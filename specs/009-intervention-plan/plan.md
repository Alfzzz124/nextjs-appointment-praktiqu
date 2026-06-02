# Plan: Intervention Plan

**Stack**: TypeScript, Next.js 14+, Prisma, MySQL, NextAuth, Vitest

## Data Model

```prisma
model InterventionPlan {
  id             String @id @default(cuid())
  sessionId      String @unique
  professionalId  String
  clientId       String
  status         PlanStatus @default(ACTIVE)
  createdAt      DateTime @default(now())
  items          RecommendationItem[]
}

model RecommendationItem {
  id                String @id @default(cuid())
  interventionPlanId String
  description        String @db.Text
  frequency          String?
  durationDays       Int?
  instructions       String? @db.Text
  status             ItemStatus @default(ACTIVE)
  completedAt         DateTime?
  createdAt           DateTime @default(now())
}

enum PlanStatus { ACTIVE COMPLETED }
enum ItemStatus { ACTIVE COMPLETED }
```

## API

```
GET  /api/v1/intervention-plans                    # list by professional/client
POST /api/v1/intervention-plans                  # create plan
GET  /api/v1/intervention-plans/:id             # read plan
PATCH /api/v1/intervention-plans/:id/items/:itemId # mark COMPLETED
```

## Constitution

- [x] Design-Driven, Trunk-Based, TDD, CI/CD, Audit Logging, API Standards, RFC 7807, JWT auth