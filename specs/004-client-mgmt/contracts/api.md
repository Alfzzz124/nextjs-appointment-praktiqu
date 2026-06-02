# Client Management API Contracts

## Base URL

`/api/v1/clients`

## Common Patterns

### Pagination

Query params: `?page=1&limit=20`
Response: `{ data: [...], pagination: { currentPage, totalPages, totalItems, itemsPerPage } }`

### Error Format (RFC 7807)

```json
{
  "type": "/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Email already exists in this practice",
  "instance": "/api/v1/clients"
}
```

### Field-Level Validation Errors

```json
{
  "type": "/errors/field-validation",
  "title": "Field Validation Error",
  "status": 422,
  "detail": "Validation failed",
  "errors": [
    { "field": "mobileNumber", "message": "Must be at least 8 digits" },
    { "field": "dateOfBirth", "message": "Date of birth cannot be in the future" }
  ]
}
```

---

## Endpoints

### GET /api/v1/clients

**Description**: List clients for the authenticated user's practice.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), RECEPTIONIST (own practice, read-only)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | number | no | 1 | Page number |
| limit | number | no | 20 | Items per page (max 100) |
| search | string | no | — | Case-insensitive search by fullName or mobileNumber prefix |
| status | string | no | — | Filter by ClientStatus |

**Response** (200):
```json
{
  "data": [
    {
      "id": "clt_abc123",
      "uniqueClientId": "CLT-2026-00001",
      "fullName": "Ahmad Wijaya",
      "email": "ahmad@example.com",
      "mobileNumber": "081234567890",
      "status": "ACTIVE",
      "sessionCount": 12,
      "createdAt": "2026-06-02T10:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalItems": 1,
    "itemsPerPage": 20
  }
}
```

**Notes**: 
- `sessionCount` is the total number of sessions (all statuses)
- Mobile number search matches prefix (e.g., "0812" matches "081234567890")

---

### POST /api/v1/clients

**Description**: Register a new client.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST (within own practice)

**Request Body**:
```json
{
  "fullName": "Ahmad Wijaya",
  "email": "ahmad@example.com",
  "mobileNumber": "081234567890",
  "dateOfBirth": "1990-05-15",
  "gender": "MALE",
  "address": "Jl. Sudirman No. 123, Jakarta",
  "emergencyContact": "Bu Siti - 081987654321",
  "notes": "First-time client referral"
}
```

**Required fields**: `fullName`, `email`, `mobileNumber`, `dateOfBirth`, `gender`
**Optional fields**: `address`, `emergencyContact`, `notes`

**Response** (201): Full client object (same as GET /:id)

**Errors**:
- 409: Email already exists in this practice (among ACTIVE clients)
- 422: Validation error (future date of birth, invalid mobile format, missing fields)

---

### GET /api/v1/clients/:id

**Description**: Get client details including session count.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), RECEPTIONIST (own practice), PROFESSIONAL (own clients only), CLIENT (self only)

**Response** (200):
```json
{
  "data": {
    "id": "clt_abc123",
    "uniqueClientId": "CLT-2026-00001",
    "practiceId": "prac_xyz789",
    "fullName": "Ahmad Wijaya",
    "email": "ahmad@example.com",
    "mobileNumber": "081234567890",
    "dateOfBirth": "1990-05-15",
    "gender": "MALE",
    "address": "Jl. Sudirman No. 123, Jakarta",
    "emergencyContact": "Bu Siti - 081987654321",
    "notes": "First-time client referral",
    "status": "ACTIVE",
    "sessionCount": 12,
    "createdAt": "2026-06-02T10:00:00Z",
    "updatedAt": "2026-06-02T10:00:00Z"
  }
}
```

**Errors**:
- 403: Professional accessing client they have no sessions with
- 404: Client not found or not accessible

---

### PATCH /api/v1/clients/:id

**Description**: Partial update of client profile.

**Authorization**: SUPER_ADMIN (all fields), CLINIC_ADMIN (practice fields), CLIENT (self, limited fields only)

**Editable fields by role**:
- SUPER_ADMIN: all fields
- CLINIC_ADMIN: fullName, address, emergencyContact, notes
- CLIENT: mobileNumber, address, emergencyContact, notes
- RECEPTIONIST: none (no edit permission)
- PROFESSIONAL: none (no edit permission)

**Request Body** (any combination):
```json
{
  "mobileNumber": "081987654321",
  "address": "Updated address",
  "emergencyContact": "New contact - 081111222222",
  "notes": "Updated notes"
}
```

**Response** (200): Full updated client object

**Errors**:
- 403: Attempting to edit a read-only field (e.g., dateOfBirth, gender, email)
- 404: Client not found

---

### DELETE /api/v1/clients/:id

**Description**: Archive a client (soft-delete, sets status to ARCHIVED).

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (within own practice)

**Preconditions**: Client must be INACTIVE (not ACTIVE) before archiving. A client with ACTIVE status must be deactivated first.

**Response** (200): Full updated client object with status ARCHIVED

**Errors**:
- 422: Cannot archive ACTIVE client (must deactivate first)

---

### PATCH /api/v1/clients/:id/status

**Description**: Update client status.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (within own practice)

**Request Body**:
```json
{
  "status": "INACTIVE"
}
```

**Valid transitions**:
- ACTIVE → INACTIVE: allowed (blocks new bookings; existing bookings preserved)
- INACTIVE → ACTIVE: allowed (restores booking eligibility)
- INACTIVE → ARCHIVED: allowed (removes from active lists; history preserved)
- ARCHIVED → ACTIVE: allowed (restores to active lists)

**Response** (200): Full updated client object

**Errors**:
- 400: Invalid status value or invalid transition
- 404: Client not found

---

### GET /api/v1/clients/:id/history

**Description**: Get client session history.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), RECEPTIONIST (own practice), PROFESSIONAL (own clients only)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | number | no | 1 | Page number |
| limit | number | no | 20 | Items per page |
| status | string | no | — | Filter by session status |

**Response** (200):
```json
{
  "data": [
    {
      "id": "ses_xyz789",
      "date": "2026-05-15T09:00:00Z",
      "service": {
        "id": "svc_abc123",
        "name": "Konseling Individual"
      },
      "professional": {
        "id": "pro_xyz123",
        "fullName": "Dr. Sarah"
      },
      "status": "COMPLETED",
      "sessionNotesAvailable": true
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalItems": 5,
    "itemsPerPage": 20
  }
}
```

**Notes**: `sessionNotesAvailable` indicates if session notes have been created (feature 008).

---

### GET /api/v1/clients/:id/progress

**Description**: Get aggregated client progress summary (sessions + notes + intervention plans).

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), PROFESSIONAL (own clients only)

**Response** (200):
```json
{
  "data": {
    "clientId": "clt_abc123",
    "fullName": "Ahmad Wijaya",
    "totalSessions": 12,
    "completedSessions": 10,
    "upcomingSession": {
      "id": "ses_upcoming",
      "date": "2026-06-05T09:00:00Z",
      "service": "Konseling Individual",
      "professional": "Dr. Sarah"
    },
    "sessionTimeline": [
      {
        "date": "2026-05-15T09:00:00Z",
        "service": "Konseling Individual",
        "professional": "Dr. Sarah",
        "status": "COMPLETED",
        "sessionNotesSummary": "Client showed improvement in coping strategies...",
        "interventionPlanSummary": null
      },
      {
        "date": "2026-05-08T09:00:00Z",
        "service": "Konseling Individual",
        "professional": "Dr. Sarah",
        "status": "COMPLETED",
        "sessionNotesSummary": "Explored childhood trauma triggers...",
        "interventionPlanSummary": "Recommended daily journaling exercise"
      }
    ],
    "activeInterventionPlan": {
      "id": "ip_xyz123",
      "createdAt": "2026-05-01T10:00:00Z",
      "summary": "Journaling + breathing exercises, 2x daily",
      "completedActivities": 15,
      "totalActivities": 30
    }
  }
}
```

**Notes**: 
- `sessionTimeline` shows most recent first
- `sessionNotesSummary` is the first 200 characters of the session note (full note requires navigating to feature 008)
- `interventionPlanSummary` shows the recommendation text (full plan requires feature 009)
- `activeInterventionPlan` shows the most recent non-completed plan