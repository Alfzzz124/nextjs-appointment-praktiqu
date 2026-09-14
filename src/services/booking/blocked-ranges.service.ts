// src/services/booking/blocked-ranges.service.ts
//
// The one place that answers "what is blocking this professional's day?".
//
// `slot-math.ts` owns the arithmetic; this owns the fetching. Both slot readers —
// `generateSlots` (one date, staff) and `getPublicSlotsForRange` (a range, the public
// booking page) — go through here, so neither can drift from the other about what
// counts as unavailable.
//
// ------------------------------------------------------------------------------
// Adding a new source of unavailability
//
// This function is the seam. A new source is merged in HERE, once, and both readers
// pick it up — Google Calendar busy blocks arrived that way and touched neither
// reader. Do not add one at the call sites; that is the duplication this replaced.
//
// The WRITE path does not come through here. `findConflictingAppointments`, used by
// public-booking.service.ts and session.service.ts, does its own overlap check.
// `createPublicAppointment` now checks Google busy times separately, right before
// it writes, because hiding a slot is not enforcing it. The staff path
// deliberately does NOT: a receptionist booking over the professional's own
// calendar entry is making an informed decision, not a mistake.
// ------------------------------------------------------------------------------
import {
  ACTIVE_STATUSES,
  listAppointments,
  type WpAppointment,
} from '@/repositories/wp/appointments.repo';
import { isOffOn, listDoctorOffDays } from '@/repositories/wp/off-days.repo';
import { blockedRangesFor, eachDate, type BlockedRange } from '@/services/booking/slot-math';
import { googleBusyForRange } from '@/services/integrations/google-busy.service';

/**
 * `paginate` in repositories/wp/wp-user.ts clamps perPage to 100 whatever is asked
 * for, so asking for more is silently ignored. Page instead.
 */
const APPOINTMENT_PAGE_SIZE = 100;

/**
 * Stop after this many pages even if the row count still claims there are more.
 * 10 000 active appointments for one professional in one range is not a real
 * practice, it is a query that has stopped making sense — better to return what we
 * have than to loop forever.
 */
const MAX_APPOINTMENT_PAGES = 100;

/**
 * Every active appointment for a professional in a date range — all of them.
 *
 * The single-page version of this silently returned the first 100, and because the
 * order is `appointmentStartDate asc` the rows it dropped were the last days of the
 * range: the days most likely to still be free, and so most likely to be clicked.
 * A booked slot then showed as available.
 */
async function listAllAppointmentsInRange(
  doctorId: bigint,
  from: string,
  to: string,
): Promise<WpAppointment[]> {
  const all: WpAppointment[] = [];

  for (let page = 1; page <= MAX_APPOINTMENT_PAGES; page += 1) {
    const result = await listAppointments({
      page,
      perPage: APPOINTMENT_PAGE_SIZE,
      doctorId,
      dateFrom: from,
      dateTo: to,
      statuses: ACTIVE_STATUSES,
    });

    all.push(...result.items);

    // A short page ends the walk: either it was the last one, or `total` disagrees
    // with what the query actually yields — and trusting `total` there would spin
    // until the page cap.
    const pageSize = result.perPage || APPOINTMENT_PAGE_SIZE;
    if (result.items.length < pageSize) break;

    if (all.length >= result.total) break;
  }

  return all;
}

/**
 * Blocked ranges for every date from `from` to `to` inclusive, keyed `YYYY-MM-DD`.
 *
 * The value keeps `blockedRangesFor`'s distinction, and callers must branch on it:
 *   - `null` — the day is closed outright (a full-day off day)
 *   - `[]`   — the day is open with nothing blocked
 *
 * Off days and appointments are fetched once for the whole range and narrowed per
 * date here, because deciding which rows fall on which date needs repository
 * knowledge (`isOffOn`, and the appointment's own start date). The arithmetic itself
 * stays in `blockedRangesFor`.
 */
export async function collectBlockedRanges(opts: {
  doctorId: number;
  /** Inclusive `YYYY-MM-DD` range. */
  from: string;
  to: string;
  /**
   * The professional's own timezone, for reading Google's UTC instants back into
   * local wall-clock minutes. Both callers already have the doctor row loaded, so
   * passing `doctor.timezone` costs nothing; omitted, it falls back to the
   * practice default.
   */
  timeZone?: string;
}): Promise<Record<string, BlockedRange[] | null>> {
  const doctorId = BigInt(opts.doctorId);

  const [offDays, appointments, googleBusy] = await Promise.all([
    listDoctorOffDays(doctorId, { from: opts.from, to: opts.to }),
    // ACTIVE_STATUSES rather than "not cancelled": CHECK_OUT is a finished visit and
    // no longer occupies its slot.
    listAllAppointmentsInRange(doctorId, opts.from, opts.to),
    // Fails open on its own: every failure inside returns {}, because a Google
    // outage must not stop a practice taking bookings.
    googleBusyForRange({
      professionalId: opts.doctorId,
      from: opts.from,
      to: opts.to,
      timeZone: opts.timeZone,
    }),
  ]);

  const byDate: Record<string, BlockedRange[] | null> = {};

  for (const date of eachDate(opts.from, opts.to)) {
    const ranges = blockedRangesFor({
      offDays: offDays.filter((o) => isOffOn(o, date)),
      appointments: appointments.filter((a) => a.startDate === date),
    });

    // `null` is a full-day closure and already says everything; appending to it
    // would turn "closed" back into "open with some blocks".
    if (ranges !== null) {
      const busy = googleBusy[date];
      if (busy) ranges.push(...busy);
    }

    byDate[date] = ranges;
  }

  return byDate;
}
