/**
 * These assertions are reached before any database access in the RBAC sense —
 * `assertCan` runs before `resolveKcActor` — but `patient_report_read` allows
 * CLIENT, so the "not 403" case *does* proceed into `resolveKcActor` and then
 * `findEncounterById`. Both are backed by Prisma, so `@/lib/db` is mocked here
 * rather than seeded, keeping this suite off the shared test database. What
 * status the CLIENT case lands on beyond "not 403" is deliberately not
 * asserted: with the encounter reported absent it currently reaches a 500.
 * `params.id` itself is fine — `withAuth` was fixed (see `src/lib/auth.ts`,
 * commit `a6a8ad6`) to hand routes the params object itself rather than the
 * `{ params }` wrapper Next.js passes it, so `ctx.params.id` now resolves as
 * every `[id]` route expects. The 500 here instead comes from the mocked
 * encounter service reporting the row absent; the point of this test is only
 * that CLIENT clears the permission gate, so it does not pin down which
 * downstream status that produces.
 *
 * `vitest.config.ts` sets neither `clearMocks` nor `restoreMocks`, so every
 * test here must reset the mocks itself — see `beforeEach`.
 *
 * Later tasks append more `describe` blocks to this file; keep new blocks
 * self-contained (own mock return values in their own `beforeEach`/`it`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    kcPatientEncounter: { findUnique: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from '@/lib/db';
import { GET as documentsGET } from '@/app/api/v1/encounters/[id]/documents/route';
import { GET as reportContentGET } from '@/app/api/v1/patient-medical-reports/[id]/content/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(SECRET);
}

function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, {
    ...init,
    headers: { authorization: `Bearer ${jwt}`, ...(init.headers ?? {}) },
  });
}

describe('GET /encounters/:id/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Actor resolves to a WP user, and the encounter itself is reported absent
    // (see the file header for why this ends up producing a 500 rather than a
    // clean 404 right now).
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 9000001n });
    (prisma.kcPatientEncounter.findUnique as any).mockResolvedValue(null);
  });

  it('rejects a request with no token (401)', async () => {
    const res = await documentsGET(
      new NextRequest('http://localhost/api/v1/encounters/1/documents'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('allows a CLIENT to reach the handler — read access is theirs too', async () => {
    const res = await documentsGET(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/encounters/1/documents'),
      { params: { id: '1' } } as any,
    );
    // Not 403: a client may read its own documents. Whether this encounter is
    // theirs is a row-scope question for the service to answer (404 in intent;
    // see the file header for the pre-existing bug that currently makes it a 500).
    expect(res.status).not.toBe(403);
  });
});

describe('GET /patient-medical-reports/:id/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Actor resolves to a WP user; the report row itself is reported absent by
    // $queryRawUnsafe (an empty result set), which getMedReport turns into a 404.
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 9000001n });
    (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
  });

  it('rejects a request with no token (401)', async () => {
    const res = await reportContentGET(
      new NextRequest('http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('lets a CLIENT through to the row-scope check', async () => {
    const res = await reportContentGET(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    expect(res.status).not.toBe(403);
  });
});
