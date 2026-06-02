# Feature Specification: Session Management

**Feature Branch**: `005-session-mgmt`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Session Management - book sessions with request-approval workflow (client books → PENDING → professional approves/rejects → BOOKED), calendar view, check-in/check-out client, session status lifecycle (PENDING/BOOKED/CHECK_IN/CHECK_OUT/COMPLETED/REJECTED/CANCELLED), cancel session, view session details, filter sessions, no double-booking enforcement, session duration from service"

## Clarifications

### Session 2026-06-02

- Q: What is the full session status lifecycle? → A: PENDING → BOOKED → CHECK_IN → CHECK_OUT → COMPLETED. PENDING → REJECTED (professional rejects). BOOKED/PENDING → CANCELLED (client or staff cancels). REJECTED and CANCELLED are terminal states. A CANCELLED session can be rescheduled into a new booking.
- Q: Who can approve a PENDING session? → A: The assigned professional (the psychologist who owns the booking request) or a Clinic Admin for their practice. A Receptionist cannot approve sessions.
- Q: How is double-booking prevented? → A: Slot generation (from feature 002) only returns available slots. When a session is created, the system checks for overlapping sessions for the same professional at the same time. A confirmed session (BOOKED/CHECK_IN/CHECK_OUT) blocks that time slot from being booked again.
- Q: How does session duration work? → A: Session duration is read from the assigned service's `durationMinutes` at session creation time. The session stores its own `startTime` and `endTime` calculated from the slot start time + service duration. If the service duration changes later, existing sessions retain their original times.
- Q: Can a professional see all their sessions or only assigned ones? → A: A professional sees sessions assigned to them. A Receptionist sees all sessions in their practice. A Clinic Admin sees all sessions in their practice. A Client sees their own sessions only.
- Q: What happens when a client is INACTIVE (from feature 004)? → A: The booking API rejects with 403 "Account inactive" error (FR-008 coordination).
- Q: Are holidays and professional off-days checked during booking? → A: Yes. Slot generation already excludes off-days and holidays. The booking API re-validates these constraints as a second-layer check before confirming.
- Q: What about session rescheduling? → A: Rescheduling cancels the existing session and creates a new one with a different slot. This is US-06.07 (P1). The implementation treats it as: CANCELLED existing → create new PENDING.
- Q: Is there a conflict if a client tries to book a slot that becomes unavailable between slot query and booking? → A: Yes. The booking API uses a database transaction with row-level locking to atomically check slot availability and create the session. If the slot is no longer available, the booking fails with a clear "Slot no longer available" error.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Client Books a Session (Priority: P1)

A Client needs to book a session by selecting a professional, service, date, and available time slot. The session goes into PENDING status and the assigned professional receives a notification.

**Why this priority**: Client self-service booking is the primary value proposition of the public portal. Without this, clients cannot independently request sessions.

**Independent Test**: Can be tested by a Client selecting a professional, service, date, and time slot, and submitting a booking request. The system creates a PENDING session and the client sees a "Pending Approval" confirmation. Delivers a session request ready for professional review.

**Acceptance Scenarios**:

1. **Given** a Client has an ACTIVE account, is authenticated, and has viewed available slots for a professional and service on a given date, **When** they select a slot and submit the booking, **Then** the system creates a PENDING session linked to the client, professional, and service; sends an approval notification to the professional; and displays a "Pending Approval" confirmation to the client.

2. **Given** a Client with an INACTIVE account attempts to book a session, **When** they submit the booking, **Then** the system rejects with 403 "Account inactive" and a message to contact the practice.

3. **Given** a Client attempts to book a slot that has become unavailable (e.g., another client booked it simultaneously), **When** they submit the booking, **Then** the system rejects with 409 "Slot no longer available" and prompts them to select another time.

4. **Given** a Client attempts to book during a holiday or professional off-day, **When** they select such a slot, **Then** the system rejects with a validation error "This time is not available".

---

### User Story 2 - Professional Approves/Rejects a Session Request (Priority: P1)

A Professional needs to approve or reject PENDING session requests from clients. Approved sessions become BOOKED and the client receives confirmation.

**Why this priority**: The approval workflow is a core business requirement (BR-05.04b). Without it, sessions remain unconfirmed and resources cannot be allocated.

**Independent Test**: Can be tested by a Professional viewing their pending requests, approving one, and verifying the status changes to BOOKED and the client receives confirmation. Delivers a confirmed booking.

**Acceptance Scenarios**:

1. **Given** a Professional is authenticated and viewing their pending session requests, **When** they approve a PENDING session, **Then** the system changes the status to BOOKED, logs an AUDIT event, sends a confirmation email to the client, and the professional sees the session in their upcoming calendar.

2. **Given** a Professional is viewing pending requests and rejects a PENDING session, **When** they provide a rejection reason and confirm, **Then** the system changes the status to REJECTED, logs an AUDIT event, and sends a rejection notification to the client.

3. **Given** a Clinic Admin views pending requests for their practice, **When** they approve a PENDING session on behalf of a professional, **Then** the system changes the status to BOOKED with the same notification flow as if the professional approved.

---

### User Story 3 - Staff Books a Session for a Client (Priority: P1)

A Receptionist or Clinic Admin needs to book a session on behalf of a client, selecting the client, professional, service, date, and time. This bypasses the client-facing flow and creates a BOOKED session directly.

**Why this priority**: Front-desk operations require staff to book on behalf of clients who call or walk in. This is a high-frequency operational workflow.

**Independent Test**: Can be tested by a Receptionist selecting a client, professional, service, date, and time, and submitting a booking. The system creates a BOOKED session directly (no PENDING state) and the client receives a confirmation. Delivers a directly booked session.

**Acceptance Scenarios**:

1. **Given** a Receptionist is authenticated and on the session booking form, **When** they select a client, professional, service, date, and available time, **Then** the system creates a BOOKED session (bypassing PENDING), sends confirmation to the client, and the professional sees the session in their calendar.

2. **Given** a Receptionist attempts to double-book a time slot that already has a confirmed session, **When** they submit the booking, **Then** the system rejects with 409 "Double-booking prevented" and shows the conflicting session.

---

### User Story 4 - Check In and Check Out a Client (Priority: P1)

A Receptionist needs to check in a client when they arrive and check out when the session ends. This updates the session status and enables session notes.

**Why this priority**: Check-in/check-out is the operational anchor for session flow. Without it, session status cannot progress to COMPLETED and session notes cannot be created.

**Independent Test**: Can be tested by a Receptionist checking in a BOOKED client, verifying status changes to CHECK_IN, then checking out, verifying status changes to CHECK_OUT. Delivers the operational session lifecycle.

**Acceptance Scenarios**:

1. **Given** a Receptionist is viewing today's sessions and a client arrives, **When** they click "Check In" on a BOOKED session, **Then** the system changes the status to CHECK_IN, logs the check-in time, and the session appears in the "In Progress" view.

2. **Given** a Receptionist is viewing the "In Progress" sessions and the professional signals the session is complete, **When** they click "Check Out" on a CHECK_IN session, **Then** the system changes the status to CHECK_OUT and logs the check-out time.

3. **Given** a Receptionist attempts to check in a session that is not in BOOKED status (e.g., already CHECKED_IN), **When** they click "Check In", **Then** the system shows an error indicating the session cannot be checked in from its current state.

---

### User Story 5 - Cancel a Session (Priority: P1)

A Client or Receptionist needs to cancel a session before it occurs. Cancellation ends the session lifecycle without completion.

**Why this priority**: Clients and staff need the ability to cancel for scheduling conflicts, illness, or other reasons. Cancellation is a common operational need.

**Independent Test**: Can be tested by a Client cancelling a PENDING session, verifying status changes to CANCELLED and the professional no longer sees it. Delivers session cancellation.

**Acceptance Scenarios**:

1. **Given** a Client views their upcoming sessions and wants to cancel, **When** they click "Cancel" and confirm, **Then** the system changes the status to CANCELLED, logs an AUDIT event with cancellation reason (optional), and notifies the professional.

2. **Given** a Receptionist cancels a BOOKED session on behalf of a client, **When** they click "Cancel", provide a reason, and confirm, **Then** the system changes the status to CANCELLED, logs an AUDIT event, and notifies the professional and client.

3. **Given** a Professional attempts to cancel a session that is already CHECKED_IN (in progress), **When** they click "Cancel", **Then** the system rejects with a message that in-progress sessions cannot be cancelled; they must wait for completion or use the "End Session" workflow.

---

### User Story 6 - View Calendar (Priority: P1)

A Staff member or Professional needs to view a calendar of sessions with day/week/month views, showing session status, client, and professional.

**Why this priority**: Calendar view is the primary operational interface for scheduling. All staff need visibility into the session schedule.

**Independent Test**: Can be tested by a Receptionist viewing today's calendar and seeing all sessions with their statuses, client names, and professional names. Delivers a usable scheduling calendar.

**Acceptance Scenarios**:

1. **Given** a Receptionist is on the calendar view, **When** they view "Today", **Then** the system displays all sessions for the practice on today's date with status colors, client names, and professional names.

2. **Given** a Professional is on the calendar view, **When** they view their schedule, **Then** the system displays only sessions assigned to them with client names and session statuses.

3. **Given** a Receptionist switches the calendar view from Day to Week, **When** they change the view, **Then** the system displays the selected week's sessions with the same level of detail.

---

### User Story 7 - View Session Details (Priority: P1)

A Staff member needs to view full session details including client info, professional info, service, date/time, status, and notes.

**Why this priority**: Session details are needed for quick reference during check-in, billing, and client communication.

**Independent Test**: Can be tested by clicking on a session in the calendar and seeing all session attributes displayed. Delivers session detail access.

**Acceptance Scenarios**:

1. **Given** a Receptionist clicks on a session in the calendar, **When** the detail panel opens, **Then** the system displays: client name + contact, professional name, service + duration, date/time, status with timestamp, and any session notes (if created).

---

### User Story 8 - Filter Sessions (Priority: P2)

A Staff member needs to filter the session list or calendar by status, date range, professional, client, or service.

**Why this priority**: Operational efficiency — staff need to quickly find sessions by various criteria for reporting, follow-up, and scheduling.

**Independent Test**: Can be tested by filtering sessions by PENDING status and verifying only pending requests appear. Delivers filtered session views.

**Acceptance Scenarios**:

1. **Given** a Receptionist filters sessions by status "PENDING", **When** they apply the filter, **Then** only sessions in PENDING status are shown with a clear filter indicator.

2. **Given** a Receptionist filters sessions by date range "This Week", **When** they apply the filter, **Then** only sessions within the current week are shown.

---

### Edge Cases

- What happens when a professional has two simultaneous PENDING requests for the same slot? → Both can exist in PENDING. The first to be approved wins; the second is rejected when approved with "Slot no longer available".
- What happens when a client cancels a session that has already been checked in? → Cancelled sessions must be BOOKED or PENDING. CHECK_IN/CHECK_OUT/COMPLETED sessions cannot be cancelled.
- What happens when the same client has overlapping sessions? → Double-booking prevention applies per professional, not per client. A client could theoretically have sessions with two different professionals at the same time (if the practice allows it).
- What happens when a session is REJECTED? → The slot becomes available again for other bookings. The client is notified and can re-book a different slot.
- What happens when a session is CANCELLED after approval notification was sent? → The cancellation notification supersedes the approval notification.
- What happens when professional off-day changes after slots were generated? → Existing PENDING sessions for that day should be invalidated (status → CANCELLED with reason "Professional unavailable"). This requires a check when off-day is updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Client to book a session by selecting: professional, service, date, and available time slot. Session is created in PENDING status. Client must be ACTIVE (FR-008 from feature 004).
- **FR-002**: System MUST prevent double-booking: a confirmed session (BOOKED, CHECK_IN, CHECK_OUT, COMPLETED) blocks that time slot for the same professional. PENDING sessions do not block.
- **FR-003**: System MUST allow a Professional or Clinic Admin to approve a PENDING session, changing status to BOOKED and sending confirmation to client.
- **FR-004**: System MUST allow a Professional or Clinic Admin to reject a PENDING session with a required reason, changing status to REJECTED and sending rejection notification to client.
- **FR-005**: System MUST allow a Receptionist or Clinic Admin to book a session for a client directly, creating a BOOKED session (bypassing PENDING) with confirmation sent to client.
- **FR-006**: System MUST allow a Receptionist to check in a BOOKED session, changing status to CHECK_IN and logging the check-in timestamp.
- **FR-007**: System MUST allow a Receptionist to check out a CHECK_IN session, changing status to CHECK_OUT and logging the check-out timestamp.
- **FR-008**: System MUST automatically complete a session 24 hours after the scheduled end time if it is still in CHECK_OUT status, changing status to COMPLETED.
- **FR-009**: System MUST allow a Client or Receptionist to cancel a PENDING or BOOKED session, changing status to CANCELLED with optional reason. CANCELLED sessions do not block future bookings.
- **FR-010**: System MUST validate that booked slots do not overlap with existing BOOKED, CHECK_IN, or CHECK_OUT sessions for the same professional. Use atomic transaction with row-level locking.
- **FR-011**: System MUST validate that booking respects professional off-days and practice holidays as a second-layer check (slot generation is the first layer).
- **FR-012**: System MUST allow viewing session calendar with day/week/month views, filtered by role (professional sees own sessions, receptionist sees practice sessions).
- **FR-013**: System MUST allow viewing session details including client, professional, service, date/time, status, and session notes (if created).
- **FR-014**: System MUST allow filtering session list/calendar by status, date range, professional, client, and service.
- **FR-015**: System MUST log all session status transitions as AUDIT events with actor, before/after status, and timestamp.
- **FR-016**: System MUST calculate session end time from start time + service durationMinutes at creation time and store both. Changes to service duration after session creation do not affect existing sessions.
- **FR-017**: System MUST reject booking attempts for slots where the professional has already confirmed a session (BOOKED, CHECK_IN, CHECK_OUT). Return 409 with "Double-booking prevented".

### Key Entities *(include if feature involves data)*

- **Session**: A booked session between a client and professional. Attributes: id, clientId, professionalId, serviceId, practiceId, slotDate (UTC), startTime (UTC), endTime (UTC), status, rejectionReason, checkedInAt, checkedOutAt, createdBy (Receptionist or Client), createdAt, updatedAt.
- **SessionStatus**: Enumeration. Values: PENDING (awaiting approval), BOOKED (confirmed), CHECK_IN (client arrived), CHECK_OUT (session ended), COMPLETED (auto-closed), REJECTED (professional rejected), CANCELLED (cancelled before start).
- **Service**: The bookable service (foreign key reference from feature 003). Attributes referenced: id, name, durationMinutes, practiceId.
- **Client**: The client booking the session (foreign key reference from feature 004). Attributes referenced: id, fullName, email, status.
- **Professional**: The professional delivering the session (foreign key reference from feature 002). Attributes referenced: id, fullName.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Client can complete a booking submission and see a PENDING confirmation within 10 seconds.
- **SC-002**: A Professional can approve a session and see it in their calendar within 5 seconds of approval.
- **SC-003**: Double-booking prevention returns 409 within 1 second when a slot is already taken.
- **SC-004**: Session status transitions (check-in, check-out, cancel) take effect immediately in the calendar view.
- **SC-005**: 100% of session status transitions are recorded as AUDIT events.
- **SC-006**: Calendar view renders 50 sessions within 2 seconds on a typical device.
- **SC-007**: Sessions auto-complete within 24 hours of their scheduled end time without manual intervention.

## Assumptions

- Session duration is copied from the service at booking time and stored on the session record. This ensures historical sessions retain their original duration even if the service is later updated.
- Professional off-day updates trigger invalidation of PENDING sessions on affected dates — this is implemented as a reactive check when off-day is saved, not a scheduled job.
- Calendar view uses client-side filtering for the current view; full dataset filtering uses server-side pagination.
- The public booking portal (feature 006) consumes the slot API from feature 002 and posts to the session booking API defined here.
- Session notes (feature 008) are linked to sessions; session notes can only be created for sessions in CHECK_IN or CHECK_OUT status.
- Billing (feature 011) is linked to sessions; billing is created after CHECK_OUT or COMPLETED status.
- Auto-completion (FR-008) runs as a background job that checks sessions every hour; sessions reaching 24 hours past endTime in CHECK_OUT status are set to COMPLETED.