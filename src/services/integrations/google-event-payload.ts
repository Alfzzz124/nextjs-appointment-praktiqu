// Turning an appointment into the Google Calendar event it should become.
//
// Pure: no database, no network, no clock. Everything here is decided by its
// arguments, which is what makes the awkward parts — timezone, implausible
// addresses, what counts as "should exist" — testable without a fixture.

import { createHash } from 'node:crypto';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { MARKER_KEY, type GoogleEventBody } from '@/lib/google/events';

/**
 * The clinic's wall-clock zone.
 *
 * Hardcoded, and not `process.env.TZ`. The application's own zone is UTC — correct
 * for storing, wrong for handing to Google: send 14:00 labelled UTC and the
 * psychologist sees a 21:00 appointment and reasonably concludes the system is
 * broken. Every user of this application is in Indonesia; if a practice in WITA or
 * WIT ever appears, the zone has to be carried from the practice record rather
 * than guessed here.
 */
export const CLINIC_TIME_ZONE = 'Asia/Jakarta';

export interface AppointmentForCalendar {
  appointmentId: number;
  /** Local clinic date, `YYYY-MM-DD`. Never derived via toISOString(). */
  date: string;
  /** Local clinic time, `HH:MM:SS`. */
  startTime: string;
  endTime: string;
  serviceName: string;
  clientName: string;
  clinicName?: string | null;
  clientEmail?: string | null;
  professionalEmail?: string | null;
  /**
   * Service is flagged `telemed_service = 'yes'`: the session happens online, so
   * the event asks Google for a Meet link.
   *
   * KiviCare's own Meet add-on used to do this and stopped on 3 August 2026, so
   * every online session since then has gone out with no meeting link at all.
   */
  isTelemed?: boolean;
}

/**
 * Addresses that exist in the data but cannot receive mail.
 *
 * Roughly seventy accounts carry `@example.com` from old probe bookings, and
 * `example.com` is reserved by RFC 2606 precisely so it never resolves. Inviting
 * one produces a bounce for the professional and nothing for anyone else, so such
 * attendees are dropped while the event itself is still created.
 */
export function isSendableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length < 6 || !trimmed.includes('@')) return false;
  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1);
  if (!domain.includes('.')) return false;
  // RFC 2606 reserved names, plus the localhost domain.
  return !/(^|\.)(example\.(com|org|net)|test|invalid|localhost)$/.test(domain);
}

/**
 * Appointment statuses whose event should exist in Google.
 *
 * PENDING is deliberately absent: the product decision was that only settled
 * appointments reach a calendar, so nobody is invited to something that is later
 * refused. CHECK_OUT stays present — a visit that happened is a reasonable thing
 * to keep in one's calendar.
 */
export function desiredStateFor(status: number): 'present' | 'absent' {
  switch (status) {
    case APPOINTMENT_STATUS.BOOKED:
    case APPOINTMENT_STATUS.CHECK_IN:
    case APPOINTMENT_STATUS.CHECK_OUT:
      return 'present';
    default:
      return 'absent';
  }
}

export function buildEventBody(appt: AppointmentForCalendar): GoogleEventBody {
  const attendees: { email: string }[] = [];
  // The professional first: it is their calendar, and an attendee list that omits
  // the owner reads oddly in every client that shows one.
  if (isSendableEmail(appt.professionalEmail)) {
    attendees.push({ email: appt.professionalEmail!.trim() });
  }
  if (isSendableEmail(appt.clientEmail)) {
    attendees.push({ email: appt.clientEmail!.trim() });
  }

  const descriptionLines = [
    appt.clinicName ? `Klinik: ${appt.clinicName}` : null,
    `Layanan: ${appt.serviceName}`,
    `Nomor janji: ${appt.appointmentId}`,
    '',
    'Dibuat otomatis oleh PraktiQu. Mengubah acara ini di Google Calendar tidak',
    'mengubah jadwal di PraktiQu.',
  ].filter((l): l is string => l !== null);

  // Stable per appointment, NOT random: Google treats requestId as the
  // idempotency key for the conference. A fresh one on every sync would ask for a
  // new Meet link each time the event is updated, and the link the client already
  // has would stop being the one in the invitation.
  const conferenceData = appt.isTelemed
    ? {
        createRequest: {
          requestId: `praktiqu-${appt.appointmentId}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' as const },
        },
      }
    : undefined;

  return {
    summary: `${appt.serviceName} — ${appt.clientName}`,
    description: descriptionLines.join('\n'),
    start: { dateTime: `${appt.date}T${appt.startTime}`, timeZone: CLINIC_TIME_ZONE },
    end: { dateTime: `${appt.date}T${appt.endTime}`, timeZone: CLINIC_TIME_ZONE },
    attendees,
    extendedProperties: { private: { [MARKER_KEY]: String(appt.appointmentId) } },
    ...(conferenceData ? { conferenceData } : {}),
  };
}

/**
 * A fingerprint of what we want Google to hold.
 *
 * Compared against the fingerprint of what last landed there, so an appointment
 * whose details did not change costs no request at all. Keys are sorted so that a
 * reordering in the builder does not read as a change and re-push every event in
 * the system.
 */
export function fingerprintEvent(body: GoogleEventBody): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** The fingerprint for an appointment that should NOT be in Google at all. */
export const ABSENT_FINGERPRINT = createHash('sha256').update('absent').digest('hex');
