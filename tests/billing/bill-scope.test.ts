import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedEncounter } from './fixtures';
import { prisma } from '@/lib/db';
import {
  createBill, getBill, getBillByEncounter, updateBill, updateBillItem, deleteBillItem,
  encountersWithoutBill, listBills,
  type BillScope,
} from '@/services/billing/bill.service';

/**
 * Cross-tenant row-scope regression suite (Critical finding, feat/encounter-documents
 * pre-merge review): `getBill`/`updateBill`/`updateBillItem`/`deleteBillItem`/
 * `getBillByEncounter`/`createBill` used to have no row scope at all — any
 * authenticated caller (CLIENT included, for the read paths) could act on any bill in
 * the install once the `withAuth` NaN-id bug was fixed. This suite proves clinic A
 * cannot reach clinic B's rows, and a patient cannot reach another patient's rows,
 * for every one of those functions.
 */

const CLINIC_A = 9_020_001, CLINIC_B = 9_020_002;
const DOCTOR_A = 9_020_011, DOCTOR_B = 9_020_012;
const PATIENT_A = 9_020_021, PATIENT_B = 9_020_022;
const ENC_A = 9_020_101, ENC_B = 9_020_102, ENC_B_NOBILL = 9_020_103, ENC_A_NOBILL = 9_020_105;

const scopeA: BillScope = { clinicId: BigInt(CLINIC_A) };
const scopeDoctorA: BillScope = { doctorId: BigInt(DOCTOR_A) };
const scopePatientA: BillScope = { patientId: BigInt(PATIENT_A) };
const scopeFailClosed: BillScope = { clinicId: -1n }; // clinic staff with no resolved clinic

let billAId: number, billBId: number;

async function wipeBillTree() {
  const bills = await prisma.kcBill.findMany({ where: { encounterId: { in: [BigInt(ENC_A), BigInt(ENC_B)] } }, select: { id: true } });
  for (const b of bills) await prisma.kcBillItem.deleteMany({ where: { billId: b.id } });
  await prisma.kcBill.deleteMany({ where: { encounterId: { in: [BigInt(ENC_A), BigInt(ENC_B)] } } });
  await prisma.kcPatientEncounter.deleteMany({ where: { id: { in: [BigInt(ENC_A), BigInt(ENC_B), BigInt(ENC_B_NOBILL), BigInt(ENC_A_NOBILL)] } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipeBillTree();
  await seedEncounter({ id: ENC_A, clinicId: CLINIC_A, doctorId: DOCTOR_A, patientId: PATIENT_A });
  await seedEncounter({ id: ENC_B, clinicId: CLINIC_B, doctorId: DOCTOR_B, patientId: PATIENT_B });
  await seedEncounter({ id: ENC_B_NOBILL, clinicId: CLINIC_B, doctorId: DOCTOR_B, patientId: PATIENT_B });
  await seedEncounter({ id: ENC_A_NOBILL, clinicId: CLINIC_A, doctorId: DOCTOR_A, patientId: PATIENT_A });

  const a = await createBill({
    serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
    taxItems: [], discount: 0, status: 'unpaid',
    clinic: { id: CLINIC_A }, doctor: { id: DOCTOR_A }, patient: { id: PATIENT_A },
    patientEncounter: { id: ENC_A }, service_total: 100, total_amount: 100,
  } as any); // unscoped setup call — not the code under test
  billAId = a.id;

  const b = await createBill({
    serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'B' }],
    taxItems: [], discount: 0, status: 'unpaid',
    clinic: { id: CLINIC_B }, doctor: { id: DOCTOR_B }, patient: { id: PATIENT_B },
    patientEncounter: { id: ENC_B }, service_total: 100, total_amount: 100,
  } as any);
  billBId = b.id;
});

afterAll(wipeBillTree);

describe('getBill scope', () => {
  it('SUPER_ADMIN (null scope) sees both bills', async () => {
    expect((await getBill(billAId, null)).id).toBe(billAId);
    expect((await getBill(billBId, null)).id).toBe(billBId);
  });

  it('clinic A cannot read clinic B\'s bill (404, not 403)', async () => {
    await expect(getBill(billBId, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getBill(billAId, scopeA)).id).toBe(billAId);
  });

  it('doctor A cannot read doctor B\'s bill', async () => {
    await expect(getBill(billBId, scopeDoctorA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getBill(billAId, scopeDoctorA)).id).toBe(billAId);
  });

  it('a CLIENT cannot read another patient\'s bill', async () => {
    await expect(getBill(billBId, scopePatientA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getBill(billAId, scopePatientA)).id).toBe(billAId);
  });

  it('a null clinicId (no clinic mapping) fails closed, matching nothing', async () => {
    await expect(getBill(billAId, scopeFailClosed)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(getBill(billBId, scopeFailClosed)).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('getBillByEncounter scope', () => {
  it('clinic A cannot fetch clinic B\'s bill by encounter id', async () => {
    await expect(getBillByEncounter(ENC_B, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    expect((await getBillByEncounter(ENC_A, scopeA) as any).id).toBe(billAId);
  });

  it('clinic A cannot see clinic B\'s unbilled-encounter skeleton either', async () => {
    // ENC_B_NOBILL has no bill at all — the skeleton branch must scope-check the
    // encounter itself, or it leaks clinic B's clinic/doctor/patient ids.
    await expect(getBillByEncounter(ENC_B_NOBILL, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('an unknown encounter id still returns the harmless unpaid stub (no leak, nothing to scope)', async () => {
    const res = await getBillByEncounter(9_999_999, scopeA);
    expect(res).toEqual({ status: 'unpaid' });
  });
});

describe('updateBill scope', () => {
  const patch = { serviceItems: [], taxItems: [], discount: 0, status: 'unpaid', total_amount: 50 } as any;

  it('clinic A cannot update clinic B\'s bill', async () => {
    await expect(updateBill(billBId, patch, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('clinic A can update its own bill', async () => {
    await expect(updateBill(billAId, { ...patch, total_amount: 100 }, scopeA)).resolves.toMatchObject({ id: billAId });
  });
});

describe('updateBillItem / deleteBillItem scope', () => {
  it('clinic A cannot update an item on clinic B\'s bill', async () => {
    const item = await prisma.kcBillItem.findFirst({ where: { billId: BigInt(billBId) } });
    await expect(updateBillItem(Number(item!.id), { serviceId: 1, quantity: 2, price: 10 }, scopeA))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('clinic A cannot delete an item on clinic B\'s bill', async () => {
    const item = await prisma.kcBillItem.findFirst({ where: { billId: BigInt(billBId) } });
    await expect(deleteBillItem(Number(item!.id), scopeA)).rejects.toMatchObject({ httpStatus: 404 });
    // still there — the scoped delete must not have gone through
    expect(await prisma.kcBillItem.findUnique({ where: { id: item!.id } })).not.toBeNull();
  });

  it('clinic A can update and delete an item on its own bill', async () => {
    const item = await prisma.kcBillItem.create({ data: { billId: BigInt(billAId), itemId: 5n, qty: 1, price: '10', createdAt: new Date() } });
    await expect(updateBillItem(Number(item.id), { serviceId: 1, quantity: 3, price: 10 }, scopeA)).resolves.toMatchObject({ id: Number(item.id) });
    await expect(deleteBillItem(Number(item.id), scopeA)).resolves.toMatchObject({ id: Number(item.id) });
  });
});

describe('createBill scope', () => {
  it('clinic A cannot create a bill against clinic B\'s encounter (404 "Encounter not found")', async () => {
    // A fresh, still-unbilled encounter in clinic B.
    const encId = 9_020_104;
    await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(encId) } });
    await seedEncounter({ id: encId, clinicId: CLINIC_B, doctorId: DOCTOR_B, patientId: PATIENT_B });
    try {
      await expect(createBill({
        serviceItems: [{ serviceId: 1, quantity: 1, price: 10, name: 'x' }],
        taxItems: [], discount: 0, status: 'unpaid',
        // Attacker-controlled body claims clinic A even though the encounter is
        // clinic B's — the check must key off the encounter, not the request body.
        clinic: { id: CLINIC_A }, doctor: { id: DOCTOR_A }, patient: { id: PATIENT_A },
        patientEncounter: { id: encId }, service_total: 10, total_amount: 10,
      } as any, scopeA)).rejects.toMatchObject({ httpStatus: 404 });
      expect(await prisma.kcBill.findFirst({ where: { encounterId: BigInt(encId) } })).toBeNull();
    } finally {
      const leftover = await prisma.kcBill.findMany({ where: { encounterId: BigInt(encId) }, select: { id: true } });
      for (const b of leftover) await prisma.kcBillItem.deleteMany({ where: { billId: b.id } });
      await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(encId) } });
      await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(encId) } });
    }
  });

  it('persists the encounter\'s own clinic, never a body-supplied one', async () => {
    // Clinic A staff creating a bill on their own (clinic A) encounter, but the
    // body labels it as clinic B's — `assertBillScope` now authorises bills by
    // `clinicId`, so a caller-controlled value here would move the row into
    // clinic B's listBills/exportBills/revenue and out of clinic A's.
    const encId = 9_020_107;
    await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(encId) } });
    await seedEncounter({ id: encId, clinicId: CLINIC_A, doctorId: DOCTOR_A, patientId: PATIENT_A });
    try {
      const created = await createBill({
        serviceItems: [{ serviceId: 1, quantity: 1, price: 10, name: 'x' }],
        taxItems: [], discount: 0, status: 'unpaid',
        clinic: { id: CLINIC_B }, doctor: { id: DOCTOR_B }, patient: { id: PATIENT_B },
        patientEncounter: { id: encId }, service_total: 10, total_amount: 10,
      } as any, scopeA);

      const row = await prisma.kcBill.findUnique({ where: { id: BigInt(created.id) }, select: { clinicId: true } });
      expect(row?.clinicId).toBe(BigInt(CLINIC_A));

      const inA = await listBills({ page: 1, perPage: 'all' } as any, scopeA);
      expect(inA.billings.map((b: any) => b.id)).toContain(created.id);

      const inB = await listBills({ page: 1, perPage: 'all' } as any, { clinicId: BigInt(CLINIC_B) });
      expect(inB.billings.map((b: any) => b.id)).not.toContain(created.id);
    } finally {
      const leftover = await prisma.kcBill.findMany({ where: { encounterId: BigInt(encId) }, select: { id: true } });
      for (const b of leftover) await prisma.kcBillItem.deleteMany({ where: { billId: b.id } });
      await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(encId) } });
      await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(encId) } });
    }
  });
});

describe('encountersWithoutBill scope', () => {
  it('a CLIENT only sees their own unbilled encounters, not another patient\'s', async () => {
    const asPatientA = await encountersWithoutBill(scopePatientA);
    const ids = asPatientA.encounters.map((e: any) => e.id);
    expect(ids).toContain(ENC_A_NOBILL);
    expect(ids).not.toContain(ENC_B_NOBILL);
  });

  it('clinic A only sees its own unbilled encounters', async () => {
    const asClinicA = await encountersWithoutBill(scopeA);
    const ids = asClinicA.encounters.map((e: any) => e.id);
    expect(ids).toContain(ENC_A_NOBILL);
    expect(ids).not.toContain(ENC_B_NOBILL);
  });
});
