/**
 * The name and category a professional's public services are shown under.
 *
 * KiviCare's `service_name_alias` holds the category slug, not a display name. Serving
 * it as `name` sent "couplefamilysessionbahasaindonesia" to patients in place of
 * "Couple/Family Session (2 Orang) - 2 Jam" (psychologist 29, 2026-10-15). The category
 * label is what KiviCare's own booking widget groups services under.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/services.repo')>()),
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/static-data.repo')>()),
  listStaticData: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
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

import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor, type WpDoctorService } from '@/repositories/wp/services.repo';
import { listStaticData, type WpStaticData } from '@/repositories/wp/static-data.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational } from '@/services/payments/intl-pricing';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';

const DOCTOR = 29;
const CLINIC = 5;

function mapping(over: Partial<WpDoctorService>): WpDoctorService {
  return {
    mappingId: 1n,
    serviceId: 498n,
    doctorId: BigInt(DOCTOR),
    clinicId: BigInt(CLINIC),
    name: 'Couple/Family Session (2 Orang) - 2 Jam',
    type: 'couplefamilysessionbahasaindonesia',
    category: null,
    charges: '1400000',
    durationMinutes: 90,
    isPublic: true,
    isActive: true,
    telemedService: null,
    nameAlias: 'couplefamilysessionbahasaindonesia',
    ...over,
  };
}

function serviceType(value: string, label: string, isActive = true): WpStaticData {
  return { id: 1n, type: 'service_type', label, value, parentId: null, isActive, createdAt: new Date(0) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'ACTIVE' } as never);
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(
    async (ids: number[]) => new Map(ids.map((id) => [id, notInternational(id)])),
  );
  vi.mocked(listStaticData).mockResolvedValue([]);
});

describe('public service name', () => {
  it('is the catalogue name, never the alias column', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping({})]);

    const [svc] = (await getPublicProfessionalServices(DOCTOR))!;

    expect(svc.name).toBe('Couple/Family Session (2 Orang) - 2 Jam');
  });
});

describe('public service category', () => {
  it("takes the label from the service's own category snapshot, without a static-data read", async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping({
        type: 'tes_psikologi',
        category: JSON.stringify({ id: 12, label: 'Tes Psikologi', value: 'tes_psikologi' }),
      }),
    ]);

    const [svc] = (await getPublicProfessionalServices(DOCTOR))!;

    expect(svc.category).toEqual({ value: 'tes_psikologi', label: 'Tes Psikologi' });
    expect(listStaticData).not.toHaveBeenCalled();
  });

  it('falls back to the service_type static data, inactive categories included', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping({}), mapping({ serviceId: 484n, type: 'additional_fee' })]);
    vi.mocked(listStaticData).mockResolvedValue([
      serviceType('couplefamilysessionbahasaindonesia', 'Couple/Family Session Bahasa Indonesia'),
      serviceType('additional_fee', 'Additional Fee', false),
    ]);

    const list = (await getPublicProfessionalServices(DOCTOR))!;

    expect(list.map((s) => s.category)).toEqual([
      { value: 'couplefamilysessionbahasaindonesia', label: 'Couple/Family Session Bahasa Indonesia' },
      { value: 'additional_fee', label: 'Additional Fee' },
    ]);
    expect(listStaticData).toHaveBeenCalledTimes(1);
    expect(listStaticData).toHaveBeenCalledWith({ type: 'service_type', includeInactive: true });
  });

  it('is null when nothing names the category, so the FE can fall back to serviceType', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping({ type: 'unknown_slug', category: '{not json' }),
      mapping({ serviceId: 2n, type: null }),
    ]);

    const list = (await getPublicProfessionalServices(DOCTOR))!;

    expect(list.map((s) => s.category)).toEqual([null, null]);
  });

  it('ignores a snapshot whose label is blank', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping({ category: JSON.stringify({ id: 3, label: '  ', value: 'x' }) }),
    ]);
    vi.mocked(listStaticData).mockResolvedValue([
      serviceType('couplefamilysessionbahasaindonesia', 'Couple/Family Session Bahasa Indonesia'),
    ]);

    const [svc] = (await getPublicProfessionalServices(DOCTOR))!;

    expect(svc.category?.label).toBe('Couple/Family Session Bahasa Indonesia');
  });
});
