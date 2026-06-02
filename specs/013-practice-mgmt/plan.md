# Plan: Practice Management

Stack: TypeScript, Next.js 14+, Prisma, MySQL, NextAuth v5, Vitest

## Models

```prisma
model Practice { id, name, timezone, address, logoUrl, status }
model Holiday { id, practiceId, date, name }
```

## Routes

```
GET /api/v1/practices
PATCH /api/v1/practices/:id
GET/POST/DELETE /api/v1/practices/:id/holidays
```

## Constitution

- [x] Design-Driven, [x] TDD, [x] Audit logging