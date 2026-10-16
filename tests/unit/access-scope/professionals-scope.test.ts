/**
 * A CLINIC_ADMIN may act only on professionals mapped to their own (active) clinic.
 *
 * DELETE /professionals/{id}, POST /professionals/bulk/{delete,status} and
 * GET /professionals/{id}/services/export checked the role and nothing else, so an admin
 * of clinic A could deactivate, or read the service list of, any psychologist on the
 * install by id. PATCH /professionals/{id}/status already applied the clinic check;
 * these now apply the same one.
 *
 * Prisma and the services are mocked; route-scope is real, because that is where the
 * clinic rule lives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  actor: { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null } as {
    id: string;
    role: string;
    practiceId: null;
  },
  clinicId: 4n as bigint | null,
}));

/** doctor id → clinic ids the doctor is mapped to. */
const mappings = vi.hoisted(() => new Map<number, number[]>());

const db = vi.hoisted(() => ({
  kcDoctorClinicMapping: {
    findFirst: vi.fn(async ({ where }: any) => {
      const clinics = mappings.get(Number(where.doctorId)) ?? [];
      return clinics.includes(Number(where.clinicId)) ? { id: 1n } : null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const ids: bigint[] = where.doctorId.in;
      return ids
        .filter((d) => (mappings.get(Number(d)) ?? []).includes(Number(where.clinicId)))
        .map((d) => ({ doctorId: d }));
    }),
  },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
  getActor: vi.fn(async () => auth.actor),
}));

vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(async (actor: unknown) => ({ actor, wpUserId: 1n, clinicId: auth.clinicId })),
}));

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(async (id: bigint) => (mappings.has(Number(id)) ? { id } : null)),
}));

const svc = vi.hoisted(() => ({
  deactivateProfessional: vi.fn(async () => undefined),
  bulkDeleteProfessionals: vi.fn(async (ids: number[]) => ids.length),
  bulkSetProfessionalStatus: vi.fn(async (ids: number[]) => ids.length),
}));
vi.mock('@/services/professional/professional.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/professional/professional.service')>()),
  ...svc,
}));

const exportDoctorServices = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/services/professional/service-assignment.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/professional/service-assignment.service')>()),
  exportDoctorServices,
}));

import { DELETE } from '@/app/api/v1/professionals/[id]/route';
import { POST as bulkDelete } from '@/app/api/v1/professionals/bulk/delete/route';
import { POST as bulkStatus } from '@/app/api/v1/professionals/bulk/status/route';
import { GET as exportServices } from '@/app/api/v1/professionals/[id]/services/export/route';

const OWN = 101; // mapped to clinic 4
const FOREIGN = 202; // mapped to clinic 5 only
const SHARED = 303; // mapped to clinics 4 and 5

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  auth.clinicId = 4n;
  mappings.clear();
  mappings.set(OWN, [4]);
  mappings.set(FOREIGN, [5]);
  mappings.set(SHARED, [4, 5]);
});

describe('DELETE /professionals/{id}', () => {
  const del = (id: number) =>
    (DELETE as any)(new NextRequest(`http://localhost/api/v1/professionals/${id}`, { method: 'DELETE' }), {
      params: { id: String(id) },
    });

  it('refuses a CLINIC_ADMIN deactivating a professional of another clinic', async () => {
    const res = await del(FOREIGN);
    expect(res.status).toBe(403);
    expect(svc.deactivateProfessional).not.toHaveBeenCalled();
  });

  it('lets a CLINIC_ADMIN deactivate their own clinic’s professional', async () => {
    const res = await del(OWN);
    expect(res.status).toBe(200);
    expect(svc.deactivateProfessional).toHaveBeenCalledWith(OWN, 'actor-1');
  });

  it('lets SUPER_ADMIN deactivate anyone', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    const res = await del(FOREIGN);
    expect(res.status).toBe(200);
  });
});

describe('POST /professionals/bulk/delete and bulk/status', () => {
  it('refuses the whole batch when any id is outside the admin’s clinic', async () => {
    const res = await (bulkDelete as any)(post('/api/v1/professionals/bulk/delete', { ids: [OWN, FOREIGN] }), {});
    expect(res.status).toBe(403);
    expect(svc.bulkDeleteProfessionals).not.toHaveBeenCalled();

    const res2 = await (bulkStatus as any)(
      post('/api/v1/professionals/bulk/status', { ids: [FOREIGN], status: 'ACTIVE' }),
      {},
    );
    expect(res2.status).toBe(403);
    expect(svc.bulkSetProfessionalStatus).not.toHaveBeenCalled();
  });

  it('applies a batch that is entirely inside the admin’s clinic', async () => {
    const res = await (bulkDelete as any)(post('/api/v1/professionals/bulk/delete', { ids: [OWN, SHARED] }), {});
    expect(res.status).toBe(200);
    expect(svc.bulkDeleteProfessionals).toHaveBeenCalledWith([OWN, SHARED]);

    const res2 = await (bulkStatus as any)(
      post('/api/v1/professionals/bulk/status', { ids: [OWN], status: 'ACTIVE' }),
      {},
    );
    expect(res2.status).toBe(200);
    expect(svc.bulkSetProfessionalStatus).toHaveBeenCalledWith([OWN], 'ACTIVE');
  });

  it('refuses a CLINIC_ADMIN with no clinic at all', async () => {
    auth.clinicId = null;
    const res = await (bulkDelete as any)(post('/api/v1/professionals/bulk/delete', { ids: [OWN] }), {});
    expect(res.status).toBe(403);
  });

  it('leaves SUPER_ADMIN unrestricted', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    const res = await (bulkDelete as any)(post('/api/v1/professionals/bulk/delete', { ids: [OWN, FOREIGN] }), {});
    expect(res.status).toBe(200);
    expect(svc.bulkDeleteProfessionals).toHaveBeenCalledWith([OWN, FOREIGN]);
  });
});

describe('GET /professionals/{id}/services/export', () => {
  const get = (id: number) =>
    (exportServices as any)(new NextRequest(`http://localhost/api/v1/professionals/${id}/services/export`), {
      params: { id: String(id) },
    });

  it('refuses a CLINIC_ADMIN exporting another clinic’s professional', async () => {
    const res = await get(FOREIGN);
    expect(res.status).toBe(403);
    expect(exportDoctorServices).not.toHaveBeenCalled();
  });

  it('limits a CLINIC_ADMIN to their own clinic’s rows of a shared professional', async () => {
    const res = await get(SHARED);
    expect(res.status).toBe(200);
    expect(exportDoctorServices).toHaveBeenCalledWith(SHARED, 4);
  });

  it('404s an unknown professional', async () => {
    const res = await get(999);
    expect(res.status).toBe(404);
  });

  it('gives SUPER_ADMIN every clinic', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    const res = await get(FOREIGN);
    expect(res.status).toBe(200);
    expect(exportDoctorServices).toHaveBeenCalledWith(FOREIGN, undefined);
  });
});
