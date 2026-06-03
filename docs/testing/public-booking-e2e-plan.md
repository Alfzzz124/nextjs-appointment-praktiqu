# E2E Test Plan: Public Booking

## Scope
End-to-end validation of the public booking wizard from landing page through confirmation.

## Pre-conditions
- App running at http://localhost:3000
- At least one ACTIVE professional with availability in DB
- At least one ACTIVE service in DB

## Scenarios

### S1: Landing page (/)
- Hero with CTA
- "Cara Booking" section shows 5 steps
- "Booking Sekarang" button → /book

### S2: Wizard Step 1 (/)
- /book shows list of professionals
- Specialty filter chips
- Clicking a card navigates to /book/[professionalId]/service

### S3: Wizard Step 2 (/book/[professionalId]/service)
- Lists services offered by the professional
- Clicking a service card navigates to /book/[professionalId]/[serviceId]

### S4: Wizard Step 3 (/book/[professionalId]/[serviceId])
- Date strip (next 14 days)
- Slot grid updates by date
- Selecting a slot enables "Lanjut" button
- Clicking creates hold and navigates to /confirm

### S5: Wizard Step 4 (confirm)
- Form with name, email, mobile, notes
- 15-min countdown banner
- Hold expiry warning at <5 min
- Submission creates PENDING appointment; on success → /confirmation
- 409: slot taken — show error
- 410: hold expired — show error
- 403: account inactive — show error

### S6: Wizard Step 5 (confirmation)
- Status badge PENDING
- Booking ID displayed
- "Add to Calendar" downloads .ics
- "Google Calendar" link opens prefilled event
- "Apa selanjutnya?" informational section

## Negative cases
- Empty required field → form validation
- Invalid email → form validation
- Hold expired before submit → 410 + redirect
- Concurrent booking on same slot → 409
- Account inactive → 403

## CI integration
Use Playwright in headless mode. Capture screenshots at each step. Assert key DOM nodes and URL transitions.