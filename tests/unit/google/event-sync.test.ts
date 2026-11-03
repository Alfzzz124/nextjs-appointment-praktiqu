/**
 * The sweep that actually moves appointments into Google.
 *
 * What these tests pin down is the decision-making, not the HTTP: when to skip a
 * row entirely, when a status change costs no request at all, and what to do when
 * the psychologist has deleted our event by hand. The Google client itself is
 * mocked — its own behaviour is covered in events.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
let connection: Record<string, unknown> | null = null;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    googleCalendarEventSync: {
      fields: { syncedHash: Symbol('syncedHash') },
      findMany: vi.fn(async () => rows),
      update: vi.fn(async (args: { where: unknown; data: unknown }) => {
        updates.push({ where: args.where, data: args.data });
        return {};
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    googleCalendarConnection: {
      findUnique: vi.fn(async () => connection),
      findMany: vi.fn(async () => []),
    },
    kcAppointment: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/google/config', () => ({
  googleOAuthConfig: () => ({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x/cb' }),
  GoogleConfigError: class extends Error {},
}));

vi.mock('@/lib/google/freebusy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshAccessToken: vi.fn(async () => 'access-token'),
}));

vi.mock('@/services/integrations/google-calendar-connection.service', () => ({
  getRefreshToken: vi.fn(async () => 'refresh-token'),
  markConnection: vi.fn(async () => {}),
}));

const createEvent = vi.fn(async () => 'evt-new');
const updateEvent = vi.fn(async () => {});
const deleteEvent = vi.fn(async () => {});

vi.mock('@/lib/google/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createEvent: (...a: unknown[]) => createEvent(...(a as [])),
  updateEvent: (...a: unknown[]) => updateEvent(...(a as [])),
  deleteEvent: (...a: unknown[]) => deleteEvent(...(a as [])),
}));

const { runEventSweep, DIRTY } = await import('@/services/integrations/google-event-sync.service');
const { buildEventBody, fingerprintEvent } = await import(
  '@/services/integrations/google-event-payload'
);
const { GoogleEventGoneError } = await import('@/lib/google/events');

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

const loader = async () => new Map([[4821, APPT]]);

function row(over: Record<string, unknown> = {}) {
  return {
    appointmentId: 4821n,
    professionalId: 29n,
    desiredState: 'present',
    desiredHash: DIRTY,
    syncedHash: null,
    googleEventId: null,
    calendarId: 'primary',
    attempts: 0,
    ...over,
  };
}

const WRITE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';

beforeEach(() => {
  rows.length = 0;
  updates.length = 0;
  connection = { status: 'active', scopeGranted: WRITE_SCOPE };
  createEvent.mockClear().mockResolvedValue('evt-new');
  updateEvent.mockClear().mockResolvedValue(undefined);
  deleteEvent.mockClear().mockResolvedValue(undefined);
});

describe('when writing is not switched on', () => {
  it('skips a professional who never granted the write scope', async () => {
    // Not an error and not worth retrying: the read direction may be working
    // perfectly well for this person.
    connection = { status: 'active', scopeGranted: 'openid email' };
    rows.push(row());

    const report = await runEventSweep({ loader });

    expect(report.skippedNoWriteScope).toBe(1);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('skips a revoked connection', async () => {
    connection = { status: 'revoked', scopeGranted: WRITE_SCOPE };
    rows.push(row());

    expect((await runEventSweep({ loader })).skippedNoWriteScope).toBe(1);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('accepts the broad calendar scope a KiviCare-era grant would carry', async () => {
    connection = { status: 'active', scopeGranted: 'https://www.googleapis.com/auth/calendar' };
    rows.push(row());

    expect((await runEventSweep({ loader })).created).toBe(1);
  });
});

describe('creating and updating', () => {
  it('creates an event and records the id Google gave back', async () => {
    rows.push(row());

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(updates[0].data).toMatchObject({ googleEventId: 'evt-new', attempts: 0 });
  });

  it('spends no request when nothing about the event changed', async () => {
    // A BOOKED → CHECK_IN flip marks the row dirty but changes no event field.
    const hash = fingerprintEvent(buildEventBody(APPT));
    rows.push(row({ syncedHash: hash, googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).alreadyCurrent).toBe(1);
    expect(createEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('updates in place when the appointment moved', async () => {
    rows.push(row({ syncedHash: 'a'.repeat(64), googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).updated).toBe(1);
    expect(updateEvent).toHaveBeenCalledTimes(1);
    // The marker is what keeps us off somebody else's event.
    expect(updateEvent.mock.calls[0][0]).toMatchObject({ expectMarker: '4821' });
  });

  it('recreates an event the psychologist deleted by hand', async () => {
    updateEvent.mockRejectedValueOnce(new GoogleEventGoneError('gone'));
    rows.push(row({ syncedHash: 'a'.repeat(64), googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
});

describe('removing', () => {
  it('deletes the event when the appointment is cancelled', async () => {
    rows.push(row({ desiredState: 'absent', googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).deleted).toBe(1);
    expect(deleteEvent.mock.calls[0][0]).toMatchObject({ expectMarker: '4821' });
    expect(updates[0].data).toMatchObject({ googleEventId: null });
  });

  it('settles without a request when there was never an event', async () => {
    rows.push(row({ desiredState: 'absent', googleEventId: null }));

    expect((await runEventSweep({ loader })).alreadyCurrent).toBe(1);
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('counts an already-deleted event as done', async () => {
    deleteEvent.mockRejectedValueOnce(new GoogleEventGoneError('gone'));
    rows.push(row({ desiredState: 'absent', googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).deleted).toBe(1);
  });
});

describe('when the appointment cannot be loaded', () => {
  it('backs off instead of deleting the event', async () => {
    // Conflating "row vanished" with "row has a broken end time" would quietly
    // remove real events over bad data.
    rows.push(row({ googleEventId: 'evt-1', syncedHash: 'a'.repeat(64) }));

    const report = await runEventSweep({ loader: async () => new Map() });

    expect(report.failed).toBe(1);
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(updates[0].data).toMatchObject({ lastError: 'appointment details unavailable' });
  });
});
