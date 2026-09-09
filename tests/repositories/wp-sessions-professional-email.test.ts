/**
 * `SessionRow` membawa email klien tapi dulu tidak membawa email profesional, padahal
 * join `wp_users du` sudah ada di SELECT_SQL. Pengingat sesi mengirim ke keduanya, jadi
 * kolomnya harus ikut terambil.
 *
 * Prisma dimock: tidak ada MySQL di lingkungan dev ini.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = { prisma: { $queryRawUnsafe: vi.fn() } };
vi.mock('@/lib/db', () => db);

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    clinic_id: 1,
    doctor_id: 119,
    patient_id: 522,
    appointment_start_date: new Date('2026-09-10T00:00:00Z'),
    appointment_start_time: new Date('1970-01-01T09:30:00Z'),
    appointment_end_time: new Date('1970-01-01T10:30:00Z'),
    appointment_timezone: 'Asia/Jakarta',
    visit_type: '3',
    description: null,
    status: 1,
    created_at: new Date('2026-09-01T00:00:00Z'),
    doctor_first: 'Pamela',
    doctor_last: 'Dewi',
    doctor_display: 'Pamela Dewi',
    doctor_email: 'pamela@klinik.test',
    patient_first: 'Ada',
    patient_last: 'Lovelace',
    patient_display: 'Ada Lovelace',
    patient_email: 'ada@contoh.test',
    ...over,
  };
}

describe('findSessionById — email profesional', () => {
  beforeEach(() => db.prisma.$queryRawUnsafe.mockReset());

  it('membawa email profesional dari kolom doctor_email', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow()]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    const row = await findSessionById(7);

    expect(row?.professionalEmail).toBe('pamela@klinik.test');
    expect(row?.clientEmail).toBe('ada@contoh.test');
  });

  it('memakai string kosong saat dokter tidak punya email, seperti perlakuan klien', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow({ doctor_email: null })]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    const row = await findSessionById(7);

    expect(row?.professionalEmail).toBe('');
  });

  it('meminta kolom doctor_email di SQL-nya', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow()]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    await findSessionById(7);

    const sql = db.prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('du.user_email');
  });
});
