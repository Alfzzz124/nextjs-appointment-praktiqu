# KiviCare Receptionists + Doctor Sessions (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Receptionists (`/api/v1/receptionists`, 10 endpoints) and Doctor Sessions (`/api/v1/doctor-sessions`, 8 endpoints) over WordPress tables, following the KC billing/encounter pattern.

**Architecture:** KC raw-SQL pattern (`withAuth` + `kcHandle` + `assertCan` + `resolveKcActor` + scope). Receptionists are `wp_users` with the `kiviCare_receptionist` capability, linked to clinics via `wp_kc_receptionist_clinic_mappings`; creation provisions a WP user (parameterized raw SQL inside a single interactive `$transaction`). Doctor Sessions are CRUD over `wp_kc_clinic_sessions` (parameterized raw SQL for `TIME` handling).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL (raw SQL for WP tables), Zod, Vitest.

**Branch:** `feat/kc-receptionists-doctor-sessions` (already created from `main`).

## CONFIRMED live schema
```
wp_users: ID, user_login(varchar60), user_pass(varchar255), user_nicename(varchar50), user_email(varchar100),
          user_url(varchar100), user_registered(datetime), user_activation_key(varchar255), user_status(int), display_name(varchar250)
wp_usermeta: (KcUserMeta) user_id, meta_key, meta_value  — receptionist role = meta_key='wp_capabilities' meta_value LIKE '%kiviCare_receptionist%'
wp_kc_receptionist_clinic_mappings: id, receptionist_id(bigint unsigned), clinic_id(bigint unsigned), created_at  — EMPTY (0 rows)
wp_kc_clinic_sessions: id, clinic_id, doctor_id(nullable), day(varchar 'mon'..'sun'), start_time(TIME), end_time(TIME), time_slot(int default 5), parent_id(nullable), created_at  — 330 rows
```
Existing Prisma models: `KcUser`(wp_users), `KcUserMeta`(wp_usermeta), `KcClinicSession`(wp_kc_clinic_sessions), `KcDoctorClinicMapping`. Add `KcReceptionistClinicMapping`.

## Decisions (from brainstorming)
- Receptionists = **WP tables** (wp_users + wp_kc_receptionist_clinic_mappings). List filters wp_users by the `kiviCare_receptionist` capability.
- POST create = **full WP provisioning** (create wp_users + role meta + clinic mapping). resend-credentials (single + bulk) = **501 stubs** (email not wired).
- Receptionist soft-delete = set `wp_users.user_status = 1`; bulk/status sets `user_status` (0 active / 1 inactive). (Matches Slice 1 "delete = deactivate" convention; reversible; does not drop the user or mapping.)
- Doctor Sessions: no status column → **`bulk/status` is omitted** (documented). `bulk/delete` is a hard delete (scoped). Times stored/returned as `HH:mm:ss` strings.
- `resolveKcActor` RECEPTIONIST bug fixed to read `wp_kc_receptionist_clinic_mappings`.

## Scope helpers
```ts
// Receptionists: by clinic membership (mapping table). Scope shape:
export interface ReceptionistScope { clinicId?: bigint }  // null = SUPER_ADMIN
export function receptionistScopeFor(kc): ReceptionistScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    default: return { clinicId: -1n };  // others can't read (gated by capability anyway)
  }
}
// Doctor sessions: direct columns.
export interface DoctorSessionScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function doctorSessionScopeFor(kc): DoctorSessionScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
```

## DB SAFETY (read first)
Only the live `wordpress-praktiqu` DB exists — no test DB. DB-backed tests MUST NOT run here; keep `assertTestDb()` intact. `prisma generate` is safe; never run `prisma migrate` / `db push`. Introspection/reads are fine; do not run the create/provisioning against the live DB in tests.

---

### Task 1: Foundation — actor fix, capabilities, model, validation, scope helpers

**Files:**
- Modify: `src/services/billing/kc-actor.ts` (RECEPTIONIST clinic resolution)
- Modify: `prisma/schema.prisma` (add `KcReceptionistClinicMapping`)
- Modify: `src/services/billing/kc-permissions.ts`, `src/services/billing/validation.ts`
- Create: `src/services/billing/staff-scope.ts` (both scope helpers)
- Test: `tests/billing/kc-permissions.test.ts` (extend)

- [ ] **Step 1: Add `KcReceptionistClinicMapping` to `prisma/schema.prisma`** (plain BigInt, mirror KcDoctorClinicMapping):
```prisma
model KcReceptionistClinicMapping {
  id             BigInt    @id @default(autoincrement())
  receptionistId BigInt    @map("receptionist_id")
  clinicId       BigInt    @map("clinic_id")
  createdAt      DateTime? @map("created_at")

  @@map("wp_kc_receptionist_clinic_mappings")
}
```

- [ ] **Step 2: `npx prisma generate`** → success.

- [ ] **Step 3: Fix `resolveKcActor` RECEPTIONIST branch** in `src/services/billing/kc-actor.ts`. Currently all of CLINIC_ADMIN/PROFESSIONAL/RECEPTIONIST read `kcDoctorClinicMapping`. Split so RECEPTIONIST reads the receptionist mapping:
```ts
if (actor.role === 'PROFESSIONAL' || actor.role === 'CLINIC_ADMIN') {
  const mapping = await prisma.kcDoctorClinicMapping.findFirst({ where: { doctorId: wpUserId }, select: { clinicId: true } });
  clinicId = mapping?.clinicId ?? null;
  if (clinicId === null && actor.role === 'CLINIC_ADMIN') {
    const owned = await prisma.kcClinic.findFirst({ where: { clinicAdminId: wpUserId }, select: { id: true } });
    clinicId = owned?.id ?? null;
  }
} else if (actor.role === 'RECEPTIONIST') {
  const mapping = await prisma.kcReceptionistClinicMapping.findFirst({ where: { receptionistId: wpUserId }, select: { clinicId: true } });
  clinicId = mapping?.clinicId ?? null;
}
```
Preserve existing behavior for the other roles exactly. (Confirm the current code shape before editing; keep the same variable names.)

- [ ] **Step 4: Capabilities in `kc-permissions.ts`** — add to union + MATRIX:
```ts
  receptionist_read:     ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'],
  receptionist_manage:   ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  doctor_session_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  doctor_session_manage: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
```

- [ ] **Step 5: Validation in `validation.ts`**:
```ts
export const receptionistListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  clinicId: z.coerce.number().int().optional(),
  search: z.string().optional(),   // matches display_name / user_email
});
export const receptionistCreateSchema = z.object({
  name: z.string().min(1).max(250),
  email: z.string().email().max(100),
  clinicId: z.coerce.number().int().optional(),  // SUPER_ADMIN sets; else derived from actor
});
export const receptionistUpdateSchema = z.object({
  name: z.string().min(1).max(250).optional(),
}).strict();   // email changes disallowed (WP-synced); clinic reassignment is a separate concern

export const DAY_ENUM = ['mon','tue','wed','thu','fri','sat','sun'] as const;
export const doctorSessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  clinicId: z.coerce.number().int().optional(),
  doctorId: z.coerce.number().int().optional(),
  day: z.enum(DAY_ENUM).optional(),
});
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;   // HH:mm or HH:mm:ss
export const doctorSessionCreateSchema = z.object({
  clinicId: z.coerce.number().int().optional(),   // derived from actor for non-super
  doctorId: z.coerce.number().int(),
  day: z.enum(DAY_ENUM),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  timeSlot: z.coerce.number().int().min(1).max(240).default(30),
});
export const doctorSessionUpdateSchema = z.object({
  day: z.enum(DAY_ENUM).optional(),
  startTime: z.string().regex(TIME_RE).optional(),
  endTime: z.string().regex(TIME_RE).optional(),
  timeSlot: z.coerce.number().int().min(1).max(240).optional(),
}).strict();
// (reuse existing idsSchema for bulk delete; idsStatusSchema for receptionist bulk/status)
```

- [ ] **Step 6: Create `src/services/billing/staff-scope.ts`** with both `ReceptionistScope`/`receptionistScopeFor` and `DoctorSessionScope`/`doctorSessionScopeFor` (code in the Scope helpers section above).

- [ ] **Step 7: Extend `tests/billing/kc-permissions.test.ts`**:
```ts
describe('receptionist + doctor_session capabilities', () => {
  it('gates correctly', () => {
    const ca = { id:'x', role:'CLINIC_ADMIN', practiceId:null } as const;
    const pro = { id:'x', role:'PROFESSIONAL', practiceId:null } as const;
    const recp = { id:'x', role:'RECEPTIONIST', practiceId:null } as const;
    expect(can(ca, 'receptionist_manage')).toBe(true);
    expect(can(recp, 'receptionist_manage')).toBe(false);
    expect(can(recp, 'receptionist_read')).toBe(true);
    expect(can(pro, 'doctor_session_manage')).toBe(true);
    expect(can(recp, 'doctor_session_manage')).toBe(false);
    expect(can(recp, 'doctor_session_read')).toBe(true);
  });
});
```
Run: `npx vitest run tests/billing/kc-permissions.test.ts` → PASS.

- [ ] **Step 8: Commit**
```bash
git add prisma/schema.prisma src/services/billing/kc-actor.ts src/services/billing/kc-permissions.ts src/services/billing/validation.ts src/services/billing/staff-scope.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(staff): actor fix, KcReceptionistClinicMapping, capabilities, validation, scope helpers"
```

---

### Task 2: Receptionist service (incl. WP provisioning)

**Files:**
- Create: `src/services/billing/receptionist.service.ts`
- Reference: `src/services/public/public-booking.service.ts` (WP user INSERT + usermeta pattern — but use parameterized `?`, NOT string interpolation), `prescription.service.ts` (raw list/scope), `kc-actor.ts` (prisma import `@/lib/db`).

- [ ] **Step 1: Write the service**

```ts
// src/services/billing/receptionist.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ReceptionistScope } from '@/services/billing/staff-scope';

const RECEPTIONIST_CAP = '%kiviCare_receptionist%';

export interface ReceptionistListParams { page: number; perPage: number | 'all'; clinicId?: number; search?: string; }

function mapRow(r: any) {
  return {
    id: Number(r.ID),
    user_login: r.user_login,
    display_name: r.display_name,
    email: r.user_email,
    status: Number(r.user_status),
  };
}

/** Base: wp_users that carry the receptionist capability. Scope adds a clinic-mapping EXISTS. */
function buildWhere(scope: ReceptionistScope | null, p: Partial<ReceptionistListParams>) {
  const where: string[] = [
    `EXISTS (SELECT 1 FROM wp_usermeta cap WHERE cap.user_id = u.ID AND cap.meta_key = 'wp_capabilities' AND cap.meta_value LIKE ?)`,
  ];
  const args: unknown[] = [RECEPTIONIST_CAP];
  if (scope?.clinicId !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM wp_kc_receptionist_clinic_mappings rcm WHERE rcm.receptionist_id = u.ID AND rcm.clinic_id = ?)`);
    args.push(scope.clinicId);
  }
  if (p.clinicId !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM wp_kc_receptionist_clinic_mappings rcm2 WHERE rcm2.receptionist_id = u.ID AND rcm2.clinic_id = ?)`);
    args.push(p.clinicId);
  }
  if (p.search) { where.push(`(u.display_name LIKE ? OR u.user_email LIKE ?)`); args.push(`%${p.search}%`, `%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

export async function listReceptionists(p: ReceptionistListParams, scope: ReceptionistScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM wp_users u WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.ID, u.user_login, u.display_name, u.user_email, u.user_status FROM wp_users u WHERE ${whereSql} ORDER BY u.ID DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { receptionists: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getReceptionist(id: number, scope: ReceptionistScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT u.ID, u.user_login, u.display_name, u.user_email, u.user_status FROM wp_users u WHERE ${whereSql} AND u.ID = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Receptionist not found', 404);
  return mapRow(rows[0]);
}

export interface ReceptionistCreateInput { name: string; email: string; clinicId?: number; }

/** Full WP provisioning inside ONE interactive transaction (LAST_INSERT_ID is connection-safe). */
export async function createReceptionist(input: ReceptionistCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? BigInt(input.clinicId ?? 0) : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  // Email uniqueness
  const existing = await prisma.$queryRawUnsafe<any[]>(`SELECT ID FROM wp_users WHERE user_email = ? LIMIT 1`, input.email);
  if (existing[0]) throw new KcError('A user with this email already exists', 409);

  const username = input.email.split('@')[0].slice(0, 60);
  const first = input.name.split(' ')[0];
  const last = input.name.split(' ').slice(1).join(' ') || '-';
  // Non-loginable placeholder hash; real auth is via the WP plugin. (No secret material.)
  const placeholderHash = '!disabled-' + username.slice(0, 20);

  const newId = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_users (user_login, user_pass, user_nicename, display_name, user_email, user_url, user_registered, user_activation_key, user_status)
       VALUES (?, ?, ?, ?, ?, '', NOW(), '', 0)`,
      username, placeholderHash, username, input.name, input.email,
    );
    const idRow = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
    const wpId = Number(idRow[0].id);
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
       (?, 'first_name', ?), (?, 'last_name', ?),
       (?, 'wp_capabilities', 'a:1:{s:21:"kiviCare_receptionist";b:1;}'),
       (?, 'wp_user_level', '0')`,
      wpId, first, wpId, last, wpId, wpId,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_receptionist_clinic_mappings (receptionist_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
      wpId, clinicId,
    );
    return wpId;
  });
  return { id: newId };
}
```
> IMPLEMENTER: `kiviCare_receptionist` is 21 chars — the PHP serialized capability MUST use `s:21:` (verify: `"kiviCare_receptionist".length === 21`). The public-booking patient meta used `s:16:"kiviCare_patient"` — do NOT copy that length. Double-check the serialized string is valid.

- [ ] **Step 2: Update / soft-delete / bulk / export**
```ts
export interface ReceptionistUpdateInput { name?: string; }
export async function updateReceptionist(id: number, input: ReceptionistUpdateInput, scope: ReceptionistScope | null): Promise<void> {
  await getReceptionist(id, scope); // scope + existence
  if (input.name !== undefined) {
    const first = input.name.split(' ')[0];
    const last = input.name.split(' ').slice(1).join(' ') || '-';
    await prisma.$executeRawUnsafe(`UPDATE wp_users SET display_name = ? WHERE ID = ?`, input.name, id);
    await prisma.$executeRawUnsafe(`UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = 'first_name'`, first, id);
    await prisma.$executeRawUnsafe(`UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = 'last_name'`, last, id);
  }
}

/** Soft delete = deactivate (user_status = 1). */
export async function deleteReceptionist(id: number, scope: ReceptionistScope | null): Promise<void> {
  await getReceptionist(id, scope);
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = 1 WHERE ID = ?`, id);
}

async function scopedIds(ids: number[], scope: ReceptionistScope | null): Promise<number[]> {
  if (ids.length === 0) return [];
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT u.ID FROM wp_users u WHERE ${whereSql} AND u.ID IN (${placeholders})`, ...args, ...ids);
  return rows.map((r) => Number(r.ID));
}

export async function bulkDeleteReceptionists(ids: number[], scope: ReceptionistScope | null): Promise<number> {
  const ok = await scopedIds(ids, scope);
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = 1 WHERE ID IN (${ph})`, ...ok);
  return ok.length;
}

export async function bulkSetReceptionistStatus(ids: number[], status: number, scope: ReceptionistScope | null): Promise<number> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  const ok = await scopedIds(ids, scope);
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = ? WHERE ID IN (${ph})`, status, ...ok);
  return ok.length;
}

export async function exportReceptionists(p: ReceptionistListParams, scope: ReceptionistScope | null) {
  const list = await listReceptionists({ ...p, perPage: 'all', page: 1 }, scope);
  return { receptionists: list.receptionists };
}
```

- [ ] **Step 3: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep receptionist.service | head` → no output.
```bash
git add src/services/billing/receptionist.service.ts
git commit -m "feat(receptionists): service — list/get/create(WP provision)/update/soft-delete/bulk/export"
```

---

### Task 3: Receptionist routes (+ resend-credentials 501 stubs)

**Files (base `src/app/api/v1/receptionists/`):**
- `route.ts` (GET list `receptionist_read`, POST create `receptionist_manage`)
- `[id]/route.ts` (GET read, PUT manage, DELETE manage)
- `bulk/delete/route.ts` (POST manage, `idsSchema`)
- `bulk/status/route.ts` (POST manage, `idsStatusSchema`)
- `export/route.ts` (GET read)
- `[id]/resend-credentials/route.ts` (POST, 501 stub)
- `bulk/resend-credentials/route.ts` (POST, 501 stub)
- Reference: prescription routes (wiring) + the Slice-1 professionals resend-credentials stub for the exact 501 shape.

- [ ] **Step 1: CRUD + bulk + export routes** — mirror the prescription route wiring exactly, swapping service = `receptionist.service`, scope = `receptionistScopeFor` (from `staff-scope`), schemas = `receptionistListQuerySchema`/`receptionistCreateSchema`/`receptionistUpdateSchema`, caps = `receptionist_read`/`receptionist_manage`, `idsSchema` (bulk delete) and `idsStatusSchema` (bulk status). List returns `{ receptionists, pagination }`. Bulk return `kcOk({ updated: n }, ...)`.

- [ ] **Step 2: resend-credentials 501 stubs** (both single and bulk). Match the Slice-1 professionals stub:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';

export const POST = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'receptionist_manage');
  return NextResponse.json(
    { status: false, message: 'Credential email delivery is not yet configured. Contact your system administrator.' },
    { status: 501 },
  );
}));
```
(kcHandle passes the 501 NextResponse through and converts the 403 from assertCan — same pattern verified in Slice 5.)

- [ ] **Step 3: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "receptionists/" | head` → no output.
```bash
git add src/app/api/v1/receptionists
git commit -m "feat(receptionists): REST routes + resend-credentials 501 stubs"
```

---

### Task 4: Doctor Sessions service

**Files:**
- Create: `src/services/billing/doctor-session.service.ts`
- Reference: `encounter.service.ts` (direct-column scope), `prescription.service.ts` (parameterized raw SQL). Times handled as `HH:mm:ss` strings via raw SQL (avoid Prisma `@db.Time` DateTime conversion).

- [ ] **Step 1: Write the service**
```ts
// src/services/billing/doctor-session.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { DoctorSessionScope } from '@/services/billing/staff-scope';

export interface DoctorSessionListParams { page: number; perPage: number | 'all'; clinicId?: number; doctorId?: number; day?: string; }

function mapRow(r: any) {
  const t = (v: any) => (v == null ? null : String(v).slice(11, 19) || String(v)); // TIME may come back as 'HH:mm:ss' or Date
  return {
    id: Number(r.id),
    clinic_id: Number(r.clinic_id),
    doctor_id: r.doctor_id != null ? Number(r.doctor_id) : null,
    day: r.day ?? null,
    start_time: typeof r.start_time === 'string' ? r.start_time : t(r.start_time),
    end_time: typeof r.end_time === 'string' ? r.end_time : t(r.end_time),
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
  return { sessions: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getDoctorSession(id: number, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} AND cs.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Doctor session not found', 404);
  return mapRow(rows[0]);
}

export interface DoctorSessionCreateInput { clinicId?: number; doctorId: number; day: string; startTime: string; endTime: string; timeSlot: number; }
export async function createDoctorSession(input: DoctorSessionCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? Number(input.clinicId ?? 0) : Number(kc.clinicId ?? input.clinicId ?? 0);
  if (!clinicId) throw new KcError('clinicId is required', 400);
  // A PROFESSIONAL may only create sessions for themselves.
  if (kc.actor.role === 'PROFESSIONAL' && BigInt(input.doctorId) !== kc.wpUserId) throw new KcError('Cannot create a session for another doctor', 403);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    clinicId, input.doctorId, input.day, input.startTime, input.endTime, input.timeSlot,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export interface DoctorSessionUpdateInput { day?: string; startTime?: string; endTime?: string; timeSlot?: number; }
export async function updateDoctorSession(id: number, input: DoctorSessionUpdateInput, scope: DoctorSessionScope | null): Promise<void> {
  await getDoctorSession(id, scope); // scope + existence
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
```
> IMPLEMENTER: verify how the MySQL `TIME` column round-trips through `$queryRawUnsafe` in this stack — it may return a JS `Date` (epoch-prefixed) or a `'HH:mm:ss'` string. `mapRow`'s `t()` handles both; adjust the slice indices if the observed shape differs (log one row while developing, but do NOT run against the live DB — reason from the introspection sample `1970-01-01T19:30:00.000Z`, which is a Date; `t()` slices chars 11..19 → '19:30:00').

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep doctor-session.service | head` → no output.
```bash
git add src/services/billing/doctor-session.service.ts
git commit -m "feat(doctor-sessions): service — CRUD + bulk-delete + export + module config"
```

---

### Task 5: Doctor Sessions routes

**Files (base `src/app/api/v1/doctor-sessions/`):**
- `route.ts` (GET list `doctor_session_read`, POST create `doctor_session_manage`)
- `[id]/route.ts` (GET read, PUT manage, DELETE manage)
- `bulk/delete/route.ts` (POST manage, `idsSchema`)
- `export/route.ts` (GET read)
- `module/route.ts` (GET read — returns `doctorSessionModule()`)
- Reference: prescription/encounter routes. Scope = `doctorSessionScopeFor`. **No `bulk/status` route** (table has no status column).

- [ ] **Step 1: Create the five route files** mirroring the prescription route wiring, swapping service = `doctor-session.service`, scope = `doctorSessionScopeFor`, schemas = `doctorSessionListQuerySchema`/`doctorSessionCreateSchema`/`doctorSessionUpdateSchema`, caps = `doctor_session_read`/`doctor_session_manage`. List returns `{ sessions, pagination }`. `module/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { doctorSessionModule } from '@/services/billing/doctor-session.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  return kcOk(doctorSessionModule(), 'Doctor session module config');
}));
```

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "doctor-sessions/" | head` → no output.
```bash
git add src/app/api/v1/doctor-sessions
git commit -m "feat(doctor-sessions): REST routes (list/create/get/update/delete/bulk-delete/export/module)"
```

---

### Task 6: Tests + close-out

**Files:**
- Modify: `tests/billing/fixtures.ts` (seed a receptionist wp_user + usermeta + mapping; seed a clinic session — all TEST_MARKER range, assertTestDb-guarded; extend cleanup)
- Create: `tests/billing/receptionist.service.test.ts`, `tests/billing/doctor-session.service.test.ts`, `tests/billing/staff-routes.integration.test.ts`
- Reference: `tests/billing/prescription.service.test.ts`, `fixtures.ts`.

**DB SAFETY:** only the live DB exists — do NOT run DB-backed tests / repoint DATABASE_URL / weaken assertTestDb. Only run `npx vitest run tests/billing/kc-permissions.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 1: Fixtures** — `seedReceptionist({ id, email, name, clinicId, status })` (raw INSERT wp_users + wp_usermeta capability + wp_kc_receptionist_clinic_mappings, TEST_MARKER ids, assertTestDb-guarded) and `seedClinicSession({ id, clinicId, doctorId, day, startTime, endTime, timeSlot })` via `prisma.kcClinicSession.create` or raw INSERT (TEST_MARKER id). Extend `cleanup()`: raw `DELETE FROM wp_kc_clinic_sessions WHERE id >= TEST_MARKER`, `DELETE FROM wp_kc_receptionist_clinic_mappings WHERE id >= TEST_MARKER`, `DELETE FROM wp_usermeta WHERE user_id >= TEST_MARKER`, `DELETE FROM wp_users WHERE ID >= TEST_MARKER`.

- [ ] **Step 2: Service tests**
  - `receptionist.service.test.ts`: `createReceptionist` (as CLINIC_ADMIN kc) then get/list finds it with the receptionist capability; scope isolation (a different clinic's admin scope does not see it); `bulkSetReceptionistStatus` flips user_status; soft-delete sets user_status=1. Assert the created wp_usermeta capability string is exactly `a:1:{s:21:"kiviCare_receptionist";b:1;}`.
  - `doctor-session.service.test.ts`: lifecycle (create→get→list→update→delete) with clinic/doctor scope; PROFESSIONAL cannot create for another doctor (throws 403); bulk-delete only removes in-scope ids; `doctorSessionModule()` returns the day list (this last one needs no DB — can assert directly).

- [ ] **Step 3: Route auth-matrix** (`staff-routes.integration.test.ts`): 401 (no token) + 403 (RECEPTIONIST POST create receptionist — receptionist_manage excludes RECEPTIONIST) for `/receptionists`; 401 + 403 (CLIENT POST) for `/doctor-sessions`. Reached before DB access.

- [ ] **Step 4: Safe checks**
```bash
npx vitest run tests/billing/kc-permissions.test.ts
npx tsc --noEmit 2>&1 | grep -iE "receptionist|doctor-session|staff-scope|staff-routes|fixtures" | head
```
Permission test passes; no new tsc errors in new files.

- [ ] **Step 5: Commit**
```bash
git add tests/billing/fixtures.ts tests/billing/receptionist.service.test.ts tests/billing/doctor-session.service.test.ts tests/billing/staff-routes.integration.test.ts
git commit -m "test(staff): receptionist + doctor-session service + route tests (DB-guarded)"
```

---

## Self-Review

**Spec coverage** (design Slice 6, ~19): Receptionists 10 → Tasks 2-3 (create=full WP provision; resend-credentials ×2 = 501 stubs; the rest CRUD/bulk/export). Doctor Sessions → Tasks 4-5: list/create/get/update/delete/bulk-delete/export/module = 8; `bulk/status` intentionally omitted (no status column — documented). Capabilities `receptionist_read/manage`, `doctor_session_read/manage` → Task 1. `resolveKcActor` RECEPTIONIST fix → Task 1.

**Placeholder scan:** No TODO/TBD. Tasks 3 & 5 describe routes as "mirror prescription wiring with these substitutions" but name every capability/schema/scope/message — deterministic given 5 slices of precedent. Two IMPLEMENTER notes flag genuine verification points (the `s:21:` serialized-capability length, and the MySQL TIME round-trip shape) with concrete guidance.

**Type consistency:** `ReceptionistScope`/`DoctorSessionScope` + their `*ScopeFor` (Task 1, `staff-scope.ts`) used by every service fn and route. Receptionist list → `{ receptionists, pagination }`; doctor-session list → `{ sessions, pagination }` — route messages match. Create derives clinic from the actor (non-super); PROFESSIONAL doctor-session create is self-only. `idsStatusSchema` reused for receptionist bulk/status; `idsSchema` for both bulk deletes.

**Security notes for reviewers:** All raw SQL is parameterized `?` — including the receptionist WP-provisioning INSERTs (wp_users, wp_usermeta, mapping) done inside a single interactive `$transaction` (LAST_INSERT_ID connection-safe), the capability `LIKE ?` filter (bound constant), search `LIKE ?`, LIMIT/OFFSET, ids, and bulk `IN (...)`. No string interpolation of user input (improves on the public-booking `escapeString` precedent). Scope enforced on list/get/update/delete/bulk and on create (clinic derived from actor; professional self-only). Email uniqueness checked before provisioning; email changes disallowed on update (WP-synced). resend-credentials are authenticated 501 stubs.
