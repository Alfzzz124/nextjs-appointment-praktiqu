/**
 * transitionSession with a booking that waits for its psychologist (spec §7.2).
 *
 * /approve and /reject now mean two things each. Which one is decided by the approval
 * record, never by the caller: an AWAITING record makes them a psychologist's decision,
 * no record leaves them "mark as paid" and "reject an unpaid booking" as before — except
 * that marking paid for a psychologist with the switch on queues the booking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const repo = vi.hoisted(() => ({
  findSessionById: vi.fn(),
  listSessions: vi.fn(),
  listSessionsByIds: vi.fn(),
  setSessionStatusDirect: vi.fn(),
}));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => repo.findSessionById(...a),
  listSessions: (...a: unknown[]) => repo.listSessions(...a),
  listSessionsByIds: (...a: unknown[]) => repo.listSessionsByIds(...a),
  setSessionStatusDirect: (...a: unknown[]) => repo.setSessionStatusDirect(...a),
}));

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn() }));
vi.mock('@/services/session/reminder-schedule', async (orig) => ({
  ...(await orig<typeof import('@/services/session/reminder-schedule')>()),
  syncSessionReminders: (...a: unknown[]) => schedule.syncSessionReminders(...a),
}));

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const approvalStore = vi.hoisted(() => ({ findApproval: vi.fn(), findApprovals: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => approvalStore.findApproval(...a),
  findApprovals: (...a: unknown[]) => approvalStore.findApprovals(...a),
}));

const settings = vi.hoisted(() => ({ requiresApproval: vi.fn() }));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: (...a: unknown[]) => settings.requiresApproval(...a),
}));

const approval = vi.hoisted(() => ({
  approveAwaiting: vi.fn(),
  rejectAwaiting: vi.fn(),
  closeOnCancel: vi.fn(),
  holdForApproval: vi.fn(),
  completeApproval: vi.fn(),
}));
const views = vi.hoisted(() => ({ withApprovals: vi.fn() }));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  ...approval,
  withApprovals: (...a: unknown[]) => views.withApprovals(...a),
}));

import {
  bulkCancelSessions,
  getSession,
  invalidatePendingForOffDay,
  listSessions,
  transitionSession,
} from '@/services/session/session.service';
import type { ApprovalView } from '@/services/approval/service';

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: '2099-09-10',
    startTime: '09:30:00',
    endTime: '10:30:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    appointmentId: 7,
    doctorWpUserId: 119,
    clinicId: 1,
    paymentOrderId: 'po_1',
    state: 'AWAITING',
    requestedAt: new Date('2026-09-01T00:00:00Z'),
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    refundStatus: 'NONE',
    refundedAt: null,
    refundedBy: null,
    refundNote: null,
    lastReminderAt: null,
    escalatedAt: null,
    ...over,
  };
}

const PSIKOLOG = { id: 'u_psi', role: 'PROFESSIONAL', practiceId: null };
const ADMIN = { id: 'u_admin', role: 'CLINIC_ADMIN', practiceId: null };
const RESEPSIONIS = { id: 'u_resepsionis', role: 'RECEPTIONIST', practiceId: null };
const KLIEN = { id: 'u_klien', role: 'CLIENT', practiceId: null };

function actAs(actor: { id: string; role: string }, wpUserId: bigint) {
  kcActor.resolveKcActor.mockResolvedValue({ actor, wpUserId, clinicId: 1n });
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findSessionById.mockResolvedValue(row());
  repo.listSessionsByIds.mockResolvedValue([]);
  repo.setSessionStatusDirect.mockResolvedValue(true);
  writes.setAppointmentStatus.mockResolvedValue({ id: 7, status: 1, cancelled: false });
  writes.cancelAppointment.mockResolvedValue({ id: 7, status: 0, cancelled: true });
  approvalStore.findApproval.mockResolvedValue(null);
  approvalStore.findApprovals.mockResolvedValue(new Map());
  settings.requiresApproval.mockResolvedValue(false);
  approval.approveAwaiting.mockResolvedValue(undefined);
  approval.rejectAwaiting.mockResolvedValue(undefined);
  approval.closeOnCancel.mockResolvedValue(true);
  approval.holdForApproval.mockResolvedValue(true);
  approval.completeApproval.mockResolvedValue(undefined);
  schedule.syncSessionReminders.mockResolvedValue(undefined);
  views.withApprovals.mockImplementation(async (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => ({ ...r, approval: null })),
  );
  actAs(PSIKOLOG, 119n);
});

describe('an AWAITING booking', () => {
  beforeEach(() => {
    approvalStore.findApproval.mockResolvedValue(record());
  });

  it('/approve by its psychologist is an approval, not a plain status write', async () => {
    await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(approval.approveAwaiting).toHaveBeenCalledWith({ actor: PSIKOLOG, row: row(), approval: record() });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('/reject by a clinic admin is a rejection, with the reason', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({
      actor: ADMIN as never,
      sessionId: 7,
      target: SESSION_STATUS.CANCELLED,
      reason: 'Jadwal bentrok',
      intent: 'reject',
    });

    expect(approval.rejectAwaiting).toHaveBeenCalledWith({ actor: ADMIN, row: row(), reason: 'Jadwal bentrok' });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('/reject by a receptionist is refused', async () => {
    actAs(RESEPSIONIS, 21n);

    await expect(
      transitionSession({
        actor: RESEPSIONIS as never,
        sessionId: 7,
        target: SESSION_STATUS.CANCELLED,
        reason: 'x',
        intent: 'reject',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
  });

  it('/cancel cancels as before and puts the money on the refund list', async () => {
    actAs(RESEPSIONIS, 21n);

    await transitionSession({ actor: RESEPSIONIS as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 0);
    expect(approval.closeOnCancel).toHaveBeenCalledWith(7, 'u_resepsionis');
  });
});

describe('a BOOKED booking', () => {
  it('/reject is refused: a stale rejection must not cancel an approved, paid booking', async () => {
    repo.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));

    await expect(
      transitionSession({
        actor: PSIKOLOG as never,
        sessionId: 7,
        target: SESSION_STATUS.CANCELLED,
        reason: 'basi',
        intent: 'reject',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_transition' });

    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
    expect(approval.closeOnCancel).not.toHaveBeenCalled();
  });

  it('a plain cancel (no intent) still cancels it as before', async () => {
    repo.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));

    await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 0);
  });
});

describe('a PENDING booking without a record', () => {
  it('"mark as paid" for a psychologist with the switch on queues it instead of booking it', async () => {
    actAs(ADMIN, 24n);
    settings.requiresApproval.mockResolvedValue(true);

    await transitionSession({ actor: ADMIN as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(approval.holdForApproval).toHaveBeenCalledWith({ row: row(), paymentOrderId: null, actorId: 'u_admin' });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('"mark as paid" with the switch off books it exactly as before', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({ actor: ADMIN as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1);
    expect(approval.holdForApproval).not.toHaveBeenCalled();
  });

  it('/reject of an unpaid booking stays a plain cancel', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({
      actor: ADMIN as never,
      sessionId: 7,
      target: SESSION_STATUS.CANCELLED,
      reason: 'x',
      intent: 'reject',
    });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 0);
    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
    expect(approval.closeOnCancel).not.toHaveBeenCalled();
  });
});

it.each(['REJECTED', 'CANCELLED'] as const)(
  '/approve on a PENDING booking whose record is %s is refused, not booked',
  async (state) => {
    approvalStore.findApproval.mockResolvedValue(record({ state, refundStatus: 'NEEDED' }));

    await expect(
      transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED }),
    ).rejects.toMatchObject({ status: 409, code: 'approval_already_decided' });

    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(approval.holdForApproval).not.toHaveBeenCalled();
  },
);

describe('approved and still being confirmed (APPROVED record, PENDING booking)', () => {
  beforeEach(() => {
    approvalStore.findApproval.mockResolvedValue(record({ state: 'APPROVED', decidedBy: 'u_psi' }));
  });

  it.each([
    ['/cancel', undefined],
    ['/reject', 'reject' as const],
  ])('%s is refused with 409: cancelling now would drop the money unflagged', async (_label, intent) => {
    actAs(ADMIN, 24n);

    await expect(
      transitionSession({ actor: ADMIN as never, sessionId: 7, target: SESSION_STATUS.CANCELLED, reason: 'x', intent }),
    ).rejects.toMatchObject({ status: 409, code: 'approval_already_decided' });

    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
    expect(approval.closeOnCancel).not.toHaveBeenCalled();
  });
});

it('an APPROVED record on a PENDING booking finishes the approval', async () => {
  approvalStore.findApproval.mockResolvedValue(record({ state: 'APPROVED', decidedBy: 'u_psi' }));

  await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

  expect(approval.completeApproval).toHaveBeenCalledWith(record({ state: 'APPROVED', decidedBy: 'u_psi' }));
  expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
});

it('the answer carries the approval field', async () => {
  const s = await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });
  expect(s).toHaveProperty('approval', null);
});

describe('invalidatePendingForOffDay', () => {
  it('leaves a paid booking that waits for its psychologist alone', async () => {
    repo.listSessions.mockResolvedValue({ items: [row({ id: 7 }), row({ id: 8 })], total: 2 });
    approvalStore.findApprovals.mockResolvedValue(new Map([[7, record()]]));

    expect(await invalidatePendingForOffDay(119, '2099-09-10')).toBe(1);

    expect(repo.setSessionStatusDirect).toHaveBeenCalledTimes(1);
    expect(repo.setSessionStatusDirect).toHaveBeenCalledWith(8, SESSION_STATUS.CANCELLED);
  });
});

describe('bulkCancelSessions', () => {
  it('skips a booking that is approved and still being confirmed, and counts it as not cancelled', async () => {
    approvalStore.findApprovals.mockResolvedValue(
      new Map([
        [7, record({ appointmentId: 7, state: 'APPROVED' })],
        [9, record({ appointmentId: 9, state: 'APPROVED' })],
      ]),
    );
    repo.listSessionsByIds.mockResolvedValue([
      row({ id: 7, status: SESSION_STATUS.PENDING }),
      row({ id: 9, status: SESSION_STATUS.BOOKED }),
    ]);

    expect(await bulkCancelSessions([7, 8, 9], 'u_admin')).toBe(2);

    expect(approvalStore.findApprovals).toHaveBeenCalledTimes(1);
    expect(approvalStore.findApprovals).toHaveBeenCalledWith([7, 8, 9]);
    expect(repo.listSessionsByIds).toHaveBeenCalledWith([7, 9]);
    // An approved booking that is BOOKED is an ordinary booking: it cancels.
    expect(writes.cancelAppointment.mock.calls).toEqual([[8], [9]]);
  });

  it('closes the approval record of every booking it cancelled', async () => {
    writes.cancelAppointment.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('plugin')).mockResolvedValueOnce({});

    expect(await bulkCancelSessions([7, 8, 9], 'u_admin')).toBe(2);

    expect(approval.closeOnCancel.mock.calls).toEqual([
      [7, 'u_admin'],
      [9, 'u_admin'],
    ]);
  });
});

describe('what a client sees', () => {
  /** The staff view, with everything a client must not read. */
  const STAFF_VIEW: ApprovalView = {
    state: 'REJECTED',
    requestedAt: '2026-09-01T00:00:00.000Z',
    decidedAt: '2026-09-02T00:00:00.000Z',
    decidedByName: 'Pamela Dewi',
    rejectReason: 'Di luar keahlian saya',
    refundStatus: 'NEEDED',
    refundedAt: null,
    refundedByName: null,
    refundNote: null,
    isOverdue: false,
    payment: { gateway: 'xendit', wcOrderId: 49863, expectedAmount: 350000, chargedAmount: 350000, chargedCurrency: 'IDR' },
  };
  const PUBLIC_KEYS = ['decidedAt', 'isOverdue', 'refundStatus', 'requestedAt', 'state'];

  beforeEach(() => {
    views.withApprovals.mockImplementation(async (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({ ...r, approval: STAFF_VIEW })),
    );
    actAs(KLIEN, 522n);
  });

  it('getSession gives a client the public approval view only', async () => {
    const s = await getSession(KLIEN as never, 7);

    expect(Object.keys(s.approval!).sort()).toEqual(PUBLIC_KEYS);
    expect(s.approval).toEqual({
      state: 'REJECTED',
      requestedAt: '2026-09-01T00:00:00.000Z',
      decidedAt: '2026-09-02T00:00:00.000Z',
      refundStatus: 'NEEDED',
      isOverdue: false,
    });
  });

  it('listSessions does too', async () => {
    repo.listSessions.mockResolvedValue({ items: [row()], total: 1 });

    const page = await listSessions(KLIEN as never, {});

    expect(Object.keys(page.data[0].approval!).sort()).toEqual(PUBLIC_KEYS);
  });

  it("so does the answer to the client's own cancel", async () => {
    const s = await transitionSession({ actor: KLIEN as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(Object.keys(s.approval!).sort()).toEqual(PUBLIC_KEYS);
  });

  it('staff still get the whole view', async () => {
    actAs(PSIKOLOG, 119n);

    const s = await getSession(PSIKOLOG as never, 7);

    expect(s.approval).toEqual(STAFF_VIEW);
  });
});
