import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as dataDeletePOST } from '@/app/api/v1/gdpr/data-delete/route';
import { GET as auditLogGET } from '@/app/api/v1/gdpr/audit-log/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

// assertCan runs before resolveKcActor, so 401 (no token) and 403 (wrong role)
// are reached before any DB access — these tests never touch the database.
describe('gdpr routes auth matrix', () => {
  it('POST /gdpr/data-delete rejected without a token (401)', async () => {
    const res = await dataDeletePOST(new NextRequest('http://localhost/api/v1/gdpr/data-delete', {
      method: 'POST', body: JSON.stringify({ userId: 1 }),
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /gdpr/data-delete denied for CLINIC_ADMIN (403 — gdpr_delete is SUPER_ADMIN only)', async () => {
    const res = await dataDeletePOST(reqWith(await token('CLINIC_ADMIN'), 'http://localhost/api/v1/gdpr/data-delete', {
      method: 'POST', body: JSON.stringify({ userId: 1 }),
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('GET /gdpr/audit-log denied for CLIENT (403 — gdpr_audit_read excludes CLIENT)', async () => {
    const res = await auditLogGET(reqWith(await token('CLIENT'), 'http://localhost/api/v1/gdpr/audit-log', {
      method: 'GET',
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
