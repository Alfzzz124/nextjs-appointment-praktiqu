/**
 * The end user's IP address, for rate limiting and the audit log.
 *
 * The Laravel FE calls this API server-side, so every request it relays arrives from
 * the FE host. Keyed on that, the `(ip, email)` login limiter degraded to per-email only,
 * the public booking limiter likewise, and `audit_logs.ip` named the FE for every user
 * (2026-09-25 FE audit, SEC-1 / BK-7).
 *
 * The FE therefore passes the browser's address in `X-Praktiqu-Client-Ip`, and proves it
 * is the FE by also sending `X-Praktiqu-Forwarder-Key` equal to `FE_FORWARDER_SECRET`.
 * A shared secret rather than a trusted-proxy allowlist, because the hops in front of
 * this app (cPanel's Apache, the WAF) are not ours to pin down, so no position in
 * `X-Forwarded-For` can be trusted by construction. Without a matching key the header is
 * ignored, and the old behaviour stands.
 *
 * The old behaviour, left as it was: the first `X-Forwarded-For` entry, which any direct
 * caller can set. Closing that needs the proxy chain in front of the app confirmed first.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const CLIENT_IP_HEADER = 'x-praktiqu-client-ip';
export const FORWARDER_KEY_HEADER = 'x-praktiqu-forwarder-key';

/** A secret shorter than this is treated as unset — a guessable key trusts everyone. */
const MIN_SECRET_LENGTH = 16;

type HeaderSource = Headers | Record<string, string | undefined>;

function read(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()];
}

function keyMatches(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The IP a trusted forwarder vouched for, or `null` when there is no valid vouch. */
function forwardedClientIp(headers: HeaderSource): string | null {
  const secret = process.env.FE_FORWARDER_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;

  const key = read(headers, FORWARDER_KEY_HEADER);
  if (!key || !keyMatches(key, secret)) return null;

  const ip = read(headers, CLIENT_IP_HEADER)?.trim();
  return ip && isIP(ip) !== 0 ? ip : null;
}

/** The best-known client IP, or `null` when nothing identifies one. */
export function clientIpOrNull(headers: HeaderSource): string | null {
  return (
    forwardedClientIp(headers) ??
    read(headers, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    read(headers, 'x-real-ip') ??
    null
  );
}

/** The best-known client IP, `0.0.0.0` when nothing identifies one. */
export function getClientIp(headers: HeaderSource): string {
  return clientIpOrNull(headers) || '0.0.0.0';
}
