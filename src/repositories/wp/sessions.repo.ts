/**
 * Sessions — the domain view over KiviCare's `wp_kc_appointments`.
 *
 * A "session" and an "appointment" are the same row. Our schema had TWO shadow copies
 * (`sessions_booking` and `appointments`) alongside KiviCare's own table; neither
 * should exist. See docs/architecture/shadow-tables-audit.md.
 *
 * `appointments.repo.ts` exposes the raw KiviCare shape. This module adds what the
 * session domain needs on top: the status mapping, and the participant names that come
 * from `wp_users` rather than the appointment row.
 */
import { prisma } from '@/lib/db';
import { APPOINTMENT_STATUS } from './appointments.repo';

/* ------------------------------------------------------------------ */
/* Status mapping                                                      */
/* ------------------------------------------------------------------ */

/**
 * Session statuses, now identical to KiviCare's five.
 *
 * We previously had seven. The two extras are gone, deliberately:
 *
 *  - `COMPLETED` collapsed into `CHECK_OUT`. KiviCare treats CHECK_OUT as the finished
 *    visit, so our CHECK_OUT → COMPLETED step was a second terminal state for the same
 *    thing.
 *  - `REJECTED` collapsed into `CANCELLED` (decision 2026-07-29). KiviCare has no
 *    equivalent, and rather than invent storage for the distinction we accepted the
 *    loss. The rejection *reason* is not lost — it is recorded in the audit log, which
 *    is app-native and stays.
 */
export const SESSION_STATUS = {
  CANCELLED: 'CANCELLED',
  BOOKED: 'BOOKED',
  PENDING: 'PENDING',
  CHECK_OUT: 'CHECK_OUT',
  CHECK_IN: 'CHECK_IN',
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/** Our status → KiviCare's integer. Ordinals verified against KCAppointment.php:41-45. */
const TO_KC: Record<SessionStatus, number> = {
  CANCELLED: APPOINTMENT_STATUS.CANCELLED,
  BOOKED: APPOINTMENT_STATUS.BOOKED,
  PENDING: APPOINTMENT_STATUS.PENDING,
  CHECK_OUT: APPOINTMENT_STATUS.CHECK_OUT,
  CHECK_IN: APPOINTMENT_STATUS.CHECK_IN,
};

const FROM_KC = new Map<number, SessionStatus>(
  Object.entries(TO_KC).map(([name, code]) => [code, name as SessionStatus]),
);

export function toKcStatus(status: SessionStatus): number {
  return TO_KC[status];
}

/**
 * An unrecognised integer maps to CANCELLED rather than throwing.
 *
 * A row written by a future KiviCare version must not break a listing; treating it as
 * inactive is the safe direction, because the alternative — defaulting to BOOKED —
 * would make an unknown row occupy a slot.
 */
export function fromKcStatus(code: number): SessionStatus {
  return FROM_KC.get(code) ?? SESSION_STATUS.CANCELLED;
}

/**
 * Legacy names callers may still send. Accepted at the boundary and folded onto the
 * five real statuses, so an old client does not get a 400 for a value that used to work.
 */
export function normaliseStatus(input: string): SessionStatus | null {
  const v = input.trim().toUpperCase();
  if (v === 'COMPLETED') return SESSION_STATUS.CHECK_OUT;
  if (v === 'REJECTED') return SESSION_STATUS.CANCELLED;
  return (Object.values(SESSION_STATUS) as string[]).includes(v) ? (v as SessionStatus) : null;
}

/**
 * Allowed transitions, expressed against the five statuses.
 *
 * CHECK_OUT is terminal now that COMPLETED is gone. CANCELLED is terminal and is also
 * where a rejection lands.
 */
export const VALID_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  PENDING: [SESSION_STATUS.BOOKED, SESSION_STATUS.CANCELLED],
  BOOKED: [SESSION_STATUS.CHECK_IN, SESSION_STATUS.CANCELLED],
  CHECK_IN: [SESSION_STATUS.CHECK_OUT],
  CHECK_OUT: [],
  CANCELLED: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* Domain rows                                                         */
/* ------------------------------------------------------------------ */

export type SessionRow = {
  id: number;
  clinicId: number;
  professionalId: number;
  clientId: number;
  professionalName: string;
  clientName: string;
  clientEmail: string;
  /** `YYYY-MM-DD` local clinic date — what KiviCare filters on. */
  slotDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  status: SessionStatus;
  /** Comma-joined service ids, as KiviCare stores them in `visit_type`. */
  serviceIds: number[];
  description: string | null;
  createdAt: Date;
};

type RawRow = {
  id: bigint | number;
  clinic_id: bigint | number;
  doctor_id: bigint | number;
  patient_id: bigint | number;
  appointment_start_date: Date | null;
  appointment_start_time: Date | null;
  appointment_end_time: Date | null;
  appointment_timezone: string | null;
  visit_type: string | null;
  description: string | null;
  status: number;
  created_at: Date;
  doctor_first: string | null;
  doctor_last: string | null;
  doctor_display: string | null;
  patient_first: string | null;
  patient_last: string | null;
  patient_display: string | null;
  patient_email: string | null;
};

function toDateString(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

function toTimeString(v: Date | null): string | null {
  return v ? v.toISOString().slice(11, 19) : null;
}

function name(first: string | null, last: string | null, display: string | null): string {
  const composed = [first, last].filter(Boolean).join(' ').trim();
  return composed || display || '';
}

/** `visit_type` holds the booked service ids comma-joined (AppointmentsController:3171). */
function parseServiceIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function toSession(r: RawRow): SessionRow {
  return {
    id: Number(r.id),
    clinicId: Number(r.clinic_id),
    professionalId: Number(r.doctor_id),
    clientId: Number(r.patient_id),
    professionalName: name(r.doctor_first, r.doctor_last, r.doctor_display),
    clientName: name(r.patient_first, r.patient_last, r.patient_display),
    clientEmail: r.patient_email ?? '',
    slotDate: toDateString(r.appointment_start_date),
    startTime: toTimeString(r.appointment_start_time),
    endTime: toTimeString(r.appointment_end_time),
    timezone: r.appointment_timezone ?? 'UTC',
    status: fromKcStatus(Number(r.status)),
    serviceIds: parseServiceIds(r.visit_type),
    description: r.description,
    createdAt: r.created_at,
  };
}

/**
 * Participant names need four `wp_usermeta` joins plus two `wp_users` joins.
 *
 * Done in SQL rather than a second pass so a page of sessions is one round trip; the
 * shadow implementation did an N+1 through Prisma relations.
 */
const SELECT_SQL = `
  SELECT a.id, a.clinic_id, a.doctor_id, a.patient_id,
         a.appointment_start_date, a.appointment_start_time, a.appointment_end_time,
         a.appointment_timezone, a.visit_type, a.description, a.status, a.created_at,
         df.meta_value AS doctor_first,  dl.meta_value AS doctor_last,  du.display_name AS doctor_display,
         pf.meta_value AS patient_first, pl.meta_value AS patient_last, pu.display_name AS patient_display,
         pu.user_email AS patient_email
    FROM wp_kc_appointments a
    LEFT JOIN wp_users du ON du.ID = a.doctor_id
    LEFT JOIN wp_users pu ON pu.ID = a.patient_id
    LEFT JOIN wp_usermeta df ON df.user_id = a.doctor_id  AND df.meta_key = 'first_name'
    LEFT JOIN wp_usermeta dl ON dl.user_id = a.doctor_id  AND dl.meta_key = 'last_name'
    LEFT JOIN wp_usermeta pf ON pf.user_id = a.patient_id AND pf.meta_key = 'first_name'
    LEFT JOIN wp_usermeta pl ON pl.user_id = a.patient_id AND pl.meta_key = 'last_name'
`;

export type ListSessionsQuery = {
  page: number;
  perPage: number;
  clinicId?: number;
  professionalId?: number;
  clientId?: number;
  /** Exact local date, `YYYY-MM-DD`. */
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  statuses?: readonly SessionStatus[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`Expected YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

function buildWhere(q: ListSessionsQuery): { sql: string; args: unknown[] } {
  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];

  if (q.clinicId !== undefined) {
    where.push('a.clinic_id = ?');
    args.push(q.clinicId);
  }
  if (q.professionalId !== undefined) {
    where.push('a.doctor_id = ?');
    args.push(q.professionalId);
  }
  if (q.clientId !== undefined) {
    where.push('a.patient_id = ?');
    args.push(q.clientId);
  }
  // Dates bound as strings — a Date on a DATE/TIME column is silently wrong here; see
  // the warning in appointments.repo.ts.
  if (q.date) {
    where.push('a.appointment_start_date = ?');
    args.push(assertDate(q.date));
  } else {
    if (q.dateFrom) {
      where.push('a.appointment_start_date >= ?');
      args.push(assertDate(q.dateFrom));
    }
    if (q.dateTo) {
      where.push('a.appointment_start_date <= ?');
      args.push(assertDate(q.dateTo));
    }
  }
  if (q.statuses !== undefined) {
    if (q.statuses.length === 0) {
      where.push('1 = 0');
    } else {
      where.push(`a.status IN (${q.statuses.map(() => '?').join(',')})`);
      args.push(...q.statuses.map(toKcStatus));
    }
  }

  return { sql: where.join(' AND '), args };
}

export async function findSessionById(id: number): Promise<SessionRow | null> {
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(`${SELECT_SQL} WHERE a.id = ? LIMIT 1`, id);
  return rows.length > 0 ? toSession(rows[0]) : null;
}

export async function listSessions(
  query: ListSessionsQuery,
): Promise<{ items: SessionRow[]; total: number }> {
  const page = Math.max(1, Math.trunc(query.page));
  const perPage = Math.min(200, Math.max(1, Math.trunc(query.perPage)));
  const { sql, args } = buildWhere(query);

  const countRows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(*) AS n FROM wp_kc_appointments a WHERE ${sql}`,
    ...args,
  );

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `${SELECT_SQL} WHERE ${sql}
      ORDER BY a.appointment_start_date ASC, a.appointment_start_time ASC, a.id ASC
      LIMIT ? OFFSET ?`,
    ...args,
    perPage,
    (page - 1) * perPage,
  );

  return { items: rows.map(toSession), total: Number(countRows[0]?.n ?? 0) };
}

/**
 * Change a session's status.
 *
 * Direct SQL rather than the plugin: `appointments.write.ts` already routes creation and
 * cancellation through it so KiviCare's hooks fire. This is the read-model's own helper
 * for bulk/maintenance paths that must not emit a notification per row — the service
 * layer decides which to use.
 */
export async function setSessionStatusDirect(id: number, status: SessionStatus): Promise<boolean> {
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_appointments SET status = ? WHERE id = ?`,
    toKcStatus(status),
    id,
  );
  return affected > 0;
}
