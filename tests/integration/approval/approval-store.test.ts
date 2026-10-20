/**
 * session_approvals + professional_approval_settings against the real test database.
 *
 * The tables are written by hand (prisma/manual/2026-10-19-approval-psikolog.sql), so this
 * file is also the check that the SQL and the Prisma models agree: a column the model
 * names but the SQL forgot fails here, not in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  claimDecision,
  countApprovals,
  findApproval,
  findApprovals,
  findWpUserContact,
  insertAwaiting,
  listApprovals,
  markEscalated,
  markRefundDone,
  paymentOrdersByIds,
  revertDecision,
  touchReminder,
  userNames,
} from '@/services/approval/store';
import {
  getApprovalSetting,
  professionalsRequiringApproval,
  requiresApproval,
  setApprovalSetting,
} from '@/services/approval/settings';

const BASE = 8_850_000;
const END = BASE + 10_000;
const DOCTOR_A = BASE + 20;
const DOCTOR_B = BASE + 21;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const WP_ADMIN = BASE + 30;
const T0 = new Date('2026-10-20T08:00:00.000Z');
const HOUR = 3_600_000;
const USER = 'approval-store-test-admin';

const inRange = { gte: BigInt(BASE), lt: BigInt(END) };

async function wipeApprovals() {
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
}

async function wipe() {
  await wipeApprovals();
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'approval-store-test-' } } });
}

function awaiting(id: number, doctor = DOCTOR_A, clinic = CLINIC_1, at = T0) {
  return insertAwaiting({ appointmentId: id, doctorWpUserId: doctor, clinicId: clinic, paymentOrderId: null, now: at });
}

/** Keep only rows from this file: other suites may leave rows in the shared table. */
const ours = (ids: number[]) => ids.filter((id) => id >= BASE && id < END);

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.user.create({
    data: {
      id: USER,
      email: `${USER}@test.local`,
      username: USER,
      firstName: 'Rina',
      lastName: 'Admin',
      displayName: 'Rina',
      role: 'CLINIC_ADMIN',
      status: 1,
    },
  });
  await prisma.kcUser.create({
    data: {
      id: BigInt(WP_ADMIN),
      userLogin: `u${WP_ADMIN}`,
      userEmail: 'admin@approval-store.test.local',
      displayName: 'Rina Admin Klinik',
      userRegistered: new Date(),
    },
  });
});

beforeEach(async () => {
  await wipeApprovals();
});

afterAll(async () => {
  await wipe();
});

describe('insertAwaiting', () => {
  it('creates one AWAITING row and refuses a second for the same appointment', async () => {
    expect(await awaiting(BASE + 100)).toBe(true);
    expect(await awaiting(BASE + 100)).toBe(false);

    const row = await findApproval(BASE + 100);
    expect(row).toMatchObject({
      appointmentId: BASE + 100,
      doctorWpUserId: DOCTOR_A,
      clinicId: CLINIC_1,
      paymentOrderId: null,
      state: 'AWAITING',
      refundStatus: 'NONE',
      decidedAt: null,
      decidedBy: null,
    });
    expect(row!.requestedAt.toISOString()).toBe(T0.toISOString());
  });

  it('findApproval answers null for an appointment without a row', async () => {
    expect(await findApproval(BASE + 999)).toBeNull();
  });
});

describe('claimDecision / revertDecision', () => {
  it('lets exactly one decision win', async () => {
    await awaiting(BASE + 101);

    expect(await claimDecision(BASE + 101, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 })).toBe(true);
    expect(
      await claimDecision(BASE + 101, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' }),
    ).toBe(false);

    expect(await findApproval(BASE + 101)).toMatchObject({ state: 'APPROVED', refundStatus: 'NONE', decidedBy: USER });
  });

  it('a rejection keeps its reason and needs a refund', async () => {
    await awaiting(BASE + 102);
    await claimDecision(BASE + 102, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'Di luar keahlian' });

    expect(await findApproval(BASE + 102)).toMatchObject({
      state: 'REJECTED',
      rejectReason: 'Di luar keahlian',
      refundStatus: 'NEEDED',
    });
  });

  it('a cancellation needs a refund too, with no reason', async () => {
    await awaiting(BASE + 103);
    await claimDecision(BASE + 103, { state: 'CANCELLED', decidedBy: null, decidedAt: T0 });

    expect(await findApproval(BASE + 103)).toMatchObject({ state: 'CANCELLED', rejectReason: null, refundStatus: 'NEEDED', decidedBy: null });
  });

  it('revertDecision puts a failed claim back to AWAITING', async () => {
    await awaiting(BASE + 104);
    await claimDecision(BASE + 104, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });

    await revertDecision(BASE + 104, 'REJECTED', USER);

    expect(await findApproval(BASE + 104)).toMatchObject({
      state: 'AWAITING',
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      refundStatus: 'NONE',
    });
  });

  it('revertDecision leaves a decision by someone else alone', async () => {
    await awaiting(BASE + 105);
    await claimDecision(BASE + 105, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 });

    await revertDecision(BASE + 105, 'APPROVED', 'someone-else');

    expect((await findApproval(BASE + 105))!.state).toBe('APPROVED');
  });
});

describe('refund and reminder bookkeeping', () => {
  it('markRefundDone succeeds once, and only on NEEDED', async () => {
    await awaiting(BASE + 110);
    expect(await markRefundDone(BASE + 110, USER, null, T0)).toBe(false);

    await claimDecision(BASE + 110, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });
    expect(await markRefundDone(BASE + 110, USER, 'Transfer BCA', T0)).toBe(true);
    expect(await markRefundDone(BASE + 110, USER, 'lagi', T0)).toBe(false);

    expect(await findApproval(BASE + 110)).toMatchObject({ refundStatus: 'DONE', refundedBy: USER, refundNote: 'Transfer BCA' });
  });

  it('touchReminder records the time; markEscalated keeps the first time', async () => {
    await awaiting(BASE + 111);
    const later = new Date(T0.getTime() + 24 * HOUR);

    await touchReminder(BASE + 111, later);
    await markEscalated(BASE + 111, later);
    await markEscalated(BASE + 111, new Date(later.getTime() + HOUR));

    const row = await findApproval(BASE + 111);
    expect(row!.lastReminderAt!.toISOString()).toBe(later.toISOString());
    expect(row!.escalatedAt!.toISOString()).toBe(later.toISOString());
  });
});

describe('findApprovals', () => {
  it('maps only the ids that have a row', async () => {
    await awaiting(BASE + 120);

    const map = await findApprovals([BASE + 120, BASE + 121]);

    expect([...map.keys()]).toEqual([BASE + 120]);
    expect(await findApprovals([])).toEqual(new Map());
  });
});

describe('listApprovals / countApprovals', () => {
  beforeEach(async () => {
    await awaiting(BASE + 130, DOCTOR_A, CLINIC_1, T0);
    await awaiting(BASE + 131, DOCTOR_B, CLINIC_2, new Date(T0.getTime() + HOUR));
    await awaiting(BASE + 132, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 132, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });
    await awaiting(BASE + 133, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 133, { state: 'CANCELLED', decidedBy: null, decidedAt: T0 });
    await markRefundDone(BASE + 133, USER, null, T0);
    await awaiting(BASE + 134, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 134, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 });
  });

  const ids = async (filter: Parameters<typeof listApprovals>[0], scope: Parameters<typeof listApprovals>[1]) =>
    ours((await listApprovals(filter, scope, 1, 100)).items.map((a) => a.appointmentId));

  it('AWAITING, oldest request first', async () => {
    expect(await ids('AWAITING', {})).toEqual([BASE + 130, BASE + 131]);
  });

  it('narrows by psychologist and by clinic', async () => {
    expect(await ids('AWAITING', { doctorWpUserId: DOCTOR_A })).toEqual([BASE + 130]);
    expect(await ids('AWAITING', { clinicId: CLINIC_2 })).toEqual([BASE + 131]);
  });

  it('REFUND_NEEDED, REFUNDED and DECIDED', async () => {
    expect(await ids('REFUND_NEEDED', { clinicId: CLINIC_1 })).toEqual([BASE + 132]);
    expect(await ids('REFUNDED', { clinicId: CLINIC_1 })).toEqual([BASE + 133]);
    expect((await ids('DECIDED', { clinicId: CLINIC_1 })).sort()).toEqual([BASE + 132, BASE + 133, BASE + 134]);
  });

  it('pages', async () => {
    const page2 = await listApprovals('AWAITING', { clinicId: CLINIC_2 }, 2, 1);
    expect(page2.total).toBe(1);
    expect(page2.items).toEqual([]);
  });

  it('counts within the scope', async () => {
    expect(await countApprovals({ clinicId: CLINIC_1 })).toEqual({ awaiting: 1, refundNeeded: 1 });
    expect(await countApprovals({ doctorWpUserId: DOCTOR_B })).toEqual({ awaiting: 1, refundNeeded: 0 });
  });
});

describe('lookups', () => {
  it('userNames joins first and last name and skips null or unknown ids', async () => {
    const names = await userNames([USER, null, 'nobody-here', USER]);
    expect([...names.entries()]).toEqual([[USER, 'Rina Admin']]);
  });

  it('paymentOrdersByIds returns the fields a refund needs', async () => {
    const order = await prisma.paymentOrder.create({
      data: {
        source: 'public',
        appointmentId: String(BASE + 140),
        wcOrderId: BASE + 500,
        expectedAmount: 350000,
        status: 'paid',
        gateway: 'xendit',
        chargedAmount: 350000,
        chargedCurrency: 'IDR',
        transactionId: 'tx-1',
      },
    });

    const map = await paymentOrdersByIds([order.id]);

    expect(map.get(order.id)).toEqual({
      id: order.id,
      gateway: 'xendit',
      wcOrderId: BASE + 500,
      transactionId: 'tx-1',
      expectedAmount: 350000,
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
    });
  });

  it('findWpUserContact reads wp_users', async () => {
    expect(await findWpUserContact(WP_ADMIN)).toEqual({ email: 'admin@approval-store.test.local', name: 'Rina Admin Klinik' });
    expect(await findWpUserContact(0)).toBeNull();
  });
});

describe('settings', () => {
  it('no row means off', async () => {
    expect(await requiresApproval(DOCTOR_A)).toBe(false);
    expect(await getApprovalSetting(DOCTOR_A)).toEqual({
      professionalId: DOCTOR_A,
      requiresApproval: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('setApprovalSetting upserts and reports the previous value', async () => {
    const on = await setApprovalSetting(DOCTOR_A, true, USER);
    expect(on.before).toBe(false);
    expect(on.after).toMatchObject({ professionalId: DOCTOR_A, requiresApproval: true, updatedBy: USER });
    expect(await requiresApproval(DOCTOR_A)).toBe(true);
    expect(await professionalsRequiringApproval([DOCTOR_A, DOCTOR_B])).toEqual(new Set([DOCTOR_A]));

    const off = await setApprovalSetting(DOCTOR_A, false, USER);
    expect(off.before).toBe(true);
    expect(await requiresApproval(DOCTOR_A)).toBe(false);
    expect(await professionalsRequiringApproval([])).toEqual(new Set());
  });
});
