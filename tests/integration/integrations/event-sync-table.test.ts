/**
 * Tabel `google_calendar_event_sync` yang sungguhan, bukan tiruannya.
 *
 * Yang dijaga di sini adalah hal-hal yang TIDAK AKAN pernah ketahuan dari uji
 * bermock, dan baru muncul pada malam deploy:
 *
 * - Apakah SQL tangan di `prisma/manual/` benar-benar menghasilkan tabel yang
 *   bisa dibaca-tulis model Prisma-nya. Keduanya ditulis terpisah, jadi satu
 *   nama kolom yang meleset cukup untuk membuat fiturnya mati total di produksi
 *   sementara seluruh uji unit tetap hijau.
 * - Apakah kueri "baris yang belum sinkron" benar-benar jalan di MySQL.
 *   Perbandingan antar-kolom lewat `prisma.<model>.fields` punya jebakan NULL:
 *   `kolom = NULL` bernilai NULL, bukan true, sehingga `NOT(...)` juga NULL dan
 *   MySQL membuang barisnya. Yang terbuang justru baris yang BELUM PERNAH
 *   sinkron sama sekali — yang paling butuh disapu.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';
import { DIRTY } from '@/services/integrations/google-event-sync.service';
import { ABSENT_FINGERPRINT } from '@/services/integrations/google-event-payload';

const PRO = 900401;
const APPT = 9004010;

async function wipe() {
  assertTestDb();
  await prisma.googleCalendarEventSync.deleteMany({
    where: { professionalId: BigInt(PRO) },
  });
}

/** Baris yang akan dipungut penyapu: belum sinkron dan boleh dicoba sekarang. */
function pekerjaanTertunda(now: Date) {
  return prisma.googleCalendarEventSync.findMany({
    where: {
      professionalId: BigInt(PRO),
      AND: [
        {
          OR: [
            { syncedHash: null },
            {
              NOT: {
                desiredHash: { equals: prisma.googleCalendarEventSync.fields.syncedHash },
              },
            },
          ],
        },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    orderBy: { appointmentId: 'asc' },
  });
}

beforeEach(wipe);
afterAll(wipe);

describe('pemetaan model terhadap SQL tangan', () => {
  it('menulis dan membaca kembali setiap kolom', async () => {
    // Kalau satu @map meleset dari SQL-nya, baris ini gagal di sini — bukan di
    // produksi pada putaran cron pertama.
    await prisma.googleCalendarEventSync.create({
      data: {
        appointmentId: BigInt(APPT),
        professionalId: BigInt(PRO),
        desiredState: 'present',
        desiredHash: DIRTY,
        syncedHash: 'a'.repeat(64),
        googleEventId: 'evt-1',
        calendarId: 'primary',
        attempts: 3,
        nextAttemptAt: new Date('2026-11-03T10:00:00Z'),
        lastError: 'sesuatu gagal',
      },
    });

    const row = await prisma.googleCalendarEventSync.findUnique({
      where: { appointmentId: BigInt(APPT) },
    });

    expect(row).toMatchObject({
      professionalId: BigInt(PRO),
      desiredState: 'present',
      desiredHash: DIRTY,
      syncedHash: 'a'.repeat(64),
      googleEventId: 'evt-1',
      calendarId: 'primary',
      attempts: 3,
      lastError: 'sesuatu gagal',
    });
  });

  it('memakai primary key sebagai mutex: niat kedua menimpa, tidak menggandakan', async () => {
    // Inilah alasan appointment_id jadi PRIMARY KEY dan bukan indeks biasa —
    // satu janji tidak boleh punya dua baris niat yang saling bertabrakan.
    for (const state of ['present', 'absent'] as const) {
      await prisma.googleCalendarEventSync.upsert({
        where: { appointmentId: BigInt(APPT) },
        create: {
          appointmentId: BigInt(APPT),
          professionalId: BigInt(PRO),
          desiredState: state,
          desiredHash: DIRTY,
        },
        update: { desiredState: state, desiredHash: DIRTY },
      });
    }

    const rows = await prisma.googleCalendarEventSync.findMany({
      where: { professionalId: BigInt(PRO) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].desiredState).toBe('absent');
  });

  it('createMany skipDuplicates tidak menimpa niat yang sudah ada', async () => {
    // Jalur rekonsiliasi: ia menambah baris yang HILANG, dan tidak boleh
    // menginjak niat yang baru saja ditulis jalur pemesanan.
    await prisma.googleCalendarEventSync.create({
      data: {
        appointmentId: BigInt(APPT),
        professionalId: BigInt(PRO),
        desiredState: 'absent',
        desiredHash: ABSENT_FINGERPRINT,
        syncedHash: ABSENT_FINGERPRINT,
      },
    });

    const hasil = await prisma.googleCalendarEventSync.createMany({
      data: [
        {
          appointmentId: BigInt(APPT),
          professionalId: BigInt(PRO),
          desiredState: 'present',
          desiredHash: DIRTY,
        },
      ],
      skipDuplicates: true,
    });

    expect(hasil.count).toBe(0);
    const row = await prisma.googleCalendarEventSync.findUnique({
      where: { appointmentId: BigInt(APPT) },
    });
    expect(row?.desiredState).toBe('absent');
  });
});

describe('kueri baris yang belum sinkron', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  async function tambah(id: number, over: Record<string, unknown>) {
    await prisma.googleCalendarEventSync.create({
      data: {
        appointmentId: BigInt(id),
        professionalId: BigInt(PRO),
        desiredState: 'present',
        desiredHash: DIRTY,
        ...over,
      },
    });
  }

  it('MEMUNGUT baris yang belum pernah sinkron sekali pun', async () => {
    // Jebakan NULL-nya. Tanpa cabang `syncedHash: null` yang dieja terpisah,
    // MySQL membuang baris ini diam-diam dan penyapu melaporkan "tidak ada
    // pekerjaan" selamanya.
    await tambah(APPT + 1, { syncedHash: null });

    const rows = await pekerjaanTertunda(now);
    expect(rows.map((r) => Number(r.appointmentId))).toEqual([APPT + 1]);
  });

  it('memungut baris yang isinya berubah sejak terakhir terkirim', async () => {
    await tambah(APPT + 2, { desiredHash: DIRTY, syncedHash: 'b'.repeat(64) });

    const rows = await pekerjaanTertunda(now);
    expect(rows.map((r) => Number(r.appointmentId))).toEqual([APPT + 2]);
  });

  it('MELEWATI baris yang sudah sinkron', async () => {
    const hash = 'c'.repeat(64);
    await tambah(APPT + 3, { desiredHash: hash, syncedHash: hash });

    expect(await pekerjaanTertunda(now)).toHaveLength(0);
  });

  it('menghormati jeda mundur yang belum habis', async () => {
    await tambah(APPT + 4, {
      syncedHash: null,
      nextAttemptAt: new Date('2026-11-03T18:00:00Z'),
    });

    expect(await pekerjaanTertunda(now)).toHaveLength(0);
    // Dan memungutnya kembali setelah jedanya lewat.
    expect(await pekerjaanTertunda(new Date('2026-11-03T19:00:00Z'))).toHaveLength(1);
  });

  it('memisahkan yang perlu dikerjakan dari yang tidak dalam satu kumpulan', async () => {
    const hash = 'd'.repeat(64);
    await tambah(APPT + 5, { syncedHash: null });
    await tambah(APPT + 6, { desiredHash: hash, syncedHash: hash });
    await tambah(APPT + 7, { desiredHash: DIRTY, syncedHash: 'e'.repeat(64) });

    const rows = await pekerjaanTertunda(now);
    expect(rows.map((r) => Number(r.appointmentId))).toEqual([APPT + 5, APPT + 7]);
  });
});
