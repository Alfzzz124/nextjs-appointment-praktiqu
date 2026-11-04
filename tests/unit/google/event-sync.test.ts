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
      updateMany: vi.fn(async (args: { data: { appCalendarId?: string } }) => {
        if (connection && args.data.appCalendarId) {
          connection.appCalendarId = args.data.appCalendarId;
        }
        return { count: 1 };
      }),
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
  // Perilaku aslinya: pakai yang tersimpan, buat sekali kalau belum ada.
  getOrCreateAppCalendarId: vi.fn(async (_id: number, create: () => Promise<string>) => {
    const tersimpan = connection?.appCalendarId as string | undefined;
    if (tersimpan) return tersimpan;
    const baru = await create();
    if (connection) connection.appCalendarId = baru;
    return baru;
  }),
}));

type Opts = Record<string, unknown>;
const dibuat = (id: string) => ({ id, htmlLink: null, hangoutLink: null, conferenceError: null });
const createEvent = vi.fn(async (_opts: Opts) => dibuat('evt-new'));
const createAppCalendar = vi.fn(async (_opts: Opts): Promise<string> => 'cal-baru');
const eventLinks = vi.fn(async (_opts: Opts) => ({
  id: 'evt-1', htmlLink: 'https://cal/e/1', hangoutLink: null, conferenceError: null,
}));
const updateEvent = vi.fn(async (_opts: Opts) => dibuat('evt-1'));
const deleteEvent = vi.fn(async (_opts: Opts): Promise<void> => {});

vi.mock('@/lib/google/events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createEvent: (opts: Opts) => createEvent(opts),
  createAppCalendar: (opts: Opts) => createAppCalendar(opts),
  eventLinks: (opts: Opts) => eventLinks(opts),
  updateEvent: (opts: Opts) => updateEvent(opts),
  deleteEvent: (opts: Opts) => deleteEvent(opts),
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
    calendarId: CAL,
    attempts: 0,
    htmlLink: 'https://cal/e/lama',
    ...over,
  };
}

const WRITE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.app.created';
const CAL = 'cal-praktiqu';

beforeEach(() => {
  rows.length = 0;
  updates.length = 0;
  connection = { status: 'active', scopeGranted: WRITE_SCOPE, appCalendarId: CAL };
  createEvent.mockClear().mockResolvedValue(dibuat('evt-new'));
  createAppCalendar.mockClear().mockResolvedValue('cal-baru');
  updateEvent.mockClear().mockResolvedValue(dibuat('evt-1'));
  eventLinks.mockClear();
  deleteEvent.mockClear().mockResolvedValue(undefined);
});

describe('when writing is not switched on', () => {
  it('skips a professional who never granted the write scope', async () => {
    // Not an error and not worth retrying: the read direction may be working
    // perfectly well for this person.
    connection = { status: 'active', scopeGranted: 'openid email', appCalendarId: CAL };
    rows.push(row());

    const report = await runEventSweep({ loader });

    expect(report.skippedNoWriteScope).toBe(1);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('skips a revoked connection', async () => {
    connection = { status: 'revoked', scopeGranted: WRITE_SCOPE, appCalendarId: CAL };
    rows.push(row());

    expect((await runEventSweep({ loader })).skippedNoWriteScope).toBe(1);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('accepts the broad calendar scope a KiviCare-era grant would carry', async () => {
    connection = {
      status: 'active',
      scopeGranted: 'https://www.googleapis.com/auth/calendar',
      appCalendarId: CAL,
    };
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

describe('kalender PraktiQu milik psikolog', () => {
  it('membuatnya sekali ketika belum ada, lalu memakainya', async () => {
    connection = { status: 'active', scopeGranted: WRITE_SCOPE, appCalendarId: null };
    rows.push(row());

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(createAppCalendar).toHaveBeenCalledTimes(1);
    // Acaranya mendarat di kalender yang baru dibuat, bukan di 'primary'.
    expect(createEvent.mock.calls[0][0]).toMatchObject({ calendarId: 'cal-baru' });
    expect(updates[0].data).toMatchObject({ calendarId: 'cal-baru' });
  });

  it('tidak membuat kalender kedua ketika sudah punya', async () => {
    // Membuat ulang tiap putaran akan memenuhi akun orang dengan kalender
    // "PraktiQu" berduplikat.
    rows.push(row());

    await runEventSweep({ loader });

    expect(createAppCalendar).not.toHaveBeenCalled();
    expect(createEvent.mock.calls[0][0]).toMatchObject({ calendarId: CAL });
  });

  it('memindahkan acara yang tertinggal di kalender lama', async () => {
    // Terjadi kalau seseorang memutus lalu menyambung lagi: kalendernya baru,
    // sementara baris lama masih menunjuk yang lama. Tanpa penghapusan ini,
    // janji yang sama muncul dua kali — satu di kalender basi, satu di yang baru.
    rows.push(row({ calendarId: 'cal-lama', googleEventId: 'evt-1', syncedHash: 'a'.repeat(64) }));

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(deleteEvent.mock.calls[0][0]).toMatchObject({
      calendarId: 'cal-lama',
      eventId: 'evt-1',
    });
    expect(createEvent.mock.calls[0][0]).toMatchObject({ calendarId: CAL });
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('tetap membuat penggantinya walau acara lama sudah lenyap', async () => {
    deleteEvent.mockRejectedValueOnce(new GoogleEventGoneError('gone'));
    rows.push(row({ calendarId: 'cal-lama', googleEventId: 'evt-1', syncedHash: 'a'.repeat(64) }));

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('menghapus dari kalender tempat acaranya benar-benar berada', async () => {
    // Pembatalan harus menyasar kalender yang tercatat pada barisnya, bukan
    // kalender tujuan hari ini.
    rows.push(row({ desiredState: 'absent', calendarId: 'cal-lama', googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader })).deleted).toBe(1);
    expect(deleteEvent.mock.calls[0][0]).toMatchObject({ calendarId: 'cal-lama' });
  });
});

describe('menyimpan tautan acara', () => {
  it('menyimpan tautan dari jalur PEMBUATAN', async () => {
    createEvent.mockResolvedValueOnce({
      id: 'evt-new', htmlLink: 'https://cal/e/9', hangoutLink: 'https://meet.google.com/x', conferenceError: null,
    });
    rows.push(row({ googleEventId: null, syncedHash: null, htmlLink: null }));

    await runEventSweep({ loader });

    expect(updates[0].data).toMatchObject({
      htmlLink: 'https://cal/e/9',
      hangoutLink: 'https://meet.google.com/x',
    });
  });

  it('menyimpan tautan dari jalur PEMBARUAN juga', async () => {
    // Versi pertama hanya menyimpannya saat membuat, jadi acara yang sampai ke
    // Google lewat pembaruan menyimpan NULL — tautannya ada, persis di tempat
    // yang tidak bisa dilihat siapa pun.
    updateEvent.mockResolvedValueOnce({
      id: 'evt-1', htmlLink: 'https://cal/e/1', hangoutLink: 'https://meet.google.com/y', conferenceError: null,
    });
    rows.push(row({ googleEventId: 'evt-1', syncedHash: 'a'.repeat(64) }));

    expect((await runEventSweep({ loader })).updated).toBe(1);
    expect(updates[0].data).toMatchObject({ hangoutLink: 'https://meet.google.com/y' });
  });

  it('mengisi tautan yang hilang pada baris yang isinya tidak berubah', async () => {
    // Baris lama yang ditulis sebelum kolomnya ada. Isinya cocok, jadi tidak ada
    // yang pernah membacanya ulang — tanpa ini ia kosong selamanya.
    const hash = fingerprintEvent(buildEventBody(APPT));
    rows.push(row({ googleEventId: 'evt-1', syncedHash: hash, htmlLink: null }));

    expect((await runEventSweep({ loader })).alreadyCurrent).toBe(1);
    expect(eventLinks).toHaveBeenCalledTimes(1);
    expect(updates[0].data).toMatchObject({ htmlLink: 'https://cal/e/1' });
  });

  it('tidak membaca ulang baris yang tautannya sudah ada', async () => {
    const hash = fingerprintEvent(buildEventBody(APPT));
    rows.push(row({ googleEventId: 'evt-1', syncedHash: hash }));

    await runEventSweep({ loader });

    expect(eventLinks).not.toHaveBeenCalled();
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
