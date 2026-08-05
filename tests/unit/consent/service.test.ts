/**
 * ConsentService — the tables stay ours; `practiceId` now points at wp_kc_clinics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
}));

import { ConsentService, ConsentServiceError } from '@/services/consent/service';
import { findClinicById } from '@/repositories/wp/clinics.repo';

const CLINIC = '3';

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
      upsert: vi.fn().mockImplementation(async ({ create }) => ({ id: 's1', ...create })),
      update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 's1', status: 'PENDING' }),
    },
  } as never;
}

describe('ConsentService', () => {
  let svc: ConsentService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findClinicById).mockResolvedValue({ id: 3n, name: 'Klinik Uji' } as never);
    prisma = makePrisma();
    svc = new ConsentService(prisma);
  });

  it('lists forms by practice', async () => {
    await svc.listForms(CLINIC);
    expect(
      (prisma as never as { consentForm: { findMany: ReturnType<typeof vi.fn> } }).consentForm
        .findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ practiceId: CLINIC }) }),
    );
  });

  it('creates a form against an existing clinic', async () => {
    const f = await svc.createForm({
      practiceId: CLINIC,
      name: 'Consent',
      content: '<p>Content</p>',
    });

    expect(f.id).toBe('new');
    expect(findClinicById).toHaveBeenCalledWith(3n);
  });

  it('refuses a form for a clinic that does not exist', async () => {
    // Otherwise the form is invisible: every list query scopes by practice.
    vi.mocked(findClinicById).mockResolvedValue(null);

    await expect(
      svc.createForm({ practiceId: '99999', name: 'Consent', content: 'x' }),
    ).rejects.toBeInstanceOf(ConsentServiceError);
  });

  it('rejects a leftover cuid practiceId', async () => {
    await expect(
      svc.createForm({ practiceId: 'clinic-cuid-1', name: 'Consent', content: 'x' }),
    ).rejects.toThrow(/numeric clinic id/);
  });

  it('sends signature request with 30d expiry', async () => {
    const sig = await svc.sendSignatureRequest('f1', 'c1');
    expect(sig.id).toBe('s1');
    expect(sig.status).toBe('PENDING');
    expect(new Date(sig.expiresAt as Date) > new Date()).toBe(true);
  });

  it('signs consent with status', async () => {
    const sig = await svc.sign('f1', 'c1', { status: 'SIGNED', signatureText: 'Ada Lovelace' });
    expect(sig.status).toBe('SIGNED');
  });

  it('withdraws consent', async () => {
    await svc.withdraw('f1', 'c1');
    expect(
      (prisma as never as { consentSignature: { update: ReturnType<typeof vi.fn> } })
        .consentSignature.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { formId_clientId: { formId: 'f1', clientId: 'c1' } } }),
    );
  });
});
