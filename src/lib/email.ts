/**
 * Email delivery — Resend integration (transactional, free tier).
 *
 * Env: `RESEND_API_KEY`. If absent (dev), we log a structured
 * `email.delivery_failed` event and return `{ ok: true }` so password-reset
 * flow never reveals whether an email was actually sent (no user
 * enumeration, per U8 of the spec).
 */

import { audit } from '@/services/audit';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  template?: string;
  attachments?: { filename: string; content: string }[];
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const FROM = process.env.EMAIL_FROM ?? 'noreply@praktiqu.local';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';

/** Send a transactional email. Falls back to console.log in dev. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    // Dev fallback — never throw; ensure no-enumeration guarantee.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'INFO',
        event: 'email.dev_fallback',
        to: input.to,
        subject: input.subject,
        template: input.template ?? null,
        timestamp: new Date().toISOString(),
      }),
    );
    return { ok: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text ?? '',
        attachments: input.attachments ?? undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      await audit.emailDeliveryFailed({
        to: input.to,
        template: input.template ?? 'unknown',
        error: text,
        timestamp: new Date().toISOString(),
      });
      return { ok: false, error: text };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: json.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit.emailDeliveryFailed({
      to: input.to,
      template: input.template ?? 'unknown',
      error: message,
      timestamp: new Date().toISOString(),
    });
    return { ok: false, error: message };
  }
}

/** Build a password-reset email. */
export function buildPasswordResetEmail(input: {
  appUrl: string;
  resetToken: string;
  ttlMinutes: number;
}): { subject: string; html: string; text: string } {
  const link = `${input.appUrl}/reset-password?token=${encodeURIComponent(input.resetToken)}`;
  return {
    subject: 'Reset your PraktiQU password',
    html: `<p>We received a request to reset your password.</p>
<p>This link expires in ${input.ttlMinutes} minutes.</p>
<p><a href="${link}">Reset your password</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    text: `Reset your password: ${link} (expires in ${input.ttlMinutes} minutes)`,
  };
}
