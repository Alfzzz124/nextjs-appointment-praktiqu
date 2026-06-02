/**
 * Edge middleware for protected routes.
 *
 * - Verifies the access-token JWT.
 * - Injects `x-praktiqu-user` header with `{id, role, email, username}` JSON.
 * - For RBAC-protected routes, requires the action on the user.
 *
 * Note: This file uses `jose` directly (Edge runtime safe — no Node APIs).
 * The `next/server` middleware contract returns NextResponse.next() or
 * NextResponse.json(..., { status }) for blocked requests.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const KEY = new TextEncoder().encode(SECRET);

const PROTECTED_PREFIXES = ['/dashboard', '/admin'];
const PUBLIC_API_PREFIXES = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password', '/api/v1/webhooks/wordpress', '/api/v1/webhooks/wordpress-jobs', '/api/v1/auth/health', '/api/health'];

interface AccessClaims {
  sub: string;
  role: string;
  email: string;
  username: string;
}

async function verify(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, KEY, { clockTolerance: 5 });
    if (payload.type !== 'access') return null;
    return payload as unknown as AccessClaims;
  } catch {
    return null;
  }
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname.startsWith('/login')) return true;
  if (pathname.startsWith('/forgot-password')) return true;
  if (pathname.startsWith('/reset-password')) return true;
  if (pathname.startsWith('/register')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always pass through public assets and the public endpoints.
  if (isPublic(pathname)) return NextResponse.next();

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api/v1/admin') || pathname.startsWith('/api/v1/auth/me') || pathname.startsWith('/api/v1/auth/logout') || pathname.startsWith('/api/v1/auth/change-password');

  if (!needsAuth) return NextResponse.next();

  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  const cookieToken = req.cookies.get('access_token')?.value ?? null;
  const token = bearer ?? cookieToken;

  if (!token) {
    return unauthorized(req, 'missing_token');
  }

  const claims = await verify(token);
  if (!claims) {
    return unauthorized(req, 'invalid_token');
  }

  // RBAC for admin paths
  if (pathname.startsWith('/api/v1/admin') && claims.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      {
        type: 'https://praktiqu.example.com/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        code: 'forbidden',
        detail: 'SUPER_ADMIN role required',
        instance: pathname,
      },
      { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const res = NextResponse.next();
  res.headers.set('x-praktiqu-user', JSON.stringify(claims));
  return res;
}

function unauthorized(req: NextRequest, code: string) {
  // For page navigations, redirect to login. For API, return 401 problem+json.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        type: 'https://praktiqu.example.com/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        code,
        detail: 'Authentication required',
        instance: req.nextUrl.pathname,
      },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('returnTo', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
