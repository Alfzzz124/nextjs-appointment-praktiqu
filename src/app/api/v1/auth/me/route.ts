/**
 * GET /api/v1/auth/me — current user profile (FR-018).
 * Reads claims from the Authorization: Bearer header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMeFromAccessToken } from '@/services/auth/service';
import { unauthorized, serviceUnavailable, problemHeaders } from '@/lib/problem-details';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    const p = unauthorized('missing_token', 'Authorization header required', '/api/v1/auth/me');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }

  const token = auth.slice(7);
  try {
    const me = await getMeFromAccessToken(token);
    // `wpUserId` is a Prisma BigInt (not JSON-serializable) — convert to number.
    const { wpUserId, ...meRest } = me;
    return NextResponse.json({ user: { ...meRest, wpUserId: wpUserId == null ? null : Number(wpUserId) } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as { code?: string }).code ?? 'unknown';
    if (status === 401) {
      const p = unauthorized(code, 'Token invalid or expired', '/api/v1/auth/me');
      return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
    }
    // eslint-disable-next-line no-console
    console.error('[auth/me] error:', err);
    const p = serviceUnavailable('internal_error', 'An unexpected error occurred', '/api/v1/auth/me');
    return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
  }
}