/**
 * A PROFESSIONAL sees only the clients they have seen (BR-10.01) — not the whole clinic.
 *
 * Before this, GET /clients scoped a psychologist to their clinic, so every one of them
 * received every colleague's patients (name, email, phone). Found by the 2026-09-25
 * Laravel FE audit (DD-5): the FE's own row filter could not catch it because client
 * rows carry no doctor field.
 *
 * Also pins /clients/:id/custom-fields, which authenticated but never scoped — any
 * signed-in account, a patient's included, could read any other patient's fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const { listClients, getClient, ClientServiceError } = await import('@/services/client/client.service');
const { GET: customFieldsGet } = await import('@/app/api/v1/clients/[id]/custom-fields/route');

const BASE = 8_400_000;
const END = BASE + 100_000;
const CLINIC = BigInt(BASE + 900);
const DOCTOR = BASE + 700;
const OTHER_DOCTOR = BASE + 701;

const SEEN = BASE + 1; // booked with DOCTOR
const COLLEAGUES = BASE + 2; // same clinic, only ever seen by OTHER_DOCTOR
const CANCELLED_ONLY = BASE + 3; // DOCTOR's only appointment with them was cancelled

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function makeToken(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedPatient(id: number, name: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `${id}@pro-scope.test.local`,
      displayName: name,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities('kiviCare_patient') },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: name.split(' ')[0] },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: name.split(' ').slice(1).join(' ') || '-' },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_clinic_mappings (patient_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    id,
    CLINIC,
  );
}

async function seedAppointment(id: number, doctorId: number, patientId: number, status: number) {
  await prisma.kcAppointment.create({
    data: {
      id: BigInt(id),
      clinicId: CLINIC,
      doctorId: BigInt(doctorId),
      patientId: BigInt(patientId),
      appointmentStartDate: new Date('2026-05-04T00:00:00Z'),
      appointmentStartTime: new Date('1970-01-01T10:00:00Z'),
      appointmentEndDate: new Date('2026-05-04T00:00:00Z'),
      appointmentEndTime: new Date('1970-01-01T11:00:00Z'),
      appointmentTimezone: 'Asia/Jakarta',
      status,
      createdAt: new Date(),
    } as never,
  });
}

async function linkAuthUser(cuid: string, wpUserId: number, role: 'CLIENT' | 'CLINIC_ADMIN' | 'PROFESSIONAL') {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@pro-scope.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role,
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

const professional = { id: 'pro-scope-test-doctor', role: 'PROFESSIONAL' } as never;
const clinicAdmin = { id: 'pro-scope-test-admin', role: 'CLINIC_ADMIN' } as never;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_clinic_mappings WHERE patient_id >= ? AND patient_id < ?`,
    BASE,
    END,
  );
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcAppointment.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'pro-scope-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await seedPatient(SEEN, 'Seen Patient');
  await seedPatient(COLLEAGUES, 'Colleagues Patient');
  await seedPatient(CANCELLED_ONLY, 'Cancelled Patient');

  // Both doctors work at CLINIC — the old clinic scope handed each the other's patients.
  await prisma.kcDoctorClinicMapping.createMany({
    data: [
      { id: BigInt(BASE + 10), doctorId: BigInt(DOCTOR), clinicId: CLINIC, createdAt: new Date() },
      { id: BigInt(BASE + 11), doctorId: BigInt(OTHER_DOCTOR), clinicId: CLINIC, createdAt: new Date() },
    ],
  });
  await seedAppointment(BASE + 5000, DOCTOR, SEEN, APPOINTMENT_STATUS.BOOKED);
  await seedAppointment(BASE + 5001, OTHER_DOCTOR, COLLEAGUES, APPOINTMENT_STATUS.CHECK_OUT);
  await seedAppointment(BASE + 5002, DOCTOR, CANCELLED_ONLY, APPOINTMENT_STATUS.CANCELLED);

  await linkAuthUser('pro-scope-test-doctor', DOCTOR, 'PROFESSIONAL');
  await linkAuthUser('pro-scope-test-admin', BASE + 800, 'CLINIC_ADMIN');
  await linkAuthUser('pro-scope-test-patient', COLLEAGUES, 'CLIENT');
  // The admin owns CLINIC; resolveKcActor falls back to kcClinic.clinicAdminId.
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(BASE + 12), doctorId: BigInt(BASE + 800), clinicId: CLINIC, createdAt: new Date() },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const idsOf = (page: { data: Array<{ id: number }> }) => page.data.map((c) => c.id).sort();

describe('listClients — PROFESSIONAL scope', () => {
  it('returns only the patients the professional has a qualifying appointment with', async () => {
    const page = await listClients({ actor: professional, query: { page: 1, limit: 100 } as never });
    expect(idsOf(page)).toEqual([SEEN]);
    expect(page.pagination.totalItems).toBe(1);
  });

  it('still gives a clinic admin the whole clinic', async () => {
    const page = await listClients({ actor: clinicAdmin, query: { page: 1, limit: 100 } as never });
    expect(idsOf(page)).toEqual([SEEN, COLLEAGUES, CANCELLED_ONLY].sort());
  });
});

describe('getClient — PROFESSIONAL scope', () => {
  it('opens a client the professional has seen', async () => {
    const client = await getClient({ actor: professional, id: SEEN });
    expect(client.id).toBe(SEEN);
  });

  it.each([
    ['a colleague’s patient', COLLEAGUES],
    ['a patient whose only appointment was cancelled', CANCELLED_ONLY],
  ])('refuses %s with 403', async (_label, id) => {
    const err = await getClient({ actor: professional, id }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientServiceError);
    expect((err as InstanceType<typeof ClientServiceError>).status).toBe(403);
  });
});

describe('GET /clients/:id/custom-fields — scoped like the client itself', () => {
  const get = async (sub: string, role: string, id: number) =>
    customFieldsGet(
      new NextRequest(`http://localhost/api/v1/clients/${id}/custom-fields`, {
        headers: { authorization: `Bearer ${await makeToken(role, sub)}` },
      }),
      { params: { id: String(id) } },
    );

  it('refuses a patient reading another patient’s fields', async () => {
    expect((await get('pro-scope-test-patient', 'CLIENT', SEEN)).status).toBe(403);
  });

  it('refuses a professional reading a colleague’s patient', async () => {
    expect((await get('pro-scope-test-doctor', 'PROFESSIONAL', COLLEAGUES)).status).toBe(403);
  });

  it('does not refuse the professional’s own patient', async () => {
    expect((await get('pro-scope-test-doctor', 'PROFESSIONAL', SEEN)).status).not.toBe(403);
  });
});
