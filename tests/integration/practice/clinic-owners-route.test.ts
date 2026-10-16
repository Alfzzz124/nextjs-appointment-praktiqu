/**
 * Ticking clinic owners. SUPER_ADMIN: any clinic. CLINIC_ADMIN: their active clinic only
 * (another clinic answers 404). Everyone else, an owner psychologist included: 403.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';

const { GET, PUT } = await import('@/app/api/v1/practices/[id]/owners/route');

const BASE = 8_790_000;
const END = BASE + 10_000;
const CLINIC = BASE + 1; // ADMIN_WP's
const ELSEWHERE = BASE + 2; // someone else's
const ADMIN_WP = BASE + 400;
const DOC_A = BASE + 500;
const DOC_B = BASE + 501;
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(sub: string, role: string, clinicId: number, method = 'GET', body?: unknown): Promise<NextRequest> {
  const jwt = await new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
  return new NextRequest(`http://localhost/api/v1/practices/${clinicId}/owners`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const ctx = (id: number) => ({ params: { id: String(id) } });

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owners-route-test-' } } });
}

async function authUser(id: string, role: string, wpUserId: number | null) {
  await prisma.user.create({
    data: { id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'T U', role: role as never, wpUserId: wpUserId === null ? null : BigInt(wpUserId), status: 1 },
  });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, name] of [[DOC_A, 'Dr A'], [DOC_B, 'Dr B']] as const) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `or${id}`, userEmail: `or${id}@test.local`, displayName: name, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Pemilik', 'a@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`, CLINIC, ADMIN_WP);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Lain', 'b@test.local', '0221234567', 'Jl. Uji 2', 'Bandung', 1, 0, 0, NOW())`, ELSEWHERE);
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 9001), doctorId: BigInt(DOC_A), clinicId: BigInt(CLINIC), createdAt: new Date() } });
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 9002), doctorId: BigInt(DOC_B), clinicId: BigInt(CLINIC), createdAt: new Date() } });
  await authUser('owners-route-test-super', 'SUPER_ADMIN', null);
  await authUser('owners-route-test-admin', 'CLINIC_ADMIN', ADMIN_WP);
  await authUser('owners-route-test-doc', 'PROFESSIONAL', DOC_A);
});

afterAll(async () => {
  await wipe();
});

describe('GET /practices/{id}/owners', () => {
  it('gives the clinic admin the roster of their clinic', async () => {
    const res = await GET(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC), ctx(CLINIC));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clinic: { id: CLINIC, name: 'Klinik Pemilik' },
      data: [
        { doctorId: DOC_A, name: 'Dr A', owner: false, source: null },
        { doctorId: DOC_B, name: 'Dr B', owner: false, source: null },
      ],
    });
  });

  it("answers 404 for another clinic's roster", async () => {
    const res = await GET(await req('owners-route-test-admin', 'CLINIC_ADMIN', ELSEWHERE), ctx(ELSEWHERE));
    expect(res.status).toBe(404);
  });

  it('answers 403 to a psychologist', async () => {
    const res = await GET(await req('owners-route-test-doc', 'PROFESSIONAL', CLINIC), ctx(CLINIC));
    expect(res.status).toBe(403);
  });
});

describe('PUT /practices/{id}/owners', () => {
  it('lets super admin tick an owner and returns the new roster', async () => {
    const res = await PUT(await req('owners-route-test-super', 'SUPER_ADMIN', CLINIC, 'PUT', { doctorIds: [DOC_B] }), ctx(CLINIC));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.find((r: { doctorId: number }) => r.doctorId === DOC_B)).toEqual({ doctorId: DOC_B, name: 'Dr B', owner: true, source: 'manual' });
    const row = await prisma.clinicOwner.findUnique({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_B) } },
    });
    expect(row?.createdBy).toBe('owners-route-test-super');
  });

  it('refuses a psychologist who does not practise at the clinic with 422 fields.doctorIds', async () => {
    const res = await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', { doctorIds: [DOC_A, ADMIN_WP] }), ctx(CLINIC));
    expect(res.status).toBe(422);
    expect((await res.json()).fields.doctorIds).toEqual([`Not an active psychologist of this clinic: ${ADMIN_WP}`]);
  });

  it('refuses a malformed body with 422 and bad JSON with 400', async () => {
    expect((await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', { doctorIds: 'x' }), ctx(CLINIC))).status).toBe(422);
    expect((await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', '{ nope'), ctx(CLINIC))).status).toBe(400);
  });

  it('answers 403 to a psychologist, even one who owns the clinic', async () => {
    await prisma.clinicOwner.upsert({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_A) } },
      create: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_A), createdBy: 'test' },
      update: {},
    });
    const res = await PUT(await req('owners-route-test-doc', 'PROFESSIONAL', CLINIC, 'PUT', { doctorIds: [] }), ctx(CLINIC));
    expect(res.status).toBe(403);
  });
});
