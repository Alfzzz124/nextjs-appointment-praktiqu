import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';

import { GET as practiceGet, PATCH as practicePatch, DELETE as practiceDelete } from '@/app/api/v1/practices/[id]/route';
import { GET as settingsGet, PATCH as settingsPatch } from '@/app/api/v1/practices/[id]/settings/route';
import { GET as holidaysGet, POST as holidaysPost, DELETE as holidayDelete } from '@/app/api/v1/practices/[id]/holidays/route';
import { GET as usersGet } from '@/app/api/v1/practices/[id]/users/route';

/**
 * Route-level proof for the extra cross-tenant gap found during audit: every
 * `/practices/:id` route (and `/settings`, `/holidays`, `/users`) gated CLINIC_ADMIN
 * by role alone — `requireRoles(['SUPER_ADMIN','CLINIC_ADMIN'])` — with no check that
 * the id in the URL was THEIR clinic. `assertPracticeInScope` (proved at the service
 * level in practice-scope.test.ts) is wired into each route here; this proves the
 * wiring holds for every one of them.
 */

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
async function token(role: string, sub: string) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

const CLINIC_A = 9_042_001, CLINIC_B = 9_042_002;
let jwtA: string;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC_A, clinicId: CLINIC_A });
  await seedClinicAdmin({ userId: CLINIC_B, clinicId: CLINIC_B });
  jwtA = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
});
afterAll(cleanup);

describe('GET/PATCH/DELETE /practices/:id', () => {
  it('clinic A gets 404 for clinic B\'s practice', async () => {
    const res = await practiceGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A sees its own practice', async () => {
    const res = await practiceGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}`), { params: { id: String(CLINIC_A) } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(CLINIC_A);
  });

  it('clinic A cannot PATCH clinic B\'s practice', async () => {
    const res = await practicePatch(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }),
    }), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A cannot DELETE (deactivate) clinic B\'s practice', async () => {
    const res = await practiceDelete(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });
});

describe('GET/PATCH /practices/:id/settings', () => {
  it('clinic A gets 404 for clinic B\'s settings', async () => {
    const res = await settingsGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/settings`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A cannot PATCH clinic B\'s settings', async () => {
    const res = await settingsPatch(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/settings`, {
      method: 'PATCH', body: JSON.stringify({ timezone: 'Asia/Jakarta' }),
    }), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });
});

describe('GET/POST/DELETE /practices/:id/holidays', () => {
  it('clinic A gets 404 listing clinic B\'s holidays', async () => {
    const res = await holidaysGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/holidays`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A cannot add a holiday to clinic B', async () => {
    const res = await holidaysPost(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/holidays`, {
      method: 'POST', body: JSON.stringify({ title: 'Hijacked holiday', startDate: '2026-12-25', endDate: '2026-12-25', isAllDay: true }),
    }), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A cannot delete a holiday from clinic B', async () => {
    const res = await holidayDelete(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/holidays/1`), { params: { id: String(CLINIC_B), holidayId: '1' } });
    expect(res.status).toBe(404);
  });

  it('clinic A can list its own (empty) holidays', async () => {
    const res = await holidaysGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`), { params: { id: String(CLINIC_A) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [] });
  });

  // The success paths `handleError`'s fail-open guard silently corrupted: POST passes
  // its raw success DTO (never an `Error`) through `handleError` unconverted, and
  // DELETE's 204 has no body at all — both are exactly what the guard's original bug
  // turned into a false 500.
  it('clinic A can add a holiday to its own practice', async () => {
    const res = await holidaysPost(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`, {
      method: 'POST', body: JSON.stringify({ title: 'Founders day', startDate: '2026-11-01', endDate: '2026-11-01', isAllDay: true }),
    }), { params: { id: String(CLINIC_A) } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({ practiceId: CLINIC_A, title: 'Founders day' });
  });

  it('clinic A can delete its own holiday', async () => {
    const created = await holidaysPost(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`, {
      method: 'POST', body: JSON.stringify({ title: 'To be removed', startDate: '2026-11-02', endDate: '2026-11-02', isAllDay: true }),
    }), { params: { id: String(CLINIC_A) } });
    const { data } = await created.json();

    const res = await holidayDelete(
      reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays/${data.id}`),
      { params: { id: String(CLINIC_A), holidayId: String(data.id) } },
    );
    expect(res.status).toBe(204);
  });
});

describe('non-numeric :id answers 404, not 500', () => {
  it('GET /practices/:id', async () => {
    const res = await practiceGet(reqWith(jwtA, `http://localhost/api/v1/practices/abc`), { params: { id: 'abc' } });
    expect(res.status).toBe(404);
  });

  it('GET /practices/:id/settings', async () => {
    const res = await settingsGet(reqWith(jwtA, `http://localhost/api/v1/practices/abc/settings`), { params: { id: 'abc' } });
    expect(res.status).toBe(404);
  });

  it('GET /practices/:id/holidays', async () => {
    const res = await holidaysGet(reqWith(jwtA, `http://localhost/api/v1/practices/abc/holidays`), { params: { id: 'abc' } });
    expect(res.status).toBe(404);
  });
});

describe('GET /practices/:id/users', () => {
  it('clinic A gets 404 listing clinic B\'s users', async () => {
    const res = await usersGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/users`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });

  it('clinic A can list its own users', async () => {
    const res = await usersGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/users`), { params: { id: String(CLINIC_A) } });
    expect(res.status).toBe(200);
  });
});
