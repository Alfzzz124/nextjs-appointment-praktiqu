/**
 * Psychologist approval for paid online bookings.
 *
 * A psychologist who switches it on (settings.ts) gets every paid public booking as a
 * request. The booking stays PENDING — its slot stays held, and KiviCare's booking mail,
 * the session reminders and Google Calendar all wait — until it is approved (BOOKED with
 * the payment, after which everything runs as for any paid booking) or rejected
 * (CANCELLED, with money to refund by hand).
 *
 * Every decision is claimed on session_approvals with a conditional UPDATE before the
 * appointment is touched, so an approve and a reject racing each other cannot both land.
 * If the appointment write then fails, the claim is undone.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md
 */
import type { Actor } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { jobs } from '@/lib/jobs/client';
import { logging } from '@/lib/logging';
import { getPublicAppUrl } from '@/lib/public-url';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { setAppointmentStatus, type ConfirmedPayment } from '@/repositories/wp/appointments.write';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { findServiceById } from '@/repositories/wp/services.repo';
import {
  SESSION_STATUS,
  findSessionById,
  listSessionsByIds,
  setSessionStatusDirect,
  type SessionRow,
  type SessionStatus,
} from '@/repositories/wp/sessions.repo';
import { resolveKcActor } from '@/services/billing/kc-actor';
import type { BuiltEmail } from '@/services/session/reminder-email';
import { sessionStartsAtUtc, syncSessionReminders } from '@/services/session/reminder-schedule';
import {
  buildClientAwaitingEmail,
  buildClientRejectedEmail,
  buildProfessionalRequestEmail,
  type SessionMailFacts,
} from './emails';
import { firstReminderAt, isOverdue } from './schedule';
import type { ApprovalSetting } from './settings';
import * as store from './store';

export const APPROVAL_REMINDER_HOOK = 'praktiqu_approval_reminder' as const;
export const APPROVAL_REMINDER_EVENT = 'approval.reminder' as const;

/**
 * Args for the hook. An OBJECT, never an array: the plugin's REST schema declares `args`
 * as `object`, and the two disagreeing once stopped every job from July to September.
 */
export function approvalReminderArgs(appointmentId: number): { appointmentId: number } {
  return { appointmentId };
}

export class ApprovalError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/** Where an email sends people: the FE page for one request, or the whole queue. */
export function approvalLink(appointmentId?: number): string {
  const tail = appointmentId !== undefined ? `/${appointmentId}` : '';
  return `${getPublicAppUrl()}/dashboard/persetujuan${tail}`;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export type Timed = Pick<SessionRow, 'id' | 'slotDate' | 'startTime' | 'timezone'>;

export interface ApprovalPayment {
  gateway: string;
  wcOrderId: number;
  expectedAmount: number;
  chargedAmount: number | null;
  chargedCurrency: string;
}

export interface ApprovalView {
  state: store.ApprovalState;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  rejectReason: string | null;
  refundStatus: store.RefundStatus;
  refundedAt: string | null;
  refundedByName: string | null;
  refundNote: string | null;
  /** AWAITING and the session has started: it can only be rejected now. */
  isOverdue: boolean;
  payment: ApprovalPayment | null;
}

/** What a client may see: no names, no internal reason, no order numbers. */
export interface PublicApprovalView {
  state: store.ApprovalState;
  requestedAt: string;
  decidedAt: string | null;
  refundStatus: store.RefundStatus;
  isOverdue: boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function overdue(a: store.ApprovalRecord, row: Timed, now: Date): boolean {
  return a.state === store.APPROVAL_STATE.AWAITING && isOverdue(sessionStartsAtUtc(row), now);
}

export async function approvalViews(rows: Timed[], now: Date = new Date()): Promise<Map<number, ApprovalView>> {
  const approvals = await store.findApprovals(rows.map((r) => r.id));
  if (approvals.size === 0) return new Map();

  const records = [...approvals.values()];
  const names = await store.userNames(records.flatMap((a) => [a.decidedBy, a.refundedBy]));
  const orders = await store.paymentOrdersByIds(
    records.flatMap((a) => (a.paymentOrderId ? [a.paymentOrderId] : [])),
  );

  const out = new Map<number, ApprovalView>();
  for (const row of rows) {
    const a = approvals.get(row.id);
    if (!a) continue;
    const order = a.paymentOrderId ? orders.get(a.paymentOrderId) : undefined;
    out.set(row.id, {
      state: a.state,
      requestedAt: a.requestedAt.toISOString(),
      decidedAt: iso(a.decidedAt),
      decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null,
      rejectReason: a.rejectReason,
      refundStatus: a.refundStatus,
      refundedAt: iso(a.refundedAt),
      refundedByName: a.refundedBy ? (names.get(a.refundedBy) ?? null) : null,
      refundNote: a.refundNote,
      isOverdue: overdue(a, row, now),
      payment: order
        ? {
            gateway: order.gateway,
            wcOrderId: order.wcOrderId,
            expectedAmount: order.expectedAmount,
            chargedAmount: order.chargedAmount,
            chargedCurrency: order.chargedCurrency,
          }
        : null,
    });
  }
  return out;
}

/** Sessions as the staff API returns them: `approval` is null for an ordinary booking. */
export async function withApprovals<T extends Timed>(
  rows: T[],
  now: Date = new Date(),
): Promise<Array<T & { approval: ApprovalView | null }>> {
  const views = await approvalViews(rows, now);
  return rows.map((r) => ({ ...r, approval: views.get(r.id) ?? null }));
}

/**
 * The client's slice of a staff view. A client may hold a token for the staff session
 * endpoints too (their own sessions), and the staff view carries the internal reject
 * reason, staff names and order numbers (spec §2).
 */
export function toPublicApprovalView(v: ApprovalView): PublicApprovalView {
  return {
    state: v.state,
    requestedAt: v.requestedAt,
    decidedAt: v.decidedAt,
    refundStatus: v.refundStatus,
    isOverdue: v.isOverdue,
  };
}

export async function publicApprovalView(row: Timed, now: Date = new Date()): Promise<PublicApprovalView | null> {
  const a = await store.findApproval(row.id);
  if (!a) return null;
  return {
    state: a.state,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    refundStatus: a.refundStatus,
    isOverdue: overdue(a, row, now),
  };
}

/**
 * publicApprovalView by appointment id, for callers that hold no session row. Reads the
 * session only when there is a record, so a booking without approval costs one query.
 */
export async function publicApprovalFor(
  appointmentId: number,
  now: Date = new Date(),
): Promise<PublicApprovalView | null> {
  const a = await store.findApproval(appointmentId);
  if (!a) return null;
  const row = await findSessionById(appointmentId);
  return {
    state: a.state,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    refundStatus: a.refundStatus,
    isOverdue: row ? overdue(a, row, now) : false,
  };
}

/* ------------------------------------------------------------------ */
/* Mail                                                                */
/* ------------------------------------------------------------------ */

export async function serviceNameOf(row: Pick<SessionRow, 'serviceIds'>): Promise<string> {
  const first = row.serviceIds[0];
  if (first === undefined) return 'Sesi';
  return (await findServiceById(BigInt(first)))?.name ?? 'Sesi';
}

/** Null when the session has no usable start: nothing sensible to put in a mail. */
export async function mailFacts(row: SessionRow): Promise<SessionMailFacts | null> {
  const startsAtUtc = sessionStartsAtUtc(row);
  if (!startsAtUtc || Number.isNaN(startsAtUtc.getTime())) return null;
  return {
    clientName: row.clientName,
    professionalName: row.professionalName,
    serviceName: await serviceNameOf(row),
    startsAtUtc,
    timezone: row.timezone,
  };
}

/** sendEmail never throws and logs a failed delivery itself. An empty address is skipped. */
export async function mail(to: string, built: BuiltEmail, template: string): Promise<boolean> {
  if (!to) return false;
  const res = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, template });
  return res.ok;
}

/** The clinic's admin (wp_kc_clinics.clinic_admin_id), or null when it has none. */
export async function clinicAdminContact(clinicId: number): Promise<{ email: string; name: string } | null> {
  const clinic = await findClinicById(BigInt(clinicId));
  if (!clinic || clinic.clinicAdminId <= 0n) return null;
  return store.findWpUserContact(Number(clinic.clinicAdminId));
}

/* ------------------------------------------------------------------ */
/* Hold                                                                */
/* ------------------------------------------------------------------ */

export interface HoldInput {
  row: SessionRow;
  /** payment_orders.id; null when staff marked the booking paid by hand. */
  paymentOrderId: string | null;
  actorId?: string | null;
  now?: Date;
}

/**
 * Put a paid booking in its psychologist's queue. The appointment is NOT touched: it is
 * PENDING and stays PENDING. Returns false when it was already queued (a repeated webhook
 * or status poll), in which case nothing is mailed or scheduled again.
 */
export async function holdForApproval(input: HoldInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const { row } = input;

  const created = await store.insertAwaiting({
    appointmentId: row.id,
    doctorWpUserId: row.professionalId,
    clinicId: row.clinicId,
    paymentOrderId: input.paymentOrderId,
    now,
  });
  if (!created) return false;

  await logging.audit('session.approval_requested', {
    userId: input.actorId ?? null,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.approval_requested',
    metadata: { professionalId: row.professionalId, clinicId: row.clinicId, paymentOrderId: input.paymentOrderId },
  });

  await jobs.enqueue({
    hook: APPROVAL_REMINDER_HOOK,
    runAt: firstReminderAt(now, sessionStartsAtUtc(row)),
    args: approvalReminderArgs(row.id),
  });

  const facts = await mailFacts(row);
  if (facts) {
    await mail(row.clientEmail, buildClientAwaitingEmail(facts), 'approval_client_awaiting');
    await mail(
      row.professionalEmail,
      buildProfessionalRequestEmail({ ...facts, link: approvalLink(row.id), waitingSince: null }),
      'approval_professional_request',
    );
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

async function paymentFor(approval: store.ApprovalRecord): Promise<ConfirmedPayment | undefined> {
  if (!approval.paymentOrderId) return undefined;
  const order = (await store.paymentOrdersByIds([approval.paymentOrderId])).get(approval.paymentOrderId);
  return order ? { gateway: order.gateway, wcOrderId: order.wcOrderId, transactionId: order.transactionId } : undefined;
}

/**
 * PENDING → BOOKED with the payment. Through the plugin, whose conditional claim fires
 * `kc_appointment_payment_completed` exactly once — KiviCare's booking mail to client,
 * psychologist and clinic. A booking marked paid by hand has no order and books without
 * it, which mails nobody (the gap spec §12 keeps).
 */
async function confirmBooked(approval: store.ApprovalRecord): Promise<void> {
  await setAppointmentStatus(approval.appointmentId, APPOINTMENT_STATUS.BOOKED, await paymentFor(approval));
}

async function afterBooked(appointmentId: number): Promise<void> {
  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  const booked = await findSessionById(appointmentId);
  if (booked) await syncSessionReminders(booked);
}

/**
 * Finish an approval that was claimed but never reached the plugin (the process died in
 * between). Safe to repeat: the plugin's claim only moves a PENDING row.
 */
export async function completeApproval(approval: store.ApprovalRecord): Promise<void> {
  await confirmBooked(approval);
  await afterBooked(approval.appointmentId);
}

async function alreadyDecided(appointmentId: number): Promise<ApprovalError> {
  const current = await store.findApproval(appointmentId);
  if (!current) {
    return new ApprovalError('approval_already_decided', 'This booking is no longer waiting for approval', 409);
  }
  const who = current.decidedBy ? (await store.userNames([current.decidedBy])).get(current.decidedBy) : undefined;
  return new ApprovalError(
    'approval_already_decided',
    `This booking was already ${current.state}${who ? ` by ${who}` : ''}`,
    409,
  );
}

async function auditDecision(
  actor: Actor,
  row: SessionRow,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
): Promise<void> {
  const onBehalf = actor.role !== 'PROFESSIONAL';
  await logging.audit('session.approval_decided', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.approval_decided',
    metadata: { decision, reason, onBehalf, professionalId: row.professionalId },
  });
  await logging.audit('session.status_changed', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.status_changed',
    metadata: {
      from: SESSION_STATUS.PENDING,
      to: decision === 'APPROVED' ? SESSION_STATUS.BOOKED : SESSION_STATUS.CANCELLED,
      reason,
    },
  });
}

export interface DecideInput {
  actor: Actor;
  row: SessionRow;
  now?: Date;
}

/** The caller (transitionSession) has already checked that the actor may decide. */
export async function approveAwaiting(input: DecideInput & { approval: store.ApprovalRecord }): Promise<void> {
  const now = input.now ?? new Date();
  const { actor, row, approval } = input;

  if (isOverdue(sessionStartsAtUtc(row), now)) {
    throw new ApprovalError('session_already_started', 'This session has already started; it can only be rejected', 422);
  }

  const claimed = await store.claimDecision(row.id, {
    state: store.APPROVAL_STATE.APPROVED,
    decidedBy: actor.id,
    decidedAt: now,
  });
  if (!claimed) throw await alreadyDecided(row.id);

  try {
    await confirmBooked(approval);
  } catch (err) {
    // The plugin may have committed before its answer was lost (a timeout, a dropped
    // connection). Then the booking IS confirmed, and undoing the claim would leave an
    // AWAITING record on a BOOKED appointment that nothing settles until a read does.
    // Any other status — still PENDING, or unreadable — and the claim is undone.
    const current = await findSessionById(row.id).catch(() => null);
    if (current?.status !== SESSION_STATUS.BOOKED) {
      await store.revertDecision(row.id, store.APPROVAL_STATE.APPROVED, actor.id);
      await logging.error('approval: confirming the booking failed', err, { resource: 'session', resourceId: String(row.id) });
      throw new ApprovalError('upstream_failed', 'The booking could not be confirmed. Try again.', 502);
    }
    await logging.error('approval: the plugin answered with an error, but the booking is BOOKED', err, {
      resource: 'session',
      resourceId: String(row.id),
    });
  }

  await afterBooked(row.id);
  await auditDecision(actor, row, 'APPROVED', null);
}

/** The caller (transitionSession) has already checked that the actor may decide. */
export async function rejectAwaiting(input: DecideInput & { reason: string }): Promise<void> {
  const now = input.now ?? new Date();
  const { actor, row, reason } = input;

  const claimed = await store.claimDecision(row.id, {
    state: store.APPROVAL_STATE.REJECTED,
    decidedBy: actor.id,
    decidedAt: now,
    rejectReason: reason,
  });
  if (!claimed) throw await alreadyDecided(row.id);

  try {
    // Directly, not through the plugin. The client never got KiviCare's booking mail, so
    // its cancellation mail would only be a confusing second message; and a PENDING
    // booking has nothing else to tear down. The plugin's set_status(0) is an UPDATE plus
    // kc_appointment_cancelled — it touches no WooCommerce order.
    await setSessionStatusDirect(row.id, SESSION_STATUS.CANCELLED);
  } catch (err) {
    await store.revertDecision(row.id, store.APPROVAL_STATE.REJECTED, actor.id);
    await logging.error('approval: cancelling the booking failed', err, { resource: 'session', resourceId: String(row.id) });
    throw new ApprovalError('status_write_failed', 'The booking could not be cancelled. Try again.', 500);
  }

  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(row.id) });
  await auditDecision(actor, row, 'REJECTED', reason);

  const facts = await mailFacts(row);
  if (facts) {
    const clinic = await findClinicById(BigInt(row.clinicId));
    await mail(
      row.clientEmail,
      buildClientRejectedEmail({
        ...facts,
        clinicName: clinic?.name ?? 'klinik',
        clinicEmail: clinic?.email ?? null,
        clinicPhone: clinic?.telephone ?? null,
      }),
      'approval_client_rejected',
    );
  }
}

/**
 * A waiting booking was cancelled some other way (staff cancel, bulk cancel, the client's
 * own link). The money is in, so it joins the refund list. False when there was no
 * AWAITING record to close.
 */
export async function closeOnCancel(appointmentId: number, actorId: string | null, now: Date = new Date()): Promise<boolean> {
  const closed = await store.claimDecision(appointmentId, {
    state: store.APPROVAL_STATE.CANCELLED,
    decidedBy: actorId,
    decidedAt: now,
  });
  if (!closed) return false;

  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  await logging.audit('session.approval_cancelled', {
    userId: actorId,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.approval_cancelled',
    metadata: { refundStatus: store.REFUND_STATUS.NEEDED },
  });
  return true;
}

/**
 * The appointment left PENDING without passing through here — someone changed it in
 * KiviCare's own dashboard. Close the record to match, so the queue stops showing it.
 */
export async function settleExternal(appointmentId: number, status: SessionStatus, now: Date = new Date()): Promise<void> {
  if (status === SESSION_STATUS.CANCELLED) {
    await closeOnCancel(appointmentId, null, now);
    return;
  }
  const closed = await store.claimDecision(appointmentId, {
    state: store.APPROVAL_STATE.APPROVED,
    decidedBy: null,
    decidedAt: now,
  });
  if (!closed) return;
  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  await logging.audit('session.approval_decided', {
    userId: null,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.approval_decided',
    metadata: { decision: 'APPROVED', external: true, status },
  });
}

/**
 * A rejection claimed on the record whose CANCELLED write never landed: the process died
 * in between, or the write failed and so did undoing the claim. The decision stands, so
 * the slot is released here — directly, as rejectAwaiting does — and the refund stays
 * NEEDED. The client's rejection mail is not sent from here.
 */
export async function finishRejection(approval: store.ApprovalRecord): Promise<void> {
  await setSessionStatusDirect(approval.appointmentId, SESSION_STATUS.CANCELLED);
  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(approval.appointmentId) });
  await logging.audit('session.status_changed', {
    userId: approval.decidedBy,
    resource: 'session',
    resourceId: String(approval.appointmentId),
    action: 'session.status_changed',
    metadata: {
      from: SESSION_STATUS.PENDING,
      to: SESSION_STATUS.CANCELLED,
      reason: approval.rejectReason,
      finishedRejection: true,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

export interface MarkRefundedInput {
  actor: Actor;
  appointmentId: number;
  note: string | null;
  now?: Date;
}

/** NEEDED → DONE. Clinic admins of the session's clinic and super admins only. */
export async function markRefunded(input: MarkRefundedInput): Promise<ApprovalView> {
  const now = input.now ?? new Date();
  const { actor, appointmentId } = input;

  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
    throw new ApprovalError('forbidden', 'Only clinic admins can mark a refund', 403);
  }
  const row = await findSessionById(appointmentId);
  if (!row) throw new ApprovalError('not_found', 'Session not found', 404);
  if (actor.role === 'CLINIC_ADMIN') {
    const kc = await resolveKcActor(actor);
    if (kc.clinicId === null || Number(kc.clinicId) !== row.clinicId) {
      throw new ApprovalError('forbidden', 'Not authorized for this clinic', 403);
    }
  }

  const approval = await store.findApproval(appointmentId);
  if (!approval) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);

  const done = await store.markRefundDone(appointmentId, actor.id, input.note, now);
  if (!done) {
    throw new ApprovalError('refund_not_needed', `The refund status is ${approval.refundStatus}`, 409);
  }

  await logging.audit('session.refund_marked', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.refund_marked',
    metadata: { note: input.note },
  });

  const view = (await approvalViews([row], now)).get(appointmentId);
  if (!view) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  return view;
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export type ApprovalQueueItem = SessionRow & { serviceName: string; approval: ApprovalView };

export interface QueueQuery {
  filter: store.QueueFilter;
  professionalId?: number;
  clinicId?: number;
  page: number;
  limit: number;
}

export interface QueuePage {
  data: ApprovalQueueItem[];
  pagination: { currentPage: number; totalPages: number; totalItems: number; itemsPerPage: number };
  counts: { awaiting: number; refundNeeded: number };
}

/** Null: the actor may look, but at nothing (another clinic, or an admin with no clinic). */
async function queueScope(
  actor: Actor,
  q: Pick<QueueQuery, 'professionalId' | 'clinicId'>,
): Promise<store.QueueScope | null> {
  if (actor.role === 'PROFESSIONAL') {
    const kc = await resolveKcActor(actor);
    // A psychologist always sees their own queue, whatever the query asks for.
    return { doctorWpUserId: Number(kc.wpUserId) };
  }
  if (actor.role === 'CLINIC_ADMIN') {
    const kc = await resolveKcActor(actor);
    if (kc.clinicId === null) return null;
    const own = Number(kc.clinicId);
    // Asking for another clinic gets nothing rather than a 403, like GET /sessions.
    if (q.clinicId !== undefined && q.clinicId !== own) return null;
    return { clinicId: own, doctorWpUserId: q.professionalId };
  }
  if (actor.role === 'SUPER_ADMIN') {
    return { clinicId: q.clinicId, doctorWpUserId: q.professionalId };
  }
  throw new ApprovalError('forbidden', 'Not authorized to see the approval queue', 403);
}

async function toItems(records: store.ApprovalRecord[], now: Date): Promise<ApprovalQueueItem[]> {
  const rows = await listSessionsByIds(records.map((a) => a.appointmentId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const views = await approvalViews(rows, now);
  const items: ApprovalQueueItem[] = [];
  for (const a of records) {
    const row = byId.get(a.appointmentId);
    const view = views.get(a.appointmentId);
    // A record whose appointment was deleted in KiviCare: nothing to show or decide.
    if (!row || !view) continue;
    items.push({ ...row, serviceName: await serviceNameOf(row), approval: view });
  }
  return items;
}

/**
 * Put right the records whose appointment moved without passing through here, before a
 * read shows them. The reminder job does the same, but it stops a day before the session
 * and never runs after it: a bill settled at check-out, a cancel in KiviCare's dashboard
 * on the day, or a booking whose approval call errored after the plugin committed would
 * otherwise stay wrong for good.
 *
 * AWAITING on an appointment that is no longer PENDING → settleExternal. REJECTED on one
 * that still is → finishRejection. Best effort: a failure is logged and the read goes on.
 */
async function reconcile(records: store.ApprovalRecord[], now: Date): Promise<void> {
  const open = records.filter(
    (a) => a.state === store.APPROVAL_STATE.AWAITING || a.state === store.APPROVAL_STATE.REJECTED,
  );
  if (open.length === 0) return;

  const rows = new Map((await listSessionsByIds(open.map((a) => a.appointmentId))).map((r) => [r.id, r]));
  for (const a of open) {
    const row = rows.get(a.appointmentId);
    if (!row) continue;
    try {
      if (a.state === store.APPROVAL_STATE.AWAITING && row.status !== SESSION_STATUS.PENDING) {
        await settleExternal(a.appointmentId, row.status, now);
      } else if (a.state === store.APPROVAL_STATE.REJECTED && row.status === SESSION_STATUS.PENDING) {
        await finishRejection(a);
      }
    } catch (err) {
      await logging.error('approval: reconciling a record failed', err, {
        resource: 'session',
        resourceId: String(a.appointmentId),
      });
    }
  }
}

export async function listQueue(actor: Actor, q: QueueQuery, now: Date = new Date()): Promise<QueuePage> {
  const scope = await queueScope(actor, q);
  if (scope === null) {
    return {
      data: [],
      pagination: { currentPage: q.page, totalPages: 1, totalItems: 0, itemsPerPage: q.limit },
      counts: { awaiting: 0, refundNeeded: 0 },
    };
  }
  await reconcile(await store.listUnsettled(scope), now);
  const { items, total } = await store.listApprovals(q.filter, scope, q.page, q.limit);
  const counts = await store.countApprovals(scope);
  return {
    data: await toItems(items, now),
    pagination: {
      currentPage: q.page,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      totalItems: total,
      itemsPerPage: q.limit,
    },
    counts,
  };
}

/** One item, same shape as the queue's, for the FE detail page. */
export async function getApprovalItem(
  actor: Actor,
  appointmentId: number,
  now: Date = new Date(),
): Promise<ApprovalQueueItem> {
  const row = await findSessionById(appointmentId);
  if (!row) throw new ApprovalError('not_found', 'Session not found', 404);

  if (actor.role !== 'SUPER_ADMIN') {
    const kc = await resolveKcActor(actor);
    const allowed =
      (actor.role === 'PROFESSIONAL' && row.professionalId === Number(kc.wpUserId)) ||
      (actor.role === 'CLINIC_ADMIN' && kc.clinicId !== null && Number(kc.clinicId) === row.clinicId);
    if (!allowed) throw new ApprovalError('forbidden', 'Not authorized', 403);
  }

  const record = await store.findApproval(appointmentId);
  if (!record) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  await reconcile([record], now);
  // toItems reads the record and the session again, so the item shows what reconcile left.
  const [item] = await toItems([record], now);
  if (!item) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  return item;
}

export interface ApprovalSettingView {
  professionalId: number;
  requiresApproval: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export async function approvalSettingView(setting: ApprovalSetting): Promise<ApprovalSettingView> {
  const names = await store.userNames([setting.updatedBy]);
  return {
    professionalId: setting.professionalId,
    requiresApproval: setting.requiresApproval,
    updatedAt: iso(setting.updatedAt),
    updatedByName: setting.updatedBy ? (names.get(setting.updatedBy) ?? null) : null,
  };
}
