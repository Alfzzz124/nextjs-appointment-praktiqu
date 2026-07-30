/**
 * Public (guest) booking — writes into KiviCare's tables, via the plugin.
 *
 * Retires the last of the booking shadow tables from this path: `appointments`,
 * `appointment_service_mappings`, `patients`, `patient_clinic_mappings`, `doctors` and
 * `users`. A guest booking now produces exactly the same rows KiviCare's own booking
 * form produces, so it is visible in the WP admin and blocks slots for staff.
 *
 * History worth keeping: the previous version bridged Professional → Doctor by userId
 * and provisioned a `doctors` row on the fly, because the two id spaces could not be
 * joined. With a single `wp_users` id space that bridge is gone — the professional id
 * IS the doctor id.
 *
 * Writes go through the praktiqu-endpoint plugin, not raw SQL: `kc_patient_save` sends
 * the welcome mail, and `kc_after_create_appointment` drives the booking notification,
 * telemed link and followups. A guest booking that skipped them would be invisible to
 * everyone but us. See docs/architecture/shadow-tables-audit.md §6 D1.
 */
import { z } from 'zod';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import { findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { cancelAppointment, createAppointment } from '@/repositories/wp/appointments.write';
import { PROFESSIONAL_STATUS, findDoctorById } from '@/repositories/wp/doctors.repo';
import { findServiceById, listServicesForDoctor } from '@/repositories/wp/services.repo';
import { findPatientByEmail } from '@/repositories/wp/patients.repo';
import { createPatient, updatePatient } from '@/repositories/wp/patients.write';
import {
  SESSION_STATUS,
  type SessionStatus,
  findSessionById,
  fromKcStatus,
} from '@/repositories/wp/sessions.repo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The booking widget posts `HH:MM`; `HH:MM:SS` is accepted for API callers. */
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export const createPublicAppointmentSchema = z.object({
  // Coerced: these are `wp_users.ID` / `wp_kc_services.id` integers, but they arrive as
  // path-derived strings from every HTML form.
  professionalId: z.coerce.number().int().positive(),
  serviceId: z.coerce.number().int().positive(),
  date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
  startTime: z.string().regex(TIME_RE, 'startTime must be HH:MM'),
  clientName: z.string().min(1).max(255),
  clientEmail: z.string().email(),
  clientMobile: z.string().min(1).max(32),
  notes: z.string().max(1000).optional(),
  holdKey: z.string().min(1),
});
export type CreatePublicAppointmentInput = z.infer<typeof createPublicAppointmentSchema>;

export class HoldExpiredError extends Error {
  readonly code = 'HOLD_EXPIRED';
}

/** Raised when the professional does not exist or is not ACTIVE. */
export class ProfessionalNotFoundError extends Error {
  readonly code = 'PROFESSIONAL_NOT_FOUND';
}

/** Raised when the service is not one this professional offers publicly. */
export class ServiceNotFoundError extends Error {
  readonly code = 'SERVICE_NOT_FOUND';
}

/** Raised when the requested slot conflicts with an existing appointment. */
export class SlotConflictError extends Error {
  readonly code = 'SLOT_CONFLICT';
}

/**
 * Raised when the email belongs to a WordPress user who is not a patient — a doctor or
 * an admin. Creating the appointment against that account would be wrong, and silently
 * making them a patient worse.
 */
export class EmailConflictError extends Error {
  readonly code = 'EMAIL_CONFLICT';
}

/** Raised when the appointment write fails. */
export class AppointmentInsertError extends Error {
  readonly code = 'APPOINTMENT_INSERT_FAILED';
}

export interface CreatedAppointment {
  id: number;
  status: SessionStatus;
  date: string;
  startTime: string;
  service: string;
  professionalName: string;
  clientName: string;
  token: string;
}

/** Only a not-yet-attended appointment can be cancelled by the guest who booked it. */
const CANCELLABLE_STATUSES: readonly SessionStatus[] = [
  SESSION_STATUS.PENDING,
  SESSION_STATUS.BOOKED,
];

const DEFAULT_DURATION_MINUTES = 30;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function withSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}:00`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? full,
    // WordPress is fine with an empty last name; KiviCare's display name just uses first.
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Resolve the guest to a `wp_users` patient, creating one if the address is new.
 *
 * A returning guest is matched by email and re-used — booking twice must not create a
 * second patient record. Either way the patient ends up mapped to the clinic, which is
 * what makes them visible to that clinic's staff.
 */
async function resolvePatient(
  input: CreatePublicAppointmentInput,
  clinicId: number,
): Promise<number> {
  const existing = await findPatientByEmail(input.clientEmail);

  if (existing) {
    // Idempotent on the plugin side: it inserts the clinic mapping only when absent.
    await updatePatient(Number(existing.id), { clinicId });
    return Number(existing.id);
  }

  const { firstName, lastName } = splitName(input.clientName);
  try {
    // No password: WordPress generates one and the kc_patient_save listener mails it,
    // which is how a guest gets an account they can later log into.
    const created = await createPatient({
      email: input.clientEmail,
      firstName,
      lastName,
      contactNumber: input.clientMobile,
      clinicId,
    });
    return created.id;
  } catch (err) {
    // 409 here means the address exists but is not a patient — findPatientByEmail is
    // role-filtered, so the two checks disagreeing is exactly that case.
    if (err instanceof WpEndpointError && err.status === 409) {
      throw new EmailConflictError('That email is already registered to another account');
    }
    throw err;
  }
}

export async function createPublicAppointment(
  input: CreatePublicAppointmentInput,
): Promise<CreatedAppointment> {
  const hold = slotHoldService.get(input.holdKey);
  if (!hold) throw new HoldExpiredError('Slot hold expired');

  const doctor = await findDoctorById(BigInt(input.professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) {
    throw new ProfessionalNotFoundError('Professional not found');
  }

  // The public catalogue only offers assigned, active, public services — the write path
  // enforces the same constraint, so a guessed service id cannot book a private service.
  const offered = await listServicesForDoctor({
    doctorId: BigInt(input.professionalId),
    publicOnly: true,
  });
  const service = offered.find((s) => Number(s.serviceId) === input.serviceId && s.isActive);
  if (!service) {
    throw new ServiceNotFoundError('Service not found for this professional');
  }

  // The clinic comes from the doctor↔service mapping rather than the doctor: a doctor
  // may work at several clinics, and the service they were booked for says which.
  const clinicId = Number(service.clinicId);
  if (!clinicId) {
    throw new AppointmentInsertError('Professional is not attached to a practice');
  }

  const startTime = withSeconds(input.startTime);
  const endTime = addMinutes(startTime, service.durationMinutes ?? DEFAULT_DURATION_MINUTES);

  const clashes = await findConflictingAppointments({
    doctorId: BigInt(input.professionalId),
    date: input.date,
    startTime,
    endTime,
  });
  if (clashes.length > 0) {
    // Release the hold: it is stale, and keeping it would block the guest from picking
    // another time for the rest of the TTL.
    slotHoldService.consume(input.holdKey);
    throw new SlotConflictError('Slot no longer available');
  }

  const patientId = await resolvePatient(input, clinicId);

  // PENDING, deliberately: KiviCare withholds the "booked" email until an appointment
  // is confirmed, and a guest booking is exactly what a practice wants to review first.
  const created = await createAppointment({
    clinicId,
    doctorId: input.professionalId,
    patientId,
    startDate: input.date,
    startTime,
    endDate: input.date,
    endTime,
    description: input.notes,
    serviceIds: [input.serviceId],
  });

  slotHoldService.consume(input.holdKey);

  const professionalName =
    [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim() || doctor.displayName;

  return {
    id: created.id,
    status: fromKcStatus(created.status),
    date: input.date,
    startTime: startTime.slice(0, 5),
    service: service.nameAlias ?? service.name,
    professionalName,
    clientName: input.clientName,
    token: signAppointmentToken(created.id),
  };
}

/* ------------------------------------------------------------------ */
/* Lookup + cancel                                                     */
/* ------------------------------------------------------------------ */

export interface PublicAppointmentView {
  id: number;
  status: SessionStatus;
  date: string;
  startTime: string;
  service: string;
  professionalName: string;
  clientName: string;
}

export class AppointmentNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
}
export class NotCancellableError extends Error {
  readonly code = 'NOT_CANCELLABLE';
}

/**
 * The service name for a booking.
 *
 * KiviCare keeps the service ids comma-joined in `visit_type`, and only the first is
 * shown — a booking carries one service in practice.
 */
async function serviceNameFor(serviceIds: number[]): Promise<string> {
  const first = serviceIds[0];
  if (first === undefined) return 'Service';
  const service = await findServiceById(BigInt(first));
  return service?.name ?? 'Service';
}

async function toView(id: number): Promise<PublicAppointmentView | null> {
  const row = await findSessionById(id);
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    date: row.slotDate ?? '',
    startTime: (row.startTime ?? '').slice(0, 5),
    service: await serviceNameFor(row.serviceIds),
    professionalName: row.professionalName,
    clientName: row.clientName,
  };
}

/** Read a public appointment by KiviCare id. Returns null if there is no such row. */
export async function getPublicAppointmentById(
  id: number,
): Promise<PublicAppointmentView | null> {
  return toView(id);
}

/**
 * Cancel a public appointment.
 *
 * Only PENDING and BOOKED may be cancelled — a checked-in or attended appointment is
 * the practice's to close, and a cancelled one is already there.
 */
export async function cancelPublicAppointment(id: number): Promise<PublicAppointmentView> {
  const current = await findSessionById(id);
  if (!current) throw new AppointmentNotFoundError();

  if (!CANCELLABLE_STATUSES.includes(current.status)) {
    throw new NotCancellableError();
  }

  // Through the plugin: cancelling drives the cancellation email, telemed teardown and
  // Pro's followup cancellation. It also writes status 0 — CANCELLED, not 1.
  await cancelAppointment(id);

  const updated = await toView(id);
  if (!updated) throw new AppointmentNotFoundError();
  return updated;
}
