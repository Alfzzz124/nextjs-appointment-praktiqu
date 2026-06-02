# Feature Specification: Intervention Plan

**Feature Branch**: `009-intervention-plan`

**Created**: 2026-06-02

**Status**: Draft

**Input**: "Intervention Plan - create recommendations for clients, add activities, set frequency/duration, view client recommendations"

## Clarifications

### Session 2026-06-02

- Q: How is an Intervention Plan created? → A: Professional creates a plan linked to a session. The plan contains one or more recommendation items (activities/exercises). Plan has: id, sessionId, professionalId, clientId, createdAt.
- Q: What is a recommendation item? → A: A recommendation line item: id, interventionPlanId, description, frequency, durationDays, instructions, status (ACTIVE/COMPLETED), completedAt.
- Q: Who can view the plan? → A: Professional who created it, and the Client it belongs to. Receptionist/Admin read-only.
- Q: Can plans be printed? → A: Yes. Feature 017 (Intervention Plan Print) handles printing. This feature owns the data.
- Q: Can clients mark items complete? → A: Yes. Client can mark recommendation items as COMPLETED. Professional cannot complete on behalf of client.
- Q: What is the status lifecycle of a recommendation? → A: ACTIVE (created) → COMPLETED (client marks done). No delete — completed items remain for history.
- Q: Is there a "duration" concept? → A: Yes — `durationDays` on each item (e.g., "Practice journaling for 30 days"). If null, item has no end date.

## User Scenarios & Testing

### US1 - Create Intervention Plan (P1)

Professional creates recommendations after a session. Plan is linked to the session and client. Delivers documented therapeutic guidance.

### US2 - Add Recommendation Items (P1)

Professional adds activities to an existing plan: description, frequency, duration, instructions.

### US3 - View Plan (Client Access) (P1)

Client views their own intervention plan and marks items complete. Delivers plan transparency.

### Edge Cases

- Client cannot edit plan content — only mark items complete
- Plan without items is allowed (draft state)
- No overlapping edit conflicts — one plan per session

## Requirements

- FR-001: System MUST allow Professional to create an Intervention Plan linked to a session and client
- FR-002: System MUST allow adding recommendation items with description, frequency, duration, instructions
- FR-003: System MUST allow Client to mark items COMPLETED
- FR-004: System MUST log AUDIT events for plan creation and item completion
- FR-005: System MUST expose plan summary for feature 014 (progress tracking)

## Success Criteria

- SC-001: Plan created and persisted within 3 seconds
- SC-002: Client sees plan within 5 seconds of creation
- SC-003: Items marked complete immediately reflect in plan view