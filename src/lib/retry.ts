/**
 * Replaying an operation that provably did nothing.
 *
 * The motivating case: `praktiqu_wp580` is capped at five MySQL connections, so a guest
 * booking can fail purely because the pool was momentarily full. Nothing about that is
 * the guest's problem, and asking them to press the button again is a poor way to spend
 * a cap that frees in milliseconds.
 *
 * Two constraints shape this:
 *
 * 1. **Only provably-no-work failures.** The gate is `isRetrySafeFailure`, not
 *    `isTransientBackendFailure`. The appointment write is not idempotent, so anything
 *    ambiguous must reach the client rather than be replayed here.
 * 2. **A small budget.** Retrying into an exhausted pool is what turns a busy moment
 *    into an outage, and each attempt holds a Passenger worker. Three attempts with
 *    growing, jittered backoff cost at most ~0.5s and stop well short of a storm.
 */

import { isRetrySafeFailure } from '@/lib/transient-failure';

/** Backoff before attempts 2 and 3. Growing, so a full pool gets time to drain. */
const DEFAULT_DELAYS_MS: readonly number[] = [120, 300];

const DEFAULT_ATTEMPTS = 3;

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base backoff before each retry; the last value repeats if attempts exceed it. */
  delaysMs?: readonly number[];
  /** Injectable for tests — production uses a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jitter so that N workers failing on the same saturated pool do not all come back at
 * the same instant. Upward only, so backoff stays monotonic and testable.
 */
function jitter(base: number): number {
  return Math.round(base * (1 + Math.random() * 0.25));
}

/**
 * Run `op`, replaying it while it fails in a way that proves nothing was written.
 *
 * Rethrows the last failure once the budget is spent, and rethrows immediately —
 * without sleeping — for any failure that is not retry-safe.
 */
export async function withRetry<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= attempts || !isRetrySafeFailure(err)) throw err;

      const base = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
      await sleep(jitter(base));
    }
  }
}
