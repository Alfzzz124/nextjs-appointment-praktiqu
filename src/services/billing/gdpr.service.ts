import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';

export interface ConsentScope { userId?: bigint } // null = admin (all)
export function consentScopeFor(kc: KcActor): ConsentScope | null {
  if (kc.actor.role === 'CLIENT') return { userId: kc.wpUserId };
  return null; // SUPER_ADMIN / CLINIC_ADMIN see all
}

// ---- Consent versions ----
export async function listConsentVersions(p: { page: number; perPage: number | 'all'; consentType?: string; activeOnly?: boolean }) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (p.consentType) { where.push('consent_type = ?'); args.push(p.consentType); }
  if (p.activeOnly) { where.push('is_active = 1'); }
  const whereSql = where.join(' AND ');
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) n FROM wp_kc_gdpr_consent_versions WHERE ${whereSql}`, ...args);
  let limitSql = ''; const pa: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pa.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_gdpr_consent_versions WHERE ${whereSql} ORDER BY consent_type, version_number DESC${limitSql}`, ...args, ...pa);
  return { versions: rows.map((r) => ({ id: Number(r.id), consent_type: r.consent_type, version_number: Number(r.version_number), title: r.title, body_text: r.body_text, legal_basis: r.legal_basis, is_active: Number(r.is_active), created_at: r.created_at })), pagination: { page: p.page, perPage: p.perPage, total: Number(countRows[0]?.n ?? 0) } };
}
export async function getConsentVersion(id: number) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_gdpr_consent_versions WHERE id = ?`, id);
  if (!rows[0]) throw new KcError('Consent version not found', 404);
  const r = rows[0];
  return { id: Number(r.id), consent_type: r.consent_type, version_number: Number(r.version_number), title: r.title, body_text: r.body_text, legal_basis: r.legal_basis, is_active: Number(r.is_active), created_by: Number(r.created_by), created_at: r.created_at };
}
export async function createConsentVersion(input: { consentType: string; title: string; bodyText: string; legalBasis: string; versionNumber?: number }, kc: KcActor): Promise<{ id: number }> {
  // Auto-increment version_number per consent_type if not provided.
  let vnum = input.versionNumber;
  if (vnum === undefined) {
    const maxRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COALESCE(MAX(version_number),0) mx FROM wp_kc_gdpr_consent_versions WHERE consent_type = ?`, input.consentType);
    vnum = Number(maxRows[0]?.mx ?? 0) + 1;
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_gdpr_consent_versions (consent_type, version_number, title, body_text, legal_basis, is_active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NOW())`,
    input.consentType, vnum, input.title, input.bodyText, input.legalBasis, Number(kc.wpUserId));
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() id`);
  return { id: Number(idRow[0].id) };
}
export async function activateConsentVersion(id: number): Promise<void> {
  const v = await getConsentVersion(id);
  // Single active version per consent_type.
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_gdpr_consent_versions SET is_active = 0 WHERE consent_type = ?`, v.consent_type);
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_gdpr_consent_versions SET is_active = 1 WHERE id = ?`, id);
}

// ---- Consents ----
export async function listConsents(p: { page: number; perPage: number | 'all'; userId?: number; consentType?: string; status?: string }, scope: ConsentScope | null) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.userId !== undefined) { where.push('user_id = ?'); args.push(scope.userId); }
  if (p.userId !== undefined) { where.push('user_id = ?'); args.push(p.userId); }
  if (p.consentType) { where.push('consent_type = ?'); args.push(p.consentType); }
  if (p.status) { where.push('status = ?'); args.push(p.status); }
  const whereSql = where.join(' AND ');
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) n FROM wp_kc_gdpr_consents WHERE ${whereSql}`, ...args);
  let limitSql = ''; const pa: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pa.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_gdpr_consents WHERE ${whereSql} ORDER BY id DESC${limitSql}`, ...args, ...pa);
  return { consents: rows.map(mapConsent), pagination: { page: p.page, perPage: p.perPage, total: Number(countRows[0]?.n ?? 0) } };
}
function mapConsent(r: any) { return { id: Number(r.id), user_id: Number(r.user_id), consent_type: r.consent_type, consent_version_id: r.consent_version_id, status: r.status, granted_at: r.granted_at, withdrawn_at: r.withdrawn_at, method: r.method, created_at: r.created_at }; }
export async function getConsent(id: number, scope: ConsentScope | null) {
  const where = ['id = ?']; const args: unknown[] = [id];
  if (scope?.userId !== undefined) { where.push('user_id = ?'); args.push(scope.userId); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_gdpr_consents WHERE ${where.join(' AND ')}`, ...args);
  if (!rows[0]) throw new KcError('Consent not found', 404);
  return mapConsent(rows[0]);
}
export async function grantConsent(input: { userId?: number; consentType: string; consentVersionId: string; method?: string }, kc: KcActor, ip: string | null): Promise<{ id: number }> {
  const userId = kc.actor.role === 'CLIENT' ? Number(kc.wpUserId) : Number(input.userId ?? 0);
  if (!userId) throw new KcError('userId is required', 400);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_gdpr_consents (user_id, consent_type, consent_version_id, status, granted_at, ip_address, method, created_at)
     VALUES (?, ?, ?, 'granted', NOW(), ?, ?, NOW())`,
    userId, input.consentType, input.consentVersionId, ip ?? null, input.method ?? 'api');
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() id`);
  return { id: Number(idRow[0].id) };
}
export async function withdrawConsent(id: number, scope: ConsentScope | null): Promise<void> {
  await getConsent(id, scope); // scope + existence
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_gdpr_consents SET status = 'withdrawn', withdrawn_at = NOW() WHERE id = ?`, id);
}

// ---- Audit log (READ-ONLY — checksum chain, never written) ----
export async function listAuditLog(p: { page: number; perPage: number | 'all'; eventType?: string; subjectUserId?: number; action?: string; dateFrom?: string; dateTo?: string }) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (p.eventType) { where.push('event_type = ?'); args.push(p.eventType); }
  if (p.subjectUserId !== undefined) { where.push('subject_user_id = ?'); args.push(p.subjectUserId); }
  if (p.action) { where.push('action = ?'); args.push(p.action); }
  if (p.dateFrom) { where.push('created_at >= ?'); args.push(p.dateFrom + ' 00:00:00'); }
  if (p.dateTo) { where.push('created_at <= ?'); args.push(p.dateTo + ' 23:59:59'); }
  const whereSql = where.join(' AND ');
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) n FROM wp_kc_gdpr_audit_log WHERE ${whereSql}`, ...args);
  let limitSql = ''; const pa: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pa.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, event_type, actor_user_id, actor_role, subject_user_id, resource_type, resource_id, action, details, ip_address, created_at FROM wp_kc_gdpr_audit_log WHERE ${whereSql} ORDER BY id DESC${limitSql}`, ...args, ...pa);
  return { entries: rows.map((r) => ({ id: Number(r.id), event_type: r.event_type, actor_user_id: Number(r.actor_user_id), actor_role: r.actor_role, subject_user_id: r.subject_user_id != null ? Number(r.subject_user_id) : null, resource_type: r.resource_type, resource_id: r.resource_id != null ? Number(r.resource_id) : null, action: r.action, details: r.details, ip_address: r.ip_address, created_at: r.created_at })), pagination: { page: p.page, perPage: p.perPage, total: Number(countRows[0]?.n ?? 0) } };
}

// ---- Data export (synchronous bundle) ----
export async function exportSubjectData(subjectUserId: number) {
  const q = <T = any>(sql: string, ...a: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
  const profile = await q(`SELECT ID, user_login, display_name, user_email, user_registered FROM wp_users WHERE ID = ?`, subjectUserId);
  if (!profile[0]) throw new KcError('Subject user not found', 404);
  const meta = await q(`SELECT meta_key, meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key IN ('first_name','last_name','billing_phone')`, subjectUserId);
  const appointments = await q(`SELECT * FROM wp_kc_appointments WHERE patient_id = ?`, subjectUserId);
  const encounters = await q(`SELECT * FROM wp_kc_patient_encounters WHERE patient_id = ?`, subjectUserId);
  const prescriptions = await q(`SELECT * FROM wp_kc_prescription WHERE patient_id = ?`, subjectUserId);
  const medicalHistory = await q(`SELECT * FROM wp_kc_medical_history WHERE patient_id = ?`, subjectUserId);
  // Bills have no patient_id → via the subject's encounters/appointments.
  const bills = await q(
    `SELECT b.* FROM wp_kc_bills b
     WHERE b.encounter_id IN (SELECT id FROM wp_kc_patient_encounters WHERE patient_id = ?)
        OR b.appointment_id IN (SELECT id FROM wp_kc_appointments WHERE patient_id = ?)`,
    subjectUserId, subjectUserId);
  const norm = (rows: any[]) => JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  return {
    subject: { id: Number(profile[0].ID), user_login: profile[0].user_login, display_name: profile[0].display_name, email: profile[0].user_email, registered: profile[0].user_registered, meta: Object.fromEntries(meta.map((m: any) => [m.meta_key, m.meta_value])) },
    appointments: norm(appointments), encounters: norm(encounters), prescriptions: norm(prescriptions),
    medicalHistory: norm(medicalHistory), bills: norm(bills),
    exportedAt: new Date().toISOString(),
  };
}

// ---- Soft-flag delete (reversible; SUPER_ADMIN only — gated at route) ----
export async function softDeleteSubject(subjectUserId: number, kc: KcActor): Promise<{ subjectUserId: number; status: string; erasedAt: string }> {
  const exists = await prisma.$queryRawUnsafe<any[]>(`SELECT ID FROM wp_users WHERE ID = ?`, subjectUserId);
  if (!exists[0]) throw new KcError('Subject user not found', 404);
  const erasedAt = new Date().toISOString();
  // Reversible soft-flag: usermeta markers + deactivate login. NO rows deleted, audit-log NOT written (checksum chain).
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DELETE FROM wp_usermeta WHERE user_id = ? AND meta_key IN ('kivicare_gdpr_erased_at','kivicare_gdpr_erased_by')`, subjectUserId),
    prisma.$executeRawUnsafe(`INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'kivicare_gdpr_erased_at', ?), (?, 'kivicare_gdpr_erased_by', ?)`, subjectUserId, erasedAt, subjectUserId, String(Number(kc.wpUserId))),
    prisma.$executeRawUnsafe(`UPDATE wp_users SET user_status = 1 WHERE ID = ?`, subjectUserId),
  ]);
  return { subjectUserId, status: 'flagged', erasedAt };
}
