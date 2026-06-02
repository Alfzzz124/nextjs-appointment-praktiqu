# Feature Specification: Billing

**Feature Branch**: `feat/011-billing`
**Created**: 2026-06-02
**Status**: Draft
**Input**: Generate bill, add bill items, apply discount, record payment, print invoice, payment status tracking.

> **Replaces**: the 602-byte stub that previously lived at this path. The KiviCare plugin (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/BillController.php`) has the original implementation; this spec targets feature parity for psychology practice on the Next.js stack.

## Clarifications

### Session 2026-06-02

- **Q: What payment provider?** → A: **Stripe** with **Stripe Elements** (PCI SAQ-A). The PraktiQU server never touches raw card data. PayPal deferred (not in MVP). See audit recommendation M12.
- **Q: How is the invoice numbered?** → A: `INV-{clinicCode}-{YYYY}-{sequence}`, per clinic, zero-padded sequence starting at `00001`. Resets yearly. Clinic code is a 2–4 character alphanumeric slug stored on the `Clinic` table.
- **Q: When is a bill created?** → A: A bill is auto-generated when a session transitions to `CHECK_OUT` or `COMPLETED` status (per 005-session-mgmt FR-008). Receptionist can also create ad-hoc bills from the cashier view.
- **Q: What about tax?** → A: For MVP, tax is **per-line optional** (default 0%). Multi-jurisdiction tax is deferred. If a clinic needs real tax, it can use Stripe Tax (configured separately); PraktiQU's Prisma `Bill.taxAmount` field is the single source of truth for what was charged.
- **Q: Receipt vs invoice?** → A: A **receipt** is a non-fiscal confirmation issued when payment is recorded. An **invoice** is a billing document issued at bill creation (or before payment). They are different documents with different templates. MVP supports both.
- **Q: Refunds and partial payments?** → A: A bill can have multiple `Payment` rows summing to the `actualAmount`; partial payments are first-class. **Refunds** are negative-amount `Payment` rows with `paymentMethod = 'refund'` and a `refundedPaymentId` reference back to the original payment.
- **Q: Discount rules?** → A: A discount is a positive `BillItem` of type `DISCOUNT` (negative price) on the bill. Per-line discount and bill-level discount both supported. `BR-08.03`: total discount cannot exceed `subtotal`. Enforced in the create/update endpoint.
- **Q: What's the audit-trail requirement?** → A: Every bill state change (create, update, pay, refund, void) is logged via `logging.audit()` (per `docs/architecture/logging.md`).
- **Q: What about aging reports?** → A: Aging buckets (0-30, 31-60, 61-90, 90+ days) computed on demand in the clinic-admin dashboard. No separate background job needed for MVP.

---

## User Scenarios & Testing

### User Story 1 - Auto-Generate Bill on Session Completion (Priority: P1)

When a session is checked out, the system generates a draft bill based on the services rendered and persists it. Receptionist reviews and confirms the bill before invoicing.

**Why this priority**: Without automatic bill generation, the front desk would have to recreate every bill manually — error-prone and unscalable.

**Independent Test**: Complete a session (CHECK_IN → CHECK_OUT) and verify a draft bill exists with the correct line items, totals, and tax.

**Acceptance Scenarios**:

1. **Given** a session in `CHECK_IN` status linked to a professional, client, and one or more services, **When** the receptionist checks the client out (CHECK_OUT), **Then** the system creates a `Bill` in `DRAFT` status with one `BillItem` per session service, `subtotal = sum(itemPrice)`, `discount = 0`, `taxAmount = 0`, and `actualAmount = subtotal`. Bill is visible to the receptionist's billing queue.

2. **Given** a session in `CHECK_OUT` status with a draft bill, **When** the receptionist opens the bill, **Then** they can add/remove line items, set a discount, set a tax amount, and confirm. Confirming transitions the bill to `ISSUED` and generates an invoice document.

3. **Given** a session in `COMPLETED` status (auto-closed per 005-session-mgmt), **When** the system runs the auto-completion job, **Then** if no bill exists for the session, the job creates one in `DRAFT` status with a metadata `autoCreated: true` flag. (Same code path as US1; just a different trigger.)

---

### User Story 2 - Receptionist Records a Payment (Priority: P1)

Receptionist records a payment against a bill. Supports full and partial payment, multiple payment methods per bill, and refunds.

**Why this priority**: Payments are the core revenue-recognition flow. Without this, no money is collected.

**Independent Test**: Issue a bill, record a partial payment via Stripe, verify the bill's `paidAmount`, `balanceDue`, and `paymentStatus` update correctly.

**Acceptance Scenarios**:

1. **Given** a bill in `ISSUED` status with `actualAmount = 500_000 IDR`, **When** the receptionist records a payment of `300_000 IDR` via Stripe, **Then** the system creates a `Payment` row with `status: 'succeeded'`, updates `Bill.paidAmount = 300_000`, `Bill.balanceDue = 200_000`, and `Bill.paymentStatus = 'partial'`. Stripe webhook confirms the charge.

2. **Given** a bill with `balanceDue > 0`, **When** the receptionist records a payment for the full balance, **Then** `Bill.paymentStatus` transitions to `paid`, `paidAmount = actualAmount`, `balanceDue = 0`, and an `InvoiceReceipt` is generated and emailed to the client.

3. **Given** a bill with multiple payments already recorded, **When** the receptionist records a refund against an earlier payment, **Then** the system creates a negative-amount `Payment` row with `paymentMethod = 'refund'`, decrements `paidAmount` by the refund amount, and adjusts `balanceDue` and `paymentStatus` accordingly. Stripe refund is initiated; webhook confirms.

4. **Given** a bill with `paymentStatus = 'paid'`, **When** the receptionist attempts to record another non-refund payment, **Then** the system rejects with 409 `bill_already_paid` and surfaces the overpayment warning.

---

### User Story 3 - Apply Discount (Priority: P1)

Receptionist applies a discount to a bill. Discounts can be per-line or whole-bill; cannot exceed the subtotal.

**Why this priority**: Common in psychology practice (early-payment, returning-client, package). Must enforce the `BR-08.03` invariant.

**Independent Test**: Create a bill with subtotal `100_000 IDR`, apply a `20_000 IDR` discount, verify `actualAmount = 80_000`. Try `120_000 IDR` discount and verify rejection.

**Acceptance Scenarios**:

1. **Given** a draft bill with subtotal `100_000 IDR`, **When** the receptionist adds a bill-level discount of `20_000 IDR` with reason "returning client", **Then** the system creates a `BillItem` of type `DISCOUNT` with negative price `-20_000`, recomputes `actualAmount = 80_000`, and logs the discount application.

2. **Given** a draft bill, **When** the receptionist attempts a discount greater than the subtotal (e.g. `120_000 IDR` on `100_000` subtotal), **Then** the system rejects with 400 `discount_exceeds_subtotal`.

3. **Given** a draft bill, **When** the receptionist adds a per-line discount by editing a `BillItem.discount` field, **Then** the bill-level totals are recomputed and the line item is updated in place.

---

### User Story 4 - Print Invoice and Receipt (Priority: P1)

Receptionist or client prints an invoice (issued bill) or a receipt (paid bill). PDF generation is client-side (browser print) for MVP.

**Why this priority**: Required for tax/regulatory record-keeping in many jurisdictions; also standard clinic practice.

**Independent Test**: Issue a bill, open the print view, verify it renders with clinic header, line items, totals, and (for receipts) payment history.

**Acceptance Scenarios**:

1. **Given** a bill in `ISSUED` status, **When** the receptionist clicks "Print Invoice", **Then** a print-formatted page renders with: clinic name + logo, bill number (`INV-...`), issue date, client name + contact, line items table, subtotal, discount, tax, actual amount, payment terms. Browser print dialog opens.

2. **Given** a bill with `paymentStatus = 'paid'`, **When** the client or receptionist clicks "Print Receipt", **Then** a print-formatted page renders with: receipt header, bill reference, paid amount, payment method, date, balance due (0).

3. **Given** a bill with multiple partial payments, **When** a receipt is printed, **Then** the receipt lists each payment as a line: date, method, amount, reference.

---

### User Story 5 - View Billing History (Priority: P1)

Clinic Admin views all bills across the practice: by date range, by status, by client, by professional. Receptionist sees the same scoped to their permissions.

**Why this priority**: Operational visibility is required for daily reconciliation and monthly reporting.

**Independent Test**: As Clinic Admin, filter bills by `paymentStatus = 'unpaid'`, verify only unpaid bills are listed, paginated.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is on the billing list, **When** they apply a filter `paymentStatus = 'unpaid'`, **Then** the system displays only bills in `unpaid` or `partial` status for their practice, paginated 20 per page, sortable by `createdAt`.

2. **Given** a Clinic Admin filters by `clientId`, **When** they apply the filter, **Then** the list shows only that client's bills across all statuses.

3. **Given** a Receptionist is on the billing list, **When** they attempt to view a bill from another practice, **Then** the system rejects with 404 (not 403, to avoid existence leak).

---

### User Story 6 - Void a Bill (Priority: P2)

Clinic Admin voids a bill that was created in error. Voided bills are retained for audit but excluded from revenue reports.

**Why this priority**: Errors happen. Voiding is a recovery path.

**Independent Test**: Issue a bill, void it, verify it disappears from active reports but appears in the audit log.

**Acceptance Scenarios**:

1. **Given** a bill in `ISSUED` status with no payments, **When** the Clinic Admin voids it with reason "duplicate", **Then** the system sets `Bill.status = 'VOID'`, retains the row, and logs the void event with reason.

2. **Given** a bill with any successful payment, **When** the Clinic Admin attempts to void it, **Then** the system rejects with 409 `cannot_void_paid_bill` and suggests issuing a refund instead.

---

### Edge Cases

- **Stripe webhook arrives before the create-bill response**: PraktiQU stores Stripe `paymentIntentId` on the Payment row, de-duplicates by intent ID; the webhook handler is idempotent.
- **Two receptionists record the same payment concurrently**: Last-write-wins on the bill's `paidAmount` is unacceptable. The payment-create endpoint uses a database transaction with `SELECT ... FOR UPDATE` on the bill row to serialize concurrent payments. The second attempt fails with 409 `concurrent_modification`.
- **Bill auto-generated after the auto-completion job (005-session-mgmt FR-008)**: If the bill already exists, the job is a no-op (idempotent on `sessionId`).
- **Refund on a Stripe payment that was later disputed**: Stripe sends a `charge.dispute.created` webhook; PraktiQU flags the bill `disputed: true` and the admin reviews. Not in MVP scope but the `Bill.metadata` field is reserved for this.
- **Currency is not IDR**: For MVP, the bill stores the clinic's configured currency (single currency per clinic). Cross-currency deferred.
- **Bill line item refers to a service that was later deactivated**: Bill still references the historical `Service` row; the line item shows the service's last known name/price.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST auto-generate a `Bill` in `DRAFT` status when a session transitions to `CHECK_OUT` or `COMPLETED`, with one `BillItem` per service rendered.
- **FR-002**: System MUST allow a Receptionist or Clinic Admin to create ad-hoc bills via `POST /api/v1/bills`.
- **FR-003**: System MUST allow a Receptionist to add, update, and remove `BillItem` rows on a `DRAFT` bill.
- **FR-004**: System MUST allow a Receptionist to apply a per-line discount (`BillItem.discount`) and a whole-bill discount (`BillItem` of type `DISCOUNT`).
- **FR-005**: System MUST reject a discount that exceeds the bill subtotal with 400 `discount_exceeds_subtotal` (per `BR-08.03`).
- **FR-006**: System MUST allow a Receptionist to issue a draft bill (transition `DRAFT` → `ISSUED`), which generates an invoice number `INV-{clinicCode}-{YYYY}-{NNNNN}` (per-clinic, per-year, zero-padded).
- **FR-007**: System MUST allow a Receptionist to record a payment against an issued bill via `POST /api/v1/bills/{id}/payments`. Supports full and partial payments.
- **FR-008**: System MUST allow a Receptionist to record a refund via `POST /api/v1/bills/{id}/refunds`, which creates a negative-amount `Payment` row linked to the original via `refundedPaymentId`.
- **FR-009**: System MUST expose `GET /api/v1/bills` with filters: `paymentStatus`, `status`, `clinicId`, `clientId`, `professionalId`, `dateFrom`, `dateTo`, paginated 20 per page, sortable by `createdAt`, `actualAmount`, `paymentStatus`.
- **FR-010**: System MUST expose `GET /api/v1/bills/{id}` returning the full bill with line items and payment history.
- **FR-011**: System MUST expose `GET /api/v1/bills/{id}/invoice` (HTML print view) and `GET /api/v1/bills/{id}/receipt` (HTML print view).
- **FR-012**: System MUST allow a Clinic Admin to void a bill with a reason (`POST /api/v1/bills/{id}/void`). Voided bills are retained but excluded from revenue reports.
- **FR-013**: System MUST reject voiding a bill with any successful payment with 409 `cannot_void_paid_bill`; the operation must issue a refund instead.
- **FR-014**: System MUST log every bill state change (create, issue, pay, refund, void) via `logging.audit()` with actor, bill ID, before/after status, and amount.
- **FR-015**: System MUST integrate with **Stripe** for payment processing using **Stripe Elements** (PCI SAQ-A). PraktiQU never stores raw card data. Stripe `paymentIntentId` is stored on the `Payment` row.
- **FR-016**: System MUST handle Stripe webhooks (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`) at `POST /api/v1/webhooks/stripe`. Signature verification via `STRIPE_WEBHOOK_SECRET`.
- **FR-017**: System MUST compute `Bill.paidAmount`, `Bill.balanceDue`, and `Bill.paymentStatus` (`unpaid` | `partial` | `paid` | `refunded` | `disputed`) on every payment create/refund/void.
- **FR-018**: System MUST scope all bill reads and writes to the user's practice (per `BR-10.03`) and the user's role (per `docs/architecture/role-taxonomy.md`).
- **FR-019**: System MUST allow a Clinic Admin to view revenue and aging reports: total revenue (this month/quarter/year), outstanding balance, aging buckets (0-30, 31-60, 61-90, 90+ days).
- **FR-020**: System MUST return RFC 7807 Problem Details for all billing endpoint errors.

### Key Entities

- **Bill**: { id, clinicId, clientId, sessionId?, professionalId, billNumber (unique per clinic), status: 'DRAFT'|'ISSUED'|'PAID'|'PARTIAL'|'VOID'|'REFUNDED', subtotal, discount, taxAmount, actualAmount, paidAmount, balanceDue, paymentStatus: 'unpaid'|'partial'|'paid'|'refunded'|'disputed', notes, dueDate, voidedAt, voidedBy, voidReason, createdBy, createdAt, updatedAt, metadata }
- **BillItem**: { id, billId, type: 'SERVICE'|'DISCOUNT'|'OTHER', serviceId?, name, description?, quantity, unitPrice, discount, lineTotal, sortOrder, createdAt }
- **Payment**: { id, billId, amount, paymentMethod: 'stripe'|'cash'|'bank_transfer'|'other', stripePaymentIntentId? (unique), status: 'pending'|'succeeded'|'failed'|'refunded', transactionRef?, refundedPaymentId? (self-ref for refund linking), notes?, paidAt, createdBy, createdAt }
- **InvoiceReceipt** (logical, not necessarily a table): generated on demand from Bill + Payment rows; no storage needed for MVP.

### Success Criteria

- **SC-001**: A bill is auto-generated within 5 seconds of session CHECK_OUT transition.
- **SC-002**: A payment recorded by the receptionist is reflected in the bill's balance within 2 seconds (after Stripe webhook confirmation).
- **SC-003**: An invoice number is unique within a clinic; no duplicates even under concurrent issuance.
- **SC-004**: A Stripe webhook is processed and the bill updated within 5 seconds of receipt.
- **SC-005**: A clinic with 10,000 historical bills can be filtered and paginated with sub-second response time.
- **SC-006**: All 18 billing endpoints return RFC 7807-compliant error responses.
- **SC-007**: 100% of bill state changes are recorded in the audit log (via `logging.audit()`).
- **SC-008**: Refunds correctly invert a payment's effect on `paidAmount` and `balanceDue`.

### Assumptions

- **MVP scope**: one currency per clinic (configured at clinic level, IDR by default). Cross-currency deferred.
- **Tax**: per-line optional, default 0%. Multi-jurisdiction tax is deferred. Stripe Tax can be enabled separately by setting `Bill.taxAmount` manually or via webhook-driven recomputation.
- **Stripe is the only payment provider** in MVP. PayPal, midtrans, Xendit, etc. deferred. (Audit M12.)
- **PDF generation** is client-side (browser print) for MVP. Server-side PDF (Puppeteer) deferred.
- **Bill-to-session link is optional**: ad-hoc bills (e.g., for a package) have `sessionId = null`. Auto-generated bills have `sessionId` set.
- **One client per bill** for MVP. Splitting a bill across clients (e.g., family billing) deferred.
- **The Prisma `Bill`, `BillItem`, `Payment`, `Tax` models** in `prisma/schema.prisma` are the canonical data model. Spec refines field semantics.
- **Job runner dependency** (C8): the auto-completion job (005-session-mgmt FR-008) is what creates bills for sessions that complete without manual checkout. This spec assumes the job runner is decided in C8; the bill creation logic is the same as the receptionist's manual flow.
