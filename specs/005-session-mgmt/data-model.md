# Data Model: Session Management

## Entities

### Session

Primary entity representing a booked session between a client and professional.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | String (cuid) | PK, auto-generated | |
| clientId | String | FK → Client, NOT NULL | One client per session |
| professionalId | String | FK → Professional, NOT NULL | One professional per session |
| serviceId | String | FK → Service, NOT NULL | Determines duration |
| practiceId | String | FK → Practice, NOT NULL | |
| slotDate | DateTime | NOT NULL, UTC | Date of the session |
| startTime | DateTime | NOT NULL, UTC | Start time (UTC) |
| endTime | DateTime | NOT NULL, UTC | End time (calculated: startTime + service.durationMinutes) |
| status | SessionStatus | NOT NULL, default PENDING | |
| rejectionReason | String | nullable, max 500 chars | Required when REJECTED |
| checkedInAt | DateTime | nullable, UTC | Set when CHECK_IN occurs |
| checkedOutAt | DateTime | nullable, UTC | Set when CHECK_OUT occurs |
| createdBy | String | NOT NULL | userId of creator (client or receptionist) |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Indexes**:
- `@@index([professionalId, slotDate, status])` — for professional calendar queries
- `@@index([clientId, slotDate])` — for client session history
- `@@index([practiceId, slotDate])` — for practice-level queries
- `@@index([status])` — for status filtering

**Relationships**:
- Session → Client: many-to-one (a session has one client)
- Session → Professional: many-to-one (a session has one professional)
- Session → Service: many-to-one (a session has one service)

### SessionStatus (Enum)

Session lifecycle states.

| Value | Description |
|-------|-------------|
| PENDING | Awaiting professional approval (client-initiated booking) |
| BOOKED | Confirmed — professional approved or staff booked directly |
| CHECK_IN | Client has arrived |
| CHECK_OUT | Session ended — awaiting completion |
| COMPLETED | Session done — auto-closed after 24h |
| REJECTED | Professional rejected the request |
| CANCELLED | Cancelled before start |

## Status Transition Rules

| From | To | Trigger | Required |
|------|-----|---------|----------|
| PENDING | BOOKED | Professional/Admin approves | — |
| PENDING | REJECTED | Professional/Admin rejects | rejectionReason |
| PENDING | CANCELLED | Client/Staff cancels | reason (optional) |
| BOOKED | CHECK_IN | Receptionist checks in | — |
| BOOKED | CANCELLED | Client/Staff cancels | reason (optional) |
| CHECK_IN | CHECK_OUT | Receptionist checks out | — |
| CHECK_OUT | COMPLETED | Auto (24h) or manual | — |
| REJECTED | — | Terminal state | — |
| CANCELLED | — | Terminal state | — |
| COMPLETED | — | Terminal state | — |

## Validation Rules

1. **Double-booking prevention**: No two sessions can have overlapping time windows for the same professional where both have status in {BOOKED, CHECK_IN, CHECK_OUT, COMPLETED}. Overlap check: `session1.startTime < session2.endTime AND session1.endTime > session2.startTime`.
2. **Client status**: Booking only allowed for ACTIVE clients (INACTIVE clients get 403).
3. **Professional availability**: Booking only allowed on dates without professional off-days.
4. **Holiday check**: Booking not allowed on practice holidays.
5. **End time calculation**: `endTime = startTime + service.durationMinutes`. Calculated at creation and stored.
6. **Check-in sequence**: Only BOOKED sessions can be checked in.
7. **Check-out sequence**: Only CHECK_IN sessions can be checked out.
8. **Cancel sequence**: Only PENDING or BOOKED sessions can be cancelled.
9. **Reject sequence**: Only PENDING sessions can be rejected; rejectionReason is required.

## Session Duration

Duration is determined by the assigned service's `durationMinutes`:
- Copy duration from Service at session creation time
- Store both `startTime` and `endTime` on the session record
- Changes to Service.durationMinutes after session creation do NOT affect existing sessions
- Session stores its own temporal bounds — it is independent of the service

## Professional Off-Day Invalidation

When a professional's off-day is updated (feature 002):
1. System identifies all PENDING sessions for that professional on affected dates
2. Those sessions are automatically set to CANCELLED with reason "Professional unavailable"
3. AUDIT log records each invalidation with actor = system