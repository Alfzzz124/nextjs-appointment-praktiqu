/**
 * resolveClinicPayment and friends — spec §1 rules 1–5 through the real repo and the
 * real pure module, with only Prisma and the logger mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ kcOption: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

import {
  PaymentSettingsUnavailableError,
  readGlobalDefaults,
  resolveClinicPayment,
  resolveClinicPaymentForDisplay,
  resolveClinicPaymentMany,
  resolveClinicPaymentManyForDisplay,
} from '@/services/payments/clinic-payment.service';

function clinicRow(clinicId: number, value: string) {
  return { optionName: `praktiqu_endpoint_clinic_${clinicId}_payment`, optionValue: value };
}

const FLAGGED = JSON.stringify({
  international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000,
  updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.kcOption.findMany.mockReset();
});

describe('resolveClinicPayment', () => {
  it('resolves a flagged clinic from its option', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    const s = await resolveClinicPayment(4);

    expect(s.clinicId).toBe(4);
    expect(s.international).toBe(true);
    expect(s.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(logging.logging.warn).not.toHaveBeenCalled();
  });

  it('treats a missing option as not international, without logging', async () => {
    db.kcOption.findMany.mockResolvedValue([]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"international":tru', 'clinic_payment_option_malformed_json'],
    ['a PHP-serialized value', 'a:1:{s:13:"international";b:1;}', 'clinic_payment_option_serialized'],
    ['an invalid stored field', JSON.stringify({ international: true, markup_percent: 150 }), 'clinic_payment_option_invalid_field'],
  ])('fails closed on %s and logs it', async (_label, value, problem) => {
    db.kcOption.findMany.mockResolvedValue([
      clinicRow(4, value),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '18000' },
    ]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(false);
    expect(s.rate).toBeNull();
    expect(logging.logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: '4',
        metadata: { problems: [expect.stringContaining(problem)] },
      }),
    );
  });

  it('keeps a flagged clinic international when the global rate is out of range (rule 3) and logs it', async () => {
    db.kcOption.findMany.mockResolvedValue([
      clinicRow(4, JSON.stringify({ international: true, fx_rate: null })),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '500000' },
    ]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.warn).toHaveBeenCalledTimes(1);
  });

  it('throws PaymentSettingsUnavailableError on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    await expect(resolveClinicPayment(4)).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });

  it.each([0, -1])('answers not international for clinic id %i without a query', async (id) => {
    const s = await resolveClinicPayment(id);

    expect(s.international).toBe(false);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveClinicPaymentMany', () => {
  it('resolves several clinics with one query and an entry for every id', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    const map = await resolveClinicPaymentMany([4, 9, 0]);

    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(map.get(4)!.international).toBe(true);
    expect(map.get(9)!.international).toBe(false);
    expect(map.get(0)!.international).toBe(false);
  });
});

describe('display variants (rule 5)', () => {
  it('resolveClinicPaymentForDisplay returns not international and logs on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const s = await resolveClinicPaymentForDisplay(4);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.error).toHaveBeenCalledWith(
      expect.stringContaining('unavailable'),
      expect.any(PaymentSettingsUnavailableError),
      expect.objectContaining({ metadata: { clinicIds: [4] } }),
    );
  });

  it('resolveClinicPaymentManyForDisplay returns not international for every id on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const map = await resolveClinicPaymentManyForDisplay([4, 9]);

    expect([...map.keys()]).toEqual([4, 9]);
    expect(map.get(4)!.international).toBe(false);
    expect(map.get(9)!.international).toBe(false);
  });

  it('resolveClinicPaymentForDisplay resolves normally when the read works', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    expect((await resolveClinicPaymentForDisplay(4)).international).toBe(true);
  });
});

describe('readGlobalDefaults', () => {
  it('parses both global options', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '16500' },
      { optionName: 'praktiqu_endpoint_paypal_markup_percent', optionValue: '10' },
    ]);

    expect(await readGlobalDefaults()).toEqual({ fxRate: 16500, markupPercent: 10 });
  });

  it('throws PaymentSettingsUnavailableError on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('down'));

    await expect(readGlobalDefaults()).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });
});
