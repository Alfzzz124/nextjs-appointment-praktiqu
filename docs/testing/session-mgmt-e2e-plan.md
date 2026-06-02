# Session Management E2E Test Plan

**Feature**: 005-session-mgmt | **Date**: 2026-06-03
**Test Strategy**: Browser-based via @vercel/agent-browser (or equivalent)
**Test Plan Location**: `docs/testing/session-mgmt-e2e-plan.md`

---

## Scope

End-to-end flows covering:
1. Client booking → PENDING → professional approval → BOOKED
2. Staff direct booking → BOOKED (no PENDING)
3. Check-in / check-out lifecycle
4. Session cancellation
5. Calendar views

---

## Test Environment

- **App**: http://localhost:3000
- **Auth**: WordPress-sourced JWT tokens (via `x-user-id`, `x-user-role`, `x-practice-id` headers in dev)
- **Database**: MySQL test DB (migrated with `npx prisma migrate deploy`)
- **Browser**: Playwright (or @vercel/agent-browser for agent-native flow)

---

## E2E User Flows

### US1 — Client Books a Session

**Prerequisites**:
- ACTIVE client account (userId known)
- Professional with active Doctor record and availability
- Service with duration
- No existing booking for the slot

**Steps**:
1. Client logs in (client role token)
2. Navigates to `/book` (or equivalent from feature 006 public booking)
3. Selects professional → service → date → time slot
4. Submits booking form
5. Sees "Pending Approval" confirmation screen
6. Professional receives notification (email or in-app)

**Assertions**:
- Session exists in DB with status=PENDING
- `slotDate`, `startTime`, `endTime` (computed), `clientId`, `professionalId`, `serviceId` correct
- `createdBy` = client userId
- GET /sessions shows the session for the client

**Performance**: SC-001 — submission completes and PENDING shown within 10s

---

### US2 — Professional Approves a Session

**Prerequisites**:
- PENDING session exists (from US1)
- Professional logged in (professional role, owns the session)

**Steps**:
1. Professional logs in
2. Navigates to `/professional/sessions` or pending requests widget
3. Sees PENDING session in queue
4. Clicks "Approve"
5. Confirms action
6. Sees session in calendar with status BOOKED

**Assertions**:
- Session status → BOOKED
- client receives confirmation (email or notification)
- Session appears in GET /sessions/calendar for the professional

**Performance**: SC-002 — approval propagates to calendar within 5s

---

### US2b — Professional Rejects a Session

**Prerequisites**:
- PENDING session exists

**Steps**:
1. Professional clicks "Reject"
2. Enters rejection reason
3. Confirms
4. Session status → REJECTED

**Assertions**:
- Session status = REJECTED
- `rejectionReason` stored
- client notified

---

### US3 — Staff Books for Client (Direct BOOKED)

**Prerequisites**:
- Receptionist or Clinic Admin role
- Client (ACTIVE), professional, service, slot available

**Steps**:
1. Receptionist logs in
2. Navigates to `/admin/sessions`
3. Clicks "New Booking"
4. Fills in: client, professional, service, date, time
5. Submits
6. Sees "Booking Confirmed" with status BOOKED

**Assertions**:
- Session status = BOOKED (not PENDING)
- No approval required
- client receives confirmation

**Performance**: SC-003 — double-booking check returns 409 within 1s

---

### US4 — Check In and Check Out

**Prerequisites**:
- BOOKED session exists (from US3 or US2 approval)

**Steps (Check In)**:
1. Client arrives at reception
2. Receptionist views today's sessions in `/admin/sessions`
3. Finds the BOOKED session
4. Clicks "Check In"
5. Session status → CHECK_IN, `checkedInAt` set

**Assertions**:
- Status = CHECK_IN
- `checkedInAt` timestamp recorded

**Steps (Check Out)**:
1. Professional signals session complete
2. Receptionist clicks "Check Out" on CHECK_IN session
3. Session status → CHECK_OUT, `checkedOutAt` set

**Assertions**:
- Status = CHECK_OUT
- `checkedOutAt` timestamp recorded

**Performance**: SC-004 — status transitions reflect immediately in calendar

---

### US5 — Cancel a Session

**Prerequisites**:
- PENDING or BOOKED session exists

**Steps (Client cancels PENDING)**:
1. Client views upcoming sessions
2. Clicks "Cancel" on the session
3. Confirms (optional reason)
4. Status → CANCELLED

**Assertions**:
- Status = CANCELLED
- `cancellationReason` stored (if provided)
- Session removed from professional's calendar
- `createdBy` preserved

**Steps (Client tries to cancel CHECK_IN)**:
1. Client attempts to cancel a CHECK_IN session
2. System rejects with 400 "cannot cancel in-progress session"

**Assertions**:
- No DB change
- 400 error returned

---

### US6 — View Calendar

**Prerequisites**:
- Multiple sessions in various statuses

**Steps (Day view)**:
1. Receptionist navigates to `/admin/sessions`
2. Default view = today, day view
3. Sees sessions listed with time, client, service, status, professional
4. Status colors match spec

**Assertions**:
- Sessions from today appear
- Status colors match STATUS_COLOR map
- No double-booking violations shown

**Steps (Week view)**:
1. Switches to Week view via toggle
2. Sees sessions for the week grouped by day

**Assertions**:
- Sessions grouped correctly
- Multiple weeks render without lag

**Steps (Month view)**:
1. Switches to Month view
2. Sees sessions for the month

**Performance**: SC-006 — calendar renders 50 sessions within 2s

---

### US7 — View Session Details

**Prerequisites**:
- At least one session exists

**Steps**:
1. Click on any session in the calendar
2. Slide-over panel opens with full details

**Assertions**:
- Client name, contact, uniqueClientId shown
- Professional name and email shown
- Service name and duration shown
- slotDate, startTime, endTime shown
- Status with timestamp shown
- checkedInAt / checkedOutAt shown (if set)
- rejectionReason / cancellationReason shown (if set)

**Assertions (empty state)**:
- "Select a session to view details" shown when no session selected

---

### US8 — Filter Sessions

**Prerequisites**:
- Multiple sessions with varied statuses

**Steps**:
1. On `/admin/sessions`, click status filter "PENDING"
2. Only PENDING sessions shown
3. Apply date range filter "This Week"
4. Only sessions within the week shown
5. URL reflects filters (`?status=PENDING&dateFrom=...&dateTo=...`)

**Assertions**:
- Filter state persists in URL
- Only matching sessions shown
- Clear filter indicator visible

---

## Edge Cases

### Concurrent Booking (Double-Booking Prevention)

**Setup**: Two browser sessions for two clients.

**Steps**:
1. Client A books slot 09:00-10:00 → 201 PENDING
2. Client B books the same slot simultaneously
3. Second request returns 409 "Double-booking prevented"

**Assertions**:
- Only one session created
- Client B sees error and is prompted to choose another time

### PENDING Approval Race

**Setup**: Two PENDING sessions for the same slot (two clients).

**Steps**:
1. Professional approves session A → BOOKED
2. Professional approves session B → 409 (slot no longer available)

**Assertions**:
- Session A is BOOKED
- Session B returns 409 or the service detects the conflict

### Professional Off-Day Update → Auto-Cancel PENDING

**Setup**: PENDING session exists, professional marks off-day.

**Steps**:
1. Professional updates their off-day in `/professional/settings` (or admin)
2. System auto-cancels PENDING sessions on affected date
3. Client notified of cancellation

**Assertions**:
- PENDING session → CANCELLED
- `cancellationReason` = "Professional unavailable"
- AUDIT log entry with system=true

---

## Cross-Feature Coordination Tests

| Test | Coordinated Feature | What to Verify |
|------|---------------------|----------------|
| Client INACTIVE blocks booking | 004-client-mgmt | FR-008: 403 "Account inactive" |
| Session notes link to sessions | 008-session-notes | Notes only for CHECK_IN+ sessions |
| Billing linked to sessions | 011-billing | Billing created after CHECK_OUT |
| Slot generation respects existing sessions | 002-professional-mgmt | Confirmed sessions block slot generation |
| Auto-complete job runs hourly | Cron / WP AS | SC-007 compliance |

---

## Success Criteria

- SC-001: Booking submission < 10s
- SC-002: Approval propagation < 5s
- SC-003: Double-booking check < 1s
- SC-004: Status transitions reflect immediately
- SC-005: 100% of status transitions have AUDIT log entries
- SC-006: Calendar renders 50 sessions < 2s
- SC-007: Auto-completion completes sessions > 24h past check-out

---

## Test Execution

```bash
# Run all E2E tests
npx playwright test --project=chromium

# Run specific flow
npx playwright test --project=chromium --grep "Client Books"
```