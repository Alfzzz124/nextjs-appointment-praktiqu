/**
 * Contract tests for the WordPress off-day (holiday) repository.
 *
 * Replaces the `professional_off_days` and `holiday_list` shadow tables. Production
 * uses all three selection modes — 130 `range`, 6 `single`, 3 `multiple` — so reading
 * every row as a start/end range would wrongly close working days.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  SELECTION_MODE,
  isOffOn,
  listClinicOffDays,
  listDoctorOffDays,
  offDaysOn,
} from '@/repositories/wp/off-days.repo';

/** Test-owned range. Cleanup is bounded by END — see the note in wp-patients.repo.test.ts. */
const BASE = 8_200_000;
const END = BASE + 100_000;

const DOCTOR = BigInt(BASE + 20);
const OTHER_DOCTOR = BigInt(BASE + 21);
const CLINIC = BigInt(BASE + 30);

async function seedOffDay(opts: {
  id: number;
  module?: string;
  moduleId?: bigint;
  mode?: string;
  start?: string;
  end?: string;
  selectedDates?: string[];
  timeSpecific?: boolean;
  startTime?: string;
  endTime?: string;
  status?: number;
  description?: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule
       (id, module_type, module_id, selection_mode, start_date, end_date, selected_dates,
        time_specific, start_time, end_time, timezone, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    opts.id,
    opts.module ?? 'doctor',
    opts.moduleId ?? DOCTOR,
    opts.mode ?? SELECTION_MODE.RANGE,
    opts.start ?? null,
    opts.end ?? null,
    opts.selectedDates ? JSON.stringify(opts.selectedDates) : null,
    opts.timeSpecific ? 1 : 0,
    opts.startTime ?? null,
    opts.endTime ?? null,
    'Asia/Jakarta',
    opts.description ?? 'Cuti',
    opts.status ?? 1,
  );
}

describe('wp off days repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.$executeRawUnsafe(
      `DELETE FROM wp_kc_clinic_schedule WHERE id >= ? AND id < ?`,
      BASE,
      END,
    );

    await seedOffDay({ id: BASE + 1, mode: SELECTION_MODE.RANGE, start: '2026-09-01', end: '2026-09-03' });
    await seedOffDay({ id: BASE + 2, mode: SELECTION_MODE.SINGLE, start: '2026-09-10', end: '2026-09-10' });
    await seedOffDay({
      id: BASE + 3,
      mode: SELECTION_MODE.MULTIPLE,
      start: '2026-09-15',
      end: '2026-09-25',
      selectedDates: ['2026-09-15', '2026-09-20'],
    });
    await seedOffDay({
      id: BASE + 4,
      mode: SELECTION_MODE.RANGE,
      start: '2026-10-01',
      end: '2026-10-01',
      timeSpecific: true,
      startTime: '13:00:00',
      endTime: '17:00:00',
    });
    // Inactive, and another doctor's — neither should surface by default.
    await seedOffDay({ id: BASE + 5, mode: SELECTION_MODE.RANGE, start: '2026-11-01', end: '2026-11-02', status: 0 });
    await seedOffDay({ id: BASE + 6, moduleId: OTHER_DOCTOR, start: '2026-09-01', end: '2026-09-03' });
    await seedOffDay({ id: BASE + 7, module: 'clinic', moduleId: CLINIC, start: '2026-12-25', end: '2026-12-26' });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM wp_kc_clinic_schedule WHERE id >= ? AND id < ?`,
      BASE,
      END,
    );
    await prisma.$disconnect();
  });

  it('lists a doctor’s active off days', async () => {
    const rows = await listDoctorOffDays(DOCTOR);
    const ids = rows.map((r) => Number(r.id));

    expect(ids).toEqual([BASE + 1, BASE + 2, BASE + 3, BASE + 4]);
  });

  it('excludes inactive rows unless asked', async () => {
    expect((await listDoctorOffDays(DOCTOR)).map((r) => Number(r.id))).not.toContain(BASE + 5);

    const all = await listDoctorOffDays(DOCTOR, { includeInactive: true });
    expect(all.map((r) => Number(r.id))).toContain(BASE + 5);
  });

  it('does not leak another doctor’s off days', async () => {
    expect((await listDoctorOffDays(DOCTOR)).map((r) => Number(r.id))).not.toContain(BASE + 6);
  });

  it('keeps clinic and doctor closures separate', async () => {
    const clinic = await listClinicOffDays(CLINIC);

    expect(clinic.map((r) => Number(r.id))).toEqual([BASE + 7]);
    expect((await listDoctorOffDays(DOCTOR)).map((r) => Number(r.id))).not.toContain(BASE + 7);
  });

  it('decodes dates, times and the multiple-mode date list', async () => {
    const rows = await listDoctorOffDays(DOCTOR);
    const multiple = rows.find((r) => Number(r.id) === BASE + 3)!;
    const partial = rows.find((r) => Number(r.id) === BASE + 4)!;

    expect(multiple.selectedDates).toEqual(['2026-09-15', '2026-09-20']);
    expect(partial.timeSpecific).toBe(true);
    expect(partial.startTime).toBe('13:00:00');
    expect(partial.endTime).toBe('17:00:00');
    expect(partial.startDate).toBe('2026-10-01');
  });

  it('filters to an overlapping window', async () => {
    const rows = await listDoctorOffDays(DOCTOR, { from: '2026-09-02', to: '2026-09-02' });

    // BASE+1 spans 09-01..09-03, so a window inside it must still match.
    expect(rows.map((r) => Number(r.id))).toContain(BASE + 1);
    expect(rows.map((r) => Number(r.id))).not.toContain(BASE + 2);
  });

  describe('isOffOn — each mode means something different', () => {
    it('range covers every day between start and end inclusive', async () => {
      const row = (await listDoctorOffDays(DOCTOR)).find((r) => Number(r.id) === BASE + 1)!;

      expect(isOffOn(row, '2026-09-01')).toBe(true);
      expect(isOffOn(row, '2026-09-02')).toBe(true);
      expect(isOffOn(row, '2026-09-03')).toBe(true);
      expect(isOffOn(row, '2026-09-04')).toBe(false);
    });

    it('single covers only its start date', async () => {
      const row = (await listDoctorOffDays(DOCTOR)).find((r) => Number(r.id) === BASE + 2)!;

      expect(isOffOn(row, '2026-09-10')).toBe(true);
      expect(isOffOn(row, '2026-09-11')).toBe(false);
    });

    it('multiple covers only the listed dates, not the span between them', async () => {
      const row = (await listDoctorOffDays(DOCTOR)).find((r) => Number(r.id) === BASE + 3)!;

      expect(isOffOn(row, '2026-09-15')).toBe(true);
      expect(isOffOn(row, '2026-09-20')).toBe(true);
      // The regression this guards: reading it as a range would close 16-19 too.
      expect(isOffOn(row, '2026-09-17')).toBe(false);
      expect(isOffOn(row, '2026-09-25')).toBe(false);
    });

    it('reports a time-specific closure as affecting the day', async () => {
      const row = (await listDoctorOffDays(DOCTOR)).find((r) => Number(r.id) === BASE + 4)!;

      // True because the day IS affected; the caller drops only 13:00-17:00.
      expect(isOffOn(row, '2026-10-01')).toBe(true);
      expect(row.timeSpecific).toBe(true);
    });

    it('rejects a malformed date rather than silently answering false', async () => {
      const row = (await listDoctorOffDays(DOCTOR))[0];
      expect(() => isOffOn(row, '01-09-2026')).toThrow(/YYYY-MM-DD/);
    });
  });

  it('offDaysOn returns every row covering a date', async () => {
    const rows = await listDoctorOffDays(DOCTOR);

    expect(offDaysOn(rows, '2026-09-02').map((r) => Number(r.id))).toEqual([BASE + 1]);
    expect(offDaysOn(rows, '2026-09-17')).toEqual([]);
  });
});
