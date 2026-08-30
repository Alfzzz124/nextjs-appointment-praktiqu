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

const svc = vi.hoisted(() => ({ listServices: vi.fn(), createService: vi.fn() }));
vi.mock('@/services/service-catalog/service', async (orig) => ({
  ...(await orig<any>()),
  ...svc,
}));

import { NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/v1/services/route';

const get = (qs = '') => new NextRequest(`http://localhost/api/v1/services${qs}`);
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/services', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const validBody = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001],
};

beforeEach(() => {
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  scope.scopeForRequest.mockReset();
  scope.canWrite.mockReset();
  svc.listServices.mockReset();
  svc.createService.mockReset();

  scope.scopeForRequest.mockResolvedValue({
    scope: { clinicId: 3n, doctorId: null, empty: false },
  });
  scope.canWrite.mockReturnValue(true);
  svc.listServices.mockResolvedValue({ services: [], total: 0, page: 1, perPage: 20 });
  svc.createService.mockResolvedValue({
    serviceId: 101,
    name: 'Konseling Individu',
    category: { id: 7, label: 'Psychology Services', value: 'psychology_services' },
    mappings: [{ id: 501, doctorId: 8100001 }],
  });
});

describe('GET /api/v1/services', () => {
  it('returns the paginated list', async () => {
    const res = await GET(get('?page=1&perPage=20'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ services: [], total: 0 });
  });

  it('rejects an unparseable query with 422', async () => {
    const res = await GET(get('?perPage=500'));

    expect(res.status).toBe(422);
    expect(svc.listServices).not.toHaveBeenCalled();
  });

  it('passes the parsed query and scope straight through', async () => {
    await GET(get('?search=Konseling&includeInactive=true'));

    expect(svc.listServices).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Konseling', includeInactive: true }),
      expect.objectContaining({ clinicId: 3n }),
    );
  });
});

describe('POST /api/v1/services', () => {
  it('creates and answers 201', async () => {
    const res = await POST(post(validBody));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ serviceId: 101 });
    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 3, 'actor-1');
  });

  it('refuses a role that cannot write with 403', async () => {
    scope.canWrite.mockReturnValue(false);

    const res = await POST(post(validBody));

    expect(res.status).toBe(403);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400', async () => {
    const res = await POST(post('{ not json'));

    expect(res.status).toBe(400);
  });

  it('rejects an invalid body with 422 and field errors', async () => {
    const res = await POST(post({ ...validBody, duration: 0 }));

    expect(res.status).toBe(422);
    expect((await res.json()).fields).toHaveProperty('duration');
  });

  it("ignores a clinicId the admin does not own", async () => {
    await POST(post({ ...validBody, clinicId: 99 }));

    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 3, 'actor-1');
  });

  it('lets a SUPER_ADMIN choose the clinic', async () => {
    auth.actor = { id: 'root', role: 'SUPER_ADMIN', practiceId: null };
    scope.scopeForRequest.mockResolvedValue({
      scope: { clinicId: null, doctorId: null, empty: false },
    });

    await POST(post({ ...validBody, clinicId: 99 }));

    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 99, 'root');
  });

  it('asks a SUPER_ADMIN for a clinic when none is given', async () => {
    auth.actor = { id: 'root', role: 'SUPER_ADMIN', practiceId: null };
    scope.scopeForRequest.mockResolvedValue({
      scope: { clinicId: null, doctorId: null, empty: false },
    });

    const res = await POST(post(validBody));

    expect(res.status).toBe(422);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('maps a service-layer conflict to 409', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_already_offered',
      message: 'already offered',
    });

    expect((await POST(post(validBody))).status).toBe(409);
  });

  it('maps a doctors-not-in-clinic error to 400', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'bad_request',
      code: 'doctors_not_in_clinic',
      message: 'nope',
    });

    expect((await POST(post(validBody))).status).toBe(400);
  });

  it('passes a scope-layer 403 straight through instead of throwing', async () => {
    scope.scopeForRequest.mockResolvedValue({
      response: NextResponse.json({ status: 403 }, { status: 403 }),
    });

    expect((await POST(post(validBody))).status).toBe(403);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('maps an unknown-category error to 422', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'validation',
      errors: { categoryId: ['Unknown service category'] },
    });

    expect((await POST(post(validBody))).status).toBe(422);
  });
});
