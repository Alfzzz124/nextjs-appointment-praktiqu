# KiviCare Prescriptions + Medical History (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Prescriptions (`/api/v1/prescriptions`, 7 endpoints) and Medical History (`/api/v1/medical-history`, 6 endpoints) CRUD modules over the WordPress `wp_kc_prescription` and `wp_kc_medical_history` tables, following the KC billing/encounter pattern.

**Architecture:** KC raw-SQL pattern — `withAuth` + `kcHandle` + `assertCan` + `resolveKcActor`. Data lives in WP tables (BigInt IDs). Writes use new `KcPrescription` / `KcMedicalHistory` Prisma models (typed, parameterized); scoped reads use `prisma.$queryRawUnsafe` with a JOIN to `wp_kc_patient_encounters` (because neither table stores doctor_id/clinic_id directly — scope is derived from the parent encounter).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL (raw SQL for WP tables), Zod, Vitest.

**Branch:** `feat/kc-prescriptions-medical-history` (already created from `main`).

## CONFIRMED live schema (introspected from `wordpress-praktiqu`)

`wp_kc_prescription` (88 rows):
```
id            bigint            PK
encounter_id  bigint unsigned   NOT NULL
patient_id    bigint unsigned   NOT NULL
name          text                        -- medicine name
frequency     varchar(199)
duration      varchar(199)
instruction   text
added_by      bigint unsigned   NOT NULL
created_at    datetime
is_from_template tinyint        default 0
```
No `doctor_id`, `clinic_id`, or `dosage` columns.

`wp_kc_medical_history` (1167 rows):
```
id            bigint            PK
encounter_id  bigint unsigned   NOT NULL
patient_id    bigint unsigned   NOT NULL
type          varchar(191)      NOT NULL   -- category
title         text
added_by      bigint unsigned   NOT NULL
created_at    datetime
is_from_template tinyint        default 0
```
No `doctor_id`, `clinic_id`, or `description` columns. The record body is `title`; `type` is a required category string.

Both scope through `wp_kc_patient_encounters` (columns `id, doctor_id, clinic_id, patient_id`).

## Endpoints

Prescriptions (7): GET `/prescriptions`, POST `/prescriptions`, GET `/prescriptions/{id}`, PUT `/prescriptions/{id}`, DELETE `/prescriptions/{id}`, GET `/prescriptions/export`, POST `/prescriptions/bulk/delete`.
Medical History (6): GET `/medical-history`, POST `/medical-history`, GET `/medical-history/{id}`, PUT `/medical-history/{id}`, DELETE `/medical-history/{id}`, GET `/medical-history/export`.

## Scope model (shared shape)

Because the leaf tables lack doctor_id/clinic_id, scope filters via the joined encounter:
```ts
export interface KcLeafScope {
  patientId?: bigint;    // CLIENT — leaf.patient_id = ?
  encDoctorId?: bigint;  // PROFESSIONAL — enc.doctor_id = ?
  encClinicId?: bigint;  // CLINIC_ADMIN / RECEPTIONIST — enc.clinic_id = ?
}
// null => SUPER_ADMIN (unrestricted)
export function leafScopeFor(kc: KcActor): KcLeafScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { encClinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { encDoctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { encClinicId: -1n };
  }
}
```

## DB SAFETY (read first)

There is **only the live `wordpress-praktiqu` database** — no test DB. DB-backed tests MUST NOT run here (the `assertTestDb()` guard in `tests/billing/fixtures.ts` enforces this; keep it intact). Write DB-backed tests correctly but do not execute them against the live DB. `prisma generate` is safe (regenerates the client, does not touch the DB). Never run `prisma migrate` / `db push`.

---

### Task 1: Prisma models + capabilities + validation + shared scope helper

**Files:**
- Modify: `prisma/schema.prisma` (add two read/write models)
- Modify: `src/services/billing/kc-permissions.ts`
- Modify: `src/services/billing/validation.ts`
- Create: `src/services/billing/kc-leaf-scope.ts` (shared `leafScopeFor`)
- Test: `tests/billing/kc-permissions.test.ts` (extend)

- [ ] **Step 1: Add Prisma models to `prisma/schema.prisma`**

Add near the other `Kc*` models (mirror `KcPatientEncounter`'s `@@map` style):
```prisma
model KcPrescription {
  id             BigInt    @id @default(autoincrement())
  encounterId    BigInt    @map("encounter_id") @db.UnsignedBigInt
  patientId      BigInt    @map("patient_id") @db.UnsignedBigInt
  name           String?   @db.Text
  frequency      String?   @db.VarChar(199)
  duration       String?   @db.VarChar(199)
  instruction    String?   @db.Text
  addedBy        BigInt    @map("added_by") @db.UnsignedBigInt
  createdAt      DateTime? @map("created_at")
  isFromTemplate Int?      @default(0) @map("is_from_template") @db.TinyInt

  @@map("wp_kc_prescription")
}

model KcMedicalHistory {
  id             BigInt    @id @default(autoincrement())
  encounterId    BigInt    @map("encounter_id") @db.UnsignedBigInt
  patientId      BigInt    @map("patient_id") @db.UnsignedBigInt
  type           String    @db.VarChar(191)
  title          String?   @db.Text
  addedBy        BigInt    @map("added_by") @db.UnsignedBigInt
  createdAt      DateTime? @map("created_at")
  isFromTemplate Int?      @default(0) @map("is_from_template") @db.TinyInt

  @@map("wp_kc_medical_history")
}
```

> IMPLEMENTER: confirm `@db.UnsignedBigInt` is the correct Prisma attribute for `bigint unsigned` in this schema's provider version. If the existing `Kc*` models represent unsigned bigints differently (e.g. plain `BigInt` without `@db.UnsignedBigInt`), match whatever `KcPatientEncounter.doctorId` / `KcBill` uses. The goal is `prisma generate` succeeding and reads/writes working — do not run `prisma migrate`.

- [ ] **Step 2: Regenerate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". (Does NOT touch the DB.) If it errors on the unsigned attribute, adjust per the note above and re-run.

- [ ] **Step 3: Add capabilities in `kc-permissions.ts`**

Add to the `Capability` union: `'prescription_read' | 'prescription_manage' | 'medical_history_read' | 'medical_history_manage'`.
Add to `MATRIX`:
```ts
  prescription_read:      ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  prescription_manage:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
  medical_history_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  medical_history_manage: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
```

- [ ] **Step 4: Add validation schemas in `validation.ts`**

```ts
export const prescriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  encounterId: z.coerce.number().int().optional(),
  search: z.string().optional(),  // matches prescription.name
});
export const prescriptionCreateSchema = z.object({
  encounterId: z.coerce.number().int(),
  patientId: z.coerce.number().int(),
  name: z.string().min(1).max(2000),
  frequency: z.string().max(199).optional(),
  duration: z.string().max(199).optional(),
  instruction: z.string().max(5000).optional(),
});
export const prescriptionUpdateSchema = z.object({
  name: z.string().min(1).max(2000).optional(),
  frequency: z.string().max(199).optional(),
  duration: z.string().max(199).optional(),
  instruction: z.string().max(5000).optional(),
}).strict();

export const medicalHistoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  encounterId: z.coerce.number().int().optional(),
  type: z.string().optional(),
  search: z.string().optional(),  // matches title
});
export const medicalHistoryCreateSchema = z.object({
  encounterId: z.coerce.number().int(),
  patientId: z.coerce.number().int(),
  type: z.string().min(1).max(191).default('general'),
  title: z.string().min(1).max(5000),
});
export const medicalHistoryUpdateSchema = z.object({
  type: z.string().min(1).max(191).optional(),
  title: z.string().min(1).max(5000).optional(),
}).strict();
```
(Reuse existing `idsSchema` for bulk delete.)

- [ ] **Step 5: Create `src/services/billing/kc-leaf-scope.ts`**

```ts
import type { KcActor } from '@/services/billing/kc-actor';

export interface KcLeafScope {
  patientId?: bigint;
  encDoctorId?: bigint;
  encClinicId?: bigint;
}

export function leafScopeFor(kc: KcActor): KcLeafScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { encClinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { encDoctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { encClinicId: -1n };
  }
}
```

- [ ] **Step 6: Add + run a capability test**

Append to `tests/billing/kc-permissions.test.ts`:
```ts
describe('prescription + medical_history capabilities', () => {
  it('read granted to CLIENT, manage denied to CLIENT', () => {
    const client = { id: 'x', role: 'CLIENT', practiceId: null } as const;
    expect(can(client, 'prescription_read')).toBe(true);
    expect(can(client, 'prescription_manage')).toBe(false);
    expect(can(client, 'medical_history_read')).toBe(true);
    expect(can(client, 'medical_history_manage')).toBe(false);
  });
  it('manage granted to PROFESSIONAL', () => {
    const pro = { id: 'x', role: 'PROFESSIONAL', practiceId: null } as const;
    expect(can(pro, 'prescription_manage')).toBe(true);
    expect(can(pro, 'medical_history_manage')).toBe(true);
  });
});
```
Run: `npx vitest run tests/billing/kc-permissions.test.ts` → PASS.

- [ ] **Step 7: Commit**
```bash
git add prisma/schema.prisma src/services/billing/kc-permissions.ts src/services/billing/validation.ts src/services/billing/kc-leaf-scope.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(rx+mh): Kc models, capabilities, validation, leaf scope helper"
```

---

### Task 2: Prescription service

**Files:**
- Create: `src/services/billing/prescription.service.ts`
- Reference: `src/services/billing/encounter.service.ts` (scope-check + raw-SQL join pattern), `bill.service.ts` (prisma import path — use the SAME, `@/lib/db`).

- [ ] **Step 1: Write the service**

```ts
// src/services/billing/prescription.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { KcLeafScope } from '@/services/billing/kc-leaf-scope';

export interface PrescriptionListParams {
  page: number;
  perPage: number | 'all';
  patientId?: number;
  encounterId?: number;
  search?: string;
}

function mapRow(r: any) {
  return {
    id: Number(r.id),
    encounter_id: Number(r.encounter_id),
    patient_id: Number(r.patient_id),
    name: r.name ?? null,
    frequency: r.frequency ?? null,
    duration: r.duration ?? null,
    instruction: r.instruction ?? null,
    created_at: r.created_at,
    patient_name: r.patient_name ?? null,
    doctor_name: r.doctor_name ?? null,
    clinic_name: r.clinic_name ?? null,
  };
}

/** Build the shared WHERE fragments + args for scope + filters. Always joined to encounters `enc`. */
function buildWhere(scope: KcLeafScope | null, p: Partial<PrescriptionListParams>) {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('rx.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.encDoctorId !== undefined) { where.push('enc.doctor_id = ?'); args.push(scope.encDoctorId); }
  if (scope?.encClinicId !== undefined) { where.push('enc.clinic_id = ?'); args.push(scope.encClinicId); }
  if (p.patientId !== undefined) { where.push('rx.patient_id = ?'); args.push(p.patientId); }
  if (p.encounterId !== undefined) { where.push('rx.encounter_id = ?'); args.push(p.encounterId); }
  if (p.search) { where.push('rx.name LIKE ?'); args.push(`%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

const BASE_JOIN =
  `FROM wp_kc_prescription rx
   LEFT JOIN wp_kc_patient_encounters enc ON rx.encounter_id = enc.id
   LEFT JOIN wp_kc_clinics c ON enc.clinic_id = c.id
   LEFT JOIN wp_users d ON enc.doctor_id = d.ID
   LEFT JOIN wp_users pt ON rx.patient_id = pt.ID`;

export async function listPrescriptions(p: PrescriptionListParams, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} ORDER BY rx.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { prescriptions: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getPrescription(id: number, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} AND rx.id = ?`,
    ...args, id,
  );
  if (!rows[0]) throw new KcError('Prescription not found', 404);
  return mapRow(rows[0]);
}

export interface PrescriptionCreateInput {
  encounterId: number; patientId: number;
  name: string; frequency?: string; duration?: string; instruction?: string;
}

export async function createPrescription(input: PrescriptionCreateInput, kc: KcActor): Promise<{ id: number }> {
  // Scope guard: verify the target encounter is within the actor's scope before attaching.
  await assertEncounterInScope(input.encounterId, kc);
  const created = await prisma.kcPrescription.create({
    data: {
      encounterId: BigInt(input.encounterId),
      patientId: BigInt(input.patientId),
      name: input.name,
      frequency: input.frequency ?? null,
      duration: input.duration ?? null,
      instruction: input.instruction ?? null,
      addedBy: kc.wpUserId,
      createdAt: new Date(),
      isFromTemplate: 0,
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export interface PrescriptionUpdateInput { name?: string; frequency?: string; duration?: string; instruction?: string; }

export async function updatePrescription(id: number, input: PrescriptionUpdateInput, scope: KcLeafScope | null): Promise<void> {
  await getPrescription(id, scope); // scope + existence (404)
  await prisma.kcPrescription.update({
    where: { id: BigInt(id) },
    data: {
      name: input.name ?? undefined,
      frequency: input.frequency ?? undefined,
      duration: input.duration ?? undefined,
      instruction: input.instruction ?? undefined,
    },
  });
}

export async function deletePrescription(id: number, scope: KcLeafScope | null): Promise<void> {
  await getPrescription(id, scope);
  await prisma.kcPrescription.delete({ where: { id: BigInt(id) } });
}

export async function bulkDeletePrescriptions(ids: number[], scope: KcLeafScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  // Resolve which of the requested ids are in-scope (via join), then delete only those.
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.id ${BASE_JOIN} WHERE ${whereSql} AND rx.id IN (${placeholders})`,
    ...args, ...ids,
  );
  const okIds = inScope.map((r) => BigInt(r.id));
  if (okIds.length === 0) return 0;
  const r = await prisma.kcPrescription.deleteMany({ where: { id: { in: okIds } } });
  return r.count;
}

export async function exportPrescriptions(p: PrescriptionListParams, scope: KcLeafScope | null) {
  const list = await listPrescriptions({ ...p, perPage: 'all', page: 1 }, scope);
  return {
    prescriptions: list.prescriptions.map((x) => ({
      id: x.id, name: x.name, frequency: x.frequency, duration: x.duration,
      instruction: x.instruction, patient_name: x.patient_name, doctor_name: x.doctor_name,
      clinic_name: x.clinic_name, created_at: x.created_at,
    })),
  };
}

/** Shared: throw 404 unless the encounter is visible under the actor's scope. */
export async function assertEncounterInScope(encounterId: number, kc: KcActor): Promise<void> {
  if (kc.actor.role === 'SUPER_ADMIN') return;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, doctor_id, clinic_id, patient_id FROM wp_kc_patient_encounters WHERE id = ?`, encounterId,
  );
  const enc = rows[0];
  if (!enc) throw new KcError('Encounter not found', 404);
  const role = kc.actor.role;
  if ((role === 'CLINIC_ADMIN' || role === 'RECEPTIONIST') && BigInt(enc.clinic_id) !== (kc.clinicId ?? -1n)) throw new KcError('Encounter not found', 404);
  if (role === 'PROFESSIONAL' && BigInt(enc.doctor_id) !== kc.wpUserId) throw new KcError('Encounter not found', 404);
  if (role === 'CLIENT' && BigInt(enc.patient_id) !== kc.wpUserId) throw new KcError('Encounter not found', 404);
}
```

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep prescription.service | head` → no output.
```bash
git add src/services/billing/prescription.service.ts
git commit -m "feat(rx): prescription service (scoped via encounter join)"
```

---

### Task 3: Prescription routes

**Files:**
- Create: `src/app/api/v1/prescriptions/route.ts` (GET list, POST create)
- Create: `src/app/api/v1/prescriptions/[id]/route.ts` (GET, PUT, DELETE)
- Create: `src/app/api/v1/prescriptions/bulk/delete/route.ts` (POST)
- Create: `src/app/api/v1/prescriptions/export/route.ts` (GET)
- Reference: `src/app/api/v1/encounters/route.ts`, `[id]/route.ts`, `bulk/delete/route.ts`, `export/route.ts` — copy the wiring exactly, swapping service/schema/capability names.

- [ ] **Step 1: `prescriptions/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { prescriptionListQuerySchema, prescriptionCreateSchema } from '@/services/billing/validation';
import { listPrescriptions, createPrescription } from '@/services/billing/prescription.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_read');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listPrescriptions(parsed.data as any, leafScopeFor(kc)), 'Prescriptions retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createPrescription(parsed.data as any, kc), 'Prescription created successfully');
}));
```

- [ ] **Step 2: `prescriptions/[id]/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { prescriptionUpdateSchema } from '@/services/billing/validation';
import { getPrescription, updatePrescription, deletePrescription } from '@/services/billing/prescription.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getPrescription(Number(params.id), leafScopeFor(kc)), 'Prescription retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updatePrescription(Number(params.id), parsed.data, leafScopeFor(kc));
  return kcOk(null, 'Prescription updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  await deletePrescription(Number(params.id), leafScopeFor(kc));
  return kcOk(null, 'Prescription deleted successfully');
}));
```

- [ ] **Step 3: `prescriptions/bulk/delete/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { idsSchema } from '@/services/billing/validation';
import { bulkDeletePrescriptions } from '@/services/billing/prescription.service';

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_manage');
  const kc = await resolveKcActor(actor);
  const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const n = await bulkDeletePrescriptions(parsed.data.ids, leafScopeFor(kc));
  return kcOk({ updated: n }, `${n} prescriptions deleted.`);
}));
```

- [ ] **Step 4: `prescriptions/export/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { leafScopeFor } from '@/services/billing/kc-leaf-scope';
import { prescriptionListQuerySchema } from '@/services/billing/validation';
import { exportPrescriptions } from '@/services/billing/prescription.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'prescription_read');
  const kc = await resolveKcActor(actor);
  const parsed = prescriptionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await exportPrescriptions(parsed.data as any, leafScopeFor(kc)), 'Prescriptions data retrieved successfully');
}));
```

- [ ] **Step 5: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "prescriptions/" | head` → no output.
```bash
git add src/app/api/v1/prescriptions
git commit -m "feat(rx): prescription REST routes (list/create/get/update/delete/bulk/export)"
```

---

### Task 4: Medical History service

**Files:**
- Create: `src/services/billing/medical-history.service.ts`
- Reference: `prescription.service.ts` (same join-scope shape; table is `wp_kc_medical_history`, body column is `title`, required category is `type`).

- [ ] **Step 1: Write the service**

Mirror `prescription.service.ts` exactly with these substitutions:
- Table alias `mh` on `wp_kc_medical_history` (join `enc` on `mh.encounter_id = enc.id`, same clinic/doctor/patient joins).
- `mapRow` returns `{ id, encounter_id, patient_id, type, title, created_at, patient_name, doctor_name, clinic_name }`.
- `buildWhere` search matches `mh.title LIKE ?`; add optional `type` filter (`mh.type = ?`).
- Uses `prisma.kcMedicalHistory` for create/update/delete.
- `createMedicalHistory(input, kc)` writes `{ encounterId, patientId, type: input.type, title: input.title, addedBy: kc.wpUserId, createdAt: new Date(), isFromTemplate: 0 }`, after `assertEncounterInScope(input.encounterId, kc)` (import it from `prescription.service` or duplicate the helper — prefer importing to stay DRY).
- `updateMedicalHistory` updates `type`/`title` only.
- No bulk delete required by the design for medical history, but INCLUDE `exportMedicalHistory` mirroring `exportPrescriptions`.

Full code (write it out; do not leave as prose in the actual file):
```ts
// src/services/billing/medical-history.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { KcLeafScope } from '@/services/billing/kc-leaf-scope';
import { assertEncounterInScope } from '@/services/billing/prescription.service';

export interface MedicalHistoryListParams {
  page: number; perPage: number | 'all';
  patientId?: number; encounterId?: number; type?: string; search?: string;
}

function mapRow(r: any) {
  return {
    id: Number(r.id), encounter_id: Number(r.encounter_id), patient_id: Number(r.patient_id),
    type: r.type ?? null, title: r.title ?? null, created_at: r.created_at,
    patient_name: r.patient_name ?? null, doctor_name: r.doctor_name ?? null, clinic_name: r.clinic_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_medical_history mh
   LEFT JOIN wp_kc_patient_encounters enc ON mh.encounter_id = enc.id
   LEFT JOIN wp_kc_clinics c ON enc.clinic_id = c.id
   LEFT JOIN wp_users d ON enc.doctor_id = d.ID
   LEFT JOIN wp_users pt ON mh.patient_id = pt.ID`;

function buildWhere(scope: KcLeafScope | null, p: Partial<MedicalHistoryListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('mh.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.encDoctorId !== undefined) { where.push('enc.doctor_id = ?'); args.push(scope.encDoctorId); }
  if (scope?.encClinicId !== undefined) { where.push('enc.clinic_id = ?'); args.push(scope.encClinicId); }
  if (p.patientId !== undefined) { where.push('mh.patient_id = ?'); args.push(p.patientId); }
  if (p.encounterId !== undefined) { where.push('mh.encounter_id = ?'); args.push(p.encounterId); }
  if (p.type) { where.push('mh.type = ?'); args.push(p.type); }
  if (p.search) { where.push('mh.title LIKE ?'); args.push(`%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

export async function listMedicalHistory(p: MedicalHistoryListParams, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mh.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} ORDER BY mh.id DESC${limitSql}`, ...args, ...pageArgs,
  );
  return { medicalHistory: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getMedicalHistory(id: number, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mh.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} AND mh.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Medical history record not found', 404);
  return mapRow(rows[0]);
}

export interface MedicalHistoryCreateInput { encounterId: number; patientId: number; type: string; title: string; }
export async function createMedicalHistory(input: MedicalHistoryCreateInput, kc: KcActor): Promise<{ id: number }> {
  await assertEncounterInScope(input.encounterId, kc);
  const created = await prisma.kcMedicalHistory.create({
    data: {
      encounterId: BigInt(input.encounterId), patientId: BigInt(input.patientId),
      type: input.type, title: input.title, addedBy: kc.wpUserId, createdAt: new Date(), isFromTemplate: 0,
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export interface MedicalHistoryUpdateInput { type?: string; title?: string; }
export async function updateMedicalHistory(id: number, input: MedicalHistoryUpdateInput, scope: KcLeafScope | null): Promise<void> {
  await getMedicalHistory(id, scope);
  await prisma.kcMedicalHistory.update({
    where: { id: BigInt(id) },
    data: { type: input.type ?? undefined, title: input.title ?? undefined },
  });
}

export async function deleteMedicalHistory(id: number, scope: KcLeafScope | null): Promise<void> {
  await getMedicalHistory(id, scope);
  await prisma.kcMedicalHistory.delete({ where: { id: BigInt(id) } });
}

export async function exportMedicalHistory(p: MedicalHistoryListParams, scope: KcLeafScope | null) {
  const list = await listMedicalHistory({ ...p, perPage: 'all', page: 1 }, scope);
  return {
    medicalHistory: list.medicalHistory.map((x) => ({
      id: x.id, type: x.type, title: x.title, patient_name: x.patient_name,
      doctor_name: x.doctor_name, clinic_name: x.clinic_name, created_at: x.created_at,
    })),
  };
}
```

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep medical-history.service | head` → no output.
```bash
git add src/services/billing/medical-history.service.ts
git commit -m "feat(mh): medical history service (scoped via encounter join)"
```

---

### Task 5: Medical History routes

**Files:**
- Create: `src/app/api/v1/medical-history/route.ts` (GET list, POST create)
- Create: `src/app/api/v1/medical-history/[id]/route.ts` (GET, PUT, DELETE)
- Create: `src/app/api/v1/medical-history/export/route.ts` (GET)
- Reference: the prescription routes from Task 3 — identical wiring, swapping: service = `medical-history.service`, schemas = `medicalHistoryListQuerySchema`/`medicalHistoryCreateSchema`/`medicalHistoryUpdateSchema`, capabilities = `medical_history_read`/`medical_history_manage`, messages = "Medical history ...". No bulk-delete route (not in the design for medical history).

- [ ] **Step 1: Create the three route files** (mirror Task 3 code exactly with the substitutions above; `list` returns `{ medicalHistory, pagination }`).

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "medical-history/" | head` → no output.
```bash
git add src/app/api/v1/medical-history
git commit -m "feat(mh): medical history REST routes (list/create/get/update/delete/export)"
```

---

### Task 6: Tests + close-out

**Files:**
- Modify: `tests/billing/fixtures.ts` (add prescription + medical-history seed/cleanup in TEST_MARKER range)
- Create: `tests/billing/prescription.service.test.ts`
- Create: `tests/billing/medical-history.service.test.ts`
- Create: `tests/billing/rx-mh-routes.integration.test.ts` (auth matrix)
- Reference: `tests/billing/encounter.service.test.ts`, `tests/billing/fixtures.ts`.

**DB SAFETY:** Only the live `wordpress-praktiqu` DB exists. Do NOT run DB-backed tests here and do NOT repoint `DATABASE_URL`. Keep `assertTestDb()` intact. Write the DB tests correctly (they run in a real test-DB env). Only run: `npx vitest run tests/billing/kc-permissions.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 1: Extend `fixtures.ts`**
Add `seedPrescription(...)` and `seedMedicalHistory(...)` (using `prisma.kcPrescription.create` / `prisma.kcMedicalHistory.create`, ids in `TEST_MARKER` range, `assertTestDb()` guard, and a `seedEncounter` parent from the encounter fixtures). Extend `cleanup()` with `deleteMany` for both, `where id >= TEST_MARKER`, placed BEFORE the encounter delete (FK-safe order).

- [ ] **Step 2: Service tests** (`prescription.service.test.ts`, `medical-history.service.test.ts`)
Full lifecycle (create→get→list→update→delete) using an in-scope encounter fixture; a scope test (a CLIENT scope for a different patient throws on get); prescription bulk-delete only removes in-scope ids. Use `assertTestDb`/`cleanup` beforeAll/afterAll like `encounter.service.test.ts`.

- [ ] **Step 3: Route auth-matrix tests** (`rx-mh-routes.integration.test.ts`)
Mirror `encounter-routes.integration.test.ts`: 401 no token; 403 CLIENT POST create (assertCan runs before DB). These do not need the DB.

- [ ] **Step 4: Run safe checks only**
```bash
npx vitest run tests/billing/kc-permissions.test.ts
npx tsc --noEmit 2>&1 | grep -iE "prescription|medical-history|kc-leaf" | head
```
Permission test passes; no new tsc errors in the new files.

- [ ] **Step 5: Commit**
```bash
git add tests/billing/fixtures.ts tests/billing/prescription.service.test.ts tests/billing/medical-history.service.test.ts tests/billing/rx-mh-routes.integration.test.ts
git commit -m "test(rx+mh): service + route integration tests (DB-guarded)"
```

---

## Self-Review

**Spec coverage** (design Slice 4, 13 endpoints): Prescriptions 7 → Tasks 2–3; Medical History 6 → Tasks 4–5. Capabilities `prescription_read/manage`, `medical_history_read/manage` → Task 1. All covered.

**Placeholder scan:** No TODO/TBD. One IMPLEMENTER note (Task 1) on the `@db.UnsignedBigInt` attribute — a real environment-verification point with a named fallback (match existing `Kc*` models). Task 4/5 reference Task 2/3 for mechanical wiring but provide full code for the service (Task 4) and explicit substitutions for the routes (Task 5).

**Type consistency:** `KcLeafScope` + `leafScopeFor` (Task 1) consumed by both services (Tasks 2, 4) and all routes (Tasks 3, 5). `assertEncounterInScope` defined in `prescription.service` (Task 2) and imported by `medical-history.service` (Task 4). Prescription list returns `{ prescriptions, pagination }`; medical-history returns `{ medicalHistory, pagination }` — route messages match. Confirmed column names (`name`/`frequency`/`duration`/`instruction`; `type`/`title`) match the introspected live schema. Scope filters correctly reference `rx.`/`mh.` (patient) vs `enc.` (doctor/clinic) — the whole point of the join.

**Security note for reviewers:** all raw SQL uses parameterized `?` (scope args, filters, LIMIT/OFFSET, id, and the `IN (...)` placeholders in bulk delete). `search` uses `LIKE ?` with the `%..%` in the bound arg, not interpolated. Writes go through typed Prisma models. Scope is enforced on every read/update/delete/bulk path and on create (via `assertEncounterInScope`).
