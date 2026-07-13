// tests/integration/consent/signature.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { authHeaders } from '../../helpers/auth';
import { POST, GET } from '@/app/api/v1/consent-forms/route';

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    consentForm = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })) };
  },
}));

let AUTH: Record<string, string>;
beforeAll(async () => {
  AUTH = await authHeaders({ userId: 'admin_1', role: 'SUPER_ADMIN' });
});

function makeReq(url: string, init?: RequestInit) { return new Request(url, init) as any; }

describe('POST /api/v1/consent-forms', () => {
  it('creates form', async () => {
    const req = makeReq('http://localhost/api/v1/consent-forms', {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ practiceId: 'p1', name: 'Telehealth', content: '<p>Content</p>' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Telehealth');
  });
});

describe('GET /api/v1/consent-forms', () => {
  it('requires practiceId', async () => {
    const req = makeReq('http://localhost/api/v1/consent-forms', { headers: AUTH });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns list when practiceId provided', async () => {
    const req = makeReq('http://localhost/api/v1/consent-forms?practiceId=p1', { headers: AUTH });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});