# Session Management API Contracts

## Base URL

`/api/v1/sessions`

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
  "detail": "Session cannot be checked in from current status",
  "instance": "/api/v1/sessions/ses_abc123/check-in"
}
```

### 409 Conflict (Double-booking)

```json
{
  "type": "/errors/conflict",
  "title": "Double Booking",
  "status": 409,
  "detail": "This time slot is already booked for another session",
  "instance": "/api/v1/sessions"
}
```

---

## Endpoints

### GET /api/v1/sessions

**Description**: List sessions for the authenticated user's scope.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (practice), PROFESSIONAL (own), RECEPTIONIST (practice), CLIENT (own)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | number | no | 1 | Page number |
| limit | number | no | 20 | Items per page (max 100) |
| status | string | no | — | Filter by SessionStatus |
| clientId | string | no | — | Filter by client |
| professionalId | string | no | — | Filter by professional |
| serviceId | string | no | — | Filter by service |
| dateFrom | string | no | — | Start date (YYYY-MM-DD) |
| dateTo | string | no | — | End date (YYYY-MM-DD) |

**Response** (200):
```json
{
  "data": [
    {
      "id": "ses_abc123",
      "client": { "id": "clt_xyz", "fullName": "Ahmad Wijaya", "uniqueClientId": "CLT-2026-00001" },
      "professional": { "id": "pro_xyz", "fullName": "Dr. Sarah" },
      "service": { "id": "svc_xyz", "name": "Konseling Individual", "durationMinutes": 60 },
      "slotDate": "2026-06-10",
      "startTime": "2026-06-10T09:00:00Z",
      "endTime": "2026-06-10T10:00:00Z",
      "status": "BOOKED",
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

---

### POST /api/v1/sessions

**Description**: Book a session. Creates PENDING for client booking, BOOKED for staff booking.

**Authorization**: 
- CLIENT → creates PENDING session (requires: clientId = self, slot from available slots)
- RECEPTIONIST, CLINIC_ADMIN, SUPER_ADMIN → creates BOOKED session directly

**Client Booking (creates PENDING)**:

Request body:
```json
{
  "clientId": "clt_xyz",
  "professionalId": "pro_xyz",
  "serviceId": "svc_xyz",
  "slotDate": "2026-06-10",
  "startTime": "2026-06-10T09:00:00Z"
}
```

**Staff Booking (creates BOOKED directly)**:

Request body:
```json
{
  "clientId": "clt_xyz",
  "professionalId": "pro_xyz",
  "serviceId": "svc_xyz",
  "slotDate": "2026-06-10",
  "startTime": "2026-06-10T09:00:00Z",
  "createdBy": "receptionist"  // staff creates directly
}
```

**Response** (201): Full session object with computed endTime

**Errors**:
- 403: Client account is INACTIVE
- 400: Professional is INACTIVE or has off-day on this date
- 400: Date is a practice holiday
- 409: Double-booking — slot already taken by another session
- 422: Validation error

---

### GET /api/v1/sessions/:id

**Description**: Get session details.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (practice), PROFESSIONAL (own), RECEPTIONIST (practice), CLIENT (own)

**Response** (200):
```json
{
  "data": {
    "id": "ses_abc123",
    "client": { "id": "clt_xyz", "fullName": "Ahmad Wijaya", "uniqueClientId": "CLT-2026-00001", "mobileNumber": "081234567890" },
    "professional": { "id": "pro_xyz", "fullName": "Dr. Sarah", "email": "sarah@practice.com" },
    "service": { "id": "svc_xyz", "name": "Konseling Individual", "durationMinutes": 60 },
    "slotDate": "2026-06-10",
    "startTime": "2026-06-10T09:00:00Z",
    "endTime": "2026-06-10T10:00:00Z",
    "status": "BOOKED",
    "checkedInAt": null,
    "checkedOutAt": null,
    "rejectionReason": null,
    "createdBy": "clt_xyz",
    "createdAt": "2026-06-02T10:00:00Z",
    "updatedAt": "2026-06-02T10:00:00Z"
  }
}
```

**Errors**:
- 403: Session not accessible to this user
- 404: Session not found

---

### POST /api/v1/sessions/:id/approve

**Description**: Approve a PENDING session → BOOKED.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (own sessions only)

**Request Body**: None required

**Response** (200): Updated session object with status BOOKED

**Side Effects**:
- Sends confirmation email to client
- Session appears in professional's calendar

**Errors**:
- 400: Session is not in PENDING status
- 403: Professional does not own this session

---

### POST /api/v1/sessions/:id/reject

**Description**: Reject a PENDING session → REJECTED.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (own sessions only)

**Request Body**:
```json
{
  "reason": "Schedule conflict — please rebook at another time"
}
```

**Required**: `reason` field (max 500 characters)

**Response** (200): Updated session object with status REJECTED

**Side Effects**:
- Sends rejection notification to client

**Errors**:
- 400: Session is not in PENDING status
- 400: `reason` is required
- 403: Professional does not own this session

---

### POST /api/v1/sessions/:id/check-in

**Description**: Check in a BOOKED session → CHECK_IN.

**Authorization**: RECEPTIONIST, CLINIC_ADMIN (within practice)

**Request Body**: None required

**Response** (200): Updated session object with status CHECK_IN, checkedInAt set

**Errors**:
- 400: Session is not in BOOKED status
- 403: Not authorized

---

### POST /api/v1/sessions/:id/check-out

**Description**: Check out a CHECK_IN session → CHECK_OUT.

**Authorization**: RECEPTIONIST, CLINIC_ADMIN (within practice)

**Request Body**: None required

**Response** (200): Updated session object with status CHECK_OUT, checkedOutAt set

**Errors**:
- 400: Session is not in CHECK_IN status
- 403: Not authorized

---

### POST /api/v1/sessions/:id/cancel

**Description**: Cancel a PENDING or BOOKED session → CANCELLED.

**Authorization**: 
- CLIENT (own PENDING/BOOKED sessions only)
- RECEPTIONIST, CLINIC_ADMIN (within practice)

**Request Body**:
```json
{
  "reason": "Client has a scheduling conflict"
}
```

**Optional**: `reason` field

**Response** (200): Updated session object with status CANCELLED

**Errors**:
- 400: Session is not in PENDING or BOOKED status
- 400: Session is in CHECK_IN or later status (cannot cancel in-progress sessions)
- 403: Not authorized

---

### GET /api/v1/sessions/calendar

**Description**: Get calendar view of sessions.

**Authorization**: Same as GET /sessions

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| view | string | no | day | day, week, or month |
| date | string | no | today | Reference date (YYYY-MM-DD) |
| professionalId | string | no | — | Filter to specific professional |

**Response** (200):
```json
{
  "data": {
    "view": "day",
    "date": "2026-06-10",
    "sessions": [
      {
        "id": "ses_abc123",
        "startTime": "09:00",
        "endTime": "10:00",
        "client": "Ahmad Wijaya",
        "service": "Konseling Individual",
        "status": "BOOKED",
        "statusColor": "#22c55e"
      }
    ]
  }
}
```

**Note**: Calendar returns grouped by time slot for rendering. Pagination not needed for typical calendar (max ~50 visible sessions).

---

### GET /api/v1/sessions/pending

**Description**: Get professional's pending approval requests.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL (own only)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | number | no | 1 | Page number |
| limit | number | no | 20 | Items per page |

**Response** (200):
```json
{
  "data": [
    {
      "id": "ses_abc123",
      "client": { "fullName": "Ahmad Wijaya", "uniqueClientId": "CLT-2026-00001" },
      "service": { "name": "Konseling Individual", "durationMinutes": 60 },
      "slotDate": "2026-06-10",
      "startTime": "09:00",
      "status": "PENDING",
      "createdAt": "2026-06-02T10:00:00Z"
    }
  ],
  "pagination": { ... }
}
```