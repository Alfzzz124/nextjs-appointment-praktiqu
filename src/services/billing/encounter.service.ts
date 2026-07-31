import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import {
  ENCOUNTER_STATUS,
  createEncounter as wpCreateEncounter,
  setEncounterStatus,
  updateEncounter as wpUpdateEncounter,
} from '@/repositories/wp/encounters.write';

export interface EncounterScope {
  clinicId?: bigint;
  doctorId?: bigint;
  patientId?: bigint;
}

/** Role-based row scope, mirroring billScopeFor. */
export function encounterScopeFor(kc: KcActor): EncounterScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null; // unrestricted
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}

export interface EncounterListParams {
  page: number;
  perPage: number | 'all';
  patientId?: number;
  doctorId?: number;
  clinicId?: number;
  status?: number;
  dateFrom?: string;
  dateTo?: string;
}

function mapEncounterRow(r: any) {
  return {
    id: Number(r.id),
    encounter_date: r.encounter_date,
    clinic_id: Number(r.clinic_id),
    doctor_id: Number(r.doctor_id),
    patient_id: Number(r.patient_id),
    appointment_id: r.appointment_id != null ? Number(r.appointment_id) : null,
    description: r.description ?? null,
    status: Number(r.status),
    clinic_name: r.clinic_name ?? null,
    doctor_name: r.doctor_name ?? null,
    patient_name: r.patient_name ?? null,
  };
}

export async function listEncounters(p: EncounterListParams, scope: EncounterScope | null) {
  const where: string[] = ['1=1'];
  const args: unknown[] = [];

  if (scope?.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(scope.clinicId); }
  if (scope?.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(scope.doctorId); }
  if (scope?.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(scope.patientId); }

  if (p.patientId !== undefined) { where.push('pe.patient_id = ?'); args.push(p.patientId); }
  if (p.doctorId !== undefined) { where.push('pe.doctor_id = ?'); args.push(p.doctorId); }
  if (p.clinicId !== undefined) { where.push('pe.clinic_id = ?'); args.push(p.clinicId); }
  if (p.status !== undefined) { where.push('pe.status = ?'); args.push(p.status); }
  if (p.dateFrom) { where.push('pe.encounter_date >= ?'); args.push(p.dateFrom); }
  if (p.dateTo) { where.push('pe.encounter_date <= ?'); args.push(p.dateTo); }

  const whereSql = where.join(' AND ');
  const baseSql =
    `FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE ${whereSql}`;

  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${baseSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);

  let limitSql = '';
  const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') {
    const perPage = p.perPage as number;
    limitSql = ' LIMIT ? OFFSET ?';
    pageArgs.push(perPage, (p.page - 1) * perPage);
  }

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     ${baseSql} ORDER BY pe.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );

  return {
    encounters: rows.map(mapEncounterRow),
    pagination: { page: p.page, perPage: p.perPage, total },
  };
}

export async function getEncounter(id: number, scope: EncounterScope | null) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pe.*, c.name AS clinic_name, d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_patient_encounters pe
     LEFT JOIN wp_kc_clinics c ON pe.clinic_id = c.id
     LEFT JOIN wp_users d ON pe.doctor_id = d.ID
     LEFT JOIN wp_users pt ON pe.patient_id = pt.ID
     WHERE pe.id = ?`,
    id,
  );
  const row = rows[0];
  if (!row) throw new KcError('Encounter not found', 404);
  assertInScope(row, scope);
  return mapEncounterRow(row);
}

function assertInScope(row: any, scope: EncounterScope | null) {
  if (!scope) return;
  if (scope.clinicId !== undefined && BigInt(row.clinic_id) !== scope.clinicId) throw new KcError('Encounter not found', 404);
  if (scope.doctorId !== undefined && BigInt(row.doctor_id) !== scope.doctorId) throw new KcError('Encounter not found', 404);
  if (scope.patientId !== undefined && BigInt(row.patient_id) !== scope.patientId) throw new KcError('Encounter not found', 404);
}

export interface EncounterCreateInput {
  patientId: number;
  appointmentId?: number;
  clinicId?: number;
  doctorId?: number;
  encounterDate?: string;
  description?: string;
  templateId?: number;
}

export async function createEncounter(input: EncounterCreateInput, kc: KcActor): Promise<{ id: number }> {
  // Derive clinic/doctor from actor when not explicitly provided (non-super-admin cannot forge).
  const clinicId = kc.actor.role === 'SUPER_ADMIN'
    ? BigInt(input.clinicId ?? 0)
    : (kc.clinicId ?? BigInt(input.clinicId ?? 0));
  const doctorId = kc.actor.role === 'PROFESSIONAL'
    ? kc.wpUserId
    : BigInt(input.doctorId ?? Number(kc.wpUserId));

  if (!clinicId || clinicId <= 0n) throw new KcError('clinicId is required', 400);

  // Through the plugin, not Prisma: `kc_encounter_save` carries KiviCare's own
  // bookkeeping, and a direct INSERT fires none of it.
  const created = await wpCreateEncounter({
    clinicId: Number(clinicId),
    doctorId: Number(doctorId),
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    encounterDate: input.encounterDate,
    description: input.description,
    templateId: input.templateId,
    // The service token has no logged-in user on the WordPress side, so the author
    // has to be stated explicitly or the row records 0.
    addedBy: Number(kc.wpUserId),
  });
  return { id: created.id };
}

export interface EncounterUpdateInput {
  description?: string;
  encounterDate?: string;
  status?: number;
}

export async function updateEncounter(id: number, input: EncounterUpdateInput, scope: EncounterScope | null): Promise<void> {
  await getEncounter(id, scope); // scope + existence check (throws 404)

  if (input.description !== undefined || input.encounterDate !== undefined) {
    await wpUpdateEncounter(id, {
      description: input.description,
      encounterDate: input.encounterDate,
    });
  }

  // Status moves separately: closing an encounter is what mails the patient their
  // notes and prescription, so it cannot ride along in a column update.
  if (input.status !== undefined) {
    await setEncounterStatus(id, input.status === 0 ? ENCOUNTER_STATUS.CLOSED : ENCOUNTER_STATUS.OPEN);
  }
}

export async function deleteEncounter(id: number, scope: EncounterScope | null): Promise<void> {
  await getEncounter(id, scope); // scope + existence check
  await prisma.kcPatientEncounter.delete({ where: { id: BigInt(id) } });
}

/** Scoped bulk delete: only rows within the actor's scope are removed. */
export async function bulkDeleteEncounters(ids: number[], scope: EncounterScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const where: any = { id: { in: ids.map((n) => BigInt(n)) } };
  if (scope?.clinicId !== undefined) where.clinicId = scope.clinicId;
  if (scope?.doctorId !== undefined) where.doctorId = scope.doctorId;
  if (scope?.patientId !== undefined) where.patientId = scope.patientId;
  const r = await prisma.kcPatientEncounter.deleteMany({ where });
  return r.count;
}

/**
 * Bulk open/close, scoped to what the actor may touch.
 *
 * The scope is resolved with one query, but the status changes go through the plugin
 * one at a time: closing is what mails the patient their notes, and an `updateMany`
 * would silently skip every one of those notifications.
 */
export async function bulkSetEncounterStatus(ids: number[], status: number, scope: EncounterScope | null): Promise<number> {
  if (status !== 0 && status !== 1) throw new KcError('Invalid status', 400);
  if (ids.length === 0) return 0;

  const where: any = { id: { in: ids.map((n) => BigInt(n)) } };
  if (scope?.clinicId !== undefined) where.clinicId = scope.clinicId;
  if (scope?.doctorId !== undefined) where.doctorId = scope.doctorId;
  if (scope?.patientId !== undefined) where.patientId = scope.patientId;

  // Ids the actor is actually allowed to change. Out-of-scope ids are dropped here
  // rather than sent to the plugin, which has no view of our scoping rules.
  const allowed = await prisma.kcPatientEncounter.findMany({ where, select: { id: true } });

  const target = status === 0 ? ENCOUNTER_STATUS.CLOSED : ENCOUNTER_STATUS.OPEN;
  let changed = 0;
  for (const row of allowed) {
    await setEncounterStatus(Number(row.id), target);
    changed++;
  }
  return changed;
}

export async function exportEncounters(p: EncounterListParams, scope: EncounterScope | null) {
  const list = await listEncounters({ ...p, perPage: 'all', page: 1 }, scope);
  const encounters = list.encounters.map((e) => ({
    id: e.id,
    encounter_date: e.encounter_date,
    patient_name: e.patient_name,
    doctor_name: e.doctor_name,
    clinic_name: e.clinic_name,
    status: e.status,
    description: e.description,
  }));
  return { encounters };
}
