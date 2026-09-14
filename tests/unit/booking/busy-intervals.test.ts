/**
 * Turning Google's busy intervals into the local per-date ranges slot maths uses.
 *
 * This is the sharp edge of the whole feature: Google answers in UTC instants
 * while every other number in the slot path is minutes past LOCAL midnight. Get it
 * wrong and the blocks land hours away — and the symptom is the wrong slots being
 * blocked, not a crash, so nothing fails loudly.
 */
import { describe, it, expect } from 'vitest';
import { busyToBlockedRanges } from '@/services/booking/busy-intervals';

const JAKARTA = 'Asia/Jakarta'; // UTC+7, no DST
const MAKASSAR = 'Asia/Makassar'; // UTC+8

const iv = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe('busyToBlockedRanges', () => {
  it('places an interval on its local date, in local minutes', () => {
    // 07:00Z is 14:00 in Jakarta.
    const out = busyToBlockedRanges([iv('2026-09-20T07:00:00Z', '2026-09-20T08:00:00Z')], JAKARTA);
    expect(out).toEqual({ '2026-09-20': [{ start: 14 * 60, end: 15 * 60 }] });
  });

  it('uses the practice timezone, not the server one', () => {
    const out = busyToBlockedRanges([iv('2026-09-20T07:00:00Z', '2026-09-20T08:00:00Z')], MAKASSAR);
    expect(out).toEqual({ '2026-09-20': [{ start: 15 * 60, end: 16 * 60 }] });
  });

  it('puts a late-evening UTC interval on the NEXT local day in Jakarta', () => {
    // 18:00Z on the 20th is 01:00 on the 21st in Jakarta. Naive date handling
    // would file this under the 20th and block the wrong day entirely.
    const out = busyToBlockedRanges([iv('2026-09-20T18:00:00Z', '2026-09-20T19:00:00Z')], JAKARTA);
    expect(out).toEqual({ '2026-09-21': [{ start: 60, end: 120 }] });
  });

  it('splits an interval that crosses local midnight across both dates', () => {
    // 23:30 to 00:30 local.
    const out = busyToBlockedRanges([iv('2026-09-20T16:30:00Z', '2026-09-20T17:30:00Z')], JAKARTA);
    expect(out).toEqual({
      '2026-09-20': [{ start: 23 * 60 + 30, end: 1440 }],
      '2026-09-21': [{ start: 0, end: 30 }],
    });
  });

  it('covers every day a multi-day interval touches', () => {
    // 09:00 local on the 20th through 11:00 local on the 22nd.
    const out = busyToBlockedRanges([iv('2026-09-20T02:00:00Z', '2026-09-22T04:00:00Z')], JAKARTA);
    expect(out['2026-09-20']).toEqual([{ start: 9 * 60, end: 1440 }]);
    expect(out['2026-09-21']).toEqual([{ start: 0, end: 1440 }]);
    expect(out['2026-09-22']).toEqual([{ start: 0, end: 11 * 60 }]);
  });

  it('keeps a genuine all-day block, because that is leave', () => {
    // Google's generated holiday and birthday calendars are excluded when the
    // connection is saved, so an all-day entry reaching here is one the person
    // put in their own calendar. Ignoring it would offer slots on a day off.
    const out = busyToBlockedRanges([iv('2026-09-19T17:00:00Z', '2026-09-20T17:00:00Z')], JAKARTA);
    expect(out['2026-09-20']).toEqual([{ start: 0, end: 1440 }]);
  });

  it('merges several intervals on the same day, in order', () => {
    const out = busyToBlockedRanges(
      [
        iv('2026-09-20T07:00:00Z', '2026-09-20T08:00:00Z'),
        iv('2026-09-20T02:00:00Z', '2026-09-20T03:00:00Z'),
      ],
      JAKARTA,
    );
    expect(out['2026-09-20']).toEqual([
      { start: 9 * 60, end: 10 * 60 },
      { start: 14 * 60, end: 15 * 60 },
    ]);
  });

  it('ignores an interval that ends before it starts', () => {
    expect(busyToBlockedRanges([iv('2026-09-20T08:00:00Z', '2026-09-20T07:00:00Z')], JAKARTA)).toEqual({});
  });

  it('ignores a zero-length interval', () => {
    expect(busyToBlockedRanges([iv('2026-09-20T07:00:00Z', '2026-09-20T07:00:00Z')], JAKARTA)).toEqual({});
  });

  it('returns nothing for no intervals', () => {
    expect(busyToBlockedRanges([], JAKARTA)).toEqual({});
  });
});
