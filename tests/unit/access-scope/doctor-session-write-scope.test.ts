/**
 * A CLINIC_ADMIN writing a weekly schedule (or a single session row) is bound to their own
 * clinic already; the psychologist named in the body was not checked at all. An admin of
 * clinic A could therefore plant clinic-A schedule rows for a psychologist who works only
 * at clinic B. The Laravel FE's custom-session form refuses exactly that against the
 * clinic roster; the backend write path now refuses it too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** doctor id → clinic ids the doctor is mapped to. */
const mappings = vi.hoisted(() => new Map<number, number[]>());

const db = vi.hoisted(() => ({
  kcDoctorClinicMapping: {
    findFirst: vi.fn(async ({ where }: any) => {
      const clinics = mappings.get(Number(where.doctorId)) ?? [];
      return clinics.includes(Number(where.clinicId)) ? { id: 1n } : null;
    }),
  },
  $queryRawUnsafe: vi.fn(async () => []),
  $transaction: vi.fn(async (fn: any) =>
    fn({
      $executeRawUnsafe: vi.fn(async () => 1),
      $queryRawUnsafe: vi.fn(async () => [{ id: 1n }]),
    }),
  ),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { createDoctorSession, saveDoctorSessionWeek } from '@/services/billing/doctor-session.service';

const OWN = 101; // mapped to clinic 4
const FOREIGN = 202; // mapped to clinic 5 only

const kc = (role: string, clinicId: bigint | null, wpUserId = 1n) =>
  ({ actor: { id: 'a', role, practiceId: null }, wpUserId, clinicId }) as any;

const week = (doctorId: number) => ({
  doctorId,
  timeSlot: 30,
  days: [{ day: 'mon', enabled: true, mainSession: { start: '09:00', end: '12:00' }, breaks: [] }],
}) as any;

const row = (doctorId: number) => ({ doctorId, day: 'mon', startTime: '09:00', endTime: '12:00', timeSlot: 30 });

beforeEach(() => {
  vi.clearAllMocks();
  mappings.clear();
  mappings.set(OWN, [4]);
  mappings.set(FOREIGN, [5]);
});

describe('doctor-session writes by a CLINIC_ADMIN', () => {
  it('refuses a weekly schedule for a psychologist outside the admin’s clinic', async () => {
    await expect(saveDoctorSessionWeek(week(FOREIGN), kc('CLINIC_ADMIN', 4n))).rejects.toMatchObject({ httpStatus: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a single session row for such a psychologist', async () => {
    await expect(createDoctorSession(row(FOREIGN), kc('CLINIC_ADMIN', 4n))).rejects.toMatchObject({ httpStatus: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('writes the week of the admin’s own psychologist', async () => {
    const saved = await saveDoctorSessionWeek(week(OWN), kc('CLINIC_ADMIN', 4n));
    expect(saved).toMatchObject({ doctor_id: OWN, clinic_id: 4 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves SUPER_ADMIN free to pair any psychologist and clinic', async () => {
    const saved = await saveDoctorSessionWeek({ ...week(FOREIGN), clinicId: 4 }, kc('SUPER_ADMIN', null));
    expect(saved).toMatchObject({ doctor_id: FOREIGN, clinic_id: 4 });
  });

  it('keeps a professional on their own schedule', async () => {
    const saved = await saveDoctorSessionWeek(week(OWN), kc('PROFESSIONAL', 4n, BigInt(OWN)));
    expect(saved).toMatchObject({ doctor_id: OWN, clinic_id: 4 });
    await expect(saveDoctorSessionWeek(week(FOREIGN), kc('PROFESSIONAL', 4n, BigInt(OWN)))).rejects.toMatchObject({
      httpStatus: 403,
    });
  });
});
