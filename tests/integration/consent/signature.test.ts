// tests/integration/consent/signature.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST, GET } from '@/app/api/v1/consent-forms/route';

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    consentForm = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })) };
  },
}));

function makeReq(url: string, init?: RequestInit) { return new Request(url, init) as any; }

describe('POST /api/v1/consent-forms', () => {
  it('creates form', async () => {
    const req = makeReq('http://localhost/api/v1/consent-forms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
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
    const req = makeReq('http://localhost/api/v1/consent-forms');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns list when practiceId provided', async () => {
    const req = makeReq('http://localhost/api/v1/consent-forms?practiceId=p1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});