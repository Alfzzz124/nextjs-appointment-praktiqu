/**
 * services/approval/service.ts — the decisions, with every boundary mocked.
 *
 * The store is mocked function by function, so these tests pin what the service asks the
 * store to do (claim, revert, mark) and in which order relative to the appointment write.
 * The store's own SQL is pinned by tests/integration/approval/approval-store.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const store = vi.hoisted(() => ({
  findApproval: vi.fn(),
  findApprovals: vi.fn(),
  insertAwaiting: vi.fn(),
  claimDecision: vi.fn(),
  revertDecision: vi.fn(),
  markRefundDone: vi.fn(),
  listUnsettled: vi.fn(),
  listApprovals: vi.fn(),
  countApprovals: vi.fn(),
  userNames: vi.fn(),
  paymentOrdersByIds: vi.fn(),
  findWpUserContact: vi.fn(),
}));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  ...store,
}));

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  cancelAppointment: vi.fn(),
  createAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const sessions = vi.hoisted(() => ({
  findSessionById: vi.fn(),
  listSessionsByIds: vi.fn(),
  setSessionStatusDirect: vi.fn(),
}));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => sessions.findSessionById(...a),
  listSessionsByIds: (...a: unknown[]) => sessions.listSessionsByIds(...a),
  setSessionStatusDirect: (...a: unknown[]) => sessions.setSessionStatusDirect(...a),
}));

vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: async () => ({ name: 'Konseling Individu' }),
}));

const clinics = vi.hoisted(() => ({ findClinicById: vi.fn() }));
vi.mock('@/repositories/wp/clinics.repo', () => clinics);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn() }));
vi.mock('@/services/session/reminder-schedule', async (orig) => ({
  ...(await orig<typeof import('@/services/session/reminder-schedule')>()),
  syncSessionReminders: (...a: unknown[]) => schedule.syncSessionReminders(...a),
}));

const kc = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kc);

const settings = vi.hoisted(() => ({ requiresApproval: vi.fn() }));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: (...a: unknown[]) => settings.requiresApproval(...a),
}));

import {
  approvalViews,
  approveAwaiting,
  closeOnCancel,
  finishRejection,
  getApprovalItem,
  holdForApproval,
  listQueue,
  markRefunded,
  notifyFinishedRejection,
  publicApprovalView,
  rejectAwaiting,
  settleExternal,
  shouldHoldForApproval,
  toPublicApprovalView,
  withApprovals,
} from '@/services/approval/service';

const NOW = new Date('2026-10-20T03:00:00.000Z'); // Selasa 10:00 WIB
const PSIKOLOG = { id: 'u_psi', role: 'PROFESSIONAL', practiceId: null } as const;
const ADMIN = { id: 'u_admin', role: 'CLINIC_ADMIN', practiceId: null } as const;
const ORDER = {
  id: 'po_1',
  gateway: 'xendit',
  wcOrderId: 49863,
  transactionId: 'tx_9',
  expectedAmount: 350000,
  chargedAmount: 350000,
  chargedCurrency: 'IDR',
};

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 4,
    professionalId: 34,
    clientId: 522,
    professionalName: 'Dianda Psikolog',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'dianda@klinik.test',
    slotDate: '2026-10-22', // Kamis 10:00 WIB = 2026-10-22T03:00Z
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-10-19T00:00:00Z'),
    ...over,
  };
}

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    appointmentId: 7,
    doctorWpUserId: 34,
    clinicId: 4,
    paymentOrderId: 'po_1',
    state: 'AWAITING',
    requestedAt: new Date('2026-10-20T02:00:00.000Z'),
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_PUBLIC_URL = 'https://appointment.praktiqu.test';
  store.findApproval.mockResolvedValue(record());
  store.findApprovals.mockResolvedValue(new Map());
  store.insertAwaiting.mockResolvedValue(true);
  store.claimDecision.mockResolvedValue(true);
  store.revertDecision.mockResolvedValue(undefined);
  store.markRefundDone.mockResolvedValue(true);
  store.listUnsettled.mockResolvedValue([]);
  store.listApprovals.mockResolvedValue({ items: [], total: 0 });
  store.countApprovals.mockResolvedValue({ awaiting: 0, refundNeeded: 0 });
  store.userNames.mockResolvedValue(new Map([['u_admin', 'Rina Admin']]));
  store.paymentOrdersByIds.mockResolvedValue(new Map([['po_1', ORDER]]));
  store.findWpUserContact.mockResolvedValue({ email: 'admin@klinik.test', name: 'Rina Admin' });
  writes.setAppointmentStatus.mockResolvedValue({ id: 7, status: 1, cancelled: false });
  sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));
  sessions.listSessionsByIds.mockResolvedValue([]);
  sessions.setSessionStatusDirect.mockResolvedValue(true);
  clinics.findClinicById.mockResolvedValue({
    id: 4n,
    name: 'Klinik Sehat',
    email: 'halo@klinik.test',
    telephone: '0221234567',
    clinicAdminId: 24n,
  });
  email.sendEmail.mockResolvedValue({ ok: true });
  jobsClient.jobs.enqueue.mockResolvedValue(undefined);
  jobsClient.jobs.cancel.mockResolvedValue(undefined);
  schedule.syncSessionReminders.mockResolvedValue(undefined);
  kc.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 24n, clinicId: 4n });
  settings.requiresApproval.mockResolvedValue(true);
});

describe('holdForApproval', () => {
  it('creates the record, schedules the first reminder and mails client and psychologist', async () => {
    expect(await holdForApproval({ row: row(), paymentOrderId: 'po_1', now: NOW })).toBe(true);

    expect(store.insertAwaiting).toHaveBeenCalledWith({
      appointmentId: 7,
      doctorWpUserId: 34,
      clinicId: 4,
      paymentOrderId: 'po_1',
      now: NOW,
    });
    // Session 48 h away: the first run is a day later.
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith({
      hook: 'praktiqu_approval_reminder',
      runAt: new Date('2026-10-21T03:00:00.000Z'),
      args: { appointmentId: 7 },
    });
    const sent = email.sendEmail.mock.calls.map(([m]) => (m as { to: string }).to);
    expect(sent).toEqual(['ada@contoh.test', 'dianda@klinik.test']);
    expect((email.sendEmail.mock.calls[1][0] as { html: string }).html).toContain(
      'https://appointment.praktiqu.test/dashboard/persetujuan/7',
    );
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_requested',
      expect.objectContaining({ resourceId: '7' }),
    );
  });

  it('a record that already exists: no job, no mail', async () => {
    store.insertAwaiting.mockResolvedValue(false);

    expect(await holdForApproval({ row: row(), paymentOrderId: 'po_1', now: NOW })).toBe(false);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('shouldHoldForApproval', () => {
  it('the switch is on and the session is ahead: hold', async () => {
    expect(await shouldHoldForApproval(row(), NOW)).toBe(true);
    expect(settings.requiresApproval).toHaveBeenCalledWith(34);
  });

  it('the switch is off: no hold', async () => {
    settings.requiresApproval.mockResolvedValue(false);
    expect(await shouldHoldForApproval(row(), NOW)).toBe(false);
  });

  it('the session has already started: no hold, whatever the switch says', async () => {
    // Held now it would be overdue at once, and an overdue request can only be rejected.
    expect(await shouldHoldForApproval(row({ slotDate: '2026-10-19' }), NOW)).toBe(false);
    expect(await shouldHoldForApproval(row({ slotDate: '2026-10-20', startTime: '10:00:00' }), NOW)).toBe(false);
  });
});

describe('approveAwaiting', () => {
  it('claims, books with the payment, cancels the reminder and schedules session reminders', async () => {
    await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW });

    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'APPROVED', decidedBy: 'u_psi', decidedAt: NOW });
    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1, {
      gateway: 'xendit',
      wcOrderId: 49863,
      transactionId: 'tx_9',
    });
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(row({ status: SESSION_STATUS.BOOKED }));
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_decided',
      expect.objectContaining({ metadata: expect.objectContaining({ decision: 'APPROVED', onBehalf: false }) }),
    );
  });

  it('a booking marked paid by hand has no order: booked without payment data', async () => {
    await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record({ paymentOrderId: null }), now: NOW });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1, undefined);
  });

  it('an admin approving is recorded as on behalf of the psychologist', async () => {
    await approveAwaiting({ actor: ADMIN as never, row: row(), approval: record(), now: NOW });

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_decided',
      expect.objectContaining({ metadata: expect.objectContaining({ onBehalf: true }) }),
    );
  });

  it('refuses once the session has started, before claiming anything', async () => {
    await expect(
      approveAwaiting({ actor: PSIKOLOG as never, row: row({ slotDate: '2026-10-19' }), approval: record(), now: NOW }),
    ).rejects.toMatchObject({ code: 'session_already_started', status: 422 });

    expect(store.claimDecision).not.toHaveBeenCalled();
  });

  it('a lost race answers 409 naming who decided, and writes nothing', async () => {
    store.claimDecision.mockResolvedValue(false);
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', decidedBy: 'u_admin' }));

    const err = await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ code: 'approval_already_decided', status: 409 });
    expect((err as Error).message).toContain('Rina Admin');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('a failed plugin write undoes the claim and answers 502', async () => {
    writes.setAppointmentStatus.mockRejectedValue(new Error('plugin down'));
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.PENDING }));

    await expect(
      approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW }),
    ).rejects.toMatchObject({ code: 'upstream_failed', status: 502 });

    expect(store.revertDecision).toHaveBeenCalledWith(7, 'APPROVED', 'u_psi');
    expect(schedule.syncSessionReminders).not.toHaveBeenCalled();
  });

  it('the plugin committed but its answer was lost: the booking IS confirmed, the claim stays', async () => {
    writes.setAppointmentStatus.mockRejectedValue(new Error('socket hang up'));
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));

    await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW });

    expect(store.revertDecision).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(row({ status: SESSION_STATUS.BOOKED }));
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_decided',
      expect.objectContaining({ metadata: expect.objectContaining({ decision: 'APPROVED' }) }),
    );
  });

  it('the plugin failed and the appointment cannot be read back: undone, 502', async () => {
    writes.setAppointmentStatus.mockRejectedValue(new Error('plugin down'));
    sessions.findSessionById.mockRejectedValue(new Error('db down'));

    await expect(
      approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW }),
    ).rejects.toMatchObject({ code: 'upstream_failed', status: 502 });

    expect(store.revertDecision).toHaveBeenCalledWith(7, 'APPROVED', 'u_psi');
  });
});

describe('rejectAwaiting', () => {
  it('claims with the reason, cancels directly (no plugin mail) and mails the client without the reason', async () => {
    await rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'Di luar keahlian saya', now: NOW });

    expect(store.claimDecision).toHaveBeenCalledWith(7, {
      state: 'REJECTED',
      decidedBy: 'u_psi',
      decidedAt: NOW,
      rejectReason: 'Di luar keahlian saya',
    });
    expect(sessions.setSessionStatusDirect).toHaveBeenCalledWith(7, 'CANCELLED');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(sent.to).toBe('ada@contoh.test');
    expect(sent.subject).toBe('Jadwal sesi Anda tidak dapat diterima');
    expect(sent.text).toContain('Klinik Sehat');
    expect(sent.text).not.toContain('Di luar keahlian');
  });

  it('a lost race answers 409 and writes nothing', async () => {
    store.claimDecision.mockResolvedValue(false);
    store.findApproval.mockResolvedValue(record({ state: 'APPROVED', decidedBy: 'u_admin' }));

    await expect(
      rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'x', now: NOW }),
    ).rejects.toMatchObject({ code: 'approval_already_decided', status: 409 });

    expect(sessions.setSessionStatusDirect).not.toHaveBeenCalled();
  });

  it('a failed status write undoes the claim', async () => {
    sessions.setSessionStatusDirect.mockRejectedValue(new Error('db down'));

    await expect(
      rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'x', now: NOW }),
    ).rejects.toMatchObject({ code: 'status_write_failed', status: 500 });

    expect(store.revertDecision).toHaveBeenCalledWith(7, 'REJECTED', 'u_psi');
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('closeOnCancel', () => {
  it('closes an AWAITING record as CANCELLED and stops its reminders', async () => {
    expect(await closeOnCancel(7, 'u_admin', NOW)).toBe(true);

    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'CANCELLED', decidedBy: 'u_admin', decidedAt: NOW });
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    expect(log.logging.audit).toHaveBeenCalledWith('session.approval_cancelled', expect.objectContaining({ resourceId: '7' }));
  });

  it('nothing to close: no job call', async () => {
    store.claimDecision.mockResolvedValue(false);

    expect(await closeOnCancel(7, null, NOW)).toBe(false);
    expect(jobsClient.jobs.cancel).not.toHaveBeenCalled();
  });
});

describe('settleExternal', () => {
  it('BOOKED outside the app: closes as APPROVED by nobody', async () => {
    await settleExternal(7, SESSION_STATUS.BOOKED, NOW);
    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'APPROVED', decidedBy: null, decidedAt: NOW });
  });

  it('CANCELLED outside the app: closes as CANCELLED with a refund to make', async () => {
    await settleExternal(7, SESSION_STATUS.CANCELLED, NOW);
    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'CANCELLED', decidedBy: null, decidedAt: NOW });
  });
});

describe('finishRejection', () => {
  const REJECTED = record({ state: 'REJECTED', decidedBy: 'u_psi', rejectReason: 'x', refundStatus: 'NEEDED' });

  it('writes the CANCELLED a rejection never got, directly and only over PENDING, and stops the reminders', async () => {
    expect(await finishRejection(REJECTED)).toBe(true);

    expect(sessions.setSessionStatusDirect).toHaveBeenCalledWith(7, 'CANCELLED', { from: 'PENDING' });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(store.claimDecision).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    // Nobody is mailed from here: a read finishes rejections too (see notifyFinishedRejection).
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('someone else moved the appointment first: false, and nothing else is done', async () => {
    sessions.setSessionStatusDirect.mockResolvedValue(false);

    expect(await finishRejection(REJECTED)).toBe(false);

    expect(jobsClient.jobs.cancel).not.toHaveBeenCalled();
    expect(log.logging.audit).not.toHaveBeenCalled();
  });
});

describe('notifyFinishedRejection', () => {
  it("writes the decision's audit and sends the client the mail rejectAwaiting never got to", async () => {
    await notifyFinishedRejection(
      record({ state: 'REJECTED', decidedBy: 'u_psi', rejectReason: 'Di luar keahlian saya', refundStatus: 'NEEDED' }),
      row(),
    );

    expect(log.logging.audit).toHaveBeenCalledWith('session.approval_decided', {
      userId: 'u_psi',
      resource: 'session',
      resourceId: '7',
      action: 'session.approval_decided',
      metadata: { decision: 'REJECTED', reason: 'Di luar keahlian saya', professionalId: 34, recovered: true },
    });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string; template: string };
    expect(sent.to).toBe('ada@contoh.test');
    expect(sent.subject).toBe('Jadwal sesi Anda tidak dapat diterima');
    expect(sent.template).toBe('approval_client_rejected');
    expect(sent.text).toContain('Klinik Sehat');
    expect(sent.text).not.toContain('Di luar keahlian');
  });
});

describe('reconcile on read', () => {
  const REJECTED_8 = record({ appointmentId: 8, state: 'REJECTED', decidedBy: 'u_psi', rejectReason: 'x', refundStatus: 'NEEDED' });

  it('listQueue settles stranded records before it pages and counts', async () => {
    store.listUnsettled.mockResolvedValue([record(), REJECTED_8, record({ appointmentId: 9 }), record({ appointmentId: 10 })]);
    sessions.listSessionsByIds.mockResolvedValueOnce([
      row({ id: 7, status: SESSION_STATUS.CANCELLED }),
      row({ id: 8, status: SESSION_STATUS.PENDING }),
      row({ id: 9, status: SESSION_STATUS.CHECK_OUT }),
      row({ id: 10, status: SESSION_STATUS.PENDING }),
    ]);

    await listQueue(ADMIN as never, { filter: 'AWAITING', page: 1, limit: 20 }, NOW);

    expect(store.listUnsettled).toHaveBeenCalledWith({ clinicId: 4, doctorWpUserId: undefined });
    expect(sessions.listSessionsByIds).toHaveBeenNthCalledWith(1, [7, 8, 9, 10]);
    // Cancelled in KiviCare: CANCELLED with a refund to make.
    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'CANCELLED', decidedBy: null, decidedAt: NOW });
    // A rejection whose CANCELLED write never landed: finished.
    expect(sessions.setSessionStatusDirect).toHaveBeenCalledWith(8, 'CANCELLED', { from: 'PENDING' });
    // Checked out (a bill settled): approved outside the app.
    expect(store.claimDecision).toHaveBeenCalledWith(9, { state: 'APPROVED', decidedBy: null, decidedAt: NOW });
    // Still waiting: left alone.
    expect(store.claimDecision).not.toHaveBeenCalledWith(10, expect.anything());
    expect(sessions.setSessionStatusDirect).toHaveBeenCalledTimes(1);

    const settledAt = store.claimDecision.mock.invocationCallOrder[0];
    expect(settledAt).toBeLessThan(store.listApprovals.mock.invocationCallOrder[0]);
    expect(settledAt).toBeLessThan(store.countApprovals.mock.invocationCallOrder[0]);
  });

  it('a failure while settling is logged and the queue still answers', async () => {
    store.listUnsettled.mockResolvedValue([REJECTED_8]);
    sessions.listSessionsByIds.mockResolvedValueOnce([row({ id: 8, status: SESSION_STATUS.PENDING })]);
    sessions.setSessionStatusDirect.mockRejectedValue(new Error('db down'));

    await expect(listQueue(ADMIN as never, { filter: 'AWAITING', page: 1, limit: 20 }, NOW)).resolves.toMatchObject({
      counts: { awaiting: 0, refundNeeded: 0 },
    });
    expect(log.logging.error).toHaveBeenCalled();
  });

  it('nothing unsettled: no session read for it', async () => {
    await listQueue(ADMIN as never, { filter: 'AWAITING', page: 1, limit: 20 }, NOW);

    expect(sessions.listSessionsByIds).toHaveBeenCalledTimes(1); // toItems only
  });

  it('getApprovalItem settles its one record before building the item', async () => {
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.PENDING }));
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', decidedBy: 'u_psi', rejectReason: 'x', refundStatus: 'NEEDED' }));
    sessions.listSessionsByIds.mockResolvedValue([row({ status: SESSION_STATUS.PENDING })]);
    store.findApprovals.mockResolvedValue(new Map([[7, record({ state: 'REJECTED', refundStatus: 'NEEDED' })]]));

    await getApprovalItem(ADMIN as never, 7, NOW);

    expect(sessions.setSessionStatusDirect).toHaveBeenCalledWith(7, 'CANCELLED', { from: 'PENDING' });
    // A read finishes the rejection but mails nobody.
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(sessions.setSessionStatusDirect.mock.invocationCallOrder[0]).toBeLessThan(
      store.findApprovals.mock.invocationCallOrder[0],
    );
  });

  it('getApprovalItem: an AWAITING record whose appointment was booked in KiviCare is closed as approved', async () => {
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));
    store.findApproval.mockResolvedValue(record());
    sessions.listSessionsByIds.mockResolvedValue([row({ status: SESSION_STATUS.BOOKED })]);
    store.findApprovals.mockResolvedValue(new Map([[7, record({ state: 'APPROVED' })]]));

    await getApprovalItem(ADMIN as never, 7, NOW);

    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'APPROVED', decidedBy: null, decidedAt: NOW });
  });
});

describe('markRefunded', () => {
  beforeEach(() => {
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', refundStatus: 'NEEDED' }));
  });

  it('a psychologist may not mark a refund', async () => {
    await expect(
      markRefunded({ actor: PSIKOLOG as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(store.markRefundDone).not.toHaveBeenCalled();
  });

  it("a clinic admin of another clinic may not either", async () => {
    kc.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 24n, clinicId: 9n });

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('404 without an approval record', async () => {
    store.findApproval.mockResolvedValue(null);

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'approval_not_found', status: 404 });
  });

  it('409 when there is no refund to mark', async () => {
    store.markRefundDone.mockResolvedValue(false);

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'refund_not_needed', status: 409 });
  });

  it('marks it and answers the updated view', async () => {
    store.findApprovals.mockResolvedValue(
      new Map([
        [
          7,
          record({
            state: 'REJECTED',
            refundStatus: 'DONE',
            refundedBy: 'u_admin',
            refundedAt: NOW,
            refundNote: 'Transfer BCA 21/10',
          }),
        ],
      ]),
    );

    const view = await markRefunded({ actor: ADMIN as never, appointmentId: 7, note: 'Transfer BCA 21/10', now: NOW });

    expect(store.markRefundDone).toHaveBeenCalledWith(7, 'u_admin', 'Transfer BCA 21/10', NOW);
    expect(view).toMatchObject({ refundStatus: 'DONE', refundedByName: 'Rina Admin', refundNote: 'Transfer BCA 21/10' });
  });
});

describe('views', () => {
  it('approvalViews builds the staff view with names and payment', async () => {
    store.findApprovals.mockResolvedValue(
      new Map([
        [
          7,
          record({
            state: 'REJECTED',
            decidedBy: 'u_admin',
            decidedAt: NOW,
            rejectReason: 'Jadwal bentrok',
            refundStatus: 'NEEDED',
          }),
        ],
      ]),
    );

    const views = await approvalViews([row()], NOW);

    expect(views.get(7)).toEqual({
      state: 'REJECTED',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: NOW.toISOString(),
      decidedByName: 'Rina Admin',
      rejectReason: 'Jadwal bentrok',
      refundStatus: 'NEEDED',
      refundedAt: null,
      refundedByName: null,
      refundNote: null,
      isOverdue: false,
      payment: { gateway: 'xendit', wcOrderId: 49863, expectedAmount: 350000, chargedAmount: 350000, chargedCurrency: 'IDR' },
    });
  });

  it('isOverdue only for an AWAITING record whose session has started', async () => {
    store.findApprovals.mockResolvedValue(new Map([[7, record()]]));
    const past = row({ slotDate: '2026-10-19' });
    expect((await approvalViews([past], NOW)).get(7)!.isOverdue).toBe(true);

    store.findApprovals.mockResolvedValue(new Map([[7, record({ state: 'REJECTED' })]]));
    expect((await approvalViews([past], NOW)).get(7)!.isOverdue).toBe(false);
  });

  it('withApprovals sets null where there is no record', async () => {
    const [s] = await withApprovals([row()], NOW);
    expect(s.approval).toBeNull();
  });

  it('toPublicApprovalView keeps only what a client may see', async () => {
    store.findApprovals.mockResolvedValue(
      new Map([[7, record({ state: 'REJECTED', decidedBy: 'u_admin', decidedAt: NOW, rejectReason: 'rahasia', refundStatus: 'NEEDED' })]]),
    );
    const staff = (await approvalViews([row()], NOW)).get(7)!;

    expect(toPublicApprovalView(staff)).toEqual({
      state: 'REJECTED',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: NOW.toISOString(),
      refundStatus: 'NEEDED',
      isOverdue: false,
    });
  });

  it('publicApprovalView carries no names, reason or order', async () => {
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', rejectReason: 'rahasia', decidedBy: 'u_admin' }));

    const view = await publicApprovalView(row(), NOW);

    expect(Object.keys(view!).sort()).toEqual(['decidedAt', 'isOverdue', 'refundStatus', 'requestedAt', 'state']);
  });
});
