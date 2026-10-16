/**
 * GET /sessions/export, /clients/export and /sessions/pending — confined to the actor's clinic.
 *
 * All three ignored the caller's clinic for CLINIC_ADMIN and RECEPTIONIST: the exports
 * passed a clinic filter only for SUPER_ADMIN, and the pending queue took `?professionalId=`
 * as given. Any clinic admin or receptionist could read every clinic's appointments,
 * patients and pending queues (2026-10-16 review of feat/pemilik-klinik).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const { GET: sessionsExport } = await import('@/app/api/v1/sessions/export/route');
const { GET: clientsExport } = await import('@/app/api/v1/clients/export/route');
const { GET: pending } = await import('@/app/api/v1/sessions/pending/route');

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 8_860_000;
const END = BASE + 10_000;

const OWN = BASE + 1; // the admin's default clinic (lowest owned id)
const OWN2 = BASE + 2; // the admin's second clinic, reached via X-Praktiqu-Clinic-Id
const FOREIGN = BASE + 3; // someone else's clinic

const DOC_OWN = BASE + 20;
const DOC_OWN2 = BASE + 21;
const DOC_FOREIGN = BASE + 22;

const P_OWN = BASE + 30;
const P_OWN2 = BASE + 31;
const P_FOREIGN = BASE + 32;

const APPT_OWN = BASE + 100;
const APPT_OWN2 = BASE + 101;
const APPT_FOREIGN = BASE + 102;

const ADMIN_WP = BASE + 500;
const RECEP_WP = BASE + 501;
const RECEP_NONE_WP = BASE + 502;
const SUPER_WP = BASE + 503;
const CLIENT_WP = P_OWN;

const PREFIX = 'export-scope-test-';
const ADMIN = `${PREFIX}admin`;
const RECEP = `${PREFIX}recep`;
const RECEP_NONE = `${PREFIX}recep-none`;
const SUPER = `${PREFIX}super`;
const CLIENT = `${PREFIX}client`;

const ROLE: Record<string, string> = {
  [ADMIN]: 'CLINIC_ADMIN',
  [RECEP]: 'RECEPTIONIST',
  [RECEP_NONE]: 'RECEPTIONIST',
  [SUPER]: 'SUPER_ADMIN',
  [CLIENT]: 'CLIENT',
};

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function request(path: string, sub: string, clinicHeader?: number) {
  const jwt = await new SignJWT({ role: ROLE[sub] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (clinicHeader !== undefined) headers['x-praktiqu-clinic-id'] = String(clinicHeader);
  return new NextRequest(`http://localhost/api/v1${path}`, { headers });
}

/** Ids inside this test's range, so other suites' rows in the shared DB don't matter. */
function ownIds(rows: Array<{ id: unknown }>): number[] {
  return rows
    .map((r) => Number(String(r.id).replace(/\D/g, '')))
    .filter((id) => id >= BASE && id < END)
    .sort((a, b) => a - b);
}

const RANGE = 'from=2026-10-07&to=2026-10-07';

async function exportSessionIds(sub: string, qs = '', clinicHeader?: number) {
  const res = await sessionsExport(await request(`/sessions/export?${RANGE}&${qs}`, sub, clinicHeader));
  const body = (await res.json()) as { data?: Array<{ id: unknown }> };
  return { status: res.status, ids: ownIds(body.data ?? []) };
}

async function exportClientIds(sub: string, qs = '', clinicHeader?: number) {
  const res = await clientsExport(await request(`/clients/export?${qs}`, sub, clinicHeader));
  const body = (await res.json()) as Array<{ id: unknown }>;
  return { status: res.status, ids: res.status === 200 ? ownIds(body) : [] };
}

async function pendingIds(sub: string, professionalId: number, clinicHeader?: number) {
  const res = await pending(
    await request(`/sessions/pending?professionalId=${professionalId}`, sub, clinicHeader),
  );
  const body = (await res.json()) as { data?: Array<{ id: unknown }> };
  return { status: res.status, ids: ownIds(body.data ?? []) };
}

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedPatient(id: number, clinic: number) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `${id}@export-scope.test.local`,
      displayName: `Patient ${id}`,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities('kiviCare_patient') },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: 'Patient' },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: String(id) },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_clinic_mappings (patient_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    id,
    clinic,
  );
}

async function linkAuthUser(cuid: string, wpUserId: number) {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@export-scope.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: ROLE[cuid] as never,
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

async function wipe() {
  const range = [BASE, END] as const;
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, ...range);
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_clinic_mappings WHERE patient_id >= ? AND patient_id < ?`,
    ...range,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_receptionist_clinic_mappings WHERE receptionist_id >= ? AND receptionist_id < ?`,
    ...range,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, ...range);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  for (const [id, owner] of [[OWN, ADMIN_WP], [OWN2, ADMIN_WP], [FOREIGN, 1]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, 'Klinik', 'klinik@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
      id,
      owner,
    );
  }

  for (const [id, clinic, doctor, patient] of [
    [APPT_OWN, OWN, DOC_OWN, P_OWN],
    [APPT_OWN2, OWN2, DOC_OWN2, P_OWN2],
    [APPT_FOREIGN, FOREIGN, DOC_FOREIGN, P_FOREIGN],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
          description, status, created_at)
       VALUES (?, ?, ?, ?, '2026-10-07', '09:00:00', '2026-10-07', '10:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
      id,
      clinic,
      doctor,
      patient,
      APPOINTMENT_STATUS.PENDING,
    );
  }

  await seedPatient(P_OWN, OWN);
  await seedPatient(P_OWN2, OWN2);
  await seedPatient(P_FOREIGN, FOREIGN);

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_receptionist_clinic_mappings (receptionist_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    RECEP_WP,
    OWN,
  );

  await linkAuthUser(ADMIN, ADMIN_WP);
  await linkAuthUser(RECEP, RECEP_WP);
  await linkAuthUser(RECEP_NONE, RECEP_NONE_WP);
  await linkAuthUser(SUPER, SUPER_WP);
  await linkAuthUser(CLIENT, CLIENT_WP);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('GET /sessions/export — clinic scope', () => {
  it('confines a clinic admin to their default clinic', async () => {
    expect(await exportSessionIds(ADMIN)).toEqual({ status: 200, ids: [APPT_OWN] });
  });

  it('follows the X-Praktiqu-Clinic-Id active clinic', async () => {
    expect(await exportSessionIds(ADMIN, '', OWN2)).toEqual({ status: 200, ids: [APPT_OWN2] });
  });

  it('ignores ?clinicId= from a clinic admin', async () => {
    expect(await exportSessionIds(ADMIN, `clinicId=${FOREIGN}`)).toEqual({ status: 200, ids: [APPT_OWN] });
  });

  it('confines a receptionist to their clinic', async () => {
    expect(await exportSessionIds(RECEP)).toEqual({ status: 200, ids: [APPT_OWN] });
  });

  it('gives a receptionist with no clinic nothing', async () => {
    expect(await exportSessionIds(RECEP_NONE)).toEqual({ status: 200, ids: [] });
  });

  it('lets a super admin see every clinic, or filter by one', async () => {
    expect((await exportSessionIds(SUPER)).ids).toEqual([APPT_OWN, APPT_OWN2, APPT_FOREIGN]);
    expect((await exportSessionIds(SUPER, `clinicId=${FOREIGN}`)).ids).toEqual([APPT_FOREIGN]);
  });
});

describe('GET /clients/export — clinic scope', () => {
  it('confines a clinic admin to their default clinic', async () => {
    expect(await exportClientIds(ADMIN)).toEqual({ status: 200, ids: [P_OWN] });
  });

  it('follows the X-Praktiqu-Clinic-Id active clinic', async () => {
    expect(await exportClientIds(ADMIN, '', OWN2)).toEqual({ status: 200, ids: [P_OWN2] });
  });

  it('ignores ?clinicId= from a clinic admin', async () => {
    expect(await exportClientIds(ADMIN, `clinicId=${FOREIGN}`)).toEqual({ status: 200, ids: [P_OWN] });
  });

  it('confines a receptionist to their clinic', async () => {
    expect(await exportClientIds(RECEP)).toEqual({ status: 200, ids: [P_OWN] });
  });

  it('gives a receptionist with no clinic nothing', async () => {
    expect(await exportClientIds(RECEP_NONE)).toEqual({ status: 200, ids: [] });
  });

  it('lets a super admin see every clinic, or filter by one', async () => {
    expect((await exportClientIds(SUPER)).ids).toEqual([P_OWN, P_OWN2, P_FOREIGN]);
    expect((await exportClientIds(SUPER, `clinicId=${FOREIGN}`)).ids).toEqual([P_FOREIGN]);
  });
});

describe('GET /sessions/pending — clinic scope', () => {
  it('shows a clinic admin the queue of a professional in their clinic', async () => {
    expect(await pendingIds(ADMIN, DOC_OWN)).toEqual({ status: 200, ids: [APPT_OWN] });
  });

  it('gives a clinic admin nothing for a professional outside their clinic', async () => {
    expect(await pendingIds(ADMIN, DOC_FOREIGN)).toEqual({ status: 200, ids: [] });
  });

  it('follows the X-Praktiqu-Clinic-Id active clinic', async () => {
    expect(await pendingIds(ADMIN, DOC_OWN2, OWN2)).toEqual({ status: 200, ids: [APPT_OWN2] });
    expect(await pendingIds(ADMIN, DOC_OWN, OWN2)).toEqual({ status: 200, ids: [] });
  });

  it('confines a receptionist to their clinic', async () => {
    expect(await pendingIds(RECEP, DOC_OWN)).toEqual({ status: 200, ids: [APPT_OWN] });
    expect(await pendingIds(RECEP, DOC_FOREIGN)).toEqual({ status: 200, ids: [] });
  });

  it('gives a receptionist with no clinic nothing', async () => {
    expect(await pendingIds(RECEP_NONE, DOC_OWN)).toEqual({ status: 200, ids: [] });
  });

  it('lets a super admin read any professional’s queue', async () => {
    expect(await pendingIds(SUPER, DOC_FOREIGN)).toEqual({ status: 200, ids: [APPT_FOREIGN] });
  });

  it('refuses a client', async () => {
    expect((await pendingIds(CLIENT, DOC_OWN)).status).toBe(403);
  });
});
