/**
 * Rekonsiliasi: menurunkan ulang apa yang SEHARUSNYA benar, langsung dari
 * janji-janji di database.
 *
 * Dijalankan terhadap database test sungguhan karena intinya memang kueri, dan
 * satu kueri di sini menyentuh kolom yang sudah dua kali menggigit proyek ini:
 * `appointment_start_date` bertipe `@db.Date`, disaring dengan objek `Date`.
 * Kolom DATE dan TIME di MySQL punya aturan pengikatan sendiri lewat Prisma —
 * uji bermock akan dengan senang hati mengulang asumsiku dan lulus, lalu
 * rekonsiliasinya diam-diam tidak menemukan satu janji pun di produksi.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb, seedAppointment, useIdBlock } from '../../billing/fixtures';
import { reconcileCalendarIntents, DIRTY } from '@/services/integrations/google-event-sync.service';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

// Blok id milik suite ini, dari registri di tests/helpers/id-blocks.ts. Bukan
// angka pilihan sendiri: suite ini menghapus wp_kc_appointments per doctor_id,
// dan blok yang tumpang tindih membuat satu suite menghapus baris suite lain.
const { BASE } = useIdBlock('integration/integrations/event-sync-reconcile.test.ts');
const PRO = BASE + 501;
const WRITE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.app.created';

/** Hari ini menurut UTC, karena kolom `@db.Date` pulang-pergi sebagai tengah malam UTC. */
function hariKe(selisih: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + selisih),
  );
  return d.toISOString().slice(0, 10);
}

async function wipe() {
  assertTestDb();
  await prisma.googleCalendarEventSync.deleteMany({ where: { professionalId: BigInt(PRO) } });
  await prisma.googleCalendarConnection.deleteMany({ where: { professionalId: BigInt(PRO) } });
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_appointments WHERE doctor_id = ?', PRO);
}

async function sambungkan(scope = WRITE_SCOPE) {
  await prisma.googleCalendarConnection.create({
    data: {
      professionalId: BigInt(PRO),
      googleAccountEmail: 'psikolog@test.local',
      refreshTokenEncrypted: 'v1:dummy',
      scopeGranted: scope,
      calendarIds: ['primary'],
      status: 'active',
      connectedAt: new Date(),
    },
  });
}

async function janji(id: number, status: number, hari: number) {
  await seedAppointment({
    id,
    doctorId: PRO,
    clinicId: PRO + 1,
    patientId: PRO + 2,
    status,
    startDate: hariKe(hari),
    startTime: '09:00:00',
  });
}

beforeEach(wipe);
afterAll(wipe);

describe('rekonsiliasi terhadap database sungguhan', () => {
  it('menemukan janji pasti yang belum punya baris niat', async () => {
    // Ini kasus yang membuat rekonsiliasi ada: pencatatan niat hilang karena
    // crash antara penulisan janji dan penulisan niatnya.
    await sambungkan();
    await janji(BASE + 1, APPOINTMENT_STATUS.BOOKED, 3);

    const hasil = await reconcileCalendarIntents();

    expect(hasil.enqueuedMissing).toBe(1);
    const row = await prisma.googleCalendarEventSync.findUnique({
      where: { appointmentId: BigInt(BASE + 1) },
    });
    expect(row).toMatchObject({ desiredState: 'present', professionalId: BigInt(PRO) });
  });

  it('tidak membuat baris untuk janji yang menunggu persetujuan', async () => {
    // Keputusan produknya: tidak ada yang diundang ke sesuatu yang bisa ditolak.
    await sambungkan();
    await janji(BASE + 2, APPOINTMENT_STATUS.PENDING, 3);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
    expect(
      await prisma.googleCalendarEventSync.findUnique({
        where: { appointmentId: BigInt(BASE + 2) },
      }),
    ).toBeNull();
  });

  it('tidak membuat nisan untuk janji yang sudah lama batal', async () => {
    await sambungkan();
    await janji(BASE + 3, APPOINTMENT_STATUS.CANCELLED, 3);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
  });

  it('membalik niat jadi absent ketika janjinya ternyata sudah dibatalkan', async () => {
    // Pembatalan yang lewat jalur yang tidak mencatat niat. Tanpa ini, acaranya
    // menetap di Google dan slotnya tidak pernah kembali dibuka.
    await sambungkan();
    await janji(BASE + 4, APPOINTMENT_STATUS.CANCELLED, 3);
    await prisma.googleCalendarEventSync.create({
      data: {
        appointmentId: BigInt(BASE + 4),
        professionalId: BigInt(PRO),
        desiredState: 'present',
        desiredHash: 'f'.repeat(64),
        syncedHash: 'f'.repeat(64),
        googleEventId: 'evt-1',
      },
    });

    const hasil = await reconcileCalendarIntents();

    expect(hasil.flippedToAbsent).toBe(1);
    const row = await prisma.googleCalendarEventSync.findUnique({
      where: { appointmentId: BigInt(BASE + 4) },
    });
    expect(row?.desiredState).toBe('absent');
    // Id acaranya DIPERTAHANKAN: penyapu masih perlu tahu apa yang harus dihapus.
    expect(row?.googleEventId).toBe('evt-1');
  });

  it('mengabaikan janji di luar cakrawala', async () => {
    await sambungkan();
    await janji(BASE + 5, APPOINTMENT_STATUS.BOOKED, 400);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
  });

  it('mengabaikan janji yang sudah lewat', async () => {
    await sambungkan();
    await janji(BASE + 6, APPOINTMENT_STATUS.BOOKED, -5);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
  });

  it('tidak menyentuh psikolog yang tidak memberi izin tulis', async () => {
    // Arah bacanya boleh jalan sempurna; arah tulisnya sekadar belum dinyalakan.
    await sambungkan('openid email https://www.googleapis.com/auth/calendar.freebusy');
    await janji(BASE + 7, APPOINTMENT_STATUS.BOOKED, 3);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
  });

  it('tidak menerima calendar.events sebagai izin tulis', async () => {
    // Scope itu bisa menulis acara tapi TIDAK bisa membuat kalender, padahal
    // seluruh fitur ini menulis ke kalender buatan sendiri. Menerimanya berarti
    // penyapu mencoba lalu gagal berulang-ulang pada setiap putaran.
    await sambungkan('openid email https://www.googleapis.com/auth/calendar.events');
    await janji(BASE + 9, APPOINTMENT_STATUS.BOOKED, 3);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(0);
  });

  it('menerima janji hari ini, bukan hanya yang akan datang', async () => {
    // Batas bawahnya tengah malam UTC hari ini. Kalau pembandingnya meleset
    // sehari, seluruh janji hari ini tidak akan pernah ditulis ke Google.
    await sambungkan();
    await janji(BASE + 8, APPOINTMENT_STATUS.BOOKED, 0);

    expect((await reconcileCalendarIntents()).enqueuedMissing).toBe(1);
  });
  describe('memeriksa ulang isi acara yang sudah sinkron', () => {
    // Rekonsiliasi dulu hanya menurunkan ulang ada/tidaknya acara, tidak pernah
    // jamnya. Janji yang dipindah lewat jalur yang tidak mencatat niat — kejadian
    // sungguhan: 3388, dipindah 10 Nov 2026 — tetap tercatat "sinkron" dan
    // acaranya menetap di jam lama selamanya.
    const SINKRON = 'f'.repeat(64);

    async function barisSinkron(id: number, terakhirDisentuh: Date) {
      await prisma.googleCalendarEventSync.create({
        data: {
          appointmentId: BigInt(id),
          professionalId: BigInt(PRO),
          desiredState: 'present',
          desiredHash: SINKRON,
          syncedHash: SINKRON,
          googleEventId: 'evt-1',
        },
      });
      // Lewat SQL karena Prisma mengisi ulang `updatedAt` sendiri.
      await prisma.$executeRawUnsafe(
        'UPDATE google_calendar_event_sync SET updatedAt = ? WHERE appointmentId = ?',
        terakhirDisentuh,
        id,
      );
    }

    it('menandai ulang baris yang sudah lama tidak diperiksa', async () => {
      await sambungkan();
      await janji(BASE + 10, APPOINTMENT_STATUS.BOOKED, 1);
      await barisSinkron(BASE + 10, new Date(Date.now() - 7 * 3_600_000));

      const hasil = await reconcileCalendarIntents();

      expect(hasil.reverified).toBe(1);
      const row = await prisma.googleCalendarEventSync.findUnique({
        where: { appointmentId: BigInt(BASE + 10) },
      });
      // Hanya ditandai: penyapu yang membandingkan isinya dengan data hidup, dan
      // yang tidak berubah lolos tanpa satu permintaan pun ke Google.
      expect(row?.desiredHash).toBe(DIRTY);
      expect(row?.syncedHash).toBe(SINKRON);
      expect(row?.googleEventId).toBe('evt-1');
    });

    it('tidak menandai ulang baris yang baru saja diperiksa', async () => {
      await sambungkan();
      await janji(BASE + 11, APPOINTMENT_STATUS.BOOKED, 1);
      await barisSinkron(BASE + 11, new Date());

      expect((await reconcileCalendarIntents()).reverified).toBe(0);
      const row = await prisma.googleCalendarEventSync.findUnique({
        where: { appointmentId: BigInt(BASE + 11) },
      });
      expect(row?.desiredHash).toBe(SINKRON);
    });

    it('tidak mengganggu baris yang sedang menunggu percobaan ulang', async () => {
      // Jeda mundurnya hasil kegagalan sungguhan; menghapusnya tiap jam berarti
      // menghantam Google terus-menerus untuk baris yang memang sedang rusak.
      await sambungkan();
      await janji(BASE + 12, APPOINTMENT_STATUS.BOOKED, 1);
      // Detik bulat: kolomnya DATETIME tanpa pecahan, dan MySQL membulatkan
      // milidetik — bukan memotongnya — sehingga pembandingan pas akan meleset.
      const nanti = new Date(Math.floor((Date.now() + 3_600_000) / 1000) * 1000);
      await prisma.googleCalendarEventSync.create({
        data: {
          appointmentId: BigInt(BASE + 12),
          professionalId: BigInt(PRO),
          desiredState: 'present',
          desiredHash: DIRTY,
          syncedHash: SINKRON,
          googleEventId: 'evt-1',
          attempts: 3,
          nextAttemptAt: nanti,
        },
      });
      await prisma.$executeRawUnsafe(
        'UPDATE google_calendar_event_sync SET updatedAt = ? WHERE appointmentId = ?',
        new Date(Date.now() - 7 * 3_600_000),
        BASE + 12,
      );

      expect((await reconcileCalendarIntents()).reverified).toBe(0);
      const row = await prisma.googleCalendarEventSync.findUnique({
        where: { appointmentId: BigInt(BASE + 12) },
      });
      expect(row).toMatchObject({ attempts: 3 });
      expect(row?.nextAttemptAt?.getTime()).toBe(nanti.getTime());
    });
  });
});
