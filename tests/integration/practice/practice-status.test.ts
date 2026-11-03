/**
 * Who may change what on an existing clinic: a CLINIC_ADMIN edits their own clinic's profile
 * but never its status; a SUPER_ADMIN deactivates (DELETE) and reactivates (POST /activate).
 * A renamed clinic obeys the same name/email rules as a new one.
 *
 * The tests of one file run in order and build on each other's state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { DELETE, PATCH } from '@/app/api/v1/practices/[id]/route';
import { POST as ACTIVATE } from '@/app/api/v1/practices/[id]/activate/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/practice-status.test.ts');
const OWN = BASE + 1; // the clinic admin's clinic
const OTHER = BASE + 2;
const MISSING = BASE + 9;
const ADMIN_WP = BASE + 500;
const OTHER_ADMIN_WP = BASE + 501;
const NAME = 'Klinik Uji Status 8750';
const DOMAIN = 'crud-status.test.local';

const SUPER = 'crud-status-test-super';
const ADMIN_AUTH = 'crud-status-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function call(method: 'PATCH' | 'DELETE', sub: string, role: string, id: number | string, body?: unknown) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return (method === 'PATCH' ? PATCH : DELETE)(req, { params: { id: String(id) } });
}
async function activate(sub: string, role: string, id: number | string) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}/activate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token(sub, role)}` },
  });
  return ACTIVATE(req, { params: { id: String(id) } });
}

const statusOf = async (id: number) =>
  (await prisma.kcClinic.findUnique({ where: { id: BigInt(id) }, select: { status: true } }))!.status;
const lastAudit = (action: string) =>
  prisma.logEntry.findFirst({ where: { action, resourceId: String(OWN) }, orderBy: { occurredAt: 'desc' } });

const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
async function wpUser(id: number) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@${DOMAIN}`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_clinic_admin') } });
}
async function clinic(id: number, name: string, email: string, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, ?, 1, ?, 0, NOW())`,
    id, name, email, adminId,
  );
}

async function wipe() {
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-status-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_WP);
  await wpUser(OTHER_ADMIN_WP);
  await clinic(OWN, `${NAME} Milik`, `milik@${DOMAIN}`, ADMIN_WP);
  await clinic(OTHER, `${NAME} Lain`, `lain@${DOMAIN}`, OTHER_ADMIN_WP);
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

describe('clinic admin', () => {
  it.each([{ status: 0 }, { status: 1 }, { name: `${NAME} Milik X`, status: 1 }])(
    'may not send status (%j): 403 status_change_forbidden, nothing changes',
    async (body) => {
      const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, body);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('status_change_forbidden');
      expect(await statusOf(OWN)).toBe(1);
      expect((await prisma.kcClinic.findUnique({ where: { id: BigInt(OWN) } }))!.name).toBe(`${NAME} Milik`);
    },
  );

  it('edits the profile of their own clinic, audited under their own id', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} Milik Baru`, city: 'Cimahi' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ name: `${NAME} Milik Baru`, city: 'Cimahi' });
    expect(await lastAudit('practice.update')).toMatchObject({ userId: ADMIN_AUTH });
  });

  it('cannot take another clinic\'s booking link', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} LAIN` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_name_conflict', reason: 'clinic_slug_taken', conflictId: OTHER });
  });

  it('cannot take another clinic\'s email', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { email: `LAIN@${DOMAIN}` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_email_conflict', conflictId: OTHER });
  });

  it('may keep its own name and email (no self-conflict)', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} Milik Baru`, email: `MILIK@${DOMAIN}` });
    expect(res.status).toBe(200);
  });

  it('gets 404 for another clinic', async () => {
    expect((await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OTHER, { city: 'Garut' })).status).toBe(404);
  });

  it('may not deactivate or activate', async () => {
    expect((await call('DELETE', ADMIN_AUTH, 'CLINIC_ADMIN', OWN)).status).toBe(403);
    expect((await activate(ADMIN_AUTH, 'CLINIC_ADMIN', OWN)).status).toBe(403);
    expect(await statusOf(OWN)).toBe(1);
  });
});

describe('super admin', () => {
  it('may still PATCH status', async () => {
    expect((await call('PATCH', SUPER, 'SUPER_ADMIN', OTHER, { status: 0 })).status).toBe(200);
    expect(await statusOf(OTHER)).toBe(0);
    expect((await call('PATCH', SUPER, 'SUPER_ADMIN', OTHER, { status: 1 })).status).toBe(200);
  });

  it('deactivates with DELETE (204), audited', async () => {
    const res = await call('DELETE', SUPER, 'SUPER_ADMIN', OWN);
    expect(res.status).toBe(204);
    expect(await statusOf(OWN)).toBe(0);
    expect(await lastAudit('practice.deactivate')).toMatchObject({ userId: SUPER, resource: 'clinic' });
  });

  it('reactivates with POST /activate, audited', async () => {
    const res = await activate(SUPER, 'SUPER_ADMIN', OWN);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe(1);
    expect(await statusOf(OWN)).toBe(1);
    expect(await lastAudit('practice.activate')).toMatchObject({ userId: SUPER, resource: 'clinic' });
  });

  it('404s a clinic that does not exist, or a non-numeric id', async () => {
    expect((await call('DELETE', SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
    expect((await activate(SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
    expect((await activate(SUPER, 'SUPER_ADMIN', 'abc')).status).toBe(404);
  });
});
