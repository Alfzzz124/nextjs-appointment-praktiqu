# Active Feature Memory: Professional Management

**Feature**: specs/002-professional-mgmt
**Last updated**: 2026-06-02

## Local Constraints

- One professional belongs to exactly one practice in v1 (deferred multi-practice).
- One professional links one-to-one to a WordPress user account.
- Slot generation intersects weekly availability windows with assigned services' durations.
- Times are stored in UTC; display is converted at the API edge per practice timezone / client locale.
- Registration number (SIP/SIK) is unique across active professionals and validated against the expected format.
- Service and Practice entities are managed by separate features; this feature only holds foreign references.

## Open Questions

- [none — all clarifications resolved in spec.md Clarifications section]

## Watchpoints

- Slot grid must remain non-overlapping when multiple services with different durations are assigned to the same professional.
- Off-day overrides and holiday overrides must be unioned; any match yields no slots.
- Status changes (activate / deactivate) must propagate to the slot API within 5 seconds (SC-005).
- AUDIT logging is required for status changes, service assignments, and any other state-mutating admin actions.
