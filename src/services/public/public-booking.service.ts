// src/services/public/public-booking.service.ts
// Public booking business logic — writes to the app tables (Prisma models),
// consistent with the public catalog (/public/professionals|services|slots)
// which serves Professional/Service cuids.
//
// History: the original implementation was a verbatim KiviCare-era port that
// ran `parseInt(professionalId)` and interpolated the result into raw
// wp_kc_* SQL. The catalog serves cuids, so parseInt yielded NaN and every
// create crashed with "Unknown column 'NaN'" (found 2026-07-13). The create
// path now bridges Professional → Doctor by userId — the same pattern
// feature-002's availability.service.getBookedRanges uses — so public
// bookings also block slots in the authenticated slot API.
import { AppointmentStatus, ServiceStatus, UserRole, VisitType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import { z } from 'zod';

export const createPublicAppointmentSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
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

/** Raised when a service row cannot be found for the given professional/service. */
export class ServiceNotFoundError extends Error {
  readonly code = 'SERVICE_NOT_FOUND';
}

/** Raised when the requested slot conflicts with an existing appointment. */
export class SlotConflictError extends Error {
  readonly code = 'SLOT_CONFLICT';
}

/** Raised when the appointment INSERT fails. */
export class AppointmentInsertError extends Error {
  readonly code = 'APPOINTMENT_INSERT_FAILED';
}

export interface CreatedAppointment {
  id: string;
  status: string;
  date: string;
  startTime: string;
  service: string;
  professionalName: string;
  clientName: string;
  token: string;
}

/** Appointment states that block a slot (mirrors feature-002 getBookedRanges). */
const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.BOOKED,
  AppointmentStatus.CHECK_IN,
];

const CANCELLABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.BOOKED,
];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** `@db.Time` columns carry HH:mm in the UTC time part (see getBookedRanges). */
function timeOfDay(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

export async function createPublicAppointment(
  input: CreatePublicAppointmentInput,
): Promise<CreatedAppointment> {
  // Verify slot hold is still active
  const hold = slotHoldService.get(input.holdKey);
  if (!hold) throw new HoldExpiredError('Slot hold expired');

  const professional = await prisma.professional.findUnique({
    where: { id: input.professionalId },
    select: { id: true, userId: true, fullName: true, practiceId: true, status: true },
  });
  if (!professional || professional.status !== 'ACTIVE') {
    throw new ProfessionalNotFoundError('Professional not found');
  }

  // The public catalog only offers assigned, ACTIVE, non-private services —
  // enforce the same constraint on the write path.
  const assignment = await prisma.professionalServiceAssignment.findUnique({
    where: {
      professionalId_serviceId: {
        professionalId: professional.id,
        serviceId: input.serviceId,
      },
    },
    select: {
      service: {
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          price: true,
          clinicId: true,
          status: true,
          isPrivate: true,
        },
      },
    },
  });
  const service = assignment?.service;
  if (!service || service.status !== ServiceStatus.ACTIVE || service.isPrivate) {
    throw new ServiceNotFoundError('Service not found for this professional');
  }

  const clinicId = professional.practiceId ?? service.clinicId;
  if (!clinicId) {
    throw new AppointmentInsertError('Professional is not attached to a practice');
  }

  // Time bounds. *Utc fields mirror the public slots route (slot-generator),
  // which builds slot instants from server-local wallclock — conflict checks
  // must live in the same frame.
  const [hh, mm] = input.startTime.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    throw new AppointmentInsertError('Invalid startTime');
  }
  const startInstant = new Date(`${input.date}T00:00:00`);
  if (Number.isNaN(startInstant.getTime())) {
    throw new AppointmentInsertError('Invalid date');
  }
  startInstant.setHours(hh, mm, 0, 0);
  const endInstant = new Date(startInstant.getTime() + service.durationMinutes * 60_000);
  const endTotalMinutes = hh * 60 + mm + service.durationMinutes;
  const endHHmm = `${pad(Math.floor(endTotalMinutes / 60) % 24)}:${pad(endTotalMinutes % 60)}`;
  const slotDate = new Date(`${input.date}T00:00:00.000Z`);

  // Bridge Professional → Doctor by shared userId (appointments.doctor_id is
  // an FK to doctors). Provision the row if this professional has none yet.
  const doctor = await prisma.doctor.upsert({
    where: { userId: professional.userId },
    update: {},
    create: { userId: professional.userId, status: 1 },
    select: { id: true },
  });

  // Get or create the client (User + Patient), then attach to the practice.
  let user = await prisma.user.findUnique({
    where: { email: input.clientEmail },
    select: { id: true },
  });
  if (!user) {
    const firstName = input.clientName.split(' ')[0];
    const lastName = input.clientName.split(' ').slice(1).join(' ') || '-';
    const base = (input.clientEmail.split('@')[0] || 'client').slice(0, 40);
    let username = base;
    while (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
      username = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    }
    user = await prisma.user.create({
      data: {
        email: input.clientEmail,
        username,
        firstName,
        lastName,
        displayName: input.clientName,
        role: UserRole.CLIENT,
      },
      select: { id: true },
    });
  }
  const patient = await prisma.patient.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
    select: { id: true },
  });
  await prisma.patientClinicMapping.upsert({
    where: { patientId_clinicId: { patientId: patient.id, clinicId } },
    update: {},
    create: { patientId: patient.id, clinicId },
  });

  // Conflict-check + insert atomically.
  let created: { id: string; status: AppointmentStatus };
  try {
    created = await prisma.$transaction(async (tx) => {
      const clash = await tx.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          status: { in: BLOCKING_STATUSES },
          appointmentStartUtc: { lt: endInstant },
          appointmentEndUtc: { gt: startInstant },
        },
        select: { id: true },
      });
      if (clash) throw new SlotConflictError('Slot no longer available');

      const appt = await tx.appointment.create({
        data: {
          clinicId,
          doctorId: doctor.id,
          patientId: patient.id,
          appointmentStartDate: slotDate,
          appointmentStartTime: timeOfDay(input.startTime),
          appointmentEndDate: slotDate,
          appointmentEndTime: timeOfDay(endHHmm),
          appointmentStartUtc: startInstant,
          appointmentEndUtc: endInstant,
          appointmentTimezone: 'Asia/Jakarta',
          visitType: VisitType.IN_PERSON,
          description: input.notes ?? null,
          status: AppointmentStatus.PENDING,
        },
        select: { id: true, status: true },
      });

      await tx.appointmentServiceMapping.create({
        data: { appointmentId: appt.id, serviceId: service.id, price: service.price },
      });

      return appt;
    });
  } catch (err) {
    if (err instanceof SlotConflictError) {
      slotHoldService.consume(input.holdKey);
    }
    throw err;
  }

  slotHoldService.consume(input.holdKey);

  return {
    id: created.id,
    status: created.status,
    date: input.date,
    startTime: input.startTime,
    service: service.name,
    professionalName: professional.fullName,
    clientName: input.clientName,
    token: signAppointmentToken(created.id),
  };
}

// ── Public appointment lookup + cancel ───────────────────────────────────────

export interface PublicAppointmentView {
  id: string;
  status: string;
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

const APPOINTMENT_VIEW_SELECT = {
  id: true,
  status: true,
  appointmentStartDate: true,
  appointmentStartTime: true,
  doctor: { select: { user: { select: { displayName: true } } } },
  patient: { select: { user: { select: { displayName: true } } } },
  services: { select: { service: { select: { name: true } } }, take: 1 },
} as const;

type AppointmentViewRow = {
  id: string;
  status: AppointmentStatus;
  appointmentStartDate: Date;
  appointmentStartTime: Date;
  doctor: { user: { displayName: string } } | null;
  patient: { user: { displayName: string } } | null;
  services: Array<{ service: { name: string } }>;
};

function toView(row: AppointmentViewRow): PublicAppointmentView {
  const t = row.appointmentStartTime;
  return {
    id: row.id,
    status: row.status,
    date: row.appointmentStartDate.toISOString().slice(0, 10),
    startTime: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    service: row.services[0]?.service.name ?? 'Service',
    professionalName: row.doctor?.user.displayName ?? 'Professional',
    clientName: row.patient?.user.displayName ?? 'Client',
  };
}

/** Read a public appointment by id (cuid). Returns null if no row. */
export async function getPublicAppointmentById(
  id: string,
): Promise<PublicAppointmentView | null> {
  const row = await prisma.appointment.findUnique({
    where: { id },
    select: APPOINTMENT_VIEW_SELECT,
  });
  return row ? toView(row as AppointmentViewRow) : null;
}

/**
 * Cancel a public appointment. Only PENDING and BOOKED appointments may be
 * cancelled; the row is then set to CANCELLED. Otherwise throws
 * NotCancellableError.
 */
export async function cancelPublicAppointment(
  id: string,
): Promise<PublicAppointmentView> {
  const row = await prisma.appointment.findUnique({
    where: { id },
    select: APPOINTMENT_VIEW_SELECT,
  });
  if (!row) throw new AppointmentNotFoundError();

  if (!CANCELLABLE_STATUSES.includes(row.status as AppointmentStatus)) {
    throw new NotCancellableError();
  }

  await prisma.appointment.update({
    where: { id },
    data: { status: AppointmentStatus.CANCELLED },
  });

  const updated = await getPublicAppointmentById(id);
  if (!updated) throw new AppointmentNotFoundError();
  return updated;
}
