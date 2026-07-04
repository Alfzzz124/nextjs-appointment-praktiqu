import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedFollowupChain, seedFollowup, cleanup } from './fixtures';
import {
  createChain, getChain, createFollowup, getFollowup, listFollowups,
  completeFollowup, bulkSetFollowupStatus, listDueFollowups, listActivity,
  createReminder, sendReminderNow,
} from '@/services/billing/followup.service';

const CLINIC = 9_000_001, DOCTOR = 9_000_002, PATIENT = 9_000_003;
const OTHER_DOCTOR = 9_000_012;

// KcActor shapes (see encounter.service.test.ts). SUPER_ADMIN → null scope.
const kcSuper = { actor: { id: 'a', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;
const kcPro = { actor: { id: 'p', role: 'PROFESSIONAL', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;
// scope objects mirror followupScopeFor()
const scopeSuper = null;
const scopePro = { doctorId: BigInt(DOCTOR) };
const scopeOtherPro = { doctorId: BigInt(OTHER_DOCTOR) };

describe('followup.service', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); });
  afterAll(cleanup);

  it('createChain → createFollowup enforces chain_id + in-scope chain', async () => {
    const chain = await createChain({ patientId: PATIENT, doctorId: DOCTOR, clinicId: CLINIC }, kcSuper);
    expect(chain.id).toBeGreaterThan(0);

    const { id } = await createFollowup({
      chainId: chain.id, patientId: PATIENT, doctorId: DOCTOR, clinicId: CLINIC,
      reason: 'BP check', priority: 'routine',
      suggestedDate: '2026-07-10 09:00:00', suggestedDeadline: '2026-07-20 09:00:00',
    }, kcSuper);
    expect(id).toBeGreaterThan(0);

    const got = await getFollowup(id, scopeSuper);
    expect(got.chain_id).toBe(chain.id);
    expect(got.status).toBe('pending');

    // assertChainInScope: a PROFESSIONAL not owning the chain's doctor cannot create in it.
    const otherChain = await seedFollowupChain({ id: 9_000_020, clinicId: CLINIC, doctorId: OTHER_DOCTOR, patientId: PATIENT });
    await expect(createFollowup({
      chainId: otherChain.id, patientId: PATIENT,
      reason: 'x', priority: 'routine',
      suggestedDate: '2026-07-10 09:00:00', suggestedDeadline: '2026-07-20 09:00:00',
    }, kcPro)).rejects.toThrow();
  });

  it('list/get is scoped by doctor_id for PROFESSIONAL', async () => {
    const chain = await seedFollowupChain({ id: 9_000_030, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const f = await seedFollowup({ id: 9_000_031, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });

    const mine = await listFollowups({ page: 1, perPage: 10 } as any, scopePro);
    expect(mine.followups.some((x) => x.id === Number(f.id))).toBe(true);

    // Another doctor's scope cannot see it.
    const theirs = await listFollowups({ page: 1, perPage: 10 } as any, scopeOtherPro);
    expect(theirs.followups.some((x) => x.id === Number(f.id))).toBe(false);
    await expect(getFollowup(Number(f.id), scopeOtherPro)).rejects.toThrow();
  });

  it('completeFollowup sets status/completed_at_utc and writes an activity_log row', async () => {
    const chain = await seedFollowupChain({ id: 9_000_040, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const f = await seedFollowup({ id: 9_000_041, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });

    await completeFollowup(Number(f.id), 'done', kcSuper, scopeSuper);
    const got = await getFollowup(Number(f.id), scopeSuper);
    expect(got.status).toBe('completed');
    expect(got.completed_at_utc).toBeTruthy();

    const { activity } = await listActivity(Number(f.id), scopeSuper);
    expect(activity.some((a) => a.action === 'completed' && a.new_status === 'completed')).toBe(true);
  });

  it('bulkSetFollowupStatus updates only in-scope rows', async () => {
    const chain = await seedFollowupChain({ id: 9_000_050, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const a = await seedFollowup({ id: 9_000_051, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const b = await seedFollowup({ id: 9_000_052, chainId: chain.id, clinicId: CLINIC, doctorId: OTHER_DOCTOR, patientId: PATIENT });

    const n = await bulkSetFollowupStatus([Number(a.id), Number(b.id)], 'scheduled', 'batch', kcPro, scopePro);
    expect(n).toBe(1); // only the DOCTOR-owned row
    expect((await getFollowup(Number(a.id), scopeSuper)).status).toBe('scheduled');
    expect((await getFollowup(Number(b.id), scopeSuper)).status).toBe('pending');
  });

  it('listDueFollowups returns pending followups past their deadline', async () => {
    const chain = await seedFollowupChain({ id: 9_000_060, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const due = await seedFollowup({
      id: 9_000_061, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT,
      status: 'pending', suggestedDeadline: '2020-01-01 09:00:00',
    });
    const notDue = await seedFollowup({
      id: 9_000_062, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT,
      status: 'pending', suggestedDeadline: '2099-01-01 09:00:00',
    });

    const { followups } = await listDueFollowups(kcSuper, scopeSuper);
    expect(followups.some((x) => x.id === Number(due.id))).toBe(true);
    expect(followups.some((x) => x.id === Number(notDue.id))).toBe(false);
  });

  it('createReminder + sendReminderNow: email dev-logs ok and marks processed_at', async () => {
    const chain = await seedFollowupChain({ id: 9_000_070, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const f = await seedFollowup({ id: 9_000_071, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });

    const { id: reminderId } = await createReminder(
      Number(f.id), { reminderType: 'deadline', offsetDays: 0, channel: 'email' }, scopeSuper,
    );
    expect(reminderId).toBeGreaterThan(0);

    // sendEmail dev-logs without RESEND_API_KEY and never throws → sent >= 1.
    const res = await sendReminderNow(Number(f.id), kcSuper, scopeSuper);
    expect(res.sent).toBeGreaterThanOrEqual(1);

    const { reminders } = await import('@/services/billing/followup.service').then((m) => m.listReminders(Number(f.id), scopeSuper));
    expect(reminders.find((r) => r.id === reminderId)?.processed_at).toBeTruthy();
  });

  it('sendReminderNow throws KcError 501 for an sms reminder', async () => {
    const chain = await seedFollowupChain({ id: 9_000_080, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const f = await seedFollowup({ id: 9_000_081, chainId: chain.id, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    await createReminder(Number(f.id), { reminderType: 'sms-alert', offsetDays: 0, channel: 'sms' }, scopeSuper);

    await expect(sendReminderNow(Number(f.id), kcSuper, scopeSuper)).rejects.toMatchObject({ httpStatus: 501 });
  });
});
