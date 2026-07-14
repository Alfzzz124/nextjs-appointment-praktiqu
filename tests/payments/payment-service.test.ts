import { describe, it, expect, vi, beforeEach } from 'vitest';

// computePublicAmount only needs calculateTax's *shape*, not a live DB — the
// real calculateTax hits prisma.kcTax.findMany() against whatever DATABASE_URL
// vitest is wired to (wordpress-praktiqu-test, per .env.test.local), and that
// table is NOT test-isolated (bill.service.test.ts's own 'calculateTax' suite
// seeds a global clinicId=-1 tax row that its cleanup() never deletes, since
// cleanup only deletes `WHERE clinic_id >= TEST_MARKER`). Mocking here keeps
// this a fast, deterministic unit test instead of an accidental integration
// test coupled to another suite's leftover fixture data.
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));

import { computePublicAmount, computeSessionAmountFromBill } from '@/services/payments/payment.service';
import type { BillDetail } from '@/services/billing/bill.service';
import { calculateTax } from '@/services/billing/bill.service';

const calculateTaxMock = vi.mocked(calculateTax);

beforeEach(() => {
  vi.clearAllMocks();
  calculateTaxMock.mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
});

describe('payment.service money math', () => {
  it('computePublicAmount: no taxes → expectedAmount equals price', async () => {
    const result = await computePublicAmount({ name: 'Consultation', price: 150000 });
    expect(result.expectedAmount).toBe(150000);
    expect(result.items).toEqual([{ name: 'Consultation', price: 150000 }]);
  });

  it('computePublicAmount: rounds a string price to an integer', async () => {
    const result = await computePublicAmount({ name: 'Consultation', price: '99999.6' });
    expect(result.expectedAmount).toBe(100000);
  });

  it('computePublicAmount: adds a global tax reported by calculateTax', async () => {
    calculateTaxMock.mockResolvedValue({
      total_tax: 15000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 15000, service_id: 0, service_name: 'Consultation' }],
    });
    const result = await computePublicAmount({ name: 'Consultation', price: 150000 });
    expect(result.expectedAmount).toBe(165000);
    expect(result.taxes).toEqual([{ name: 'VAT', amount: 15000 }]);
  });

  it('computeSessionAmountFromBill: passes through the bill total as integer rupiah', () => {
    const bill = {
      total_amount: 250000.4,
      serviceItems: [{ id: 1, serviceId: 1, service_name: 'Therapy', quantity: 1, price: 250000, total: 250000 }],
      taxItems: [{ id: 1, tax_name: 'VAT', tax_type: 'percentage', tax_value: 10, tax_amount: 25000 }],
    } as unknown as BillDetail;

    const result = computeSessionAmountFromBill(bill);
    expect(result.expectedAmount).toBe(250000);
    expect(result.items).toEqual([{ name: 'Therapy', price: 250000 }]);
    expect(result.taxes).toEqual([{ name: 'VAT', amount: 25000 }]);
  });
});
