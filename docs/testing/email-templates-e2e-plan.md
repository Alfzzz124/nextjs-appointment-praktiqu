# E2E Test Plan: Email Templates (018)

> **Scope**: End-to-end browser tests for the email template customization feature.
> **Tool**: Playwright (recommended) or `@vercel/agent-browser` (per 012 plan).
> **Run**: `npx playwright test --project=chromium --reporter=list`

## Overview

Email template customization allows clinic admins to:
- View the list of all templates
- Create a new template with key, name, description, subject, body (HTML + text), from-name, reply-to
- Edit an existing template
- Preview a template with sample variable values
- Delete a template

## Test Scenarios

### TS1 — Template list page (`/settings/email-templates`)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as CLINIC_ADMIN | Redirect to dashboard |
| 2 | Navigate to `/settings/email-templates` | Page loads, "New Template" button visible |
| 3 | Verify table or empty state shown | Empty state if no templates, table if any exist |
| 4 | Click "New Template" | Navigate to `/settings/email-templates/new` |
| 5 | Navigate back | Back to list |

### TS2 — Create a new template (`/settings/email-templates/new`)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to create page | Form rendered with all fields |
| 2 | Leave key blank and try to save | Validation error "Template key is required" |
| 3 | Fill key = `test-confirmation` | Key field updated |
| 4 | Fill name, subject, body HTML, body text | Fields updated |
| 5 | Add `client_name=Ada` in sample values | Preview updates |
| 6 | Click Preview | Right panel shows rendered subject + body |
| 7 | Click Save template | POST to `/api/v1/email-templates` |
| 8 | Verify success | Redirect to list; new template appears in table |
| 9 | Verify API called with `variables` auto-detected | List includes `client_name` |

### TS3 — Edit an existing template (`/settings/email-templates/:id`)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Click a template row in the list | Navigate to edit page |
| 2 | Verify form pre-filled with template data | Key locked, other fields editable |
| 3 | Change subject | Field updates |
| 4 | Click Preview | Right panel shows new rendered output |
| 5 | Change sample values `client_name=Ada&clinic_name=Main` | Preview updates |
| 6 | Click Save template | PATCH to `/api/v1/email-templates/:id` |
| 7 | Verify success | Redirect to list |

### TS4 — Preview with missing variables

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open template editor | Pre-filled with a template |
| 2 | Clear all sample values | Sample values area empty |
| 3 | Click Preview | Amber warning shows "Missing values for: client_name, clinic_name, ..." |
| 4 | Add `client_name=Ada` | Warning updates, only missing vars shown |

### TS5 — Preview with content overrides (Preview API)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open template editor | Template loaded |
| 2 | Add override subject `Custom Subject {{client_name}}` | Subject field updated |
| 3 | Add `client_name=Bob` in sample values | Preview shows "Custom Subject Bob" |

### TS6 — Delete template

| Step | Action | Expected |
|------|--------|----------|
| 1 | In the edit page, click "Delete" | Confirmation dialog shown |
| 2 | Confirm delete | DELETE to `/api/v1/email-templates/:id` |
| 3 | Verify success | Redirect to list; template no longer present |

### TS7 — Role enforcement

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as PROFESSIONAL (not admin) | — |
| 2 | Navigate to `/settings/email-templates` | 403 or redirect to home |
| 3 | Navigate directly to `/settings/email-templates/new` | 403 or redirect |

## API Contract Tests

### API1 — GET /api/v1/email-templates

- Returns `{ items: EmailTemplateDTO[] }`
- Optional `?includeInactive=true` query param

### API2 — POST /api/v1/email-templates

- 201 with created template on success
- 400 with `validation_error` on invalid payload
- 409 with `conflict` when key already exists

### API3 — GET /api/v1/email-templates/:id

- 200 with template DTO
- 404 with `not_found` when id not found

### API4 — PATCH /api/v1/email-templates/:id

- 200 with updated template
- 404 with `not_found`
- 400 with `validation_error`

### API5 — DELETE /api/v1/email-templates/:id

- 204 on success
- 404 with `not_found`

### API6 — POST /api/v1/email-templates/:id/preview

- 200 with `RenderedTemplate` shape
- `{ subject, bodyHtml, bodyText, fromName, replyTo, missingVariables }`
- 400 for invalid variable values

## Test Data Setup

```typescript
const TEMPLATE_DATA = {
  appointmentConfirmation: {
    key: 'appointment-confirmation',
    name: 'Appointment Confirmation',
    description: 'Sent to clients when an appointment is booked.',
    subject: 'Your appointment on {{appointment_date}} is confirmed',
    bodyHtml: '<p>Hi {{client_name}}, your session is on {{appointment_date}}.</p>',
    bodyText: 'Hi {{client_name}}, your session is on {{appointment_date}}.',
    fromName: 'PraktiQU Clinic',
    replyTo: 'admin@praktiqu.example',
  },
};
```

## Edge Cases

| Case | Expected behavior |
|------|-------------------|
| Template with no placeholders | Preview renders unchanged; no missing variables |
| Template with unknown variable in body | `{{unknown_var}}` stays literal; listed in missingVariables |
| Two templates with same key | API returns 409; UI shows "key already exists" error |
| Very long subject / body | Truncated or validated at 50,000 chars |
| Invalid reply-to email | Validation error; save blocked |
| Empty HTML + empty text body | Validation error; save blocked |
| Missing fromName / replyTo | Stored as null; email uses default sender |

## Playwright Setup (example)

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    storageState: '.playwright/.auth/admin.json',
  },
});
```

```typescript
// tests/e2e/email-templates.spec.ts
import { test, expect } from '@playwright/test';

test('admin can create and preview an email template', async ({ page }) => {
  await page.goto('/settings/email-templates/new');
  await page.fill('[name=key]', 'my-test-template');
  await page.fill('[name=subject]', 'Hello {{client_name}}');
  await page.fill('[name=bodyHtml]', '<p>Hello {{client_name}}</p>');
  await page.fill('[name=bodyText]', 'Hello {{client_name}}');
  await page.fill('[name=sample-values]', 'client_name=Ada');
  await page.click('button:has-text("Preview")');
  await expect(page.locator('.preview-subject')).toContainText('Hello Ada');
  await page.click('button:has-text("Save template")');
  await expect(page).toHaveURL('/settings/email-templates');
});
```