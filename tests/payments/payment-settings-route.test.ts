/**
 * GET / PUT /api/v1/practices/{id}/payment-settings (spec §3 "Access", §7 route tests).
 *
 * Real JWTs through the real role guard and scope check, the real service, repo and
 * logger. Mocked: Prisma (so the audit row is the `log_entries` insert itself), the
 * clinic lookup, the clinic-admin → clinic resolution, and the plugin PUT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  kcOption: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  kcUser: { findUnique: vi.fn() },
  logEntry: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(),
}));
vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
}));
vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  putClinicPaymentSettings: vi.fn(),
}));

import { GET, PUT } from '@/app/api/v1/practices/[id]/payment-settings/route';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { WpEndpointError, putClinicPaymentSettings } from '@/lib/wp-endpoint';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';
import { bearerToken } from '../helpers/auth';

const SUPER_ID = 'cksuperadmin00000000000001';
const ADMIN_ID = 'ckclinicadmin0000000000001';
const OWN_CLINIC = 4;
const OTHER_CLINIC = 9;
const VALID = { international: true, fxRate: 18000, markupPercent: 10, fixedFeeIdr: 25000 };
const NOTHING_STORED = { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };

function optionRow(fields: Record<string, unknown> = {}) {
  return {
    optionName: `praktiqu_endpoint_clinic_${OWN_CLINIC}_payment`,
    optionValue: JSON.stringify({
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000,
      updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123, ...fields,
    }),
  };
}
const globalRate = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: v });

async function call(
  method: 'GET' | 'PUT',
  role: Actor['role'] | null,
  opts: { id?: string; body?: unknown; userId?: string } = {},
): Promise<Response> {
  const id = opts.id ?? String(OWN_CLINIC);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) {
    const userId = opts.userId ?? (role === 'SUPER_ADMIN' ? SUPER_ID : ADMIN_ID);
    headers.authorization = `Bearer ${await bearerToken({ userId, role })}`;
  }
  const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const req = new NextRequest(`http://x/api/v1/practices/${id}/payment-settings`, { method, headers, body });
  return (method === 'GET' ? GET : PUT)(req, { params: { id } }) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findClinicById).mockImplementation(async (id: bigint) =>
    id === BigInt(OWN_CLINIC) || id === BigInt(OTHER_CLINIC) ? ({ id } as never) : null,
  );
  // The clinic admin runs clinic 4.
  vi.mocked(resolveKcActor).mockImplementation(async (actor: Actor) => ({ actor, wpUserId: 55n, clinicId: BigInt(OWN_CLINIC) }));
  db.kcOption.findMany.mockReset().mockResolvedValue([]);
  db.user.findUnique.mockReset().mockImplementation(async (args: any) => {
    if (args.where.id === SUPER_ID) return { wpUserId: 123n };
    if (args.where.id === ADMIN_ID) return { wpUserId: 55n };
    if (args.where.wpUserId === 123n) return { displayName: 'Super Admin' };
    if (args.where.wpUserId === 55n) return { displayName: 'Admin Klinik' };
    return null;
  });
  db.kcUser.findUnique.mockReset().mockResolvedValue(null);
  db.logEntry.create.mockReset().mockResolvedValue({});
  vi.mocked(putClinicPaymentSettings).mockReset().mockResolvedValue(undefined);
});

describe('payment-settings — role matrix', () => {
  it.each(['SUPER_ADMIN', 'CLINIC_ADMIN'] as const)('%s may read its clinic', async (role) => {
    expect((await call('GET', role)).status).toBe(200);
  });

  it.each(['PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'] as const)('%s gets 403 on GET and PUT', async (role) => {
    const get = await call('GET', role);
    const put = await call('PUT', role, { body: VALID });

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect((await put.json()).code).toBe('forbidden');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('401 without a bearer token', async () => {
    expect((await call('GET', null)).status).toBe(401);
  });

  it('403 for a clinic admin whose account has no WordPress link', async () => {
    vi.mocked(resolveKcActor).mockRejectedValue(new KcError('User is not linked to a WordPress account', 403));

    const res = await call('PUT', 'CLINIC_ADMIN', { body: VALID });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });
});

describe('payment-settings — scope and existence', () => {
  it.each(['GET', 'PUT'] as const)('%s: a clinic admin gets 404 for another clinic, with no read or write', async (method) => {
    const res = await call(method, 'CLINIC_ADMIN', { id: String(OTHER_CLINIC), body: method === 'PUT' ? VALID : undefined });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT'] as const)('%s: a super admin gets 404 for a clinic that does not exist, and no plugin call', async (method) => {
    const res = await call(method, 'SUPER_ADMIN', { id: '404404', body: method === 'PUT' ? VALID : undefined });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
    expect(findClinicById).toHaveBeenCalledWith(404404n);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('404 for a non-numeric id', async () => {
    const res = await call('GET', 'SUPER_ADMIN', { id: 'abc' });

    expect(res.status).toBe(404);
    expect(findClinicById).not.toHaveBeenCalled();
  });
});

describe('GET payment-settings', () => {
  it('answers the view under data', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow(), globalRate('16500')]);

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.clinicId).toBe(OWN_CLINIC);
    expect(data.stored).toEqual(VALID);
    expect(data.effective.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(data.globalDefaults).toEqual({ fxRate: 16500, markupPercent: null });
    expect(data.example).toEqual({ price: '12.23', taxes: [], fee: '1.39', total: '13.62', idr: 200000 });
    expect(data.updatedBy).toEqual({ wpUserId: 123, name: 'Super Admin' });
  });

  it('503 payment_settings_unavailable when wp_options cannot be read', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('payment_settings_unavailable');
  });

  it('500 internal_error as problem+json, logged, for anything unexpected', async () => {
    vi.mocked(findClinicById).mockRejectedValue(new Error('Lost connection to MySQL server'));

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toEqual({
      type: '/errors/internal', title: 'Internal Server Error', status: 500, code: 'internal_error',
    });
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
  });
});

describe('PUT payment-settings', () => {
  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await call('PUT', 'SUPER_ADMIN', { body: '{nope' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
  });

  it('422 invalid_input with per-field messages, and no plugin call', async () => {
    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: 16.5, currency: 'USD' } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ status: 422, code: 'invalid_input' });
    expect(body.fields.fxRate).toEqual(['fxRate must be from 1000 to 100000 (rupiah per 1 USD)']);
    expect(body.fields.body[0]).toContain('currency');
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('422 fx_rate_required when the global rate is out of range, in the same field shape', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('500000')]);

    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: null } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('fx_rate_required');
    expect(Object.keys(body.fields)).toEqual(['fxRate']);
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it("422 fx_rate_required when the plugin's own re-check refuses", async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 422: A usable rate is required', 422, 'fx_rate_required'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: null } });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('fx_rate_required');
  });

  it('saves, writes the AUDIT log_entries row with the caller cuid, and answers the option read back', async () => {
    db.kcOption.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([optionRow()]);

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, {
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    expect(db.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        level: 'AUDIT',
        action: 'clinic.payment_settings.updated',
        userId: SUPER_ID,
        resource: 'clinic',
        resourceId: '4',
        metadata: { wpUserId: 123, before: NOTHING_STORED, after: VALID },
      }),
    });
    expect((await res.json()).data.stored).toEqual(VALID);
  });

  it("a clinic admin saves its own clinic, and updated_by is that admin's WordPress id", async () => {
    const res = await call('PUT', 'CLINIC_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, expect.objectContaining({ updated_by: 55 }));
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: ADMIN_ID }) });
  });

  it('forwards updated_by null when the account has no WordPress link', async () => {
    db.user.findUnique.mockImplementation(async (args: any) => (args.where.id === SUPER_ID ? { wpUserId: null } : null));

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, expect.objectContaining({ updated_by: null }));
    expect(db.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: SUPER_ID, metadata: expect.objectContaining({ wpUserId: null }) }),
    });
  });

  it('404 when the plugin no longer finds the clinic', async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 404: Clinic 4 does not exist', 404, 'clinic_not_found'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
  });

  it("422 invalid_input when WordPress's own validation refuses, logged but never echoed", async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 400: secret wp detail', 400, 'invalid_settings'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      status: 422,
      code: 'invalid_input',
      fields: { body: ['WordPress rejected the settings'] },
    });
    expect(text).not.toContain('secret wp detail');
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
    expect(db.logEntry.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'AUDIT' }) });
  });

  it('502 payment_settings_save_failed for any other plugin error, logged but never echoed', async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 500: secret wp detail', 500, 'save_failed'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe('payment_settings_save_failed');
    expect(text).not.toContain('secret wp detail');
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
    expect(db.logEntry.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'AUDIT' }) });
  });
});
