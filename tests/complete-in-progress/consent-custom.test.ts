/**
 * Tests for Task 9: consent-form DELETE + bulk-status, custom-field bulk-status,
 * save-data, get-data.
 *
 * These tests mock the Prisma client so no DB is needed.
 *
 * The former "file-upload stub" coverage here was removed when the real
 * handler replaced the 501 stub — see tests/uploads/file-upload-route.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth', () => ({
  getActor: vi.fn().mockResolvedValue({ id: 'user-1', role: 'SUPER_ADMIN', practiceId: null }),
  withAuth: (handler: Function) => (req: any, ctx: any) =>
    handler(req, { actor: { id: 'user-1', role: 'SUPER_ADMIN', practiceId: null }, params: ctx }),
  AuthError: class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
}));

// ── Prisma mock ──────────────────────────────────────────────────────────────
vi.mock('@prisma/client', () => {
  const mockPrisma = {
    consentForm: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    customField: {
      updateMany: vi.fn(),
    },
    customFieldData: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { PrismaClient: vi.fn(() => mockPrisma) };
});

// ── Import routes AFTER mock ─────────────────────────────────────────────────
import { DELETE } from '@/app/api/v1/consent-forms/[id]/route';
import { POST as consentStatusPost } from '@/app/api/v1/consent-forms/status/route';
import { POST as cfStatusPost } from '@/app/api/v1/custom-fields/status/route';
import { POST as cfSaveData } from '@/app/api/v1/custom-fields/save-data/route';
import { GET as cfGetData } from '@/app/api/v1/custom-fields/get-data/route';
import { PrismaClient } from '@prisma/client';

// Helper to get the underlying mock prisma instance
function getMockPrisma() {
  return new (PrismaClient as any)();
}

function makeReq(url: string, opts: RequestInit = {}) {
  return new NextRequest(url, opts);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Consent form DELETE
// ────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/consent-forms/[id]', () => {
  it('returns 200 when form exists', async () => {
    const db = getMockPrisma();
    db.consentForm.findUnique.mockResolvedValue({ id: 'form-1', name: 'Test' });
    db.consentForm.delete.mockResolvedValue({});

    const res = await DELETE(
      makeReq('http://localhost/api/v1/consent-forms/form-1'),
      { params: { id: 'form-1' } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message');
  });

  it('returns 404 when form does not exist', async () => {
    const db = getMockPrisma();
    db.consentForm.findUnique.mockResolvedValue(null);

    const res = await DELETE(
      makeReq('http://localhost/api/v1/consent-forms/missing'),
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Consent form bulk status
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/consent-forms/status', () => {
  it('returns 200 with updated count', async () => {
    const db = getMockPrisma();
    db.consentForm.updateMany.mockResolvedValue({ count: 3 });

    const res = await consentStatusPost(
      makeReq('http://localhost/api/v1/consent-forms/status', {
        method: 'POST',
        body: JSON.stringify({ ids: ['a', 'b', 'c'], status: 'ACTIVE' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('updated', 3);
  });

  it('returns 400 when ids is missing', async () => {
    const res = await consentStatusPost(
      makeReq('http://localhost/api/v1/consent-forms/status', {
        method: 'POST',
        body: JSON.stringify({ status: 'ACTIVE' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Custom field bulk status
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/custom-fields/status', () => {
  it('returns 200 with updated count', async () => {
    const db = getMockPrisma();
    db.customField.updateMany.mockResolvedValue({ count: 2 });

    const res = await cfStatusPost(
      makeReq('http://localhost/api/v1/custom-fields/status', {
        method: 'POST',
        body: JSON.stringify({ ids: ['f1', 'f2'], status: 0 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('updated', 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Custom field save-data
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/custom-fields/save-data', () => {
  it('returns 200 with Saved message', async () => {
    const db = getMockPrisma();
    db.customFieldData.upsert.mockResolvedValue({});

    const res = await cfSaveData(
      makeReq('http://localhost/api/v1/custom-fields/save-data', {
        method: 'POST',
        body: JSON.stringify({ entityType: 'client', entityId: 'c1', fieldId: 'f1', value: 'hello' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Saved');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await cfSaveData(
      makeReq('http://localhost/api/v1/custom-fields/save-data', {
        method: 'POST',
        body: JSON.stringify({ entityType: 'client' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Custom field get-data
// ────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/custom-fields/get-data', () => {
  it('returns 200 with items array', async () => {
    const db = getMockPrisma();
    db.customFieldData.findMany.mockResolvedValue([{ fieldId: 'f1', fieldValue: 'hello' }]);

    const res = await cfGetData(
      makeReq('http://localhost/api/v1/custom-fields/get-data?entityType=client&entityId=c1'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('returns 400 when query params missing', async () => {
    const res = await cfGetData(
      makeReq('http://localhost/api/v1/custom-fields/get-data'),
    );
    expect(res.status).toBe(400);
  });
});
