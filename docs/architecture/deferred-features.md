# Deferred Features

**File**: `docs/architecture/deferred-features.md`
**Status**: Backlog
**Date**: 2026-06-02

## Why this doc exists

Audit C6 found that 8 of the 18 feature specs were stub-sized (400–700 bytes). User decision: do NOT cut them (they have parity with the KiviCare WordPress plugin) — but DO defer the spec writing until after the MVP features land. This doc is the canonical backlog for those deferred specs.

## MVP priority (spec'd now, in 011-billing and 012-notifications)

Already shipped:
- 011-billing — real spec, plan, tasks
- 012-notifications — real spec, plan, tasks

## Backlog (deferred; stubs remain in `specs/`)

These features are real and will be built, but the spec/plan/tasks are stubs for now. Specs will be written in priority order, AFTER the MVP features are stable.

| # | Feature | Priority | Why deferred | Earliest target |
| --- | --- | --- | --- | --- |
| 010 | Informed Consent | P1 in PRD | Depends on 002 (professional) + 004 (client) being stable | After 002 + 004 |
| 013 | Practice Management | P0 in PRD | Foundational; needs dedicated attention. Real spec needed soon. | Right after MVP features |
| 014 | Client Progress Tracking | P1 in PRD | Depends on 008 (session notes) + 009 (intervention plan) | After 008 + 009 |
| 015 | Notes Templates | P2 in PRD | Build after 008 (session notes) has its data model | After 008 |
| 016 | Custom Fields | P2 in PRD | Generic data-model concern; needs its own architecture doc | After most entities land |
| 017 | Intervention Plan Print | P2 in PRD | Build alongside 009 (intervention plan) | After 009 |
| 018 | Email Templates | P1 in PRD | Now under 012 (overlap with notifications feature) | **Covered by 012** |

**Note on 018**: The 018 stub was originally a stand-alone "email template management" feature. It is now subsumed by 012-notifications (which includes template management per US3). The 018 directory can stay as a thin pointer to 012, or be removed. **Recommendation: keep 018 as a stub pointing to 012.**

## Phasing

Phase 1 (MVP, in-progress):
- 001, 002, 003, 004, 005, 006, 007, 008, 009, 011, 012

Phase 2 (post-MVP, next specs to write):
- 013 (Practice Management) — write real spec
- 010 (Informed Consent) — write real spec
- 014 (Client Progress Tracking) — write real spec

Phase 3 (later):
- 015 (Notes Templates) — write real spec
- 017 (Intervention Plan Print) — write real spec
- 016 (Custom Fields) — write real spec (may need an ADR first)

Phase 4 (deferred indefinitely):
- 018 (subsumed by 012)
- Any feature not listed above

## Decision policy

A deferred feature is **promoted to "in-spec"** when:
- An upstream feature it depends on is complete, AND
- A team member picks it up for a sprint, AND
- The backlog order above is respected (Phase 2 before Phase 3)

A deferred feature is **cut** (removed from the backlog) when:
- It's been superseded by another feature, OR
- Product strategy changes invalidate the need

The 018 / 012 overlap is a candidate for a future cleanup PR; flag in standup.
