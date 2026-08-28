// tests/unit/booking/slot-math.test.ts
import { describe, it, expect } from 'vitest';
import {
  blockedRangesFor,
  buildDaySlots,
  eachDate,
  toMinutes,
  toTime,
} from '@/services/booking/slot-math';

const nineToTwelve = { startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 };

describe('buildDaySlots', () => {
  it('fills a window back to back', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [] })).toEqual([
      { startTime: '09:00:00', endTime: '10:00:00' },
      { startTime: '10:00:00', endTime: '11:00:00' },
      { startTime: '11:00:00', endTime: '12:00:00' },
    ]);
  });

  it('drops a slot a block partially overlaps', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60 + 30, end: 11 * 60 }], // 10:30–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('keeps the slots on either side of an exactly-aligned block', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60, end: 11 * 60 }], // 10:00–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('lets a service duration override the window slot size', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [], durationMinutes: 90 })).toEqual([
      { startTime: '09:00:00', endTime: '10:30:00' },
      { startTime: '10:30:00', endTime: '12:00:00' },
    ]);
  });

  it('emits nothing when the window cannot fit one slot', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '09:30:00', slotDurationMinutes: 60 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('skips a window whose duration is not positive', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 0 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('handles several windows in one day', () => {
    const slots = buildDaySlots({
      windows: [
        nineToTwelve,
        { startTime: '14:00:00', endTime: '15:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [],
    });
    expect(slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00', '14:00:00',
    ]);
  });
});

describe('blockedRangesFor', () => {
  it('returns null when a full-day off day covers the date', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: false, startTime: null, endTime: null }],
      appointments: [],
    });
    expect(blocked).toBeNull();
  });

  it('returns an empty list when nothing blocks', () => {
    expect(blockedRangesFor({ offDays: [], appointments: [] })).toEqual([]);
  });

  it('converts a time-specific off day', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' }],
      appointments: [],
    });
    expect(blocked).toEqual([{ start: 600, end: 660 }]);
  });

  it('converts an appointment', () => {
    const blocked = blockedRangesFor({
      offDays: [],
      appointments: [{ startTime: '14:00:00', endTime: '15:00:00' }],
    });
    expect(blocked).toEqual([{ start: 840, end: 900 }]);
  });

  it('combines off days and appointments', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' }],
      appointments: [{ startTime: '14:00:00', endTime: '15:00:00' }],
    });
    expect(blocked).toEqual([{ start: 600, end: 660 }, { start: 840, end: 900 }]);
  });

  it('skips a time-specific off day with no times recorded', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: null, endTime: null }],
      appointments: [],
    });
    expect(blocked).toEqual([]);
  });

  it('skips an appointment with no times recorded', () => {
    const blocked = blockedRangesFor({
      offDays: [],
      appointments: [{ startTime: '14:00:00', endTime: null }],
    });
    expect(blocked).toEqual([]);
  });
});

describe('eachDate', () => {
  it('includes both ends', () => {
    expect(eachDate('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28', '2026-08-29', '2026-08-30',
    ]);
  });

  it('returns one date when from equals to', () => {
    expect(eachDate('2026-08-28', '2026-08-28')).toEqual(['2026-08-28']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDate('2026-08-30', '2026-08-28')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(eachDate('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01',
    ]);
  });
});

describe('toMinutes / toTime', () => {
  it('round-trips a time', () => {
    expect(toTime(toMinutes('14:45:00'))).toBe('14:45:00');
  });

  it('converts midnight to zero', () => {
    expect(toMinutes('00:00:00')).toBe(0);
  });
});
