import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `handleError` in the holidays route used to have `if (!(err instanceof Error))
 * return null;` — added to stop success DTOs (never `Error`s) from being misread as
 * failures, but it also read a genuine non-Error rejection (`throw 'string'`) as
 * success, turning it into a 200 carrying the thrown value as `data`. The route was
 * rewritten to track success/failure structurally (via a `settle` helper) instead of
 * type-sniffing the resolved value, so `handleError` is now only ever called on an
 * actual failure and can safely fail closed on anything it doesn't recognise.
 *
 * `assertPracticeInScope` and the role gate are stubbed so this test exercises only
 * the handleError / settle wiring, not scoping or auth (covered elsewhere).
 */
vi.mock('@/lib/auth/route-guards', () => ({
  requireRoles: vi.fn().mockResolvedValue({ actor: { id: 'test', role: 'SUPER_ADMIN' } }),
}));

vi.mock('@/services/practice/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/practice/service')>();
  return {
    ...actual,
    assertPracticeInScope: vi.fn().mockResolvedValue(undefined),
    listHolidays: vi.fn(),
  };
});

import { GET } from '@/app/api/v1/practices/[id]/holidays/route';
import { listHolidays } from '@/services/practice/service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /practices/:id/holidays — handleError fails closed', () => {
  it('answers 500, not 200, when the service rejects with a non-Error value', async () => {
    (listHolidays as unknown as ReturnType<typeof vi.fn>).mockRejectedValue('boom');
    const req = new NextRequest('http://localhost/api/v1/practices/1/holidays');
    const res = await GET(req, { params: { id: '1' } });
    expect(res.status).toBe(500);
  });
});
