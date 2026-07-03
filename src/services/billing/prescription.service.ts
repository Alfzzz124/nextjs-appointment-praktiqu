// src/services/billing/prescription.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { KcLeafScope } from '@/services/billing/kc-leaf-scope';

export interface PrescriptionListParams {
  page: number;
  perPage: number | 'all';
  patientId?: number;
  encounterId?: number;
  search?: string;
}

function mapRow(r: any) {
  return {
    id: Number(r.id),
    encounter_id: Number(r.encounter_id),
    patient_id: Number(r.patient_id),
    name: r.name ?? null,
    frequency: r.frequency ?? null,
    duration: r.duration ?? null,
    instruction: r.instruction ?? null,
    created_at: r.created_at,
    patient_name: r.patient_name ?? null,
    doctor_name: r.doctor_name ?? null,
    clinic_name: r.clinic_name ?? null,
  };
}

/** Build the shared WHERE fragments + args for scope + filters. Always joined to encounters `enc`. */
function buildWhere(scope: KcLeafScope | null, p: Partial<PrescriptionListParams>) {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (scope?.patientId !== undefined) { where.push('rx.patient_id = ?'); args.push(scope.patientId); }
  if (scope?.encDoctorId !== undefined) { where.push('enc.doctor_id = ?'); args.push(scope.encDoctorId); }
  if (scope?.encClinicId !== undefined) { where.push('enc.clinic_id = ?'); args.push(scope.encClinicId); }
  if (p.patientId !== undefined) { where.push('rx.patient_id = ?'); args.push(p.patientId); }
  if (p.encounterId !== undefined) { where.push('rx.encounter_id = ?'); args.push(p.encounterId); }
  if (p.search) { where.push('rx.name LIKE ?'); args.push(`%${p.search}%`); }
  return { whereSql: where.join(' AND '), args };
}

const BASE_JOIN =
  `FROM wp_kc_prescription rx
   LEFT JOIN wp_kc_patient_encounters enc ON rx.encounter_id = enc.id
   LEFT JOIN wp_kc_clinics c ON enc.clinic_id = c.id
   LEFT JOIN wp_users d ON enc.doctor_id = d.ID
   LEFT JOIN wp_users pt ON rx.patient_id = pt.ID`;

export async function listPrescriptions(p: PrescriptionListParams, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} ORDER BY rx.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { prescriptions: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getPrescription(id: number, scope: KcLeafScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${BASE_JOIN} WHERE ${whereSql} AND rx.id = ?`,
    ...args, id,
  );
  if (!rows[0]) throw new KcError('Prescription not found', 404);
  return mapRow(rows[0]);
}

export interface PrescriptionCreateInput {
  encounterId: number; patientId: number;
  name: string; frequency?: string; duration?: string; instruction?: string;
}

export async function createPrescription(input: PrescriptionCreateInput, kc: KcActor): Promise<{ id: number }> {
  // Scope guard: verify the target encounter is within the actor's scope before attaching.
  const enc = await assertEncounterInScope(input.encounterId, kc);
  const created = await prisma.kcPrescription.create({
    data: {
      encounterId: BigInt(input.encounterId),
      patientId: BigInt(enc.patient_id), // derived from encounter, not input

      name: input.name,
      frequency: input.frequency ?? null,
      duration: input.duration ?? null,
      instruction: input.instruction ?? null,
      addedBy: kc.wpUserId,
      createdAt: new Date(),
      isFromTemplate: 0,
    },
    select: { id: true },
  });
  return { id: Number(created.id) };
}

export interface PrescriptionUpdateInput { name?: string; frequency?: string; duration?: string; instruction?: string; }

export async function updatePrescription(id: number, input: PrescriptionUpdateInput, scope: KcLeafScope | null): Promise<void> {
  await getPrescription(id, scope); // scope + existence (404)
  await prisma.kcPrescription.update({
    where: { id: BigInt(id) },
    data: {
      name: input.name ?? undefined,
      frequency: input.frequency ?? undefined,
      duration: input.duration ?? undefined,
      instruction: input.instruction ?? undefined,
    },
  });
}

export async function deletePrescription(id: number, scope: KcLeafScope | null): Promise<void> {
  await getPrescription(id, scope);
  await prisma.kcPrescription.delete({ where: { id: BigInt(id) } });
}

export async function bulkDeletePrescriptions(ids: number[], scope: KcLeafScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  // Resolve which of the requested ids are in-scope (via join), then delete only those.
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(
    `SELECT rx.id ${BASE_JOIN} WHERE ${whereSql} AND rx.id IN (${placeholders})`,
    ...args, ...ids,
  );
  const okIds = inScope.map((r) => BigInt(r.id));
  if (okIds.length === 0) return 0;
  const r = await prisma.kcPrescription.deleteMany({ where: { id: { in: okIds } } });
  return r.count;
}

export async function exportPrescriptions(p: PrescriptionListParams, scope: KcLeafScope | null) {
  const list = await listPrescriptions({ ...p, perPage: 'all', page: 1 }, scope);
  return {
    prescriptions: list.prescriptions.map((x) => ({
      id: x.id, name: x.name, frequency: x.frequency, duration: x.duration,
      instruction: x.instruction, patient_name: x.patient_name, doctor_name: x.doctor_name,
      clinic_name: x.clinic_name, created_at: x.created_at,
    })),
  };
}

/** Shared: throw 404 unless the encounter is visible under the actor's scope. Returns the encounter row so callers can derive server-trusted fields (e.g. patient_id). */
export async function assertEncounterInScope(
  encounterId: number,
  kc: KcActor,
): Promise<{ id: number; patient_id: number; doctor_id: number; clinic_id: number }> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, doctor_id, clinic_id, patient_id FROM wp_kc_patient_encounters WHERE id = ?`, encounterId,
  );
  const enc = rows[0];
  if (!enc) throw new KcError('Encounter not found', 404);
  const row = {
    id: Number(enc.id),
    patient_id: Number(enc.patient_id),
    doctor_id: Number(enc.doctor_id),
    clinic_id: Number(enc.clinic_id),
  };
  if (kc.actor.role === 'SUPER_ADMIN') return row;
  const role = kc.actor.role;
  if ((role === 'CLINIC_ADMIN' || role === 'RECEPTIONIST') && BigInt(enc.clinic_id) !== (kc.clinicId ?? -1n)) throw new KcError('Encounter not found', 404);
  if (role === 'PROFESSIONAL' && BigInt(enc.doctor_id) !== kc.wpUserId) throw new KcError('Encounter not found', 404);
  if (role === 'CLIENT' && BigInt(enc.patient_id) !== kc.wpUserId) throw new KcError('Encounter not found', 404);
  return row;
}
