/**
 * /api/v1/custom-fields routes, now backed by KiviCare's tables.
 *
 * Previously mocked `PrismaClient.customField` — the shadow model. The repository is
 * mocked instead, since that is what the service calls now.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { authHeaders } from '../../helpers/auth';

vi.mock('@/repositories/wp/custom-fields.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/custom-fields.repo')>()),
  listCustomFields: vi.fn(),
  createCustomField: vi.fn(),
  findCustomFieldById: vi.fn(),
}));

import { POST, GET } from '@/app/api/v1/custom-fields/route';
import {
  createCustomField,
  findCustomFieldById,
  listCustomFields,
} from '@/repositories/wp/custom-fields.repo';

const FIELD_ID = 7;

let AUTH: Record<string, string>;
beforeAll(async () => {
  AUTH = await authHeaders({ userId: 'admin_1', role: 'SUPER_ADMIN' });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomFields).mockResolvedValue([]);
  vi.mocked(createCustomField).mockResolvedValue(FIELD_ID);
  vi.mocked(findCustomFieldById).mockResolvedValue({
    id: FIELD_ID,
    moduleType: 'client',
    doctorId: 0,
    label: 'Emergency Contact',
    fieldType: 'text',
    options: [],
    placeholder: null,
    isRequired: false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as never);
});

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as never;
}

describe('POST /api/v1/custom-fields', () => {
  it('creates a text field', async () => {
    const res = await POST(
      makeReq('http://localhost/api/v1/custom-fields', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({
          moduleType: 'client',
          fieldLabel: 'Emergency Contact',
          fieldType: 'text',
          isRequired: false,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fieldLabel).toBe('Emergency Contact');
    expect(body.id).toBe(FIELD_ID);
  });

  it('rejects unknown fieldType', async () => {
    const res = await POST(
      makeReq('http://localhost/api/v1/custom-fields', {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ moduleType: 'client', fieldLabel: 'X', fieldType: 'unknown' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/custom-fields', () => {
  it('returns list', async () => {
    const res = await GET(
      makeReq('http://localhost/api/v1/custom-fields?moduleType=client', { headers: AUTH }),
    );

    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).items)).toBe(true);
  });

  it('rejects a non-numeric doctorId instead of querying NaN', async () => {
    // KiviCare scopes custom fields by doctor, not clinic — this replaced ?clinicId=.
    const res = await GET(
      makeReq('http://localhost/api/v1/custom-fields?doctorId=abc', { headers: AUTH }),
    );
    expect(res.status).toBe(400);
  });
});
