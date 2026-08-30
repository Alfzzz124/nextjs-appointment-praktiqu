// tests/unit/booking/blocked-ranges.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the two repositories the collector fetches from. `isOffOn` is given its real
// behaviour below rather than a stub, because "which off day covers which date" is
// part of what the collector is being tested for.
vi.mock('@/repositories/wp/off-days.repo', () => ({
  isOffOn: vi.fn(),
  listDoctorOffDays: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.repo', () => ({
  ACTIVE_STATUSES: [1, 2, 4],
  listAppointments: vi.fn(),
}));

import { collectBlockedRanges } from '@/services/booking/blocked-ranges.service';
import * as offDays from '@/repositories/wp/off-days.repo';
import * as appts from '@/repositories/wp/appointments.repo';

const DOCTOR_ID = 7;
const MON = '2026-08-31';
const TUE = '2026-09-01';
const WED = '2026-09-02';

/** An appointment as the repository hands it over. */
function appointment(startDate: string, startTime: string, endTime: string) {
  return { startDate, startTime, endTime };
}

/** One full page of filler rows on `date`, all at the same time. */
function page(count: number, date: string) {
  return Array.from({ length: count }, () => appointment(date, '08:00:00', '08:30:00'));
}

beforeEach(() => {
  vi.clearAllMocks();
  (offDays.listDoctorOffDays as any).mockResolvedValue([]);
  // The off day carries the dates it covers; the collector decides per date.
  (offDays.isOffOn as any).mockImplementation((o: any, date: string) =>
    (o.dates ?? []).includes(date),
  );
  (appts.listAppointments as any).mockResolvedValue({ items: [], total: 0, page: 1, perPage: 100 });
});

describe('collectBlockedRanges', () => {
  it('has a key for every date in the range, inclusive', async () => {
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: WED });
    expect(Object.keys(byDate)).toEqual([MON, TUE, WED]);
  });

  it('gives an open day an empty list, not null', async () => {
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: MON });
    expect(byDate[MON]).toEqual([]);
  });

  it('gives a full-day closure null, so the caller can tell it from an open day', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([
      { timeSpecific: false, dates: [TUE] },
    ]);
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: WED });
    expect(byDate[TUE]).toBeNull();
    expect(byDate[MON]).toEqual([]);
    expect(byDate[WED]).toEqual([]);
  });

  it('turns a time-specific off day into a range on the days it covers only', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([
      { timeSpecific: true, startTime: '13:00:00', endTime: '17:00:00', dates: [MON] },
    ]);
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: TUE });
    expect(byDate[MON]).toEqual([{ start: 780, end: 1020 }]);
    expect(byDate[TUE]).toEqual([]);
  });

  it('assigns each appointment to its own date', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [appointment(MON, '10:00:00', '11:00:00'), appointment(WED, '09:00:00', '09:30:00')],
      total: 2,
      page: 1,
      perPage: 100,
    });
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: WED });
    expect(byDate[MON]).toEqual([{ start: 600, end: 660 }]);
    expect(byDate[TUE]).toEqual([]);
    expect(byDate[WED]).toEqual([{ start: 540, end: 570 }]);
  });

  it('fetches once for the whole range, not once per date', async () => {
    await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: '2026-09-13' });
    expect((appts.listAppointments as any).mock.calls).toHaveLength(1);
    expect((offDays.listDoctorOffDays as any).mock.calls).toHaveLength(1);
  });

  it('asks only for statuses that occupy a slot', async () => {
    await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: MON });
    expect((appts.listAppointments as any).mock.calls[0][0]).toMatchObject({
      statuses: [1, 2, 4],
      dateFrom: MON,
      dateTo: MON,
    });
  });

  /**
   * The bug this paging exists for: the repository clamps perPage to 100, rows come
   * back ordered by date ascending, so a single page drops the END of the range —
   * the days most likely to still be free.
   */
  it('pages past the 100-row clamp instead of truncating the end of the range', async () => {
    (appts.listAppointments as any).mockImplementation(async ({ page: p }: any) =>
      p === 1
        ? { items: page(100, MON), total: 101, page: 1, perPage: 100 }
        : { items: [appointment(WED, '15:00:00', '16:00:00')], total: 101, page: 2, perPage: 100 },
    );

    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: WED });

    expect((appts.listAppointments as any).mock.calls).toHaveLength(2);
    // The row that a single page would have lost.
    expect(byDate[WED]).toEqual([{ start: 900, end: 960 }]);
  });

  it('never asks for more than the clamp allows, since a larger perPage is ignored', async () => {
    await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: MON });
    expect((appts.listAppointments as any).mock.calls[0][0].perPage).toBeLessThanOrEqual(100);
  });

  it('stops when a page comes back short even if total claims there is more', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [appointment(MON, '10:00:00', '11:00:00')],
      total: 5000,
      page: 1,
      perPage: 100,
    });
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: MON });
    expect((appts.listAppointments as any).mock.calls).toHaveLength(1);
    expect(byDate[MON]).toEqual([{ start: 600, end: 660 }]);
  });

  it('stops walking pages when a lying total would otherwise loop forever', async () => {
    // Always a full page, always more to come: only the page cap ends this.
    (appts.listAppointments as any).mockResolvedValue({
      items: page(100, MON),
      total: Number.MAX_SAFE_INTEGER,
      page: 1,
      perPage: 100,
    });
    const byDate = await collectBlockedRanges({ doctorId: DOCTOR_ID, from: MON, to: MON });
    const calls = (appts.listAppointments as any).mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(100);
    expect(byDate[MON]).not.toBeNull();
  });
});
