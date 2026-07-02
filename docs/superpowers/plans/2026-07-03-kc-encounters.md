# KiviCare Encounters (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full CRUD Encounters module at `/api/v1/encounters` (~9 endpoints) over the WordPress `wp_kc_patient_encounters` table, following the established KC billing pattern.

**Architecture:** KC raw-SQL pattern — routes use `withAuth` + `kcHandle`, gate on capabilities via `assertCan`, resolve `KcActor` via `resolveKcActor`, and scope queries by role. Encounter data lives in `wp_kc_patient_encounters` accessed through the `prisma.kcPatientEncounter` model (simple ops) and `prisma.$queryRawUnsafe` (list joins for patient/doctor/clinic names). Responses use `kcOk`/`kcFail`. This mirrors `bill.service.ts` / `tax.service.ts` exactly.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL (raw SQL for WP tables), Zod, Vitest (real test DB with fixtures).

**Branch:** `feat/kc-encounters` (already created from `main`).

**Endpoints (design Slice 3):**
| Method | Path | Capability |
|--------|------|-----------|
| GET | `/encounters` | `encounter_read` |
| POST | `/encounters` | `encounter_manage` |
| GET | `/encounters/{id}` | `encounter_read` |
| PUT | `/encounters/{id}` | `encounter_manage` |
| DELETE | `/encounters/{id}` | `encounter_manage` |
| POST | `/encounters/bulk/delete` | `encounter_manage` |
| POST | `/encounters/bulk/status` | `encounter_manage` |
| GET | `/encounters/export` | `encounter_read` |
| GET | `/encounters/{id}/print` | `encounter_read` (HTML view) |

---

## Conventions for every route in this slice (mirror `src/app/api/v1/bills/route.ts`)

```ts
export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, '<capability>');
    const kc = await resolveKcActor(actor);
    // ...validate, call service with encounterScopeFor(kc)...
    return kcOk(data, '<message>');
  }),
);
```

- Import `withAuth` from `@/lib/auth`, `kcHandle`/`kcOk`/`kcFail`/`KcError` from `@/lib/kc-response`, `assertCan` from `@/services/billing/kc-permissions`, `resolveKcActor` from `@/services/billing/kc-actor`.
- Do NOT call `assertBillingEnabled()` — that is billing-specific; encounters are not behind the billing flag.
- Bulk request body shape: `{ ids: number[] }` (+ `{ status: 0|1 }` for bulk-status). Reuse `idsSchema` / `idsStatusSchema` from `@/services/billing/validation`.
- WP encounter status: `0 = closed`, `1 = open` (per `bill.service.ts`). Do not invent other values.

---

## File Structure

**New service:** `src/services/billing/encounter.service.ts` — all encounter data logic + `encounterScopeFor`.
**New render helper:** `src/services/billing/encounter-document.service.ts` — `renderEncounterHtml()` for the print view.
**Modify:** `src/services/billing/kc-permissions.ts` (add 2 capabilities), `src/services/billing/validation.ts` (add encounter schemas).
**New routes under `src/app/api/v1/encounters/`:**
- `route.ts` (GET list, POST create)
- `[id]/route.ts` (GET, PUT, DELETE)
- `bulk/delete/route.ts` (POST)
- `bulk/status/route.ts` (POST)
- `export/route.ts` (GET)
- `[id]/print/route.ts` (GET, HTML)
**Tests:** `tests/billing/encounter.service.test.ts`, `tests/billing/encounter-routes.integration.test.ts`, plus fixtures added to `tests/billing/fixtures.ts`.

`KcPatientEncounter` model fields (from `prisma/schema.prisma`): `id` (BigInt), `encounterDate`→`encounter_date` (DateTime? Date), `clinicId`→`clinic_id`, `doctorId`→`doctor_id`, `patientId`→`patient_id`, `appointmentId`→`appointment_id` (nullable), `description` (Text?), `status` (Int default 0), `addedBy`→`added_by`, `createdAt`→`created_at`, `templateId`→`template_id` (nullable).

---

### Task 1: Capabilities + validation schemas + scope helper

**Files:**
- Modify: `src/services/billing/kc-permissions.ts`
- Modify: `src/services/billing/validation.ts`
- Create: `src/services/billing/encounter.service.ts` (scope helper + types only in this task)
- Test: `tests/billing/kc-permissions.test.ts` (extend)

- [ ] **Step 1: Add a failing capability test**

Append to `tests/billing/kc-permissions.test.ts`:
```ts
import { can } from '@/services/billing/kc-permissions';

describe('encounter capabilities', () => {
  it('grants encounter_read to CLIENT and encounter_manage to PROFESSIONAL', () => {
    expect(can({ id: 'x', role: 'CLIENT', practiceId: null }, 'encounter_read')).toBe(true);
    expect(can({ id: 'x', role: 'PROFESSIONAL', practiceId: null }, 'encounter_manage')).toBe(true);
  });
  it('denies encounter_manage to CLIENT', () => {
    expect(can({ id: 'x', role: 'CLIENT', practiceId: null }, 'encounter_manage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm failure**

Run: `npx vitest run tests/billing/kc-permissions.test.ts`
Expected: FAIL — `'encounter_read'` not assignable to `Capability` (type error) or matrix lookup undefined.

- [ ] **Step 3: Add capabilities in `kc-permissions.ts`**

Add to the `Capability` union:
```ts
  | 'encounter_read'
  | 'encounter_manage';
```
Add to `MATRIX`:
```ts
  encounter_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  encounter_manage: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
```

- [ ] **Step 4: Add validation schemas in `validation.ts`**

Append (reuse existing `idsSchema`, `idsStatusSchema`, `statusSchema` — do not redefine them):
```ts
export const encounterListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  doctorId: z.coerce.number().int().optional(),
  clinicId: z.coerce.number().int().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
  dateFrom: z.string().optional(),   // YYYY-MM-DD
  dateTo: z.string().optional(),     // YYYY-MM-DD
});

export const encounterCreateSchema = z.object({
  patientId: z.coerce.number().int(),
  appointmentId: z.coerce.number().int().optional(),
  clinicId: z.coerce.number().int().optional(),   // admins may set; else derived from actor
  doctorId: z.coerce.number().int().optional(),   // admins may set; else derived from actor
  encounterDate: z.string().optional(),           // YYYY-MM-DD; default today
  description: z.string().max(5000).optional(),
  templateId: z.coerce.number().int().optional(),
});

export const encounterUpdateSchema = z.object({
  description: z.string().max(5000).optional(),
  encounterDate: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
}).strict();
```

- [ ] **Step 5: Create `encounter.service.ts` with scope helper + types**

```ts
// src/services/billing/encounter.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';

export interface EncounterScope {
  clinicId?: bigint;
  doctorId?: bigint;
  patientId?: bigint;
}

/** Role-based row scope, mirroring billScopeFor. */
export function encounterScopeFor(kc: KcActor): EncounterScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null; // unrestricted
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
```

> IMPLEMENTER: confirm the prisma import path used across billing services. `bill.service.ts` imports `prisma` — match whatever it uses (`@/lib/db` or `@/lib/prisma`). Use the SAME path here and in all later tasks.

- [ ] **Step 6: Run tests, confirm pass**

Run: `npx vitest run tests/billing/kc-permissions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/billing/kc-permissions.ts src/services/billing/validation.ts src/services/billing/encounter.service.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(encounters): capabilities, validation schemas, scope helper"
```

---

### Task 2: Encounter service — list, get, create, update, delete

**Files:**
- Modify: `src/services/billing/encounter.service.ts`
- Read for reference: `src/services/billing/bill.service.ts` (`encountersWithoutBill` join SQL, `createBill` encounter lookups).

- [ ] **Step 1: Append list + get + mutations**

```ts
// append to src/services/billing/encounter.service.ts

export interface EncounterListParams {
  page: number;
  perPage: number | 'all';
  patientId?: number;
  doctorId?: number;
  clinicId?: number;
  status?: number;
  dateFrom?: string;
  dateTo?: string;
}

function mapEncounterRow(r: any) {
  return {
    id: Number(r.id),
    encounter_date: r.encounter_date,
    clinic_id: Number(r.clinic_id),
    doctor_id: Number(r.doctor_id),
    patient_id: Number(r.patient_id),
    appointment_id: r.appointment_id != null ? Number(r.appointment_id) : null,
    description: r.description ?? null,
    status: Number(r.status),
    clinic_name: r.clinic_name ?? null,
    doctor_name: r.doctor_name ?? null,
    patient_name: r.patient_name ?? null,
  };
}

export async function listEncounters(p: EncounterListParams, scope: EncounterScope | null) {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];

  if (scope?.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(scope.clinicId); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(scope.doctorId); }
  if (scope?.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(scope.patientId); }

  if (p.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(p.patientId); }
  if (p.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(p.doctorId); }
  if (p.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(p.clinicId); }
  if (p.status !== undefined) { where.push('pe.status = ?'); args.push(p.status); }
  if (p.dateFrom) { where.push('pe.encounter_date >= ?'); args.push(p.dateFrom); }
  if (p.dateTo) { where.push('pe.encounter_date <= ?'); args.push(p.dateTo); }

  const whereSql = where.join(' AND ');
  const baseSql =
    `FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${whereSql}`;

  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${baseSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);

  let limitSql = '';
  const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') {
    const perPage = p.perPage as number;
    limitSql = ' LIMIT ? OFFSET ?';
    pageArgs.push(perPage, (p.page - 1) * perPage);
  }

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${baseSql} ORDER BY pe.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );

  return {
    encounters: rows.map(mapEncounterRow),
    pagination: { page: p.page, perPage: p.perPage, total },
  };
}

export async function getEncounter(id: number, scope: EncounterScope | null) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE pe.id = ?`,
    id,
  );
  const row = rows[0];
  if (!row) throw new KcError('Encounter not found', 404);
  assertInScope(row, scope);
  return mapEncounterRow(row);
}

function assertInScope(row: any, scope: EncounterScope | null) {
  if (!scope) return;
  if (scope.clinicId !== undefined && BigInt(row.clinic_id) !== scope.clinicId) throw new KcError('Encounter not found', 404);
  if (scope.doctorId !== undefined && BigInt(row.doctor_id) !== scope.doctorId) throw new KcError('Encounter not found', 404);
  if (scope.patientId !== undefined && BigInt(row.patient_id) !== scope.patientId) throw new KcError('Encounter not found', 404);
}

export interface EncounterCreateInput {
  patientId: number;
  appointmentId?: number;
  clinicId?: number;
  doctorId?: number;
  encounterDate?: string;
  description?: string;
  templateId?: number;
}

export async function createEncounter(input: EncounterCreateInput, kc: KcActor): Promise<{ id: number }> {
  // Derive clinic/doctor from actor when not explicitly provided (non-super-admin cannot forge).
  const clinicId = kc.actor.role === 'SUPER_ADMIN'
    ? BigInt(input.clinicId ?? 0)
    : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  const doctorId = kc.actor.role === 'PROFESSIONAL'
    ? kc.wpUserId
    : BigInt(input.doctorId ?? Number(kc.wpUserId));

  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  const created = await prisma.kcPatientEncounter.create({
    data: {
      patientId: BigInt(input.patientId),
      appointmentId: input.appointmentId != null ? BigInt(input.appointmentId) : null,
      clinicId,
      doctorId,
      encounterDate: input.encounterDate ? new Date(input.encounterDate) : new Date(),
      description: input.description ?? null,
      status: 1, // open
      addedBy: kc.wpUserId,
      createdAt: new Date(),
      templateId: input.templateId != null ? BigInt(input.templateId) : null,
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export interface EncounterUpdateInput {
  description?: string;
  encounterDate?: string;
  status?: number;
}

export async function updateEncounter(id: number, input: EncounterUpdateInput, scope: EncounterScope | null): Promise<void> {
  await getEncounter(id, scope); // scope + existence check (throws 404)
  await prisma.kcPatientEncounter.update({
    where: { id: BigInt(id) },
    data: {
      description: input.description ?? undefined,
      encounterDate: input.encounterDate ? new Date(input.encounterDate) : undefined,
      status: input.status ?? undefined,
    },
  });
}

export async function deleteEncounter(id: number, scope: EncounterScope | null): Promise<void> {
  await getEncounter(id, scope); // scope + existence check
  await prisma.kcPatientEncounter.delete({ where: { id: BigInt(id) } });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | grep encounter.service | head`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/services/billing/encounter.service.ts
git commit -m "feat(encounters): service list/get/create/update/delete"
```

---

### Task 3: Encounter service — bulk delete, bulk status, export

**Files:**
- Modify: `src/services/billing/encounter.service.ts`
- Reference: `src/services/billing/tax.service.ts` (`bulkSetTaxStatus`), `bill.service.ts` (`exportBills`).

- [ ] **Step 1: Append bulk + export**

```ts
// append to src/services/billing/encounter.service.ts

/** Scoped bulk delete: only rows within the actor's scope are removed. */
export async function bulkDeleteEncounters(ids: number[], scope: EncounterScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const where: any = { id: { in: ids.map((n) => BigInt(n)) } };
  if (scope?.clinicId !== undefined) where.clinicId = scope.clinicId;
  if (scope?.doctorId !== undefined) where.doctorId = scope.doctorId;
  if (scope?.patientId !== undefined) where.patientId = scope.patientId;
  const r = await prisma.kcPatientEncounter.deleteMany({ where });
  return r.count;
}

export async function bulkSetEncounterStatus(ids: number[], status: number, scope: EncounterScope | null): Promise<number> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  if (ids.length === 0) return 0;
  const where: any = { id: { in: ids.map((n) => BigInt(n)) } };
  if (scope?.clinicId !== undefined) where.clinicId = scope.clinicId;
  if (scope?.doctorId !== undefined) where.doctorId = scope.doctorId;
  if (scope?.patientId !== undefined) where.patientId = scope.patientId;
  const r = await prisma.kcPatientEncounter.updateMany({ where, data: { status } });
  return r.count;
}

export async function exportEncounters(p: EncounterListParams, scope: EncounterScope | null) {
  const list = await listEncounters({ ...p, perPage: 'all', page: 1 }, scope);
  const encounters = list.encounters.map((e) => ({
    id: e.id,
    encounter_date: e.encounter_date,
    patient_name: e.patient_name,
    doctor_name: e.doctor_name,
    clinic_name: e.clinic_name,
    status: e.status,
    description: e.description,
  }));
  return { encounters };
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep encounter.service | head` → no output.
```bash
git add src/services/billing/encounter.service.ts
git commit -m "feat(encounters): bulk delete/status + export"
```

---

### Task 4: Core REST routes (list, create, get, update, delete)

**Files:**
- Create: `src/app/api/v1/encounters/route.ts`
- Create: `src/app/api/v1/encounters/[id]/route.ts`
- Reference: `src/app/api/v1/bills/route.ts`, `src/app/api/v1/bills/[id]/route.ts`.

- [ ] **Step 1: `encounters/route.ts` (GET list, POST create)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encounterListQuerySchema, encounterCreateSchema } from '@/services/billing/validation';
import { listEncounters, createEncounter, encounterScopeFor } from '@/services/billing/encounter.service';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const parsed = encounterListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await listEncounters(parsed.data as any, encounterScopeFor(kc));
    return kcOk(data, 'Encounters retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = encounterCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const created = await createEncounter(parsed.data as any, kc);
    return kcOk(created, 'Encounter created successfully');
  }),
);
```

- [ ] **Step 2: `encounters/[id]/route.ts` (GET, PUT, DELETE)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encounterUpdateSchema } from '@/services/billing/validation';
import { getEncounter, updateEncounter, deleteEncounter, encounterScopeFor } from '@/services/billing/encounter.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const data = await getEncounter(Number(params.id), encounterScopeFor(kc));
    return kcOk(data, 'Encounter retrieved successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = encounterUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    await updateEncounter(Number(params.id), parsed.data, encounterScopeFor(kc));
    return kcOk(null, 'Encounter updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    await deleteEncounter(Number(params.id), encounterScopeFor(kc));
    return kcOk(null, 'Encounter deleted successfully');
  }),
);
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep "encounters/" | head` → no output.
```bash
git add src/app/api/v1/encounters/route.ts "src/app/api/v1/encounters/[id]/route.ts"
git commit -m "feat(encounters): core REST routes (list/create/get/update/delete)"
```

---

### Task 5: Bulk + export routes

**Files:**
- Create: `src/app/api/v1/encounters/bulk/delete/route.ts`
- Create: `src/app/api/v1/encounters/bulk/status/route.ts`
- Create: `src/app/api/v1/encounters/export/route.ts`
- Reference: `src/app/api/v1/taxes/bulk/status/route.ts`, `src/app/api/v1/bills/export/route.ts`.

- [ ] **Step 1: `bulk/delete/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { idsSchema } from '@/services/billing/validation';
import { bulkDeleteEncounters, encounterScopeFor } from '@/services/billing/encounter.service';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkDeleteEncounters(parsed.data.ids, encounterScopeFor(kc));
    return kcOk({ updated: n }, `${n} encounters deleted.`);
  }),
);
```

- [ ] **Step 2: `bulk/status/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { idsStatusSchema } from '@/services/billing/validation';
import { bulkSetEncounterStatus, encounterScopeFor } from '@/services/billing/encounter.service';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_manage');
    const kc = await resolveKcActor(actor);
    const parsed = idsStatusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkSetEncounterStatus(parsed.data.ids, parsed.data.status, encounterScopeFor(kc));
    return kcOk({ updated: n }, `${n} encounters status updated.`);
  }),
);
```

> IMPLEMENTER: confirm `idsStatusSchema` exposes `.status` as a number (from `statusSchema`). If `statusSchema` names the field differently, adjust.

- [ ] **Step 3: `export/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encounterListQuerySchema } from '@/services/billing/validation';
import { exportEncounters, encounterScopeFor } from '@/services/billing/encounter.service';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const parsed = encounterListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await exportEncounters(parsed.data as any, encounterScopeFor(kc));
    return kcOk(data, 'Encounters data retrieved successfully');
  }),
);
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep "encounters/" | head` → no output.
```bash
git add src/app/api/v1/encounters/bulk src/app/api/v1/encounters/export
git commit -m "feat(encounters): bulk delete/status + export routes"
```

---

### Task 6: Print (HTML) route + renderer

**Files:**
- Create: `src/services/billing/encounter-document.service.ts`
- Create: `src/app/api/v1/encounters/[id]/print/route.ts`
- Reference: `src/services/billing/bill-document.service.ts` (`renderInvoiceHtml` escaping approach). The design specifies an **HTML print view** for encounters (not PDF), so return `text/html` directly — no Puppeteer.

- [ ] **Step 1: Create the renderer**

```ts
// src/services/billing/encounter-document.service.ts
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface EncounterView {
  id: number;
  encounter_date: unknown;
  patient_name: string | null;
  doctor_name: string | null;
  clinic_name: string | null;
  status: number;
  description: string | null;
}

export function renderEncounterHtml(e: EncounterView): string {
  const statusLabel = e.status === 0 ? 'Closed' : 'Open';
  const date = e.encounter_date ? String(e.encounter_date).slice(0, 10) : '-';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Encounter #${esc(e.id)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #222; }
  h1 { font-size: 20px; } .row { margin: 8px 0; } .label { font-weight: bold; width: 140px; display: inline-block; }
  .notes { margin-top: 16px; white-space: pre-wrap; border-top: 1px solid #ccc; padding-top: 12px; }
</style></head>
<body>
  <h1>Encounter #${esc(e.id)}</h1>
  <div class="row"><span class="label">Date</span> ${esc(date)}</div>
  <div class="row"><span class="label">Patient</span> ${esc(e.patient_name)}</div>
  <div class="row"><span class="label">Doctor</span> ${esc(e.doctor_name)}</div>
  <div class="row"><span class="label">Clinic</span> ${esc(e.clinic_name)}</div>
  <div class="row"><span class="label">Status</span> ${esc(statusLabel)}</div>
  <div class="notes"><strong>Clinical notes</strong><br>${esc(e.description) || '<em>None</em>'}</div>
</body></html>`;
}
```

- [ ] **Step 2: Create the print route**

```ts
// src/app/api/v1/encounters/[id]/print/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, KcError } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getEncounter, encounterScopeFor } from '@/services/billing/encounter.service';
import { renderEncounterHtml } from '@/services/billing/encounter-document.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    assertCan(actor, 'encounter_read');
    const kc = await resolveKcActor(actor);
    const encounter = await getEncounter(Number(params.id), encounterScopeFor(kc));
    const html = renderEncounterHtml(encounter as any);
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="encounter_${params.id}.html"`,
      },
    });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    console.error('[kc] encounter print failed', err);
    return kcFail('Failed to render encounter', 500);
  }
});
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "encounter-document|encounters/.*print" | head` → no output.
```bash
git add src/services/billing/encounter-document.service.ts "src/app/api/v1/encounters/[id]/print/route.ts"
git commit -m "feat(encounters): HTML print view"
```

---

### Task 7: Tests + full-suite/tsc close-out

**Files:**
- Modify: `tests/billing/fixtures.ts` (add encounter seed/cleanup)
- Create: `tests/billing/encounter.service.test.ts`
- Create: `tests/billing/encounter-routes.integration.test.ts`
- Reference: `tests/billing/bill.service.test.ts`, `tests/billing/fixtures.ts`, `tests/billing/routes.integration.test.ts`.

**Context:** These tests hit the real test DB. `fixtures.ts` guards with `assertTestDb()` and uses `TEST_MARKER = 9_000_000`. Add encounter fixtures in that range so cleanup is safe.

- [ ] **Step 1: Add encounter fixture helpers to `tests/billing/fixtures.ts`**

```ts
// append inside fixtures.ts (near seedTax)
export async function seedEncounter(data: Partial<{
  id: number; clinicId: number; doctorId: number; patientId: number;
  status: number; description: string; encounterDate: Date;
}>) {
  assertTestDb();
  return prisma.kcPatientEncounter.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 500),
      clinicId: BigInt(data.clinicId ?? TEST_MARKER + 1),
      doctorId: BigInt(data.doctorId ?? TEST_MARKER + 2),
      patientId: BigInt(data.patientId ?? TEST_MARKER + 3),
      status: data.status ?? 1,
      description: data.description ?? 'Test encounter',
      encounterDate: data.encounterDate ?? new Date('2026-01-15'),
      addedBy: BigInt(TEST_MARKER + 2),
      createdAt: new Date('2026-01-15'),
    },
  });
}
```
Extend the existing `cleanup()` to also delete encounters:
```ts
  await prisma.kcPatientEncounter.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
```

- [ ] **Step 2: Service tests `tests/billing/encounter.service.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedEncounter, cleanup } from './fixtures';
import {
  listEncounters, getEncounter, createEncounter, updateEncounter,
  deleteEncounter, bulkSetEncounterStatus, bulkDeleteEncounters,
} from '@/services/billing/encounter.service';

const CLINIC = 9_000_701, DOCTOR = 9_000_702, PATIENT = 9_000_703;
const kcSuper = { actor: { id: 'a', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;

describe('encounter.service', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); });
  afterAll(cleanup);

  it('creates, reads, lists, updates status, and deletes an encounter', async () => {
    const { id } = await createEncounter({ patientId: PATIENT, clinicId: CLINIC, doctorId: DOCTOR, description: 'hello' }, kcSuper);
    expect(id).toBeGreaterThan(0);

    const got = await getEncounter(id, null);
    expect(got.description).toBe('hello');

    const list = await listEncounters({ page: 1, perPage: 10, clinicId: CLINIC } as any, null);
    expect(list.encounters.some((e) => e.id === id)).toBe(true);

    await updateEncounter(id, { status: 0 }, null);
    expect((await getEncounter(id, null)).status).toBe(0);

    const n = await bulkSetEncounterStatus([id], 1, null);
    expect(n).toBe(1);

    await deleteEncounter(id, null);
    await expect(getEncounter(id, null)).rejects.toThrow();
  });

  it('scopes reads: a CLIENT cannot see another patient\'s encounter', async () => {
    const seeded = await seedEncounter({ id: 9_000_710, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    await expect(getEncounter(Number(seeded.id), { patientId: BigInt(PATIENT + 999) })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Route integration tests `tests/billing/encounter-routes.integration.test.ts`**

Mirror `tests/billing/routes.integration.test.ts` — build a JWT for each role, hit the route handlers, assert the KC envelope (`{ status: true, data }`) and the auth matrix (401 no token, 403 wrong role). Cover at minimum: GET `/encounters` as CLINIC_ADMIN → 200; POST `/encounters` as CLIENT → 403; GET `/encounters` with no token → 401.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { assertTestDb, cleanup, seedEncounter } from './fixtures';
import { GET as listGET, POST as createPOST } from '@/app/api/v1/encounters/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
async function token(role: string, sub = 'u1') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function req(jwt?: string, url = 'http://x/api/v1/encounters', init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jwt) headers.set('authorization', `Bearer ${jwt}`);
  return new NextRequest(url, { ...init, headers });
}

describe('encounter routes auth matrix', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedEncounter({ id: 9_000_720 }); });
  afterAll(cleanup);

  it('401 without a token', async () => {
    const res = await listGET(req(), { params: {} } as any);
    expect(res.status).toBe(401);
  });
  it('403 when a CLIENT tries to create', async () => {
    const res = await createPOST(req(await token('CLIENT'), 'http://x/api/v1/encounters', {
      method: 'POST', body: JSON.stringify({ patientId: 1 }), headers: { 'content-type': 'application/json' },
    }), { params: {} } as any);
    expect(res.status).toBe(403);
  });
});
```

> IMPLEMENTER: the exact JWT/actor→wpUserId wiring may require a real `User` row with `wpUserId` for `resolveKcActor` to succeed on the happy path. Look at how `tests/billing/routes.integration.test.ts` seeds the user/actor and copy that setup. If a full happy-path 200 needs heavy fixture wiring, it is acceptable to assert the auth matrix (401/403) here and rely on the service tests (Task 7 Step 2) for behavior — but do cover at least one 200 if the existing billing integration test shows how.

- [ ] **Step 4: Run encounter tests**

Run: `npx vitest run tests/billing/encounter.service.test.ts tests/billing/encounter-routes.integration.test.ts tests/billing/kc-permissions.test.ts`
Expected: all pass. (Requires a test DB per `assertTestDb`. If `DATABASE_URL` is not a test DB in this environment, the fixtures throw by design — in that case run the permission unit test and note the DB-backed suites need the test DB, matching how the existing billing suites run.)

- [ ] **Step 5: Full suite + tsc**

Run: `npx vitest run 2>&1 | tail -20` — confirm no NEW failures vs the known pre-existing baseline (~33 failing files: booking/intervention-plan/professional/session/email-template units + the `vi.mock` hoisting bug).
Run: `npx tsc --noEmit 2>&1 | grep -E "encounter" | head` — no output.

- [ ] **Step 6: Commit**

```bash
git add tests/billing/fixtures.ts tests/billing/encounter.service.test.ts tests/billing/encounter-routes.integration.test.ts
git commit -m "test(encounters): service + route integration tests"
```

---

## Self-Review

**Spec coverage** (design Slice 3, 9 endpoints): GET list (Task 4), POST create (Task 4), GET/{id} (Task 4), PUT/{id} (Task 4), DELETE/{id} (Task 4), POST bulk/delete (Task 5), POST bulk/status (Task 5), GET export (Task 5), GET /{id}/print (Task 6). All 9 covered. Capabilities `encounter_read`/`encounter_manage` added in Task 1.

**Placeholder scan:** No TODO/TBD. Three IMPLEMENTER notes flag genuine environment-verification points (prisma import path, `statusSchema` field name, and the integration-test fixture wiring) — each names the reference file to copy from. No unspecified code.

**Type consistency:** `EncounterScope` / `encounterScopeFor` defined in Task 1, consumed by every service fn (Tasks 2–3) and route (Tasks 4–6). `EncounterListParams` (Task 2) reused by `exportEncounters` (Task 3). `mapEncounterRow` output shape feeds `EncounterView` in the renderer (Task 6) — fields `id, encounter_date, patient_name, doctor_name, clinic_name, status, description` match. Bulk endpoints use `idsSchema`/`idsStatusSchema` from existing validation. Print is HTML per the design (no Puppeteer), distinct from the bill PDF path.
