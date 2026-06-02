// tests/integration/custom-fields/create.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST, GET } from '@/app/api/v1/custom-fields/route';

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    customField = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
    };
  },
}));

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any;
}

describe('POST /api/v1/custom-fields', () => {
  it('creates a text field', async () => {
    const req = makeReq('http://localhost/api/v1/custom-fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        moduleType: 'client',
        fieldLabel: 'Emergency Contact',
        fieldType: 'text',
        isRequired: false,
        order: 0,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fieldLabel).toBe('Emergency Contact');
  });

  it('rejects unknown fieldType', async () => {
    const req = makeReq('http://localhost/api/v1/custom-fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        moduleType: 'client',
        fieldLabel: 'X',
        fieldType: 'unknown',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/custom-fields', () => {
  it('returns list', async () => {
    const req = makeReq('http://localhost/api/v1/custom-fields?moduleType=client');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});