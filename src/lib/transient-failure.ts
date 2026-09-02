/**
 * Telling transient backend failures apart from permanent ones.
 *
 * A guest booking can fail because something is broken or because something is busy,
 * and the two deserve opposite answers: "this will not work" versus "try again in a
 * moment". Until this module existed both arrived as a bare 500, so the front end could
 * only guess — and it guessed at corrupt patient data when the real cause was a MySQL
 * connection cap.
 *
 * The rule is deliberately narrow. Retryable means *the request never got a real
 * answer* — the far side was unreachable, overloaded, or out of connections. Anything
 * the far side actually decided (a 4xx, a validation refusal) is not retryable, and
 * neither is our own misconfiguration: `WpConfigError` carries status 500, but a missing
 * service token is global and permanent, and advertising it as retryable would turn a
 * broken deploy into an infinite polite retry loop.
 */

import { WpEndpointError, WpConfigError } from '@/lib/wp-endpoint';

/**
 * How long to tell a client to wait. A saturated connection pool drains in seconds, so
 * this is short enough to be worth honouring and long enough not to add to the pile-up.
 */
export const TRANSIENT_RETRY_AFTER_SECONDS = 5;

/**
 * Prisma reports an exhausted or unreachable database through the message rather than a
 * typed field, so these are matched on text. Each one is a "could not get a working
 * connection" condition — never a rejected query.
 */
const TRANSIENT_DB_MESSAGES: readonly RegExp[] = [
  /max_user_connections/i, // MySQL 1226 — the per-user cap on shared hosting
  /too many connections/i, // MySQL 1040 — the server-wide cap
  /can't reach database server/i, // Prisma P1001
  /server has closed the connection/i, // Prisma P1017
  /timed out fetching a new connection/i, // Prisma pool timeout
];

/**
 * The subset of the above where Prisma never sent the statement — the failure happened
 * while *acquiring* a connection, so nothing was written.
 *
 * P1017 ("server has closed the connection") is deliberately absent: the connection can
 * drop mid-statement, which leaves a write ambiguous. It still earns a 503; it just
 * never earns an automatic replay.
 */
const RETRY_SAFE_DB_MESSAGES: readonly RegExp[] = [
  /max_user_connections/i,
  /too many connections/i,
  /can't reach database server/i,
  /timed out fetching a new connection/i,
];

/**
 * WordPress core prints this and dies during bootstrap, before any plugin file loads.
 * Seeing it proves our appointment write never began.
 */
const WP_BOOTSTRAP_DB_FAILURE = /Error establishing a database connection/i;

/**
 * True when `err` means "busy or unreachable, worth retrying" rather than "broken".
 */
export function isTransientBackendFailure(err: unknown): boolean {
  // Checked before the parent class: WpConfigError extends WpEndpointError with a 500.
  if (err instanceof WpConfigError) return false;

  if (err instanceof WpEndpointError) {
    // Status 0 is `wpFetch`'s "WordPress never answered" — the most transient failure
    // there is. 5xx is WordPress answering that it could not serve the request, which
    // on this stack is usually its own database connection failing.
    return err.status === 0 || err.status >= 500;
  }

  if (err instanceof Error && /^PrismaClient/.test(err.name)) {
    return TRANSIENT_DB_MESSAGES.some((re) => re.test(err.message));
  }

  return false;
}

/**
 * True when `err` proves the attempt did **no work**, so replaying it cannot duplicate
 * anything.
 *
 * Strictly narrower than `isTransientBackendFailure`. The booking write is not
 * idempotent — `createAppointment` called twice books twice — so "probably fine to
 * retry" is not good enough here. A 5xx that WordPress itself produced means WordPress
 * was alive and may have written before failing; that one is transient but not
 * replayable, and the guest gets a 503 to act on instead of a silent second booking.
 */
export function isRetrySafeFailure(err: unknown): boolean {
  if (err instanceof WpConfigError) return false;

  if (err instanceof WpEndpointError) {
    // Status 0: `wpFetch` never got the request there, so nothing ran.
    if (err.status === 0) return true;
    return WP_BOOTSTRAP_DB_FAILURE.test(err.message);
  }

  if (err instanceof Error && /^PrismaClient/.test(err.name)) {
    return RETRY_SAFE_DB_MESSAGES.some((re) => re.test(err.message));
  }

  return false;
}
