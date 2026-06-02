# Memory Synthesis

feature: 008-session-notes
status: draft
hard_conflicts: 0
soft_conflicts: 0

## Current Scope

- Feature: Session Notes
- Professional creates clinical notes for CHECK_IN/CHECK_OUT sessions
- Notes locked when session COMPLETED or manually closed by professional
- Summary shared with feature 014 (progress tracking)
- No new entities beyond SessionNote + NoteStatus enum
- Audit logging on all note creation/modification

## Dependencies

- Session (005) for sessionId and status rules
- Client (004) for client context
- Print is client-side (CSS) — no server dependency

## Watchpoints

- Notes can only be created by the professional assigned to the session
- Notes locked on COMPLETED or manual close
- Feature 014 reads summary field — ensure summary is populated on save
- Print uses browser print CSS — no PDF generation needed

## Retrieval Notes

- Budget: ~200 words
