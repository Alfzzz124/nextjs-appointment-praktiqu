/**
 * Custom-field definitions and email templates have no clinic column: one row serves every
 * clinic. Letting any CLINIC_ADMIN write them meant one clinic's admin could rewrite or
 * delete the configuration of the whole platform (and a deleted field definition made the
 * stored values of every clinic unreadable). Writes are SUPER_ADMIN-only; reads are
 * unchanged. The services are stubbed — only the role gate is under test.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { authHeaders } from '../../helpers/auth';

const cf = vi.hoisted(() => ({
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  getField: vi.fn(),
  listFields: vi.fn(),
  bulkSetCustomFieldStatus: vi.fn(),
}));
vi.mock('@/services/custom-fields/service', async (orig) => ({
  ...(await orig<typeof import('@/services/custom-fields/service')>()),
  CustomFieldService: class {
    createField = cf.createField;
    updateField = cf.updateField;
    deleteField = cf.deleteField;
    getField = cf.getField;
    listFields = cf.listFields;
    bulkSetCustomFieldStatus = cf.bulkSetCustomFieldStatus;
  },
}));

const et = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  getTemplateById: vi.fn(),
  listTemplates: vi.fn(),
}));
vi.mock('@/services/email-templates/templates.service', async (orig) => ({
  ...(await orig<typeof import('@/services/email-templates/templates.service')>()),
  ...et,
}));

import { POST as cfCreate, GET as cfList } from '@/app/api/v1/custom-fields/route';
import { PATCH as cfPatch, DELETE as cfDelete } from '@/app/api/v1/custom-fields/[id]/route';
import { POST as cfStatus } from '@/app/api/v1/custom-fields/status/route';
import { POST as etCreate, GET as etList } from '@/app/api/v1/email-templates/route';
import { PATCH as etPatch, DELETE as etDelete, GET as etGet } from '@/app/api/v1/email-templates/[id]/route';

let ADMIN: Record<string, string>;
let SUPER: Record<string, string>;
beforeAll(async () => {
  ADMIN = await authHeaders({ userId: 'cf_admin', role: 'CLINIC_ADMIN' });
  SUPER = await authHeaders({ userId: 'cf_super', role: 'SUPER_ADMIN' });
});

beforeEach(() => {
  vi.clearAllMocks();
  cf.createField.mockResolvedValue({ id: 7 });
  cf.updateField.mockResolvedValue({ id: 7 });
  cf.deleteField.mockResolvedValue(undefined);
  cf.listFields.mockResolvedValue([]);
  cf.bulkSetCustomFieldStatus.mockResolvedValue(1);
  et.createTemplate.mockResolvedValue({ id: 't1' });
  et.updateTemplate.mockResolvedValue({ id: 't1' });
  et.deleteTemplate.mockResolvedValue(undefined);
  et.listTemplates.mockResolvedValue([]);
  et.getTemplateById.mockResolvedValue({ id: 't1' });
});

const req = (url: string, headers: Record<string, string>, method: string, body?: unknown) =>
  new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as never;

const fieldBody = { moduleType: 'client', fieldLabel: 'Emergency Contact', fieldType: 'text', isRequired: false };
const templateBody = {
  key: 'k1', name: 'N', subject: 'S {{a}}', bodyHtml: '<p>{{a}}</p>', bodyText: '{{a}}', variables: ['a'], status: 'active',
};
const idCtx = { params: { id: '7' } };
const tplCtx = { params: { id: 't1' } };

describe('custom-fields — writes are SUPER_ADMIN-only', () => {
  const cases: Array<[string, (h: Record<string, string>) => Promise<Response>, () => unknown]> = [
    ['POST /custom-fields', (h) => cfCreate(req('http://x/api/v1/custom-fields', h, 'POST', fieldBody)), () => cf.createField],
    ['PATCH /custom-fields/:id', (h) => cfPatch(req('http://x/api/v1/custom-fields/7', h, 'PATCH', { fieldLabel: 'New' }), idCtx), () => cf.updateField],
    ['DELETE /custom-fields/:id', (h) => cfDelete(req('http://x/api/v1/custom-fields/7', h, 'DELETE'), idCtx), () => cf.deleteField],
    ['POST /custom-fields/status', (h) => cfStatus(req('http://x/api/v1/custom-fields/status', h, 'POST', { ids: [7], status: 0 }), { params: {} } as never) as Promise<Response>, () => cf.bulkSetCustomFieldStatus],
  ];

  it.each(cases)('%s refuses a clinic admin and changes nothing', async (_n, call, svc) => {
    const res = await call(ADMIN);
    expect(res.status).toBe(403);
    expect(svc()).not.toHaveBeenCalled();
  });

  it.each(cases)('%s still works for a super admin', async (_n, call, svc) => {
    const res = await call(SUPER);
    expect(res.status).toBeLessThan(300);
    expect(svc()).toHaveBeenCalled();
  });

  it('a clinic admin can still read the definitions', async () => {
    expect((await cfList(req('http://x/api/v1/custom-fields', ADMIN, 'GET'))).status).toBe(200);
  });
});

describe('email-templates — writes are SUPER_ADMIN-only', () => {
  const cases: Array<[string, (h: Record<string, string>) => Promise<Response>, () => unknown]> = [
    ['POST /email-templates', (h) => etCreate(req('http://x/api/v1/email-templates', h, 'POST', templateBody)), () => et.createTemplate],
    ['PATCH /email-templates/:id', (h) => etPatch(req('http://x/api/v1/email-templates/t1', h, 'PATCH', { name: 'New' }), tplCtx), () => et.updateTemplate],
    ['DELETE /email-templates/:id', (h) => etDelete(req('http://x/api/v1/email-templates/t1', h, 'DELETE'), tplCtx), () => et.deleteTemplate],
  ];

  it.each(cases)('%s refuses a clinic admin and changes nothing', async (_n, call, svc) => {
    const res = await call(ADMIN);
    expect(res.status).toBe(403);
    expect(svc()).not.toHaveBeenCalled();
  });

  it.each(cases)('%s still works for a super admin', async (_n, call, svc) => {
    const res = await call(SUPER);
    expect(res.status).toBeLessThan(300);
    expect(svc()).toHaveBeenCalled();
  });

  it('a clinic admin can still list and read templates', async () => {
    expect((await etList(req('http://x/api/v1/email-templates', ADMIN, 'GET'))).status).toBe(200);
    expect((await etGet(req('http://x/api/v1/email-templates/t1', ADMIN, 'GET'), tplCtx)).status).toBe(200);
  });
});
