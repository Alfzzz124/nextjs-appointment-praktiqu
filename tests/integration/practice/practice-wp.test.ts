/**
 * Practice domain against KiviCare's tables.
 *
 * Replaces two mock-based suites (666 lines) that stubbed `prisma.clinic` and
 * `prisma.holiday` — models that no longer exist. They described a schema rather than
 * behaviour, so porting the mocks would have preserved nothing.
 *
 * A practice is a `wp_kc_clinics` row; its holidays are `wp_kc_clinic_schedule` rows
 * with `module_type = 'clinic'`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  HolidayNotFoundError,
  PracticeNotFoundError,
  PracticeValidationError,
  addHoliday,
  getPractice,
  listHolidays,
  listPractices,
  removeHoliday,
  updatePractice,
} from '@/services/practice/service';

/** Test-owned range, below billing's unbounded `>= 9_000_000` cleanup. */
const BASE = 7_900_000;
const END = BASE + 100_000;
const CLINIC = BASE + 1;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_clinic_schedule WHERE module_id >= ? AND module_id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Uji', 'klinik@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 1, 0, NOW())`,
    CLINIC,
  );
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('practices', () => {
  it('reads a practice from wp_kc_clinics', async () => {
    const p = await getPractice(CLINIC);

    expect(p.id).toBe(CLINIC);
    expect(p.name).toBe('Klinik Uji');
    expect(p.city).toBe('Bandung');
    expect(p.status).toBe(1);
  });

  it('throws for an unknown practice', async () => {
    await expect(getPractice(CLINIC + 999)).rejects.toBeInstanceOf(PracticeNotFoundError);
  });

  it('lists practices', async () => {
    const { data } = await listPractices({ page: 1, limit: 100 });
    expect(data.map((p) => p.id)).toContain(CLINIC);
  });

  it('round-trips timezone and logo through the extra blob', async () => {
    // Those have no columns on KiviCare's table.
    await updatePractice(CLINIC, { timezone: 'Asia/Jakarta', logoUrl: 'https://x/logo.png' });

    const p = await getPractice(CLINIC);
    expect(p.timezone).toBe('Asia/Jakarta');
    expect(p.logoUrl).toBe('https://x/logo.png');
  });

  it('merges into extra rather than replacing it', async () => {
    // The regression this guards: a partial update must not blank the sibling keys
    // that share the blob.
    await updatePractice(CLINIC, { logoUrl: 'https://x/new.png' });

    const p = await getPractice(CLINIC);
    expect(p.logoUrl).toBe('https://x/new.png');
    expect(p.timezone).toBe('Asia/Jakarta');
  });

  it('updates plain columns', async () => {
    await updatePractice(CLINIC, { name: 'Klinik Berubah', city: 'Jakarta' });

    const p = await getPractice(CLINIC);
    expect(p.name).toBe('Klinik Berubah');
    expect(p.city).toBe('Jakarta');
    // Untouched fields survive.
    expect(p.email).toBe('klinik@test.local');
  });
});

describe('holidays', () => {
  it('adds and lists an all-day holiday', async () => {
    const created = await addHoliday(CLINIC, {
      title: 'Tahun Baru',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      isAllDay: true,
    });

    expect(created.title).toBe('Tahun Baru');
    expect(created.isAllDay).toBe(true);
    expect(created.practiceId).toBe(CLINIC);

    expect((await listHolidays(CLINIC)).map((h) => h.id)).toContain(created.id);
  });

  it('stores a part-day holiday with both bounds', async () => {
    const created = await addHoliday(CLINIC, {
      title: 'Rapat',
      startDate: '2026-02-02',
      endDate: '2026-02-02',
      isAllDay: false,
      startTime: '13:00',
      endTime: '17:00',
    });

    // isAllDay is the inverse of KiviCare's time_specific — easy to get backwards.
    expect(created.isAllDay).toBe(false);
    expect(created.startTime).toBe('13:00');
    expect(created.endTime).toBe('17:00');
  });

  it('refuses a part-day holiday without both times', async () => {
    // Without bounds the slot generator cannot tell what it covers.
    await expect(
      addHoliday(CLINIC, {
        title: 'Tidak lengkap',
        startDate: '2026-03-03',
        endDate: '2026-03-03',
        isAllDay: false,
        startTime: '13:00',
      }),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('refuses an end date before the start', async () => {
    await expect(
      addHoliday(CLINIC, {
        title: 'Terbalik',
        startDate: '2026-04-10',
        endDate: '2026-04-01',
        isAllDay: true,
      }),
    ).rejects.toBeInstanceOf(PracticeValidationError);
  });

  it('removes a holiday', async () => {
    const created = await addHoliday(CLINIC, {
      title: 'Sementara',
      startDate: '2026-05-05',
      endDate: '2026-05-05',
      isAllDay: true,
    });

    expect(await removeHoliday(CLINIC, created.id)).toBe(true);
    expect((await listHolidays(CLINIC)).map((h) => h.id)).not.toContain(created.id);
  });

  it('will not remove a holiday belonging to another practice', async () => {
    const created = await addHoliday(CLINIC, {
      title: 'Milik klinik ini',
      startDate: '2026-06-06',
      endDate: '2026-06-06',
      isAllDay: true,
    });

    // Scoped by clinic, so an id alone is not enough to delete someone else's closure.
    await expect(removeHoliday(CLINIC + 500, created.id)).rejects.toBeInstanceOf(
      HolidayNotFoundError,
    );
    expect((await listHolidays(CLINIC)).map((h) => h.id)).toContain(created.id);
  });
});
