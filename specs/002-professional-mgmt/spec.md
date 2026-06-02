# Feature Specification: Professional Management

**Feature Branch**: `002-professional-mgmt`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Professional Management for PraktiQU - manage psychologist/psychiatrist profiles, registration numbers (SIP/SIK), specialties, availability schedule, day-wise slot configuration"

## Clarifications

### Session 2026-06-02

- Q: How should the system handle a professional belonging to multiple practices? → A: One professional belongs to exactly one practice for v1. Multi-practice membership deferred to a later phase. This keeps the data model and authorization simple.
- Q: How is day-wise slot configuration affected by service duration? → A: Slot grid is generated from the professional's weekly availability windows intersected with each service's duration. A professional can be configured for multiple services with different durations; each session draws from the appropriate service-driven slot.
- Q: How are professionals identified relative to the existing WordPress user base? → A: A Professional entity links to a WordPress user account (one-to-one). The professional-specific attributes (SIP/SIK, type, specialties, schedule) live in a separate professional profile table, not on the WordPress user record.
- Q: How does the system handle off-days / time-off within a configured weekly schedule? → A: Each professional has a base weekly schedule plus a list of explicit off-day overrides (date ranges or specific dates). The slot generator subtracts off-days from the base schedule when computing available slots.
- Q: Are digital signatures part of this feature? → A: No. FR-02.09 (digital signature) is out of scope for this feature and will be addressed in a separate specification if/when required.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register a Professional (Priority: P1)

A Super Admin needs to create a new professional account in the system. The professional is associated with a single practice and includes the legally required registration number (SIP/SIK) and a professional type (e.g., Psikolog Klinis, Psikiater).

**Why this priority**: A professional cannot exist in the system without first being registered. All downstream features (schedule, service assignment, session booking) depend on a registered professional.

**Independent Test**: Can be tested by a Super Admin submitting the create-professional form with required fields (name, email, professional type, SIP/SIK, practice) and verifying a new professional record is created with status PENDING_ACTIVATION. Delivers the ability to onboard new psychologists.

**Acceptance Scenarios**:

1. **Given** a Super Admin is authenticated and on the Professionals list, **When** they submit a valid create form including name, email, professional type, SIP/SIK, and a practice, **Then** a new professional record is created in PENDING_ACTIVATION status, the linked WordPress user account is provisioned, and the professional appears in the list with a pending indicator.

2. **Given** a Super Admin submits a create form with an email that already exists, **When** the form is submitted, **Then** the system rejects the request with a clear validation error and does not create a duplicate professional.

3. **Given** a Super Admin submits a create form without a required field (e.g., SIP/SIK or professional type), **When** the form is submitted, **Then** the system rejects the request with field-level validation errors and does not create the professional.

---

### User Story 2 - Maintain the Professional Profile (Priority: P1)

A Professional needs to view and update their own profile: contact information, biography, specialties, and assigned services.

**Why this priority**: Professionals manage their own public-facing information. Profile completeness directly affects client booking and trust.

**Independent Test**: Can be tested by an authenticated Professional opening their profile, updating biography and specialties, saving, and reloading to confirm changes persisted. Delivers self-service profile maintenance.

**Acceptance Scenarios**:

1. **Given** a Professional is authenticated, **When** they open their profile, **Then** the system displays their current profile information, including type, registration number (read-only), specialties, and assigned services.

2. **Given** a Professional updates editable fields (biography, specialties, contact info), **When** they save, **Then** the system persists the changes, logs an AUDIT event, and confirms the update.

3. **Given** a Professional attempts to edit a non-editable field (e.g., SIP/SIK or professional type), **When** the form is rendered, **Then** those fields are read-only and a clear note explains that changes require administrator assistance.

---

### User Story 3 - Configure Availability and Day-Wise Slot Grid (Priority: P1)

A Professional needs to define when they are available for sessions. The system uses this configuration to generate bookable slots for clients, taking each service's duration into account.

**Why this priority**: Without an availability schedule, no session can be booked. This is the foundation for the entire session management workflow.

**Independent Test**: Can be tested by a Professional defining weekly availability (e.g., Mon/Wed/Fri 09:00-12:00), then querying the public slot API for a given date and service to confirm returned slots align with the configured windows and service duration. Delivers bookable slot generation.

**Acceptance Scenarios**:

1. **Given** a Professional is authenticated and has at least one assigned service, **When** they configure weekly availability (per day, per time window), **Then** the system persists the schedule and the slot generator uses it to produce bookable slots for the assigned services.

2. **Given** a Professional has configured availability and an assigned 60-minute service, **When** the system generates slots for a future date, **Then** slots are produced in 60-minute increments within the configured window with no overlap and no slots ending after the window.

3. **Given** a Professional has configured availability and an assigned 120-minute service, **When** the system generates slots for a future date, **Then** slots are produced in 120-minute increments within the configured window.

4. **Given** a Professional adds an off-day override, **When** the slot generator runs for that date, **Then** no slots are produced for that date.

---

### User Story 4 - List, Search, and Update Professional Status (Priority: P2)

A Clinic Admin needs to browse, search, and update the status of professionals within their practice.

**Why this priority**: Operations require administrative visibility into professionals. Status updates (activate / deactivate) gate whether the professional can be booked.

**Independent Test**: Can be tested by a Clinic Admin listing professionals, filtering by status, and activating/deactivating a record. Delivers administrative control.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is authenticated, **When** they open the professionals list, **Then** the system displays professionals in their practice with pagination, current status, and basic search.

2. **Given** a Clinic Admin filters by status, **When** they apply a filter (e.g., ACTIVE), **Then** the list shows only matching professionals and the filter is reflected in the URL.

3. **Given** a Clinic Admin updates a professional's status to INACTIVE, **When** the change is saved, **Then** the system updates the status, logs an AUDIT event, and the professional no longer appears in bookable slot results.

---

### User Story 5 - View and Update Assigned Services (Priority: P2)

A Clinic Admin needs to assign services to a professional and the Professional needs to see which services they are configured for. This determines what bookable session types are available for that professional.

**Why this priority**: Service assignment links the professional to the service catalog. Required for slot generation and booking to function.

**Independent Test**: Can be tested by a Clinic Admin assigning two services to a professional and verifying that the slot API returns service-appropriate slot grids. Delivers service-to-professional binding.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is editing a professional, **When** they assign one or more services, **Then** the system persists the assignments and the professional's bookable slot API now reflects those services.

2. **Given** a Professional is authenticated, **When** they view their profile, **Then** they see the services they are currently assigned to (read-only for now; reassignment is admin-only).

---

### Edge Cases

- What happens when a Professional's only assigned service is deactivated? → The Professional remains registered but no longer appears in slot results for that service; other assigned services continue to work.
- How does the system handle timezone differences for professionals serving clients in different regions? → All times are stored in UTC; display is converted to the practice's configured timezone for staff and the client's locale for clients.
- What happens when two off-day overlaps (e.g., off-day within a window that already excludes a holiday)? → Off-day and holiday overrides are unioned; any matching date yields no slots.
- What happens when SIP/SIK format is invalid? → System rejects the request with a clear validation error specifying the expected format (e.g., "DDD-XXXXX-YYYY").
- What happens when a Professional's WordPress user is deleted? → The professional record must be deactivated (soft-disable) and a clear error surfaces if a Super Admin attempts to reactivate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Super Admin to register a new professional with: full name, email, professional type, registration number (SIP/SIK), practice assignment, and an initial status of PENDING_ACTIVATION.
- **FR-002**: System MUST validate that SIP/SIK is unique across active professionals and matches the expected format for the professional's country/jurisdiction.
- **FR-003**: System MUST link each professional record to exactly one WordPress user account (one-to-one) at registration time.
- **FR-004**: System MUST restrict a professional to a single practice in this version. Multi-practice membership is explicitly out of scope.
- **FR-005**: System MUST allow a Professional to view and update their own profile fields (biography, specialties, contact information) and MUST prevent editing of registration number, professional type, and assigned services from the self-service view.
- **FR-006**: System MUST allow a Professional to configure weekly availability (per day-of-week with one or more time windows) and a list of off-day overrides (specific dates or date ranges).
- **FR-007**: System MUST generate bookable slots by intersecting the professional's configured availability with the assigned services' durations. Different services may produce different slot grids for the same professional on the same day.
- **FR-008**: System MUST expose a read-only API to query a professional's bookable slots for a given date and service, returning slots in UTC.
- **FR-009**: System MUST allow a Clinic Admin to list, search, and filter professionals within their practice, with pagination.
- **FR-010**: System MUST allow a Clinic Admin to update a professional's status (ACTIVE, INACTIVE) and the change MUST immediately affect slot visibility.
- **FR-011**: System MUST allow a Clinic Admin to assign and unassign services to a professional. Only ACTIVE services are assignable.
- **FR-012**: System MUST log all professional status changes and assignment changes as AUDIT events, including actor, target, before/after, and timestamp.
- **FR-013**: System MUST reject attempts by a Professional to self-deactivate or self-assign services.
- **FR-014**: System MUST convert all stored times to UTC at write-time and convert to the practice's timezone on read for staff; client views use the client's locale.
- **FR-015**: System MUST enforce that a professional cannot have overlapping availability windows on the same day-of-week.

### Key Entities *(include if feature involves data)*

- **Professional**: A psychologist/psychiatrist registered in the system. Attributes: id, userId (WordPress link), practiceId, fullName, email, professionalType, registrationNumber, status, biography, specialties, createdAt, updatedAt.
- **ProfessionalAvailability**: A weekly recurring availability window. Attributes: id, professionalId, dayOfWeek, startTime, endTime. Multiple windows per day are allowed.
- **ProfessionalOffDay**: An explicit override that disables booking on a specific date or date range. Attributes: id, professionalId, startDate, endDate, reason (optional).
- **ProfessionalServiceAssignment**: A many-to-many link between a Professional and a Service indicating the professional offers that service. Attributes: id, professionalId, serviceId, createdAt.
- **Practice**: The clinic/practice a professional belongs to (foreign key only; full practice management is a separate feature). Attributes referenced: id, name, timezone.
- **Service**: The bookable service offering (foreign key only; full service management is a separate feature). Attributes referenced: id, name, durationMinutes, status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Super Admin can register a new professional and see them in the list within 60 seconds of submission.
- **SC-002**: A Professional can configure a weekly availability schedule and see updated bookable slots within 30 seconds of saving.
- **SC-003**: Slot generation returns correctly sized, non-overlapping slots for any assigned service duration, verified by automated tests covering 30/60/90/120-minute services.
- **SC-004**: 100% of professional status changes are recorded as AUDIT events retrievable by clinic administrators.
- **SC-005**: A deactivated professional disappears from public slot results within 5 seconds of the status change.
- **SC-006**: A Clinic Admin can list, filter, and search 500 professionals in a single practice with a sub-1-second response.

## Assumptions

- Each professional belongs to exactly one practice in v1; multi-practice support is a deferred enhancement.
- Practice and Service entities referenced here are managed in their own dedicated features (003 Practice Management, 005 Service Management). This feature consumes them as foreign references only.
- The WordPress user table is the source of identity; this feature only extends it with a professional profile table.
- The Public Booking Portal and Session Management features consume the slot API; their internal flows are not part of this spec.
- Digital signature (FR-02.09 from the PRD) is not part of this feature and is deferred to a separate specification.
- The professional's professional type is one of a closed enumeration (e.g., Psikolog Klinis, Psikolog Anak, Psikiater, Konselor). Extending the list is an admin operation.
- All times are stored in UTC; timezone conversion happens at the API edge.
