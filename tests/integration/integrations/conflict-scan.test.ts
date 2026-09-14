/**
 * Pemindaian harian bentrok mundur.
 *
 * Melawan database test sungguhan, karena yang dijaga di sini sebagian besar
 * adalah STATUS: apakah peringatan yang sama terkirim dua kali, apakah bentrok
 * yang berubah memicu peringatan baru, dan apakah bentrok yang selesai
 * membersihkan jejaknya. Mock hanya akan mengulang asumsiku sendiri.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/services/integrations/google-busy.service', () => ({
  googleBusyForRange: vi.fn(async () => ({})),
}));
vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(async () => ({
    id: 730n, email: 'psikolog@test.local', displayName: 'Psikolog Test',
    timezone: 'Asia/Jakarta', status: 1,
  })),
}));
vi.mock('@/repositories/wp/appointments.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/appointments.repo')>()),
  listAppointments: vi.fn(async () => ({ items: [], total: 0, perPage: 100, page: 1 })),
}));

import { scanBackwardConflicts } from '@/services/integrations/conflict-scan.service';
import { sendEmail } from '@/lib/email';
import * as busy from '@/services/integrations/google-busy.service';
import * as appts from '@/repositories/wp/appointments.repo';

const PRO = 900301;
type Mock = ReturnType<typeof vi.fn>;

async function wipe() {
  assertTestDb();
  await prisma.googleConflictWarning.deleteMany({ where: { professionalId: BigInt(PRO) } });
  await prisma.googleCalendarConnection.deleteMany({ where: { professionalId: BigInt(PRO) } });
}

async function connect() {
  await prisma.googleCalendarConnection.create({
    data: {
      professionalId: BigInt(PRO), googleAccountEmail: 'dr@gmail.com',
      refreshTokenEncrypted: 'v1:x', scopeGranted: 'freebusy',
      calendarIds: ['primary'], status: 'active', connectedAt: new Date(),
    },
  });
}

/** Satu janji temu 14:00–15:00, dan agenda Google yang menimpanya. */
function bentrok(busyRange = { start: 840, end: 900 }) {
  (appts.listAppointments as Mock).mockResolvedValue({
    items: [{ id: 5150n, startDate: '2026-10-01', startTime: '14:00:00', endTime: '15:00:00' }],
    total: 1, perPage: 100, page: 1,
  });
  (busy.googleBusyForRange as Mock).mockResolvedValue({ '2026-10-01': [busyRange] });
}

beforeEach(async () => {
  vi.clearAllMocks();
  (sendEmail as unknown as Mock).mockResolvedValue({ ok: true });
  await wipe();
  await connect();
});
afterAll(wipe);

describe('scanBackwardConflicts', () => {
  it('tidak melakukan apa-apa ketika tidak ada bentrok', async () => {
    const hasil = await scanBackwardConflicts();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(hasil.notified).toBe(0);
  });

  it('mengirim satu peringatan dan mencatatnya', async () => {
    bentrok();
    const hasil = await scanBackwardConflicts();

    expect(hasil.notified).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    const baris = await prisma.googleConflictWarning.findMany({ where: { professionalId: BigInt(PRO) } });
    expect(baris).toHaveLength(1);
    expect(baris[0].appointmentId).toBe(5150);
  });

  it('tidak mengirim ulang untuk bentrok yang sama', async () => {
    // Pemindaiannya harian. Tanpa ini, satu agenda yang dibiarkan menghasilkan
    // satu email tiap hari sampai janji temunya lewat.
    bentrok();
    await scanBackwardConflicts();
    (sendEmail as unknown as Mock).mockClear();

    const kedua = await scanBackwardConflicts();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(kedua.notified).toBe(0);
  });

  it('mengirim lagi ketika bentroknya berubah', async () => {
    bentrok({ start: 840, end: 900 });
    await scanBackwardConflicts();
    (sendEmail as unknown as Mock).mockClear();

    // Psikolognya menggeser agendanya, masih menimpa tapi di jam berbeda.
    bentrok({ start: 870, end: 930 });
    const kedua = await scanBackwardConflicts();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(kedua.notified).toBe(1);
  });

  it('membersihkan catatan ketika bentroknya sudah selesai', async () => {
    // Supaya bentrok yang muncul lagi nanti tetap diberitahukan, bukan ditelan
    // catatan lama.
    bentrok();
    await scanBackwardConflicts();
    expect(await prisma.googleConflictWarning.count({ where: { professionalId: BigInt(PRO) } })).toBe(1);

    (busy.googleBusyForRange as Mock).mockResolvedValue({});
    await scanBackwardConflicts();
    expect(await prisma.googleConflictWarning.count({ where: { professionalId: BigInt(PRO) } })).toBe(0);
  });

  it('tidak mencatat peringatan ketika emailnya gagal terkirim', async () => {
    // Kalau dicatat, percobaan besok akan menganggapnya sudah diberitahukan dan
    // psikolognya tidak pernah tahu.
    bentrok();
    (sendEmail as unknown as Mock).mockResolvedValue({ ok: false, error: 'resend down' });

    const hasil = await scanBackwardConflicts();
    expect(hasil.notified).toBe(0);
    expect(await prisma.googleConflictWarning.count({ where: { professionalId: BigInt(PRO) } })).toBe(0);
  });

  it('melewati koneksi yang tidak aktif', async () => {
    bentrok();
    await prisma.googleCalendarConnection.updateMany({
      where: { professionalId: BigInt(PRO) }, data: { status: 'revoked' },
    });
    const hasil = await scanBackwardConflicts();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(hasil.scanned).toBe(0);
  });
});
