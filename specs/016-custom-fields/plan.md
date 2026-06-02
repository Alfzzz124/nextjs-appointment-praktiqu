# Plan: Custom Fields

Stack: TypeScript, Next.js 14+, Prisma, Vitest.

## Concept

Dynamic fields stored as JSON on existing entities. Field definitions in CustomField model.

## Models

```prisma
model CustomField { id, entityType, fieldName, fieldType, required }
model CustomFieldValue { id, entityId, fieldId, value }
```

## Constitution

- [x] Design-Driven, [x] TDD