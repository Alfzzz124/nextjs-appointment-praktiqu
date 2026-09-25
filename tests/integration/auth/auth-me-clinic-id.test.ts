/**
 * /auth/me carries `clinicId` for the single-clinic staff roles.
 *
 * The Laravel FE had to guess an admin's clinic by sweeping /practices for a matching
 * email — a sweep that stopped after the first page — and could never find a
 * receptionist's, so both got empty dashboards (2026-09-25 FE audit, API-16 / DD-6).
 *
 * A PROFESSIONAL must NOT get one: they can work at several clinics, and the FE treats
 * this value as a clinic override, so a first-mapping guess would lock them into one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';

const { GET } = await import('@/app/api/v1/auth/me/route');

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 8_600_000;
const END = BASE + 10_000;
const CLINIC_A = BASE + 1;
const CLINIC_B = BASE + 2;
const ADMIN_WP = BASE + 500;
const RECEPTIONIST_WP = BASE + 501;
const DOCTOR_WP = BASE + 502;

async function linkAuthUser(cuid: string, wpUserId: number | null, role: string) {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@auth-me-clinic.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: role as never,
      wpUserId: wpUserId === null ? null : BigInt(wpUserId),
      status: 1,
    },
  });
}

async function me(cuid: string, role: string) {
  const { token } = await issueAccessToken({
    userId: cuid,
    role: role as never,
    email: `${cuid}@auth-me-clinic.test.local`,
    username: cuid,
  });
  const res = await GET(
    new NextRequest('http://localhost/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: Record<string, unknown> }).user;
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcReceptionistClinicMapping.deleteMany({
    where: { receptionistId: { gte: BigInt(BASE), lt: BigInt(END) } },
  });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'auth-me-clinic-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik A', 'a@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    CLINIC_A,
    ADMIN_WP,
  );
  await prisma.kcReceptionistClinicMapping.create({
    data: { receptionistId: BigInt(RECEPTIONIST_WP), clinicId: BigInt(CLINIC_B), createdAt: new Date() },
  });
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(BASE + 10), doctorId: BigInt(DOCTOR_WP), clinicId: BigInt(CLINIC_A), createdAt: new Date() },
  });
  await linkAuthUser('auth-me-clinic-test-admin', ADMIN_WP, 'CLINIC_ADMIN');
  await linkAuthUser('auth-me-clinic-test-receptionist', RECEPTIONIST_WP, 'RECEPTIONIST');
  await linkAuthUser('auth-me-clinic-test-doctor', DOCTOR_WP, 'PROFESSIONAL');
  await linkAuthUser('auth-me-clinic-test-unlinked', null, 'CLINIC_ADMIN');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('GET /auth/me — clinicId', () => {
  it('gives a clinic admin the clinic they own', async () => {
    expect((await me('auth-me-clinic-test-admin', 'CLINIC_ADMIN')).clinicId).toBe(CLINIC_A);
  });

  it('gives a receptionist their mapped clinic', async () => {
    expect((await me('auth-me-clinic-test-receptionist', 'RECEPTIONIST')).clinicId).toBe(CLINIC_B);
  });

  it('gives a professional null, even though they have a clinic mapping', async () => {
    expect((await me('auth-me-clinic-test-doctor', 'PROFESSIONAL')).clinicId).toBeNull();
  });

  it('gives an account with no WordPress link null rather than failing', async () => {
    expect((await me('auth-me-clinic-test-unlinked', 'CLINIC_ADMIN')).clinicId).toBeNull();
  });
});
