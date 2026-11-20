// How a failed Google Calendar response is read.
//
// One place decides what a status means, because two callers (events, freebusy)
// each mapping "401 or 403" to "revoked" is exactly what went wrong: Google uses
// 403 for usage limits, per-event refusals and missing scopes as well as for
// nothing at all about the person's consent, and a quota blip deleted a
// psychologist's refresh token.

import { GoogleOAuthError } from '@/lib/google/oauth-client';

/**
 * The authorisation is gone: revoked by the person, or expired.
 *
 * Its own type because the right response is a calm "reconnect", not an error
 * banner. While the Google app is in Testing this happens to every connected
 * professional every 7 days, so treating it as a failure would paint the settings
 * page red weekly and earn a bug report each Monday.
 */
export class GoogleAuthRevokedError extends Error {
  readonly code = 'GOOGLE_AUTH_REVOKED';
}

/** Google is unhappy now but may not be in a minute: 429, 5xx, usage limits, network. */
export class GoogleTransientError extends Error {
  readonly code = 'GOOGLE_TRANSIENT';
}

/** Google's own error code from a failed response, without assuming a shape. */
async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    if (typeof body.error === 'string') return body.error;
    const nested = body.error as { message?: unknown; status?: unknown } | undefined;
    if (nested && typeof nested.message === 'string') return nested.message;
    if (nested && typeof nested.status === 'string') return nested.status;
  } catch {
    /* a non-JSON error page says no more than the status does */
  }
  return 'unknown';
}

interface GoogleErrorDetail {
  reason?: unknown;
}

/**
 * The machine-readable `reason` and the human message of a failed response.
 *
 * `errors[].reason` is the classic shape; `details[].reason` is the newer one.
 */
async function reasonOf(res: Response): Promise<{ reason: string | null; message: string }> {
  let reason: string | null = null;
  let message = '';
  try {
    const body = (await res.clone().json()) as {
      error?: {
        message?: unknown;
        errors?: GoogleErrorDetail[];
        details?: GoogleErrorDetail[];
      };
    };
    const found = [...(body.error?.errors ?? []), ...(body.error?.details ?? [])].find(
      (d) => typeof d?.reason === 'string',
    );
    if (found) reason = found.reason as string;
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    /* a non-JSON error page says no more than the status does */
  }
  return { reason, message };
}

const USAGE_LIMIT_REASONS = new Set([
  'ratelimitexceeded',
  'userratelimitexceeded',
  'quotaexceeded',
  'dailylimitexceeded',
  'rate_limit_exceeded',
]);

/** A 403 that Google sends for quota. It clears by itself; the grant is untouched. */
function isUsageLimit(reason: string | null, message: string): boolean {
  if (reason && USAGE_LIMIT_REASONS.has(reason.toLowerCase())) return true;
  return /usage limits? exceeded|rate limit exceeded/i.test(message);
}

/**
 * Turn the statuses that say something about the credential or the quota into the
 * error that says what to do about it. Returns normally for any other status so
 * the caller can apply its own rules (404 means different things to different calls).
 *
 * - 401: the access token was rejected, and a fresh one had just been minted from
 *   the refresh token — the authorisation is gone. Revoked.
 * - 403 usage limit, and 429: transient, like a 5xx. The connection is left alone.
 * - any other 403 (not the organiser, scope too narrow, calendar not shared): a
 *   refusal of THIS request. Not a revocation, so the refresh token stays; the
 *   reason is in the message because it is the only clue anyone will get.
 */
export async function raiseForAuthOrQuota(res: Response, what: string): Promise<void> {
  if (res.status === 401) {
    throw new GoogleAuthRevokedError(`Google rejected the access token (${res.status})`);
  }
  if (res.status === 429) {
    throw new GoogleTransientError(`${what} failed (${res.status}: ${await errorCodeOf(res)})`);
  }
  if (res.status === 403) {
    const { reason, message } = await reasonOf(res);
    const detail = `${reason ?? 'unknown'}${message ? `: ${message}` : ''}`;
    if (isUsageLimit(reason, message)) {
      throw new GoogleTransientError(`${what} hit a Google usage limit (403: ${detail})`);
    }
    throw new GoogleOAuthError(`${what} was refused (403: ${detail})`);
  }
}
