# Feature Specification: Public Booking Portal

**Feature Branch**: `007-public-booking`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Public Booking Portal - browse professionals, select service, choose date/time, register during booking, view confirmation, login existing account"

## Clarifications

### Session 2026-06-02

- Q: Is the booking wizard a multi-step flow or single page? → A: Multi-step wizard: Step 1 Professional → Step 2 Service → Step 3 Date/Time → Step 4 Client Info/Login → Step 5 Confirmation. URL reflects step state for bookmarking.
- Q: How are available slots shown? → A: Consumes the slot API from feature 002 (Professional Management) which generates slots from professional availability intersected with service duration. Only ACTIVE professionals and ACTIVE services appear.
- Q: Can an existing client log in during the wizard? → A: Yes. Step 4 shows "Already have an account? Login" link. Logging in pre-fills client info from their profile.
- Q: What happens if a slot becomes unavailable during the wizard? → A: The booking API uses atomic transaction with row-level locking. If slot is taken between step 3 (viewing) and step 4 (confirming), the API returns 409 and the user is prompted to select another slot.
- Q: Is the public booking page accessible without authentication? → A: Yes. All booking steps are public until the final confirmation. Only confirmed booking requires a client account.
- Q: How does inline registration work? → A: Step 4 collects minimal info: name, email, mobile. A WordPress account is provisioned, client record created, and booking proceeds automatically.
- Q: What timezone are displayed times in? → A: Practice timezone for display; stored in UTC. Client sees times in their browser locale or practice timezone.
- Q: Can visitors browse without selecting a professional? → A: No. PraktiQU requires selecting a professional first (Step 1). Service and slot availability depend on the professional.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse and Select Professional (Priority: P0)

A visitor needs to browse available professionals and select one to book with. Professionals are shown with their name, photo, specialties, and next available slot.

**Why this priority**: The wizard starts here. Without a professional selection, no subsequent steps are possible.

**Independent Test**: Can be tested by visiting the booking page and seeing a list of professionals with availability indicators. Selecting one advances to Step 2. Delivers the entry point of the booking flow.

**Acceptance Scenarios**:

1. **Given** a visitor navigates to the booking page, **When** the page loads, **Then** the system displays available professionals with their name, photo, type, specialties, and next available date.

2. **Given** a visitor filters professionals by specialty, **When** they apply a filter, **Then** only matching professionals are shown.

3. **Given** a visitor selects a professional, **When** they click "Continue", **Then** the wizard advances to Step 2 (Service Selection) with the professional pre-selected.

---

### User Story 2 - Select Service (Priority: P0)

A visitor has selected a professional and needs to choose a service type (e.g., Konseling Individual, Asesmen Psikologis) from that professional's offered services.

**Why this priority**: Service determines duration and price. Cannot proceed to slot selection without a service.

**Independent Test**: Can be tested by selecting a professional, seeing available services, selecting one, and advancing to Step 3. Delivers service selection.

**Acceptance Scenarios**:

1. **Given** a visitor is on Step 2 with a professional selected, **When** the page loads, **Then** the system displays the services offered by that professional with name, description, duration, and price.

2. **Given** a visitor selects a service, **When** they click "Continue", **Then** the wizard advances to Step 3 (Date/Time) with the service pre-selected.

---

### User Story 3 - Choose Date and Time (Priority: P0)

A visitor has selected a professional and service and needs to pick an available date and time slot. Slots are generated based on professional availability and service duration.

**Why this priority**: Slot selection is the core value moment — choosing when to meet. Cannot complete booking without a slot.

**Independent Test**: Can be tested by selecting a date on the calendar and seeing available slots, selecting one, and advancing to Step 4. Delivers slot selection.

**Acceptance Scenarios**:

1. **Given** a visitor is on Step 3 with professional and service selected, **When** they pick a date, **Then** the system displays available time slots for that date based on the professional's availability intersected with the service duration.

2. **Given** a visitor selects a time slot, **When** they click "Continue", **Then** the wizard advances to Step 4 (Client Info/Login) with the slot reserved temporarily (15-minute hold).

3. **Given** a visitor takes more than 15 minutes to complete Step 4, **When** they submit, **Then** the system warns that the slot may no longer be available and prompts them to re-select.

---

### User Story 4 - Client Login or Register (Priority: P1)

A visitor with an existing account logs in, or a new visitor registers inline during the booking flow. Existing clients can pre-fill their info; new visitors create an account as part of booking.

**Why this priority**: Booking confirmation requires a client account. Self-registration during booking reduces friction.

**Independent Test**: Can be tested by registering inline during booking and verifying the account is created and linked to the booking. Delivers account creation during booking.

**Acceptance Scenarios**:

1. **Given** a new visitor enters their info (name, email, mobile) on Step 4, **When** they submit, **Then** the system creates a WordPress account, creates a client profile, and proceeds to confirmation.

2. **Given** an existing client clicks "Login" on Step 4, **When** they authenticate, **Then** the system pre-fills their profile info and proceeds to confirmation.

3. **Given** a visitor with an INACTIVE account tries to log in during booking, **When** they authenticate, **Then** the system shows "Account inactive — please contact the practice" and does not pre-fill or proceed.

---

### User Story 5 - View Booking Confirmation (Priority: P0)

A visitor has completed the booking and sees a clear confirmation with session details, next steps, and a summary of what to expect.

**Why this priority**: Confirmation provides closure and sets expectations. Without it, the user doesn't know if the booking succeeded.

**Independent Test**: Can be tested by completing the wizard and seeing a confirmation page with booking details, professional info, and what to bring. Delivers confirmed booking.

**Acceptance Scenarios**:

1. **Given** a visitor has submitted their booking, **When** the system processes the PENDING session, **Then** the confirmation page displays: session date/time, professional name, service, location/practica address, what to bring, and a "Add to Calendar" option.

2. **Given** a visitor completes booking as a new client, **When** confirmation shows, **Then** the system also shows their new account credentials (email/temp password) and prompts them to set a permanent password.

3. **Given** a visitor completes booking, **When** confirmation loads, **Then** the system sends a confirmation email to the client with all booking details.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a multi-step booking wizard with URL reflecting step state (e.g., `/book/professional/:id/service/:id`).
- **FR-002**: System MUST list ACTIVE professionals with name, photo, type, specialties, and next available slot date on Step 1.
- **FR-003**: System MUST filter professionals by specialty on Step 1.
- **FR-004**: System MUST display available services for the selected professional on Step 2 with name, description, duration, and price.
- **FR-005**: System MUST display available time slots for the selected professional and service on Step 3 using the slot generation API from feature 002.
- **FR-006**: System MUST reserve the selected slot for 15 minutes during Step 4 completion. If not confirmed within 15 minutes, the slot hold expires and the user is prompted to re-select.
- **FR-007**: System MUST create a PENDING session booking when the visitor confirms on Step 4.
- **FR-008**: System MUST allow existing clients to log in during Step 4 and pre-fill their profile info.
- **FR-009**: System MUST allow new visitors to register inline on Step 4 (name, email, mobile, password) creating both WordPress account and client profile.
- **FR-010**: System MUST reject login attempts for INACTIVE client accounts with a clear message.
- **FR-011**: System MUST send a booking confirmation email to the client after successful booking.
- **FR-012**: System MUST display the booking confirmation page with session details, professional info, service, date/time, and "Add to Calendar" option.
- **FR-013**: System MUST display the booking as PENDING in the client's dashboard awaiting professional approval.
- **FR-014**: System MUST prevent double-booking using atomic transaction with row-level locking at the booking confirmation step.
- **FR-015**: System MUST display a clear error when the selected slot is no longer available (expired hold or concurrent booking).

### Key Entities *(include if feature involves data)*

- **Professional**: From feature 002. Attributes referenced: id, fullName, photo, professionalType, specialties, status, practiceId.
- **Service**: From feature 003. Attributes referenced: id, name, description, durationMinutes, price, status.
- **Client**: From feature 004. Attributes referenced: id, fullName, email, mobileNumber, status.
- **Session**: From feature 005. Created by this feature. Attributes: clientId, professionalId, serviceId, slotDate, startTime, status = PENDING.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Visitor can complete a booking in under 5 minutes from Step 1 to confirmation.
- **SC-002**: Available slots display within 2 seconds of date selection.
- **SC-003**: Booking confirmation email sent within 30 seconds of successful booking.
- **SC-004**: Slot hold expires correctly after 15 minutes of inactivity.
- **SC-005**: Double-booking is prevented atomically — concurrent attempts for the same slot result in only one successful booking.

## Assumptions

- The wizard is public (no authentication required) until Step 4 confirmation. Only confirmed bookings require a client account.
- Slot generation is handled entirely by the slot API from feature 002. This feature consumes the slot API and posts to the session booking API.
- Practice address/location display is read from the practice entity (feature 013). Until feature 013, show a placeholder address.
- Email sending is handled by feature 012 (Notifications). Until feature 012, confirmation email is logged but not sent.
- "Add to Calendar" generates an .ics file download or Google Calendar link.