import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { assertTestDb, cleanup, seedClinicAdmin, seedEncounter, useIdBlock } from './fixtures';
import { GET as listGET, POST as createPOST } from '@/app/api/v1/encounters/route';
import { GET as getOneGET } from '@/app/api/v1/encounters/[id]/route';

const { BASE } = useIdBlock('billing/encounter-routes.integration.test.ts');

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = `test-admin-${BASE + 1}`) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url = 'http://localhost/api/v1/encounters', init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

describe('encounter routes auth matrix', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedClinicAdmin({ userId: BASE + 1, clinicId: BASE + 1 });
    await seedEncounter({ id: BASE + 720, clinicId: BASE + 1 });
  });
  afterAll(cleanup);

  it('GET /encounters returns the {status,message,data} envelope for CLINIC_ADMIN (200)', async () => {
    const res = await listGET(reqWith(await token('CLINIC_ADMIN')), { params: {} } as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('status', true);
    expect(json.data).toHaveProperty('encounters');
  });

  it('GET /encounters rejected without a token (401)', async () => {
    const res = await listGET(new NextRequest('http://localhost/api/v1/encounters'), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /encounters denied for CLIENT (403)', async () => {
    const res = await createPOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/encounters', {
      method: 'POST', body: JSON.stringify({ patientId: 1 }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  // Regression test for the withAuth params bug: Next.js invokes dynamic route
  // handlers as `handler(req, { params })`, but withAuth used to hand routes
  // the whole `{ params }` context object as `params`, so `params.id` read
  // `undefined` and every dynamic route silently computed NaN. This is the
  // first test in the suite that drives a real seeded row through a dynamic
  // `[id]` route with a real actor and checks the row comes back.
  it('GET /encounters/:id returns the seeded encounter for CLINIC_ADMIN (200)', async () => {
    const res = await getOneGET(
      reqWith(await token('CLINIC_ADMIN'), `http://localhost/api/v1/encounters/${BASE + 720}`),
      { params: { id: String(BASE + 720) } } as any,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('status', true);
    expect(json.data).toMatchObject({ id: BASE + 720, clinic_id: BASE + 1 });
  });
});
