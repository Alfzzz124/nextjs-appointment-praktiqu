/**
 * Caching Google's free/busy answers.
 *
 * Against the real database, because the cache IS database state: whether a second
 * call avoids Google depends on what the first one actually wrote.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { assertTestDb } from '../../billing/fixtures';

vi.mock('@/lib/google/freebusy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/google/freebusy')>()),
  refreshAccessToken: vi.fn(async () => 'access-token'),
  queryFreeBusy: vi.fn(async () => []),
}));

import { googleBusyForRange } from '@/services/integrations/google-busy.service';
import { saveConnection } from '@/services/integrations/google-calendar-connection.service';
import * as gcal from '@/lib/google/freebusy';

const PRO = 900002;
const JAKARTA = 'Asia/Jakarta';
const DATE = '2026-09-20';
/** 14:00–15:00 Jakarta. */
const BUSY = [{ start: new Date('2026-09-20T07:00:00Z'), end: new Date('2026-09-20T08:00:00Z') }];

async function wipe() {
  assertTestDb();
  await prisma.googleBusyCache.deleteMany({ where: { professionalId: BigInt(PRO) } });
  await prisma.googleCalendarConnection.deleteMany({ where: { professionalId: BigInt(PRO) } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.APP_URL = 'https://staging2.praktiqu.com';
  await wipe();
  await saveConnection({
    professionalId: PRO,
    googleAccountEmail: 'dr@gmail.com',
    refreshToken: 'rt',
    scopeGranted: 'freebusy',
  });
  (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(BUSY);
});
afterAll(wipe);

const ask = (over: Record<string, unknown> = {}) =>
  googleBusyForRange({ professionalId: PRO, from: DATE, to: DATE, timeZone: JAKARTA, ...over });

describe('caching', () => {
  it('asks Google on the first call and converts to local minutes', async () => {
    expect(await ask()).toEqual({ [DATE]: [{ start: 14 * 60, end: 15 * 60 }] });
    expect(gcal.queryFreeBusy).toHaveBeenCalledOnce();
  });

  it('serves the second call from cache, without touching Google', async () => {
    await ask();
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    expect(await ask()).toEqual({ [DATE]: [{ start: 14 * 60, end: 15 * 60 }] });
    expect(gcal.queryFreeBusy).not.toHaveBeenCalled();
  });

  it('caches a day with nothing busy, so an empty answer is not re-fetched', async () => {
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await ask();
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    expect(await ask()).toEqual({});
    expect(gcal.queryFreeBusy).not.toHaveBeenCalled();
  });

  it('asks again once the entry has gone stale', async () => {
    await ask();
    await prisma.googleBusyCache.updateMany({
      where: { professionalId: BigInt(PRO) },
      data: { fetchedAt: new Date(Date.now() - 10 * 60_000) },
    });
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    await ask();
    expect(gcal.queryFreeBusy).toHaveBeenCalledOnce();
  });

  it('treats a different timezone as a miss rather than reusing the minutes', async () => {
    // The stored minutes were converted in one zone; reading them as another would
    // shift every block by the offset between them, silently.
    await ask();
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    const out = await ask({ timeZone: 'Asia/Makassar' });
    expect(gcal.queryFreeBusy).toHaveBeenCalledOnce();
    expect(out).toEqual({ [DATE]: [{ start: 15 * 60, end: 16 * 60 }] });
  });

  it('re-fetches when only part of the range is cached', async () => {
    await ask();
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    await googleBusyForRange({
      professionalId: PRO, from: DATE, to: '2026-09-21', timeZone: JAKARTA,
    });
    expect(gcal.queryFreeBusy).toHaveBeenCalledOnce();
  });

  it('bypasses the cache entirely when asked to', async () => {
    // The booking write path passes this: it is one call per booking, not one per
    // page render, and it is the last check before money and a patient's time are
    // committed.
    await ask();
    (gcal.queryFreeBusy as unknown as ReturnType<typeof vi.fn>).mockClear();

    await ask({ cache: false });
    expect(gcal.queryFreeBusy).toHaveBeenCalledOnce();
  });
});
