/**
 * Contract tests for the WordPress appointment read repository.
 *
 * Appointments live in `wp_kc_appointments`. Our schema has TWO shadow copies of this
 * — `appointments` and `sessions_booking` — and neither should exist. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * Status ordinals are verified against KCAppointment.php:41-45, not assumed:
 * CANCELLED=0, BOOKED=1, PENDING=2, CHECK_OUT=3, CHECK_IN=4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  ACTIVE_STATUSES,
  APPOINTMENT_STATUS,
  findAppointmentById,
  findConflictingAppointments,
  listAppointments,
} from '@/repositories/wp/appointments.repo';

/** Test-owned range. Cleanup is bounded by END — see the note in wp-patients.repo.test.ts. */
const BASE = 9_700_000;
const END = BASE + 100_000;

const CLINIC = BigInt(BASE + 10);
const DOCTOR = BigInt(BASE + 20);
const PATIENT = BigInt(BASE + 30);

/** `@db.Time` columns round-trip as a Date on the epoch day. */
function time(hhmmss: string): Date {
  return new Date(`1970-01-01T${hhmmss}Z`);
}

function day(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T00:00:00Z`);
}

async function seedAppointment(opts: {
  id: number;
  status: number;
  date: string;
  start: string;
  end: string;
  doctorId?: bigint;
  patientId?: bigint;
  visitType?: string;
}) {
  await prisma.kcAppointment.create({
    data: {
      id: BigInt(opts.id),
      clinicId: CLINIC,
      doctorId: opts.doctorId ?? DOCTOR,
      patientId: opts.patientId ?? PATIENT,
      appointmentStartDate: day(opts.date),
      appointmentStartTime: time(opts.start),
      appointmentEndDate: day(opts.date),
      appointmentEndTime: time(opts.end),
      appointmentTimezone: 'Asia/Jakarta',
      visitType: opts.visitType ?? 'in_clinic',
      status: opts.status,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    } as never,
  });
}

describe('wp appointments repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcAppointment.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

    await seedAppointment({ id: BASE + 1, status: APPOINTMENT_STATUS.BOOKED, date: '2026-08-03', start: '09:00:00', end: '10:00:00' });
    await seedAppointment({ id: BASE + 2, status: APPOINTMENT_STATUS.PENDING, date: '2026-08-03', start: '11:00:00', end: '12:00:00' });
    await seedAppointment({ id: BASE + 3, status: APPOINTMENT_STATUS.CANCELLED, date: '2026-08-03', start: '13:00:00', end: '14:00:00' });
    await seedAppointment({ id: BASE + 4, status: APPOINTMENT_STATUS.CHECK_OUT, date: '2026-08-04', start: '09:00:00', end: '10:00:00' });
    // Different doctor, same slot as BASE+1 — must not count as a conflict.
    await seedAppointment({
      id: BASE + 5, status: APPOINTMENT_STATUS.BOOKED, date: '2026-08-03',
      start: '09:00:00', end: '10:00:00', doctorId: BigInt(BASE + 21),
    });
  });

  afterAll(async () => {
    await prisma.kcAppointment.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.$disconnect();
  });

  it('pins the status ordinals KiviCare uses', () => {
    // Regression guard: a previous port assumed 1 = CANCELLED and cancelling an
    // appointment marked it BOOKED, blocking the slot forever.
    expect(APPOINTMENT_STATUS.CANCELLED).toBe(0);
    expect(APPOINTMENT_STATUS.BOOKED).toBe(1);
    expect(APPOINTMENT_STATUS.PENDING).toBe(2);
    expect(APPOINTMENT_STATUS.CHECK_OUT).toBe(3);
    expect(APPOINTMENT_STATUS.CHECK_IN).toBe(4);
    // KCAppointment.php:493 — active/slot-blocking states.
    expect([...ACTIVE_STATUSES].sort()).toEqual([1, 2, 4]);
  });

  it('reads an appointment from wp_kc_appointments', async () => {
    const appt = await findAppointmentById(BigInt(BASE + 1));

    expect(appt).not.toBeNull();
    expect(appt!.clinicId).toBe(CLINIC);
    expect(appt!.doctorId).toBe(DOCTOR);
    expect(appt!.patientId).toBe(PATIENT);
    expect(appt!.status).toBe(APPOINTMENT_STATUS.BOOKED);
    expect(appt!.timezone).toBe('Asia/Jakarta');
  });

  it('exposes local date and time as plain strings', async () => {
    const appt = await findAppointmentById(BigInt(BASE + 1));

    expect(appt!.startDate).toBe('2026-08-03');
    expect(appt!.startTime).toBe('09:00:00');
    expect(appt!.endTime).toBe('10:00:00');
  });

  it('reports cancelled and active states', async () => {
    const cancelled = await findAppointmentById(BigInt(BASE + 3));
    expect(cancelled!.isCancelled).toBe(true);
    expect(cancelled!.isActive).toBe(false);

    const booked = await findAppointmentById(BigInt(BASE + 1));
    expect(booked!.isCancelled).toBe(false);
    expect(booked!.isActive).toBe(true);
  });

  it('returns null for an unknown appointment', async () => {
    expect(await findAppointmentById(BigInt(BASE + 999))).toBeNull();
  });

  it('filters by doctor and date', async () => {
    const { items } = await listAppointments({
      page: 1, perPage: 50, doctorId: DOCTOR, date: '2026-08-03',
    });

    expect(items.map((a) => Number(a.id)).sort()).toEqual([BASE + 1, BASE + 2, BASE + 3]);
  });

  it('filters by status set', async () => {
    const { items } = await listAppointments({
      page: 1, perPage: 50, doctorId: DOCTOR, statuses: [APPOINTMENT_STATUS.CANCELLED],
    });

    expect(items.map((a) => Number(a.id))).toEqual([BASE + 3]);
  });

  it('filters by an inclusive date range', async () => {
    const { items } = await listAppointments({
      page: 1, perPage: 50, doctorId: DOCTOR,
      dateFrom: '2026-08-04', dateTo: '2026-08-04',
    });

    expect(items.map((a) => Number(a.id))).toEqual([BASE + 4]);
  });

  it('reports a total independent of the current page', async () => {
    const firstPage = await listAppointments({ page: 1, perPage: 1, doctorId: DOCTOR });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(4);
  });

  describe('conflict detection', () => {
    it('finds an overlapping active appointment for the same doctor', async () => {
      const conflicts = await findConflictingAppointments({
        doctorId: DOCTOR, date: '2026-08-03', startTime: '09:30:00', endTime: '10:30:00',
      });

      expect(conflicts.map((a) => Number(a.id))).toEqual([BASE + 1]);
    });

    it('ignores cancelled appointments when detecting conflicts', async () => {
      // BASE+3 is CANCELLED and occupies 13:00-14:00.
      const conflicts = await findConflictingAppointments({
        doctorId: DOCTOR, date: '2026-08-03', startTime: '13:00:00', endTime: '14:00:00',
      });

      expect(conflicts).toEqual([]);
    });

    it('does not treat another doctor’s appointment as a conflict', async () => {
      const conflicts = await findConflictingAppointments({
        doctorId: BigInt(BASE + 22), date: '2026-08-03', startTime: '09:00:00', endTime: '10:00:00',
      });

      expect(conflicts).toEqual([]);
    });

    it('treats back-to-back appointments as non-overlapping', async () => {
      // BASE+1 ends at 10:00; a slot starting exactly at 10:00 is fine.
      const conflicts = await findConflictingAppointments({
        doctorId: DOCTOR, date: '2026-08-03', startTime: '10:00:00', endTime: '11:00:00',
      });

      expect(conflicts).toEqual([]);
    });

    it('can exclude an appointment being rescheduled', async () => {
      const conflicts = await findConflictingAppointments({
        doctorId: DOCTOR, date: '2026-08-03', startTime: '09:00:00', endTime: '10:00:00',
        excludeAppointmentId: BigInt(BASE + 1),
      });

      expect(conflicts).toEqual([]);
    });
  });
});
