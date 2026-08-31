/**
 * The three endpoints the scheduling screen calls, exercised through the route handlers:
 * auth → permission → clinic resolution from the actor → service → response envelope.
 *
 * The resource lives at `/professional-sessions`; `/doctor-sessions` re-exports it, and the
 * last test here holds that alias in place.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET as weekGET, PUT as weekPUT, DELETE as weekDELETE } from '@/app/api/v1/professional-sessions/week/route';
import { GET as groupedGET } from '@/app/api/v1/professional-sessions/grouped/route';
import { POST as bulkDeletePOST } from '@/app/api/v1/professional-sessions/bulk/delete/route';
import { assertTestDb, cleanup, seedClinicAdmin } from './fixtures';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const CLINIC = 9_000_201, ADMIN = 9_000_202, DOCTOR = 9_000_210;
const BASE = 'http://localhost/api/v1/professional-sessions';

async function token(role: string, sub = `test-admin-${ADMIN}`) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' } });
}

const WEEK_BODY = {
  doctorId: DOCTOR,
  timeSlot: 30,
  days: [
    { day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [{ start: '12:00', end: '13:00' }] },
    { day: 'thu', enabled: true, mainSession: { start: '09:00', end: '12:00' }, breaks: [] },
  ],
};

describe('doctor-session week routes — auth', () => {
  it('PUT without a token is 401', async () => {
    const res = await weekPUT(new NextRequest(`${BASE}/week`, { method: 'PUT', body: JSON.stringify(WEEK_BODY) }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('PUT as RECEPTIONIST is 403 — doctor_session_manage excludes them', async () => {
    const res = await weekPUT(reqWith(await token('RECEPTIONIST'), `${BASE}/week`, { method: 'PUT', body: JSON.stringify(WEEK_BODY) }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('GET grouped without a token is 401', async () => {
    const res = await groupedGET(new NextRequest(`${BASE}/grouped`), { params: {} } as any);
    expect(res.status).toBe(401);
  });
});

describe('doctor-session week routes — round trip', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
  });
  afterAll(cleanup);

  it('PUT saves, GET reads the same week back, and the clinic comes from the actor', async () => {
    const jwt = await token('CLINIC_ADMIN');

    const put = await weekPUT(reqWith(jwt, `${BASE}/week`, { method: 'PUT', body: JSON.stringify(WEEK_BODY) }), { params: {} } as any);
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody.status).toBe(true);
    expect(putBody.data).toMatchObject({ doctor_id: DOCTOR, clinic_id: CLINIC, windows: 3 });

    // No clinicId in the query — a clinic admin is bound to their own.
    const get = await weekGET(reqWith(jwt, `${BASE}/week?doctorId=${DOCTOR}`), { params: {} } as any);
    const week = (await get.json()).data;
    const mon = week.days.find((d: any) => d.day === 'mon');
    expect(mon.mainSession).toEqual({ start: '09:00', end: '17:00' });
    expect(mon.breaks).toEqual([{ start: '12:00', end: '13:00' }]);
    expect(week.time_slot).toBe(30);
  });

  it('a broken week comes back as 400 with the message the form shows', async () => {
    const res = await weekPUT(reqWith(await token('CLINIC_ADMIN'), `${BASE}/week`, {
      method: 'PUT',
      body: JSON.stringify({
        ...WEEK_BODY,
        days: [{ day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [{ start: '12:00', end: '12:05' }] }],
      }),
    }), { params: {} } as any);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/at least 15 minutes/i);
  });

  it('GET grouped returns one line for the schedule', async () => {
    const res = await groupedGET(reqWith(await token('CLINIC_ADMIN'), `${BASE}/grouped?perPage=10`), { params: {} } as any);
    const body = await res.json();
    expect(body.data.pagination.total).toBe(1);
    expect(body.data.sessions[0].days).toEqual(['mon', 'thu']);
  });

  it('bulk delete accepts whole schedules, not just row ids', async () => {
    const res = await bulkDeletePOST(reqWith(await token('CLINIC_ADMIN'), `${BASE}/bulk/delete`, {
      method: 'POST', body: JSON.stringify({ groups: [{ doctorId: DOCTOR, clinicId: CLINIC }] }),
    }), { params: {} } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).data.removed).toBe(3);

    const after = await weekGET(reqWith(await token('CLINIC_ADMIN'), `${BASE}/week?doctorId=${DOCTOR}`), { params: {} } as any);
    expect((await after.json()).data.days.every((d: any) => !d.enabled)).toBe(true);
  });

  it('a clinic admin asking for another clinic is told so, not handed their own', async () => {
    const res = await weekGET(
      reqWith(await token('CLINIC_ADMIN'), `${BASE}/week?doctorId=${DOCTOR}&clinicId=${CLINIC + 77}`),
      { params: {} } as any,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/another clinic/i);
  });

  it('DELETE removes a schedule outright', async () => {
    const jwt = await token('CLINIC_ADMIN');
    await weekPUT(reqWith(jwt, `${BASE}/week`, { method: 'PUT', body: JSON.stringify(WEEK_BODY) }), { params: {} } as any);
    const res = await weekDELETE(reqWith(jwt, `${BASE}/week?doctorId=${DOCTOR}`), { params: {} } as any);
    expect((await res.json()).data.removed).toBe(3);
  });
});

describe('the /doctor-sessions alias', () => {
  it('re-exports the same handlers, so the old path still answers', async () => {
    const alias = await import('@/app/api/v1/doctor-sessions/week/route');
    const canonical = await import('@/app/api/v1/professional-sessions/week/route');
    expect(alias.GET).toBe(canonical.GET);
    expect(alias.PUT).toBe(canonical.PUT);
    expect(alias.DELETE).toBe(canonical.DELETE);

    const list = await import('@/app/api/v1/doctor-sessions/route');
    expect(list.GET).toBe((await import('@/app/api/v1/professional-sessions/route')).GET);
  });
});
