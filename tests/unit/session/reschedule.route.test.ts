/**
 * POST /api/v1/sessions/:id/reschedule — the HTTP contract the Laravel FE reads.
 *
 * Errors are problem+json with the code in `title`, like the other session action routes
 * (cancel, approve, check-in), because that is where SessionStatusController looks.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const svc = vi.hoisted(() => ({ rescheduleSession: vi.fn() }));
vi.mock('@/services/session/reschedule.service', () => svc);

const auth = vi.hoisted(() => ({ sessionActorFromRequest: vi.fn() }));
vi.mock('@/lib/auth/session-actor', () => auth);

import { POST } from '@/app/api/v1/sessions/[id]/reschedule/route';
import { SessionServiceError } from '@/services/session/session.service';
import { AuthError } from '@/lib/auth';
import { WpEndpointError } from '@/lib/wp-endpoint';

const ACTOR = { id: 'wpu_24', role: 'CLINIC_ADMIN', practiceId: '3' };

function post(id: string, body: unknown) {
  return POST(
    new NextRequest(`http://test/api/v1/sessions/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.sessionActorFromRequest.mockResolvedValue(ACTOR);
  svc.rescheduleSession.mockResolvedValue({ id: 812, slotDate: '2026-10-22', startTime: '10:00:00' });
});

describe('POST /api/v1/sessions/:id/reschedule', () => {
  it('moves the session and answers the re-read session', async () => {
    const res = await post('812', { slotDate: '2026-10-22', startTime: '10:00', reason: 'Psikolog berhalangan' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: 812, slotDate: '2026-10-22', startTime: '10:00:00' } });
    expect(svc.rescheduleSession).toHaveBeenCalledWith({
      actor: ACTOR,
      sessionId: 812,
      slotDate: '2026-10-22',
      startTime: '10:00',
      reason: 'Psikolog berhalangan',
    });
  });

  it('treats an empty reason as none', async () => {
    await post('812', { slotDate: '2026-10-22', startTime: '10:00:00', reason: '' });
    expect(svc.rescheduleSession.mock.calls[0][0].reason).toBeUndefined();
  });

  it.each([
    [{ startTime: '10:00' }, 'no date'],
    [{ slotDate: '22-10-2026', startTime: '10:00' }, 'a date in the wrong format'],
    [{ slotDate: '2026-10-22', startTime: '25:00' }, 'an hour that does not exist'],
    [{ slotDate: '2026-10-22', startTime: '10:00', reason: 'x'.repeat(501) }, 'a reason over 500 characters'],
  ] as Array<[Record<string, unknown>, string]>)('refuses %o (%s) with 422', async (body) => {
    const res = await post('812', body);
    expect(res.status).toBe(422);
    expect(svc.rescheduleSession).not.toHaveBeenCalled();
  });

  it('refuses a non-numeric id with 400', async () => {
    expect((await post('abc', { slotDate: '2026-10-22', startTime: '10:00' })).status).toBe(400);
  });

  it('answers a refusal as problem+json with its code in title', async () => {
    svc.rescheduleSession.mockRejectedValue(new SessionServiceError('slot_taken', 'That slot is no longer available', 409));
    const res = await post('812', { slotDate: '2026-10-22', startTime: '10:00' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      type: '/errors/slot_taken',
      title: 'slot_taken',
      status: 409,
      detail: 'That slot is no longer available',
    });
  });

  it.each([
    [500, 'praktiqu_schedule_db_error'],
    [0, undefined],
  ])('answers an unmapped plugin failure (%s) with 503, telling the user to look', async (status, code) => {
    svc.rescheduleSession.mockRejectedValue(new WpEndpointError('x', status, code));
    const res = await post('812', { slotDate: '2026-10-22', startTime: '10:00' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ title: 'upstream_write_failed', detail: expect.stringContaining('Reload') });
  });

  it('answers a missing login with 401', async () => {
    auth.sessionActorFromRequest.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await post('812', { slotDate: '2026-10-22', startTime: '10:00' })).status).toBe(401);
  });
});
