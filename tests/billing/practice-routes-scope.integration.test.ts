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

  // There is no `[holidayId]` route segment anywhere under `practices/` —
  // `practices/[id]/holidays/route.ts` is the only file, so Next.js only ever
  // supplies `{ id }` to this handler. The two DELETE tests below used to pass
  // `{ params: { id, holidayId } }`, a shape production never produces; that made
  // them green on a route that cannot exist while the reachable one (`{ id }` only)
  // is permanently broken (see the next test). Fixed here to call with the real
  // params shape, cast `as any` since `HolidayParams`'s own type still (wrongly)
  // requires `holidayId`.
  it('clinic A cannot delete a holiday from clinic B (scope is still checked before the broken holidayId read)', async () => {
    const res = await holidayDelete(
      reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}/holidays`),
      { params: { id: String(CLINIC_B) } } as any,
    );
    expect(res.status).toBe(404);
  });

  it('clinic A can list its own (empty) holidays', async () => {
    const res = await holidaysGet(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`), { params: { id: String(CLINIC_A) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [] });
  });

  // The success paths `handleError`'s fail-open guard silently corrupted: POST passes
  // its raw success DTO (never an `Error`) through `handleError` unconverted — that is
  // what the guard's original bug turned into a false 500.
  it('clinic A can add a holiday to its own practice', async () => {
    const res = await holidaysPost(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`, {
      method: 'POST', body: JSON.stringify({ title: 'Founders day', startDate: '2026-11-01', endDate: '2026-11-01', isAllDay: true }),
    }), { params: { id: String(CLINIC_A) } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({ practiceId: CLINIC_A, title: 'Founders day' });
  });

  /**
   * DELETE is pre-existing and broken for every real caller, not just an edge case:
   * production never supplies `holidayId` (no route segment carries it), so
   * `Number(params.holidayId)` is `NaN`, `BigInt(NaN)` throws `RangeError`, and
   * `handleError` falls through to a generic 500. This is deliberately NOT fixed here
   * — building the missing `[holidayId]` route is out of scope for this branch — but
   * the test must say what actually happens instead of asserting a params shape
   * Next.js cannot produce. Recorded in
   * docs/deploy/encounter-documents-staging-deploy.md alongside the other known gaps.
   */
  it('clinic A deleting its own holiday 500s — no [holidayId] segment exists to carry the id', async () => {
    const created = await holidaysPost(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`, {
      method: 'POST', body: JSON.stringify({ title: 'To be removed', startDate: '2026-11-02', endDate: '2026-11-02', isAllDay: true }),
    }), { params: { id: String(CLINIC_A) } });
    expect(created.status).toBe(201);

    const res = await holidayDelete(
      reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_A}/holidays`),
      { params: { id: String(CLINIC_A) } } as any,
    );
    expect(res.status).toBe(500);
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
