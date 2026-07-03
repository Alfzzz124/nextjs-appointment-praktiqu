// src/services/billing/dashboard.service.ts
import { prisma } from '@/lib/db';
import type { DashboardScope } from '@/services/billing/schedule-scope';

export interface DashboardParams { dateFrom?: string; dateTo?: string; limit: number; period: 'day' | 'month'; }

// Appointment scope predicate over alias `a`.
function apptScope(scope: DashboardScope | null): { sql: string; args: unknown[] } {
  if (!scope) return { sql: '1=1', args: [] };
  if (scope.doctorId !== undefined) return { sql: 'a.doctor_id = ?', args: [scope.doctorId] };
  return { sql: 'a.clinic_id = ?', args: [scope.clinicId] };
}
// Bill scope over alias `b` (bills carry clinic_id; for doctor scope, join via encounter).
function billScope(scope: DashboardScope | null): { sql: string; args: unknown[]; joinEnc: boolean } {
  if (!scope) return { sql: '1=1', args: [], joinEnc: false };
  if (scope.doctorId !== undefined) return { sql: 'e.doctor_id = ?', args: [scope.doctorId], joinEnc: true };
  return { sql: 'b.clinic_id = ?', args: [scope.clinicId], joinEnc: false };
}

export async function getStatistics(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const dateA: string[] = []; const dateArgsA: unknown[] = [];
  if (p.dateFrom) { dateA.push('a.appointment_start_date >= ?'); dateArgsA.push(p.dateFrom); }
  if (p.dateTo) { dateA.push('a.appointment_start_date <= ?'); dateArgsA.push(p.dateTo); }
  const apptWhere = [a.sql, ...dateA].join(' AND ');

  const apptRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT a.patient_id) AS patients,
            SUM(CASE WHEN a.status <> 0 THEN 1 ELSE 0 END) AS active
     FROM wp_kc_appointments a WHERE ${apptWhere}`, ...a.args, ...dateArgsA);

  const b = billScope(scope);
  const dateB: string[] = []; const dateArgsB: unknown[] = [];
  if (p.dateFrom) { dateB.push('b.created_at >= ?'); dateArgsB.push(p.dateFrom + ' 00:00:00'); }
  if (p.dateTo) { dateB.push('b.created_at <= ?'); dateArgsB.push(p.dateTo + ' 23:59:59'); }
  const billWhere = [b.sql, ...dateB].join(' AND ');
  const billJoin = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const billRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(CAST(b.actual_amount AS DECIMAL(15,2))), 0) AS revenue
     FROM wp_kc_bills b ${billJoin} WHERE ${billWhere}`, ...b.args, ...dateArgsB);

  return {
    patients: Number(apptRows[0]?.patients ?? 0),
    appointments: Number(apptRows[0]?.total ?? 0),
    active_appointments: Number(apptRows[0]?.active ?? 0),
    bills: Number(billRows[0]?.bills ?? 0),
    revenue: Number(billRows[0]?.revenue ?? 0),
  };
}

export async function getRecentPayments(p: DashboardParams, scope: DashboardScope | null) {
  const b = billScope(scope);
  const join = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT b.id, b.title, b.actual_amount, b.payment_status, b.created_at, b.clinic_id
     FROM wp_kc_bills b ${join} WHERE ${b.sql} ORDER BY b.id DESC LIMIT ?`, ...b.args, p.limit);
  return { payments: rows.map((r) => ({ id: Number(r.id), title: r.title, amount: Number(r.actual_amount ?? 0), payment_status: r.payment_status, created_at: r.created_at })) };
}

export async function getTopProfessionals(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.doctor_id, d.display_name AS doctor_name, COUNT(*) AS appointments
     FROM wp_kc_appointments a LEFT JOIN wp_users d ON a.doctor_id = d.ID
     WHERE ${a.sql} GROUP BY a.doctor_id, d.display_name ORDER BY appointments DESC LIMIT ?`, ...a.args, p.limit);
  return { professionals: rows.map((r) => ({ doctor_id: Number(r.doctor_id), doctor_name: r.doctor_name, appointments: Number(r.appointments) })) };
}

export async function getUpcomingSessions(p: DashboardParams, scope: DashboardScope | null) {
  const a = apptScope(scope);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT a.id, a.appointment_start_date, a.appointment_start_time, a.status,
            d.display_name AS doctor_name, pt.display_name AS patient_name
     FROM wp_kc_appointments a
     LEFT JOIN wp_users d ON a.doctor_id = d.ID
     LEFT JOIN wp_users pt ON a.patient_id = pt.ID
     WHERE ${a.sql} AND a.status IN (1, 2) AND a.appointment_start_date >= CURDATE()
     ORDER BY a.appointment_start_date ASC, a.appointment_start_time ASC LIMIT ?`, ...a.args, p.limit);
  return { sessions: rows.map((r) => ({ id: Number(r.id), date: r.appointment_start_date ? String(r.appointment_start_date).slice(0,10) : null, status: Number(r.status), doctor_name: r.doctor_name, patient_name: r.patient_name })) };
}

export async function getRevenueChart(p: DashboardParams, scope: DashboardScope | null) {
  const b = billScope(scope);
  const join = b.joinEnc ? 'LEFT JOIN wp_kc_patient_encounters e ON b.encounter_id = e.id' : '';
  const fmt = p.period === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const dates: string[] = []; const dargs: unknown[] = [];
  if (p.dateFrom) { dates.push('b.created_at >= ?'); dargs.push(p.dateFrom + ' 00:00:00'); }
  if (p.dateTo) { dates.push('b.created_at <= ?'); dargs.push(p.dateTo + ' 23:59:59'); }
  const where = [b.sql, ...dates].join(' AND ');
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DATE_FORMAT(b.created_at, '${fmt}') AS bucket, COALESCE(SUM(CAST(b.actual_amount AS DECIMAL(15,2))), 0) AS revenue
     FROM wp_kc_bills b ${join} WHERE ${where} GROUP BY bucket ORDER BY bucket ASC`, ...b.args, ...dargs);
  return { chart: rows.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue) })) };
}
