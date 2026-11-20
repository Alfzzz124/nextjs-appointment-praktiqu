/**
 * Jalur tagih langsung dolar.
 *
 * Angka yang diketik admin adalah angka TERAKHIR: tanpa markup, tanpa biaya tetap, tanpa
 * baris pajak. Berkas ini sengaja terpisah dari `intl-pricing.test.ts`, yang memegang lima
 * vektor emas jalur konversi lama dan tidak boleh ikut berubah.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §2
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildUsdQuote,
  gateUsdPayment,
  isUsdDirect,
  toCharge,
  toUsdView,
  type ClinicPaymentSettings,
} from '@/services/payments/intl-pricing';

const settings = (over: Partial<ClinicPaymentSettings> = {}): ClinicPaymentSettings => ({
  clinicId: 44,
  international: true,
  methods: ['xendit', 'paypal', 'card'],
  rate: new Prisma.Decimal('16500'),
  markupPercent: new Prisma.Decimal('10'),
  fixedFeeIdr: new Prisma.Decimal('25000'),
  source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
  problems: [],
  ...over,
});

const noRate = () =>
  settings({ rate: null, source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' } });

describe('isUsdDirect', () => {
  it('butuh SETIAP baris punya harga dolar', () => {
    expect(isUsdDirect([{ name: 'A', price: 0, priceUsd: '55.00' }])).toBe(true);
    expect(isUsdDirect([{ name: 'A', price: 0, priceUsd: '55.00' }, { name: 'B', price: 1 }])).toBe(false);
    expect(isUsdDirect([])).toBe(false);
    expect(isUsdDirect([{ name: 'A', price: 0, priceUsd: '' }])).toBe(false);
    expect(isUsdDirect([{ name: 'A', price: 0, priceUsd: null }])).toBe(false);
  });
});

describe('buildUsdQuote — jalur dolar', () => {
  it('menagih persis harga dolarnya, tanpa markup dan tanpa biaya tetap', () => {
    const q = buildUsdQuote([{ name: 'Konseling', price: 907500, priceUsd: '55.00' }], [], settings());
    expect(q).not.toBeNull();
    expect(q!.totalUsd).toBe('55.00');
    expect(q!.totalCents).toBe(5500);
    expect(q!.lines).toHaveLength(1);
    expect(q!.lines[0].kind).toBe('item');
    expect(q!.snapshot.pricing).toBe('usd_direct');
  });

  it('mengabaikan baris pajak', () => {
    const q = buildUsdQuote(
      [{ name: 'Konseling', price: 907500, priceUsd: '55.00' }],
      [{ name: 'PPN', amount: 90750 }],
      settings(),
    );
    expect(q!.totalUsd).toBe('55.00');
    expect(q!.lines.every((l) => l.kind === 'item')).toBe(true);
  });

  it('menurunkan rupiah dari dolar, bukan memakai `price` yang basi', () => {
    const q = buildUsdQuote([{ name: 'Konseling', price: 1, priceUsd: '55.00' }], [], settings());
    expect(q!.lines[0].idr).toBe(907500);
    expect(q!.expectedIdr).toBe(907500);
  });

  it('mencatat kurs tanpa markup', () => {
    const q = buildUsdQuote([{ name: 'K', price: 0, priceUsd: '55.00' }], [], settings());
    expect(q!.effectiveFxRate).toBe('16500');
    expect(q!.snapshot.fxRate).toBe('16500');
  });

  it('menjumlahkan beberapa baris', () => {
    const q = buildUsdQuote(
      [
        { name: 'A', price: 0, priceUsd: '55.00' },
        { name: 'B', price: 0, priceUsd: '12.50' },
      ],
      [],
      settings(),
    );
    expect(q!.totalUsd).toBe('67.50');
    expect(q!.lines).toHaveLength(2);
  });

  it('satu baris tanpa harga dolar mengembalikan SELURUH order ke jalur lama', () => {
    const q = buildUsdQuote(
      [
        { name: 'A', price: 200000, priceUsd: '55.00' },
        { name: 'B', price: 200000 },
      ],
      [],
      settings({
        rate: new Prisma.Decimal('18000'),
        markupPercent: new Prisma.Decimal('10'),
        fixedFeeIdr: new Prisma.Decimal('0'),
      }),
    );
    expect(q!.snapshot.pricing).toBe('converted');
    expect(q!.lines[0].usd).toBe('12.23');
    expect(q!.lines[1].usd).toBe('12.23');
  });

  it('order dolar nol tetap gratis walau rupiahnya bukan nol', () => {
    expect(buildUsdQuote([{ name: 'A', price: 907500, priceUsd: '0.00' }], [], settings())).toBeNull();
  });

  it('klinik bukan internasional tidak pernah lewat jalur dolar', () => {
    const q = buildUsdQuote([{ name: 'A', price: 0, priceUsd: '55.00' }], [], settings({ international: false }));
    expect(q).toBeNull();
  });

  it('tanpa kurs, rupiah turunannya tidak bisa dihitung, jadi tidak ada kuotasi', () => {
    expect(buildUsdQuote([{ name: 'A', price: 0, priceUsd: '55.00' }], [], noRate())).toBeNull();
  });
});

describe('toUsdView dan toCharge — jalur dolar', () => {
  it('tidak memunculkan baris biaya internasional', () => {
    const q = buildUsdQuote([{ name: 'Konseling', price: 0, priceUsd: '55.00' }], [], settings())!;
    const view = toUsdView(q)!;
    expect(view.price).toBe('55.00');
    expect(view.total).toBe('55.00');
    expect(view.fee).toBeNull();
    expect(view.taxes).toEqual([]);

    const charge = toCharge(q);
    expect(charge.total).toBe('55.00');
    expect(charge.items).toEqual([{ name: 'Konseling', amount: '55.00' }]);
    expect(charge.taxes).toEqual([]);
    expect('fee' in charge).toBe(false);
  });
});

describe('gateUsdPayment — jalur dolar', () => {
  it('meloloskan order dolar', () => {
    const g = gateUsdPayment([{ name: 'A', price: 0, priceUsd: '55.00' }], [], settings());
    expect(g.ok).toBe(true);
  });

  it('menolak order dolar nol dengan not_allowed, bukan rate_missing', () => {
    const g = gateUsdPayment([{ name: 'A', price: 907500, priceUsd: '0.00' }], [], settings());
    expect(g).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('meloloskan order dolar yang rupiah cerminnya nol — tidak dibaca sebagai gratis', () => {
    const g = gateUsdPayment([{ name: 'A', price: 0, priceUsd: '55.00' }], [], settings());
    expect(g).toEqual({ ok: true, quote: expect.objectContaining({ totalUsd: '55.00' }) });
  });

  it('menjawab rate_missing saat klinik internasional tanpa kurs', () => {
    const g = gateUsdPayment([{ name: 'A', price: 0, priceUsd: '55.00' }], [], noRate());
    expect(g).toEqual({ ok: false, reason: 'rate_missing' });
  });

  it('menjawab not_allowed saat klinik bukan internasional', () => {
    const g = gateUsdPayment([{ name: 'A', price: 0, priceUsd: '55.00' }], [], settings({ international: false }));
    expect(g).toEqual({ ok: false, reason: 'not_allowed' });
  });
});

describe('jalur lama menandai dirinya', () => {
  it('snapshot.pricing adalah converted', () => {
    const q = buildUsdQuote(
      [{ name: 'A', price: 200000 }],
      [],
      settings({ rate: new Prisma.Decimal('18000'), fixedFeeIdr: new Prisma.Decimal('0') }),
    );
    expect(q!.snapshot.pricing).toBe('converted');
  });
});
