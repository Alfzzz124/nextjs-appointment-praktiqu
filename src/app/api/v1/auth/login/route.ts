/**
 * POST /api/v1/auth/login
 * FR-001: authenticate against WordPress, issue JWT access + refresh tokens.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { login } from '@/services/auth/service';
import { getClientIp } from '@/services/auth/service';
import { badRequest, unauthorized, forbidden, serviceUnavailable, problemHeaders, type ProblemDetails } from '@/lib/problem-details';
import { tooManyRequests } from '@/lib/problem-details';

const BodySchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', '/api/v1/auth/login');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'Missing or invalid email or password', '/api/v1/auth/login');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip = getClientIp(req.headers);
  const userAgent = req.headers.get('user-agent') ?? 'unknown';

  try {
    const result = await login({
      email: parsed.data.email,
      password: parsed.data.password,
      ip,
      userAgent,
    });

    // `wpUserId` is a Prisma BigInt, which JSON.stringify cannot serialize —
    // convert to a plain number (WP user ids are always small integers).
    const { wpUserId, ...userRest } = result.user;
    return NextResponse.json(
      {
        user: { ...userRest, wpUserId: wpUserId == null ? null : Number(wpUserId) },
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown';
    const status = (err as { status?: number }).status ?? 500;

    if (status === 429) {
      const retryMs = (err as { retryAfterMs?: number }).retryAfterMs ?? 0;
      const p = tooManyRequests('rate_limited', Math.ceil(retryMs / 1000), 'Too many failed attempts', '/api/v1/auth/login');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 401) {
      const p = unauthorized(code, 'Email or password is incorrect', '/api/v1/auth/login');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 403) {
      const p = forbidden(code, code === 'inactive' ? 'Account is inactive' : code === 'locked' ? 'Account is locked' : 'Access denied', '/api/v1/auth/login');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 503) {
      const p = serviceUnavailable('service_unavailable', 'Authentication service is temporarily unavailable', '/api/v1/auth/login');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    // Unexpected error
    // eslint-disable-next-line no-console
    console.error('[auth/login] unexpected error:', err);
    const p = serviceUnavailable('internal_error', 'An unexpected error occurred', '/api/v1/auth/login');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
}
