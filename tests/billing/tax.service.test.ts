import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { listTaxes, getTax } from '@/services/billing/tax.service';

describe('tax.service list/get', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedTax({ id: 9000001, name: 'VAT', taxValue: '10' }); });
  afterAll(cleanup);

  it('lists taxes with pagination meta', async () => {
    const res = await listTaxes({ page: 1, perPage: 10 } as any, null);
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.taxes.find((t) => t.id === 9000001)?.name).toBe('VAT');
  });

  it('gets a single tax with parsed value', async () => {
    const tax = await getTax(9000001);
    expect(tax.taxValue).toBe(10);
  });

  it('throws 404 for missing tax', async () => {
    await expect(getTax(9999999)).rejects.toThrow();
  });
});
