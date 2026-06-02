/**
 * POST /api/v1/auth/refresh — token refresh with rotation (FR-015).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { refresh } from '@/services/auth/service';
import { getClientIp } from '@/services/auth/service';
import { badRequest, unauthorized, problemHeaders, serviceUnavailable } from '@/lib/problem-details';

const BodySchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const p = badRequest('invalid_body', 'Request body must be valid JSON', '/api/v1/auth/refresh');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('validation_error', 'refreshToken is required', '/api/v1/auth/refresh');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const ip = getClientIp(req.headers);
  const userAgent = req.headers.get('user-agent') ?? 'unknown';

  try {
    const result = await refresh({ refreshToken: parsed.data.refreshToken, ip, userAgent });
    return NextResponse.json({
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      refreshToken: result.refreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as { code?: string }).code ?? 'unknown';
    if (status === 401) {
      const p = unauthorized(code, 'Token expired or revoked', '/api/v1/auth/refresh');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    // eslint-disable-next-line no-console
    console.error('[auth/refresh] error:', err);
    const p = serviceUnavailable('internal_error', 'An unexpected error occurred', '/api/v1/auth/refresh');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
}