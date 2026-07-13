// tests/integration/intervention-plan/plan-creation.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { POST, GET } from '@/app/api/v1/intervention-plans/route';
import { authHeaders } from '../../helpers/auth';

// Auth is now JWT-based; mint a professional Bearer token once for the suite.
let AUTH: Record<string, string>;
beforeAll(async () => {
  AUTH = await authHeaders({ userId: 'prof_1', role: 'PROFESSIONAL' });
});

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    interventionPlan = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: 'new',
        ...data,
        items: (data.items?.create ?? []).map((i: any) => ({ id: 'i1', ...i })),
      })),
      findUnique: vi.fn().mockResolvedValue(null),
    };
    recommendationItem = { update: vi.fn() };
  },
}));

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any;
}

describe('POST /api/v1/intervention-plans', () => {
  it('creates plan', async () => {
    const req = makeReq('http://localhost/api/v1/intervention-plans', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ sessionId: 's1', clientId: 'c1', items: [{ description: 'Test' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('rejects empty items', async () => {
    const req = makeReq('http://localhost/api/v1/intervention-plans', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ sessionId: 's1', clientId: 'c1', items: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/intervention-plans', () => {
  it('returns empty list', async () => {
    const req = makeReq('http://localhost/api/v1/intervention-plans', { headers: AUTH });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});