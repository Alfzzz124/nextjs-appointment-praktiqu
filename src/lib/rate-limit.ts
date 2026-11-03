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
  /** Test-only: number of keys held. */
  _size(): number;
}

interface RateLimiterOptions {
  config?: Partial<RateLimitConfig>;
  now?: () => number;
  /** Most keys held at once. */
  maxKeys?: number;
  /** Sweep spent keys once every this many `check`/`recordFailure` calls. */
  sweepEvery?: number;
}

/**
 * The key usually holds the client IP, which a direct caller can forge (src/lib/client-ip.ts),
 * so every key kept is memory an anonymous caller can spend. Hence: `check` never creates a
 * key; spent keys are swept every `sweepEvery` calls; and a new key at `maxKeys` sweeps at
 * once and, if what is left is all live (a flood inside one window), drops the least recently
 * used until a tenth of the room is free. Freeing a tenth rather than one key makes a flood
 * pay one full sweep per maxKeys/10 new keys instead of one per key.
 */
const DEFAULT_MAX_KEYS = 10_000;
const DEFAULT_SWEEP_EVERY = 1_000;

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const cfg: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...(options.config ?? {}) };
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const sweepEvery = options.sweepEvery ?? DEFAULT_SWEEP_EVERY;
  /** Insertion order is recency order: `touch` moves a key to the end, eviction takes the front. */
  const state = new Map<string, RateLimitState>();
  let callsSinceSweep = 0;

  function touch(key: string): RateLimitState | undefined {
    const s = state.get(key);
    if (s) {
      state.delete(key);
      state.set(key, s);
    }
    return s;
  }

  function create(key: string, t: number): RateLimitState {
    if (state.size >= maxKeys) {
      sweep(t);
      const lowWater = Math.floor(maxKeys * 0.9);
      for (const k of state.keys()) {
        if (state.size <= lowWater) break;
        state.delete(k);
      }
    }
    const s: RateLimitState = { failures: [], lockedUntil: null, id: randomUUID() };
    state.set(key, s);
    return s;
  }

  /** No failure left in the window and no lock running: dropping it changes no verdict. */
  function spent(s: RateLimitState, t: number): boolean {
    if (s.lockedUntil && s.lockedUntil > t) return false;
    const cutoff = t - cfg.windowMs;
    return s.failures.every((ts) => ts <= cutoff);
  }

  function sweep(t: number): void {
    for (const [k, s] of state) {
      if (spent(s, t)) state.delete(k);
    }
  }

  function tick(t: number): void {
    if (++callsSinceSweep >= sweepEvery) {
      callsSinceSweep = 0;
      sweep(t);
    }
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
      tick(t);
      const s = touch(key) ?? create(key, t);
      s.failures.push(t);
      return evaluate(s, t);
    },
    recordSuccess(key) {
      state.delete(key);
    },
    check(key) {
      const t = now();
      tick(t);
      const s = touch(key);
      // An unknown key has no failures, so it is allowed, and nothing is stored for it.
      return s ? evaluate(s, t) : { kind: 'allow' };
    },
    reset(key) {
      state.delete(key);
    },
    _clear() {
      state.clear();
    },
    _size() {
      return state.size;
    },
  };
}

/** Build a rate-limit key for `(ip, email)`. */
/**
 * Key for the address-only layer. Every `(ip, email)` limiter on an auth route has one
 * beside it, because the IP half cannot be trusted: without a vouched IP (see
 * src/lib/client-ip.ts) it is the first X-Forwarded-For entry, which a direct caller
 * sets to anything. Rotating it gave each guess a fresh tuple and so an unlimited
 * number of guesses against one account. This layer ignores the IP, so it holds however
 * the IP is forged; its thresholds are looser so that genuine users behind one address
 * are not locked out by it first.
 */
export function subjectKey(email: string | null): string {
  return `*|${(email ?? '').toLowerCase().trim()}`;
}

/** The stricter of two verdicts: lockout > progressive delay > allow, longest wait wins. */
export function worstVerdict(a: RateLimitVerdict, b: RateLimitVerdict): RateLimitVerdict {
  const rank = (v: RateLimitVerdict) => (v.kind === 'lockout' ? 2 : v.kind === 'progressive_delay' ? 1 : 0);
  const wait = (v: RateLimitVerdict) =>
    v.kind === 'lockout' ? v.retryAfterMs : v.kind === 'progressive_delay' ? v.delayMs : 0;
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return wait(a) >= wait(b) ? a : b;
}

/**
 * Looser thresholds for the address-only layer: 30 failures in 15 minutes, then 15
 * minutes locked. Three times the per-tuple limit, so it only bites when the tuple layer
 * is being dodged.
 */
export const SUBJECT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60_000,
  progressiveAfter: 30,
  progressiveDelayMs: 0,
  lockoutAfter: 30,
  lockoutMs: 15 * 60_000,
};

export function tupleKey(ip: string, email: string | null): string {
  return `${ip}|${(email ?? '').toLowerCase().trim()}`;
}
