/**
 * Menulis harga dolar lewat POST/PUT /api/v1/services.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1, §3
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/repositories/wp/services.repo', () => ({
  listClinicServices: vi.fn(),
  findMappingById: vi.fn(),
  listOptionRowsOf: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/repositories/wp/services.write', () => ({
  findCatalogueByNameAndType: vi.fn().mockResolvedValue(null),
  createCatalogue: vi.fn().mockResolvedValue(909n),
  createServiceWithMappings: vi.fn().mockResolvedValue({ serviceId: 909n, mappingIds: [777n] }),
  doctorsMappedToClinic: vi.fn(async (ids: bigint[]) => ids),
  findConflictingMapping: vi.fn().mockResolvedValue(null),
  saveServiceUpdate: vi.fn(),
  countBlockingAppointments: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/repositories/wp/static-data.repo', () => ({
  findServiceTypeById: vi.fn().mockResolvedValue({ id: 1n, label: 'Konseling', value: 'psychology_services' }),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPayment: vi.fn(),
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ audit: vi.fn(), logging: { warn: vi.fn(), error: vi.fn() } }));

import * as repo from '@/repositories/wp/services.repo';
import * as write from '@/repositories/wp/services.write';
import * as payments from '@/services/payments/clinic-payment.service';
import { createService, getService, updateService } from '@/services/service-catalog/service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';

const CLINIC = 44;

const intl = (rate: string | null = '16500'): ClinicPaymentSettings => ({
  clinicId: CLINIC,
  international: true,
  methods: rate === null ? ['xendit'] : ['xendit', 'paypal', 'card'],
  rate: rate === null ? null : new Prisma.Decimal(rate),
  markupPercent: new Prisma.Decimal('10'),
  fixedFeeIdr: new Prisma.Decimal('0'),
  source: { fxRate: rate === null ? null : 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'default' },
  problems: [],
});

const scope = { clinicId: BigInt(CLINIC), doctorId: null, empty: false };

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 501n,
  serviceId: 201n,
  doctorId: 8100001n,
  clinicId: BigInt(CLINIC),
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":1,"label":"Konseling","value":"psychology_services"}',
  charges: '425000',
  durationMinutes: 60,
  telemedService: 'no',
  isPublic: true,
  isActive: true,
  nameAlias: null,
  optionOf: null,
  priceUsd: null,
  extra: null,
  ...over,
});

const baseCreate = {
  name: 'Konseling Individu',
  categoryId: 1,
  duration: 60,
  doctorIds: [8100001],
  telemedService: 'no' as const,
  status: 1 as const,
  isPublic: 1 as const,
};

function savedUpdate() {
  return (write.saveServiceUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  (write.createServiceWithMappings as ReturnType<typeof vi.fn>).mockResolvedValue({ serviceId: 909n, mappingIds: [777n] });
  (write.findCatalogueByNameAndType as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (write.createCatalogue as ReturnType<typeof vi.fn>).mockResolvedValue(909n);
  (write.doctorsMappedToClinic as ReturnType<typeof vi.fn>).mockImplementation(async (ids: bigint[]) => ids);
  (write.findConflictingMapping as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (write.countBlockingAppointments as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (repo.listOptionRowsOf as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (payments.resolveClinicPayment as ReturnType<typeof vi.fn>).mockResolvedValue(intl());
  (payments.resolveClinicPaymentManyForDisplay as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Map([[CLINIC, intl()]]),
  );
});

describe('createService dengan priceUsd', () => {
  it('menurunkan rupiah dari dolar dan menulis penandanya ke extra', async () => {
    await createService({ ...baseCreate, priceUsd: '55.00' } as never, CLINIC, 'a');

    const call = (write.createServiceWithMappings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mappings[0].charges).toBe('907500');
    expect(JSON.parse(call.mappings[0].extra)).toEqual({ praktiqu_price_usd: '55.00' });
  });

  it('harga rupiah tidak menyentuh extra sama sekali', async () => {
    await createService({ ...baseCreate, price: 425000 } as never, CLINIC, 'a');

    const call = (write.createServiceWithMappings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mappings[0].charges).toBe('425000');
    expect(call.mappings[0].extra).toBeUndefined();
  });

  it('menolak harga dolar di klinik yang bukan internasional dengan usd_price_not_allowed', async () => {
    (payments.resolveClinicPayment as ReturnType<typeof vi.fn>).mockResolvedValue(notInternational(CLINIC));

    await expect(createService({ ...baseCreate, priceUsd: '55.00' } as never, CLINIC, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable',
      code: 'usd_price_not_allowed',
    });
    expect(write.createServiceWithMappings).not.toHaveBeenCalled();
  });

  it('menolak harga dolar saat klinik internasional tanpa kurs dengan fx_rate_required', async () => {
    (payments.resolveClinicPayment as ReturnType<typeof vi.fn>).mockResolvedValue(intl(null));

    await expect(createService({ ...baseCreate, priceUsd: '55.00' } as never, CLINIC, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable',
      code: 'fx_rate_required',
    });
  });
});

describe('updateService dengan priceUsd', () => {
  beforeEach(() => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(row());
  });

  it('menulis rupiah turunan dan penanda dolarnya', async () => {
    await updateService(501, { priceUsd: '55.00' } as never, scope as never, 'a');

    expect(savedUpdate().parent.patch.charges).toBe('907500');
    expect(JSON.parse(savedUpdate().parent.patch.extra)).toEqual({ praktiqu_price_usd: '55.00' });
  });

  it('menggabungkan ke extra yang sudah memegang penanda opsi durasi', async () => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(
      row({ extra: '{"product_id":"771"}' }),
    );

    await updateService(501, { priceUsd: '55.00' } as never, scope as never, 'a');

    expect(JSON.parse(savedUpdate().parent.patch.extra)).toEqual({
      product_id: '771',
      praktiqu_price_usd: '55.00',
    });
  });

  it('harga rupiah MEMBUANG harga dolar yang ada — jalan membatalkan konversi', async () => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(
      row({ priceUsd: '55.00', extra: '{"product_id":"771","praktiqu_price_usd":"55.00"}' }),
    );

    await updateService(501, { price: 425000 } as never, scope as never, 'a');

    const parsed = JSON.parse(savedUpdate().parent.patch.extra);
    expect(parsed).toEqual({ product_id: '771' });
    expect(savedUpdate().parent.patch.charges).toBe('425000');
  });

  it('harga rupiah pada baris yang tidak punya harga dolar TIDAK menyentuh extra', async () => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(
      row({ extra: 'catatan admin: jangan dihapus' }),
    );

    await updateService(501, { price: 425000 } as never, scope as never, 'a');

    expect(savedUpdate().parent.patch.extra).toBeUndefined();
  });

  it('opsi durasi punya harga dolarnya sendiri', async () => {
    await updateService(
      501,
      { durationOptions: [{ duration: 90, priceUsd: '75.00' }] } as never,
      scope as never,
      'a',
    );

    expect(savedUpdate().optionInserts[0]).toMatchObject({ charges: '1237500', priceUsd: '75.00' });
  });
});

describe('ringkasan membawa mata uang dan nilai awal konversi', () => {
  it('menyodorkan hasil jalur lama sebagai priceUsdSuggested selama belum dikonversi', async () => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(row());

    const found = await getService(501, scope as never);

    // ceil(425000 × 110 / 16500) = 2834 sen
    expect(found!.service.priceUsd).toBeNull();
    expect(found!.service.priceUsdSuggested).toBe('28.34');
    expect(found!.currency).toEqual({ code: 'USD', fxRate: '16500' });
  });

  it('berhenti menyodorkan begitu harga dolarnya ditetapkan', async () => {
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(
      row({ priceUsd: '30.00', charges: '495000', extra: '{"praktiqu_price_usd":"30.00"}' }),
    );

    const found = await getService(501, scope as never);

    expect(found!.service.priceUsd).toBe('30.00');
    expect(found!.service.priceUsdSuggested).toBeNull();
  });

  it('klinik biasa tetap rupiah dan tidak disodori apa pun', async () => {
    (payments.resolveClinicPaymentManyForDisplay as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([[CLINIC, notInternational(CLINIC)]]),
    );
    (repo.findMappingById as ReturnType<typeof vi.fn>).mockResolvedValue(row());

    const found = await getService(501, scope as never);

    expect(found!.currency).toEqual({ code: 'IDR', fxRate: null });
    expect(found!.service.priceUsdSuggested).toBeNull();
  });
});
