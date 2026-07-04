import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as ratingCreatePOST } from '@/app/api/v1/ratings/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (PROFESSIONAL create) do not touch the database.
describe('ratings routes auth matrix', () => {
  it('POST /ratings rejected without a token (401)', async () => {
    const res = await ratingCreatePOST(new NextRequest('http://localhost/api/v1/ratings', {
      method: 'POST', body: JSON.stringify({ doctorId: 1, review: 5 }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /ratings denied for PROFESSIONAL (403 — rating_manage excludes PROFESSIONAL)', async () => {
    const res = await ratingCreatePOST(reqWith(await token('PROFESSIONAL'), 'http://localhost/api/v1/ratings', {
      method: 'POST', body: JSON.stringify({ doctorId: 1, review: 5 }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
