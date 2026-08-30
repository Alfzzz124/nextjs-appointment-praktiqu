/**
 * Professional availability — backed by KiviCare's own tables.
 *
 * Replaces three shadow tables at once:
 *   `professional_availability` → `wp_kc_clinic_sessions`
 *   `professional_off_days`     → `wp_kc_clinic_schedule` (module_type = 'doctor')
 *   booked-slot lookups         → `wp_kc_appointments`
 *
 * Reads and writes are both direct SQL. That is a deliberate exception to the
 * plugin-REST rule (D1), made on evidence: KiviCare registers no `do_action` for clinic
 * sessions or holidays, so a direct write skips nothing.
 *
 * Ids are `number` — `wp_users.ID` for the doctor, `wp_kc_clinics.id` for the clinic.
 */

import {
  DAYS_OF_WEEK,
  getWeeklyAvailability,
  listClinicSessions,
  replaceWeeklySchedule,
  type ClinicSessionInput,
  type DayOfWeek,
} from '@/repositories/wp/clinic-sessions.repo';
import {
  OFF_DAY_MODULE,
  createOffDay,
  deleteOffDay,
  listDoctorOffDays,
  type WpOffDay,
} from '@/repositories/wp/off-days.repo';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { PROFESSIONAL_STATUS, findDoctorById } from '@/repositories/wp/doctors.repo';
import { collectBlockedRanges } from '@/services/booking/blocked-ranges.service';
import { buildDaySlots, toMinutes, toTime } from '@/services/booking/slot-math';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AvailabilityWindow {
  id?: number;
  /** KiviCare's day slug: 'mon'…'sun'. */
  day: DayOfWeek;
  /** `HH:MM:SS`. */
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
}

export interface BookableSlot {
  /** Local clinic time — the basis KiviCare stores appointments in. */
  date: string;
  startTime: string;
  endTime: string;
  serviceId: number;
  doctorId: number;
}

/** Every day is present, so callers can iterate without existence checks. */
export type WeeklySchedule = Record<DayOfWeek, AvailabilityWindow[]>;

export interface OffDay {
  id: number;
  startDate: string | null;
  endDate: string | null;
  selectionMode: string;
  selectedDates: string[];
  timeSpecific: boolean;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
}

export type AvailabilityError =
  | { _tag: 'validation'; message: string }
  | { _tag: 'not_found' }
  | { _tag: 'conflict'; message: string };

export function isAvailabilityError(err: unknown): err is AvailabilityError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

/** `YYYY-MM-DD` → KiviCare's day slug, computed in UTC so no local-tz shift applies. */
export function dayOfWeekFor(date: string): DayOfWeek {
  const d = new Date(`${date}T00:00:00Z`);
  // getUTCDay() is 0=Sunday, but DAYS_OF_WEEK starts at Monday.
  return DAYS_OF_WEEK[(d.getUTCDay() + 6) % 7];
}

function toOffDay(o: WpOffDay): OffDay {
  return {
    id: Number(o.id),
    startDate: o.startDate,
    endDate: o.endDate,
    selectionMode: o.selectionMode,
    selectedDates: o.selectedDates,
    timeSpecific: o.timeSpecific,
    startTime: o.startTime,
    endTime: o.endTime,
    description: o.description,
  };
}

/* ------------------------------------------------------------------ */
/* Weekly schedule                                                     */
/* ------------------------------------------------------------------ */

export async function getWeeklySchedule(
  doctorId: number,
  clinicId: number,
): Promise<WeeklySchedule> {
  const week = await getWeeklyAvailability({
    clinicId: BigInt(clinicId),
    doctorId: BigInt(doctorId),
  });

  const out = Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, [] as AvailabilityWindow[]]),
  ) as WeeklySchedule;

  for (const day of DAYS_OF_WEEK) {
    out[day] = week[day].map((s) => ({
      id: Number(s.id),
      day,
      startTime: s.startTime ?? '00:00:00',
      endTime: s.endTime ?? '00:00:00',
      slotDurationMinutes: s.slotDurationMinutes,
    }));
  }
  return out;
}

/**
 * Replace the whole weekly schedule.
 *
 * Overlapping windows on the same day are rejected: two overlapping rows make the same
 * minute bookable twice and produce duplicate slots.
 */
export async function setWeeklySchedule(
  doctorId: number,
  clinicId: number,
  windows: AvailabilityWindow[],
): Promise<number> {
  for (const w of windows) {
    if (!TIME_RE.test(w.startTime) || !TIME_RE.test(w.endTime)) {
      throw { _tag: 'validation' as const, message: 'Times must be HH:MM:SS' };
    }
    if (!(DAYS_OF_WEEK as readonly string[]).includes(w.day)) {
      throw { _tag: 'validation' as const, message: `Unknown day "${w.day}"` };
    }
    if (toMinutes(w.endTime) <= toMinutes(w.startTime)) {
      throw {
        _tag: 'validation' as const,
        message: `${w.day}: endTime must be after startTime`,
      };
    }
  }

  for (const day of DAYS_OF_WEEK) {
    const sameDay = windows
      .filter((w) => w.day === day)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

    for (let i = 1; i < sameDay.length; i++) {
      if (toMinutes(sameDay[i].startTime) < toMinutes(sameDay[i - 1].endTime)) {
        throw {
          _tag: 'conflict' as const,
          message:
            `${day}: ${sameDay[i - 1].startTime}-${sameDay[i - 1].endTime} overlaps ` +
            `${sameDay[i].startTime}-${sameDay[i].endTime}`,
        };
      }
    }
  }

  const sessions: ClinicSessionInput[] = windows.map((w) => ({
    day: w.day,
    startTime: w.startTime,
    endTime: w.endTime,
    slotDurationMinutes: w.slotDurationMinutes,
  }));

  return replaceWeeklySchedule({
    clinicId: BigInt(clinicId),
    doctorId: BigInt(doctorId),
    sessions,
  });
}

/* ------------------------------------------------------------------ */
/* Off days                                                            */
/* ------------------------------------------------------------------ */

export async function listOffDays(doctorId: number): Promise<OffDay[]> {
  return (await listDoctorOffDays(BigInt(doctorId))).map(toOffDay);
}

export async function addOffDay(
  doctorId: number,
  input: {
    startDate: string;
    endDate?: string;
    selectionMode?: 'single' | 'multiple' | 'range';
    selectedDates?: string[];
    timeSpecific?: boolean;
    startTime?: string;
    endTime?: string;
    description?: string;
  },
): Promise<number> {
  if (input.timeSpecific && (!input.startTime || !input.endTime)) {
    throw {
      _tag: 'validation' as const,
      message: 'A time-specific off day needs both startTime and endTime',
    };
  }

  try {
    return Number(
      await createOffDay({
        module: OFF_DAY_MODULE.DOCTOR,
        moduleId: BigInt(doctorId),
        ...input,
      }),
    );
  } catch (err) {
    throw { _tag: 'validation' as const, message: String((err as Error).message) };
  }
}

/** Scoped by doctor, so one professional cannot delete another's closure. */
export async function removeOffDay(doctorId: number, offDayId: number): Promise<boolean> {
  const ok = await deleteOffDay({
    id: BigInt(offDayId),
    module: OFF_DAY_MODULE.DOCTOR,
    moduleId: BigInt(doctorId),
  });
  if (!ok) throw { _tag: 'not_found' as const };
  return true;
}

/* ------------------------------------------------------------------ */
/* Slot generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bookable slots for a doctor on one date.
 *
 * Returns `[]` when the doctor is inactive, the service is not assigned to them at that
 * clinic, or they have no window that day.
 *
 * Off-day handling is the subtle part. The previous implementation returned `[]` if ANY
 * off-day row matched the date. That is wrong now that time-specific closures exist in
 * the data — a 13:00–17:00 closure would have hidden the whole morning. A full-day
 * closure still clears the date; a time-specific one only blocks the range it covers.
 */
export async function generateSlots(
  doctorId: number,
  date: string,
  serviceId: number,
  clinicId: number,
): Promise<BookableSlot[]> {
  const doctor = await findDoctorById(BigInt(doctorId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return [];

  const assigned = await listServicesForDoctor({
    doctorId: BigInt(doctorId),
    clinicId: BigInt(clinicId),
  });
  const service = assigned.find((s) => Number(s.serviceId) === serviceId && s.isActive);
  if (!service) return [];

  const windows = await listClinicSessions({
    clinicId: BigInt(clinicId),
    doctorId: BigInt(doctorId),
    day: dayOfWeekFor(date),
  });
  if (windows.length === 0) return [];

  // Off days and bookings both come from the shared collector, so this path and the
  // public one cannot disagree about what blocks a day — and Phase 2's Google
  // Calendar busy blocks arrive here without touching this function.
  const blockedByDate = await collectBlockedRanges({ doctorId, from: date, to: date });

  // null means a full-day closure, which ends it here. An empty array means the
  // day is open with nothing blocked — the two must not be conflated.
  const blocked = blockedByDate[date];
  if (blocked === null) return [];

  const daySlots = buildDaySlots({
    windows: windows
      .filter((w) => w.startTime !== null && w.endTime !== null)
      .map((w) => ({
        startTime: w.startTime as string,
        endTime: w.endTime as string,
        slotDurationMinutes: w.slotDurationMinutes,
      })),
    blocked,
    durationMinutes: service.durationMinutes ?? undefined,
  });

  return daySlots.map((s) => ({
    date,
    startTime: s.startTime,
    endTime: s.endTime,
    serviceId,
    doctorId,
  }));
}
