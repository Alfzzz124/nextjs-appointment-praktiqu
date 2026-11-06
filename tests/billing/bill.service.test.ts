import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedTax, cleanup, assertTestDb, useIdBlock } from './fixtures';
import { calculateTax, createBill, getBill, getBillByEncounter, updateBill, updateBillItem, deleteBillItem } from '@/services/billing/bill.service';
import { prisma } from '@/lib/db';
import { optionMarker, removedMarker } from '@/repositories/wp/duration-option-marker';

const { BASE } = useIdBlock('billing/bill.service.test.ts');

describe('bill.service calculateTax', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); await seedTax({ id: BASE + 200, name: 'VAT', taxType: 'percentage', taxValue: '10' }); });
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

describe('bill.service calculateTax: service-scoped tax and duration options', () => {
  const CLINIC = BASE + 2000;
  const TAX = BASE + 2001;
  const TAX_GLOBAL = BASE + 2002;
  const DOCTOR = BASE + 2030;
  const [S_PARENT, S_OPT, S_REMOVED, S_OTHER] = [BASE + 2010, BASE + 2011, BASE + 2012, BASE + 2013];
  const [M_PARENT, M_OPT, M_REMOVED] = [BASE + 2020, BASE + 2021, BASE + 2022];
  const mapRow = (id: number, serviceId: number, duration: number, extra: string | null, status = 1) => ({
    id: BigInt(id), serviceId: BigInt(serviceId), doctorId: BigInt(DOCTOR), clinicId: BigInt(CLINIC),
    charges: '100', duration, status, isPublic: 1, telemedService: 'no', extra, createdAt: new Date(),
  });
  const wipeRows = async () => {
    await prisma.kcTax.deleteMany({ where: { id: { in: [BigInt(TAX), BigInt(TAX_GLOBAL)] } } });
    await prisma.kcServiceDoctorMapping.deleteMany({ where: { id: { in: [M_PARENT, M_OPT, M_REMOVED].map(BigInt) } } });
    await prisma.kcService.deleteMany({ where: { id: { in: [S_PARENT, S_OPT, S_REMOVED, S_OTHER].map(BigInt) } } });
  };

  beforeAll(async () => {
    assertTestDb();
    await wipeRows();
    await prisma.kcService.createMany({
      data: [S_PARENT, S_OPT, S_REMOVED, S_OTHER].map((id) => ({
        id: BigInt(id), name: `Pajak Uji ${id}`, type: 'uji_pajak', price: '0', category: null, status: 1, createdAt: new Date(),
      })) as never,
    });
    await prisma.kcServiceDoctorMapping.createMany({
      data: [
        mapRow(M_PARENT, S_PARENT, 60, null),
        mapRow(M_OPT, S_OPT, 90, optionMarker(BigInt(M_PARENT))),
        mapRow(M_REMOVED, S_REMOVED, 45, removedMarker(BigInt(M_PARENT)), 0),
      ] as never,
    });
    // service_id on a tax row holds the parent MAPPING id.
    await prisma.kcTax.create({
      data: {
        id: BigInt(TAX), name: 'Pajak Layanan', taxType: 'percentage', taxValue: '10', clinicId: BigInt(CLINIC),
        doctorId: BigInt(DOCTOR), serviceId: BigInt(M_PARENT), addedBy: 1n, status: 1, createdAt: new Date(),
      },
    });
    // Doctor-global row: service_id is a catalogue id by KiviCare Pro's contract, so it is
    // never read as a mapping id here, even when the number happens to equal one.
    await prisma.kcTax.create({
      data: {
        id: BigInt(TAX_GLOBAL), name: 'Pajak Global', taxType: 'percentage', taxValue: '5', clinicId: BigInt(CLINIC),
        doctorId: -1n, serviceId: BigInt(M_PARENT), addedBy: 1n, status: 1, createdAt: new Date(),
      },
    });
  });
  afterAll(wipeRows);

  const item = (id: number) => ({ serviceId: id, quantity: 1, price: 100, service_name: `s${id}` });
  const hitsOf = async (taxId: number) => {
    const res = await calculateTax({
      clinic_id: CLINIC, doctor_id: DOCTOR,
      serviceItems: [item(S_PARENT), item(S_OPT), item(S_REMOVED), item(S_OTHER)],
    } as any);
    return res.calculated_taxes.filter((t) => t.tax_id === taxId).map((t) => t.service_id).sort();
  };

  it('applies a doctor-specific tax to the parent and all its options (removed too), not to other services', async () => {
    expect(await hitsOf(TAX)).toEqual([S_PARENT, S_OPT, S_REMOVED].sort());
  });

  it('does not read a doctor-global row as a mapping id: options are not added', async () => {
    expect(await hitsOf(TAX_GLOBAL)).toEqual([S_PARENT]);
  });
});

describe('bill.service create', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcPatientEncounter.create({ data: { id: BigInt(BASE + 300), clinicId: BigInt(BASE + 1), doctorId: BigInt(BASE + 2), patientId: BigInt(BASE + 3), appointmentId: BigInt(BASE + 4), status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: BigInt(BASE + 300) }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(BASE + 300) } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(BASE + 300) } });
    await cleanup();
  });

  it('creates a bill + items in a transaction', async () => {
    const res = await createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: BASE + 1 }, doctor: { id: BASE + 2 }, patient: { id: BASE + 3 },
      patientEncounter: { id: BASE + 300, appointmentId: BASE + 4 },
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
      clinic: { id: BASE + 1 }, doctor: { id: BASE + 2 }, patient: { id: BASE + 3 },
      patientEncounter: { id: BASE + 300, appointmentId: BASE + 4 },
      service_total: 100, total_amount: 100,
    } as any)).rejects.toThrow();
  });
});

describe('bill.service get', () => {
  beforeAll(async () => {
    assertTestDb();
    // Create encounter + bill for get tests (use a different id to avoid collision with create suite)
    await prisma.kcPatientEncounter.create({ data: { id: BigInt(BASE + 400), clinicId: BigInt(BASE + 1), doctorId: BigInt(BASE + 2), patientId: BigInt(BASE + 3), appointmentId: null, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
    await createBill({
      serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: BASE + 1 }, doctor: { id: BASE + 2 }, patient: { id: BASE + 3 },
      patientEncounter: { id: BASE + 400, appointmentId: null },
      service_total: 100, total_amount: 100,
    } as any);
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: BigInt(BASE + 400) }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(BASE + 400) } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(BASE + 400) } });
  });

  it('reads back the created bill with serviceItems + recomputed totals', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(BASE + 400) }, select: { id: true } });
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
    const res = await getBillByEncounter(BASE + 400);
    expect(res).toHaveProperty('serviceItems');
    expect(Array.isArray((res as any).serviceItems)).toBe(true);
    expect(res).toHaveProperty('total_amount');
  });

  it('by-encounter returns a skeleton when no bill exists', async () => {
    const res = await getBillByEncounter(BASE + 999); // no bill, no encounter → skeleton/empty
    expect(res).toHaveProperty('status');
  });
});

describe('bill.service update + items', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcPatientEncounter.create({ data: { id: BigInt(BASE + 500), clinicId: BigInt(BASE + 1), doctorId: BigInt(BASE + 2), patientId: BigInt(BASE + 3), appointmentId: null, status: 1, addedBy: 1n, createdAt: new Date(), encounterDate: new Date() } as any });
    await createBill({
      serviceItems: [{ serviceId: 1, quantity: 2, price: 75, name: 'B' }],
      taxItems: [], discount: 0, status: 'unpaid',
      clinic: { id: BASE + 1 }, doctor: { id: BASE + 2 }, patient: { id: BASE + 3 },
      patientEncounter: { id: BASE + 500, appointmentId: null },
      service_total: 150, total_amount: 150,
    } as any);
  });
  afterAll(async () => {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: BigInt(BASE + 500) }, select: { id: true } });
    for (const b of bills) { await prisma.kcBillItem.deleteMany({ where: { billId: b.id } }); }
    await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(BASE + 500) } });
    await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(BASE + 500) } });
  });

  it('updates a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(BASE + 500) } });
    const item = await prisma.kcBillItem.findFirst({ where: { billId: created!.id } });
    const r = await updateBillItem(Number(item!.id), { serviceId: 2, quantity: 3, price: 50 });
    expect(r.id).toBe(Number(item!.id));
    const after = await prisma.kcBillItem.findUnique({ where: { id: item!.id } });
    expect(after!.qty).toBe(3);
  });

  it('deletes a bill item', async () => {
    const created = await prisma.kcBill.findFirst({ where: { encounterId: BigInt(BASE + 500) } });
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
