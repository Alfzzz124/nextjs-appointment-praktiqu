/**
 * Scope matrix for /api/v1/services, mirroring KiviCare's own getServices
 * (DoctorServiceController.php:623-652).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

import { KcError } from '@/lib/kc-response';
import {
  readScopeFor,
  canWrite,
  parseServiceId,
  scopeForRequest,
} from '@/services/service-catalog/scope';

const actorOf = (role: string) => ({ id: 'u1', role, practiceId: null }) as any;

// Block body, not `beforeEach(() => mock.mockReset())`. A concise arrow returns the mock,
// and Vitest registers a function returned from `beforeEach` as a per-test teardown — so it
// would CALL the mock after each test. After a test that set `mockRejectedValue`, that call
// produces an unawaited rejected promise and the test fails as an unhandled rejection.
beforeEach(() => {
  kcActor.resolveKcActor.mockReset();
});

describe('readScopeFor', () => {
  it('leaves SUPER_ADMIN unrestricted', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 1n, clinicId: null });

    expect(await readScopeFor(actorOf('SUPER_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: false,
    });
  });

  it('locks CLINIC_ADMIN to their own clinic', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: 3n });

    expect(await readScopeFor(actorOf('CLINIC_ADMIN'))).toEqual({
      clinicId: 3n,
      doctorId: null,
      empty: false,
    });
  });

  it('locks RECEPTIONIST to their own clinic', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 30n, clinicId: 4n });

    expect(await readScopeFor(actorOf('RECEPTIONIST'))).toEqual({
      clinicId: 4n,
      doctorId: null,
      empty: false,
    });
  });

  it('gives a clinic-less admin an empty scope rather than the whole table', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: null });

    expect(await readScopeFor(actorOf('CLINIC_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: true,
    });
  });

  it('locks PROFESSIONAL to their own rows, across clinics', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 8100001n, clinicId: 3n });

    expect(await readScopeFor(actorOf('PROFESSIONAL'))).toEqual({
      clinicId: null,
      doctorId: 8100001n,
      empty: false,
    });
  });

  it('shows a CLIENT nothing', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 99n, clinicId: null });

    expect(await readScopeFor(actorOf('CLIENT'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: true,
    });
  });
});

describe('canWrite', () => {
  it('admits only the two admin roles', () => {
    expect(canWrite('SUPER_ADMIN')).toBe(true);
    expect(canWrite('CLINIC_ADMIN')).toBe(true);
    expect(canWrite('RECEPTIONIST')).toBe(false);
    expect(canWrite('PROFESSIONAL')).toBe(false);
    expect(canWrite('CLIENT')).toBe(false);
  });
});

describe('parseServiceId', () => {
  it('accepts a positive integer', () => {
    expect(parseServiceId('501')).toBe(501);
  });

  it('rejects anything that would become NaN in a SQL parameter', () => {
    expect(parseServiceId('abc')).toBeNull();
    expect(parseServiceId('')).toBeNull();
    expect(parseServiceId('0')).toBeNull();
    expect(parseServiceId('-1')).toBeNull();
    expect(parseServiceId('1.5')).toBeNull();
  });
});

describe('scopeForRequest', () => {
  it('returns the scope when the actor resolves', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: 3n });

    const result = await scopeForRequest(actorOf('CLINIC_ADMIN'));

    expect(result).toEqual({ scope: { clinicId: 3n, doctorId: null, empty: false } });
  });

  it('turns an unlinked WordPress account into a 403, not an uncaught 500', async () => {
    kcActor.resolveKcActor.mockRejectedValue(
      new KcError('User is not linked to a WordPress account', 403),
    );

    const result = await scopeForRequest(actorOf('CLINIC_ADMIN'));

    expect('response' in result).toBe(true);
    expect((result as { response: Response }).response.status).toBe(403);
  });

  it('lets an unexpected error through rather than masking it as 403', async () => {
    kcActor.resolveKcActor.mockRejectedValue(new Error('connection lost'));

    await expect(scopeForRequest(actorOf('CLINIC_ADMIN'))).rejects.toThrow('connection lost');
  });
});

describe('the shared scope constants', () => {
  it('cannot be mutated by one request into a scope every later request inherits', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 1n, clinicId: null });

    const first = await readScopeFor(actorOf('SUPER_ADMIN'));
    expect(() => {
      (first as { clinicId: bigint | null }).clinicId = 999n;
    }).toThrow();

    expect(await readScopeFor(actorOf('SUPER_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: false,
    });
  });
});
