import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as followupCreatePOST } from '@/app/api/v1/followups/route';
import { POST as chainCreatePOST } from '@/app/api/v1/followup-chains/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// assertCan runs before resolveKcActor, so 401 (no token) and 403 (wrong role)
// are reached before any DB access — safe to run without a test DB.
describe('followups + followup-chains routes auth matrix', () => {
  it('POST /followups rejected without a token (401)', async () => {
    const res = await followupCreatePOST(new NextRequest('http://localhost/api/v1/followups', {
      method: 'POST', body: JSON.stringify({ chainId: 1, patientId: 1, reason: 'x', suggestedDate: '2026-07-10 09:00:00', suggestedDeadline: '2026-07-20 09:00:00' }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /followups denied for RECEPTIONIST (403 — followup_manage excludes RECEPTIONIST)', async () => {
    const res = await followupCreatePOST(reqWith(await token('RECEPTIONIST'), 'http://localhost/api/v1/followups', {
      method: 'POST', body: JSON.stringify({ chainId: 1, patientId: 1, reason: 'x', suggestedDate: '2026-07-10 09:00:00', suggestedDeadline: '2026-07-20 09:00:00' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('POST /followup-chains rejected without a token (401)', async () => {
    const res = await chainCreatePOST(new NextRequest('http://localhost/api/v1/followup-chains', {
      method: 'POST', body: JSON.stringify({ patientId: 1 }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /followup-chains denied for RECEPTIONIST (403 — followup_manage excludes RECEPTIONIST)', async () => {
    const res = await chainCreatePOST(reqWith(await token('RECEPTIONIST'), 'http://localhost/api/v1/followup-chains', {
      method: 'POST', body: JSON.stringify({ patientId: 1 }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
