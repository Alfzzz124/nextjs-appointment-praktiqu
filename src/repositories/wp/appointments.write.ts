/**
 * Appointment writes — via the praktiqu-endpoint plugin, never direct SQL.
 *
 * Reads live in `appointments.repo.ts`. Writes must not: creating an appointment with
 * a raw INSERT skips five `kc_after_create_appointment` listeners (booking email, Pro
 * custom fields, followup scheduling) and leaves the derived UTC columns NULL, because
 * KCAppointment::save is what computes them. Cancellation likewise drives the
 * cancellation email, telemed link teardown and Pro's followup cancellation.
 *
 * See docs/architecture/shadow-tables-audit.md §6 D1.
 */
import { wpRequestJson, WpEndpointError } from '@/lib/wp-endpoint';
import { APPOINTMENT_STATUS } from './appointments.repo';

export type CreateAppointmentInput = {
  clinicId: number;
  doctorId: number;
  patientId: number;
  /** `YYYY-MM-DD` in the appointment's own timezone. */
  startDate: string;
  /** `HH:MM:SS`. */
  startTime: string;
  endDate?: string;
  endTime?: string;
  /** IANA zone. Defaults to the WordPress site timezone if omitted. */
  timezone?: string;
  description?: string;
  serviceIds?: number[];
  /**
   * Defaults to PENDING, which deliberately suppresses the "booked" notification —
   * KiviCare withholds it until an appointment is confirmed/paid.
   */
  status?: number;
};

export type CreatedAppointment = {
  id: number;
  status: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  startDate: string;
  startTime: string;
  timezone: string;
  serviceIds: number[];
  /** Whether `kc_after_create_appointment` fired — false for PENDING bookings. */
  notified: boolean;
};

export type UpdateAppointmentInput = {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  description?: string;
  timezone?: string;
};

type CreateResponse = {
  id: number;
  status: number;
  clinic_id: number;
  doctor_id: number;
  patient_id: number;
  start_date: string;
  start_time: string;
  timezone: string;
  service_ids: number[];
  notified: boolean;
};

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreatedAppointment> {
  const res = await wpRequestJson<CreateResponse>('/appointments', {
    method: 'POST',
    body: {
      clinic_id: input.clinicId,
      doctor_id: input.doctorId,
      patient_id: input.patientId,
      start_date: input.startDate,
      start_time: input.startTime,
      end_date: input.endDate,
      end_time: input.endTime,
      timezone: input.timezone,
      description: input.description,
      service_ids: input.serviceIds ?? [],
      status: input.status ?? APPOINTMENT_STATUS.PENDING,
    },
  });

  if (typeof res?.id !== 'number' || !Number.isFinite(res.id)) {
    throw new WpEndpointError('Appointment create returned no id', 502);
  }

  return {
    id: res.id,
    status: res.status,
    clinicId: res.clinic_id,
    doctorId: res.doctor_id,
    patientId: res.patient_id,
    startDate: res.start_date,
    startTime: res.start_time,
    timezone: res.timezone,
    serviceIds: res.service_ids ?? [],
    notified: Boolean(res.notified),
  };
}

export async function updateAppointment(
  appointmentId: number,
  input: UpdateAppointmentInput,
): Promise<{ id: number; updated: string[] }> {
  return wpRequestJson<{ id: number; updated: string[] }>(`/appointments/${appointmentId}`, {
    method: 'PUT',
    body: {
      start_date: input.startDate,
      start_time: input.startTime,
      end_date: input.endDate,
      end_time: input.endTime,
      description: input.description,
      timezone: input.timezone,
    },
  });
}

/**
 * Change status. Use `cancelAppointment` rather than passing 0 here directly — the
 * ordinal is counter-intuitive enough to be worth naming.
 */
export async function setAppointmentStatus(
  appointmentId: number,
  status: number,
): Promise<{ id: number; status: number; cancelled: boolean }> {
  return wpRequestJson(`/appointments/${appointmentId}/status`, {
    method: 'POST',
    body: { status },
  });
}

/**
 * Cancel an appointment.
 *
 * CANCELLED is 0, not 1. An earlier port wrote 1 here, which is BOOKED — the
 * appointment stayed active and the slot was blocked permanently.
 */
export async function cancelAppointment(appointmentId: number) {
  return setAppointmentStatus(appointmentId, APPOINTMENT_STATUS.CANCELLED);
}
