/**
 * Session Notes service — feature 008.
 *
 * Responsibilities:
 *   - Enforce note-creation rules (only on CHECK_IN/CHECK_OUT sessions).
 *   - Enforce authorship (only the professional on the session writes).
 *   - Lock notes when the session is COMPLETED or the note is closed.
 *   - Build & persist the 200-char summary for feature 014.
 *   - Emit audit events on every create / update / close.
 *
 * Spec source: specs/008-session-notes/spec.md, plan.md.
 */

import type { PrismaClient } from '@prisma/client';
import { logging } from '@/lib/logging';
import { listClinicMembers } from '@/repositories/wp/clinics.repo';
import {
  SESSION_STATUS,
  findSessionById,
  listSessions,
  type SessionStatus,
} from '@/repositories/wp/sessions.repo';
import {
  type CreateSessionNoteInput,
  type UpdateSessionNoteInput,
  type ListSessionNotesQuery,
  buildSummary,
  formatSoapToContent,
} from './validation';

export const SESSION_NOTE_SUMMARY_MAX = 200;

/** Sessions in these statuses can have notes created / edited. */
const EDITABLE_SESSION_STATUSES: SessionStatus[] = [
  SESSION_STATUS.CHECK_IN,
  SESSION_STATUS.CHECK_OUT,
];

/** Sessions in these statuses lock the note. */
const LOCKED_SESSION_STATUSES: SessionStatus[] = [SESSION_STATUS.CANCELLED];

/**
 * How many of a client's sessions the `clientId` filter considers.
 *
 * `session_notes.sessionId` is a plain string column with no relation to
 * `wp_kc_appointments`, so filtering by client means resolving their session ids first.
 * One client's history fits well inside this; a practice's would not, which is why
 * clinic scoping goes through professionals instead.
 */
const CLIENT_SESSION_LOOKUP_CAP = 500;

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
   * Authorship is compared on this, not on `userId`: a note's `professionalId` is a
   * KiviCare doctor id, and the two id spaces do not match.
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

export class SessionNoteService {
  constructor(private prisma: PrismaClient) {}

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  async create(input: CreateSessionNoteInput, scope: SessionNoteActorScope) {
    const session = await findSessionById(Number(input.sessionId));

    if (!session) {
      throw new SessionNoteAccessError('Session not found', 404);
    }

    this.assertCanCreate(session, scope);

    const existing = await this.prisma.sessionNote.findUnique({
      where: { sessionId: input.sessionId },
    });
    if (existing) {
      throw new SessionNoteAccessError(
        'Session notes already exist for this session',
        409,
      );
    }

    const content = input.soap
      ? formatSoapToContent(input.soap)
      : (input.content ?? '');

    const note = await this.prisma.sessionNote.create({
      data: {
        sessionId: input.sessionId,
        // Stored as text: the column has no FK and never did. The value is now the
        // KiviCare doctor id (wp_users.ID) rather than a `doctors` cuid.
        professionalId: String(session.professionalId),
        content,
        summary: buildSummary(content, SESSION_NOTE_SUMMARY_MAX),
      },
    });

    await logging.audit('session_note.create', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: note.id,
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: '/api/v1/session-notes',
      method: 'POST',
      statusCode: 201,
      metadata: { sessionId: note.sessionId, professionalId: note.professionalId },
    });

    return note;
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async getById(id: string, scope: SessionNoteActorScope) {
    const note = await this.prisma.sessionNote.findUnique({ where: { id } });
    if (!note) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    this.assertCanRead(note.professionalId, scope);
    return note;
  }

  async getBySessionId(sessionId: string, scope: SessionNoteActorScope) {
    const note = await this.prisma.sessionNote.findUnique({
      where: { sessionId },
    });
    if (!note) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    this.assertCanRead(note.professionalId, scope);
    return note;
  }

  // ---------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------

  async list(query: ListSessionNotesQuery, scope: SessionNoteActorScope) {
    const where: Record<string, unknown> = {};
    const { actor } = scope;

    // RBAC scoping: professionals see only their own; CLINIC_ADMIN / SUPER_ADMIN
    // see all notes within their clinic / globally.
    if (actor.role === 'PROFESSIONAL') {
      where.professionalId = String(actor.wpUserId);
    } else if (actor.role === 'CLINIC_ADMIN' && scope.clinicId) {
      // Scoped by the clinic's professionals, not by its sessions. The old query
      // loaded every appointment id in the clinic into one IN list, which grows
      // without bound; the doctor roster is a handful of rows and gives the same
      // answer, since a note's author is by definition the session's doctor.
      const members = await listClinicMembers(BigInt(scope.clinicId));
      const doctorIds = members
        .filter((m) => m.role === 'doctor')
        .map((m) => m.userId.toString());
      // A clinic with no doctors must see nothing, not everything.
      where.professionalId = { in: doctorIds };
    } else if (actor.role !== 'SUPER_ADMIN') {
      // RECEPTIONIST / CLIENT → no listing access.
      return { data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: query.limit } };
    }

    if (query.status) where.status = query.status;
    if (query.clientId) {
      const { items } = await listSessions({
        page: 1,
        perPage: CLIENT_SESSION_LOOKUP_CAP,
        clientId: Number(query.clientId),
      });
      where.sessionId = { in: items.map((s) => String(s.id)) };
    }
    if (query.search) {
      where.content = { contains: query.search };
    }

    const total = await this.prisma.sessionNote.count({ where });
    const items = await this.prisma.sessionNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      data: items,
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

  async update(
    id: string,
    input: UpdateSessionNoteInput,
    scope: SessionNoteActorScope,
  ) {
    const note = await this.prisma.sessionNote.findUnique({ where: { id } });
    if (!note) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    // Awaited: without it the promise was dropped and the "session is locked" check
    // never blocked an edit — the authorship checks inside threw into nothing too.
    await this.assertCanEdit(note, scope);

    const content = input.soap ? formatSoapToContent(input.soap) : (input.content ?? '');

    const updated = await this.prisma.sessionNote.update({
      where: { id },
      data: {
        content,
        summary: buildSummary(content, SESSION_NOTE_SUMMARY_MAX),
      },
    });

    await logging.audit('session_note.update', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: id,
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: `/api/v1/session-notes/${id}`,
      method: 'PATCH',
      statusCode: 200,
    });

    return updated;
  }

  // ---------------------------------------------------------------------
  // Close (lock)
  // ---------------------------------------------------------------------

  async close(id: string, scope: SessionNoteActorScope) {
    const note = await this.prisma.sessionNote.findUnique({ where: { id } });
    if (!note) {
      throw new SessionNoteAccessError('Session note not found', 404);
    }
    if (note.status === 'CLOSED') {
      return note; // idempotent
    }
    this.assertCanClose(note, scope);

    const closed = await this.prisma.sessionNote.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    await logging.audit('session_note.close', {
      userId: scope.actor.userId,
      resource: 'session_note',
      resourceId: id,
      ip: scope.actor.ip,
      userAgent: scope.actor.userAgent,
      requestId: scope.actor.requestId,
      path: `/api/v1/session-notes/${id}/close`,
      method: 'POST',
      statusCode: 200,
    });

    return closed;
  }

  // ---------------------------------------------------------------------
  // Authorization helpers
  // ---------------------------------------------------------------------

  private assertCanCreate(
    session: { status: SessionStatus; professionalId: number; clinicId: number },
    scope: SessionNoteActorScope,
  ) {
    const { actor } = scope;

    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
      throw new SessionNoteAccessError(
        'Only the assigned professional can create session notes',
        403,
      );
    }

    if (actor.role === 'PROFESSIONAL' && session.professionalId !== actor.wpUserId) {
      throw new SessionNoteAccessError(
        'Professional is not assigned to this session',
        403,
      );
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

  private async assertCanEdit(
    note: { status: string; professionalId: string; sessionId: string },
    scope: SessionNoteActorScope,
  ) {
    const { actor } = scope;
    if (actor.role === 'SUPER_ADMIN') return; // admins may force-unlock in extreme cases
    if (actor.role !== 'PROFESSIONAL') {
      throw new SessionNoteAccessError(
        'Only the assigned professional can edit session notes',
        403,
      );
    }
    if (note.professionalId !== String(actor.wpUserId)) {
      throw new SessionNoteAccessError(
        'Professional did not create this session note',
        403,
      );
    }
    if (note.status === 'CLOSED') {
      throw new SessionNoteAccessError(
        'Session note is closed and cannot be edited',
        409,
      );
    }
    // Lock once the session is no longer editable.
    const session = await findSessionById(Number(note.sessionId));
    if (session && LOCKED_SESSION_STATUSES.includes(session.status)) {
      throw new SessionNoteAccessError(
        'Session note is locked because the session is no longer editable',
        409,
      );
    }
  }

  private assertCanClose(
    note: { professionalId: string },
    scope: SessionNoteActorScope,
  ) {
    const { actor } = scope;
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role !== 'PROFESSIONAL') {
      throw new SessionNoteAccessError(
        'Only the assigned professional can close session notes',
        403,
      );
    }
    if (note.professionalId !== String(actor.wpUserId)) {
      throw new SessionNoteAccessError(
        'Professional did not create this session note',
        403,
      );
    }
  }
}
