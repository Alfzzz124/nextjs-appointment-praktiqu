/**
 * Session service — business logic for booking, lifecycle, and queries.
 *
 * Source of truth: specs/005-session-mgmt/data-model.md
 *
 * The service is the single chokepoint for:
 *   - status transition validation (T008)
 *   - client INACTIVE blocking (T009)
 *   - professional off-day validation (T010)
 *   - practice holiday validation (T011)
 *   - AUDIT logging on every status change (T012)
 *   - double-booking guard (delegated to double-booking-check.ts)
 *
 * All API route handlers MUST go through this service — never mutate the
 * Session table directly.
 */

import {
  Prisma,
  SessionStatus,
  UserRole,
  type Session as SessionRow,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import {
  createSessionWithDoubleBookingGuard,
  DoubleBookingError,
  type SlotCandidate,
} from './double-booking-check';
import {
  canTransition,
  type CalendarResponse,
  type CalendarView,
  type CreateSessionInput,
  type PaginatedResponse,
  type SessionEntity,
  type SessionListFilters,
  type SessionWithRelations,
  STATUS_COLOR,
} from '@/types/session';

export class SessionServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SessionServiceError';
    this.code = code;
    this.status = status;
  }
}

interface Actor {
  userId: string;
  role: UserRole;
  practiceId: string | null;
}

interface CreateArgs {
  actor: Actor;
  input: CreateSessionInput;
  /** Force BOOKED status (used by staff bookings); otherwise PENDING. */
  forceBooked?: boolean;
  /** Optional override of createdBy (defaults to actor.userId). */
  createdBy?: string;
}

interface TransitionArgs {
  actor: Actor;
  sessionId: string;
  target: SessionStatus;
  reason?: string;
}

const MS_PER_MIN = 60_000;

/* -------------------------------------------------------------------------- */
/*                                READ HELPERS                                */
/* -------------------------------------------------------------------------- */

function toEntity(row: SessionRow): SessionEntity {
  return {
    id: row.id,
    clientId: row.clientId,
    professionalId: row.professionalId,
    serviceId: row.serviceId,
    practiceId: row.practiceId,
    slotDate: row.slotDate.toISOString().slice(0, 10),
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    status: row.status,
    rejectionReason: row.rejectionReason,
    cancellationReason: row.cancellationReason,
    checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : null,
    checkedOutAt: row.checkedOutAt ? row.checkedOutAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SESSION_INCLUDE = {
  client: {
    include: {
      user: { select: { firstName: true, lastName: true, email: true, basicData: true } },
    },
  },
  professional: {
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  },
  service: { select: { id: true, name: true, duration: true } },
} satisfies Prisma.SessionInclude;

type SessionWithIncluded = Prisma.SessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

function toEntityWithRelations(row: SessionWithIncluded): SessionWithRelations {
  const fullName =
    `${row.client.user.firstName ?? ''} ${row.client.user.lastName ?? ''}`.trim() ||
    row.client.user.displayNameFallback();
  const profName =
    `${row.professional.user.firstName ?? ''} ${row.professional.user.lastName ?? ''}`.trim();

  // best-effort mobile: look in basicData JSON (KiviCare stores mobile_number there)
  const basic = (row.client.user.basicData as Record<string, unknown> | null) ?? null;
  const mobile = typeof basic?.mobileNumber === 'string' ? (basic.mobileNumber as string) : null;

  return {
    ...toEntity(row),
    client: {
      id: row.client.id,
      fullName,
      uniqueClientId: row.client.patientUniqueId ?? null,
      mobileNumber: mobile,
      email: row.client.user.email,
    },
    professional: {
      id: row.professional.id,
      fullName: profName,
      email: row.professional.user.email,
    },
    service: {
      id: row.service.id,
      name: row.service.name,
      durationMinutes: row.service.duration,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                              ACCESS GUARDS                                 */
/* -------------------------------------------------------------------------- */

async function assertCanView(actor: Actor, row: SessionWithIncluded): Promise<void> {
  const role = actor.role;
  if (role === UserRole.SUPER_ADMIN) return;
  if (role === UserRole.CLINIC_ADMIN || role === UserRole.RECEPTIONIST) {
    if (actor.practiceId && row.practiceId === actor.practiceId) return;
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  if (role === UserRole.PROFESSIONAL) {
    if (row.professional.userId === actor.userId) return;
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  if (role === UserRole.CLIENT) {
    if (row.client.userId === actor.userId) return;
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  throw new SessionServiceError('forbidden', 'Not authorized', 403);
}

function assertCanMutate(actor: Actor, row: SessionWithIncluded): void {
  const role = actor.role;
  if (role === UserRole.SUPER_ADMIN) return;
  if (role === UserRole.CLINIC_ADMIN || role === UserRole.RECEPTIONIST) {
    if (actor.practiceId && row.practiceId === actor.practiceId) return;
    throw new SessionServiceError('forbidden', 'Not authorized for this practice', 403);
  }
  if (role === UserRole.PROFESSIONAL) {
    if (row.professional.userId === actor.userId) return;
    throw new SessionServiceError('forbidden', 'You can only manage your own sessions', 403);
  }
  if (role === UserRole.CLIENT) {
    if (row.client.userId === actor.userId) return;
    throw new SessionServiceError('forbidden', 'You can only manage your own sessions', 403);
  }
  throw new SessionServiceError('forbidden', 'Not authorized', 403);
}

/* -------------------------------------------------------------------------- */
/*                              CREATE / BOOK                                 */
/* -------------------------------------------------------------------------- */

export async function createSession(args: CreateArgs): Promise<SessionWithRelations> {
  const { actor, input, forceBooked = false, createdBy } = args;

  // T042: detect staff vs client booking from JWT role.
  const isStaff =
    actor.role === UserRole.RECEPTIONIST ||
    actor.role === UserRole.CLINIC_ADMIN ||
    actor.role === UserRole.SUPER_ADMIN;
  const isClient = actor.role === UserRole.CLIENT;
  if (!isStaff && !isClient) {
    throw new SessionServiceError(
      'forbidden',
      'Only clients and staff can create sessions',
      403,
    );
  }

  // Clients can only book for themselves.
  if (isClient) {
    const clientRow = await prisma.patient.findUnique({
      where: { id: input.clientId },
      select: { userId: true },
    });
    if (!clientRow) {
      throw new SessionServiceError('not_found', 'Client not found', 404);
    }
    if (clientRow.userId !== actor.userId) {
      throw new SessionServiceError('forbidden', 'Clients can only book for themselves', 403);
    }
  }

  // T009: client INACTIVE blocking (FR-008 from feature 004).
  const client = await prisma.patient.findUnique({
    where: { id: input.clientId },
    select: { id: true, userId: true, status: true, user: { select: { status: true } } },
  });
  if (!client) {
    throw new SessionServiceError('not_found', 'Client not found', 404);
  }
  const clientActive = (client.status === 1) && (client.user.status === 1);
  if (!clientActive) {
    throw new SessionServiceError(
      'account_inactive',
      'Account inactive. Please contact the practice.',
      403,
    );
  }

  // Professional must exist and be active.
  const professional = await prisma.doctor.findUnique({
    where: { id: input.professionalId },
    select: { id: true, status: true },
  });
  if (!professional || professional.status !== 1) {
    throw new SessionServiceError(
      'professional_inactive',
      'Professional is not available',
      400,
    );
  }

  // Service lookup (for duration + practice).
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { id: true, duration: true, clinicId: true },
  });
  if (!service) {
    throw new SessionServiceError('not_found', 'Service not found', 404);
  }
  if (!service.clinicId) {
    throw new SessionServiceError(
      'service_orphan',
      'Service is not attached to a practice',
      400,
    );
  }

  // Practice scoping: staff must operate within their own practice.
  if (isStaff) {
    if (!actor.practiceId || actor.practiceId !== service.clinicId) {
      throw new SessionServiceError('forbidden', 'Not authorized for this practice', 403);
    }
  }

  // T010: professional off-day check (re-validate on booking).
  // T011: practice holiday check.
  await assertNoOffDay(professional.id, input.slotDate);
  await assertNotHoliday(service.clinicId, input.slotDate);

  // Parse time bounds.
  const startTime = new Date(input.startTime);
  if (Number.isNaN(startTime.getTime())) {
    throw new SessionServiceError('invalid_time', 'startTime is not a valid datetime', 422);
  }
  const endTime = new Date(startTime.getTime() + service.duration * MS_PER_MIN);
  const slotDate = new Date(`${input.slotDate}T00:00:00.000Z`);

  const candidate: SlotCandidate = {
    clientId: input.clientId,
    professionalId: input.professionalId,
    serviceId: input.serviceId,
    practiceId: service.clinicId,
    slotDate,
    startTime,
    endTime,
    createdBy: createdBy ?? actor.userId,
  };

  let created;
  try {
    created = await createSessionWithDoubleBookingGuard(candidate);
  } catch (err) {
    if (err instanceof DoubleBookingError) {
      throw new SessionServiceError('double_booking', err.message, 409);
    }
    throw err;
  }

  // Staff booking promotes PENDING → BOOKED directly.
  let finalStatus = created.status;
  if (forceBooked || isStaff) {
    const updated = await prisma.session.update({
      where: { id: created.id },
      data: { status: SessionStatus.BOOKED },
      select: { id: true, status: true },
    });
    finalStatus = updated.status;
  }

  // T012: AUDIT log for the create.
  await logging.audit('session.created', {
    userId: actor.userId,
    resource: 'session',
    resourceId: created.id,
    action: 'session.created',
    metadata: {
      clientId: input.clientId,
      professionalId: input.professionalId,
      serviceId: input.serviceId,
      practiceId: service.clinicId,
      status: finalStatus,
      forced: forceBooked || isStaff,
    },
  });

  if (finalStatus === SessionStatus.PENDING) {
    await logging.audit('session.status_changed', {
      userId: actor.userId,
      resource: 'session',
      resourceId: created.id,
      action: 'session.status_changed',
      metadata: { from: null, to: SessionStatus.PENDING, reason: 'created' },
    });
  }

  const row = await prisma.session.findUniqueOrThrow({
    where: { id: created.id },
    include: SESSION_INCLUDE,
  });
  return toEntityWithRelations(row);
}

/* -------------------------------------------------------------------------- */
/*                                READ / LIST                                 */
/* -------------------------------------------------------------------------- */

export async function getSession(actor: Actor, id: string): Promise<SessionWithRelations> {
  const row = await prisma.session.findUnique({ where: { id }, include: SESSION_INCLUDE });
  if (!row) {
    throw new SessionServiceError('not_found', 'Session not found', 404);
  }
  await assertCanView(actor, row);
  return toEntityWithRelations(row);
}

export async function listSessions(
  actor: Actor,
  filters: SessionListFilters & { page: number; limit: number },
): Promise<PaginatedResponse<SessionWithRelations>> {
  const { page, limit, status, clientId, professionalId, serviceId, dateFrom, dateTo } = filters;

  const where: Prisma.SessionWhereInput = { AND: [] };

  // Role scoping
  if (actor.role === UserRole.SUPER_ADMIN) {
    // no extra filter
  } else if (actor.role === UserRole.CLINIC_ADMIN || actor.role === UserRole.RECEPTIONIST) {
    if (!actor.practiceId) {
      throw new SessionServiceError('forbidden', 'No practice on actor', 403);
    }
    (where.AND as Prisma.SessionWhereInput[]).push({ practiceId: actor.practiceId });
  } else if (actor.role === UserRole.PROFESSIONAL) {
    (where.AND as Prisma.SessionWhereInput[]).push({ professional: { userId: actor.userId } });
  } else if (actor.role === UserRole.CLIENT) {
    (where.AND as Prisma.SessionWhereInput[]).push({ client: { userId: actor.userId } });
  } else {
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }

  if (status) (where.AND as Prisma.SessionWhereInput[]).push({ status });
  if (clientId) (where.AND as Prisma.SessionWhereInput[]).push({ clientId });
  if (professionalId) (where.AND as Prisma.SessionWhereInput[]).push({ professionalId });
  if (serviceId) (where.AND as Prisma.SessionWhereInput[]).push({ serviceId });
  if (dateFrom || dateTo) {
    const range: Prisma.DateTimeFilter = {};
    if (dateFrom) range.gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999Z`);
    (where.AND as Prisma.SessionWhereInput[]).push({ slotDate: range });
  }

  const [total, rows] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: [{ slotDate: 'asc' }, { startTime: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map(toEntityWithRelations),
    pagination: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                            STATUS TRANSITIONS                              */
/* -------------------------------------------------------------------------- */

export async function transitionSession(args: TransitionArgs): Promise<SessionWithRelations> {
  const { actor, sessionId, target, reason } = args;

  return prisma.$transaction(async (tx) => {
    const row = await tx.session.findUnique({
      where: { id: sessionId },
      include: SESSION_INCLUDE,
    });
    if (!row) {
      throw new SessionServiceError('not_found', 'Session not found', 404);
    }

    // Role-specific permission checks
    switch (target) {
      case SessionStatus.BOOKED:
        // approve — professional/admin
        if (
          actor.role !== UserRole.SUPER_ADMIN &&
          actor.role !== UserRole.CLINIC_ADMIN &&
          !(actor.role === UserRole.PROFESSIONAL && row.professional.userId === actor.userId)
        ) {
          throw new SessionServiceError('forbidden', 'Not authorized to approve', 403);
        }
        break;
      case SessionStatus.REJECTED:
        if (
          actor.role !== UserRole.SUPER_ADMIN &&
          actor.role !== UserRole.CLINIC_ADMIN &&
          !(actor.role === UserRole.PROFESSIONAL && row.professional.userId === actor.userId)
        ) {
          throw new SessionServiceError('forbidden', 'Not authorized to reject', 403);
        }
        if (!reason || reason.trim().length === 0) {
          throw new SessionServiceError('reason_required', 'Rejection reason is required', 400);
        }
        break;
      case SessionStatus.CHECK_IN:
      case SessionStatus.CHECK_OUT:
        if (
          actor.role !== UserRole.CLINIC_ADMIN &&
          actor.role !== UserRole.RECEPTIONIST &&
          actor.role !== UserRole.SUPER_ADMIN
        ) {
          throw new SessionServiceError('forbidden', 'Not authorized to check in/out', 403);
        }
        if (
          (actor.role === UserRole.CLINIC_ADMIN || actor.role === UserRole.RECEPTIONIST) &&
          (!actor.practiceId || actor.practiceId !== row.practiceId)
        ) {
          throw new SessionServiceError('forbidden', 'Not authorized for this practice', 403);
        }
        break;
      case SessionStatus.CANCELLED:
        if (
          actor.role === UserRole.PROFESSIONAL ||
          actor.role === UserRole.SUPER_ADMIN
        ) {
          throw new SessionServiceError('forbidden', 'Professionals cannot cancel', 403);
        }
        if (actor.role === UserRole.CLIENT) {
          if (row.client.userId !== actor.userId) {
            throw new SessionServiceError('forbidden', 'Not your session', 403);
          }
        }
        if (
          (actor.role === UserRole.CLINIC_ADMIN || actor.role === UserRole.RECEPTIONIST) &&
          (!actor.practiceId || actor.practiceId !== row.practiceId)
        ) {
          throw new SessionServiceError('forbidden', 'Not authorized for this practice', 403);
        }
        break;
      default:
        break;
    }

    // T008: validate transition
    if (!canTransition(row.status, target)) {
      throw new SessionServiceError(
        'invalid_transition',
        `Cannot transition session from ${row.status} to ${target}`,
        400,
      );
    }

    // Build update payload
    const data: Prisma.SessionUpdateInput = { status: target };
    if (target === SessionStatus.REJECTED) {
      data.rejectionReason = reason ?? null;
    }
    if (target === SessionStatus.CANCELLED) {
      data.cancellationReason = reason ?? null;
    }
    if (target === SessionStatus.CHECK_IN) {
      data.checkedInAt = new Date();
    }
    if (target === SessionStatus.CHECK_OUT) {
      data.checkedOutAt = new Date();
    }

    const updated = await tx.session.update({
      where: { id: sessionId },
      data,
      include: SESSION_INCLUDE,
    });

    // T012: AUDIT log
    await logging.audit('session.status_changed', {
      userId: actor.userId,
      resource: 'session',
      resourceId: sessionId,
      action: 'session.status_changed',
      metadata: { from: row.status, to: target, reason: reason ?? null },
    });

    return toEntityWithRelations(updated);
  });
}

/* -------------------------------------------------------------------------- */
/*                              PENDING QUEUE                                 */
/* -------------------------------------------------------------------------- */

export async function listPendingForProfessional(
  actor: Actor,
  page: number,
  limit: number,
): Promise<PaginatedResponse<SessionWithRelations>> {
  if (
    actor.role !== UserRole.SUPER_ADMIN &&
    actor.role !== UserRole.CLINIC_ADMIN &&
    actor.role !== UserRole.PROFESSIONAL
  ) {
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  const where: Prisma.SessionWhereInput = { status: SessionStatus.PENDING };
  if (actor.role === UserRole.PROFESSIONAL) {
    where.professional = { userId: actor.userId };
  } else if (actor.role === UserRole.CLINIC_ADMIN) {
    if (!actor.practiceId) {
      throw new SessionServiceError('forbidden', 'No practice on actor', 403);
    }
    where.practiceId = actor.practiceId;
  }

  const [total, rows] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map(toEntityWithRelations),
    pagination: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                CALENDAR                                    */
/* -------------------------------------------------------------------------- */

export async function getCalendar(
  actor: Actor,
  view: CalendarView,
  date: Date,
  professionalId: string | null,
): Promise<CalendarResponse> {
  const { start, end } = rangeForView(view, date);

  const where: Prisma.SessionWhereInput = {
    slotDate: { gte: start, lte: end },
  };
  if (actor.role === UserRole.SUPER_ADMIN) {
    if (professionalId) where.professionalId = professionalId;
  } else if (actor.role === UserRole.CLINIC_ADMIN || actor.role === UserRole.RECEPTIONIST) {
    if (!actor.practiceId) {
      throw new SessionServiceError('forbidden', 'No practice on actor', 403);
    }
    where.practiceId = actor.practiceId;
    if (professionalId) where.professionalId = professionalId;
  } else if (actor.role === UserRole.PROFESSIONAL) {
    where.professional = { userId: actor.userId };
    if (professionalId) where.professionalId = professionalId;
  } else {
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }

  const rows = await prisma.session.findMany({
    where,
    include: SESSION_INCLUDE,
    orderBy: { startTime: 'asc' },
  });

  return {
    view,
    date: date.toISOString().slice(0, 10),
    sessions: rows.map((r) => {
      const profName =
        `${r.professional.user.firstName ?? ''} ${r.professional.user.lastName ?? ''}`.trim();
      const cliName =
        `${r.client.user.firstName ?? ''} ${r.client.user.lastName ?? ''}`.trim();
      return {
        id: r.id,
        startTime: r.startTime.toISOString().slice(11, 16),
        endTime: r.endTime.toISOString().slice(11, 16),
        client: cliName,
        service: r.service.name,
        status: r.status,
        statusColor: STATUS_COLOR[r.status],
        professionalId: r.professionalId,
        professionalName: profName,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/*                            OFF-DAY / HOLIDAY                               */
/* -------------------------------------------------------------------------- */

async function assertNoOffDay(professionalId: string, slotDateISO: string): Promise<void> {
  const slotDate = new Date(`${slotDateISO}T00:00:00.000Z`);
  // DoctorSession.dayOfWeek is 0-6; we compare by the UTC weekday of slotDate.
  const dow = slotDate.getUTCDay();
  const offDay = await prisma.doctorSession.findFirst({
    where: { doctorId: professionalId, dayOfWeek: dow, status: 0 },
    select: { id: true },
  });
  if (offDay) {
    throw new SessionServiceError(
      'professional_off_day',
      'The professional is off on this day',
      400,
    );
  }
}

async function assertNotHoliday(practiceId: string, slotDateISO: string): Promise<void> {
  const day = new Date(`${slotDateISO}T00:00:00.000Z`);
  const holiday = await prisma.holiday.findFirst({
    where: {
      moduleType: 'clinic',
      moduleId: practiceId,
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { id: true, title: true },
  });
  if (holiday) {
    throw new SessionServiceError(
      'holiday',
      `The practice is closed for ${holiday.title} on this day`,
      400,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                         PROFESSIONAL OFF-DAY HOOK                          */
/* -------------------------------------------------------------------------- */

/**
 * When a professional's off-day is updated (feature 002), all PENDING
 * sessions for that professional on the affected date are auto-cancelled
 * with reason "Professional unavailable".
 *
 * Called from the professional management flow; uses AUDIT logging with
 * actor = "system" to attribute the invalidation.
 */
export async function invalidatePendingForOffDay(
  professionalId: string,
  slotDateISO: string,
): Promise<number> {
  const slotDate = new Date(`${slotDateISO}T00:00:00.000Z`);
  const result = await prisma.$transaction(async (tx) => {
    const pending = await tx.session.findMany({
      where: {
        professionalId,
        slotDate,
        status: SessionStatus.PENDING,
      },
      select: { id: true, status: true },
    });
    if (pending.length === 0) return [] as string[];

    await tx.session.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: {
        status: SessionStatus.CANCELLED,
        cancellationReason: 'Professional unavailable',
      },
    });
    return pending.map((p) => p.id);
  });

  for (const id of result) {
    await logging.audit('session.status_changed', {
      userId: null,
      resource: 'session',
      resourceId: id,
      action: 'session.status_changed',
      metadata: {
        from: SessionStatus.PENDING,
        to: SessionStatus.CANCELLED,
        reason: 'Professional unavailable (off-day updated)',
        system: true,
      },
    });
  }

  return result.length;
}

/* -------------------------------------------------------------------------- */
/*                            AUTO-COMPLETION                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mark all CHECK_OUT sessions older than the given threshold as COMPLETED.
 * Returns the number of sessions updated.
 */
export async function autoCompleteOldSessions(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const candidates = await prisma.session.findMany({
    where: {
      status: SessionStatus.CHECK_OUT,
      checkedOutAt: { lt: cutoff },
    },
    select: { id: true },
  });
  if (candidates.length === 0) return 0;

  await prisma.session.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { status: SessionStatus.COMPLETED },
  });

  for (const c of candidates) {
    await logging.audit('session.status_changed', {
      userId: null,
      resource: 'session',
      resourceId: c.id,
      action: 'session.status_changed',
      metadata: {
        from: SessionStatus.CHECK_OUT,
        to: SessionStatus.COMPLETED,
        reason: 'auto-completion (>24h past check-out)',
        system: true,
      },
    });
  }

  return candidates.length;
}

/* -------------------------------------------------------------------------- */
/*                                HELPERS                                     */
/* -------------------------------------------------------------------------- */

function rangeForView(view: CalendarView, date: Date): { start: Date; end: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (view === 'day') {
    const start = new Date(d);
    const end = new Date(d);
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
    return { start, end };
  }
  if (view === 'week') {
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
    return { start, end };
  }
  // month
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

export { assertCanMutate };
