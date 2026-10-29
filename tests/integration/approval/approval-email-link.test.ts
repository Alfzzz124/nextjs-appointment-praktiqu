/**
 * The no-login approval link end to end against the test database
 * (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md §6, §9).
 *
 * Same boundaries mocked as approval-routes.test.ts: the plugin write (setAppointmentStatus
 * writes the status straight into wp_kc_appointments, as the plugin's UPDATE would), jobs
 * and email. The tests run in order and build on each other's state.
 *
 * Who may use a link is decided from the live account: a psychologist who was deactivated
 * (app account, WordPress account or professional status) no longer opens it. Only forged
 * tokens count against the rate limit, so the tests below never lock out a genuine one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { signApprovalToken } from '@/lib/public/approval-token';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const writes = vi.hoisted(() => ({ setAppointmentStatus: vi.fn() }));
vi.mock('@/repositories/wp/appointments.write', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/appointments.write')>()),
  setAppointmentStatus: (...a: unknown[]) => writes.setAppointmentStatus(...a),
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

import { GET as linkGet } from '@/app/api/v1/public/approvals/[token]/route';
import { POST as linkApprove } from '@/app/api/v1/public/approvals/[token]/approve/route';
import { POST as linkReject } from '@/app/api/v1/public/approvals/[token]/reject/route';
import { POST as staffApprove } from '@/app/api/v1/sessions/[id]/approve/route';

const { BASE, END } = idBlock('integration/approval/approval-email-link.test.ts');
const CLINIC = BASE + 1;
const DOCTOR = BASE + 20;
const OTHER_DOCTOR = BASE + 21;
const DOCTOR_GONE = BASE + 22; // gets deactivated, step by step
const DOCTOR_MISMATCH = BASE + 23; // its app account (same e-mail) belongs to another WordPress user
const MISMATCH_WP_ID = BASE + 24; // the wpUserId that app account carries
const PATIENT = BASE + 30;
const APPT_APPROVE = BASE + 100; // waiting, paid by order → approved through the link
const APPT_REJECT = BASE + 101; // waiting → rejected through the link
const APPT_DONE = BASE + 102; // already approved in the dashboard
const APPT_PAST = BASE + 103; // waiting, its session was a year ago
const APPT_MOVED = BASE + 104; // held for DOCTOR, the appointment now belongs to OTHER_DOCTOR
const APPT_RACE = BASE + 105; // two clicks on the link at the same moment
const APPT_RACE2 = BASE + 107; // link and dashboard approve at the same moment
const APPT_NONE = BASE + 106; // PENDING, never held for approval
const APPT_GONE = BASE + 108; // waiting, held for DOCTOR_GONE
const APPT_MISMATCH = BASE + 109; // waiting, held for DOCTOR_MISMATCH
const WC_ORDER = BASE + 500;

const PSI = 'approval-link-test-psi';
const GONE_USER = 'approval-link-test-gone';
const MISMATCH_USER = 'approval-link-test-mismatch';
const FUTURE = `${new Date().getUTCFullYear() + 1}-03-10`;
const PAST = `${new Date().getUTCFullYear() - 1}-03-10`;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
const wpEmail = (id: number) => `u${id}@approval-link.test.local`;
const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

const linkFor = (appointmentId: number, doctorWpUserId = DOCTOR) => signApprovalToken({ appointmentId, doctorWpUserId });
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

function getReq(token: string, ip = '198.51.100.7') {
  return new NextRequest(`http://localhost/api/v1/public/approvals/${token}`, { headers: { 'x-forwarded-for': ip } });
}
function postReq(token: string, action: 'approve' | 'reject', body?: unknown, ip = '198.51.100.7') {
  return new NextRequest(`http://localhost/api/v1/public/approvals/${token}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}
async function staffReq(id: number) {
  const jwt = await new SignJWT({ role: 'PROFESSIONAL' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(PSI)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
  return new NextRequest(`http://localhost/api/v1/sessions/${id}/approve`, {
    method: 'POST',
    body: '{}',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
  });
}

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: wpEmail(id), displayName: `${first} Uji`, userRegistered: new Date() },
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

async function appointment(id: number, doctor: number, status: number, date: string) {
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
    date,
    date,
    status,
  );
}

const statusOf = async (id: number) =>
  Number(
    (await prisma.$queryRawUnsafe<Array<{ status: number }>>('SELECT status FROM wp_kc_appointments WHERE id = ?', id))[0]
      .status,
  );

async function wipe() {
  const ids = [
    APPT_APPROVE, APPT_REJECT, APPT_DONE, APPT_PAST, APPT_MOVED, APPT_RACE, APPT_RACE2, APPT_NONE, APPT_GONE, APPT_MISMATCH,
  ].map(String);
  await prisma.logEntry.deleteMany({ where: { resourceId: { in: ids } } });
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { startsWith: 'approval-link-test-' } }, { wpUserId: inRange }] } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Tautan', 'klinik@approval-link.test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    CLINIC,
  );
  await wpUser(DOCTOR, 'kiviCare_doctor', 'Dianda');
  await wpUser(OTHER_DOCTOR, 'kiviCare_doctor', 'Pamela');
  await wpUser(DOCTOR_GONE, 'kiviCare_doctor', 'Gina');
  await wpUser(DOCTOR_MISMATCH, 'kiviCare_doctor', 'Mira');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  for (const [mapId, doctor] of [
    [BASE + 900, DOCTOR],
    [BASE + 901, OTHER_DOCTOR],
    [BASE + 902, DOCTOR_GONE],
    [BASE + 903, DOCTOR_MISMATCH],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
      mapId,
      doctor,
      CLINIC,
    );
  }
  // Same address as the WordPress account: ensureUserFromWordPress finds this row.
  await prisma.user.create({
    data: {
      id: PSI,
      email: wpEmail(DOCTOR),
      username: PSI,
      firstName: 'Dianda',
      lastName: 'Uji',
      displayName: 'Dianda',
      role: 'PROFESSIONAL',
      wpUserId: BigInt(DOCTOR),
      status: 1,
    },
  });
  await prisma.user.create({
    data: {
      id: GONE_USER,
      email: wpEmail(DOCTOR_GONE),
      username: GONE_USER,
      firstName: 'Gina',
      lastName: 'Uji',
      displayName: 'Gina',
      role: 'PROFESSIONAL',
      wpUserId: BigInt(DOCTOR_GONE),
      status: 1,
    },
  });
  // The e-mail finds this account, but it is the app account of a different WordPress user.
  await prisma.user.create({
    data: {
      id: MISMATCH_USER,
      email: wpEmail(DOCTOR_MISMATCH),
      username: MISMATCH_USER,
      firstName: 'Mira',
      lastName: 'Uji',
      displayName: 'Mira',
      role: 'PROFESSIONAL',
      wpUserId: BigInt(MISMATCH_WP_ID),
      status: 1,
    },
  });

  for (const id of [APPT_APPROVE, APPT_REJECT, APPT_RACE, APPT_RACE2, APPT_NONE]) {
    await appointment(id, DOCTOR, APPOINTMENT_STATUS.PENDING, FUTURE);
  }
  await appointment(APPT_DONE, DOCTOR, APPOINTMENT_STATUS.BOOKED, FUTURE);
  await appointment(APPT_PAST, DOCTOR, APPOINTMENT_STATUS.PENDING, PAST);
  await appointment(APPT_MOVED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING, FUTURE);
  await appointment(APPT_GONE, DOCTOR_GONE, APPOINTMENT_STATUS.PENDING, FUTURE);
  await appointment(APPT_MISMATCH, DOCTOR_MISMATCH, APPOINTMENT_STATUS.PENDING, FUTURE);

  const order = await prisma.paymentOrder.create({
    data: {
      source: 'public',
      appointmentId: String(APPT_APPROVE),
      wcOrderId: WC_ORDER,
      expectedAmount: 350000,
      status: 'paid',
      gateway: 'xendit',
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
      transactionId: 'tx-tautan',
    },
  });
  const waiting = (id: number, paymentOrderId: string | null = null, doctor = DOCTOR) => ({
    appointmentId: BigInt(id),
    doctorWpUserId: BigInt(doctor),
    clinicId: BigInt(CLINIC),
    paymentOrderId,
    state: 'AWAITING',
  });
  await prisma.sessionApproval.createMany({
    data: [
      waiting(APPT_APPROVE, order.id),
      waiting(APPT_REJECT),
      waiting(APPT_PAST),
      waiting(APPT_MOVED),
      waiting(APPT_RACE),
      waiting(APPT_RACE2),
      waiting(APPT_GONE, null, DOCTOR_GONE),
      waiting(APPT_MISMATCH, null, DOCTOR_MISMATCH),
      { ...waiting(APPT_DONE), state: 'APPROVED', decidedAt: new Date(), decidedBy: PSI },
    ],
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.setAppointmentStatus.mockImplementation(async (id: number, status: number) => {
    await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
    return { id, status, cancelled: status === 0 };
  });
  jobsClient.enqueue.mockResolvedValue(true);
  jobsClient.cancel.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
});

const VIEW_KEYS = [
  'amount', 'canApprove', 'canReject', 'clientName', 'decidedAt', 'decidedByName', 'isOverdue',
  'professionalName', 'serviceName', 'slotDate', 'startTime', 'state', 'timezone',
];

describe('GET /public/approvals/{token}', () => {
  it('shows a waiting booking with the buttons it may offer, and nothing else', async () => {
    const res = await linkGet(getReq(linkFor(APPT_APPROVE)), ctx(linkFor(APPT_APPROVE)));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(VIEW_KEYS);
    expect(data).toMatchObject({
      clientName: 'Klien Uji',
      professionalName: 'Dianda Uji',
      serviceName: 'Sesi',
      slotDate: FUTURE,
      startTime: '10:00:00',
      timezone: 'Asia/Jakarta',
      amount: { value: 350000, currency: 'IDR' },
      state: 'AWAITING',
      decidedByName: null,
      isOverdue: false,
      canApprove: true,
      canReject: true,
    });
  });

  it('opening the link decides nothing: no write, still PENDING and AWAITING', async () => {
    for (const id of [APPT_APPROVE, APPT_REJECT]) {
      const token = linkFor(id);
      expect((await linkGet(getReq(token), ctx(token))).status).toBe(200);
    }
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
    for (const id of [APPT_APPROVE, APPT_REJECT]) {
      expect(await statusOf(id)).toBe(APPOINTMENT_STATUS.PENDING);
      const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(id) } });
      expect(record).toMatchObject({ state: 'AWAITING', decidedBy: null });
    }
  });

  it('a link that does not verify, or names a booking without a record, is 404 approval_link_invalid', async () => {
    for (const token of ['rusak', linkFor(APPT_NONE), linkFor(BASE + 999)]) {
      const res = await linkGet(getReq(token), ctx(token));
      expect(res.status).toBe(404);
      expect((await res.json()).title).toBe('approval_link_invalid');
    }
  });

  it('a booking now with another psychologist does not open for the old one', async () => {
    const res = await linkGet(getReq(linkFor(APPT_MOVED)), ctx(linkFor(APPT_MOVED)));
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe('approval_link_invalid');
  });

  it('a decided booking shows who decided and no buttons', async () => {
    const { data } = await (await linkGet(getReq(linkFor(APPT_DONE)), ctx(linkFor(APPT_DONE)))).json();
    expect(data).toMatchObject({ state: 'APPROVED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });
  });

  it('a session that has started may only be rejected', async () => {
    const { data } = await (await linkGet(getReq(linkFor(APPT_PAST)), ctx(linkFor(APPT_PAST)))).json();
    expect(data).toMatchObject({ state: 'AWAITING', isOverdue: true, canApprove: false, canReject: true });
  });
});

describe('POST /public/approvals/{token}/approve', () => {
  it('approves as the psychologist: BOOKED, recorded under their account, audited via email_link', async () => {
    const token = linkFor(APPT_APPROVE);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ state: 'APPROVED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });

    expect(await statusOf(APPT_APPROVE)).toBe(APPOINTMENT_STATUS.BOOKED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_APPROVE) } });
    expect(record?.decidedBy).toBe(PSI);

    const audit = await prisma.logEntry.findFirst({
      where: { resourceId: String(APPT_APPROVE), action: 'session.approval_decided' },
    });
    expect(audit?.metadata).toMatchObject({ decision: 'APPROVED', via: 'email_link', onBehalf: false });
  });

  it('the same link again: 409 approval_already_decided, nothing written', async () => {
    const token = linkFor(APPT_APPROVE);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(409);
    expect((await res.json()).title).toBe('approval_already_decided');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('a session that has started: 422 session_already_started', async () => {
    const token = linkFor(APPT_PAST);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(422);
    expect((await res.json()).title).toBe('session_already_started');
    expect(await statusOf(APPT_PAST)).toBe(APPOINTMENT_STATUS.PENDING);
  });

  it('two clicks on the link at the same moment: exactly one decides, the other gets 409', async () => {
    const token = linkFor(APPT_RACE);
    const results = await Promise.all([
      linkApprove(postReq(token, 'approve'), ctx(token)),
      linkApprove(postReq(token, 'approve'), ctx(token)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(writes.setAppointmentStatus).toHaveBeenCalledTimes(1);
    expect(await statusOf(APPT_RACE)).toBe(APPOINTMENT_STATUS.BOOKED);
  });

  it('link and dashboard at the same moment: one decision recorded, BOOKED, nothing errors', async () => {
    const token = linkFor(APPT_RACE2);
    const [viaLink, viaDashboard] = await Promise.all([
      linkApprove(postReq(token, 'approve'), ctx(token)),
      staffApprove(await staffReq(APPT_RACE2), { params: Promise.resolve({ id: String(APPT_RACE2) }) }),
    ]);
    // The dashboard path that loses may answer 409 (claim lost), 400 (already BOOKED) or
    // 200 (it finished the winner's confirmation through completeApproval, which is
    // idempotent). Never a 5xx, and only one decision is ever recorded.
    for (const s of [viaLink.status, viaDashboard.status]) expect([200, 400, 409]).toContain(s);
    expect([viaLink.status, viaDashboard.status]).toContain(200);
    expect(await statusOf(APPT_RACE2)).toBe(APPOINTMENT_STATUS.BOOKED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_RACE2) } });
    expect(record).toMatchObject({ state: 'APPROVED', decidedBy: PSI });
    expect(
      await prisma.logEntry.count({ where: { resourceId: String(APPT_RACE2), action: 'session.approval_decided' } }),
    ).toBe(1);
  });
});

describe('POST /public/approvals/{token}/reject', () => {
  it('an empty or too long reason is 422 and changes nothing', async () => {
    const token = linkFor(APPT_REJECT);
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      const res = await linkReject(postReq(token, 'reject', { reason }), ctx(token));
      expect(res.status).toBe(422);
    }
    expect(await statusOf(APPT_REJECT)).toBe(APPOINTMENT_STATUS.PENDING);
  });

  it('rejects as the psychologist: CANCELLED, reason kept internal, client told', async () => {
    const token = linkFor(APPT_REJECT);
    const res = await linkReject(postReq(token, 'reject', { reason: '  Bentrok jadwal  ' }), ctx(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ state: 'REJECTED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });
    expect(JSON.stringify(body)).not.toContain('Bentrok jadwal');

    expect(await statusOf(APPT_REJECT)).toBe(APPOINTMENT_STATUS.CANCELLED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_REJECT) } });
    expect(record).toMatchObject({ state: 'REJECTED', rejectReason: 'Bentrok jadwal', refundStatus: 'NEEDED', decidedBy: PSI });
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: wpEmail(PATIENT), subject: 'Jadwal sesi Anda tidak dapat diterima' }),
    );
  });
});

describe('rejecting after the session started', () => {
  it('is still allowed: the approve above was refused with 422, the reject goes through', async () => {
    const token = linkFor(APPT_PAST);
    const res = await linkReject(postReq(token, 'reject', { reason: 'Sudah lewat' }), ctx(token));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ state: 'REJECTED', canApprove: false, canReject: false });
    expect(await statusOf(APPT_PAST)).toBe(APPOINTMENT_STATUS.CANCELLED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_PAST) } });
    expect(record).toMatchObject({ state: 'REJECTED', rejectReason: 'Sudah lewat', decidedBy: PSI });
  });
});

describe('who may use a link', () => {
  const notValid = async (res: Response) => {
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe('approval_link_invalid');
  };

  it('a deactivated psychologist loses the link, whichever way they were deactivated', async () => {
    const token = linkFor(APPT_GONE, DOCTOR_GONE);
    const open = () => linkGet(getReq(token), ctx(token));

    // 1. The app account: users.status 0.
    await prisma.user.update({ where: { id: GONE_USER }, data: { status: 0 } });
    await notValid(await open());
    await prisma.user.update({ where: { id: GONE_USER }, data: { status: 1 } });

    // 2. The WordPress account: users.status is only synced at login, so this is read live.
    await prisma.kcUserMeta.create({
      data: { userId: BigInt(DOCTOR_GONE), metaKey: 'praktiqu_user_status', metaValue: 'inactive' },
    });
    await notValid(await open());
    await prisma.kcUserMeta.deleteMany({ where: { userId: BigInt(DOCTOR_GONE), metaKey: 'praktiqu_user_status' } });

    // 3. The professional status, which is what the admin's "deactivate professional" sets.
    await prisma.kcUserMeta.updateMany({
      where: { userId: BigInt(DOCTOR_GONE), metaKey: 'praktiqu_professional_status' },
      data: { metaValue: 'INACTIVE' },
    });
    await notValid(await open());
    await notValid(await linkApprove(postReq(token, 'approve'), ctx(token)));
    await notValid(await linkReject(postReq(token, 'reject', { reason: 'Tidak jadi' }), ctx(token)));
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(await statusOf(APPT_GONE)).toBe(APPOINTMENT_STATUS.PENDING);
    await prisma.kcUserMeta.updateMany({
      where: { userId: BigInt(DOCTOR_GONE), metaKey: 'praktiqu_professional_status' },
      data: { metaValue: 'ACTIVE' },
    });

    // Everything back as it was: the very same link works again.
    const res = await open();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ state: 'AWAITING', canApprove: true, canReject: true });
  });

  it('an app account that belongs to another WordPress user: 500 approval_actor_missing, nothing decided', async () => {
    const token = linkFor(APPT_MISMATCH, DOCTOR_MISMATCH);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(500);
    expect((await res.json()).title).toBe('approval_actor_missing');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(await statusOf(APPT_MISMATCH)).toBe(APPOINTMENT_STATUS.PENDING);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_MISMATCH) } });
    expect(record).toMatchObject({ state: 'AWAITING', decidedBy: null });
  });
});

describe('rate limit', () => {
  it('only forged tokens count: 30 of them lock the address out, a genuine link still opens', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 30; i++) {
      const res = await linkGet(getReq(`rusak-${i}`, ip), ctx(`rusak-${i}`));
      expect(res.status).toBe(404);
      expect((await res.json()).title).toBe('approval_link_invalid');
    }

    const locked = await linkGet(getReq('rusak-lagi', ip), ctx('rusak-lagi'));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
    const problem = await locked.json();
    expect(problem).toMatchObject({ code: 'rate_limited', title: 'Too Many Requests', status: 429 });

    const post = await linkApprove(postReq('rusak-lagi', 'approve', undefined, ip), ctx('rusak-lagi'));
    expect(post.status).toBe(429);

    // The same address, a correctly signed token: never checked against the limiter.
    const done = linkFor(APPT_DONE);
    const ok = await linkGet(getReq(done, ip), ctx(done));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ state: 'APPROVED' });
  });

  it('a signed link that no longer works (no record) is 404 and is not counted', async () => {
    const ip = '203.0.113.51';
    const stale = linkFor(APPT_NONE);
    for (let i = 0; i < 35; i++) expect((await linkGet(getReq(stale, ip), ctx(stale))).status).toBe(404);
    const done = linkFor(APPT_DONE);
    expect((await linkGet(getReq(done, ip), ctx(done))).status).toBe(200);
  });
});
