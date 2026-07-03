import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as scheduleCreatePOST } from '@/app/api/v1/clinic-schedules/route';
import { GET as dashboardStatsGET } from '@/app/api/v1/dashboard/statistics/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (wrong role) do not touch the database.
describe('clinic-schedules + dashboard routes auth matrix', () => {
  it('POST /clinic-schedules rejected without a token (401)', async () => {
    const res = await scheduleCreatePOST(new NextRequest('http://localhost/api/v1/clinic-schedules', {
      method: 'POST', body: JSON.stringify({ moduleType: 'clinic', moduleId: 1, selectionMode: 'range' }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /clinic-schedules denied for CLIENT (403 — schedule_manage excludes CLIENT)', async () => {
    const res = await scheduleCreatePOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/clinic-schedules', {
      method: 'POST', body: JSON.stringify({ moduleType: 'clinic', moduleId: 1, selectionMode: 'range' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('GET /dashboard/statistics rejected without a token (401)', async () => {
    const res = await dashboardStatsGET(new NextRequest('http://localhost/api/v1/dashboard/statistics', {
      method: 'GET',
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('GET /dashboard/statistics denied for CLIENT (403 — dashboard_read excludes CLIENT)', async () => {
    const res = await dashboardStatsGET(reqWith(await token('CLIENT'), 'http://localhost/api/v1/dashboard/statistics', {
      method: 'GET',
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
