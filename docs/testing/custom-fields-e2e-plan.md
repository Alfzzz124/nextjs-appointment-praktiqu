# E2E Test Plan: Custom Fields

## Scope
Validation of custom field definition and value-binding flows.

## Scenarios

### S1: Create a custom field
1. Authenticate as CLINIC_ADMIN
2. POST `/api/v1/custom-fields` with moduleType=client, fieldType=select, options=[A,B,C]
3. **Expected**: 201; field has id; persisted to DB

### S2: Bind a value
1. POST value to `/api/v1/custom-fields` setValue endpoint (or nested route)
2. **Expected**: 200/201; fieldValue persisted; unique by [moduleType, moduleId, fieldId]

### S3: Validate value type
- email field with invalid value → 400
- select field with value not in options → 400
- required field empty → 400

### S4: List fields by module
- GET `/api/v1/custom-fields?moduleType=client` returns only client fields

## Negative cases
- Wrong fieldType → 400 ZodError
- Empty label → 400

## CI integration
Run via @vercel/agent-browser; capture screenshots for builder UI.
