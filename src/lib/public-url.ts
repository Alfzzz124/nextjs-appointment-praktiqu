/**
 * The base URL for links we hand to someone else — reset emails, payment redirects.
 *
 * Deliberately NOT `NEXT_PUBLIC_APP_URL`, for two reasons:
 *
 * 1. Next inlines every `NEXT_PUBLIC_*` variable into the bundle at build time. Changing
 *    it in cPanel and restarting has no effect at all; the old value stays baked in until
 *    the app is rebuilt. A reset email kept pointing at the previous host that way.
 * 2. It is the wrong value once the user-facing site is a separate front-end.
 *    `NEXT_PUBLIC_APP_URL` is also the base two dashboard pages use to fetch our own API,
 *    so repointing it at the front-end silently breaks them.
 *
 * `APP_PUBLIC_URL` carries the outward-facing address and is read at call time, so
 * changing it in cPanel and restarting is enough.
 */

const FALLBACK = 'http://localhost:3000';

function firstSet(...values: (string | undefined)[]): string {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return FALLBACK;
}

/** Base URL for links sent to users. No trailing slash, so callers can append a path. */
export function getPublicAppUrl(): string {
  return firstSet(
    process.env.APP_PUBLIC_URL,
    // Kept as a fallback so deployments that have not set APP_PUBLIC_URL yet keep working.
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.AUTH_URL,
  ).replace(/\/+$/, '');
}
