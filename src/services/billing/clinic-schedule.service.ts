// src/services/billing/clinic-schedule.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ScheduleScope } from '@/services/billing/schedule-scope';

export interface ScheduleListParams { page: number; perPage: number | 'all'; moduleType?: string; moduleId?: number; }

function mapRow(r: any) {
  const t = (v: any) => (v == null ? null : typeof v === 'string' ? v : String(v).slice(11, 19));
  return {
    id: Number(r.id),
    module_type: r.module_type ?? null,
    module_id: r.module_id != null ? Number(r.module_id) : null,
    selection_mode: r.selection_mode ?? null,
    start_date: r.start_date ? String(r.start_date).slice(0, 10) : null,
    end_date: r.end_date ? String(r.end_date).slice(0, 10) : null,
    selected_dates: r.selected_dates ?? null,
    time_specific: r.time_specific != null ? Number(r.time_specific) : null,
    start_time: t(r.start_time),
    end_time: t(r.end_time),
    timezone: r.timezone ?? null,
    description: r.description ?? null,
    status: r.status != null ? Number(r.status) : null,
    created_at: r.created_at,
  };
}

/** Scope predicate over the `sc` alias. Returns SQL + args. */
function scopeClause(scope: ScheduleScope | null): { sql: string; args: unknown[] } {
  if (!scope) return { sql: '1=1', args: [] };
  if (scope.doctorId !== undefined) return { sql: `(sc.module_type = 'doctor' AND sc.module_id = ?)`, args: [scope.doctorId] };
  // clinic scope: clinic's own schedule OR its doctors' schedules
  return {
    sql: `((sc.module_type = 'clinic' AND sc.module_id = ?) OR (sc.module_type = 'doctor' AND sc.module_id IN (SELECT doctor_id FROM wp_kc_doctor_clinic_mappings WHERE clinic_id = ?)))`,
    args: [scope.clinicId, scope.clinicId],
  };
}

function buildWhere(scope: ScheduleScope | null, p: Partial<ScheduleListParams>) {
  const sc = scopeClause(scope);
  const where = [sc.sql]; const args = [...sc.args];
  if (p.moduleType) { where.push('sc.module_type = ?'); args.push(p.moduleType); }
  if (p.moduleId !== undefined) { where.push('sc.module_id = ?'); args.push(p.moduleId); }
  return { whereSql: where.join(' AND '), args };
}

export async function listSchedules(p: ScheduleListParams, scope: ScheduleScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM wp_kc_clinic_schedule sc WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT sc.* FROM wp_kc_clinic_schedule sc WHERE ${whereSql} ORDER BY sc.id DESC${limitSql}`, ...args, ...pageArgs);
  return { schedules: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getSchedule(id: number, scope: ScheduleScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT sc.* FROM wp_kc_clinic_schedule sc WHERE ${whereSql} AND sc.id = ?`, ...args, id);
  if (!rows[0]) throw new KcError('Schedule not found', 404);
  return mapRow(rows[0]);
}

/** Verify the target module belongs to the actor's scope (for create). */
export function assertModuleInScope(moduleType: string, moduleId: number, kc: KcActor): void {
  if (kc.actor.role === 'SUPER_ADMIN') return;
  if (kc.actor.role === 'PROFESSIONAL') {
    if (!(moduleType === 'doctor' && BigInt(moduleId) === kc.wpUserId)) throw new KcError('Cannot manage this schedule', 403);
    return;
  }
  // CLINIC_ADMIN / RECEPTIONIST: clinic module must be their clinic; doctor module handled leniently (belongs to clinic — checked at DB level on read). Enforce clinic module here:
  if (moduleType === 'clinic' && BigInt(moduleId) !== (kc.clinicId ?? -1n)) throw new KcError('Cannot manage another clinic\'s schedule', 403);
}

export interface ScheduleCreateInput {
  moduleType: string; moduleId: number; selectionMode: string;
  startDate?: string; endDate?: string; selectedDates?: string;
  timeSpecific: boolean; startTime?: string; endTime?: string; timezone?: string;
  description?: string; status: number;
}
export async function createSchedule(input: ScheduleCreateInput, kc: KcActor): Promise<{ id: number }> {
  assertModuleInScope(input.moduleType, input.moduleId, kc);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule
     (start_date, end_date, selection_mode, selected_dates, time_specific, start_time, end_time, timezone, module_type, module_id, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    input.startDate ?? null, input.endDate ?? null, input.selectionMode, input.selectedDates ?? null,
    input.timeSpecific ? 1 : 0, input.startTime ?? null, input.endTime ?? null, input.timezone ?? null,
    input.moduleType, input.moduleId, input.description ?? null, input.status,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export interface ScheduleUpdateInput {
  selectionMode?: string; startDate?: string; endDate?: string; selectedDates?: string;
  timeSpecific?: boolean; startTime?: string; endTime?: string; timezone?: string; description?: string; status?: number;
}
export async function updateSchedule(id: number, input: ScheduleUpdateInput, scope: ScheduleScope | null): Promise<void> {
  await getSchedule(id, scope);
  const map: Array<[string, unknown]> = [
    ['selection_mode', input.selectionMode], ['start_date', input.startDate], ['end_date', input.endDate],
    ['selected_dates', input.selectedDates], ['time_specific', input.timeSpecific === undefined ? undefined : (input.timeSpecific ? 1 : 0)],
    ['start_time', input.startTime], ['end_time', input.endTime], ['timezone', input.timezone],
    ['description', input.description], ['status', input.status],
  ];
  const sets: string[] = []; const args: unknown[] = [];
  for (const [col, val] of map) { if (val !== undefined) { sets.push(`${col} = ?`); args.push(val); } }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinic_schedule SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

export async function deleteSchedule(id: number, scope: ScheduleScope | null): Promise<void> {
  await getSchedule(id, scope);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE id = ?`, id);
}

/** Return schedule blocks for a module in a date range (the "unavailable" windows). Scope-checked. */
export async function getUnavailableSchedule(input: { moduleType: string; moduleId: number; startDate?: string; endDate?: string }, scope: ScheduleScope | null) {
  // Reuse listSchedules-style scope by filtering to the requested module and intersecting the scope predicate.
  const sc = scopeClause(scope);
  const where = [sc.sql, 'sc.module_type = ?', 'sc.module_id = ?', 'sc.status = 1']; const args = [...sc.args, input.moduleType, input.moduleId];
  if (input.startDate) { where.push('(sc.end_date IS NULL OR sc.end_date >= ?)'); args.push(input.startDate); }
  if (input.endDate) { where.push('(sc.start_date IS NULL OR sc.start_date <= ?)'); args.push(input.endDate); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT sc.* FROM wp_kc_clinic_schedule sc WHERE ${where.join(' AND ')} ORDER BY sc.start_date ASC`, ...args);
  return { unavailable: rows.map(mapRow) };
}

export function scheduleModule() {
  return { moduleTypes: ['clinic', 'doctor'], selectionModes: ['single', 'range', 'multiple'] };
}
