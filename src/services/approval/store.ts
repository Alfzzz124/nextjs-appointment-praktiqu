/**
 * `session_approvals` — the app-native record of a paid booking that waits for its
 * psychologist — plus the few app-table reads the approval flow needs.
 *
 * KiviCare has five statuses and none means "paid, waiting for the psychologist", so
 * such a booking stays PENDING in wp_kc_appointments and this row says why. Every path
 * that used to read PENDING as "unpaid" now asks here first.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §5
 */
import { Prisma, type SessionApproval } from '@prisma/client';
import { prisma } from '@/lib/db';

export const APPROVAL_STATE = {
  AWAITING: 'AWAITING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalState = (typeof APPROVAL_STATE)[keyof typeof APPROVAL_STATE];

export const REFUND_STATUS = { NONE: 'NONE', NEEDED: 'NEEDED', DONE: 'DONE' } as const;
export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export type ApprovalRecord = {
  appointmentId: number;
  doctorWpUserId: number;
  clinicId: number;
  paymentOrderId: string | null;
  state: ApprovalState;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  rejectReason: string | null;
  refundStatus: RefundStatus;
  refundedAt: Date | null;
  refundedBy: string | null;
  refundNote: string | null;
  lastReminderAt: Date | null;
  escalatedAt: Date | null;
};

function toRecord(r: SessionApproval): ApprovalRecord {
  return {
    ...r,
    appointmentId: Number(r.appointmentId),
    doctorWpUserId: Number(r.doctorWpUserId),
    clinicId: Number(r.clinicId),
    state: r.state as ApprovalState,
    refundStatus: r.refundStatus as RefundStatus,
  };
}

export async function findApproval(appointmentId: number): Promise<ApprovalRecord | null> {
  const row = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(appointmentId) } });
  return row ? toRecord(row) : null;
}

export async function findApprovals(appointmentIds: number[]): Promise<Map<number, ApprovalRecord>> {
  if (appointmentIds.length === 0) return new Map();
  const rows = await prisma.sessionApproval.findMany({
    where: { appointmentId: { in: appointmentIds.map((id) => BigInt(id)) } },
  });
  return new Map(rows.map((r) => [Number(r.appointmentId), toRecord(r)]));
}

export type NewApproval = {
  appointmentId: number;
  doctorWpUserId: number;
  clinicId: number;
  paymentOrderId: string | null;
  now: Date;
};

/** Create the AWAITING row. False when it already exists: a repeated webhook or poll. */
export async function insertAwaiting(input: NewApproval): Promise<boolean> {
  try {
    await prisma.sessionApproval.create({
      data: {
        appointmentId: BigInt(input.appointmentId),
        doctorWpUserId: BigInt(input.doctorWpUserId),
        clinicId: BigInt(input.clinicId),
        paymentOrderId: input.paymentOrderId,
        state: APPROVAL_STATE.AWAITING,
        requestedAt: input.now,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

export type Decision =
  | { state: typeof APPROVAL_STATE.APPROVED; decidedBy: string | null; decidedAt: Date }
  | { state: typeof APPROVAL_STATE.REJECTED; decidedBy: string | null; decidedAt: Date; rejectReason: string }
  | { state: typeof APPROVAL_STATE.CANCELLED; decidedBy: string | null; decidedAt: Date };

/**
 * AWAITING → the decision, as one conditional UPDATE. False means the row was no longer
 * AWAITING: someone else decided first, and this caller must not touch the appointment.
 * A rejection or a cancellation leaves money to return, so it marks the refund NEEDED.
 */
export async function claimDecision(appointmentId: number, d: Decision): Promise<boolean> {
  const { count } = await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), state: APPROVAL_STATE.AWAITING },
    data: {
      state: d.state,
      decidedAt: d.decidedAt,
      decidedBy: d.decidedBy,
      rejectReason: d.state === APPROVAL_STATE.REJECTED ? d.rejectReason : null,
      refundStatus: d.state === APPROVAL_STATE.APPROVED ? REFUND_STATUS.NONE : REFUND_STATUS.NEEDED,
    },
  });
  return count === 1;
}

/** Undo a claim whose appointment write failed, so the same decision can be tried again. */
export async function revertDecision(
  appointmentId: number,
  state: ApprovalState,
  decidedBy: string | null,
): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), state, decidedBy },
    data: {
      state: APPROVAL_STATE.AWAITING,
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      refundStatus: REFUND_STATUS.NONE,
    },
  });
}

/**
 * APPROVED → CANCELLED with a refund to make, as one conditional UPDATE: the approval's
 * confirmation found the appointment already cancelled, so it never became a booking.
 * Nobody decided the cancellation through the app, hence decidedBy null.
 */
export async function cancelApproved(appointmentId: number, now: Date): Promise<boolean> {
  const { count } = await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), state: APPROVAL_STATE.APPROVED },
    data: {
      state: APPROVAL_STATE.CANCELLED,
      decidedAt: now,
      decidedBy: null,
      rejectReason: null,
      refundStatus: REFUND_STATUS.NEEDED,
    },
  });
  return count === 1;
}

/** NEEDED → DONE. False when the refund was not needed, or already marked. */
export async function markRefundDone(
  appointmentId: number,
  by: string,
  note: string | null,
  now: Date,
): Promise<boolean> {
  const { count } = await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), refundStatus: REFUND_STATUS.NEEDED },
    data: { refundStatus: REFUND_STATUS.DONE, refundedAt: now, refundedBy: by, refundNote: note },
  });
  return count === 1;
}

export async function touchReminder(appointmentId: number, at: Date): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId) },
    data: { lastReminderAt: at },
  });
}

/** Escalation goes out once; a second call leaves the first timestamp alone. */
export async function markEscalated(appointmentId: number, at: Date): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), escalatedAt: null },
    data: { escalatedAt: at },
  });
}

export type QueueFilter = 'AWAITING' | 'REFUND_NEEDED' | 'REFUNDED' | 'DECIDED';
export const QUEUE_FILTERS: readonly QueueFilter[] = ['AWAITING', 'REFUND_NEEDED', 'REFUNDED', 'DECIDED'];

/** Narrowing only: an undefined field puts no condition on that column. */
export type QueueScope = { doctorWpUserId?: number; clinicId?: number };

function scopeWhere(scope: QueueScope): Prisma.SessionApprovalWhereInput {
  return {
    ...(scope.doctorWpUserId !== undefined ? { doctorWpUserId: BigInt(scope.doctorWpUserId) } : {}),
    ...(scope.clinicId !== undefined ? { clinicId: BigInt(scope.clinicId) } : {}),
  };
}

const FILTER_WHERE: Record<QueueFilter, Prisma.SessionApprovalWhereInput> = {
  AWAITING: { state: APPROVAL_STATE.AWAITING },
  REFUND_NEEDED: { refundStatus: REFUND_STATUS.NEEDED },
  REFUNDED: { refundStatus: REFUND_STATUS.DONE },
  DECIDED: { state: { in: [APPROVAL_STATE.APPROVED, APPROVAL_STATE.REJECTED, APPROVAL_STATE.CANCELLED] } },
};

const FILTER_ORDER: Record<QueueFilter, Prisma.SessionApprovalOrderByWithRelationInput[]> = {
  AWAITING: [{ requestedAt: 'asc' }, { appointmentId: 'asc' }],
  REFUND_NEEDED: [{ decidedAt: 'asc' }, { appointmentId: 'asc' }],
  REFUNDED: [{ refundedAt: 'desc' }, { appointmentId: 'desc' }],
  DECIDED: [{ decidedAt: 'desc' }, { appointmentId: 'desc' }],
};

export async function listApprovals(
  filter: QueueFilter,
  scope: QueueScope,
  page: number,
  limit: number,
): Promise<{ items: ApprovalRecord[]; total: number }> {
  const where: Prisma.SessionApprovalWhereInput = { ...FILTER_WHERE[filter], ...scopeWhere(scope) };
  const total = await prisma.sessionApproval.count({ where });
  const rows = await prisma.sessionApproval.findMany({
    where,
    orderBy: FILTER_ORDER[filter],
    skip: (page - 1) * limit,
    take: limit,
  });
  return { items: rows.map(toRecord), total };
}

/**
 * The records a read may have to put right before showing them: every AWAITING one, and
 * every rejection whose refund is still open (a rejection that died between its claim and
 * the CANCELLED write leaves exactly that). Unpaged: both are work queues, so small.
 */
export async function listUnsettled(scope: QueueScope): Promise<ApprovalRecord[]> {
  const rows = await prisma.sessionApproval.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [
        { state: APPROVAL_STATE.AWAITING },
        { state: APPROVAL_STATE.REJECTED, refundStatus: REFUND_STATUS.NEEDED },
      ],
    },
  });
  return rows.map(toRecord);
}

/** The two numbers the FE badges show. Sequential: the pool is small (max_user_connections=5). */
export async function countApprovals(scope: QueueScope): Promise<{ awaiting: number; refundNeeded: number }> {
  const base = scopeWhere(scope);
  const awaiting = await prisma.sessionApproval.count({ where: { ...base, ...FILTER_WHERE.AWAITING } });
  const refundNeeded = await prisma.sessionApproval.count({ where: { ...base, ...FILTER_WHERE.REFUND_NEEDED } });
  return { awaiting, refundNeeded };
}

/** users.id → display name, for "decided by" and "refunded by". Unknown ids are left out. */
export async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });
  return new Map(
    rows.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.displayName]),
  );
}

export type PaymentSummary = {
  id: string;
  gateway: string;
  wcOrderId: number;
  transactionId: string | null;
  expectedAmount: number;
  chargedAmount: number | null;
  chargedCurrency: string;
};

export async function paymentOrdersByIds(ids: string[]): Promise<Map<string, PaymentSummary>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.paymentOrder.findMany({
    where: { id: { in: wanted } },
    select: {
      id: true,
      gateway: true,
      wcOrderId: true,
      transactionId: true,
      expectedAmount: true,
      chargedAmount: true,
      chargedCurrency: true,
    },
  });
  return new Map(
    rows.map((o) => [
      o.id,
      {
        id: o.id,
        gateway: o.gateway,
        wcOrderId: o.wcOrderId,
        transactionId: o.transactionId,
        expectedAmount: o.expectedAmount,
        chargedAmount: o.chargedAmount === null ? null : Number(o.chargedAmount),
        chargedCurrency: o.chargedCurrency,
      },
    ]),
  );
}

/** wp_users email and display name, for the escalation mail to a clinic admin. */
export async function findWpUserContact(wpUserId: number): Promise<{ email: string; name: string } | null> {
  if (!Number.isSafeInteger(wpUserId) || wpUserId <= 0) return null;
  const u = await prisma.kcUser.findUnique({
    where: { id: BigInt(wpUserId) },
    select: { userEmail: true, displayName: true },
  });
  return u && u.userEmail ? { email: u.userEmail, name: u.displayName } : null;
}
