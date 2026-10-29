/**
 * Approve or reject one waiting booking from the link in the psychologist's email,
 * without logging in (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md).
 *
 * The token names one booking and its psychologist. Whether it still works is decided here,
 * from the booking as it is now: it exists, it has an approval record, and it still belongs
 * to that psychologist. The view shows only what the email already said. The decisions are
 * the dashboard's own functions, run as the psychologist's account — so the claim (first one
 * wins), the client mails and the rule that an overdue session can only be rejected all hold.
 */
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { verifyApprovalToken } from '@/lib/public/approval-token';
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

interface Resolved {
  row: SessionRow;
  approval: store.ApprovalRecord;
  doctorWpUserId: number;
}

/** One answer for every way a link fails, so a forged token learns nothing. */
function invalidLink(): ApprovalError {
  return new ApprovalError('approval_link_invalid', 'This approval link is not valid', 404);
}

async function resolve(token: string): Promise<Resolved> {
  const payload = verifyApprovalToken(token);
  if (!payload) throw invalidLink();
  const row = await findSessionById(payload.appointmentId);
  if (!row || row.professionalId !== payload.doctorWpUserId) throw invalidLink();
  const approval = await store.findApproval(payload.appointmentId);
  if (!approval) throw invalidLink();
  return { row, approval, doctorWpUserId: payload.doctorWpUserId };
}

/** Settle a record whose appointment moved outside the app (as the queue does), then read again. */
async function resolveSettled(token: string, now: Date): Promise<Resolved> {
  const first = await resolve(token);
  await reconcile([first.approval], now);
  return resolve(token);
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

/**
 * The psychologist's app account. ensureUserFromWordPress creates it from WordPress when they
 * never logged in. It must be the same WordPress user the token names; anything else and the
 * decision would be recorded under somebody else.
 */
async function linkActor(row: SessionRow, doctorWpUserId: number): Promise<Actor> {
  const user = row.professionalEmail ? await ensureUserFromWordPress(row.professionalEmail) : null;
  if (!user || user.wpUserId === null || Number(user.wpUserId) !== doctorWpUserId) {
    await logging.error('approval link: no app account matches the psychologist', undefined, {
      resource: 'session',
      resourceId: String(row.id),
      metadata: { doctorWpUserId },
    });
    throw new ApprovalError('approval_actor_missing', 'The psychologist account could not be resolved', 500);
  }
  return { id: user.id, role: 'PROFESSIONAL', practiceId: null };
}

export async function linkView(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const { row, approval } = await resolveSettled(token, now);
  return toView(row, approval, now);
}

export async function approveByLink(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolveSettled(token, now);
  assertWaiting(resolved);
  const { row, approval, doctorWpUserId } = resolved;
  const actor = await linkActor(row, doctorWpUserId);
  await approveAwaiting({ actor, actorWpUserId: doctorWpUserId, row, approval, now, via: 'email_link' });
  const after = await resolve(token);
  return toView(after.row, after.approval, now);
}

export async function rejectByLink(token: string, reason: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolveSettled(token, now);
  assertWaiting(resolved);
  const { row, doctorWpUserId } = resolved;
  const actor = await linkActor(row, doctorWpUserId);
  await rejectAwaiting({ actor, actorWpUserId: doctorWpUserId, row, reason, now, via: 'email_link' });
  const after = await resolve(token);
  return toView(after.row, after.approval, now);
}
