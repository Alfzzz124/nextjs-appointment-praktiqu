/**
 * Session service — backed by `wp_kc_appointments`, not the shadow tables.
 *
 * A session IS a KiviCare appointment. Our schema carried TWO copies of that table
 * (`sessions_booking` and `appointments`); neither should exist. See
 * docs/architecture/shadow-tables-audit.md.
 *
 *  - Reads  → `repositories/wp/sessions.repo.ts`
 *  - Writes → `repositories/wp/appointments.write.ts` → plugin REST, because
 *             `kc_after_create_appointment` has five listeners (booking email, Pro
 *             custom fields, followup scheduling) and cancellation drives the
 *             cancellation email and telemed teardown.
 *
 * Ids are `number`. Statuses are KiviCare's five — see sessions.repo.ts for why
 * COMPLETED and REJECTED are gone.
 *
 * Two things the shadow table stored have no KiviCare column, and are NOT faked:
 * the `checkedInAt`/`checkedOutAt` timestamps are simply gone (KiviCare records only
 * the status), and the cancellation reason now lives in the audit log, which is
 * app-native and stays.
 */

import { logging } from '@/lib/logging';
import { resolveKcActor, type KcActor } from '@/services/billing/kc-actor';
import type { Actor } from '@/lib/auth';
import {
  SESSION_STATUS,
  canTransition,
  findSessionById,
  listSessions as listSessionRows,
  normaliseStatus,
  setSessionStatusDirect,
  toKcStatus,
  type SessionRow,
  type SessionStatus,
} from '@/repositories/wp/sessions.repo';
import {
  cancelAppointment,
  createAppointment,
  setAppointmentStatus,
} from '@/repositories/wp/appointments.write';
import { findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { PROFESSIONAL_STATUS, findDoctorById } from '@/repositories/wp/doctors.repo';
import { CLIENT_STATUS, findPatientById } from '@/repositories/wp/patients.repo';
import { isOffOn, listClinicOffDays, listDoctorOffDays } from '@/repositories/wp/off-days.repo';

export { SESSION_STATUS, canTransition, normaliseStatus };
export type { SessionStatus };

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class SessionServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface Session {
  id: number;
  clinicId: number;
  professionalId: number;
  clientId: number;
  /** `YYYY-MM-DD` local clinic date. */
  slotDate: string | null;
  /** `HH:MM:SS` local clinic time. */
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  status: SessionStatus;
  serviceIds: number[];
  description: string | null;
  createdAt: Date;
}

export interface SessionWithRelations extends Session {
  professionalName: string;
  clientName: string;
  clientEmail: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { currentPage: number; totalPages: number; totalItems: number; itemsPerPage: number };
}

export type CalendarView = 'day' | 'week' | 'month';

export interface CalendarResponse {
  view: CalendarView;
  date: string;
  sessions: Array<{
    id: number;
    slotDate: string | null;
    startTime: string | null;
    endTime: string | null;
    client: string;
    status: SessionStatus;
    statusColor: string;
    professionalId: number;
    professionalName: string;
  }>;
}

/** UI badge colours, one per remaining status. */
export const STATUS_COLOR: Record<SessionStatus, string> = {
  PENDING: '#eab308',
  BOOKED: '#22c55e',
  CHECK_IN: '#3b82f6',
  CHECK_OUT: '#8b5cf6',
  CANCELLED: '#6b7280',
};

export interface CreateSessionInput {
  clientId: number;
  professionalId: number;
  serviceId: number;
  clinicId?: number;
  /** `YYYY-MM-DD`. */
  slotDate: string;
  /** `HH:MM:SS` local clinic time. */
  startTime: string;
}

export interface SessionListFilters {
  page?: number;
  limit?: number;
  professionalId?: number;
  clientId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function toSession(r: SessionRow): SessionWithRelations {
  return { ...r };
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

/**
 * The clinic an actor is confined to; `null` means unrestricted (SUPER_ADMIN).
 *
 * A scoped actor with no clinic resolves to `-1`, a clinic id that matches nothing,
 * rather than to "no filter" — the latter would widen an access boundary to every
 * clinic in the install.
 */
function actorClinic(kc: KcActor): number | null {
  if (kc.actor.role === 'SUPER_ADMIN') return null;
  return kc.clinicId === null ? -1 : Number(kc.clinicId);
}

function assertCanRead(kc: KcActor, s: SessionRow): void {
  const role = kc.actor.role;
  if (role === 'SUPER_ADMIN') return;

  if (role === 'PROFESSIONAL') {
    if (s.professionalId === Number(kc.wpUserId)) return;
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  if (role === 'CLIENT') {
    if (s.clientId === Number(kc.wpUserId)) return;
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }
  // Clinic staff, scoped to their own clinic.
  if (kc.clinicId !== null && s.clinicId === Number(kc.clinicId)) return;
  throw new SessionServiceError('forbidden', 'Not authorized for this clinic', 403);
}

async function loadForActor(kc: KcActor, id: number): Promise<SessionRow> {
  const s = await findSessionById(id);
  if (!s) throw new SessionServiceError('not_found', 'Session not found', 404);
  assertCanRead(kc, s);
  return s;
}

/**
 * Reject a booking that falls on a closed day.
 *
 * A full-day closure blocks it outright; a time-specific one blocks only its own range,
 * so the caller's slot may still be fine. Treating a partial closure as a full one
 * would refuse bookable slots.
 */
async function assertNotOffDay(
  professionalId: number,
  clinicId: number,
  date: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const [doctorOff, clinicOff] = await Promise.all([
    listDoctorOffDays(BigInt(professionalId), { from: date, to: date }),
    listClinicOffDays(BigInt(clinicId), { from: date, to: date }),
  ]);

  const covering = [...doctorOff, ...clinicOff].filter((o) => isOffOn(o, date));
  if (covering.some((o) => !o.timeSpecific)) {
    throw new SessionServiceError('unavailable', 'The professional is unavailable on that date', 400);
  }

  const start = addMinutes(startTime, 0);
  for (const o of covering) {
    if (o.timeSpecific && o.startTime && o.endTime) {
      // Half-open overlap, matching the slot generator.
      if (o.startTime < endTime && o.endTime > start) {
        throw new SessionServiceError('unavailable', 'That time is blocked on this date', 400);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface CreateArgs {
  actor: Actor;
  input: CreateSessionInput;
  /** Staff bookings skip the pending queue and land BOOKED. */
  forceBooked?: boolean;
}

export async function createSession(args: CreateArgs): Promise<SessionWithRelations> {
  const { actor, input } = args;
  const kc = await resolveKcActor(actor);

  const isStaff = ['RECEPTIONIST', 'CLINIC_ADMIN', 'SUPER_ADMIN'].includes(actor.role);
  const isClient = actor.role === 'CLIENT';
  if (!isStaff && !isClient) {
    throw new SessionServiceError('forbidden', 'Only clients and staff can create sessions', 403);
  }

  if (!DATE_RE.test(input.slotDate)) {
    throw new SessionServiceError('invalid_date', 'slotDate must be YYYY-MM-DD', 422);
  }
  if (!TIME_RE.test(input.startTime)) {
    throw new SessionServiceError('invalid_time', 'startTime must be HH:MM:SS', 422);
  }

  if (isClient && input.clientId !== Number(kc.wpUserId)) {
    throw new SessionServiceError('forbidden', 'Clients can only book for themselves', 403);
  }

  const client = await findPatientById(BigInt(input.clientId));
  if (!client) throw new SessionServiceError('not_found', 'Client not found', 404);
  if (client.status !== CLIENT_STATUS.ACTIVE) {
    throw new SessionServiceError(
      'account_inactive',
      'Account inactive. Please contact the practice.',
      403,
    );
  }

  const professional = await findDoctorById(BigInt(input.professionalId));
  if (!professional || professional.status !== PROFESSIONAL_STATUS.ACTIVE) {
    throw new SessionServiceError('professional_inactive', 'Professional is not available', 400);
  }

  const clinicId = input.clinicId ?? (kc.clinicId !== null ? Number(kc.clinicId) : undefined);
  if (!clinicId) {
    throw new SessionServiceError('missing_clinic', 'clinicId is required', 400);
  }
  if (isStaff && kc.clinicId !== null && clinicId !== Number(kc.clinicId)) {
    throw new SessionServiceError('forbidden', 'Not authorized for this clinic', 403);
  }

  // The doctor's own mapping carries the duration that actually applies, which is also
  // what the patient is charged for.
  const assigned = await listServicesForDoctor({
    doctorId: BigInt(input.professionalId),
    clinicId: BigInt(clinicId),
  });
  const service = assigned.find((s) => Number(s.serviceId) === input.serviceId && s.isActive);
  if (!service) {
    throw new SessionServiceError(
      'service_unavailable',
      'Service is not offered by this professional',
      400,
    );
  }
  const endTime = addMinutes(input.startTime, service.durationMinutes ?? 30);

  await assertNotOffDay(input.professionalId, clinicId, input.slotDate, input.startTime, endTime);

  const clashes = await findConflictingAppointments({
    doctorId: BigInt(input.professionalId),
    date: input.slotDate,
    startTime: input.startTime,
    endTime,
  });
  if (clashes.length > 0) {
    throw new SessionServiceError('slot_taken', 'That slot is no longer available', 409);
  }

  // Staff bookings are confirmed; a client's own booking waits for approval. This also
  // decides whether KiviCare sends the "booked" email — it withholds it for PENDING.
  const status = args.forceBooked || isStaff ? SESSION_STATUS.BOOKED : SESSION_STATUS.PENDING;

  const created = await createAppointment({
    clinicId,
    doctorId: input.professionalId,
    patientId: input.clientId,
    startDate: input.slotDate,
    startTime: input.startTime,
    endDate: input.slotDate,
    endTime,
    serviceIds: [input.serviceId],
    status: toKcStatus(status),
  });

  await logging.audit('session.created', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(created.id),
    action: 'session.created',
    metadata: { status, clinicId, professionalId: input.professionalId, clientId: input.clientId },
  });

  const row = await findSessionById(created.id);
  if (!row) {
    throw new SessionServiceError(
      'readback_failed',
      'Session was created but could not be read back',
      502,
    );
  }
  return toSession(row);
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getSession(actor: Actor, id: number): Promise<SessionWithRelations> {
  const kc = await resolveKcActor(actor);
  return toSession(await loadForActor(kc, id));
}

export async function listSessions(
  actor: Actor,
  filters: SessionListFilters,
): Promise<PaginatedResponse<SessionWithRelations>> {
  const kc = await resolveKcActor(actor);
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const query: Parameters<typeof listSessionRows>[0] = {
    page,
    perPage: limit,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };

  // A professional or client sees only their own rows, whatever the query asks for.
  if (actor.role === 'PROFESSIONAL') {
    query.professionalId = Number(kc.wpUserId);
  } else if (actor.role === 'CLIENT') {
    query.clientId = Number(kc.wpUserId);
  } else {
    const clinic = actorClinic(kc);
    if (clinic !== null) query.clinicId = clinic;
    if (filters.professionalId !== undefined) query.professionalId = filters.professionalId;
    if (filters.clientId !== undefined) query.clientId = filters.clientId;
  }

  if (filters.status) {
    const s = normaliseStatus(filters.status);
    if (!s) {
      throw new SessionServiceError('invalid_status', `Unknown status "${filters.status}"`, 422);
    }
    query.statuses = [s];
  }

  const { items, total } = await listSessionRows(query);

  return {
    data: items.map(toSession),
    pagination: {
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

export async function listPendingForProfessional(
  actor: Actor,
  professionalId?: number,
): Promise<SessionWithRelations[]> {
  const kc = await resolveKcActor(actor);
  // A professional always sees their own queue, never another's.
  const target =
    actor.role === 'PROFESSIONAL' ? Number(kc.wpUserId) : (professionalId ?? Number(kc.wpUserId));

  const { items } = await listSessionRows({
    page: 1,
    perPage: 200,
    professionalId: target,
    statuses: [SESSION_STATUS.PENDING],
  });
  return items.map(toSession);
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

export interface TransitionArgs {
  actor: Actor;
  sessionId: number;
  target: SessionStatus;
  reason?: string;
}

export async function transitionSession(args: TransitionArgs): Promise<SessionWithRelations> {
  const { actor, sessionId, target, reason } = args;
  const kc = await resolveKcActor(actor);
  const row = await loadForActor(kc, sessionId);

  const isOwningProfessional =
    actor.role === 'PROFESSIONAL' && row.professionalId === Number(kc.wpUserId);
  const isAdmin = actor.role === 'SUPER_ADMIN' || actor.role === 'CLINIC_ADMIN';

  if (target === SESSION_STATUS.BOOKED && !isAdmin && !isOwningProfessional) {
    throw new SessionServiceError('forbidden', 'Not authorized to approve', 403);
  }
  if (
    (target === SESSION_STATUS.CHECK_IN || target === SESSION_STATUS.CHECK_OUT) &&
    !isAdmin &&
    actor.role !== 'RECEPTIONIST' &&
    !isOwningProfessional
  ) {
    throw new SessionServiceError('forbidden', 'Not authorized to change attendance', 403);
  }

  if (!canTransition(row.status, target)) {
    throw new SessionServiceError(
      'invalid_transition',
      `Cannot transition session from ${row.status} to ${target}`,
      400,
    );
  }

  // Through the plugin, so KiviCare's cancellation email and telemed teardown fire.
  await setAppointmentStatus(sessionId, toKcStatus(target));

  // The reason has no column in wp_kc_appointments, so it lives here. The audit log is
  // app-native and stays, which is why collapsing REJECTED into CANCELLED does not lose
  // the "why".
  await logging.audit('session.status_changed', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(sessionId),
    action: 'session.status_changed',
    metadata: { from: row.status, to: target, reason: reason ?? null },
  });

  const updated = await findSessionById(sessionId);
  if (!updated) throw new SessionServiceError('not_found', 'Session not found', 404);
  return toSession(updated);
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

function rangeForView(view: CalendarView, date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  if (view === 'day') return { from: date, to: date };

  if (view === 'week') {
    // Weeks start Monday, matching KiviCare's day slugs.
    const dow = (d.getUTCDay() + 6) % 7;
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - dow);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export async function getCalendar(
  actor: Actor,
  view: CalendarView,
  date: string,
  professionalId: number | null,
): Promise<CalendarResponse> {
  if (!DATE_RE.test(date)) {
    throw new SessionServiceError('invalid_date', 'date must be YYYY-MM-DD', 422);
  }
  const kc = await resolveKcActor(actor);
  const { from, to } = rangeForView(view, date);

  const query: Parameters<typeof listSessionRows>[0] = {
    page: 1,
    perPage: 200,
    dateFrom: from,
    dateTo: to,
  };

  if (actor.role === 'PROFESSIONAL') {
    query.professionalId = Number(kc.wpUserId);
  } else if (['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
    const clinic = actorClinic(kc);
    if (clinic !== null) query.clinicId = clinic;
    if (professionalId !== null) query.professionalId = professionalId;
  } else {
    throw new SessionServiceError('forbidden', 'Not authorized', 403);
  }

  const { items } = await listSessionRows(query);

  return {
    view,
    date,
    sessions: items.map((s) => ({
      id: s.id,
      slotDate: s.slotDate,
      startTime: s.startTime,
      endTime: s.endTime,
      client: s.clientName,
      status: s.status,
      statusColor: STATUS_COLOR[s.status],
      professionalId: s.professionalId,
      professionalName: s.professionalName,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Cancel PENDING sessions that fall on a newly-created off day.
 *
 * Uses the direct status write rather than the plugin: this can touch many rows at
 * once and firing a cancellation notification per row would flood the patient. The
 * audit entries are the record instead.
 */
export async function invalidatePendingForOffDay(
  professionalId: number,
  slotDate: string,
): Promise<number> {
  if (!DATE_RE.test(slotDate)) {
    throw new SessionServiceError('invalid_date', 'slotDate must be YYYY-MM-DD', 422);
  }

  const { items } = await listSessionRows({
    page: 1,
    perPage: 200,
    professionalId,
    date: slotDate,
    statuses: [SESSION_STATUS.PENDING],
  });

  for (const s of items) {
    await setSessionStatusDirect(s.id, SESSION_STATUS.CANCELLED);
    await logging.audit('session.status_changed', {
      userId: null,
      resource: 'session',
      resourceId: String(s.id),
      action: 'session.status_changed',
      metadata: {
        from: SESSION_STATUS.PENDING,
        to: SESSION_STATUS.CANCELLED,
        reason: 'Professional unavailable (off-day updated)',
        system: true,
      },
    });
  }

  return items.length;
}

/**
 * Cancel sessions in bulk.
 *
 * Sequential and through the plugin, so each cancellation fires KiviCare's hooks.
 * Failures are counted rather than thrown, so one bad id cannot abandon the batch.
 */
export async function bulkCancelSessions(ids: number[]): Promise<number> {
  let cancelled = 0;
  for (const id of ids) {
    try {
      await cancelAppointment(id);
      cancelled += 1;
    } catch {
      // Counted, not thrown — the returned number is the caller's signal.
    }
  }
  return cancelled;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface SessionExportParams {
  clinicId?: number;
  professionalId?: number;
  status?: SessionStatus;
  dateFrom?: string;
  dateTo?: string;
}

const EXPORT_PAGE = 200;

export async function exportSessions(params: SessionExportParams): Promise<SessionWithRelations[]> {
  const out: SessionWithRelations[] = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await listSessionRows({
      page,
      perPage: EXPORT_PAGE,
      clinicId: params.clinicId,
      professionalId: params.professionalId,
      statuses: params.status ? [params.status] : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    out.push(...items.map(toSession));
    // items.length === 0 also guards a total that shrinks mid-sweep.
    if (items.length === 0 || out.length >= total) break;
  }
  return out;
}
