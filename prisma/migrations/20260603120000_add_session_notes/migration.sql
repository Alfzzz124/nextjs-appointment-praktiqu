-- Migration: add_session_notes
-- Feature 008: Session Notes
-- Adds the SessionNote model + NoteStatus enum.
-- One note per session (unique sessionId). Notes are locked when the
-- session reaches COMPLETED or when the professional manually closes them.
-- The `summary` field holds the first 200 characters of `content` for
-- feature 014 (client progress tracking) to read without touching content.

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "session_notes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "summary" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_notes_sessionId_key" ON "session_notes"("sessionId");

-- CreateIndex
CREATE INDEX "session_notes_professionalId_idx" ON "session_notes"("professionalId");

-- CreateIndex
CREATE INDEX "session_notes_status_idx" ON "session_notes"("status");

-- CreateIndex
CREATE INDEX "session_notes_sessionId_idx" ON "session_notes"("sessionId");
