/**
 * Clinic staff may bulk-act only on their own clinic's sessions and clients.
 *
 * POST /sessions/bulk/delete (bulk cancel), /clients/bulk/delete (bulk archive) and
 * /clients/bulk/status checked the role and then acted on every id they were handed, so
 * a CLINIC_ADMIN or RECEPTIONIST of clinic A could cancel clinic B's appointments or
 * archive its patients. The single-id routes already refused that.
 *
 * Prisma and the bulk writers are mocked; the routes, the scope helpers and the repo
 * queries behind them are real.
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

/** appointment id → clinic id. */
const appointments = vi.hoisted(() => new Map<number, number>());
/** patient id → clinic ids. */
const patients = vi.hoisted(() => new Map<number, number[]>());

const db = vi.hoisted(() => ({
  kcAppointment: {
    findMany: vi.fn(async ({ where }: any) =>
      (where.id.in as bigint[])
        .filter((id) => appointments.get(Number(id)) === Number(where.clinicId))
        .map((id) => ({ id })),
    ),
  },
  // patientIdsInClinic: SELECT patient_id ... WHERE clinic_id = ? AND patient_id IN (?, ...)
  $queryRawUnsafe: vi.fn(async (_sql: string, clinicId: bigint, ...ids: bigint[]) =>
    ids
      .filter((id) => (patients.get(Number(id)) ?? []).includes(Number(clinicId)))
      .map((id) => ({ patient_id: id })),
  ),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getActor: vi.fn(async () => auth.actor),
}));

vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(async (actor: unknown) => ({ actor, wpUserId: 1n, clinicId: auth.clinicId })),
}));

const writers = vi.hoisted(() => ({
  cancelAppointment: vi.fn(async () => undefined),
  updatePatient: vi.fn(async () => undefined),
}));
vi.mock('@/repositories/wp/appointments.write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/appointments.write')>()),
  cancelAppointment: writers.cancelAppointment,
}));
vi.mock('@/repositories/wp/patients.write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/patients.write')>()),
  updatePatient: writers.updatePatient,
}));

import { POST as sessionsBulkDelete } from '@/app/api/v1/sessions/bulk/delete/route';
import { POST as clientsBulkDelete } from '@/app/api/v1/clients/bulk/delete/route';
import { POST as clientsBulkStatus } from '@/app/api/v1/clients/bulk/status/route';

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
  appointments.clear();
  appointments.set(11, 4);
  appointments.set(12, 4);
  appointments.set(21, 5);
  patients.clear();
  patients.set(31, [4]);
  patients.set(32, [4, 5]);
  patients.set(41, [5]);
});

describe('POST /sessions/bulk/delete', () => {
  const call = (ids: number[]) => sessionsBulkDelete(post('/api/v1/sessions/bulk/delete', { ids }));

  it.each(['CLINIC_ADMIN', 'RECEPTIONIST'])(
    'refuses a %s batch holding another clinic’s session, cancelling nothing',
    async (role) => {
      auth.actor = { id: 'actor-1', role, practiceId: null };
      const res = await call([11, 21]);
      expect(res.status).toBe(403);
      expect(writers.cancelAppointment).not.toHaveBeenCalled();
    },
  );

  it('refuses an id that does not exist rather than reporting it', async () => {
    const res = await call([11, 999]);
    expect(res.status).toBe(403);
    expect(writers.cancelAppointment).not.toHaveBeenCalled();
  });

  it('cancels a batch entirely inside the actor’s clinic', async () => {
    const res = await call([11, 12]);
    expect(res.status).toBe(200);
    expect(writers.cancelAppointment).toHaveBeenCalledTimes(2);
  });

  it('refuses staff with no clinic', async () => {
    auth.clinicId = null;
    const res = await call([11]);
    expect(res.status).toBe(403);
  });

  it('leaves SUPER_ADMIN unrestricted', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    const res = await call([11, 21]);
    expect(res.status).toBe(200);
    expect(writers.cancelAppointment).toHaveBeenCalledTimes(2);
  });
});

describe('POST /clients/bulk/delete and bulk/status', () => {
  const archive = (ids: number[]) => clientsBulkDelete(post('/api/v1/clients/bulk/delete', { ids }));
  const status = (ids: number[]) =>
    clientsBulkStatus(post('/api/v1/clients/bulk/status', { ids, status: 'INACTIVE' }));

  it.each(['CLINIC_ADMIN', 'RECEPTIONIST'])(
    'refuses a %s batch holding another clinic’s client, changing nothing',
    async (role) => {
      auth.actor = { id: 'actor-1', role, practiceId: null };
      expect((await archive([31, 41])).status).toBe(403);
      expect((await status([41])).status).toBe(403);
      expect(writers.updatePatient).not.toHaveBeenCalled();
    },
  );

  it('applies a batch whose clients all belong to the actor’s clinic (any of their clinics)', async () => {
    expect((await archive([31, 32])).status).toBe(200);
    expect(writers.updatePatient).toHaveBeenCalledTimes(2);
    writers.updatePatient.mockClear();
    expect((await status([32])).status).toBe(200);
    expect(writers.updatePatient).toHaveBeenCalledTimes(1);
  });

  it('refuses staff with no clinic', async () => {
    auth.clinicId = null;
    expect((await archive([31])).status).toBe(403);
  });

  it('leaves SUPER_ADMIN unrestricted', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    expect((await archive([31, 41])).status).toBe(200);
    expect(writers.updatePatient).toHaveBeenCalledTimes(2);
  });
});
