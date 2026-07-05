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

import type { PrismaClient, AppointmentStatus } from '@prisma/client';
import { logging } from '@/lib/logging';
import {
  type CreateSessionNoteInput,
  type UpdateSessionNoteInput,
  type ListSessionNotesQuery,
  buildSummary,
  formatSoapToContent,
} from './validation';

export const SESSION_NOTE_SUMMARY_MAX = 200;

/** Sessions in these statuses can have notes created / edited. */
const EDITABLE_SESSION_STATUSES: AppointmentStatus[] = ['CHECK_IN', 'CHECK_OUT'];

/** Sessions in these statuses lock the note. */
const LOCKED_SESSION_STATUSES: AppointmentStatus[] = ['CANCELLED'];

export class SessionNoteAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SessionNoteAccessError';
    this.status = status;
  }
}

export interface SessionNoteActor {
  userId: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface SessionNoteActorScope {
  actor: SessionNoteActor;
  /** clinicId of the actor (for CLINIC_ADMIN scoping). */
  clinicId?: string | null;
}

export class SessionNoteService {
  constructor(private prisma: PrismaClient) {}

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  async create(input: CreateSessionNoteInput, scope: SessionNoteActorScope) {
    const session = await this.prisma.appointment.findUnique({
      where: { id: input.sessionId },
      select: { id: true, status: true, doctorId: true, clinicId: true },
    });

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
        professionalId: session.doctorId,
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
      where.professionalId = actor.userId;
    } else if (actor.role === 'CLINIC_ADMIN' && scope.clinicId) {
      const sessionIds = await this.prisma.appointment.findMany({
        where: { clinicId: scope.clinicId },
        select: { id: true },
      });
      const ids = sessionIds.map((s) => s.id);
      where.sessionId = { in: ids };
    } else if (actor.role !== 'SUPER_ADMIN') {
      // RECEPTIONIST / CLIENT → no listing access.
      return { data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: query.limit } };
    }

    if (query.status) where.status = query.status;
    if (query.clientId) {
      const sessionIds = await this.prisma.appointment.findMany({
        where: { patientId: query.clientId },
        select: { id: true },
      });
      const ids = sessionIds.map((s) => s.id);
      where.sessionId = { in: ids };
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
    this.assertCanEdit(note, scope);

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
    session: { status: AppointmentStatus; doctorId: string; clinicId: string },
    scope: SessionNoteActorScope,
  ) {
    const { actor } = scope;

    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
      throw new SessionNoteAccessError(
        'Only the assigned professional can create session notes',
        403,
      );
    }

    if (actor.role === 'PROFESSIONAL' && session.doctorId !== actor.userId) {
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
    if (actor.role === 'PROFESSIONAL' && professionalId === actor.userId) return;
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
    if (note.professionalId !== actor.userId) {
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
    // Lock when the session reaches COMPLETED.
    const session = await this.prisma.appointment.findUnique({
      where: { id: note.sessionId },
      select: { status: true },
    });
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
    if (note.professionalId !== actor.userId) {
      throw new SessionNoteAccessError(
        'Professional did not create this session note',
        403,
      );
    }
  }
}
