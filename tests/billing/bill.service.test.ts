import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { calculateTax } from '@/services/billing/bill.service';

describe('bill.service calculateTax', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedTax({ id: 9000200, name: 'VAT', taxType: 'percentage', taxValue: '10' }); });
  afterAll(cleanup);

  it('returns total tax and per-service breakdown', async () => {
    const res = await calculateTax({
      clinic_id: -1, doctor_id: -1,
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, service_name: 'A' }],
    } as any);
    expect(res.total_tax).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(res.calculated_taxes)).toBe(true);
  });
});
