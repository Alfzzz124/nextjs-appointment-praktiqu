/**
 * Approve or reject one waiting booking from the link in the psychologist's email,
 * without logging in (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md).
 *
 * The token names one booking and its psychologist, and never expires. Whether it still
 * works is decided here, from the booking and the account as they are now: the booking exists,
 * has an approval record and still belongs to that psychologist, and the psychologist is still
 * active. Deactivating the account is the clinic's way to revoke a link that was forwarded or
 * leaked. The view shows what the email already said, plus the amount paid (the email does not
 * carry it). The decisions are the dashboard's own functions, run as the psychologist's
 * account — so the claim (first one wins), the client mails and the rule that an overdue
 * session can only be rejected all hold.
 */
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { verifyApprovalToken } from '@/lib/public/approval-token';
import { findWpAccountStatus } from '@/repositories/wp/account-status.repo';
import { PROFESSIONAL_STATUS, findDoctorById } from '@/repositories/wp/doctors.repo';
import { SESSION_STATUS, findSessionById, type SessionRow } from '@/repositories/wp/sessions.repo';
import { ensureUserFromWordPress } from '@/services/auth/service';
import { sessionStartsAtUtc } from '@/services/session/reminder-schedule';
import { isOverdue } from './schedule';
import { ApprovalError, approveAwaiting, reconcile, rejectAwaiting, serviceNameOf } from './service';
import * as store from './store';

export interface PublicApprovalLinkView {
  clientName: string;
  professionalName: string;
  serviceName: string;
  /** YYYY-MM-DD, clinic zone. */
  slotDate: string | null;
  /** HH:mm:ss, clinic zone. */
  startTime: string | null;
  timezone: string;
  /** What the client paid; null when staff marked it paid by hand. */
  amount: { value: number; currency: 'IDR' | 'USD' } | null;
  state: store.ApprovalState;
  decidedByName: string | null;
  decidedAt: string | null;
  isOverdue: boolean;
  canApprove: boolean;
  canReject: boolean;
}

interface Loaded {
  row: SessionRow;
  approval: store.ApprovalRecord;
}

interface Resolved extends Loaded {
  doctorWpUserId: number;
  /** The psychologist's app account, resolved once when the link was checked. */
  actor: Actor;
}

/** One answer for every way a link fails, so a forged token learns nothing. */
export function invalidLink(): ApprovalError {
  return new ApprovalError('approval_link_invalid', 'This approval link is not valid', 404);
}

/** The booking and its approval record as they are now, if they still belong to this psychologist. */
async function load(appointmentId: number, doctorWpUserId: number): Promise<Loaded> {
  const row = await findSessionById(appointmentId);
  if (!row || row.professionalId !== doctorWpUserId) throw invalidLink();
  const approval = await store.findApproval(appointmentId);
  if (!approval) throw invalidLink();
  return { row, approval };
}

/**
 * The psychologist's app account, for a link whose psychologist is still active.
 *
 * Active means all three: the WordPress account (read live, because users.status only follows
 * it at login), the professional status the admin's "deactivate professional" sets, and the
 * app account. Any of them off and the link is invalid. The WordPress checks come first so a
 * deactivated psychologist's link does not even create an app account.
 *
 * ensureUserFromWordPress creates the app account from WordPress when they never logged in.
 * It must be the same WordPress user the token names; anything else and the decision would be
 * recorded under somebody else.
 */
async function linkActor(row: SessionRow, doctorWpUserId: number): Promise<Actor> {
  const wpId = BigInt(doctorWpUserId);
  if ((await findWpAccountStatus(wpId)) !== 'active') throw invalidLink();
  if ((await findDoctorById(wpId))?.status === PROFESSIONAL_STATUS.INACTIVE) throw invalidLink();

  const user = row.professionalEmail ? await ensureUserFromWordPress(row.professionalEmail) : null;
  if (!user || user.wpUserId === null || Number(user.wpUserId) !== doctorWpUserId) {
    await logging.error('approval link: no app account matches the psychologist', undefined, {
      resource: 'session',
      resourceId: String(row.id),
      metadata: { doctorWpUserId },
    });
    throw new ApprovalError('approval_actor_missing', 'The psychologist account could not be resolved', 500);
  }
  if (user.status === 0) throw invalidLink();
  return { id: user.id, role: 'PROFESSIONAL', practiceId: null };
}

/**
 * What reconcile would settle: a waiting record whose appointment already moved on, or a
 * rejected one whose appointment is still PENDING. If this drifts from reconcile the cost is
 * a stale view for one call, not a wrong decision: the decision functions re-check the record.
 */
function needsSettling({ row, approval }: Loaded): boolean {
  return (
    (approval.state === store.APPROVAL_STATE.AWAITING && row.status !== SESSION_STATUS.PENDING) ||
    (approval.state === store.APPROVAL_STATE.REJECTED && row.status === SESSION_STATUS.PENDING)
  );
}

/**
 * Check the link as it stands now and return what it opens. A record whose appointment moved
 * outside the app is settled first (as the queue does), so the page never offers buttons for
 * a booking that is already done. Settling comes after the account check, so a link that is
 * not valid changes nothing.
 */
async function resolve(token: string, now: Date): Promise<Resolved> {
  const payload = verifyApprovalToken(token);
  if (!payload) throw invalidLink();
  const { appointmentId, doctorWpUserId } = payload;

  let loaded = await load(appointmentId, doctorWpUserId);
  const actor = await linkActor(loaded.row, doctorWpUserId);
  if (needsSettling(loaded)) {
    await reconcile([loaded.approval], now);
    loaded = await load(appointmentId, doctorWpUserId);
  }
  return { ...loaded, doctorWpUserId, actor };
}

async function toView(row: SessionRow, a: store.ApprovalRecord, now: Date): Promise<PublicApprovalLinkView> {
  const names = await store.userNames([a.decidedBy]);
  const order = a.paymentOrderId ? (await store.paymentOrdersByIds([a.paymentOrderId])).get(a.paymentOrderId) : undefined;
  const waiting = a.state === store.APPROVAL_STATE.AWAITING && row.status === SESSION_STATUS.PENDING;
  const overdue = a.state === store.APPROVAL_STATE.AWAITING && isOverdue(sessionStartsAtUtc(row), now);
  return {
    clientName: row.clientName,
    professionalName: row.professionalName,
    serviceName: await serviceNameOf(row),
    slotDate: row.slotDate,
    startTime: row.startTime,
    timezone: row.timezone,
    amount: order
      ? { value: order.chargedAmount ?? order.expectedAmount, currency: order.chargedCurrency === 'USD' ? 'USD' : 'IDR' }
      : null,
    state: a.state,
    decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    isOverdue: overdue,
    canApprove: waiting && !overdue,
    canReject: waiting,
  };
}

function assertWaiting({ row, approval }: Resolved): void {
  if (approval.state !== store.APPROVAL_STATE.AWAITING || row.status !== SESSION_STATUS.PENDING) {
    throw new ApprovalError('approval_already_decided', 'This booking is no longer waiting for approval', 409);
  }
}

export async function linkView(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const { row, approval } = await resolve(token, now);
  return toView(row, approval, now);
}

/** The view after a decision: the booking and record as the decision left them. */
async function viewAfter({ row, doctorWpUserId }: Resolved, now: Date): Promise<PublicApprovalLinkView> {
  const after = await load(row.id, doctorWpUserId);
  return toView(after.row, after.approval, now);
}

export async function approveByLink(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolve(token, now);
  assertWaiting(resolved);
  const { actor, row, approval, doctorWpUserId } = resolved;
  await approveAwaiting({ actor, actorWpUserId: doctorWpUserId, row, approval, now, via: 'email_link' });
  return viewAfter(resolved, now);
}

export async function rejectByLink(token: string, reason: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolve(token, now);
  assertWaiting(resolved);
  const { actor, row, doctorWpUserId } = resolved;
  await rejectAwaiting({ actor, actorWpUserId: doctorWpUserId, row, reason, now, via: 'email_link' });
  return viewAfter(resolved, now);
}
