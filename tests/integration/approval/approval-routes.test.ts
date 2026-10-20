/**
 * The approval routes end to end against the test database (spec §7.3, §7.4).
 *
 * The plugin is the one boundary mocked: setAppointmentStatus writes the status straight
 * into wp_kc_appointments, as the plugin's UPDATE would. Jobs and email are mocked so
 * nothing leaves the machine. The tests in this file run in order and build on each
 * other's state (vitest runs the tests of one file sequentially).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const writes = vi.hoisted(() => ({ setAppointmentStatus: vi.fn(), cancelAppointment: vi.fn() }));
vi.mock('@/repositories/wp/appointments.write', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/appointments.write')>()),
  setAppointmentStatus: (...a: unknown[]) => writes.setAppointmentStatus(...a),
  cancelAppointment: (...a: unknown[]) => writes.cancelAppointment(...a),
}));

const jobsClient = vi.hoisted(() => ({ enqueue: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/jobs/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/jobs/client')>()),
  jobs: { enqueue: (...a: unknown[]) => jobsClient.enqueue(...a), cancel: (...a: unknown[]) => jobsClient.cancel(...a) },
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

import { GET as queueGet } from '@/app/api/v1/sessions/approvals/route';
import { GET as itemGet } from '@/app/api/v1/sessions/[id]/approval/route';
import { POST as refundPost } from '@/app/api/v1/sessions/[id]/refund-done/route';
import { POST as approvePost } from '@/app/api/v1/sessions/[id]/approve/route';
import { POST as rejectPost } from '@/app/api/v1/sessions/[id]/reject/route';
import { GET as settingGet, PUT as settingPut } from '@/app/api/v1/professionals/[id]/approval-setting/route';

const BASE = 8_870_000;
const END = BASE + 10_000;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const DOCTOR = BASE + 20;
const OTHER_DOCTOR = BASE + 21;
const PATIENT = BASE + 30;
const ADMIN_WP = BASE + 40;
const SUPER_WP = BASE + 41;
const APPT_AWAITING = BASE + 100; // DOCTOR, CLINIC_1, paid, waiting
const APPT_OTHER = BASE + 101; // OTHER_DOCTOR, CLINIC_2, paid, waiting
const APPT_REJECTED = BASE + 102; // DOCTOR, CLINIC_1, rejected, refund needed
const APPT_PLAIN = BASE + 103; // DOCTOR, CLINIC_1, unpaid, no record
const WC_ORDER = BASE + 500;

const PSI = 'approval-routes-test-psi';
const OTHER_PSI = 'approval-routes-test-other';
const ADMIN = 'approval-routes-test-admin';
const SUPER = 'approval-routes-test-super';
const RESEPSIONIS = 'approval-routes-test-resepsionis';

const DATE = `${new Date().getUTCFullYear() + 1}-03-10`;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function req(sub: string, role: string, path: string, body?: unknown, method?: string) {
  return new NextRequest(`http://localhost/api/v1${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
}
const sessionCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const professionalCtx = (id: number) => ({ params: { id: String(id) } }) as never;
const ours = (data: Array<{ id: number }>) => data.map((d) => d.id).filter((id) => id >= BASE && id < END);

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `u${id}@approval-routes.test.local`,
      displayName: `${first} Uji`,
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: 'Uji' },
      { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
}

async function authUser(id: string, role: string, wpUserId: number | null, first: string) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      username: id,
      firstName: first,
      lastName: 'Uji',
      displayName: first,
      role: role as never,
      wpUserId: wpUserId === null ? null : BigInt(wpUserId),
      status: 1,
    },
  });
}

async function appointment(id: number, clinic: number, doctor: number, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
    id,
    clinic,
    doctor,
    PATIENT,
    DATE,
    DATE,
    status,
  );
}

async function wipe() {
  const ids = [APPT_AWAITING, APPT_OTHER, APPT_REJECTED, APPT_PLAIN, DOCTOR, OTHER_DOCTOR].map(String);
  await prisma.logEntry.deleteMany({ where: { resourceId: { in: ids } } });
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'approval-routes-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  for (const [id, admin] of [[CLINIC_1, ADMIN_WP], [CLINIC_2, 0]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
      id,
      `Klinik ${id}`,
      `k${id}@approval-routes.test.local`,
      admin,
    );
  }
  await wpUser(DOCTOR, 'kiviCare_doctor', 'Dianda');
  await wpUser(OTHER_DOCTOR, 'kiviCare_doctor', 'Pamela');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  await wpUser(ADMIN_WP, 'kiviCare_clinic_admin', 'Rina');
  for (const [mapId, doctor, clinic] of [[BASE + 900, DOCTOR, CLINIC_1], [BASE + 901, OTHER_DOCTOR, CLINIC_2]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
      mapId,
      doctor,
      clinic,
    );
  }
  await authUser(PSI, 'PROFESSIONAL', DOCTOR, 'Dianda');
  await authUser(OTHER_PSI, 'PROFESSIONAL', OTHER_DOCTOR, 'Pamela');
  await authUser(ADMIN, 'CLINIC_ADMIN', ADMIN_WP, 'Rina');
  await authUser(SUPER, 'SUPER_ADMIN', SUPER_WP, 'Super');
  await authUser(RESEPSIONIS, 'RECEPTIONIST', null, 'Resepsionis');

  await appointment(APPT_AWAITING, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await appointment(APPT_OTHER, CLINIC_2, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await appointment(APPT_REJECTED, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.CANCELLED);
  await appointment(APPT_PLAIN, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.PENDING);

  const order = await prisma.paymentOrder.create({
    data: {
      source: 'public',
      appointmentId: String(APPT_AWAITING),
      wcOrderId: WC_ORDER,
      expectedAmount: 350000,
      status: 'paid',
      gateway: 'xendit',
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
      transactionId: 'tx-uji',
    },
  });
  await prisma.sessionApproval.createMany({
    data: [
      { appointmentId: BigInt(APPT_AWAITING), doctorWpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC_1), paymentOrderId: order.id, state: 'AWAITING' },
      { appointmentId: BigInt(APPT_OTHER), doctorWpUserId: BigInt(OTHER_DOCTOR), clinicId: BigInt(CLINIC_2), paymentOrderId: null, state: 'AWAITING' },
      {
        appointmentId: BigInt(APPT_REJECTED),
        doctorWpUserId: BigInt(DOCTOR),
        clinicId: BigInt(CLINIC_1),
        paymentOrderId: null,
        state: 'REJECTED',
        decidedAt: new Date(),
        decidedBy: PSI,
        rejectReason: 'Jadwal bentrok',
        refundStatus: 'NEEDED',
      },
    ],
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.setAppointmentStatus.mockImplementation(async (id: number, status: number) => {
    await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
    return { id, status, cancelled: status === 0 };
  });
  writes.cancelAppointment.mockResolvedValue({ id: 0, status: 0, cancelled: true });
  jobsClient.enqueue.mockResolvedValue(undefined);
  jobsClient.cancel.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
});

describe('GET /sessions/approvals', () => {
  it('a psychologist sees only their own queue, with counts and the payment', async () => {
    const res = await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(ours(body.data)).toEqual([APPT_AWAITING]);
    expect(body.counts).toEqual({ awaiting: 1, refundNeeded: 1 });
    expect(body.data[0]).toMatchObject({
      id: APPT_AWAITING,
      clientName: 'Klien Uji',
      professionalName: 'Dianda Uji',
      serviceName: 'Sesi',
      approval: { state: 'AWAITING', refundStatus: 'NONE', payment: { gateway: 'xendit', wcOrderId: WC_ORDER } },
    });
  });

  it('a clinic admin sees their clinic; asking for another clinic gets an empty page', async () => {
    const own = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', '/sessions/approvals'))).json();
    expect(ours(own.data)).toEqual([APPT_AWAITING]);

    const other = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', `/sessions/approvals?clinicId=${CLINIC_2}`))).json();
    expect(other.data).toEqual([]);
    expect(other.counts).toEqual({ awaiting: 0, refundNeeded: 0 });
  });

  it('a super admin narrows by clinic', async () => {
    const body = await (await queueGet(await req(SUPER, 'SUPER_ADMIN', `/sessions/approvals?clinicId=${CLINIC_2}`))).json();
    expect(ours(body.data)).toEqual([APPT_OTHER]);
  });

  it('REFUND_NEEDED carries the internal reason for staff', async () => {
    const body = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', '/sessions/approvals?state=REFUND_NEEDED'))).json();
    expect(ours(body.data)).toEqual([APPT_REJECTED]);
    expect(body.data[0].approval).toMatchObject({ state: 'REJECTED', refundStatus: 'NEEDED', rejectReason: 'Jadwal bentrok', decidedByName: 'Dianda Uji' });
  });

  it('a receptionist is refused; an unknown state is a 422', async () => {
    expect((await queueGet(await req(RESEPSIONIS, 'RECEPTIONIST', '/sessions/approvals'))).status).toBe(403);
    expect((await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals?state=NOPE'))).status).toBe(422);
  });
});

describe('GET /sessions/:id/approval', () => {
  it('the psychologist reads their own item', async () => {
    const res = await itemGet(await req(PSI, 'PROFESSIONAL', `/sessions/${APPT_AWAITING}/approval`), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ id: APPT_AWAITING, approval: { state: 'AWAITING', isOverdue: false } });
  });

  it("another psychologist gets 403; a session with no record gets 404", async () => {
    expect((await itemGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_AWAITING))).status).toBe(403);

    const res = await itemGet(await req(PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_PLAIN));
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe('approval_not_found');
  });
});

describe('deciding', () => {
  it('another psychologist cannot approve', async () => {
    const res = await approvePost(await req(OTHER_PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(403);
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('its psychologist approves: booked with the payment, record APPROVED', async () => {
    const res = await approvePost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(APPT_AWAITING, 1, {
      gateway: 'xendit',
      wcOrderId: WC_ORDER,
      transactionId: 'tx-uji',
    });
    expect(body.data).toMatchObject({ status: 'BOOKED', approval: { state: 'APPROVED', decidedByName: 'Dianda Uji' } });
    expect(jobsClient.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: APPT_AWAITING } });
  });

  it('approving again is refused by the transition rules', async () => {
    expect((await approvePost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING))).status).toBe(400);
  });

  it('a super admin rejects for the psychologist: cancelled, refund needed, client mailed', async () => {
    const res = await rejectPost(
      await req(SUPER, 'SUPER_ADMIN', '/x', { reason: 'Psikolog cuti' }),
      sessionCtx(APPT_OTHER),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'CANCELLED', approval: { state: 'REJECTED', refundStatus: 'NEEDED' } });

    const rows = await prisma.$queryRawUnsafe<Array<{ status: number }>>(
      'SELECT status FROM wp_kc_appointments WHERE id = ?',
      APPT_OTHER,
    );
    expect(Number(rows[0].status)).toBe(APPOINTMENT_STATUS.CANCELLED);
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: `u${PATIENT}@approval-routes.test.local` }));
  });
});

describe('POST /sessions/:id/refund-done', () => {
  it('a psychologist cannot mark a refund', async () => {
    expect((await refundPost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_REJECTED))).status).toBe(403);
  });

  it('the clinic admin marks it, once', async () => {
    const res = await refundPost(await req(ADMIN, 'CLINIC_ADMIN', '/x', { note: 'Transfer BCA 21/10' }), sessionCtx(APPT_REJECTED));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ refundStatus: 'DONE', refundNote: 'Transfer BCA 21/10', refundedByName: 'Rina Uji' });

    const again = await refundPost(await req(ADMIN, 'CLINIC_ADMIN', '/x', {}), sessionCtx(APPT_REJECTED));
    expect(again.status).toBe(409);
  });
});

describe('GET|PUT /professionals/:id/approval-setting', () => {
  it('the psychologist reads and switches on their own', async () => {
    const before = await settingGet(await req(PSI, 'PROFESSIONAL', '/x'), professionalCtx(DOCTOR));
    expect(before.status).toBe(200);
    expect((await before.json()).data).toEqual({ professionalId: DOCTOR, requiresApproval: false, updatedAt: null, updatedByName: null });

    const res = await settingPut(await req(PSI, 'PROFESSIONAL', '/x', { requiresApproval: true }, 'PUT'), professionalCtx(DOCTOR));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ professionalId: DOCTOR, requiresApproval: true, updatedByName: 'Dianda Uji' });

    const audit = await prisma.logEntry.findFirst({
      where: { action: 'professional.approval_setting_changed', resourceId: String(DOCTOR) },
    });
    expect(audit).not.toBeNull();
  });

  it('another psychologist may not', async () => {
    expect((await settingGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), professionalCtx(DOCTOR))).status).toBe(403);
  });

  it("the clinic admin may for their clinic's psychologist only", async () => {
    expect((await settingGet(await req(ADMIN, 'CLINIC_ADMIN', '/x'), professionalCtx(DOCTOR))).status).toBe(200);
    expect((await settingGet(await req(ADMIN, 'CLINIC_ADMIN', '/x'), professionalCtx(OTHER_DOCTOR))).status).toBe(403);
  });

  it('an unknown professional is 404; a bad body is 422', async () => {
    expect((await settingGet(await req(SUPER, 'SUPER_ADMIN', '/x'), professionalCtx(BASE + 999))).status).toBe(404);
    const bad = await settingPut(await req(SUPER, 'SUPER_ADMIN', '/x', { requiresApproval: 'ya' }, 'PUT'), professionalCtx(DOCTOR));
    expect(bad.status).toBe(422);
  });
});
