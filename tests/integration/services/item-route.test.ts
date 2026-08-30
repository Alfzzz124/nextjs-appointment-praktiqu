import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ actor: { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
}));

const scope = vi.hoisted(() => ({ scopeForRequest: vi.fn(), canWrite: vi.fn() }));
vi.mock('@/services/service-catalog/scope', async (orig) => ({
  ...(await orig<any>()),
  ...scope,
}));

const svc = vi.hoisted(() => ({
  getService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
}));
vi.mock('@/services/service-catalog/service', async (orig) => ({
  ...(await orig<any>()),
  ...svc,
}));

import { NextResponse } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/v1/services/[id]/route';

const url = 'http://localhost/api/v1/services/501';
const ctx = (id: string) => ({ params: { id } });
const req = (method = 'GET', body?: unknown) =>
  new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  });

const summary = { id: 501, serviceId: 101, name: 'Konseling Individu' };

beforeEach(() => {
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  scope.scopeForRequest.mockReset();
  scope.canWrite.mockReset();
  Object.values(svc).forEach((f) => f.mockReset());

  scope.scopeForRequest.mockResolvedValue({
    scope: { clinicId: 3n, doctorId: null, empty: false },
  });
  scope.canWrite.mockReturnValue(true);
  svc.getService.mockResolvedValue(summary);
  svc.updateService.mockResolvedValue(summary);
  svc.deleteService.mockResolvedValue({ ok: true });
});

describe('GET /api/v1/services/{id}', () => {
  it('returns the service', async () => {
    const res = await GET(req(), ctx('501'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 501 });
  });

  it('404s when the service is missing or out of scope', async () => {
    svc.getService.mockResolvedValue(null);

    expect((await GET(req(), ctx('501'))).status).toBe(404);
  });

  it('passes a scope-layer 403 straight through instead of throwing', async () => {
    scope.scopeForRequest.mockResolvedValue({
      response: NextResponse.json({ status: 403 }, { status: 403 }),
    });

    expect((await GET(req(), ctx('501'))).status).toBe(403);
    expect(svc.getService).not.toHaveBeenCalled();
  });

  it('400s a non-numeric id before it can become NaN in SQL', async () => {
    const res = await GET(req(), ctx('abc'));

    expect(res.status).toBe(400);
    expect(svc.getService).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/services/{id}', () => {
  it('updates and returns the fresh row', async () => {
    const res = await PUT(req('PUT', { price: 300000 }), ctx('501'));

    expect(res.status).toBe(200);
    expect(svc.updateService).toHaveBeenCalledWith(
      501,
      { price: 300000 },
      expect.anything(),
      'actor-1',
    );
  });

  it('403s a role that cannot write', async () => {
    scope.canWrite.mockReturnValue(false);

    expect((await PUT(req('PUT', { price: 1 }), ctx('501'))).status).toBe(403);
    expect(svc.updateService).not.toHaveBeenCalled();
  });

  it('400s a malformed body', async () => {
    expect((await PUT(req('PUT', '{ not json'), ctx('501'))).status).toBe(400);
  });

  it('422s an empty patch', async () => {
    expect((await PUT(req('PUT', {}), ctx('501'))).status).toBe(422);
  });

  it('404s when the service layer says not found', async () => {
    svc.updateService.mockRejectedValue({ _tag: 'not_found', entity: 'service' });

    expect((await PUT(req('PUT', { price: 1 }), ctx('501'))).status).toBe(404);
  });

  it('400s a bad_request tag rather than letting it fall through to a 500', async () => {
    // Not reachable from updateService today, but the error union permits it and the
    // collection route maps it. Both sibling routes must agree.
    svc.updateService.mockRejectedValue({
      _tag: 'bad_request',
      code: 'doctors_not_in_clinic',
      message: 'nope',
    });

    expect((await PUT(req('PUT', { price: 1 }), ctx('501'))).status).toBe(400);
  });

  it('409s a name collision', async () => {
    svc.updateService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_name_taken',
      message: 'taken',
    });

    expect((await PUT(req('PUT', { name: 'x' }), ctx('501'))).status).toBe(409);
  });
});

describe('DELETE /api/v1/services/{id}', () => {
  it('deletes and returns ok', async () => {
    const res = await DELETE(req('DELETE'), ctx('501'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('403s a role that cannot write', async () => {
    scope.canWrite.mockReturnValue(false);

    expect((await DELETE(req('DELETE'), ctx('501'))).status).toBe(403);
  });

  it('409s when upcoming appointments still use the service, and passes the count on', async () => {
    svc.deleteService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_has_upcoming_appointments',
      message: '3 upcoming appointment(s) still use this service.',
      count: 3,
    });

    const res = await DELETE(req('DELETE'), ctx('501'));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'service_has_upcoming_appointments',
      count: 3,
    });
  });

  it('404s when the service layer says not found', async () => {
    svc.deleteService.mockRejectedValue({ _tag: 'not_found', entity: 'service' });

    expect((await DELETE(req('DELETE'), ctx('501'))).status).toBe(404);
  });
});
