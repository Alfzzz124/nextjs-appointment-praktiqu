/**
 * The three Google Calendar connection routes.
 *
 * Services are mocked; what is under test is the wiring and the refusals — who is
 * allowed to start a flow, what happens to a returnUrl that is not permitted, and
 * what the callback does with each way the flow can end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let actor = { id: 'u1', role: 'PROFESSIONAL', practiceId: null as string | null };

vi.mock('@/lib/auth', () => ({
  withAuth:
    (handler: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown, ctx?: { params?: unknown }) =>
      handler(req, { actor, ip: null, userAgent: null, params: ctx?.params ?? {} }),
  getActor: vi.fn(),
}));
vi.mock('@/services/billing/kc-actor', () => ({
  resolveKcActor: vi.fn(async () => ({ wpUserId: 4242n, clinicId: 1n })),
}));
vi.mock('@/lib/google/oauth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/google/oauth-client')>()),
  exchangeCodeForTokens: vi.fn(),
}));
vi.mock('@/services/integrations/google-calendar-connection.service', () => ({
  saveConnection: vi.fn(),
  getConnectionStatus: vi.fn(async () => ({ status: 'active' })),
  disconnectCalendar: vi.fn(),
}));

import { POST as authUrl } from '@/app/api/v1/integrations/google-calendar/auth-url/route';
import { GET as callback } from '@/app/api/v1/integrations/google-calendar/callback/route';
import { GET as status, DELETE as remove } from '@/app/api/v1/integrations/google-calendar/route';
import { signOAuthState } from '@/lib/google/oauth-state';
import * as oauth from '@/lib/google/oauth-client';
import * as connections from '@/services/integrations/google-calendar-connection.service';

const ALLOWED = 'https://terpadu.praktiqu.com/dashboard/kalender';

beforeEach(() => {
  vi.clearAllMocks();
  actor = { id: 'u1', role: 'PROFESSIONAL', practiceId: null };
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.APP_URL = 'https://staging2.praktiqu.com';
  process.env.GOOGLE_OAUTH_RETURN_URL_ALLOWLIST = 'https://terpadu.praktiqu.com/dashboard';
  (connections.getConnectionStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: 'active',
  });
});

function post(body: unknown) {
  return new NextRequest('http://x/api/v1/integrations/google-calendar/auth-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function get(qs: string) {
  return new NextRequest(`http://x/api/v1/integrations/google-calendar/callback?${qs}`);
}

describe('POST auth-url', () => {
  it('hands back a Google consent URL carrying our state', async () => {
    const res = await authUrl(post({ returnUrl: ALLOWED }), undefined as never);
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).url);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://staging2.praktiqu.com/api/v1/integrations/google-calendar/callback',
    );
  });

  it('refuses a returnUrl outside the allowlist', async () => {
    const res = await authUrl(post({ returnUrl: 'https://evil.example/dashboard' }), undefined as never);
    expect(res.status).toBe(422);
  });

  it('refuses anyone who is not the professional themselves', async () => {
    actor = { id: 'u2', role: 'CLINIC_ADMIN', practiceId: 'p1' };
    const res = await authUrl(post({ returnUrl: ALLOWED }), undefined as never);
    expect(res.status).toBe(403);
  });

  it('says so plainly when the server has no Google credentials', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await authUrl(post({ returnUrl: ALLOWED }), undefined as never);
      expect(res.status).toBe(503);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('GET callback', () => {
  const state = () => signOAuthState({ professionalId: 4242, returnUrl: ALLOWED });

  it('stores the connection and sends the browser back with gcal=ok', async () => {
    (oauth.exchangeCodeForTokens as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      refreshToken: 'rt', email: 'dr@gmail.com', scope: 'freebusy',
    });
    const res = await callback(get(`code=CODE&state=${encodeURIComponent(state())}`));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get('location') as string);
    expect(to.origin + to.pathname).toBe(ALLOWED);
    expect(to.searchParams.get('gcal')).toBe('ok');
    expect(connections.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: 4242, googleAccountEmail: 'dr@gmail.com' }),
    );
  });

  it('treats a refusal at the consent screen as denied, not an error', async () => {
    const res = await callback(get(`error=access_denied&state=${encodeURIComponent(state())}`));
    expect(new URL(res.headers.get('location') as string).searchParams.get('gcal')).toBe('denied');
    expect(connections.saveConnection).not.toHaveBeenCalled();
  });

  it('reports a failed exchange as gcal=error with a stable reason', async () => {
    (oauth.exchangeCodeForTokens as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new oauth.GoogleOAuthError('Google returned no refresh token'),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await callback(get(`code=CODE&state=${encodeURIComponent(state())}`));
      const to = new URL(res.headers.get('location') as string);
      expect(to.searchParams.get('gcal')).toBe('error');
      expect(to.searchParams.get('reason')).toBe('token_exchange_failed');
      // Google's own prose must not travel in the URL — it lands in browser
      // history and logs the front end does not control.
      expect(to.searchParams.get('reason')).not.toContain('refresh token');
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses to redirect at all when the state does not verify', async () => {
    // The one path that cannot redirect: nothing trustworthy says where to.
    const res = await callback(get('code=CODE&state=forged'));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('refuses when the allowlist no longer permits the stored returnUrl', async () => {
    const signed = signOAuthState({ professionalId: 4242, returnUrl: ALLOWED });
    process.env.GOOGLE_OAUTH_RETURN_URL_ALLOWLIST = 'https://other.praktiqu.com/dashboard';
    const res = await callback(get(`code=CODE&state=${encodeURIComponent(signed)}`));
    expect(res.status).toBe(400);
  });
});

describe('GET / DELETE the connection', () => {
  it('returns the status for the professional themselves', async () => {
    const res = await status(new NextRequest('http://x/api/v1/integrations/google-calendar'), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('active');
  });

  it('removes the connection and answers 204', async () => {
    const res = await remove(new NextRequest('http://x/api/v1/integrations/google-calendar', { method: 'DELETE' }), undefined as never);
    expect(res.status).toBe(204);
    expect(connections.disconnectCalendar).toHaveBeenCalledWith(4242);
  });

  it('refuses a non-professional', async () => {
    actor = { id: 'u2', role: 'RECEPTIONIST', practiceId: 'p1' };
    const res = await status(new NextRequest('http://x/api/v1/integrations/google-calendar'), undefined as never);
    expect(res.status).toBe(403);
  });
});
