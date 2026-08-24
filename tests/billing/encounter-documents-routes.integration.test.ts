/**
 * These assertions are reached before any database access in the RBAC sense —
 * `assertCan` runs before `resolveKcActor` — but `patient_report_read` allows
 * CLIENT, so the "not 403" case *does* proceed into `resolveKcActor` and then
 * `findEncounterById`. Both are backed by Prisma, so `@/lib/db` is mocked here
 * rather than seeded, keeping this suite off the shared test database. What
 * status the CLIENT case lands on beyond "not 403" is deliberately not
 * asserted: with the encounter reported absent it currently reaches a 500,
 * because `params.id` comes through `withAuth` as `undefined` here (see
 * `src/lib/auth.ts` — `ctx` already *is* `{ params }` when Next.js calls a
 * route, so wrapping it again as the `params` field double-nests it for every
 * `[id]` route in the app, not just this one). That is a pre-existing,
 * codebase-wide bug outside this task's scope; the point of this test is only
 * that CLIENT clears the permission gate, so it does not pin down which
 * downstream status that bug happens to produce.
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
  },
}));

import { prisma } from '@/lib/db';
import { GET as documentsGET } from '@/app/api/v1/encounters/[id]/documents/route';

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
