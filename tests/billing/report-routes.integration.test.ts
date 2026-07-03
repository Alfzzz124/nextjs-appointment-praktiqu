import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET as reportsGET, POST as reportsPOST } from '@/app/api/v1/patient-medical-reports/route';
import { GET as previewGET } from '@/app/api/v1/patient-medical-reports/[id]/preview/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// These assertions are reached before any DB access: assertCan runs before resolveKcActor,
// so 401 (no token) and 403 (CLIENT create) do not touch the database. The preview stub
// returns 501 after assertCan and never calls resolveKcActor, so it also needs no DB.
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

  it('GET /patient-medical-reports/[id]/preview returns 501 for an authorized role (CLINIC_ADMIN)', async () => {
    const res = await previewGET(
      reqWith(await token('CLINIC_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/preview'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(501);
    expect((await res.json()).code).toBe('NOT_IMPLEMENTED');
  });
});
