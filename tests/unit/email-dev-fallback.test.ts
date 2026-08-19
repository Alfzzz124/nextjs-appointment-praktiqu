/**
 * sendEmail()'s dev fallback — when RESEND_API_KEY is unset, it logs to console
 * instead of calling Resend. The OTP feature puts the sign-in code in the
 * subject line (so it's readable from a phone notification), which means a
 * naive fallback that logs the full payload would write the code to the log
 * in plain text — breaking the "code is never logged, only its hash" guarantee.
 *
 * This covers the redaction: by default the fallback must not surface
 * `subject`/`text` anywhere in the logged output, only under an explicit
 * opt-in (`EMAIL_DEV_LOG_BODY=true`) for local development.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendEmail } from '@/lib/email';

const KEYS = ['RESEND_API_KEY', 'EMAIL_DEV_LOG_BODY'] as const;
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

const SECRET_SUBJECT = '418902 is your PraktiQU sign-in code';

describe('sendEmail dev fallback', () => {
  it('does not log the subject (or any secret it carries) when EMAIL_DEV_LOG_BODY is unset', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await sendEmail({
      to: 'patient@example.com',
      subject: SECRET_SUBJECT,
      html: '<p>irrelevant</p>',
      text: 'irrelevant',
      template: 'otp',
    });

    const loggedOutput = spy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(loggedOutput).not.toContain('418902');
    expect(loggedOutput).not.toContain(SECRET_SUBJECT);

    spy.mockRestore();
  });

  it('still logs the recipient and resolves { ok: true }', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await sendEmail({
      to: 'patient@example.com',
      subject: SECRET_SUBJECT,
      html: '<p>irrelevant</p>',
      template: 'otp',
    });

    const loggedOutput = spy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(loggedOutput).toContain('patient@example.com');
    expect(result).toEqual({ ok: true });

    spy.mockRestore();
  });

  it('includes the subject when EMAIL_DEV_LOG_BODY=true is set deliberately', async () => {
    process.env.EMAIL_DEV_LOG_BODY = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({
      to: 'patient@example.com',
      subject: SECRET_SUBJECT,
      html: '<p>irrelevant</p>',
      template: 'otp',
    });

    const loggedOutput = spy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(loggedOutput).toContain(SECRET_SUBJECT);

    spy.mockRestore();
  });
});
