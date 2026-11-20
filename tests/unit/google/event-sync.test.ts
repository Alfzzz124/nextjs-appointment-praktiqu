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
      // Menghormati `professionalId: { in }` dan `take` seperti MySQL: tanpa itu
      // uji antrean yang tersumbat tidak punya cara untuk gagal.
      findMany: vi.fn(
        async (args?: { where?: { professionalId?: { in?: bigint[] } }; take?: number }) => {
          const boleh = args?.where?.professionalId?.in?.map(String);
          const cocok = boleh ? rows.filter((r) => boleh.includes(String(r.professionalId))) : rows;
          return args?.take ? cocok.slice(0, args.take) : cocok;
        },
      ),
      count: vi.fn(async (args?: { where?: { professionalId?: { notIn?: bigint[] } } }) => {
        const tolak = args?.where?.professionalId?.notIn?.map(String);
        return tolak ? rows.filter((r) => !tolak.includes(String(r.professionalId))).length : rows.length;
      }),
      update: vi.fn(async (args: { where: unknown; data: unknown }) => {
        updates.push({ where: args.where, data: args.data });
        return {};
      }),
      createMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    googleCalendarConnection: {
      // Hanya psikolog 29 yang punya sambungan di uji ini; yang lain tidak.
      findUnique: vi.fn(async (args: { where: { professionalId: bigint } }) =>
        args.where.professionalId === 29n ? connection : null,
      ),
      findMany: vi.fn(async () => (connection ? [{ professionalId: 29n, ...connection }] : [])),
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
  // Bersyarat pada id yang gagal, seperti aslinya.
  forgetAppCalendarId: vi.fn(async (_id: number, calendarId: string) => {
    if (connection?.appCalendarId === calendarId) connection.appCalendarId = null;
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
const { GoogleEventGoneError, GoogleTransientError } = await import('@/lib/google/events');
const { GoogleAuthRevokedError } = await import('@/lib/google/freebusy');
const { GoogleOAuthError } = await import('@/lib/google/oauth-client');
const connectionService = await import(
  '@/services/integrations/google-calendar-connection.service'
);
const markConnection = vi.mocked(connectionService.markConnection);
const forgetAppCalendarId = vi.mocked(connectionService.forgetAppCalendarId);

const { APPOINTMENT_STATUS } = await import('@/repositories/wp/appointments.repo');

const APPT = {
  status: APPOINTMENT_STATUS.BOOKED,
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
/** Janji yang sama, sudah dibatalkan. */
const loaderBatal = async () =>
  new Map([[4821, { ...APPT, status: APPOINTMENT_STATUS.CANCELLED }]]);

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
  // Janji uji (2026-11-04) harus masih di depan: sapuan tidak membuat acara untuk
  // janji yang sudah lewat. Uji yang memang butuh "sudah lewat" memberi `now` sendiri.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T03:00:00Z'));
  rows.length = 0;
  updates.length = 0;
  connection = { status: 'active', scopeGranted: WRITE_SCOPE, appCalendarId: CAL };
  createEvent.mockClear().mockResolvedValue(dibuat('evt-new'));
  createAppCalendar.mockClear().mockResolvedValue('cal-baru');
  updateEvent.mockClear().mockResolvedValue(dibuat('evt-1'));
  eventLinks.mockClear();
  deleteEvent.mockClear().mockResolvedValue(undefined);
  markConnection.mockClear();
  forgetAppCalendarId.mockClear();
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

    expect((await runEventSweep({ loader: loaderBatal })).deleted).toBe(1);
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

    expect((await runEventSweep({ loader: loaderBatal })).deleted).toBe(1);
    expect(deleteEvent.mock.calls[0][0]).toMatchObject({ expectMarker: '4821' });
    expect(updates[0].data).toMatchObject({ googleEventId: null });
  });

  it('settles without a request when there was never an event', async () => {
    rows.push(row({ desiredState: 'absent', googleEventId: null }));

    expect((await runEventSweep({ loader: loaderBatal })).alreadyCurrent).toBe(1);
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('counts an already-deleted event as done', async () => {
    deleteEvent.mockRejectedValueOnce(new GoogleEventGoneError('gone'));
    rows.push(row({ desiredState: 'absent', googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader: loaderBatal })).deleted).toBe(1);
  });
});

describe('status janji dibaca langsung, bukan dari niat yang tercatat', () => {
  // Niat dicatat oleh jalur tulis kita sendiri. Janji bisa dibatalkan lewat jalur
  // yang tidak mencatat apa pun (dasbor KiviCare, pembatalan order WooCommerce),
  // dan kejadian sungguhan 10 Nov 2026: janji 3397 sudah batal, barisnya masih
  // 'present'. Tanpa membaca ulang status, klien janji yang sudah batal menerima
  // undangan kalender.

  it('tidak membuat acara untuk janji yang ternyata sudah batal', async () => {
    rows.push(row({ desiredState: 'present', googleEventId: null }));

    const report = await runEventSweep({ loader: loaderBatal });

    expect(createEvent).not.toHaveBeenCalled();
    expect(report.alreadyCurrent).toBe(1);
    // Niatnya ikut dibetulkan, supaya rekonsiliasi berikutnya tidak membaliknya lagi.
    expect(updates[0].data).toMatchObject({ desiredState: 'absent', googleEventId: null });
  });

  it('menghapus acara janji yang dibatalkan lewat jalur lain', async () => {
    rows.push(row({ desiredState: 'present', googleEventId: 'evt-1', syncedHash: 'a'.repeat(64) }));

    expect((await runEventSweep({ loader: loaderBatal })).deleted).toBe(1);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(deleteEvent.mock.calls[0][0]).toMatchObject({ eventId: 'evt-1', expectMarker: '4821' });
    expect(updates[0].data).toMatchObject({ desiredState: 'absent', googleEventId: null });
  });

  it('membuat acara bila niatnya absent tapi janjinya ternyata sudah pasti', async () => {
    rows.push(row({ desiredState: 'absent', googleEventId: null }));

    expect((await runEventSweep({ loader })).created).toBe(1);
    expect(updates[0].data).toMatchObject({ desiredState: 'present', googleEventId: 'evt-new' });
  });

  it('tetap menghapus acara yang janjinya sudah tidak ada sama sekali', async () => {
    // Tanpa baris janji, niat yang tercatat satu-satunya pegangan.
    rows.push(row({ desiredState: 'absent', googleEventId: 'evt-1' }));

    expect((await runEventSweep({ loader: async () => new Map() })).deleted).toBe(1);
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

describe('penolakan Google tidak otomatis berarti izin dicabut', () => {
  // Kejadian 10 Nov 2026: sambungan psikolog 34 jatuh ke "revoked". Setiap 403
  // dibaca sebagai pencabutan, padahal Google memakai 403 juga untuk kuota dan
  // untuk penolakan per acara.
  const APPT2 = { ...APPT, appointmentId: 4822 };
  const dua = async () =>
    new Map([
      [4821, APPT],
      [4822, APPT2],
    ]);
  const baris2 = () => row({ appointmentId: 4822n });

  it('batas pemakaian: sambungan dan token tidak disentuh, barisnya diundur', async () => {
    createEvent.mockRejectedValueOnce(
      new GoogleTransientError('create event hit a Google usage limit (403: rateLimitExceeded)'),
    );
    rows.push(row());

    const report = await runEventSweep({ loader });

    expect(report.failed).toBe(1);
    expect(markConnection).not.toHaveBeenCalled();
    expect(updates[0].data).toMatchObject({ lastError: expect.stringContaining('rateLimitExceeded') });
  });

  it('403 per acara hanya menggagalkan barisnya, yang lain tetap jalan', async () => {
    createEvent.mockRejectedValueOnce(
      new GoogleOAuthError('create event was refused (403: forbiddenForNonOrganizer)'),
    );
    rows.push(row(), baris2());

    const report = await runEventSweep({ loader: dua });

    expect(report).toMatchObject({ failed: 1, created: 1 });
    expect(markConnection).not.toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledTimes(2);
  });

  it('401: sambungan dicabut dan alasannya ikut disimpan', async () => {
    createEvent.mockRejectedValueOnce(
      new GoogleAuthRevokedError('Google rejected the access token (401)'),
    );
    rows.push(row(), baris2());

    const report = await runEventSweep({ loader: dua });

    expect(markConnection).toHaveBeenCalledWith(29, {
      status: 'revoked',
      reason: 'Google rejected the access token (401)',
    });
    // Token mati: tidak ada gunanya mencoba baris berikutnya.
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(report.failed).toBe(1);
  });

  it('403 saat membuat kalender PraktiQu: tidak dicabut, alasannya tercatat di baris', async () => {
    connection = { status: 'active', scopeGranted: WRITE_SCOPE, appCalendarId: null };
    createAppCalendar.mockRejectedValueOnce(
      new GoogleOAuthError('create calendar was refused (403: insufficientPermissions)'),
    );
    rows.push(row());

    const report = await runEventSweep({ loader });

    expect(report.failed).toBe(1);
    expect(markConnection).not.toHaveBeenCalled();
    expect(updates[0].data).toMatchObject({
      lastError: expect.stringContaining('insufficientPermissions'),
    });
  });

  it('refresh token ditolak (invalid_grant): dicabut dengan alasannya', async () => {
    const { refreshAccessToken } = await import('@/lib/google/freebusy');
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(
      new GoogleAuthRevokedError('Google authorisation is no longer valid'),
    );
    rows.push(row());

    await runEventSweep({ loader });

    expect(markConnection).toHaveBeenCalledWith(29, {
      status: 'revoked',
      reason: 'Google authorisation is no longer valid',
    });
  });
});

describe('kalender PraktiQu yang dihapus psikolognya', () => {
  // Layar FE bilang boleh menghapusnya. Id yang tersimpan lalu dijawab 404
  // selamanya: createEvent ada di luar try/catch, barisnya diundur terus, dan
  // layar tetap hijau.
  const APPT2 = { ...APPT, appointmentId: 4822 };
  const dua = async () =>
    new Map([
      [4821, APPT],
      [4822, APPT2],
    ]);

  it('melupakan kalendernya, menyerahkan pembuatan ulang ke sapuan berikutnya', async () => {
    createEvent.mockRejectedValueOnce(new GoogleEventGoneError('create event: event not found (404)'));
    rows.push(row(), row({ appointmentId: 4822n }));

    const report = await runEventSweep({ loader: dua });

    expect(forgetAppCalendarId).toHaveBeenCalledWith(29, CAL);
    // Baris yang kena hanya diundur sebentar, dan sambungannya tidak dicabut.
    expect(report.failed).toBe(1);
    expect(markConnection).not.toHaveBeenCalled();
    const undur = new Date((updates[0].data as { nextAttemptAt: Date }).nextAttemptAt).getTime() - Date.now();
    expect(undur).toBeLessThanOrEqual(2 * 60_000);
    // Tidak menembak baris lain ke kalender yang sudah pasti mati.
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('acara berikutnya masuk ke kalender yang baru', async () => {
    createEvent.mockRejectedValueOnce(new GoogleEventGoneError('create event: event not found (404)'));
    rows.push(row());
    await runEventSweep({ loader });

    // Sapuan berikutnya: id lama sudah dilupakan, jadi dibuatkan yang baru.
    expect(connection?.appCalendarId).toBeNull();
    createEvent.mockClear();
    await runEventSweep({ loader });

    expect(createAppCalendar).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0]).toMatchObject({ calendarId: 'cal-baru' });
  });

  it('tidak melupakan kalender yang baru saja dibuat di putaran yang sama', async () => {
    // Tanpa pagar ini, kalender yang 404 sesaat setelah dibuat dilupakan dan
    // dibuat lagi tiap sapuan: akun psikolog dipenuhi kalender "PraktiQu".
    connection = { status: 'active', scopeGranted: WRITE_SCOPE, appCalendarId: null };
    createEvent.mockRejectedValueOnce(new GoogleEventGoneError('create event: event not found (404)'));
    rows.push(row());

    const report = await runEventSweep({ loader });

    expect(createAppCalendar).toHaveBeenCalledTimes(1);
    expect(forgetAppCalendarId).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
  });

  it('memperbarui acara di kalender yang hilang berujung pada pembuatan ulang, bukan macet', async () => {
    // updateEvent → 404 → dibuat ulang → 404 lagi karena kalendernya yang hilang.
    updateEvent.mockRejectedValueOnce(new GoogleEventGoneError('read event: event not found (404)'));
    createEvent.mockRejectedValueOnce(new GoogleEventGoneError('create event: event not found (404)'));
    rows.push(row({ syncedHash: 'a'.repeat(64), googleEventId: 'evt-1' }));

    await runEventSweep({ loader });

    expect(forgetAppCalendarId).toHaveBeenCalledWith(29, CAL);
  });

  it('membuat ulang acara yang tautannya hilang bila acaranya ternyata lenyap', async () => {
    // Jalur "isi tautan yang kosong": acaranya ikut hilang bersama kalendernya,
    // dan GET-nya dulu keluar dari syncOne sebagai galat — diundur selamanya.
    const hash = fingerprintEvent(buildEventBody(APPT));
    eventLinks.mockRejectedValueOnce(new GoogleEventGoneError('read event: event not found (404)'));
    updateEvent.mockRejectedValueOnce(new GoogleEventGoneError('read event: event not found (404)'));
    rows.push(row({ googleEventId: 'evt-1', syncedHash: hash, htmlLink: null }));

    const report = await runEventSweep({ loader });

    expect(report.created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
});

describe('antrean tidak boleh tersumbat baris psikolog tanpa izin tulis', () => {
  const NOW = new Date('2026-11-03T03:00:00Z');

  it('lebih dari 200 baris psikolog tanpa sambungan tidak menghalangi baris psikolog tersambung', async () => {
    // Baris psikolog lain datang LEBIH DULU di antrean: dengan `take: 200` tanpa
    // penyaring, baris psikolog 29 tidak pernah terambil.
    for (let i = 0; i < 205; i++) {
      rows.push(row({ appointmentId: BigInt(7000 + i), professionalId: 31n }));
    }
    rows.push(row());

    const report = await runEventSweep({ loader, now: NOW });

    expect(report.created).toBe(1);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('baris psikolog tanpa sambungan tidak disentuh dan dihitung apa adanya', async () => {
    rows.push(row({ professionalId: 31n }));

    const report = await runEventSweep({ loader, now: NOW });

    expect(updates).toEqual([]);
    expect(createEvent).not.toHaveBeenCalled();
    expect(report.examined).toBe(0);
    expect(report.skippedNoWriteScope).toBe(1);
  });
});

describe('janji yang sudah lewat', () => {
  // Tiga minggu setelah janji uji (2026-11-04 14:00-15:00 WIB).
  const SESUDAH = new Date('2026-11-25T03:00:00Z');

  it('tidak dibuatkan acara, barisnya ditutup supaya tidak terambil lagi', async () => {
    rows.push(row());

    const report = await runEventSweep({ loader, now: SESUDAH });

    expect(createEvent).not.toHaveBeenCalled();
    expect(report.created).toBe(0);
    expect(updates).toHaveLength(1);
    const data = updates[0].data as Record<string, unknown>;
    expect(data.syncedHash).toBe(data.desiredHash);
    expect(data.desiredHash).not.toBe(DIRTY);
    expect(data.googleEventId).toBeNull();
  });

  it('yang berakhir sebentar lagi masih dibuatkan acara', async () => {
    rows.push(row());
    // 14:30 WIB: janji (sampai 15:00) belum berakhir.
    const report = await runEventSweep({ loader, now: new Date('2026-11-04T07:30:00Z') });

    expect(report.created).toBe(1);
  });

  it('yang batal dan punya acara tetap dihapus dari kalender', async () => {
    rows.push(row({ googleEventId: 'evt-1', syncedHash: 'x'.repeat(64) }));

    const report = await runEventSweep({ loader: loaderBatal, now: SESUDAH });

    expect(report.deleted).toBe(1);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });

  it('yang sudah punya acara tetap boleh diperbarui', async () => {
    rows.push(row({ googleEventId: 'evt-1', syncedHash: 'x'.repeat(64) }));

    const report = await runEventSweep({ loader, now: SESUDAH });

    expect(report.updated).toBe(1);
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });

  it('acara di kalender lama dipindahkan ke yang baru hanya bila belum lewat; yang lewat cukup dihapus', async () => {
    rows.push(row({ googleEventId: 'evt-1', syncedHash: 'x'.repeat(64), calendarId: 'cal-lama' }));

    await runEventSweep({ loader, now: SESUDAH });

    expect(deleteEvent).toHaveBeenCalledTimes(1);
    expect(createEvent).not.toHaveBeenCalled();
  });
});
