import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { prepareUnlinkBatch, unlinkReport } from '@/repositories/wp/encounter-documents.repo';
import type { KcActor } from '@/services/billing/kc-actor';
import type { MedReportScope } from '@/services/billing/med-report-scope';

export interface MedReportListParams { page: number; perPage: number | 'all'; patientId?: number; search?: string; excludeIds?: number[]; }

function mapRow(r: any) {
  return {
    id: Number(r.id),
    name: r.name ?? null,
    patient_id: Number(r.patient_id),
    upload_report: r.upload_report ?? null,
    date: r.date,
    patient_name: r.patient_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_patient_medical_report mr
   LEFT JOIN wp_users pt ON mr.patient_id = pt.ID`;

function buildWhere(scope: MedReportScope | null, p: Partial<MedReportListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('mr.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.clinicId !== undefined) {
    where.push('EXISTS (SELECT 1 FROM wp_kc_patient_clinic_mappings pcm WHERE pcm.patient_id = mr.patient_id AND pcm.clinic_id = ?)');
    args.push(scope.clinicId);
  }
  if (p.patientId !== undefined) { where.push('mr.patient_id = ?'); args.push(p.patientId); }
  if (p.search) { where.push('mr.name LIKE ?'); args.push(`%${p.search}%`); }
  if (p.excludeIds && p.excludeIds.length > 0) {
    where.push(`mr.id NOT IN (${p.excludeIds.map(() => '?').join(',')})`);
    args.push(...p.excludeIds);
  }
  return { whereSql: where.join(' AND '), args };
}

export async function listMedReports(p: MedReportListParams, scope: MedReportScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.*, pt.display_name AS patient_name ${BASE_JOIN} WHERE ${whereSql} ORDER BY mr.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { reports: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

/**
 * Fetch specific reports by id, scoped the same way `listMedReports` is — a caller
 * cannot read another clinic's (or patient's) rows just by naming their ids. One
 * query via `IN (...)`. An empty `ids` returns `[]` without touching the database
 * (an empty `IN ()` is invalid SQL).
 */
export async function listMedReportsByIds(ids: number[], scope: MedReportScope | null) {
  if (ids.length === 0) return [];
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.*, pt.display_name AS patient_name ${BASE_JOIN} WHERE ${whereSql} AND mr.id IN (${placeholders}) ORDER BY mr.id DESC`,
    ...args, ...ids,
  );
  return rows.map(mapRow);
}

export async function getMedReport(id: number, scope: MedReportScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.*, pt.display_name AS patient_name ${BASE_JOIN} WHERE ${whereSql} AND mr.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Medical report not found', 404);
  return mapRow(rows[0]);
}

/** Throw 404 unless the patient is visible under the actor's scope (own patient / clinic membership). */
export async function assertPatientInScope(patientId: number, kc: KcActor): Promise<void> {
  if (kc.actor.role === 'SUPER_ADMIN') return;
  if (kc.actor.role === 'CLIENT') {
    if (BigInt(patientId) !== kc.wpUserId) throw new KcError('Patient not found', 404);
    return;
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM wp_kc_patient_clinic_mappings WHERE patient_id = ? AND clinic_id = ? LIMIT 1`,
    patientId, kc.clinicId ?? -1n,
  );
  if (!rows[0]) throw new KcError('Patient not found', 404);
}

export interface MedReportCreateInput {
  patientId: number;
  name: string;
  /**
   * A WordPress media id the *caller* has already established belongs to
   * `patientId` — in practice, one it just created in this same request via
   * `uploadMedia` (see `uploadEncounterDocument`). This is a trust boundary,
   * not a formality: nothing in the WP media library ties a media id to a
   * patient, so there is no way for this function to verify the claim itself.
   * A media id read out of an untrusted request body carries no such
   * relationship — a caller could name any other clinic's attachment and this
   * would happily file it under their own patient, after which
   * `GET /patient-medical-reports/{id}/content` hands back those bytes (the
   * C1 finding this field name exists to prevent a repeat of). That is why
   * the public create schema (`medReportCreateSchema`) has no media-id field
   * at all: there is no way to reach this parameter from a request body.
   */
  verifiedMediaId: string;
  date?: string;
}
export async function createMedReport(input: MedReportCreateInput, kc: KcActor): Promise<{ id: number }> {
  await assertPatientInScope(input.patientId, kc);
  const created = await prisma.kcPatientMedicalReport.create({
    data: {
      patientId: BigInt(input.patientId),
      name: input.name,
      uploadReport: input.verifiedMediaId,
      date: input.date ? new Date(input.date) : new Date(),
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

/**
 * Rename a document. Only `name` changes — the media id, the file and any encounter
 * link stay exactly as they are.
 */
export async function renameMedReport(
  id: number,
  name: string,
  scope: MedReportScope | null,
): Promise<{ id: number; name: string }> {
  const trimmed = name.trim();
  if (trimmed === '') throw new KcError('Name is required', 400);

  await getMedReport(id, scope); // scope + existence (404)

  await prisma.kcPatientMedicalReport.update({
    where: { id: BigInt(id) },
    data: { name: trimmed },
  });

  return { id, name: trimmed };
}

export async function deleteMedReport(id: number, scope: MedReportScope | null): Promise<void> {
  await getMedReport(id, scope); // scope + existence (404)
  // Link first: a link pointing at a deleted document would have to be worked
  // around by every encounter listing from here on.
  await unlinkReport(id);
  await prisma.kcPatientMedicalReport.delete({ where: { id: BigInt(id) } });
}

/**
 * Delete several documents, each as its own unlink-then-delete unit.
 *
 * Processing stops at the first failure rather than best-effort-continuing
 * through the rest: a document is only ever deleted once its own link is
 * gone, so whatever has completed so far is fully coherent — earlier ids are
 * unlinked and deleted, the one that failed and everything after it are
 * completely untouched. That is a state the caller can reason about (and
 * simply retry the same ids again, since unlinking and deleting are both
 * idempotent) instead of a 500 that leaves them guessing which of the batch
 * actually went through. The count returned is exactly how many were
 * removed, whether or not that matches how many were requested.
 *
 * The per-document loop still calls the unlink step once per id — that is
 * what makes a mid-batch failure attributable to one specific document
 * instead of the whole batch. What is no longer paid once per id is the
 * expensive part: `prepareUnlinkBatch` reads the link table exactly once for
 * the whole batch up front, so this costs one table scan, not N.
 */
export async function bulkDeleteMedReports(ids: number[], scope: MedReportScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.id ${BASE_JOIN} WHERE ${whereSql} AND mr.id IN (${placeholders})`, ...args, ...ids,
  );
  const okIds = inScope.map((r) => BigInt(r.id));
  if (okIds.length === 0) return 0;

  const unlinkOne = await prepareUnlinkBatch(okIds.map(Number));
  let deleted = 0;
  try {
    for (const okId of okIds) {
      // Link first: see deleteMedReport — a link pointing at a deleted
      // document would have to be worked around by every encounter listing.
      await unlinkOne(Number(okId));
      await prisma.kcPatientMedicalReport.delete({ where: { id: okId } });
      deleted++;
    }
  } catch (err) {
    console.error(
      `[bulkDeleteMedReports] stopped after ${deleted}/${okIds.length}:`, err,
    );
  }
  return deleted;
}

export async function exportMedReports(p: MedReportListParams, scope: MedReportScope | null) {
  const list = await listMedReports({ ...p, perPage: 'all', page: 1 }, scope);
  return { reports: list.reports.map((x) => ({ id: x.id, name: x.name, patient_name: x.patient_name, upload_report: x.upload_report, date: x.date })) };
}

/**
 * Where to fetch this document's bytes.
 *
 * This used to return the WordPress `guid`. That URL can never be opened: the
 * `uploads/kivicare-reports` directory carries an `.htaccess` of `Deny from all`,
 * written by KiviCare's own media migration. Handing the front-end a link that is
 * guaranteed to 403 is worse than returning no link at all, so this now points at
 * the authenticated streaming route.
 */
export async function resolveReportFile(id: number, scope: MedReportScope | null) {
  const report = await getMedReport(id, scope);
  return {
    reportId: report.id,
    name: report.name,
    mediaId: report.upload_report,
    contentPath: `/api/v1/patient-medical-reports/${report.id}/content`,
  };
}
