/**
 * getPublicAppUrl — the base for links we hand to someone else.
 *
 * This exists because `NEXT_PUBLIC_APP_URL` cannot do the job. Next inlines every
 * `NEXT_PUBLIC_*` variable at build time, so changing it in cPanel and restarting does
 * nothing — a reset email kept pointing at the old host until the app was rebuilt. It is
 * also the wrong value once the user-facing site is a separate front-end: two dashboard
 * pages use it as the base for fetching our OWN API, and pointing it elsewhere breaks them.
 *
 * `APP_PUBLIC_URL` is read at call time, so cPanel + restart is enough.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPublicAppUrl } from '@/lib/public-url';

const KEYS = ['APP_PUBLIC_URL', 'NEXT_PUBLIC_APP_URL', 'AUTH_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getPublicAppUrl', () => {
  it('prefers APP_PUBLIC_URL, the one that can change without a rebuild', () => {
    process.env.APP_PUBLIC_URL = 'https://terpadu.praktiqu.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging2.praktiqu.com';

    expect(getPublicAppUrl()).toBe('https://terpadu.praktiqu.com');
  });

  it('falls back to NEXT_PUBLIC_APP_URL so nothing breaks before the new var is set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging2.praktiqu.com';

    expect(getPublicAppUrl()).toBe('https://staging2.praktiqu.com');
  });

  it('falls back to AUTH_URL when neither app url is set', () => {
    process.env.AUTH_URL = 'https://auth.example.com';

    expect(getPublicAppUrl()).toBe('https://auth.example.com');
  });

  it('lands on localhost for dev', () => {
    expect(getPublicAppUrl()).toBe('http://localhost:3000');
  });

  it('ignores a blank value rather than building links against an empty host', () => {
    process.env.APP_PUBLIC_URL = '   ';
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging2.praktiqu.com';

    expect(getPublicAppUrl()).toBe('https://staging2.praktiqu.com');
  });

  it('drops a trailing slash so callers can append a path safely', () => {
    process.env.APP_PUBLIC_URL = 'https://terpadu.praktiqu.com/';

    expect(getPublicAppUrl()).toBe('https://terpadu.praktiqu.com');
  });

  it('reads the environment on every call, not once at import', () => {
    process.env.APP_PUBLIC_URL = 'https://satu.example.com';
    expect(getPublicAppUrl()).toBe('https://satu.example.com');

    process.env.APP_PUBLIC_URL = 'https://dua.example.com';
    expect(getPublicAppUrl()).toBe('https://dua.example.com');
  });
});
