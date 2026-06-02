# Implementation Plan: 011-billing

**Branch**: `feat/011-billing` | **Date**: 2026-06-02 | **Spec**: specs/011-billing/spec.md

## Summary

Implement a billing module for PraktiQU that generates bills from completed sessions, supports Stripe-backed payment recording (with Elements for PCI SAQ-A), applies per-line and bill-level discounts with subtotal-overflow protection, supports partial payments and refunds, and produces invoice / receipt print views. Targets feature parity with the KiviCare plugin's `BillController` (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/BillController.php`) on the Next.js stack.

## Technical Context

- **Language/Version**: TypeScript (strict mode)
- **Primary Dependencies**: Next.js 14+ (App Router), Prisma, Zod, Stripe Node SDK, Vitest
- **Storage**: MySQL (PraktiQU's `praktiqu` schema) + Prisma ORM
- **Testing**: Vitest + `@vercel/agent-browser` for E2E
- **Target Platform**: Vercel (Next.js deployment)
- **Project Type**: Web application (backend API + frontend)
- **Performance Goals**: bill auto-generation within 5s of session CHECK_OUT; sub-second filter/paginate on 10k bills
- **Constraints**: Stripe-only payments in MVP; client-side PDF; per-clinic single-currency; discount cannot exceed subtotal
- **Scale/Scope**: one clinic per bill; up to 10k bills per clinic per year

## Constitution Check

- [x] **Design-Driven**: Print views follow Stitch clinic-dashboard patterns (header with clinic logo, two-column invoice layout).
- [x] **Trunk-Based**: Branch lifespan ≤ 3 days; PR; merge to main.
- [x] **Conventional Commits**: `<type>(billing):` scope.
- [x] **TDD**: All US1-US6 schedule failing tests before implementation.
- [x] **Full CI/CD**: lint, type-check, vitest, build, E2E plan.
- [x] **RFC 7807**: all errors.
- [x] **JWT Auth**: protected endpoints; RBAC per `docs/architecture/role-taxonomy.md`.
- [x] **Database-backed logging**: all state changes via `logging.audit()` (per C5 / `docs/architecture/logging.md`).

## Source Code Structure

```
src/app/api/v1/bills/
├── route.ts                       # GET (list) / POST (create)
├── [id]/
│   ├── route.ts                   # GET / PATCH / DELETE
│   ├── payments/
│   │   └── route.ts               # POST record payment
│   ├── refunds/
│   │   └── route.ts               # POST record refund
│   ├── void/
│   │   └── route.ts               # POST void bill
│   ├── invoice/
│   │   └── route.ts               # GET invoice print view (HTML)
│   └── receipt/
│       └── route.ts               # GET receipt print view (HTML)
└── ...

src/app/api/v1/webhooks/
└── stripe/
    └── route.ts                   # POST Stripe webhook receiver

src/services/
└── billing.ts                     # business logic
    ├── createBillFromSession()
    ├── createAdHocBill()
    ├── issueBill()
    ├── recordPayment()
    ├── recordRefund()
    ├── voidBill()
    ├── listBills()
    ├── getBill()
    └── generateInvoiceNumber()

src/lib/stripe.ts                  # Stripe SDK wrapper (Elements client + server SDK)
src/services/invoice-number.ts     # clinic-scoped sequence generator
src/services/billing-reports.ts    # aging buckets, totals

src/app/(dashboard)/billing/       # Frontend pages
├── page.tsx                       # List with filters
├── [id]/
│   ├── page.tsx                   # Bill detail
│   ├── print-invoice/page.tsx     # Print view
│   └── print-receipt/page.tsx     # Print view
└── new/page.tsx                   # Ad-hoc bill creation
```

## Data Model

Existing Prisma models in `prisma/schema.prisma` cover the core entities:

- `Bill` (lines 539-561)
- `BillItem` (lines 563-575)
- `Payment` (lines 578-588)
- `PaymentAppointmentMapping` (lines 591-601) — used to link Stripe payments to source sessions
- `Tax` (lines 604-612)

**Schema additions** required:

```prisma
// Add to Bill model:
paymentStatus    String  @default("unpaid")  // unpaid|partial|paid|refunded|disputed
paidAmount       Decimal @default(0) @db.Decimal(10,2)
balanceDue       Decimal @default(0) @db.Decimal(10,2)
voidedAt         DateTime?
voidedBy         String?
voidReason       String?  @db.Text
billNumber       String?  @unique  // INV-{clinicCode}-{YYYY}-{NNNNN}
disputedAt       DateTime?
disputeReason    String?  @db.Text

// Add to BillItem model:
type             String   @default("SERVICE")  // SERVICE|DISCOUNT|OTHER
sortOrder        Int      @default(0)

// Add to Payment model:
refundedPaymentId  String?  // self-ref for refund linking
metadata          Json?    // Stripe raw event, idempotency key, etc.
```

Plus add `Clinic.code: String? @unique` for the invoice-number prefix.

## API Endpoints

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/api/v1/bills` | List with filters | SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST |
| POST | `/api/v1/bills` | Create ad-hoc bill | SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST |
| GET | `/api/v1/bills/{id}` | Get bill | per role scoping |
| PATCH | `/api/v1/bills/{id}` | Update draft bill | CLINIC_ADMIN, RECEPTIONIST |
| POST | `/api/v1/bills/{id}/payments` | Record payment | CLINIC_ADMIN, RECEPTIONIST |
| POST | `/api/v1/bills/{id}/refunds` | Record refund | CLINIC_ADMIN |
| POST | `/api/v1/bills/{id}/void` | Void bill | CLINIC_ADMIN |
| GET | `/api/v1/bills/{id}/invoice` | Invoice print view | per role scoping |
| GET | `/api/v1/bills/{id}/receipt` | Receipt print view | per role scoping |
| POST | `/api/v1/webhooks/stripe` | Stripe webhook receiver | (public, signed) |

## Implementation Phases

See `tasks.md` for the task breakdown. Phases:

1. **Phase 1 — Data model + invoice number generator**: schema migration, `invoice-number.ts`
2. **Phase 2 — Bill create / read / update**: REST endpoints, RBAC
3. **Phase 3 — Auto-generation from session**: hook into 005-session-mgmt CHECK_OUT transition
4. **Phase 4 — Stripe integration**: SDK wrapper, payment create intent, webhook receiver
5. **Phase 5 — Refund + void**: edge cases, audit logging
6. **Phase 6 — Frontend (list / detail / new)**: Stitch-based UI
7. **Phase 7 — Print views**: invoice and receipt HTML
8. **Phase 8 — Reports**: aging buckets, totals
9. **Phase 9 — Polish + E2E**: security review, full test pass

## Dependencies

- **Auth (001)**: required for JWT, RBAC, `logging.audit()`
- **Sessions (005)**: required for auto-bill generation trigger
- **C8 (job runner)**: required for auto-completion-driven bill creation (fallback if reception forgets to check out)
- **Stripe account**: required for payment processing (test mode for development)
- **FR-08 (invoices are scoped to practice)**: depends on `Clinic.id` + `User.clinicId` mapping

## Risk Register

- **R-1**: Concurrent payment recording on the same bill (two receptionists). Mitigation: `SELECT ... FOR UPDATE` on Bill row; second attempt fails 409.
- **R-2**: Stripe webhook arrives before create-bill response. Mitigation: idempotency by `paymentIntentId`; webhook handler is `INSERT ... ON CONFLICT DO NOTHING`.
- **R-3**: Invoice number uniqueness under clinic creation / year boundary. Mitigation: `Bill.billNumber` is `@@unique`; sequence stored in `Clinic.billSequence` and `Clinic.billSequenceYear`, reset yearly.
- **R-4**: Tax miscalculation. Mitigation: `Bill.taxAmount` is explicit (set by receptionist or Stripe Tax integration), not computed; the API rejects negative tax.
- **R-5**: Print view rendering differs across browsers. Mitigation: use `@media print` CSS; E2E test prints to PDF in headless Chrome and validates dimensions.
