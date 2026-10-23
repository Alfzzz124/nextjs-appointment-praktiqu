// tests/unit/booking/booking-window.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOOKING_WINDOW,
  bookingDateVerdict,
  type BookingWindow,
} from '@/services/booking/booking-policy';
import { parseBookingWindow } from '@/services/booking/booking-window';

describe('parseBookingWindow', () => {
  it('reads the array KiviCare saves', () => {
    expect(parseBookingWindow('a:2:{s:4:"post";i:30;s:3:"pre";i:1;}', 'off')).toEqual({
      minDaysAhead: 1,
      maxDaysAhead: 30,
      sameDayOnly: false,
    });
  });

  it('falls back to KiviCare defaults when nobody has saved the setting', () => {
    expect(parseBookingWindow(undefined, undefined)).toEqual(DEFAULT_BOOKING_WINDOW);
  });

  it('reads numeric strings the way PHP (int) does', () => {
    expect(parseBookingWindow('a:2:{s:4:"post";s:2:"60";s:3:"pre";s:1:"2";}', undefined)).toMatchObject({
      minDaysAhead: 2,
      maxDaysAhead: 60,
    });
  });

  it('defaults a missing or negative member on its own', () => {
    expect(parseBookingWindow('a:1:{s:3:"pre";i:-1;}', undefined)).toMatchObject({
      minDaysAhead: 0,
      maxDaysAhead: 365,
    });
  });

  it('ignores garbage rather than throwing', () => {
    expect(parseBookingWindow('not serialized', 'garbage')).toEqual(DEFAULT_BOOKING_WINDOW);
  });

  it.each([
    ['on', true],
    ['s:2:"on";', true],
    ['1', true],
    ['off', false],
    ['s:3:"off";', false],
  ])('same-day flag %s -> %s', (raw, expected) => {
    expect(parseBookingWindow(undefined, raw).sameDayOnly).toBe(expected);
  });
});

describe('bookingDateVerdict', () => {
  // Late evening on purpose: a whole-day rule must not care how close to midnight it is.
  const NOW = new Date('2026-10-23T22:30:00');
  const h1: BookingWindow = { minDaysAhead: 1, maxDaysAhead: 30, sameDayOnly: false };

  it('H-1 closes today and opens tomorrow', () => {
    expect(bookingDateVerdict('2026-10-23', NOW, h1)).toBe('too_soon');
    expect(bookingDateVerdict('2026-10-24', NOW, h1)).toBe('ok');
  });

  it('includes the last day and closes the one after', () => {
    expect(bookingDateVerdict('2026-11-22', NOW, h1)).toBe('ok');
    expect(bookingDateVerdict('2026-11-23', NOW, h1)).toBe('too_far');
  });

  it('the default window leaves today open and the past closed', () => {
    expect(bookingDateVerdict('2026-10-23', NOW, DEFAULT_BOOKING_WINDOW)).toBe('ok');
    expect(bookingDateVerdict('2026-10-22', NOW, DEFAULT_BOOKING_WINDOW)).toBe('too_soon');
  });

  it('same-day only overrides the day counts', () => {
    const sameDay = { ...h1, sameDayOnly: true };
    expect(bookingDateVerdict('2026-10-23', NOW, sameDay)).toBe('ok');
    expect(bookingDateVerdict('2026-10-24', NOW, sameDay)).toBe('too_far');
    expect(bookingDateVerdict('2026-10-22', NOW, sameDay)).toBe('too_soon');
  });

  it('crosses a month end by calendar days', () => {
    const now = new Date('2026-10-31T09:00:00');
    expect(bookingDateVerdict('2026-11-01', now, h1)).toBe('ok');
  });
});
