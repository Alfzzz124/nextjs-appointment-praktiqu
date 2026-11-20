/**
 * lensa-otorisasi-route-be-3: GET /custom-fields/get-data, POST /custom-fields/save-data and
 * GET|PUT /sessions/{id}/custom-fields were behind a login only, so any account — a patient's
 * included — could read and overwrite the custom-field values of any client, appointment or
 * encounter. The sibling /clients/{id}/custom-fields already used assertClientAccess.
 *
 * The existing entity guards (assertClientAccess, loadForActor, getEncounter) are mocked at
 * their module edge so each case can say "this actor is outside the entity's scope"; the routes
 * and the wiring in services/custom-fields/access.ts are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  actor: { id: 'staff-1', role: 'PROFESSIONAL', practiceId: null } as { id: string; role: string; practiceId: null },
}));

const guards = vi.hoisted(() => ({
  assertClientAccess: vi.fn(async () => undefined),
  loadForActor: vi.fn(async () => ({})),
  getEncounter: vi.fn(async () => ({})),
  fieldModule: 'client',
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
  getActor: vi.fn(async () => auth.actor),
}));

vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(async (actor: unknown) => ({ actor, wpUserId: 1n, clinicId: 4n })),
}));

vi.mock('@/services/client/client.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/client/client.service')>()),
  assertClientAccess: guards.assertClientAccess,
}));
vi.mock('@/services/session/session.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/session/session.service')>()),
  loadForActor: guards.loadForActor,
}));
vi.mock('@/services/billing/encounter.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/encounter.service')>()),
  getEncounter: guards.getEncounter,
}));

const repo = vi.hoisted(() => ({
  setCustomFieldValue: vi.fn(async () => 1),
  listCustomFieldValues: vi.fn(async () => []),
  listCustomFields: vi.fn(async () => []),
}));
vi.mock('@/repositories/wp/custom-fields.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/custom-fields.repo')>()),
  findCustomFieldById: vi.fn(async () => ({
    id: 7, moduleType: guards.fieldModule, doctorId: 0, label: 'Catatan', fieldType: 'text',
    options: [], placeholder: null, isRequired: false, isActive: true, createdAt: null,
  })),
  ...repo,
}));

import { GET as getData } from '@/app/api/v1/custom-fields/get-data/route';
import { POST as saveData } from '@/app/api/v1/custom-fields/save-data/route';
import { GET as sessionGet, PUT as sessionPut } from '@/app/api/v1/sessions/[id]/custom-fields/route';
import { ClientServiceError } from '@/services/client/client.service';
import { SessionServiceError } from '@/services/session/session.service';
import { KcError } from '@/lib/kc-response';

type Role = 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'RECEPTIONIST' | 'PROFESSIONAL' | 'CLIENT';
const as = (role: Role) => {
  auth.actor = { id: `${role.toLowerCase()}-1`, role, practiceId: null };
};

const json = (body: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/v1/x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
const read = (type: string, id = 17) =>
  getData(new NextRequest(`http://localhost/api/v1/custom-fields/get-data?entityType=${type}&entityId=${id}`), {} as any);
const write = (type: string, id = 17) =>
  (saveData as any)(json({ entityType: type, entityId: id, fieldId: 7, value: 'x' }));

const outsideClient = () =>
  guards.assertClientAccess.mockRejectedValueOnce(
    new ClientServiceError('Forbidden: client is not in your clinic', { status: 403, code: 'forbidden' }),
  );
const outsideSession = () =>
  guards.loadForActor.mockRejectedValueOnce(new SessionServiceError('forbidden', 'Not authorized', 403));
const outsideEncounter = () => guards.getEncounter.mockRejectedValueOnce(new KcError('Encounter not found', 404));

beforeEach(() => {
  vi.clearAllMocks();
  guards.fieldModule = 'client';
  as('PROFESSIONAL');
});

describe('GET /custom-fields/get-data', () => {
  it('refuses a client outside the actor scope', async () => {
    outsideClient();
    const res = await read('client');
    expect(res.status).toBe(403);
    expect(repo.listCustomFieldValues).not.toHaveBeenCalled();
  });

  it('refuses a CLIENT reading another patient (guard decides)', async () => {
    as('CLIENT');
    outsideClient();
    expect((await read('client')).status).toBe(403);
    expect(repo.listCustomFieldValues).not.toHaveBeenCalled();
  });

  it('lets a CLIENT read their own record', async () => {
    as('CLIENT');
    expect((await read('client')).status).toBe(200);
    expect(guards.assertClientAccess).toHaveBeenCalledWith(auth.actor, 17);
  });

  it('refuses an appointment outside the actor scope', async () => {
    outsideSession();
    expect((await read('appointment')).status).toBe(403);
    expect(repo.listCustomFieldValues).not.toHaveBeenCalled();
  });

  it('refuses an encounter outside the actor scope (404)', async () => {
    outsideEncounter();
    expect((await read('session_note')).status).toBe(404);
    expect(repo.listCustomFieldValues).not.toHaveBeenCalled();
  });

  it('lets staff read an encounter in scope', async () => {
    expect((await read('session_note')).status).toBe(200);
    expect(guards.getEncounter).toHaveBeenCalled();
  });

  it('skips the guards for SUPER_ADMIN', async () => {
    as('SUPER_ADMIN');
    expect((await read('client')).status).toBe(200);
    expect(guards.assertClientAccess).not.toHaveBeenCalled();
  });
});

describe('POST /custom-fields/save-data', () => {
  it.each(['CLIENT'] as Role[])('refuses %s writing even their own values', async (role) => {
    as(role);
    expect((await write('client')).status).toBe(403);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('refuses staff writing a client outside their scope', async () => {
    outsideClient();
    expect((await write('client')).status).toBe(403);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('refuses staff writing an appointment outside their scope', async () => {
    guards.fieldModule = 'appointment';
    outsideSession();
    expect((await write('appointment')).status).toBe(403);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('refuses staff writing an encounter outside their scope', async () => {
    guards.fieldModule = 'session_note';
    outsideEncounter();
    expect((await write('session_note')).status).toBe(404);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it.each(['CLINIC_ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'] as Role[])(
    'lets %s write a client in their scope',
    async (role) => {
      as(role);
      expect((await write('client')).status).toBe(200);
      expect(repo.setCustomFieldValue).toHaveBeenCalled();
    },
  );

  it('lets SUPER_ADMIN write without the guards', async () => {
    as('SUPER_ADMIN');
    expect((await write('client')).status).toBe(200);
    expect(guards.assertClientAccess).not.toHaveBeenCalled();
  });
});

describe('/sessions/{id}/custom-fields', () => {
  const params = { params: { id: '55' } };
  const put = () => sessionPut(json({ values: { '7': 'x' } }, 'PUT'), params);
  const get = () => sessionGet(new NextRequest('http://localhost/api/v1/sessions/55/custom-fields'), params);

  it('refuses GET for a session outside the actor scope', async () => {
    outsideSession();
    expect((await get()).status).toBe(403);
    expect(repo.listCustomFieldValues).not.toHaveBeenCalled();
  });

  it('lets a CLIENT read the custom fields of a session the guard accepts', async () => {
    as('CLIENT');
    expect((await get()).status).toBe(200);
    expect(guards.loadForActor).toHaveBeenCalled();
  });

  it('refuses PUT for a CLIENT', async () => {
    as('CLIENT');
    expect((await put()).status).toBe(403);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('refuses PUT for a session outside the actor scope', async () => {
    guards.fieldModule = 'appointment';
    outsideSession();
    expect((await put()).status).toBe(403);
    expect(repo.setCustomFieldValue).not.toHaveBeenCalled();
  });

  it('lets staff PUT a session in scope', async () => {
    guards.fieldModule = 'appointment';
    expect((await put()).status).toBe(200);
  });
});
