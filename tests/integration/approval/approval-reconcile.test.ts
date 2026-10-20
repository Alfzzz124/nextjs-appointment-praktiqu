/**
 * An approval record and its appointment that disagree, against the test database (final
 * review I2, I3, M1).
 *
 * The reminder job stops a day before the session and never runs after it, so the queue
 * and the item settle what it would have: a booking cancelled or checked out in KiviCare,
 * and a rejection whose CANCELLED write never landed. An approval whose plugin call
 * errored after committing is kept, not undone. A booking approved but not yet confirmed
 * cannot be cancelled or rejected under it.
 *
 * The plugin is the one boundary mocked; jobs and email are mocked so nothing leaves the
 * machine.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';

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
import { POST as approvePost } from '@/app/api/v1/sessions/[id]/approve/route';
import { POST as rejectPost } from '@/app/api/v1/sessions/[id]/reject/route';
import { POST as cancelPost } from '@/app/api/v1/sessions/[id]/cancel/route';
import { handleApprovalReminder } from '@/services/approval/reminder-handler';

const BASE = 8_880_000;
const END = BASE + 10_000;
const CLINIC = BASE + 1;
const DOCTOR = BASE + 20; // read through the queue
const OTHER_DOCTOR = BASE + 21; // read one item at a time, never through the queue
const PATIENT = BASE + 30;
const APPT_CANCELLED_IN_KC = BASE + 100; // AWAITING, cancelled in KiviCare's dashboard
const APPT_CHECKED_OUT = BASE + 101; // AWAITING, checked out by a bill settlement
const APPT_HALF_REJECTED = BASE + 102; // REJECTED, but its CANCELLED write never landed
const APPT_WAITING = BASE + 103; // AWAITING, still PENDING: stays
const APPT_LOST_ANSWER = BASE + 104; // AWAITING; the plugin commits BOOKED, then errors
const APPT_BEING_CONFIRMED = BASE + 105; // APPROVED, still PENDING: the confirmation is on its way
const APPT_ITEM_HALF_REJECTED = BASE + 110; // OTHER_DOCTOR, REJECTED + PENDING, read as an item
const APPT_APPROVE_REJECTED = BASE + 111; // OTHER_DOCTOR, REJECTED + PENDING, then /approve
const APPT_JOB_HALF_REJECTED = BASE + 112; // OTHER_DOCTOR, REJECTED + PENDING, found by the reminder job
const APPT_RACE_CANCELLED = BASE + 113; // OTHER_DOCTOR, AWAITING; cancelled between the claim and the plugin call

const PSI = 'approval-reconcile-test-psi';
const OTHER_PSI = 'approval-reconcile-test-other';

const DATE = `${new Date().getUTCFullYear() + 1}-03-10`;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function req(sub: string, role: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
}
const sessionCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const ours = (data: Array<{ id: number }>) => data.map((d) => d.id).filter((id) => id >= BASE && id < END);

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `u${id}@approval-reconcile.test.local`,
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

async function authUser(id: string, wpUserId: number, first: string) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      username: id,
      firstName: first,
      lastName: 'Uji',
      displayName: first,
      role: 'PROFESSIONAL',
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

async function appointment(id: number, doctor: number, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
    id,
    CLINIC,
    doctor,
    PATIENT,
    DATE,
    DATE,
    status,
  );
}

async function record(id: number, doctor: number, state: 'AWAITING' | 'APPROVED' | 'REJECTED') {
  await prisma.sessionApproval.create({
    data: {
      appointmentId: BigInt(id),
      doctorWpUserId: BigInt(doctor),
      clinicId: BigInt(CLINIC),
      paymentOrderId: null,
      state,
      ...(state === 'REJECTED'
        ? { decidedAt: new Date(), decidedBy: PSI, rejectReason: 'Jadwal bentrok', refundStatus: 'NEEDED' }
        : {}),
      ...(state === 'APPROVED' ? { decidedAt: new Date(), decidedBy: PSI } : {}),
    },
  });
}

async function statusOf(id: number): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: number }>>('SELECT status FROM wp_kc_appointments WHERE id = ?', id);
  return Number(rows[0].status);
}

const approvalOf = (id: number) => prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(id) } });

async function wipe() {
  await prisma.logEntry.deleteMany({
    where: { resourceId: { in: Array.from({ length: 200 }, (_, i) => String(BASE + i)) } },
  });
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'approval-reconcile-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Uji', 'klinik@approval-reconcile.test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    CLINIC,
  );
  await wpUser(DOCTOR, 'kiviCare_doctor', 'Dianda');
  await wpUser(OTHER_DOCTOR, 'kiviCare_doctor', 'Pamela');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  for (const [mapId, doctor] of [[BASE + 900, DOCTOR], [BASE + 901, OTHER_DOCTOR]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
      mapId,
      doctor,
      CLINIC,
    );
  }
  await authUser(PSI, DOCTOR, 'Dianda');
  await authUser(OTHER_PSI, OTHER_DOCTOR, 'Pamela');

  await appointment(APPT_CANCELLED_IN_KC, DOCTOR, APPOINTMENT_STATUS.CANCELLED);
  await record(APPT_CANCELLED_IN_KC, DOCTOR, 'AWAITING');
  await appointment(APPT_CHECKED_OUT, DOCTOR, APPOINTMENT_STATUS.CHECK_OUT);
  await record(APPT_CHECKED_OUT, DOCTOR, 'AWAITING');
  await appointment(APPT_HALF_REJECTED, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_HALF_REJECTED, DOCTOR, 'REJECTED');
  await appointment(APPT_WAITING, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_WAITING, DOCTOR, 'AWAITING');
  await appointment(APPT_LOST_ANSWER, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_LOST_ANSWER, DOCTOR, 'AWAITING');
  await appointment(APPT_BEING_CONFIRMED, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_BEING_CONFIRMED, DOCTOR, 'APPROVED');
  await appointment(APPT_ITEM_HALF_REJECTED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_ITEM_HALF_REJECTED, OTHER_DOCTOR, 'REJECTED');
  await appointment(APPT_APPROVE_REJECTED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_APPROVE_REJECTED, OTHER_DOCTOR, 'REJECTED');
  await appointment(APPT_JOB_HALF_REJECTED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_JOB_HALF_REJECTED, OTHER_DOCTOR, 'REJECTED');
  await appointment(APPT_RACE_CANCELLED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await record(APPT_RACE_CANCELLED, OTHER_DOCTOR, 'AWAITING');
});

/** The plugin's status write, expect_status (1.8.4) included. */
async function pluginSetStatus(id: number, status: number, _payment?: unknown, opts: { expectStatus?: number } = {}) {
  if (opts.expectStatus !== undefined) {
    const moved = await prisma.$executeRawUnsafe(
      'UPDATE wp_kc_appointments SET status = ? WHERE id = ? AND status = ?',
      status,
      id,
      opts.expectStatus,
    );
    if (moved === 0) {
      if ((await statusOf(id)) !== status) throw new WpEndpointError('status 409', 409, 'praktiqu_status_conflict');
      return { id, status, cancelled: status === 0, claimed: false };
    }
    return { id, status, cancelled: status === 0, claimed: true };
  }
  await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
  return { id, status, cancelled: status === 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.setAppointmentStatus.mockImplementation(pluginSetStatus);
  writes.cancelAppointment.mockResolvedValue({ id: 0, status: 0, cancelled: true });
  jobsClient.enqueue.mockResolvedValue(undefined);
  jobsClient.cancel.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
});

describe('approved and still being confirmed', () => {
  it('/reject and /cancel answer 409 approval_already_decided and change nothing', async () => {
    const rejected = await rejectPost(await req(PSI, 'PROFESSIONAL', '/x', { reason: 'basi' }), sessionCtx(APPT_BEING_CONFIRMED));
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).title).toBe('approval_already_decided');

    const cancelled = await cancelPost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_BEING_CONFIRMED));
    expect(cancelled.status).toBe(409);
    expect((await cancelled.json()).title).toBe('approval_already_decided');

    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(await statusOf(APPT_BEING_CONFIRMED)).toBe(APPOINTMENT_STATUS.PENDING);
    expect(await approvalOf(APPT_BEING_CONFIRMED)).toMatchObject({ state: 'APPROVED', refundStatus: 'NONE' });
  });
});

describe('/approve', () => {
  it('on a rejection whose CANCELLED write never landed: 409, and the booking is not booked', async () => {
    const res = await approvePost(await req(OTHER_PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_APPROVE_REJECTED));

    expect(res.status).toBe(409);
    expect((await res.json()).title).toBe('approval_already_decided');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(await statusOf(APPT_APPROVE_REJECTED)).toBe(APPOINTMENT_STATUS.PENDING);
  });

  it('cancelled between the claim and the plugin call: 409, the booking stays CANCELLED and joins the refund list', async () => {
    writes.setAppointmentStatus.mockImplementationOnce(async (id: number, ...rest: unknown[]) => {
      // KiviCare's dashboard (or a cancel that read the record before the claim) lands first.
      await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', APPOINTMENT_STATUS.CANCELLED, id);
      return pluginSetStatus(id, ...(rest as [number, unknown, { expectStatus?: number }]));
    });

    const res = await approvePost(await req(OTHER_PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_RACE_CANCELLED));

    expect(res.status).toBe(409);
    expect((await res.json()).title).toBe('booking_cancelled');
    expect(await statusOf(APPT_RACE_CANCELLED)).toBe(APPOINTMENT_STATUS.CANCELLED);
    expect(await approvalOf(APPT_RACE_CANCELLED)).toMatchObject({ state: 'CANCELLED', refundStatus: 'NEEDED', decidedBy: null });

    const item = await itemGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_RACE_CANCELLED));
    expect((await item.json()).data).toMatchObject({ status: 'CANCELLED', approval: { state: 'CANCELLED', refundStatus: 'NEEDED' } });
  });

  it('the plugin commits BOOKED and then errors: the approval stands', async () => {
    writes.setAppointmentStatus.mockImplementation(async (id: number, status: number) => {
      await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
      throw new Error('socket hang up');
    });

    const res = await approvePost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_LOST_ANSWER));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'BOOKED', approval: { state: 'APPROVED', decidedByName: 'Dianda Uji' } });
    expect(await approvalOf(APPT_LOST_ANSWER)).toMatchObject({ state: 'APPROVED', decidedBy: PSI, refundStatus: 'NONE' });
    expect(jobsClient.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: APPT_LOST_ANSWER } });
  });
});

describe('GET /sessions/approvals', () => {
  it('settles stranded records before it answers, so the page and the counts agree', async () => {
    const res = await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(ours(body.data)).toEqual([APPT_WAITING]);
    expect(body.counts).toEqual({ awaiting: 1, refundNeeded: 2 });

    expect(await approvalOf(APPT_CANCELLED_IN_KC)).toMatchObject({ state: 'CANCELLED', refundStatus: 'NEEDED', decidedBy: null });
    expect(await approvalOf(APPT_CHECKED_OUT)).toMatchObject({ state: 'APPROVED', refundStatus: 'NONE', decidedBy: null });
    expect(await approvalOf(APPT_HALF_REJECTED)).toMatchObject({ state: 'REJECTED', refundStatus: 'NEEDED' });
    expect(await statusOf(APPT_HALF_REJECTED)).toBe(APPOINTMENT_STATUS.CANCELLED);
    expect(await approvalOf(APPT_WAITING)).toMatchObject({ state: 'AWAITING' });
    expect(await statusOf(APPT_WAITING)).toBe(APPOINTMENT_STATUS.PENDING);
    // Directly, not through the plugin: no KiviCare cancellation mail.
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(writes.cancelAppointment).not.toHaveBeenCalled();
  });

  it('the refund list now holds the booking cancelled in KiviCare', async () => {
    const body = await (await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals?state=REFUND_NEEDED'))).json();

    expect(ours(body.data).sort()).toEqual([APPT_CANCELLED_IN_KC, APPT_HALF_REJECTED]);
  });
});

describe('GET /sessions/:id/approval', () => {
  it('finishes its own half-done rejection before answering', async () => {
    const res = await itemGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_ITEM_HALF_REJECTED));
    expect(res.status).toBe(200);

    expect((await res.json()).data).toMatchObject({
      id: APPT_ITEM_HALF_REJECTED,
      status: 'CANCELLED',
      approval: { state: 'REJECTED', refundStatus: 'NEEDED' },
    });
    expect(await statusOf(APPT_ITEM_HALF_REJECTED)).toBe(APPOINTMENT_STATUS.CANCELLED);
    // A read mails nobody; only the reminder job, which runs as the system, does.
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('the reminder job', () => {
  const decidedAudits = () =>
    prisma.logEntry.count({ where: { resourceId: String(APPT_JOB_HALF_REJECTED), action: 'session.approval_decided' } });

  it('finishes a half-done rejection, tells the client once and audits the decision', async () => {
    await handleApprovalReminder({ appointmentId: APPT_JOB_HALF_REJECTED });

    expect(await statusOf(APPT_JOB_HALF_REJECTED)).toBe(APPOINTMENT_STATUS.CANCELLED);
    expect(await approvalOf(APPT_JOB_HALF_REJECTED)).toMatchObject({ state: 'REJECTED', refundStatus: 'NEEDED' });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: `u${PATIENT}@approval-reconcile.test.local`, template: 'approval_client_rejected' }),
    );
    expect(await decidedAudits()).toBe(1);

    // WordPress may run the job again (its unschedule is best-effort): nothing is repeated.
    await handleApprovalReminder({ appointmentId: APPT_JOB_HALF_REJECTED });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(await decidedAudits()).toBe(1);
  });
});
