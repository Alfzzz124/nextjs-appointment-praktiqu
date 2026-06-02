# Service Management API Contracts

## Base URL

`/api/v1/services`

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
  "detail": "Service name already exists in this practice",
  "instance": "/api/v1/services"
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
    { "field": "durationMinutes", "message": "Must be one of: 30, 60, 90, 120, 150, 180" },
    { "field": "name", "message": "Name already exists in this practice" }
  ]
}
```

---

## Endpoints

### GET /api/v1/services

**Description**: List services for the authenticated user's practice (or all services for Super Admin).

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), PROFESSIONAL (read), RECEPTIONIST (read)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| page | number | no | 1 | Page number |
| limit | number | no | 20 | Items per page (max 100) |
| search | string | no | — | Case-insensitive name search |
| serviceType | string | no | — | Filter by ServiceType |
| status | string | no | — | Filter by ServiceStatus |

**Response** (200):
```json
{
  "data": [
    {
      "id": "svc_abc123",
      "practiceId": "prac_xyz789",
      "name": "Konseling Individual",
      "description": "One-on-one counseling session",
      "price": 150000,
      "durationMinutes": 60,
      "serviceType": "KONSELING",
      "status": "ACTIVE",
      "createdAt": "2026-06-02T10:00:00Z",
      "updatedAt": "2026-06-02T10:00:00Z"
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

### POST /api/v1/services

**Description**: Create a new service.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (own practice)

**Request Body**:
```json
{
  "name": "Konseling Individual",
  "description": "One-on-one counseling session",
  "price": 150000,
  "durationMinutes": 60,
  "serviceType": "KONSELING"
}
```

**Required fields**: `name`, `price`, `durationMinutes`, `serviceType`
**Optional fields**: `description`

**Response** (201): Full service object (same as GET /:id)

**Errors**:
- 409: Name already exists in this practice
- 422: Validation error (invalid duration, negative price, missing fields)

---

### GET /api/v1/services/:id

**Description**: Get service details including assigned professional count.

**Authorization**: SUPER_ADMIN (all), CLINIC_ADMIN (own practice), PROFESSIONAL (read), RECEPTIONIST (read)

**Response** (200):
```json
{
  "data": {
    "id": "svc_abc123",
    "practiceId": "prac_xyz789",
    "name": "Konseling Individual",
    "description": "One-on-one counseling session",
    "price": 150000,
    "durationMinutes": 60,
    "serviceType": "KONSELING",
    "status": "ACTIVE",
    "assignedProfessionalCount": 3,
    "createdAt": "2026-06-02T10:00:00Z",
    "updatedAt": "2026-06-02T10:00:00Z"
  }
}
```

**Errors**:
- 404: Service not found or not accessible

---

### PATCH /api/v1/services/:id

**Description**: Partial update of service fields.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (own practice)

**Request Body** (any combination):
```json
{
  "name": "Updated Service Name",
  "description": "Updated description",
  "price": 175000,
  "durationMinutes": 90,
  "serviceType": "ASESMEN"
}
```

**Response** (200): Full updated service object

**Warnings** (HTTP 200 with warning header):
- When durationMinutes is changed on a service with existing BOOKED sessions: `X-Warning: Duration change will not affect existing bookings`

**Errors**:
- 404: Service not found
- 409: Name conflict with another service in the same practice
- 422: Validation error

---

### DELETE /api/v1/services/:id

**Description**: Physical deletion of a service.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (own practice)

**Preconditions for deletion**:
- Service status must be INACTIVE
- No associated ProfessionalServiceAssignment records
- No associated session records

**Response** (204): No content

**Errors**:
- 409: Cannot delete service with existing bookings or assignments
- 422: Cannot delete ACTIVE service (must deactivate first)

---

### PATCH /api/v1/services/:id/status

**Description**: Activate or deactivate a service.

**Authorization**: SUPER_ADMIN, CLINIC_ADMIN (own practice)

**Request Body**:
```json
{
  "status": "INACTIVE"
}
```

**Response** (200): Full updated service object

**Errors**:
- 400: Invalid status value (must be ACTIVE or INACTIVE)
- 404: Service not found

---

### GET /api/v1/services/public

**Description**: List ACTIVE services for public booking portal. No authentication required.

**Authorization**: None (public)

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| practiceId | string | yes | — | Practice to list services for |
| serviceType | string | no | — | Filter by ServiceType |

**Response** (200):
```json
{
  "data": [
    {
      "id": "svc_abc123",
      "name": "Konseling Individual",
      "description": "One-on-one counseling session",
      "price": 150000,
      "durationMinutes": 60,
      "serviceType": "KONSELING"
    }
  ]
}
```

**Note**: Returns only ACTIVE services. No pagination needed for typical practice (max ~100 services).