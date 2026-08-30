/**
 * Public (unauthenticated) catalogue — backed by KiviCare's tables.
 *
 * Retires the `clinics`, `services`, `professional_service_assignments` and
 * `static_data` shadow tables from this path. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * Everything here is world-readable, so the queries are deliberately narrow: only
 * ACTIVE clinics, only services the doctor has marked public, and only the lookup
 * types a booking form needs.
 *
 * Ids are `number` — `wp_kc_clinics.id`, `wp_users.ID`, `wp_kc_services.id`.
 */
import { SLOT_HOLD_TTL_MS } from '@/services/booking/slot-hold.service';
import { verifyAppointmentIdToken } from '@/lib/public/appointment-token';
import { getPublicAppointmentById } from '@/services/public/public-booking.service';
import { findClinicById, listClinics, type WpClinic } from '@/repositories/wp/clinics.repo';
import { listServicesForDoctor, type WpDoctorService } from '@/repositories/wp/services.repo';
import {
  PROFESSIONAL_STATUS,
  findDoctorById,
  listDoctors,
  type WpDoctor,
} from '@/repositories/wp/doctors.repo';
import { STATIC_DATA_TYPE, listStaticData } from '@/repositories/wp/static-data.repo';
import { listClinicSessions } from '@/repositories/wp/clinic-sessions.repo';
import { dayOfWeekFor, generateSlots } from '@/services/professional/availability.service';
import { collectBlockedRanges } from '@/services/booking/blocked-ranges.service';
import { buildDaySlots, eachDate, toMinutes } from '@/services/booking/slot-math';

export interface PublicClinic {
  id: number;
  name: string;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  specialties: string[];
}

function toPublicClinic(c: WpClinic): PublicClinic {
  return {
    id: Number(c.id),
    name: c.name ?? '',
    email: c.email,
    telephoneNo: c.telephone,
    address: c.address,
    city: c.city,
    state: c.state,
    country: c.country,
    postalCode: c.postalCode,
    specialties: c.specialties,
  };
}

/** Active clinics only — an inactive one must not appear on a public booking page. */
export async function listPublicPractices(): Promise<PublicClinic[]> {
  const { items } = await listClinics({ page: 1, perPage: 100 });
  return items.map(toPublicClinic).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPublicPractice(id: number): Promise<PublicClinic | null> {
  const clinic = await findClinicById(BigInt(id));
  // Checked here rather than left to the caller: this endpoint is unauthenticated, so
  // a deactivated clinic must simply not exist to the public.
  if (!clinic || !clinic.isActive) return null;
  return toPublicClinic(clinic);
}

export interface PublicProfessional {
  id: number;
  fullName: string;
  professionalType: string | null;
  biography: string | null;
  specialties: string[];
  /**
   * The next day this professional has working hours, and when those start.
   *
   * Availability, not a free slot: it says the practice is open to them that day, not
   * that 09:00 is unbooked. The booking widget calls the slots endpoint for the real
   * answer. (The previous implementation claimed a bookable slot while passing an empty
   * booking list, so it named a time that could already be taken.)
   */
  nextAvailable: { date: string; startTime: string } | null;
}

/** How far ahead `nextAvailable` looks before giving up. */
const NEXT_AVAILABLE_HORIZON_DAYS = 14;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Active professionals for the public directory.
 *
 * Capped at 50, as before — this is a browse page, not an export.
 */
export async function listPublicProfessionals(
  opts: { specialty?: string; clinicId?: number } = {},
): Promise<PublicProfessional[]> {
  const { items } = await listDoctors({
    page: 1,
    perPage: 50,
    statuses: [PROFESSIONAL_STATUS.ACTIVE],
    specialty: opts.specialty,
    clinicIds: opts.clinicId !== undefined ? [BigInt(opts.clinicId)] : undefined,
  });

  // The repository's specialty filter is a LIKE over the whole basic_data blob and can
  // over-match; re-check against the decoded list so the answer is exact.
  const specialty = opts.specialty?.trim().toLowerCase();
  const doctors = specialty
    ? items.filter((d) => d.specialties.some((s) => s.toLowerCase() === specialty))
    : items;

  // One query for the whole page. Per-doctor lookups here were 50 round-trips.
  const sessions =
    doctors.length === 0
      ? []
      : await listClinicSessions({ doctorIds: doctors.map((d) => d.id) });

  const byDoctor = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (s.doctorId === null) continue;
    const key = s.doctorId.toString();
    const list = byDoctor.get(key);
    if (list) list.push(s);
    else byDoctor.set(key, [s]);
  }

  const today = new Date();
  return doctors.map((d) => ({
    id: Number(d.id),
    fullName:
      [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.displayName || d.email,
    professionalType: d.professionalType,
    biography: d.description,
    specialties: d.specialties,
    nextAvailable: nextAvailableFor(byDoctor.get(d.id.toString()) ?? [], today),
  }));
}

function nextAvailableFor(
  sessions: Array<{ day: string | null; startTime: string | null }>,
  from: Date,
): { date: string; startTime: string } | null {
  if (sessions.length === 0) return null;

  for (let i = 0; i < NEXT_AVAILABLE_HORIZON_DAYS; i += 1) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const date = isoDate(d);
    const day = dayOfWeekFor(date);

    const earliest = sessions
      .filter((s) => s.day === day && s.startTime)
      .map((s) => s.startTime!)
      .sort()[0];

    if (earliest) return { date, startTime: earliest };
  }
  return null;
}

export interface PublicService {
  id: number;
  name: string;
  price: string;
  durationMinutes: number | null;
  serviceType: string | null;
}

/**
 * A professional's publicly bookable services.
 *
 * Returns `null` when the professional does not exist or is not ACTIVE, so the route
 * can 404 rather than showing an empty catalogue for someone merely inactive.
 *
 * `publicOnly` matters: KiviCare's mapping carries an `is_public` flag, and a service
 * the doctor offers privately must not surface here.
 */
export async function getPublicProfessionalServices(
  professionalId: number,
  clinicId?: number,
): Promise<PublicService[] | null> {
  const doctor = await findDoctorById(BigInt(professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;

  const rows = await listServicesForDoctor({
    doctorId: BigInt(professionalId),
    clinicId: clinicId !== undefined ? BigInt(clinicId) : undefined,
    publicOnly: true,
  });

  return rows.map((s) => ({
    id: Number(s.serviceId),
    name: s.nameAlias ?? s.name,
    // The doctor's charge, not the catalogue list price — that is what a patient pays.
    price: s.charges ?? '0',
    durationMinutes: s.durationMinutes,
    serviceType: s.type,
  }));
}

export interface PublicSlot {
  date: string;
  /** `HH:MM:SS`, local clinic time — the basis KiviCare stores appointments in. */
  startTime: string;
  endTime: string;
}

/**
 * The "is this professional publicly bookable for this service" check shared by both
 * slot readers below. `null` collapses three distinct failures — no such professional,
 * not ACTIVE, service not offered publicly and actively — into the one answer both
 * callers need: 404. Returning the full mapping (not just its id) means the caller
 * never has to re-query for the clinic or duration it already has in hand.
 */
async function resolvePublicServiceMapping(
  professionalId: number,
  serviceId: number,
  clinicId?: number,
): Promise<{ doctor: WpDoctor; mapping: WpDoctorService } | null> {
  const doctor = await findDoctorById(BigInt(professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;

  const offered = await listServicesForDoctor({
    doctorId: BigInt(professionalId),
    clinicId: clinicId !== undefined ? BigInt(clinicId) : undefined,
    publicOnly: true,
  });
  const mapping = offered.find((s) => Number(s.serviceId) === serviceId && s.isActive);
  if (!mapping) return null;

  return { doctor, mapping };
}

/**
 * Bookable slots for one professional, service and date.
 *
 * `null` means there is no such active professional, or the service is not one they
 * offer publicly — a 404 either way, distinct from "no slots that day" (`[]`). A day
 * that is open but wholly in the past — every window's start already gone by — is the
 * `[]` case too: the professional is bookable, there is just nothing left to offer.
 *
 * Unlike the previous implementation this subtracts real bookings and off days: it
 * shares `generateSlots` with the authenticated slot API, so the public page and the
 * staff calendar cannot disagree about what is free.
 *
 * Also drops any slot whose start has already passed, for the same reason and in the
 * same way as `getPublicSlotsForRange`: this is a public endpoint, a patient is
 * choosing a future appointment, and a slot that has already started is never a valid
 * choice. `generateSlots` itself must keep offering those — the authenticated staff
 * path uses it so a receptionist can record a walk-in that happened this morning. `now`
 * is injectable, defaulting to the current time, so the rule is testable without
 * freezing the clock.
 */
export async function getPublicSlots(opts: {
  professionalId: number;
  date: string;
  serviceId: number;
  clinicId?: number;
  now?: Date;
}): Promise<PublicSlot[] | null> {
  const resolved = await resolvePublicServiceMapping(
    opts.professionalId,
    opts.serviceId,
    opts.clinicId,
  );
  if (!resolved) return null;
  const { mapping } = resolved;
  const now = opts.now ?? new Date();

  // Which clinic the slots belong to comes from the mapping: a doctor may work at
  // several, and the service they were asked about says which one this is.
  const slots = await generateSlots(
    opts.professionalId,
    opts.date,
    opts.serviceId,
    Number(mapping.clinicId),
  );

  return slots
    .filter((s) => !isPast(s.date, s.startTime, now))
    .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
}

export interface PublicDaySlots {
  date: string;
  slots: PublicSlot[];
}

/**
 * Local calendar date as `YYYY-MM-DD`. Never via `toISOString()`, which names the
 * previous day on any server running ahead of UTC.
 */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Minutes past local midnight for an instant, the basis the slot maths uses. */
function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Drop slots that have already started.
 *
 * Public only, and deliberately so. A patient is choosing a future appointment, so a
 * slot whose start has passed is never a valid choice. The authenticated staff path
 * (`generateSlots`) must NOT do this: a receptionist recording a walk-in that
 * happened this morning has a legitimate reason to pick a past slot, and hiding
 * those would silently break that workflow.
 *
 * Compared in local clinic time, like everything else here — the slot times are
 * local wall-clock strings and `now` is read through local getters, so no UTC
 * conversion enters the arithmetic. A slot is past when its START is at or before
 * `now`, matching the guard the retired slot generator carried.
 */
function isPast(date: string, startTime: string, now: Date): boolean {
  const today = localDate(now);
  if (date < today) return true;
  if (date > today) return false;
  return toMinutes(startTime) <= localMinutes(now);
}

/**
 * Bookable slots for one professional and service across a date range.
 *
 * Same rules as `getPublicSlots`, in one pass: five queries for a fortnight
 * rather than five per day. The booking page renders two weeks at once, so the
 * per-date version would have issued seventy.
 *
 * `null` means no such active professional, or the service is not one they
 * offer publicly — a 404 either way, distinct from "nothing free" (`slots: []`).
 *
 * `now` is injectable so the past-slot rule can be tested without freezing the
 * clock; it defaults to the current time.
 */
export async function getPublicSlotsForRange(opts: {
  professionalId: number;
  serviceId: number;
  from: string;
  to: string;
  clinicId?: number;
  now?: Date;
}): Promise<PublicDaySlots[] | null> {
  const resolved = await resolvePublicServiceMapping(
    opts.professionalId,
    opts.serviceId,
    opts.clinicId,
  );
  if (!resolved) return null;
  const { mapping } = resolved;

  const doctorId = BigInt(opts.professionalId);
  const clinicId = BigInt(mapping.clinicId);
  const now = opts.now ?? new Date();

  const [sessions, blockedByDate] = await Promise.all([
    listClinicSessions({ clinicId, doctorId }),
    // One collector owns off days, bookings and — from Phase 2 — Google Calendar
    // busy blocks, so this page and the staff calendar cannot disagree.
    collectBlockedRanges({ doctorId: opts.professionalId, from: opts.from, to: opts.to }),
  ]);

  return eachDate(opts.from, opts.to).map((date) => {
    // null is a full-day closure and is not the same answer as `[]`, which is an
    // open day with nothing blocked.
    const blocked = blockedByDate[date];
    if (blocked === null) return { date, slots: [] };

    const day = dayOfWeekFor(date);
    const windows = sessions
      .filter((s) => s.day === day && s.startTime !== null && s.endTime !== null)
      .map((s) => ({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        slotDurationMinutes: s.slotDurationMinutes,
      }));

    const slots = buildDaySlots({
      windows,
      blocked,
      durationMinutes: mapping.durationMinutes ?? undefined,
    });

    return {
      date,
      slots: slots
        .filter((s) => !isPast(date, s.startTime, now))
        .map((s) => ({ date, startTime: s.startTime, endTime: s.endTime })),
    };
  });
}

export interface PublicProfessionalSummary {
  id: number;
  fullName: string;
}

/**
 * Just enough about one professional to head a public page.
 *
 * `listPublicProfessionals` is a directory listing and does far more work than a
 * detail page needs; this is the single-row counterpart. `null` for an unknown or
 * non-ACTIVE professional, so the caller can 404.
 */
export async function getPublicProfessionalSummary(
  professionalId: number,
): Promise<PublicProfessionalSummary | null> {
  const doctor = await findDoctorById(BigInt(professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;
  return { id: Number(doctor.id), fullName: doctor.displayName };
}

/**
 * Enum values the app itself defines. These are PraktiQU concepts with no KiviCare
 * lookup rows, so they stay hard-coded rather than being faked into wp_kc_static_data.
 */
const ENUM_STATIC = {
  gender: ['MALE', 'FEMALE', 'OTHER'],
  professionalType: ['PSIKOLOG_KLINIS', 'PSIKOLOG_ANAK', 'PSIKIATER', 'KONSELOR'],
  serviceType: ['KONSELING', 'ASESMEN', 'WORKSHOP'],
};

export interface StaticDataResponse {
  gender: string[];
  professionalType: string[];
  serviceType: string[];
  dynamic: Record<string, Array<{ label: string; value: string }>>;
}

export async function getPublicStaticData(): Promise<StaticDataResponse> {
  // Only the lookup types a public booking form needs. Returning every type would
  // expose whatever an add-on happens to keep in that shared table.
  const types = [
    STATIC_DATA_TYPE.SPECIALIZATION,
    STATIC_DATA_TYPE.BLOOD_GROUP,
    STATIC_DATA_TYPE.QUALIFICATION,
  ];

  const dynamic: StaticDataResponse['dynamic'] = {};
  for (const type of types) {
    const rows = await listStaticData({ type });
    dynamic[type] = rows.map((r) => ({ label: r.label ?? '', value: r.value ?? '' }));
  }

  return { ...ENUM_STATIC, dynamic };
}

export interface PublicBookingConfig {
  slotHoldTtlMs: number;
  minBookingNoticeMinutes: number;
  maxAdvanceDays: number;
}

export function getPublicBookingConfig(): PublicBookingConfig {
  return {
    slotHoldTtlMs: SLOT_HOLD_TTL_MS,
    minBookingNoticeMinutes: 60,
    maxAdvanceDays: 60,
  };
}

/* ------------------------------------------------------------------ */
/* Rating prompt                                                       */
/* ------------------------------------------------------------------ */

export interface RatingPrompt {
  appointmentId: number;
  professionalName: string;
  service: string;
  canRate: boolean;
  reason: string | null;
}

/**
 * Context a rating widget needs, from a signed appointment token.
 *
 * There is no stored Rating model; `canRate` is derived from the appointment being
 * finished. CHECK_OUT is that state — and now the only one, since COMPLETED was folded
 * into it when the statuses collapsed to KiviCare's five.
 */
export async function getRatingPrompt(token: string): Promise<RatingPrompt | null> {
  const id = verifyAppointmentIdToken(token);
  if (id === null) return null;

  const appt = await getPublicAppointmentById(id);
  if (!appt) return null;

  const finished = appt.status === 'CHECK_OUT';
  return {
    appointmentId: appt.id,
    professionalName: appt.professionalName,
    service: appt.service,
    canRate: finished,
    reason: finished ? null : 'Appointment is not yet completed',
  };
}
