/**
 * `withAuth` receives its second argument exactly as Next.js invokes route
 * handlers: `handler(req, { params })` for dynamic routes, and no second
 * argument at all for non-dynamic ones. It must hand the wrapped handler the
 * *params object itself* at `ctx.params` — not the `{ params }` wrapper Next
 * gives it — or every route reading `ctx.params.id` sees `undefined`.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(sub = 'user-1') {
  return new SignJWT({ role: 'SUPER_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(SECRET);
}

function reqWith(jwt: string) {
  return new NextRequest('http://localhost/api/v1/whatever/42', {
    headers: { authorization: `Bearer ${jwt}` },
  });
}

describe('withAuth params unwrapping', () => {
  it('gives the handler the params object itself when Next.js calls it the dynamic-route way', async () => {
    const wrapped = withAuth<{ id: string }>(async (_req, ctx) => {
      expect(ctx.params.id).toBe('42');
      return NextResponse.json({ ok: true });
    });

    const res = await wrapped(reqWith(await token()), { params: { id: '42' } });
    expect(res.status).toBe(200);
  });

  it('gives the handler an object (not undefined) when Next.js omits ctx for a non-dynamic route', async () => {
    const wrapped = withAuth<{ id?: string }>(async (_req, ctx) => {
      expect(ctx.params).toBeDefined();
      expect(typeof ctx.params).toBe('object');
      expect(ctx.params.id).toBeUndefined();
      return NextResponse.json({ ok: true });
    });

    const res = await wrapped(reqWith(await token()));
    expect(res.status).toBe(200);
  });
});
