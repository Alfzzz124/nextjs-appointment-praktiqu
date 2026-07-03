// src/services/billing/doctor-session.service.ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import type { DoctorSessionScope } from '@/services/billing/staff-scope';

export interface DoctorSessionListParams { page: number; perPage: number | 'all'; clinicId?: number; doctorId?: number; day?: string; }

function mapRow(r: any) {
  const t = (v: any) => (v == null ? null : String(v).slice(11, 19) || String(v)); // TIME may come back as 'HH:mm:ss' or Date
  return {
    id: Number(r.id),
    clinic_id: Number(r.clinic_id),
    doctor_id: r.doctor_id != null ? Number(r.doctor_id) : null,
    day: r.day ?? null,
    start_time: typeof r.start_time === 'string' ? r.start_time : t(r.start_time),
    end_time: typeof r.end_time === 'string' ? r.end_time : t(r.end_time),
    time_slot: r.time_slot != null ? Number(r.time_slot) : null,
    clinic_name: r.clinic_name ?? null,
    doctor_name: r.doctor_name ?? null,
  };
}

const BASE_JOIN =
  `FROM wp_kc_clinic_sessions cs
   LEFT JOIN wp_kc_clinics c ON cs.clinic_id = c.id
   LEFT JOIN wp_users d ON cs.doctor_id = d.ID`;

function buildWhere(scope: DoctorSessionScope | null, p: Partial<DoctorSessionListParams>) {
  const where: string[] = ['1=1']; const args: unknown[] = [];
  if (scope?.clinicId !== undefined) { where.push('cs.clinic_id = ?'); args.push(scope.clinicId); }
  if (scope?.doctorId !== undefined) { where.push('cs.doctor_id = ?'); args.push(scope.doctorId); }
  if (p.clinicId !== undefined) { where.push('cs.clinic_id = ?'); args.push(p.clinicId); }
  if (p.doctorId !== undefined) { where.push('cs.doctor_id = ?'); args.push(p.doctorId); }
  if (p.day) { where.push('cs.day = ?'); args.push(p.day); }
  return { whereSql: where.join(' AND '), args };
}

export async function listDoctorSessions(p: DoctorSessionListParams, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, p);
  const countRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n ${BASE_JOIN} WHERE ${whereSql}`, ...args);
  const total = Number(countRows[0]?.n ?? 0);
  let limitSql = ''; const pageArgs: unknown[] = [];
  if (p.perPage !== 'all') { limitSql = ' LIMIT ? OFFSET ?'; pageArgs.push(p.perPage as number, (p.page - 1) * (p.perPage as number)); }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} ORDER BY cs.id DESC${limitSql}`,
    ...args, ...pageArgs,
  );
  return { sessions: rows.map(mapRow), pagination: { page: p.page, perPage: p.perPage, total } };
}

export async function getDoctorSession(id: number, scope: DoctorSessionScope | null) {
  const { whereSql, args } = buildWhere(scope, {});
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT cs.*, c.name AS clinic_name, d.display_name AS doctor_name ${BASE_JOIN} WHERE ${whereSql} AND cs.id = ?`, ...args, id,
  );
  if (!rows[0]) throw new KcError('Doctor session not found', 404);
  return mapRow(rows[0]);
}

export interface DoctorSessionCreateInput { clinicId?: number; doctorId: number; day: string; startTime: string; endTime: string; timeSlot: number; }
export async function createDoctorSession(input: DoctorSessionCreateInput, kc: KcActor): Promise<{ id: number }> {
  const clinicId = kc.actor.role === 'SUPER_ADMIN' ? Number(input.clinicId ?? 0) : Number(kc.clinicId ?? input.clinicId ?? 0);
  if (!clinicId) throw new KcError('clinicId is required', 400);
  // A PROFESSIONAL may only create sessions for themselves.
  if (kc.actor.role === 'PROFESSIONAL' && BigInt(input.doctorId) !== kc.wpUserId) throw new KcError('Cannot create a session for another doctor', 403);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_sessions (clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    clinicId, input.doctorId, input.day, input.startTime, input.endTime, input.timeSlot,
  );
  const idRow = await prisma.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() AS id`);
  return { id: Number(idRow[0].id) };
}

export interface DoctorSessionUpdateInput { day?: string; startTime?: string; endTime?: string; timeSlot?: number; }
export async function updateDoctorSession(id: number, input: DoctorSessionUpdateInput, scope: DoctorSessionScope | null): Promise<void> {
  await getDoctorSession(id, scope); // scope + existence
  const sets: string[] = []; const args: unknown[] = [];
  if (input.day !== undefined) { sets.push('day = ?'); args.push(input.day); }
  if (input.startTime !== undefined) { sets.push('start_time = ?'); args.push(input.startTime); }
  if (input.endTime !== undefined) { sets.push('end_time = ?'); args.push(input.endTime); }
  if (input.timeSlot !== undefined) { sets.push('time_slot = ?'); args.push(input.timeSlot); }
  if (sets.length === 0) return;
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinic_sessions SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
}

export async function deleteDoctorSession(id: number, scope: DoctorSessionScope | null): Promise<void> {
  await getDoctorSession(id, scope);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_sessions WHERE id = ?`, id);
}

export async function bulkDeleteDoctorSessions(ids: number[], scope: DoctorSessionScope | null): Promise<number> {
  if (ids.length === 0) return 0;
  const { whereSql, args } = buildWhere(scope, {});
  const placeholders = ids.map(() => '?').join(',');
  const inScope = await prisma.$queryRawUnsafe<any[]>(`SELECT cs.id ${BASE_JOIN} WHERE ${whereSql} AND cs.id IN (${placeholders})`, ...args, ...ids);
  const ok = inScope.map((r) => Number(r.id));
  if (ok.length === 0) return 0;
  const ph = ok.map(() => '?').join(',');
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_sessions WHERE id IN (${ph})`, ...ok);
  return ok.length;
}

export async function exportDoctorSessions(p: DoctorSessionListParams, scope: DoctorSessionScope | null) {
  const list = await listDoctorSessions({ ...p, perPage: 'all', page: 1 }, scope);
  return { sessions: list.sessions };
}

/** Static config for the scheduling UI. */
export function doctorSessionModule() {
  return { days: ['mon','tue','wed','thu','fri','sat','sun'], slotOptions: [5,10,15,20,30,45,60,90,120], defaultSlot: 30 };
}
