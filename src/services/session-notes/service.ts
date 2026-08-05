/**
 * Session Notes — a note IS a KiviCare encounter (phase E3).
 *
 * Retires the `session_notes` table. It held 0 rows on staging while clinicians had
 * recorded 319 encounters and 1167 medical-history entries in KiviCare: we had built a
 * parallel clinical record nobody used, invisible to every KiviCare screen.
 *
 * The mapping, and why each half fits:
 *   note                → `wp_kc_patient_encounters` row for the session's appointment
 *                         (both are one-per-session)
 *   note id             → the encounter id
 *   note body           → the encounter's `description` plus typed
 *                         `wp_kc_medical_history` entries (problem/observation/note)
 *   OPEN / CLOSED       → encounter `status` 1 / 0
 *   summary             → derived on read; there is no column, and a stored copy would
 *                         drift from the text it summarises
 *
 * SOAP is gone. It was ours, not KiviCare's, and its four fixed sections could not be
 * rendered by KiviCare's encounter view, templates or print output.
 *
 * Writes go through the plugin, because KiviCare fires listeners on encounter changes —
 * including `kc_encounter_closed`, which mails the patient their notes and prescription.
 *
 * Ids are `number` throughout: `wp_kc_appointments.id` for a session,
 * `wp_kc_patient_encounters.id` for a note.
 */

import { logging } from '@/lib/logging';
import { findSessionById } from '@/repositories/wp/sessions.repo';
import {
  findEncounterByAppointmentId,
  findEncounterById,
  listEncounterHistory,
  listEncounters,
  listHistoryForEncounters,
  type WpEncounter,
} from '@/repositories/wp/clinical-records.repo';
import {
  ENCOUNTER_STATUS,
  HISTORY_TYPE,
  closeEncounter,
  createEncounter,
  replaceEncounterHistory,
  updateEncounter,
  type HistoryEntry,
  type HistoryType,
} from '@/repositories/wp/encounters.write';
import {
  buildSummary,
  entriesToContent,
  type CreateSessionNoteInput,
  type ListSessionNotesQuery,
  type SessionNoteEntry,
  type UpdateSessionNoteInput,
} from './validation';

export const SESSION_NOTE_SUMMARY_MAX = 200;

/** Sessions in these statuses can have notes created / edited. */
const EDITABLE_SESSION_STATUSES = ['CHECK_IN', 'CHECK_OUT'];

/** Sessions in these statuses lock the note. */
const LOCKED_SESSION_STATUSES = ['CANCELLED'];

export class SessionNoteAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SessionNoteAccessError';
    this.status = status;
  }
}

export interface SessionNoteActor {
  /** Auth-mirror id (a cuid). Identifies the actor in the audit log. */
  userId: string;
  /**
   * The same person's `wp_users.ID`.
   *
   * Authorship is compared on this: an encounter's author is a KiviCare doctor id, and
   * the two id spaces do not match.
   */
  wpUserId: number;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface SessionNoteActorScope {
  actor: SessionNoteActor;
  /** `wp_kc_clinics.id` of the actor (for CLINIC_ADMIN scoping). */
  clinicId?: number | null;
}

/**
 * Normalise validated entries into the write repository's shape.
 *
 * The zod schema already requires both fields, but the project compiles with
 * `strictNullChecks: false`, under which `z.infer` marks every property optional — so
 * TypeScript cannot see the guarantee. Rather than assert it away, the values are made
 * definite here. Empty titles are dropped, which is what the plugin does server-side
 * anyway: they render as blank rows in KiviCare's encounter view.
 */
function toHistoryEntries(
  entries: ReadonlyArray<{ type?: string; title?: string }> | undefined,
): HistoryEntry[] {
  return (entries ?? [])
    .map((e) => ({
      type: (e.type ?? HISTORY_TYPE.NOTE) as HistoryType,
      title: (e.title ?? '').trim(),
    }))
    .filter((e) => e.title !== '');
}

/** The shape callers have always received, rebuilt from the encounter. */
export interface SessionNoteDTO {
  id: number;
  sessionId: string;
  professionalId: string;
  clientId: number;
  clinicId: number;
  summary: string;
  content: string;
  entries: SessionNoteEntry[];
  status: 'OPEN' | 'CLOSED';
  createdAt: Date | null;
}

function toDTO(
  encounter: WpEncounter,
  entries: ReadonlyArray<{ type: string; title: string }>,
): SessionNoteDTO {
  const content = entriesToContent(encounter.description, entries);
  return {
    id: encounter.id,
    // Kept as text for the callers that have always read it that way; the value is the
    // appointment id.
    sessionId: encounter.appointmentId === null ? '' : String(encounter.appointmentId),
    professionalId: String(encounter.doctorId),
    clientId: encounter.patientId,
    clinicId: encounter.clinicId,
    summary: buildSummary(content, SESSION_NOTE_SUMMARY_MAX),
    content,
    entries: entries.map((e) => ({ type: e.type as SessionNoteEntry['type'], title: e.title })),
    status: encounter.status === ENCOUNTER_STATUS.CLOSED ? 'CLOSED' : 'OPEN',
    createdAt: encounter.createdAt,
  };
}

export class SessionNoteService {
  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  async create(input: CreateSessionNoteInput, scope: SessionNoteActorScope) {
    const session = await findSessionById(Number(input.sessionId));
    if (!session) {
      throw new SessionNoteAccessError('Session not found', 404);
    }

    this.assertCanCreate(session, scope);

    // One encounter per appointment, as one note per session. KiviCare's own UI may
    // have created it already — that is a conflict, not a second note.
    const existing = await findEncounterByAppointmentId(Number(input.sessionId));
    if (existing) {
      throw new SessionNoteAccessError('Session notes already exist for this session', 409);
    }

    const created = await createEncounter({
      clinicId: session.clinicId,
      doctorId: session.professionalId,
      patientId: session.clientId,
      appointmentId: Number(input.sessionId),
      description: input.content ?? '',
      // Credit the clinician, not the service token: without this the plugin's
      // get_current_user_id() records 0 and the author is lost.
      addedBy: scope.actor.wpUserId,
    });

    const entries = toHistoryEntries(input.entries);
    if (entries.length > 0) {
      await replaceEncounterHistory({
        encounterId: created.id,
        patientId: session.clientId,
        entries,
        addedBy: scope.actor.wpUserId,
      });
    }

    await logging.audit('session_note.create', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: String(created.id),
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: '/api/v1/session-notes',
      method: 'POST',
      statusCode: 201,
      metadata: { sessionId: input.sessionId, professionalId: session.professionalId },
    });

    return this.load(created.id);
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  private async load(encounterId: number): Promise<SessionNoteDTO> {
    const encounter = await findEncounterById(encounterId);
    if (!encounter) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    const entries = await listEncounterHistory(encounterId);
    return toDTO(encounter, entries);
  }

  async getById(id: number, scope: SessionNoteActorScope): Promise<SessionNoteDTO> {
    const note = await this.load(id);
    this.assertCanRead(note.professionalId, scope);
    return note;
  }

  async getBySessionId(sessionId: number, scope: SessionNoteActorScope): Promise<SessionNoteDTO> {
    const encounter = await findEncounterByAppointmentId(sessionId);
    if (!encounter) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    const note = await this.load(encounter.id);
    this.assertCanRead(note.professionalId, scope);
    return note;
  }

  // ---------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------

  async list(query: ListSessionNotesQuery, scope: SessionNoteActorScope) {
    const { actor } = scope;

    let doctorId: number | undefined;
    let clinicIds: number[] | undefined;

    if (actor.role === 'PROFESSIONAL') {
      doctorId = actor.wpUserId;
    } else if (actor.role === 'CLINIC_ADMIN') {
      // Scoped by the clinic itself now — an encounter carries `clinic_id`, so the
      // roster round-trip the old session_notes table needed is gone.
      clinicIds = scope.clinicId ? [scope.clinicId] : [];
    } else if (actor.role !== 'SUPER_ADMIN') {
      // RECEPTIONIST / CLIENT → no listing access.
      return {
        data: [],
        pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: query.limit },
      };
    }

    // A client filter narrows to that patient's encounters directly; the old code had
    // to resolve their session ids first because notes carried no patient column.
    const patientId = query.clientId ? Number(query.clientId) : undefined;

    const { items, total } = await listEncounters({
      page: query.page,
      perPage: query.limit,
      doctorId,
      clinicIds,
      patientId,
      status:
        query.status === undefined
          ? undefined
          : query.status === 'CLOSED'
            ? ENCOUNTER_STATUS.CLOSED
            : ENCOUNTER_STATUS.OPEN,
    });

    const historyByEncounter = await listHistoryForEncounters(items.map((e) => e.id));
    let data = items.map((e) => toDTO(e, historyByEncounter.get(e.id) ?? []));

    // Search happens here, not in SQL: the text now lives across `description` plus N
    // medical_history rows, so there is no single column to match on.
    if (query.search) {
      const needle = query.search.toLowerCase();
      data = data.filter((n) => n.content.toLowerCase().includes(needle));
    }

    return {
      data,
      pagination: {
        currentPage: query.page,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
        totalItems: total,
        itemsPerPage: query.limit,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------

  async update(id: number, input: UpdateSessionNoteInput, scope: SessionNoteActorScope) {
    const note = await this.load(id);
    await this.assertCanEdit(note, scope);

    if (input.content !== undefined) {
      await updateEncounter(id, { description: input.content });
    }

    if (input.entries !== undefined) {
      // Replace, not append: editing rewrites the record wholesale, and a retried
      // request must not duplicate every line.
      await replaceEncounterHistory({
        encounterId: id,
        patientId: note.clientId,
        entries: toHistoryEntries(input.entries),
        addedBy: scope.actor.wpUserId,
      });
    }

    await logging.audit('session_note.update', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: String(id),
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: `/api/v1/session-notes/${id}`,
      method: 'PATCH',
      statusCode: 200,
    });

    return this.load(id);
  }

  // ---------------------------------------------------------------------
  // Close (lock)
  // ---------------------------------------------------------------------

  async close(id: number, scope: SessionNoteActorScope) {
    const note = await this.load(id);
    if (note.status === 'CLOSED') {
      return note; // idempotent
    }
    this.assertCanClose(note.professionalId, scope);

    // Through the plugin: this is what finally fires `kc_encounter_closed`, the hook
    // whose listener mails the patient their notes and prescription. Nothing in
    // KiviCare core or Pro ever triggered it, so that email had never been sent.
    await closeEncounter(id);

    await logging.audit('session_note.close', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: String(id),
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: `/api/v1/session-notes/${id}/close`,
      method: 'POST',
      statusCode: 200,
    });

    return this.load(id);
  }

  // ---------------------------------------------------------------------
  // Authorization helpers
  // ---------------------------------------------------------------------

  private assertCanCreate(
    session: { status: string; professionalId: number; clinicId: number },
    scope: SessionNoteActorScope,
  ) {
    const { actor } = scope;

    if (
      actor.role !== 'PROFESSIONAL' &&
      actor.role !== 'SUPER_ADMIN' &&
      actor.role !== 'CLINIC_ADMIN'
    ) {
      throw new SessionNoteAccessError(
        'Only the assigned professional can create session notes',
        403,
      );
    }

    if (actor.role === 'PROFESSIONAL' && session.professionalId !== actor.wpUserId) {
      throw new SessionNoteAccessError('Professional is not assigned to this session', 403);
    }

    if (!EDITABLE_SESSION_STATUSES.includes(session.status)) {
      throw new SessionNoteAccessError(
        `Session notes cannot be created for sessions in ${session.status} status`,
        422,
      );
    }
  }

  private assertCanRead(professionalId: string, scope: SessionNoteActorScope) {
    const { actor } = scope;
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'CLINIC_ADMIN') return; // clinic scoping handled in route layer
    if (actor.role === 'PROFESSIONAL' && professionalId === String(actor.wpUserId)) return;
    throw new SessionNoteAccessError('Not allowed to read this session note', 403);
  }

  private async assertCanEdit(note: SessionNoteDTO, scope: SessionNoteActorScope) {
    const { actor } = scope;
    if (actor.role === 'SUPER_ADMIN') return; // admins may force-unlock in extreme cases
    if (actor.role !== 'PROFESSIONAL') {
      throw new SessionNoteAccessError('Only the assigned professional can edit session notes', 403);
    }
    if (note.professionalId !== String(actor.wpUserId)) {
      throw new SessionNoteAccessError('Professional did not create this session note', 403);
    }
    if (note.status === 'CLOSED') {
      throw new SessionNoteAccessError('Session note is closed and cannot be edited', 409);
    }

    // Lock once the session itself is no longer editable.
    const session = note.sessionId ? await findSessionById(Number(note.sessionId)) : null;
    if (session && LOCKED_SESSION_STATUSES.includes(session.status)) {
      throw new SessionNoteAccessError(
        'Session note is locked because the session is no longer editable',
        409,
      );
    }
  }

  private assertCanClose(professionalId: string, scope: SessionNoteActorScope) {
    const { actor } = scope;
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role !== 'PROFESSIONAL') {
      throw new SessionNoteAccessError(
        'Only the assigned professional can close session notes',
        403,
      );
    }
    if (professionalId !== String(actor.wpUserId)) {
      throw new SessionNoteAccessError('Professional did not create this session note', 403);
    }
  }
}
