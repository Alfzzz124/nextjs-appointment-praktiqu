/**
 * Public services name each duration option's parent by the parent's PUBLIC id (the
 * catalogue id the booking page sends), not by its mapping id.
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
// Same as tests/public-booking/service-name-category.test.ts: keeps the payment modules
// behind the catalogue from reaching a real logger.
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
import { listStaticData } from '@/repositories/wp/static-data.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational } from '@/services/payments/intl-pricing';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';

const DOCTOR = 34;

function mapping(over: Partial<WpDoctorService>): WpDoctorService {
  return {
    mappingId: 501n, serviceId: 101n, doctorId: BigInt(DOCTOR), clinicId: 4n,
    name: 'Konseling Individu', type: 'konseling', category: null, charges: '425000',
    durationMinutes: 60, isPublic: true, isActive: true, telemedService: null, nameAlias: null,
    durationOf: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'ACTIVE' } as never);
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(
    async (ids: number[]) => new Map(ids.map((id) => [id, notInternational(id)])),
  );
  vi.mocked(listStaticData).mockResolvedValue([]);
});

describe('PublicService.durationOf', () => {
  it("is null for a parent and the parent's catalogue id for its option", async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping({}),
      mapping({ mappingId: 601n, serviceId: 201n, name: 'Konseling Individu (90 menit)', charges: '600000', durationMinutes: 90, durationOf: 501n }),
    ]);

    const rows = (await getPublicProfessionalServices(DOCTOR))!;

    expect(rows.map((r) => [r.id, r.durationOf])).toEqual([[101, null], [201, 101]]);
  });
});
