/**
 * Auth context helper for API routes.
 *
 * Reads the JWT session from the `Authorization: Bearer <token>` header
 * and resolves the PraktiQU User + actor context. Throws 401 if
 * unauthenticated or 403 if the role is not permitted.
 *
 * In production this would delegate to NextAuth v5's `auth()` function.
 * Here we decode the JWT directly (no DB round-trip on every request).
 *
 * The JWT payload shape:
 *   { sub: userId, role: UserRole, practiceId: string | null, iat, exp }
 */

import { NextRequest, NextResponse } from 'next/server';
import { clientIpOrNull } from '@/lib/client-ip';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'dev-secret-change-me',
);

export interface Actor {
  id: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  practiceId: string | null;
}

export interface AuthContext {
  actor: Actor;
  ip: string | null;
  userAgent: string | null;
}

export async function getActor(req: NextRequest): Promise<Actor> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }
  const token = header.slice('Bearer '.length);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) throw new AuthError('Invalid token: missing sub', 401);
    return {
      id: payload.sub as string,
      role: (payload.role as Actor['role']) ?? 'CLIENT',
      practiceId: (payload.practiceId as string | null) ?? null,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired token', 401);
  }
}

/**
 * The actor behind a request on a route that does NOT require one, or null.
 *
 * For public routes that treat a signed-in caller differently without turning a guest
 * away. It never throws: a missing, malformed or forged bearer is simply "nobody",
 * which is how the route already treats every guest.
 *
 * `expiredGraceSeconds` accepts a token whose `exp` passed up to that long ago. The
 * signature is still verified in full, so the identity is one we issued; only its
 * freshness is relaxed. Use it only where the answer grants nothing (deciding what NOT
 * to do to a booking, say) and never to authorise anything.
 */
export async function optionalActor(
  req: NextRequest,
  opts: { expiredGraceSeconds?: number } = {},
): Promise<Actor | null> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(header.slice('Bearer '.length), JWT_SECRET, {
      clockTolerance: opts.expiredGraceSeconds ?? 0,
    });
    if (!payload.sub) return null;
    return {
      id: payload.sub as string,
      role: (payload.role as Actor['role']) ?? 'CLIENT',
      practiceId: (payload.practiceId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Convenience wrapper for Next.js route handlers. */
export function withAuth<T>(
  handler: (req: NextRequest, ctx: AuthContext & { params: T }) => Promise<NextResponse>,
) {
  // Next.js invokes route handlers as `handler(req, { params })`, so the second
  // argument here is `{ params: T }`, not `T` itself — and it is omitted entirely
  // for non-dynamic routes. Unwrap `.params` (falling back to `{}` when ctx is
  // absent) so handlers read `ctx.params.id` directly instead of the doubly-nested
  // `ctx.params.params.id`. Do not assign `ctx` straight to `params` again.
  return async (req: NextRequest, ctx?: { params: T }): Promise<NextResponse> => {
    try {
      const actor = await getActor(req);
      return await handler(req, {
        actor,
        ip: clientIpOrNull(req.headers),
        userAgent: req.headers.get('user-agent') ?? null,
        params: (((ctx as any)?.params) ?? {}) as T,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
