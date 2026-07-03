// src/services/billing/medical-history.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { KcLeafScope } from '@/services/billing/kc-leaf-scope';
import { assertEncounterInScope } from '@/services/billing/prescription.service';

export interface MedicalHistoryListParams {
  page: number; perPage: number | 'all';
  patientId?: number; encounterId?: number; type?: string; search?: string;
}

function mapRow(r: any) {
  return {
    id: Number(r.id), encounter_id: Number(r.encounter_id), patient_id: Number(r.patient_id),
    type: r.type ?? null, title: r.title ?? null, created_at: r.created_at,
    patient_name: r.patient_name ?? null, doctor_name: r.doctor_name ?? null, clinic_name: r.clinic_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_medical_history mh
   LEFT JOIN wp_kc_patient_encounters enc ON mh.encounter_id = enc.id
   LEFT JOIN wp_kc_clinics c ON enc.clinic_id = c.id
   LEFT JOIN wp_users d ON enc.doctor_id = d.ID
   LEFT JOIN wp_users pt ON mh.patient_id = pt.ID`;

function buildWhere(scope: KcLeafScope | null, p: Partial<MedicalHistoryListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('mh.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.encDoctorId !== undefined) { where.push('enc.doctor_id = ?'); args.push(scope.encDoctorId); }
  if (scope?.encClinicId !== undefined) { where.push('enc.clinic_id = ?'); args.push(scope.encClinicId); }
  if (p.patientId !== undefined) { where.push('mh.patient_id = ?'); args.push(p.patientId); }
  if (p.encounterId !== undefined) { where.push('mh.encounter_id = ?'); args.push(p.encounterId); }
  if (p.type) { where.push('mh.type = ?'); args.push(p.type); }
  if (p.search) { where.push('mh.title LIKE ?'); args.push(`%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

export async function listMedicalHistory(p: MedicalHistoryListParams, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mh.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} ORDER BY mh.id DESC${limitSql}`, ...args, ...pageArgs,
  );
  return { medicalHistory: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getMedicalHistory(id: number, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT mh.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} AND mh.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Medical history record not found', 404);
  return mapRow(rows[0]);
}

export interface MedicalHistoryCreateInput { encounterId: number; patientId: number; type: string; title: string; }
export async function createMedicalHistory(input: MedicalHistoryCreateInput, kc: KcActor): Promise<{ id: number }> {
  const enc = await assertEncounterInScope(input.encounterId, kc);
  const created = await prisma.kcMedicalHistory.create({
    data: {
      encounterId: BigInt(input.encounterId), patientId: BigInt(enc.patient_id), // derived from encounter, not input
      type: input.type, title: input.title, addedBy: kc.wpUserId, createdAt: new Date(), isFromTemplate: 0,
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export interface MedicalHistoryUpdateInput { type?: string; title?: string; }
export async function updateMedicalHistory(id: number, input: MedicalHistoryUpdateInput, scope: KcLeafScope | null): Promise<void> {
  await getMedicalHistory(id, scope);
  await prisma.kcMedicalHistory.update({
    where: { id: BigInt(id) },
    data: { type: input.type ?? undefined, title: input.title ?? undefined },
  });
}

export async function deleteMedicalHistory(id: number, scope: KcLeafScope | null): Promise<void> {
  await getMedicalHistory(id, scope);
  await prisma.kcMedicalHistory.delete({ where: { id: BigInt(id) } });
}

export async function exportMedicalHistory(p: MedicalHistoryListParams, scope: KcLeafScope | null) {
  const list = await listMedicalHistory({ ...p, perPage: 'all', page: 1 }, scope);
  return {
    medicalHistory: list.medicalHistory.map((x) => ({
      id: x.id, type: x.type, title: x.title, patient_name: x.patient_name,
      doctor_name: x.doctor_name, clinic_name: x.clinic_name, created_at: x.created_at,
    })),
  };
}
