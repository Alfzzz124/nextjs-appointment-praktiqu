/**
 * GET /sessions?practiceId= — accepted, and it can only narrow the actor's scope.
 *
 * The strict query schema used to 422 on `practiceId`, which the Laravel FE sends on
 * every clinic-admin dashboard load: the whole Appointments list came back empty and
 * read as "no appointments yet" (2026-09-25 FE audit, DD-1 / API-1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const { GET } = await import('@/app/api/v1/sessions/route');

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 8_500_000;
const END = BASE + 10_000;
const OWN = BASE + 1;
const FOREIGN = BASE + 2;
const ADMIN_WP = BASE + 500;
const DOCTOR = BASE + 20;
const PATIENT = BASE + 30;

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(sub: string, role: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

async function list(sub: string, role: string, qs: string) {
  const res = await GET(
    new NextRequest(`http://localhost/api/v1/sessions?${qs}`, {
      headers: { authorization: `Bearer ${await token(sub, role)}` },
    }),
  );
  const body = (await res.json()) as { data?: Array<{ id: unknown }> };
  const ids = (body.data ?? []).map((s) => Number(String(s.id).replace(/\D/g, ''))).filter((id) => id >= BASE && id < END);
  return { status: res.status, ids: ids.sort() };
}

async function linkAuthUser(cuid: string, wpUserId: number, role: string) {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@sessions-practice.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: role as never,
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'sessions-practice-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, owner] of [[OWN, ADMIN_WP], [FOREIGN, 1]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, 'Klinik', 'klinik@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
      id,
      owner,
    );
  }
  for (const [id, clinic] of [[BASE + 100, OWN], [BASE + 101, FOREIGN]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
          description, status, created_at)
       VALUES (?, ?, ?, ?, '2026-10-05', '09:00:00', '2026-10-05', '10:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
      id,
      clinic,
      DOCTOR,
      PATIENT,
      APPOINTMENT_STATUS.BOOKED,
    );
  }
  await linkAuthUser('sessions-practice-test-admin', ADMIN_WP, 'CLINIC_ADMIN');
  await linkAuthUser('sessions-practice-test-super', BASE + 501, 'SUPER_ADMIN');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const RANGE = 'dateFrom=2026-10-05&dateTo=2026-10-05&limit=100';

describe('GET /sessions?practiceId=', () => {
  it('no longer 422s — a clinic admin gets their clinic’s sessions', async () => {
    const r = await list('sessions-practice-test-admin', 'CLINIC_ADMIN', `practiceId=${OWN}&${RANGE}`);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual([BASE + 100]);
  });

  it('cannot widen a clinic admin to another clinic', async () => {
    const r = await list('sessions-practice-test-admin', 'CLINIC_ADMIN', `practiceId=${FOREIGN}&${RANGE}`);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual([]);
  });

  it('narrows a super admin to the requested clinic', async () => {
    const r = await list('sessions-practice-test-super', 'SUPER_ADMIN', `practiceId=${FOREIGN}&${RANGE}`);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual([BASE + 101]);
  });
});
