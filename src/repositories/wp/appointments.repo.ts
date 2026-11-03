/**
 * Appointment reads, straight from KiviCare's `wp_kc_appointments`.
 *
 * Our schema carries TWO shadow copies of this table — `appointments` and
 * `sessions_booking` — and neither should exist. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer so
 * KiviCare's hooks (notifications, Google Calendar sync, telemed) still fire (D1).
 * That matters most here: appointment creation is the hook-heaviest operation in
 * KiviCare, which is exactly why direct SQL writes were rejected.
 */
import { prisma } from '@/lib/db';
import { paginate } from './wp-user';

/**
 * Verified against KCAppointment.php:41-45 — not assumed.
 *
 * The ordinals are counter-intuitive: 0 is CANCELLED, not "inactive-as-in-1". An
 * earlier port assumed 1 = CANCELLED, so cancelling an appointment wrote BOOKED and
 * left the slot blocked permanently.
 */
export const APPOINTMENT_STATUS = {
  CANCELLED: 0,
  BOOKED: 1,
  PENDING: 2,
  CHECK_OUT: 3,
  CHECK_IN: 4,
} as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

/**
 * States that occupy a slot. KCAppointment.php:493 uses exactly
 * [BOOKED, PENDING, CHECK_IN]; CHECK_OUT (3) is a completed visit and does not block.
 */
export const ACTIVE_STATUSES: readonly number[] = [
  APPOINTMENT_STATUS.BOOKED,
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.CHECK_IN,
];

export type WpAppointment = {
  id: bigint;
  clinicId: bigint;
  doctorId: bigint;
  patientId: bigint;
  /** Local calendar date, `YYYY-MM-DD`. This is what KiviCare filters on. */
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  /** Derived UTC instants. Nullable — backfilled by KiviCare's UTC migration. */
  startUtc: Date | null;
  endUtc: Date | null;
  timezone: string;
  visitType: string | null;
  description: string | null;
  status: number;
  isCancelled: boolean;
  isActive: boolean;
  createdAt: Date;
};

export type ListAppointmentsQuery = {
  page: number;
  perPage: number;
  clinicId?: bigint;
  doctorId?: bigint;
  patientId?: bigint;
  /** Exact local date, `YYYY-MM-DD`. */
  date?: string;
  /** Inclusive local date range, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  statuses?: readonly number[];
};

export type PaginatedAppointments = {
  items: WpAppointment[];
  total: number;
  page: number;
  perPage: number;
};

const SELECT = {
  id: true,
  clinicId: true,
  doctorId: true,
  patientId: true,
  appointmentStartDate: true,
  appointmentStartTime: true,
  appointmentEndDate: true,
  appointmentEndTime: true,
  appointmentStartUtc: true,
  appointmentEndUtc: true,
  appointmentTimezone: true,
  visitType: true,
  description: true,
  status: true,
  createdAt: true,
} as const;

type AppointmentRow = {
  id: bigint;
  clinicId: bigint;
  doctorId: bigint;
  patientId: bigint;
  appointmentStartDate: Date | null;
  appointmentStartTime: Date;
  appointmentEndDate: Date | null;
  appointmentEndTime: Date | null;
  appointmentStartUtc: Date | null;
  appointmentEndUtc: Date | null;
  appointmentTimezone: string;
  visitType: string | null;
  description: string | null;
  status: number;
  createdAt: Date;
};

/**
 * `@db.Date` and `@db.Time` both round-trip as JS Dates — the date at midnight UTC,
 * the time on the epoch day. Format off the UTC parts so a non-UTC server timezone
 * cannot shift the calendar date.
 */
function toDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toTimeString(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 19) : null;
}

function toAppointment(row: AppointmentRow): WpAppointment {
  return {
    id: row.id,
    clinicId: row.clinicId,
    doctorId: row.doctorId,
    patientId: row.patientId,
    startDate: toDateString(row.appointmentStartDate),
    startTime: toTimeString(row.appointmentStartTime),
    endDate: toDateString(row.appointmentEndDate),
    endTime: toTimeString(row.appointmentEndTime),
    startUtc: row.appointmentStartUtc,
    endUtc: row.appointmentEndUtc,
    timezone: row.appointmentTimezone,
    visitType: row.visitType,
    description: row.description,
    status: row.status,
    isCancelled: row.status === APPOINTMENT_STATUS.CANCELLED,
    isActive: ACTIVE_STATUSES.includes(row.status),
    createdAt: row.createdAt,
  };
}

/** `YYYY-MM-DD` → the Date value stored in a `@db.Date` column. */
function dateArg(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T00:00:00Z`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

/**
 * Time comparisons are bound as `'HH:MM:SS'` strings, never as JS Dates.
 *
 * Binding a Date to a TIME column comparison is silently wrong: the driver sends a
 * full datetime, and MySQL promotes the TIME column to a datetime using the CURRENT
 * date to compare. So a stored `09:00:00` becomes `<today> 09:00:00`, which is never
 * `< 1970-01-01 10:30:00` — every overlap check returns "no conflict" and every slot
 * looks free. It reads as working because a time-only filter can still match; the
 * bug only appears once a date predicate is present.
 */
function assertDate(value: string): string {
  if (!DATE_RE.test(value)) throw new Error(`Expected YYYY-MM-DD, got ${JSON.stringify(value)}`);
  return value;
}

function assertTime(value: string): string {
  if (!TIME_RE.test(value)) throw new Error(`Expected HH:MM:SS, got ${JSON.stringify(value)}`);
  return value;
}

function buildWhere(query: ListAppointmentsQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (query.clinicId !== undefined) where.clinicId = query.clinicId;
  if (query.doctorId !== undefined) where.doctorId = query.doctorId;
  if (query.patientId !== undefined) where.patientId = query.patientId;
  if (query.statuses && query.statuses.length > 0) where.status = { in: [...query.statuses] };

  if (query.date) {
    where.appointmentStartDate = dateArg(query.date);
  } else if (query.dateFrom || query.dateTo) {
    const range: Record<string, Date> = {};
    if (query.dateFrom) range.gte = dateArg(query.dateFrom);
    if (query.dateTo) range.lte = dateArg(query.dateTo);
    where.appointmentStartDate = range;
  }

  return where;
}

export async function findAppointmentById(id: bigint): Promise<WpAppointment | null> {
  const row = await prisma.kcAppointment.findUnique({ where: { id }, select: SELECT });
  return row ? toAppointment(row as AppointmentRow) : null;
}

/** Of `ids`, the appointments that belong to `clinicId`. Ids that do not exist are absent. */
export async function appointmentIdsInClinic(ids: number[], clinicId: bigint): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.kcAppointment.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) }, clinicId },
    select: { id: true },
  });
  return new Set(rows.map((r) => Number(r.id)));
}

export async function listAppointments(
  query: ListAppointmentsQuery,
): Promise<PaginatedAppointments> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);
  const where = buildWhere(query);

  const [rows, total] = await Promise.all([
    prisma.kcAppointment.findMany({
      where,
      select: SELECT,
      orderBy: [{ appointmentStartDate: 'asc' }, { appointmentStartTime: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: perPage,
    }),
    prisma.kcAppointment.count({ where }),
  ]);

  return { items: (rows as AppointmentRow[]).map(toAppointment), total, page, perPage };
}

/**
 * Active appointments for a doctor that overlap the given local time window.
 *
 * Overlap is half-open: an appointment ending exactly when the new one starts does
 * not conflict, so back-to-back slots are bookable. Cancelled and checked-out
 * appointments never block.
 *
 * Pass `excludeAppointmentId` when rescheduling, so an appointment doesn't collide
 * with itself.
 */
export async function findConflictingAppointments(opts: {
  doctorId: bigint;
  date: string;
  startTime: string;
  endTime: string;
  excludeAppointmentId?: bigint;
}): Promise<WpAppointment[]> {
  const date = assertDate(opts.date);
  const start = assertTime(opts.startTime);
  const end = assertTime(opts.endTime);

  // Raw SQL, not the query builder: Prisma serialises a `@db.Time` filter as a
  // datetime, which breaks TIME comparisons (see assertTime above). Times are bound
  // as strings so MySQL compares TIME to TIME.
  const statusPlaceholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const excludeSql = opts.excludeAppointmentId !== undefined ? 'AND id <> ?' : '';

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, clinic_id, doctor_id, patient_id,
            appointment_start_date, appointment_start_time,
            appointment_end_date, appointment_end_time,
            appointment_start_utc, appointment_end_utc,
            appointment_timezone, visit_type, description, status, created_at
       FROM wp_kc_appointments
      WHERE doctor_id = ?
        AND appointment_start_date = ?
        AND status IN (${statusPlaceholders})
        -- half-open overlap: back-to-back slots do not conflict
        AND appointment_start_time < ?
        AND appointment_end_time   > ?
        ${excludeSql}
      ORDER BY appointment_start_time ASC`,
    opts.doctorId,
    date,
    ...ACTIVE_STATUSES,
    end,
    start,
    ...(opts.excludeAppointmentId !== undefined ? [opts.excludeAppointmentId] : []),
  );

  return rows.map((r) =>
    toAppointment({
      id: r.id as bigint,
      clinicId: r.clinic_id as bigint,
      doctorId: r.doctor_id as bigint,
      patientId: r.patient_id as bigint,
      appointmentStartDate: r.appointment_start_date as Date | null,
      appointmentStartTime: r.appointment_start_time as Date,
      appointmentEndDate: r.appointment_end_date as Date | null,
      appointmentEndTime: r.appointment_end_time as Date | null,
      appointmentStartUtc: r.appointment_start_utc as Date | null,
      appointmentEndUtc: r.appointment_end_utc as Date | null,
      appointmentTimezone: r.appointment_timezone as string,
      visitType: r.visit_type as string | null,
      description: r.description as string | null,
      status: Number(r.status),
      createdAt: r.created_at as Date,
    }),
  );
}

/** One side of an overlapping pair. Times are local `HH:MM:SS` on the pair's date. */
export type OverlapSide = {
  id: number;
  clinicId: number;
  status: number;
  startTime: string;
  endTime: string;
};

/** Two active appointments of one doctor whose times overlap on one date; `low.id < high.id`. */
export type OverlapPair = {
  doctorId: number;
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  /** `appointment_timezone` of the low side; empty when KiviCare left it NULL. */
  timezone: string;
  low: OverlapSide;
  high: OverlapSide;
};

/**
 * Every pair of ACTIVE appointments of one doctor that overlap on the same local date, from
 * `fromDate` on. This is the after-the-fact check for writers that bypass the plugin's
 * per-doctor schedule lock (KiviCare's WP admin, KiviCare Pro's inbound Google Calendar
 * reschedule, CSV import) — docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md.
 *
 * The predicate is Schedule_Write::assertFree's, column for column: same doctor, same
 * appointment_start_date, half-open time overlap. Change one, change the other.
 *
 * Nothing time-valued is bound — only the date string and the statuses — so the TIME-vs-Date
 * trap described at assertTime cannot apply. Dates and times come back as strings from
 * DATE_FORMAT/TIME_FORMAT rather than as Prisma Dates.
 */
export async function findOverlappingAppointmentPairs(fromDate: string): Promise<OverlapPair[]> {
  const from = assertDate(fromDate);
  const statuses = ACTIVE_STATUSES.map(() => '?').join(',');

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT a.id AS low_id, b.id AS high_id, a.doctor_id,
            DATE_FORMAT(a.appointment_start_date, '%Y-%m-%d') AS date,
            a.appointment_timezone AS timezone,
            a.clinic_id AS low_clinic_id, a.status AS low_status,
            TIME_FORMAT(a.appointment_start_time, '%H:%i:%s') AS low_start,
            TIME_FORMAT(a.appointment_end_time,   '%H:%i:%s') AS low_end,
            b.clinic_id AS high_clinic_id, b.status AS high_status,
            TIME_FORMAT(b.appointment_start_time, '%H:%i:%s') AS high_start,
            TIME_FORMAT(b.appointment_end_time,   '%H:%i:%s') AS high_end
       FROM wp_kc_appointments a
       JOIN wp_kc_appointments b
         ON b.doctor_id = a.doctor_id
        AND b.appointment_start_date = a.appointment_start_date
        AND b.id > a.id
        -- half-open overlap: back-to-back slots do not conflict
        AND b.appointment_start_time < a.appointment_end_time
        AND b.appointment_end_time   > a.appointment_start_time
      WHERE a.doctor_id > 0
        AND a.status IN (${statuses})
        AND b.status IN (${statuses})
        AND a.appointment_start_date >= ?
      ORDER BY a.appointment_start_date, a.appointment_start_time, a.id, b.id`,
    ...ACTIVE_STATUSES,
    ...ACTIVE_STATUSES,
    from,
  );

  return rows.map((r) => ({
    doctorId: Number(r.doctor_id),
    date: String(r.date),
    timezone: (r.timezone as string | null) ?? '',
    low: {
      id: Number(r.low_id),
      clinicId: Number(r.low_clinic_id),
      status: Number(r.low_status),
      startTime: String(r.low_start),
      endTime: String(r.low_end),
    },
    high: {
      id: Number(r.high_id),
      clinicId: Number(r.high_clinic_id),
      status: Number(r.high_status),
      startTime: String(r.high_start),
      endTime: String(r.high_end),
    },
  }));
}
