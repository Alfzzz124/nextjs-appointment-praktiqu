/**
 * /auth/me tells a psychologist which clinics they own, so the FE can offer owner mode.
 * Only a PROFESSIONAL carries the field; it is always an array.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const { GET } = await import('@/app/api/v1/auth/me/route');

const { BASE, END } = idBlock('integration/auth/auth-me-owned-clinics.test.ts');
const SOLO = BASE + 1;
const DOC = BASE + 500;
const LONE = BASE + 501; // a doctor with no clinic at all

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function linkAuthUser(cuid: string, wpUserId: number | null, role: string) {
  await prisma.user.create({
    data: { id: cuid, email: `${cuid}@test.local`, username: cuid, firstName: 'T', lastName: 'U', displayName: 'T U', role: role as never, wpUserId: wpUserId === null ? null : BigInt(wpUserId), status: 1 },
  });
}

async function me(cuid: string, role: string) {
  const { token } = await issueAccessToken({ userId: cuid, role: role as never, email: `${cuid}@test.local`, username: cuid });
  const res = await GET(new NextRequest('http://localhost/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: Record<string, unknown> }).user;
}

async function wipe() {
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'auth-me-owned-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, LONE]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `am${id}`, userEmail: `am${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Solo', 's@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, SOLO);
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 10), doctorId: BigInt(DOC), clinicId: BigInt(SOLO), createdAt: new Date() } });
  await linkAuthUser('auth-me-owned-test-doc', DOC, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-lone', LONE, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-unlinked', null, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-super', null, 'SUPER_ADMIN');
});

afterAll(async () => {
  await wipe();
});

describe('GET /auth/me — ownedClinics', () => {
  it('lists the solo clinic of a psychologist, clinicId staying null', async () => {
    const user = await me('auth-me-owned-test-doc', 'PROFESSIONAL');
    expect(user.clinicId).toBeNull();
    expect(user.ownedClinics).toEqual([{ id: SOLO, name: 'Klinik Solo', source: 'solo' }]);
  });

  it('gives a psychologist without clinics, or without a WordPress link, an empty list', async () => {
    expect((await me('auth-me-owned-test-lone', 'PROFESSIONAL')).ownedClinics).toEqual([]);
    expect((await me('auth-me-owned-test-unlinked', 'PROFESSIONAL')).ownedClinics).toEqual([]);
  });

  it('gives other roles no ownedClinics field at all', async () => {
    expect(await me('auth-me-owned-test-super', 'SUPER_ADMIN')).not.toHaveProperty('ownedClinics');
  });
});

describe('GET /auth/me — practiceClinics', () => {
  it('lists the active clinics a psychologist practises at', async () => {
    expect((await me('auth-me-owned-test-doc', 'PROFESSIONAL')).practiceClinics).toEqual([
      { id: SOLO, name: 'Klinik Solo' },
    ]);
  });

  it('gives a psychologist without clinics, or without a WordPress link, an empty list', async () => {
    expect((await me('auth-me-owned-test-lone', 'PROFESSIONAL')).practiceClinics).toEqual([]);
    expect((await me('auth-me-owned-test-unlinked', 'PROFESSIONAL')).practiceClinics).toEqual([]);
  });

  it('gives other roles no practiceClinics field at all', async () => {
    expect(await me('auth-me-owned-test-super', 'SUPER_ADMIN')).not.toHaveProperty('practiceClinics');
  });
});
