/**
 * Booking publik atas layanan ber-harga-dolar: yang ditagih persis harga dolarnya, dan
 * rupiah yang dicatat diturunkan ULANG dari dolar — bukan dibaca dari `charges` yang
 * boleh tertinggal di belakang kurs.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §2
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/repositories/wp/sessions.repo', () => ({
  SESSION_STATUS: { PENDING: 0, APPROVED: 1 },
  findSessionById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => ({ listServicesForDoctor: vi.fn() }));
vi.mock('@/lib/wp-endpoint', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createWcOrder: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPayment: vi.fn(),
  notInternational: vi.fn(),
}));
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn().mockResolvedValue({ total_tax: 0, calculated_taxes: [] }),
  getBill: vi.fn(),
}));
vi.mock('@/lib/jobs/client', () => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/logging', () => ({
  logging: { warn: vi.fn(), error: vi.fn(), audit: vi.fn(), system: vi.fn() },
  audit: vi.fn(),
}));
vi.mock('@/lib/public/appointment-token', () => ({ signAppointmentToken: () => 'tok' }));

import { findSessionById } from '@/repositories/wp/sessions.repo';
import { listServicesForDoctor } from '@/repositories/wp/services.repo';
import { createWcOrder } from '@/lib/wp-endpoint';
import { resolveClinicPayment } from '@/services/payments/clinic-payment.service';
import type { ClinicPaymentSettings } from '@/services/payments/intl-pricing';

const CLINIC = 44;
const DOCTOR = 34;
const SERVICE = 7;
const APPT = 9001;

const intl = (rate = '16500'): ClinicPaymentSettings => ({
  clinicId: CLINIC,
  international: true,
  methods: ['xendit', 'paypal', 'card'],
  rate: new Prisma.Decimal(rate),
  markupPercent: new Prisma.Decimal('10'),
  fixedFeeIdr: new Prisma.Decimal('25000'),
  source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
  problems: [],
});

/** `charges` sengaja BASI: kurs sudah berubah, cermin rupiahnya belum distempel ulang. */
const usdMapping = (charges: string, priceUsd: string | null) => ({
  mappingId: 501n,
  serviceId: BigInt(SERVICE),
  doctorId: BigInt(DOCTOR),
  clinicId: BigInt(CLINIC),
  name: 'Konseling Individu',
  type: 'konseling',
  category: null,
  charges,
  priceUsd,
  durationMinutes: 60,
  isPublic: true,
  isActive: true,
  telemedService: null,
  nameAlias: null,
  durationOf: null,
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(findSessionById).mockResolvedValue({
    id: APPT,
    status: 0,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    serviceIds: [SERVICE],
    clientName: 'Guest',
    clientEmail: 'guest@example.com',
  } as never);
  vi.mocked(resolveClinicPayment).mockResolvedValue(intl());
  vi.mocked(createWcOrder).mockResolvedValue({
    orderId: 1,
    checkoutUrl: 'https://pay.example/1',
    chargedAmount: 55,
    chargedCurrency: 'USD',
  } as never);

  const db = await import('@/lib/db');
  vi.spyOn(db.prisma.paymentOrder, 'findFirst').mockResolvedValue(null as never);
  vi.spyOn(db.prisma.paymentOrder, 'create').mockResolvedValue({} as never);
});

describe('initiatePublicPayment — layanan ber-harga-dolar', () => {
  it('menagih persis $55.00, tanpa baris biaya internasional', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([usdMapping('907500', '55.00')] as never);
    const { initiatePublicPayment } = await import('@/services/payments/payment.service');

    await initiatePublicPayment(APPT, 'paypal');

    const charge = vi.mocked(createWcOrder).mock.calls[0][0].charge!;
    expect(charge.total).toBe('55.00');
    expect(charge.items).toEqual([{ name: 'Konseling Individu', amount: '55.00' }]);
    expect('fee' in charge).toBe(false);
    expect(charge.snapshot.pricing).toBe('usd_direct');
  });

  it('menurunkan rupiah dari dolar walau `charges` sudah basi', async () => {
    // Kurs klinik 16500, tapi charges masih angka kurs lama.
    vi.mocked(listServicesForDoctor).mockResolvedValue([usdMapping('800000', '55.00')] as never);
    const { initiatePublicPayment } = await import('@/services/payments/payment.service');

    await initiatePublicPayment(APPT, 'paypal');

    const order = vi.mocked(createWcOrder).mock.calls[0][0];
    expect(order.items).toEqual([{ name: 'Konseling Individu', price: 907500, priceUsd: '55.00' }]);
  });

  it('klien Xendit membayar rupiah turunan yang sama, bukan `charges` yang basi', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([usdMapping('800000', '55.00')] as never);
    const { initiatePublicPayment } = await import('@/services/payments/payment.service');

    await initiatePublicPayment(APPT, 'xendit');

    const order = vi.mocked(createWcOrder).mock.calls[0][0];
    expect(order.items[0].price).toBe(907500);
    expect(order.charge).toBeUndefined();
  });

  it('layanan rupiah tetap lewat jalur konversi, dengan biaya tetapnya', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([usdMapping('200000', null)] as never);
    vi.mocked(resolveClinicPayment).mockResolvedValue({
      ...intl('18000'),
      fixedFeeIdr: new Prisma.Decimal('25000'),
    });
    // Backstop skew versi membandingkan yang ditagih plugin dengan yang dikuotasi; untuk
    // kasus ini kuotasinya 13,62, jadi mock-nya harus mengembalikan angka yang sama.
    vi.mocked(createWcOrder).mockResolvedValue({
      orderId: 1,
      checkoutUrl: 'https://pay.example/1',
      chargedAmount: 13.62,
      chargedCurrency: 'USD',
    } as never);
    const { initiatePublicPayment } = await import('@/services/payments/payment.service');

    await initiatePublicPayment(APPT, 'paypal');

    const charge = vi.mocked(createWcOrder).mock.calls[0][0].charge!;
    expect(charge.total).toBe('13.62');
    expect(charge.fee).toEqual({ name: 'International service fee', amount: '1.39' });
    expect(charge.snapshot.pricing).toBe('converted');
  });
});
