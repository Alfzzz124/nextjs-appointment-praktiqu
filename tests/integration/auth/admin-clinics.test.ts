/**
 * Which clinics a CLINIC_ADMIN may act in, and which one is their default.
 *
 * The source of truth is wp_kc_clinics.clinic_admin_id (KiviCare's own definition of
 * "admin of clinic X"). Doctor mappings are only a fallback for an admin who owns no
 * clinic at all, so accounts scoped that way before keep their access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { listAdminClinicIds, listAdminClinics, resolveClinicId } from '@/services/billing/kc-actor';

const BASE = 8_650_000;
const END = BASE + 10_000;

const OWNER = BASE + 500; // owns three clinics, and is also mapped as a doctor elsewhere
const MAPPED_ONLY = BASE + 501; // owns none, has two doctor mappings
const NOBODY = BASE + 502; // owns none, no mappings
const RECEPTIONIST = BASE + 503;
const DOCTOR = BASE + 504;
const SOMEONE_ELSE = BASE + 900;

const ACTIVE_LOW = BASE + 1;
const INACTIVE = BASE + 2;
const ACTIVE_HIGH = BASE + 3;
const MAPPED_1 = BASE + 4;
const MAPPED_2 = BASE + 5;

async function clinic(id: number, adminId: number, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', ?, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    status,
    adminId,
  );
}

async function doctorMapping(id: number, doctorId: number, clinicId: number) {
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(id), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcReceptionistClinicMapping.deleteMany({
    where: { receptionistId: { gte: BigInt(BASE), lt: BigInt(END) } },
  });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  // Inserted out of id order on purpose: the result must not depend on insertion order.
  await clinic(ACTIVE_HIGH, OWNER, 1);
  await clinic(INACTIVE, OWNER, 0);
  await clinic(ACTIVE_LOW, OWNER, 1);
  await clinic(MAPPED_1, SOMEONE_ELSE, 1);
  await clinic(MAPPED_2, SOMEONE_ELSE, 1);
  // MAPPED_ONLY's mapping ids put MAPPED_2 first.
  await doctorMapping(BASE + 10, MAPPED_ONLY, MAPPED_2);
  await doctorMapping(BASE + 11, MAPPED_ONLY, MAPPED_1);
  // OWNER is also mapped as a doctor at MAPPED_1. Ownership must win; the old resolver
  // read the doctor mapping first and so gave OWNER clinic MAPPED_1.
  await doctorMapping(BASE + 12, OWNER, MAPPED_1);
  await doctorMapping(BASE + 13, DOCTOR, MAPPED_2);
  await doctorMapping(BASE + 14, DOCTOR, MAPPED_1);
  await prisma.kcReceptionistClinicMapping.create({
    data: { id: BigInt(BASE + 20), receptionistId: BigInt(RECEPTIONIST), clinicId: BigInt(MAPPED_1), createdAt: new Date() },
  });
});

afterAll(async () => {
  await wipe();
});

describe('listAdminClinicIds', () => {
  it('lists owned clinics, active ones first, each group by id', async () => {
    expect(await listAdminClinicIds(BigInt(OWNER))).toEqual([
      BigInt(ACTIVE_LOW),
      BigInt(ACTIVE_HIGH),
      BigInt(INACTIVE),
    ]);
  });

  it('ignores doctor mappings when the admin owns a clinic', async () => {
    expect(await listAdminClinicIds(BigInt(OWNER))).not.toContain(BigInt(MAPPED_1));
  });

  it('falls back to doctor mappings, in mapping order, when the admin owns nothing', async () => {
    expect(await listAdminClinicIds(BigInt(MAPPED_ONLY))).toEqual([BigInt(MAPPED_2), BigInt(MAPPED_1)]);
  });

  it('is empty for an admin with neither', async () => {
    expect(await listAdminClinicIds(BigInt(NOBODY))).toEqual([]);
  });
});

describe('listAdminClinics', () => {
  it('has the same order as listAdminClinicIds, with names and the active flag', async () => {
    expect(await listAdminClinics(BigInt(OWNER))).toEqual([
      { id: ACTIVE_LOW, name: `Klinik ${ACTIVE_LOW}`, active: true },
      { id: ACTIVE_HIGH, name: `Klinik ${ACTIVE_HIGH}`, active: true },
      { id: INACTIVE, name: `Klinik ${INACTIVE}`, active: false },
    ]);
  });

  it('names the fallback clinics too', async () => {
    expect(await listAdminClinics(BigInt(MAPPED_ONLY))).toEqual([
      { id: MAPPED_2, name: `Klinik ${MAPPED_2}`, active: true },
      { id: MAPPED_1, name: `Klinik ${MAPPED_1}`, active: true },
    ]);
  });
});

describe('resolveClinicId', () => {
  it('gives a clinic admin the first of their clinics', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(OWNER))).toBe(BigInt(ACTIVE_LOW));
  });

  it('gives a mapped-only clinic admin their first mapping', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(MAPPED_ONLY))).toBe(BigInt(MAPPED_2));
  });

  it('gives null to a clinic admin with nothing', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(NOBODY))).toBeNull();
  });

  it('keeps a professional on their first mapping by mapping id', async () => {
    expect(await resolveClinicId('PROFESSIONAL', BigInt(DOCTOR))).toBe(BigInt(MAPPED_2));
  });

  it('keeps a receptionist on their mapping', async () => {
    expect(await resolveClinicId('RECEPTIONIST', BigInt(RECEPTIONIST))).toBe(BigInt(MAPPED_1));
  });

  it('gives SUPER_ADMIN and CLIENT nothing', async () => {
    expect(await resolveClinicId('SUPER_ADMIN', BigInt(OWNER))).toBeNull();
    expect(await resolveClinicId('CLIENT', BigInt(OWNER))).toBeNull();
  });
});
