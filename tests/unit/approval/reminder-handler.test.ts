/**
 * approval.reminder — one Action Scheduler job per waiting booking (spec §4.4).
 *
 * The clock is injected, so each scenario is exact. The service's own decisions
 * (completeApproval, settleExternal) are mocked: here we pin WHEN the handler calls them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const store = vi.hoisted(() => ({ findApproval: vi.fn(), touchReminder: vi.fn(), markEscalated: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  ...store,
}));

const decisions = vi.hoisted(() => ({
  completeApproval: vi.fn(),
  settleExternal: vi.fn(),
  finishRejection: vi.fn(),
  clinicAdminContact: vi.fn(),
}));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  ...decisions,
}));

const sessions = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => sessions.findSessionById(...a),
}));

vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: async () => ({ name: 'Konseling Individu' }),
}));

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

import { handleApprovalReminder } from '@/services/approval/reminder-handler';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-20T03:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

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
    slotDate: '2026-10-23', // 2026-10-23T03:00Z = T0 + 72 h
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: T0,
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
    requestedAt: T0,
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

const recipients = () => email.sendEmail.mock.calls.map(([m]) => (m as { to: string }).to);

beforeEach(() => {
  vi.clearAllMocks();
  store.findApproval.mockResolvedValue(record());
  store.touchReminder.mockResolvedValue(undefined);
  store.markEscalated.mockResolvedValue(undefined);
  sessions.findSessionById.mockResolvedValue(row());
  decisions.clinicAdminContact.mockResolvedValue({ email: 'admin@klinik.test', name: 'Rina' });
  decisions.completeApproval.mockResolvedValue(undefined);
  decisions.settleExternal.mockResolvedValue(undefined);
  decisions.finishRejection.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
  jobsClient.jobs.enqueue.mockResolvedValue(undefined);
});

describe('handleApprovalReminder', () => {
  it('a day after the request: reminds the psychologist, escalates once, runs again', async () => {
    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(recipients()).toEqual(['dianda@klinik.test', 'admin@klinik.test']);
    expect(store.touchReminder).toHaveBeenCalledWith(7, at(24));
    expect(store.markEscalated).toHaveBeenCalledWith(7, at(24));
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith({
      hook: 'praktiqu_approval_reminder',
      runAt: at(48),
      args: { appointmentId: 7 },
    });
  });

  it('already escalated and reminded recently: mails nobody, still reschedules', async () => {
    store.findApproval.mockResolvedValue(record({ lastReminderAt: at(20), escalatedAt: at(1) }));

    await handleApprovalReminder({ appointmentId: 7 }, at(25));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a clinic with no admin: marks the escalation done anyway', async () => {
    decisions.clinicAdminContact.mockResolvedValue(null);

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(recipients()).toEqual(['dianda@klinik.test']);
    expect(store.markEscalated).toHaveBeenCalledWith(7, at(24));
    expect(log.logging.audit).toHaveBeenCalledWith(
      'approval.reminder.ran',
      expect.objectContaining({ metadata: expect.objectContaining({ escalated: 'no_admin' }) }),
    );
  });

  it('the session has started: nothing, and no next run', async () => {
    await handleApprovalReminder({ appointmentId: 7 }, at(73));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('APPROVED on a PENDING appointment: finishes the approval', async () => {
    const approved = record({ state: 'APPROVED', decidedBy: 'u_psi' });
    store.findApproval.mockResolvedValue(approved);

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(decisions.completeApproval).toHaveBeenCalledWith(approved);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it.each([SESSION_STATUS.BOOKED, SESSION_STATUS.CANCELLED])(
    'AWAITING but the appointment is %s: settles it',
    async (status) => {
      sessions.findSessionById.mockResolvedValue(row({ status }));

      await handleApprovalReminder({ appointmentId: 7 }, at(24));

      expect(decisions.settleExternal).toHaveBeenCalledWith(7, status, at(24));
      expect(email.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('REJECTED but the appointment is still PENDING: finishes the rejection', async () => {
    const rejected = record({ state: 'REJECTED', decidedBy: 'u_psi', rejectReason: 'x', refundStatus: 'NEEDED' });
    store.findApproval.mockResolvedValue(rejected);

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(decisions.finishRejection).toHaveBeenCalledWith(rejected);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('already decided: skipped', async () => {
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED' }));
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(decisions.settleExternal).not.toHaveBeenCalled();
    expect(decisions.finishRejection).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a positive integer, and accepts a numeric string', async () => {
    await handleApprovalReminder({ appointmentId: 'abc' }, at(24));
    expect(store.findApproval).not.toHaveBeenCalled();
    expect(log.logging.warn).toHaveBeenCalled();

    await handleApprovalReminder({ appointmentId: '7' }, at(24));
    expect(store.findApproval).toHaveBeenCalledWith(7);
  });
});
