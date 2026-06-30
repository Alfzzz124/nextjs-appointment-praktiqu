import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { seedTax, seedClinicAdmin, cleanup, assertTestDb } from './fixtures';
import { GET as taxesGet, POST as taxesPost } from '@/app/api/v1/taxes/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url = 'http://localhost/api/v1/taxes', init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

describe('taxes routes', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedClinicAdmin({ userId: 9000001, clinicId: 9000001 }); await seedTax({ id: 9000400, name: 'VAT' }); });
  afterAll(cleanup);

  it('GET /taxes returns the {status,message,data} envelope', async () => {
    const res = await taxesGet(reqWith(await token('CLINIC_ADMIN')), {} as any);
    const json = await res.json();
    expect(json).toHaveProperty('status', true);
    expect(json.data).toHaveProperty('taxes');
  });

  it('POST /taxes denied for PROFESSIONAL (403)', async () => {
    const res = await taxesPost(reqWith(await token('PROFESSIONAL'), 'http://localhost/api/v1/taxes', {
      method: 'POST', body: JSON.stringify({ name: 'X', rateValue: 5 }),
    }), {} as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('GET /taxes rejected without token (401)', async () => {
    const res = await taxesGet(new NextRequest('http://localhost/api/v1/taxes'), {} as any);
    expect(res.status).toBe(401);
  });
});
