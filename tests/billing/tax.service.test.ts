import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { listTaxes, getTax, createTax } from '@/services/billing/tax.service';
import { prisma } from '@/lib/db';

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

describe('tax.service create', () => {
  afterAll(async () => { await prisma.kcTax.deleteMany({ where: { name: 'GST9M' } }); });

  it('creates a global tax and dedups identical ones', async () => {
    await prisma.kcTax.deleteMany({ where: { name: 'GST9M' } });
    const r1 = await createTax({ name: 'GST9M', rateType: 'percentage', rateValue: 9, clinic: -1, doctor: [], service: [] } as any, 1);
    expect(r1.created_count).toBe(1);
    const r2 = await createTax({ name: 'GST9M', rateType: 'percentage', rateValue: 9, clinic: -1, doctor: [], service: [] } as any, 1);
    expect(r2.skipped_count).toBe(1);
  });

  it('rejects rateValue <= 0 at the service layer', async () => {
    await expect(createTax({ name: 'bad', rateValue: 0 } as any, 1)).rejects.toThrow();
  });
});
