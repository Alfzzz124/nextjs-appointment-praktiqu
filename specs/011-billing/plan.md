# Plan: Billing

Stack: TypeScript, Next.js 14+, Prisma, MySQL, Vitest

## Models

```prisma
model Invoice { id, clientId, status, total, createdAt }
model InvoiceItem { id, invoiceId, description, amount }
model Payment { id, invoiceId, amount, method, paidAt }
```

## Routes

```
POST /api/v1/invoices
GET /api/v1/invoices
PATCH /api/v1/invoices/:id
POST /api/v1/invoices/:id/payments
```

## Constitution

- [x] Design-Driven, [x] TDD, [x] Audit logging