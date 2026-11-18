/**
 * POST /api/v1/public/booking/hold — public, so it must refuse junk and a flood.
 *
 * 2026-11-17 audit, booking-submit-bayar-7: no input validation beyond "non-empty
 * string" and no rate limit, so an anonymous caller could grow the in-memory hold map
 * without bound with arbitrary keys.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/public/booking/hold/route';
import { slotHoldService } from '@/services/booking/slot-hold.service';

const GOOD = { professionalId: '7', serviceId: '3', date: '2026-09-20', startTime: '09:00' };

let ipCounter = 0;
/** Each test gets its own address so the module-level limiter never leaks between them. */
function post(body: unknown, ip = `203.0.113.${(ipCounter += 1)}`, raw?: string) {
  return POST(
    new NextRequest('http://x/api/v1/public/booking/hold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  slotHoldService.sweep();
});

describe('input validation', () => {
  it('accepts a well-formed hold', async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ holdKey: '7:3:2026-09-20:09:00' });
  });

  it.each([
    ['a non-numeric professional id', { ...GOOD, professionalId: 'abc:../x' }],
    ['a non-numeric service id', { ...GOOD, serviceId: '3; DROP' }],
    ['a date that is not YYYY-MM-DD', { ...GOOD, date: '20-09-2026' }],
    ['a time that is not HH:MM', { ...GOOD, startTime: '9am' }],
    ['an absurdly long id', { ...GOOD, professionalId: '1'.repeat(500) }],
  ])('answers 400 for %s, and stores nothing', async (_label, body) => {
    const before = slotHoldService.size;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(slotHoldService.size).toBe(before);
  });

  it('answers 400 rather than 500 for a body that is not JSON', async () => {
    const res = await post(undefined, undefined, '{not json');
    expect(res.status).toBe(400);
  });
});

describe('rate limit', () => {
  it('does not refuse a busy hour of real bookings that all arrive from one address', async () => {
    // The Laravel FE calls this endpoint server-side for every patient. Unless
    // FE_FORWARDER_SECRET is set on both sides (src/lib/client-ip.ts), they all share the
    // FE host's address, and each booking may take up to six holds while it retries. A
    // limit sized for one browser would then refuse the whole platform.
    const ip = '198.51.100.90';
    for (let i = 0; i < 300; i++) {
      const res = await post({ ...GOOD, startTime: `${String(8 + (i % 12)).padStart(2, '0')}:00` }, ip);
      expect(res.status).toBe(201);
    }
  });

  it('answers 429 with Retry-After once one address has asked too often', async () => {
    const ip = '198.51.100.77';
    let last: Response | undefined;
    for (let i = 0; i < 700; i++) {
      last = await post({ ...GOOD, startTime: `${String(9 + (i % 8)).padStart(2, '0')}:00` }, ip);
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });

  it('does not penalise a different address', async () => {
    expect((await post(GOOD, '198.51.100.78')).status).toBe(201);
  });
});
