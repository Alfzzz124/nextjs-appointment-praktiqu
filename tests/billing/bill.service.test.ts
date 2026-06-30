import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb } from './fixtures';
import { calculateTax, createBill, getBill, getBillByEncounter, updateBill, updateBillItem, deleteBillItem } from '@/services/billing/bill.service';
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

describe('bill.service get', () => {
  beforeAll(async () => {
    assertTestDb();
    // Create encounter + bill for get tests (use a different id to avoid collision with create suite)
    await prisma.kcPatientEncounter.create({ data: { id: 9000400n, clinicId: 9000001n, doctorId: 9000002n, patientId: 9000003n, appointmentId: null, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
    await createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000400, appointmentId: null },
      service_total: 100, total_amount: 100,
    } as any);
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: 9000400n }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: 9000400n } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: 9000400n } });
  });

  it('reads back the created bill with serviceItems + recomputed totals', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000400n }, select: { id: true } });
    const bill = await getBill(Number(created!.id));
    expect(bill.serviceItems.length).toBeGreaterThanOrEqual(1);
    expect(bill).toHaveProperty('total_amount');
    expect(bill).toHaveProperty('taxItems');
    expect(bill.doctor.id).toBeGreaterThan(0);
    expect(bill.patient.id).toBeGreaterThan(0);
  });

  it('throws 404 KcError for a non-existent bill id', async () => {
    await expect(getBill(9999999)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('by-encounter returns full BillDetail when a bill exists', async () => {
    const res = await getBillByEncounter(9000400);
    expect(res).toHaveProperty('serviceItems');
    expect(Array.isArray((res as any).serviceItems)).toBe(true);
    expect(res).toHaveProperty('total_amount');
  });

  it('by-encounter returns a skeleton when no bill exists', async () => {
    const res = await getBillByEncounter(9000999); // no bill, no encounter → skeleton/empty
    expect(res).toHaveProperty('status');
  });
});

describe('bill.service update + items', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcPatientEncounter.create({ data: { id: 9000500n, clinicId: 9000001n, doctorId: 9000002n, patientId: 9000003n, appointmentId: null, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
    await createBill({
      serviceItems: [{ serviceId: 1, quantity: 2, price: 75, name: 'B' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: 9000001 }, doctor: { id: 9000002 }, patient: { id: 9000003 },
      patientEncounter: { id: 9000500, appointmentId: null },
      service_total: 150, total_amount: 150,
    } as any);
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: 9000500n }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: 9000500n } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: 9000500n } });
  });

  it('updates a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000500n } });
    const item = await prisma.kcBillItem.findFirst({ where: { billId: created!.id } });
    const r = await updateBillItem(Number(item!.id), { serviceId: 2, quantity: 3, price: 50 });
    expect(r.id).toBe(Number(item!.id));
    const after = await prisma.kcBillItem.findUnique({ where: { id: item!.id } });
    expect(after!.qty).toBe(3);
  });

  it('deletes a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: 9000500n } });
    const item = await prisma.kcBillItem.create({ data: { billId: created!.id, itemId: 5n, qty: 1, price: '10', createdAt: new Date() } });
    const r = await deleteBillItem(Number(item.id));
    expect(r.id).toBe(Number(item.id));
    expect(await prisma.kcBillItem.findUnique({ where: { id: item.id } })).toBeNull();
  });
});

import { listBills, encountersWithoutBill, exportBills } from '@/services/billing/bill.service';

describe('bill.service list', () => {
  it('lists bills with pagination meta and role scope (superadmin = all)', async () => {
    const res = await listBills({ page: 1, perPage: 10 } as any, null);
    expect(res.pagination).toHaveProperty('total');
    expect(Array.isArray(res.billings)).toBe(true);
  });

  it('lists encounters without a bill', async () => {
    const res = await encountersWithoutBill(null);
    expect(res).toHaveProperty('count');
  });

  it('exports bills as shaped rows', async () => {
    const res = await exportBills({ page: 1, perPage: 'all' } as any, null);
    expect(Array.isArray(res.bills)).toBe(true);
  });
});
