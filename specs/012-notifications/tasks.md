# Tasks: Notifications

## Foundation
- T001 [P] Add NotificationTemplate + NotificationLog models to `prisma/schema.prisma`
- T002 [P] Migration: `npx prisma migrate dev --name add_notifications`
- T003 [P] Types + Zod schemas in `src/types/notification.ts`
- T004 [P] Notification service in `src/services/notifications/service.ts`
- T005 Email sending service in `src/services/notifications/email.service.ts`
- T006 Unit tests in `tests/unit/notifications/service.test.ts`

## US1: Email Templates (P1)
- T007 Template editor in `src/components/notifications/template-editor.tsx`
- T008 Integration test: create template

## US2: Send Notification (P1)
- T009 Send trigger in `src/services/notifications/trigger.ts`
- T010 Integration test: send notification

## Polish
- T011 E2E plan at `docs/testing/notifications-e2e-plan.md`
- T012 Lint, type-check, tests, build