# Plan: Notifications

Stack: TypeScript, Next.js 14+, MySQL, Prisma, email provider (SMTP/SendGrid/etc), Vitest

## Models

```prisma
model NotificationTemplate { id, practiceId, name, subject, body, variables }
model NotificationLog { id, recipientId, templateId, sentAt, status }
```

## Routes

```
GET /api/v1/notification-templates
POST /api/v1/notification-templates
PATCH /api/v1/notification-templates/:id
POST /api/v1/notifications/send
```

## Constitution

- [x] Design-Driven, [x] TDD, [x] Audit logging