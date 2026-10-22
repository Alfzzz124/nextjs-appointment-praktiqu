/**
 * GET /practices/clinic-admins — the accounts a super admin can make a clinic's admin.
 * Read from WordPress, so an admin created in KiviCare who has never logged in to the API
 * (no `users` row yet) is still offered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { GET } from '@/app/api/v1/practices/clinic-admins/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/clinic-admins.test.ts');
const ADMIN_X = BASE + 500; // owns two clinics
const ADMIN_BROKEN = BASE + 501; // broken capability length prefix, owns none
const ADMIN_NONAME = BASE + 502; // empty display_name
const PATIENT = BASE + 503;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const SUPER = 'clinic-admins-test-super';
const ADMIN_AUTH = 'clinic-admins-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
const get = async (sub?: string, role?: string) =>
  GET(new NextRequest('http://localhost/api/v1/practices/clinic-admins', {
    headers: sub ? { authorization: `Bearer ${await token(sub, role!)}` } : {},
  }));

async function wpUser(id: number, displayName: string, capabilities: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@clinic-admins.test.local`, displayName, userRegistered: new Date() },
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
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'clinic-admins-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_X, 'Admin Iks', caps('kiviCare_clinic_admin'));
  await wpUser(ADMIN_BROKEN, 'Admin Rusak', 'a:1:{s:15:"kiviCare_clinic_admin";b:1;}');
  await wpUser(ADMIN_NONAME, '', caps('kiviCare_clinic_admin'));
  await wpUser(PATIENT, 'Pasien', caps('kiviCare_patient'));
  await clinic(CLINIC_2, ADMIN_X);
  await clinic(CLINIC_1, ADMIN_X);
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN_AUTH, 'CLINIC_ADMIN', ADMIN_X]] as const) {
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

type Row = { wpUserId: number; name: string; email: string; clinicIds: number[] };

describe('GET /practices/clinic-admins', () => {
  it('lists clinic admin accounts with the clinics they own', async () => {
    const res = await get(SUPER, 'SUPER_ADMIN');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Row[]; total: number };
    expect(body.total).toBe(body.data.length);
    expect(body.data.find((r) => r.wpUserId === ADMIN_X)).toEqual({
      wpUserId: ADMIN_X,
      name: 'Admin Iks',
      email: `u${ADMIN_X}@clinic-admins.test.local`,
      clinicIds: [CLINIC_1, CLINIC_2],
    });
  });

  it('includes an account whose capability row has a broken length prefix', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === ADMIN_BROKEN)).toMatchObject({ name: 'Admin Rusak', clinicIds: [] });
  });

  it('falls back to user_login for an empty display name', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === ADMIN_NONAME)?.name).toBe(`u${ADMIN_NONAME}`);
  });

  it('leaves out other roles', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === PATIENT)).toBeUndefined();
  });

  it('refuses a clinic admin with 403', async () => {
    expect((await get(ADMIN_AUTH, 'CLINIC_ADMIN')).status).toBe(403);
  });

  it('refuses a request without a token with 401', async () => {
    expect((await get()).status).toBe(401);
  });
});
