/**
 * GET /public/professionals/:id/slots without `date` means "today" in the clinic zone.
 *
 * It used toISOString(), the UTC date, which is still yesterday from 00:00 to 07:00 WIB.
 * The booking policy then treated every slot of that "today" as past, and the response
 * was empty for seven hours a day. toISOString is UTC under any process TZ, so this fails
 * the same way on every server. (2026-11-18 review of fix/zona-waktu-klinik.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/public/public-catalog.service', () => ({
  getPublicSlots: vi.fn(async () => []),
}));

import { GET } from '@/app/api/v1/public/professionals/[id]/slots/route';
import { getPublicSlots } from '@/services/public/public-catalog.service';

function get(query: string) {
  return GET(new NextRequest(`http://x/api/v1/public/professionals/7/slots?${query}`), { params: { id: '7' } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(getPublicSlots).mockClear();
});

describe('GET /public/professionals/:id/slots — default date', () => {
  it('is today in WIB, not the UTC date, in the early-morning hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T20:30:00Z')); // 03:30 WIB on 19 November

    const res = await get('serviceId=3');

    expect(res.status).toBe(200);
    expect((await res.json()).date).toBe('2026-11-19');
    expect(vi.mocked(getPublicSlots).mock.calls[0][0]).toMatchObject({ date: '2026-11-19' });
  });

  it('keeps an explicit date as given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T20:30:00Z'));

    const res = await get('serviceId=3&date=2026-12-01');

    expect((await res.json()).date).toBe('2026-12-01');
  });
});
