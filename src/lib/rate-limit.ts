/**
 * Rate limiter for auth endpoints.
 *
 * Per FR-019: keyed on `(IP, email)` tuple with a sliding 15-minute window.
 *   - 5 failed attempts  → 30s progressive delay
 *   - 10 failed attempts → 5min hard lockout (HTTP 429 + Retry-After)
 *   - Successful auth    → reset counter for that tuple
 *
 * Implementation: in-process sliding-window store. The rate-limit state is
 * keyed `${ip}:${email}` (and a separate per-IP-only key for non-credential
 * failures like "missing email"). A Redis backend is the production target
 * (see `docs/auth/runbook.md`); this module exposes the same interface so
 * swapping the backend is a one-line change.
 *
 * Deterministic for tests: a `nowProvider` is injectable so unit tests can
 * advance time without sleeping.
 */

import { randomUUID } from 'node:crypto';

export interface RateLimitConfig {
  windowMs: number;            // 15 * 60_000
  progressiveAfter: number;    // 5
  progressiveDelayMs: number;  // 30_000
  lockoutAfter: number;        // 10
  lockoutMs: number;           // 5 * 60_000
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60_000,
  progressiveAfter: 5,
  progressiveDelayMs: 30_000,
  lockoutAfter: 10,
  lockoutMs: 5 * 60_000,
};

export interface RateLimitState {
  /** Sliding window of failure timestamps (ms). */
  failures: number[];
  /** Hard-lockout expiry (ms). When in the future, all requests are blocked. */
  lockedUntil: number | null;
  /** Per-tuple ID for tracing. */
  id: string;
}

export type RateLimitVerdict =
  | { kind: 'allow' }
  | { kind: 'progressive_delay'; delayMs: number }
  | { kind: 'lockout'; retryAfterMs: number };

export interface RateLimiter {
  recordFailure(key: string): RateLimitVerdict;
  recordSuccess(key: string): void;
  check(key: string): RateLimitVerdict;
  reset(key: string): void;
  /** Test-only: clear all state. */
  _clear(): void;
}

interface RateLimiterOptions {
  config?: Partial<RateLimitConfig>;
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const cfg: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...(options.config ?? {}) };
  const now = options.now ?? (() => Date.now());
  const state = new Map<string, RateLimitState>();

  function getOrCreate(key: string): RateLimitState {
    let s = state.get(key);
    if (!s) {
      s = { failures: [], lockedUntil: null, id: randomUUID() };
      state.set(key, s);
    }
    return s;
  }

  function prune(s: RateLimitState, t: number): void {
    const cutoff = t - cfg.windowMs;
    s.failures = s.failures.filter((ts) => ts > cutoff);
  }

  function evaluate(s: RateLimitState, t: number): RateLimitVerdict {
    if (s.lockedUntil && s.lockedUntil > t) {
      return { kind: 'lockout', retryAfterMs: s.lockedUntil - t };
    }
    prune(s, t);
    if (s.failures.length >= cfg.lockoutAfter) {
      s.lockedUntil = t + cfg.lockoutMs;
      return { kind: 'lockout', retryAfterMs: cfg.lockoutMs };
    }
    if (s.failures.length >= cfg.progressiveAfter) {
      return { kind: 'progressive_delay', delayMs: cfg.progressiveDelayMs };
    }
    return { kind: 'allow' };
  }

  return {
    recordFailure(key) {
      const t = now();
      const s = getOrCreate(key);
      s.failures.push(t);
      return evaluate(s, t);
    },
    recordSuccess(key) {
      state.delete(key);
    },
    check(key) {
      const t = now();
      const s = getOrCreate(key);
      return evaluate(s, t);
    },
    reset(key) {
      state.delete(key);
    },
    _clear() {
      state.clear();
    },
  };
}

/** Build a rate-limit key for `(ip, email)`. */
export function tupleKey(ip: string, email: string | null): string {
  return `${ip}|${(email ?? '').toLowerCase().trim()}`;
}
