/**
 * A patient registered at clinics A and B belongs to both. The list already used every
 * mapping (EXISTS), but opening the record compared against the patient's FIRST mapping
 * only, so clinic B listed the patient and then answered 403 on click.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb, seedPatient, seedPatientClinicMapping, useIdBlock } from '../../billing/fixtures';
import { GET as clientGet } from '@/app/api/v1/clients/[id]/route';
import { GET as clientsGet } from '@/app/api/v1/clients/route';

const { BASE, END } = useIdBlock('integration/client/client-multi-clinic-access.test.ts');
const ADMIN_WP = BASE + 500;
const CLINIC_A = BASE + 1;
const CLINIC_B = BASE + 2;
const P_BOTH = BASE + 100; // mapped to A first, then B
const P_A_ONLY = BASE + 101;
const ADMIN = 'client-multi-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
let jwt: string;

function req(path: string, clinicHeader: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${jwt}`, 'x-praktiqu-clinic-id': clinicHeader },
  });
}
const open = (id: number, clinic: number) =>
  clientGet(req(`/api/v1/clients/${id}`, String(clinic)), { params: Promise.resolve({ id: String(id) }) } as any);

async function clinic(id: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    ADMIN_WP,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_clinic_mappings WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'client-multi-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A);
  await clinic(CLINIC_B);
  await seedPatient({ id: P_BOTH, name: 'Pasien Dua', email: `p${P_BOTH}@client-multi.test.local` });
  await seedPatient({ id: P_A_ONLY, name: 'Pasien Satu', email: `p${P_A_ONLY}@client-multi.test.local` });
  await seedPatientClinicMapping({ id: BASE + 200, patientId: P_BOTH, clinicId: CLINIC_A });
  await seedPatientClinicMapping({ id: BASE + 201, patientId: P_BOTH, clinicId: CLINIC_B });
  await seedPatientClinicMapping({ id: BASE + 202, patientId: P_A_ONLY, clinicId: CLINIC_A });
  await prisma.user.create({
    data: {
      id: ADMIN, email: `${ADMIN}@test.local`, username: ADMIN, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(ADMIN_WP), status: 1,
    },
  });
  jwt = await new SignJWT({ role: 'CLINIC_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADMIN)
    .setExpirationTime('1h')
    .sign(SECRET);
});

afterAll(async () => {
  await wipe();
});

describe('opening a patient while clinic B is active', () => {
  it('opens a patient of clinics A and B', async () => {
    expect((await open(P_BOTH, CLINIC_B)).status).toBe(200);
  });

  it('still refuses a patient of clinic A only with 403', async () => {
    expect((await open(P_A_ONLY, CLINIC_B)).status).toBe(403);
  });

  it('lists the shared patient and not the clinic-A-only one', async () => {
    const res = await clientsGet(req('/api/v1/clients?limit=100', String(CLINIC_B)));
    expect(res.status).toBe(200);
    const listed = ((await res.json()) as { data: Array<{ id: number }> }).data.map((c) => c.id);
    expect(listed).toContain(P_BOTH);
    expect(listed).not.toContain(P_A_ONLY);
  });
});

describe('opening a patient while clinic A is active', () => {
  it('opens both patients', async () => {
    expect((await open(P_BOTH, CLINIC_A)).status).toBe(200);
    expect((await open(P_A_ONLY, CLINIC_A)).status).toBe(200);
  });
});
