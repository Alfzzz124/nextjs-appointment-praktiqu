import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, seedTax, cleanup, useIdBlock } from './fixtures';

import { POST as taxCreate } from '@/app/api/v1/taxes/route';

import { GET as taxGet, PUT as taxPut, DELETE as taxDelete } from '@/app/api/v1/taxes/[id]/route';
import { PUT as taxStatusPut } from '@/app/api/v1/taxes/[id]/status/route';
import { POST as taxBulkDelete } from '@/app/api/v1/taxes/bulk/delete/route';
import { PUT as taxBulkStatus } from '@/app/api/v1/taxes/bulk/status/route';

const { BASE } = useIdBlock('billing/tax-routes-scope.integration.test.ts');

/**
 * Route-level proof that `taxes/[id]` and its bulk siblings actually resolve the
 * caller's clinic and pass it down — the reviewer's finding was that these routes
 * never read `KcTax.clinicId` at all. Service-level scope logic itself is covered in
 * tax-scope.test.ts.
 */

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
async function token(role: string, sub: string) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

const CLINIC_A = BASE + 1, CLINIC_B = BASE + 2;
let taxAId: number, taxBId: number, taxGlobalId: number;
const SUPER_SUB = 'test-super-tax-routes';

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC_A, clinicId: CLINIC_A });
  await seedClinicAdmin({ userId: CLINIC_B, clinicId: CLINIC_B });
  taxAId = Number((await seedTax({ id: BASE + 101, name: 'Route Tax A', clinicId: CLINIC_A })).id);
  taxBId = Number((await seedTax({ id: BASE + 102, name: 'Route Tax B', clinicId: CLINIC_B })).id);
  taxGlobalId = Number((await seedTax({ id: BASE + 103, name: 'Route Tax Global', clinicId: -1 })).id);
  await prisma.user.deleteMany({ where: { id: SUPER_SUB } });
  await prisma.user.create({
    data: {
      id: SUPER_SUB, email: 'super-tax-routes@test.local', username: 'super-tax-routes',
      firstName: 'S', lastName: 'A', displayName: 'Super', role: 'SUPER_ADMIN', wpUserId: BigInt(BASE + 3), status: 1,
    },
  });
});
afterAll(async () => {
  await prisma.kcTax.deleteMany({ where: { name: { startsWith: 'RouteNew' } } });
  await prisma.user.deleteMany({ where: { id: SUPER_SUB } });
  await cleanup();
});

describe('GET/PUT/DELETE /taxes/:id', () => {
  it('clinic A gets 404 for clinic B\'s tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxGet(reqWith(jwt, `http://localhost/api/v1/taxes/${taxBId}`), { params: { id: String(taxBId) } } as any);
    expect(res.status).toBe(404);
  });

  it('clinic A sees its own tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxGet(reqWith(jwt, `http://localhost/api/v1/taxes/${taxAId}`), { params: { id: String(taxAId) } } as any);
    const json = await res.json();
    expect(json.status).toBe(true);
    expect(json.data.id).toBe(taxAId);
  });

  it('clinic A cannot PUT clinic B\'s tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxBId}`, {
      method: 'PUT', body: JSON.stringify({ rateValue: 42 }),
    }), { params: { id: String(taxBId) } } as any);
    expect(res.status).toBe(404);
  });

  it('clinic A cannot DELETE clinic B\'s tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxDelete(reqWith(jwt, `http://localhost/api/v1/taxes/${taxBId}`), { params: { id: String(taxBId) } } as any);
    expect(res.status).toBe(404);
  });
});

describe('PUT /taxes/:id/status', () => {
  it('clinic A cannot change clinic B\'s tax status', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxStatusPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxBId}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 0 }),
    }), { params: { id: String(taxBId) } } as any);
    expect(res.status).toBe(404);
  });
});

describe('bulk /taxes/bulk/delete and /taxes/bulk/status', () => {
  it('clinic A\'s bulk delete does not touch clinic B\'s tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxBulkDelete(reqWith(jwt, 'http://localhost/api/v1/taxes/bulk/delete', {
      method: 'POST', body: JSON.stringify({ ids: [taxBId] }),
    }), { params: {} } as any);
    const json = await res.json();
    expect(json.message).toContain('0 taxes deleted');
    // Tax B must still exist — checked as clinic B's own admin, in scope for it.
    const jwtB = await token('CLINIC_ADMIN', `test-admin-${CLINIC_B}`);
    const check = await taxGet(reqWith(jwtB, `http://localhost/api/v1/taxes/${taxBId}`), { params: { id: String(taxBId) } } as any);
    expect((await check.json()).status).toBe(true);
  });

  it('clinic A\'s bulk status update does not touch clinic B\'s tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxBulkStatus(reqWith(jwt, 'http://localhost/api/v1/taxes/bulk/status', {
      method: 'PUT', body: JSON.stringify({ ids: [taxBId], status: 0 }),
    }), { params: {} } as any);
    const json = await res.json();
    expect(json.message).toContain('0 taxes status updated');
  });
});

/**
 * A global tax (clinic -1) applies to every clinic's bills, so a clinic admin may not
 * create, move, change or delete one — only SUPER_ADMIN may. Reading stays open to all.
 */
describe('POST /taxes — clinic scope', () => {
  const post = async (sub: string, role: string, body: Record<string, unknown>) =>
    taxCreate(reqWith(await token(role, sub), 'http://localhost/api/v1/taxes', {
      method: 'POST', body: JSON.stringify({ rateValue: 11, ...body }),
    }), { params: {} } as any);
  const rowsNamed = (name: string) => prisma.kcTax.findMany({ where: { name } });

  it('a clinic admin who names no clinic creates a tax for their own clinic only', async () => {
    const res = await post(`test-admin-${CLINIC_A}`, 'CLINIC_ADMIN', { name: 'RouteNew default' });
    expect(res.status).toBe(200);
    expect((await rowsNamed('RouteNew default')).map((r) => Number(r.clinicId))).toEqual([CLINIC_A]);
  });

  it('refuses a clinic admin creating a global tax (clinic -1)', async () => {
    const res = await post(`test-admin-${CLINIC_A}`, 'CLINIC_ADMIN', { name: 'RouteNew global', clinic: -1 });
    expect(res.status).toBe(403);
    expect(await rowsNamed('RouteNew global')).toHaveLength(0);
  });

  it('refuses a clinic admin creating a tax for another clinic', async () => {
    const res = await post(`test-admin-${CLINIC_A}`, 'CLINIC_ADMIN', { name: 'RouteNew other', clinic: CLINIC_B });
    expect(res.status).toBe(403);
    expect(await rowsNamed('RouteNew other')).toHaveLength(0);
  });

  it('lets a clinic admin name their own clinic explicitly', async () => {
    const res = await post(`test-admin-${CLINIC_A}`, 'CLINIC_ADMIN', { name: 'RouteNew own', clinic: CLINIC_A });
    expect(res.status).toBe(200);
  });

  it('lets SUPER_ADMIN create a global tax and a tax for any clinic', async () => {
    expect((await post(SUPER_SUB, 'SUPER_ADMIN', { name: 'RouteNew super global' })).status).toBe(200);
    expect((await post(SUPER_SUB, 'SUPER_ADMIN', { name: 'RouteNew super b', clinic: CLINIC_B })).status).toBe(200);
    expect((await rowsNamed('RouteNew super global')).map((r) => Number(r.clinicId))).toEqual([-1]);
  });
});

describe('global taxes are SUPER_ADMIN-only to change', () => {
  const idCtx = (id: number) => ({ params: { id: String(id) } } as any);
  const exists = async (id: number) => (await prisma.kcTax.findUnique({ where: { id: BigInt(id) } })) !== null;

  it('a clinic admin can still read a global tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxGet(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}`), idCtx(taxGlobalId));
    expect((await res.json()).status).toBe(true);
  });

  it('refuses a clinic admin changing a global tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}`, {
      method: 'PUT', body: JSON.stringify({ rateValue: 1 }),
    }), idCtx(taxGlobalId));
    expect(res.status).toBe(403);
  });

  it('refuses a clinic admin deleting a global tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxDelete(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}`), idCtx(taxGlobalId));
    expect(res.status).toBe(403);
    expect(await exists(taxGlobalId)).toBe(true);
  });

  it('refuses a clinic admin switching a global tax off', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxStatusPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 0 }),
    }), idCtx(taxGlobalId));
    expect(res.status).toBe(403);
    expect((await prisma.kcTax.findUnique({ where: { id: BigInt(taxGlobalId) } }))?.status).toBe(1);
  });

  it('bulk delete and bulk status leave a global tax alone for a clinic admin', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const del = await taxBulkDelete(reqWith(jwt, 'http://localhost/api/v1/taxes/bulk/delete', {
      method: 'POST', body: JSON.stringify({ ids: [taxGlobalId] }),
    }), { params: {} } as any);
    expect((await del.json()).message).toContain('0 taxes deleted');
    const st = await taxBulkStatus(reqWith(jwt, 'http://localhost/api/v1/taxes/bulk/status', {
      method: 'PUT', body: JSON.stringify({ ids: [taxGlobalId], status: 0 }),
    }), { params: {} } as any);
    expect((await st.json()).message).toContain('0 taxes status updated');
    const row = await prisma.kcTax.findUnique({ where: { id: BigInt(taxGlobalId) } });
    expect(row?.status).toBe(1);
  });

  it('refuses a clinic admin moving their own tax to another clinic or to global', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    for (const clinic of [CLINIC_B, -1]) {
      const res = await taxPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxAId}`, {
        method: 'PUT', body: JSON.stringify({ clinic }),
      }), idCtx(taxAId));
      expect(res.status).toBe(403);
    }
    expect(Number((await prisma.kcTax.findUnique({ where: { id: BigInt(taxAId) } }))?.clinicId)).toBe(CLINIC_A);
  });

  it('still lets a clinic admin edit their own tax', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await taxPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxAId}`, {
      method: 'PUT', body: JSON.stringify({ rateValue: 12, clinic: CLINIC_A }),
    }), idCtx(taxAId));
    expect(res.status).toBe(200);
  });

  it('lets SUPER_ADMIN change a global tax, switch it off and delete it', async () => {
    const jwt = await token('SUPER_ADMIN', SUPER_SUB);
    const put = await taxPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}`, {
      method: 'PUT', body: JSON.stringify({ rateValue: 8 }),
    }), idCtx(taxGlobalId));
    expect(put.status).toBe(200);
    const st = await taxStatusPut(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}/status`, {
      method: 'PUT', body: JSON.stringify({ status: 0 }),
    }), idCtx(taxGlobalId));
    expect(st.status).toBe(200);
    const del = await taxDelete(reqWith(jwt, `http://localhost/api/v1/taxes/${taxGlobalId}`), idCtx(taxGlobalId));
    expect(del.status).toBe(200);
    expect(await exists(taxGlobalId)).toBe(false);
  });
});
