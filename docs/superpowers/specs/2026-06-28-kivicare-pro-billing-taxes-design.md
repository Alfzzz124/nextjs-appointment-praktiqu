# Design: KiviCare-Pro Billing + Taxes → Next.js + Prisma

**Date:** 2026-06-28
**Status:** Implemented (slice 1)
**Slice:** 1 of N — first vertical slice of the kivicare-pro → Next.js port

---

## 0. Context

This is the **first slice** of a larger effort to reimplement the KiviCare-Pro
WordPress plugin's REST API (~143 endpoints across ~18 feature areas) in the
existing Next.js 14 (App Router) + Prisma + MySQL application at the repo root.

Decisions that govern the **whole** port (settled during brainstorming):

- **Fidelity:** Faithful 1:1 port. Same routes (namespace `kivicare/v1`), same
  `{status, message, data}` response envelope (from `KCBaseController::response()`),
  same business behavior.
- **Data layer:** Read/write the **real KiviCare WordPress tables** (`wp_kc_*`,
  BigInt IDs, exact columns). Next.js and WordPress **coexist on one MySQL
  instance** (sibling model — already documented in `prisma/schema.prisma`).
  The app's "clean" native models (`Doctor`, `Bill`, `Client`, `Professional`,
  on their own `cuid()` tables) are **not** used for this work. We extend the
  existing read-only `Kc*` view-model pattern (`KcClinic`, `KcService`,
  `KcAppointment`, ...) into full read/write models.
- **"Professional" is a presentation label only.** The underlying entity is a
  `wp_users` row with the `kiviCare_doctor` role. There is **no** `kc_doctors`
  or `kc_patients` table — doctors/patients live in `wp_users` + `wp_usermeta`.

Decisions specific to **this slice**:

- **Route mounting:** `/api/v1/...` (the app's existing convention), e.g.
  `/api/v1/taxes`, `/api/v1/bills`. The literal `kivicare` namespace segment is
  dropped; the response envelope and behavior remain faithful.
- **Scope:** Include **all ~21** billing + tax endpoints, including PDF print,
  email-bill, and CSV/XLS export.
- **Authorization:** Role-based mapping (map KiviCare capabilities onto the 5 JWT
  roles + data scoping), **not** a port of KiviCare's per-user permission store.

---

## 1. Scope — endpoint inventory

All endpoints return the `{status, message, data}` envelope unless noted.
"Source" is the KiviCare-Pro controller method this is ported from.

### Taxes (9) — `src/services/billing/tax.service.ts`

| Method | Route (`/api/v1`) | Source | Notes |
|---|---|---|---|
| GET | `/taxes` | `KCProTaxController::getTaxes` | list; filters: `id, taxName, status, clinic, doctor[], service[], orderby, order, page, perPage` (`perPage='all'` → no limit); role-scoped |
| GET | `/taxes/{id}` | `getTax` | resolves service_id (mapping id) → real service |
| POST | `/taxes` | `createTax` | `rateValue>0`; doctor/service combinatorial create; dedup by (name,type,clinic,doctor,service); `-1` sentinel = all |
| PUT | `/taxes/{id}` | `updateTax` | same validation as create |
| DELETE | `/taxes/{id}` | `deleteTax` | hard delete |
| PUT | `/taxes/{id}/status` | `updateTaxStatus` | `status ∈ {0,1}` |
| PUT | `/taxes/bulk/status` | `bulkUpdateTaxStatus` | `ids[]`, `status` |
| POST | `/taxes/bulk/delete` | `bulkDeleteTaxes` | `ids[]` |
| GET | `/taxes/export` | `exportTaxes` | returns shaped JSON (`tax_rate`, "All Clinics" labels...) + `format` echoed; **frontend builds the file** |

### Bills (12) — `src/services/billing/bill.service.ts` (+ `bill-document.service.ts`)

| Method | Route (`/api/v1`) | Source | Notes |
|---|---|---|---|
| GET | `/bills` | `KCProBillController::getBills` | list; search + `status, date_from, date_to, page, perPage, orderBy, order` + per-column LIKE filters; role-scoped; `pagination` meta |
| GET | `/bills/{id}` | `BillController::getBill` (base) | full bill detail: patient/clinic/doctor blocks, `serviceItems[]`, `taxItems[]`, recomputed `total_amount` |
| GET | `/bills/by-encounter/{encounterId}` | `getBillByEncounterId` (base) | returns bill if exists, else a skeleton from the encounter |
| POST | `/bills` | `createBill` (base) | **transaction**; auto-creates missing services; writes `kc_bills`+`kc_bill_items`(+`kc_tax_data`); 409 if bill already exists for encounter; status side-effects (see §5) |
| PUT | `/bills/{id}` | `updateBill` (base) | transactional update; `checkout` flag completes appointment; fires `kivicare_after_update_bill` equivalent hook |
| POST | `/bills/calculate-tax` | `calculateTaxForService` | stateless; uses tax-calculator + applicable taxes for clinic/doctor/services |
| GET | `/bills/encounters-without-bill` | `getEncountersWithoutBill` | encounters whose id ∉ bills; role-scoped |
| PUT | `/bills/item/{itemId}` | `updateBillItem` | update one `kc_bill_items` row |
| DELETE | `/bills/item/{itemId}` | `deleteBillItem` | delete one `kc_bill_items` row |
| GET | `/bills/export` | `exportBills` | shaped JSON; **frontend builds the file** |
| POST | `/bills/{id}/email` | `emailBill` | render invoice PDF, email via Resend with attachment |
| GET | `/bills/{id}/print` | `KCProPrintBillController::print` | returns `application/pdf` stream, filename `bill_{id}_{ts}.pdf` |

---

## 2. Architecture — three layers

### Route handlers — `src/app/api/v1/{taxes,bills}/.../route.ts`
Thin. Responsibilities only:
1. `withAuth` wrapper → `actor`.
2. Permission check via `kc-permissions` (capability + data scope); on fail →
   `kcFail('Permission denied', 403)`.
3. Parse/validate input with Zod (loose, matching KiviCare's permissive style).
4. Call the service.
5. Wrap result: `kcOk(data, message)` / catch `KcError` → `kcFail`.

Route file map:
```
src/app/api/v1/
  taxes/
    route.ts                 # GET (list), POST (create)
    [id]/route.ts            # GET, PUT, DELETE
    [id]/status/route.ts     # PUT
    bulk/status/route.ts     # PUT
    bulk/delete/route.ts     # POST
    export/route.ts          # GET
  bills/
    route.ts                 # GET (list), POST (create)
    [id]/route.ts            # GET, PUT
    [id]/email/route.ts      # POST
    [id]/print/route.ts      # GET (PDF stream)
    by-encounter/[encounterId]/route.ts   # GET
    calculate-tax/route.ts   # POST
    encounters-without-bill/route.ts      # GET
    export/route.ts          # GET
    item/[itemId]/route.ts   # PUT, DELETE
```

### Services — `src/services/billing/`
- `tax.service.ts` — tax CRUD, bulk ops, list (filter/sort/paginate/scope), export shaping.
- `bill.service.ts` — bill list/detail/create/update, bill-item ops, encounters-without-bill, calculate-tax, export shaping. Owns the `$transaction` flows.
- `bill-document.service.ts` — invoice HTML rendering + PDF generation + email.
- `tax-calculator.ts` — pure tax math (no DB). Ported from `KCPTaxCalculator`.
- `validation.ts` — Zod schemas for every endpoint's input.
- `mappers.ts` — row → API-shape mappers (parse varchar amounts to numbers,
  resolve mapping-id → service, assemble user/clinic/doctor blocks from
  `wp_users`/`wp_usermeta`, build image URLs).

### Data — Prisma models (see §3).

### Shared helpers
- `src/lib/kc-response.ts`
  ```ts
  export function kcOk<T>(data: T, message = ''): NextResponse  // {status:true, message, data}
  export function kcFail(message: string, httpStatus = 400, data: unknown = null): NextResponse // {status:false,...}
  export class KcError extends Error { constructor(message: string, public httpStatus = 400) {} }
  ```
  Kept separate from the existing `problem-details.ts` (RFC 7807), which native
  `/api/v1` app endpoints continue to use.
- `src/lib/kc-permissions.ts` — capability matrix + scope resolution (see §5).

---

## 3. Data layer — Prisma models

All mapped to the live WordPress tables. Follow the existing `Kc*` convention
(BigInt IDs, `@map` snake_case columns, `@@map("wp_kc_*")`). Amount columns are
**`varchar`** in KiviCare — model them as `String?` and parse in `mappers.ts`
(do not silently coerce types in the schema).

**New writable models:**
- `KcBill` → `wp_kc_bills` (`id, encounter_id, appointment_id, title, total_amount,
  discount, actual_amount, status, payment_status, created_at, clinic_id`)
- `KcBillItem` → `wp_kc_bill_items` (`id, bill_id, item_id, qty, price, created_at`)
- `KcTax` → `wp_kc_taxes` (`id, name, tax_type, tax_value, clinic_id, doctor_id,
  service_id, added_by, status, created_at`)
- `KcTaxData` → `wp_kc_tax_data` (`id, module_type, module_id, name, charges,
  tax_value, tax_type`)

**New read models (for joins / scoping / settings):**
- `KcPatientEncounter` → `wp_kc_patient_encounters`
- `KcUser` → `wp_users` (id, user_email, display_name, user_login)
- `KcUserMeta` → `wp_usermeta` (umeta_id, user_id, meta_key, meta_value) — source
  of first/last name, profile image id, `basic_data` JSON, role
- `KcOption` → `wp_options` (option_id, option_name, option_value) — `kc_*`
  settings: module-enabled flags, tax mode (`include`/`exclude`), currency

**Extend existing models to writable where needed:**
- `KcService` (`wp_kc_services`), `KcServiceDoctorMapping`
  (`wp_kc_service_doctor_mapping`) — bill creation auto-inserts a service +
  mapping when a free-text bill line has no matching service.

> The actual WordPress table prefix is read from `DATABASE_URL`'s DB; the
> existing models already use the `wp_` prefix literal in `@@map`. We keep that.
> If the deployment uses a non-`wp_` prefix, that is a deploy-time concern
> already inherent in the existing `Kc*` models — out of scope to parameterize here.

**Faithful quirks to preserve (documented in `mappers.ts`):**
- `kc_taxes.service_id` stores a **service-doctor-mapping id**, not a service id.
  Resolve via `LEFT JOIN wp_kc_service_doctor_mapping ON taxes.service_id = mapping.id`
  then `mapping.service_id → wp_kc_services`. Expose both `serviceId` (mapping)
  and `actual_service_id`.
- Sentinel `-1` (or NULL) in `clinic_id` / `doctor_id` / `service_id` = "all".
- Amounts are strings; parse defensively (`parseFloat`, default 0).
- Status integers: tax `0/1`; on bill paid → encounter status `0` +
  `payment_status='paid'` + appointment status `3`; on unpaid → encounter `1`.

---

## 4. Tax calculator — `tax-calculator.ts`

Pure TypeScript port of `KCPTaxCalculator`. No DB access.

API:
```ts
class TaxCalculator {
  addService(id, name, price, quantity): void
  addTax(taxId, name, type: 'percentage'|'fixed', value, serviceIds?: number[]): void
  calculate(mode: 'include'|'exclude' = 'exclude'): void
  getTotalTax(): number
  getCalculatedTaxes(): CalculatedTax[]   // flat per-(service,tax) breakdown
  getTaxSummary(): TaxSummary[]           // grouped by tax id
}
```
Rules:
- `percentage`: `tax = base * value / 100`. `fixed`: `tax = value`.
- `exclude` (default): tax added on top of `price*qty`.
- `include`: tax extracted from the price (divide out percentage taxes to find
  base, then recompute amounts) — faithful to the PHP logic.
- A tax with no `serviceIds` (or containing `-1`) is global → applies to all services.

Fully unit-tested in isolation (the only piece with non-trivial pure logic).

---

## 5. Authorization — role mapping + data scoping

`kc-permissions.ts` exposes:
```ts
type Capability = 'patient_bill_list'|'patient_bill_view'|'patient_bill_add'
                |'patient_bill_delete'|'tax_manage';
function can(actor: Actor, cap: Capability): boolean
function billScope(actor: Actor): BillScope   // {clinicId?, doctorId?, patientId?}
function taxScope(actor: Actor): TaxScope      // {clinicId?} | all
function assertModuleEnabled(module: 'billing'): Promise<void>  // reads KcOption
```

Capability matrix:

| Capability | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| `patient_bill_list` / `patient_bill_view` | ✓ all | ✓ own clinic | ✓ own (doctor) | ✓ own clinic | ✓ own (patient) |
| `patient_bill_add` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `patient_bill_delete` | ✓ | ✓ | ✗ | ✓ | ✗ |
| `tax_manage` (create/update/delete/status/bulk) | ✓ | ✓ own clinic | ✗ | ✗ | ✗ |
| `tax` read (`GET /taxes*`) | ✓ | ✓ | ✓ | ✓ | ✗ |

**Data scoping** (applied inside list/detail queries, not just the gate):
- CLINIC_ADMIN / RECEPTIONIST → restricted to their clinic id (resolved from
  `wp_usermeta` / clinic-mapping tables, mirroring `KCClinic::getClinicIdOf*`).
- PROFESSIONAL → restricted to their own `doctor_id` (their `wp_users.ID`).
- CLIENT → restricted to their own `patient_id`.
- SUPER_ADMIN → unrestricted.

Every endpoint first calls `assertModuleEnabled('billing')` (reads the
`kc_*`/module flag from `KcOption`), matching KiviCare's `isModuleEnabled('billing')`.

Mapping of the JWT roles ↔ WP roles is already established in the codebase
(`UserRole` enum comments + `src/lib/auth/role-mapping.ts`).

---

## 6. PDF / email / export

- **Export endpoints** (`/taxes/export`, `/bills/export`): faithful to KiviCare —
  return shaped JSON (with display strings like `"All Clinics"`, `"X%"`,
  `"Active"`); the **frontend** turns it into CSV/XLS/PDF. The `format` param is
  accepted and echoed but does not change the response. **No new dependency.**
- **Print** (`GET /bills/{id}/print`): `bill-document.service.ts` renders an HTML
  invoice (TS template ported from `KCBillPrintTemplate.php`, using clinic
  currency + logo) and converts to PDF with **Puppeteer** (full `puppeteer`,
  system Chromium — the app runs on a Linux/WSL Node server, not edge).
  Returns `application/pdf` with `Content-Disposition` inline; filename
  `bill_{id}_{timestamp}.pdf`. Route exports `runtime = 'nodejs'`.
- **Email** (`POST /bills/{id}/email`): generate the same PDF bytes, send through
  the existing `sendEmail()` (Resend) with a base64 attachment, subject/body from
  a `kivicare_patient_invoice` template (stored in `EmailTemplate` or `KcOption`,
  with `{patient_name}`, `{clinic_name}`, `{invoice_id}`, `{total}` substitution).
  Returns `kcOk(true, 'Bill sent successfully')`.

New dependency: `puppeteer` (devDeps already include `@playwright/test`; we use
Puppeteer for PDF specifically — note this is the one new runtime dep).

---

## 7. Error handling & envelope semantics

- Success → `kcOk(data, message)` → `{status:true, message, data}`, HTTP 200
  (201 not used by KiviCare for these — it returns 200 with the new id in `data`).
- Validation failure → `kcFail(message, 400)` → `{status:false, message, data:null}`.
- Permission failure → `kcFail('Permission denied', 403)`.
- Not found → `kcFail('<entity> not found', 404)`.
- Conflict (bill already exists for encounter) → `kcFail(..., 409)`.
- Service throws `KcError(message, status)`; the route wrapper converts it.
- Unexpected errors → logged via existing `src/lib/logging.ts` (`error(...)`),
  return `kcFail('Something went wrong', 500)`.

---

## 8. Testing

- **Unit (Vitest):** `tax-calculator.ts` — percentage/fixed, include/exclude,
  multi-service, global vs service-scoped taxes, zero/negative guards.
- **Service (Vitest + test MySQL via Prisma):** tax CRUD + dedup + bulk; bill
  create/update transaction (rollback on failure), bill-item ops,
  encounters-without-bill, calculate-tax, role scoping returns correct subsets,
  paid-bill side effects (encounter/appointment status writes).
- **Route/integration (HTTP or Playwright):** envelope shape for every endpoint,
  auth + permission matrix (each role × capability), pagination + `perPage='all'`,
  export JSON shape, print returns a valid PDF, email returns success and calls
  the email sender.
- Seed fixtures into `wp_kc_*` tables for service/integration tests.

---

## 9. Out of scope (future slices)

Other kivicare-pro areas: custom forms, follow-ups (+chains/reminders/audit),
GDPR (consents/versions/audit/settings), reports, patient medical reports,
ratings/reviews, imports, Google Calendar, SMS/WhatsApp templates, pro settings,
permission/sidebar settings, booking-limit manager, service-sessions, encounter
templates, print-encounter/print-prescription.

Also out of scope here:
- Porting KiviCare's per-user custom permission store (`KCPermissions` /
  `can_user_perform_action` per-user overrides) — we use the role matrix.
- Parameterizing the `wp_` table prefix.
- Building the frontend file generation for exports (frontend concern; the API
  returns JSON exactly as KiviCare does).
