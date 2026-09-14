/**
 * The `state` parameter carried through Google's consent screen.
 *
 * It is the only thing tying the browser that comes back to the professional who
 * started the flow, and it carries the redirect target — so it has to be
 * tamper-proof and short-lived, not merely opaque.
 */
import { describe, it, expect } from 'vitest';
import { signOAuthState, verifyOAuthState } from '@/lib/google/oauth-state';

const PAYLOAD = { professionalId: 42, returnUrl: 'https://terpadu.praktiqu.com/dashboard' };

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips the payload', () => {
    expect(verifyOAuthState(signOAuthState(PAYLOAD))).toMatchObject(PAYLOAD);
  });

  it('gives a different state each time, so one cannot be replayed as another', () => {
    expect(signOAuthState(PAYLOAD)).not.toBe(signOAuthState(PAYLOAD));
  });

  it('rejects a tampered payload', () => {
    const [body, sig] = signOAuthState(PAYLOAD).split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.professionalId = 999;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a truncated or malformed state', () => {
    expect(verifyOAuthState('')).toBeNull();
    expect(verifyOAuthState('nope')).toBeNull();
    expect(verifyOAuthState('a.b.c')).toBeNull();
  });

  it('rejects a state older than its lifetime', () => {
    const old = signOAuthState(PAYLOAD, { issuedAt: Date.now() - 31 * 60_000 });
    expect(verifyOAuthState(old)).toBeNull();
  });

  it('accepts a state still inside its lifetime', () => {
    const recent = signOAuthState(PAYLOAD, { issuedAt: Date.now() - 60_000 });
    expect(verifyOAuthState(recent)).toMatchObject(PAYLOAD);
  });

  it('rejects a state issued in the future, which means a forged timestamp', () => {
    const ahead = signOAuthState(PAYLOAD, { issuedAt: Date.now() + 10 * 60_000 });
    expect(verifyOAuthState(ahead)).toBeNull();
  });
});
