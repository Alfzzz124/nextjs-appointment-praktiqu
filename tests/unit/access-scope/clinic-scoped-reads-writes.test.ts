/**
 * Four more places where the role was checked and the clinic was not:
 *
 * - GET /gdpr/audit-log handed a CLINIC_ADMIN the audit trail of every clinic.
 * - POST /consent-forms accepted any authenticated role, CLIENT included, and any clinic.
 * - PUT /professionals/{id}/availability took `?clinicId=` on trust, so an admin of a
 *   clinic sharing a psychologist could rewrite that psychologist's week at the OTHER clinic.
 * - assertModuleInScope let a CLINIC_ADMIN file a 'doctor' schedule block (an off-day)
 *   against any psychologist on the install.
 *
 * Prisma and the writers are mocked; routes and scope rules are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  actor: { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null } as {
    id: string;
    role: string;
    practiceId: null;
  },
  wpUserId: 1n,
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
  },
  $queryRawUnsafe: vi.fn(async (sql: string) => (sql.includes('COUNT(*)') ? [{ n: 0 }] : [])),
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
  resolveKcActor: vi.fn(async (actor: unknown) => ({
    actor,
    wpUserId: auth.wpUserId,
    clinicId: auth.clinicId,
  })),
}));

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(async (id: bigint) => (mappings.has(Number(id)) ? { id } : null)),
}));

const availability = vi.hoisted(() => ({
  setWeeklySchedule: vi.fn(async () => undefined),
  getWeeklySchedule: vi.fn(async () => []),
}));
vi.mock('@/services/professional/availability.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/professional/availability.service')>()),
  ...availability,
}));

const createForm = vi.hoisted(() => vi.fn(async (data: any) => ({ id: 'form-1', ...data })));
vi.mock('@/services/consent/service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/services/consent/service')>();
  class ConsentService extends orig.ConsentService {
    createForm = createForm as any;
  }
  return { ...orig, ConsentService };
});

import { GET as auditLog } from '@/app/api/v1/gdpr/audit-log/route';
import { POST as createConsentForm } from '@/app/api/v1/consent-forms/route';
import { GET as getAvailability, PUT as putAvailability } from '@/app/api/v1/professionals/[id]/availability/route';
import { assertModuleInScope } from '@/services/billing/clinic-schedule.service';

const SHARED = 303; // mapped to clinics 4 and 5
const FOREIGN = 202; // mapped to clinic 5 only

beforeEach(() => {
  vi.clearAllMocks();
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  auth.wpUserId = 1n;
  auth.clinicId = 4n;
  mappings.clear();
  mappings.set(SHARED, [4, 5]);
  mappings.set(FOREIGN, [5]);
});

describe('GET /gdpr/audit-log', () => {
  const get = () => (auditLog as any)(new NextRequest('http://localhost/api/v1/gdpr/audit-log'), {});

  it('confines a CLINIC_ADMIN to subjects of their own clinic', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    for (const [sql, ...args] of db.$queryRawUnsafe.mock.calls as unknown as [string, ...unknown[]][]) {
      expect(sql).toContain('wp_kc_patient_clinic_mappings');
      expect(sql).toContain('wp_kc_doctor_clinic_mappings');
      expect(args.slice(0, 2)).toEqual([4n, 4n]);
    }
  });

  it('matches nothing for a CLINIC_ADMIN with no clinic', async () => {
    auth.clinicId = null;
    await get();
    const [, ...args] = db.$queryRawUnsafe.mock.calls[0] as unknown as [string, ...unknown[]];
    expect(args.slice(0, 2)).toEqual([-1n, -1n]);
  });

  it('leaves SUPER_ADMIN unfiltered', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    await get();
    const [sql] = db.$queryRawUnsafe.mock.calls[0] as unknown as [string];
    expect(sql).not.toContain('clinic_mappings');
  });
});

describe('POST /consent-forms', () => {
  const post = (practiceId: string) =>
    createConsentForm(
      new NextRequest('http://localhost/api/v1/consent-forms', {
        method: 'POST',
        body: JSON.stringify({ practiceId, name: 'Informed consent', content: 'Body' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

  it.each(['CLIENT', 'PROFESSIONAL', 'RECEPTIONIST'])('refuses %s', async (role) => {
    auth.actor = { id: 'actor-1', role, practiceId: null };
    const res = await post('4');
    expect(res.status).toBe(403);
    expect(createForm).not.toHaveBeenCalled();
  });

  it('refuses a CLINIC_ADMIN creating a form for another clinic', async () => {
    const res = await post('5');
    expect(res.status).toBe(403);
    expect(createForm).not.toHaveBeenCalled();
  });

  it('lets a CLINIC_ADMIN create a form for their own clinic', async () => {
    const res = await post('4');
    expect(res.status).toBe(201);
    expect(createForm).toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN create a form for any clinic', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    const res = await post('5');
    expect(res.status).toBe(201);
  });
});

describe('/professionals/{id}/availability ?clinicId', () => {
  const week = { schedule: [{ day: 'mon', startTime: '09:00', endTime: '12:00' }] };
  const put = (id: number, clinicId?: number) =>
    (putAvailability as any)(
      new NextRequest(
        `http://localhost/api/v1/professionals/${id}/availability${clinicId ? `?clinicId=${clinicId}` : ''}`,
        { method: 'PUT', body: JSON.stringify(week), headers: { 'content-type': 'application/json' } },
      ),
      { params: { id: String(id) } },
    );
  const get = (id: number, clinicId?: number) =>
    (getAvailability as any)(
      new NextRequest(
        `http://localhost/api/v1/professionals/${id}/availability${clinicId ? `?clinicId=${clinicId}` : ''}`,
      ),
      { params: { id: String(id) } },
    );

  it('refuses a CLINIC_ADMIN writing a shared professional’s week at the other clinic', async () => {
    const res = await put(SHARED, 5);
    expect(res.status).toBe(403);
    expect(availability.setWeeklySchedule).not.toHaveBeenCalled();
  });

  it('refuses a CLINIC_ADMIN reading it there too', async () => {
    const res = await get(SHARED, 5);
    expect(res.status).toBe(403);
  });

  it('lets a CLINIC_ADMIN write at their own clinic, named or defaulted', async () => {
    expect((await put(SHARED, 4)).status).toBe(200);
    expect((await put(SHARED)).status).toBe(200);
    expect(availability.setWeeklySchedule).toHaveBeenCalledTimes(2);
    for (const call of availability.setWeeklySchedule.mock.calls as unknown as unknown[][]) {
      expect(call[1]).toBe(4);
    }
  });

  it('lets a professional write their own week only at a clinic they are mapped to', async () => {
    auth.actor = { id: 'actor-1', role: 'PROFESSIONAL', practiceId: null };
    auth.wpUserId = BigInt(SHARED);
    expect((await put(SHARED, 5)).status).toBe(200);
    expect((await put(SHARED, 9)).status).toBe(403);
  });

  it('lets SUPER_ADMIN write at any clinic', async () => {
    auth.actor = { id: 'super-1', role: 'SUPER_ADMIN', practiceId: null };
    auth.clinicId = null;
    expect((await put(FOREIGN, 5)).status).toBe(200);
  });
});

describe('assertModuleInScope — doctor module', () => {
  const kc = (role: string, clinicId: bigint | null, wpUserId = 1n) =>
    ({ actor: { id: 'a', role, practiceId: null }, wpUserId, clinicId }) as any;

  it('refuses a CLINIC_ADMIN scheduling a professional of another clinic', async () => {
    await expect(assertModuleInScope('doctor', FOREIGN, kc('CLINIC_ADMIN', 4n))).rejects.toThrow();
  });

  it('allows a CLINIC_ADMIN scheduling a professional of their clinic', async () => {
    await expect(assertModuleInScope('doctor', SHARED, kc('CLINIC_ADMIN', 4n))).resolves.toBeUndefined();
  });

  it('refuses a CLINIC_ADMIN with no clinic', async () => {
    await expect(assertModuleInScope('doctor', SHARED, kc('CLINIC_ADMIN', null))).rejects.toThrow();
  });

  it('keeps the existing clinic-module and professional rules', async () => {
    await expect(assertModuleInScope('clinic', 5, kc('CLINIC_ADMIN', 4n))).rejects.toThrow();
    await expect(assertModuleInScope('clinic', 4, kc('CLINIC_ADMIN', 4n))).resolves.toBeUndefined();
    await expect(assertModuleInScope('doctor', SHARED, kc('PROFESSIONAL', 4n, BigInt(SHARED)))).resolves.toBeUndefined();
    await expect(assertModuleInScope('doctor', FOREIGN, kc('PROFESSIONAL', 4n, BigInt(SHARED)))).rejects.toThrow();
    await expect(assertModuleInScope('doctor', FOREIGN, kc('SUPER_ADMIN', null))).resolves.toBeUndefined();
  });
});
