/**
 * Blok `currency` pada layar uang.
 *
 * Backend hanya menyebut mata uang dan kursnya; FE yang memformat. Angkanya sendiri tetap
 * rupiah, dan konversi historis memang perkiraan — lihat spec §4.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §3
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));

import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { currencyForActor } from '@/services/billing/actor-currency';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import type { KcActor } from '@/services/billing/kc-actor';

const CLINIC = 44;

const intl = (rate: string | null): ClinicPaymentSettings => ({
  clinicId: CLINIC,
  international: true,
  methods: rate === null ? ['xendit'] : ['xendit', 'paypal', 'card'],
  rate: rate === null ? null : new Prisma.Decimal(rate),
  markupPercent: new Prisma.Decimal('10'),
  fixedFeeIdr: new Prisma.Decimal('0'),
  source: { fxRate: rate === null ? null : 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'default' },
  problems: [],
});

const actor = (clinicId: bigint | null): KcActor =>
  ({ actor: { role: 'CLINIC_ADMIN' }, wpUserId: 7n, clinicId }) as unknown as KcActor;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('currencyForActor', () => {
  it('klinik internasional berkurs memakai dolar', async () => {
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(new Map([[CLINIC, intl('16500')]]));

    expect(await currencyForActor(actor(BigInt(CLINIC)))).toEqual({ code: 'USD', fxRate: '16500' });
  });

  it('klinik internasional TANPA kurs tetap rupiah', async () => {
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(new Map([[CLINIC, intl(null)]]));

    expect(await currencyForActor(actor(BigInt(CLINIC)))).toEqual({ code: 'IDR', fxRate: null });
  });

  it('klinik biasa rupiah', async () => {
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(
      new Map([[CLINIC, notInternational(CLINIC)]]),
    );

    expect(await currencyForActor(actor(BigInt(CLINIC)))).toEqual({ code: 'IDR', fxRate: null });
  });

  it('tanpa klinik yang sedang dilihat, rupiah — dan basis data tidak disentuh', async () => {
    expect(await currencyForActor(actor(null))).toEqual({ code: 'IDR', fxRate: null });
    expect(resolveClinicPaymentManyForDisplay).not.toHaveBeenCalled();
  });

  it('clinicId sentinel -1 tidak pernah jadi query', async () => {
    expect(await currencyForActor(actor(-1n))).toEqual({ code: 'IDR', fxRate: null });
    expect(resolveClinicPaymentManyForDisplay).not.toHaveBeenCalled();
  });

  it('klinik yang tidak terbaca jatuh ke rupiah, bukan melempar', async () => {
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(new Map());

    expect(await currencyForActor(actor(BigInt(CLINIC)))).toEqual({ code: 'IDR', fxRate: null });
  });
});

describe('tempat blok currency di amplop KiviCare', () => {
  /**
   * `PraktiquApi::unwrap()` di Laravel FE MEMBUANG segala sesuatu selain `data` begitu
   * amplopnya punya `status` atau `message`. Jadi ruas di tingkat amplop tidak pernah
   * sampai ke halaman — `currency` harus berada DI DALAM `data`.
   */
  it('amplopnya tetap persis seperti sebelumnya, dan currency ikut di dalam data', async () => {
    const { kcOk } = await import('@/lib/kc-response');

    const body = await kcOk({ revenue: 1_000_000, currency: { code: 'USD', fxRate: '16500' } }, 'ok').json();

    expect(Object.keys(body).sort()).toEqual(['data', 'message', 'status']);
    expect(body.data.currency).toEqual({ code: 'USD', fxRate: '16500' });
  });
});
