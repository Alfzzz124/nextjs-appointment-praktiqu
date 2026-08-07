/**
 * POST /api/v1/auth/forgot-password (FR-004).
 * Always returns 200 (no enumeration) even if email is unknown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { ensureUserFromWordPress } from '@/services/auth/service';
import { sendEmail, buildPasswordResetEmail } from '@/lib/email';
import { badRequest, tooManyRequests, problemHeaders } from '@/lib/problem-details';
import { createRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, tupleKey } from '@/lib/rate-limit';

/**
 * Without this, anyone could mail a stranger's inbox on demand — and since each request
 * invalidates the previous token, repeated calls also keep breaking whatever link the
 * victim is trying to use.
 */
const limiter = createRateLimiter({ config: DEFAULT_RATE_LIMIT_CONFIG });

const BodySchema = z.object({
  email: z.string().email(),
});

const RESET_TTL = parseInt(process.env.RESET_TOKEN_TTL ?? '1800', 10);
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', '/api/v1/auth/forgot-password');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'A valid email address is required', '/api/v1/auth/forgot-password');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0';
  const userAgent = req.headers.get('user-agent') ?? 'unknown';

  // Look up the user by email so we can generate the reset link
  const email = parsed.data.email.trim().toLowerCase();

  const key = tupleKey(ip, email);
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter, 'Too many reset requests', '/api/v1/auth/forgot-password');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  // Not `prisma.user.findUnique` — most people with an account have never logged into
  // the app, so they have no `users` row yet. See ensureUserFromWordPress.
  const user = await ensureUserFromWordPress(email);

  if (user) {
    // Invalidate any existing unused reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TTL * 1000),
        ipAddress: ip,
        userAgent,
      },
    });

    const emailContent = buildPasswordResetEmail({
      appUrl: APP_URL,
      resetToken: rawToken,
      ttlMinutes: Math.ceil(RESET_TTL / 60),
    });
    await sendEmail({
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      template: 'password-reset',
    });
    limiter.recordSuccess(key);
  } else {
    // An unknown address is what probing looks like, so it counts against the limiter —
    // which is invisible to the caller, since the response below never varies.
    limiter.recordFailure(key);
  }

  // Always return 200 to prevent email enumeration.
  return NextResponse.json({ message: 'If that email exists, a reset link has been sent.' }, { status: 200 });
}