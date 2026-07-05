/**
 * Availability Service — slot generation and schedule management.
 *
 * T008: generateSlots(), getWeeklySchedule(), addOffDay(), removeOffDay()
 * T039: overlapping windows validation (FR-015)
 * T040: slot generation algorithm (per plan.md)
 *
 * Slot generation algorithm (plan.md):
 *   1. Verify professional.status == ACTIVE
 *   2. Verify service is assigned to professional and ACTIVE
 *   3. Get practice.timezone
 *   4. Convert date (in practice TZ) → weekday
 *   5. Fetch windows for (professionalId, weekday)
 *   6. Subtract off-days where startDate..endDate includes date
 *   7. Subtract existing BOOKED, PENDING, CHECKED_IN sessions for date
 *   8. For each window: walk in service.durationMinutes increments
 *   9. Convert each slot (local TZ) → UTC, return
 */

import { prisma } from '@/lib/db';
import { buildUtcDateTime, getDayOfWeekInTz, minutesToTime } from '@/lib/time';
import { professionalAudit } from '@/lib/audit';
import { AppointmentStatus, ServiceStatus } from '@prisma/client';

// ============================================
// Types
// ============================================

export interface AvailabilityWindow {
  id?: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface BookableSlot {
  startUtc: Date;
  endUtc: Date;
  serviceId: string;
  professionalId: string;
}

export interface WeeklySchedule {
  [dayOfWeek: number]: AvailabilityWindow[];
}

// ============================================
// Weekly Schedule (T008)
// ============================================

/**
 * Get the full weekly schedule for a professional.
 * Returns a map from dayOfWeek (0-6) to array of windows.
 */
export async function getWeeklySchedule(professionalId: string): Promise<WeeklySchedule> {
  const windows = await prisma.professionalAvailability.findMany({
    where: { professionalId },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });

  const schedule: WeeklySchedule = {};
  for (let d = 0; d <= 6; d++) {
    schedule[d] = [];
  }
  for (const w of windows) {
    schedule[w.dayOfWeek].push({
      id: w.id,
      dayOfWeek: w.dayOfWeek,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    });
  }
  return schedule;
}

/**
 * Replace the full weekly schedule for a professional.
 * Deletes all existing windows and creates new ones.
 * Validates for overlapping windows (T039, FR-015).
 */
export async function setWeeklySchedule(
  professionalId: string,
  windows: AvailabilityWindow[],
  actorId: string,
): Promise<void> {
  // T039: Validate no overlapping windows on same day
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) {
    if (!byDay.has(w.dayOfWeek)) byDay.set(w.dayOfWeek, []);
    byDay.get(w.dayOfWeek)!.push(w);
  }

  for (const [day, dayWindows] of byDay) {
    // Sort by start time
    const sorted = [...dayWindows].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endMinute > sorted[i + 1].startMinute) {
        throw {
          _tag: 'validation' as const,
          errors: {
            [`schedule[${day}]`]: [
              `Overlapping availability windows on day ${day}. Window ends at ${minutesToTime(sorted[i].endMinute)} but next window starts at ${minutesToTime(sorted[i + 1].startMinute)}`,
            ],
          },
        };
      }
    }
  }

  // Atomic replace
  await prisma.$transaction([
    prisma.professionalAvailability.deleteMany({ where: { professionalId } }),
    prisma.professionalAvailability.createMany({
      data: windows.map((w) => ({
        professionalId,
        dayOfWeek: w.dayOfWeek,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
      })),
    }),
  ]);

  // AUDIT
  await professionalAudit('professional.availability_changed', {
    professionalId,
    actorId,
    after: { windows },
  });
}

// ============================================
// Off Days (T008)
// ============================================

export interface OffDay {
  id: string;
  professionalId: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  createdAt: Date;
}

export async function addOffDay(
  professionalId: string,
  startDate: Date,
  endDate: Date,
  reason: string | null,
  actorId: string,
): Promise<OffDay> {
  const offDay = await prisma.professionalOffDay.create({
    data: {
      professionalId,
      startDate,
      endDate,
      reason,
    },
  });

  await professionalAudit('professional.off_day_added', {
    professionalId,
    actorId,
    after: {
      id: offDay.id,
      startDate: offDay.startDate,
      endDate: offDay.endDate,
      reason: offDay.reason,
    },
  });

  return offDay;
}

export async function removeOffDay(id: string, actorId: string): Promise<void> {
  const offDay = await prisma.professionalOffDay.findUnique({ where: { id } });
  if (!offDay) {
    throw { _tag: 'not_found' as const };
  }

  await prisma.professionalOffDay.delete({ where: { id } });

  await professionalAudit('professional.off_day_removed', {
    professionalId: offDay.professionalId,
    actorId,
    before: {
      id: offDay.id,
      startDate: offDay.startDate,
      endDate: offDay.endDate,
    },
  });
}

export async function listOffDays(professionalId: string): Promise<OffDay[]> {
  return prisma.professionalOffDay.findMany({
    where: { professionalId },
    orderBy: { startDate: 'desc' },
  });
}

// ============================================
// Slot Generation (T008, T040)
// ============================================

/**
 * Generate bookable slots for a professional, date, and service.
 *
 * Algorithm (per plan.md):
 *   1. Verify professional.status == ACTIVE
 *   2. Verify service is assigned to professional and ACTIVE
 *   3. Get practice.timezone
 *   4. Convert date (in practice TZ) → weekday
 *   5. Fetch windows for (professionalId, weekday)
 *   6. Subtract off-days where startDate..endDate includes date
 *   7. Subtract existing BOOKED, PENDING, CHECKED_IN sessions for date
 *   8. For each window: walk in service.durationMinutes increments
 *   9. Convert each slot (local TZ) → UTC, return
 */
export async function generateSlots(
  professionalId: string,
  dateStr: string, // YYYY-MM-DD in practice TZ
  serviceId: string,
): Promise<BookableSlot[]> {
  // 1. Get professional + service assignment
  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    include: {
      practice: { select: { id: true, name: true, timezone: true } },
      serviceAssignments: {
        include: { service: { select: { id: true, duration: true, status: true } } },
      },
    },
  });

  if (!professional) return [];
  if (professional.status !== 'ACTIVE') return [];

  // 2. Verify service assignment
  const assignment = professional.serviceAssignments.find(
    (a) => a.serviceId === serviceId && a.service.status === ServiceStatus.ACTIVE,
  );
  if (!assignment) return [];

  const service = assignment.service;
  const tz = professional.practice?.timezone ?? 'Asia/Jakarta';

  // 3 & 4: Get day of week in practice timezone
  const dayOfWeek = getDayOfWeekInTz(dateStr + 'T00:00:00Z', tz);

  // 5: Fetch availability windows for this day
  const windows = await prisma.professionalAvailability.findMany({
    where: { professionalId, dayOfWeek },
    orderBy: { startMinute: 'asc' },
  });

  if (windows.length === 0) return [];

  // 6: Check off-days
  const offDays = await prisma.professionalOffDay.findMany({
    where: {
      professionalId,
      startDate: { lte: dateStr + 'T00:00:00Z' },
      endDate: { gte: dateStr + 'T00:00:00Z' },
    },
  });

  if (offDays.length > 0) return [];

  // 7: Subtract existing BOOKED/PENDING/CHECKED_IN sessions
  // We need to find appointments for this professional on this date
  // that overlap with the availability windows
  const bookedRanges = await getBookedRanges(professionalId, dateStr, tz);

  // 8 & 9: Generate slots
  const slots: BookableSlot[] = [];
  const duration = service.duration;

  for (const window of windows) {
    let slotStart = window.startMinute;
    while (slotStart + duration <= window.endMinute) {
      // Check if this slot overlaps with any booked range
      const slotEnd = slotStart + duration;
      const overlaps = bookedRanges.some(
        (range) => range.start < slotEnd && range.end > slotStart,
      );

      if (!overlaps) {
        const startUtc = buildUtcDateTime(dateStr, slotStart, tz);
        const endUtc = new Date(startUtc.getTime() + duration * 60 * 1000);
        slots.push({
          startUtc,
          endUtc,
          serviceId,
          professionalId,
        });
      }

      slotStart += duration;
    }
  }

  return slots;
}

/**
 * Get booked/pending session time ranges for a professional on a given date.
 * Returns array of {start, end} in minutes-from-midnight (practice TZ).
 *
 * Blocking states: BOOKED, PENDING, CHECKED_IN
 * Non-blocking: COMPLETED, CANCELLED, REJECTED
 */
async function getBookedRanges(
  professionalId: string,
  dateStr: string,
  tz: string,
): Promise<Array<{ start: number; end: number }>> {
  // Find the Doctor record for this professional's userId
  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    include: { user: { select: { id: true } } },
  });

  if (!professional) return [];

  // Find Doctor by userId
  const doctor = await prisma.doctor.findUnique({
    where: { userId: professional.userId },
  });

  if (!doctor) return [];

  // Query appointments for this date and doctor
  const startOfDay = new Date(dateStr + 'T00:00:00Z');
  const endOfDay = new Date(dateStr + 'T23:59:59Z');

  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      appointmentStartDate: { gte: startOfDay, lte: endOfDay },
      status: {
        in: [
          AppointmentStatus.BOOKED,
          AppointmentStatus.PENDING,
          AppointmentStatus.CHECK_IN,
        ],
      },
    },
  });

  // Convert appointment times to minutes-from-midnight in practice TZ.
  // appointmentStartTime/EndTime are `@db.Time` → Date whose time part
  // (in UTC) carries the HH:mm we stored.
  const toMinutes = (t: Date | null): number =>
    t ? t.getUTCHours() * 60 + t.getUTCMinutes() : 0;

  return appointments.map((apt) => ({
    start: toMinutes(apt.appointmentStartTime),
    end: toMinutes(apt.appointmentEndTime),
  }));
}

// ============================================
// Error types
// ============================================

export type AvailabilityError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'not_found' }
  | { _tag: 'forbidden'; message: string };

export function isAvailabilityError(err: unknown): err is AvailabilityError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}