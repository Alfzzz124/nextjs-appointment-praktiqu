# Plan: Informed Consent

Stack: TypeScript, Next.js 14+, Prisma, MySQL, NextAuth v5, Vitest

## Models

```prisma
model ConsentForm { id, practiceId, name, content, status, createdAt }
model ConsentSignature { id, formId, clientId, signedAt, ipAddress }
```

## Routes

```
GET /api/v1/consent-forms
POST /api/v1/consent-forms
GET /api/v1/consent-forms/:id
PATCH /api/v1/consent-forms/:id
POST /api/v1/consent-signatures
```

## Constitution

- [x] Design-Driven, [x] TDD, [x] Audit logging