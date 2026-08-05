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
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { PROFESSIONAL_STATUS, findDoctorById, listDoctors } from '@/repositories/wp/doctors.repo';
import { STATIC_DATA_TYPE, listStaticData } from '@/repositories/wp/static-data.repo';
import { listClinicSessions } from '@/repositories/wp/clinic-sessions.repo';
import { dayOfWeekFor, generateSlots } from '@/services/professional/availability.service';

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
 * Bookable slots for one professional, service and date.
 *
 * `null` means there is no such active professional, or the service is not one they
 * offer publicly — a 404 either way, distinct from "no slots that day" (`[]`).
 *
 * Unlike the previous implementation this subtracts real bookings and off days: it
 * shares `generateSlots` with the authenticated slot API, so the public page and the
 * staff calendar cannot disagree about what is free.
 */
export async function getPublicSlots(opts: {
  professionalId: number;
  date: string;
  serviceId: number;
  clinicId?: number;
}): Promise<PublicSlot[] | null> {
  const doctor = await findDoctorById(BigInt(opts.professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;

  const offered = await listServicesForDoctor({
    doctorId: BigInt(opts.professionalId),
    clinicId: opts.clinicId !== undefined ? BigInt(opts.clinicId) : undefined,
    publicOnly: true,
  });
  const mapping = offered.find((s) => Number(s.serviceId) === opts.serviceId && s.isActive);
  if (!mapping) return null;

  // Which clinic the slots belong to comes from the mapping: a doctor may work at
  // several, and the service they were asked about says which one this is.
  const slots = await generateSlots(
    opts.professionalId,
    opts.date,
    opts.serviceId,
    Number(mapping.clinicId),
  );

  return slots.map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));
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
