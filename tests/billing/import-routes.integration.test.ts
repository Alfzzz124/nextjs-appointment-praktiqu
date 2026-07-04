import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as importPOST } from '@/app/api/v1/import/route';
import { POST as validatePOST } from '@/app/api/v1/import/validate/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

const body = JSON.stringify({ entity: 'taxes', rows: [{ name: 'VAT', tax_value: 10 }] });

// These assertions are reached before any DB access: withAuth throws 401 before
// the handler runs, and assertCan throws 403 before resolveKcActor is called —
// so 401 (no token) and 403 (wrong role) never touch the database.
describe('import routes auth matrix', () => {
  it('POST /import rejected without a token (401)', async () => {
    const res = await importPOST(new NextRequest('http://localhost/api/v1/import', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /import denied for PROFESSIONAL (403 — import_manage excludes PROFESSIONAL)', async () => {
    const res = await importPOST(reqWith(await token('PROFESSIONAL'), 'http://localhost/api/v1/import', {
      method: 'POST', body,
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('POST /import/validate rejected without a token (401)', async () => {
    const res = await validatePOST(new NextRequest('http://localhost/api/v1/import/validate', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    }), { params: {} } as any);
    expect(res.status).toBe(401);
  });

  it('POST /import/validate denied for RECEPTIONIST (403 — import_manage excludes RECEPTIONIST)', async () => {
    const res = await validatePOST(reqWith(await token('RECEPTIONIST'), 'http://localhost/api/v1/import/validate', {
      method: 'POST', body,
    }), { params: {} } as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });
});
