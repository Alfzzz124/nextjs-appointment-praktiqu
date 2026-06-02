# Plan: Client Progress Tracking

Stack: TypeScript, Next.js 14+, Prisma, Vitest. Reads Sessions, Notes (008), Plans (009).

## Concept

Aggregated timeline per client. Read-only. No new entities.

## Routes

```
GET /api/v1/clients/:id/progress
```

## Constitution

- [x] Design-Driven, [x] TDD, [x] Audit logging