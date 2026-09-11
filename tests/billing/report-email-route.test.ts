/**
 * Who receives a clinical document is this route's whole job — the service takes
 * a finished address and asks no questions. These tests pin the policy: staff may
 * redirect a copy, the default is the client's own address, and a malformed `to`
 * never reaches the mail provider, which accepts arrays and would happily fan a
 * report out to a list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

// `kc-permissions` imports prisma at module scope but only touches it inside
// `assertBillingEnabled`, which this route never calls. An empty stub keeps the
// suite off the database without pretending to model tables nothing reads.
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/services/billing/kc-actor', () => ({
  resolveKcActor: vi.fn(async (actor: any) => ({ actor, wpUserId: 9000001n, clinicId: 3n })),
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  getMedReport: vi.fn().mockResolvedValue({
    id: 5, name: 'Hasil asesmen awal', patient_id: 9000002,
    upload_report: '42', date: new Date('2026-01-02'), patient_name: 'Budi Santoso',
  }),
}));
vi.mock('@/repositories/wp/patients.repo', () => ({
  findPatientById: vi.fn().mockResolvedValue({
    id: 9000002n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: 3n,
  }),
}));
vi.mock('@/services/billing/report-email.service', () => ({
  emailMedReport: vi.fn().mockResolvedValue(true),
}));

import { POST as sendEmailPOST } from '@/app/api/v1/patient-medical-reports/[id]/send-email/route';
import { emailMedReport } from '@/services/billing/report-email.service';
import { findPatientById } from '@/repositories/wp/patients.repo';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function token(role: string, sub = 'test-admin-9000001') {
  return new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
    .setExpirationTime('1h').sign(SECRET);
}

function post(jwt: string | null, body: unknown) {
  return new NextRequest('http://localhost/api/v1/patient-medical-reports/5/send-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = { params: { id: '5' } } as any;

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /patient-medical-reports/:id/send-email — the gate', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await sendEmailPOST(post(null, {}), ctx);
    expect(res.status).toBe(401);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  /**
   * `patient_report_manage` does not include CLIENT, so a client cannot email
   * even their own report. Staff send it to them. If this ever starts returning
   * 200, the capability map changed and the recipient policy below needs a
   * second look.
   */
  it('denies a CLIENT (403) and sends nothing', async () => {
    const res = await sendEmailPOST(post(await token('CLIENT'), {}), ctx);
    expect(res.status).toBe(403);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('no longer answers 501 for an authorised caller', async () => {
    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);
    expect(res.status).not.toBe(501);
  });
});

describe('POST /patient-medical-reports/:id/send-email — the recipient', () => {
  it('defaults to the client\'s own address', async () => {
    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(200);
    expect(emailMedReport).toHaveBeenCalledWith(5, 'budi@example.test', { clinicId: 3n });
  });

  it('lets staff redirect a copy', async () => {
    await sendEmailPOST(post(await token('PROFESSIONAL'), { to: 'rujukan@example.test' }), ctx);

    expect(emailMedReport).toHaveBeenCalledWith(5, 'rujukan@example.test', expect.anything());
  });

  it('refuses a non-string `to` (400) and sends nothing', async () => {
    // The mail provider accepts an array of recipients, so this is the
    // difference between one redirect and a fan-out.
    const res = await sendEmailPOST(
      post(await token('CLINIC_ADMIN'), { to: ['a@example.test', 'b@example.test'] }),
      ctx,
    );

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('refuses (400) when the client has no address on file', async () => {
    (findPatientById as any).mockResolvedValueOnce({
      id: 9000002n, email: '', displayName: 'Budi Santoso', clinicId: 3n,
    });

    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('refuses (400) when the client row is missing entirely', async () => {
    (findPatientById as any).mockResolvedValueOnce(null);

    const res = await sendEmailPOST(post(await token('CLINIC_ADMIN'), {}), ctx);

    expect(res.status).toBe(400);
    expect(emailMedReport).not.toHaveBeenCalled();
  });

  it('accepts a body that is not JSON at all, falling back to the client address', async () => {
    const req = new NextRequest('http://localhost/api/v1/patient-medical-reports/5/send-email', {
      method: 'POST',
      headers: { authorization: `Bearer ${await token('CLINIC_ADMIN')}`, 'content-type': 'application/json' },
      body: 'not json',
    });

    const res = await sendEmailPOST(req, ctx);

    expect(res.status).toBe(200);
    expect(emailMedReport).toHaveBeenCalledWith(5, 'budi@example.test', expect.anything());
  });
});
