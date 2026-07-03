import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { MedReportScope } from '@/services/billing/med-report-scope';

export interface MedReportListParams { page: number; perPage: number | 'all'; patientId?: number; search?: string; }

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

export interface MedReportCreateInput { patientId: number; name: string; uploadReport: string; date?: string; }
export async function createMedReport(input: MedReportCreateInput, kc: KcActor): Promise<{ id: number }> {
  await assertPatientInScope(input.patientId, kc);
  const created = await prisma.kcPatientMedicalReport.create({
    data: {
      patientId: BigInt(input.patientId),
      name: input.name,
      uploadReport: input.uploadReport,
      date: input.date ? new Date(input.date) : new Date(),
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export async function deleteMedReport(id: number, scope: MedReportScope | null): Promise<void> {
  await getMedReport(id, scope); // scope + existence (404)
  await prisma.kcPatientMedicalReport.delete({ where: { id: BigInt(id) } });
}

export async function bulkDeleteMedReports(ids: number[], scope: MedReportScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mr.id ${BASE_JOIN} WHERE ${whereSql} AND mr.id IN (${placeholders})`, ...args, ...ids,
  );
  const okIds = inScope.map((r) => BigInt(r.id));
  if (okIds.length === 0) return 0;
  const r = await prisma.kcPatientMedicalReport.deleteMany({ where: { id: { in: okIds } } });
  return r.count;
}

export async function exportMedReports(p: MedReportListParams, scope: MedReportScope | null) {
  const list = await listMedReports({ ...p, perPage: 'all', page: 1 }, scope);
  return { reports: list.reports.map((x) => ({ id: x.id, name: x.name, patient_name: x.patient_name, upload_report: x.upload_report, date: x.date })) };
}

/** Best-effort WP media resolution. Returns the stored media id and a URL if the attachment exists (else null). */
export async function resolveReportFile(id: number, scope: MedReportScope | null) {
  const report = await getMedReport(id, scope);
  const mediaId = report.upload_report;
  let fileUrl: string | null = null;
  const asInt = Number.parseInt(String(mediaId), 10);
  if (Number.isFinite(asInt)) {
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT guid FROM wp_posts WHERE ID = ? AND post_type = 'attachment' LIMIT 1`, asInt);
    fileUrl = rows[0]?.guid ?? null;
    if (!fileUrl) {
      const meta = await prisma.$queryRawUnsafe<any[]>(`SELECT meta_value FROM wp_postmeta WHERE post_id = ? AND meta_key = '_wp_attached_file' LIMIT 1`, asInt);
      fileUrl = meta[0]?.meta_value ? String(meta[0].meta_value) : null;
    }
  }
  return { reportId: report.id, name: report.name, mediaId, fileUrl };
}
