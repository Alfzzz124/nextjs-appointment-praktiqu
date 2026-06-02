# Dashboard API Contracts

## Base URL

`/api/v1/dashboard`

## Common Patterns

### Authentication

All dashboard endpoints require JWT Bearer authentication. The user's role is extracted from the JWT token to determine which widgets to include in the response.

### Error Format (RFC 7807)

```json
{
  "type": "/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication required"
}
```

---

## Endpoints

### GET /api/v1/dashboard

**Description**: Get aggregated dashboard data tailored to the authenticated user's role.

**Authorization**: All authenticated roles (SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL, RECEPTIONIST, CLIENT)

**Response** (200):
```json
{
  "data": {
    "role": "PROFESSIONAL",
    "widgets": {
      "todaySessions": {
        "count": 4,
        "sessions": [
          {
            "id": "ses_abc123",
            "client": "Ahmad Wijaya",
            "service": "Konseling Individual",
            "time": "09:00",
            "status": "BOOKED"
          }
        ]
      },
      "pendingApprovals": {
        "count": 2
      },
      "activeClients": {
        "count": 15
      },
      "upcomingSessions": null,
      "recentHistory": null
    },
    "quickActions": [
      { "label": "Approve Requests", "href": "/professional/sessions?status=PENDING", "count": 2 },
      { "label": "View Calendar", "href": "/professional/sessions", "count": null }
    ]
  }
}
```

**Widget Inclusion by Role**:

| Widget | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
|---|---|---|---|---|---|
| todaySessions | ✅ (all practices) | ✅ | ✅ (own) | ✅ | ❌ |
| pendingApprovals | ✅ | ✅ | ✅ (own) | ❌ | ❌ |
| activeClients | ✅ (all) | ✅ (practice) | ✅ (own) | ❌ | ❌ |
| upcomingSessions | ❌ | ❌ | ❌ | ❌ | ✅ |
| recentHistory | ❌ | ❌ | ❌ | ❌ | ✅ |
| quickActions | ✅ | ✅ | ✅ | ✅ | ✅ |

---

### GET /api/v1/dashboard/stats

**Description**: Get administrative statistics for practice management.

**Authorization**: CLINIC_ADMIN, SUPER_ADMIN only

**Query Parameters**:
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| practiceId | string | no | user's practice | Filter to specific practice (SUPER_ADMIN only) |

**Response** (200):
```json
{
  "data": {
    "practiceId": "prac_xyz",
    "practiceName": "Klinik Psikologi Jaya",
    "sessionsThisWeek": 24,
    "sessionsLastWeek": 20,
    "percentageChange": 20,
    "activeClients": 45,
    "newClientsThisMonth": 3,
    "revenue": null
  }
}
```

**Notes**:
- `revenue` is `null` until billing feature (011) is implemented
- Percentage change calculated as: `((thisWeek - lastWeek) / lastWeek) * 100`, rounded to nearest integer
- Super Admin can query across all practices by omitting `practiceId`

**Errors**:
- 401: Not authenticated
- 403: Not authorized (PROFESSIONAL, RECEPTIONIST, CLIENT)
