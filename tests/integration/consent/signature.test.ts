/**
 * Consent form routes. `practiceId` is a wp_kc_clinics id now, so the clinic has to
 * exist before a form can be filed against it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { authHeaders } from '../../helpers/auth';
import { POST, GET } from '@/app/api/v1/consent-forms/route';
import { findClinicById } from '@/repositories/wp/clinics.repo';

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    consentForm = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
    };
  },
}));

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
}));

let AUTH: Record<string, string>;
beforeAll(async () => {
  AUTH = await authHeaders({ userId: 'admin_1', role: 'SUPER_ADMIN' });
});

beforeEach(() => {
  vi.mocked(findClinicById).mockResolvedValue({ id: 3n, name: 'Klinik Uji' } as never);
});

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as never;
}

function postBody(body: unknown) {
  return makeReq('http://localhost/api/v1/consent-forms', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/consent-forms', () => {
  it('creates form', async () => {
    const res = await POST(
      postBody({ practiceId: '3', name: 'Telehealth', content: '<p>Content</p>' }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Telehealth');
  });

  it('rejects a leftover cuid practiceId', async () => {
    const res = await POST(postBody({ practiceId: 'p1', name: 'Telehealth', content: 'x' }));
    expect(res.status).toBe(400);
  });

  it('404s when the clinic does not exist', async () => {
    vi.mocked(findClinicById).mockResolvedValue(null);

    const res = await POST(postBody({ practiceId: '99999', name: 'Telehealth', content: 'x' }));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/consent-forms', () => {
  it('requires practiceId', async () => {
    const res = await GET(makeReq('http://localhost/api/v1/consent-forms', { headers: AUTH }));
    expect(res.status).toBe(400);
  });

  it('returns list when practiceId provided', async () => {
    const res = await GET(
      makeReq('http://localhost/api/v1/consent-forms?practiceId=3', { headers: AUTH }),
    );

    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).items)).toBe(true);
  });
});
