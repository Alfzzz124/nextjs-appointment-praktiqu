# Plan: Email Template Customization

Stack: Type.js 14+, Vitest. Extends Notifications (012).

## Concept

Template editor for notification templates. Variable substitution rendering. Read from 012 models.

## Routes

```
GET /api/v1/notification-templates
PATCH /api/v1/notification-templates/:id
POST /api/v1/notification-templates/:id/preview
```

## Constitution

- [x] Design-Driven, [x] TDD