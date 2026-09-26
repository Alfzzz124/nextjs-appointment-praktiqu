/**
 * GET /practices is scoped like GET /practices/:id: a CLINIC_ADMIN lists only their own
 * clinic.
 *
 * It used to return every clinic. The Laravel FE compares each row to the admin's
 * practiceId, saw 21 foreign clinics, and — correctly — treated that as leaked data:
 * every clinic admin got a "data outside your scope" banner and hidden statistics on
 * every page load (2026-09-25 FE audit, API-2 / DD-7).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { listPractices } from '@/services/practice/service';

const { GET } = await import('@/app/api/v1/practices/route');

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 7_950_000;
const END = BASE + 10_000;
const OWN = BASE + 1;
const FOREIGN = BASE + 2;
const ADMIN_WP = BASE + 500;
const ORPHAN_WP = BASE + 501;

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

const admin = { id: 'practice-scope-test-admin', role: 'CLINIC_ADMIN' } as never;
const orphan = { id: 'practice-scope-test-orphan', role: 'CLINIC_ADMIN' } as never;
const superAdmin = { id: 'practice-scope-test-super', role: 'SUPER_ADMIN' } as never;

async function linkAuthUser(cuid: string, wpUserId: number, role: string) {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@practice-scope.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: role as never,
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'practice-scope-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, name, owner] of [
    [OWN, 'Klinik Sendiri', ADMIN_WP],
    [FOREIGN, 'Klinik Lain', 1],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, 'klinik@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
      id,
      name,
      owner,
    );
  }
  // No doctor mapping: resolveKcActor falls back to the clinic this admin owns.
  await linkAuthUser('practice-scope-test-admin', ADMIN_WP, 'CLINIC_ADMIN');
  await linkAuthUser('practice-scope-test-orphan', ORPHAN_WP, 'CLINIC_ADMIN');
  await linkAuthUser('practice-scope-test-super', BASE + 502, 'SUPER_ADMIN');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const ours = (data: Array<{ id: number }>) => data.map((p) => p.id).filter((id) => id >= BASE && id < END).sort();

describe('listPractices — actor scope', () => {
  it('gives a clinic admin only their own clinic', async () => {
    const { data, total } = await listPractices({ page: 1, limit: 100 }, admin);
    expect(data.map((p) => p.id)).toEqual([OWN]);
    expect(total).toBe(1);
  });

  it('gives a clinic admin with no clinic nothing — never everything', async () => {
    const { data, total } = await listPractices({ page: 1, limit: 100 }, orphan);
    expect(data).toEqual([]);
    expect(total).toBe(0);
  });

  it('still gives a super admin every clinic', async () => {
    const { data } = await listPractices({ page: 1, limit: 100 }, superAdmin);
    expect(ours(data)).toEqual([OWN, FOREIGN]);
  });
});

describe('GET /api/v1/practices — passes the actor through', () => {
  it('returns only the clinic admin’s clinic', async () => {
    const jwt = await new SignJWT({ role: 'CLINIC_ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('practice-scope-test-admin')
      .setExpirationTime('1h')
      .sign(JWT_SECRET);
    const res = await GET(
      new NextRequest('http://localhost/api/v1/practices?limit=100', {
        headers: { authorization: `Bearer ${jwt}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: number }> };
    expect(body.data.map((p) => p.id)).toEqual([OWN]);
  });
});
