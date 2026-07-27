/**
 * Contract tests for the WordPress clinic-session (availability) repository.
 *
 * A doctor's working hours live in `wp_kc_clinic_sessions`. Our schema duplicates this
 * three times over — `professional_availability`, `doctor_sessions` and
 * `clinic_sessions`. See docs/architecture/shadow-tables-audit.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  DAYS_OF_WEEK,
  getWeeklyAvailability,
  listClinicSessions,
} from '@/repositories/wp/clinic-sessions.repo';

/** Test-owned range. Cleanup is bounded by END — see the note in wp-patients.repo.test.ts. */
const BASE = 9_800_000;
const END = BASE + 100_000;

const CLINIC = BigInt(BASE + 10);
const DOCTOR = BigInt(BASE + 20);
const OTHER_DOCTOR = BigInt(BASE + 21);

function time(hhmmss: string): Date {
  return new Date(`1970-01-01T${hhmmss}Z`);
}

async function seedSession(opts: {
  id: number;
  day: string;
  start: string;
  end: string;
  doctorId?: bigint;
  slotDuration?: number;
  parentId?: bigint;
}) {
  await prisma.kcClinicSession.create({
    data: {
      id: BigInt(opts.id),
      clinicId: CLINIC,
      doctorId: opts.doctorId ?? DOCTOR,
      day: opts.day,
      startTime: time(opts.start),
      endTime: time(opts.end),
      slotDuration: opts.slotDuration ?? 30,
      parentId: opts.parentId ?? null,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    } as never,
  });
}

describe('wp clinic sessions repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcClinicSession.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

    // Monday split into morning and afternoon — KiviCare stores these as two rows.
    await seedSession({ id: BASE + 1, day: 'mon', start: '09:00:00', end: '12:00:00' });
    await seedSession({ id: BASE + 2, day: 'mon', start: '14:00:00', end: '17:00:00', parentId: BigInt(BASE + 1) });
    await seedSession({ id: BASE + 3, day: 'wed', start: '09:00:00', end: '15:00:00', slotDuration: 60 });
    // Another doctor at the same clinic.
    await seedSession({ id: BASE + 4, day: 'mon', start: '08:00:00', end: '10:00:00', doctorId: OTHER_DOCTOR });
  });

  afterAll(async () => {
    await prisma.kcClinicSession.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.$disconnect();
  });

  it('uses the day slugs KiviCare writes', () => {
    expect(DAYS_OF_WEEK).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('lists a doctor’s sessions at a clinic', async () => {
    const sessions = await listClinicSessions({ clinicId: CLINIC, doctorId: DOCTOR });

    expect(sessions.map((s) => Number(s.id))).toEqual([BASE + 1, BASE + 2, BASE + 3]);
  });

  it('exposes times as plain HH:MM:SS strings', async () => {
    const [first] = await listClinicSessions({ clinicId: CLINIC, doctorId: DOCTOR, day: 'mon' });

    expect(first.startTime).toBe('09:00:00');
    expect(first.endTime).toBe('12:00:00');
    expect(first.slotDurationMinutes).toBe(30);
  });

  it('filters by day', async () => {
    const wed = await listClinicSessions({ clinicId: CLINIC, doctorId: DOCTOR, day: 'wed' });

    expect(wed.map((s) => Number(s.id))).toEqual([BASE + 3]);
    expect(wed[0].slotDurationMinutes).toBe(60);
  });

  it('does not leak another doctor’s sessions', async () => {
    const sessions = await listClinicSessions({ clinicId: CLINIC, doctorId: DOCTOR });

    expect(sessions.map((s) => Number(s.id))).not.toContain(BASE + 4);
  });

  it('rejects an invalid day slug rather than silently returning nothing', async () => {
    await expect(
      listClinicSessions({ clinicId: CLINIC, doctorId: DOCTOR, day: 'monday' }),
    ).rejects.toThrow(/day/i);
  });

  describe('weekly availability', () => {
    it('groups sessions by day with every day present', async () => {
      const week = await getWeeklyAvailability({ clinicId: CLINIC, doctorId: DOCTOR });

      expect(Object.keys(week).sort()).toEqual([...DAYS_OF_WEEK].sort());
      expect(week.mon).toHaveLength(2);
      expect(week.wed).toHaveLength(1);
    });

    it('returns empty arrays for days with no sessions', async () => {
      const week = await getWeeklyAvailability({ clinicId: CLINIC, doctorId: DOCTOR });

      expect(week.tue).toEqual([]);
      expect(week.sun).toEqual([]);
    });

    it('orders same-day sessions by start time', async () => {
      const week = await getWeeklyAvailability({ clinicId: CLINIC, doctorId: DOCTOR });

      expect(week.mon.map((s) => s.startTime)).toEqual(['09:00:00', '14:00:00']);
    });

    it('returns all days empty for a doctor with no sessions', async () => {
      const week = await getWeeklyAvailability({
        clinicId: CLINIC,
        doctorId: BigInt(BASE + 99),
      });

      expect(Object.values(week).every((v) => v.length === 0)).toBe(true);
    });
  });
});
