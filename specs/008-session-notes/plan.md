# Implementation Plan: Session Notes

**Branch**: `008-session-notes` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

## Summary

Implement session notes for PraktiQU: professional creates clinical notes for CHECK_IN/CHECK_OUT sessions, edits open notes, closes notes (locks them), lists and searches notes, prints formatted notes. Notes are linked to sessions and professionals.

## Tech Context

**Stack**: TypeScript strict, Next.js 14+, Prisma 5, MySQL, NextAuth v5, Vitest. No new data stores beyond SessionNote model.

## Constitution Check

- [x] Design-Driven, Trunk-Based, Conventional Commits, TDD + E2E, CI/CD, API Standards, Audit Logging

## Data Model

```prisma
model SessionNote {
  id              String   @id @default(cuid())
  sessionId       String   @unique  // one note per session
  professionalId  String
  summary         String   @db.VarChar(200)  // first 200 chars for feature 014
  content         String   @db.Text
  status          NoteStatus @default(OPEN)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  closedAt        DateTime?

  @@index([professionalId])
}

enum NoteStatus { OPEN CLOSED }
```

## API Contracts

```
GET    /api/v1/session-notes                     # list (professional's notes)
POST   /api/v1/session-notes                  # create
GET    /api/v1/session-notes/:id             # read
PATCH  /api/v1/session-notes/:id              # update (OPEN notes only)
POST   /api/v1/session-notes/:id/close       # close (lock note)
GET    /api/v1/sessions/:id/notes           # notes for a session
```

## Implementation Order

1. Prisma schema + migration
2. Session notes service + routes
3. Notes form UI + list UI
4. Print view
5. Unit + integration tests
6. E2E plan