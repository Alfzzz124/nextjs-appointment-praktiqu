# KiviCare Clinic Schedules + Dashboard (Slice 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clinic Schedules (`/api/v1/clinic-schedules`, 7 endpoints) and a read-only Dashboard (`/api/v1/dashboard`, 5 endpoints) following the KC billing pattern.

**Architecture:** KC raw-SQL pattern (`withAuth` + `kcHandle` + `assertCan` + `resolveKcActor` + scope). Clinic schedules are CRUD over `wp_kc_clinic_schedule` (pure parameterized raw SQL — dates as `YYYY-MM-DD`, times as `HH:mm:ss`; no new Prisma model). Dashboard is read-only aggregate SQL over `wp_kc_appointments` + `wp_kc_bills`, scoped by clinic/doctor.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL (raw SQL), Zod, Vitest.

**Branch:** `feat/kc-schedules-dashboard` (already created from `main`).

## CONFIRMED live schema
```
wp_kc_clinic_schedule (139 rows):
  id bigint PK | start_date date | end_date date | selection_mode varchar(20) ['single','range','multiple']
  | selected_dates text | time_specific tinyint(1) | start_time time | end_time time | timezone varchar(64)
  | module_type varchar(191) ['clinic','doctor'] | module_id bigint unsigned | description text
  | status tinyint unsigned | created_at datetime

wp_kc_appointments: id, appointment_start_date(date), appointment_start_time(time), clinic_id, doctor_id, patient_id,
  status tinyint (0=CANCELLED,1=BOOKED,2=PENDING,3=CHECK_OUT,4=CHECK_IN), created_at, appointment_start_utc
wp_kc_bills: id, encounter_id, appointment_id, title, total_amount(varchar), discount(varchar), actual_amount(varchar),
  status bigint, payment_status varchar(10), created_at, clinic_id(bigint nullable)
```
Reuse `wp_kc_doctor_clinic_mappings (doctor_id, clinic_id)` to resolve a clinic's doctors.

## Scope
**Schedules** — by module:
- SUPER_ADMIN → no filter.
- CLINIC_ADMIN / RECEPTIONIST → `(module_type='clinic' AND module_id = :clinicId) OR (module_type='doctor' AND module_id IN (SELECT doctor_id FROM wp_kc_doctor_clinic_mappings WHERE clinic_id = :clinicId))`.
- PROFESSIONAL → `(module_type='doctor' AND module_id = :wpUserId)`.
- CLIENT → no access (capability excludes CLIENT).

**Dashboard** — appointments/bills filter:
- SUPER_ADMIN → none; CLINIC_ADMIN/RECEPTIONIST → `clinic_id = :clinicId`; PROFESSIONAL → `doctor_id = :wpUserId` (appointments) and bills scoped by `clinic_id` for admins / skipped-or-encounter-joined for doctors; CLIENT → no access.

## Capabilities (design Slice 7)
```ts
  schedule_read:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  schedule_manage:  ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
  dashboard_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
```

## Endpoints
Clinic Schedules (7): GET list, POST create, GET/{id}, PUT/{id}, DELETE/{id}, POST get-unavailable-schedule, GET module.
Dashboard (5): GET statistics, GET recent-payments, GET top-professionals, GET upcoming-sessions, GET revenue-chart.

## DB SAFETY (read first)
Only the live `wordpress-praktiqu` DB exists — no test DB. DB-backed tests MUST NOT run here; keep `assertTestDb()` intact. No schema changes/migrations. Reads-only introspection is fine; do not run mutations against the live DB in tests.

---

### Task 1: Capabilities + validation + scope helpers

**Files:**
- Modify: `src/services/billing/kc-permissions.ts`, `src/services/billing/validation.ts`
- Create: `src/services/billing/schedule-scope.ts` (schedule + dashboard scope helpers)
- Test: `tests/billing/kc-permissions.test.ts` (extend)

- [ ] **Step 1: Capabilities** — add `schedule_read`, `schedule_manage`, `dashboard_read` to the union + MATRIX (roles above).

- [ ] **Step 2: Validation in `validation.ts`**:
```ts
export const SCHEDULE_MODULE = ['clinic', 'doctor'] as const;
export const SCHEDULE_SELECTION = ['single', 'range', 'multiple'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE2 = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  moduleType: z.enum(SCHEDULE_MODULE).optional(),
  moduleId: z.coerce.number().int().optional(),
});
export const scheduleCreateSchema = z.object({
  moduleType: z.enum(SCHEDULE_MODULE),
  moduleId: z.coerce.number().int(),
  selectionMode: z.enum(SCHEDULE_SELECTION),
  startDate: z.string().regex(DATE_RE).optional(),
  endDate: z.string().regex(DATE_RE).optional(),
  selectedDates: z.string().max(5000).optional(),  // CSV/JSON of dates for 'multiple'
  timeSpecific: z.coerce.boolean().default(false),
  startTime: z.string().regex(TIME_RE2).optional(),
  endTime: z.string().regex(TIME_RE2).optional(),
  timezone: z.string().max(64).optional(),
  description: z.string().max(5000).optional(),
  status: z.coerce.number().int().min(0).max(1).default(1),
});
export const scheduleUpdateSchema = scheduleCreateSchema.partial().omit({ moduleType: true, moduleId: true }).strict();
export const unavailableScheduleSchema = z.object({
  moduleType: z.enum(SCHEDULE_MODULE),
  moduleId: z.coerce.number().int(),
  startDate: z.string().regex(DATE_RE).optional(),
  endDate: z.string().regex(DATE_RE).optional(),
});
export const dashboardQuerySchema = z.object({
  dateFrom: z.string().regex(DATE_RE).optional(),
  dateTo: z.string().regex(DATE_RE).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  period: z.enum(['day', 'month']).default('month'),  // revenue-chart granularity
});
```

- [ ] **Step 3: Create `src/services/billing/schedule-scope.ts`**:
```ts
import type { KcActor } from '@/services/billing/kc-actor';

export interface ScheduleScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function scheduleScopeFor(kc: KcActor): ScheduleScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}

export interface DashboardScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function dashboardScopeFor(kc: KcActor): DashboardScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
```

- [ ] **Step 4: Extend `tests/billing/kc-permissions.test.ts`**:
```ts
describe('schedule + dashboard capabilities', () => {
  it('gates correctly', () => {
    const ca = { id:'x', role:'CLINIC_ADMIN', practiceId:null } as const;
    const client = { id:'x', role:'CLIENT', practiceId:null } as const;
    const recp = { id:'x', role:'RECEPTIONIST', practiceId:null } as const;
    expect(can(ca, 'schedule_manage')).toBe(true);
    expect(can(recp, 'schedule_manage')).toBe(false);
    expect(can(recp, 'schedule_read')).toBe(true);
    expect(can(recp, 'dashboard_read')).toBe(true);
    expect(can(client, 'dashboard_read')).toBe(false);
    expect(can(client, 'schedule_read')).toBe(false);
  });
});
```
Run: `npx vitest run tests/billing/kc-permissions.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/billing/kc-permissions.ts src/services/billing/validation.ts src/services/billing/schedule-scope.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(schedules+dashboard): capabilities, validation, scope helpers"
```

---

### Task 2: Clinic schedule service

**Files:**
- Create: `src/services/billing/clinic-schedule.service.ts`
- Reference: `doctor-session.service.ts` (raw SQL + TIME/date handling, scope, LAST_INSERT_ID).

- [ ] **Step 1: Write the service**
```ts
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
```

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep clinic-schedule.service | head` → no output.
```bash
git add src/services/billing/clinic-schedule.service.ts
git commit -m "feat(schedules): service — CRUD + get-unavailable + module"
```

---

### Task 3: Clinic schedule routes

**Files (base `src/app/api/v1/clinic-schedules/`):**
- `route.ts` (GET list `schedule_read`, POST create `schedule_manage`)
- `[id]/route.ts` (GET read, PUT manage, DELETE manage)
- `get-unavailable-schedule/route.ts` (POST `schedule_read`)
- `module/route.ts` (GET `schedule_read`)
- Reference: doctor-session routes (identical wiring). Scope = `scheduleScopeFor`. List returns `{ schedules, pagination }`.

- [ ] **Step 1: Create the route files** mirroring the doctor-session route wiring, swapping service = `clinic-schedule.service`, scope = `scheduleScopeFor`, schemas = `scheduleListQuerySchema`/`scheduleCreateSchema`/`scheduleUpdateSchema`, caps = `schedule_read`/`schedule_manage`. The `get-unavailable-schedule` route (POST) validates `unavailableScheduleSchema` and calls `getUnavailableSchedule(body, scheduleScopeFor(kc))`. `module` route returns `scheduleModule()`.

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "clinic-schedules/" | head` → no output.
```bash
git add src/app/api/v1/clinic-schedules
git commit -m "feat(schedules): REST routes (list/create/get/update/delete/get-unavailable/module)"
```

---

### Task 4: Dashboard service

**Files:**
- Create: `src/services/billing/dashboard.service.ts`
- Reference: `bill.service.ts` (varchar amount parsing — `toNum`/`CAST`), `encounter.service.ts` (scope).

- [ ] **Step 1: Write the service**
```ts
// src/services/billing/dashboard.service.ts
import { prisma } from '@/lib/db';
import type { DashboardScope } from '@/services/billing/schedule-scope';

export interface DashboardParams { dateFrom?: string; dateTo?: string; limit: number; period: 'day' | 'month'; }

// Appointment scope predicate over alias `a`.
function apptScope(scope: DashboardScope | null): { sql: string; args: unknown[] } {
  if (!scope) return { sql: '1=1', args: [] };
  if (scope.doctorId !== undefined) return { sql: 'a.doctor_id = ?', args: [scope.doctorId] };
  return { sql: 'a.clinic_id = ?', args: [scope.clinicId] };
}
// Bill scope over alias `b` (bills carry clinic_id; for doctor scope, join via encounter).
function billScope(scope: DashboardScope | null): { sql: string; args: unknown[]; joinEnc: boolean } {
  if (!scope) return { sql: '1=1', args: [], joinEnc: false };
  if (scope.doctorId !== undefined) return { sql: 'e.doctor_id = ?', args: [scope.doctorId], joinEnc: true };
  return { sql: 'b.clinic_id = ?', args: [scope.clinicId], joinEnc: false };
}

export async function getStatistics(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const dateA: string[] = []; const dateArgsA: unknown[] = [];
  if (p.dateFrom) { dateA.push('a.appointment_start_date >= ?'); dateArgsA.push(p.dateFrom); }
  if (p.dateTo) { dateA.push('a.appointment_start_date <= ?'); dateArgsA.push(p.dateTo); }
  const apptWhere = [a.sql, ...dateA].join(' AND ');

  const apptRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT a.patient_id) AS patients,
            SUM(CASE WHEN a.status <> 0 THEN 1 ELSE 0 END) AS active
     FROM wp_kc_appointments a WHERE ${apptWhere}`, ...a.args, ...dateArgsA);

  const b = billScope(scope);
  const dateB: string[] = []; const dateArgsB: unknown[] = [];
  if (p.dateFrom) { dateB.push('b.created_at >= ?'); dateArgsB.push(p.dateFrom + ' 00:00:00'); }
  if (p.dateTo) { dateB.push('b.created_at <= ?'); dateArgsB.push(p.dateTo + ' 23:59:59'); }
  const billWhere = [b.sql, ...dateB].join(' AND ');
  const billJoin = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const billRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(CAST(b.actual_amount AS DECIMAL(15,2))), 0) AS revenue
     FROM wp_kc_bills b ${billJoin} WHERE ${billWhere}`, ...b.args, ...dateArgsB);

  return {
    patients: Number(apptRows[0]?.patients ?? 0),
    appointments: Number(apptRows[0]?.total ?? 0),
    active_appointments: Number(apptRows[0]?.active ?? 0),
    bills: Number(billRows[0]?.bills ?? 0),
    revenue: Number(billRows[0]?.revenue ?? 0),
  };
}

export async function getRecentPayments(p: DashboardParams, scope: DashboardScope | null) {
  const b = billScope(scope);
  const join = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT b.id, b.title, b.actual_amount, b.payment_status, b.created_at, b.clinic_id
     FROM wp_kc_bills b ${join} WHERE ${b.sql} ORDER BY b.id DESC LIMIT ?`, ...b.args, p.limit);
  return { payments: rows.map((r) => ({ id: Number(r.id), title: r.title, amount: Number(r.actual_amount ?? 0), payment_status: r.payment_status, created_at: r.created_at })) };
}

export async function getTopProfessionals(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.doctor_id, d.display_name AS doctor_name, COUNT(*) AS appointments
     FROM wp_kc_appointments a LEFT JOIN wp_users d ON a.doctor_id = d.ID
     WHERE ${a.sql} GROUP BY a.doctor_id, d.display_name ORDER BY appointments DESC LIMIT ?`, ...a.args, p.limit);
  return { professionals: rows.map((r) => ({ doctor_id: Number(r.doctor_id), doctor_name: r.doctor_name, appointments: Number(r.appointments) })) };
}

export async function getUpcomingSessions(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a.appointment_start_date, a.appointment_start_time, a.status,
            d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_appointments a
     LEFT JOIN wp_users d ON a.doctor_id = d.ID
     LEFT JOIN wp_users pt ON a.patient_id = pt.ID
     WHERE ${a.sql} AND a.status IN (1, 2) AND a.appointment_start_date >= CURDATE()
     ORDER BY a.appointment_start_date ASC, a.appointment_start_time ASC LIMIT ?`, ...a.args, p.limit);
  return { sessions: rows.map((r) => ({ id: Number(r.id), date: r.appointment_start_date ? String(r.appointment_start_date).slice(0,10) : null, status: Number(r.status), doctor_name: r.doctor_name, patient_name: r.patient_name })) };
}

export async function getRevenueChart(p: DashboardParams, scope: DashboardScope | null) {
  const b = billScope(scope);
  const join = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const fmt = p.period === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const dates: string[] = []; const dargs: unknown[] = [];
  if (p.dateFrom) { dates.push('b.created_at >= ?'); dargs.push(p.dateFrom + ' 00:00:00'); }
  if (p.dateTo) { dates.push('b.created_at <= ?'); dargs.push(p.dateTo + ' 23:59:59'); }
  const where = [b.sql, ...dates].join(' AND ');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DATE_FORMAT(b.created_at, '${fmt}') AS bucket, COALESCE(SUM(CAST(b.actual_amount AS DECIMAL(15,2))), 0) AS revenue
     FROM wp_kc_bills b ${join} WHERE ${where} GROUP BY bucket ORDER BY bucket ASC`, ...b.args, ...dargs);
  return { chart: rows.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue) })) };
}
```
> IMPLEMENTER: `fmt` is a hardcoded literal chosen from `p.period` (only `'%Y-%m-%d'` or `'%Y-%m'`) — it is NOT user input, so interpolating it is safe. Every other value is a bound `?`. Do not let any user value reach the format string.

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep dashboard.service | head` → no output.
```bash
git add src/services/billing/dashboard.service.ts
git commit -m "feat(dashboard): service — statistics/recent-payments/top-professionals/upcoming/revenue-chart"
```

---

### Task 5: Dashboard routes

**Files (base `src/app/api/v1/dashboard/`):**
- `statistics/route.ts`, `recent-payments/route.ts`, `top-professionals/route.ts`, `upcoming-sessions/route.ts`, `revenue-chart/route.ts` — all GET, capability `dashboard_read`.
- Reference: prescription export route wiring (GET + query parse + scope).

- [ ] **Step 1: Create the five GET routes**. Each: `withAuth` + `kcHandle`, `assertCan(actor,'dashboard_read')`, `resolveKcActor`, parse `dashboardQuerySchema` from query string, call the matching service fn with `dashboardScopeFor(kc)`, `kcOk(data, '...')`. Example (`statistics/route.ts`):
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { dashboardScopeFor } from '@/services/billing/schedule-scope';
import { dashboardQuerySchema } from '@/services/billing/validation';
import { getStatistics } from '@/services/billing/dashboard.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'dashboard_read');
  const kc = await resolveKcActor(actor);
  const parsed = dashboardQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await getStatistics(parsed.data as any, dashboardScopeFor(kc)), 'Dashboard statistics');
}));
```
The other four are identical, swapping the service fn + message.

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "dashboard/" | head` → no output.
```bash
git add src/app/api/v1/dashboard
git commit -m "feat(dashboard): 5 read-only aggregate routes"
```

---

### Task 6: Tests + close-out

**Files:**
- Modify: `tests/billing/fixtures.ts` (seed a clinic schedule + a couple appointments/bills, TEST_MARKER range, assertTestDb-guarded; extend cleanup)
- Create: `tests/billing/clinic-schedule.service.test.ts`, `tests/billing/dashboard.service.test.ts`, `tests/billing/schedules-dashboard-routes.integration.test.ts`
- Reference: `tests/billing/doctor-session.service.test.ts`, `staff-routes.integration.test.ts`.

**DB SAFETY:** only the live DB exists — do NOT run DB-backed tests / repoint DATABASE_URL / weaken assertTestDb. Only run `npx vitest run tests/billing/kc-permissions.test.ts`, the DB-free route auth-matrix test, and `npx tsc --noEmit`.

- [ ] **Step 1: Fixtures** — `seedClinicSchedule({ id, moduleType, moduleId, selectionMode, status })` (raw INSERT, TEST_MARKER id), `seedAppointment({ id, clinicId, doctorId, patientId, status, startDate })`, `seedBill({ id, clinicId, encounterId, actualAmount, createdAt })` (raw INSERTs, TEST_MARKER). Extend `cleanup()` with raw DELETEs (id >= TEST_MARKER) for wp_kc_clinic_schedule, wp_kc_appointments, wp_kc_bills.

- [ ] **Step 2: Service tests**
  - `clinic-schedule.service.test.ts`: lifecycle (create→get→list→update→delete) as CLINIC_ADMIN with a clinic-module schedule; scope isolation (another clinic's scope can't see it); `assertModuleInScope` rejects a clinic-admin creating another clinic's schedule (403); `getUnavailableSchedule` returns the block; `scheduleModule()` shape (no DB — direct assert).
  - `dashboard.service.test.ts`: seed a few appointments + bills for a clinic; `getStatistics` returns expected counts/revenue for that clinic scope; `getTopProfessionals`/`getUpcomingSessions`/`getRecentPayments`/`getRevenueChart` return scoped rows. (All DB-backed — written, not run here.)

- [ ] **Step 3: Route auth-matrix** (`schedules-dashboard-routes.integration.test.ts`): 401 (no token) + 403 (CLIENT) for POST `/clinic-schedules` (schedule_manage excludes CLIENT) and GET `/dashboard/statistics` (dashboard_read excludes CLIENT). Reached before DB access.

- [ ] **Step 4: Safe checks**
```bash
npx vitest run tests/billing/kc-permissions.test.ts
npx vitest run tests/billing/schedules-dashboard-routes.integration.test.ts
npx tsc --noEmit 2>&1 | grep -iE "clinic-schedule|dashboard|schedule-scope|schedules-dashboard|fixtures" | head
```
Permission + route auth-matrix tests pass; no new tsc errors in new files.

- [ ] **Step 5: Commit**
```bash
git add tests/billing/fixtures.ts tests/billing/clinic-schedule.service.test.ts tests/billing/dashboard.service.test.ts tests/billing/schedules-dashboard-routes.integration.test.ts
git commit -m "test(schedules+dashboard): service + route tests (DB-guarded)"
```

---

## Self-Review

**Spec coverage** (design Slice 7, 12): Clinic Schedules 7 → Tasks 2-3 (list/create/get/update/delete/get-unavailable/module). Dashboard 5 → Tasks 4-5 (statistics/recent-payments/top-professionals/upcoming-sessions/revenue-chart). Capabilities `schedule_read`/`schedule_manage`/`dashboard_read` → Task 1.

**Placeholder scan:** No TODO/TBD. Tasks 3 & 5 describe routes as "mirror X with substitutions" but name every capability/schema/scope/service-fn/message — deterministic given 6 slices of precedent. One IMPLEMENTER note flags the one safe literal interpolation (the `DATE_FORMAT` bucket string, chosen from a 2-value enum, never user input).

**Type consistency:** `ScheduleScope`/`scheduleScopeFor` + `DashboardScope`/`dashboardScopeFor` (Task 1, `schedule-scope.ts`) used by both services + all routes. Schedule list → `{ schedules, pagination }`; dashboard fns return `{ patients, appointments, ... }` / `{ payments }` / `{ professionals }` / `{ sessions }` / `{ chart }` — route messages match. Column names match the introspected schema; appointment status IN (1,2) = BOOKED/PENDING for "upcoming"; revenue via `CAST(actual_amount AS DECIMAL)`.

**Security notes for reviewers:** all raw SQL parameterized `?` — scope args, filters, dates, LIMIT, and the schedule scope subquery. The only interpolation is the `DATE_FORMAT` literal (enum-constrained, not user input). Scope enforced on schedule list/get/update/delete and create (`assertModuleInScope`), and on every dashboard aggregate (clinic/doctor predicate). Dashboard + get-unavailable are read-only. Capability gating on all 12 routes; CLIENT excluded from both modules.
