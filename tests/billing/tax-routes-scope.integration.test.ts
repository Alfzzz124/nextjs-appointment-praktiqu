import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { assertTestDb, seedClinicAdmin, seedTax, cleanup } from './fixtures';

import { GET as taxGet, PUT as taxPut, DELETE as taxDelete } from '@/app/api/v1/taxes/[id]/route';
import { PUT as taxStatusPut } from '@/app/api/v1/taxes/[id]/status/route';
import { POST as taxBulkDelete } from '@/app/api/v1/taxes/bulk/delete/route';
import { PUT as taxBulkStatus } from '@/app/api/v1/taxes/bulk/status/route';

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

const CLINIC_A = 9_031_001, CLINIC_B = 9_031_002;
let taxAId: number, taxBId: number;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC_A, clinicId: CLINIC_A });
  await seedClinicAdmin({ userId: CLINIC_B, clinicId: CLINIC_B });
  taxAId = Number((await seedTax({ id: 9_031_101, name: 'Route Tax A', clinicId: CLINIC_A })).id);
  taxBId = Number((await seedTax({ id: 9_031_102, name: 'Route Tax B', clinicId: CLINIC_B })).id);
});
afterAll(cleanup);

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
