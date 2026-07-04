import { prisma } from '@/lib/db';
import type { KcActor } from '@/services/billing/kc-actor';
import type { ImportAdapter } from '../adapters';

export const appointmentsAdapter: ImportAdapter = {
  // Appointments are never deduped — always insert.
  async findExisting() {
    return null;
  },
  async insert(row, kc) {
    const clinicId =
      kc.actor.role === 'SUPER_ADMIN' ? BigInt(row.clinic_id) : (kc.clinicId ?? BigInt(row.clinic_id));
    const timezone = row.timezone ?? 'Asia/Jakarta';
    // Build a local datetime string from date + time; store as-is for both local and UTC columns
    // (no offset conversion available here — same value keeps them consistent).
    const time = row.appointment_start_time.length === 5 ? `${row.appointment_start_time}:00` : row.appointment_start_time;
    const startLocal = `${row.appointment_start_date} ${time}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_start_utc, appointment_timezone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      clinicId,
      BigInt(row.doctor_id),
      BigInt(row.patient_id),
      row.appointment_start_date,
      time,
      startLocal,
      timezone,
      row.status,
    );
  },
};
