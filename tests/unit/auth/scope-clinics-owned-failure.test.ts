/**
 * A psychologist's login / /auth/me must survive a failing owned-clinics lookup
 * (e.g. `clinic_owners` missing on a half-migrated DB): the login still succeeds
 * with `ownedClinics: []`, the failure is logged, and the FE retries on its next refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listOwnedClinics, logError } = vi.hoisted(() => ({
  listOwnedClinics: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/services/clinic-owner/service', () => ({ listOwnedClinics }));
vi.mock('@/lib/logging', () => ({
  logging: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

const { scopeClinics } = await import('@/services/auth/service');

describe('scopeClinics — PROFESSIONAL when the owned-clinics lookup fails', () => {
  beforeEach(() => {
    listOwnedClinics.mockReset();
    logError.mockReset();
  });

  it('resolves to an empty ownedClinics list and logs the error with the wpUserId', async () => {
    const boom = new Error("Table 'clinic_owners' doesn't exist");
    listOwnedClinics.mockRejectedValue(boom);

    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({ clinicId: null, ownedClinics: [] });

    expect(logError).toHaveBeenCalledTimes(1);
    const [, err, ctx] = logError.mock.calls[0];
    expect(err).toBe(boom);
    expect(JSON.stringify(ctx)).toContain('5');
  });

  it('still returns the clinics when the lookup works', async () => {
    listOwnedClinics.mockResolvedValue([{ id: 4, name: 'K', source: 'manual' }]);
    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [{ id: 4, name: 'K', source: 'manual' }],
    });
    expect(logError).not.toHaveBeenCalled();
  });
});
