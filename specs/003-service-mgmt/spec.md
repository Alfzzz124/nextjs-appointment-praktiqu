# Feature Specification: Service Management

**Feature Branch**: `003-service-mgmt`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Service Management - create, update, delete services with pricing, flexible duration (60/90/120 min), service types (konseling/asesmen/workshop), assign to professional"

## Clarifications

### Session 2026-06-02

- Q: How does a service relate to a practice? → A: One service belongs to exactly one practice in this version. This aligns with the professional-practice relationship from feature 002. Multi-practice services (same service offered across multiple practices) are deferred to a later phase.
- Q: How are service types structured? → A: Service type is a closed enumeration: KONSELING (individual counseling), ASESMEN (psychological assessment), WORKSHOP (group training/workshop). These map to the session types in the PRD (Individual, Group, Assessment). Extending this list requires a migration.
- Q: How is duration specified? → A: Duration is an integer in minutes, stored directly on the service record. Valid values are 30, 60, 90, 120, 150, 180 minutes. Default is 60 minutes. Duration drives the slot generation in feature 002 (Professional Management).
- Q: Can a service be deleted or only deactivated? → A: Deactivation only (soft-delete). A service with ACTIVE status cannot be deleted if it has existing bookings. This prevents orphaned session records. Physical deletion is only possible for INACTIVE services with no booking history.
- Q: Who can manage services? → A: Clinic Admin manages services within their practice. Super Admin has cross-practice visibility. Service assignment to professionals is done via feature 002's service assignment endpoint, not this feature.
- Q: Is there a private/public flag on services? → A: No. FR-05.07 (private/public service flag) is P2 and deferred. All services are visible to authorized users within the practice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a Service (Priority: P1)

A Clinic Admin needs to create a new service offering for their practice, with a name, price, duration, and service type. The service becomes available for assignment to professionals once created.

**Why this priority**: Services are the foundational offering that clients book and professionals deliver. Without services, the booking system has nothing to sell and slot generation has no duration to work with.

**Independent Test**: Can be tested by a Clinic Admin submitting the create-service form with all required fields (name, price, duration, service type) and verifying the service appears in the service list with ACTIVE status. Delivers a bookable service offering.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is authenticated and on the Services list, **When** they submit a valid create form with name, price (e.g., 150000), duration (e.g., 60 minutes), and service type (KONSELING), **Then** a new service record is created in ACTIVE status, linked to the admin's practice, and appears in the service list immediately.

2. **Given** a Clinic Admin submits a create form with a service name that already exists in their practice, **When** the form is submitted, **Then** the system rejects the request with a clear validation error indicating the name is already in use.

3. **Given** a Clinic Admin submits a create form with an invalid duration (e.g., 45 minutes, not in the allowed set), **When** the form is submitted, **Then** the system rejects the request with a field-level validation error specifying allowed values.

4. **Given** a Clinic Admin submits a create form with a negative price, **When** the form is submitted, **Then** the system rejects the request with a validation error.

---

### User Story 2 - Update Service Details (Priority: P1)

A Clinic Admin needs to update an existing service: change the price, duration, name, or service type. Changes should not break existing bookings that are already confirmed.

**Why this priority**: Services may need price adjustments, duration corrections, or name corrections after creation. The system must allow updates while maintaining data integrity for existing bookings.

**Independent Test**: Can be tested by updating a service's price and duration, then verifying existing bookings (if any) remain unchanged while new slot generation uses the updated duration. Delivers editable service catalog.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is viewing an existing service, **When** they update the price or duration and save, **Then** the system persists the changes, logs an AUDIT event, and new slot generation uses the updated values immediately.

2. **Given** a Clinic Admin attempts to update a service that has PENDING or BOOKED sessions in the future, **When** they change the duration, **Then** the system warns that existing bookings will continue to use the old duration but new slots use the new duration, and the admin confirms before proceeding.

3. **Given** a Clinic Admin updates a service name to one already used by another service in the same practice, **When** the form is submitted, **Then** the system rejects with a name-conflict validation error.

---

### User Story 3 - List and Search Services (Priority: P1)

A Clinic Admin and staff need to browse the service catalog within their practice. Staff need to see which services are available for booking without administrative controls.

**Why this priority**: Service visibility is required for the public booking portal (feature 006) and for professional service assignment (feature 002). A readable list with filter and search is the primary access pattern.

**Independent Test**: Can be tested by listing services with pagination, searching by name, and filtering by service type. Delivers a browsable service catalog.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin opens the service list, **When** they load the page, **Then** the system displays all ACTIVE services for their practice with name, price, duration, service type, and pagination.

2. **Given** a user filters the service list by service type (ASESMEN), **When** they apply the filter, **Then** only services of type ASESMEN are returned, and the filter is reflected in the URL.

3. **Given** a user searches for "konseling" in the service list, **When** they submit the search, **Then** services with "konseling" in their name are returned (case-insensitive).

---

### User Story 4 - Deactivate and Reactivate Services (Priority: P2)

A Clinic Admin needs to deactivate a service (e.g., seasonal service no longer offered) without deleting it. Deactivation removes the service from bookable options while preserving booking history.

**Why this priority**: Service catalog management requires the ability to retire services temporarily. Hard deletion would break booking history; soft-delete via deactivation preserves audit trails.

**Independent Test**: Can be tested by deactivating a service and verifying it no longer appears in the public booking portal while existing bookings remain intact. Delivers reversible service lifecycle management.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin deactivates an ACTIVE service, **When** the change is saved, **Then** the service status changes to INACTIVE, it no longer appears in the service list filter for ACTIVE, and it no longer appears in slot results for new bookings.

2. **Given** a Clinic Admin reactivates an INACTIVE service, **When** the change is saved, **Then** the service status changes to ACTIVE, it reappears in slot generation immediately.

3. **Given** a Clinic Admin attempts to delete a service with existing booking history, **When** the delete action is triggered, **Then** the system rejects with a message explaining that active bookings exist, and suggests deactivation instead.

---

### User Story 5 - View Service Details (Priority: P2)

A Professional or staff member needs to view full details of a service, including which professionals offer it, to understand what clients can book.

**Why this priority**: Service details are needed for professional service assignment (feature 002) and for the public booking portal to display service descriptions. Professionals need to know what services they are assigned.

**Independent Test**: Can be tested by viewing a service's detail page and seeing name, description, price, duration, service type, and a list of assigned professionals. Delivers service transparency.

**Acceptance Scenarios**:

1. **Given** a user is viewing a service detail page, **When** the page loads, **Then** the system displays all service attributes: name, description, price, duration, service type, status, and the count of professionals assigned to this service.

2. **Given** a user views a service that has no assigned professionals, **When** the detail page loads, **Then** the system displays the service with a "No professionals assigned yet" note.

---

### Edge Cases

- What happens when a service duration is changed mid-day? → Existing BOOKED sessions retain the old duration; new slot generation uses the new duration. The system warns the admin before the change proceeds.
- What happens when a service is deactivated with PENDING sessions? → PENDING sessions remain unchanged; only new slot generation is blocked. Professional still sees the pending session.
- What happens when all services in a practice are deactivated? → The practice has no bookable services; the public booking portal shows "No services available" and professionals see no slots generated.
- What happens when a service name is too long? → System enforces a maximum name length (100 characters) with a clear validation error.
- What happens when price is zero (free service)? → Allowed. The system accepts 0 as a valid price for complimentary or pro-bono services.
- What happens when two services have the same name but different durations? → Allowed. Name uniqueness is per (practice, name) only; duration is a separate attribute. The display should show name + duration to differentiate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Clinic Admin to create a new service with: name, description (optional), price, durationMinutes, serviceType, and practiceId. Status defaults to ACTIVE.
- **FR-002**: System MUST validate that service name is unique within the same practice. Services in different practices may share the same name.
- **FR-003**: System MUST validate that durationMinutes is one of the allowed values: 30, 60, 90, 120, 150, 180. Default is 60.
- **FR-004**: System MUST allow a Clinic Admin to update any field of an existing service (name, description, price, duration, serviceType).
- **FR-005**: System MUST warn the Clinic Admin when updating duration of a service that has existing future BOOKED sessions, and require explicit confirmation before saving.
- **FR-006**: System MUST allow a Clinic Admin to list services within their practice with pagination, search by name, and filter by serviceType and status.
- **FR-007**: System MUST allow a Clinic Admin to deactivate a service (set INACTIVE). Deactivation does not affect existing bookings.
- **FR-008**: System MUST allow a Clinic Admin to reactivate an INACTIVE service (set ACTIVE). The service immediately reappears in slot generation.
- **FR-009**: System MUST reject physical deletion of a service if it has any associated bookings (any session status). Only INACTIVE services with zero bookings can be physically deleted.
- **FR-010**: System MUST allow authorized users (Clinic Admin, Professional, Receptionist) to view service details including assigned professional count.
- **FR-011**: System MUST log all service state changes (create, update, deactivate, reactivate, delete) as AUDIT events with actor, target, before/after, and timestamp.
- **FR-012**: System MUST expose a read-only API endpoint to list ACTIVE services for a given practice, ordered by name. Used by the public booking portal.
- **FR-013**: System MUST enforce a maximum name length of 100 characters and a maximum description length of 500 characters.
- **FR-014**: System MUST store price as a positive integer (smallest currency unit, e.g., rupiahs). Zero is allowed for free services.

### Key Entities *(include if feature involves data)*

- **Service**: A bookable service offering. Attributes: id, practiceId, name, description, price, durationMinutes, serviceType, status, createdAt, updatedAt.
- **ServiceType**: Enumeration. Values: KONSELING (individual counseling), ASESMEN (psychological assessment), WORKSHOP (group training/workshop).
- **ServiceStatus**: Enumeration. Values: ACTIVE (available for booking), INACTIVE (retired but preserved for history).
- **Practice**: The clinic/practice a service belongs to (foreign key reference; full management is feature 013). Attributes referenced: id, name.
- **ProfessionalServiceAssignment**: The many-to-many link between Service and Professional (managed by feature 002; referenced here for read-only display of assigned professional count).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Clinic Admin can create a new service and see it in the list within 5 seconds of submission.
- **SC-002**: Updated service duration is reflected in slot generation immediately upon save (no cache delay).
- **SC-003**: Deactivated services do not appear in public booking portal service list within 5 seconds of status change.
- **SC-004**: Service list returns results within 1 second for 100 services with pagination.
- **SC-005**: 100% of service state changes are recorded as AUDIT events retrievable by Clinic Admin.
- **SC-006**: Service name uniqueness is enforced per practice, allowing same name across different practices.

## Assumptions

- Service belongs to exactly one practice in v1 (aligned with Professional practice relationship from feature 002).
- Service management does not create or assign professionals; it only references the ProfessionalServiceAssignment entity managed by feature 002.
- Price is stored as an integer in the smallest currency unit (e.g., Rupiah, no decimals). Display formatting (e.g., "150.000") is handled by the UI layer.
- Service type is a closed enumeration; extending requires a database migration.
- Duration values are fixed to 30/60/90/120/150/180 to align with the psychology practice standard session durations (50-min clinical hour, 90-min group, 120-min assessment). These match the PRD session types.
- The public booking portal (feature 006) consumes the ACTIVE service list; this feature does not implement the booking flow itself.