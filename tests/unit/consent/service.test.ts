// tests/unit/consent/service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentService } from '@/services/consent/service';

function makePrisma() {
  return {
    consentForm: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'f1', name: 'Test Form' }),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new', ...data })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    consentSignature: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 's1', ...data })),
      upsert: vi.fn().mockImplementation(async ({ where, create, update }) => ({ id: 's1', ...create })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 's1', status: 'PENDING' }),
    },
  } as any;
}

describe('ConsentService', () => {
  let svc: ConsentService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => { prisma = makePrisma(); svc = new ConsentService(prisma); });

  it('lists forms by practice', async () => {
    await svc.listForms('p1');
    expect(prisma.consentForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ practiceId: 'p1' }) }),
    );
  });

  it('creates a form', async () => {
    const f = await svc.createForm({ practiceId: 'p1', name: 'Consent', content: '<p>Content</p>' });
    expect(f.id).toBe('new');
  });

  it('sends signature request with 30d expiry', async () => {
    const sig = await svc.sendSignatureRequest('f1', 'c1');
    expect(sig.id).toBe('s1');
    expect(sig.status).toBe('PENDING');
    const expiry = new Date(sig.expiresAt as Date);
    expect(expiry > new Date()).toBe(true);
  });

  it('signs consent with status', async () => {
    const sig = await svc.sign('f1', 'c1', { status: 'SIGNED', signatureText: 'Ada Lovelace' });
    expect(prisma.consentSignature.upsert).toHaveBeenCalled();
    expect(sig.status).toBe('SIGNED');
  });

  it('withdraws consent', async () => {
    await svc.withdraw('f1', 'c1');
    expect(prisma.consentSignature.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { formId_clientId: { formId: 'f1', clientId: 'c1' } } }),
    );
  });
});