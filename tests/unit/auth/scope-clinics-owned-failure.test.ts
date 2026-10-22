/**
 * A psychologist's login / /auth/me must survive a failing clinic lookup (e.g. `clinic_owners`
 * missing on a half-migrated DB): the login still succeeds with an empty list, the failure is
 * logged, and the FE retries on its next refresh. The two lists fail independently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listOwnedClinics, listPracticeClinics, logError } = vi.hoisted(() => ({
  listOwnedClinics: vi.fn(),
  listPracticeClinics: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/services/clinic-owner/service', () => ({ listOwnedClinics }));
vi.mock('@/services/billing/kc-actor', async (orig) => ({
  ...(await orig<typeof import('@/services/billing/kc-actor')>()),
  listPracticeClinics,
}));
vi.mock('@/lib/logging', () => ({
  logging: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

const { scopeClinics } = await import('@/services/auth/service');

describe('scopeClinics — PROFESSIONAL clinic lists', () => {
  beforeEach(() => {
    listOwnedClinics.mockReset();
    listPracticeClinics.mockReset();
    logError.mockReset();
    listPracticeClinics.mockResolvedValue([{ id: 4, name: 'K' }]);
  });

  it('resolves to an empty ownedClinics list and logs the error with the wpUserId', async () => {
    const boom = new Error("Table 'clinic_owners' doesn't exist");
    listOwnedClinics.mockRejectedValue(boom);

    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [],
      practiceClinics: [{ id: 4, name: 'K' }],
    });

    expect(logError).toHaveBeenCalledTimes(1);
    const [, err, ctx] = logError.mock.calls[0];
    expect(err).toBe(boom);
    expect(JSON.stringify(ctx)).toContain('5');
  });

  it('resolves to an empty practiceClinics list when that lookup fails, keeping ownedClinics', async () => {
    listOwnedClinics.mockResolvedValue([{ id: 4, name: 'K', source: 'manual' }]);
    listPracticeClinics.mockRejectedValue(new Error('boom'));

    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [{ id: 4, name: 'K', source: 'manual' }],
      practiceClinics: [],
    });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('still returns both lists when the lookups work', async () => {
    listOwnedClinics.mockResolvedValue([{ id: 4, name: 'K', source: 'manual' }]);
    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [{ id: 4, name: 'K', source: 'manual' }],
      practiceClinics: [{ id: 4, name: 'K' }],
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('gives a psychologist without a WordPress link two empty lists, without querying', async () => {
    await expect(scopeClinics('PROFESSIONAL', null)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [],
      practiceClinics: [],
    });
    expect(listPracticeClinics).not.toHaveBeenCalled();
  });
});
