/**
 * POST /api/v1/practices — a super admin creates a clinic, owned by an existing clinic admin,
 * by a new admin account (made by the praktiqu-endpoint plugin, mocked here) or by nobody yet.
 *
 * Clinics created through the route take an AUTO_INCREMENT id, so they are found and removed
 * by the name prefix NAME rather than by the id range.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

vi.mock('@/repositories/wp/clinic-admins.write', () => ({ createClinicAdminViaPlugin: vi.fn() }));

import { prisma } from '@/lib/db';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { createClinicAdminViaPlugin } from '@/repositories/wp/clinic-admins.write';
import { assertTestDb } from '../../billing/fixtures';
import { POST } from '@/app/api/v1/practices/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/practice-create.test.ts');
const EXISTING_CLINIC = BASE + 1;
const ADMIN_WP = BASE + 500; // a real clinic admin account
const PATIENT_WP = BASE + 501;
const DOCTOR_WP = BASE + 502; // active professional "Psikolog Uji Bentrok 8740"
const NEW_ADMIN_WP = BASE + 503; // the id the mocked plugin hands out
const NAME = 'Klinik Uji CRUD 8740';
const DOMAIN = 'crud-create.test.local';

const SUPER = 'crud-create-test-super';
const ADMIN_AUTH = 'crud-create-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function create(sub: string, role: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/v1/practices', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return POST(req);
}
const superCreate = (body: unknown) => create(SUPER, 'SUPER_ADMIN', body);

const clinicRow = (name: string) =>
  prisma.kcClinic.findFirst({ where: { name }, select: { id: true, clinicAdminId: true, status: true } });
const clinicCount = () => prisma.kcClinic.count();

const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
async function wpUser(id: number, capabilities: string, meta: Record<string, string> = {}) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@${DOMAIN}`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities } });
  for (const [metaKey, metaValue] of Object.entries(meta)) {
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey, metaValue } });
  }
}

async function wipe() {
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE (id >= ? AND id < ?) OR name LIKE ?`, BASE, END, `${NAME}%`);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-create-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_WP, caps('kiviCare_clinic_admin'));
  await wpUser(PATIENT_WP, caps('kiviCare_patient'));
  await wpUser(DOCTOR_WP, caps('kiviCare_doctor'), { first_name: 'Psikolog', last_name: 'Uji Bentrok 8740' });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, ?, 1, ?, 0, NOW())`,
    EXISTING_CLINIC,
    `${NAME} Lama`,
    `lama@${DOMAIN}`,
    ADMIN_WP,
  );
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN_AUTH, 'CLINIC_ADMIN', ADMIN_WP]] as const) {
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

beforeEach(() => {
  vi.mocked(createClinicAdminViaPlugin).mockReset();
});

describe('refusals', () => {
  it('403s a clinic admin and creates nothing', async () => {
    const before = await clinicCount();
    expect((await create(ADMIN_AUTH, 'CLINIC_ADMIN', { name: `${NAME} Ditolak` })).status).toBe(403);
    expect(await clinicCount()).toBe(before);
  });

  it('400s a body that is not JSON', async () => {
    expect((await superCreate('bukan json')).status).toBe(400);
  });

  it.each([
    {},
    { name: '   ' },
    { name: `${NAME} X`, email: 'bukan-email' },
    { name: `${NAME} X`, admin: { mode: 'new', name: 'Tanpa Email' } },
    { name: `${NAME} X`, admin: { mode: 'existing', wpUserId: 'abc' } },
    { name: `${NAME} X`, timezone: 'Asia/Jakarta' },
  ])('422s %j', async (body) => {
    const res = await superCreate(body);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('validation_error');
  });

  it.each([
    [`${NAME} Lama`, 'clinic_slug_taken'],
    ['klinik UJI crud 8740 — lama!', 'clinic_slug_taken'],
    ['Psikolog Uji Bentrok 8740', 'professional_slug_taken'],
    ['Login', 'reserved_slug'],
    ['8740', 'numeric_slug'],
    ['!!!', 'empty_slug'],
  ])('409s the name %j as %s and creates nothing', async (name, reason) => {
    const before = await clinicCount();
    const res = await superCreate({ name });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_name_conflict', reason });
    expect(await clinicCount()).toBe(before);
  });

  it('names the clinic that holds the link', async () => {
    const res = await superCreate({ name: `${NAME} Lama` });
    expect(await res.json()).toMatchObject({ slug: 'klinik-uji-crud-8740-lama', conflictId: EXISTING_CLINIC, conflictName: `${NAME} Lama` });
  });

  it('409s a clinic email another clinic has, in any case', async () => {
    const res = await superCreate({ name: `${NAME} Email`, email: `LAMA@${DOMAIN}` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_email_conflict', conflictId: EXISTING_CLINIC });
    expect(await clinicRow(`${NAME} Email`)).toBeNull();
  });

  it('422s mode existing with an account that is not a clinic admin', async () => {
    const res = await superCreate({ name: `${NAME} Pasien`, admin: { mode: 'existing', wpUserId: PATIENT_WP } });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
    expect(await clinicRow(`${NAME} Pasien`)).toBeNull();
  });

  it('409s mode new with an email WordPress already has, before calling the plugin', async () => {
    const res = await superCreate({ name: `${NAME} Admin Ganda`, admin: { mode: 'new', name: 'Admin Ganda', email: `U${ADMIN_WP}@${DOMAIN}` } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('admin_email_taken');
    expect(createClinicAdminViaPlugin).not.toHaveBeenCalled();
    expect(await clinicRow(`${NAME} Admin Ganda`)).toBeNull();
  });
});

describe('creates', () => {
  it('mode none (the default): active, no admin, audited', async () => {
    const res = await superCreate({ name: `${NAME} Tanpa Admin`, email: `tanpa@${DOMAIN}`, telephoneNo: '0221234567', city: 'Bandung', address: '  ' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({
      name: `${NAME} Tanpa Admin`,
      email: `tanpa@${DOMAIN}`,
      telephoneNo: '0221234567',
      city: 'Bandung',
      address: null,
      status: 1,
    });
    expect(body.admin).toEqual({ mode: 'none', wpUserId: null, emailSent: null });

    const row = await clinicRow(`${NAME} Tanpa Admin`);
    expect(Number(row!.id)).toBe(body.data.id);
    expect(Number(row!.clinicAdminId)).toBe(0);

    const audit = await prisma.logEntry.findFirst({ where: { action: 'practice.create', resourceId: String(body.data.id) } });
    expect(audit).toMatchObject({ userId: SUPER, resource: 'clinic' });
    expect(audit!.metadata).toMatchObject({ adminMode: 'none', adminId: null });
  });

  it('can create an inactive clinic', async () => {
    const res = await superCreate({ name: `${NAME} Nonaktif`, status: 0 });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe(0);
  });

  it('mode existing: the clinic belongs to that admin', async () => {
    const res = await superCreate({ name: `${NAME} Admin Lama`, admin: { mode: 'existing', wpUserId: ADMIN_WP } });
    expect(res.status).toBe(201);
    expect((await res.json()).admin).toEqual({ mode: 'existing', wpUserId: ADMIN_WP, emailSent: null });
    expect(Number((await clinicRow(`${NAME} Admin Lama`))!.clinicAdminId)).toBe(ADMIN_WP);
  });

  it('mode new: the plugin makes the account for the new clinic', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockImplementation(async ({ email, clinicId }) => {
      // What the real plugin does: claim the clinic for the account it created.
      await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`, NEW_ADMIN_WP, clinicId);
      return { id: NEW_ADMIN_WP, email, clinicId, emailSent: true };
    });

    const res = await superCreate({ name: `${NAME} Admin Baru`, admin: { mode: 'new', name: ' Dewi Lestari ', email: `dewi@${DOMAIN}` } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.admin).toEqual({ mode: 'new', wpUserId: NEW_ADMIN_WP, emailSent: true });
    expect(createClinicAdminViaPlugin).toHaveBeenCalledWith({ name: 'Dewi Lestari', email: `dewi@${DOMAIN}`, clinicId: body.data.id });
    expect(Number((await clinicRow(`${NAME} Admin Baru`))!.clinicAdminId)).toBe(NEW_ADMIN_WP);
  });

  it('mode new: passes emailSent=false through', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockImplementation(async ({ email, clinicId }) => ({ id: NEW_ADMIN_WP, email, clinicId, emailSent: false }));
    const res = await superCreate({ name: `${NAME} Email Gagal`, admin: { mode: 'new', name: 'Dewi', email: `dewi2@${DOMAIN}` } });
    expect(res.status).toBe(201);
    expect((await res.json()).admin.emailSent).toBe(false);
  });
});

describe('a failed admin account leaves no clinic behind', () => {
  it('502 admin_provision_failed when the plugin fails', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(new WpEndpointError('/clinic-admins failed 500: boom', 500));
    const res = await superCreate({ name: `${NAME} Gagal`, admin: { mode: 'new', name: 'Dewi', email: `gagal@${DOMAIN}` } });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('admin_provision_failed');
    expect(await clinicRow(`${NAME} Gagal`)).toBeNull();
  });

  it('502 when WordPress never answered', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(new WpEndpointError('/clinic-admins: fetch failed', 0));
    const res = await superCreate({ name: `${NAME} Putus`, admin: { mode: 'new', name: 'Dewi', email: `putus@${DOMAIN}` } });
    expect(res.status).toBe(502);
    expect(await clinicRow(`${NAME} Putus`)).toBeNull();
  });

  it('409 admin_email_taken when WordPress got the email first', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(
      new WpEndpointError('/clinic-admins failed 409: That email is already registered.', 409, 'praktiqu_email_taken'),
    );
    const res = await superCreate({ name: `${NAME} Balapan`, admin: { mode: 'new', name: 'Dewi', email: `balapan@${DOMAIN}` } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('admin_email_taken');
    expect(await clinicRow(`${NAME} Balapan`)).toBeNull();
  });
});
