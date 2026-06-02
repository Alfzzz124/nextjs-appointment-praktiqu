---
description: "Task list for 011-billing feature implementation"
---

# Tasks: 011-billing

**Input**: Feature specification from `specs/011-billing/spec.md`
**Prerequisites**: plan.md (required), spec.md (required for user stories), 001-auth-foundation (required for auth + RBAC), 005-session-mgmt (required for auto-bill trigger)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Foundational Setup

- [ ] TB01 [P] Add `paymentStatus`, `paidAmount`, `balanceDue`, `billNumber`, `voidedAt/By/Reason`, `disputedAt/Reason` columns to Prisma `Bill` model
- [ ] TB02 [P] Add `type` and `sortOrder` columns to Prisma `BillItem` model
- [ ] TB03 [P] Add `refundedPaymentId` self-relation and `metadata` Json to Prisma `Payment` model
- [ ] TB04 [P] Add `Clinic.code: String? @unique` and `Clinic.billSequence`, `Clinic.billSequenceYear` for invoice numbering
- [ ] TB05 [P] Create `src/lib/stripe.ts` — Stripe SDK wrapper exposing `getStripeInstance()`, `createPaymentIntent()`, `verifyWebhookSignature()`, `createRefund()`
- [ ] TB06 Write Prisma migration for the above schema additions; verify `prisma migrate dev` runs cleanly
- [ ] TB07 [P] Create `src/services/invoice-number.ts` — clinic-scoped sequence generator (atomic, year-rollover, retry on collision)
- [ ] TB08 Write tests for `invoice-number.ts` — cases: (a) first invoice in a clinic/year, (b) sequence increments, (c) year rollover resets, (d) concurrent issuance produces unique numbers, (e) invalid clinic code rejected
- [ ] TB09 [P] Create `src/services/billing.ts` skeleton with stub methods (throwing `NotImplemented`); to be filled in subsequent phases
- [ ] TB10 [P] Write RFC 7807 helpers reused from 001-auth-foundation: `BillingError.codes` (e.g., `discount_exceeds_subtotal`, `bill_already_paid`, `cannot_void_paid_bill`, `concurrent_modification`)

**Checkpoint**: Schema migrated, invoice-number generator tested, Stripe SDK wrapper compiles.

---

## Phase 2: Bill Create / Read / Update (US2, US3, US5)

- [ ] TB11 [US2] Write unit tests for `createAdHocBill` — cases: (a) valid bill with one service line item, (b) bill with discount, (c) bill with tax, (d) bill with multiple services, (e) invalid clinicId rejected, (f) cross-practice write rejected, (g) RFC 7807 errors
- [ ] TB12 [US2] Implement `createAdHocBill` in `src/services/billing.ts` — uses a single Prisma transaction
- [ ] TB13 [US2] Create `POST /api/v1/bills` route handler in `src/app/api/v1/bills/route.ts`
- [ ] TB14 [US2] Write integration tests for `POST /api/v1/bills` — full request/response cycle, role checks, validation
- [ ] TB15 [US5] Write tests for `listBills` — cases: (a) all bills for clinic, (b) filter by `paymentStatus`, (c) filter by `clientId`, (d) filter by `dateFrom/dateTo`, (e) pagination, (f) sort by `createdAt`, (g) cross-practice read rejected
- [ ] TB16 [US5] Implement `listBills` in `src/services/billing.ts`
- [ ] TB17 [US5] Create `GET /api/v1/bills` route handler
- [ ] TB18 [US5] Write integration tests for `GET /api/v1/bills` (filter combinations, pagination boundaries, RBAC)
- [ ] TB19 [P] [US5] Implement `getBill` (single fetch with items + payments) and create `GET /api/v1/bills/{id}` route
- [ ] TB20 [P] [US3] Write tests for discount application — cases: (a) per-line discount within subtotal, (b) bill-level discount within subtotal, (c) discount > subtotal rejected, (d) discount on a voided bill rejected
- [ ] TB21 [P] [US3] Implement discount application logic in `createAdHocBill` and `updateBill` services
- [ ] TB22 [US2] Write tests for `updateBill` (only DRAFT bills editable)
- [ ] TB23 [US2] Implement `updateBill` and create `PATCH /api/v1/bills/{id}` route

**Checkpoint**: Bills can be created, listed, retrieved, and updated (in DRAFT state). Discounts enforced.

---

## Phase 3: Auto-Generation from Session (US1)

- [ ] TB24 [US1] Write tests for `createBillFromSession(sessionId)` — cases: (a) session in CHECK_OUT → DRAFT bill with one item per service, (b) session already has bill → idempotent no-op, (c) session in wrong status rejected, (d) session's professional/clinic not found rejected
- [ ] TB25 [US1] Implement `createBillFromSession` in `src/services/billing.ts`
- [ ] TB26 [US1] Hook into 005-session-mgmt's CHECK_OUT transition: import billing service, call `createBillFromSession` after the status update transaction commits
- [ ] TB27 [US1] Write tests for the 005 → 011 integration — when a session is checked out, a bill is created
- [ ] TB28 [US1] Add "Create Bill" button to the receptionist's session detail view (Stitch reference TBD)

**Checkpoint**: When a receptionist checks out a session, a draft bill appears in the billing queue.

---

## Phase 4: Stripe Integration (US2 issue, US2 payment)

- [ ] TB29 [P] Add `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` to `.env.example` (per C7 deferred email decisions, document the parallel here)
- [ ] TB30 [US2] Write tests for `issueBill` — cases: (a) DRAFT → ISSUED generates invoice number, (b) billNumber is unique within clinic/year, (c) already-issued bill is idempotent, (d) bill with no items rejected
- [ ] TB31 [US2] Implement `issueBill` and create `POST /api/v1/bills/{id}/issue` (or fold into PATCH with `status: 'ISSUED'`)
- [ ] TB32 [US2] Write tests for `recordPayment` — cases: (a) full payment via Stripe succeeds, (b) partial payment succeeds, (c) overpayment rejected, (d) concurrent payments serialized via FOR UPDATE, (e) Stripe intent ID stored, (f) idempotency on Stripe webhook
- [ ] TB33 [US2] Implement `recordPayment` in `src/services/billing.ts`
- [ ] TB34 [US2] Create `POST /api/v1/bills/{id}/payments` route
- [ ] TB35 [P] [US2] Create `POST /api/v1/webhooks/stripe` route in `src/app/api/v1/webhooks/stripe/route.ts`
- [ ] TB36 [US2] Implement webhook handler — verify signature, process `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`
- [ ] TB37 [US2] Write tests for webhook handler — cases: (a) valid signature processed, (b) invalid signature 401, (c) duplicate event (idempotency by Stripe event ID) no-op, (d) unknown event type ignored
- [ ] TB38 [US2] Build the Stripe Elements payment form on the frontend (Stitch-based) — client-side, never touches PraktiQU server

**Checkpoint**: Bills can be paid via Stripe Elements. Webhooks update bill state.

---

## Phase 5: Refund + Void (US2 refund, US6 void)

- [ ] TB39 [US2] Write tests for `recordRefund` — cases: (a) full refund on a paid bill, (b) partial refund, (c) refund more than original payment rejected, (d) refund on unpaid bill rejected, (e) refund creates negative-amount Payment row linked to original
- [ ] TB40 [US2] Implement `recordRefund` and create `POST /api/v1/bills/{id}/refunds` route
- [ ] TB41 [US2] Wire refund to Stripe API call; webhook confirms
- [ ] TB42 [US6] Write tests for `voidBill` — cases: (a) void DRAFT bill succeeds, (b) void ISSUED bill (no payments) succeeds, (c) void bill with payments rejected (suggest refund), (d) void with reason captured, (e) voided bill excluded from revenue reports
- [ ] TB43 [US6] Implement `voidBill` and create `POST /api/v1/bills/{id}/void` route
- [ ] TB44 [US2/US6] Update `Bill.paymentStatus` computation to include `disputed` state when Stripe sends `charge.dispute.created` webhook

**Checkpoint**: Refunds and voids work. Bill `paymentStatus` transitions are correct.

---

## Phase 6: Frontend — List / Detail / New (US5, US2)

- [ ] TB45 [P] [US5] Build billing list page `src/app/(dashboard)/billing/page.tsx` — table with filters (status, client, date range), pagination, sort
- [ ] TB46 [P] [US5] Build bill detail page `src/app/(dashboard)/billing/[id]/page.tsx` — line items, payment history, action buttons
- [ ] TB47 [P] [US2] Build ad-hoc bill creation page `src/app/(dashboard)/billing/new/page.tsx` — service picker, client picker, line item editor
- [ ] TB48 [P] [US3] Build discount application UI (per-line + bill-level) with live total recompute
- [ ] TB49 [P] [US2] Build Stripe Elements payment form on bill detail page
- [ ] TB50 [P] [US6] Build void-bill dialog with reason capture

**Checkpoint**: Frontend usable for all primary flows.

---

## Phase 7: Print Views (US4)

- [ ] TB51 [US4] Build invoice print view `GET /api/v1/bills/{id}/invoice` — returns HTML with `@media print` CSS, clinic header, line items, totals, payment terms
- [ ] TB52 [US4] Build receipt print view `GET /api/v1/bills/{id}/receipt` — same template, plus payment history
- [ ] TB53 [US4] Write E2E test plan in `docs/testing/billing-print-e2e-plan.md` (open print view in headless Chrome, validate rendered DOM, validate PDF dimensions)
- [ ] TB54 [US4] Execute E2E test via `@vercel/agent-browser`; document results in `docs/testing/billing-print-e2e-results.md`

**Checkpoint**: Invoices and receipts print correctly across Chrome / Firefox / Safari.

---

## Phase 8: Reports (US5 reporting)

- [ ] TB55 [US5] Implement `getRevenueReport(clinicId, period)` — totals by month/quarter/year
- [ ] TB56 [US5] Implement `getAgingReport(clinicId)` — buckets 0-30, 31-60, 61-90, 90+ days
- [ ] TB57 [US5] Build reports view `src/app/(dashboard)/billing/reports/page.tsx` — table + chart (Stitch-based)
- [ ] TB58 Write tests for report functions (boundary cases: empty clinic, all paid, all overdue)

**Checkpoint**: Clinic Admin can see revenue and aging reports.

---

## Phase 9: Polish & Cross-Cutting

- [ ] TB59 [P] Add `docs/billing/architecture.md` (data model, state machine), `docs/billing/runbook.md` (Stripe keys, dispute handling, refund policy)
- [ ] TB60 Update `specs/011-billing/checklists/completion.md` against spec.md FR-001…FR-020 with pass/fail per requirement
- [ ] TB61 Run full CI/CD pipeline verification
- [ ] TB62 [P] Add unit tests for edge cases: invoice-number race, Stripe webhook replay, concurrent payment serialization, void-after-refund attempt, currency precision
- [ ] TB63 Security hardening review: Stripe webhook signature, no raw card data in logs, RBAC enforcement, audit log completeness
- [ ] TB64 Configure Vitest coverage threshold ≥ 80% for `src/services/billing.ts`; fail CI below threshold
- [ ] TB65 Generate OpenAPI 3.0 spec for `/api/v1/bills/*` via `zod-to-openapi`; serve at `/docs/api`
- [ ] TB66 Add Vitest benchmark: `POST /api/v1/bills/{id}/payments` p95 < 2s
- [ ] TB67 Add Vitest benchmark: `GET /api/v1/bills` with 10k bills p95 < 1s
- [ ] TB68 Add Vitest benchmark: Stripe webhook processing p95 < 500ms

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — START HERE
- **Bill CRUD (Phase 2)**: Depends on Foundational + 001-auth-foundation
- **Auto-generation (Phase 3)**: Depends on Bill CRUD + 005-session-mgmt
- **Stripe (Phase 4)**: Depends on Bill CRUD; runs parallel to Auto-generation
- **Refund + Void (Phase 5)**: Depends on Stripe
- **Frontend (Phase 6)**: Depends on Bill CRUD; runs parallel to Stripe/Refund
- **Print (Phase 7)**: Depends on Frontend
- **Reports (Phase 8)**: Depends on Bill CRUD; runs parallel to Print
- **Polish (Phase 9)**: Depends on all prior phases

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core service before route handler
- Story complete before moving to next priority

### Parallel Opportunities

Phases 3, 4, and 6 can run in parallel after Phase 2. Phase 8 can run in parallel with Phase 7.