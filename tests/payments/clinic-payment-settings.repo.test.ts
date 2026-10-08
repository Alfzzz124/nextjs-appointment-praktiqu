/**
 * Raw reads of the per-clinic payment option and the two global options.
 *
 * Mocked Prisma: what matters is the single query's shape and that any database error
 * becomes PaymentSettingsUnavailableError (the payment gate's retryable 503).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ kcOption: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  GLOBAL_MARKUP_OPTION,
  GLOBAL_RATE_OPTION,
  PaymentSettingsUnavailableError,
  clinicPaymentOptionName,
  readRawPaymentOptions,
} from '@/repositories/wp/clinic-payment-settings.repo';

beforeEach(() => {
  db.kcOption.findMany.mockReset();
});

describe('clinicPaymentOptionName', () => {
  it('is praktiqu_endpoint_clinic_{id}_payment', () => {
    expect(clinicPaymentOptionName(4)).toBe('praktiqu_endpoint_clinic_4_payment');
  });
});

describe('readRawPaymentOptions', () => {
  it('reads every clinic option and both globals in ONE query', async () => {
    db.kcOption.findMany.mockResolvedValue([]);

    await readRawPaymentOptions([4, 9]);

    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(db.kcOption.findMany).toHaveBeenCalledWith({
      where: {
        optionName: {
          in: [
            'praktiqu_endpoint_clinic_4_payment',
            'praktiqu_endpoint_clinic_9_payment',
            'praktiqu_endpoint_paypal_idr_rate',
            'praktiqu_endpoint_paypal_markup_percent',
          ],
        },
      },
      select: { optionName: true, optionValue: true },
    });
  });

  it('returns the raw strings keyed by clinic id, plus the globals', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: 'praktiqu_endpoint_clinic_9_payment', optionValue: '{"international":true}' },
      { optionName: GLOBAL_RATE_OPTION, optionValue: '16500' },
      { optionName: GLOBAL_MARKUP_OPTION, optionValue: '10' },
    ]);

    const raw = await readRawPaymentOptions([4, 9]);

    expect([...raw.byClinic.entries()]).toEqual([[9, '{"international":true}']]);
    expect(raw.globalRate).toBe('16500');
    expect(raw.globalMarkup).toBe('10');
  });

  it('still reads the globals when no clinic is asked for', async () => {
    db.kcOption.findMany.mockResolvedValue([{ optionName: GLOBAL_RATE_OPTION, optionValue: '18000' }]);

    const raw = await readRawPaymentOptions([]);

    expect(db.kcOption.findMany.mock.calls[0][0].where.optionName.in).toEqual([GLOBAL_RATE_OPTION, GLOBAL_MARKUP_OPTION]);
    expect(raw.byClinic.size).toBe(0);
    expect(raw.globalRate).toBe('18000');
    expect(raw.globalMarkup).toBeNull();
  });

  it('turns a database error into PaymentSettingsUnavailableError, keeping the cause', async () => {
    const dbDown = new Error('Too many connections');
    db.kcOption.findMany.mockRejectedValue(dbDown);

    const err = await readRawPaymentOptions([4]).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsUnavailableError);
    expect(err.cause).toBe(dbDown);
  });
});
