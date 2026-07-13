# KiviCare-Pro Billing + Taxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faithfully port KiviCare-Pro's ~21 Billing + Taxes REST endpoints into the existing Next.js 14 + Prisma app, reading/writing the live WordPress `wp_kc_*` tables and returning KiviCare's `{status, message, data}` envelope.

**Architecture:** Three layers — thin route handlers under `src/app/api/v1/{taxes,bills}` (auth + permission + Zod + envelope), services under `src/services/billing` (all business logic, Prisma access, transactions), and Prisma models mapped to the real `wp_kc_*` tables. Complex list/detail reads use `prisma.$queryRaw` (faithful to the original SQL joins over the `wp_usermeta` EAV); writes use Prisma model methods inside `$transaction`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma 5 + MySQL, Zod, Vitest, Resend (email), Puppeteer (bill PDF).

**Design doc:** `docs/superpowers/specs/2026-06-28-kivicare-pro-billing-taxes-design.md`

---

## Conventions used throughout this plan

- **Prisma client:** `import { prisma } from '@/lib/db'`.
- **Tests:** live in `tests/billing/**/*.test.ts`. Run with `npx vitest run <path>`. Node env, `@` alias active.
- **DB tables already exist** in the shared WordPress MySQL DB. We hand-author Prisma models with `@@map("wp_kc_*")` and run **`npx prisma generate` only** — **never** `prisma migrate`/`db push` against these tables (WordPress owns them). This matches the existing `KcClinic`/`KcService` models.
- **Amounts** in KiviCare are stored as `varchar`; model them as `String?` and parse with a shared `toNum()` helper.
- **ID impedance:** the JWT `actor.id` is the PraktiQU `users.id` (cuid). The `wp_kc_*` tables key on `wp_users.ID` (BigInt). Always resolve via the `KcActor` helper (Task 4).
- **Commit** after each task. We are on `main`; the first foundation task creates the working branch.

---

## File structure (created/modified)

```
prisma/schema.prisma                                  # MODIFY: add Kc* models
package.json                                          # MODIFY: add puppeteer
src/lib/kc-response.ts                                # CREATE: envelope + KcError
src/lib/kc-num.ts                                     # CREATE: toNum/toMoney helpers
src/services/billing/
  kc-actor.ts                                         # CREATE: cuid→wpUserId + clinic scope
  kc-permissions.ts                                   # CREATE: capability matrix + scopes
  tax-calculator.ts                                   # CREATE: pure tax math
  validation.ts                                       # CREATE: Zod schemas
  mappers.ts                                          # CREATE: row→API-shape mappers
  tax.service.ts                                      # CREATE: tax CRUD/list/export
  bill.service.ts                                     # CREATE: bill CRUD/list/items/calc
  bill-document.service.ts                            # CREATE: invoice HTML+PDF+email
src/app/api/v1/taxes/
  route.ts                                            # CREATE: GET list, POST
  [id]/route.ts                                       # CREATE: GET, PUT, DELETE
  [id]/status/route.ts                               # CREATE: PUT
  bulk/status/route.ts                                # CREATE: PUT
  bulk/delete/route.ts                                # CREATE: POST
  export/route.ts                                     # CREATE: GET
src/app/api/v1/bills/
  route.ts                                            # CREATE: GET list, POST
  [id]/route.ts                                       # CREATE: GET, PUT
  [id]/email/route.ts                                 # CREATE: POST
  [id]/print/route.ts                                 # CREATE: GET (PDF)
  by-encounter/[encounterId]/route.ts                # CREATE: GET
  calculate-tax/route.ts                              # CREATE: POST
  encounters-without-bill/route.ts                   # CREATE: GET
  export/route.ts                                     # CREATE: GET
  item/[itemId]/route.ts                             # CREATE: PUT, DELETE
tests/billing/
  tax-calculator.test.ts
  kc-permissions.test.ts
  tax.service.test.ts
  bill.service.test.ts
  bill-document.service.test.ts
  routes.integration.test.ts
  fixtures.ts                                         # seed/cleanup wp_kc_* rows
```

---

# Milestone 0 — Foundation

### Task 1: Branch + install Puppeteer

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b feat/kivicare-pro-billing-taxes
```

- [ ] **Step 2: Install puppeteer**

```bash
npm install puppeteer@^23
```

- [ ] **Step 3: Verify it resolves**

Run: `node -e "require('puppeteer'); console.log('ok')"`
Expected: prints `ok` (Chromium downloads on install).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add puppeteer for bill PDF generation"
```

---

### Task 2: Prisma models for `wp_kc_*` billing/tax tables

**Files:**
- Modify: `prisma/schema.prisma` (append to the "KIVICARE WORDPRESS VIEWS" section)

- [ ] **Step 1: Append the new models**

Append the following to `prisma/schema.prisma`. Column names/types are taken verbatim from the KiviCare migrations. `@@map` uses the `wp_` prefix to match existing `Kc*` models.

```prisma
// ---- Billing + Taxes (read/write) ----

model KcBill {
  id            BigInt   @id @default(autoincrement())
  encounterId   BigInt   @map("encounter_id")
  appointmentId BigInt?  @map("appointment_id")
  title         String?
  totalAmount   String?  @map("total_amount")
  discount      String?
  actualAmount  String?  @map("actual_amount")
  status        BigInt   @default(0)
  paymentStatus String?  @map("payment_status")
  createdAt     DateTime @map("created_at")
  clinicId      BigInt?  @map("clinic_id")

  @@map("wp_kc_bills")
}

model KcBillItem {
  id        BigInt   @id @default(autoincrement())
  billId    BigInt   @map("bill_id")
  itemId    BigInt   @map("item_id")
  qty       Int
  price     String?
  createdAt DateTime @map("created_at")

  @@map("wp_kc_bill_items")
}

model KcTax {
  id        BigInt   @id @default(autoincrement())
  name      String?
  taxType   String?  @map("tax_type")
  taxValue  String?  @map("tax_value")
  clinicId  BigInt?  @map("clinic_id")
  doctorId  BigInt?  @map("doctor_id")
  serviceId BigInt?  @map("service_id")
  addedBy   BigInt?  @map("added_by")
  status    Int      @default(0)
  createdAt DateTime @map("created_at")

  @@map("wp_kc_taxes")
}

model KcTaxData {
  id         BigInt  @id @default(autoincrement())
  moduleType String? @map("module_type")
  moduleId   BigInt? @map("module_id")
  name       String?
  charges    String?
  taxValue   String? @map("tax_value")
  taxType    String? @map("tax_type")

  @@map("wp_kc_tax_data")
}

model KcPatientEncounter {
  id            BigInt   @id @default(autoincrement())
  encounterDate DateTime? @map("encounter_date") @db.Date
  clinicId      BigInt   @map("clinic_id")
  doctorId      BigInt   @map("doctor_id")
  patientId     BigInt   @map("patient_id")
  appointmentId BigInt?  @map("appointment_id")
  description   String?  @db.Text
  status        Int      @default(0)
  addedBy       BigInt   @map("added_by")
  createdAt     DateTime? @map("created_at")
  templateId    BigInt?  @map("template_id")

  @@map("wp_kc_patient_encounters")
}

model KcUser {
  id              BigInt  @id @default(autoincrement())
  userLogin       String  @map("user_login")
  userEmail       String  @map("user_email")
  displayName     String  @map("display_name")
  userRegistered  DateTime @map("user_registered")

  @@map("wp_users")
}

model KcUserMeta {
  umetaId   BigInt  @id @default(autoincrement()) @map("umeta_id")
  userId    BigInt  @map("user_id")
  metaKey   String? @map("meta_key")
  metaValue String? @map("meta_value") @db.LongText

  @@index([userId])
  @@map("wp_usermeta")
}

model KcOption {
  optionId    BigInt @id @default(autoincrement()) @map("option_id")
  optionName  String @map("option_name")
  optionValue String @map("option_value") @db.LongText

  @@map("wp_options")
}
```

> **Note:** `KcClinic`, `KcService`, `KcServiceDoctorMapping`, `KcAppointment` already exist (read-only views). We will write to `KcService`/`KcServiceDoctorMapping` during bill creation; no model change is needed since they already map the right columns. Confirm their `@@map` matches (`wp_kc_services`, `wp_kc_service_doctor_mapping`).

- [ ] **Step 2: Generate the client (NOT migrate)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no migration prompt. Do **not** run `prisma migrate`/`db push`.

- [ ] **Step 3: Smoke-check the new models compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors referencing the Kc* models.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(billing): add Prisma models for wp_kc billing/tax tables"
```

---

### Task 3: Response envelope + numeric helpers

**Files:**
- Create: `src/lib/kc-response.ts`
- Create: `src/lib/kc-num.ts`

- [ ] **Step 1: Write the helpers**

`src/lib/kc-num.ts`:
```ts
/** Parse a KiviCare varchar amount into a number; non-numeric → fallback. */
export function toNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 2 decimals (currency). */
export function toMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** JSON-safe BigInt → number (kc ids fit in JS safe range in practice). */
export function bigToNum(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'bigint' ? Number(v) : v;
}
```

`src/lib/kc-response.ts`:
```ts
import { NextResponse } from 'next/server';

/** KiviCare {status, message, data} success envelope. Always HTTP 200. */
export function kcOk<T>(data: T, message = ''): NextResponse {
  return NextResponse.json({ status: true, message, data }, { status: 200 });
}

/** KiviCare failure envelope with explicit HTTP status. */
export function kcFail(message: string, httpStatus = 400, data: unknown = null): NextResponse {
  return NextResponse.json({ status: false, message, data }, { status: httpStatus });
}

/** Thrown by services; routes convert it to kcFail. */
export class KcError extends Error {
  constructor(message: string, public httpStatus = 400) {
    super(message);
    this.name = 'KcError';
  }
}

/** Wrap a service call, converting KcError + unknown errors to envelopes. */
export async function kcHandle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[kc] unhandled', err);
    return kcFail('Something went wrong', 500);
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/billing/kc-response.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { kcOk, kcFail, KcError, kcHandle } from '@/lib/kc-response';
import { toNum, toMoney } from '@/lib/kc-num';

describe('kc-response', () => {
  it('kcOk wraps data with status true', async () => {
    const res = kcOk({ id: 1 }, 'done');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true, message: 'done', data: { id: 1 } });
  });

  it('kcFail sets status false and http status', async () => {
    const res = kcFail('nope', 403);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: false, message: 'nope', data: null });
  });

  it('kcHandle converts KcError to envelope', async () => {
    const res = await kcHandle(async () => { throw new KcError('bad', 409); });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe('bad');
  });

  it('toNum parses varchar amounts', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum('')).toBe(0);
    expect(toMoney(0.1 + 0.2)).toBe(0.3);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/billing/kc-response.test.ts`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kc-response.ts src/lib/kc-num.ts tests/billing/kc-response.test.ts
git commit -m "feat(billing): add kc-response envelope and numeric helpers"
```

---

### Task 4: `KcActor` — resolve cuid → wpUserId + clinic scope

**Files:**
- Create: `src/services/billing/kc-actor.ts`

This resolves the JWT actor to KiviCare ids. `doctor_id`/`patient_id` in kc tables = `wp_users.ID` = `users.wpUserId`. Clinic id is resolved from the kc mapping tables, mirroring `KCClinic::getClinicIdOfClinicAdmin/Receptionist`.

- [ ] **Step 1: Write the failing test**

`tests/billing/kc-actor.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    kcDoctorClinicMapping: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { resolveKcActor } from '@/services/billing/kc-actor';

describe('resolveKcActor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps cuid actor to wpUserId', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: 42n });
    (prisma.kcDoctorClinicMapping.findFirst as any).mockResolvedValue({ clinicId: 7n });
    const kc = await resolveKcActor({ id: 'cuid1', role: 'PROFESSIONAL', practiceId: null });
    expect(kc.wpUserId).toBe(42n);
  });

  it('throws when user has no wpUserId', async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ wpUserId: null });
    await expect(
      resolveKcActor({ id: 'cuid1', role: 'PROFESSIONAL', practiceId: null }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/kc-actor.test.ts`
Expected: FAIL — `resolveKcActor` not found.

- [ ] **Step 3: Implement**

`src/services/billing/kc-actor.ts`:
```ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';

export interface KcActor {
  actor: Actor;
  wpUserId: bigint;          // = wp_users.ID; used as doctor_id / patient_id
  clinicId: bigint | null;   // resolved clinic for CLINIC_ADMIN / RECEPTIONIST
}

/** Resolve the JWT actor to KiviCare ids. */
export async function resolveKcActor(actor: Actor): Promise<KcActor> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { wpUserId: true },
  });
  if (!user?.wpUserId) {
    throw new KcError('User is not linked to a WordPress account', 403);
  }
  const wpUserId = user.wpUserId;

  let clinicId: bigint | null = null;
  if (actor.role === 'CLINIC_ADMIN' || actor.role === 'PROFESSIONAL' || actor.role === 'RECEPTIONIST') {
    // clinic admins own a clinic; doctors/receptionists are mapped to one.
    const mapping = await prisma.kcDoctorClinicMapping.findFirst({
      where: { doctorId: wpUserId },
      select: { clinicId: true },
    });
    clinicId = mapping?.clinicId ?? null;
  }
  return { actor, wpUserId, clinicId };
}
```

> **Implementation note:** Clinic-admin clinic resolution in KiviCare reads `wp_kc_clinics.clinic_admin_id`. If `kcDoctorClinicMapping` returns null for a CLINIC_ADMIN, fall back to `prisma.kcClinic.findFirst({ where: { clinicAdminId: wpUserId } })`. Add that fallback inside the `if` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/billing/kc-actor.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/kc-actor.ts tests/billing/kc-actor.test.ts
git commit -m "feat(billing): add KcActor resolver (cuid -> wpUserId + clinic)"
```

---

### Task 5: `kc-permissions` — capability matrix + scopes

**Files:**
- Create: `src/services/billing/kc-permissions.ts`
- Test: `tests/billing/kc-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/billing/kc-permissions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { can } from '@/services/billing/kc-permissions';
import type { Actor } from '@/lib/auth';

const a = (role: Actor['role']): Actor => ({ id: 'x', role, practiceId: null });

describe('kc-permissions.can', () => {
  it('tax_manage allowed for admins only', () => {
    expect(can(a('SUPER_ADMIN'), 'tax_manage')).toBe(true);
    expect(can(a('CLINIC_ADMIN'), 'tax_manage')).toBe(true);
    expect(can(a('PROFESSIONAL'), 'tax_manage')).toBe(false);
    expect(can(a('RECEPTIONIST'), 'tax_manage')).toBe(false);
  });

  it('patient_bill_add denied for CLIENT', () => {
    expect(can(a('CLIENT'), 'patient_bill_add')).toBe(false);
    expect(can(a('RECEPTIONIST'), 'patient_bill_add')).toBe(true);
  });

  it('patient_bill_delete denied for PROFESSIONAL', () => {
    expect(can(a('PROFESSIONAL'), 'patient_bill_delete')).toBe(false);
    expect(can(a('CLINIC_ADMIN'), 'patient_bill_delete')).toBe(true);
  });

  it('tax read allowed for staff, denied for client', () => {
    expect(can(a('PROFESSIONAL'), 'tax_read')).toBe(true);
    expect(can(a('CLIENT'), 'tax_read')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/kc-permissions.test.ts`
Expected: FAIL — `can` not found.

- [ ] **Step 3: Implement**

`src/services/billing/kc-permissions.ts`:
```ts
import type { Actor } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';

export type Capability =
  | 'patient_bill_list'
  | 'patient_bill_view'
  | 'patient_bill_add'
  | 'patient_bill_delete'
  | 'tax_read'
  | 'tax_manage';

type Role = Actor['role'];

const MATRIX: Record<Capability, Role[]> = {
  patient_bill_list:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_bill_view:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_bill_add:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  patient_bill_delete: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'],
  tax_read:            ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  tax_manage:          ['SUPER_ADMIN', 'CLINIC_ADMIN'],
};

export function can(actor: Actor, cap: Capability): boolean {
  return MATRIX[cap].includes(actor.role);
}

/** Gate: throw 403 unless allowed. */
export function assertCan(actor: Actor, cap: Capability): void {
  if (!can(actor, cap)) throw new KcError('Permission denied', 403);
}

/** Faithful equivalent of isModuleEnabled('billing'). */
export async function assertBillingEnabled(): Promise<void> {
  const opt = await prisma.kcOption.findFirst({
    where: { optionName: 'kivicare_pro_modules_config' },
    select: { optionValue: true },
  });
  // Absent option = module enabled (KiviCare defaults modules on).
  if (!opt) return;
  try {
    const cfg = JSON.parse(opt.optionValue) as Record<string, unknown>;
    if (cfg.billing === false || cfg.billing === '0') {
      throw new KcError('Billing module is disabled', 403);
    }
  } catch {
    // Non-JSON / unknown shape → treat as enabled.
  }
}
```

> **Implementation note:** The exact option name + shape for module flags should be confirmed against `KCProBillController::isModuleEnabled` / `KCModuleRegistry`. If the flag is stored differently, adjust `assertBillingEnabled` only — callers stay the same. If unsure, leave it permissive (return without throwing) and open a follow-up.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/billing/kc-permissions.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/kc-permissions.ts tests/billing/kc-permissions.test.ts
git commit -m "feat(billing): add capability matrix and module gate"
```

---

# Milestone 1 — Tax calculator (pure)

### Task 6: Port `KCPTaxCalculator`

**Files:**
- Create: `src/services/billing/tax-calculator.ts`
- Test: `tests/billing/tax-calculator.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/billing/tax-calculator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TaxCalculator } from '@/services/billing/tax-calculator';

describe('TaxCalculator', () => {
  it('percentage tax in exclude mode adds on top', () => {
    const c = new TaxCalculator();
    c.addService(1, 'Counseling', 100, 1);
    c.addTax(10, 'VAT', 'percentage', 10, [1]);
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(10);
    const flat = c.getCalculatedTaxes();
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ tax_id: 10, tax_amount: 10, service_id: 1 });
  });

  it('fixed tax adds a flat amount', () => {
    const c = new TaxCalculator();
    c.addService(1, 'X', 200, 2); // base 400
    c.addTax(5, 'Stamp', 'fixed', 15, [1]);
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(15);
  });

  it('global tax (no serviceIds) applies to all services', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 100, 1);
    c.addService(2, 'B', 100, 1);
    c.addTax(7, 'GST', 'percentage', 10); // global
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(20);
  });

  it('include mode extracts tax from price', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 110, 1); // price includes 10% tax
    c.addTax(7, 'GST', 'percentage', 10, [1]);
    c.calculate('include');
    expect(c.getTotalTax()).toBeCloseTo(10, 2); // base 100, tax 10
  });

  it('summary groups by tax id across services', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 100, 1);
    c.addService(2, 'B', 100, 1);
    c.addTax(7, 'GST', 'percentage', 10);
    c.calculate('exclude');
    const summary = c.getTaxSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ tax_id: 7, tax_amount: 20 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/billing/tax-calculator.test.ts`
Expected: FAIL — `TaxCalculator` not found.

- [ ] **Step 3: Implement**

`src/services/billing/tax-calculator.ts`:
```ts
import { toMoney } from '@/lib/kc-num';

export type TaxType = 'percentage' | 'fixed';
export type TaxMode = 'include' | 'exclude';

interface Svc { id: number; name: string; price: number; qty: number }
interface Tx { taxId: number; name: string; type: TaxType; value: number; serviceIds: number[] }

export interface CalculatedTax {
  tax_id: number;
  tax_name: string;
  tax_type: TaxType;
  tax_value: number;
  tax_amount: number;
  service_id: number;
  service_name: string;
}

export interface TaxSummaryRow {
  tax_id: number;
  tax_name: string;
  tax_type: TaxType;
  tax_value: number;
  tax_amount: number;
}

export class TaxCalculator {
  private services: Svc[] = [];
  private taxes: Tx[] = [];
  private calculated: CalculatedTax[] = [];

  addService(id: number, name: string, price: number, qty: number): void {
    this.services.push({ id, name, price, qty });
  }

  /** serviceIds omitted/empty or containing -1 = global (all services). */
  addTax(taxId: number, name: string, type: TaxType, value: number, serviceIds: number[] = []): void {
    this.taxes.push({ taxId, name, type, value, serviceIds });
  }

  private applies(tax: Tx, serviceId: number): boolean {
    if (tax.serviceIds.length === 0) return true;
    if (tax.serviceIds.includes(-1)) return true;
    return tax.serviceIds.includes(serviceId);
  }

  calculate(mode: TaxMode = 'exclude'): void {
    this.calculated = [];
    for (const s of this.services) {
      const gross = s.price * s.qty;
      const applicable = this.taxes.filter((t) => this.applies(t, s.id));

      // For include mode, derive the base by dividing out total percentage.
      let base = gross;
      if (mode === 'include') {
        const pctSum = applicable
          .filter((t) => t.type === 'percentage')
          .reduce((acc, t) => acc + t.value, 0);
        const fixedSum = applicable
          .filter((t) => t.type === 'fixed')
          .reduce((acc, t) => acc + t.value, 0);
        base = (gross - fixedSum) / (1 + pctSum / 100);
      }

      for (const t of applicable) {
        const amount =
          t.type === 'percentage' ? (base * t.value) / 100 : t.value;
        this.calculated.push({
          tax_id: t.taxId,
          tax_name: t.name,
          tax_type: t.type,
          tax_value: t.value,
          tax_amount: toMoney(amount),
          service_id: s.id,
          service_name: s.name,
        });
      }
    }
  }

  getCalculatedTaxes(): CalculatedTax[] {
    return this.calculated;
  }

  getTotalTax(): number {
    return toMoney(this.calculated.reduce((acc, c) => acc + c.tax_amount, 0));
  }

  getTaxSummary(): TaxSummaryRow[] {
    const byId = new Map<number, TaxSummaryRow>();
    for (const c of this.calculated) {
      const existing = byId.get(c.tax_id);
      if (existing) existing.tax_amount = toMoney(existing.tax_amount + c.tax_amount);
      else byId.set(c.tax_id, {
        tax_id: c.tax_id, tax_name: c.tax_name, tax_type: c.tax_type,
        tax_value: c.tax_value, tax_amount: c.tax_amount,
      });
    }
    return [...byId.values()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/billing/tax-calculator.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/tax-calculator.ts tests/billing/tax-calculator.test.ts
git commit -m "feat(billing): port KCPTaxCalculator as pure TS module"
```

---

# Milestone 2 — Validation, mappers, test fixtures

### Task 7: Zod validation schemas

**Files:**
- Create: `src/services/billing/validation.ts`

- [ ] **Step 1: Implement the schemas**

`src/services/billing/validation.ts`:
```ts
import { z } from 'zod';

// Accept ints, {value}, or {id} shapes KiviCare sends; normalize to number[].
const idList = z
  .array(z.union([z.number(), z.string(), z.object({ value: z.any() }).passthrough(), z.object({ id: z.any() }).passthrough()]))
  .optional()
  .transform((arr) =>
    (arr ?? [])
      .map((x) => (typeof x === 'object' && x !== null ? (x as any).value ?? (x as any).id : x))
      .map((x) => parseInt(String(x), 10))
      .filter((n) => Number.isFinite(n)),
  );

export const taxListQuerySchema = z.object({
  id: z.coerce.number().int().optional(),
  taxName: z.string().optional(),
  status: z.coerce.number().int().optional(),
  clinic: z.coerce.number().int().optional(),
  doctor: idList,
  service: idList,
  orderby: z.string().optional(),
  order: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int(), z.literal('all')]).default(10),
});

export const taxCreateSchema = z.object({
  name: z.string().optional().default(''),
  rateType: z.enum(['percentage', 'fixed']).default('percentage'),
  rateValue: z.coerce.number().refine((n) => n > 0, 'rateValue must be > 0'),
  clinic: z.coerce.number().int().default(-1),
  doctor: idList,
  service: idList,
  status: z.coerce.number().int().min(0).max(1).default(1),
  addedBy: z.coerce.number().int().optional(),
});

export const taxUpdateSchema = taxCreateSchema.partial().extend({
  rateValue: z.coerce.number().refine((n) => n > 0, 'rateValue must be > 0').optional(),
});

export const statusSchema = z.object({ status: z.coerce.number().int().min(0).max(1) });
export const idsSchema = z.object({ ids: z.array(z.coerce.number().int()).min(1) });
export const idsStatusSchema = idsSchema.merge(statusSchema);

export const billListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int(), z.literal('all')]).default(10),
  orderBy: z.string().optional(),
  order: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
  id: z.coerce.number().int().optional(),
  encounter_id: z.coerce.number().int().optional(),
  doctorName: z.string().optional(),
  clinicName: z.string().optional(),
  patientName: z.string().optional(),
  serviceName: z.string().optional(),
});

const serviceItemSchema = z.object({
  serviceId: z.coerce.number().int().optional(),
  id: z.coerce.number().int().optional(),
  name: z.string().optional(),
  service_name: z.string().optional(),
  quantity: z.coerce.number().int().optional(),
  qty: z.coerce.number().int().optional(),
  price: z.coerce.number().optional(),
});

const taxItemSchema = z.object({
  id: z.coerce.number().int().optional(),
  tax_name: z.string().optional(),
  tax_type: z.enum(['percentage', 'fixed']).optional(),
  tax_value: z.coerce.number().optional(),
  tax_amount: z.coerce.number().optional(),
});

const refObj = z.object({ id: z.coerce.number().int(), appointmentId: z.coerce.number().int().optional() });

export const billCreateSchema = z.object({
  serviceItems: z.array(serviceItemSchema).min(1),
  taxItems: z.array(taxItemSchema).optional().default([]),
  discount: z.coerce.number().optional().default(0),
  discountEnabled: z.coerce.boolean().optional().default(false),
  status: z.enum(['paid', 'unpaid']),
  clinic: refObj,
  doctor: refObj,
  patient: refObj,
  patientEncounter: refObj,
  service_total: z.coerce.number(),
  total_amount: z.coerce.number(),
  checkout: z.coerce.boolean().optional(),
});

export const billUpdateSchema = billCreateSchema;

export const billItemUpdateSchema = z.object({
  serviceId: z.coerce.number().int(),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number(),
});

export const calculateTaxSchema = z.object({
  clinic_id: z.coerce.number().int().optional(),
  doctor_id: z.coerce.number().int().optional(),
  serviceItems: z.array(serviceItemSchema).min(1),
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep validation.ts | head`
Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/services/billing/validation.ts
git commit -m "feat(billing): add Zod validation schemas"
```

---

### Task 8: Row→API mappers + usermeta helpers

**Files:**
- Create: `src/services/billing/mappers.ts`
- Test: `tests/billing/mappers.test.ts`

These build the user/clinic/doctor blocks from `wp_usermeta` and resolve images. Confirm the exact meta keys against `kivicare-clinic-management-system/app/models/KCUser.php` / `KCDoctor.php` during implementation (known keys: `first_name`, `last_name`, `basic_data`, `doctor_profile_image`, `patient_profile_image`).

- [ ] **Step 1: Write the failing test**

`tests/billing/mappers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { metaToMap, fullNameFromMeta, taxRowToApi } from '@/services/billing/mappers';

describe('mappers', () => {
  it('metaToMap collapses rows to a key→value object', () => {
    const map = metaToMap([
      { metaKey: 'first_name', metaValue: 'Jane' },
      { metaKey: 'last_name', metaValue: 'Doe' },
    ]);
    expect(map.first_name).toBe('Jane');
  });

  it('fullNameFromMeta joins first + last', () => {
    expect(fullNameFromMeta({ first_name: 'Jane', last_name: 'Doe' })).toBe('Jane Doe');
  });

  it('taxRowToApi parses value and maps fields', () => {
    const api = taxRowToApi({
      id: 3n, name: 'VAT', taxType: 'percentage', taxValue: '10',
      clinicId: -1n, doctorId: -1n, serviceId: -1n, addedBy: 1n, status: 1,
      createdAt: new Date('2026-01-01'),
    } as any, { actual_service_id: null, serviceName: null });
    expect(api).toMatchObject({ id: 3, name: 'VAT', taxType: 'percentage', taxValue: 10, status: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/mappers.test.ts`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement**

`src/services/billing/mappers.ts`:
```ts
import { toNum, bigToNum } from '@/lib/kc-num';
import type { KcTax } from '@prisma/client';

export type MetaRow = { metaKey: string | null; metaValue: string | null };

export function metaToMap(rows: MetaRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.metaKey) out[r.metaKey] = r.metaValue ?? '';
  return out;
}

export function fullNameFromMeta(map: Record<string, string>): string {
  return `${map.first_name ?? ''} ${map.last_name ?? ''}`.trim();
}

/** Build a WP attachment URL; null id → null. KiviCare stores attachment ids in meta. */
export function attachmentUrl(id: number | null): string | null {
  if (!id) return null;
  const base = process.env.WP_UPLOADS_BASE_URL ?? '';
  return base ? `${base}/?attachment_id=${id}` : null;
}

export interface TaxApi {
  id: number; name: string; taxType: string; taxValue: number;
  clinicId: number | null; doctorId: number | null; serviceId: number | null;
  actual_service_id: number | null; addedBy: number | null; status: number;
  createdAt: Date; serviceName?: string | null;
}

export function taxRowToApi(
  row: KcTax,
  extra: { actual_service_id: number | null; serviceName: string | null },
): TaxApi {
  return {
    id: Number(row.id),
    name: row.name ?? '',
    taxType: row.taxType ?? 'percentage',
    taxValue: toNum(row.taxValue),
    clinicId: bigToNum(row.clinicId),
    doctorId: bigToNum(row.doctorId),
    serviceId: bigToNum(row.serviceId),
    actual_service_id: extra.actual_service_id,
    addedBy: bigToNum(row.addedBy),
    status: row.status,
    createdAt: row.createdAt,
    serviceName: extra.serviceName,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/billing/mappers.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/mappers.ts tests/billing/mappers.test.ts
git commit -m "feat(billing): add row->API mappers and usermeta helpers"
```

---

### Task 9: Integration test fixtures (shared MySQL)

**Files:**
- Create: `tests/billing/fixtures.ts`

Service/integration tests need real `wp_kc_*` rows. This module seeds and tears down deterministic fixtures using a **dedicated test DB** (`DATABASE_URL` pointed at a disposable schema). Guard so it never runs against a non-test DB.

- [ ] **Step 1: Implement the fixtures helper**

`tests/billing/fixtures.ts`:
```ts
import { prisma } from '@/lib/db';

const TEST_MARKER = 9_000_000; // ids in this range belong to tests

export function assertTestDb(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error('Refusing to seed fixtures: DATABASE_URL does not look like a test DB');
  }
}

export async function seedClinicAdmin(opts: { userId: number; clinicId: number }) {
  assertTestDb();
  await prisma.kcUser.create({
    data: {
      id: BigInt(opts.userId), userLogin: `admin${opts.userId}`,
      userEmail: `admin${opts.userId}@test.local`, displayName: 'Admin',
      userRegistered: new Date(),
    },
  });
  await prisma.kcClinic.create({
    data: { id: BigInt(opts.clinicId), name: 'Test Clinic', clinicAdminId: BigInt(opts.userId), clinicLogo: 0n, status: 1, createdAt: new Date() } as any,
  });
  // Link the PraktiQU user (cuid) → wpUserId for resolveKcActor.
  await prisma.user.create({
    data: {
      id: `test-admin-${opts.userId}`, email: `admin${opts.userId}@test.local`,
      username: `admin${opts.userId}`, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(opts.userId), status: 1,
    },
  });
}

export async function seedTax(data: Partial<{ id: number; name: string; taxType: string; taxValue: string; clinicId: number; status: number }>) {
  assertTestDb();
  return prisma.kcTax.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 1),
      name: data.name ?? 'VAT', taxType: data.taxType ?? 'percentage',
      taxValue: data.taxValue ?? '10', clinicId: BigInt(data.clinicId ?? -1),
      doctorId: -1n, serviceId: -1n, addedBy: 1n, status: data.status ?? 1, createdAt: new Date(),
    },
  });
}

export async function cleanup() {
  assertTestDb();
  await prisma.kcTax.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBillItem.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBill.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcTaxData.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcClinic.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'test-' } } });
}
```

> **Note for the executor:** Provision a test MySQL schema and set `DATABASE_URL` (with "test" in the name) in `.env.test`. Use ids ≥ 9,000,000 for all seeded rows so `cleanup()` is safe. If a shared test DB is not available, mark the `*.service.test.ts` integration tests `describe.skip` and rely on the unit-mocked tests — but prefer a real test DB.

- [ ] **Step 2: Commit**

```bash
git add tests/billing/fixtures.ts
git commit -m "test(billing): add wp_kc_* test fixtures + guard"
```

---

# Milestone 3 — Tax service + routes

### Task 10: `tax.service.ts` — list + get

**Files:**
- Create: `src/services/billing/tax.service.ts`
- Test: `tests/billing/tax.service.test.ts`

- [ ] **Step 1: Write the failing test** (integration; requires test DB)

`tests/billing/tax.service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { listTaxes, getTax } from '@/services/billing/tax.service';

describe('tax.service list/get', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedTax({ id: 9000001, name: 'VAT', taxValue: '10' }); });
  afterAll(cleanup);

  it('lists taxes with pagination meta', async () => {
    const res = await listTaxes({ page: 1, perPage: 10 } as any, null /* superadmin scope */);
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.taxes.find((t) => t.id === 9000001)?.name).toBe('VAT');
  });

  it('gets a single tax with parsed value', async () => {
    const tax = await getTax(9000001);
    expect(tax.taxValue).toBe(10);
  });

  it('throws 404 for missing tax', async () => {
    await expect(getTax(9999999)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/tax.service.test.ts`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement list + get**

`src/services/billing/tax.service.ts`:
```ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { taxRowToApi, type TaxApi } from './mappers';
import type { KcActor } from './kc-actor';

const SORT_COLUMNS: Record<string, string> = {
  taxName: 't.name', taxRate: 't.tax_value', status: 't.status', id: 't.id',
};

export interface TaxListResult {
  taxes: TaxApi[]; page: number; per_page: number; total: number; total_pages: number;
}

export interface TaxListParams {
  id?: number; taxName?: string; status?: number; clinic?: number;
  doctor?: number[]; service?: number[];
  orderby?: string; order?: string; page: number; perPage: number | 'all';
}

/** scope=null means unrestricted (super admin). */
export async function listTaxes(p: TaxListParams, scope: { clinicId: bigint } | null): Promise<TaxListResult> {
  const where: string[] = ['1=1'];
  const args: any[] = [];
  if (p.id) { where.push('t.id = ?'); args.push(p.id); }
  if (p.taxName) { where.push('t.name LIKE ?'); args.push(`%${p.taxName}%`); }
  if (p.status !== undefined) { where.push('t.status = ?'); args.push(p.status); }
  if (p.clinic !== undefined) { where.push('t.clinic_id = ?'); args.push(p.clinic); }
  if (scope) { where.push('(t.clinic_id = ? OR t.clinic_id = -1 OR t.clinic_id IS NULL)'); args.push(scope.clinicId); }

  const orderCol = SORT_COLUMNS[p.orderby ?? 'id'] ?? 't.id';
  const orderDir = (p.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(DISTINCT t.id) c FROM wp_kc_taxes t WHERE ${whereSql}`, ...args,
  );
  const total = Number(countRows[0]?.c ?? 0);

  let limitSql = '';
  const page = p.page ?? 1;
  const perPage = p.perPage === 'all' ? total || 1 : p.perPage;
  if (p.perPage !== 'all') limitSql = `LIMIT ${perPage} OFFSET ${(page - 1) * (perPage as number)}`;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t.*, s.name AS service_name, sdm.service_id AS actual_service_id
     FROM wp_kc_taxes t
     LEFT JOIN wp_kc_service_doctor_mapping sdm ON t.service_id = sdm.id
     LEFT JOIN wp_kc_services s ON sdm.service_id = s.id
     WHERE ${whereSql}
     GROUP BY t.id
     ORDER BY ${orderCol} ${orderDir}
     ${limitSql}`,
    ...args,
  );

  const taxes = rows.map((r) =>
    taxRowToApi(
      { id: r.id, name: r.name, taxType: r.tax_type, taxValue: r.tax_value, clinicId: r.clinic_id,
        doctorId: r.doctor_id, serviceId: r.service_id, addedBy: r.added_by, status: r.status, createdAt: r.created_at } as any,
      { actual_service_id: r.actual_service_id ? Number(r.actual_service_id) : null, serviceName: r.service_name ?? null },
    ),
  );

  return { taxes, page, per_page: perPage as number, total, total_pages: perPage ? Math.ceil(total / (perPage as number)) : 1 };
}

export async function getTax(id: number): Promise<TaxApi> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t.*, s.name AS service_name, sdm.service_id AS actual_service_id
     FROM wp_kc_taxes t
     LEFT JOIN wp_kc_service_doctor_mapping sdm ON t.service_id = sdm.id
     LEFT JOIN wp_kc_services s ON sdm.service_id = s.id
     WHERE t.id = ? LIMIT 1`, id,
  );
  if (rows.length === 0) throw new KcError('Tax not found', 404);
  const r = rows[0];
  return taxRowToApi(
    { id: r.id, name: r.name, taxType: r.tax_type, taxValue: r.tax_value, clinicId: r.clinic_id,
      doctorId: r.doctor_id, serviceId: r.service_id, addedBy: r.added_by, status: r.status, createdAt: r.created_at } as any,
    { actual_service_id: r.actual_service_id ? Number(r.actual_service_id) : null, serviceName: r.service_name ?? null },
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/tax.service.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/tax.service.ts tests/billing/tax.service.test.ts
git commit -m "feat(billing): tax.service list + get"
```

---

### Task 11: `tax.service.ts` — create (combinatorial + dedup)

**Files:**
- Modify: `src/services/billing/tax.service.ts`
- Modify: `tests/billing/tax.service.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/billing/tax.service.test.ts`:
```ts
import { createTax } from '@/services/billing/tax.service';

describe('tax.service create', () => {
  afterAll(cleanup);
  it('creates a global tax and dedups identical ones', async () => {
    const r1 = await createTax({ name: 'GST9M', rateType: 'percentage', rateValue: 9, clinic: -1, doctor: [], service: [] } as any, 1);
    expect(r1.created_count).toBe(1);
    const r2 = await createTax({ name: 'GST9M', rateType: 'percentage', rateValue: 9, clinic: -1, doctor: [], service: [] } as any, 1);
    expect(r2.skipped_count).toBe(1);
  });

  it('rejects rateValue <= 0 at the service layer', async () => {
    await expect(createTax({ name: 'bad', rateValue: 0 } as any, 1)).rejects.toThrow();
  });
});
```

(Cleanup uses the test marker range; give these taxes ids in range or filter by name in an `afterAll`. Simpler: delete by name in this block's `afterAll`: `await prisma.kcTax.deleteMany({ where: { name: 'GST9M' } })`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/tax.service.test.ts -t create`
Expected: FAIL — `createTax` not found.

- [ ] **Step 3: Implement create**

Append to `src/services/billing/tax.service.ts`:
```ts
export interface TaxCreateInput {
  name: string; rateType: 'percentage' | 'fixed'; rateValue: number;
  clinic: number; doctor: number[]; service: number[]; status?: number; addedBy?: number;
}

export interface TaxCreateResult { ids: number[]; created_count: number; skipped_count: number; }

export async function createTax(input: TaxCreateInput, currentUserId: number): Promise<TaxCreateResult> {
  if (!(input.rateValue > 0)) throw new KcError('Tax rate must be greater than 0', 400);

  const clinicId = input.clinic ?? -1;
  const doctors = input.doctor.length ? input.doctor : [-1];
  const services = input.service.length ? input.service : [-1];

  // If both specific doctor and service: resolve to service-doctor-mapping ids (status=1).
  const combos: { doctorId: number; serviceId: number }[] = [];
  for (const d of doctors) {
    for (const s of services) {
      if (d !== -1 && s !== -1) {
        const map = await prisma.kcServiceDoctorMapping.findFirst({
          where: { doctorId: BigInt(d), serviceId: BigInt(s), status: 1 }, select: { id: true },
        });
        if (map) combos.push({ doctorId: d, serviceId: Number(map.id) });
        else combos.push({ doctorId: d, serviceId: s }); // fall back to raw service id
      } else {
        combos.push({ doctorId: d, serviceId: s });
      }
    }
  }

  const ids: number[] = [];
  let skipped = 0;
  for (const c of combos) {
    const dup = await prisma.kcTax.findFirst({
      where: {
        name: input.name, taxType: input.rateType,
        clinicId: BigInt(clinicId), doctorId: BigInt(c.doctorId), serviceId: BigInt(c.serviceId),
      },
      select: { id: true },
    });
    if (dup) { skipped++; continue; }
    const created = await prisma.kcTax.create({
      data: {
        name: input.name, taxType: input.rateType, taxValue: String(input.rateValue),
        clinicId: BigInt(clinicId), doctorId: BigInt(c.doctorId), serviceId: BigInt(c.serviceId),
        addedBy: BigInt(input.addedBy ?? currentUserId), status: input.status ?? 1, createdAt: new Date(),
      },
      select: { id: true },
    });
    ids.push(Number(created.id));
  }
  return { ids, created_count: ids.length, skipped_count: skipped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/tax.service.test.ts -t create`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/tax.service.ts tests/billing/tax.service.test.ts
git commit -m "feat(billing): tax.service create (combinatorial + dedup)"
```

---

### Task 12: `tax.service.ts` — update, delete, status, bulk, export

**Files:**
- Modify: `src/services/billing/tax.service.ts`
- Modify: `tests/billing/tax.service.test.ts`

- [ ] **Step 1: Add failing tests**

Append:
```ts
import { updateTax, deleteTax, setTaxStatus, bulkSetTaxStatus, bulkDeleteTaxes, exportTaxes } from '@/services/billing/tax.service';

describe('tax.service mutate', () => {
  let id: number;
  beforeAll(async () => { const t = await seedTax({ id: 9000050, name: 'MUT', taxValue: '5' }); id = Number(t.id); });
  afterAll(cleanup);

  it('updates value', async () => { await updateTax(id, { rateValue: 12 } as any); const t = await getTax(id); expect(t.taxValue).toBe(12); });
  it('sets status', async () => { await setTaxStatus(id, 0); expect((await getTax(id)).status).toBe(0); });
  it('bulk status', async () => { await bulkSetTaxStatus([id], 1); expect((await getTax(id)).status).toBe(1); });
  it('exports shaped rows', async () => { const r = await exportTaxes({ page: 1, perPage: 'all' } as any, null); expect(r.taxes[0]).toHaveProperty('tax_rate'); });
  it('deletes', async () => { await deleteTax(id); await expect(getTax(id)).rejects.toThrow(); });
  it('rejects bad status', async () => { await expect(setTaxStatus(id, 5 as any)).rejects.toThrow(); });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/tax.service.test.ts -t mutate`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement**

Append to `src/services/billing/tax.service.ts`:
```ts
import { toNum } from '@/lib/kc-num';

export async function updateTax(id: number, input: Partial<TaxCreateInput>): Promise<void> {
  if (input.rateValue !== undefined && !(input.rateValue > 0)) throw new KcError('Tax rate must be greater than 0', 400);
  const existing = await prisma.kcTax.findUnique({ where: { id: BigInt(id) } });
  if (!existing) throw new KcError('Tax not found', 404);
  await prisma.kcTax.update({
    where: { id: BigInt(id) },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.rateType !== undefined ? { taxType: input.rateType } : {}),
      ...(input.rateValue !== undefined ? { taxValue: String(input.rateValue) } : {}),
      ...(input.clinic !== undefined ? { clinicId: BigInt(input.clinic) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}

export async function deleteTax(id: number): Promise<void> {
  const existing = await prisma.kcTax.findUnique({ where: { id: BigInt(id) } });
  if (!existing) throw new KcError('Tax not found', 404);
  await prisma.kcTax.delete({ where: { id: BigInt(id) } });
}

export async function setTaxStatus(id: number, status: number): Promise<void> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  const existing = await prisma.kcTax.findUnique({ where: { id: BigInt(id) } });
  if (!existing) throw new KcError('Tax not found', 404);
  await prisma.kcTax.update({ where: { id: BigInt(id) }, data: { status } });
}

export async function bulkSetTaxStatus(ids: number[], status: number): Promise<number> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  const r = await prisma.kcTax.updateMany({ where: { id: { in: ids.map(BigInt) } }, data: { status } });
  return r.count;
}

export async function bulkDeleteTaxes(ids: number[]): Promise<number> {
  const r = await prisma.kcTax.deleteMany({ where: { id: { in: ids.map(BigInt) } } });
  return r.count;
}

export interface TaxExportRow {
  id: number; tax_name: string; tax_rate: string; clinic_name: string;
  doctor_name: string; service_name: string; status: string; actual_service_id: number | null;
}

export async function exportTaxes(p: TaxListParams, scope: { clinicId: bigint } | null): Promise<{ taxes: TaxExportRow[] }> {
  const list = await listTaxes({ ...p, perPage: 'all' }, scope);
  const taxes: TaxExportRow[] = list.taxes.map((t) => ({
    id: t.id,
    tax_name: t.name,
    tax_rate: t.taxType === 'percentage' ? `${toNum(t.taxValue)}%` : `Fixed ${toNum(t.taxValue)}`,
    clinic_name: t.clinicId === -1 || t.clinicId === null ? 'All Clinics' : String(t.clinicId),
    doctor_name: t.doctorId === -1 || t.doctorId === null ? 'All Doctors' : String(t.doctorId),
    service_name: t.serviceName ?? (t.serviceId === -1 ? 'All Services' : ''),
    status: t.status === 1 ? 'Active' : 'Inactive',
    actual_service_id: t.actual_service_id,
  }));
  return { taxes };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/tax.service.test.ts -t mutate`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/tax.service.ts tests/billing/tax.service.test.ts
git commit -m "feat(billing): tax.service update/delete/status/bulk/export"
```

---

### Task 13: Tax route handlers

**Files:**
- Create: `src/app/api/v1/taxes/route.ts`
- Create: `src/app/api/v1/taxes/[id]/route.ts`
- Create: `src/app/api/v1/taxes/[id]/status/route.ts`
- Create: `src/app/api/v1/taxes/bulk/status/route.ts`
- Create: `src/app/api/v1/taxes/bulk/delete/route.ts`
- Create: `src/app/api/v1/taxes/export/route.ts`

Each handler: `withAuth` → resolve `KcActor` → `assertBillingEnabled()` → `assertCan` → validate → call service → `kcOk`, wrapped in `kcHandle`.

- [ ] **Step 1: `taxes/route.ts` (GET list, POST create)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listTaxes, createTax } from '@/services/billing/tax.service';
import { taxListQuerySchema, taxCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    const kc = await resolveKcActor(actor);
    const parsed = taxListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const scope = actor.role === 'SUPER_ADMIN' ? null : { clinicId: kc.clinicId ?? -1n };
    const data = await listTaxes(parsed.data as any, scope);
    return kcOk(data, 'Taxes retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const kc = await resolveKcActor(actor);
    const body = await req.json().catch(() => ({}));
    const parsed = taxCreateSchema.safeParse(body);
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    const data = await createTax(parsed.data as any, Number(kc.wpUserId));
    return kcOk(data, `Tax created successfully${data.skipped_count ? ` (${data.skipped_count} skipped as duplicates)` : ''}`);
  }),
);
```

- [ ] **Step 2: `taxes/[id]/route.ts` (GET, PUT, DELETE)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { getTax, updateTax, deleteTax } from '@/services/billing/tax.service';
import { taxUpdateSchema } from '@/services/billing/validation';

type P = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any as { actor: any; params: P['params'] };
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    return kcOk(await getTax(Number(params.id)), 'Tax detail fetched successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = taxUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    await updateTax(Number(params.id), parsed.data as any);
    return kcOk(null, 'Tax updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    await deleteTax(Number(params.id));
    return kcOk(null, 'Tax deleted successfully.');
  }),
);
```

- [ ] **Step 3: `taxes/[id]/status/route.ts` (PUT)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { setTaxStatus } from '@/services/billing/tax.service';
import { statusSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = statusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid status', 400);
    await setTaxStatus(Number(params.id), parsed.data.status);
    return kcOk(null, 'Tax status updated.');
  }),
);
```

- [ ] **Step 4: `taxes/bulk/status/route.ts` (PUT) and `taxes/bulk/delete/route.ts` (POST)**

`bulk/status/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { bulkSetTaxStatus } from '@/services/billing/tax.service';
import { idsStatusSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = idsStatusSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkSetTaxStatus(parsed.data.ids, parsed.data.status);
    return kcOk(null, `${n} taxes status updated.`);
  }),
);
```

`bulk/delete/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { bulkDeleteTaxes } from '@/services/billing/tax.service';
import { idsSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_manage');
    const parsed = idsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    const n = await bulkDeleteTaxes(parsed.data.ids);
    return kcOk(null, `${n} taxes deleted successfully.`);
  }),
);
```

- [ ] **Step 5: `taxes/export/route.ts` (GET)**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { exportTaxes } from '@/services/billing/tax.service';
import { taxListQuerySchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'tax_read');
    const kc = await resolveKcActor(actor);
    const parsed = taxListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const scope = actor.role === 'SUPER_ADMIN' ? null : { clinicId: kc.clinicId ?? -1n };
    const data = await exportTaxes(parsed.data as any, scope);
    return kcOk(data, 'Taxes data retrieved successfully');
  }),
);
```

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'api/v1/taxes' | head`
Expected: no output. Then `npx next lint --dir src/app/api/v1/taxes` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/v1/taxes
git commit -m "feat(billing): tax REST route handlers"
```

---

# Milestone 4 — Bill service + routes

### Task 14: `bill.service.ts` — calculate-tax

**Files:**
- Create: `src/services/billing/bill.service.ts`
- Test: `tests/billing/bill.service.test.ts`

This is the cleanest bill function to do first — it wires the tax-calculator to `KcTax` lookup with no writes.

- [ ] **Step 1: Write the failing test**

`tests/billing/bill.service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { calculateTax } from '@/services/billing/bill.service';

describe('bill.service calculateTax', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedTax({ id: 9000200, name: 'VAT', taxType: 'percentage', taxValue: '10' }); });
  afterAll(cleanup);

  it('returns total tax and per-service breakdown', async () => {
    const res = await calculateTax({
      clinic_id: -1, doctor_id: -1,
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, service_name: 'A' }],
    } as any);
    expect(res.total_tax).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(res.calculated_taxes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill.service.test.ts -t calculateTax`
Expected: FAIL — `calculateTax` not found.

- [ ] **Step 3: Implement**

`src/services/billing/bill.service.ts`:
```ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { toNum } from '@/lib/kc-num';
import { TaxCalculator } from './tax-calculator';

interface NormItem { serviceId: number; name: string; price: number; qty: number }

function normalizeItems(items: any[]): NormItem[] {
  return items.map((it) => ({
    serviceId: Number(it.serviceId ?? it.id ?? 0),
    name: String(it.service_name ?? it.name ?? ''),
    price: toNum(it.price),
    qty: Number(it.quantity ?? it.qty ?? 1),
  }));
}

/** Fetch taxes applicable to a (clinic, doctor) context. -1 = global. */
async function fetchApplicableTaxes(clinicId: number, doctorId: number) {
  return prisma.kcTax.findMany({
    where: {
      status: 1,
      OR: [{ clinicId: BigInt(clinicId) }, { clinicId: -1n }, { clinicId: null }],
      AND: [{ OR: [{ doctorId: BigInt(doctorId) }, { doctorId: -1n }, { doctorId: null }] }],
    },
  });
}

export interface CalculateTaxResult {
  total_tax: number;
  calculated_taxes: ReturnType<TaxCalculator['getCalculatedTaxes']>;
}

export async function calculateTax(input: { clinic_id?: number; doctor_id?: number; serviceItems: any[] }): Promise<CalculateTaxResult> {
  const items = normalizeItems(input.serviceItems);
  if (items.length === 0) throw new KcError('No service items provided', 400);

  const taxes = await fetchApplicableTaxes(input.clinic_id ?? -1, input.doctor_id ?? -1);
  const calc = new TaxCalculator();
  for (const it of items) calc.addService(it.serviceId, it.name, it.price, it.qty);
  for (const t of taxes) {
    // resolve mapping-id service_id → real service id for matching
    let svcIds: number[] = [];
    if (t.serviceId && t.serviceId !== -1n) {
      const map = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: t.serviceId }, select: { serviceId: true } });
      svcIds = map ? [Number(map.serviceId)] : [Number(t.serviceId)];
    }
    calc.addTax(Number(t.id), t.name ?? '', (t.taxType as any) ?? 'percentage', toNum(t.taxValue), svcIds);
  }
  calc.calculate('exclude');
  return { total_tax: calc.getTotalTax(), calculated_taxes: calc.getCalculatedTaxes() };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill.service.test.ts -t calculateTax`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill.service.ts tests/billing/bill.service.test.ts
git commit -m "feat(billing): bill.service calculate-tax"
```

---

### Task 15: `bill.service.ts` — create bill (transaction + side effects)

**Files:**
- Modify: `src/services/billing/bill.service.ts`
- Modify: `tests/billing/bill.service.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/billing/bill.service.test.ts`:
```ts
import { createBill, getBill } from '@/services/billing/bill.service';
import { prisma } from '@/lib/db';

describe('bill.service create', () => {
  beforeAll(async () => {
    assertTestDb();
    // seed an encounter to bill against
    await prisma.kcPatientEncounter.create({ data: { id: 9000300n, clinicId: 9000001n, doctorId: 9000002n, patientId: 9000003n, appointmentId: 9000004n, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
  });
  afterAll(async () => { await prisma.kcPatientEncounter.deleteMany({ where: { id: 9000300n } }); await cleanup(); });

  it('creates a bill + items in a transaction', async () => {
    const res = await createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000300, appointmentId: 9000004 },
      service_total: 100, total_amount: 100,
    } as any);
    expect(res.id).toBeGreaterThan(0);
    const items = await prisma.kcBillItem.findMany({ where: { billId: BigInt(res.id) } });
    expect(items).toHaveLength(1);
  });

  it('rejects a second bill for the same encounter (409)', async () => {
    await expect(createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000300, appointmentId: 9000004 },
      service_total: 100, total_amount: 100,
    } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "create"`
Expected: FAIL — `createBill` not found.

- [ ] **Step 3: Implement create**

Append to `src/services/billing/bill.service.ts`:
```ts
export interface BillRef { id: number; appointmentId?: number }
export interface BillCreateInput {
  serviceItems: any[]; taxItems: any[]; discount: number; discountEnabled?: boolean;
  status: 'paid' | 'unpaid'; clinic: BillRef; doctor: BillRef; patient: BillRef;
  patientEncounter: BillRef; service_total: number; total_amount: number; checkout?: boolean;
}

export async function createBill(input: BillCreateInput): Promise<{ id: number }> {
  const encounterId = BigInt(input.patientEncounter.id);

  const existing = await prisma.kcBill.findFirst({ where: { encounterId }, select: { id: true } });
  if (existing) throw new KcError('A bill already exists for this encounter', 409);

  const encounter = await prisma.kcPatientEncounter.findUnique({ where: { id: encounterId } });
  if (!encounter) throw new KcError('Encounter not found', 404);

  const items = normalizeItems(input.serviceItems);

  const billId = await prisma.$transaction(async (tx) => {
    const bill = await tx.kcBill.create({
      data: {
        encounterId,
        appointmentId: input.patientEncounter.appointmentId ? BigInt(input.patientEncounter.appointmentId) : null,
        totalAmount: String(input.total_amount),
        discount: String(input.discount ?? 0),
        actualAmount: String(input.total_amount),
        status: 0n,
        paymentStatus: input.status,
        clinicId: BigInt(input.clinic.id),
        createdAt: new Date(),
      },
      select: { id: true },
    });

    for (const it of items) {
      let serviceId = it.serviceId;
      // Auto-create a service if the line references none.
      if (!serviceId) {
        const svc = await tx.kcService.create({ data: { type: 'bill_service', name: it.name || 'Service', price: String(it.price), status: 1, createdAt: new Date() } as any, select: { id: true } });
        serviceId = Number(svc.id);
      }
      await tx.kcBillItem.create({ data: { billId: bill.id, itemId: BigInt(serviceId), qty: it.qty, price: String(it.price), createdAt: new Date() } });
    }

    // Persist applied taxes to wp_kc_tax_data (module_type='encounter').
    await tx.kcTaxData.deleteMany({ where: { moduleType: 'encounter', moduleId: encounterId } });
    for (const t of input.taxItems ?? []) {
      await tx.kcTaxData.create({ data: { moduleType: 'encounter', moduleId: encounterId, name: t.tax_name ?? '', charges: String(t.tax_amount ?? 0), taxValue: String(t.tax_value ?? 0), taxType: t.tax_type ?? 'percentage' } });
    }

    // Status side effects.
    if (input.status === 'paid') {
      await tx.kcPatientEncounter.update({ where: { id: encounterId }, data: { status: 0 } });
      if (encounter.appointmentId) await tx.kcAppointment.update({ where: { id: encounter.appointmentId }, data: { status: 3 } as any });
    } else {
      await tx.kcPatientEncounter.update({ where: { id: encounterId }, data: { status: 1 } });
    }
    return bill.id;
  });

  return { id: Number(billId) };
}
```

> **Note:** `kcAppointment` write requires the existing `KcAppointment` model to be writable (it is — it maps `wp_kc_appointments`; ensure no `@ignore`). The `kc_appointment_updated` / Google-Calendar side effects from KiviCare are **out of scope** for this slice (Google Calendar is a later slice); leave a `// TODO(followup-slice): fire kc_appointment_updated hook` comment.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "create"`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill.service.ts tests/billing/bill.service.test.ts
git commit -m "feat(billing): bill.service create (transaction + status side effects)"
```

---

### Task 16: `bill.service.ts` — get bill detail + by-encounter

**Files:**
- Modify: `src/services/billing/bill.service.ts`
- Modify: `tests/billing/bill.service.test.ts`

- [ ] **Step 1: Add the failing test**

Append:
```ts
import { getBillByEncounter } from '@/services/billing/bill.service';

describe('bill.service get', () => {
  it('reads back the created bill with serviceItems + recomputed totals', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000300n }, select: { id: true } });
    const bill = await getBill(Number(created!.id));
    expect(bill.serviceItems.length).toBeGreaterThanOrEqual(1);
    expect(bill).toHaveProperty('total_amount');
    expect(bill).toHaveProperty('taxItems');
  });

  it('by-encounter returns a skeleton when no bill exists', async () => {
    const res = await getBillByEncounter(9000999); // no bill, no encounter → skeleton/empty
    expect(res).toHaveProperty('status');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "get"`
Expected: FAIL — `getBill`/`getBillByEncounter` not found.

- [ ] **Step 3: Implement**

Append to `src/services/billing/bill.service.ts`:
```ts
import { toMoney } from '@/lib/kc-num';

export interface BillServiceItem {
  id: number; serviceId: number; service_name: string; quantity: number; price: number; total: number;
}
export interface BillTaxItem { id: number; tax_name: string; tax_type: string; tax_value: number; tax_amount: number; }
export interface BillDetail {
  id: number; invoiceId: number; date: Date; status: string;
  clinic: { id: number }; doctor: { id: number }; patient: { id: number };
  patientEncounter: { id: number; appointmentId: number | null };
  serviceItems: BillServiceItem[]; service_total: number; discount: number;
  totalTax: number; taxItems: BillTaxItem[]; total_amount: number; actual_amount: number;
}

export async function getBill(id: number): Promise<BillDetail> {
  const bill = await prisma.kcBill.findUnique({ where: { id: BigInt(id) } });
  if (!bill) throw new KcError('Bill not found', 404);

  const items = await prisma.kcBillItem.findMany({ where: { billId: bill.id } });
  const serviceIds = items.map((i) => i.itemId);
  const services = await prisma.kcService.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } });
  const nameById = new Map(services.map((s) => [s.id.toString(), s.name]));

  const serviceItems: BillServiceItem[] = items.map((i) => {
    const price = toNum(i.price); const total = toMoney(price * i.qty);
    return { id: Number(i.id), serviceId: Number(i.itemId), service_name: nameById.get(i.itemId.toString()) ?? '', quantity: i.qty, price, total };
  });
  const service_total = toMoney(serviceItems.reduce((a, s) => a + s.total, 0));

  const taxRows = await prisma.kcTaxData.findMany({ where: { moduleType: 'encounter', moduleId: bill.encounterId } });
  const taxItems: BillTaxItem[] = taxRows.map((t) => ({ id: Number(t.id), tax_name: t.name ?? '', tax_type: t.taxType ?? 'percentage', tax_value: toNum(t.taxValue), tax_amount: toNum(t.charges) }));
  const totalTax = toMoney(taxItems.reduce((a, t) => a + t.tax_amount, 0));
  const discount = toNum(bill.discount);

  return {
    id: Number(bill.id), invoiceId: Number(bill.id), date: bill.createdAt, status: bill.paymentStatus ?? 'unpaid',
    clinic: { id: Number(bill.clinicId ?? 0) }, doctor: { id: 0 }, patient: { id: 0 },
    patientEncounter: { id: Number(bill.encounterId), appointmentId: bill.appointmentId ? Number(bill.appointmentId) : null },
    serviceItems, service_total, discount, totalTax, taxItems,
    total_amount: toMoney(service_total + totalTax - discount), actual_amount: toNum(bill.actualAmount),
  };
}

export async function getBillByEncounter(encounterId: number): Promise<{ status: string } | BillDetail> {
  const bill = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(encounterId) }, select: { id: true } });
  if (bill) return getBill(Number(bill.id));
  const enc = await prisma.kcPatientEncounter.findUnique({ where: { id: BigInt(encounterId) } });
  if (!enc) return { status: 'unpaid' };
  return {
    // skeleton mirrors KiviCare's "Bill not found for this encounter" payload
    status: 'unpaid',
    // @ts-expect-error partial skeleton is intentional and matches KiviCare
    clinic: { id: Number(enc.clinicId) }, patient: { id: Number(enc.patientId) }, doctor: { id: Number(enc.doctorId) },
    patientEncounter: { id: Number(enc.id), appointmentId: enc.appointmentId ? Number(enc.appointmentId) : null }, serviceItems: [],
  };
}
```

> **Note:** the doctor/patient/clinic detail blocks (names, emails, profile images via `wp_usermeta`) are enriched in Task 18's list query and can be added to `getBill` using the same `metaToMap` helper. For this task, ids suffice to make detail functional; enrich names in Task 18 once the usermeta join is proven.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "get"`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill.service.ts tests/billing/bill.service.test.ts
git commit -m "feat(billing): bill.service get detail + by-encounter"
```

---

### Task 17: `bill.service.ts` — update, bill-item ops

**Files:**
- Modify: `src/services/billing/bill.service.ts`
- Modify: `tests/billing/bill.service.test.ts`

- [ ] **Step 1: Add failing tests**

Append:
```ts
import { updateBill, updateBillItem, deleteBillItem } from '@/services/billing/bill.service';

describe('bill.service update + items', () => {
  it('updates a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000300n } });
    const item = await prisma.kcBillItem.findFirst({ where: { billId: created!.id } });
    const r = await updateBillItem(Number(item!.id), { serviceId: 2, quantity: 3, price: 50 });
    expect(r.id).toBe(Number(item!.id));
    const after = await prisma.kcBillItem.findUnique({ where: { id: item!.id } });
    expect(after!.qty).toBe(3);
  });

  it('deletes a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000300n } });
    const item = await prisma.kcBillItem.create({ data: { billId: created!.id, itemId: 5n, qty: 1, price: '10', createdAt: new Date() } });
    const r = await deleteBillItem(Number(item.id));
    expect(r.id).toBe(Number(item.id));
    expect(await prisma.kcBillItem.findUnique({ where: { id: item.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "update + items"`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement**

Append:
```ts
export async function updateBill(id: number, input: BillCreateInput): Promise<{ id: number }> {
  const bill = await prisma.kcBill.findUnique({ where: { id: BigInt(id) } });
  if (!bill) throw new KcError('Bill not found', 404);
  const items = normalizeItems(input.serviceItems);
  await prisma.$transaction(async (tx) => {
    await tx.kcBill.update({
      where: { id: BigInt(id) },
      data: { totalAmount: String(input.total_amount), discount: String(input.discount ?? 0), actualAmount: String(input.total_amount), paymentStatus: input.status },
    });
    await tx.kcBillItem.deleteMany({ where: { billId: BigInt(id) } });
    for (const it of items) {
      let serviceId = it.serviceId;
      if (!serviceId) { const svc = await tx.kcService.create({ data: { type: 'bill_service', name: it.name || 'Service', price: String(it.price), status: 1, createdAt: new Date() } as any, select: { id: true } }); serviceId = Number(svc.id); }
      await tx.kcBillItem.create({ data: { billId: BigInt(id), itemId: BigInt(serviceId), qty: it.qty, price: String(it.price), createdAt: new Date() } });
    }
    await tx.kcTaxData.deleteMany({ where: { moduleType: 'encounter', moduleId: bill.encounterId } });
    for (const t of input.taxItems ?? []) await tx.kcTaxData.create({ data: { moduleType: 'encounter', moduleId: bill.encounterId, name: t.tax_name ?? '', charges: String(t.tax_amount ?? 0), taxValue: String(t.tax_value ?? 0), taxType: t.tax_type ?? 'percentage' } });
    if ((input.checkout || input.status === 'paid')) {
      await tx.kcPatientEncounter.update({ where: { id: bill.encounterId }, data: { status: 0 } });
      if (bill.appointmentId) await tx.kcAppointment.update({ where: { id: bill.appointmentId }, data: { status: 3 } as any });
    }
  });
  return { id };
}

export async function updateBillItem(itemId: number, input: { serviceId: number; quantity: number; price: number }): Promise<{ id: number }> {
  const item = await prisma.kcBillItem.findUnique({ where: { id: BigInt(itemId) } });
  if (!item) throw new KcError('Bill item not found', 404);
  await prisma.kcBillItem.update({ where: { id: BigInt(itemId) }, data: { itemId: BigInt(input.serviceId), qty: input.quantity, price: String(input.price) } });
  return { id: itemId };
}

export async function deleteBillItem(itemId: number): Promise<{ id: number }> {
  const item = await prisma.kcBillItem.findUnique({ where: { id: BigInt(itemId) } });
  if (!item) throw new KcError('Bill item not found', 404);
  await prisma.kcBillItem.delete({ where: { id: BigInt(itemId) } });
  return { id: itemId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "update + items"`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill.service.ts tests/billing/bill.service.test.ts
git commit -m "feat(billing): bill.service update + bill-item ops"
```

---

### Task 18: `bill.service.ts` — list (scoped, filtered, paginated) + encounters-without-bill + export

**Files:**
- Modify: `src/services/billing/bill.service.ts`
- Modify: `tests/billing/bill.service.test.ts`

- [ ] **Step 1: Add failing tests**

Append:
```ts
import { listBills, encountersWithoutBill, exportBills } from '@/services/billing/bill.service';

describe('bill.service list', () => {
  it('lists bills with pagination meta and role scope (superadmin = all)', async () => {
    const res = await listBills({ page: 1, perPage: 10 } as any, null);
    expect(res.pagination).toHaveProperty('total');
    expect(Array.isArray(res.billings)).toBe(true);
  });

  it('lists encounters without a bill', async () => {
    const res = await encountersWithoutBill(null);
    expect(res).toHaveProperty('count');
  });

  it('exports bills as shaped rows', async () => {
    const res = await exportBills({ page: 1, perPage: 'all' } as any, null);
    expect(Array.isArray(res.bills)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "list"`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement**

Append to `src/services/billing/bill.service.ts`. Uses raw SQL for the multi-join (patient/doctor/clinic names via `wp_usermeta`). `scope` carries role-based filters.

```ts
export interface BillScope { clinicId?: bigint; doctorId?: bigint; patientId?: bigint }

export interface BillListParams {
  search?: string; status?: string; date_from?: string; date_to?: string;
  page: number; perPage: number | 'all'; orderBy?: string; order?: string;
  id?: number; encounter_id?: number; doctorName?: string; clinicName?: string; patientName?: string; serviceName?: string;
}

const BILL_SORT: Record<string, string> = {
  invoiceId: 'bills.id', id: 'bills.id', encounter_id: 'bills.encounter_id',
  total_amount: 'CAST(bills.total_amount AS DECIMAL(10,2))', discount: 'CAST(bills.discount AS DECIMAL(10,2))',
  actual_amount: 'CAST(bills.actual_amount AS DECIMAL(10,2))', date: 'bills.created_at', status: 'bills.payment_status',
};

export async function listBills(p: BillListParams, scope: BillScope | null) {
  const where: string[] = ['1=1']; const args: any[] = [];
  if (p.id) { where.push('bills.id = ?'); args.push(p.id); }
  if (p.encounter_id) { where.push('bills.encounter_id = ?'); args.push(p.encounter_id); }
  if (p.status) { where.push('bills.payment_status = ?'); args.push(p.status); }
  if (p.date_from) { where.push('DATE(bills.created_at) >= ?'); args.push(p.date_from); }
  if (p.date_to) { where.push('DATE(bills.created_at) <= ?'); args.push(p.date_to); }
  if (scope?.clinicId !== undefined) { where.push('bills.clinic_id = ?'); args.push(Number(scope.clinicId)); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(Number(scope.doctorId)); }
  if (scope?.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(Number(scope.patientId)); }
  if (p.search) {
    where.push('(bills.id LIKE ? OR clinics.name LIKE ? OR bills.payment_status LIKE ?)');
    args.push(`%${p.search}%`, `%${p.search}%`, `%${p.search}%`);
  }
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(DISTINCT bills.id) c
     FROM wp_kc_bills bills
     LEFT JOIN wp_kc_patient_encounters pe ON bills.encounter_id = pe.id
     LEFT JOIN wp_kc_clinics clinics ON bills.clinic_id = clinics.id
     WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.c ?? 0);

  const orderCol = BILL_SORT[p.orderBy ?? 'id'] ?? 'bills.id';
  const orderDir = (p.order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const perPage = p.perPage === 'all' ? total || 1 : (p.perPage as number);
  const limitSql = p.perPage === 'all' ? '' : `LIMIT ${perPage} OFFSET ${(p.page - 1) * perPage}`;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT bills.*, pe.doctor_id, pe.patient_id, pe.appointment_id,
            clinics.name AS clinic_name, clinics.email AS clinic_email,
            d.display_name AS doctor_name, d.user_email AS doctor_email,
            pt.display_name AS patient_name, pt.user_email AS patient_email
     FROM wp_kc_bills bills
     LEFT JOIN wp_kc_patient_encounters pe ON bills.encounter_id = pe.id
     LEFT JOIN wp_kc_clinics clinics ON bills.clinic_id = clinics.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${whereSql}
     GROUP BY bills.id
     ORDER BY ${orderCol} ${orderDir}
     ${limitSql}`, ...args);

  const billings = rows.map((r) => ({
    id: Number(r.id), invoiceId: Number(r.id), encounter_id: Number(r.encounter_id), date: r.created_at,
    status: r.payment_status ?? 'unpaid',
    patient: { name: r.patient_name ?? '', email: r.patient_email ?? '' },
    clinic: { id: Number(r.clinic_id ?? 0), name: r.clinic_name ?? '', email: r.clinic_email ?? '' },
    doctor: { id: Number(r.doctor_id ?? 0), name: r.doctor_name ?? '', email: r.doctor_email ?? '' },
    services: '', discount: toNum(r.discount), total_amount: toNum(r.total_amount), actual_amount: toNum(r.actual_amount),
  }));

  return { billings, pagination: { total, perPage, currentPage: p.page, lastPage: Math.max(1, Math.ceil(total / perPage)) } };
}

export async function encountersWithoutBill(scope: BillScope | null) {
  const where: string[] = ['pe.id NOT IN (SELECT encounter_id FROM wp_kc_bills WHERE encounter_id IS NOT NULL)'];
  const args: any[] = [];
  if (scope?.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(Number(scope.clinicId)); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(Number(scope.doctorId)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${where.join(' AND ')}
     ORDER BY pe.id DESC`, ...args);
  const encounters = rows.map((r) => ({
    id: Number(r.id), encounterDate: r.encounter_date, patientId: Number(r.patient_id), clinicId: Number(r.clinic_id),
    doctorId: Number(r.doctor_id), status: r.status, description: r.description ?? '', appointmentId: r.appointment_id ? Number(r.appointment_id) : null,
    patientName: r.patient_name ?? '', clinicName: r.clinic_name ?? '', doctorName: r.doctor_name ?? '',
  }));
  return { encounters, count: encounters.length };
}

export async function exportBills(p: BillListParams, scope: BillScope | null) {
  const list = await listBills({ ...p, perPage: 'all' }, scope);
  const bills = list.billings.map((b) => ({
    id: b.id, total_amount: b.total_amount, discount: b.discount || '-', actual_amount: b.actual_amount,
    encounter_id: b.encounter_id, clinic_id: b.clinic.id, doctor_id: b.doctor.id, patient_id: 0,
    status: b.status, doctor_name: b.doctor.name, patient_name: b.patient.name, clinic_name: b.clinic.name, service_name: b.services,
  }));
  return { bills };
}
```

> **Implementation note:** KiviCare also enriches names from `wp_usermeta` (`first_name`/`last_name`) rather than `display_name`. If `display_name` is empty in your data, add a correlated subquery or join to `wp_usermeta` using `metaToMap` per row. Start with `display_name`; switch to usermeta if integration data shows blanks.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill.service.test.ts -t "list"`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill.service.ts tests/billing/bill.service.test.ts
git commit -m "feat(billing): bill.service list + encounters-without-bill + export"
```

---

### Task 19: Bill route handlers (non-document)

**Files:**
- Create: `src/app/api/v1/bills/route.ts` (GET list, POST)
- Create: `src/app/api/v1/bills/[id]/route.ts` (GET, PUT)
- Create: `src/app/api/v1/bills/by-encounter/[encounterId]/route.ts` (GET)
- Create: `src/app/api/v1/bills/calculate-tax/route.ts` (POST)
- Create: `src/app/api/v1/bills/encounters-without-bill/route.ts` (GET)
- Create: `src/app/api/v1/bills/export/route.ts` (GET)
- Create: `src/app/api/v1/bills/item/[itemId]/route.ts` (PUT, DELETE)

Add a small scope helper used by all list routes.

- [ ] **Step 1: Add `billScopeFor` to `kc-permissions.ts`**

Append to `src/services/billing/kc-permissions.ts`:
```ts
import type { KcActor } from './kc-actor';
import type { BillScope } from './bill.service';

/** Translate a KcActor into a bill query scope (null = unrestricted). */
export function billScopeFor(kc: KcActor): BillScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
```

- [ ] **Step 2: `bills/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { listBills, createBill } from '@/services/billing/bill.service';
import { billListQuerySchema, billCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    const parsed = billListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    const data = await listBills(parsed.data as any, billScopeFor(kc));
    return kcOk(data, 'Bills retrieved successfully');
  }),
);

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const parsed = billCreateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    const data = await createBill(parsed.data as any);
    return kcOk(data, 'Bill created successfully');
  }),
);
```

- [ ] **Step 3: `bills/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { getBill, updateBill } from '@/services/billing/bill.service';
import { billUpdateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    return kcOk(await getBill(Number(params.id)), 'Bill retrieved successfully');
  }),
);

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const parsed = billUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    return kcOk(await updateBill(Number(params.id), parsed.data as any), 'Bill updated successfully');
  }),
);
```

- [ ] **Step 4: Remaining bill routes**

`bills/by-encounter/[encounterId]/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { getBillByEncounter } from '@/services/billing/bill.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    return kcOk(await getBillByEncounter(Number(params.encounterId)), 'Bill fetched');
  }),
);
```

`bills/calculate-tax/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { calculateTax } from '@/services/billing/bill.service';
import { calculateTaxSchema } from '@/services/billing/validation';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const parsed = calculateTaxSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    return kcOk(await calculateTax(parsed.data as any), 'Tax calculated successfully');
  }),
);
```

`bills/encounters-without-bill/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { encountersWithoutBill } from '@/services/billing/bill.service';

export const GET = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    return kcOk(await encountersWithoutBill(billScopeFor(kc)), 'Encounters without bill retrieved successfully');
  }),
);
```

`bills/export/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { exportBills } from '@/services/billing/bill.service';
import { billListQuerySchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_list');
    const kc = await resolveKcActor(actor);
    const parsed = billListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return kcFail('Invalid query', 400);
    return kcOk(await exportBills(parsed.data as any, billScopeFor(kc)), 'Bills data retrieved successfully');
  }),
);
```

`bills/item/[itemId]/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { updateBillItem, deleteBillItem } from '@/services/billing/bill.service';
import { billItemUpdateSchema } from '@/services/billing/validation';

export const PUT = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_add');
    const parsed = billItemUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return kcFail('Invalid input', 400);
    return kcOk(await updateBillItem(Number(params.itemId), parsed.data), 'Bill item updated successfully');
  }),
);

export const DELETE = withAuth(async (_req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_delete');
    return kcOk(await deleteBillItem(Number(params.itemId)), 'Bill item deleted successfully');
  }),
);
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'api/v1/bills|kc-permissions' | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/bills src/services/billing/kc-permissions.ts
git commit -m "feat(billing): bill REST route handlers (non-document)"
```

---

# Milestone 5 — Bill documents (PDF + email)

### Task 20: `bill-document.service.ts` — invoice HTML + PDF

**Files:**
- Create: `src/services/billing/bill-document.service.ts`
- Test: `tests/billing/bill-document.service.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/billing/bill-document.service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderInvoiceHtml } from '@/services/billing/bill-document.service';

describe('bill-document html', () => {
  it('renders bill fields into HTML', () => {
    const html = renderInvoiceHtml({
      id: 7, invoiceId: 7, date: new Date('2026-01-02'), status: 'paid',
      clinic: { id: 1, name: 'Clinic A', email: 'c@a.test' } as any,
      doctor: { id: 2, name: 'Dr B' } as any, patient: { id: 3, name: 'Pat C' } as any,
      patientEncounter: { id: 9, appointmentId: null },
      serviceItems: [{ id: 1, serviceId: 1, service_name: 'Counseling', quantity: 1, price: 100, total: 100 }],
      service_total: 100, discount: 0, totalTax: 10,
      taxItems: [{ id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 10 }],
      total_amount: 110, actual_amount: 110,
    } as any, { currencyPrefix: 'Rp', currencyPostfix: '' });
    expect(html).toContain('Counseling');
    expect(html).toContain('Clinic A');
    expect(html).toContain('110');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill-document.service.test.ts -t html`
Expected: FAIL — `renderInvoiceHtml` not found.

- [ ] **Step 3: Implement HTML render + PDF**

`src/services/billing/bill-document.service.ts`:
```ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { getBill, type BillDetail } from './bill.service';

export interface CurrencyFmt { currencyPrefix: string; currencyPostfix: string }

function money(n: number, c: CurrencyFmt): string {
  return `${c.currencyPrefix}${n.toFixed(2)}${c.currencyPostfix}`;
}

/** Pure HTML render of the invoice — ported from KCBillPrintTemplate.php. */
export function renderInvoiceHtml(bill: BillDetail, c: CurrencyFmt): string {
  const rows = bill.serviceItems
    .map((s) => `<tr><td>${s.service_name}</td><td>${s.quantity}</td><td>${money(s.price, c)}</td><td>${money(s.total, c)}</td></tr>`)
    .join('');
  const taxRows = bill.taxItems
    .map((t) => `<tr><td colspan="3">${t.tax_name} (${t.tax_type === 'percentage' ? `${t.tax_value}%` : 'fixed'})</td><td>${money(t.tax_amount, c)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#222;padding:24px}
    h1{font-size:20px} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
    .totals td{font-weight:bold}
  </style></head><body>
    <h1>Invoice #${bill.invoiceId}</h1>
    <p><strong>${bill.clinic.name ?? ''}</strong> ${bill.clinic.email ?? ''}</p>
    <p>Patient: ${bill.patient.name ?? ''} &middot; Doctor: ${bill.doctor.name ?? ''}</p>
    <p>Date: ${new Date(bill.date).toISOString().slice(0, 10)} &middot; Status: ${bill.status}</p>
    <table><thead><tr><th>Service</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${rows}
      <tr class="totals"><td colspan="3">Subtotal</td><td>${money(bill.service_total, c)}</td></tr>
      ${taxRows}
      <tr class="totals"><td colspan="3">Discount</td><td>${money(bill.discount, c)}</td></tr>
      <tr class="totals"><td colspan="3">Total</td><td>${money(bill.total_amount, c)}</td></tr>
    </tbody></table>
  </body></html>`;
}

/** Resolve clinic currency from kc_options (kivicare settings). Falls back to no prefix. */
export async function resolveCurrency(): Promise<CurrencyFmt> {
  const opt = await prisma.kcOption.findFirst({ where: { optionName: 'kivicare_currency_setting' }, select: { optionValue: true } });
  if (!opt) return { currencyPrefix: '', currencyPostfix: '' };
  try {
    const cfg = JSON.parse(opt.optionValue) as { prefix?: string; postfix?: string };
    return { currencyPrefix: cfg.prefix ?? '', currencyPostfix: cfg.postfix ?? '' };
  } catch {
    return { currencyPrefix: '', currencyPostfix: '' };
  }
}

/** Generate a PDF buffer for a bill. Uses Puppeteer (nodejs runtime). */
export async function generateBillPdf(billId: number): Promise<Buffer> {
  const bill = await getBill(billId); // throws 404 if missing
  const currency = await resolveCurrency();
  const html = renderInvoiceHtml(bill, currency);

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '16px', right: '16px' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

> The `KcError` import is used by `generateBillPdf` indirectly via `getBill`. Keep the import for clarity even though it is not thrown here directly; if lint flags it as unused, remove it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/billing/bill-document.service.test.ts -t html`
Expected: 1 passed. (PDF generation is exercised in the integration test, not unit — it needs Chromium.)

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/bill-document.service.ts tests/billing/bill-document.service.test.ts
git commit -m "feat(billing): invoice HTML render + Puppeteer PDF"
```

---

### Task 21: `bill-document.service.ts` — email bill

**Files:**
- Modify: `src/services/billing/bill-document.service.ts`
- Modify: `tests/billing/bill-document.service.test.ts`

- [ ] **Step 1: Add the failing test (mock sendEmail + puppeteer + prisma)**

Append to `tests/billing/bill-document.service.test.ts`:
```ts
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) }));
vi.mock('@/services/billing/bill.service', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, getBill: vi.fn().mockResolvedValue({
    id: 7, invoiceId: 7, date: new Date(), status: 'paid',
    clinic: { id: 1, name: 'Clinic A', email: 'c@a.test' }, doctor: { id: 2, name: 'Dr B' }, patient: { id: 3, name: 'Pat C' },
    patientEncounter: { id: 9, appointmentId: null },
    serviceItems: [], service_total: 0, discount: 0, totalTax: 0, taxItems: [], total_amount: 0, actual_amount: 0,
  }) };
});
vi.mock('puppeteer', () => ({ default: { launch: vi.fn().mockResolvedValue({
  newPage: vi.fn().mockResolvedValue({ setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(Buffer.from('PDF')) }),
  close: vi.fn(),
}) } }));

import { emailBill } from '@/services/billing/bill-document.service';
import { sendEmail } from '@/lib/email';

describe('emailBill', () => {
  it('sends the invoice PDF to the patient', async () => {
    const res = await emailBill(7, 'pat@c.test');
    expect(res).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/billing/bill-document.service.test.ts -t emailBill`
Expected: FAIL — `emailBill` not found.

- [ ] **Step 3: Implement emailBill**

Append to `src/services/billing/bill-document.service.ts`:
```ts
import { sendEmail } from '@/lib/email';

/** Email a bill PDF to the given recipient. `to` defaults to the bill's patient email when omitted. */
export async function emailBill(billId: number, to: string): Promise<boolean> {
  if (!to) throw new KcError('Recipient email is required', 400);
  const bill = await getBill(billId);
  const pdf = await generateBillPdf(billId);

  const result = await sendEmail({
    to,
    subject: `Invoice #${bill.invoiceId} from ${bill.clinic.name ?? 'your clinic'}`,
    html: `<p>Dear ${bill.patient.name ?? 'patient'},</p><p>Please find your invoice #${bill.invoiceId} attached.</p>`,
    template: 'kivicare_patient_invoice',
    // Resend attachment support: see https://resend.com/docs (content = base64).
    // sendEmail() is extended below to forward attachments.
    // @ts-expect-error attachments is an optional extension to SendEmailInput
    attachments: [{ filename: `bill_${bill.invoiceId}.pdf`, content: pdf.toString('base64') }],
  });
  if (!result.ok) throw new KcError('Failed to send bill email', 502);
  return true;
}
```

- [ ] **Step 4: Extend `sendEmail` to forward attachments**

Modify `src/lib/email.ts`:
- In `SendEmailInput`, add: `attachments?: { filename: string; content: string }[];`
- In the Resend `body`, add `attachments: input.attachments ?? undefined,` to the JSON payload.

Concrete edit to the `body: JSON.stringify({...})` block:
```ts
      body: JSON.stringify({
        from: FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text ?? '',
        attachments: input.attachments ?? undefined,
      }),
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/billing/bill-document.service.test.ts -t emailBill`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add src/services/billing/bill-document.service.ts src/lib/email.ts tests/billing/bill-document.service.test.ts
git commit -m "feat(billing): email bill PDF via Resend attachment"
```

---

### Task 22: Bill document route handlers (print + email)

**Files:**
- Create: `src/app/api/v1/bills/[id]/print/route.ts`
- Create: `src/app/api/v1/bills/[id]/email/route.ts`

- [ ] **Step 1: `bills/[id]/print/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { generateBillPdf } from '@/services/billing/bill-document.service';
import { KcError } from '@/lib/kc-response';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const pdf = await generateBillPdf(Number(params.id));
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="bill_${params.id}_${Date.now()}.pdf"`,
      },
    });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[kc] print failed', err);
    return kcFail('Failed to generate PDF', 500);
  }
});
```

- [ ] **Step 2: `bills/[id]/email/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcOk, kcHandle, kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { emailBill } from '@/services/billing/bill-document.service';
import { getBill } from '@/services/billing/bill.service';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) =>
  kcHandle(async () => {
    const { actor, params } = ctx as any;
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const body = await req.json().catch(() => ({}));
    // Prefer explicit `to`; otherwise fall back to the bill's patient email.
    let to: string = body?.to ?? '';
    if (!to) {
      const bill = await getBill(Number(params.id));
      // patient.email is enriched in the list/detail usermeta join; if absent, require `to`.
      to = (bill as any).patient?.email ?? '';
    }
    if (!to) return kcFail('No recipient email available for this bill', 400);
    await emailBill(Number(params.id), to);
    return kcOk(true, 'Bill sent successfully');
  }),
);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'bills/\[id\]/(print|email)' | head`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/bills/[id]/print src/app/api/v1/bills/[id]/email
git commit -m "feat(billing): bill print (PDF) + email route handlers"
```

---

# Milestone 6 — Integration + close-out

### Task 23: Route integration tests (envelope + auth matrix)

**Files:**
- Create: `tests/billing/routes.integration.test.ts`

Exercise representative routes via their exported handlers with a forged JWT, asserting envelope shape and the permission matrix. Build a token with `jose` and the dev `AUTH_SECRET`.

- [ ] **Step 1: Write the tests**

`tests/billing/routes.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { seedTax, seedClinicAdmin, cleanup, assertTestDb } from './fixtures';
import { GET as taxesGet, POST as taxesPost } from '@/app/api/v1/taxes/route';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url = 'http://localhost/api/v1/taxes', init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

describe('taxes routes', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedClinicAdmin({ userId: 9000001, clinicId: 9000001 }); await seedTax({ id: 9000400, name: 'VAT' }); });
  afterAll(cleanup);

  it('GET /taxes returns the {status,message,data} envelope', async () => {
    const res = await taxesGet(reqWith(await token('CLINIC_ADMIN')), {} as any);
    const json = await res.json();
    expect(json).toHaveProperty('status', true);
    expect(json.data).toHaveProperty('taxes');
  });

  it('POST /taxes denied for PROFESSIONAL (403)', async () => {
    const res = await taxesPost(reqWith(await token('PROFESSIONAL'), 'http://localhost/api/v1/taxes', {
      method: 'POST', body: JSON.stringify({ name: 'X', rateValue: 5 }),
    }), {} as any);
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe(false);
  });

  it('GET /taxes rejected without token (401)', async () => {
    const res = await taxesGet(new NextRequest('http://localhost/api/v1/taxes'), {} as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/billing/routes.integration.test.ts`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/billing/routes.integration.test.ts
git commit -m "test(billing): route envelope + auth-matrix integration tests"
```

---

### Task 24: Full suite, build, lint, close-out

**Files:** none (verification + docs)

- [ ] **Step 1: Run the whole billing suite**

Run: `npx vitest run tests/billing`
Expected: all tests pass.

- [ ] **Step 2: Type-check + lint + build**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx next lint --dir src/app/api/v1 --dir src/services/billing
npm run build
```
Expected: no type errors, no lint errors, build succeeds (`prisma generate && next build`).

- [ ] **Step 3: Manual smoke (optional, against a dev WP DB)**

With a running dev server and a valid JWT:
```bash
curl -s -H "Authorization: Bearer $JWT" http://localhost:3000/api/v1/taxes | head -c 400
curl -s -H "Authorization: Bearer $JWT" "http://localhost:3000/api/v1/bills?perPage=5" | head -c 400
```
Expected: `{"status":true,"message":"...","data":{...}}`.

- [ ] **Step 4: Update the design doc status + commit**

Edit `docs/superpowers/specs/2026-06-28-kivicare-pro-billing-taxes-design.md` header `Status:` → `Implemented (slice 1)`.

```bash
git add docs/superpowers/specs/2026-06-28-kivicare-pro-billing-taxes-design.md
git commit -m "docs(billing): mark billing+taxes slice implemented"
```

- [ ] **Step 5: Open the PR (only if the user asks)**

```bash
git push -u origin feat/kivicare-pro-billing-taxes
gh pr create --title "KiviCare-Pro Billing + Taxes (Next.js port)" --body "Ports ~21 billing/tax endpoints to /api/v1 over wp_kc_* tables. See docs/superpowers/specs/2026-06-28-kivicare-pro-billing-taxes-design.md"
```

---

## Endpoint → Task coverage map (self-review)

| Endpoint | Task |
|---|---|
| GET /taxes | 10, 13 |
| GET /taxes/{id} | 10, 13 |
| POST /taxes | 11, 13 |
| PUT /taxes/{id} | 12, 13 |
| DELETE /taxes/{id} | 12, 13 |
| PUT /taxes/{id}/status | 12, 13 |
| PUT /taxes/bulk/status | 12, 13 |
| POST /taxes/bulk/delete | 12, 13 |
| GET /taxes/export | 12, 13 |
| GET /bills | 18, 19 |
| GET /bills/{id} | 16, 19 |
| GET /bills/by-encounter/{encounterId} | 16, 19 |
| POST /bills | 15, 19 |
| PUT /bills/{id} | 17, 19 |
| POST /bills/calculate-tax | 14, 19 |
| GET /bills/encounters-without-bill | 18, 19 |
| PUT /bills/item/{itemId} | 17, 19 |
| DELETE /bills/item/{itemId} | 17, 19 |
| GET /bills/export | 18, 19 |
| POST /bills/{id}/email | 21, 22 |
| GET /bills/{id}/print | 20, 22 |

All 21 endpoints covered. Tax calculator (Task 6), permissions (Task 5), data models (Task 2), and the ID resolver (Task 4) underpin them.
