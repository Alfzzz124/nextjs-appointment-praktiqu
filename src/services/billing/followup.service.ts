import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { sendEmail } from '@/lib/email';
import type { KcActor } from '@/services/billing/kc-actor';
import type { FollowupScope } from '@/services/billing/followup-scope';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a scope predicate on direct clinic_id/doctor_id columns for a table alias. */
function scopeClause(scope: FollowupScope | null, alias: string): { sql: string; args: unknown[] } {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (scope?.clinicId !== undefined) { where.push(`${alias}.clinic_id = ?`); args.push(scope.clinicId); }
  if (scope?.doctorId !== undefined) { where.push(`${alias}.doctor_id = ?`); args.push(scope.doctorId); }
  return { sql: where.join(' AND '), args };
}

/** Insert an activity-log row (created_at_utc = UTC_TIMESTAMP()). */
async function logActivity(
  followupId: number,
  userId: bigint,
  action: string,
  oldStatus: string | null,
  newStatus: string | null,
  note?: string | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followup_activity_log (followup_id, user_id, action, old_status, new_status, note, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    followupId, userId, action, oldStatus, newStatus, note ?? null,
  );
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapChainRow(r: any) {
  return {
    id: Number(r.id),
    clinic_id: Number(r.clinic_id),
    patient_id: Number(r.patient_id),
    doctor_id: Number(r.doctor_id),
    diagnosis_id: r.diagnosis_id != null ? Number(r.diagnosis_id) : null,
    name: r.name ?? null,
    status: r.status ?? null,
    created_at_utc: r.created_at_utc ?? null,
    closed_at_utc: r.closed_at_utc ?? null,
    closed_by: r.closed_by != null ? Number(r.closed_by) : null,
    patient_name: r.patient_name ?? null,
    doctor_name: r.doctor_name ?? null,
    clinic_name: r.clinic_name ?? null,
  };
}

function mapFollowupRow(r: any) {
  return {
    id: Number(r.id),
    clinic_id: Number(r.clinic_id),
    doctor_id: Number(r.doctor_id),
    patient_id: Number(r.patient_id),
    encounter_id: r.encounter_id != null ? Number(r.encounter_id) : null,
    chain_id: Number(r.chain_id),
    parent_followup_id: r.parent_followup_id != null ? Number(r.parent_followup_id) : null,
    reason: r.reason ?? null,
    priority: r.priority ?? null,
    status: r.status ?? null,
    created_at_utc: r.created_at_utc ?? null,
    suggested_date_utc: r.suggested_date_utc ?? null,
    suggested_deadline_utc: r.suggested_deadline_utc ?? null,
    scheduled_appointment_id: r.scheduled_appointment_id != null ? Number(r.scheduled_appointment_id) : null,
    completed_at_utc: r.completed_at_utc ?? null,
    cancelled_at_utc: r.cancelled_at_utc ?? null,
    metadata: r.metadata ?? null,
    created_by: r.created_by != null ? Number(r.created_by) : null,
    updated_at_utc: r.updated_at_utc ?? null,
    updated_by: r.updated_by != null ? Number(r.updated_by) : null,
    patient_name: r.patient_name ?? null,
    doctor_name: r.doctor_name ?? null,
    clinic_name: r.clinic_name ?? null,
  };
}

function mapReminderRow(r: any) {
  return {
    id: Number(r.id),
    followup_id: Number(r.followup_id),
    reminder_type: r.reminder_type ?? null,
    offset_days: r.offset_days != null ? Number(r.offset_days) : 0,
    channel: r.channel ?? null,
    action_id: r.action_id != null ? Number(r.action_id) : null,
    processed_at: r.processed_at ?? null,
  };
}

function mapActivityRow(r: any) {
  return {
    id: Number(r.id),
    followup_id: Number(r.followup_id),
    user_id: Number(r.user_id),
    action: r.action ?? null,
    old_status: r.old_status ?? null,
    new_status: r.new_status ?? null,
    note: r.note ?? null,
    created_at_utc: r.created_at_utc ?? null,
  };
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

const CHAIN_JOIN =
  `FROM wp_kc_followup_chains fc
   LEFT JOIN wp_kc_clinics c ON fc.clinic_id = c.id
   LEFT JOIN wp_users d ON fc.doctor_id = d.ID
   LEFT JOIN wp_users pt ON fc.patient_id = pt.ID`;

const CHAIN_COLS =
  `fc.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name`;

export interface ChainListParams {
  page: number;
  perPage: number | 'all';
  patientId?: number;
  doctorId?: number;
  status?: string;
}

export async function listChains(p: ChainListParams, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'fc');
  const where = [scopeSql];
  if (p.patientId !== undefined) { where.push('fc.patient_id = ?'); args.push(p.patientId); }
  if (p.doctorId !== undefined) { where.push('fc.doctor_id = ?'); args.push(p.doctorId); }
  if (p.status !== undefined) { where.push('fc.status = ?'); args.push(p.status); }
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${CHAIN_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);

  let limitSql = '';
  const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') {
    const perPage = p.perPage as number;
    limitSql = ' LIMIT ? OFFSET ?';
    pageArgs.push(perPage, (p.page - 1) * perPage);
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${CHAIN_COLS} ${CHAIN_JOIN} WHERE ${whereSql} ORDER BY fc.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { chains: rows.map(mapChainRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getChain(id: number, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'fc');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${CHAIN_COLS} ${CHAIN_JOIN} WHERE ${scopeSql} AND fc.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Followup chain not found', 404);
  const chain = mapChainRow(rows[0]);

  const fups = await prisma.$queryRawUnsafe<any[]>(
    `SELECT f.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_followups f
     LEFT JOIN wp_kc_clinics c ON f.clinic_id = c.id
     LEFT JOIN wp_users d ON f.doctor_id = d.ID
     LEFT JOIN wp_users pt ON f.patient_id = pt.ID
     WHERE f.chain_id = ? ORDER BY f.id ASC`, id,
  );
  return { ...chain, followups: fups.map(mapFollowupRow) };
}

/** Throw 404 unless the chain exists and is in scope. Returns the chain row. */
export async function assertChainInScope(chainId: number, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'fc');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT fc.* FROM wp_kc_followup_chains fc WHERE ${scopeSql} AND fc.id = ?`, ...args, chainId,
  );
  if (!rows[0]) throw new KcError('Followup chain not found', 404);
  return rows[0];
}

export interface ChainCreateInput {
  patientId: number;
  doctorId?: number;
  clinicId?: number;
  name?: string;
  diagnosisId?: number;
}

export async function createChain(input: ChainCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN'
    ? BigInt(input.clinicId ?? 0)
    : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  const doctorId = kc.actor.role === 'PROFESSIONAL'
    ? kc.wpUserId
    : BigInt(input.doctorId ?? Number(kc.wpUserId));
  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followup_chains (clinic_id, patient_id, doctor_id, diagnosis_id, name, status, created_at_utc)
     VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP())`,
    clinicId, BigInt(input.patientId), doctorId,
    input.diagnosisId != null ? BigInt(input.diagnosisId) : null,
    input.name ?? null,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export interface ChainUpdateInput {
  name?: string;
  status?: string;
}

export async function updateChain(id: number, input: ChainUpdateInput, kc: KcActor, scope: FollowupScope | null): Promise<void> {
  await assertChainInScope(id, scope); // scope + existence
  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); args.push(input.name); }
  if (input.status !== undefined) {
    sets.push('status = ?'); args.push(input.status);
    if (input.status === 'closed') {
      sets.push('closed_at_utc = UTC_TIMESTAMP()');
      sets.push('closed_by = ?'); args.push(kc.wpUserId);
    }
  }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_followup_chains SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

// ---------------------------------------------------------------------------
// Followups
// ---------------------------------------------------------------------------

const FUP_JOIN =
  `FROM wp_kc_followups f
   LEFT JOIN wp_kc_clinics c ON f.clinic_id = c.id
   LEFT JOIN wp_users d ON f.doctor_id = d.ID
   LEFT JOIN wp_users pt ON f.patient_id = pt.ID`;

const FUP_COLS =
  `f.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name`;

export interface FollowupListParams {
  page: number;
  perPage: number | 'all';
  chainId?: number;
  patientId?: number;
  doctorId?: number;
  status?: string;
  priority?: string;
}

export async function listFollowups(p: FollowupListParams, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const where = [scopeSql];
  if (p.chainId !== undefined) { where.push('f.chain_id = ?'); args.push(p.chainId); }
  if (p.patientId !== undefined) { where.push('f.patient_id = ?'); args.push(p.patientId); }
  if (p.doctorId !== undefined) { where.push('f.doctor_id = ?'); args.push(p.doctorId); }
  if (p.status !== undefined) { where.push('f.status = ?'); args.push(p.status); }
  if (p.priority !== undefined) { where.push('f.priority = ?'); args.push(p.priority); }
  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${FUP_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);

  let limitSql = '';
  const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') {
    const perPage = p.perPage as number;
    limitSql = ' LIMIT ? OFFSET ?';
    pageArgs.push(perPage, (p.page - 1) * perPage);
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${FUP_COLS} ${FUP_JOIN} WHERE ${whereSql} ORDER BY f.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { followups: rows.map(mapFollowupRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getFollowup(id: number, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${FUP_COLS} ${FUP_JOIN} WHERE ${scopeSql} AND f.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Followup not found', 404);
  return mapFollowupRow(rows[0]);
}

export interface FollowupCreateInput {
  chainId: number;
  patientId: number;
  doctorId?: number;
  clinicId?: number;
  encounterId?: number;
  parentFollowupId?: number;
  reason: string;
  priority: string;
  suggestedDate: string;
  suggestedDeadline: string;
  metadata?: string;
}

export async function createFollowup(input: FollowupCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN'
    ? BigInt(input.clinicId ?? 0)
    : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  const doctorId = kc.actor.role === 'PROFESSIONAL'
    ? kc.wpUserId
    : BigInt(input.doctorId ?? Number(kc.wpUserId));
  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  // A followup must belong to an in-scope chain.
  await assertChainInScope(input.chainId, kc.actor.role === 'SUPER_ADMIN' ? null : { clinicId, doctorId: kc.actor.role === 'PROFESSIONAL' ? doctorId : undefined });

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followups
       (clinic_id, doctor_id, patient_id, encounter_id, chain_id, parent_followup_id,
        reason, priority, status, created_at_utc, suggested_date_utc, suggested_deadline_utc,
        metadata, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), ?, ?, ?, ?)`,
    clinicId, doctorId, BigInt(input.patientId),
    input.encounterId != null ? BigInt(input.encounterId) : null,
    BigInt(input.chainId),
    input.parentFollowupId != null ? BigInt(input.parentFollowupId) : null,
    input.reason, input.priority,
    input.suggestedDate, input.suggestedDeadline,
    input.metadata ?? null, kc.wpUserId,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  const id = Number(idRow[0].id);
  await logActivity(id, kc.wpUserId, 'created', null, 'pending');
  return { id };
}

export interface FollowupUpdateInput {
  reason?: string;
  priority?: string;
  status?: string;
  suggestedDate?: string;
  suggestedDeadline?: string;
}

export async function updateFollowup(id: number, input: FollowupUpdateInput, kc: KcActor, scope: FollowupScope | null): Promise<void> {
  const current = await getFollowup(id, scope); // scope + existence
  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.reason !== undefined) { sets.push('reason = ?'); args.push(input.reason); }
  if (input.priority !== undefined) { sets.push('priority = ?'); args.push(input.priority); }
  if (input.suggestedDate !== undefined) { sets.push('suggested_date_utc = ?'); args.push(input.suggestedDate); }
  if (input.suggestedDeadline !== undefined) { sets.push('suggested_deadline_utc = ?'); args.push(input.suggestedDeadline); }

  const statusChanged = input.status !== undefined && input.status !== current.status;
  if (input.status !== undefined) { sets.push('status = ?'); args.push(input.status); }
  if (statusChanged) {
    sets.push('updated_at_utc = UTC_TIMESTAMP()');
    sets.push('updated_by = ?'); args.push(kc.wpUserId);
  }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_followups SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
  if (statusChanged) {
    await logActivity(id, kc.wpUserId, 'updated', current.status, input.status ?? null);
  }
}

export async function deleteFollowup(id: number, kc: KcActor, scope: FollowupScope | null): Promise<void> {
  await getFollowup(id, scope); // scope + existence
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_activity_log WHERE followup_id = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_reminders WHERE followup_id = ?`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followups WHERE id = ?`, id);
}

export async function completeFollowup(id: number, note: string | undefined, kc: KcActor, scope: FollowupScope | null): Promise<void> {
  const current = await getFollowup(id, scope);
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_followups SET status = 'completed', completed_at_utc = UTC_TIMESTAMP(),
       updated_at_utc = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?`,
    kc.wpUserId, id,
  );
  await logActivity(id, kc.wpUserId, 'completed', current.status, 'completed', note ?? null);
}

export async function cancelFollowup(id: number, note: string | undefined, kc: KcActor, scope: FollowupScope | null): Promise<void> {
  const current = await getFollowup(id, scope);
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_followups SET status = 'cancelled', cancelled_at_utc = UTC_TIMESTAMP(),
       updated_at_utc = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?`,
    kc.wpUserId, id,
  );
  await logActivity(id, kc.wpUserId, 'cancelled', current.status, 'cancelled', note ?? null);
}

export async function bulkSetFollowupStatus(ids: number[], status: string, note: string | undefined, kc: KcActor, scope: FollowupScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT f.id, f.status FROM wp_kc_followups f WHERE ${scopeSql} AND f.id IN (${placeholders})`,
    ...args, ...ids,
  );
  if (inScope.length === 0) return 0;
  const okIds = inScope.map((r) => Number(r.id));
  const ph = okIds.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_followups SET status = ?, updated_at_utc = UTC_TIMESTAMP(), updated_by = ? WHERE id IN (${ph})`,
    status, kc.wpUserId, ...okIds,
  );
  for (const r of inScope) {
    await logActivity(Number(r.id), kc.wpUserId, 'updated', r.status ?? null, status, note ?? null);
  }
  return okIds.length;
}

export async function listDueFollowups(kc: KcActor, scope: FollowupScope | null) {
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${FUP_COLS} ${FUP_JOIN}
     WHERE ${scopeSql}
       AND f.status IN ('pending','scheduled')
       AND f.suggested_deadline_utc <= UTC_TIMESTAMP()
     ORDER BY f.suggested_deadline_utc ASC`,
    ...args,
  );
  return { followups: rows.map(mapFollowupRow) };
}

export async function listActivity(followupId: number, scope: FollowupScope | null) {
  await getFollowup(followupId, scope); // scope + existence
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM wp_kc_followup_activity_log WHERE followup_id = ? ORDER BY id ASC`, followupId,
  );
  return { activity: rows.map(mapActivityRow) };
}

// ---------------------------------------------------------------------------
// Reminders (Task 3)
// ---------------------------------------------------------------------------

export async function listReminders(followupId: number, scope: FollowupScope | null) {
  await getFollowup(followupId, scope); // scope + existence of parent
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM wp_kc_followup_reminders WHERE followup_id = ? ORDER BY id ASC`, followupId,
  );
  return { reminders: rows.map(mapReminderRow) };
}

export interface ReminderCreateInput {
  reminderType: string;
  offsetDays: number;
  channel: string;
}

export async function createReminder(followupId: number, input: ReminderCreateInput, scope: FollowupScope | null): Promise<{ id: number }> {
  await getFollowup(followupId, scope); // scope + existence of parent
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followup_reminders (followup_id, reminder_type, offset_days, channel, action_id, processed_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
    followupId, input.reminderType, input.offsetDays, input.channel,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export async function deleteReminder(reminderId: number, scope: FollowupScope | null): Promise<void> {
  // Join to parent followup for scope enforcement.
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT r.id FROM wp_kc_followup_reminders r
     JOIN wp_kc_followups f ON r.followup_id = f.id
     WHERE ${scopeSql} AND r.id = ?`,
    ...args, reminderId,
  );
  if (!rows[0]) throw new KcError('Reminder not found', 404);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_reminders WHERE id = ?`, reminderId);
}

/**
 * Send followup reminders immediately.
 * Email reminders are delivered via sendEmail (dev-logs without RESEND_API_KEY, never throws).
 * sms/push reminders are not yet configured → 501.
 * If no email reminder rule exists, one immediate email is still sent (manual send).
 */
export async function sendReminderNow(followupId: number, kc: KcActor, scope: FollowupScope | null): Promise<{ sent: number; channelsSkipped: string[] }> {
  const { sql: scopeSql, args } = scopeClause(scope, 'f');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT f.*, pt.user_email AS patient_email, pt.display_name AS patient_name, c.name AS clinic_name
     FROM wp_kc_followups f
     LEFT JOIN wp_users pt ON f.patient_id = pt.ID
     LEFT JOIN wp_kc_clinics c ON f.clinic_id = c.id
     WHERE ${scopeSql} AND f.id = ?`,
    ...args, followupId,
  );
  const f = rows[0];
  if (!f) throw new KcError('Followup not found', 404);

  const reminders = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM wp_kc_followup_reminders WHERE followup_id = ?`, followupId,
  );

  // sms/push are not yet configured.
  const blocked = reminders.filter((r) => r.channel === 'sms' || r.channel === 'push');
  if (blocked.length > 0) {
    throw new KcError('SMS/push reminder delivery is not yet configured', 501);
  }

  const patientEmail = f.patient_email as string | null;
  if (!patientEmail) throw new KcError('Patient has no email address on file', 400);

  const clinicName = f.clinic_name ?? 'your clinic';
  const reason = f.reason ?? 'a follow-up';
  const subject = `Follow-up reminder from ${clinicName}`;
  const html = `<p>Hello ${f.patient_name ?? ''},</p>
<p>This is a reminder about your follow-up: ${reason}.</p>
<p>Suggested date: ${f.suggested_date_utc ?? ''}.</p>
<p>— ${clinicName}</p>`;
  const text = `Follow-up reminder: ${reason}. Suggested date: ${f.suggested_date_utc ?? ''}. — ${clinicName}`;

  const emailReminders = reminders.filter((r) => r.channel === 'email');
  const channelsSkipped: string[] = [];
  let sent = 0;

  if (emailReminders.length === 0) {
    // No email rule — send one immediate email anyway (manual send).
    const res = await sendEmail({ to: patientEmail, subject, html, text, template: 'followup_reminder' });
    if (res.ok) sent += 1;
  } else {
    for (const r of emailReminders) {
      const res = await sendEmail({ to: patientEmail, subject, html, text, template: 'followup_reminder' });
      if (res.ok) {
        sent += 1;
        await prisma.$executeRawUnsafe(
          `UPDATE wp_kc_followup_reminders SET processed_at = UTC_TIMESTAMP() WHERE id = ?`, Number(r.id),
        );
      }
    }
  }

  if (sent > 0) {
    await logActivity(followupId, kc.wpUserId, 'reminder_sent', null, null, `email x${sent}`);
  }
  return { sent, channelsSkipped };
}
