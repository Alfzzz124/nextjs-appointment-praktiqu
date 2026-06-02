# Plan: Notes Templates

Stack: TypeScript, Next.js 14+, Prisma, Vitest.

## Models

```prisma
model NotesTemplate { id, practiceId, serviceType, name, structure }
```

## Routes

```
GET /api/v1/notes-templates
POST /api/v1/notes-templates
```

## Constitution

- [x] Design-Driven, [x] TDD