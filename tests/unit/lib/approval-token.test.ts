/**
 * The token in the psychologist's "approve / reject" email link (spec 2026-10-29 §5).
 * It names one booking and its psychologist; anyone holding it may decide that booking
 * while it waits, so it must be tamper-proof and must not pass as any other token.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signApprovalToken, verifyApprovalToken } from '@/lib/public/approval-token';
import { signAppointmentToken, verifyAppointmentToken } from '@/lib/public/appointment-token';
import { signOAuthState, verifyOAuthState } from '@/lib/google/oauth-state';

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const PAYLOAD = { appointmentId: 7, doctorWpUserId: 34 };

/** A token with any body, correctly signed — to prove the checks after the signature. */
function signed(body: unknown): string {
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
}

describe('signApprovalToken / verifyApprovalToken', () => {
  it('round-trips the payload', () => {
    expect(verifyApprovalToken(signApprovalToken(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('has no expiry: a token issued a year ago still verifies', () => {
    const old = signApprovalToken(PAYLOAD, { issuedAt: Date.now() - 365 * 24 * 3_600_000 });
    expect(verifyApprovalToken(old)).toEqual(PAYLOAD);
  });

  it('gives each email its own token', () => {
    expect(signApprovalToken(PAYLOAD, { issuedAt: 1 })).not.toBe(signApprovalToken(PAYLOAD, { issuedAt: 2 }));
  });

  it('rejects a tampered body', () => {
    const [body, sig] = signApprovalToken(PAYLOAD).split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.a = 8;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    expect(verifyApprovalToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const [body] = signApprovalToken(PAYLOAD).split('.');
    expect(verifyApprovalToken(`${body}.${'A'.repeat(43)}`)).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const t of ['', 'nope', 'a.b.c', '.x', 'x.']) expect(verifyApprovalToken(t)).toBeNull();
  });

  it('rejects a correctly signed body with another purpose', () => {
    expect(verifyApprovalToken(signed({ p: 'oauth', a: 7, d: 34, i: 1 }))).toBeNull();
    expect(verifyApprovalToken(signed({ a: 7, d: 34, i: 1 }))).toBeNull();
  });

  it('rejects ids that are not positive safe integers', () => {
    for (const a of [0, -1, 1.5, '7', null]) {
      expect(verifyApprovalToken(signed({ p: 'approval', a, d: 34, i: 1 }))).toBeNull();
    }
    expect(verifyApprovalToken(signed({ p: 'approval', a: 7, d: 0, i: 1 }))).toBeNull();
  });

  it('rejects a signed body that is not a JSON object', () => {
    expect(verifyApprovalToken(signed(null))).toBeNull();
    expect(verifyApprovalToken(signed('approval'))).toBeNull();
  });

  it('does not pass as an appointment token or a Google state, nor they as it', () => {
    const token = signApprovalToken(PAYLOAD);
    expect(verifyAppointmentToken(token)).toBeNull();
    expect(verifyOAuthState(token)).toBeNull();

    expect(verifyApprovalToken(signAppointmentToken(7))).toBeNull();
    expect(verifyApprovalToken(signOAuthState({ professionalId: 34, returnUrl: 'https://contoh.test/' }))).toBeNull();
  });
});
