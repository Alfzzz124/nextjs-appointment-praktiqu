# Data Model: Client Management

## Entities

### Client

Primary entity representing a registered client in a practice.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | String (cuid) | PK, auto-generated | |
| userId | String | FK → WordPress user, UNIQUE | One-to-one link |
| practiceId | String | FK → Practice, NOT NULL | One practice per client |
| uniqueClientId | String | NOT NULL, per-practice unique | Human-readable, e.g., CLT-2026-00001 |
| fullName | String | max 100 chars, NOT NULL | |
| email | String | max 255 chars, per-practice unique | Linked to WordPress user |
| mobileNumber | String | max 20 chars, NOT NULL | Not unique — multiple clients may share |
| dateOfBirth | DateTime | NOT NULL, not in future | |
| gender | Gender | NOT NULL, enum | MALE/FEMALE/OTHER |
| address | String | max 500 chars, nullable | Optional |
| emergencyContact | String | max 100 chars, nullable | Optional |
| notes | String | max 1000 chars, nullable | Client notes |
| status | ClientStatus | NOT NULL, default ACTIVE | ACTIVE/INACTIVE/ARCHIVED |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Indexes**:
- `@@unique([practiceId, uniqueClientId])` — unique per practice
- `@@unique([practiceId, email])` — email unique per practice
- `@@index([practiceId, status])` — for filtered list queries
- `@@index([fullName])` — for search
- `@@index([mobileNumber])` — for mobile search

**Relationships**:
- Client → WordPress user: one-to-one via userId
- Client → Practice: many-to-one
- Client → Session: one-to-many (client has many sessions)

### ClientStatus (Enum)

Client account lifecycle state.

| Value | Description |
|-------|-------------|
| ACTIVE | Client can book new sessions |
| INACTIVE | Client account paused; bookings rejected |
| ARCHIVED | Client departed/erased; hidden from active lists; history preserved |

### Gender (Enum)

Client gender for demographics.

| Value | Description |
|-------|-------------|
| MALE | |
| FEMALE | |
| OTHER | |

## Validation Rules

1. **Email uniqueness**: `email` must be unique per practice among ACTIVE clients. Archived clients do not block new registrations with the same email.
2. **Date of birth**: `dateOfBirth` must be in the past (not future).
3. **Mobile number**: minimum 8 digits, numeric with optional + prefix (e.g., +62812..., 081234567890).
4. **Name length**: max 100 characters.
5. **Address length**: max 500 characters.
6. **Emergency contact length**: max 100 characters.
7. **Notes length**: max 1000 characters.

## State Transitions

```
[no client]
    │
    ▼
  ACTIVE ←──────────────┐
    │                   │
    │ (deactivate)       │ (reactivate)
    ▼                   │
  INACTIVE              │
    │                   │
    │ (archive)          │ (restore)
    └───────┐           │
            ▼           │
         ARCHIVED ──────┘
```

- ACTIVE → INACTIVE: Soft-deactivation (allowed anytime; existing bookings preserved; new bookings blocked)
- INACTIVE → ACTIVE: Reactivation (allowed anytime; booking eligibility restored)
- INACTIVE → ARCHIVED: Archival (allowed anytime; hidden from active lists; history preserved)
- ARCHIVED → ACTIVE: Restore (allowed anytime; returns to active lists)

## Unique Client ID Format

Format: `CLT-{year}-{sequential number, 5 digits, zero-padded}`

Examples: `CLT-2026-00001`, `CLT-2026-00042`, `CLT-2027-00100`

Generation rules:
- Sequential number resets each year per practice
- If sequence exceeds 99999 in a year, overflow numbering continues and a warning is logged
- ID is assigned at registration time and never changes

## Access Control Rules (from BR-10)

Enforced at the service layer in `client.service.ts`:

| Role | Access Rule |
|------|-------------|
| SUPER_ADMIN | All clients, all practices |
| CLINIC_ADMIN | Clients in their practice only |
| RECEPTIONIST | Clients in their practice (read-only) |
| PROFESSIONAL | Clients they have had at least one BOOKED/COMPLETED session with |
| CLIENT | Own profile only (self) |

Professional access rule implementation:
```
canProfessionalAccessClient(professionalId, clientId):
  1. Query Session where professionalId AND clientId AND status IN (BOOKED, COMPLETED)
  2. If count > 0: allow access
  3. Else: deny with 403
```