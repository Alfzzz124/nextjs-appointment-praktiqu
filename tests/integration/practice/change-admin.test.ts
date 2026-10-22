/**
 * POST /practices/:id/change-admin — a super admin hands a clinic to a clinic admin.
 *
 * It used to look the new admin up by auth cuid and then write Number(cuid) (NaN) into
 * wp_kc_clinics.clinic_admin_id, so it could not succeed with any input. It now takes a
 * wp_users.ID that must hold the kiviCare_clinic_admin capability.
 *
 * The tests in this file run in order and build on each other's state (vitest runs the
 * tests of one file sequentially).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { POST } from '@/app/api/v1/practices/[id]/change-admin/route';
import { GET as practicesGet } from '@/app/api/v1/practices/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/change-admin.test.ts');
const ADMIN1 = BASE + 500; // owns A and B at the start
const ADMIN2 = BASE + 501;
const ADMIN3 = BASE + 502; // capability row with a broken length prefix
const PATIENT = BASE + 503;
const NO_SUCH_USER = BASE + 599;
const CLINIC_A = BASE + 1;
const CLINIC_B = BASE + 2;
const NO_SUCH_CLINIC = BASE + 9;

const SUPER = 'change-admin-test-super';
const ADMIN1_AUTH = 'change-admin-test-admin1';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function call(sub: string, role: string, clinicId: string, body: string) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${clinicId}/change-admin`, {
    method: 'POST',
    body,
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return POST(req, { params: { id: clinicId } } as any);
}
const superCall = (clinicId: number | string, body: unknown) =>
  call(SUPER, 'SUPER_ADMIN', String(clinicId), typeof body === 'string' ? body : JSON.stringify(body));

async function adminOf(clinicId: number): Promise<number> {
  const row = await prisma.kcClinic.findUnique({ where: { id: BigInt(clinicId) }, select: { clinicAdminId: true } });
  return Number(row!.clinicAdminId);
}

const auditRows = () =>
  prisma.logEntry.findMany({
    where: { action: 'practice.admin_changed', resourceId: { in: [String(CLINIC_A), String(CLINIC_B)] } },
    orderBy: { occurredAt: 'asc' },
  });

async function wpUser(id: number, capabilities: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@change-admin.test.local`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities } });
}
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    adminId,
  );
}

async function wipe() {
  await prisma.logEntry.deleteMany({
    where: { action: 'practice.admin_changed', resourceId: { in: [String(CLINIC_A), String(CLINIC_B)] } },
  });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'change-admin-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN1, caps('kiviCare_clinic_admin'));
  await wpUser(ADMIN2, caps('kiviCare_clinic_admin'));
  // Length prefix 15 is wrong (the slug has 21 characters): unserialize() fails on it, a
  // LIKE match does not. Real rows like this exist on the live site.
  await wpUser(ADMIN3, 'a:1:{s:15:"kiviCare_clinic_admin";b:1;}');
  await wpUser(PATIENT, caps('kiviCare_patient'));
  await clinic(CLINIC_A, ADMIN1);
  await clinic(CLINIC_B, ADMIN1);
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN1_AUTH, 'CLINIC_ADMIN', ADMIN1]] as const) {
    await prisma.user.create({
      data: {
        id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'Test',
        role, wpUserId: wp === null ? null : BigInt(wp), status: 1,
      },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('refusals', () => {
  it('refuses a clinic admin with 403', async () => {
    const res = await call(ADMIN1_AUTH, 'CLINIC_ADMIN', String(CLINIC_B), JSON.stringify({ newAdminId: ADMIN2 }));
    expect(res.status).toBe(403);
    expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
  });

  it('404s a clinic that does not exist', async () => {
    expect((await superCall(NO_SUCH_CLINIC, { newAdminId: ADMIN2 })).status).toBe(404);
  });

  it('404s a non-numeric clinic id', async () => {
    expect((await superCall('abc', { newAdminId: ADMIN2 })).status).toBe(404);
  });

  it('400s a body that is not JSON', async () => {
    expect((await superCall(CLINIC_B, 'not json')).status).toBe(400);
  });

  it.each([{}, { newAdminId: 'abc' }, { newAdminId: 0 }, { newAdminId: 'cmrhxo22l0006usokhbjug1fe' }, { newAdminId: 1.5 }])(
    '422s the body %j',
    async (body) => {
      expect((await superCall(CLINIC_B, body)).status).toBe(422);
      expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
    },
  );

  it('422s not_a_clinic_admin for a patient account', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: PATIENT });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
    expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
  });

  it('422s not_a_clinic_admin for a WordPress user that does not exist', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: NO_SUCH_USER });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
  });
});

describe('changes', () => {
  it('hands clinic B to another admin and audits it', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: ADMIN2 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      clinicId: CLINIC_B,
      adminId: ADMIN2,
      previousAdminId: ADMIN1,
      previousAdminClinicCount: 1,
      unchanged: false,
    });
    expect(await adminOf(CLINIC_B)).toBe(ADMIN2);
    const [row] = await auditRows();
    expect(row).toMatchObject({ userId: SUPER, resource: 'clinic', resourceId: String(CLINIC_B) });
    expect(row.metadata).toMatchObject({ previousAdminId: ADMIN1, newAdminId: ADMIN2 });
  });

  it('reports when the previous admin is left with no clinic', async () => {
    const res = await superCall(CLINIC_A, { newAdminId: ADMIN2 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ previousAdminId: ADMIN1, previousAdminClinicCount: 0 });
  });

  it('accepts a numeric string and a capability row with a broken length prefix', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: String(ADMIN3) });
    expect(res.status).toBe(200);
    expect(await adminOf(CLINIC_B)).toBe(ADMIN3);
  });

  it('changes nothing and audits nothing when the admin is already in place', async () => {
    const before = (await auditRows()).length;
    const res = await superCall(CLINIC_B, { newAdminId: ADMIN3 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ unchanged: true, adminId: ADMIN3, previousAdminId: ADMIN3 });
    expect((await auditRows()).length).toBe(before);
  });

  it('the previous admin loses the clinic on their very next request', async () => {
    const req = new NextRequest('http://localhost/api/v1/practices', {
      headers: { authorization: `Bearer ${await token(ADMIN1_AUTH, 'CLINIC_ADMIN')}`, 'x-praktiqu-clinic-id': String(CLINIC_A) },
    });
    const res = await practicesGet(req);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('clinic_not_in_scope');
  });
});
