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
import { toUserUpsertData, wpLookupByEmail } from '@/lib/auth/wp-auth';
import { ensureUserFromWordPress, normaliseEmail } from '@/services/auth/service';
import { audit } from '@/services/audit';
import {
  AuthError,
  issueTokensForUser,
  type IssuedTokens,
  type LoginResult,
} from '@/services/auth/service';

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

  let user = await ensureUserFromWordPress(email);
  if (!user) return { retryAfterSeconds: COOLDOWN_SECONDS };

  // Refresh the row from WordPress before minting a code. `ensureUserFromWordPress` only
  // ever contacts WordPress the first time it sees an address; once a `users` row exists it
  // is returned as-is. The row's `status` is otherwise only refreshed by a successful
  // *password* login (see `toUserUpsertData`'s update branch in service.ts), so a staff
  // member deactivated in WordPress would otherwise keep OTP access forever even though
  // password login correctly refuses them. `wpLookupByEmail` returns `null` both when
  // WordPress has no such user and when WordPress could not be reached in time — those two
  // cases are indistinguishable here, and a WordPress outage must not lock every user out
  // of OTP sign-in, so on `null` we deliberately proceed with the existing app row rather
  // than treating it as "no such account".
  const wp = await wpLookupByEmail(email);
  if (wp) {
    user = await prisma.user.upsert(toUserUpsertData(wp));
  }

  if (user.status === 0) {
    // Same shape as the unregistered branch — a deactivated account must not be
    // distinguishable from one that never existed.
    return { retryAfterSeconds: COOLDOWN_SECONDS };
  }

  const latest = await prisma.otpCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    const elapsed = Date.now() - latest.createdAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      // Silent, and always the same number: answering with the real remaining time here
      // would turn the cooldown into an oracle for which addresses exist (a registered
      // address called twice a second apart would answer 59, 58... while an unregistered
      // one always answers 60).
      return { retryAfterSeconds: COOLDOWN_SECONDS };
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

export interface VerifyOtpInput {
  email: string;
  code: string;
  ip: string;
  userAgent: string;
}

export interface VerifyOtpResult extends IssuedTokens {
  user: LoginResult['user'];
}

/**
 * Trade a code for a session.
 *
 * Every rejection before a match answers `invalid_code` regardless of cause, so verify
 * cannot be used to discover which addresses exist — the same rule `request` follows.
 *
 * `code_expired` and `too_many_attempts` are reported only to a caller who has proven they
 * hold the real digits (the hash comparison runs first). Deciding them before the comparison
 * would let an attacker manufacture either condition for any address — request a code and
 * wait ten minutes, or burn it with five wrong guesses — and read the response as proof the
 * address is registered.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const email = normaliseEmail(input.email);

  // OTP is the one login path WordPress never validates, so a failed attempt here is the
  // only record that it happened at all — mirror the shape `login()` already uses.
  const recordFailure = (reason: 'invalid_credentials' | 'inactive') =>
    audit.loginFailure(
      {
        attemptedEmail: email,
        timestamp: new Date().toISOString(),
        ip: input.ip,
        userAgent: input.userAgent,
        reason,
      },
      { ip: input.ip, userAgent: input.userAgent },
    );

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await recordFailure('invalid_credentials');
    throw new AuthError('invalid_code', 400, 'That code is not valid');
  }

  const record = await prisma.otpCode.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) {
    await recordFailure('invalid_credentials');
    throw new AuthError('invalid_code', 400, 'That code is not valid');
  }

  const isExpired = record.expiresAt.getTime() <= Date.now();
  const isBurned = record.attempts >= OTP_MAX_ATTEMPTS;

  if (!codesMatch(input.code, record.codeHash)) {
    if (!isExpired && !isBurned) {
      // Only a still-live record's counter moves. A dead record's attempt count no longer
      // does anything, so letting a wrong guess against it keep incrementing would just be
      // the counter running away past the limit for no reason.
      await prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
    }
    await recordFailure('invalid_credentials');
    throw new AuthError('invalid_code', 400, 'That code is not valid');
  }

  // The digits are correct — only now are expiry and the attempt limit trustworthy signals,
  // since only someone who already holds the real code can reach this point.
  if (isExpired) {
    await recordFailure('invalid_credentials');
    throw new AuthError('code_expired', 400, 'That code has expired — request a new one');
  }
  if (isBurned) {
    await recordFailure('invalid_credentials');
    throw new AuthError('too_many_attempts', 400, 'Too many wrong attempts — request a new code');
  }

  // Spend the code before deciding anything else about the account, so a rejected login
  // cannot be retried against the same digits.
  await prisma.otpCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  if (user.status === 0) {
    await recordFailure('inactive');
    throw new AuthError('account_inactive', 403, 'Account is inactive');
  }

  if (!user.emailVerified) {
    // Reading the code proves control of the mailbox.
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  }

  const tokens = await issueTokensForUser(user, input.ip, input.userAgent);

  await audit.loginSuccess(
    {
      userId: user.id,
      timestamp: new Date().toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
      method: 'otp',
    },
    { ip: input.ip, userAgent: input.userAgent },
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      role: user.role,
      wpUserId: user.wpUserId,
    },
    ...tokens,
  };
}
