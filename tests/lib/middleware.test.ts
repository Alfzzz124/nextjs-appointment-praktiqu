/**
 * Which URLs may an anonymous visitor open?
 *
 * `src/app/(dashboard)/` is a Next.js **route group** — the parentheses mean the segment
 * never reaches the URL. So those pages are served at `/practice/settings`,
 * `/intervention-plans`, `/billing`, … and none of them begins with `/dashboard`, which is
 * what the old `PROTECTED_PREFIXES` list guarded. The prefix list guarded a URL that does
 * not exist, so `needsAuth` was `false` and every one of those pages was served to anyone.
 *
 * Nothing behind it caught the miss: `(dashboard)/layout.tsx` only wraps children in
 * sidebar chrome, and several of those pages are Server Components reading the database
 * directly rather than through the guarded `/api/v1` routes.
 *
 * The policy is now deny-by-default for pages, with one explicit public surface. These
 * tests pin both halves — the closed side, and the open side that guest booking and the
 * payment-gateway callbacks depend on.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { middleware } from '@/middleware';

/** Run the middleware against a bare GET: no cookie, no Authorization header. */
async function anonymousGet(pathname: string) {
  return middleware(new NextRequest(new URL(`http://localhost${pathname}`)));
}

/** The same resolution order the middleware module uses at import time. */
const SECRET = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? 'dev-secret-change-me';

async function signedGet(pathname: string, role = 'CLINIC_ADMIN') {
  const token = await new SignJWT({ type: 'access', sub: 'wpu_119', role, email: 'a@b.c', username: 'a' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));

  const req = new NextRequest(new URL(`http://localhost${pathname}`), {
    headers: { authorization: `Bearer ${token}` },
  });
  return middleware(req);
}

/** `NextResponse.next()` answers 200; `NextResponse.redirect()` answers 307. */
const PASSED_THROUGH = 200;
const REDIRECTED = 307;

describe('middleware — pages are closed unless explicitly public', () => {
  // Every one of these is a `(dashboard)` page, so none begins with `/dashboard`.
  const closed = [
    '/practice/settings',
    '/practice/holidays',
    '/intervention-plans',
    '/intervention-plans/clx123abc',
    '/intervention-plans/clx123abc/print',
    '/billing',
    '/consent-forms',
    '/professional/sessions',
    '/settings/custom-fields',
    '/client/progress',
    '/admin/clients',
  ];

  for (const pathname of closed) {
    it(`sends an anonymous visitor at ${pathname} to the login page`, async () => {
      const res = await anonymousGet(pathname);

      expect(res.status).toBe(REDIRECTED);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      // The visitor lands back where they were headed once they sign in.
      expect(location.searchParams.get('returnTo')).toBe(pathname);
    });
  }

  it('lets a signed-in caller through to a dashboard page', async () => {
    const res = await signedGet('/practice/settings');

    expect(res.status).toBe(PASSED_THROUGH);
  });

  it('closes an unknown page rather than serving it', async () => {
    // The point of deny-by-default: a page nobody added to the allowlist fails closed.
    const res = await anonymousGet('/some/page/added/next/quarter');

    expect(res.status).toBe(REDIRECTED);
  });
});

describe('middleware — the public surface stays open', () => {
  // Guest booking and self-service live here. If any of these starts redirecting, an
  // unauthenticated visitor can no longer book a session.
  const open = [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/book',
    '/book/confirmation',
    '/book/119/42',
    '/book/119/42/confirm',
    '/book/119/service',
    '/consent/clx9/sign',
    '/favicon.ico',
    '/_next/chunk.js',
  ];

  for (const pathname of open) {
    it(`serves ${pathname} without a session`, async () => {
      const res = await anonymousGet(pathname);

      expect(res.status).toBe(PASSED_THROUGH);
    });
  }

  it('does not treat /booking-admin as part of the public /book surface', async () => {
    // Prefix matching runs on whole segments, so a future admin page whose name merely
    // starts with a public word is not accidentally opened.
    const res = await anonymousGet('/booking-admin');

    expect(res.status).toBe(REDIRECTED);
  });
});

describe('middleware — API routes keep their own guards', () => {
  // These carry no user token: the gateway calls them back directly and the route
  // verifies an HMAC signature instead. Gating them here would stop payments.
  const gatewayCallbacks = [
    '/api/v1/sessions/payment-webhook',
    '/api/v1/sessions/payment-success',
    '/api/v1/sessions/payment-cancel',
    '/api/v1/sessions/payment-verify',
  ];

  for (const pathname of gatewayCallbacks) {
    it(`does not gate the gateway callback ${pathname}`, async () => {
      const res = await anonymousGet(pathname);

      expect(res.status).toBe(PASSED_THROUGH);
    });
  }

  it('leaves an ordinary API route to its own withAuth guard', async () => {
    const res = await anonymousGet('/api/v1/sessions');

    expect(res.status).toBe(PASSED_THROUGH);
  });

  it('answers 401 problem+json — not a redirect — for a gated API route', async () => {
    const res = await anonymousGet('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('still requires SUPER_ADMIN on /api/v1/admin', async () => {
    const res = await signedGet('/api/v1/admin/anything', 'CLINIC_ADMIN');

    expect(res.status).toBe(403);
  });

  it('serves the public API without a session', async () => {
    const res = await anonymousGet('/api/v1/public/professionals');

    expect(res.status).toBe(PASSED_THROUGH);
  });
});
