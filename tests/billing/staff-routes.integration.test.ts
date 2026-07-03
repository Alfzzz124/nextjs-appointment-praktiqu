import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as receptionistCreatePOST } from '@/app/api/v1/receptionists/route';
import { POST as doctorSessionCreatePOST } from '@/app/api/v1/doctor-sessions/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (wrong role) do not touch the database.
describe('receptionists + doctor-sessions routes auth matrix', () => {
  it('POST /receptionists rejected without a token (401)', async () => {
    const res = await receptionistCreatePOST(new NextRequest('http://localhost/api/v1/receptionists', {
      method: 'POST', body: JSON.stringify({ name: 'R', email: 'r@test.local' }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /receptionists denied for RECEPTIONIST (403 — receptionist_manage excludes RECEPTIONIST)', async () => {
    const res = await receptionistCreatePOST(reqWith(await token('RECEPTIONIST'), 'http://localhost/api/v1/receptionists', {
      method: 'POST', body: JSON.stringify({ name: 'R', email: 'r@test.local' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('POST /doctor-sessions rejected without a token (401)', async () => {
    const res = await doctorSessionCreatePOST(new NextRequest('http://localhost/api/v1/doctor-sessions', {
      method: 'POST', body: JSON.stringify({ doctorId: 1, day: 'mon', startTime: '09:00:00', endTime: '17:00:00', timeSlot: 30 }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /doctor-sessions denied for CLIENT (403 — doctor_session_manage excludes CLIENT)', async () => {
    const res = await doctorSessionCreatePOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/doctor-sessions', {
      method: 'POST', body: JSON.stringify({ doctorId: 1, day: 'mon', startTime: '09:00:00', endTime: '17:00:00', timeSlot: 30 }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
