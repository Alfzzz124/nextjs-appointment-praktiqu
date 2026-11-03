import { describe, expect, it } from 'vitest';
import type { OverlapPair } from '@/repositories/wp/appointments.repo';
import {
  fingerprintOf,
  isUpcoming,
  overlapEndsAt,
  planNotices,
  scanFromDate,
  type SentNotice,
} from '@/services/schedule/conflict-pairs';

function pair(over: Partial<OverlapPair> = {}, lowId = 3401, highId = 3405): OverlapPair {
  return {
    doctorId: 34,
    date: '2026-10-23',
    timezone: 'Asia/Jakarta',
    low: { id: lowId, clinicId: 4, status: 1, startTime: '09:00:00', endTime: '10:00:00' },
    high: { id: highId, clinicId: 4, status: 2, startTime: '09:30:00', endTime: '10:30:00' },
    ...over,
  };
}

const psikolog = { email: 'dianda@klinik.test', name: 'Dianda' };
const admin = { email: 'admin@klinik.test', name: 'Admin Klinik' };

describe('scanFromDate', () => {
  it('is the UTC date of the day before now, whatever the hour', () => {
    expect(scanFromDate(new Date('2026-10-22T01:00:00Z'))).toBe('2026-10-21');
    expect(scanFromDate(new Date('2026-10-22T23:30:00Z'))).toBe('2026-10-21');
    expect(scanFromDate(new Date('2026-03-01T00:00:00Z'))).toBe('2026-02-28');
  });
});

describe('overlapEndsAt', () => {
  it('is the earlier end, in the pair zone', () => {
    // 10:00 WIB = 03:00 UTC
    expect(overlapEndsAt(pair()).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });

  it('takes the high side end when that one is earlier', () => {
    const p = pair({
      low: { id: 1, clinicId: 4, status: 1, startTime: '09:00:00', endTime: '11:00:00' },
      high: { id: 2, clinicId: 4, status: 1, startTime: '09:30:00', endTime: '10:00:00' },
    });
    expect(overlapEndsAt(p).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });

  it('reads the clock of another zone', () => {
    // London is on BST (UTC+1) on 23 October 2026
    expect(overlapEndsAt(pair({ timezone: 'Europe/London' })).toISOString()).toBe('2026-10-23T09:00:00.000Z');
  });

  it('falls back to Asia/Jakarta when KiviCare left the zone empty', () => {
    expect(overlapEndsAt(pair({ timezone: '' })).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });
});

describe('isUpcoming', () => {
  it('keeps a clash until its overlap ends, and drops it at that instant', () => {
    expect(isUpcoming(pair(), new Date('2026-10-22T12:00:00Z'))).toBe(true);
    expect(isUpcoming(pair(), new Date('2026-10-23T02:59:59Z'))).toBe(true); // still running
    expect(isUpcoming(pair(), new Date('2026-10-23T03:00:00Z'))).toBe(false);
    expect(isUpcoming(pair(), new Date('2026-10-24T00:00:00Z'))).toBe(false);
  });

  it('counts an unreadable zone as upcoming: one email too many beats a missed clash', () => {
    expect(isUpcoming(pair({ timezone: 'Mars/Olympus' }), new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('fingerprintOf', () => {
  it('captures the date and both time ranges, not the statuses', () => {
    expect(fingerprintOf(pair())).toBe('2026-10-23|09:00:00-10:00:00|09:30:00-10:30:00');
    const statusOnly = pair({ high: { ...pair().high, status: 1 } });
    expect(fingerprintOf(statusOnly)).toBe(fingerprintOf(pair()));
  });
});

describe('planNotices', () => {
  const told = (p: OverlapPair, recipient: string, fingerprint = fingerprintOf(p)): SentNotice => ({
    appointmentLowId: p.low.id,
    appointmentHighId: p.high.id,
    recipient,
    fingerprint,
  });

  it('gives a new clash to every recipient', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [psikolog, admin] }], [])).toEqual([
      { recipient: psikolog, pairs: [p] },
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('mails one address once, whatever its case, under the name it first appeared with', () => {
    const p = pair();
    const owner = { email: ' Dianda@Klinik.TEST ', name: 'Pemilik' };
    expect(planNotices([{ pair: p, recipients: [psikolog, owner] }], [])).toEqual([
      { recipient: psikolog, pairs: [p] },
    ]);
  });

  it('skips an empty address', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [{ email: '', name: 'X' }, admin] }], [])).toEqual([
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('skips what a recipient was already told, but not someone else', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [psikolog, admin] }], [told(p, psikolog.email)])).toEqual([
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('tells again when the clash moved but still overlaps', () => {
    const p = pair();
    const old = told(p, psikolog.email, '2026-10-23|09:00:00-10:00:00|09:45:00-10:45:00');
    expect(planNotices([{ pair: p, recipients: [psikolog] }], [old])).toEqual([
      { recipient: psikolog, pairs: [p] },
    ]);
  });

  it('collects every new clash of one recipient into one entry, in order', () => {
    const a = pair({}, 1, 2);
    const b = pair({ date: '2026-10-24' }, 3, 4);
    expect(
      planNotices(
        [
          { pair: a, recipients: [psikolog] },
          { pair: b, recipients: [psikolog, admin] },
        ],
        [],
      ),
    ).toEqual([
      { recipient: psikolog, pairs: [a, b] },
      { recipient: admin, pairs: [b] },
    ]);
  });
});
