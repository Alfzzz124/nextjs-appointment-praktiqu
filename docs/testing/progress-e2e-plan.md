# E2E Test Plan: Client Progress Tracking

## Scope
Validate the client progress timeline view combining sessions, notes, and plans.

## Scenarios

### S1: View empty timeline
1. Navigate to `/client/progress?clientId=x`
2. **Expected**: "No entries yet." message; goals section shows "No goals set."

### S2: View populated timeline
1. Session exists for client; plan created; goal set
2. Navigate to `/client/progress?clientId=x`
3. **Expected**: Sessions appear with type badge; plans with items; goals with achievement status

### S3: Mark goal achieved
1. POST to mark-goal-achieved endpoint
2. **Expected**: Goal status changes to achieved; achievedAt set

## CI integration
Use Playwright; assert timeline entries count matches session count.