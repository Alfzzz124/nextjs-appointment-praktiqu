import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';

export interface RatingScope { patientId?: bigint; doctorId?: bigint; clinicId?: bigint }
export function ratingScopeFor(kc: KcActor): RatingScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLIENT': return { patientId: kc.wpUserId };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    default: return { clinicId: -1n };
  }
}

export interface RatingListParams { page: number; perPage: number | 'all'; doctorId?: number; patientId?: number; }

function mapRow(r: any) {
  return {
    id: Number(r.id), review: Number(r.review), review_description: r.review_description ?? null,
    patient_id: Number(r.patient_id), doctor_id: Number(r.doctor_id),
    patient_name: r.patient_name ?? null, doctor_name: r.doctor_name ?? null,
    created_at: r.created_at,
  };
}
const BASE_JOIN =
  `FROM wp_kc_patient_review r
   LEFT JOIN wp_users pt ON r.patient_id = pt.ID
   LEFT JOIN wp_users d ON r.doctor_id = d.ID`;

function buildWhere(scope: RatingScope | null, p: Partial<RatingListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('r.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.doctorId !== undefined) { where.push('r.doctor_id = ?'); args.push(scope.doctorId); }
  if (scope?.clinicId !== undefined) {
    where.push('EXISTS (SELECT 1 FROM wp_kc_doctor_clinic_mappings dcm WHERE dcm.doctor_id = r.doctor_id AND dcm.clinic_id = ?)');
    args.push(scope.clinicId);
  }
  if (p.doctorId !== undefined) { where.push('r.doctor_id = ?'); args.push(p.doctorId); }
  if (p.patientId !== undefined) { where.push('r.patient_id = ?'); args.push(p.patientId); }
  return { whereSql: where.join(' AND '), args };
}

export async function listRatings(p: RatingListParams, scope: RatingScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT r.*, pt.display_name AS patient_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} ORDER BY r.id DESC${limitSql}`,
    ...args, ...pageArgs);
  return { ratings: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getRating(id: number, scope: RatingScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT r.*, pt.display_name AS patient_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} AND r.id = ?`, ...args, id);
  if (!rows[0]) throw new KcError('Rating not found', 404);
  return mapRow(rows[0]);
}

export interface RatingCreateInput { doctorId: number; patientId?: number; review: number; reviewDescription?: string; }
export async function createRating(input: RatingCreateInput, kc: KcActor): Promise<{ id: number }> {
  const patientId = kc.actor.role === 'CLIENT' ? Number(kc.wpUserId) : Number(input.patientId ?? 0);
  if (!patientId) throw new KcError('patientId is required', 400);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_review (review, review_description, patient_id, doctor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    input.review, input.reviewDescription ?? null, patientId, input.doctorId);
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export async function deleteRating(id: number, scope: RatingScope | null): Promise<void> {
  await getRating(id, scope); // scope + existence (404)
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_review WHERE id = ?`, id);
}

export async function ratingStats(scope: RatingScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT r.doctor_id, d.display_name AS doctor_name, COUNT(*) AS count, AVG(r.review) AS avg_review
     ${BASE_JOIN} WHERE ${whereSql} GROUP BY r.doctor_id, d.display_name ORDER BY count DESC`, ...args);
  return { stats: rows.map((x) => ({ doctor_id: Number(x.doctor_id), doctor_name: x.doctor_name, count: Number(x.count), avg_review: x.avg_review != null ? Number(x.avg_review) : 0 })) };
}
