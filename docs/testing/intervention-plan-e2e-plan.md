# E2E Test Plan: Intervention Plan

## Scope
Full end-to-end flow: professional creates plan, adds recommendations; client views and marks item complete.

## Pre-conditions
- Authenticated PROFESSIONAL
- Existing patient/session

## Scenarios

### S1: Create intervention plan (US1)
1. POST `/api/v1/intervention-plans` with sessionId, clientId, items
2. **Expected**: 201; plan created with `items.create`

### S2: Add recommendation items (US2)
- Items added at plan creation time (one-shot) per spec
- OR via `POST /api/v1/intervention-plans/[id]/items` for incremental

### S3: Client views plan (US3)
1. Client navigates to `/client/intervention-plan`
2. **Expected**: sees their active plans with recommendations

### S4: Client marks item complete (US3)
1. POST `/api/v1/intervention-plans/[id]/items/[itemId]/complete` with `isCompleted: true`
2. **Expected**: 200; item.status = COMPLETED; completedAt set

### S5: Print plan (feature 017)
1. Navigate to `/intervention-plans/[id]/print`
2. **Expected**: A4-formatted view with recommendations grouped by status

## CI integration
Run via agent-browser; assert all key DOM nodes.