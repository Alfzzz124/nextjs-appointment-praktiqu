# Practice Management E2E Test Plan

**Feature**: Practice Management (spec 013)
**Test Type**: Agent-based (manual execution by human + agent via `@vercel/agent-browser`)
**Tester**: Run the agent with this doc as context
**Last Updated**: 2026-06-03

---

## Preconditions

- Dev server running at `http://localhost:3000`
- PraktiQU DB seeded with at least one `Clinic` record
- Tester logged in as **Clinic Admin** or **Super Admin**
- No data cleanup required between scenarios (each is idempotent)

---

## TS-01: View Practice Settings

**Goal**: Verify the settings page loads and displays correct practice data.

1. Navigate to `/practice/settings`
2. Verify the page title "Practice Settings" is visible
3. Verify the Practice Name field is pre-filled with the clinic name
4. Verify the Email, Telephone, and address fields are visible and populated
5. Verify the Timezone dropdown shows a list of IANA timezones
6. Verify the Status banner does NOT appear (clinic is active)

**Expected Results**:
- Page loads with HTTP 200
- All fields populated from the DB
- No console errors

---

## TS-02: Update Practice Settings

**Goal**: Verify settings can be updated and the change persists.

1. Navigate to `/practice/settings`
2. Change the **Practice Name** to "Updated Test Clinic"
3. Change the **Timezone** to "Europe/London"
4. Change the **Logo URL** to `https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=200`
5. Click **Save Settings**
6. Wait for the "✓ Saved" indicator
7. Reload the page
8. Verify the name, timezone, and logo URL persisted

**Expected Results**:
- Form submits with HTTP 200
- Green "Settings saved successfully" banner appears
- After reload, all three fields retain their new values

**Rollback**: Revert to original values after verification.

---

## TS-03: View Holiday Calendar (Empty State)

**Goal**: Verify the holidays page shows empty state when no holidays exist.

1. Navigate to `/practice/holidays`
2. Verify the page title "Holiday Calendar" is visible
3. Verify the "No holidays configured" empty state message
4. Verify the "+ Add Holiday" button is visible

**Expected Results**:
- Page loads without errors
- Empty state displayed correctly
- "+ Add Holiday" button clickable

---

## TS-04: Add a Holiday

**Goal**: Verify a holiday can be added and appears in the list.

1. Navigate to `/practice/holidays`
2. Click "+ Add Holiday"
3. Fill in:
   - **Holiday Name**: "Test National Holiday"
   - **Start Date**: pick a future date (e.g., one week from today)
   - **End Date**: same as start date
4. Click "Add Holiday"
5. Verify the holiday appears in the list below with the correct title and date
6. Verify the add form closes

**Expected Results**:
- Holiday appears in the list immediately after creation
- Form closes automatically
- The "Remove" button is visible next to the new entry

---

## TS-05: Remove a Holiday

**Goal**: Verify a holiday can be removed from the list.

**Prerequisite**: Complete TS-04 first (a holiday must exist to remove).

1. Navigate to `/practice/holidays`
2. Find the holiday added in TS-04
3. Click **Remove** next to it
4. Verify the holiday is removed from the list
5. Verify the list shows the empty state if it was the only holiday

**Expected Results**:
- Holiday disappears from the list immediately
- No 500 errors
- Empty state shown if list was the only item

---

## TS-06: Validate Holiday Form — End Before Start

**Goal**: Verify client-side validation rejects end date before start date.

1. Navigate to `/practice/holidays`
2. Click "+ Add Holiday"
3. Fill in a start date of "2026-06-15" and end date of "2026-06-01" (end before start)
4. Click "Add Holiday"
5. Verify the error message "End date must be on or after the start date" appears
6. Verify no holiday was created (list unchanged)

**Expected Results**:
- Form submission blocked
- Error message displayed inline
- No API call made with invalid dates

---

## TS-07: Validate Settings Form — Invalid Timezone

**Goal**: Verify invalid timezone is rejected.

1. Navigate to `/practice/settings`
2. Open browser DevTools → Network tab
3. Attempt to submit via `fetch` directly with an invalid timezone:
   ```js
   fetch('/api/v1/practices/{id}', {
     method: 'PATCH',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ timezone: 'Not/A_Timezone' })
   })
   ```
4. Verify the response is HTTP 422 with `issues` array containing the timezone error

**Expected Results**:
- API returns HTTP 422
- Response body contains `type: '/errors/validation-error'`
- `issues` array includes the timezone validation message

---

## TS-08: Practice Not Found — 404

**Goal**: Verify graceful handling when practice ID does not exist.

1. Open DevTools → Console
2. Run:
   ```js
   fetch('/api/v1/practices/nonexistent-id-123', {
     method: 'GET',
     headers: { 'Content-Type': 'application/json' }
   })
   ```
3. Verify response is HTTP 404 with RFC 7807 error body

**Expected Results**:
- HTTP 404
- Response body contains `type: '/errors/resource-not-found'` and `status: 404`

---

## TS-09: Deactivate Practice (Soft Delete)

**Goal**: Verify a practice can be deactivated via DELETE.

**Prerequisite**: Requires admin session. Skip if not admin.

1. Note the practice ID from TS-01
2. Run in console:
   ```js
   fetch('/api/v1/practices/{id}', { method: 'DELETE' })
     .then(r => ({ status: r.status, body: r.json() }))
   ```
3. Verify response is HTTP 204
4. Navigate to `/practice/settings`
5. Verify the "inactive" banner is shown

**Rollback**: Re-activate via PATCH with `{ status: 1 }`

---

## Critical Paths Covered

| Path | TS |
|---|---|
| Settings — read | TS-01 |
| Settings — update | TS-02 |
| Holidays — empty state | TS-03 |
| Holidays — add | TS-04 |
| Holidays — remove | TS-05 |
| Holidays — validate dates | TS-06 |
| Settings — validate timezone | TS-07 |
| 404 graceful handling | TS-08 |
| Deactivate (soft delete) | TS-09 |

---

## Success Criteria

All 9 scenarios pass → E2E is green. Document any failures in
`docs/testing/practice-mgmt-e2e-results.md`.