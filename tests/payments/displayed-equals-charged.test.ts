/**
 * Cross-path invariant (final review, Important #3): the USD figure a patient is SHOWN is
 * the figure they are CHARGED.
 *
 * Three services quote the same booking independently:
 *   (a) the catalogue row     — getPublicProfessionalServices   -> usd
 *   (b) the booking response  — createPublicAppointment / getPublicAppointmentById -> usd
 *   (c) the charge            — initiatePublicPayment            -> charge sent to createWcOrder
 * Each calls computePublicAmount + buildUsdQuote on its own, so nothing but this test
 * stops one of them drifting (the doctor's own price vs the list price, nameAlias vs
 * name, a tax line dropped on one path, the fee rounded differently).
 *
 * ONE mapping fixture is fed through all of them. Only the I/O boundaries are mocked:
 * Prisma (`@/lib/db`, so the REAL clinic-settings read and quote run), calculateTax, the
 * WordPress repositories, the WooCommerce call, jobs and logging. The expected figure is
 * computed here from the spec's rule with integer maths, independent of intl-pricing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  paymentOrder: { create: vi.fn(), findFirst: vi.fn() },
  // wp_options — the per-clinic international payment option and the global rate/markup.
  kcOption: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const wpEndpoint = vi.hoisted(() => ({ createWcOrder: vi.fn() }));
vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  ...wpEndpoint,
}));

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
  getBill: vi.fn(),
}));

// The category label is not what these tests are about; no category is named.
vi.mock('@/repositories/wp/static-data.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/static-data.repo')>()),
  listStaticData: vi.fn(async () => []),
}));
vi.mock('@/repositories/wp/services.repo', () => ({
  listServicesForDoctor: vi.fn(),
  findServiceById: vi.fn(),
}));
vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
vi.mock('@/repositories/wp/sessions.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/appointments.repo')>()),
  findConflictingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => ({
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  setAppointmentStatus: vi.fn(),
}));
vi.mock('@/repositories/wp/patients.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/patients.repo')>()),
  findPatientByEmail: vi.fn(),
}));
vi.mock('@/repositories/wp/patients.write', () => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
}));
vi.mock('@/services/integrations/google-busy.service', () => ({
  googleBusyForRange: vi.fn(async () => ({})),
}));

import { calculateTax } from '@/services/billing/bill.service';
import { findServiceById, listServicesForDoctor } from '@/repositories/wp/services.repo';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { findSessionById } from '@/repositories/wp/sessions.repo';
import { APPOINTMENT_STATUS, findConflictingAppointments } from '@/repositories/wp/appointments.repo';
import { createAppointment } from '@/repositories/wp/appointments.write';
import { findPatientByEmail } from '@/repositories/wp/patients.repo';
import { createPatient } from '@/repositories/wp/patients.write';
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';
import { createPublicAppointment, getPublicAppointmentById } from '@/services/public/public-booking.service';
import { initiatePublicPayment } from '@/services/payments/payment.service';

const DOCTOR = 29;
const CLINIC = 4;
const SERVICE = 7;
const PATIENT = 461;
const APPOINTMENT = 5150;

// The clinic option under test and the figures it implies.
const RATE = 18000;
const MARKUP = 10;
const FEE_IDR = 25000;
const CHARGES_IDR = 200000;
const LIST_PRICE_IDR = 150000; // the catalogue's own price — must NOT be what anyone quotes
const TAX_PERCENT = 11;

// ---- the spec rule, with integers --------------------------------------------------------
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
/** Item or tax line: ceil(idr * (100 + markup) / rate) cents. */
const lineCents = (idr: number): number => Number(ceilDiv(BigInt(idr) * BigInt(100 + MARKUP), BigInt(RATE)));
/** Fee line: ceil(fee * 100 / rate) cents, no markup. */
const feeCents = (idr: number): number => Number(ceilDiv(BigInt(idr) * 100n, BigInt(RATE)));
const usd = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

const TAX_IDR = (CHARGES_IDR * TAX_PERCENT) / 100;
const EXPECTED = {
  price: usd(lineCents(CHARGES_IDR)),
  tax: usd(lineCents(TAX_IDR)),
  fee: usd(feeCents(FEE_IDR)),
  total: usd(lineCents(CHARGES_IDR) + lineCents(TAX_IDR) + feeCents(FEE_IDR)),
};

/**
 * A service with a nameAlias and the doctor's own charge, in the international clinic.
 * The alias is KiviCare's category slug, not a name — every path must bill `name`.
 */
const MAPPING = {
  mappingId: 11n,
  serviceId: BigInt(SERVICE),
  doctorId: BigInt(DOCTOR),
  clinicId: BigInt(CLINIC),
  name: 'Konseling Individu',
  nameAlias: 'konseling',
  type: 'KONSELING',
  category: null,
  charges: String(CHARGES_IDR),
  durationMinutes: 60,
  isPublic: true,
  isActive: true,
  telemedService: null,
};

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bookingRow() {
  return {
    id: APPOINTMENT,
    clinicId: CLINIC,
    professionalId: DOCTOR,
    clientId: PATIENT,
    professionalName: 'Dewi Santoso',
    clientName: 'Budi Test',
    clientEmail: 'budi@test.local',
    slotDate: tomorrow(),
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status: 'PENDING',
    serviceIds: [SERVICE],
    description: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  db.kcOption.findMany.mockResolvedValue([
    {
      optionName: `praktiqu_endpoint_clinic_${CLINIC}_payment`,
      optionValue: JSON.stringify({
        international: true, fx_rate: RATE, markup_percent: MARKUP, fixed_fee_idr: FEE_IDR,
        updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123,
      }),
    },
  ]);
  db.paymentOrder.findFirst.mockResolvedValue(null);
  db.paymentOrder.create.mockResolvedValue({ id: 'po_1' });

  // The tax is a function of what it is asked to tax, so a path that passes the wrong
  // price (list price instead of the doctor's charge) shows up in its total.
  vi.mocked(calculateTax).mockImplementation((async (args: { serviceItems: Array<{ price: number; service_name: string }> }) => {
    const [item] = args.serviceItems;
    const amount = Math.round((item.price * TAX_PERCENT) / 100);
    return {
      total_tax: amount,
      calculated_taxes: [{
        tax_id: 1, tax_name: 'PPN', tax_type: 'percentage', tax_value: TAX_PERCENT,
        tax_amount: amount, service_id: SERVICE, service_name: item.service_name,
      }],
    };
  }) as never);

  vi.mocked(findDoctorById).mockResolvedValue({
    id: BigInt(DOCTOR), firstName: 'Dewi', lastName: 'Santoso', displayName: 'dewi', status: 'ACTIVE',
  } as never);
  vi.mocked(listServicesForDoctor).mockResolvedValue([MAPPING]);
  vi.mocked(findServiceById).mockResolvedValue({ id: BigInt(SERVICE), name: MAPPING.name, charges: String(LIST_PRICE_IDR) } as never);
  vi.mocked(findSessionById).mockResolvedValue(bookingRow() as never);

  vi.mocked(findConflictingAppointments).mockResolvedValue([]);
  vi.mocked(findPatientByEmail).mockResolvedValue(null);
  vi.mocked(createPatient).mockResolvedValue({
    id: PATIENT, email: 'budi@test.local', username: 'budi', firstName: 'Budi', lastName: 'Test',
    contactNumber: '08120001111', patientUniqueId: null,
  });
  vi.mocked(createAppointment).mockResolvedValue({
    id: APPOINTMENT, status: APPOINTMENT_STATUS.PENDING, clinicId: CLINIC, doctorId: DOCTOR,
    patientId: PATIENT, startDate: tomorrow(), startTime: '10:00:00', timezone: 'Asia/Jakarta',
    serviceIds: [SERVICE], notified: false,
  });

  // WooCommerce charges exactly what it was told to — the happy path of the backstop.
  wpEndpoint.createWcOrder.mockImplementation(async (args: { charge: { total: string } }) => ({
    orderId: 77,
    checkoutUrl: 'https://paypal.com/checkout/77',
    chargedAmount: Number(args.charge.total),
    chargedCurrency: 'USD',
    fxRate: 16363.64,
  }));
});

/** What the patient sees on the catalogue row. */
async function catalogueUsd() {
  const rows = await getPublicProfessionalServices(DOCTOR);
  const row = rows!.find((r) => r.id === SERVICE)!;
  expect(row.paymentMethods).toEqual(['xendit', 'paypal', 'card']);
  return row.usd!;
}

/** What the patient sees on the booking confirmation straight after booking. */
async function createdUsd() {
  const key = slotHoldService.buildKey(String(DOCTOR), String(SERVICE), tomorrow(), '10:00');
  slotHoldService.create({
    professionalId: String(DOCTOR), serviceId: String(SERVICE), date: tomorrow(), startTime: '10:00', key,
  });
  const created = await createPublicAppointment({
    professionalId: DOCTOR, serviceId: SERVICE, date: tomorrow(), startTime: '10:00',
    clientName: 'Budi Test', clientEmail: 'budi@test.local', clientMobile: '08120001111', holdKey: key,
  });
  return created.usd!;
}

/** What the patient sees when the booking is looked up later (success screen, cancel). */
async function lookedUpUsd() {
  const view = await getPublicAppointmentById(APPOINTMENT);
  return view!.usd!;
}

/** What the patient is billed: the `charge` sent to WooCommerce, in the same shape as `usd`. */
async function chargedUsd() {
  await initiatePublicPayment(APPOINTMENT, 'paypal');
  const sent = wpEndpoint.createWcOrder.mock.calls[0][0];
  expect(sent.charge.items.map((i: { name: string }) => i.name)).toEqual([MAPPING.name]);
  return {
    price: sent.charge.items[0].amount as string,
    taxes: sent.charge.taxes as Array<{ name: string; amount: string }>,
    fee: sent.charge.fee.amount as string,
    total: sent.charge.total as string,
  };
}

describe('the USD figure shown is the USD figure charged', () => {
  it('has a spec-rule figure worth checking against (Rp 200,000 + 11% PPN, rate 18,000, markup 10%, fee Rp 25,000)', () => {
    expect(EXPECTED).toEqual({ price: '12.23', tax: '1.35', fee: '1.39', total: '14.97' });
  });

  it.each([
    ['(a) the catalogue row', catalogueUsd],
    ['(b) the booking response', createdUsd],
    ['(b) the booking lookup', lookedUpUsd],
    ['(c) the charge sent to WooCommerce', chargedUsd],
  ])('%s equals the spec-rule figure', async (_label, read) => {
    const shown = await read();

    expect(shown.total).toBe(EXPECTED.total);
    expect(shown.price).toBe(EXPECTED.price);
    expect(shown.fee).toBe(EXPECTED.fee);
    expect(shown.taxes).toEqual([{ name: 'PPN', amount: EXPECTED.tax }]);
  });

  it('gives one and the same breakdown on every path for the one fixture', async () => {
    const catalogue = await catalogueUsd();
    const created = await createdUsd();
    const lookedUp = await lookedUpUsd();
    const charged = await chargedUsd();

    expect(created).toEqual(catalogue);
    expect(lookedUp).toEqual(catalogue);
    expect(charged).toEqual(catalogue);
    expect(new Set([catalogue.total, created.total, lookedUp.total, charged.total])).toEqual(new Set([EXPECTED.total]));
  });

  it('prices every path on the doctor\'s own charge, never the catalogue list price', async () => {
    await catalogueUsd();
    await createdUsd();
    await lookedUpUsd();
    await chargedUsd();

    const taxedPrices = vi.mocked(calculateTax).mock.calls.map(
      ([args]) => (args as { serviceItems: Array<{ price: number }> }).serviceItems[0].price,
    );
    expect(taxedPrices).toHaveLength(4);
    expect(taxedPrices.every((p) => p === CHARGES_IDR)).toBe(true);
    expect(taxedPrices).not.toContain(LIST_PRICE_IDR);
  });
});
