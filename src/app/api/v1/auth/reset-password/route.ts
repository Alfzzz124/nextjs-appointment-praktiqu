/**
 * POST /api/v1/auth/reset-password (FR-005).
 *
 * Second half of the forgot-password flow: takes the raw token from the emailed link
 * plus a new password, and hands both to `resetPassword()`.
 *
 * No tokens are issued. The user signs in again — holding the email link should not by
 * itself hand out a session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resetPassword, getClientIp } from '@/services/auth/service';
import {
  badRequest,
  tooManyRequests,
  serviceUnavailable,
  problemHeaders,
} from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/auth/reset-password';

const BodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

/** Token-state failures the front-end is expected to tell apart. */
const TOKEN_ERROR_DETAIL: Record<string, string> = {
  invalid_token: 'Reset link is not valid — please request a new one',
  token_expired: 'Reset link has expired — please request a new one',
  token_used: 'Reset link has already been used — please request a new one',
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'Both token and password are required', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  try {
    await resetPassword({
      token: parsed.data.token,
      password: parsed.data.password,
      ip: getClientIp(req.headers),
    });
    return NextResponse.json({ message: 'Password updated. Please sign in.' }, { status: 200 });
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown';
    const status = (err as { status?: number }).status ?? 500;

    if (status === 429) {
      const retryMs = (err as { retryAfterMs?: number }).retryAfterMs ?? 0;
      const p = tooManyRequests('rate_limited', Math.ceil(retryMs / 1000), 'Too many attempts', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (code in TOKEN_ERROR_DETAIL) {
      const p = badRequest(code, TOKEN_ERROR_DETAIL[code], INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (code === 'weak_password') {
      const p = badRequest('weak_password', (err as Error).message, INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 503) {
      const p = serviceUnavailable('service_unavailable', 'Password reset is temporarily unavailable', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }

    console.error('[auth/reset-password] unexpected error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
