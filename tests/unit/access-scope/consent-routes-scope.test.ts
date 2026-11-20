/**
 * lensa-otorisasi-route-be-1 / -2: the consent routes checked a login (and, for POST
 * /consent-forms, the clinic) but never tied a form or a signature to the caller.
 *
 * - any account, a patient's included, could send/sign/overwrite a signature for any
 *   client and read any client's signature status;
 * - list, read (with every client's signature), patch, delete and bulk status of a
 *   consent form crossed clinics.
 *
 * Prisma is an in-memory fake; the routes and the scope rules are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Role = 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'RECEPTIONIST' | 'PROFESSIONAL' | 'CLIENT';

const auth = vi.hoisted(() => ({
  actor: { id: 'admin-4', role: 'CLINIC_ADMIN', practiceId: null } as {
    id: string;
    role: string;
    practiceId: null;
  },
  clinicId: 4n as bigint | null,
}));

const store = vi.hoisted(() => ({
  forms: new Map<string, { id: string; practiceId: string; name: string; status: string }>(),
  sigs: [] as Array<{ formId: string; clientId: string; status: string }>,
}));

const fake = vi.hoisted(() => {
  const withSigs = (f: any, include: any) =>
    include?.signatures ? { ...f, signatures: store.sigs.filter((s) => s.formId === f.id) } : { ...f };
  return {
    consentForm: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const f = store.forms.get(where.id);
        return f ? withSigs(f, include) : null;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...store.forms.values()].filter((f) => f.practiceId === where.practiceId),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const f = store.forms.get(where.id)!;
        Object.assign(f, data);
        return { ...f };
      }),
      delete: vi.fn(async ({ where }: any) => {
        store.forms.delete(where.id);
        return {};
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const f of store.forms.values()) {
          if (!where.id.in.includes(f.id)) continue;
          if (where.practiceId !== undefined && f.practiceId !== where.practiceId) continue;
          f.status = data.status;
          count++;
        }
        return { count };
      }),
    },
    consentSignature: {
      create: vi.fn(async ({ data }: any) => {
        store.sigs.push({ formId: data.formId, clientId: data.clientId, status: data.status });
        return { ...data };
      }),
      upsert: vi.fn(async ({ where, create }: any) => ({ ...create, ...where.formId_clientId })),
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.formId_clientId;
        return store.sigs.find((s) => s.formId === k.formId && s.clientId === k.clientId) ?? null;
      }),
    },
  };
});

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => fake) }));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
  getActor: vi.fn(async () => auth.actor),
}));

vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(async (actor: unknown) => ({ actor, wpUserId: 1n, clinicId: auth.clinicId })),
}));

import { GET as listForms } from '@/app/api/v1/consent-forms/route';
import {
  GET as getForm,
  PATCH as patchForm,
  DELETE as deleteForm,
} from '@/app/api/v1/consent-forms/[id]/route';
import { POST as bulkStatus } from '@/app/api/v1/consent-forms/status/route';
import { GET as getSig, POST as postSig } from '@/app/api/v1/consent-signatures/route';

const OWN = 'form-clinic-4';
const FOREIGN = 'form-clinic-5';

function as(role: Role, id = `${role.toLowerCase()}-1`, clinicId: bigint | null = 4n) {
  auth.actor = { id, role, practiceId: null };
  auth.clinicId = clinicId;
}

function req(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/v1/${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}
const ctx = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  store.forms.clear();
  store.forms.set(OWN, { id: OWN, practiceId: '4', name: 'Own', status: 'ACTIVE' });
  store.forms.set(FOREIGN, { id: FOREIGN, practiceId: '5', name: 'Foreign', status: 'ACTIVE' });
  store.sigs.length = 0;
  store.sigs.push({ formId: OWN, clientId: 'client-1', status: 'PENDING' });
  store.sigs.push({ formId: FOREIGN, clientId: 'client-9', status: 'SIGNED' });
  as('CLINIC_ADMIN', 'admin-4');
});

describe('GET /consent-forms', () => {
  it('refuses a CLIENT', async () => {
    as('CLIENT', 'client-1', null);
    expect((await listForms(req('consent-forms?practiceId=4'))).status).toBe(403);
  });

  it.each(['CLINIC_ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'] as Role[])(
    'refuses %s asking for another clinic',
    async (role) => {
      as(role);
      expect((await listForms(req('consent-forms?practiceId=5'))).status).toBe(403);
      expect(fake.consentForm.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(['CLINIC_ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'] as Role[])(
    'lets %s list their own clinic',
    async (role) => {
      as(role);
      const res = await listForms(req('consent-forms?practiceId=4'));
      expect(res.status).toBe(200);
      expect((await res.json()).items.map((f: any) => f.id)).toEqual([OWN]);
    },
  );

  it('lets SUPER_ADMIN list any clinic', async () => {
    as('SUPER_ADMIN', 'super-1', null);
    expect((await listForms(req('consent-forms?practiceId=5'))).status).toBe(200);
  });
});

describe('GET /consent-forms/{id}', () => {
  it('hides another clinic form from a CLINIC_ADMIN (404)', async () => {
    expect((await getForm(req(`consent-forms/${FOREIGN}`), ctx(FOREIGN))).status).toBe(404);
  });

  it('gives a CLINIC_ADMIN their own form with its signatures', async () => {
    const res = await getForm(req(`consent-forms/${OWN}`), ctx(OWN));
    expect(res.status).toBe(200);
    expect((await res.json()).signatures).toHaveLength(1);
  });

  it('gives a PROFESSIONAL of the clinic the form but not the signatures', async () => {
    as('PROFESSIONAL');
    const res = await getForm(req(`consent-forms/${OWN}`), ctx(OWN));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('signatures');
  });

  it('hides a form from a PROFESSIONAL of another clinic', async () => {
    as('PROFESSIONAL', 'prof-1', 5n);
    expect((await getForm(req(`consent-forms/${OWN}`), ctx(OWN))).status).toBe(404);
  });

  it('gives SUPER_ADMIN any form with its signatures', async () => {
    as('SUPER_ADMIN', 'super-1', null);
    const res = await getForm(req(`consent-forms/${FOREIGN}`), ctx(FOREIGN));
    expect(res.status).toBe(200);
    expect((await res.json()).signatures).toHaveLength(1);
  });

  it('gives a CLIENT the form they were asked to sign, without signatures', async () => {
    as('CLIENT', 'client-1', null);
    const res = await getForm(req(`consent-forms/${OWN}`), ctx(OWN));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('signatures');
  });

  it('hides a form nobody asked this CLIENT to sign (404)', async () => {
    as('CLIENT', 'client-2', null);
    expect((await getForm(req(`consent-forms/${OWN}`), ctx(OWN))).status).toBe(404);
  });
});

describe('PATCH /consent-forms/{id}', () => {
  const patch = (id: string, body: unknown) => patchForm(req(`consent-forms/${id}`, 'PATCH', body), ctx(id));

  it('refuses a CLINIC_ADMIN editing another clinic form', async () => {
    expect((await patch(FOREIGN, { name: 'pwned' })).status).toBe(404);
    expect(fake.consentForm.update).not.toHaveBeenCalled();
  });

  it('refuses moving an own form to another clinic', async () => {
    expect((await patch(OWN, { practiceId: '5' })).status).toBe(403);
    expect(fake.consentForm.update).not.toHaveBeenCalled();
  });

  it('lets a CLINIC_ADMIN edit their own form', async () => {
    expect((await patch(OWN, { name: 'Renamed' })).status).toBe(200);
    expect(fake.consentForm.update).toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN edit any form', async () => {
    as('SUPER_ADMIN', 'super-1', null);
    expect((await patch(FOREIGN, { name: 'Renamed' })).status).toBe(200);
  });
});

describe('DELETE /consent-forms/{id}', () => {
  const del = (id: string) => (deleteForm as any)(req(`consent-forms/${id}`, 'DELETE'), ctx(id));

  it('refuses a CLINIC_ADMIN deleting another clinic form', async () => {
    expect((await del(FOREIGN)).status).toBe(404);
    expect(fake.consentForm.delete).not.toHaveBeenCalled();
  });

  it('lets a CLINIC_ADMIN delete their own form', async () => {
    expect((await del(OWN)).status).toBe(200);
    expect(fake.consentForm.delete).toHaveBeenCalled();
  });
});

describe('POST /consent-forms/status', () => {
  const bulk = (ids: string[]) =>
    (bulkStatus as any)(req('consent-forms/status', 'POST', { ids, status: 'INACTIVE' }));

  it('leaves another clinic form untouched for a CLINIC_ADMIN', async () => {
    const res = await bulk([OWN, FOREIGN]);
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect(store.forms.get(FOREIGN)!.status).toBe('ACTIVE');
    expect(store.forms.get(OWN)!.status).toBe('INACTIVE');
  });

  it('lets SUPER_ADMIN change any form', async () => {
    as('SUPER_ADMIN', 'super-1', null);
    expect((await (await bulk([OWN, FOREIGN])).json()).updated).toBe(2);
  });
});

describe('POST /consent-signatures', () => {
  const post = (body: unknown) => postSig(req('consent-signatures', 'POST', body));

  it('refuses a CLIENT sending a signature request', async () => {
    as('CLIENT', 'client-1', null);
    expect((await post({ action: 'send', formId: OWN, clientId: 'client-2' })).status).toBe(403);
    expect(fake.consentSignature.create).not.toHaveBeenCalled();
  });

  it('refuses staff sending a request for another clinic form', async () => {
    as('RECEPTIONIST');
    expect((await post({ action: 'send', formId: FOREIGN, clientId: 'client-2' })).status).toBe(404);
    expect(fake.consentSignature.create).not.toHaveBeenCalled();
  });

  it('lets staff send a request for their clinic form', async () => {
    as('RECEPTIONIST');
    expect((await post({ action: 'send', formId: OWN, clientId: 'client-2' })).status).toBe(201);
  });

  it('signs a CLIENT in under their own id whatever the body says', async () => {
    as('CLIENT', 'client-1', null);
    const res = await post({ formId: OWN, clientId: 'client-victim', status: 'DECLINED', declineReason: 'x' });
    expect(res.status).toBe(200);
    const where = (fake.consentSignature.upsert.mock.calls[0] as any)[0].where.formId_clientId;
    expect(where).toEqual({ formId: OWN, clientId: 'client-1' });
  });

  it('refuses staff recording a signature on another clinic form', async () => {
    expect((await post({ formId: FOREIGN, clientId: 'client-9', status: 'DECLINED' })).status).toBe(404);
    expect(fake.consentSignature.upsert).not.toHaveBeenCalled();
  });

  it('lets staff record a signature on behalf of a client of their clinic form', async () => {
    const res = await post({ formId: OWN, clientId: 'client-1', status: 'SIGNED', signatureText: 'A' });
    expect(res.status).toBe(200);
    const where = (fake.consentSignature.upsert.mock.calls[0] as any)[0].where.formId_clientId;
    expect(where).toEqual({ formId: OWN, clientId: 'client-1' });
  });
});

describe('GET /consent-signatures', () => {
  const get = (formId: string, clientId: string) =>
    getSig(req(`consent-signatures?formId=${formId}&clientId=${clientId}`));

  it("reads only the CLIENT's own signature, ignoring the clientId asked for", async () => {
    as('CLIENT', 'client-2', null);
    const res = await get(FOREIGN, 'client-9');
    expect(await res.json()).toEqual({ status: null });
    const where = (fake.consentSignature.findUnique.mock.calls[0] as any)[0].where.formId_clientId;
    expect(where.clientId).toBe('client-2');
  });

  it('refuses staff reading a signature of another clinic form', async () => {
    expect((await get(FOREIGN, 'client-9')).status).toBe(404);
  });

  it('lets staff read a signature of their clinic form', async () => {
    const res = await get(OWN, 'client-1');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('PENDING');
  });
});
