/**
 * The public directory and personal-link lookup say whether a professional approves their
 * own bookings, so the booking page can tell the client before they pay (spec §7.5).
 * Against the test database: the switch lives in an app table, the professional in wp_*.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { getPublicProfessional, listPublicProfessionals } from '@/services/public/public-catalog.service';
import { setApprovalSetting } from '@/services/approval/settings';

const BASE = 8_860_000;
const END = BASE + 10_000;
const CLINIC = BASE + 1;
const DOCTOR = BASE + 20;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function wipe() {
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Uji', 'klinik@public-approval.test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    CLINIC,
  );
  await prisma.kcUser.create({
    data: {
      id: BigInt(DOCTOR),
      userLogin: `u${DOCTOR}`,
      userEmail: `u${DOCTOR}@public-approval.test.local`,
      displayName: 'Dianda Uji',
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(DOCTOR), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') },
      { userId: BigInt(DOCTOR), metaKey: 'first_name', metaValue: 'Dianda' },
      { userId: BigInt(DOCTOR), metaKey: 'last_name', metaValue: 'Uji' },
      { userId: BigInt(DOCTOR), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
    BASE + 900,
    DOCTOR,
    CLINIC,
  );
});

afterAll(async () => {
  await wipe();
});

describe('requiresApproval on the public professional', () => {
  it('is false until the switch is turned on, then true — single lookup and directory', async () => {
    expect((await getPublicProfessional(DOCTOR))?.requiresApproval).toBe(false);

    await setApprovalSetting(DOCTOR, true, 'public-approval-test');

    expect((await getPublicProfessional(DOCTOR))?.requiresApproval).toBe(true);
    const listed = (await listPublicProfessionals({ clinicId: CLINIC })).find((p) => p.id === DOCTOR);
    expect(listed?.requiresApproval).toBe(true);
  });
});
