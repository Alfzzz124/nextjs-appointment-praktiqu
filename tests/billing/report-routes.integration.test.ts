import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET as reportsGET, POST as reportsPOST } from '@/app/api/v1/patient-medical-reports/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (CLIENT create) do not touch the database.
describe('patient-medical-reports routes auth matrix', () => {
  it('GET /patient-medical-reports rejected without a token (401)', async () => {
    const res = await reportsGET(
      new NextRequest('http://localhost/api/v1/patient-medical-reports'),
      { params: {} } as any,
    );
    expect(res.status).toBe(401);
  });

  it('POST /patient-medical-reports denied for CLIENT (403)', async () => {
    const res = await reportsPOST(reqWith(await token('CLIENT'), 'http://localhost/api/v1/patient-medical-reports', {
      method: 'POST', body: JSON.stringify({ patientId: 1, name: 'X', uploadReport: '0' }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  // C1: a body naming a media id (`uploadReport`) used to let a caller mint a
  // report row over another clinic's attachment. `medReportCreateSchema` now
  // has no media-id field at all, and this route has no upload step of its own
  // to produce a trustworthy one, so it can no longer create a report —
  // authorized or not. No `@/lib/db` mock is needed: this never reaches the
  // database.
  it('POST /patient-medical-reports never creates a report, even for an authorized actor supplying a media id (501)', async () => {
    const res = await reportsPOST(reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports', {
      method: 'POST', body: JSON.stringify({ patientId: 1, name: 'X', uploadReport: 'victim-media-id' }),
    }), { params: {} } as any);
    expect(res.status).toBe(501);
    expect((await res.json()).status).toBe(false);
  });
});
