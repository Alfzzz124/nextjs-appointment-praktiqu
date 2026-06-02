# Professional Management E2E Test Plan

**Feature**: Professional Management (002)
**Test Framework**: @vercel/agent-browser (markdown test plan)
**Last Updated**: 2026-06-03

## Scope

End-to-end tests covering all 5 user stories in Professional Management (002).
Tests assume a running instance with MySQL database, authenticated users,
and seeded test data (clinics, services, users).

## Prerequisites

1. **Database**: MySQL with PraktiQU schema, Professional models migrated
2. **Users**: Seeded users for each role:
   - `super-admin@praktiqu.test` (SUPER_ADMIN, WP admin)
   - `clinic-admin@praktiqu.test` (CLINIC_ADMIN, WP kiviCare_clinic_admin)
   - `professional@praktiqu.test` (PROFESSIONAL, WP kiviCare_doctor)
3. **Clinics**: At least 1 clinic with timezone (e.g., `Asia/Jakarta`)
4. **Services**: At least 1 ACTIVE service (e.g., 60-min Konsultasi Awal)
5. **Auth**: JWT bearer tokens available for all roles

## Test Data Seed Script

```sql
-- Seed for E2E tests (run once before tests)
INSERT INTO users (id, email, username, firstName, lastName, displayName, role, wpRole, wpUserId, status)
VALUES
  ('user-super-admin', 'super-admin@praktiqu.test', 'superadmin', 'Super', 'Admin', 'Super Admin', 'SUPER_ADMIN', 'administrator', 1, 1),
  ('user-clinic-admin', 'clinic-admin@praktiqu.test', 'clinicadmin', 'Clinic', 'Admin', 'Clinic Admin', 'CLINIC_ADMIN', 'kiviCare_clinic_admin', 2, 1),
  ('user-professional', 'professional@praktiqu.test', 'professional', 'Jane', 'Doe', 'Jane Doe', 'PROFESSIONAL', 'kiviCare_doctor', 3, 1)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO professionals (id, userId, practiceId, fullName, email, professionalType, registrationNumber, status)
VALUES
  ('prof-1', 'user-professional', 'clinic-1', 'Jane Doe', 'jane.doe@praktiqu.test', 'PSIKOLOG_KLINIS', 'PSI-99999-2024', 'PENDING_ACTIVATION')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO services (id, clinicId, name, duration, price, status)
VALUES ('svc-60', 'clinic-1', 'Konsultasi Awal 60 Menit', 60, 250000.00, 1)
ON DUPLICATE KEY UPDATE id=id;
```

---

## User Story 1: Register Professional

**Feature**: Super Admin can register a new professional with name, email, professional type, SIP/SIK, and practice assignment.

### US1-E2E-001: Happy path — register new professional

```
Scenario: Super Admin registers a new professional
Given I am authenticated as Super Admin
And I am on the /admin/professionals page
When I fill in the registration form:
  - Full Name: "Dr. Ahmad Wijaya"
  - Email: "ahmad.wijaya@praktiqu.test"
  - Professional Type: "Psikolog Klinis"
  - Registration Number: "PSI-88888-2024"
  - Practice: "PraktiQU Clinic"
And I click "Save Professional"
Then I should see a success message
And the professional should appear in the list with status "Pending"
And the professional should have PENDING_ACTIVATION status in the database
```

**Verification**:
- [ ] Success message displayed
- [ ] Professional in list
- [ ] DB: `SELECT status FROM professionals WHERE email = 'ahmad.wijaya@praktiqu.test'` returns `PENDING_ACTIVATION`
- [ ] DB: AUDIT log entry exists with `professional.created`

### US1-E2E-002: Duplicate email rejection

```
Scenario: Submit form with existing email
Given I am authenticated as Super Admin
And a professional exists with email "existing@praktiqu.test"
When I fill in the registration form with email "existing@praktiqu.test"
And I submit the form
Then I should see a validation error on the email field
And no new professional should be created
```

**Verification**:
- [ ] Field-level error shown
- [ ] HTTP 422 response
- [ ] DB: no new record

### US1-E2E-003: Invalid registration number format

```
Scenario: Submit form with invalid SIP/SIK format
Given I am authenticated as Super Admin
When I fill in the registration form with registration number "INVALID"
And I submit the form
Then I should see a validation error on the registration number field
And the error should show the expected format (e.g., "PSI-12345-2024")
```

### US1-E2E-004: Unauthorized user cannot register

```
Scenario: Non-Super Admin attempts to register professional
Given I am authenticated as Clinic Admin
When I POST to /api/v1/professionals with valid payload
Then I should receive HTTP 403 Forbidden
And no professional should be created
```

---

## User Story 2: Maintain Profile

**Feature**: Professional can view and update their own profile (biography, specialties, contact info) but cannot edit SIP/SIK or professional type.

### US2-E2E-001: Self-service profile view

```
Scenario: Professional views own profile
Given I am authenticated as Professional (Jane Doe)
And I have a professional record linked to my user account
When I open /professional/profile
Then I should see my profile with all fields
And SIP/SIK and professional type should be read-only
```

**Verification**:
- [ ] All profile fields visible
- [ ] Read-only fields disabled with tooltip

### US2-E2E-002: Self-service profile update

```
Scenario: Professional updates biography and specialties
Given I am authenticated as Professional
When I update my biography to "Specialist in CBT and mindfulness"
And I add specialty "Depresi"
And I save the profile
Then the changes should persist when I reload
And an AUDIT event should be logged
```

**Verification**:
- [ ] Biography updated in DB
- [ ] Specialty added
- [ ] DB: `SELECT * FROM log_entries WHERE action = 'professional.updated'` exists

### US2-E2E-003: Cannot edit SIP/SIK or professional type

```
Scenario: Self-edit form has read-only fields
Given I am on the professional self-edit form
Then SIP/SIK field should be disabled
And professional type field should be disabled
And a tooltip should explain "Changes require administrator assistance"
```

### US2-E2E-004: Unauthorized access to other profile

```
Scenario: Professional attempts to edit another professional's profile
Given I am authenticated as Professional A
When I PATCH /api/v1/professionals/:id (where id belongs to Professional B)
Then I should receive HTTP 403 Forbidden
```

---

## User Story 3: Configure Availability

**Feature**: Professional can define weekly availability and off-day overrides; system generates bookable slots per service duration.

### US3-E2E-001: Configure weekly availability

```
Scenario: Professional sets Mon/Wed/Fri 09:00-12:00 availability
Given I am authenticated as Professional
And I have at least one assigned service (60-min)
When I open /professional/profile
And I configure availability:
  - Monday: 09:00 - 12:00
  - Wednesday: 09:00 - 12:00
  - Friday: 09:00 - 12:00
And I save
Then the schedule should be persisted
And the slots API should return 3 slots for next Monday at 60-min service
```

**Verification**:
- [ ] DB: `SELECT COUNT(*) FROM professional_availability WHERE professionalId = ?` returns 3
- [ ] GET /api/v1/professionals/:id/slots?date=NEXT_MONDAY&serviceId=svc-60 returns 3 slots

### US3-E2E-002: Overlapping windows rejection

```
Scenario: Professional attempts to create overlapping windows
Given I am authenticated as Professional
When I submit availability with:
  - Monday: 09:00-12:00
  - Monday: 11:00-13:00 (overlaps with first)
Then I should receive HTTP 422 with overlapping window error
And no new availability windows should be created
```

**Verification**:
- [ ] HTTP 422 response
- [ ] `fields.schedule` contains overlap error
- [ ] DB: no new overlapping windows

### US3-E2E-003: Slot generation for 60-min service

```
Scenario: Query slots for 60-minute service on configured day
Given availability is set: Mon 09:00-12:00
And a 60-minute service is assigned to the professional
When I GET /api/v1/professionals/:id/slots?date=2024-01-15&serviceId=svc-60
Then I should receive 3 slots at 09:00, 10:00, 11:00 (UTC)
And each slot should have startUtc and endUtc in UTC
```

### US3-E2E-004: Off-day blocks all slots

```
Scenario: Off-day overrides availability
Given availability is set: Mon 09:00-12:00
And I add an off-day for 2024-01-15 (a Monday)
When I query slots for 2024-01-15
Then I should receive an empty slots array
```

### US3-E2E-005: Booked session blocks slot

```
Scenario: Existing appointment blocks slot generation
Given availability is set: Mon 09:00-12:00 (60-min service)
And I have a PENDING appointment on Monday at 10:00
When I query available slots for Monday
Then the 10:00 slot should not appear
And 09:00 and 11:00 slots should appear
```

---

## User Story 4: List, Search, Status

**Feature**: Clinic Admin can browse, search, and activate/deactivate professionals within their practice.

### US4-E2E-001: Clinic Admin lists own practice professionals

```
Scenario: Clinic Admin views their practice's professionals
Given I am authenticated as Clinic Admin for "PraktiQU Clinic"
When I GET /api/v1/professionals
Then I should only see professionals in my practice
And I should not see professionals from other clinics
```

### US4-E2E-002: Filter by status

```
Scenario: Clinic Admin filters by ACTIVE status
Given I am authenticated as Clinic Admin
When I GET /api/v1/professionals?status=ACTIVE
Then only ACTIVE professionals should be returned
And the filter should be reflected in the URL
```

### US4-E2E-003: Deactivate professional

```
Scenario: Clinic Admin deactivates a professional
Given I am authenticated as Clinic Admin
And an ACTIVE professional exists in my practice
When I PATCH /api/v1/professionals/:id/status with status=INACTIVE
Then the professional status should change to INACTIVE
And the professional should not appear in slot results
And an AUDIT event should be logged
```

**Verification** (SC-005):
- [ ] Status changes to INACTIVE
- [ ] Within 5 seconds: GET /api/v1/professionals/:id/slots returns empty array

### US4-E2E-004: Super Admin can list all professionals

```
Scenario: Super Admin views all professionals across practices
Given I am authenticated as Super Admin
When I GET /api/v1/professionals
Then I should see professionals from all practices
And I can filter by practiceId
```

---

## User Story 5: Service Assignment

**Feature**: Clinic Admin can assign services to a professional; assigned services determine which slot grids appear.

### US5-E2E-001: Assign service to professional

```
Scenario: Clinic Admin assigns a 60-min and 120-min service to a professional
Given I am authenticated as Clinic Admin
And a professional exists in my practice
And two services exist: "Konsultasi 60 Menit" (60 min) and "Konsultasi 120 Menit" (120 min)
When I POST /api/v1/professionals/:id/services with serviceId for 60-min service
And I POST /api/v1/professionals/:id/services with serviceId for 120-min service
Then both services should be assigned
And each should appear in GET /api/v1/professionals/:id/services
```

### US5-E2E-002: Slot generation reflects service duration

```
Scenario: Different services produce different slot counts
Given a professional has availability: Mon 09:00-12:00
And the professional has two assigned services: 60-min and 120-min
When I query slots for the 60-min service
Then I should get 3 slots (09:00, 10:00, 11:00)
When I query slots for the 120-min service
Then I should get 1 slot (09:00)
```

### US5-E2E-003: Cannot assign inactive service

```
Scenario: Clinic Admin attempts to assign inactive service
Given I am authenticated as Clinic Admin
And a professional exists in my practice
And a service with status=0 exists
When I POST /api/v1/professionals/:id/services with the inactive serviceId
Then I should receive HTTP 422 with validation error
And the service should not be assigned
```

### US5-E2E-004: Unassign service

```
Scenario: Clinic Admin removes a service assignment
Given I am authenticated as Clinic Admin
And a professional has an assigned service
When I DELETE /api/v1/professionals/:id/services?serviceId=...
Then the assignment should be removed
And the service should not appear in GET /api/v1/professionals/:id/services
And an AUDIT event should be logged
```

---

## Performance Tests

### PERF-E2E-001: List 500 professionals in < 1 second

```
Scenario: Large practice performance
Given 500 professionals exist in the database
When I GET /api/v1/professionals?pageSize=100
Then the response time should be < 1 second
```

### PERF-E2E-002: Slot query < 500ms p95

```
Scenario: Slot generation performance
Given a professional has availability on the queried date
When I GET /api/v1/professionals/:id/slots?date=...&serviceId=...
Then the response time should be < 500ms p95
```

---

## Audit Logging Tests

### AUDIT-E2E-001: All state changes logged

```
Scenario: Every professional state change generates an AUDIT log entry
Given I perform each of these actions:
  - Create professional
  - Update profile
  - Change status (activate)
  - Change status (deactivate)
  - Assign service
  - Unassign service
  - Add off day
  - Remove off day
  - Change availability
Then for each action, an AUDIT log entry should exist in log_entries with:
  - level = 'AUDIT'
  - action = 'professional.{action}'
  - resource = 'professional'
  - resourceId = professional.id
  - userId = actor.id
  - metadata contains before/after values
```

---

## Test Execution

### Run All E2E Tests

```bash
# Using @vercel/agent-browser
npx vercel agent test \
  --test-plan docs/testing/professional-mgmt-e2e-plan.md \
  --base-url http://localhost:3000 \
  --auth-token <JWT_TOKEN>
```

### Run Specific User Story Tests

```bash
# US1 only
npx vercel agent test \
  --test-plan docs/testing/professional-mgmt-e2e-plan.md \
  --filter "US1-E2E-*"

# US3 only (availability)
npx vercel agent test \
  --test-plan docs/testing/professional-mgmt-e2e-plan.md \
  --filter "US3-E2E-*"
```

### Run Performance Tests

```bash
npx vercel agent test \
  --test-plan docs/testing/professional-mgmt-e2e-plan.md \
  --filter "PERF-*"
```

---

## Cleanup

```sql
-- Cleanup after E2E tests
DELETE FROM professional_service_assignments WHERE professionalId IN ('prof-1', 'prof-e2e-*');
DELETE FROM professional_off_days WHERE professionalId IN ('prof-1', 'prof-e2e-*');
DELETE FROM professional_availability WHERE professionalId IN ('prof-1', 'prof-e2e-*');
DELETE FROM professionals WHERE email LIKE '%@praktiqu.test' AND id != 'prof-1';
DELETE FROM log_entries WHERE occurredAt > '2024-01-01' AND action LIKE 'professional.%';
```