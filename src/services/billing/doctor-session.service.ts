// src/services/billing/doctor-session.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { DoctorSessionScope } from '@/services/billing/staff-scope';

export interface DoctorSessionListParams { page: number; perPage: number | 'all'; clinicId?: number; doctorId?: number; day?: string; }

/**
 * Normalise a `TIME` column to 'HH:mm:ss'.
 *
 * Prisma hands a MySQL TIME back as a Date on 1970-01-01 whose *UTC* clock carries the
 * stored wall-clock, so it must be read in UTC — the same way every wp repository does
 * it (see repositories/wp/clinic-sessions.repo.ts, which reads this very table).
 * Slicing `String(date)` instead yielded '1970 18:' (Date.toString(), not ISO) and threw
 * the minutes away, so the UI could not render or recover the practice hours.
 */
function toTimeString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(11, 19);
  return String(v);
}

/** 'HH:mm' or 'HH:mm:ss' → minutes past midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

/** Trim a stored time down to what a form binds to. */
function hhmm(t: string): string { return t.slice(0, 5); }

/** Widen a form value back to what the `TIME` column stores. */
function hhmmss(t: string): string { return t.length === 5 ? `${t}:00` : t; }

export function mapDoctorSessionRow(r: any) {
  return {
    id: Number(r.id),
    clinic_id: Number(r.clinic_id),
    doctor_id: r.doctor_id != null ? Number(r.doctor_id) : null,
    day: r.day ?? null,
    start_time: toTimeString(r.start_time),
    end_time: toTimeString(r.end_time),
    time_slot: r.time_slot != null ? Number(r.time_slot) : null,
    clinic_name: r.clinic_name ?? null,
    doctor_name: r.doctor_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_clinic_sessions cs
   LEFT JOIN wp_kc_clinics c ON cs.clinic_id = c.id
   LEFT JOIN wp_users d ON cs.doctor_id = d.ID`;

function buildWhere(scope: DoctorSessionScope | null, p: Partial<DoctorSessionListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.clinicId !== undefined) { where.push('cs.clinic_id = ?'); args.push(scope.clinicId); }
  if (scope?.doctorId !== undefined) { where.push('cs.doctor_id = ?'); args.push(scope.doctorId); }
  if (p.clinicId !== undefined) { where.push('cs.clinic_id = ?'); args.push(p.clinicId); }
  if (p.doctorId !== undefined) { where.push('cs.doctor_id = ?'); args.push(p.doctorId); }
  if (p.day) { where.push('cs.day = ?'); args.push(p.day); }
  return { whereSql: where.join(' AND '), args };
}

export async function listDoctorSessions(p: DoctorSessionListParams, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} ORDER BY cs.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { sessions: rows.map(mapDoctorSessionRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getDoctorSession(id: number, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} AND cs.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Doctor session not found', 404);
  return mapDoctorSessionRow(rows[0]);
}

/**
 * Which (clinic, doctor) a write lands on, given who is asking.
 *
 * Shared by the single-row create and the weekly save so the two cannot drift into
 * disagreeing about who may write where.
 */
function resolveWriteTarget(input: { clinicId?: number; doctorId: number }, kc: KcActor): { clinicId: number; doctorId: number } {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? Number(input.clinicId ?? 0) : Number(kc.clinicId ?? input.clinicId ?? 0);
  if (!clinicId) throw new KcError('clinicId is required', 400);
  // A PROFESSIONAL may only write their own schedule.
  if (kc.actor.role === 'PROFESSIONAL' && BigInt(input.doctorId) !== kc.wpUserId) {
    throw new KcError('Cannot create a session for another doctor', 403);
  }
  // A clinic-bound actor may not aim a write at someone else's clinic.
  if (kc.actor.role !== 'SUPER_ADMIN' && input.clinicId !== undefined && Number(input.clinicId) !== clinicId) {
    throw new KcError('Cannot write a session for another clinic', 403);
  }
  return { clinicId, doctorId: Number(input.doctorId) };
}

/**
 * Reject a window that covers a minute another window already covers.
 *
 * Two overlapping rows make the same minute bookable twice, which surfaces as duplicate
 * slots in the booking UI. The weekly save cannot hit this (it replaces the whole set and
 * validates in memory), so this guards only the row-at-a-time endpoints.
 */
async function assertNoOverlap(
  target: { clinicId: number; doctorId: number; day: string; startTime: string; endTime: string },
  excludeId?: number,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, start_time, end_time FROM wp_kc_clinic_sessions
      WHERE clinic_id = ? AND doctor_id = ? AND day = ?${excludeId ? ' AND id <> ?' : ''}`,
    ...(excludeId
      ? [target.clinicId, target.doctorId, target.day, excludeId]
      : [target.clinicId, target.doctorId, target.day]),
  );
  const start = toMinutes(target.startTime);
  const end = toMinutes(target.endTime);
  for (const r of rows) {
    const rs = toMinutes(toTimeString(r.start_time) ?? '00:00:00');
    const re = toMinutes(toTimeString(r.end_time) ?? '00:00:00');
    if (rs === 0 && re === 0) continue;   // legacy zero-time row, not a real window
    if (start < re && rs < end) {
      throw new KcError(
        `${target.day}: ${hhmm(target.startTime)}-${hhmm(target.endTime)} overlaps ${hhmm(toTimeString(r.start_time)!)}-${hhmm(toTimeString(r.end_time)!)}`,
        409,
      );
    }
  }
}

export interface DoctorSessionCreateInput { clinicId?: number; doctorId: number; day: string; startTime: string; endTime: string; timeSlot: number; }
export async function createDoctorSession(input: DoctorSessionCreateInput, kc: KcActor): Promise<{ id: number }> {
  const { clinicId, doctorId } = resolveWriteTarget(input, kc);
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) throw new KcError('End time must be after start time', 400);
  await assertNoOverlap({ clinicId, doctorId, day: input.day, startTime: input.startTime, endTime: input.endTime });
  // One interactive transaction pins one connection, so LAST_INSERT_ID() cannot pick up
  // another request's insert the way a pooled follow-up SELECT can.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      clinicId, doctorId, input.day, input.startTime, input.endTime, input.timeSlot,
    );
    const idRow = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    return { id: Number(idRow[0].id) };
  });
}

export interface DoctorSessionUpdateInput { day?: string; startTime?: string; endTime?: string; timeSlot?: number; }
export async function updateDoctorSession(id: number, input: DoctorSessionUpdateInput, scope: DoctorSessionScope | null): Promise<void> {
  const current = await getDoctorSession(id, scope); // scope + existence
  const day = input.day ?? current.day ?? '';
  const startTime = input.startTime ?? current.start_time ?? '';
  const endTime = input.endTime ?? current.end_time ?? '';
  if (startTime && endTime && toMinutes(endTime) <= toMinutes(startTime)) {
    throw new KcError('End time must be after start time', 400);
  }
  if (day && startTime && endTime) {
    await assertNoOverlap(
      { clinicId: current.clinic_id, doctorId: current.doctor_id ?? 0, day, startTime, endTime },
      id,
    );
  }
  const sets: string[] = []; const args: unknown[] = [];
  if (input.day !== undefined) { sets.push('day = ?'); args.push(input.day); }
  if (input.startTime !== undefined) { sets.push('start_time = ?'); args.push(input.startTime); }
  if (input.endTime !== undefined) { sets.push('end_time = ?'); args.push(input.endTime); }
  if (input.timeSlot !== undefined) { sets.push('time_slot = ?'); args.push(input.timeSlot); }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinic_sessions SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

export async function deleteDoctorSession(id: number, scope: DoctorSessionScope | null): Promise<void> {
  await getDoctorSession(id, scope);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_sessions WHERE id = ?`, id);
}

export async function bulkDeleteDoctorSessions(ids: number[], scope: DoctorSessionScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(`SELECT cs.id ${BASE_JOIN} WHERE ${whereSql} AND cs.id IN (${placeholders})`, ...args, ...ids);
  const ok = inScope.map((r) => Number(r.id));
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_sessions WHERE id IN (${ph})`, ...ok);
  return ok.length;
}

export async function exportDoctorSessions(p: DoctorSessionListParams, scope: DoctorSessionScope | null) {
  const list = await listDoctorSessions({ ...p, perPage: 'all', page: 1 }, scope);
  return { sessions: list.sessions };
}

/** Static config for the scheduling UI. */
export function doctorSessionModule() {
  return { days: ['mon','tue','wed','thu','fri','sat','sun'], slotOptions: [5,10,15,20,30,45,60,90,120], defaultSlot: 30 };
}

/* ------------------------------------------------------------------ */
/* Weekly schedule                                                     */
/*                                                                     */
/* The scheduling screen edits one week for one (doctor × clinic) at a  */
/* time — the way KiviCare's own dashboard does — and a day with a      */
/* break is stored as two rows with the break as the gap between them.  */
/* These functions are the translation between the two shapes, so the   */
/* front end never has to do interval arithmetic to render a form.      */
/* ------------------------------------------------------------------ */

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DaySlug = (typeof DAY_ORDER)[number];

/** Minimums KiviCare enforces in its UI; mirrored here so both sides agree. */
const MIN_SESSION_MINUTES = 30;
const MIN_BREAK_MINUTES = 15;

/** A KiviCare row of 00:00:00–00:00:00 carries no hours; it is junk, not a window. */
const NOT_ZERO_ROW = `NOT (cs.start_time = '00:00:00' AND cs.end_time = '00:00:00')`;

export interface TimeRange { start: string; end: string; }
export interface WeekDayInput { day: DaySlug; enabled: boolean; mainSession?: TimeRange | null; breaks?: TimeRange[]; }
export interface DoctorSessionWeekInput { clinicId?: number; doctorId: number; timeSlot: number; days: WeekDayInput[]; }
export interface WeekWindow { day: DaySlug; startTime: string; endTime: string; }

export interface WeekDayView { day: DaySlug; enabled: boolean; mainSession: TimeRange | null; breaks: TimeRange[]; }
export interface DoctorSessionWeekView {
  doctor_id: number; clinic_id: number;
  doctor_name: string | null; clinic_name: string | null;
  time_slot: number;
  days: WeekDayView[];
}

/**
 * Turn "one session plus N breaks" into the rows the table actually stores.
 *
 * Pure and exported so the rules can be tested without a database. Every message matches
 * the one the front-end shows for the same rule, so a user never sees two wordings for
 * one mistake.
 */
export function buildWeekWindows(days: WeekDayInput[]): WeekWindow[] {
  const seen = new Set<string>();
  const windows: WeekWindow[] = [];

  for (const d of days) {
    if (seen.has(d.day)) throw new KcError(`${d.day}: day appears twice`, 400);
    seen.add(d.day);
    if (!d.enabled) continue;

    const main = d.mainSession;
    if (!main?.start || !main?.end) throw new KcError(`Please set session times for ${d.day}`, 400);

    const start = toMinutes(main.start);
    const end = toMinutes(main.end);
    if (end <= start) throw new KcError(`${d.day}: End time must be after start time`, 400);
    if (end - start < MIN_SESSION_MINUTES) throw new KcError(`${d.day}: Session must be at least 30 minutes long`, 400);

    const breaks = [...(d.breaks ?? [])]
      .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end), raw: b }))
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < breaks.length; i++) {
      const b = breaks[i];
      if (b.end <= b.start) throw new KcError(`${d.day}: Break end time must be after break start time`, 400);
      if (b.end - b.start < MIN_BREAK_MINUTES) throw new KcError(`${d.day}: Break must be at least 15 minutes long`, 400);
      if (b.start < start || b.start >= end) throw new KcError(`${d.day}: Break must be within session hours`, 400);
      if (b.end > end) throw new KcError(`${d.day}: Break must end before session ends`, 400);
      if (i > 0 && b.start < breaks[i - 1].end) {
        throw new KcError(`${d.day}: Break times cannot overlap with other breaks`, 400);
      }
    }

    // The remaining stretches of the day are the rows.
    let cursor = start;
    const dayWindows: WeekWindow[] = [];
    for (const b of breaks) {
      if (b.start > cursor) dayWindows.push({ day: d.day, startTime: hhmmss(toTime(cursor)), endTime: hhmmss(toTime(b.start)) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < end) dayWindows.push({ day: d.day, startTime: hhmmss(toTime(cursor)), endTime: hhmmss(toTime(end)) });

    // Breaks that swallow the whole session would silently save a day with no hours.
    if (dayWindows.length === 0) throw new KcError(`${d.day}: Breaks leave no working time`, 400);
    windows.push(...dayWindows);
  }

  if (windows.length === 0) throw new KcError('Please select at least one day', 400);
  return windows;
}

/** Minutes past midnight → 'HH:mm'. */
function toTime(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Replace a doctor's whole week at one clinic, in one transaction.
 *
 * Replace rather than merge: the screen shows the entire week, so what it submits *is*
 * the schedule. A partial save would leave rows the user believes they deleted.
 */
export async function saveDoctorSessionWeek(
  input: DoctorSessionWeekInput,
  kc: KcActor,
): Promise<{ doctor_id: number; clinic_id: number; time_slot: number; windows: number }> {
  const { clinicId, doctorId } = resolveWriteTarget(input, kc);
  const windows = buildWeekWindows(input.days);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `DELETE FROM wp_kc_clinic_sessions WHERE clinic_id = ? AND doctor_id = ?`,
      clinicId, doctorId,
    );
    const values = windows.map(() => '(?, ?, ?, ?, ?, ?, NOW())').join(', ');
    const args = windows.flatMap((w) => [clinicId, doctorId, w.day, w.startTime, w.endTime, input.timeSlot]);
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
       VALUES ${values}`,
      ...args,
    );
    // KiviCare stamps every row of a schedule with the id of its first row. Nothing in our
    // read path depends on it, but the plugin's own screens write it, so keep the shape.
    const idRow = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    const firstId = Number(idRow[0].id);
    await tx.$executeRawUnsafe(
      `UPDATE wp_kc_clinic_sessions SET parent_id = ? WHERE clinic_id = ? AND doctor_id = ?`,
      firstId, clinicId, doctorId,
    );
  });

  return { doctor_id: doctorId, clinic_id: clinicId, time_slot: input.timeSlot, windows: windows.length };
}

/**
 * Read a week back in the shape the form binds to.
 *
 * A doctor with no rows yet is not an error — the "add" form asks for exactly this and
 * gets seven disabled days.
 */
export async function getDoctorSessionWeek(
  doctorId: number,
  clinicId: number,
  scope: DoctorSessionScope | null,
): Promise<DoctorSessionWeekView> {
  const { whereSql, args } = buildWhere(scope, { clinicId, doctorId });
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN}
      WHERE ${whereSql} AND ${NOT_ZERO_ROW}
      ORDER BY cs.start_time ASC`,
    ...args,
  );

  const byDay = new Map<string, any[]>();
  for (const r of rows) {
    const day = String(r.day ?? '').toLowerCase();   // legacy rows carry 'MON'
    if (!(DAY_ORDER as readonly string[]).includes(day)) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r);
  }

  const days: WeekDayView[] = DAY_ORDER.map((day) => {
    const dayRows = (byDay.get(day) ?? []).sort(
      (a, b) => toMinutes(toTimeString(a.start_time)!) - toMinutes(toTimeString(b.start_time)!),
    );
    if (dayRows.length === 0) return { day, enabled: false, mainSession: null, breaks: [] };

    const mainSession = {
      start: hhmm(toTimeString(dayRows[0].start_time)!),
      end: hhmm(toTimeString(dayRows[dayRows.length - 1].end_time)!),
    };
    // Every gap between consecutive rows is a break the user entered.
    const breaks: TimeRange[] = [];
    for (let i = 0; i < dayRows.length - 1; i++) {
      const gapStart = hhmm(toTimeString(dayRows[i].end_time)!);
      const gapEnd = hhmm(toTimeString(dayRows[i + 1].start_time)!);
      if (toMinutes(gapStart) < toMinutes(gapEnd)) breaks.push({ start: gapStart, end: gapEnd });
    }
    return { day, enabled: true, mainSession, breaks };
  });

  const first = rows[0];
  return {
    doctor_id: doctorId,
    clinic_id: clinicId,
    doctor_name: first?.doctor_name ?? null,
    clinic_name: first?.clinic_name ?? null,
    time_slot: first?.time_slot != null ? Number(first.time_slot) : doctorSessionModule().defaultSlot,
    days,
  };
}

/** Delete every row of one (doctor × clinic) schedule. Returns rows removed. */
export async function deleteDoctorSessionWeek(
  doctorId: number,
  clinicId: number,
  scope: DoctorSessionScope | null,
): Promise<number> {
  const { whereSql, args } = buildWhere(scope, { clinicId, doctorId });
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT cs.id ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length === 0) return 0;
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_clinic_sessions WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  return ids.length;
}

export interface DoctorSessionGroupListParams {
  page: number; perPage: number | 'all';
  clinicId?: number; doctorId?: number; search?: string;
  orderBy: 'doctor_name' | 'clinic_name' | 'time_slot';
  order: 'asc' | 'desc';
}

/**
 * The list screen's shape: one row per (doctor × clinic), not per stored window.
 *
 * A doctor working Monday and Tuesday with a lunch break is four rows in the table but
 * one line in the UI, so the grouping has to happen in SQL for pagination to mean
 * anything.
 */
export async function listDoctorSessionGroups(p: DoctorSessionGroupListParams, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, { clinicId: p.clinicId, doctorId: p.doctorId });
  const where: string[] = [whereSql, NOT_ZERO_ROW];
  const whereArgs = [...args];
  if (p.search) {
    where.push('(d.display_name LIKE ? OR c.name LIKE ?)');
    whereArgs.push(`%${p.search}%`, `%${p.search}%`);
  }
  const fullWhere = where.join(' AND ');
  const GROUP_BY = `GROUP BY cs.doctor_id, cs.clinic_id, c.name, c.email, d.display_name, d.user_email`;

  const countRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS n FROM (SELECT 1 ${BASE_JOIN} WHERE ${fullWhere} ${GROUP_BY}) t`,
    ...whereArgs,
  );
  const total = Number(countRows[0]?.n ?? 0);

  // Whitelisted above by zod; interpolated because MySQL cannot bind an ORDER BY column.
  const orderSql = `${{ doctor_name: 'd.display_name', clinic_name: 'c.name', time_slot: 'MIN(cs.time_slot)' }[p.orderBy]} ${p.order === 'desc' ? 'DESC' : 'ASC'}`;
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT MAX(cs.id) AS id, cs.doctor_id, cs.clinic_id,
            MIN(cs.time_slot) AS time_slot, COUNT(*) AS window_count,
            GROUP_CONCAT(DISTINCT cs.day) AS days,
            c.name AS clinic_name, c.email AS clinic_email,
            d.display_name AS doctor_name, d.user_email AS doctor_email
       ${BASE_JOIN}
      WHERE ${fullWhere}
      ${GROUP_BY}
      ORDER BY ${orderSql}${limitSql}`,
    ...whereArgs, ...pageArgs,
  );

  const groups = rows.map((r) => ({
    id: Number(r.id),                       // an addressable row of the group
    doctor_id: Number(r.doctor_id),
    clinic_id: Number(r.clinic_id),
    doctor_name: r.doctor_name ?? null,
    doctor_email: r.doctor_email ?? null,
    clinic_name: r.clinic_name ?? null,
    clinic_email: r.clinic_email ?? null,
    // GROUP_CONCAT cannot both de-duplicate and order by a custom sequence, so sort here.
    days: String(r.days ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d): d is DaySlug => (DAY_ORDER as readonly string[]).includes(d))
      .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
    time_slot: r.time_slot != null ? Number(r.time_slot) : null,
    window_count: Number(r.window_count),
  }));

  return { sessions: groups, pagination: { page: p.page, perPage: p.perPage, total } };
}

/** Delete whole schedules by (doctor, clinic). Returns rows removed. */
export async function bulkDeleteDoctorSessionGroups(
  groups: { doctorId: number; clinicId: number }[],
  scope: DoctorSessionScope | null,
): Promise<number> {
  let removed = 0;
  for (const g of groups) removed += await deleteDoctorSessionWeek(g.doctorId, g.clinicId, scope);
  return removed;
}
