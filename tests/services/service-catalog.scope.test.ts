/**
 * Scope matrix for /api/v1/services, mirroring KiviCare's own getServices
 * (DoctorServiceController.php:623-652).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

import {
  readScopeFor,
  canWrite,
  parseServiceId,
} from '@/services/service-catalog/scope';

const actorOf = (role: string) => ({ id: 'u1', role, practiceId: null }) as any;

beforeEach(() => kcActor.resolveKcActor.mockReset());

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
