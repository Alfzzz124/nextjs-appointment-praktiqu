# Feature Specification: Client Management

**Feature Branch**: `004-client-mgmt`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Client Management - register clients, unique ID generation, demographics/contact info, client list with pagination and search, session history view, client status management, client self-registration, client progress tracking"

## Clarifications

### Session 2026-06-02

- Q: How is the client unique ID generated? → A: The system generates a human-readable unique ID (e.g., "CLT-2026-00001") auto-incremented per practice. Format: "CLT-{year}-{sequential number}", reset per year per practice. This enables easy lookup without exposing internal database IDs.
- Q: How does client registration link to the WordPress user account? → A: A Client entity links one-to-one to a WordPress user account (similar to Professional in feature 002). The client-specific attributes (unique ID, demographics, contact info, status) live in the client profile table. Clients can self-register via the public portal (feature 006) or be added by staff.
- Q: What demographics are required? → A: Required: full name, email, mobile number, date of birth, gender. Optional: address, emergency contact, notes. Gender is a closed set: MALE, FEMALE, OTHER. Date of birth used for age calculation and session planning.
- Q: How does client progress tracking work? → A: Professional tracks client progress via session notes (feature 008). The client progress view aggregates session history, completed session notes, and intervention plans into a single timeline per client. This is a read-only dashboard view, not a separate tracking system.
- Q: Can a client belong to multiple practices? → A: One client belongs to exactly one practice in this version. This mirrors the professional-practice relationship. Cross-practice clients are deferred.
- Q: What is the client status lifecycle? → A: ClientStatus: ACTIVE (can book), INACTIVE (paused/departed), ARCHIVED (left practice). Only ACTIVE clients can initiate new bookings. Staff can archive a client to remove from active lists while preserving history.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a Client via Staff (Priority: P1)

A Receptionist or Clinic Admin needs to register a new client on behalf of the client, entering their demographics and contact information. The system generates a unique client ID.

**Why this priority**: New clients must be registered before they can book sessions or appear in the system. Staff registration is the primary onboarding path for clients who walk in or are referred.

**Independent Test**: Can be tested by a Receptionist submitting the client registration form with all required fields and verifying a new client record is created with a generated unique ID. Delivers a registered client ready for booking.

**Acceptance Scenarios**:

1. **Given** a Receptionist is authenticated and on the Clients list, **When** they submit a valid registration form with full name, email, mobile number, date of birth, and gender, **Then** a new client record is created with ACTIVE status, a unique client ID (e.g., "CLT-2026-00001"), and linked WordPress user account, and the client appears in the list immediately.

2. **Given** a Receptionist submits a registration form with an email that already exists in the system, **When** the form is submitted, **Then** the system rejects with a clear validation error and does not create a duplicate.

3. **Given** a Receptionist submits a registration form without a required field (e.g., mobile number), **When** the form is submitted, **Then** the system rejects with field-level validation errors.

4. **Given** a Receptionist submits a registration form with an invalid date of birth (e.g., future date), **When** the form is submitted, **Then** the system rejects with a validation error.

---

### User Story 2 - Complete Client Profile (Priority: P1)

A Client needs to view and update their own profile: contact information, address, emergency contact, and personal notes. Staff-added clients can complete their profile via the self-service portal.

**Why this priority**: Clients manage their own contact and demographic data. Incomplete profiles cause booking failures and communication issues.

**Independent Test**: Can be tested by a Client updating their mobile number and address, saving, and reloading to confirm changes. Delivers self-service profile management.

**Acceptance Scenarios**:

1. **Given** a Client is authenticated and opens their profile, **When** the page loads, **Then** the system displays all profile fields: unique ID (read-only), full name, email (read-only), mobile number, date of birth (read-only), gender (read-only), address, emergency contact, notes.

2. **Given** a Client updates their mobile number and address, **When** they save, **Then** the system persists the changes, logs an AUDIT event, and confirms the update.

3. **Given** a Client attempts to edit a read-only field (e.g., date of birth or gender), **When** the form is rendered, **Then** those fields are read-only with a note that changes require staff assistance.

---

### User Story 3 - List and Search Clients (Priority: P1)

A Staff member (Receptionist, Clinic Admin) needs to browse and search the client roster within their practice. Search by name or mobile number enables quick lookup.

**Why this priority**: Client lookup is a high-frequency operation. Receptionists need to find clients quickly during check-in, booking, and billing.

**Independent Test**: Can be tested by listing clients with pagination, searching by name, and filtering by status. Delivers a searchable client directory.

**Acceptance Scenarios**:

1. **Given** a Receptionist opens the Clients list, **When** the page loads, **Then** the system displays clients with their unique ID, name, mobile number, status, and session count, with pagination.

2. **Given** a Receptionist searches for "Ahmad" in the client search, **When** they submit, **Then** clients with "Ahmad" in their name are returned (case-insensitive), and the search is reflected in the URL.

3. **Given** a Receptionist searches by mobile number "0812", **When** they submit, **Then** clients with mobile numbers starting with "0812" are returned.

---

### User Story 4 - View Client Details and Session History (Priority: P2)

A Professional or Receptionist needs to view a client's full profile and session history to prepare for sessions or handle client inquiries.

**Why this priority**: Professionals need context before each session. Receptionists need session history for billing and communication.

**Independent Test**: Can be tested by viewing a client detail page and verifying: full profile data, session history with dates and statuses, and total session count. Delivers client context for staff.

**Acceptance Scenarios**:

1. **Given** a Professional opens a client's detail page, **When** the page loads, **Then** the system displays: full profile, unique client ID, session history timeline (most recent first), completed session count, and next upcoming session (if any).

2. **Given** a Professional views session history, **When** they click on a past session, **Then** the session detail opens (service, professional, date, status).

3. **Given** a Receptionist views a client with no sessions, **When** the detail page loads, **Then** it displays "No sessions yet" with a prompt to book the first session.

---

### User Story 5 - Manage Client Status (Priority: P2)

A Clinic Admin needs to deactivate or archive a client. Deactivation pauses the client's ability to book; archiving removes from active lists while preserving records.

**Why this priority**: Client lifecycle management is required for GDPR compliance (right to erasure → archive), practice hygiene (departed clients), and access control (paused accounts).

**Independent Test**: Can be tested by deactivating an ACTIVE client and verifying they cannot initiate new bookings while existing pending sessions remain. Delivers client lifecycle controls.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin deactivates an ACTIVE client, **When** the change is saved, **Then** the client status changes to INACTIVE, they cannot initiate new bookings, existing PENDING sessions remain visible, and the client disappears from active client lists.

2. **Given** a Clinic Admin archives an INACTIVE client, **When** the change is saved, **Then** the client status changes to ARCHIVED, the client is hidden from active lists, and existing session history is preserved.

3. **Given** a Clinic Admin attempts to reactivate an ARCHIVED client, **When** the action is triggered, **Then** the system restores status to ACTIVE and the client reappears in active lists.

---

### User Story 6 - Track Client Progress (Priority: P2)

A Professional needs a consolidated view of a client's progress: session timeline, completed session notes, and intervention plans. This aggregates data from features 008 (Session Notes) and 009 (Intervention Plan).

**Why this priority**: Client progress tracking enables evidence-based session planning and demonstrates therapeutic progress over time. It is a read-only aggregation, not a separate data entry system.

**Independent Test**: Can be tested by opening the client progress view and verifying: session timeline with dates and statuses, session note summaries, and intervention plan summaries. Delivers a progress overview.

**Acceptance Scenarios**:

1. **Given** a Professional opens the client progress view, **When** the page loads, **Then** the system displays a timeline of all sessions (completed first), with each session showing: date, service, professional, status.

2. **Given** a Professional views a completed session in the timeline, **When** they expand the session entry, **Then** the session note summary is shown (full note requires navigating to session notes feature).

3. **Given** a Client has an active intervention plan, **When** the Professional opens the client progress view, **Then** the intervention plan summary is shown with recommendation and duration.

---

### Edge Cases

- What happens when a client's email is updated? → Email is linked to the WordPress user account; updating it requires re-verification. The client record and WordPress user must stay synchronized.
- What happens when a client is deleted from WordPress but not from the client table? → Orphaned client records must be detected and flagged. The system prevents deletion of a WordPress user that has an associated active client record.
- What happens when a client tries to book a session while INACTIVE? → The booking API rejects with a clear message that the client account is inactive and they should contact the practice.
- What happens when two clients have the same mobile number? → Allowed. Mobile number is not unique — a client may change numbers over time. Search by mobile number returns all matches.
- What happens when the client ID sequence wraps (reaches 99999 in a year)? → The sequence should be large enough (100,000 per practice per year is the assumption). If exceeded, the system logs a warning and continues with overflow numbering.
- What happens when a professional tries to access a client not assigned to them? → The system enforces data access rules: professionals see only clients they have had sessions with (per BR-10.01). Accessing a client outside this rule returns 403.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Receptionist or Clinic Admin to register a new client with required fields: fullName, email, mobileNumber, dateOfBirth, gender, and practiceId. Status defaults to ACTIVE.
- **FR-002**: System MUST generate a unique client ID in format "CLT-{year}-{sequential}" per practice per year, auto-incremented and unique within the practice.
- **FR-003**: System MUST link each client record to exactly one WordPress user account (one-to-one). The WordPress user account is provisioned at registration time.
- **FR-004**: System MUST allow a Client to view and update their own editable profile fields (mobileNumber, address, emergencyContact, notes) while preventing self-editing of read-only fields (fullName, email, dateOfBirth, gender, uniqueId).
- **FR-005**: System MUST allow listing clients with pagination, case-insensitive search by fullName or mobileNumber prefix, and filter by status.
- **FR-006**: System MUST allow viewing full client details including: profile, unique ID, session history (session date, service, professional, status), and session count.
- **FR-007**: System MUST allow a Clinic Admin to update client status (ACTIVE ↔ INACTIVE ↔ ARCHIVED). Status changes must immediately affect booking eligibility.
- **FR-008**: System MUST reject new bookings initiated by INACTIVE clients with a clear error message.
- **FR-009**: System MUST allow a Professional to view a client's session history and progress summary (timeline of sessions, session note summaries, intervention plan summaries).
- **FR-010**: System MUST enforce data access rules: Professionals see only clients they have had at least one session with; Receptionists see practice clients; Clinic Admin sees practice clients; Super Admin sees all.
- **FR-011**: System MUST log all client status changes and profile updates as AUDIT events with actor, target, before/after, and timestamp.
- **FR-012**: System MUST validate that email is unique across active clients within the same practice at registration time.
- **FR-013**: System MUST validate dateOfBirth is not in the future.
- **FR-014**: System MUST support a mobile number format validation (minimum 8 digits, numeric with optional + prefix).

### Key Entities *(include if feature involves data)*

- **Client**: A client registered in the practice. Attributes: id, userId (WordPress link), practiceId, uniqueClientId, fullName, email, mobileNumber, dateOfBirth, gender, address, emergencyContact, notes, status, createdAt, updatedAt.
- **ClientStatus**: Enumeration. Values: ACTIVE (can book), INACTIVE (paused), ARCHIVED (departed/erased).
- **Gender**: Enumeration. Values: MALE, FEMALE, OTHER.
- **Practice**: The practice a client belongs to (foreign key reference; full management is feature 013). Attributes referenced: id, name.
- **Session**: The session between client and professional (foreign key reference; full management is feature 005). Attributes referenced for session history: id, date, service, professional, status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Receptionist can register a new client and see them in the list within 10 seconds of submission.
- **SC-002**: Client list returns 200 clients with pagination within 1 second.
- **SC-003**: Client search by name or mobile number returns results within 500ms.
- **SC-004**: Status changes (deactivate/archive) take effect immediately — INACTIVE clients cannot initiate bookings within 5 seconds of the change.
- **SC-005**: 100% of client status changes and profile updates are recorded as AUDIT events.
- **SC-006**: Professionals can view client session history within the same response time as the detail view (no additional page load).

## Assumptions

- Each client belongs to exactly one practice in v1 (aligned with professional-practice from feature 002).
- Client links one-to-one to a WordPress user account, provisioned at registration.
- Unique client ID is per-practice per-year. Resetting the sequence each year keeps IDs short and readable.
- Mobile number is not unique — multiple clients may share a mobile number.
- Client progress tracking is a read-only aggregation from Session Notes (feature 008) and Intervention Plan (feature 009). This feature does not create those records — it only reads and displays them.
- Informed consent (FR-03.11) is managed by feature 010 (Informed Consent). This feature references consent status but does not implement consent collection.
- Professional data access (only seeing clients they've had sessions with) is enforced at the service layer, not at the database level.
- Client ID overflow format if sequence exceeds 99999: "CLT-{year}-OVF-{sequential}" (logs a warning and continues).