// Where an OAuth callback is allowed to send the browser afterwards.
//
// The front end is multi-tenant, so their settings URL differs per tenant and a
// target hard-coded here would land people in the wrong one. They send it; we
// check it. A redirect target accepted as given is an open redirect, and this one
// sits on a flow carrying an OAuth code, in a health application.
//
// Fails closed, always. There is no fallback to a default when the value does not
// match: a silent fallback turns a misconfigured allowlist into a redirect that
// looks plausible and goes somewhere nobody intended.

/**
 * Check `candidate` against `allowlist` and return it normalised, or `null`.
 *
 * Each allowlist entry is an absolute URL whose origin must match exactly and
 * whose path is treated as a prefix — `https://host/dashboard` permits
 * `/dashboard` and `/dashboard/anything`, but not `/dashboard-evil` and not
 * `/admin`.
 */
export function resolveReturnUrl(
  candidate: string,
  allowlist: readonly string[],
): string | null {
  if (allowlist.length === 0) return null;

  let url: URL;
  try {
    // Parsed without a base on purpose: a relative or protocol-relative value
    // ("//evil.example") must fail here rather than be resolved against one of
    // our own hosts and pass.
    url = new URL(candidate);
  } catch {
    return null;
  }

  // Anything that is not plain HTTPS — javascript:, data:, http: — is out. The
  // scheme check also stops a downgrade on an otherwise allowed host.
  if (url.protocol !== 'https:') return null;

  // `https://allowed.host@evil.example/` parses with host `evil.example`, so the
  // origin comparison below already rejects it. Credentials are refused anyway:
  // they have no business in a redirect target and their only use here is to make
  // a URL read as one host while resolving to another.
  if (url.username || url.password) return null;

  for (const entry of allowlist) {
    let allowed: URL;
    try {
      allowed = new URL(entry);
    } catch {
      continue; // A malformed entry disables itself rather than the whole list.
    }
    if (url.origin !== allowed.origin) continue;

    const base = allowed.pathname.replace(/\/+$/, '');
    // `url.pathname` is already normalised by URL, so "/dashboard/../admin" has
    // become "/admin" by the time it is compared.
    const path = url.pathname;
    if (path === base || path.startsWith(`${base}/`)) {
      return url.toString();
    }
  }

  return null;
}

/** The configured allowlist, as entries. Empty when unset — which refuses everything. */
export function configuredReturnUrlAllowlist(): string[] {
  return (process.env.GOOGLE_OAUTH_RETURN_URL_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
