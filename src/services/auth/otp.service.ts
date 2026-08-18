/**
 * Sign-in by one-time code, as an alternative to the password login in `service.ts`.
 *
 * Design notes worth keeping in mind while reading:
 *
 * - `request` gives the same answer whether or not the address is registered. Any branch
 *   that returns something distinguishable is a way to enumerate accounts.
 * - Resolution goes through `ensureUserFromWordPress`, not `prisma.user.findUnique`. Most
 *   accounts have no `users` row until their first app login; looking only at the app table
 *   would exclude them, which is exactly the bug that left 789 of 850 staging users unable
 *   to reset a password.
 * - Codes are found by `userId`, not by hash: six digits collide between users.
 */

import { prisma } from '@/lib/db';
import { buildOtpEmail, sendEmail } from '@/lib/email';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  codesMatch,
  generateOtpCode,
  hashOtpCode,
} from '@/lib/auth/otp';
import { ensureUserFromWordPress, normaliseEmail } from '@/services/auth/service';

export interface RequestOtpInput {
  email: string;
  ip: string;
  userAgent: string;
}

const COOLDOWN_SECONDS = Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000);

/**
 * Mail a fresh code, unless one was just sent.
 *
 * Always resolves. `retryAfterSeconds` is how long the caller should disable its resend
 * button — the same number whether or not anything was actually sent.
 */
export async function requestOtp(input: RequestOtpInput): Promise<{ retryAfterSeconds: number }> {
  const email = normaliseEmail(input.email);

  const user = await ensureUserFromWordPress(email);
  if (!user) return { retryAfterSeconds: COOLDOWN_SECONDS };

  const latest = await prisma.otpCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    const elapsed = Date.now() - latest.createdAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      // Silent: answering differently here would turn the cooldown into an oracle for
      // which addresses exist.
      return { retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000) };
    }
  }

  await prisma.otpCode.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      codeHash: hashOtpCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
  });

  const mail = buildOtpEmail({ code, ttlMinutes: Math.round(OTP_TTL_MS / 60_000) });
  await sendEmail({
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: 'otp-login',
  });

  return { retryAfterSeconds: COOLDOWN_SECONDS };
}
