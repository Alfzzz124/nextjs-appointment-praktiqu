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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { GET as documentsGET, POST as documentsPOST } from '@/app/api/v1/encounters/[id]/documents/route';
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

describe('GET /encounters/:id/documents — perPage/page parsing', () => {
  /**
   * These assert the value the route actually hands to `listEncounterDocuments`,
   * not just the HTTP status — that's the only way to catch `perPage=0` silently
   * turning into the default (`Number(0) || DEFAULT` is falsy) rather than
   * clamping to the floor of 1. The service itself is mocked via `vi.doMock` +
   * a fresh dynamic `import()` per test (undone by `vi.resetModules` in
   * `beforeEach`), so this block doesn't disturb the static, `@/lib/db`-backed
   * mocking the rest of this file relies on.
   */
  beforeEach(() => {
    vi.resetModules();
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 9000001n });
  });

  async function callWithPerPage(query: string) {
    const listEncounterDocuments = vi.fn().mockResolvedValue({
      sessionDocuments: [],
      patientDocuments: [],
      pagination: { page: 1, perPage: 1, total: 0 },
    });
    vi.doMock('@/services/encounter-documents/service', () => ({
      listEncounterDocuments,
      uploadEncounterDocument: vi.fn(),
    }));

    const { GET } = await import('@/app/api/v1/encounters/[id]/documents/route');
    const res = await GET(
      reqWith(await token('SUPER_ADMIN'), `http://localhost/api/v1/encounters/1/documents${query}`),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(200);

    const [, , opts] = listEncounterDocuments.mock.calls[0];
    return opts.perPage;
  }

  it('perPage=0 clamps to the floor (1), not the default', async () => {
    expect(await callWithPerPage('?perPage=0')).toBe(1);
  });

  it('perPage=-5 clamps to the floor (1)', async () => {
    expect(await callWithPerPage('?perPage=-5')).toBe(1);
  });

  it('perPage=abc (unparseable) falls back to the default (20)', async () => {
    expect(await callWithPerPage('?perPage=abc')).toBe(20);
  });

  it('perPage=99999 clamps to the ceiling (100)', async () => {
    expect(await callWithPerPage('?perPage=99999')).toBe(100);
  });

  it('a missing perPage falls back to the default (20)', async () => {
    expect(await callWithPerPage('')).toBe(20);
  });
});

describe('GET /patient-medical-reports/:id/content', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Actor resolves to a WP user; the report row itself is reported absent by
    // $queryRawUnsafe (an empty result set), which getMedReport turns into a 404.
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 9000001n });
    (prisma.$queryRawUnsafe as any).mockResolvedValue([]);
    // Only reached once a report row with a numeric upload_report clears the
    // 404 guard below — needed so fetchMedia's serviceToken() call doesn't
    // throw before the fetch stub in each test below gets a chance to run.
    process.env.WORDPRESS_SERVICE_TOKEN = 'test-token';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
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

  /**
   * The try/catch's four documented branches, none of which any test above
   * reaches. Each assertion below also checks the body never carries the
   * upstream detail (message text, filesystem path) the code comment next to
   * the catch says must not reach the client — see route.ts's `catch (err)`.
   */

  it('returns a clean 404 when the report has no numeric file id', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Report', patient_id: 9000001, upload_report: null, date: new Date('2026-01-01') },
    ]);

    const res = await reportContentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.message).toBe('Document has no file');
  });

  it('turns an upstream 404 from the media plugin into a generic 502, not the plugin detail', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Report', patient_id: 9000001, upload_report: '42', date: new Date('2026-01-01') },
    ]);
    globalThis.fetch = vi.fn(async () =>
      new Response('/var/www/wp-content/uploads/kivicare-reports/patient-42-confidential.pdf not found', { status: 404 }),
    ) as any;

    const res = await reportContentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    const bodyText = await res.text();

    expect(res.status).toBe(502);
    expect(bodyText).not.toContain('kivicare-reports');
    expect(bodyText).not.toContain('confidential');
    expect(JSON.parse(bodyText).message).toBe('Could not read the document');
  });

  it('turns an upstream 500 from the media plugin into a generic 502, not the plugin detail', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Report', patient_id: 9000001, upload_report: '42', date: new Date('2026-01-01') },
    ]);
    globalThis.fetch = vi.fn(async () =>
      new Response('Fatal error in /var/www/html/wp-content/plugins/kivicare/media.php on line 88', { status: 500 }),
    ) as any;

    const res = await reportContentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    const bodyText = await res.text();

    expect(res.status).toBe(502);
    expect(bodyText).not.toContain('kivicare/media.php');
    expect(bodyText).not.toContain('Fatal error');
    expect(JSON.parse(bodyText).message).toBe('Could not read the document');
  });

  it('turns a non-WpEndpointError throw (e.g. a network failure) into a generic 502', async () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([
      { id: 1, name: 'Report', patient_id: 9000001, upload_report: '42', date: new Date('2026-01-01') },
    ]);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND internal-wp-host.local');
    }) as any;

    const res = await reportContentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/patient-medical-reports/1/content'),
      { params: { id: '1' } } as any,
    );
    const bodyText = await res.text();

    expect(res.status).toBe(502);
    expect(bodyText).not.toContain('ENOTFOUND');
    expect(bodyText).not.toContain('internal-wp-host.local');
    expect(JSON.parse(bodyText).message).toBe('Could not read the document');
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

  it('surfaces a KcError raised inside getSession with its own status, not a generic 502', async () => {
    // getSession → resolveKcActor throws this KcError(..., 403) when the actor's
    // User row has no wpUserId — before SessionServiceError ever gets a chance
    // to fire. The route's catch used to only match `instanceof SessionServiceError`,
    // so this fell through to the generic branch and came back as a 502.
    (prisma.user.findUnique as any).mockResolvedValue(null);

    const res = await attachmentGET(
      reqWith(await token('SUPER_ADMIN'), 'http://localhost/api/v1/sessions/1/attachments/2/content'),
      { params: { id: '1', mediaId: '2' } } as any,
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.message).toBe('User is not linked to a WordPress account');
  });
});

describe('POST /encounters/:id/documents', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await documentsPOST(
      new NextRequest('http://localhost/api/v1/encounters/1/documents', { method: 'POST' }),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('denies a CLIENT (403) — upload is staff-only', async () => {
    const res = await documentsPOST(
      reqWith(await token('CLIENT'), 'http://localhost/api/v1/encounters/1/documents', { method: 'POST' }),
      { params: { id: '1' } } as any,
    );
    expect(res.status).toBe(403);
  });
});
