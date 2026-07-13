// tests/integration/notes-templates/create.test.ts
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { authHeaders } from '../../helpers/auth';
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

let AUTH: Record<string, string>;
beforeAll(async () => {
  AUTH = await authHeaders({ userId: 'admin_1', role: 'SUPER_ADMIN' });
});

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any;
}

describe('POST /api/v1/notes-templates', () => {
  it('creates a template and returns 201', async () => {
    const req = makeReq('http://localhost/api/v1/notes-templates', {
      method: 'POST',
      headers: AUTH,
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
      headers: AUTH,
      body: JSON.stringify({ name: '', content: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/notes-templates', () => {
  it('returns list', async () => {
    const req = makeReq('http://localhost/api/v1/notes-templates?clinicId=c1', { headers: AUTH });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });
});
