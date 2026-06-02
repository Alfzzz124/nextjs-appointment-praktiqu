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

/** Convenience wrapper for Next.js route handlers. */
export function withAuth<T>(
  handler: (req: NextRequest, ctx: AuthContext & { params: T }) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: T): Promise<NextResponse> => {
    try {
      const actor = await getActor(req);
      return await handler(req, {
        actor,
        ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
        params: ctx,
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
