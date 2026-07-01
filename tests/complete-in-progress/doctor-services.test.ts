/**
 * Task 10: Doctor Services — bulk delete, bulk status, export
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth so getActor returns a SUPER_ADMIN actor
vi.mock('@/lib/auth', () => ({
  getActor: vi.fn().mockResolvedValue({ id: 'user-1', role: 'SUPER_ADMIN', practiceId: null }),
  withAuth: vi.fn(),
}));

// Mock service functions
vi.mock('@/services/professional/service-assignment.service', () => ({
  bulkDeleteDoctorServices: vi.fn().mockResolvedValue(3),
  bulkSetDoctorServiceStatus: vi.fn().mockResolvedValue(2),
  exportDoctorServices: vi.fn().mockResolvedValue([
    {
      id: 'assign-1',
      professionalId: 'prof-1',
      serviceId: 'svc-1',
      serviceName: 'Consultation',
      serviceDuration: 30,
      serviceStatus: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ]),
  listAssignedServices: vi.fn().mockResolvedValue([]),
  assignService: vi.fn(),
  unassignService: vi.fn(),
  isServiceAssignmentError: vi.fn().mockReturnValue(false),
}));

import { POST as bulkDeletePost } from '@/app/api/v1/professionals/[id]/services/bulk/delete/route';
import { POST as bulkStatusPost } from '@/app/api/v1/professionals/[id]/services/bulk/status/route';
import { GET as exportGet } from '@/app/api/v1/professionals/[id]/services/export/route';
import { getActor } from '@/lib/auth';

const PROF_ID = 'prof-1';

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /professionals/[id]/services/bulk/delete', () => {
  it('returns 200 with count on success', async () => {
    const req = makeReq('POST', `http://localhost/api/v1/professionals/${PROF_ID}/services/bulk/delete`, {
      serviceIds: ['svc-1', 'svc-2', 'svc-3'],
    });
    const res = await bulkDeletePost(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ updated: 3 });
  });

  it('returns 403 for non-admin role', async () => {
    vi.mocked(getActor).mockResolvedValueOnce({ id: 'user-2', role: 'RECEPTIONIST', practiceId: 'p-1' } as never);
    const req = makeReq('POST', `http://localhost/api/v1/professionals/${PROF_ID}/services/bulk/delete`, {
      serviceIds: ['svc-1'],
    });
    const res = await bulkDeletePost(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(403);
  });
});

describe('POST /professionals/[id]/services/bulk/status', () => {
  it('returns 200 with count on success', async () => {
    const req = makeReq('POST', `http://localhost/api/v1/professionals/${PROF_ID}/services/bulk/status`, {
      serviceIds: ['svc-1', 'svc-2'],
      status: 'active',
    });
    const res = await bulkStatusPost(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ updated: 2 });
  });

  it('returns 422 when serviceIds missing', async () => {
    const req = makeReq('POST', `http://localhost/api/v1/professionals/${PROF_ID}/services/bulk/status`, {
      status: 'active',
    });
    const res = await bulkStatusPost(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(422);
  });
});

describe('GET /professionals/[id]/services/export', () => {
  it('returns 200 with Content-Disposition header', async () => {
    const req = makeReq('GET', `http://localhost/api/v1/professionals/${PROF_ID}/services/export`);
    const res = await exportGet(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ professionalId: PROF_ID });
  });

  it('returns 403 for non-admin role', async () => {
    vi.mocked(getActor).mockResolvedValueOnce({ id: 'user-3', role: 'PROFESSIONAL', practiceId: null } as never);
    const req = makeReq('GET', `http://localhost/api/v1/professionals/${PROF_ID}/services/export`);
    const res = await exportGet(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(403);
  });
});
