/**
 * POST /api/v1/public/booking/hold — public, so it must refuse junk and a flood.
 *
 * 2026-11-17 audit, booking-submit-bayar-7: no input validation beyond "non-empty
 * string" and no rate limit, so an anonymous caller could grow the in-memory hold map
 * without bound with arbitrary keys.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/public/booking/hold/route';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { CLIENT_IP_HEADER, FORWARDER_KEY_HEADER } from '@/lib/client-ip';

const GOOD = { professionalId: '7', serviceId: '3', date: '2026-09-20', startTime: '09:00' };
const FORWARDER_SECRET = 'hold-route-test-forwarder-secret';

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

/** A request the FE relays and vouches for: the browser's address plus the shared key. */
function postVouched(body: unknown, clientIp: string) {
  return POST(
    new NextRequest('http://x/api/v1/public/booking/hold', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '192.0.2.10',
        [CLIENT_IP_HEADER]: clientIp,
        [FORWARDER_KEY_HEADER]: FORWARDER_SECRET,
      },
      body: JSON.stringify(body),
    }),
  );
}

const savedSecret = process.env.FE_FORWARDER_SECRET;
beforeAll(() => {
  process.env.FE_FORWARDER_SECRET = FORWARDER_SECRET;
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.FE_FORWARDER_SECRET;
  else process.env.FE_FORWARDER_SECRET = savedSecret;
});

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
  it('never locks out an address it cannot trust, because any caller can forge it', async () => {
    // Unvouched, the address is the first X-Forwarded-For entry, which a direct caller
    // sets at will. Without FE_FORWARDER_SECRET every patient the FE relays shares the FE
    // host's address, so a lockout keyed on it would let anyone who forges that address
    // refuse every patient's booking.
    const feHost = '198.51.100.90';
    for (let i = 0; i < 700; i++) {
      const res = await post({ ...GOOD, startTime: `${String(8 + (i % 12)).padStart(2, '0')}:00` }, feHost);
      expect(res.status).toBe(201);
    }
  });

  it('does not refuse a busy stretch from one vouched address shared by many patients', async () => {
    // Carrier-grade NAT puts many patients behind one public address.
    const shared = '203.0.113.200';
    for (let i = 0; i < 300; i++) {
      const res = await postVouched({ ...GOOD, startTime: `${String(8 + (i % 12)).padStart(2, '0')}:00` }, shared);
      expect(res.status).toBe(201);
    }
  });

  it('answers 429 with Retry-After once one vouched address has asked too often', async () => {
    const ip = '203.0.113.201';
    let last: Response | undefined;
    for (let i = 0; i < 700; i++) {
      last = await postVouched({ ...GOOD, startTime: `${String(9 + (i % 8)).padStart(2, '0')}:00` }, ip);
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });

  it('does not penalise a different vouched address', async () => {
    expect((await postVouched(GOOD, '203.0.113.202')).status).toBe(201);
  });
});
