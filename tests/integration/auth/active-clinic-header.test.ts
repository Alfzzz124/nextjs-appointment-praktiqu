/**
 * X-Praktiqu-Clinic-Id: the clinic a CLINIC_ADMIN who holds several clinics is acting in
 * for this request. getActor() checks it against the admin's own clinics; every other role
 * ignores it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { AuthError, getActor } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { assertTestDb } from '../../billing/fixtures';

const BASE = 8_660_000;
const END = BASE + 10_000;
const ADMIN_WP = BASE + 500;
const OTHER_ADMIN_WP = BASE + 501;
const RECEPTIONIST_WP = BASE + 502;
const CLINIC_A = BASE + 1; // ADMIN_WP's default
const CLINIC_B = BASE + 2; // ADMIN_WP's second clinic
const CLINIC_C = BASE + 3; // OTHER_ADMIN_WP's
const MISSING = BASE + 9; // no such clinic

const ADMIN = 'active-clinic-test-admin';
const UNLINKED = 'active-clinic-test-unlinked';
const RECEPTIONIST = 'active-clinic-test-receptionist';
const SUPER = 'active-clinic-test-super';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(sub: string, role: string, clinicHeader?: string): Promise<NextRequest> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (clinicHeader !== undefined) headers['x-praktiqu-clinic-id'] = clinicHeader;
  return new NextRequest('http://localhost/api/v1/anything', { headers });
}

async function rejection(p: Promise<unknown>): Promise<AuthError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error('expected getActor to reject');
}

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

async function authUser(id: string, role: string, wpUserId: number | null) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@active-clinic.test.local`,
      username: id,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: role as never,
      wpUserId: wpUserId === null ? null : BigInt(wpUserId),
      status: 1,
    },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'active-clinic-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A, ADMIN_WP);
  await clinic(CLINIC_B, ADMIN_WP);
  await clinic(CLINIC_C, OTHER_ADMIN_WP);
  await authUser(ADMIN, 'CLINIC_ADMIN', ADMIN_WP);
  await authUser(UNLINKED, 'CLINIC_ADMIN', null);
  await authUser(RECEPTIONIST, 'RECEPTIONIST', RECEPTIONIST_WP);
  await authUser(SUPER, 'SUPER_ADMIN', null);
});

afterAll(async () => {
  await wipe();
});

describe('getActor — X-Praktiqu-Clinic-Id', () => {
  it('leaves activeClinicId unset without the header', async () => {
    expect((await getActor(await req(ADMIN, 'CLINIC_ADMIN'))).activeClinicId).toBeUndefined();
  });

  it('treats an empty header as absent', async () => {
    expect((await getActor(await req(ADMIN, 'CLINIC_ADMIN', ''))).activeClinicId).toBeUndefined();
  });

  it('accepts a clinic the admin owns', async () => {
    const actor = await getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_B)));
    expect(actor.activeClinicId).toBe(BigInt(CLINIC_B));
  });

  it("rejects another admin's clinic with 403 clinic_not_in_scope", async () => {
    const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_C))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('rejects a clinic that does not exist exactly the same way', async () => {
    const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', String(MISSING))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it.each(['abc', '0', '-1', '1.5', '01', '4 4', '12345678901234567890'])(
    'rejects the malformed value %j with 400 invalid_clinic_header',
    async (value) => {
      const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', value)));
      expect(err.status).toBe(400);
      expect(err.message).toBe('invalid_clinic_header');
    },
  );

  it('rejects any clinic for a clinic admin with no WordPress link', async () => {
    const err = await rejection(getActor(await req(UNLINKED, 'CLINIC_ADMIN', String(CLINIC_A))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('ignores the header for a receptionist', async () => {
    const actor = await getActor(await req(RECEPTIONIST, 'RECEPTIONIST', String(CLINIC_C)));
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('ignores even a malformed header for a super admin', async () => {
    const actor = await getActor(await req(SUPER, 'SUPER_ADMIN', 'abc'));
    expect(actor.activeClinicId).toBeUndefined();
  });
});

describe('resolveKcActor — active clinic', () => {
  it('uses the default clinic without the header', async () => {
    const kc = await resolveKcActor(await getActor(await req(ADMIN, 'CLINIC_ADMIN')));
    expect(kc.clinicId).toBe(BigInt(CLINIC_A));
  });

  it('uses the validated clinic from the header', async () => {
    const kc = await resolveKcActor(await getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_B))));
    expect(kc.clinicId).toBe(BigInt(CLINIC_B));
  });
});
