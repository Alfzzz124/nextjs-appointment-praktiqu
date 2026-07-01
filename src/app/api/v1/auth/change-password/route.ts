/**
 * POST /api/v1/auth/change-password
 *
 * Authenticated user changes their own password via WordPress.
 * Access: any authenticated user.
 * Body: { currentPassword: string; newPassword: string }
 * Returns: 200 + new token pair on success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';
import { badRequest } from '@/lib/problem-details';
import { changePassword, AuthError, InvalidCredentialsError, WeakPasswordError, WpUnavailableError } from '@/services/auth/service';
import { z } from 'zod';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext & { params: unknown }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(badRequest('invalid_json', 'Request body must be valid JSON'), {
      status: 400,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      badRequest('validation_error', 'currentPassword and newPassword (min 8 chars) are required'),
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  try {
    const tokens = await changePassword({
      userId: ctx.actor.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      ip: ctx.ip ?? '0.0.0.0',
      userAgent: ctx.userAgent ?? '',
    });
    return NextResponse.json({ data: tokens });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return NextResponse.json(
        badRequest('invalid_credentials', 'Current password is incorrect'),
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    if (err instanceof WeakPasswordError) {
      return NextResponse.json(
        badRequest('weak_password', err.message),
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
      );
    }
    if (err instanceof WpUnavailableError) {
      return NextResponse.json(
        { code: 'service_unavailable', message: 'Authentication service unavailable' },
        { status: 503 },
      );
    }
    throw err;
  }
});
