import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', () => ({ listClinicNames: vi.fn(), findClinicIdByEmail: vi.fn() }));
vi.mock('@/services/public/public-catalog.service', () => ({ listActiveProfessionalSlugs: vi.fn() }));

import { findClinicIdByEmail, listClinicNames } from '@/repositories/wp/clinics.repo';
import { listActiveProfessionalSlugs } from '@/services/public/public-catalog.service';
import {
  ClinicEmailConflictError,
  ClinicNameConflictError,
  RESERVED_SLUGS,
  assertClinicEmailAvailable,
  assertClinicNameAvailable,
  findClinicNameProblem,
} from '@/services/practice/clinic-names';

const clinics = [
  { id: 4, name: 'Klinik Sehat Bandung' },
  { id: 5, name: null },
  { id: 9, name: 'Ruang Tenang' },
];
const ctx = { clinics, professionalSlugs: new Set(['dewi-lestari']) };

describe('findClinicNameProblem', () => {
  it('accepts a fresh name', () => {
    expect(findClinicNameProblem('Klinik Baru Cimahi', ctx)).toBeNull();
  });

  it.each([
    ['', 'empty_slug', ''],
    ['!!! ???', 'empty_slug', ''],
    ['Ψυχή', 'empty_slug', ''],
    ['12345', 'numeric_slug', '12345'],
    ['  007 ', 'numeric_slug', '007'],
    ['Login', 'reserved_slug', 'login'],
    ['Cek Hasil', 'reserved_slug', 'cek-hasil'],
    ['Dewi Lestari', 'professional_slug_taken', 'dewi-lestari'],
  ])('%j → %s', (name, reason, slug) => {
    expect(findClinicNameProblem(name, ctx)).toEqual({ reason, slug });
  });

  it('names the clinic whose link it would take, by the FE slug rule', () => {
    expect(findClinicNameProblem('KLINIK sehat — Bandung!', ctx)).toEqual({
      reason: 'clinic_slug_taken',
      slug: 'klinik-sehat-bandung',
      conflictId: 4,
      conflictName: 'Klinik Sehat Bandung',
    });
  });

  it('ignores the clinic being renamed', () => {
    expect(findClinicNameProblem('Klinik Sehat  Bandung', { ...ctx, exceptId: 4 })).toBeNull();
  });

  it('holds every word the FE routes use', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      ['admin', 'atur-ulang-sandi', 'booking', 'cek-hasil', 'doctor', 'forgot-password', 'klinik', 'login', 'logout', 'lupa-sandi', 'pasien', 'psikolog', 'reset-password', 'staff', 'up'].sort(),
    );
  });
});

describe('assertClinicNameAvailable', () => {
  beforeEach(() => {
    vi.mocked(listClinicNames).mockResolvedValue(clinics);
    vi.mocked(listActiveProfessionalSlugs).mockResolvedValue(new Set(['dewi-lestari']));
  });

  it('resolves for a free name', async () => {
    await expect(assertClinicNameAvailable('Klinik Baru')).resolves.toBeUndefined();
  });

  it('throws ClinicNameConflictError carrying the problem', async () => {
    const err = await assertClinicNameAvailable('Ruang Tenang').catch((e) => e);
    expect(err).toBeInstanceOf(ClinicNameConflictError);
    expect(err.problem).toEqual({ reason: 'clinic_slug_taken', slug: 'ruang-tenang', conflictId: 9, conflictName: 'Ruang Tenang' });
  });

  it('passes exceptId through', async () => {
    await expect(assertClinicNameAvailable('Ruang Tenang', { exceptId: 9 })).resolves.toBeUndefined();
  });
});

describe('assertClinicEmailAvailable', () => {
  beforeEach(() => {
    vi.mocked(findClinicIdByEmail).mockReset();
  });

  it('skips an empty email without a query', async () => {
    await assertClinicEmailAvailable(null);
    await assertClinicEmailAvailable(undefined);
    await assertClinicEmailAvailable('   ');
    expect(findClinicIdByEmail).not.toHaveBeenCalled();
  });

  it('resolves when no other clinic has it', async () => {
    vi.mocked(findClinicIdByEmail).mockResolvedValue(null);
    await expect(assertClinicEmailAvailable('baru@klinik.id')).resolves.toBeUndefined();
  });

  it('throws ClinicEmailConflictError naming the clinic that has it', async () => {
    vi.mocked(findClinicIdByEmail).mockResolvedValue(4);
    const err = await assertClinicEmailAvailable(' a@b.co ', { exceptId: 7 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClinicEmailConflictError);
    expect(err.conflictId).toBe(4);
    expect(findClinicIdByEmail).toHaveBeenCalledWith('a@b.co', 7);
  });
});
