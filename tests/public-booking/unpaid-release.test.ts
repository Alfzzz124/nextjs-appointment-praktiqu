/**
 * POST /public/appointments schedules the release of an unpaid guest booking, and only
 * that.
 *
 * The exemption is the part that can do damage. The Laravel FE's "Appointment Manual"
 * books through this same endpoint on a client's behalf, and staff mark that booking
 * paid by hand later. Releasing it would cancel staff work in silence and mail the
 * patient a cancellation. Those requests carry the staff member's bearer, often an
 * expired one, because the FE only refreshes on a 401 from a non-public call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

vi.mock('@/services/public/public-booking.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/public/public-booking.service')>()),
  createPublicAppointment: vi.fn(),
  getPublicAppointmentById: vi.fn(),
}));

vi.mock('@/services/public/booking-idempotency.service', () => ({
  claimIdempotencyKey: vi.fn(),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  bookingFingerprintOf: vi.fn(() => 'fp'),
}));

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

import { POST } from '@/app/api/v1/public/appointments/route';
import * as booking from '@/services/public/public-booking.service';
import * as idem from '@/services/public/booking-idempotency.service';

const APPT_ID = 8_750_010;
const APPT = {
  id: APPT_ID,
  status: 'PENDING',
  date: '2026-10-20',
  startTime: '10:00',
  service: 'Konseling',
  professionalName: 'Pamela Dewi',
  clientName: 'Ada Lovelace',
  clinicId: 4,
  token: 'signed-token',
};

// The key getActor verifies with (src/lib/auth.ts).
const KEY = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

/** A token shaped like the ones issueAccessToken mints, with a controllable lifetime. */
async function bearer(
  role: string,
  { expiredSecondsAgo, key = KEY }: { expiredSecondsAgo?: number; key?: Uint8Array } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = expiredSecondsAgo === undefined ? now + 900 : now - expiredSecondsAgo;
  const token = await new SignJWT({ role, email: 'staf@klinik.test', username: 'staf', type: 'access', jti: 'j' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('user-staf')
    .setIssuedAt(exp - 900)
    .setExpirationTime(exp)
    .sign(key);
  return `Bearer ${token}`;
}

let n = 0;
function post(opts: { authorization?: string; idempotencyKey?: string } = {}): Promise<Response> {
  n += 1;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // A distinct IP per request keeps the route's module-level rate limiter out of the way.
    'x-forwarded-for': `10.9.0.${n}`,
  };
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  return POST(
    new NextRequest('http://x/api/v1/public/appointments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        professionalId: 34,
        serviceId: 488,
        date: '2026-10-20',
        startTime: '10:00',
        clientName: 'Ada Lovelace',
        clientEmail: `ada${n}@contoh.test`,
        clientMobile: '08120001111',
        holdKey: 'hold-1',
      }),
    }),
  ) as unknown as Promise<Response>;
}

function releaseCalls() {
  return jobsClient.jobs.enqueue.mock.calls.filter(
    ([o]: [{ hook: string }]) => o.hook === 'praktiqu_booking_unpaid_cancel',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES;
  vi.mocked(booking.createPublicAppointment).mockResolvedValue(APPT as never);
  vi.mocked(idem.claimIdempotencyKey).mockResolvedValue({ kind: 'claimed' });
});

describe('POST /public/appointments — release of an unpaid booking', () => {
  it('schedules the release for a guest booking', async () => {
    const before = Date.now();
    const res = await post();

    expect(res.status).toBe(201);
    const calls = releaseCalls();
    expect(calls).toHaveLength(1);
    const [{ runAt, args }] = calls[0];
    expect(args).toEqual({ appointmentId: APPT_ID });
    // Default TTL: 60 minutes from now.
    expect(runAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(runAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
  });

  it.each(['RECEPTIONIST', 'CLINIC_ADMIN', 'SUPER_ADMIN', 'PROFESSIONAL'])(
    'does not schedule it when a %s made the booking',
    async (role) => {
      const res = await post({ authorization: await bearer(role) });

      expect(res.status).toBe(201);
      expect(releaseCalls()).toHaveLength(0);
    },
  );

  it('still exempts staff whose access token expired while the form was open', async () => {
    const res = await post({ authorization: await bearer('RECEPTIONIST', { expiredSecondsAgo: 20 * 60 }) });

    expect(res.status).toBe(201);
    expect(releaseCalls()).toHaveLength(0);
  });

  it('does not exempt a staff token older than the refresh-token lifetime', async () => {
    const res = await post({
      authorization: await bearer('RECEPTIONIST', { expiredSecondsAgo: 8 * 24 * 60 * 60 }),
    });

    expect(res.status).toBe(201);
    expect(releaseCalls()).toHaveLength(1);
  });

  it('schedules it for a patient signed in as CLIENT', async () => {
    await post({ authorization: await bearer('CLIENT') });

    expect(releaseCalls()).toHaveLength(1);
  });

  it('schedules it when the bearer is forged, so a guest cannot exempt themself', async () => {
    const forged = await bearer('SUPER_ADMIN', { key: new TextEncoder().encode('not-our-secret') });

    await post({ authorization: forged });

    expect(releaseCalls()).toHaveLength(1);
  });

  it('schedules it when the Authorization header is garbage', async () => {
    await post({ authorization: 'Bearer not.a.jwt' });

    expect(releaseCalls()).toHaveLength(1);
  });

  it('schedules nothing when PUBLIC_BOOKING_UNPAID_TTL_MINUTES is 0', async () => {
    process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES = '0';

    const res = await post();

    expect(res.status).toBe(201);
    expect(releaseCalls()).toHaveLength(0);
  });

  it('still answers 201 when scheduling fails; the booking exists', async () => {
    jobsClient.jobs.enqueue.mockRejectedValueOnce(new Error('WordPress unreachable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post({ idempotencyKey: 'k-enqueue-fails' });

    expect(res.status).toBe(201);
    // The key must NOT be handed back: a retry with it would book the patient twice.
    expect(idem.releaseIdempotencyKey).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not schedule a second release on an Idempotency-Key replay', async () => {
    vi.mocked(idem.claimIdempotencyKey).mockResolvedValue({ kind: 'replay', appointmentId: APPT_ID });
    vi.mocked(booking.getPublicAppointmentById).mockResolvedValue(APPT as never);

    const res = await post({ idempotencyKey: 'k-replay' });

    expect(res.status).toBe(200);
    expect(releaseCalls()).toHaveLength(0);
  });

  it('schedules nothing when the booking itself fails', async () => {
    vi.mocked(booking.createPublicAppointment).mockRejectedValue(
      new booking.SlotConflictError('Slot no longer available'),
    );

    const res = await post();

    expect(res.status).toBe(409);
    expect(releaseCalls()).toHaveLength(0);
  });
});
