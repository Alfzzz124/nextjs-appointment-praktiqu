import { describe, it, expect } from 'vitest';
import { TaxCalculator } from '@/services/billing/tax-calculator';

describe('TaxCalculator', () => {
  it('percentage tax in exclude mode adds on top', () => {
    const c = new TaxCalculator();
    c.addService(1, 'Counseling', 100, 1);
    c.addTax(10, 'VAT', 'percentage', 10, [1]);
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(10);
    const flat = c.getCalculatedTaxes();
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ tax_id: 10, tax_amount: 10, service_id: 1 });
  });

  it('fixed tax adds a flat amount', () => {
    const c = new TaxCalculator();
    c.addService(1, 'X', 200, 2); // base 400
    c.addTax(5, 'Stamp', 'fixed', 15, [1]);
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(15);
  });

  it('global tax (no serviceIds) applies to all services', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 100, 1);
    c.addService(2, 'B', 100, 1);
    c.addTax(7, 'GST', 'percentage', 10); // global
    c.calculate('exclude');
    expect(c.getTotalTax()).toBe(20);
  });

  it('include mode extracts tax from price', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 110, 1); // price includes 10% tax
    c.addTax(7, 'GST', 'percentage', 10, [1]);
    c.calculate('include');
    expect(c.getTotalTax()).toBeCloseTo(10, 2); // base 100, tax 10
  });

  it('summary groups by tax id across services', () => {
    const c = new TaxCalculator();
    c.addService(1, 'A', 100, 1);
    c.addService(2, 'B', 100, 1);
    c.addTax(7, 'GST', 'percentage', 10);
    c.calculate('exclude');
    const summary = c.getTaxSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ tax_id: 7, tax_amount: 20 });
  });
});
