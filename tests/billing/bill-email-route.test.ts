import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb, seedClinicAdmin, seedEncounter, cleanup } from './fixtures';
import { createBill } from '@/services/billing/bill.service';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) }));
vi.mock('puppeteer', () => ({ default: { launch: vi.fn().mockResolvedValue({
  newPage: vi.fn().mockResolvedValue({ setContent: vi.fn(), pdf: vi.fn().mockResolvedValue(Buffer.from('PDF')) }),
  close: vi.fn(),
}) } }));

import { POST as emailPost } from '@/app/api/v1/bills/[id]/email/route';
import { sendEmail } from '@/lib/email';

/**
 * `POST /bills/:id/email` reads the recipient from the request body behind a
 * `patient_bill_view` gate that includes CLIENT — the exact primitive the pre-merge
 * review flagged ("any authenticated client can have the invoice PDF for any bill
 * mailed to an address of their choosing"). Row scope (tested at the service level in
 * bill-scope.test.ts) closes "any bill"; this suite closes "an address of their
 * choosing" by proving a CLIENT's `to` override is ignored, while staff — who could
 * already see the real recipient in the UI — keep it for legitimate resends.
 */

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
async function token(role: string, sub: string) {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
}
function reqWith(jwt: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const CLINIC = 9_021_001, DOCTOR = 9_021_002, PATIENT = 9_021_003, OTHER_PATIENT = 9_021_004;
const ENC = 9_021_101;
let billId: number;

beforeAll(async () => {
  assertTestDb();
  await cleanup();
  await seedClinicAdmin({ userId: CLINIC, clinicId: CLINIC }); // gives a CLINIC_ADMIN test-admin-<CLINIC>
  await seedEncounter({ id: ENC, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });

  const bill = await createBill({
    serviceItems: [{ serviceId: 1, quantity: 1, price: 100, name: 'A' }],
    taxItems: [], discount: 0, status: 'unpaid',
    clinic: { id: CLINIC }, doctor: { id: DOCTOR }, patient: { id: PATIENT },
    patientEncounter: { id: ENC }, service_total: 100, total_amount: 100,
  } as any);
  billId = bill.id;

  await prisma.user.create({
    data: {
      id: `test-client-${PATIENT}`, email: `client${PATIENT}@test.local`, username: `client${PATIENT}`,
      firstName: 'C', lastName: 'L', displayName: 'Client', role: 'CLIENT', wpUserId: BigInt(PATIENT), status: 1,
    },
  });
  await prisma.user.create({
    data: {
      id: `test-client-${OTHER_PATIENT}`, email: `client${OTHER_PATIENT}@test.local`, username: `client${OTHER_PATIENT}`,
      firstName: 'O', lastName: 'P', displayName: 'Other Client', role: 'CLIENT', wpUserId: BigInt(OTHER_PATIENT), status: 1,
    },
  });
});

afterAll(async () => {
  const bills = await prisma.kcBill.findMany({ where: { encounterId: BigInt(ENC) }, select: { id: true } });
  for (const b of bills) await prisma.kcBillItem.deleteMany({ where: { billId: b.id } });
  await prisma.kcBill.deleteMany({ where: { encounterId: BigInt(ENC) } });
  await prisma.kcPatientEncounter.deleteMany({ where: { id: BigInt(ENC) } });
  await cleanup();
});

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /bills/:id/email', () => {
  it('ignores a CLIENT-supplied "to" — the recipient falls back to the bill\'s own patient email, not the attacker\'s address', async () => {
    const jwt = await token('CLIENT', `test-client-${PATIENT}`);
    const res = await emailPost(
      reqWith(jwt, `http://localhost/api/v1/bills/${billId}/email`, { to: 'attacker@evil.test' }),
      { params: { id: String(billId) } } as any,
    );
    // BillDetail.patient has no email field to fall back to (pre-existing, unrelated
    // gap noted in the report) — so the ignored override surfaces as "no recipient",
    // never as a send to the attacker's address.
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('honors a staff-supplied "to" for a bill within their clinic', async () => {
    const jwt = await token('CLINIC_ADMIN', `test-admin-${CLINIC}`);
    const res = await emailPost(
      reqWith(jwt, `http://localhost/api/v1/bills/${billId}/email`, { to: 'accountant@clinic.test' }),
      { params: { id: String(billId) } } as any,
    );
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'accountant@clinic.test' }));
  });

  it('a CLIENT gets 404 (not 403) for another patient\'s bill', async () => {
    const jwt = await token('CLIENT', `test-client-${OTHER_PATIENT}`);
    const res = await emailPost(
      reqWith(jwt, `http://localhost/api/v1/bills/${billId}/email`, {}),
      { params: { id: String(billId) } } as any,
    );
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
