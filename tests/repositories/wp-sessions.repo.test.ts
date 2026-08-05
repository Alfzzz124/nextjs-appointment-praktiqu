/**
 * Contract tests for the session domain view over `wp_kc_appointments`.
 *
 * Replaces the `sessions_booking` and `appointments` shadow tables. The status mapping
 * is the risky part: we had seven statuses against KiviCare's five, and the two extras
 * were folded in (COMPLETED → CHECK_OUT, REJECTED → CANCELLED).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import {
  SESSION_STATUS,
  canTransition,
  findSessionById,
  fromKcStatus,
  listSessions,
  normaliseStatus,
  setSessionStatusDirect,
  toKcStatus,
} from '@/repositories/wp/sessions.repo';

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 8_000_000;
const END = BASE + 100_000;

const CLINIC = BASE + 10;
const DOCTOR = BASE + 20;
const CLIENT = BASE + 30;

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedUser(id: number, role: string, first: string, last: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `${id}@sessions.test.local`,
      displayName: `${first} ${last}`,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: last },
    ],
  });
}

async function seedAppointment(opts: {
  id: number;
  status: number;
  date: string;
  start: string;
  end: string;
  visitType?: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Jakarta', ?, 'Sesi uji', ?, NOW())`,
    opts.id, CLINIC, DOCTOR, CLIENT, opts.date, opts.start, opts.date, opts.end,
    opts.visitType ?? '101,102', opts.status,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

describe('wp sessions repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await wipe();
    await seedUser(DOCTOR, 'kiviCare_doctor', 'Dokter', 'Satu');
    await seedUser(CLIENT, 'kiviCare_patient', 'Pasien', 'Dua');

    await seedAppointment({ id: BASE + 1, status: APPOINTMENT_STATUS.BOOKED, date: '2026-10-05', start: '09:00:00', end: '10:00:00' });
    await seedAppointment({ id: BASE + 2, status: APPOINTMENT_STATUS.PENDING, date: '2026-10-05', start: '11:00:00', end: '12:00:00' });
    await seedAppointment({ id: BASE + 3, status: APPOINTMENT_STATUS.CANCELLED, date: '2026-10-06', start: '09:00:00', end: '10:00:00' });
    await seedAppointment({ id: BASE + 4, status: APPOINTMENT_STATUS.CHECK_OUT, date: '2026-10-07', start: '09:00:00', end: '10:00:00' });
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  describe('status mapping', () => {
    it('round-trips every status through KiviCare’s integers', () => {
      for (const s of Object.values(SESSION_STATUS)) {
        expect(fromKcStatus(toKcStatus(s))).toBe(s);
      }
    });

    it('pins the ordinals', () => {
      expect(toKcStatus(SESSION_STATUS.CANCELLED)).toBe(0);
      expect(toKcStatus(SESSION_STATUS.BOOKED)).toBe(1);
      expect(toKcStatus(SESSION_STATUS.PENDING)).toBe(2);
      expect(toKcStatus(SESSION_STATUS.CHECK_OUT)).toBe(3);
      expect(toKcStatus(SESSION_STATUS.CHECK_IN)).toBe(4);
    });

    it('folds the two retired statuses onto their replacements', () => {
      expect(normaliseStatus('COMPLETED')).toBe(SESSION_STATUS.CHECK_OUT);
      expect(normaliseStatus('REJECTED')).toBe(SESSION_STATUS.CANCELLED);
      expect(normaliseStatus('booked')).toBe(SESSION_STATUS.BOOKED);
      expect(normaliseStatus('NONSENSE')).toBeNull();
    });

    it('treats an unknown integer as CANCELLED, not BOOKED', () => {
      // Defaulting the other way would let an unrecognised row occupy a slot.
      expect(fromKcStatus(99)).toBe(SESSION_STATUS.CANCELLED);
    });

    it('makes CHECK_OUT terminal now that COMPLETED is gone', () => {
      expect(canTransition(SESSION_STATUS.CHECK_IN, SESSION_STATUS.CHECK_OUT)).toBe(true);
      expect(canTransition(SESSION_STATUS.CHECK_OUT, SESSION_STATUS.CANCELLED)).toBe(false);
      expect(canTransition(SESSION_STATUS.PENDING, SESSION_STATUS.CANCELLED)).toBe(true);
      expect(canTransition(SESSION_STATUS.CANCELLED, SESSION_STATUS.BOOKED)).toBe(false);
    });
  });

  describe('reads', () => {
    it('reads a session with participant names resolved from wp_users', async () => {
      const s = await findSessionById(BASE + 1);

      expect(s).not.toBeNull();
      expect(s!.professionalName).toBe('Dokter Satu');
      expect(s!.clientName).toBe('Pasien Dua');
      expect(s!.clientEmail).toBe(`${CLIENT}@sessions.test.local`);
      expect(s!.status).toBe(SESSION_STATUS.BOOKED);
      expect(s!.slotDate).toBe('2026-10-05');
      expect(s!.startTime).toBe('09:00:00');
    });

    it('parses the comma-joined service ids out of visit_type', async () => {
      const s = await findSessionById(BASE + 1);
      expect(s!.serviceIds).toEqual([101, 102]);
    });

    it('returns no service ids when visit_type is not a list', async () => {
      await seedAppointment({
        id: BASE + 9, status: APPOINTMENT_STATUS.BOOKED,
        date: '2026-10-09', start: '09:00:00', end: '10:00:00', visitType: 'in_clinic',
      });
      const s = await findSessionById(BASE + 9);
      expect(s!.serviceIds).toEqual([]);
    });

    it('returns null for an unknown id', async () => {
      expect(await findSessionById(BASE + 999)).toBeNull();
    });

    it('filters by date and reports a page-independent total', async () => {
      const { items, total } = await listSessions({
        page: 1, perPage: 50, professionalId: DOCTOR, date: '2026-10-05',
      });

      expect(items.map((s) => s.id).sort()).toEqual([BASE + 1, BASE + 2]);
      expect(total).toBe(2);
    });

    it('filters by status set', async () => {
      const { items } = await listSessions({
        page: 1, perPage: 50, professionalId: DOCTOR, statuses: [SESSION_STATUS.CANCELLED],
      });
      expect(items.map((s) => s.id)).toEqual([BASE + 3]);
    });

    it('returns nothing — not everything — for an empty status filter', async () => {
      const { items, total } = await listSessions({
        page: 1, perPage: 50, professionalId: DOCTOR, statuses: [],
      });
      expect(items).toEqual([]);
      expect(total).toBe(0);
    });

    it('filters by an inclusive date range', async () => {
      const { items } = await listSessions({
        page: 1, perPage: 50, professionalId: DOCTOR,
        dateFrom: '2026-10-06', dateTo: '2026-10-07',
      });
      expect(items.map((s) => s.id)).toEqual([BASE + 3, BASE + 4]);
    });

    it('rejects a malformed date rather than matching nothing silently', async () => {
      await expect(
        listSessions({ page: 1, perPage: 10, date: '05-10-2026' }),
      ).rejects.toThrow(/YYYY-MM-DD/);
    });
  });

  describe('writes', () => {
    it('sets status directly', async () => {
      expect(await setSessionStatusDirect(BASE + 2, SESSION_STATUS.BOOKED)).toBe(true);
      expect((await findSessionById(BASE + 2))!.status).toBe(SESSION_STATUS.BOOKED);

      await setSessionStatusDirect(BASE + 2, SESSION_STATUS.PENDING);
    });

    it('reports false for an id that does not exist', async () => {
      expect(await setSessionStatusDirect(BASE + 999, SESSION_STATUS.CANCELLED)).toBe(false);
    });
  });
});
