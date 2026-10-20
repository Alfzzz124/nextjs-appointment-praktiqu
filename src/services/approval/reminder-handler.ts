/**
 * `approval.reminder` — one Action Scheduler job per waiting booking, rescheduled by itself
 * until the booking is decided or its start passes (spec §4.4).
 *
 * Runs in the background with nobody waiting on it, so it never throws on a refusal: it
 * logs and ends. WordPress-side unscheduling is best-effort and WP-Cron runs late, so every
 * run re-reads the record and the appointment and acts only on what is true now.
 */
import { jobs } from '@/lib/jobs/client';
import { registerJobHandler } from '@/lib/jobs/webhook-handler';
import { logging } from '@/lib/logging';
import { SESSION_STATUS, findSessionById } from '@/repositories/wp/sessions.repo';
import { sessionStartsAtUtc } from '@/services/session/reminder-schedule';
import { buildAdminEscalationEmail, buildProfessionalRequestEmail } from './emails';
import { planReminder } from './schedule';
import {
  APPROVAL_REMINDER_EVENT,
  APPROVAL_REMINDER_HOOK,
  approvalLink,
  approvalReminderArgs,
  clinicAdminContact,
  completeApproval,
  mail,
  mailFacts,
  settleExternal,
} from './service';
import * as store from './store';

export async function handleApprovalReminder(data: Record<string, unknown>, now: Date = new Date()): Promise<void> {
  // Crosses a JSON boundary from WordPress, which may send "7". Coerced, then checked.
  const appointmentId = Number(data.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    await logging.warn(`${APPROVAL_REMINDER_EVENT}: invalid appointmentId`, { metadata: { data } });
    return;
  }
  const resourceId = String(appointmentId);

  const approval = await store.findApproval(appointmentId);
  const row = approval ? await findSessionById(appointmentId) : null;
  if (!approval || !row) {
    await logging.warn(`${APPROVAL_REMINDER_EVENT}: approval or session not found`, { resource: 'session', resourceId });
    return;
  }

  // The record and the appointment disagree: settle that, then stop. An APPROVED record on
  // a PENDING appointment is an approval that died before it reached the plugin.
  if (approval.state === store.APPROVAL_STATE.APPROVED && row.status === SESSION_STATUS.PENDING) {
    await completeApproval(approval);
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.completed`, { resource: 'session', resourceId });
    return;
  }
  if (approval.state === store.APPROVAL_STATE.AWAITING && row.status !== SESSION_STATUS.PENDING) {
    await settleExternal(appointmentId, row.status, now);
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.settled`, {
      resource: 'session',
      resourceId,
      metadata: { status: row.status },
    });
    return;
  }
  if (approval.state !== store.APPROVAL_STATE.AWAITING) {
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.skipped`, {
      resource: 'session',
      resourceId,
      metadata: { reason: 'decided', state: approval.state },
    });
    return;
  }

  const startsAt = sessionStartsAtUtc(row);
  if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= now.getTime()) {
    // Overdue: the queue shows it as "Terlewat" and only a rejection is left. Nagging about
    // a session that already started helps nobody.
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.skipped`, {
      resource: 'session',
      resourceId,
      metadata: { reason: startsAt ? 'overdue' : 'no_schedule' },
    });
    return;
  }

  const plan = planReminder({
    now,
    startsAt,
    requestedAt: approval.requestedAt,
    lastReminderAt: approval.lastReminderAt,
    escalatedAt: approval.escalatedAt,
  });
  const facts = await mailFacts(row);
  const link = approvalLink(appointmentId);

  let reminded = false;
  if (plan.remindProfessional && facts) {
    reminded = await mail(
      row.professionalEmail,
      buildProfessionalRequestEmail({ ...facts, link, waitingSince: approval.requestedAt }),
      'approval_professional_reminder',
    );
    await store.touchReminder(appointmentId, now);
  }

  let escalated: 'sent' | 'no_admin' | null = null;
  if (plan.escalate) {
    const admin = await clinicAdminContact(row.clinicId);
    if (admin && facts) {
      await mail(
        admin.email,
        buildAdminEscalationEmail({ ...facts, adminName: admin.name, link, requestedAt: approval.requestedAt }),
        'approval_admin_escalation',
      );
    }
    // Marked either way: an escalation with nobody to receive it would otherwise be retried
    // on every run. The queue still shows the booking to the super admin.
    await store.markEscalated(appointmentId, now);
    escalated = admin ? 'sent' : 'no_admin';
  }

  if (plan.nextRunAt) {
    await jobs.enqueue({ hook: APPROVAL_REMINDER_HOOK, runAt: plan.nextRunAt, args: approvalReminderArgs(appointmentId) });
  }

  await logging.audit(`${APPROVAL_REMINDER_EVENT}.ran`, {
    resource: 'session',
    resourceId,
    metadata: { reminded, escalated, nextRunAt: plan.nextRunAt ? plan.nextRunAt.toISOString() : null },
  });
}

// Side effect on load. The jobs webhook route imports this module for exactly this; see
// the comment in src/app/api/v1/webhooks/wordpress-jobs/route.ts.
registerJobHandler(APPROVAL_REMINDER_EVENT, (data) => handleApprovalReminder(data));
