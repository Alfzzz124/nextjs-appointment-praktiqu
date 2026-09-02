/**
 * A transient database outage must reach the guest as a retryable 503 — not a bare 500.
 *
 * Measured on staging 2026-09-02: `praktiqu_wp580` is capped at `max_user_connections=5`
 * while four Passenger workers each open Prisma's default pool, so WordPress answers
 * `<h1>Error establishing a database connection</h1>` and Prisma raises
 * `ERROR 42000 (1226)`. Both fell through this route's final handler as a status-500
 * `Internal Server Error` with no `code`, which is why the front end had to invent
 * `appointment_write_failed` and guessed at corrupt patient data. The booking was
 * retryable the whole time; nothing in the response said so.
 *
 * The distinction that matters here is transient vs permanent. `WpConfigError` is also
 * a 500 and must NOT be advertised as retryable: a missing service token is global and
 * permanent, and telling every guest to try again just hides a broken deploy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/public/public-booking.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/public/public-booking.service')>()),
  createPublicAppointment: vi.fn(),
}));

import { POST } from '@/app/api/v1/public/appointments/route';
import {
  createPublicAppointment,
  AppointmentInsertError,
} from '@/services/public/public-booking.service';
import { WpEndpointError, WpConfigError } from '@/lib/wp-endpoint';

const BODY = {
  professionalId: 34,
  serviceId: 488,
  date: '2026-09-20',
  startTime: '10:00',
  clientName: 'Rafiq Adha',
  clientEmail: 'rafiqadha2001@gmail.com',
  clientMobile: '08120001111',
  holdKey: 'hold-1',
};

/** Each call gets a distinct IP so the route's own rate limiter never interferes. */
let ipCounter = 0;
function post(): Promise<Response> {
  ipCounter += 1;
  return POST(
    new NextRequest('http://x/api/v1/public/appointments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.0.0.${ipCounter}`,
      },
      body: JSON.stringify(BODY),
    }),
  ) as unknown as Promise<Response>;
}

/** Shaped like the Prisma error staging actually raised when the cap was hit. */
function prismaConnectionExhausted(): Error {
  const err = new Error(
    'Invalid `prisma.kcAppointment.findMany()` invocation:\n\nError in connector: ' +
      'Error querying the database: Server error: `ERROR 42000 (1226): ' +
      "User 'praktiqu_wp580' has exceeded the 'max_user_connections' resource " +
      '(current value: 5)',
  );
  err.name = 'PrismaClientUnknownRequestError';
  return err;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /public/appointments — transient database failure', () => {
  it('answers 503 when WordPress could not reach its database', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new WpEndpointError(
        '/appointments failed 500: <h1>Error establishing a database connection</h1>',
        500,
      ),
    );

    const res = await post();

    expect(res.status).toBe(503);
  });

  it('names a retryable code so the front end need not guess', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new WpEndpointError('/appointments failed 500: db down', 500),
    );

    const body = await (await post()).json();

    expect(body.code).toBe('service_unavailable');
  });

  it('sends Retry-After so a client knows when to try again', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new WpEndpointError('/appointments failed 503: overloaded', 503),
    );

    const res = await post();

    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('treats "WordPress never answered" (status 0) as retryable', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new WpEndpointError('/appointments unreachable: ECONNREFUSED', 0),
    );

    expect((await post()).status).toBe(503);
  });

  it('treats Prisma connection exhaustion as retryable', async () => {
    (createPublicAppointment as any).mockRejectedValue(prismaConnectionExhausted());

    expect((await post()).status).toBe(503);
  });

  it('does not spend the guest’s rate-limit budget on an outage', async () => {
    // Retrying is the advice; counting those retries toward a 15-minute lockout
    // contradicts it. Same IP throughout, more attempts than the limiter allows.
    (createPublicAppointment as any).mockRejectedValue(
      new WpEndpointError('/appointments failed 500: db down', 500),
    );

    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = (await POST(
        new NextRequest('http://x/api/v1/public/appointments', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '10.9.9.9',
          },
          body: JSON.stringify(BODY),
        }),
      )) as unknown as Response;
    }

    expect(last!.status).toBe(503);
  });
});

describe('POST /public/appointments — recovers on its own', () => {
  const BOOKED = {
    id: 5150,
    status: 'PENDING',
    date: BODY.date,
    startTime: BODY.startTime,
    service: 'konseling',
    professionalName: 'Dianda',
    clientName: BODY.clientName,
    token: 'tok',
  };

  it('books the guest anyway when the pool frees up on a later attempt', async () => {
    let calls = 0;
    (createPublicAppointment as any).mockImplementation(async () => {
      calls += 1;
      if (calls < 3) {
        throw new WpEndpointError(
          '/appointments failed 500: <h1>Error establishing a database connection</h1>',
          500,
        );
      }
      return BOOKED;
    });

    const res = await post();

    expect(res.status).toBe(201);
    expect(calls).toBe(3);
  });

  it('reports 503 only after its retries are spent', async () => {
    let calls = 0;
    (createPublicAppointment as any).mockImplementation(async () => {
      calls += 1;
      throw new WpEndpointError(
        '/appointments failed 500: <h1>Error establishing a database connection</h1>',
        500,
      );
    });

    const res = await post();

    expect(res.status).toBe(503);
    expect(calls).toBe(3);
  });

  it('never replays a failure that may already have written the appointment', async () => {
    let calls = 0;
    (createPublicAppointment as any).mockImplementation(async () => {
      calls += 1;
      // WordPress answered, so it was alive — a second attempt risks a double booking.
      throw new WpEndpointError('/appointments failed 502: bad gateway', 502);
    });

    const res = await post();

    expect(res.status).toBe(503);
    expect(calls).toBe(1);
  });

  it('never replays a business refusal', async () => {
    let calls = 0;
    (createPublicAppointment as any).mockImplementation(async () => {
      calls += 1;
      throw new AppointmentInsertError('Professional is not attached to a practice');
    });

    await post();

    expect(calls).toBe(1);
  });
});

describe('POST /public/appointments — permanent failures stay non-retryable', () => {
  it('keeps 500 for a missing service token (WpConfigError)', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new WpConfigError('WORDPRESS_SERVICE_TOKEN not set'),
    );

    expect((await post()).status).toBe(500);
  });

  it('keeps 500 when the professional has no practice attached', async () => {
    (createPublicAppointment as any).mockRejectedValue(
      new AppointmentInsertError('Professional is not attached to a practice'),
    );

    expect((await post()).status).toBe(500);
  });
});
