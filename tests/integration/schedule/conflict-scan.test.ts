/**
 * Pemindaian bentrok jadwal per jam, melawan database test sungguhan.
 *
 * Yang dijaga sebagian besar adalah STATUS: apakah peringatan yang sama terkirim dua kali,
 * apakah bentrok yang berubah memicu peringatan baru, apakah bentrok yang selesai membersihkan
 * jejaknya, dan apakah email yang gagal diulang hanya untuk penerimanya. Email di-mock;
 * database tidak.
 *
 * Kueri melihat SELURUH database test, termasuk sisa suite lain, jadi setiap asersi disaring
 * ke alamat dan id milik suite ini.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';

const { BASE, END } = idBlock('integration/schedule/conflict-scan.test.ts');
const CLINIC_A = BASE + 1; // admin ADMIN_A
const CLINIC_B = BASE + 2; // admin ADMIN_B
const CLINIC_NO_ADMIN = BASE + 3;
const CLINIC_OWNED = BASE + 4; // admin is the psikolog herself
const DOC = BASE + 20;
const PATIENT = BASE + 30;
const ADMIN_A = BASE + 40;
const ADMIN_B = BASE + 41;
const A1 = BASE + 100;
const A2 = BASE + 101;

const DOMAIN = '@schedule-conflict.test.local';
const mailOf = (id: number) => `u${id}${DOMAIN}`;
const DATE = `${new Date().getUTCFullYear() + 1}-05-12`;
const { BOOKED, PENDING, CANCELLED } = APPOINTMENT_STATUS;
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: mailOf(id),
      displayName: `${first} Uji`,
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: 'Uji' },
    ],
  });
}

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id - BASE}`,
    `klinik${id}${DOMAIN}`,
    adminId,
  );
}

async function appt(id: number, clinicId: number, start: string, end: string, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Jakarta', '', '', ?, NOW())`,
    id, clinicId, DOC, PATIENT, DATE, start, DATE, end, status,
  );
}

const update = (sql: string, ...args: unknown[]) =>
  prisma.$executeRawUnsafe(`UPDATE wp_kc_appointments SET ${sql}`, ...args);

/** Addresses of this suite that got a mail, sorted. */
function sentTo(): string[] {
  return email.sendEmail.mock.calls
    .map(([m]) => (m as { to: string }).to)
    .filter((to) => to.endsWith(DOMAIN))
    .sort();
}

const ourNotices = () =>
  prisma.scheduleConflictNotice.findMany({
    where: { appointmentLowId: { gte: BASE, lt: END } },
    orderBy: { recipient: 'asc' },
  });

async function wipe() {
  // The table belongs to this feature alone; scans here also record other suites' leftovers.
  await prisma.scheduleConflictNotice.deleteMany({});
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?', BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?', BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

  await wpUser(DOC, 'kiviCare_doctor', 'Dianda');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  await wpUser(ADMIN_A, 'kiviCare_clinic_admin', 'AdminA');
  await wpUser(ADMIN_B, 'kiviCare_clinic_admin', 'AdminB');
  await clinic(CLINIC_A, ADMIN_A);
  await clinic(CLINIC_B, ADMIN_B);
  await clinic(CLINIC_NO_ADMIN, 0);
  await clinic(CLINIC_OWNED, DOC);
});

beforeEach(async () => {
  await wipe();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?', BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$disconnect();
});

describe('scanScheduleConflicts', () => {
  it('mails the psikolog and the clinic admin once, then stays quiet', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);

    const first = await scanScheduleConflicts();
    expect(first.pairs).toBeGreaterThanOrEqual(1);
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());

    // Leftover pairs of other suites may be mailed first; pick ours.
    const mail = email.sendEmail.mock.calls
      .map(([m]) => m as { to: string; subject: string; text: string; template: string })
      .find((m) => m.to === mailOf(DOC))!;
    expect(mail.subject).toBe('Jadwal bentrok: 1 pasang janji temu tumpang tindih');
    expect(mail.text).toContain(`#${A1} · 09:00–10:00`);
    expect(mail.text).toContain(`#${A2} · 09:30–10:30`);
    expect(mail.template).toBe('schedule_conflict');

    const notices = await ourNotices();
    expect(notices.map((n) => n.recipient)).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
    expect(notices.every((n) => n.fingerprint === `${DATE}|09:00:00-10:00:00|09:30:00-10:30:00`)).toBe(true);

    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
  });

  it('tells the admin of each clinic when the pair spans two', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_B, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A), mailOf(ADMIN_B)].sort());
  });

  it('still tells the psikolog when the clinic has no admin', async () => {
    await appt(A1, CLINIC_NO_ADMIN, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_NO_ADMIN, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC)]);
  });

  it('sends one email to an owner who is both admin and psikolog', async () => {
    await appt(A1, CLINIC_OWNED, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_OWNED, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC)]);
  });

  it('tells everyone again when the clash moves but still overlaps', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();

    await update("appointment_start_time = '09:45:00', appointment_end_time = '10:45:00' WHERE id = ?", A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();

    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
    const notices = await ourNotices();
    expect(notices.every((n) => n.fingerprint === `${DATE}|09:00:00-10:00:00|09:45:00-10:45:00`)).toBe(true);
  });

  it('does not mail again for a status change alone', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);
    await scanScheduleConflicts();

    await update('status = ? WHERE id = ?', BOOKED, A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
  });

  it('forgets a resolved clash and reports it again if it comes back', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);
    await scanScheduleConflicts();

    await update('status = ? WHERE id = ?', CANCELLED, A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
    expect(await ourNotices()).toEqual([]);

    await update('status = ? WHERE id = ?', PENDING, A2);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
  });

  it('retries only the recipient whose email failed', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);
    email.sendEmail.mockImplementation(async (m: { to: string }) =>
      m.to === mailOf(ADMIN_A) ? { ok: false, error: 'smtp down' } : { ok: true },
    );

    const first = await scanScheduleConflicts();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect((await ourNotices()).map((n) => n.recipient)).toEqual([mailOf(DOC)]);

    email.sendEmail.mockReset();
    email.sendEmail.mockResolvedValue({ ok: true });
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(ADMIN_A)]);
  });

  it('ignores a clash whose overlap is already over, but not one still running', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);

    // 11:00 WIB: the overlap ended at 10:00 WIB (03:00 UTC).
    await scanScheduleConflicts(new Date(`${DATE}T04:00:00Z`));
    expect(sentTo()).toEqual([]);
    expect(await ourNotices()).toEqual([]);

    // 09:40 WIB: both sessions are running.
    await scanScheduleConflicts(new Date(`${DATE}T02:40:00Z`));
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
  });
});
