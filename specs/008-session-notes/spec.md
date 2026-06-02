# Feature Specification: Session Notes

**Feature Branch**: `008-session-notes`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Session Notes - create session notes, add notes content, close session notes, view session notes list, print session notes, use notes template"

## Clarifications

### Session 2026-06-02

- Q: When can session notes be created? → A: Only for sessions in CHECK_IN or CHECK_OUT status. Notes cannot be created for PENDING/BOOKED sessions.
- Q: Who can create notes? → A: The professional assigned to the session only. A Receptionist cannot create clinical notes.
- Q: Can notes be edited after creation? → A: Notes can be edited by the professional who created them until the session is COMPLETED. After COMPLETED, notes are locked and cannot be edited.
- Q: What is a session notes template? → A: A pre-defined structure for notes content (SOAP format, free-form, etc.). Templates are defined by the practice and linked to service types.
- Q: How does the client progress tracking (feature 014) access notes? → A: Session notes summaries are read by feature 014. Feature 008 owns the notes content; feature 014 reads summaries.
- Q: Can session notes be printed? → A: Yes. A print view generates a formatted document. Printing is done client-side (print CSS / PDF generation).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Session Notes (Priority: P1)

A Professional creates clinical notes for a session that is CHECK_IN or CHECK_OUT. Notes are linked to the session and the professional.

**Why this priority**: Clinical notes are the primary documentation of therapeutic work. Without notes, no progress tracking or legal record exists.

**Independent Test**: Professional opens notes for a CHECK_IN session → enters content → saves → sees confirmation → notes appear in session history. Delivers clinical documentation.

**Acceptance Scenarios**:

1. **Given** a Professional is on a CHECK_IN session, **When** they click "Add Notes", **Then** the notes form opens with session context pre-filled and editable content fields.

2. **Given** a Professional enters notes content and saves, **When** the form is submitted, **Then** the system persists the notes, logs an AUDIT event, and the session shows "Notes available" in history.

3. **Given** a Professional tries to open notes for a PENDING session, **When** the notes form loads, **Then** the system shows "Session notes cannot be created for sessions that have not started" and prevents editing.

4. **Given** a Professional tries to create notes for another professional's session, **When** the notes form loads, **Then** the system returns 403 Forbidden.

---

### User Story 2 - View Session Notes List (Priority: P1)

A Professional views all notes they have created, sorted by date, filterable by client or session date.

**Why this priority**: Notes review is needed for continuity of care and legal record keeping.

**Independent Test**: Professional opens notes list → sees notes organized by session → can search and filter.

**Acceptance Scenarios**:

1. **Given** a Professional opens the notes list, **When** the page loads, **Then** the system displays notes created by this professional ordered by session date (newest first).

2. **Given** a Professional searches notes by client name, **When** they enter a search term, **Then** matching notes are displayed.

3. **Given** a Professional has no notes yet, **When** the page loads, **Then** "No notes yet" empty state appears with guidance to create first notes.

---

### User Story 3 - Close Session Notes (Priority: P1)

A Professional closes session notes when documentation is complete. Closed notes are locked and cannot be edited.

**Why this priority**: Closing notes finalizes the clinical record. Open notes can be edited; closed notes are immutable.

**Independent Test**: Professional opens notes → clicks "Close" → confirmation → notes are locked → edit buttons disappear → "Closed" badge shown.

**Acceptance Scenarios**:

1. **Given** a Professional has open notes on a session, **When** they click "Close Notes", **Then** the system locks the notes, shows "Closed" status, and disables editing.

2. **Given** a Professional tries to edit closed notes, **When** they load the notes page, **Then** the system shows a read-only view with "Closed" badge and no edit controls.

3. **Given** a Super Admin views closed notes, **When** the notes page loads, **Then** the system shows a read-only view (admin cannot edit clinical notes).

---

### User Story 4 - Print Session Notes (Priority: P2)

A Professional prints session notes as a formatted document.

**Why this priority**: Printing supports legal documentation requirements and client handover.

**Independent Test**: Professional clicks "Print" on a notes entry → print preview opens with formatted layout → print dialog opens. Delivers printed documentation.

**Acceptance Scenarios**:

1. **Given** a Professional clicks Print on notes entry, **When** the print view opens, **Then** the system displays a formatted page with session date, client name, professional name, service, and notes content.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a Professional to create notes for sessions in CHECK_IN or CHECK_OUT status only.
- **FR-002**: System MUST link notes to the Professional who created them and the Session they belong to.
- **FR-003**: System MUST allow notes to be edited by the creator while the session is not COMPLETED.
- **FR-004**: System MUST lock notes when the session reaches COMPLETED status. Locked notes are read-only.
- **FR-005**: System MUST allow notes to be closed manually while session is still CHECK_OUT, locking them immediately.
- **FR-006**: System MUST allow listing notes by Professional with search and date filter.
- **FR-007**: System MUST allow printing notes with a formatted print view.
- **FR-008**: System MUST log all notes creation and modification as AUDIT events.
- **FR-009**: System MUST provide notes summary for feature 014 (progress tracking). Summary = first 200 characters of notes content.
- **FR-010**: System MUST prevent non-creating professionals from editing notes.

### Key Entities *(include if feature involves data)*

- **SessionNote**: Clinical notes for a session. Attributes: id, sessionId, professionalId, content, status (OPEN/CLOSED), createdAt, updatedAt, closedAt.
- **Session**: The session notes belong to (foreign key reference from feature 005). Attributes referenced: id, status, clientId, professionalId.
- **Client**: The client for context (foreign key reference from feature 004). Attributes referenced: id, fullName.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Notes are created and persisted within 3 seconds of submission.
- **SC-002**: Notes list loads 50 entries within 2 seconds.
- **SC-003**: Closed notes cannot be edited — edit controls are absent and API rejects edit attempts.

## Assumptions

- Notes content is free-form text. Rich text formatting is not required for MVP. Basic paragraph structure is sufficient.
- Notes print view uses browser print CSS. No server-side PDF generation.
- Notes summaries for feature 014 are stored as a truncated text field on the SessionNote record.