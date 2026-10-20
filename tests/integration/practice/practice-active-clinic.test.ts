/**
 * Route-level proof that the active clinic narrows what a clinic admin who holds two
 * clinics sees, through both auth wrappers in use: requireRoles (/practices) and withAuth
 * (/bills).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { GET as practicesGet } from '@/app/api/v1/practices/route';
import { GET as practiceGet } from '@/app/api/v1/practices/[id]/route';
import { GET as billsGet } from '@/app/api/v1/bills/route';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/practice-active-clinic.test.ts');
const ADMIN_WP = BASE + 500;
const OTHER_WP = BASE + 501;
const CLINIC_A = BASE + 1; // ADMIN_WP's default
const CLINIC_B = BASE + 2; // ADMIN_WP's second clinic
const CLINIC_C = BASE + 3; // OTHER_WP's
const ADMIN = 'practice-active-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
let jwt: string;

function req(path: string, clinicHeader?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (clinicHeader !== undefined) headers['x-praktiqu-clinic-id'] = clinicHeader;
  return new NextRequest(`http://localhost${path}`, { headers });
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

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'practice-active-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A, ADMIN_WP);
  await clinic(CLINIC_B, ADMIN_WP);
  await clinic(CLINIC_C, OTHER_WP);
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

const ids = async (res: Response) => ((await res.json()) as { data: Array<{ id: number }> }).data.map((p) => p.id);

describe('GET /practices', () => {
  it('lists only the default clinic without the header', async () => {
    const res = await practicesGet(req('/api/v1/practices'));
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual([CLINIC_A]);
  });

  it('lists only the active clinic with the header', async () => {
    const res = await practicesGet(req('/api/v1/practices', String(CLINIC_B)));
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual([CLINIC_B]);
  });

  it("refuses another admin's clinic with 403 clinic_not_in_scope", async () => {
    const res = await practicesGet(req('/api/v1/practices', String(CLINIC_C)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('clinic_not_in_scope');
  });

  it('refuses a malformed header with 400 invalid_clinic_header', async () => {
    const res = await practicesGet(req('/api/v1/practices', 'abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_clinic_header');
  });
});

describe('GET /practices/:id', () => {
  it('404s the second clinic while the first is active', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`, String(CLINIC_A)), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(404);
  });

  it('404s the second clinic without the header (default is the first)', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(404);
  });

  it('serves the second clinic once it is active', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`, String(CLINIC_B)), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(CLINIC_B);
  });
});

describe('withAuth routes', () => {
  it("refuse another admin's clinic before the handler runs", async () => {
    const res = await billsGet(req('/api/v1/bills', String(CLINIC_C)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('clinic_not_in_scope');
  });
});
