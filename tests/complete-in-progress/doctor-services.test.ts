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
      doctorId: 8100001,
      serviceId: 101,
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
import {
  bulkDeleteDoctorServices,
  bulkSetDoctorServiceStatus,
} from '@/services/professional/service-assignment.service';

// Numeric wp_users.ID since professionals moved to WordPress (D2). The routes now
// reject a non-numeric id with 400 before reaching the service.
const PROF_ID = '8100001';

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('the retired write endpoints', () => {
  // These four used to write to wp_kc_service_doctor_mapping without the
  // upcoming-appointment check /api/v1/services enforces, and without a clinic filter --
  // so DELETE switched a service off at EVERY clinic the psychologist works at. They now
  // answer 410. See src/services/professional/retired-endpoints.ts.

  it('bulk/delete answers 410 and points at the replacement', async () => {
    const res = await bulkDeletePost();

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('endpoint_retired');
    expect(body.replacement).toBe('DELETE /api/v1/services/{id}');
    expect(bulkDeleteDoctorServices).not.toHaveBeenCalled();
  });

  it('bulk/status answers 410', async () => {
    const res = await bulkStatusPost();

    expect(res.status).toBe(410);
    expect((await res.json()).replacement).toBe('PUT /api/v1/services/{id}');
    expect(bulkSetDoctorServiceStatus).not.toHaveBeenCalled();
  });

  it('carries the headers a client can notice without reading the body', async () => {
    const res = await bulkDeletePost();

    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Sunset')).toBeTruthy();
    expect(res.headers.get('Link')).toContain('rel="successor-version"');
  });

  it('never consults auth — the endpoint is gone for everyone', async () => {
    // Deliberate: checking the token first would answer 401 to an unauthenticated caller,
    // implying a better token might work. It would not; the endpoint is gone.
    vi.mocked(getActor).mockClear();

    expect((await bulkDeletePost()).status).toBe(410);
    expect((await bulkStatusPost()).status).toBe(410);
    expect(getActor).not.toHaveBeenCalled();
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
    // The export now returns the doctor's WordPress id under `doctorId`; there is no
    // separate professional entity to key on any more.
    expect(body[0]).toMatchObject({ doctorId: Number(PROF_ID) });
  });

  it('returns 403 for non-admin role', async () => {
    vi.mocked(getActor).mockResolvedValueOnce({ id: 'user-3', role: 'PROFESSIONAL', practiceId: null } as never);
    const req = makeReq('GET', `http://localhost/api/v1/professionals/${PROF_ID}/services/export`);
    const res = await exportGet(req, { params: { id: PROF_ID } });
    expect(res.status).toBe(403);
  });
});
