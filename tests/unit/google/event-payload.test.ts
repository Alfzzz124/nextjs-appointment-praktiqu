/**
 * Turning an appointment into the event Google should hold.
 *
 * Pure throughout, so the awkward parts are testable without a database: which
 * statuses belong on a calendar at all, which addresses can actually receive an
 * invitation, and the timezone — the one mistake here that produces a confident,
 * wrong answer rather than an error.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEventBody,
  fingerprintEvent,
  desiredStateFor,
  isSendableEmail,
  CLINIC_TIME_ZONE,
  ABSENT_FINGERPRINT,
} from '@/services/integrations/google-event-payload';
import { MARKER_KEY } from '@/lib/google/events';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const APPT = {
  appointmentId: 4821,
  date: '2026-11-04',
  startTime: '14:00:00',
  endTime: '15:00:00',
  serviceName: 'Konseling Individu',
  clientName: 'Rina Pratiwi',
  clinicName: 'Klinik Terpadu',
  clientEmail: 'rina@gmail.com',
  professionalEmail: 'dianda@gmail.com',
};

describe('desiredStateFor', () => {
  it('puts settled appointments on the calendar', () => {
    expect(desiredStateFor(APPOINTMENT_STATUS.BOOKED)).toBe('present');
    expect(desiredStateFor(APPOINTMENT_STATUS.CHECK_IN)).toBe('present');
    // A visit that happened is a reasonable thing to keep in one's calendar.
    expect(desiredStateFor(APPOINTMENT_STATUS.CHECK_OUT)).toBe('present');
  });

  it('keeps PENDING off the calendar entirely', () => {
    // The product decision: nobody is invited to something that is later refused.
    expect(desiredStateFor(APPOINTMENT_STATUS.PENDING)).toBe('absent');
  });

  it('removes a cancelled appointment', () => {
    expect(desiredStateFor(APPOINTMENT_STATUS.CANCELLED)).toBe('absent');
  });

  it('treats an unknown status as absent rather than guessing', () => {
    expect(desiredStateFor(99)).toBe('absent');
  });
});

describe('isSendableEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isSendableEmail('rina@gmail.com')).toBe(true);
    expect(isSendableEmail('  Rina@Example-Clinic.co.id ')).toBe(true);
  });

  it('rejects the reserved domains that test data is full of', () => {
    // Roughly seventy accounts carry these from old probe bookings. RFC 2606
    // reserves them precisely so they never resolve.
    expect(isSendableEmail('probe@example.com')).toBe(false);
    expect(isSendableEmail('probe@example.org')).toBe(false);
    expect(isSendableEmail('someone@test')).toBe(false);
    expect(isSendableEmail('someone@localhost')).toBe(false);
  });

  it('rejects what is not an address at all', () => {
    expect(isSendableEmail(null)).toBe(false);
    expect(isSendableEmail('')).toBe(false);
    expect(isSendableEmail('rina')).toBe(false);
    expect(isSendableEmail('rina@nodot')).toBe(false);
  });
});

describe('buildEventBody', () => {
  it('names the service and the client', () => {
    expect(buildEventBody(APPT).summary).toBe('Konseling Individu — Rina Pratiwi');
  });

  it('sends local wall time with the clinic zone, never a UTC instant', () => {
    const body = buildEventBody(APPT);
    // The failure this guards against is silent: send 14:00 labelled UTC and the
    // psychologist sees 21:00 and concludes the system is broken.
    expect(body.start).toEqual({ dateTime: '2026-11-04T14:00:00', timeZone: CLINIC_TIME_ZONE });
    expect(body.end).toEqual({ dateTime: '2026-11-04T15:00:00', timeZone: CLINIC_TIME_ZONE });
    expect(CLINIC_TIME_ZONE).toBe('Asia/Jakarta');
  });

  it('invites the professional and the client', () => {
    expect(buildEventBody(APPT).attendees).toEqual([
      { email: 'dianda@gmail.com' },
      { email: 'rina@gmail.com' },
    ]);
  });

  it('still creates the event when the client address cannot receive mail', () => {
    const body = buildEventBody({ ...APPT, clientEmail: 'probe@example.com' });
    expect(body.attendees).toEqual([{ email: 'dianda@gmail.com' }]);
    expect(body.summary).toContain('Rina Pratiwi');
  });

  it('carries the marker that identifies the event as ours', () => {
    // The single most important field in the body: with calendar.events we hold
    // write access to a real calendar, and this is the only thing separating our
    // events from the psychologist's own.
    expect(buildEventBody(APPT).extendedProperties.private[MARKER_KEY]).toBe('4821');
  });

  it('omits the clinic line when there is no clinic name', () => {
    const body = buildEventBody({ ...APPT, clinicName: null });
    expect(body.description).not.toContain('Klinik:');
    expect(body.description).toContain('Layanan: Konseling Individu');
  });
});

describe('fingerprintEvent', () => {
  it('is stable across runs for identical content', () => {
    expect(fingerprintEvent(buildEventBody(APPT))).toBe(fingerprintEvent(buildEventBody(APPT)));
  });

  it('changes when the time changes', () => {
    const a = fingerprintEvent(buildEventBody(APPT));
    const b = fingerprintEvent(buildEventBody({ ...APPT, startTime: '15:00:00' }));
    expect(a).not.toBe(b);
  });

  it('changes when an attendee is dropped', () => {
    const a = fingerprintEvent(buildEventBody(APPT));
    const b = fingerprintEvent(buildEventBody({ ...APPT, clientEmail: null }));
    expect(a).not.toBe(b);
  });

  it('ignores key order, so reordering the builder re-pushes nothing', () => {
    const body = buildEventBody(APPT);
    const shuffled = Object.fromEntries(
      Object.entries(body).reverse(),
    ) as typeof body;
    expect(fingerprintEvent(shuffled)).toBe(fingerprintEvent(body));
  });

  it('never collides with the absent marker', () => {
    expect(fingerprintEvent(buildEventBody(APPT))).not.toBe(ABSENT_FINGERPRINT);
  });
});

describe('sesi online', () => {
  it('meminta Meet hanya ketika layanannya online', () => {
    expect(buildEventBody({ ...APPT, isTelemed: true }).conferenceData).toMatchObject({
      createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } },
    });
    expect(buildEventBody(APPT).conferenceData).toBeUndefined();
    expect(buildEventBody({ ...APPT, isTelemed: false }).conferenceData).toBeUndefined();
  });

  it('memakai requestId yang tetap per janji, bukan acak', () => {
    // Google memperlakukan requestId sebagai kunci idempotensi. Kalau berubah
    // tiap sinkron, setiap pembaruan akan meminta Meet baru dan tautan yang
    // sudah dipegang klien berhenti jadi tautan yang benar.
    const a = buildEventBody({ ...APPT, isTelemed: true }).conferenceData?.createRequest.requestId;
    const b = buildEventBody({ ...APPT, isTelemed: true }).conferenceData?.createRequest.requestId;
    expect(a).toBe(b);
    expect(a).toContain('4821');
  });

  it('sidik jarinya berubah saat layanan berubah jadi online', () => {
    // Kalau tidak, janji yang diubah jadi sesi online tidak akan pernah
    // disinkronkan ulang dan selamanya tanpa tautan rapat.
    expect(fingerprintEvent(buildEventBody({ ...APPT, isTelemed: true })))
      .not.toBe(fingerprintEvent(buildEventBody(APPT)));
  });
});
