/**
 * The active-clinic header makes getActor() throw 400/403 as well as 401. Wrappers that
 * turned every AuthError into 401 would send the Laravel FE into a pointless token refresh
 * and retry; they must pass the real status and the code (the error message) through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getActor: vi.fn() };
});

import { AuthError, getActor } from '@/lib/auth';
import { requireRoles } from '@/lib/auth/route-guards';
import { callerFromRequest } from '@/lib/auth/caller';
import { callerFromHeaders } from '@/lib/auth/session-notes-caller';

const request = () => new NextRequest('http://localhost/api/v1/anything');

beforeEach(() => { vi.mocked(getActor).mockReset(); });

describe('requireRoles', () => {
  it('answers 403 with the clinic code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('clinic_not_in_scope', 403));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(403);
    expect((await gate.response.json()).code).toBe('clinic_not_in_scope');
  });

  it('answers 400 with the header code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('invalid_clinic_header', 400));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(400);
    expect((await gate.response.json()).code).toBe('invalid_clinic_header');
  });

  it('still answers 401 unauthorized for a bad token', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(401);
    expect((await gate.response.json()).code).toBe('unauthorized');
  });
});

describe('callerFromRequest (intervention plans)', () => {
  it('keeps 403 and the code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('clinic_not_in_scope', 403));
    await expect(callerFromRequest(request())).rejects.toMatchObject({ status: 403, message: 'clinic_not_in_scope' });
  });

  it('still reports 401 as unauthenticated', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    await expect(callerFromRequest(request())).rejects.toMatchObject({ status: 401, message: 'unauthenticated' });
  });
});

describe('callerFromHeaders (session notes)', () => {
  it('keeps 400 and the code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('invalid_clinic_header', 400));
    await expect(callerFromHeaders(request())).rejects.toMatchObject({ status: 400, message: 'invalid_clinic_header' });
  });

  it('still reports 401 as unauthenticated', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    await expect(callerFromHeaders(request())).rejects.toMatchObject({ status: 401, message: 'unauthenticated' });
  });
});
