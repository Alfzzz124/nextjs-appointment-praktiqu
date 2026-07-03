import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';
import {
  createDoctorSession, getDoctorSession, listDoctorSessions,
  updateDoctorSession, deleteDoctorSession, bulkDeleteDoctorSessions,
  doctorSessionModule,
} from '@/services/billing/doctor-session.service';

const CLINIC = 9_000_001, ADMIN = 9_000_002, DOCTOR = 9_000_010, OTHER_DOCTOR = 9_000_011;

// CLINIC_ADMIN actor scoped to CLINIC — create derives clinicId from kc.clinicId.
const kcAdmin = {
  actor: { id: 'test-admin-9000002', role: 'CLINIC_ADMIN', practiceId: null },
  wpUserId: BigInt(ADMIN),
  clinicId: BigInt(CLINIC),
} as any;

// PROFESSIONAL actor bound to DOCTOR — may only create sessions for themselves.
const kcDoctor = {
  actor: { id: 'test-doctor', role: 'PROFESSIONAL', practiceId: null },
  wpUserId: BigInt(DOCTOR),
  clinicId: BigInt(CLINIC),
} as any;

const scopeClinic = { clinicId: BigInt(CLINIC) };

describe('doctor-session.service', () => {
  // No DB needed for the static module config — assert it directly.
  it('doctorSessionModule() returns the 7-day list', () => {
    const m = doctorSessionModule();
    expect(m.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(m.defaultSlot).toBe(30);
  });

  describe('DB-backed lifecycle', () => {
    beforeAll(async () => {
      assertTestDb();
      await cleanup();
      await seedClinicAdmin({ userId: ADMIN, clinicId: CLINIC });
    });
    afterAll(cleanup);

    it('creates, reads, lists, updates, and deletes a session (clinic + doctor scope)', async () => {
      const { id } = await createDoctorSession(
        { doctorId: DOCTOR, day: 'mon', startTime: '09:00:00', endTime: '17:00:00', timeSlot: 30 },
        kcAdmin,
      );
      expect(id).toBeGreaterThan(0);

      const got = await getDoctorSession(id, scopeClinic);
      expect(got.day).toBe('mon');
      expect(got.doctor_id).toBe(DOCTOR);

      const list = await listDoctorSessions({ page: 1, perPage: 100 } as any, scopeClinic);
      expect(list.sessions.some((s) => s.id === id)).toBe(true);

      await updateDoctorSession(id, { day: 'tue', timeSlot: 45 }, scopeClinic);
      const updated = await getDoctorSession(id, scopeClinic);
      expect(updated.day).toBe('tue');
      expect(updated.time_slot).toBe(45);

      await deleteDoctorSession(id, scopeClinic);
      await expect(getDoctorSession(id, scopeClinic)).rejects.toThrow();
    });

    it('a PROFESSIONAL cannot create a session for another doctor (403)', async () => {
      await expect(
        createDoctorSession(
          { doctorId: OTHER_DOCTOR, day: 'mon', startTime: '09:00:00', endTime: '12:00:00', timeSlot: 30 },
          kcDoctor,
        ),
      ).rejects.toThrow();
      // creating for themselves succeeds
      const { id } = await createDoctorSession(
        { doctorId: DOCTOR, day: 'wed', startTime: '09:00:00', endTime: '12:00:00', timeSlot: 30 },
        kcDoctor,
      );
      expect(id).toBeGreaterThan(0);
      await deleteDoctorSession(id, scopeClinic);
    });

    it('bulk-delete only removes in-scope ids', async () => {
      const inScope = await createDoctorSession(
        { doctorId: DOCTOR, day: 'thu', startTime: '09:00:00', endTime: '12:00:00', timeSlot: 30 },
        kcAdmin,
      );
      const outScope = await createDoctorSession(
        { clinicId: CLINIC + 500, doctorId: DOCTOR, day: 'fri', startTime: '09:00:00', endTime: '12:00:00', timeSlot: 30 },
        { ...kcAdmin, actor: { ...kcAdmin.actor, role: 'SUPER_ADMIN' }, clinicId: null },
      );

      const n = await bulkDeleteDoctorSessions([inScope.id, outScope.id], scopeClinic);
      expect(n).toBe(1);
      await expect(getDoctorSession(inScope.id, scopeClinic)).rejects.toThrow();
      // the out-of-clinic session survives the scoped delete
      expect((await getDoctorSession(outScope.id, null)).id).toBe(outScope.id);
      await deleteDoctorSession(outScope.id, null);
    });
  });
});
