import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as rxCreatePOST } from '@/app/api/v1/prescriptions/route';
import { POST as mhCreatePOST } from '@/app/api/v1/medical-history/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (CLIENT create) do not touch the database.
describe('prescriptions + medical-history routes auth matrix', () => {
  it('POST /prescriptions rejected without a token (401)', async () => {
    const res = await rxCreatePOST(new NextRequest('http://localhost/api/v1/prescriptions', {
      method: 'POST', body: JSON.stringify({ encounterId: 1, patientId: 1, name: 'X' }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /prescriptions denied for CLIENT (403)', async () => {
    const res = await rxCreatePOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/prescriptions', {
      method: 'POST', body: JSON.stringify({ encounterId: 1, patientId: 1, name: 'X' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('POST /medical-history rejected without a token (401)', async () => {
    const res = await mhCreatePOST(new NextRequest('http://localhost/api/v1/medical-history', {
      method: 'POST', body: JSON.stringify({ encounterId: 1, patientId: 1, type: 'general', title: 'X' }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /medical-history denied for CLIENT (403)', async () => {
    const res = await mhCreatePOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/medical-history', {
      method: 'POST', body: JSON.stringify({ encounterId: 1, patientId: 1, type: 'general', title: 'X' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
