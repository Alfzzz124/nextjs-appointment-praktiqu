/**
 * findOverlappingAppointmentPairs melawan database test sungguhan.
 *
 * Predikatnya harus sama persis dengan Schedule_Write::assertFree di plugin, dan hanya MySQL
 * yang bisa membuktikan perbandingan TIME-nya benar — mock hanya akan mengulang asumsiku.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';
import {
  APPOINTMENT_STATUS,
  findOverlappingAppointmentPairs,
  type OverlapPair,
} from '@/repositories/wp/appointments.repo';

const { BASE, END } = idBlock('integration/schedule/overlap-pairs.test.ts');
const CLINIC = BASE + 1;
const DOC = BASE + 20;
const DOC2 = BASE + 21;
const PATIENT = BASE + 30;

const YEAR = new Date().getUTCFullYear() + 1;
const DATE = `${YEAR}-04-14`;
const NEXT_DATE = `${YEAR}-04-15`;
const TRIPLE_DATE = `${YEAR}-04-16`;
const PAST_DATE = `${new Date().getUTCFullYear() - 1}-04-14`;

const { BOOKED, PENDING, CANCELLED, CHECK_OUT, CHECK_IN } = APPOINTMENT_STATUS;

async function appt(id: number, doctor: number, date: string, start: string, end: string, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Jakarta', '', '', ?, NOW())`,
    id, CLINIC, doctor, PATIENT, date, start, date, end, status,
  );
}

const ours = (pairs: OverlapPair[]) => pairs.filter((p) => p.low.id >= BASE && p.low.id < END);
const ids = (pairs: OverlapPair[]) => ours(pairs).map((p) => [p.low.id - BASE, p.high.id - BASE]);

async function wipe() {
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?', BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await appt(BASE + 100, DOC, DATE, '09:00:00', '10:00:00', BOOKED);
  await appt(BASE + 101, DOC, DATE, '09:30:00', '10:30:00', PENDING); // → (100, 101)
  await appt(BASE + 102, DOC, DATE, '10:30:00', '11:00:00', BOOKED); // back-to-back with 101
  await appt(BASE + 103, DOC, DATE, '09:00:00', '10:00:00', CANCELLED);
  await appt(BASE + 104, DOC, DATE, '09:15:00', '09:45:00', CHECK_OUT);
  await appt(BASE + 105, DOC2, DATE, '09:00:00', '10:00:00', BOOKED); // another psikolog
  await appt(BASE + 106, DOC, NEXT_DATE, '09:00:00', '10:00:00', BOOKED); // another date
  await appt(BASE + 110, DOC, TRIPLE_DATE, '13:00:00', '14:00:00', BOOKED);
  await appt(BASE + 111, DOC, TRIPLE_DATE, '13:30:00', '14:30:00', CHECK_IN);
  await appt(BASE + 112, DOC, TRIPLE_DATE, '13:45:00', '14:15:00', PENDING);
  await appt(BASE + 120, DOC, PAST_DATE, '09:00:00', '10:00:00', BOOKED);
  await appt(BASE + 121, DOC, PAST_DATE, '09:30:00', '10:30:00', BOOKED);
  await appt(BASE + 130, 0, DATE, '09:00:00', '10:00:00', BOOKED); // KiviCare junk: no doctor
  await appt(BASE + 131, 0, DATE, '09:30:00', '10:30:00', BOOKED);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('findOverlappingAppointmentPairs', () => {
  it('finds exactly the overlapping active pairs of one psikolog, each once, low id first', async () => {
    const pairs = await findOverlappingAppointmentPairs(`${YEAR}-01-01`);
    expect(ids(pairs)).toEqual([
      [100, 101],
      [110, 111],
      [110, 112],
      [111, 112],
    ]);
  });

  it('returns dates and times as strings, with clinic, status and zone', async () => {
    const [pair] = ours(await findOverlappingAppointmentPairs(DATE));
    expect(pair).toEqual({
      doctorId: DOC,
      date: DATE,
      timezone: 'Asia/Jakarta',
      low: { id: BASE + 100, clinicId: CLINIC, status: BOOKED, startTime: '09:00:00', endTime: '10:00:00' },
      high: { id: BASE + 101, clinicId: CLINIC, status: PENDING, startTime: '09:30:00', endTime: '10:30:00' },
    });
  });

  it('leaves out dates before fromDate', async () => {
    expect(ids(await findOverlappingAppointmentPairs(PAST_DATE))).toContainEqual([120, 121]);
    expect(ids(await findOverlappingAppointmentPairs(DATE))).not.toContainEqual([120, 121]);
  });

  it('rejects a malformed fromDate instead of binding it', async () => {
    await expect(findOverlappingAppointmentPairs('2026-1-1')).rejects.toThrow(/YYYY-MM-DD/);
  });
});
