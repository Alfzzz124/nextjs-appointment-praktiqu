/**
 * These assertions are reached before any database access in the RBAC sense —
 * `assertCan` runs before `resolveKcActor` — but `patient_report_read` allows
 * CLIENT, so the CLIENT case *does* proceed into `resolveKcActor` and then
 * `findEncounterById`. Both are backed by Prisma, so `@/lib/db` is mocked here
 * rather than seeded, keeping this suite off the shared test database.
 * `params.id` itself is fine — `withAuth` was fixed (see `src/lib/auth.ts`,
 * commit `a6a8ad6`) to hand routes the params object itself rather than the
 * `{ params }` wrapper Next.js passes it, so `ctx.params.id` now resolves as
 * every `[id]` route expects. With that fixed, and the encounter reported
 * absent, the CLIENT case reaches the real `404 Encounter not found` — no
 * longer the unreachable 500 an earlier, defensive `not.toBe(403)` was written
 * to route around.
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

// Every table `resolveKcActor` or the encounter-documents code paths can touch,
// stubbed to fail loudly instead of silently returning `undefined` when a test
// exercises a path nobody has mocked yet — a wrong status from an unmocked call
// resolving to `undefined` is much harder to trace than a thrown error naming
// exactly which call was missing.
vi.mock('@/lib/db', () => {
  function loud(path: string) {
    return vi.fn(() => {
      throw new Error(`@/lib/db mock: prisma.${path}() called without a mock — add one in this test's beforeEach`);
    });
  }
  return {
    prisma: {
      user: { findUnique: loud('user.findUnique') },
      kcPatientEncounter: { findUnique: loud('kcPatientEncounter.findUnique') },
      kcAppointment: { findUnique: loud('kcAppointment.findUnique') },
      kcDoctorClinicMapping: { findFirst: loud('kcDoctorClinicMapping.findFirst') },
      kcClinic: { findFirst: loud('kcClinic.findFirst') },
      kcReceptionistClinicMapping: { findFirst: loud('kcReceptionistClinicMapping.findFirst') },
      $queryRawUnsafe: loud('$queryRawUnsafe'),
    },
  };
});

import { prisma } from '@/lib/db';
import { GET as documentsGET } from '@/app/api/v1/encounters/[id]/documents/route';
import { GET as reportContentGET } from '@/app/api/v1/patient-medical-reports/[id]/content/route';
import { GET as attachmentGET } from '@/app/api/v1/sessions/[id]/attachments/[mediaId]/content/route';

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
    // Actor resolves to a WP user, and the encounter itself is reported absent.
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
    // Not 403: a client may read its own documents. With the encounter reported
    // absent this reaches the real 404 — tightened from `not.toBe(403)` now that
    // the withAuth params bug (commit a6a8ad6) that used to swallow this into an
    // unreachable 500 is fixed.
    expect(res.status).toBe(404);
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

describe('GET /sessions/:id/attachments/:mediaId/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a request with no token (401)', async () => {
    const res = await attachmentGET(
      new NextRequest('http://localhost/api/v1/sessions/1/attachments/2/content'),
      { params: { id: '1', mediaId: '2' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('refuses a non-numeric media id before any lookup (404)', async () => {
    const res = await attachmentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/sessions/1/attachments/abc/content'),
      { params: { id: '1', mediaId: 'abc' } } as any,
    );
    expect(res.status).toBe(404);
  });
});
