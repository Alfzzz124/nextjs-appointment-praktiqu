# Design: KiviCare Full API Port (Slices 2–8 + Complete In-Progress)

**Date:** 2026-07-01  
**Status:** Approved  
**Scope:** All KiviCare REST endpoints except `settings` (98 endpoints deferred)  
**Total:** ~163 endpoints across 8 slices

---

## Background

PraktiQU wraps the KiviCare WordPress plugin via a Next.js API layer. The billing + taxes slice (PR #2, merged) proved the pattern. This design covers the remaining endpoint groups, ported in priority order.

Gap baseline: 361 KiviCare endpoints total, ~100 implemented (27.7%), ~261 remaining. After excluding settings (98), ~163 remain to port.

---

## Slice Inventory

| # | Slice | Endpoints | Branch |
|---|-------|-----------|--------|
| 1 | Complete in-progress | ~48 | `feat/kc-complete-in-progress` |
| 2 | Public booking | ~12 | `feat/kc-public-booking` |
| 3 | Encounters | ~9 | `feat/kc-encounters` |
| 4 | Prescriptions + Medical History | ~13 | `feat/kc-prescriptions-medical-history` |
| 5 | Patient Medical Reports | ~9 | `feat/kc-patient-medical-reports` |
| 6 | Receptionists + Doctor Sessions | ~19 | `feat/kc-receptionists-doctor-sessions` |
| 7 | Clinic Schedules + Dashboard | ~12 | `feat/kc-schedules-dashboard` |
| 8 | Pro + GDPR + Rating + Import | ~41 | `feat/kc-advanced` |

Each slice: one plan file → one branch → one PR → merge to main.

---

## Slice 1: Complete In-Progress (~48 endpoints)

Extends existing modules with missing bulk/export/credential/auth endpoints.

### Professionals (`/api/v1/professionals`)
- `POST /professionals/bulk/delete` — bulk delete by ids
- `POST /professionals/bulk/status` — bulk toggle status
- `POST /professionals/bulk/resend-credentials` — bulk email credentials
- `GET  /professionals/export` — export list as JSON
- `POST /professionals/{id}/resend-credentials` — single resend

### Sessions (`/api/v1/sessions`)
- `POST /sessions/bulk/delete`
- `GET  /sessions/export`
- `GET  /sessions/{id}/print-invoice` — HTML invoice print view
- `GET  /sessions/{id}/summary` — appointment summary
- `GET  /sessions/{id}/view` — public-safe appointment view
- `POST /sessions/payment-cancel` — payment cancelled webhook
- `POST /sessions/payment-success` — payment success webhook
- `POST /sessions/payment-verify` — verify payment status
- `POST /sessions/payment-webhook` — generic payment gateway webhook
- `POST /sessions/{id}/regenerate-video-conference` — regenerate video link

### Practices (`/api/v1/practices`)
- `POST /practices/bulk/delete`
- `POST /practices/bulk/status`
- `POST /practices/bulk/resend-credentials`
- `GET  /practices/export`
- `POST /practices/{id}/resend-credentials`
- `GET  /practices/{id}/users` — list clinic staff
- `POST /practices/{id}/change-admin` — transfer admin role

### Clients (`/api/v1/clients`)
- `POST /clients/bulk/delete`
- `POST /clients/bulk/status`
- `POST /clients/bulk/resend-credentials`
- `GET  /clients/export`
- `POST /clients/{id}/resend-credentials`
- `GET  /clients/{id}/statistics` — patient stats

### Taxes (`/api/v1/taxes`)
- `POST /taxes/bulk/delete`
- `POST /taxes/bulk/status`
- `GET  /taxes/export`

### Auth (`/api/v1/auth`)
- `POST /auth/register` — create patient account
- `POST /auth/change-password`
- `POST /auth/reset-password`
- `POST /auth/delete-account`

### Consent Forms (`/api/v1/consent-forms`)
- `DELETE /consent-forms/{id}`
- `PATCH  /consent-forms/{id}/status`

### Custom Fields (`/api/v1/custom-fields`)
- `DELETE /custom-fields/{id}`
- `PATCH  /custom-fields/{id}/status`
- `POST   /custom-fields/{id}/save-data`
- `GET    /custom-fields/{id}/get-data`
- `POST   /custom-fields/file-upload`
- `POST   /custom-fields/import`

### Doctor Services (`/api/v1/professionals/{id}/services`)
- `POST /professionals/{id}/services/bulk/delete`
- `POST /professionals/{id}/services/bulk/status`
- `GET  /professionals/{id}/services/export`

---

## Slice 2: Public Booking (~12 endpoints)

Unauthenticated endpoints for the patient-facing booking widget.

### Routes (`/api/v1/public`)
- `GET  /public/professionals` — list bookable professionals (already partial)
- `GET  /public/professionals/{id}/slots` — available slots
- `GET  /public/professionals/{id}/services` — services offered
- `GET  /public/practices` — list bookable clinics
- `GET  /public/practices/{id}` — clinic info
- `POST /public/appointments` — create appointment (guest)
- `GET  /public/appointments/{token}` — check appointment by token
- `POST /public/appointments/{token}/cancel` — cancel by token
- `GET  /public/static-data` — currencies, countries, etc.
- `GET  /public/config` — booking widget config
- `POST /public/payment-verify` — verify payment post-redirect
- `GET  /public/rating/{id}` — fetch rating prompt

No JWT required. Rate-limit: 30 req/min per IP on write endpoints.

---

## Slice 3: Encounters (~9 endpoints)

Standalone encounter module (maps to `wp_kc_patient_encounters`). In billing slice, encounters were accessed read-only as FK targets. This slice adds full CRUD.

### Routes (`/api/v1/encounters`)
- `GET    /encounters` — list with filters (doctor, patient, clinic, status, date)
- `POST   /encounters` — create encounter
- `GET    /encounters/{id}` — get encounter detail
- `PUT    /encounters/{id}` — update encounter
- `DELETE /encounters/{id}` — delete
- `POST   /encounters/bulk/delete`
- `POST   /encounters/bulk/status`
- `GET    /encounters/export`
- `GET    /encounters/{id}/print` — HTML print view

---

## Slice 4: Prescriptions + Medical History (~13 endpoints)

### Prescriptions (`/api/v1/prescriptions`)
- `GET    /prescriptions` — list
- `POST   /prescriptions` — create
- `GET    /prescriptions/{id}`
- `PUT    /prescriptions/{id}`
- `DELETE /prescriptions/{id}`
- `GET    /prescriptions/export`
- `POST   /prescriptions/bulk/delete`

### Medical History (`/api/v1/medical-history`)
- `GET    /medical-history` — list (scoped by patient)
- `POST   /medical-history` — record
- `GET    /medical-history/{id}`
- `PUT    /medical-history/{id}`
- `DELETE /medical-history/{id}`
- `GET    /medical-history/export`

---

## Slice 5: Patient Medical Reports (~9 endpoints)

Document generation for patient records. Uses Puppeteer (server-side PDF) + Resend (email delivery), same pattern as `bill-document.service.ts`.

### Routes (`/api/v1/patient-medical-reports`)
- `GET    /patient-medical-reports` — list reports
- `POST   /patient-medical-reports` — generate report
- `GET    /patient-medical-reports/{id}`
- `DELETE /patient-medical-reports/{id}`
- `GET    /patient-medical-reports/{id}/preview` — HTML preview
- `GET    /patient-medical-reports/{id}/print` — PDF download (nodejs runtime)
- `POST   /patient-medical-reports/{id}/send-email` — email PDF
- `GET    /patient-medical-reports/export`
- `POST   /patient-medical-reports/bulk/delete`

---

## Slice 6: Receptionists + Doctor Sessions (~19 endpoints)

### Receptionists (`/api/v1/receptionists`)
- `GET    /receptionists` — list
- `POST   /receptionists` — create
- `GET    /receptionists/{id}`
- `PUT    /receptionists/{id}`
- `DELETE /receptionists/{id}`
- `POST   /receptionists/bulk/delete`
- `POST   /receptionists/bulk/status`
- `POST   /receptionists/bulk/resend-credentials`
- `GET    /receptionists/export`
- `POST   /receptionists/{id}/resend-credentials`

### Doctor Sessions (`/api/v1/doctor-sessions`)
Doctor schedule/availability blocks (not to be confused with patient sessions).
- `GET    /doctor-sessions` — list
- `POST   /doctor-sessions` — create block
- `GET    /doctor-sessions/{id}`
- `PUT    /doctor-sessions/{id}`
- `DELETE /doctor-sessions/{id}`
- `POST   /doctor-sessions/bulk/delete`
- `POST   /doctor-sessions/bulk/status`
- `GET    /doctor-sessions/export`
- `GET    /doctor-sessions/module` — get module config

---

## Slice 7: Clinic Schedules + Dashboard (~12 endpoints)

### Clinic Schedules (`/api/v1/clinic-schedules`)
- `GET    /clinic-schedules` — list active schedules
- `POST   /clinic-schedules` — create
- `GET    /clinic-schedules/{id}`
- `PUT    /clinic-schedules/{id}`
- `DELETE /clinic-schedules/{id}`
- `POST   /clinic-schedules/get-unavailable-schedule`
- `GET    /clinic-schedules/module`

### Dashboard (`/api/v1/dashboard`)
- `GET    /dashboard/statistics` — counts: patients, sessions, bills, revenue
- `GET    /dashboard/recent-payments` — last N payments
- `GET    /dashboard/top-professionals` — top by session count
- `GET    /dashboard/upcoming-sessions` — next N sessions
- `GET    /dashboard/revenue-chart` — revenue by period

---

## Slice 8: Pro + GDPR + Rating + Import (~41 endpoints)

### Pro Features (`/api/v1/pro`)
KiviCare Pro followups, advanced patient export, and other premium features. Exact endpoint list derived from `pro` tag in openapi.yaml at implementation time.

### GDPR (`/api/v1/gdpr`)
- `GET /gdpr/audit-log` — paginated audit log

### Rating (`/api/v1/rating`)
- `GET    /rating` — list ratings
- `POST   /rating` — submit rating
- `GET    /rating/{id}`
- `DELETE /rating/{id}`

### Import (`/api/v1/import`)
Bulk CSV/JSON import for: appointments, clinics, doctors, patients, prescriptions, services, taxes, encounters, medical-history. Returns job ID; processing is synchronous (no background jobs in MVP).

---

## Technical Conventions

### Response Envelope
All routes use `kcOk(data)` / `kcFail(msg, status)` / `kcHandle(fn)`. No direct `Response.json()`.

### Auth
```
JWT → KcActor → wpUserId (BigInt)
assertCan(actor, capability)  // throws 403 if missing
```
Public routes (Slice 2) skip `assertCan` entirely.

### Database Access
- `prisma.$queryRawUnsafe` only — no `prisma migrate`
- Amount columns stored as `varchar`, parsed with `toNum` / `toMoney`
- BigInt IDs (`wp_users.ID`) cast via `Number()` at boundary

### Bulk Operations
```ts
// Request shape (all bulk endpoints)
{ ids: number[] }

// Response shape
{ status: true, message: "...", data: { updated: N } }

// Implementation: transaction + parameterized WHERE IN
```

### Export Endpoints
- Return JSON array (not CSV)
- Same auth + scope rules as list endpoints
- Filename header: `Content-Disposition: attachment; filename="<entity>-export.json"`

### Capabilities Matrix

| Slice | Capabilities |
|-------|-------------|
| 1 | `professional_export`, `client_export`, `session_export`, `clinic_export` |
| 2 | none (public) |
| 3 | `encounter_read`, `encounter_manage` |
| 4 | `prescription_manage`, `medical_history_manage` |
| 5 | `patient_report_read`, `patient_report_manage` |
| 6 | `receptionist_manage`, `doctor_session_manage` |
| 7 | `schedule_manage`, `dashboard_read` |
| 8 | `pro_read`, `gdpr_read`, `rating_read`, `import_manage` |

New capabilities are added to `src/services/billing/kc-permissions.ts`.

### PDF + Email Routes
Slices 5+ that generate PDFs follow `bill-document.service.ts` pattern:
- `export const runtime = 'nodejs'` on route files
- Puppeteer in service layer
- `new Uint8Array(pdf)` for BodyInit compat
- `sendEmail` with base64 attachment via Resend

---

## Testing Strategy

Each slice:

1. **Service unit tests** — Vitest, hit real `wp_kc_*` tables, isolated fixture lifecycle. Encounter IDs in non-overlapping ranges per suite.
2. **Route integration tests** — envelope shape, auth matrix (401 no token / 403 wrong role), happy path.
3. All tests pass before PR merge. No mocking of the database.

Test file locations:
```
tests/<slice-name>/<entity>.service.test.ts
tests/<slice-name>/routes.integration.test.ts
```

---

## Deferred

- **Settings** (98 endpoints) — admin/system config, SMS gateways, Zoom, Google Meet, Google Calendar, WhatsApp. Deferred indefinitely.
- **Setup wizard** — one-time setup flow, not relevant post-install.
- **Static data** (public read-only lookups) — included in Slice 2 if needed by booking widget.

---

## Execution Order

1. Slice 1 → PR → merge → Slice 2 → PR → merge → ...
2. Each slice is independent; no cross-slice dependencies within slices 1–8.
3. Slice 4 (prescriptions) should complete before Slice 5 (medical reports) as reports reference prescriptions.
