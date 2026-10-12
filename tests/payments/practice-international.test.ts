/**
 * `PracticeDTO.international` on GET /practices, GET /practices/{id} and the PATCH
 * answer (spec §3 "Fields added to existing endpoints").
 *
 * The clinic rows and the settings read are mocked: the flag must come from ONE settings
 * read per page, and a clinic the read has no entry for reads false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
  updateClinic: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { findClinicById, listClinics, updateClinic, type WpClinic } from '@/repositories/wp/clinics.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import { exportPractices, getPractice, listPractices, updatePractice } from '@/services/practice/service';

function clinic(id: number): WpClinic {
  return {
    id: BigInt(id),
    name: `Klinik ${id}`,
    email: null,
    telephone: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    specialties: [],
    isActive: true,
    clinicAdminId: 1n,
    countryCode: null,
    countryCallingCode: null,
    extra: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Only `international` matters to the DTO; the rest is the not-international shape. */
function flagged(id: number): ClinicPaymentSettings {
  return { ...notInternational(id), international: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(
    async (ids: number[]) => new Map(ids.map((id) => [id, id === 4 ? flagged(id) : notInternational(id)])),
  );
});

describe('PracticeDTO.international', () => {
  it('lists each clinic with its flag, from one settings read for the page', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4), clinic(9)], total: 2 } as never);

    const { data } = await listPractices();

    expect(data.map((p) => [p.id, p.international])).toEqual([[4, true], [9, false]]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([4, 9]);
  });

  it('reads false for a clinic the settings read has no entry for', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4)], total: 1 } as never);
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(new Map());

    expect((await listPractices()).data[0].international).toBe(false);
  });

  it('shows the flag on GET /practices/{id}', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(4));

    const dto = await getPractice(4);

    expect(dto.international).toBe(true);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([4]);
  });

  it('keeps the flag in the PATCH answer', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(4));
    vi.mocked(updateClinic).mockResolvedValue(true);

    const dto = await updatePractice(4, { name: 'Klinik Baru' });

    expect(dto.international).toBe(true);
  });

  it('carries the flag into the JSON export too', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4), clinic(9)], total: 2 } as never);

    const rows = await exportPractices();

    expect(rows.map((p) => p.international)).toEqual([true, false]);
  });
});
