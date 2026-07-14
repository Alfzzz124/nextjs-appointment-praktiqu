# Appointment Payment via WooCommerce + Xendit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the five 501 payment stubs (`sessions/payment-{cancel,success,verify,webhook}`, `public/payment-verify`) plus a new `public/payments` route with a working Xendit-via-WooCommerce payment flow for both public/guest bookings and staff-created bills, backed by a new `payment_orders` table and a WordPress `praktiqu-endpoint` plugin extension.

**Architecture:** Next.js owns the `payment_orders` state machine (`pending → paid|failed|expired|cancelled`, one-way, idempotent) and computes amounts. The WP plugin's new `Payments` class creates a WooCommerce order directly (KiviCare `create_wc_direct_order` pattern), and reports status back via a dedicated, separately-secreted signed webhook plus a verify-fallback GET. Auto-cancel runs on WP's Action Scheduler via the existing `/praktiqu/v1/jobs` bridge.

**Tech Stack:** Next.js 14 App Router + TypeScript + Prisma (MySQL) + Zod + vitest; WordPress PHP 7.4+ plugin (`praktiqu-endpoint`) + WooCommerce.

Source design: `docs/superpowers/specs/2026-07-14-appointment-payment-xendit-woocommerce-design.md` (Approved).

## Global Constraints

- Payment window: **1 hour** hold before auto-cancel (`AUTO_CANCEL_MS = 60 * 60 * 1000`).
- Verify-fallback threshold: reconcile with WP only after a payment order has been `pending` for **> 2 minutes** (`VERIFY_FALLBACK_MS = 2 * 60 * 1000`).
- Webhook signing: HMAC-SHA256, constant-time compare (`crypto.timingSafeEqual`), header `X-PraktiQU-Webhook-Signature`.
- New secret `PAYMENT_WEBHOOK_SECRET` — **never** reuse `AUTH_SECRET` or `WORDPRESS_WEBHOOK_SECRET**. Kept as its own WP plugin option pair (`praktiqu_endpoint_payment_webhook_url` / `_secret`) so payment-webhook trust is independently rotatable from the general user-lifecycle webhook.
- `payment_orders.wcOrderId` is **UNIQUE** — the idempotency anchor. All status writes are guarded SQL (`WHERE status = 'pending'`) so `paid` never reverts to `pending` and `expired` never overrides `paid`.
- **Never** run `prisma migrate dev` / `prisma db push` (DATABASE_URL is the live WordPress DB). New tables are added via a hand-written SQL script under `docs/deploy/`, applied manually; `prisma/schema.prisma` is hand-edited to match, then only `prisma generate` (safe, no DB writes) is run.
- Money is **integer rupiah** (no fractional subunit) everywhere in `payment_orders` and the WC-order-creation payload.
- Guests may only ever address a payment by their existing HMAC appointment token (`src/lib/public/appointment-token.ts`) — never a raw appointment id, to avoid id enumeration.
- All new/modified TS routes use `@/lib/problem-details` (RFC 7807) for error responses, matching the sibling `public/*` and `sessions/*` routes already in the codebase.
- WP plugin PHP has no automated test harness in this repo (vitest only covers `src/`) — PHP tasks below end in a manual verification checklist instead of a TDD cycle.

---

## Task 1: `payment_orders` table — Prisma model + scoped SQL

**Files:**
- Modify: `prisma/schema.prisma` (append after the `Tax` model, ~line 960)
- Create: `docs/deploy/staging-schema-2026-07-14-payment-orders.sql`

**Interfaces:**
- Produces: Prisma model `PaymentOrder` with fields `id, source, appointmentId, billId, encounterId, wcOrderId, expectedAmount, status, transactionId, paidAt, webhookPayload, createdAt, updatedAt` — every later task's `prisma.paymentOrder.*` calls depend on this exact shape.

- [ ] **Step 1: Add the Prisma model**

Insert into `prisma/schema.prisma` right after the `model Tax { ... }` block (~line 960):

```prisma
model PaymentOrder {
  id             String    @id @default(cuid())
  source         String // 'public' | 'session'
  appointmentId  String?
  billId         String? // legacy wp_kc_bills.id, stored as string
  encounterId    String? // legacy wp_kc_patient_encounters.id, stored as string
  wcOrderId      Int       @unique
  expectedAmount Int // integer rupiah
  status         String    @default("pending") // pending|paid|failed|expired|cancelled
  transactionId  String?
  paidAt         DateTime?
  webhookPayload Json?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([appointmentId])
  @@index([billId])
  @@index([status])
  @@map("payment_orders")
}
```

- [ ] **Step 2: Write the scoped SQL migration script**

Create `docs/deploy/staging-schema-2026-07-14-payment-orders.sql`:

```sql
-- ============================================================================
-- Staging schema update for the payment-orders feature (2026-07-14)
-- ============================================================================
--
-- Apply this to the STAGING database only (a copy of `wordpress-praktiqu`),
-- and to the local `wordpress-praktiqu-test` DB before running vitest's
-- integration suites.
--
-- WHY MANUAL SQL, NOT PRISMA:
--   DATABASE_URL is the WordPress DB itself, and prisma/schema.prisma maps BOTH
--   app tables AND the wp_* tables into one datasource. `prisma db push` /
--   `prisma migrate dev` would see the wp_* tables as drift and try to
--   alter/drop them — corrupting WordPress. Run this script directly instead
--   (mysql CLI, phpMyAdmin, Adminer, etc.). Only `prisma generate` is safe.
--
-- Idempotency: CREATE TABLE uses IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `payment_orders` (
  `id`             VARCHAR(191) NOT NULL,
  `source`         VARCHAR(20)  NOT NULL,
  `appointmentId`  VARCHAR(191) NULL,
  `billId`         VARCHAR(191) NULL,
  `encounterId`    VARCHAR(191) NULL,
  `wcOrderId`      INT          NOT NULL,
  `expectedAmount` INT          NOT NULL,
  `status`         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `transactionId`  VARCHAR(191) NULL,
  `paidAt`         DATETIME(3)  NULL,
  `webhookPayload` JSON         NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payment_orders_wcOrderId_key` (`wcOrderId`),
  INDEX `payment_orders_appointmentId_idx` (`appointmentId`),
  INDEX `payment_orders_billId_idx` (`billId`),
  INDEX `payment_orders_status_idx` (`status`)
) DEFAULT CHARSET = utf8mb4;
```

- [ ] **Step 3: Apply to the test DB and regenerate the Prisma client**

Run:
```bash
mysql -h 127.0.0.1 -u <user> -p wordpress-praktiqu-test < docs/deploy/staging-schema-2026-07-14-payment-orders.sql
npx prisma generate
```
Expected: no errors; `node_modules/.prisma/client` regenerated with a `PaymentOrder` model.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma docs/deploy/staging-schema-2026-07-14-payment-orders.sql
git commit -m "feat(payments): add payment_orders table (scoped SQL, no prisma migrate)"
```

---

## Task 2: `payment.service.ts` — money math

**Files:**
- Create: `src/services/payments/payment.service.ts`
- Test: `tests/payments/payment-service.test.ts`

**Interfaces:**
- Consumes: `calculateTax(input: { clinic_id?: number; doctor_id?: number; serviceItems: any[] }): Promise<CalculateTaxResult>` and `getBill` types from `@/services/billing/bill.service` (already exists); `toNum` from `@/lib/kc-num`.
- Produces: `computePublicAmount(service: { name: string; price: number | string }): Promise<ComputedAmount>`, `computeSessionAmountFromBill(bill: BillDetail): ComputedAmount`, types `PaymentLineItem { name: string; price: number }`, `PaymentTaxLine { name: string; amount: number }`, `ComputedAmount { expectedAmount: number; items: PaymentLineItem[]; taxes: PaymentTaxLine[] }`. Later tasks import these three types/functions verbatim.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/payment-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// computePublicAmount only needs calculateTax's *shape*, not a live DB — the
// real calculateTax hits prisma.kcTax.findMany() against whatever DATABASE_URL
// vitest is wired to (wordpress-praktiqu-test, per .env.test.local), and that
// table is NOT test-isolated (bill.service.test.ts's own 'calculateTax' suite
// seeds a global clinicId=-1 tax row that its cleanup() never deletes, since
// cleanup only deletes `WHERE clinic_id >= TEST_MARKER`). Mocking here keeps
// this a fast, deterministic unit test instead of an accidental integration
// test coupled to another suite's leftover fixture data.
const calculateTaxMock = vi.fn();
vi.mock('@/services/billing/bill.service', () => ({ calculateTax: calculateTaxMock }));

beforeEach(() => {
  vi.clearAllMocks();
  calculateTaxMock.mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
});

import { computePublicAmount, computeSessionAmountFromBill } from '@/services/payments/payment.service';
import type { BillDetail } from '@/services/billing/bill.service';

describe('payment.service money math', () => {
  it('computePublicAmount: no taxes → expectedAmount equals price', async () => {
    const result = await computePublicAmount({ name: 'Consultation', price: 150000 });
    expect(result.expectedAmount).toBe(150000);
    expect(result.items).toEqual([{ name: 'Consultation', price: 150000 }]);
  });

  it('computePublicAmount: rounds a string price to an integer', async () => {
    const result = await computePublicAmount({ name: 'Consultation', price: '99999.6' });
    expect(result.expectedAmount).toBe(100000);
  });

  it('computePublicAmount: adds a global tax reported by calculateTax', async () => {
    calculateTaxMock.mockResolvedValue({
      total_tax: 15000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 15000, service_id: 0, service_name: 'Consultation' }],
    });
    const result = await computePublicAmount({ name: 'Consultation', price: 150000 });
    expect(result.expectedAmount).toBe(165000);
    expect(result.taxes).toEqual([{ name: 'VAT', amount: 15000 }]);
  });

  it('computeSessionAmountFromBill: passes through the bill total as integer rupiah', () => {
    const bill = {
      total_amount: 250000.4,
      serviceItems: [{ id: 1, serviceId: 1, service_name: 'Therapy', quantity: 1, price: 250000, total: 250000 }],
      taxItems: [{ id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 25000 }],
    } as unknown as BillDetail;

    const result = computeSessionAmountFromBill(bill);
    expect(result.expectedAmount).toBe(250000);
    expect(result.items).toEqual([{ name: 'Therapy', price: 250000 }]);
    expect(result.taxes).toEqual([{ name: 'VAT', amount: 25000 }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/payment-service.test.ts`
Expected: FAIL — `Cannot find module '@/services/payments/payment.service'`.

- [ ] **Step 3: Implement the money math functions**

Create `src/services/payments/payment.service.ts`:

```ts
import { calculateTax } from '@/services/billing/bill.service';
import type { BillDetail } from '@/services/billing/bill.service';
import { toNum } from '@/lib/kc-num';

export interface PaymentLineItem {
  name: string;
  price: number;
}

export interface PaymentTaxLine {
  name: string;
  amount: number;
}

export interface ComputedAmount {
  expectedAmount: number;
  items: PaymentLineItem[];
  taxes: PaymentTaxLine[];
}

/** Round to a whole rupiah — IDR has no fractional subunit in practice. */
function toRupiah(n: number): number {
  return Math.round(n);
}

/**
 * Public/guest booking amount. Only GLOBAL taxes (clinicId -1/null) apply —
 * app-table Clinic cuids have no bridge to the legacy wp_kc numeric clinic id
 * that clinic-scoped kcTax rows are keyed on, so clinic-specific taxes are out
 * of scope until that bridge exists.
 */
export async function computePublicAmount(service: { name: string; price: number | string }): Promise<ComputedAmount> {
  const price = toNum(service.price);
  const { total_tax, calculated_taxes } = await calculateTax({
    serviceItems: [{ serviceId: 0, service_name: service.name, price, quantity: 1 }],
  });
  const taxes: PaymentTaxLine[] = calculated_taxes.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return {
    expectedAmount: toRupiah(price + total_tax),
    items: [{ name: service.name, price: toRupiah(price) }],
    taxes,
  };
}

/** Staff/session amount — the bill's own totals (already tax-inclusive) drive the WC order. */
export function computeSessionAmountFromBill(bill: BillDetail): ComputedAmount {
  const items: PaymentLineItem[] = bill.serviceItems.map((i) => ({
    name: i.service_name || 'Service',
    price: toRupiah(i.price * i.quantity),
  }));
  const taxes: PaymentTaxLine[] = bill.taxItems.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return { expectedAmount: toRupiah(bill.total_amount), items, taxes };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/payment-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/payments/payment.service.ts tests/payments/payment-service.test.ts
git commit -m "feat(payments): money math for public + session payment amounts"
```

---

## Task 3: `payment.service.ts` — webhook signature verification

**Files:**
- Modify: `src/services/payments/payment.service.ts`
- Test: `tests/payments/payment-service.test.ts`

**Interfaces:**
- Produces: `verifyPaymentWebhookSignature(rawBody: string, signature: string | null): boolean`. Consumed later by the `sessions/payment-webhook` route (Task 10).

- [ ] **Step 1: Write the failing tests**

Append to `tests/payments/payment-service.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { verifyPaymentWebhookSignature } from '@/services/payments/payment.service';

describe('payment.service webhook signature', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV }; });
  afterEach(() => { process.env = OLD_ENV; });

  it('accepts a correctly-signed body', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    const body = '{"event":"payment.completed"}';
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex');
    expect(verifyPaymentWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    const sig = createHmac('sha256', 'test-secret').update('{"event":"payment.completed"}').digest('hex');
    expect(verifyPaymentWebhookSignature('{"event":"payment.failed"}', sig)).toBe(false);
  });

  it('rejects a missing signature', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    expect(verifyPaymentWebhookSignature('{}', null)).toBe(false);
  });

  it('rejects everything in production when no secret is configured', () => {
    process.env.PAYMENT_WEBHOOK_SECRET = '';
    process.env.NODE_ENV = 'production';
    expect(verifyPaymentWebhookSignature('{}', 'anything')).toBe(false);
  });
});
```

The `describe, it, expect, vi, beforeEach` import already exists from Task 2 — add `afterEach` to it (`import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`). Note Task 2's `beforeEach` already calls `vi.clearAllMocks()` — this new suite's own `beforeEach`/`afterEach` (for `process.env` save/restore) runs independently per `describe` block, so both coexist without conflict.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/payment-service.test.ts`
Expected: FAIL — `verifyPaymentWebhookSignature is not a function`.

- [ ] **Step 3: Implement**

Append to `src/services/payments/payment.service.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time HMAC-SHA256 verification for `sessions/payment-webhook`.
 * Deliberately a SEPARATE secret from WORDPRESS_WEBHOOK_SECRET/AUTH_SECRET —
 * see Global Constraints in the implementation plan.
 */
export function verifyPaymentWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false;
    return true; // dev-only fallback, mirrors src/lib/jobs/webhook-handler.ts
  }
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/payment-service.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/services/payments/payment.service.ts tests/payments/payment-service.test.ts
git commit -m "feat(payments): constant-time webhook signature verification"
```

---

## Task 4: `payment.service.ts` — order CRUD + guarded state machine

**Files:**
- Modify: `src/services/payments/payment.service.ts`
- Test: `tests/payments/payment-service.test.ts`

**Interfaces:**
- Consumes: `prisma.paymentOrder` (Task 1) from `@/lib/db`.
- Produces: `PaymentSource = 'public' | 'session'`, `PaymentStatus = 'pending'|'paid'|'failed'|'expired'|'cancelled'`, `createPaymentOrder`, `getPaymentOrderByAppointment`, `getPaymentOrderByBill`, `getPaymentOrderByWcOrderId`, `markPaid`, `markFailed`, `markExpired`, `AmountMismatchError`, `UnknownOrderError`. Tasks 7–11 (routes) depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/state-machine.test.ts` (mocks `@/lib/db` — this is a brand-new, isolated table with no legacy `wp_kc_*` FK entanglement, so unit-testing at the Prisma boundary is the lighter-weight and faster choice here, consistent with how `tests/public-booking/routes.integration.test.ts` mocks at the service boundary):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  paymentOrder: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
};
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  createPaymentOrder, getPaymentOrderByWcOrderId, markPaid, markFailed, markExpired,
  AmountMismatchError, UnknownOrderError,
} from '@/services/payments/payment.service';

beforeEach(() => vi.clearAllMocks());

describe('payment.service state machine', () => {
  it('createPaymentOrder writes a pending row', async () => {
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1', status: 'pending' });
    await createPaymentOrder({ source: 'public', appointmentId: 'appt_1', wcOrderId: 42, expectedAmount: 100000 });
    expect(db.paymentOrder.create).toHaveBeenCalledWith({
      data: {
        source: 'public', appointmentId: 'appt_1', billId: null, encounterId: null,
        wcOrderId: 42, expectedAmount: 100000, status: 'pending',
      },
    });
  });

  it('markPaid throws UnknownOrderError for an unrecognized wcOrderId', async () => {
    db.paymentOrder.findUnique.mockResolvedValue(null);
    await expect(markPaid({ wcOrderId: 999, amountPaid: 1000, transactionId: 'tx', webhookPayload: {} }))
      .rejects.toThrow(UnknownOrderError);
  });

  it('markPaid throws AmountMismatchError when paid amount != expectedAmount', async () => {
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, expectedAmount: 100000, status: 'pending' });
    await expect(markPaid({ wcOrderId: 42, amountPaid: 50000, transactionId: 'tx', webhookPayload: {} }))
      .rejects.toThrow(AmountMismatchError);
  });

  it('markPaid transitions pending -> paid exactly once (idempotent on replay)', async () => {
    db.paymentOrder.findUnique
      .mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'pending' })
      .mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'paid' });
    db.paymentOrder.updateMany.mockResolvedValueOnce({ count: 1 });
    const first = await markPaid({ wcOrderId: 42, amountPaid: 100000, transactionId: 'tx', webhookPayload: {} });
    expect(first?.status).toBe('paid');

    // Replay: row is no longer 'pending', so the guarded updateMany matches zero rows.
    db.paymentOrder.findUnique.mockResolvedValueOnce({ wcOrderId: 42, expectedAmount: 100000, status: 'paid' });
    db.paymentOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    const second = await markPaid({ wcOrderId: 42, amountPaid: 100000, transactionId: 'tx', webhookPayload: {} });
    expect(second).toBeNull();
  });

  it('markExpired never overrides an already-paid order', async () => {
    db.paymentOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await markExpired(42);
    expect(result).toBeNull();
    expect(db.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { wcOrderId: 42, status: 'pending' },
      data: { status: 'expired' },
    });
  });

  it('markFailed is a guarded one-way transition', async () => {
    db.paymentOrder.updateMany.mockResolvedValueOnce({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValueOnce({ wcOrderId: 42, status: 'failed' });
    const result = await markFailed(42, { reason: 'declined' });
    expect(result?.status).toBe('failed');
    expect(db.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { wcOrderId: 42, status: 'pending' },
      data: { status: 'failed', webhookPayload: { reason: 'declined' } },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/state-machine.test.ts`
Expected: FAIL — the imported functions don't exist yet.

- [ ] **Step 3: Implement**

Append to `src/services/payments/payment.service.ts`:

```ts
import { prisma } from '@/lib/db';
import type { PaymentOrder } from '@prisma/client';

export type PaymentSource = 'public' | 'session';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

export class AmountMismatchError extends Error {}
export class UnknownOrderError extends Error {}

export interface CreatePaymentOrderInput {
  source: PaymentSource;
  appointmentId?: string | null;
  billId?: string | null;
  encounterId?: string | null;
  wcOrderId: number;
  expectedAmount: number;
}

export async function createPaymentOrder(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
  return prisma.paymentOrder.create({
    data: {
      source: input.source,
      appointmentId: input.appointmentId ?? null,
      billId: input.billId ?? null,
      encounterId: input.encounterId ?? null,
      wcOrderId: input.wcOrderId,
      expectedAmount: input.expectedAmount,
      status: 'pending',
    },
  });
}

export async function getPaymentOrderByAppointment(appointmentId: string): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findFirst({ where: { appointmentId }, orderBy: { createdAt: 'desc' } });
}

export async function getPaymentOrderByBill(billId: string): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findFirst({ where: { billId }, orderBy: { createdAt: 'desc' } });
}

export async function getPaymentOrderByWcOrderId(wcOrderId: number): Promise<PaymentOrder | null> {
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

export interface MarkPaidInput {
  wcOrderId: number;
  amountPaid: number;
  transactionId: string;
  webhookPayload: unknown;
}

/** Guarded one-way transition pending -> paid. Returns null if already resolved (idempotent replay). */
export async function markPaid(input: MarkPaidInput): Promise<PaymentOrder | null> {
  const order = await prisma.paymentOrder.findUnique({ where: { wcOrderId: input.wcOrderId } });
  if (!order) throw new UnknownOrderError(`No payment order for wcOrderId ${input.wcOrderId}`);
  if (order.status === 'pending' && order.expectedAmount !== input.amountPaid) {
    throw new AmountMismatchError(`Expected ${order.expectedAmount}, got ${input.amountPaid}`);
  }

  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId: input.wcOrderId, status: 'pending' },
    data: {
      status: 'paid',
      transactionId: input.transactionId,
      paidAt: new Date(),
      webhookPayload: input.webhookPayload as any,
    },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId: input.wcOrderId } });
}

export async function markFailed(wcOrderId: number, webhookPayload: unknown): Promise<PaymentOrder | null> {
  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId, status: 'pending' },
    data: { status: 'failed', webhookPayload: webhookPayload as any },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

export async function markExpired(wcOrderId: number): Promise<PaymentOrder | null> {
  const result = await prisma.paymentOrder.updateMany({
    where: { wcOrderId, status: 'pending' },
    data: { status: 'expired' },
  });
  if (result.count === 0) return null;
  return prisma.paymentOrder.findUnique({ where: { wcOrderId } });
}

// Note: the `status` column also allows 'cancelled' (see Task 1's data model),
// reserved for a future out-of-band cancellation path (e.g. a guest cancelling
// their own PENDING appointment before paying). No route in this plan drives
// that transition yet, so no markCancelled() is defined until one does —
// avoids dead exported code (YAGNI).
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/state-machine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/payments/payment.service.ts tests/payments/state-machine.test.ts
git commit -m "feat(payments): guarded one-way payment-order state machine"
```

---

## Task 5: `src/lib/wp-endpoint.ts` — WP plugin payments client

**Files:**
- Create: `src/lib/wp-endpoint.ts`
- Test: `tests/payments/wp-endpoint.test.ts`

**Interfaces:**
- Produces: `createWcOrder(input: CreateWcOrderInput): Promise<CreateWcOrderResult>`, `getWcOrderStatus(orderId: number): Promise<WcOrderStatus>`, `WpEndpointError`. Consumed by `payment.service.ts` in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/wp-endpoint.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('wp-endpoint payments client', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('createWcOrder posts to /payments/order with the service token header', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const result = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 100000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
    });
    expect(result).toEqual({ orderId: 7, checkoutUrl: 'https://wp.test/checkout/7' });
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('http://wp.test/wp-json/praktiqu/v1/payments/order');
    expect(opts.headers['X-PraktiQU-Service-Token']).toBe('tok');
  });

  it('createWcOrder throws WpEndpointError on a non-ok response', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'down' });
    const { createWcOrder, WpEndpointError } = await import('@/lib/wp-endpoint');
    await expect(createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    })).rejects.toThrow(WpEndpointError);
  });

  it('getWcOrderStatus GETs /payments/order/{id}', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 7, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 }),
    });
    const { getWcOrderStatus } = await import('@/lib/wp-endpoint');
    const result = await getWcOrderStatus(7);
    expect(result).toEqual({ orderId: 7, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 });
    expect((fetch as any).mock.calls[0][0]).toBe('http://wp.test/wp-json/praktiqu/v1/payments/order/7');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/wp-endpoint.test.ts`
Expected: FAIL — `Cannot find module '@/lib/wp-endpoint'`.

- [ ] **Step 3: Implement**

Create `src/lib/wp-endpoint.ts`:

```ts
/**
 * WordPress praktiqu-endpoint plugin client — payments bridge.
 *
 * Mirrors the fetch-with-service-token pattern in `src/lib/jobs/client.ts`.
 */

export interface PaymentOrderItem {
  name: string;
  price: number;
}

export interface PaymentOrderTax {
  name: string;
  amount: number;
}

export interface CreateWcOrderInput {
  source: 'public' | 'session';
  appointmentId?: string;
  billId?: string;
  encounterId?: string;
  customerName: string;
  customerEmail: string;
  items: PaymentOrderItem[];
  taxes: PaymentOrderTax[];
  returnUrl: string;
  cancelUrl: string;
}

export interface CreateWcOrderResult {
  orderId: number;
  checkoutUrl: string;
}

export interface WcOrderStatus {
  orderId: number;
  status: string;
  isPaid: boolean;
  transactionId: string | null;
  amount: number;
}

const WP_ENDPOINT = process.env.WORDPRESS_URL ?? 'http://localhost:9001';
const WP_PAYMENTS_BASE = `${WP_ENDPOINT}/wp-json/praktiqu/v1/payments`;

export class WpEndpointError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'WpEndpointError';
  }
}

function serviceToken(): string {
  const token = process.env.WORDPRESS_SERVICE_TOKEN ?? '';
  if (!token) throw new WpEndpointError('WORDPRESS_SERVICE_TOKEN not set', 500);
  return token;
}

export async function createWcOrder(input: CreateWcOrderInput): Promise<CreateWcOrderResult> {
  const res = await fetch(`${WP_PAYMENTS_BASE}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PraktiQU-Service-Token': serviceToken() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order create failed ${res.status}: ${text}`, res.status);
  }
  const data = await res.json();
  return { orderId: data.orderId, checkoutUrl: data.checkoutUrl };
}

export async function getWcOrderStatus(orderId: number): Promise<WcOrderStatus> {
  const res = await fetch(`${WP_PAYMENTS_BASE}/order/${orderId}`, {
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order status fetch failed ${res.status}: ${text}`, res.status);
  }
  const data = await res.json();
  return {
    orderId: data.orderId,
    status: data.status,
    isPaid: data.isPaid,
    transactionId: data.transactionId ?? null,
    amount: data.amount,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/wp-endpoint.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wp-endpoint.ts tests/payments/wp-endpoint.test.ts
git commit -m "feat(payments): WP endpoint payments client (create + get order status)"
```

---

## Task 6: Extend the jobs client with `praktiqu_payment_auto_cancel`

**Files:**
- Modify: `src/lib/jobs/client.ts`
- Test: `tests/payments/jobs-client.test.ts`

**Interfaces:**
- Produces: `JobHook` now includes `'praktiqu_payment_auto_cancel'`. Consumed by `payment.service.ts` (Task 7) to enqueue/cancel the auto-cancel job.

- [ ] **Step 1: Write the failing test**

Create `tests/payments/jobs-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('jobs client — praktiqu_payment_auto_cancel', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  it('enqueue accepts the payment auto-cancel hook with matching args for later cancel()', async () => {
    const { jobs } = await import('@/lib/jobs/client');
    await jobs.enqueue({ hook: 'praktiqu_payment_auto_cancel', runAt: new Date('2026-07-14T13:00:00Z'), args: { wcOrderId: 42 } });
    await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: 42 } });

    const [enqueueCall, cancelCall] = (fetch as any).mock.calls;
    expect(JSON.parse(enqueueCall[1].body).args).toEqual({ wcOrderId: 42 });
    expect(JSON.parse(cancelCall[1].body).args).toEqual({ wcOrderId: 42 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/jobs-client.test.ts`
Expected: FAIL — TypeScript rejects `'praktiqu_payment_auto_cancel'` as not assignable to `JobHook`.

- [ ] **Step 3: Implement**

In `src/lib/jobs/client.ts`, change:

```ts
export type JobHook =
  | 'praktiqu_session_auto_complete'
  | 'praktiqu_session_send_reminder'
  | 'praktiqu_log_purge';
```

to:

```ts
export type JobHook =
  | 'praktiqu_session_auto_complete'
  | 'praktiqu_session_send_reminder'
  | 'praktiqu_log_purge'
  | 'praktiqu_payment_auto_cancel';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/jobs-client.test.ts`
Expected: PASS (1 test). Note: enqueue's `args: { ...options.args, webhookToken: options.webhookToken }` merge means `webhookToken: undefined` is dropped by `JSON.stringify`, so `args` stays `{ wcOrderId: 42 }` in both calls — this is what makes WP's `as_unschedule_all_actions($hook, $argsMatcher, group)` exact-match cancellation work later (Task 15).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/client.ts tests/payments/jobs-client.test.ts
git commit -m "feat(payments): add praktiqu_payment_auto_cancel job hook"
```

---

## Task 7: `payment.service.ts` — orchestration (initiate, reconcile, side effects)

**Files:**
- Modify: `src/services/payments/payment.service.ts`
- Test: `tests/payments/orchestration.test.ts`

**Interfaces:**
- Consumes: `createWcOrder`, `getWcOrderStatus` from `@/lib/wp-endpoint` (Task 5); `jobs` from `@/lib/jobs/client` (Task 6); `signAppointmentToken` from `@/lib/public/appointment-token`; `getBill` from `@/services/billing/bill.service`; `prisma` (`@/lib/db`), `AppointmentStatus` (`@prisma/client`).
- Produces: `initiatePublicPayment(appointmentId): Promise<{ checkoutUrl: string }>`, `ensureSessionPayment(billId): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number }>`, `checkPublicPaymentStatus(appointmentId): Promise<PaymentStatusView>`, `checkSessionPaymentStatus(billId): Promise<PaymentStatusView>`, `applyPaidSideEffectsPublic(order)`, `applyPaidSideEffectsSession(order)`, `cancelIfStillPending(order)`, error classes `AppointmentNotFoundError`, `AppointmentNotPendingError`, `PaymentAlreadyInitiatedError`. Routes in Tasks 8–11 call these directly by name.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/orchestration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  paymentOrder: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  appointment: { findUnique: vi.fn(), updateMany: vi.fn() },
  kcBill: { update: vi.fn() },
  kcPatientEncounter: { update: vi.fn() },
  kcAppointment: { updateMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(db)),
};
vi.mock('@/lib/db', () => ({ prisma: db }));

const wpEndpoint = { createWcOrder: vi.fn(), getWcOrderStatus: vi.fn() };
vi.mock('@/lib/wp-endpoint', () => wpEndpoint);

const jobsClient = { jobs: { enqueue: vi.fn(), cancel: vi.fn() } };
vi.mock('@/lib/jobs/client', () => jobsClient);

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn().mockResolvedValue({ total_tax: 0, calculated_taxes: [] }),
  getBill: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

import {
  initiatePublicPayment, checkPublicPaymentStatus,
  AppointmentNotFoundError, AppointmentNotPendingError, PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { getBill } from '@/services/billing/bill.service';

describe('initiatePublicPayment', () => {
  it('throws AppointmentNotFoundError when the appointment does not exist', async () => {
    db.appointment.findUnique.mockResolvedValue(null);
    await expect(initiatePublicPayment('appt_missing')).rejects.toThrow(AppointmentNotFoundError);
  });

  it('throws AppointmentNotPendingError when the appointment is already BOOKED', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'BOOKED',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    await expect(initiatePublicPayment('appt_1')).rejects.toThrow(AppointmentNotPendingError);
  });

  it('throws PaymentAlreadyInitiatedError when a pending order already exists', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'PENDING',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    db.paymentOrder.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(initiatePublicPayment('appt_1')).rejects.toThrow(PaymentAlreadyInitiatedError);
  });

  it('creates a WC order + payment_orders row + auto-cancel job on success', async () => {
    db.appointment.findUnique.mockResolvedValue({
      id: 'appt_1', status: 'PENDING',
      patient: { user: { displayName: 'Jane', email: 'jane@x.com' } },
      services: [{ price: 100000, service: { name: 'Consult' } }],
    });
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 42, checkoutUrl: 'https://wp/checkout/42' });
    db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

    const result = await initiatePublicPayment('appt_1');
    expect(result).toEqual({ checkoutUrl: 'https://wp/checkout/42' });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ wcOrderId: 42, expectedAmount: 100000, source: 'public' }),
    }));
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'praktiqu_payment_auto_cancel',
      args: { wcOrderId: 42 },
    }));
  });
});

describe('checkPublicPaymentStatus — verify fallback', () => {
  it('reconciles a stale pending order that WC shows as paid', async () => {
    const staleCreatedAt = new Date(Date.now() - 3 * 60_000); // 3 minutes old
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, createdAt: staleCreatedAt,
      source: 'public', appointmentId: 'appt_1', billId: null,
    });
    wpEndpoint.getWcOrderStatus.mockResolvedValue({ orderId: 42, status: 'processing', isPaid: true, transactionId: 'tx-1', amount: 100000 });
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue({ wcOrderId: 42, status: 'paid', expectedAmount: 100000, source: 'public', appointmentId: 'appt_1' });

    const result = await checkPublicPaymentStatus('appt_1');
    expect(result.status).toBe('paid');
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt_1', status: 'PENDING' },
      data: { status: 'BOOKED' },
    });
  });

  it('does not reconcile a pending order younger than 2 minutes', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 42, status: 'pending', expectedAmount: 100000, createdAt: new Date(), source: 'public', appointmentId: 'appt_1',
    });
    const result = await checkPublicPaymentStatus('appt_1');
    expect(result.status).toBe('pending');
    expect(wpEndpoint.getWcOrderStatus).not.toHaveBeenCalled();
  });
});

describe('cancelIfStillPending — auto-cancel guard', () => {
  it('cancels a public appointment that is still PENDING', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');
    await cancelIfStillPending({ source: 'public', appointmentId: 'appt_1', wcOrderId: 42 } as any);
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: 'appt_1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });

  it('is a no-op for a session/staff order (no appointment slot to release)', async () => {
    const { cancelIfStillPending } = await import('@/services/payments/payment.service');
    await cancelIfStillPending({ source: 'session', appointmentId: null, wcOrderId: 42 } as any);
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});
```

Note: `cancelIfStillPending` never touches the appointment row directly with an unconditional update — it always guards with `status: 'PENDING'` in the `WHERE` clause (Task 7, Step 3 implementation below), so a real database will silently no-op for an appointment already `BOOKED`/`CHECK_IN`/`CANCELLED`. That guarantee lives in the guarded `updateMany` call itself, not in application-level branching — Prisma's `updateMany` only affects rows matching the full `where`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/orchestration.test.ts`
Expected: FAIL — the orchestration functions don't exist yet.

- [ ] **Step 3: Implement**

Append to `src/services/payments/payment.service.ts`:

```ts
import { AppointmentStatus } from '@prisma/client';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import { createWcOrder, getWcOrderStatus } from '@/lib/wp-endpoint';
import { jobs } from '@/lib/jobs/client';
import { getBill } from '@/services/billing/bill.service';

export class AppointmentNotFoundError extends Error {}
export class AppointmentNotPendingError extends Error {}
export class PaymentAlreadyInitiatedError extends Error {}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const AUTO_CANCEL_MS = 60 * 60 * 1000; // 1 hour — see Global Constraints
const VERIFY_FALLBACK_MS = 2 * 60 * 1000; // 2 minutes — see Global Constraints

export interface PaymentStatusView {
  status: PaymentStatus;
  expectedAmount: number;
}

export async function initiatePublicPayment(appointmentId: string): Promise<{ checkoutUrl: string }> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      patient: { select: { user: { select: { displayName: true, email: true } } } },
      services: { take: 1, select: { price: true, service: { select: { name: true } } } },
    },
  });
  if (!appt) throw new AppointmentNotFoundError();
  if (appt.status !== AppointmentStatus.PENDING) throw new AppointmentNotPendingError();

  const existing = await getPaymentOrderByAppointment(appointmentId);
  if (existing && existing.status === 'pending') throw new PaymentAlreadyInitiatedError();

  const svc = appt.services[0];
  const serviceName = svc?.service.name ?? 'Service';
  const servicePrice = svc ? Number(svc.price) : 0;
  const { expectedAmount, items, taxes } = await computePublicAmount({ name: serviceName, price: servicePrice });

  const token = signAppointmentToken(appointmentId);
  const wcOrder = await createWcOrder({
    source: 'public',
    appointmentId,
    customerName: appt.patient?.user.displayName ?? 'Guest',
    customerEmail: appt.patient?.user.email ?? '',
    items,
    taxes,
    returnUrl: `${APP_URL}/book/payment/success?appt=${token}`,
    cancelUrl: `${APP_URL}/book/payment/cancel?appt=${token}`,
  });

  await createPaymentOrder({ source: 'public', appointmentId, wcOrderId: wcOrder.orderId, expectedAmount });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return { checkoutUrl: wcOrder.checkoutUrl };
}

export async function applyPaidSideEffectsPublic(order: PaymentOrder): Promise<void> {
  // Guard-DB-write-first: the network call (jobs.cancel) only fires the
  // first time this actually changes something, so a later self-heal
  // re-application (see ensurePaidSideEffectsApplied) is a cheap no-op
  // instead of a redundant WP round-trip. A stale WP-side auto-cancel job
  // firing after this point is harmless — the WP job handler independently
  // checks the real WooCommerce order's own is_paid() before cancelling
  // anything (Task 16).
  if (!order.appointmentId) return;
  const result = await prisma.appointment.updateMany({
    where: { id: order.appointmentId, status: AppointmentStatus.PENDING },
    data: { status: AppointmentStatus.BOOKED },
  });
  if (result.count === 0) return; // already applied — nothing left to do
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
}

/** Returns whether the bill was actually transitioned (false = already paid, a no-op). */
async function markBillPaid(billId: string, encounterId: string | null): Promise<boolean> {
  return prisma.$transaction(async (tx: typeof prisma) => {
    const bill = await tx.kcBill.findUnique({ where: { id: BigInt(billId) } });
    if (!bill || bill.paymentStatus === 'paid') return false;
    await tx.kcBill.update({ where: { id: BigInt(billId) }, data: { paymentStatus: 'paid' } });
    const encId = encounterId ? BigInt(encounterId) : bill.encounterId;
    await tx.kcPatientEncounter.update({ where: { id: encId }, data: { status: 0 } });
    if (bill.appointmentId) {
      await tx.kcAppointment.updateMany({ where: { id: bill.appointmentId }, data: { status: 3 } as any });
    }
    return true;
  });
}

export async function applyPaidSideEffectsSession(order: PaymentOrder): Promise<void> {
  if (!order.billId) return;
  const applied = await markBillPaid(order.billId, order.encounterId);
  if (!applied) return; // already applied — nothing left to do
  await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
}

/**
 * Idempotently (re-)apply paid side effects for an order already marked
 * 'paid'. Closes a crash-window gap: if the process died between markPaid's
 * guarded write and the side-effect call, a later read of this order would
 * otherwise never retry the (now cheap, guard-first) side effect.
 */
async function ensurePaidSideEffectsApplied(order: PaymentOrder): Promise<void> {
  if (order.status !== 'paid') return;
  if (order.source === 'public') await applyPaidSideEffectsPublic(order);
  else await applyPaidSideEffectsSession(order);
}

export async function cancelIfStillPending(order: PaymentOrder): Promise<void> {
  if (order.source === 'public' && order.appointmentId) {
    await prisma.appointment.updateMany({
      where: { id: order.appointmentId, status: AppointmentStatus.PENDING },
      data: { status: AppointmentStatus.CANCELLED },
    });
  }
  // Session/staff flow: an expired unpaid bill simply stays unpaid — staff
  // bookings don't hold a slot the way public PENDING appointments do.
}

async function reconcileIfStale(order: PaymentOrder): Promise<PaymentOrder> {
  if (order.status === 'paid') {
    // Self-heal: a prior crash between markPaid's write and its side effect
    // would otherwise leave this order paid forever with no retry path.
    await ensurePaidSideEffectsApplied(order);
    return order;
  }
  if (order.status !== 'pending') return order;
  if (Date.now() - order.createdAt.getTime() < VERIFY_FALLBACK_MS) return order;

  const wcStatus = await getWcOrderStatus(order.wcOrderId);
  if (wcStatus.isPaid) {
    const updated = await markPaid({
      wcOrderId: order.wcOrderId,
      amountPaid: wcStatus.amount,
      transactionId: wcStatus.transactionId ?? '',
      webhookPayload: { source: 'verify-fallback', wcStatus },
    });
    if (!updated) return order;
    if (updated.source === 'public') await applyPaidSideEffectsPublic(updated);
    else await applyPaidSideEffectsSession(updated);
    return updated;
  }
  if (wcStatus.status === 'cancelled' || wcStatus.status === 'failed') {
    const updated = await markFailed(order.wcOrderId, { source: 'verify-fallback', wcStatus });
    return updated ?? order;
  }
  return order;
}

export async function checkPublicPaymentStatus(appointmentId: string): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByAppointment(appointmentId);
  if (!order) throw new UnknownOrderError('No payment found for this appointment');
  const reconciled = await reconcileIfStale(order);
  return { status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
}

export async function checkSessionPaymentStatus(billId: string): Promise<PaymentStatusView> {
  const order = await getPaymentOrderByBill(billId);
  if (!order) throw new UnknownOrderError('No payment found for this bill');
  const reconciled = await reconcileIfStale(order);
  return { status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
}

export async function ensureSessionPayment(
  billId: string,
): Promise<{ checkoutUrl: string | null; status: PaymentStatus; expectedAmount: number }> {
  const existing = await getPaymentOrderByBill(billId);
  if (existing) {
    const reconciled = await reconcileIfStale(existing);
    if (reconciled.status !== 'failed' && reconciled.status !== 'expired' && reconciled.status !== 'cancelled') {
      return { checkoutUrl: null, status: reconciled.status as PaymentStatus, expectedAmount: reconciled.expectedAmount };
    }
    // failed/expired/cancelled — fall through and create a fresh order.
  }

  const bill = await getBill(Number(billId));
  const { expectedAmount, items, taxes } = computeSessionAmountFromBill(bill);
  const patientUser = await prisma.kcUser.findUnique({
    where: { id: BigInt(bill.patient.id) },
    select: { displayName: true, userEmail: true },
  });

  const wcOrder = await createWcOrder({
    source: 'session',
    billId,
    encounterId: String(bill.patientEncounter.id),
    customerName: patientUser?.displayName ?? 'Patient',
    customerEmail: patientUser?.userEmail ?? '',
    items,
    taxes,
    returnUrl: `${APP_URL}/staff/bills/${billId}/payment-success`,
    cancelUrl: `${APP_URL}/staff/bills/${billId}/payment-cancel`,
  });

  await createPaymentOrder({
    source: 'session',
    billId,
    encounterId: String(bill.patientEncounter.id),
    wcOrderId: wcOrder.orderId,
    expectedAmount,
  });
  await jobs.enqueue({
    hook: 'praktiqu_payment_auto_cancel',
    runAt: new Date(Date.now() + AUTO_CANCEL_MS),
    args: { wcOrderId: wcOrder.orderId },
  });

  return { checkoutUrl: wcOrder.checkoutUrl, status: 'pending', expectedAmount };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/orchestration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full payments suite together**

Run: `npx vitest run tests/payments/`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add src/services/payments/payment.service.ts tests/payments/orchestration.test.ts
git commit -m "feat(payments): initiate/reconcile/side-effect orchestration"
```

---

## Task 8: `POST /api/v1/public/payments` (guest initiate)

**Files:**
- Create: `src/app/api/v1/public/payments/route.ts`
- Test: `tests/payments/public-routes.test.ts`

**Interfaces:**
- Consumes: `initiatePublicPayment`, `AppointmentNotFoundError`, `AppointmentNotPendingError`, `PaymentAlreadyInitiatedError` from `@/services/payments/payment.service` (Task 7); `verifyAppointmentToken` from `@/lib/public/appointment-token`.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/public-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/payments/payment.service', () => ({
  initiatePublicPayment: vi.fn(),
  checkPublicPaymentStatus: vi.fn(),
  AppointmentNotFoundError: class AppointmentNotFoundError extends Error {},
  AppointmentNotPendingError: class AppointmentNotPendingError extends Error {},
  PaymentAlreadyInitiatedError: class PaymentAlreadyInitiatedError extends Error {},
  UnknownOrderError: class UnknownOrderError extends Error {},
}));
vi.mock('@/lib/public/appointment-token', () => ({
  verifyAppointmentToken: vi.fn((t: string) => (t === 'bad' ? null : 'appt_1')),
}));

import { POST as initiate } from '@/app/api/v1/public/payments/route';
import * as svc from '@/services/payments/payment.service';

function req(body: unknown) {
  return new NextRequest('http://x/api/v1/public/payments', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /public/payments', () => {
  it('400 on invalid token', async () => {
    const res = await initiate(req({ token: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('201 with checkoutUrl on success', async () => {
    (svc.initiatePublicPayment as any).mockResolvedValue({ checkoutUrl: 'https://wp/checkout/1' });
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.checkoutUrl).toBe('https://wp/checkout/1');
  });

  it('409 when the appointment is not pending', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new (svc as any).AppointmentNotPendingError());
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(409);
  });

  it('404 when the appointment does not exist', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new (svc as any).AppointmentNotFoundError());
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/public-routes.test.ts`
Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Implement**

Create `src/app/api/v1/public/payments/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import {
  initiatePublicPayment,
  AppointmentNotFoundError,
  AppointmentNotPendingError,
  PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { badRequest, notFound, conflict } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'token is required');
    return NextResponse.json(p, { status: p.status });
  }

  const appointmentId = verifyAppointmentToken(parsed.data.token);
  if (!appointmentId) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await initiatePublicPayment(appointmentId);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) {
      const p = notFound('appointment_not_found', 'Appointment not found');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof AppointmentNotPendingError) {
      const p = conflict('appointment_not_pending', 'Appointment is not awaiting payment');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof PaymentAlreadyInitiatedError) {
      const p = conflict('payment_already_initiated', 'Payment already initiated — check status instead');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[public/payments] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/public-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/public/payments/route.ts tests/payments/public-routes.test.ts
git commit -m "feat(payments): POST /api/v1/public/payments — guest payment initiation"
```

---

## Task 9: `POST /api/v1/public/payment-verify` (guest verify-fallback) — replace 501 stub

**Files:**
- Modify: `src/app/api/v1/public/payment-verify/route.ts`
- Modify: `tests/public-booking/routes.integration.test.ts` (remove the now-stale stub expectation)
- Modify: `tests/payments/public-routes.test.ts` (add real-behavior tests)

**Interfaces:**
- Consumes: `checkPublicPaymentStatus`, `UnknownOrderError` from `@/services/payments/payment.service` (Task 7).

- [ ] **Step 1: Remove the stale stub test**

In `tests/public-booking/routes.integration.test.ts`, delete the `describe('payment-verify stub', ...)` block (lines 68–74) and its `import { POST as paymentVerify } from '@/app/api/v1/public/payment-verify/route';` (line 27) — the route no longer returns 501, so this expectation is obsolete. Payment-verify tests now live in `tests/payments/public-routes.test.ts`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/payments/public-routes.test.ts` (extend the existing mocks — add `checkPublicPaymentStatus` scenarios; the mock module already declares it and `UnknownOrderError` from Task 8's setup):

```ts
import { POST as verify } from '@/app/api/v1/public/payment-verify/route';

describe('POST /public/payment-verify', () => {
  it('400 on invalid token', async () => {
    const res = await verify(req({ token: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('200 with current status', async () => {
    (svc.checkPublicPaymentStatus as any).mockResolvedValue({ status: 'paid', expectedAmount: 100000 });
    const res = await verify(req({ token: 'good' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'paid', expectedAmount: 100000 });
  });

  it('404 when no payment exists for the appointment', async () => {
    (svc.checkPublicPaymentStatus as any).mockRejectedValue(new (svc as any).UnknownOrderError());
    const res = await verify(req({ token: 'good' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/payments/public-routes.test.ts`
Expected: FAIL — the route still returns the 501 stub body.

- [ ] **Step 4: Implement**

Replace the full contents of `src/app/api/v1/public/payment-verify/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import { checkPublicPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'token is required');
    return NextResponse.json(p, { status: p.status });
  }

  const appointmentId = verifyAppointmentToken(parsed.data.token);
  if (!appointmentId) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await checkPublicPaymentStatus(appointmentId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this appointment');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[public/payment-verify] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/payments/public-routes.test.ts tests/public-booking/routes.integration.test.ts`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/public/payment-verify/route.ts tests/payments/public-routes.test.ts tests/public-booking/routes.integration.test.ts
git commit -m "feat(payments): implement public/payment-verify (guest verify-fallback)"
```

---

## Task 10: `POST /api/v1/sessions/payment-verify` (staff initiate/check) — replace 501 stub

**Files:**
- Modify: `src/app/api/v1/sessions/payment-verify/route.ts`
- Create: `tests/payments/session-routes.test.ts`

**Interfaces:**
- Consumes: `ensureSessionPayment` from `@/services/payments/payment.service` (Task 7); `requireRoles` from `@/lib/auth/route-guards`.

- [ ] **Step 1: Write the failing tests**

Create `tests/payments/session-routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/payments/payment.service', () => ({
  ensureSessionPayment: vi.fn(),
  checkSessionPaymentStatus: vi.fn(),
  verifyPaymentWebhookSignature: vi.fn(),
  getPaymentOrderByWcOrderId: vi.fn(),
  markPaid: vi.fn(),
  markFailed: vi.fn(),
  markExpired: vi.fn(),
  applyPaidSideEffectsPublic: vi.fn(),
  applyPaidSideEffectsSession: vi.fn(),
  cancelIfStillPending: vi.fn(),
  AmountMismatchError: class AmountMismatchError extends Error {},
  UnknownOrderError: class UnknownOrderError extends Error {},
}));
vi.mock('@/lib/auth/route-guards', () => ({
  requireRoles: vi.fn(async () => ({ actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } })),
}));
vi.mock('@/lib/kc-response', () => ({
  KcError: class KcError extends Error { constructor(message: string, public httpStatus = 400) { super(message); } },
}));

import { POST as paymentVerify } from '@/app/api/v1/sessions/payment-verify/route';
import * as svc from '@/services/payments/payment.service';
import { requireRoles } from '@/lib/auth/route-guards';

function req(body: unknown) {
  return new NextRequest('http://x/api/v1/sessions/payment-verify', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /sessions/payment-verify', () => {
  it('401 when unauthenticated', async () => {
    (requireRoles as any).mockResolvedValue({ response: new Response(null, { status: 401 }) });
    const res: any = await paymentVerify(req({ billId: '1' }));
    expect(res.status).toBe(401);
  });

  it('400 on missing billId', async () => {
    const res = await paymentVerify(req({}));
    expect(res.status).toBe(400);
  });

  it('200 with a checkout link on success', async () => {
    (svc.ensureSessionPayment as any).mockResolvedValue({ checkoutUrl: 'https://wp/checkout/9', status: 'pending', expectedAmount: 50000 });
    const res = await paymentVerify(req({ billId: '9' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.checkoutUrl).toBe('https://wp/checkout/9');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: FAIL — the route still returns the 501 stub body.

- [ ] **Step 3: Implement**

Replace the full contents of `src/app/api/v1/sessions/payment-verify/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { ensureSessionPayment } from '@/services/payments/payment.service';
import { badRequest } from '@/lib/problem-details';
import { KcError } from '@/lib/kc-response';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;
const bodySchema = z.object({ billId: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, STAFF_ROLES);
  if ('response' in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'billId is required');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await ensureSessionPayment(parsed.data.billId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof KcError) {
      return NextResponse.json({ type: 'about:blank', title: err.message, status: err.httpStatus }, { status: err.httpStatus });
    }
    console.error('[sessions/payment-verify] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/sessions/payment-verify/route.ts tests/payments/session-routes.test.ts
git commit -m "feat(payments): implement sessions/payment-verify (staff initiate/check)"
```

---

## Task 11: `POST /api/v1/sessions/payment-webhook` (receiver) — replace 501 stub

**Files:**
- Modify: `src/app/api/v1/sessions/payment-webhook/route.ts`
- Modify: `tests/payments/session-routes.test.ts`

**Interfaces:**
- Consumes: `verifyPaymentWebhookSignature`, `getPaymentOrderByWcOrderId`, `markPaid`, `markFailed`, `markExpired`, `applyPaidSideEffectsPublic`, `applyPaidSideEffectsSession`, `cancelIfStillPending`, `AmountMismatchError` from `@/services/payments/payment.service` (Tasks 3, 4, 7).

- [ ] **Step 1: Write the failing tests**

Append to `tests/payments/session-routes.test.ts`:

```ts
import { POST as webhook } from '@/app/api/v1/sessions/payment-webhook/route';

function webhookReq(rawBody: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature) headers['x-praktiqu-webhook-signature'] = signature;
  return new NextRequest('http://x/api/v1/sessions/payment-webhook', { method: 'POST', body: rawBody, headers });
}

describe('POST /sessions/payment-webhook', () => {
  it('401 on invalid signature', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(false);
    const res = await webhook(webhookReq('{}', 'bad-sig'));
    expect(res.status).toBe(401);
  });

  it('404 for an unknown wcOrderId', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue(null);
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 999 }), 'ok'));
    expect(res.status).toBe(404);
  });

  it('200 + applies public side effects on payment.completed', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    // Returned from BOTH the pre-switch lookup and the post-markPaid
    // re-fetch (mockResolvedValue, not Once) — status: 'paid' reflects the
    // state after markPaid's guarded write, which the route re-reads rather
    // than trusting markPaid's own return value (see the route's crash-window
    // self-heal comment: markPaid returns null both on a lost race AND on a
    // prior-crash replay, so re-reading current state is the only way to
    // apply side effects in the replay case too).
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public', status: 'paid' });
    (svc.markPaid as any).mockResolvedValue({ wcOrderId: 42, source: 'public', status: 'paid' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 100000, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.applyPaidSideEffectsPublic).toHaveBeenCalled();
  });

  it('200 + still applies side effects when markPaid returns null (replay of an already-paid order)', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'session', status: 'paid' });
    (svc.markPaid as any).mockResolvedValue(null); // e.g. a prior crash already flipped this row to 'paid'
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 100000, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.applyPaidSideEffectsSession).toHaveBeenCalled();
  });

  it('409 on amount mismatch', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markPaid as any).mockRejectedValue(new (svc as any).AmountMismatchError());
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.completed', wcOrderId: 42, amountPaid: 1, transactionId: 'tx' }), 'ok'));
    expect(res.status).toBe(409);
  });

  it('200 + cancels appointment on payment.expired', async () => {
    (svc.verifyPaymentWebhookSignature as any).mockReturnValue(true);
    (svc.getPaymentOrderByWcOrderId as any).mockResolvedValue({ wcOrderId: 42, source: 'public' });
    (svc.markExpired as any).mockResolvedValue({ wcOrderId: 42, source: 'public', appointmentId: 'appt_1' });
    const res = await webhook(webhookReq(JSON.stringify({ event: 'payment.expired', wcOrderId: 42 }), 'ok'));
    expect(res.status).toBe(200);
    expect(svc.cancelIfStillPending).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: FAIL — the route still returns the 501 stub body.

- [ ] **Step 3: Implement**

Replace the full contents of `src/app/api/v1/sessions/payment-webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logging } from '@/lib/logging';
import {
  verifyPaymentWebhookSignature,
  getPaymentOrderByWcOrderId,
  markPaid,
  markFailed,
  markExpired,
  applyPaidSideEffectsPublic,
  applyPaidSideEffectsSession,
  cancelIfStillPending,
  AmountMismatchError,
} from '@/services/payments/payment.service';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  event: z.enum(['payment.completed', 'payment.failed', 'payment.expired']),
  wcOrderId: z.number(),
  amountPaid: z.number().optional(),
  transactionId: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-praktiqu-webhook-signature');

  if (!verifyPaymentWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ status: false, message: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: false, message: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ status: false, message: 'Invalid payload' }, { status: 400 });
  }
  const { event, wcOrderId, amountPaid, transactionId } = parsed.data;

  const order = await getPaymentOrderByWcOrderId(wcOrderId);
  if (!order) {
    await logging.warn('Payment webhook for unknown wcOrderId', { metadata: { wcOrderId, event } });
    return NextResponse.json({ status: false, message: 'Unknown order' }, { status: 404 });
  }

  try {
    if (event === 'payment.completed') {
      await markPaid({
        wcOrderId,
        amountPaid: amountPaid ?? 0,
        transactionId: transactionId ?? '',
        webhookPayload: parsed.data,
      });
      // Re-fetch current state rather than branching on markPaid's return
      // value: markPaid returns null both when this webhook lost a race to
      // an earlier delivery AND when a prior process crash left the row
      // 'paid' with its side effect never applied. Re-checking and applying
      // (idempotently — see payment.service.ts's guard-first side-effect
      // functions) is the only way to self-heal the second case.
      const current = await getPaymentOrderByWcOrderId(wcOrderId);
      if (current?.status === 'paid') {
        if (current.source === 'public') await applyPaidSideEffectsPublic(current);
        else await applyPaidSideEffectsSession(current);
      }
    } else if (event === 'payment.failed') {
      await markFailed(wcOrderId, parsed.data);
    } else if (event === 'payment.expired') {
      const updated = await markExpired(wcOrderId);
      if (updated) await cancelIfStillPending(updated);
    }
  } catch (err) {
    if (err instanceof AmountMismatchError) {
      await logging.error('Payment webhook amount mismatch', err, { metadata: { wcOrderId, event } });
      return NextResponse.json({ status: false, message: 'Amount mismatch' }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ status: true, message: 'ok' }, { status: 200 });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/sessions/payment-webhook/route.ts tests/payments/session-routes.test.ts
git commit -m "feat(payments): implement sessions/payment-webhook receiver"
```

---

## Task 12: `payment-success` + `payment-cancel` (thin recorders) — replace 501 stubs

**Files:**
- Modify: `src/app/api/v1/sessions/payment-success/route.ts`
- Modify: `src/app/api/v1/sessions/payment-cancel/route.ts`
- Modify: `tests/payments/session-routes.test.ts`

**Interfaces:**
- Consumes: `checkSessionPaymentStatus`, `UnknownOrderError` from `@/services/payments/payment.service` (Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `tests/payments/session-routes.test.ts`:

```ts
import { POST as success } from '@/app/api/v1/sessions/payment-success/route';
import { POST as cancelRoute } from '@/app/api/v1/sessions/payment-cancel/route';

describe.each([
  ['payment-success', success],
  ['payment-cancel', cancelRoute],
])('POST /sessions/%s', (_name, handler) => {
  it('400 on missing billId', async () => {
    const res = await handler(req({}));
    expect(res.status).toBe(400);
  });

  it('200 with the reconciled status', async () => {
    (svc.checkSessionPaymentStatus as any).mockResolvedValue({ status: 'paid', expectedAmount: 50000 });
    const res = await handler(req({ billId: '9' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'paid', expectedAmount: 50000 });
  });

  it('404 when no payment exists for the bill', async () => {
    (svc.checkSessionPaymentStatus as any).mockRejectedValue(new (svc as any).UnknownOrderError());
    const res = await handler(req({ billId: '9' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: FAIL — both routes still return their 501 stub bodies.

- [ ] **Step 3: Implement**

Replace the full contents of `src/app/api/v1/sessions/payment-success/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { checkSessionPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;
const bodySchema = z.object({ billId: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, STAFF_ROLES);
  if ('response' in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'billId is required');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await checkSessionPaymentStatus(parsed.data.billId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this bill');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[sessions/payment-success] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

Replace the full contents of `src/app/api/v1/sessions/payment-cancel/route.ts` with the **identical** body, only changing the `console.error` tag to `[sessions/payment-cancel]`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { checkSessionPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;
const bodySchema = z.object({ billId: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, STAFF_ROLES);
  if ('response' in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'billId is required');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await checkSessionPaymentStatus(parsed.data.billId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this bill');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[sessions/payment-cancel] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

Note: both routes need `requireRoles` mocked (already stubbed in Task 10's setup) to resolve to `{ actor }` by default for these `describe.each` tests to reach the body — confirm the existing `vi.mock('@/lib/auth/route-guards', ...)` from Task 10 covers this (it does, same test file).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments/session-routes.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the entire payments + public-booking suites**

Run: `npx vitest run tests/payments/ tests/public-booking/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/sessions/payment-success/route.ts src/app/api/v1/sessions/payment-cancel/route.ts tests/payments/session-routes.test.ts
git commit -m "feat(payments): implement sessions/payment-success and payment-cancel"
```

---

## Task 13: WP plugin — Settings: payment webhook URL + secret

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php`

No automated PHP tests exist in this repo — verify manually per Step 3.

- [ ] **Step 1: Register the two new options**

In `register_settings()`, after the existing `praktiqu_endpoint_webhook_secret` registration, add:

```php
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_payment_webhook_url', [
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ]);
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_payment_webhook_secret', [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_payment_secret'],
            'default'           => '',
        ]);
```

Add the sanitize callback right after the existing `sanitize_secret()` method:

```php
    /**
     * Same placeholder-preserving behavior as sanitize_secret(), but for the
     * payment webhook secret — kept independently rotatable from the general
     * webhook secret (see 2026-07-14 payment feature design §5 Security).
     */
    public function sanitize_payment_secret(string $value): string
    {
        if ($value === '' || $value === str_repeat('*', 8)) {
            return (string) get_option('praktiqu_endpoint_payment_webhook_secret', '');
        }
        return $value;
    }
```

- [ ] **Step 2: Add the admin-page form fields + endpoint list entries**

In `render_page()`, after the closing `</table>` of the existing webhook fields (before `<?php submit_button(); ?>`), add:

```php
                <h2><?php esc_html_e('PraktiQU Payment Webhook', 'praktiqu-endpoint'); ?></h2>
                <p class="description">
                    <?php esc_html_e('Separate URL + secret for payment.completed / payment.failed / payment.expired events (Xendit via WooCommerce). Kept independent of the general webhook secret above so it can be rotated without affecting password/user-state webhooks.', 'praktiqu-endpoint'); ?>
                </p>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_payment_webhook_url"><?php esc_html_e('Payment Webhook URL', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <input
                                type="url"
                                id="praktiqu_endpoint_payment_webhook_url"
                                name="praktiqu_endpoint_payment_webhook_url"
                                value="<?php echo esc_attr((string) get_option('praktiqu_endpoint_payment_webhook_url', '')); ?>"
                                class="regular-text"
                                placeholder="https://praktiqu.example.com/api/v1/sessions/payment-webhook"
                            />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="praktiqu_endpoint_payment_webhook_secret"><?php esc_html_e('Payment Webhook Secret', 'praktiqu-endpoint'); ?></label>
                        </th>
                        <td>
                            <?php $payment_secret = (string) get_option('praktiqu_endpoint_payment_webhook_secret', ''); ?>
                            <input
                                type="text"
                                id="praktiqu_endpoint_payment_webhook_secret"
                                name="praktiqu_endpoint_payment_webhook_secret"
                                value="<?php echo esc_attr($payment_secret === '' ? '' : str_repeat('*', max(8, strlen($payment_secret)))); ?>"
                                class="regular-text"
                                placeholder="<?php esc_attr_e('(unchanged)', 'praktiqu-endpoint'); ?>"
                            />
                            <p class="description">
                                <?php esc_html_e('Must match the PraktiQU Next.js app\'s PAYMENT_WEBHOOK_SECRET env var exactly.', 'praktiqu-endpoint'); ?>
                            </p>
                        </td>
                    </tr>
                </table>
```

And extend the endpoint list `<ul>` with:

```php
                <li><code>POST /payments/order</code> — create a WooCommerce order for an appointment/bill</li>
                <li><code>GET  /payments/order/{id}</code> — read WooCommerce order status</li>
```

- [ ] **Step 3: Manual verification checklist**

- [ ] `php -l includes/class-praktiqu-endpoint-settings.php` reports no syntax errors.
- [ ] On a local/staging WP install with the plugin active, visit Settings → PraktiQU Endpoint and confirm the two new fields render and save (submit, reload, confirm the URL persists and the secret shows asterisks).

- [ ] **Step 4: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php
git commit -m "feat(wp-plugin): add payment webhook URL/secret settings fields"
```

---

## Task 14: WP plugin — new `Payments` class (WC order creation + status + dispatch)

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (require the new file)

- [ ] **Step 1: Create the `Payments` class**

Create `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php`:

```php
<?php
/**
 * Payments — WooCommerce order bridge for the Xendit-via-WooCommerce
 * payment feature (2026-07-14 design).
 *
 * Creates WC orders directly (KiviCare `create_wc_direct_order` pattern:
 * one virtual product per line item, taxes as WC_Order_Item_Fee), exposes
 * order status for the verify-fallback path, and dispatches a dedicated,
 * separately-secreted signed webhook on completion/failure/expiry — kept
 * apart from Hooks::dispatch_webhook() (which serves user-lifecycle events)
 * so payment webhook trust can be rotated independently.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Payments
{
    public function register(): void
    {
        add_action('woocommerce_order_status_changed', [$this, 'on_order_status_changed'], 10, 4);
        add_action('woocommerce_payment_complete', [$this, 'on_payment_complete'], 10, 1);
    }

    /**
     * Create a WooCommerce order for an appointment (public) or bill (session).
     *
     * @param array $input {
     *   source: 'public'|'session', appointmentId?: string, billId?: string,
     *   encounterId?: string, customerEmail: string,
     *   items: array<{name:string,price:number}>, taxes: array<{name:string,amount:number}>,
     *   returnUrl: string, cancelUrl: string
     * }
     */
    public function create_order(array $input): array|\WP_Error
    {
        if (!class_exists('WooCommerce')) {
            return new \WP_Error('woocommerce_missing', 'WooCommerce is not active', ['status' => 503]);
        }

        $order = wc_create_order();

        foreach ((array) ($input['items'] ?? []) as $item) {
            $product = new \WC_Product_Simple();
            $product->set_name((string) ($item['name'] ?? 'Service'));
            $product->set_status('publish');
            $product->set_price((string) ($item['price'] ?? 0));
            $product->set_regular_price((string) ($item['price'] ?? 0));
            $product->set_virtual(true);
            $product->set_sold_individually(true);
            $product->set_catalog_visibility('hidden');
            $product->set_manage_stock(false);
            $product->set_stock_status('instock');
            $product_id = $product->save();
            $order->add_product(wc_get_product($product_id), 1);
        }

        foreach ((array) ($input['taxes'] ?? []) as $tax) {
            $amount = (float) ($tax['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            $fee = new \WC_Order_Item_Fee();
            $fee->set_name((string) ($tax['name'] ?? 'Tax'));
            $fee->set_amount((string) $amount);
            $fee->set_total((string) $amount);
            $order->add_item($fee);
        }

        $order->set_billing_email((string) ($input['customerEmail'] ?? ''));
        $order->update_meta_data('praktiqu_source', (string) ($input['source'] ?? 'public'));
        if (!empty($input['appointmentId'])) {
            $order->update_meta_data('praktiqu_appointment_id', (string) $input['appointmentId']);
        }
        if (!empty($input['billId'])) {
            $order->update_meta_data('praktiqu_bill_id', (string) $input['billId']);
        }
        if (!empty($input['encounterId'])) {
            $order->update_meta_data('praktiqu_encounter_id', (string) $input['encounterId']);
        }
        if (!empty($input['returnUrl'])) {
            $order->update_meta_data('praktiqu_return_url', esc_url_raw((string) $input['returnUrl']));
        }
        if (!empty($input['cancelUrl'])) {
            $order->update_meta_data('praktiqu_cancel_url', esc_url_raw((string) $input['cancelUrl']));
        }

        $order->calculate_totals();
        $order->save();

        return [
            'orderId'     => $order->get_id(),
            'checkoutUrl' => $order->get_checkout_payment_url(),
        ];
    }

    public function get_order_status(int $order_id): array|\WP_Error
    {
        if (!class_exists('WooCommerce')) {
            return new \WP_Error('woocommerce_missing', 'WooCommerce is not active', ['status' => 503]);
        }
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order) {
            return new \WP_Error('order_not_found', 'WooCommerce order not found', ['status' => 404]);
        }
        return [
            'orderId'       => $order_id,
            'status'        => $order->get_status(),
            'isPaid'        => $order->is_paid(),
            'transactionId' => $order->get_transaction_id() ?: null,
            'amount'        => (int) round((float) $order->get_total()),
        ];
    }

    /**
     * Cancel a WC order that never completed payment. Called by
     * Jobs::handle_payment_auto_cancel. Never cancels an already-paid order.
     */
    public function cancel_order(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order || $order->is_paid()) {
            return;
        }
        $order->update_status('cancelled', 'PraktiQU auto-cancel: payment window expired.');
    }

    public function on_order_status_changed(int $order_id, string $old_status, string $new_status, \WC_Order $order): void
    {
        if (!$this->is_praktiqu_order($order)) {
            return;
        }
        if (in_array($new_status, ['cancelled', 'failed'], true)) {
            $this->dispatch_payment_webhook('payment.failed', $order);
        }
    }

    public function on_payment_complete(int $order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof \WC_Order || !$this->is_praktiqu_order($order)) {
            return;
        }
        $this->dispatch_payment_webhook('payment.completed', $order);
    }

    private function is_praktiqu_order(\WC_Order $order): bool
    {
        return (bool) ($order->get_meta('praktiqu_appointment_id') || $order->get_meta('praktiqu_bill_id'));
    }

    /**
     * Fire a payment-specific webhook, signed with the dedicated payment
     * webhook secret (see Settings — kept separate from the general secret
     * used for password/user events).
     */
    public function dispatch_payment_webhook(string $event, \WC_Order $order): void
    {
        $url = (string) get_option('praktiqu_endpoint_payment_webhook_url', '');
        if ($url === '') {
            return;
        }
        $secret = (string) get_option('praktiqu_endpoint_payment_webhook_secret', '');

        $payload = [
            'event'         => $event,
            'wcOrderId'     => $order->get_id(),
            'amountPaid'    => (int) round((float) $order->get_total()),
            'transactionId' => $order->get_transaction_id() ?: null,
            'source'        => $order->get_meta('praktiqu_source') ?: 'public',
            'issuedAt'      => gmdate('c'),
        ];
        $body = wp_json_encode($payload);
        if ($body === false) {
            return;
        }
        $signature = $secret !== '' ? hash_hmac('sha256', $body, $secret) : '';

        $response = wp_remote_post($url, [
            'method'      => 'POST',
            'timeout'     => 5,
            'redirection' => 0,
            'headers'     => [
                'Content-Type'                 => 'application/json',
                'X-PraktiQU-Webhook-Signature' => $signature,
            ],
            'body'        => $body,
            'blocking'    => false,
        ]);
        if (is_wp_error($response) && defined('WP_DEBUG') && WP_DEBUG) {
            error_log('[praktiqu-endpoint] payment webhook dispatch failed: ' . $response->get_error_message());
        }
    }
}
```

- [ ] **Step 2: Require the new file**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, after the `class-praktiqu-endpoint-jobs.php` require line, add:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-payments.php';
```

- [ ] **Step 3: Manual verification checklist**

- [ ] `php -l includes/class-praktiqu-endpoint-payments.php` reports no syntax errors.
- [ ] `php -l praktiqu-endpoint.php` reports no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
git commit -m "feat(wp-plugin): add Payments class (WC order creation, status, webhook dispatch)"
```

---

## Task 15: WP plugin — REST routes for `/payments/order`

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php`

**Interfaces:**
- Consumes: `Payments::create_order`, `Payments::get_order_status` (Task 14).

- [ ] **Step 1: Wire `Payments` into the constructor**

Change:

```php
    private Service $service;
    private Jobs $jobs;

    public function __construct(Service $service, Jobs $jobs)
    {
        $this->service = $service;
        $this->jobs = $jobs;
    }
```

to:

```php
    private Service $service;
    private Jobs $jobs;
    private Payments $payments;

    public function __construct(Service $service, Jobs $jobs, Payments $payments)
    {
        $this->service = $service;
        $this->jobs = $jobs;
        $this->payments = $payments;
    }
```

- [ ] **Step 2: Register the two new routes**

In `register_routes()`, after the `DELETE /jobs` route block, add:

```php
        // POST /praktiqu/v1/payments/order — create a WC order (2026-07-14 payment feature)
        register_rest_route($ns, '/payments/order', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
        ]);

        // GET /praktiqu/v1/payments/order/{id} — verify-fallback order status
        register_rest_route($ns, '/payments/order/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
```

- [ ] **Step 3: Add the handlers**

After `handle_cancel_job()`, add:

```php
    /**
     * POST /praktiqu/v1/payments/order
     */
    public function handle_create_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->create_order($request->get_json_params() ?: []);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }

    /**
     * GET /praktiqu/v1/payments/order/{id}
     */
    public function handle_get_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->get_order_status((int) $request->get_param('id'));
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }
```

- [ ] **Step 4: Manual verification checklist**

- [ ] `php -l includes/class-praktiqu-endpoint-rest-controller.php` reports no syntax errors.
- [ ] On staging with the service token configured: `curl -X POST https://staging2.praktiqu.com/wp-json/praktiqu/v1/payments/order -H "X-PraktiQU-Service-Token: $TOKEN" -H "Content-Type: application/json" -d '{"source":"public","items":[{"name":"Test","price":10000}],"taxes":[],"customerEmail":"t@x.com"}'` returns `{"orderId":..., "checkoutUrl":...}`.
- [ ] `curl https://staging2.praktiqu.com/wp-json/praktiqu/v1/payments/order/<id> -H "X-PraktiQU-Service-Token: $TOKEN"` returns the order status.

- [ ] **Step 5: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php
git commit -m "feat(wp-plugin): register POST/GET /payments/order REST routes"
```

---

## Task 16: WP plugin — auto-cancel job handler

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php`

**Interfaces:**
- Consumes: `Payments::cancel_order`, `Payments::dispatch_payment_webhook` (Task 14).

- [ ] **Step 1: Wire `Payments` into the constructor**

Change:

```php
final class Jobs
{
    public const GROUP = 'praktiqu-jobs';

    private Service $service;

    public function __construct(Service $service)
    {
        $this->service = $service;
    }
```

to:

```php
final class Jobs
{
    public const GROUP = 'praktiqu-jobs';

    private Service $service;
    private Payments $payments;

    public function __construct(Service $service, Payments $payments)
    {
        $this->service = $service;
        $this->payments = $payments;
    }
```

- [ ] **Step 2: Register the hook + allowlist entry**

In `register()`, add:

```php
        add_action('praktiqu_payment_auto_cancel', [$this, 'handle_payment_auto_cancel'], 10, 1);
```

In `enqueue()`, add `'praktiqu_payment_auto_cancel'` to the `$allowed` array:

```php
        $allowed = [
            'praktiqu_session_auto_complete',
            'praktiqu_session_send_reminder',
            'praktiqu_log_purge',
            'praktiqu_payment_auto_cancel',
        ];
```

- [ ] **Step 3: Add the handler**

After `handle_session_send_reminder()`, add:

```php
    /**
     * Auto-cancel a WC order whose 1-hour payment window has expired
     * (2026-07-14 payment feature). No-op if the order is already paid.
     *
     * Args: [wcOrderId (int)] — matches the args passed by PraktiQU's
     * jobs.enqueue() call exactly, so jobs.cancel() with the same args can
     * unschedule this action if payment completes first.
     */
    public function handle_payment_auto_cancel(int $wcOrderId): void
    {
        $order = wc_get_order($wcOrderId);
        if (!$order instanceof \WC_Order || $order->is_paid()) {
            return;
        }
        $this->payments->cancel_order($wcOrderId);
        $this->payments->dispatch_payment_webhook('payment.expired', $order);
    }
```

- [ ] **Step 4: Manual verification checklist**

- [ ] `php -l includes/class-praktiqu-endpoint-jobs.php` reports no syntax errors.
- [ ] On staging: enqueue a test job via `curl -X POST .../wp-json/praktiqu/v1/jobs -d '{"hook":"praktiqu_payment_auto_cancel","runAt":<epoch+60>,"args":{"wcOrderId":<test-order-id>}}'`, wait for WP-Cron to fire, confirm the WC order transitions to `cancelled` and the payment webhook fires (check `error_log` if `WP_DEBUG` is on, or inspect the Next.js side's received webhook).

- [ ] **Step 5: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php
git commit -m "feat(wp-plugin): praktiqu_payment_auto_cancel job handler"
```

---

## Task 17: WP plugin — wire `Payments` into `Plugin.php`

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php`

- [ ] **Step 1: Add the property + instantiate before its dependents**

Change:

```php
    public Service $service;
    public REST_Controller $rest;
    public Hooks $hooks;
    public Jobs $jobs;
    public Settings $settings;

    private function __construct()
    {
        $this->service  = new Service();
        $this->jobs     = new Jobs($this->service);
        $this->rest     = new REST_Controller($this->service, $this->jobs);
        $this->hooks    = new Hooks($this->service);
        $this->settings = new Settings();

        $this->rest->register();
        $this->hooks->register();
        $this->jobs->register();
        $this->settings->register();
    }
```

to:

```php
    public Service $service;
    public Payments $payments;
    public REST_Controller $rest;
    public Hooks $hooks;
    public Jobs $jobs;
    public Settings $settings;

    private function __construct()
    {
        $this->service  = new Service();
        $this->payments = new Payments();
        $this->jobs     = new Jobs($this->service, $this->payments);
        $this->rest     = new REST_Controller($this->service, $this->jobs, $this->payments);
        $this->hooks    = new Hooks($this->service);
        $this->settings = new Settings();

        $this->rest->register();
        $this->hooks->register();
        $this->jobs->register();
        $this->payments->register();
        $this->settings->register();
    }
```

- [ ] **Step 2: Manual verification checklist**

- [ ] `php -l includes/class-praktiqu-endpoint-plugin.php` reports no syntax errors.
- [ ] Deactivate + reactivate the plugin on a local/staging WP install (or run `wp plugin list` if WP-CLI is available) — no fatal errors on `plugins_loaded`.
- [ ] `GET /wp-json/praktiqu/v1/health` still returns `200` (confirms the constructor chain didn't break bootstrapping).

- [ ] **Step 3: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php
git commit -m "feat(wp-plugin): wire Payments into Plugin bootstrap"
```

---

## Task 18: Env vars + plugin readme

**Files:**
- Modify: `.env.example`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (version bump)

- [ ] **Step 1: Add `PAYMENT_WEBHOOK_SECRET` to `.env.example`**

In `.env.example`, after the `# Stripe (Billing feature, 011)` block under `# OPTIONAL: Payment Gateways`, add:

```bash
# Payment webhook signature secret (Xendit via WooCommerce, 2026-07 payment feature).
# MUST differ from AUTH_SECRET / WORDPRESS_WEBHOOK_SECRET — configured
# independently in the praktiqu-endpoint plugin's "Payment Webhook Secret"
# setting (Settings → PraktiQU Endpoint). Generate with: openssl rand -base64 32
PAYMENT_WEBHOOK_SECRET="dev-payment-webhook-secret-change-me"
```

- [ ] **Step 2: Bump the plugin version**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`, change:
```php
 * Version:           1.1.0
```
to:
```php
 * Version:           1.2.0
```
and:
```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.1.0');
```
to:
```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.2.0');
```

- [ ] **Step 3: Update the readme**

In `Wordpress-Plugin/praktiqu-endpoint/readme.txt`, change `Stable tag: 1.0.0` to `Stable tag: 1.2.0`, add to `== Endpoints ==`:

```
* `POST /payments/order` — create a WooCommerce order for an appointment or bill
* `GET  /payments/order/{id}` — read WooCommerce order status
```

and add to `== Changelog ==`:

```
= 1.2.0 =
* Payments: Xendit-via-WooCommerce bridge. New /payments/order (create) and
  /payments/order/{id} (status) endpoints, praktiqu_payment_auto_cancel job,
  and a dedicated payment webhook URL/secret (independent of the general
  webhook secret) dispatching payment.completed/failed/expired.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example Wordpress-Plugin/praktiqu-endpoint/readme.txt Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
git commit -m "docs(payments): env var + plugin readme/version for the payment feature"
```

---

## Task 19: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire vitest suite**

Run: `npx vitest run`
Expected: all `tests/payments/*` files PASS; no new failures introduced elsewhere (the pre-existing 8 legacy `wp_kc_*` billing failures noted in the design's Out-of-scope section are expected and unrelated).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint` (skip if no such script exists — check `package.json` first)
Expected: no new lint errors in touched files.

- [ ] **Step 4: Manual end-to-end note**

Per the design's §Testing: full end-to-end verification (real Xendit test-mode payment, real WC checkout redirect, real webhook delivery) requires the staging deploy — track that separately per the design's "Out of scope" section (the pending `.next` staging deploy of `5339a35`). Do not claim end-to-end verification without it.
