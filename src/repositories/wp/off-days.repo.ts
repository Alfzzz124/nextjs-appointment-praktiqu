/**
 * Off days / holidays, straight from KiviCare's `wp_kc_clinic_schedule`.
 *
 * Replaces the `professional_off_days` and `holiday_list` shadow tables. One table
 * holds both clinic-wide and per-doctor closures, discriminated by `module_type`
 * ('clinic' | 'doctor') with `module_id` naming the clinic or the doctor's
 * `wp_users.ID`.
 *
 * Reads AND writes are direct SQL here. That is a deliberate exception to the
 * plugin-REST rule (D1), made on evidence: KiviCare registers no `do_action` for
 * holidays, so a direct write skips nothing. See the Writes section below.
 */
import { prisma } from '@/lib/db';

export const OFF_DAY_MODULE = { CLINIC: 'clinic', DOCTOR: 'doctor' } as const;
export type OffDayModule = (typeof OFF_DAY_MODULE)[keyof typeof OFF_DAY_MODULE];

/**
 * How the stored dates should be read.
 *
 * Production uses all three: 130 `range`, 6 `single`, 3 `multiple`. Rows written
 * before KiviCare's 2026-02 enhancement have a NULL mode and are treated as `range`,
 * which is what the original two-column start/end shape meant.
 */
export const SELECTION_MODE = {
  SINGLE: 'single',
  MULTIPLE: 'multiple',
  RANGE: 'range',
} as const;
export type SelectionMode = (typeof SELECTION_MODE)[keyof typeof SELECTION_MODE];

/** KiviCare marks live rows with 1. */
const STATUS_ACTIVE = 1;

export type WpOffDay = {
  id: bigint;
  module: string;
  /** Clinic id, or the doctor's `wp_users.ID`. */
  moduleId: bigint;
  selectionMode: SelectionMode;
  /** `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  /** Explicit dates, only meaningful when `selectionMode` is `multiple`. */
  selectedDates: string[];
  /** When true the closure covers only `startTime`–`endTime`, not the whole day. */
  timeSpecific: boolean;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  description: string | null;
  isActive: boolean;
};

type RawRow = {
  id: bigint | number;
  module_type: string | null;
  module_id: bigint | number;
  selection_mode: string | null;
  start_date: Date | null;
  end_date: Date | null;
  selected_dates: string | null;
  time_specific: number | null;
  start_time: Date | null;
  end_time: Date | null;
  timezone: string | null;
  description: string | null;
  status: number | null;
};

/** `@db.Date`/`@db.Time` round-trip as Dates; format off UTC so no shift can occur. */
function toDateString(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null;
}

function toTimeString(v: Date | null): string | null {
  return v ? v.toISOString().slice(11, 19) : null;
}

function toSelectionMode(raw: string | null): SelectionMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === SELECTION_MODE.SINGLE || v === SELECTION_MODE.MULTIPLE
    ? v
    : SELECTION_MODE.RANGE;
}

/**
 * `selected_dates` is a JSON array of `YYYY-MM-DD`. Rows written outside KiviCare may
 * hold anything, so a malformed value degrades to an empty list rather than throwing —
 * losing one holiday is better than failing the whole availability lookup.
 */
function decodeSelectedDates(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((d) => (typeof d === 'string' ? d.trim().slice(0, 10) : ''))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    return [];
  }
}

function toOffDay(row: RawRow): WpOffDay {
  return {
    id: BigInt(row.id),
    module: row.module_type ?? '',
    moduleId: BigInt(row.module_id),
    selectionMode: toSelectionMode(row.selection_mode),
    startDate: toDateString(row.start_date),
    endDate: toDateString(row.end_date),
    selectedDates: decodeSelectedDates(row.selected_dates),
    timeSpecific: row.time_specific === 1,
    startTime: toTimeString(row.start_time),
    endTime: toTimeString(row.end_time),
    timezone: row.timezone,
    description: row.description,
    isActive: row.status === STATUS_ACTIVE,
  };
}

const COLUMNS = `id, module_type, module_id, selection_mode, start_date, end_date,
                 selected_dates, time_specific, start_time, end_time, timezone,
                 description, status`;

export type ListOffDaysQuery = {
  module: OffDayModule;
  moduleId: bigint;
  /** Inclusive `YYYY-MM-DD` window. A row overlapping it at all is returned. */
  from?: string;
  to?: string;
  includeInactive?: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`Expected YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

export async function listOffDays(query: ListOffDaysQuery): Promise<WpOffDay[]> {
  const where = ['module_type = ?', 'module_id = ?'];
  const args: unknown[] = [query.module, query.moduleId];

  if (!query.includeInactive) {
    where.push('status = ?');
    args.push(STATUS_ACTIVE);
  }

  // Overlap, not containment: a holiday spanning the window's edges still applies.
  // Dates are bound as strings — see the TIME/DATE binding warning in
  // appointments.repo.ts. `multiple` rows keep their dates in selected_dates, so they
  // are deliberately not excluded by the range filter and are resolved by isOffOn.
  if (query.to) {
    where.push('(start_date IS NULL OR start_date <= ? OR selection_mode = ?)');
    args.push(assertDate(query.to), SELECTION_MODE.MULTIPLE);
  }
  if (query.from) {
    where.push('(end_date IS NULL OR end_date >= ? OR selection_mode = ?)');
    args.push(assertDate(query.from), SELECTION_MODE.MULTIPLE);
  }

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT ${COLUMNS} FROM wp_kc_clinic_schedule
      WHERE ${where.join(' AND ')}
      ORDER BY start_date ASC, id ASC`,
    ...args,
  );

  return rows.map(toOffDay);
}

/** Off days for a doctor, by `wp_users.ID`. */
export function listDoctorOffDays(
  doctorId: bigint,
  opts: { from?: string; to?: string; includeInactive?: boolean } = {},
): Promise<WpOffDay[]> {
  return listOffDays({ module: OFF_DAY_MODULE.DOCTOR, moduleId: doctorId, ...opts });
}

export function listClinicOffDays(
  clinicId: bigint,
  opts: { from?: string; to?: string; includeInactive?: boolean } = {},
): Promise<WpOffDay[]> {
  return listOffDays({ module: OFF_DAY_MODULE.CLINIC, moduleId: clinicId, ...opts });
}

/**
 * Does this off-day cover the given date?
 *
 * Each selection mode means something different, and reading them all as a start/end
 * range would silently mark working days as closed:
 *   - `single`   — only `startDate`
 *   - `multiple` — only the dates listed in `selectedDates`
 *   - `range`    — every day from `startDate` to `endDate` inclusive
 *
 * A `timeSpecific` row still returns true: the day is affected, just not entirely.
 * Callers that generate slots must consult `startTime`/`endTime` to decide which ones
 * to drop — treating a partial closure as a full one would hide bookable slots.
 */
export function isOffOn(offDay: WpOffDay, date: string): boolean {
  assertDate(date);

  switch (offDay.selectionMode) {
    case SELECTION_MODE.SINGLE:
      return offDay.startDate === date;
    case SELECTION_MODE.MULTIPLE:
      return offDay.selectedDates.includes(date);
    default: {
      if (!offDay.startDate) return false;
      // String comparison is safe and correct for zero-padded ISO dates.
      const end = offDay.endDate ?? offDay.startDate;
      return date >= offDay.startDate && date <= end;
    }
  }
}

/** The subset of `offDays` that cover `date`. */
export function offDaysOn(offDays: WpOffDay[], date: string): WpOffDay[] {
  return offDays.filter((o) => isOffOn(o, date));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */
/**
 * Direct SQL, like clinic sessions: KiviCare registers no `do_action` for holidays, so
 * a write here skips nothing. See the note in clinic-sessions.repo.ts.
 */

export type CreateOffDayInput = {
  module: OffDayModule;
  moduleId: bigint;
  selectionMode?: SelectionMode;
  startDate: string;
  endDate?: string;
  selectedDates?: string[];
  timeSpecific?: boolean;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  description?: string;
};

export async function createOffDay(input: CreateOffDayInput): Promise<bigint> {
  const mode = input.selectionMode ?? SELECTION_MODE.RANGE;
  assertDate(input.startDate);
  if (input.endDate) assertDate(input.endDate);
  for (const d of input.selectedDates ?? []) assertDate(d);

  if (mode === SELECTION_MODE.MULTIPLE && (input.selectedDates ?? []).length === 0) {
    // A multiple-mode row with no dates covers nothing, and isOffOn would report the
    // doctor as available on every day it nominally spans.
    throw new Error('selectionMode "multiple" requires at least one selected date');
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule
       (module_type, module_id, selection_mode, start_date, end_date, selected_dates,
        time_specific, start_time, end_time, timezone, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
    input.module,
    input.moduleId,
    mode,
    input.startDate,
    input.endDate ?? input.startDate,
    input.selectedDates ? JSON.stringify(input.selectedDates) : null,
    input.timeSpecific ? 1 : 0,
    input.startTime ?? null,
    input.endTime ?? null,
    input.timezone ?? null,
    input.description ?? null,
  );

  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT LAST_INSERT_ID() AS id`,
  );
  return BigInt(rows[0].id);
}

/**
 * Remove an off day, scoped to its owner.
 *
 * The module/moduleId are part of the WHERE rather than trusted from the caller: an id
 * alone would let one doctor delete another's closure.
 */
export async function deleteOffDay(opts: {
  id: bigint;
  module: OffDayModule;
  moduleId: bigint;
}): Promise<boolean> {
  const affected = await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_clinic_schedule WHERE id = ? AND module_type = ? AND module_id = ?`,
    opts.id,
    opts.module,
    opts.moduleId,
  );
  return affected > 0;
}
