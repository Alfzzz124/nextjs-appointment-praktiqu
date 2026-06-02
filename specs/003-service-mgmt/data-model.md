# Data Model: Service Management

## Entities

### Service

Primary entity representing a bookable service offering.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | String (cuid) | PK, auto-generated | |
| practiceId | String | FK → Practice, NOT NULL | One practice per service |
| name | String | max 100 chars, NOT NULL | Unique per practice |
| description | String | max 500 chars, nullable | Optional service description |
| price | Int | NOT NULL, >= 0 | Smallest currency unit (e.g., rupiahs) |
| durationMinutes | Int | NOT NULL, in {30,60,90,120,150,180} | Drives slot generation |
| serviceType | ServiceType | NOT NULL, enum | KONSELING/ASESMEN/WORKSHOP |
| status | ServiceStatus | NOT NULL, default ACTIVE | ACTIVE/INACTIVE |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Indexes**:
- `@@unique([practiceId, name])` — name unique per practice
- `@@index([practiceId, status])` — for filtered list queries
- `@@index([serviceType])` — for type filter queries

**Relationships**:
- Service → Practice: many-to-one (service belongs to one practice)
- Service → ProfessionalServiceAssignment: one-to-many (a service can be assigned to many professionals)

### ServiceType (Enum)

Closed enumeration of service categories.

| Value | Description |
|-------|-------------|
| KONSELING | Individual counseling sessions |
| ASESMEN | Psychological assessment |
| WORKSHOP | Group training/workshop |

Extending this list requires a database migration.

### ServiceStatus (Enum)

Service availability state.

| Value | Description |
|-------|-------------|
| ACTIVE | Available for booking and assignment |
| INACTIVE | Retired; preserved for history; excluded from slot generation |

## Validation Rules

1. **Name uniqueness**: `name` must be unique within the same `practiceId`. Different practices may share service names.
2. **Duration allowed values**: `durationMinutes` must be one of: 30, 60, 90, 120, 150, 180. Default: 60.
3. **Price non-negative**: `price` must be >= 0. Zero allowed for free services.
4. **Name length**: max 100 characters.
5. **Description length**: max 500 characters.
6. **Deletable only if**: `status == INACTIVE` AND no associated `ProfessionalServiceAssignment` records AND no associated session records.

## State Transitions

```
[no service]
    │
    ▼
  ACTIVE ←──────────────────┐
    │                       │
    │ (deactivate)          │ (reactivate)
    ▼                       │
  INACTIVE                  │
    │                       │
    └───────────────────────┘
```

- ACTIVE → INACTIVE: Soft-deactivation (allowed anytime; existing bookings preserved)
- INACTIVE → ACTIVE: Reactivation (allowed anytime; immediately reappears in slot generation)
- INACTIVE → DELETE: Physical deletion only if no bookings and no professional assignments
