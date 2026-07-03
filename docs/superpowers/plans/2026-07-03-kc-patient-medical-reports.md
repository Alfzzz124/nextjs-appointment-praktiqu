# KiviCare Patient Medical Reports (Slice 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Patient Medical Reports module at `/api/v1/patient-medical-reports` (~10 endpoints) over the WordPress `wp_kc_patient_medical_report` table, following the KC billing/encounter pattern.

**Reality check (from live DB introspection):** `wp_kc_patient_medical_report` is an **upload registry**, not a document generator. Columns: `id, name (text), patient_id, upload_report (varchar20 = WP media attachment id), date (datetime)`. No doctor_id/clinic_id/encounter_id. So this slice is **faithful CRUD over uploaded-report records + best-effort media resolution**; PDF-generate / HTML-preview / email endpoints are **501 stubs** (WP media + email delivery are not wired here, consistent with prior slices). Scope for staff is derived by joining `wp_kc_patient_clinic_mappings` (patient→clinic).

**Architecture:** KC raw-SQL pattern — `withAuth` + `kcHandle` + `assertCan` + `resolveKcActor`. Reads use `prisma.$queryRawUnsafe` (parameterized) with an `EXISTS` clinic-scope subquery; writes use a new typed `KcPatientMedicalReport` model.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL (raw SQL for WP tables), Zod, Vitest.

**Branch:** `feat/kc-patient-medical-reports` (already created from `main`).

## CONFIRMED live schema
```
wp_kc_patient_medical_report:  id bigint PK | name text | patient_id bigint unsigned | upload_report varchar(20) | date datetime
wp_kc_patient_clinic_mappings: id bigint PK | patient_id bigint unsigned | clinic_id bigint unsigned | created_at datetime
```
Media resolution note: `upload_report` holds a WP media id; resolve via `wp_posts.guid` / `wp_postmeta._wp_attached_file` where the attachment exists. In the current DB these attachment rows are absent, so the resolver returns `fileUrl: null` gracefully — do NOT treat a missing attachment as an error.

## Scope model
```ts
export interface MedReportScope { patientId?: bigint; clinicId?: bigint }  // null => SUPER_ADMIN (all)
export function medReportScopeFor(kc: KcActor): MedReportScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: kc.clinicId ?? -1n };  // CLINIC_ADMIN / RECEPTIONIST / PROFESSIONAL
  }
}
```
- CLIENT → `mr.patient_id = ?`
- staff → `EXISTS (SELECT 1 FROM wp_kc_patient_clinic_mappings pcm WHERE pcm.patient_id = mr.patient_id AND pcm.clinic_id = ?)`

## Endpoints (design Slice 5, ~9 + a media resolver)
| Method | Path | Capability | Behavior |
|--------|------|-----------|----------|
| GET | `/patient-medical-reports` | `patient_report_read` | list (scoped) |
| POST | `/patient-medical-reports` | `patient_report_manage` | register a report record |
| GET | `/patient-medical-reports/{id}` | `patient_report_read` | detail |
| DELETE | `/patient-medical-reports/{id}` | `patient_report_manage` | delete |
| GET | `/patient-medical-reports/export` | `patient_report_read` | export JSON |
| POST | `/patient-medical-reports/bulk/delete` | `patient_report_manage` | scoped bulk delete |
| GET | `/patient-medical-reports/{id}/file` | `patient_report_read` | resolve media id → `{ mediaId, fileUrl\|null }` |
| GET | `/patient-medical-reports/{id}/preview` | `patient_report_read` | **501 stub** |
| GET | `/patient-medical-reports/{id}/print` | `patient_report_read` | **501 stub** |
| POST | `/patient-medical-reports/{id}/send-email` | `patient_report_manage` | **501 stub** |

## DB SAFETY (read first)
Only the live `wordpress-praktiqu` DB exists — no test DB. DB-backed tests MUST NOT run here; keep the `assertTestDb()` guard in `tests/billing/fixtures.ts` intact. `prisma generate` is safe; never run `prisma migrate` / `db push`.

---

### Task 1: Prisma model + capabilities + validation + scope/guard helpers

**Files:**
- Modify: `prisma/schema.prisma` (add `KcPatientMedicalReport`)
- Modify: `src/services/billing/kc-permissions.ts`, `src/services/billing/validation.ts`
- Create: `src/services/billing/med-report-scope.ts`
- Test: `tests/billing/kc-permissions.test.ts` (extend)

- [ ] **Step 1: Add the Prisma model** (mirror existing `Kc*` models — plain `BigInt`, no `@db.Unsigned*`):
```prisma
model KcPatientMedicalReport {
  id           BigInt    @id @default(autoincrement())
  name         String?   @db.Text
  patientId    BigInt    @map("patient_id")
  uploadReport String    @map("upload_report") @db.VarChar(20)
  date         DateTime?

  @@map("wp_kc_patient_medical_report")
}
```

- [ ] **Step 2: `npx prisma generate`** → "Generated Prisma Client". (No DB change.)

- [ ] **Step 3: Capabilities in `kc-permissions.ts`** — add to union and MATRIX:
```ts
  patient_report_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_report_manage: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
```

- [ ] **Step 4: Validation in `validation.ts`**:
```ts
export const medReportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  search: z.string().optional(),  // matches name
});
export const medReportCreateSchema = z.object({
  patientId: z.coerce.number().int(),
  name: z.string().min(1).max(2000),
  uploadReport: z.string().min(1).max(20),   // existing WP media id
  date: z.string().optional(),               // ISO / YYYY-MM-DD; default now
});
// (reuse existing idsSchema for bulk delete)
```

- [ ] **Step 5: Create `src/services/billing/med-report-scope.ts`**:
```ts
import type { KcActor } from '@/services/billing/kc-actor';
export interface MedReportScope { patientId?: bigint; clinicId?: bigint }
export function medReportScopeFor(kc: KcActor): MedReportScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: kc.clinicId ?? -1n };
  }
}
```

- [ ] **Step 6: Add + run capability test** in `tests/billing/kc-permissions.test.ts`:
```ts
describe('patient_report capabilities', () => {
  it('read to CLIENT, manage denied to CLIENT, manage to RECEPTIONIST', () => {
    const client = { id: 'x', role: 'CLIENT', practiceId: null } as const;
    const recp = { id: 'x', role: 'RECEPTIONIST', practiceId: null } as const;
    expect(can(client, 'patient_report_read')).toBe(true);
    expect(can(client, 'patient_report_manage')).toBe(false);
    expect(can(recp, 'patient_report_manage')).toBe(true);
  });
});
```
Run: `npx vitest run tests/billing/kc-permissions.test.ts` → PASS.

- [ ] **Step 7: Commit**
```bash
git add prisma/schema.prisma src/services/billing/kc-permissions.ts src/services/billing/validation.ts src/services/billing/med-report-scope.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(reports): Kc model, capabilities, validation, scope helper"
```

---

### Task 2: Patient medical report service

**Files:**
- Create: `src/services/billing/patient-medical-report.service.ts`
- Reference: `src/services/billing/prescription.service.ts` (raw-SQL list/get + scope + parameterization), `bill.service.ts` (prisma import `@/lib/db`).

- [ ] **Step 1: Write the service**
```ts
// src/services/billing/patient-medical-report.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { MedReportScope } from '@/services/billing/med-report-scope';

export interface MedReportListParams { page: number; perPage: number | 'all'; patientId?: number; search?: string; }

function mapRow(r: any) {
  return {
    id: Number(r.id),
    name: r.name ?? null,
    patient_id: Number(r.patient_id),
    upload_report: r.upload_report ?? null,
    date: r.date,
    patient_name: r.patient_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_patient_medical_report mr
   LEFT JOIN wp_users pt ON mr.patient_id = pt.ID`;

function buildWhere(scope: MedReportScope | null, p: Partial<MedReportListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('mr.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.clinicId !== undefined) {
    where.push('EXISTS (SELECT 1 FROM wp_kc_patient_clinic_mappings pcm WHERE pcm.patient_id = mr.patient_id AND pcm.clinic_id = ?)');
    args.push(scope.clinicId);
  }
  if (p.patientId !== undefined) { where.push('mr.patient_id = ?'); args.push(p.patientId); }
  if (p.search) { where.push('mr.name LIKE ?'); args.push(`%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

export async function listMedReports(p: MedReportListParams, scope: MedReportScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.*, pt.display_name AS patient_name ${BASE_JOIN} WHERE ${whereSql} ORDER BY mr.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { reports: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getMedReport(id: number, scope: MedReportScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.*, pt.display_name AS patient_name ${BASE_JOIN} WHERE ${whereSql} AND mr.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Medical report not found', 404);
  return mapRow(rows[0]);
}

/** Throw 404 unless the patient is visible under the actor's scope (own patient / clinic membership). */
export async function assertPatientInScope(patientId: number, kc: KcActor): Promise<void> {
  if (kc.actor.role === 'SUPER_ADMIN') return;
  if (kc.actor.role === 'CLIENT') {
    if (BigInt(patientId) !== kc.wpUserId) throw new KcError('Patient not found', 404);
    return;
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM wp_kc_patient_clinic_mappings WHERE patient_id = ? AND clinic_id = ? LIMIT 1`,
    patientId, kc.clinicId ?? -1n,
  );
  if (!rows[0]) throw new KcError('Patient not found', 404);
}

export interface MedReportCreateInput { patientId: number; name: string; uploadReport: string; date?: string; }
export async function createMedReport(input: MedReportCreateInput, kc: KcActor): Promise<{ id: number }> {
  await assertPatientInScope(input.patientId, kc);
  const created = await prisma.kcPatientMedicalReport.create({
    data: {
      patientId: BigInt(input.patientId),
      name: input.name,
      uploadReport: input.uploadReport,
      date: input.date ? new Date(input.date) : new Date(),
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export async function deleteMedReport(id: number, scope: MedReportScope | null): Promise<void> {
  await getMedReport(id, scope); // scope + existence (404)
  await prisma.kcPatientMedicalReport.delete({ where: { id: BigInt(id) } });
}

export async function bulkDeleteMedReports(ids: number[], scope: MedReportScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.id ${BASE_JOIN} WHERE ${whereSql} AND mr.id IN (${placeholders})`, ...args, ...ids,
  );
  const okIds = inScope.map((r) => BigInt(r.id));
  if (okIds.length === 0) return 0;
  const r = await prisma.kcPatientMedicalReport.deleteMany({ where: { id: { in: okIds } } });
  return r.count;
}

export async function exportMedReports(p: MedReportListParams, scope: MedReportScope | null) {
  const list = await listMedReports({ ...p, perPage: 'all', page: 1 }, scope);
  return { reports: list.reports.map((x) => ({ id: x.id, name: x.name, patient_name: x.patient_name, upload_report: x.upload_report, date: x.date })) };
}

/** Best-effort WP media resolution. Returns the stored media id and a URL if the attachment exists (else null). */
export async function resolveReportFile(id: number, scope: MedReportScope | null) {
  const report = await getMedReport(id, scope);
  const mediaId = report.upload_report;
  let fileUrl: string | null = null;
  const asInt = Number.parseInt(String(mediaId), 10);
  if (Number.isFinite(asInt)) {
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT guid FROM wp_posts WHERE ID = ? AND post_type = 'attachment' LIMIT 1`, asInt);
    fileUrl = rows[0]?.guid ?? null;
    if (!fileUrl) {
      const meta = await prisma.$queryRawUnsafe<any[]>(`SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wp_attached_file' LIMIT 1`, asInt);
      fileUrl = meta[0]?.meta_value ? String(meta[0].meta_value) : null;
    }
  }
  return { reportId: report.id, name: report.name, mediaId, fileUrl };
}
```

- [ ] **Step 2: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep patient-medical-report.service | head` → no output.
```bash
git add src/services/billing/patient-medical-report.service.ts
git commit -m "feat(reports): service (scoped CRUD + media resolve)"
```

---

### Task 3: CRUD + file routes

**Files:**
- Create: `src/app/api/v1/patient-medical-reports/route.ts` (GET list, POST create)
- Create: `src/app/api/v1/patient-medical-reports/[id]/route.ts` (GET, DELETE)
- Create: `src/app/api/v1/patient-medical-reports/export/route.ts` (GET)
- Create: `src/app/api/v1/patient-medical-reports/bulk/delete/route.ts` (POST)
- Create: `src/app/api/v1/patient-medical-reports/[id]/file/route.ts` (GET)
- Reference: prescription routes (identical wiring).

- [ ] **Step 1: `route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { medReportListQuerySchema, medReportCreateSchema } from '@/services/billing/validation';
import { listMedReports, createMedReport } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  const parsed = medReportListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listMedReports(parsed.data as any, medReportScopeFor(kc)), 'Medical reports retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);
  const parsed = medReportCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createMedReport(parsed.data as any, kc), 'Medical report created successfully');
}));
```

- [ ] **Step 2: `[id]/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { getMedReport, deleteMedReport } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getMedReport(Number(params.id), medReportScopeFor(kc)), 'Medical report retrieved successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  const kc = await resolveKcActor(actor);
  await deleteMedReport(Number(params.id), medReportScopeFor(kc));
  return kcOk(null, 'Medical report deleted successfully');
}));
```

- [ ] **Step 3: `export/route.ts`** — mirror prescription export: `assertCan(actor,'patient_report_read')`, parse `medReportListQuerySchema`, call `exportMedReports(..., medReportScopeFor(kc))`, `kcOk(data, 'Medical reports data retrieved successfully')`.

- [ ] **Step 4: `bulk/delete/route.ts`** — mirror prescription bulk delete: `assertCan(actor,'patient_report_manage')`, parse `idsSchema`, `bulkDeleteMedReports(ids, medReportScopeFor(kc))`, `kcOk({ updated: n }, `${n} medical reports deleted.`)`.

- [ ] **Step 5: `[id]/file/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { resolveReportFile } from '@/services/billing/patient-medical-report.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'patient_report_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await resolveReportFile(Number(params.id), medReportScopeFor(kc)), 'Report file resolved');
}));
```

- [ ] **Step 6: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep "patient-medical-reports/" | head` → no output.
```bash
git add src/app/api/v1/patient-medical-reports
git commit -m "feat(reports): CRUD + export + bulk-delete + media-resolve routes"
```

---

### Task 4: Stub routes (preview / print / send-email — 501)

**Files:**
- Create: `src/app/api/v1/patient-medical-reports/[id]/preview/route.ts`
- Create: `src/app/api/v1/patient-medical-reports/[id]/print/route.ts`
- Create: `src/app/api/v1/patient-medical-reports/[id]/send-email/route.ts`

These are 501 stubs — generation/email are not wired (consistent with prior slices). They still authenticate (so unauthenticated callers get 401, not a bare 501) but return NOT_IMPLEMENTED.

- [ ] **Step 1: `preview/route.ts`**
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { assertCan } from '@/services/billing/kc-permissions';
import { NextResponse } from 'next/server';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_read');
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Medical report HTML preview is not yet configured' },
    { status: 501 },
  );
});
```

- [ ] **Step 2: `print/route.ts`** — same as preview, message `'Medical report PDF print is not yet configured'`, capability `patient_report_read`.

- [ ] **Step 3: `send-email/route.ts`** — `export const POST = withAuth(...)`, `assertCan(actor, 'patient_report_manage')`, message `'Emailing medical reports is not yet configured'`, status 501.

> Note: `assertCan` throws a `KcError(403)` for wrong roles. Since these handlers are not wrapped in `kcHandle`, wrap the `assertCan` call in a try/catch returning `kcFail(err.message, err.httpStatus)` on `KcError`, OR wrap the whole body in `kcHandle` and return the 501 via `NextResponse` inside it. Simplest: wrap in `kcHandle` and `return NextResponse.json(...501...)` inside — `kcHandle` passes through non-error NextResponses. Confirm `kcHandle` returns the handler's response untouched on success (it does for bills print). Match whichever the codebase supports cleanly.

- [ ] **Step 4: Verify + commit**
Run: `npx tsc --noEmit 2>&1 | grep -E "preview|print|send-email" | head` → no output.
```bash
git add "src/app/api/v1/patient-medical-reports/[id]/preview" "src/app/api/v1/patient-medical-reports/[id]/print" "src/app/api/v1/patient-medical-reports/[id]/send-email"
git commit -m "feat(reports): preview/print/send-email 501 stubs"
```

---

### Task 5: Tests + close-out

**Files:**
- Modify: `tests/billing/fixtures.ts` (add `seedMedReport` + clinic mapping seed + cleanup)
- Create: `tests/billing/patient-medical-report.service.test.ts`
- Create: `tests/billing/report-routes.integration.test.ts`

**DB SAFETY:** only the live `wordpress-praktiqu` DB exists. Do NOT run DB-backed tests or repoint `DATABASE_URL`; keep `assertTestDb()` intact. Only run `npx vitest run tests/billing/kc-permissions.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 1: Fixtures** — add `seedMedReport({ id, patientId, name, uploadReport, date })` via `prisma.kcPatientMedicalReport.create` (TEST_MARKER range), and a helper to insert a `wp_kc_patient_clinic_mappings` row (raw `prisma.$executeRawUnsafe` INSERT with TEST_MARKER ids, guarded by `assertTestDb()`) so clinic-scope can be exercised. Extend `cleanup()` with `kcPatientMedicalReport.deleteMany({ where: { id: { gte: TEST_MARKER } } })` and a raw `DELETE FROM wp_kc_patient_clinic_mappings WHERE id >= TEST_MARKER`.

- [ ] **Step 2: Service tests** (`patient-medical-report.service.test.ts`): lifecycle (create→get→list→delete) with a clinic-mapped patient; CLIENT scope test (other patient throws on get); bulk-delete only removes in-scope ids; `assertPatientInScope` rejects a patient outside the actor's clinic. `resolveReportFile` returns `fileUrl: null` when the attachment is absent (assert it does not throw). beforeAll/afterAll with assertTestDb + cleanup.

- [ ] **Step 3: Route auth-matrix tests** (`report-routes.integration.test.ts`): 401 (no token) and 403 (CLIENT POST create) — reached before DB access. Also assert a stub route (`preview`) returns 501 for an authorized role (this needs no DB: the handler returns 501 after assertCan; use a CLINIC_ADMIN token — note resolveKcActor is not called in the stub, so no DB user row needed. If the stub does call resolveKcActor, drop this 501-with-auth assertion to avoid DB and just cover 401/403).

- [ ] **Step 4: Safe checks**
```bash
npx vitest run tests/billing/kc-permissions.test.ts
npx tsc --noEmit 2>&1 | grep -iE "patient-medical-report|med-report|report-routes|fixtures" | head
```
Permission test passes; no new tsc errors in new files.

- [ ] **Step 5: Commit**
```bash
git add tests/billing/fixtures.ts tests/billing/patient-medical-report.service.test.ts tests/billing/report-routes.integration.test.ts
git commit -m "test(reports): service + route integration tests (DB-guarded)"
```

---

## Self-Review

**Spec coverage** (design Slice 5): list/create/get/delete/export/bulk-delete → Tasks 2-3 (faithful); preview/print/send-email → Task 4 (501 stubs, per the confirmed reality that this table is an upload registry, not a generator); plus `/{id}/file` media resolver (Task 3). Capabilities `patient_report_read`/`patient_report_manage` → Task 1. All design endpoints accounted for (generation ones intentionally stubbed with rationale).

**Placeholder scan:** No TODO/TBD. Task 3 Steps 3-4 and Task 4 Step 2-3 describe routes as "mirror X with these substitutions" but name the exact capability/schema/message/service-fn — deterministic, not vague. Task 4's note flags the one real wiring choice (kcHandle vs try/catch for the stub's assertCan) with a concrete resolution.

**Type consistency:** `MedReportScope` + `medReportScopeFor` (Task 1) used by every service fn (Task 2) and route (Task 3). `assertPatientInScope` (Task 2) guards create. List returns `{ reports, pagination }`; route messages match. `resolveReportFile` returns `{ reportId, name, mediaId, fileUrl }` — consumed by the `/file` route. Column names (`name`, `patient_id`, `upload_report`, `date`) match the introspected schema. Clinic scope uses the confirmed `wp_kc_patient_clinic_mappings(patient_id, clinic_id)` via EXISTS.

**Security note for reviewers:** all raw SQL is parameterized (`?`), including the EXISTS clinic-scope subquery, `LIKE ?` search, LIMIT/OFFSET, id, and bulk-delete `IN (...)`. Writes use the typed `KcPatientMedicalReport` model. Scope enforced on list/get/delete/bulk and on create (`assertPatientInScope`). The media resolver is read-only and null-safe. Stubs authenticate before returning 501.
