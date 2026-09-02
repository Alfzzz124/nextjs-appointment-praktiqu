/**
 * When is a failed booking safe to replay?
 *
 * `createAppointment` is not idempotent: replay it after a write that actually landed
 * and the guest gets two appointments. So auto-retry is gated on a stricter question
 * than "was this transient" — it must be provable that the attempt did **no work**.
 *
 * Three failures prove that:
 *   - `WpEndpointError` status 0 — `wpFetch` never reached WordPress at all.
 *   - WordPress's bootstrap DB failure — core prints
 *     `<h1>Error establishing a database connection</h1>` and dies before any plugin
 *     code runs, so the appointment write cannot have started.
 *   - Prisma failing to *acquire* a connection (1226, 1040, P1001, P1017, pool
 *     timeout) — the statement was never sent.
 *
 * Any other 5xx is ambiguous: WordPress answered, so it was alive, so it may have
 * written before it failed. Those stay a single attempt and surface as a retryable 503
 * for the client to decide about — a duplicate appointment is worse than a retry the
 * guest makes knowingly.
 */
import { describe, it, expect, vi } from 'vitest';
import { isRetrySafeFailure } from '@/lib/transient-failure';
import { withRetry } from '@/lib/retry';
import { WpEndpointError, WpConfigError } from '@/lib/wp-endpoint';

function prismaErr(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const WP_BOOTSTRAP_DB_FAILURE = new WpEndpointError(
  '/appointments failed 500: <h1>Error establishing a database connection</h1>',
  500,
);

describe('isRetrySafeFailure — proves the attempt did no work', () => {
  it('accepts "WordPress never answered" (status 0)', () => {
    expect(isRetrySafeFailure(new WpEndpointError('/appointments unreachable', 0))).toBe(true);
  });

  it('accepts WordPress dying before plugin code ran', () => {
    expect(isRetrySafeFailure(WP_BOOTSTRAP_DB_FAILURE)).toBe(true);
  });

  it('accepts Prisma failing to acquire a connection (1226)', () => {
    expect(
      isRetrySafeFailure(
        prismaErr(
          'PrismaClientUnknownRequestError',
          "ERROR 42000 (1226): User 'praktiqu_wp580' has exceeded the 'max_user_connections' resource",
        ),
      ),
    ).toBe(true);
  });

  it('accepts a Prisma pool timeout', () => {
    expect(
      isRetrySafeFailure(
        prismaErr(
          'PrismaClientKnownRequestError',
          'Timed out fetching a new connection from the connection pool',
        ),
      ),
    ).toBe(true);
  });

  it('refuses an ambiguous 5xx — WordPress was alive and may have written', () => {
    expect(isRetrySafeFailure(new WpEndpointError('/appointments failed 502', 502))).toBe(false);
  });

  it('refuses a missing service token — permanent, not busy', () => {
    expect(isRetrySafeFailure(new WpConfigError('WORDPRESS_SERVICE_TOKEN not set'))).toBe(false);
  });

  it('refuses a Prisma error that is not about acquiring a connection', () => {
    expect(
      isRetrySafeFailure(
        prismaErr('PrismaClientValidationError', 'Unknown argument `foo`'),
      ),
    ).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the value without sleeping when the first attempt succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withRetry(async () => 'ok', { sleep });

    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('replays a retry-safe failure and returns the later success', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      if (attempts < 3) throw WP_BOOTSTRAP_DB_FAILURE;
      return 'booked';
    };

    const result = await withRetry(op, { sleep: async () => {} });

    expect(result).toBe('booked');
    expect(attempts).toBe(3);
  });

  it('backs off between attempts rather than hammering a saturated pool', async () => {
    const waits: number[] = [];
    const op = async () => {
      throw WP_BOOTSTRAP_DB_FAILURE;
    };

    await expect(
      withRetry(op, { sleep: async (ms) => void waits.push(ms) }),
    ).rejects.toThrow();

    expect(waits.length).toBeGreaterThan(0);
    expect(waits[waits.length - 1]).toBeGreaterThan(waits[0]!);
  });

  it('gives up and rethrows the last failure once the budget is spent', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      throw WP_BOOTSTRAP_DB_FAILURE;
    };

    await expect(withRetry(op, { sleep: async () => {} })).rejects.toBe(WP_BOOTSTRAP_DB_FAILURE);
    expect(attempts).toBeLessThanOrEqual(3);
    expect(attempts).toBeGreaterThan(1);
  });

  it('does not replay a failure that may have written', async () => {
    let attempts = 0;
    const ambiguous = new WpEndpointError('/appointments failed 502', 502);
    const op = async () => {
      attempts += 1;
      throw ambiguous;
    };

    await expect(withRetry(op, { sleep: async () => {} })).rejects.toBe(ambiguous);
    expect(attempts).toBe(1);
  });

  it('does not replay a business refusal', async () => {
    let attempts = 0;
    const refusal = new Error('Slot no longer available');
    const op = async () => {
      attempts += 1;
      throw refusal;
    };

    await expect(withRetry(op, { sleep: async () => {} })).rejects.toBe(refusal);
    expect(attempts).toBe(1);
  });
});
