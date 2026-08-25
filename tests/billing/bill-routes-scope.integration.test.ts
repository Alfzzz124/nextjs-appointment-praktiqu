import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, seedEncounter, cleanup } from './fixtures';
import { createBill } from '@/services/billing/bill.service';

vi.mock('puppeteer', () => ({ default: { launch: vi.fn().mockResolvedValue({
  newPage: vi.fn().mockResolvedValue({ setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(Buffer.from('PDF')) }),
  close: vi.fn(),
}) } }));

import { GET as billGet, PUT as billPut } from '@/app/api/v1/bills/[id]/route';
import { GET as billPrintGet } from '@/app/api/v1/bills/[id]/print/route';
import { GET as billByEncounterGet } from '@/app/api/v1/bills/by-encounter/[encounterId]/route';
import { PUT as billItemPut, DELETE as billItemDelete } from '@/app/api/v1/bills/item/[itemId]/route';

/**
 * Route-level proof for the row-scope fix: the reviewer's finding was specifically
 * that `withAuth`'s NaN-id fix ACTIVATES these `[id]` routes, so the wiring at the
 * route layer (does it resolve the actor and pass its scope to the service?) matters
 * as much as the service-level check itself (covered in bill-scope.test.ts).
 */

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
async function token(role: string, sub: string) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, init: RequestInit = {}) {
  return new NextRequest(url, { ...init, headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

const CLINIC_A = 9_022_001, CLINIC_B = 9_022_002;
const DOCTOR_A = 9_022_011, DOCTOR_B = 9_022_012;
const PATIENT_A = 9_022_021, PATIENT_B = 9_022_022;
const ENC_A = 9_022_101, ENC_B = 9_022_102;

let billAId: number, billBId: number;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC_A, clinicId: CLINIC_A });
  await seedClinicAdmin({ userId: CLINIC_B, clinicId: CLINIC_B });
  await seedEncounter({ id: ENC_A, clinicId: CLINIC_A, doctorId: DOCTOR_A, patientId: PATIENT_A });
  await seedEncounter({ id: ENC_B, clinicId: CLINIC_B, doctorId: DOCTOR_B, patientId: PATIENT_B });

  const a = await createBill({
    serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
    taxItems: [], discount: 0, status: 'unpaid',
    clinic: { id: CLINIC_A }, doctor: { id: DOCTOR_A }, patient: { id: PATIENT_A },
    patientEncounter: { id: ENC_A }, service_total: 100, total_amount: 100,
  } as any);
  billAId = a.id;

  const b = await createBill({
    serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'B' }],
    taxItems: [], discount: 0, status: 'unpaid',
    clinic: { id: CLINIC_B }, doctor: { id: DOCTOR_B }, patient: { id: PATIENT_B },
    patientEncounter: { id: ENC_B }, service_total: 100, total_amount: 100,
  } as any);
  billBId = b.id;
});

afterAll(async () => {
  for (const encId of [ENC_A, ENC_B]) {
    const bills = await prisma.kcBill.findMany({ where: { encounterId: BigInt(encId) }, select: { id: true } });
    for (const bl of bills) await prisma.kcBillItem.deleteMany({ where: { billId: bl.id } });
    await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(encId) } });
  }
  await prisma.kcPatientEncounter.deleteMany({ where: { id: { in: [BigInt(ENC_A), BigInt(ENC_B)] } } });
  await cleanup();
});

describe('GET /bills/:id', () => {
  it('clinic A gets 404 (not 403) for clinic B\'s bill', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billGet(reqWith(jwt, `http://localhost/api/v1/bills/${billBId}`), { params: { id: String(billBId) } } as any);
    expect(res.status).toBe(404);
    expect((await res.json())).toMatchObject({ status: false });
  });

  it('clinic A sees its own bill', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billGet(reqWith(jwt, `http://localhost/api/v1/bills/${billAId}`), { params: { id: String(billAId) } } as any);
    const json = await res.json();
    expect(json.status).toBe(true);
    expect(json.data.id).toBe(billAId);
  });
});

describe('PUT /bills/:id', () => {
  it('clinic A cannot update clinic B\'s bill', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billPut(reqWith(jwt, `http://localhost/api/v1/bills/${billBId}`, {
      method: 'PUT',
      body: JSON.stringify({
        serviceItems: [{ serviceId: 1, quantity: 1, price: 1, service_name: 'x' }],
        taxItems: [], discount: 0, status: 'unpaid',
        clinic: { id: CLINIC_B }, doctor: { id: DOCTOR_B }, patient: { id: PATIENT_B },
        patientEncounter: { id: ENC_B }, service_total: 1, total_amount: 1,
      }),
    }), { params: { id: String(billBId) } } as any);
    expect(res.status).toBe(404);
  });
});

describe('GET /bills/:id/print', () => {
  it('clinic A cannot render clinic B\'s invoice PDF', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billPrintGet(reqWith(jwt, `http://localhost/api/v1/bills/${billBId}/print`), { params: { id: String(billBId) } } as any);
    expect(res.status).toBe(404);
  });
});

describe('GET /bills/by-encounter/:encounterId', () => {
  it('clinic A cannot fetch clinic B\'s bill via its encounter id', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billByEncounterGet(reqWith(jwt, `http://localhost/api/v1/bills/by-encounter/${ENC_B}`), { params: { encounterId: String(ENC_B) } } as any);
    expect(res.status).toBe(404);
  });
});

describe('PUT/DELETE /bills/item/:itemId', () => {
  it('clinic A cannot update an item on clinic B\'s bill', async () => {
    const item = await prisma.kcBillItem.findFirst({ where: { billId: BigInt(billBId) } });
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billItemPut(reqWith(jwt, `http://localhost/api/v1/bills/item/${item!.id}`, {
      method: 'PUT', body: JSON.stringify({ serviceId: 1, quantity: 1, price: 1 }),
    }), { params: { itemId: String(item!.id) } } as any);
    expect(res.status).toBe(404);
  });

  it('clinic A cannot delete an item on clinic B\'s bill', async () => {
    const item = await prisma.kcBillItem.findFirst({ where: { billId: BigInt(billBId) } });
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC_A}`);
    const res = await billItemDelete(reqWith(jwt, `http://localhost/api/v1/bills/item/${item!.id}`), { params: { itemId: String(item!.id) } } as any);
    expect(res.status).toBe(404);
    expect(await prisma.kcBillItem.findUnique({ where: { id: item!.id } })).not.toBeNull();
  });
});
