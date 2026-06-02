# Tasks: Billing

## Foundation
- T001 [P] Add Invoice + InvoiceItem + Payment models to `prisma/schema.prisma`
- T002 [P] Migration: `npx prisma migrate dev --name add_billing`
- T003 [P] Types + Zod schemas in `src/types/invoice.ts`
- T004 [P] Invoice service in `src/services/billing/service.ts`
- T005 Create routes in `src/app/api/v1/invoices/` and `src/app/api/v1/payments/`
- T006 Unit tests in `tests/unit/billing/service.test.ts`

## US1: Generate Bill (P1)
- T007 Create invoice form in `src/components/billing/invoice-form.tsx`
- T008 Integration test: generate bill from session

## US2: Record Payment (P1)
- T009 Payment form in `src/components/billing/payment-form.tsx`
- T010 Integration test: record payment

## US3: Print Invoice (P1)
- T011 Print view in `src/app/(dashboard)/billing/invoices/[id]/print/page.tsx`
- T012 Integration test: print invoice

## Polish
- T013 E2E plan at `docs/testing/billing-e2e-plan.md`
- T014 Lint, type-check, tests, build