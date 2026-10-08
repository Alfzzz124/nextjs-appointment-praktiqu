/**
 * rowPaymentFor — the `paymentMethods` + `usd` fields of a public row.
 *
 * calculateTax is mocked (as in payment-service.test.ts) so computePublicAmount stays a
 * fast unit; the settings are built with the real pure module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));

import { rowPaymentFor } from '@/services/payments/public-usd.service';
import { notInternational, parseStoredOption, resolveSettings } from '@/services/payments/intl-pricing';
import { calculateTax } from '@/services/billing/bill.service';

const calculateTaxMock = vi.mocked(calculateTax);

function flagged(fields: Record<string, unknown>) {
  return resolveSettings(
    4,
    parseStoredOption(JSON.stringify({ international: true, fx_rate: null, markup_percent: null, fixed_fee_idr: null, ...fields })),
    { fxRate: null, markupPercent: null },
  );
}

const ROW = { clinicId: 4, doctorId: 29, serviceId: 7, name: 'Konsultasi', price: '200000' };

beforeEach(() => {
  vi.clearAllMocks();
  calculateTaxMock.mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
});

describe('rowPaymentFor', () => {
  it('offers Xendit only, with no USD and no tax query, for a clinic that is not international', async () => {
    const result = await rowPaymentFor(ROW, notInternational(4));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
    expect(calculateTaxMock).not.toHaveBeenCalled();
  });

  it('offers Xendit only, with no tax query, for a flagged clinic with no usable rate', async () => {
    const result = await rowPaymentFor(ROW, flagged({ markup_percent: 10 }));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
    expect(calculateTaxMock).not.toHaveBeenCalled();
  });

  it('quotes the worked example for a flagged clinic with a rate', async () => {
    const result = await rowPaymentFor(ROW, flagged({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 }));

    expect(result).toEqual({
      paymentMethods: ['xendit', 'paypal', 'card'],
      usd: { price: '12.23', taxes: [], fee: '1.39', total: '13.62' },
    });
    expect(calculateTaxMock).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: 4,
      doctor_id: 29,
      serviceItems: [expect.objectContaining({ serviceId: 7, service_name: 'Konsultasi', price: 200000 })],
    }));
  });

  it('includes the clinic and doctor taxes in USD', async () => {
    calculateTaxMock.mockResolvedValue({
      total_tax: 22000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'PPN', tax_type: 'percentage', tax_value: 11, tax_amount: 22000, service_id: 7, service_name: 'Konsultasi' }],
    });

    const result = await rowPaymentFor(ROW, flagged({ fx_rate: 18000, markup_percent: 10 }));

    expect(result.usd).toEqual({ price: '12.23', taxes: [{ name: 'PPN', amount: '1.35' }], fee: null, total: '13.58' });
  });

  it('falls back to Xendit only for a free row', async () => {
    const result = await rowPaymentFor({ ...ROW, price: 0 }, flagged({ fx_rate: 18000, fixed_fee_idr: 25000 }));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
  });
});
