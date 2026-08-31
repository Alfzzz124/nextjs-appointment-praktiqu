import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedClinicAdmin, cleanup } from './fixtures';
import { prisma } from '@/lib/db';
import {
  createDoctorSession, getDoctorSession, listDoctorSessions,
  updateDoctorSession, deleteDoctorSession, bulkDeleteDoctorSessions,
  doctorSessionModule, buildWeekWindows, saveDoctorSessionWeek,
  getDoctorSessionWeek, deleteDoctorSessionWeek, listDoctorSessionGroups,
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

/* ------------------------------------------------------------------ */
/* Weekly schedule — the shape the scheduling screen edits             */
/* ------------------------------------------------------------------ */

describe('weekly doctor sessions', () => {
  const day = (over: any = {}) => ({ day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [], ...over });

  describe('buildWeekWindows (pure)', () => {
    it('splits a day at its break', () => {
      const w = buildWeekWindows([day({ breaks: [{ start: '12:00', end: '13:00' }] })]);
      expect(w).toEqual([
        { day: 'mon', startTime: '09:00:00', endTime: '12:00:00' },
        { day: 'mon', startTime: '13:00:00', endTime: '17:00:00' },
      ]);
    });

    it('two breaks make three windows, whatever order they arrive in', () => {
      const w = buildWeekWindows([day({
        breaks: [{ start: '15:00', end: '15:30' }, { start: '12:00', end: '12:30' }],
      })]);
      expect(w.map((x) => `${x.startTime}-${x.endTime}`)).toEqual([
        '09:00:00-12:00:00', '12:30:00-15:00:00', '15:30:00-17:00:00',
      ]);
    });

    it('a break flush against the session start just moves the start', () => {
      const w = buildWeekWindows([day({ breaks: [{ start: '09:00', end: '10:00' }] })]);
      expect(w).toEqual([{ day: 'mon', startTime: '10:00:00', endTime: '17:00:00' }]);
    });

    it('skips disabled days and keeps enabled ones', () => {
      const w = buildWeekWindows([
        day(),
        day({ day: 'tue', enabled: false, mainSession: null }),
        day({ day: 'wed', mainSession: { start: '08:00', end: '11:00' } }),
      ]);
      expect(w.map((x) => x.day)).toEqual(['mon', 'wed']);
    });

    it.each([
      ['no day enabled', [day({ enabled: false, mainSession: null })], /at least one day/i],
      ['enabled day with no times', [day({ mainSession: null })], /set session times for mon/i],
      ['end before start', [day({ mainSession: { start: '17:00', end: '09:00' } })], /after start time/i],
      ['session under 30 minutes', [day({ mainSession: { start: '09:00', end: '09:20' } })], /at least 30 minutes/i],
      ['break under 15 minutes', [day({ breaks: [{ start: '12:00', end: '12:10' }] })], /at least 15 minutes/i],
      ['break outside the session', [day({ breaks: [{ start: '18:00', end: '19:00' }] })], /within session hours/i],
      ['break ending after the session', [day({ breaks: [{ start: '16:30', end: '18:00' }] })], /end before session ends/i],
      ['overlapping breaks', [day({ breaks: [{ start: '12:00', end: '13:00' }, { start: '12:30', end: '14:00' }] })], /cannot overlap/i],
      ['a break that swallows the day', [day({ breaks: [{ start: '09:00', end: '17:00' }] })], /no working time/i],
      ['the same day twice', [day(), day()], /appears twice/i],
    ])('rejects %s', (_label, days, message) => {
      expect(() => buildWeekWindows(days as any)).toThrow(message as RegExp);
    });
  });

  describe('DB-backed', () => {
    const WEEK_CLINIC = 9_000_101, WEEK_ADMIN = 9_000_102, WEEK_DOCTOR = 9_000_110;
    const kcWeekAdmin = {
      actor: { id: `test-admin-${WEEK_ADMIN}`, role: 'CLINIC_ADMIN', practiceId: null },
      wpUserId: BigInt(WEEK_ADMIN), clinicId: BigInt(WEEK_CLINIC),
    } as any;
    const weekScope = { clinicId: BigInt(WEEK_CLINIC) };

    beforeAll(async () => {
      assertTestDb();
      await cleanup();
      await seedClinicAdmin({ userId: WEEK_ADMIN, clinicId: WEEK_CLINIC });
    });
    afterAll(cleanup);

    it('saves a week and reads back the session plus its breaks', async () => {
      const saved = await saveDoctorSessionWeek({
        doctorId: WEEK_DOCTOR,
        timeSlot: 45,
        days: [
          { day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [{ start: '12:00', end: '13:00' }] },
          { day: 'wed', enabled: true, mainSession: { start: '08:00', end: '11:00' }, breaks: [] },
          { day: 'sun', enabled: false, mainSession: null, breaks: [] },
        ],
      } as any, kcWeekAdmin);
      expect(saved.windows).toBe(3);   // mon splits in two, wed is one

      const week = await getDoctorSessionWeek(WEEK_DOCTOR, WEEK_CLINIC, weekScope);
      expect(week.time_slot).toBe(45);
      expect(week.days).toHaveLength(7);

      const mon = week.days.find((d) => d.day === 'mon')!;
      expect(mon.enabled).toBe(true);
      expect(mon.mainSession).toEqual({ start: '09:00', end: '17:00' });
      expect(mon.breaks).toEqual([{ start: '12:00', end: '13:00' }]);

      const wed = week.days.find((d) => d.day === 'wed')!;
      expect(wed.mainSession).toEqual({ start: '08:00', end: '11:00' });
      expect(wed.breaks).toEqual([]);

      expect(week.days.filter((d) => d.enabled).map((d) => d.day)).toEqual(['mon', 'wed']);
    });

    it('saving again replaces the week rather than adding to it', async () => {
      await saveDoctorSessionWeek({
        doctorId: WEEK_DOCTOR, timeSlot: 30,
        days: [{ day: 'fri', enabled: true, mainSession: { start: '10:00', end: '12:00' }, breaks: [] }],
      } as any, kcWeekAdmin);

      const week = await getDoctorSessionWeek(WEEK_DOCTOR, WEEK_CLINIC, weekScope);
      expect(week.days.filter((d) => d.enabled).map((d) => d.day)).toEqual(['fri']);
      expect(week.time_slot).toBe(30);
    });

    it('lists one grouped row per doctor and clinic, with days in week order', async () => {
      await saveDoctorSessionWeek({
        doctorId: WEEK_DOCTOR, timeSlot: 30,
        days: [
          { day: 'wed', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [{ start: '12:00', end: '13:00' }] },
          { day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [] },
        ],
      } as any, kcWeekAdmin);

      const list = await listDoctorSessionGroups(
        { page: 1, perPage: 10, orderBy: 'doctor_name', order: 'asc' } as any, weekScope,
      );
      expect(list.pagination.total).toBe(1);
      expect(list.sessions[0].doctor_id).toBe(WEEK_DOCTOR);
      expect(list.sessions[0].days).toEqual(['mon', 'wed']);   // not insertion order
      expect(list.sessions[0].window_count).toBe(3);
      expect(list.sessions[0].time_slot).toBe(30);
    });

    it('a professional cannot save someone else\'s week', async () => {
      const kcOtherDoctor = {
        actor: { id: 'test-doctor-other', role: 'PROFESSIONAL', practiceId: null },
        wpUserId: BigInt(WEEK_DOCTOR + 1), clinicId: BigInt(WEEK_CLINIC),
      } as any;
      await expect(saveDoctorSessionWeek({
        doctorId: WEEK_DOCTOR, timeSlot: 30,
        days: [{ day: 'mon', enabled: true, mainSession: { start: '09:00', end: '17:00' }, breaks: [] }],
      } as any, kcOtherDoctor)).rejects.toThrow(/another doctor/i);
    });

    it('deletes the whole schedule at once', async () => {
      const removed = await deleteDoctorSessionWeek(WEEK_DOCTOR, WEEK_CLINIC, weekScope);
      expect(removed).toBeGreaterThan(0);
      const week = await getDoctorSessionWeek(WEEK_DOCTOR, WEEK_CLINIC, weekScope);
      expect(week.days.every((d) => !d.enabled)).toBe(true);
    });

    it('an unknown doctor reads back as an empty week, not an error', async () => {
      const week = await getDoctorSessionWeek(WEEK_DOCTOR + 900, WEEK_CLINIC, weekScope);
      expect(week.days).toHaveLength(7);
      expect(week.days.every((d) => !d.enabled)).toBe(true);
      expect(week.time_slot).toBe(30);   // the module default
    });

    it('reads a schedule KiviCare itself wrote, gaps and legacy casing included', async () => {
      // Exactly what the WordPress plugin inserts: an uppercase day slug and a lunch
      // break expressed as two rows with a hole between them.
      const LEGACY_DOCTOR = WEEK_DOCTOR + 5;
      await prisma.$executeRawUnsafe(
        `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
         VALUES (?, ?, 'MON', '09:00:00', '12:00:00', 20, NOW()),
                (?, ?, 'MON', '13:00:00', '17:00:00', 20, NOW()),
                (?, ?, 'SAT', '00:00:00', '00:00:00', 20, NOW())`,
        WEEK_CLINIC, LEGACY_DOCTOR, WEEK_CLINIC, LEGACY_DOCTOR, WEEK_CLINIC, LEGACY_DOCTOR,
      );

      const week = await getDoctorSessionWeek(LEGACY_DOCTOR, WEEK_CLINIC, weekScope);
      const mon = week.days.find((d) => d.day === 'mon')!;
      expect(mon.enabled).toBe(true);
      expect(mon.mainSession).toEqual({ start: '09:00', end: '17:00' });
      expect(mon.breaks).toEqual([{ start: '12:00', end: '13:00' }]);
      expect(week.time_slot).toBe(20);
      // The 00:00-00:00 junk row is not a working day.
      expect(week.days.find((d) => d.day === 'sat')!.enabled).toBe(false);

      // ...and editing it writes back over the plugin's rows rather than beside them.
      await saveDoctorSessionWeek({
        doctorId: LEGACY_DOCTOR, timeSlot: 30,
        days: [{ day: 'mon', enabled: true, mainSession: { start: '10:00', end: '16:00' }, breaks: [] }],
      } as any, kcWeekAdmin);

      const after = await getDoctorSessionWeek(LEGACY_DOCTOR, WEEK_CLINIC, weekScope);
      expect(after.days.find((d) => d.day === 'mon')!.mainSession).toEqual({ start: '10:00', end: '16:00' });
      expect(after.days.filter((d) => d.enabled)).toHaveLength(1);
      const left = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM wp_kc_clinic_sessions WHERE clinic_id = ? AND doctor_id = ?`,
        WEEK_CLINIC, LEGACY_DOCTOR,
      );
      expect(Number(left[0].n)).toBe(1);   // the three legacy rows are gone, not orphaned
    });

    it('rejects a single session that overlaps one already stored, and allows an adjacent one', async () => {
      const first = await createDoctorSession(
        { doctorId: WEEK_DOCTOR, day: 'tue', startTime: '09:00:00', endTime: '12:00:00', timeSlot: 30 },
        kcWeekAdmin,
      );
      await expect(createDoctorSession(
        { doctorId: WEEK_DOCTOR, day: 'tue', startTime: '11:00:00', endTime: '13:00:00', timeSlot: 30 },
        kcWeekAdmin,
      )).rejects.toThrow(/overlaps/i);

      const adjacent = await createDoctorSession(
        { doctorId: WEEK_DOCTOR, day: 'tue', startTime: '12:00:00', endTime: '15:00:00', timeSlot: 30 },
        kcWeekAdmin,
      );
      expect(adjacent.id).toBeGreaterThan(0);

      // moving the second window back over the first is rejected too
      await expect(updateDoctorSession(adjacent.id, { startTime: '10:00:00' }, weekScope)).rejects.toThrow(/overlaps/i);

      await deleteDoctorSession(first.id, weekScope);
      await deleteDoctorSession(adjacent.id, weekScope);
    });
  });
});
