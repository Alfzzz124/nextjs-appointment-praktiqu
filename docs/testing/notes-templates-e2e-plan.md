# E2E Test Plan: Notes Templates

## Scope
End-to-end validation of the note template management flow for clinicians.

## Pre-conditions
- Running Next.js app at http://localhost:3000
- Authenticated user with PROFESSIONAL or CLINIC_ADMIN role
- Database migrated and seeded

## Scenarios

### S1: Create a new template
1. Navigate to `/settings/notes-templates`
2. Click "New Template"
3. Fill in name, content with `{{client_name}}` placeholder
4. Add variables: `client_name, session_date`
5. Click "Save template"
6. **Expected**: Template appears in list; new id assigned; success toast.

### S2: Edit existing template
1. From list, click row to open editor
2. Modify content
3. Save
4. **Expected**: Updated `updatedAt` timestamp; content persisted.

### S3: Render template with variables
1. Open a template
2. Provide variable values
3. Trigger preview/render
4. **Expected**: Placeholders replaced; unknown variables preserved.

### S4: Soft delete
1. Click delete on a template
2. Confirm dialog
3. **Expected**: Status set to 0; row no longer in default list view.

## Negative cases
- Empty name → form validation error
- Empty content → form validation error
- Invalid JSON body to API → 400 RFC 7807
- Authenticated user without write role → 403

## CI integration
Run via @vercel/agent-browser in headless mode; capture screenshots at each step.
