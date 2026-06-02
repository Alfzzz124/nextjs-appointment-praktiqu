/**
 * Type definitions for the Session Notes feature (008).
 *
 * `SessionNote` mirrors the Prisma `SessionNote` model — IDs are string
 * CUIDs, status is a narrow union of `OPEN` | `CLOSED`. The `summary`
 * field holds the first 200 chars of `content` and is what feature 014
 * (client progress tracking) reads.
 *
 * `SessionNoteSoap` represents the structured SOAP sections the
 * professional fills in. The UI concatenates these sections on save and
 * stores the result in `SessionNote.content` so the clinical record is
 * a single, immutable-by-convention string.
 */

export type NoteStatus = 'OPEN' | 'CLOSED';

export interface SessionNote {
  id: string;
  sessionId: string;
  professionalId: string;
  summary: string;
  content: string;
  status: NoteStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  closedAt: string | null;
}

/** SOAP fields (Subjective, Objective, Assessment, Plan). */
export interface SessionNoteSoap {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface SessionNoteWithSoap extends SessionNote {
  soap: SessionNoteSoap;
}

/** Pagination wrapper mirroring the rest of the API. */
export interface PaginatedSessionNotes {
  data: SessionNote[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
}

/** Audit metadata for the create/update lifecycle. */
export interface SessionNoteAuditMeta {
  userId: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
