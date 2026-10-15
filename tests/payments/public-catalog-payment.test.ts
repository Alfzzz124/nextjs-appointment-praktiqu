/**
 * The public catalogue's payment fields (spec §3 "Fields added to existing endpoints",
 * §7 "Catalogue"): `international` + `paymentMethods` on clinics, and `clinicId` +
 * `paymentMethods` + `usd` on a professional's services.
 *
 * The repositories, the settings read and calculateTax are mocked. The quote itself is
 * real (public-usd.service + intl-pricing), so these are the figures the charge uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
}));
vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
// The category label is not what these tests are about; no category is named.
vi.mock('@/repositories/wp/static-data.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/static-data.repo')>()),
  listStaticData: vi.fn(async () => []),
}));
vi.mock('@/repositories/wp/services.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/services.repo')>()),
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
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

import { findClinicById, listClinics, type WpClinic } from '@/repositories/wp/clinics.repo';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor, type WpDoctorService } from '@/repositories/wp/services.repo';
import {
  resolveClinicPaymentForDisplay,
  resolveClinicPaymentManyForDisplay,
} from '@/services/payments/clinic-payment.service';
import { calculateTax } from '@/services/billing/bill.service';
import { notInternational, parseStoredOption, resolveSettings, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import {
  getPublicPractice,
  getPublicProfessionalServices,
  listPublicPractices,
} from '@/services/public/public-catalog.service';

const DOCTOR = 29;
const INTL = 4; // flagged: rate 18,000, markup 10 %, fee Rp 25,000 — the spec's worked example
const LOCAL = 9; // not international

function settingsFor(clinicId: number, fields: Record<string, unknown>): ClinicPaymentSettings {
  return resolveSettings(
    clinicId,
    parseStoredOption(JSON.stringify({ fx_rate: null, markup_percent: null, fixed_fee_idr: null, ...fields })),
    { fxRate: null, markupPercent: null },
  );
}
const WORKED_EXAMPLE = { international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 };

function settingsMap(ids: number[], intl: ClinicPaymentSettings = settingsFor(INTL, WORKED_EXAMPLE)) {
  return new Map(ids.map((id) => [id, id === INTL ? intl : notInternational(id)]));
}

function clinic(id: number, isActive = true): WpClinic {
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
    isActive,
    clinicAdminId: 1n,
    countryCode: null,
    countryCallingCode: null,
    extra: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function mapping(serviceId: number, clinicId: number, charges: string): WpDoctorService {
  return {
    mappingId: BigInt(serviceId * 100 + clinicId),
    serviceId: BigInt(serviceId),
    doctorId: BigInt(DOCTOR),
    clinicId: BigInt(clinicId),
    name: 'Konsultasi',
    type: 'KONSELING',
    charges,
    durationMinutes: 60,
    isPublic: true,
    isActive: true,
    telemedService: null,
    nameAlias: null,
    category: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(async (ids: number[]) => settingsMap(ids));
  vi.mocked(resolveClinicPaymentForDisplay).mockImplementation(async (id: number) => settingsMap([id]).get(id)!);
  vi.mocked(calculateTax).mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
  vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'ACTIVE' } as never);
});

describe('public clinics', () => {
  it('lists each clinic with its flag and methods, from one settings read', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(LOCAL), clinic(INTL)], total: 2 } as never);

    const list = await listPublicPractices();

    expect(list.map((c) => [c.id, c.international, c.paymentMethods])).toEqual([
      [INTL, true, ['xendit', 'paypal', 'card']],
      [LOCAL, false, ['xendit']],
    ]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([LOCAL, INTL]);
  });

  it('keeps the flag but offers Xendit only when a flagged clinic has no usable rate', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(INTL)], total: 1 } as never);
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(
      settingsMap([INTL], settingsFor(INTL, { international: true })),
    );

    const [only] = await listPublicPractices();

    expect(only.international).toBe(true);
    expect(only.paymentMethods).toEqual(['xendit']);
  });

  it('shows one clinic with its methods', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(INTL));

    const one = await getPublicPractice(INTL);

    expect(one).toMatchObject({ id: INTL, international: true, paymentMethods: ['xendit', 'paypal', 'card'] });
    expect(resolveClinicPaymentForDisplay).toHaveBeenCalledWith(INTL);
  });

  it('reads no settings for an inactive clinic', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(INTL, false));

    expect(await getPublicPractice(INTL)).toBeNull();
    expect(resolveClinicPaymentForDisplay).not.toHaveBeenCalled();
  });
});

describe("a professional's services", () => {
  it('quotes USD only for the international clinic, a usable rate and a non-free row', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping(7, INTL, '200000'),
      mapping(7, LOCAL, '200000'),
      mapping(8, INTL, '0'),
    ]);

    const rows = await getPublicProfessionalServices(DOCTOR);

    expect(rows).toEqual([
      {
        id: 7, name: 'Konsultasi', price: '200000', durationMinutes: 60, serviceType: 'KONSELING', category: null,
        clinicId: INTL,
        paymentMethods: ['xendit', 'paypal', 'card'],
        usd: { price: '12.23', taxes: [], fee: '1.39', total: '13.62' },
      },
      {
        id: 7, name: 'Konsultasi', price: '200000', durationMinutes: 60, serviceType: 'KONSELING', category: null,
        clinicId: LOCAL,
        paymentMethods: ['xendit'],
        usd: null,
      },
      {
        id: 8, name: 'Konsultasi', price: '0', durationMinutes: 60, serviceType: 'KONSELING', category: null,
        clinicId: INTL,
        paymentMethods: ['xendit'],
        usd: null,
      },
    ]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    // The local clinic's row runs no tax query.
    expect(calculateTax).toHaveBeenCalledTimes(2);
    expect(calculateTax).not.toHaveBeenCalledWith(expect.objectContaining({ clinic_id: LOCAL }));
  });

  it('gives every USD amount as a 2-decimal string, taxes included', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping(7, INTL, '200000')]);
    vi.mocked(calculateTax).mockResolvedValue({
      total_tax: 22000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'PPN', tax_type: 'percentage', tax_value: 11, tax_amount: 22000, service_id: 7, service_name: 'Konsultasi' }],
    } as never);

    const [row] = await getPublicProfessionalServices(DOCTOR);

    expect(row.usd).toEqual({ price: '12.23', taxes: [{ name: 'PPN', amount: '1.35' }], fee: '1.39', total: '14.97' });
    for (const amount of [row.usd!.price, row.usd!.fee!, row.usd!.total, ...row.usd!.taxes.map((t) => t.amount)]) {
      expect(amount).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('shows a row in rupiah and Xendit only, not a 500, when its tax read fails', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping(7, INTL, '200000')]);
    vi.mocked(calculateTax).mockRejectedValue(new Error('Too many connections'));

    const [row] = await getPublicProfessionalServices(DOCTOR);

    expect(row).toMatchObject({ clinicId: INTL, paymentMethods: ['xendit'], usd: null });
  });

  it('reads no settings for a professional who is not active', async () => {
    vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'INACTIVE' } as never);

    expect(await getPublicProfessionalServices(DOCTOR)).toBeNull();
    expect(resolveClinicPaymentManyForDisplay).not.toHaveBeenCalled();
  });
});
