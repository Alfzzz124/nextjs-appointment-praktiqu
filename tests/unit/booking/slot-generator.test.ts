// tests/unit/booking/slot-generator.test.ts
import { describe, it, expect } from 'vitest';
import { generateSlots, formatSlotLabel } from '@/services/booking/slot-generator';

const baseDate = new Date('2026-06-04T00:00:00'); // Thursday
const baseAvailability = [
  { dayOfWeek: 4, startMinute: 9 * 60, endMinute: 17 * 60 }, // 09:00-17:00
];

describe('generateSlots', () => {
  it('returns empty for wrong day', () => {
    const monday = new Date('2026-06-01T00:00:00');
    const slots = generateSlots({ date: monday, duration: 60, availability: baseAvailability, existingBookings: [] });
    expect(slots).toEqual([]);
  });

  it('generates slots for matching day', () => {
    const slots = generateSlots({ date: baseDate, duration: 60, availability: baseAvailability, existingBookings: [] });
    expect(slots.length).toBe(8); // 09, 10, 11, 12, 13, 14, 15, 16
    expect(slots[0].startTime).toBe('09:00');
    expect(slots[0].endTime).toBe('10:00');
  });

  it('excludes overlapping bookings', () => {
    const conflict = new Date('2026-06-04T10:00:00');
    const slots = generateSlots({
      date: baseDate,
      duration: 60,
      availability: baseAvailability,
      existingBookings: [{ startUtc: conflict, endUtc: new Date('2026-06-04T11:00:00') }],
    });
    expect(slots.find((s) => s.startTime === '10:00')).toBeUndefined();
  });

  it('respects interval smaller than duration', () => {
    const slots = generateSlots({
      date: baseDate,
      duration: 60,
      availability: baseAvailability,
      existingBookings: [],
      slotIntervalMinutes: 30,
    });
    expect(slots.length).toBeGreaterThan(8);
  });
});

describe('formatSlotLabel', () => {
  it('formats HH:mm range', () => {
    expect(formatSlotLabel({ startTime: '09:00', endTime: '10:00', startUtc: new Date(), endUtc: new Date() })).toBe('09:00 – 10:00');
  });
});