/**
 * POST /api/v1/auth/logout — invalidate refresh token (FR-002).
 * Idempotent: a 204 is returned even if the token is already invalid.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logout } from '@/services/auth/service';
import { getClientIp } from '@/services/auth/service';
import { badRequest, unauthorized, problemHeaders } from '@/lib/problem-details';

const BodySchema = z.object({
  refreshToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Missing body is OK — logout without a token just clears the session cookie.
    body = {};
  }

  const parsed = BodySchema.safeParse(body);

  // Extract userId from the auth header if present (for audit tracking).
  let userId: string | undefined;
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  if (bearer) {
    try {
      const claims = JSON.parse(atob(bearer.split('.')[1]!));
      userId = claims.sub;
    } catch {
      // ignore malformed token
    }
  }

  const ip = getClientIp(req.headers);
  const userAgent = req.headers.get('user-agent') ?? 'unknown';

  await logout({
    refreshToken: parsed.success ? parsed.data.refreshToken : undefined,
    userId,
    ip,
    userAgent,
  });

  return new NextResponse(null, { status: 204 });
}