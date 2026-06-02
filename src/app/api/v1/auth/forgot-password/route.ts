/**
 * POST /api/v1/auth/forgot-password (FR-004).
 * Always returns 200 (no enumeration) even if email is unknown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { sendEmail, buildPasswordResetEmail } from '@/lib/email';
import { badRequest, problemHeaders } from '@/lib/problem-details';

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
  const user = await prisma.user.findUnique({ where: { email } });

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
  }

  // Always return 200 to prevent email enumeration.
  return NextResponse.json({ message: 'If that email exists, a reset link has been sent.' }, { status: 200 });
}