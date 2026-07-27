/**
 * Doctor availability, straight from KiviCare's `wp_kc_clinic_sessions`.
 *
 * Our schema duplicates this three times over — `professional_availability`,
 * `doctor_sessions` and `clinic_sessions`. None should exist. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * A doctor's week is a set of rows keyed by a day slug; a day split into morning and
 * afternoon is simply two rows for that day. `time_slot` is the appointment
 * granularity in minutes.
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer (D1).
 */
import { prisma } from '@/lib/db';

/** The slugs KiviCare writes into `wp_kc_clinic_sessions.day`. */
export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export type WpClinicSession = {
  id: bigint;
  clinicId: bigint;
  doctorId: bigint | null;
  day: string | null;
  /** `HH:MM:SS`. */
  startTime: string | null;
  endTime: string | null;
  /** Appointment granularity in minutes (`time_slot`). */
  slotDurationMinutes: number;
  /** Groups the rows created together for one doctor/clinic schedule. */
  parentId: bigint | null;
  createdAt: Date;
};

/** Every day is present, so callers can iterate without existence checks. */
export type WeeklyAvailability = Record<DayOfWeek, WpClinicSession[]>;

const SELECT = {
  id: true,
  clinicId: true,
  doctorId: true,
  day: true,
  startTime: true,
  endTime: true,
  slotDuration: true,
  parentId: true,
  createdAt: true,
} as const;

type SessionRow = {
  id: bigint;
  clinicId: bigint;
  doctorId: bigint | null;
  day: string | null;
  startTime: Date;
  endTime: Date;
  slotDuration: number;
  parentId: bigint | null;
  createdAt: Date;
};

/**
 * `@db.Time` round-trips as a Date on the epoch day. Format off the UTC parts so a
 * non-UTC server timezone cannot shift the value.
 *
 * NOTE: reading TIME columns is safe; *filtering* on them via the Prisma query builder
 * is not — see the warning in appointments.repo.ts. This module only filters on `day`.
 */
function toTimeString(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 19) : null;
}

function toSession(row: SessionRow): WpClinicSession {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    day: row.day,
    startTime: toTimeString(row.startTime),
    endTime: toTimeString(row.endTime),
    slotDurationMinutes: row.slotDuration,
    parentId: row.parentId,
    createdAt: row.createdAt,
  };
}

function isDayOfWeek(value: string): value is DayOfWeek {
  return (DAYS_OF_WEEK as readonly string[]).includes(value);
}

/**
 * Reject an unknown day slug rather than returning an empty list. "monday" or
 * "Mon" would otherwise look like "this doctor never works", which is
 * indistinguishable from a genuine gap in availability.
 */
function assertDay(value: string): DayOfWeek {
  if (!isDayOfWeek(value)) {
    throw new Error(
      `Unknown day ${JSON.stringify(value)} — expected one of ${DAYS_OF_WEEK.join(', ')}`,
    );
  }
  return value;
}

export async function listClinicSessions(query: {
  clinicId?: bigint;
  doctorId?: bigint;
  day?: string;
}): Promise<WpClinicSession[]> {
  const where: Record<string, unknown> = {};
  if (query.clinicId !== undefined) where.clinicId = query.clinicId;
  if (query.doctorId !== undefined) where.doctorId = query.doctorId;
  if (query.day !== undefined) where.day = assertDay(query.day);

  const rows = await prisma.kcClinicSession.findMany({
    where,
    select: SELECT,
    orderBy: [{ day: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
  });

  return (rows as SessionRow[]).map(toSession);
}

/**
 * A doctor's whole week at one clinic, grouped by day.
 *
 * Days are ordered mon→sun (not the alphabetical order the DB returns), and sessions
 * within a day by start time, so a split morning/afternoon schedule reads correctly.
 */
export async function getWeeklyAvailability(query: {
  clinicId: bigint;
  doctorId: bigint;
}): Promise<WeeklyAvailability> {
  const sessions = await listClinicSessions(query);

  const week = Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, [] as WpClinicSession[]])) as WeeklyAvailability;

  for (const session of sessions) {
    const day = session.day;
    if (day && isDayOfWeek(day)) week[day].push(session);
    // Rows with a null or unrecognised day are skipped: they cannot be placed on a
    // calendar, and silently bucketing them into a real day would fabricate hours.
  }

  for (const day of DAYS_OF_WEEK) {
    week[day].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  }

  return week;
}
