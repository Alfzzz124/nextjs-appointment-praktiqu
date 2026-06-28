import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { calculateTax, createBill } from '@/services/billing/bill.service';
import { prisma } from '@/lib/db';

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

describe('bill.service create', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcPatientEncounter.create({ data: { id: 9000300n, clinicId: 9000001n, doctorId: 9000002n, patientId: 9000003n, appointmentId: 9000004n, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: 9000300n }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: 9000300n } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: 9000300n } });
    await cleanup();
  });

  it('creates a bill + items in a transaction', async () => {
    const res = await createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000300, appointmentId: 9000004 },
      service_total: 100, total_amount: 100,
    } as any);
    expect(res.id).toBeGreaterThan(0);
    const items = await prisma.kcBillItem.findMany({ where: { billId: BigInt(res.id) } });
    expect(items).toHaveLength(1);
  });

  it('rejects a second bill for the same encounter (409)', async () => {
    await expect(createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000300, appointmentId: 9000004 },
      service_total: 100, total_amount: 100,
    } as any)).rejects.toThrow();
  });
});
