/**
 * Validating the `returnUrl` the front end asks us to send them back to.
 *
 * This is the open-redirect guard on an OAuth flow in a health application, so
 * the tests lean on the attacks rather than the happy path. The front end asked
 * for the parameter; they also asked us to insist on the allowlist.
 */
import { describe, it, expect } from 'vitest';
import { resolveReturnUrl } from '@/lib/return-url-allowlist';

const ALLOW = [
  'https://terpadu.praktiqu.com/dashboard',
  'https://staging2.praktiqu.com/dashboard',
];

describe('resolveReturnUrl', () => {
  it('accepts an allowed origin and path prefix', () => {
    expect(
      resolveReturnUrl('https://terpadu.praktiqu.com/dashboard/pengaturan/kalender', ALLOW),
    ).toBe('https://terpadu.praktiqu.com/dashboard/pengaturan/kalender');
  });

  it('accepts the prefix itself', () => {
    expect(resolveReturnUrl('https://terpadu.praktiqu.com/dashboard', ALLOW)).toBe(
      'https://terpadu.praktiqu.com/dashboard',
    );
  });

  it('keeps a query string the front end put there', () => {
    expect(
      resolveReturnUrl('https://terpadu.praktiqu.com/dashboard/x?tab=cal', ALLOW),
    ).toBe('https://terpadu.praktiqu.com/dashboard/x?tab=cal');
  });

  it('refuses another origin outright', () => {
    expect(resolveReturnUrl('https://evil.example/dashboard', ALLOW)).toBeNull();
  });

  it('refuses a scheme downgrade', () => {
    expect(resolveReturnUrl('http://terpadu.praktiqu.com/dashboard', ALLOW)).toBeNull();
  });

  it('refuses a path outside the allowed prefix', () => {
    expect(resolveReturnUrl('https://terpadu.praktiqu.com/admin', ALLOW)).toBeNull();
  });

  it('refuses a prefix match that is not a path boundary', () => {
    // /dashboard-evil must not pass because it starts with /dashboard.
    expect(resolveReturnUrl('https://terpadu.praktiqu.com/dashboard-evil', ALLOW)).toBeNull();
  });

  it('refuses userinfo smuggling', () => {
    expect(
      resolveReturnUrl('https://terpadu.praktiqu.com@evil.example/dashboard', ALLOW),
    ).toBeNull();
  });

  it('refuses a protocol-relative URL', () => {
    expect(resolveReturnUrl('//evil.example/dashboard', ALLOW)).toBeNull();
  });

  it('refuses a subdomain of an allowed host', () => {
    expect(resolveReturnUrl('https://evil.terpadu.praktiqu.com/dashboard', ALLOW)).toBeNull();
  });

  it('refuses a javascript: URL', () => {
    expect(resolveReturnUrl('javascript:alert(1)', ALLOW)).toBeNull();
  });

  it('refuses nonsense rather than throwing', () => {
    expect(resolveReturnUrl('not a url', ALLOW)).toBeNull();
  });

  it('refuses everything when the allowlist is empty', () => {
    // No silent fallback to some default: a misconfigured allowlist must fail
    // closed and visibly, not quietly send people somewhere plausible.
    expect(resolveReturnUrl('https://terpadu.praktiqu.com/dashboard', [])).toBeNull();
  });

  it('ignores a path traversal that climbs out of the prefix', () => {
    expect(
      resolveReturnUrl('https://terpadu.praktiqu.com/dashboard/../admin', ALLOW),
    ).toBeNull();
  });
});
