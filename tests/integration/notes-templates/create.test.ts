// tests/integration/notes-templates/create.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/api/v1/notes-templates/route';

vi.mock('@prisma/client', () => {
  const data: Record<string, any> = {};
  return {
    PrismaClient: class {
      noteTemplate = {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(async ({ data: d }) => {
          const id = `t_${Date.now()}`;
          data[id] = { id, ...d };
          return data[id];
        }),
      };
    },
  };
});

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any;
}

describe('POST /api/v1/notes-templates', () => {
  it('creates a template and returns 201', async () => {
    const req = makeReq('http://localhost/api/v1/notes-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Intake', content: 'Hello {{name}}' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Intake');
  });

  it('returns 400 on validation failure', async () => {
    const req = makeReq('http://localhost/api/v1/notes-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', content: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/notes-templates', () => {
  it('returns list', async () => {
    const req = makeReq('http://localhost/api/v1/notes-templates?clinicId=c1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});
