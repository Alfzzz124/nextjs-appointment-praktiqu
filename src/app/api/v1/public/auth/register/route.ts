/**
 * POST /api/v1/public/auth/register
 *
 * Patient self-registration (FR-022). Public — no token required.
 *
 * Creates the WordPress patient first, then the PraktiQU `User` row, then signs the
 * patient in: the response body matches `POST /api/v1/auth/login` so both flows store a
 * session the same way. Rate limiting, password rules and the duplicate check all live
 * in `register()`; this route only maps errors onto problem+json.
 *
 * Not to be confused with `POST /api/v1/auth/register`, which is SUPER_ADMIN-only staff
 * provisioning and creates no WordPress account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { register, getClientIp } from '@/services/auth/service';
import {
  badRequest,
  conflict,
  tooManyRequests,
  serviceUnavailable,
  problemHeaders,
} from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const INSTANCE = '/api/v1/public/auth/register';

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  contactNumber: z.string().min(1).optional(),
});

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
    const p = badRequest('validation_error', parsed.error.issues[0]?.message ?? 'Invalid input', INSTANCE);
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  try {
    const result = await register({
      email: parsed.data.email,
      password: parsed.data.password,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      contactNumber: parsed.data.contactNumber,
      ip: getClientIp(req.headers),
      userAgent: req.headers.get('user-agent') ?? 'unknown',
    });

    // `wpUserId` is a Prisma BigInt, which JSON.stringify cannot serialise — WP user ids
    // are always small integers, so a plain number is safe.
    const { wpUserId, ...userRest } = result.user;
    return NextResponse.json(
      {
        userId: result.userId,
        user: { ...userRest, wpUserId: wpUserId == null ? null : Number(wpUserId) },
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown';
    const status = (err as { status?: number }).status ?? 500;

    if (status === 429) {
      const retryMs = (err as { retryAfterMs?: number }).retryAfterMs ?? 0;
      const p = tooManyRequests('rate_limited', Math.ceil(retryMs / 1000), 'Too many attempts', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (code === 'weak_password') {
      const p = badRequest('weak_password', (err as Error).message, INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (code === 'duplicate_email') {
      // Say only that the address is taken. Which kind of account holds it — patient,
      // doctor, admin — is not a stranger's business.
      const p = conflict('duplicate_email', 'That email is already registered — please sign in', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    if (status === 503) {
      const p = serviceUnavailable('service_unavailable', 'Registration is temporarily unavailable', INSTANCE);
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }

    console.error('[public/auth/register] unexpected error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
