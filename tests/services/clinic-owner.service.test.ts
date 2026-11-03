/**
 * Who counts as a clinic's owner ("pemilik klinik"): an ACTIVE psychologist mapped to the
 * clinic who is either ticked in clinic_owners or the clinic's only active psychologist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  NotAClinicProfessionalError,
  isClinicOwner,
  listClinicOwnerRoster,
  listOwnedClinics,
  setClinicOwners,
} from '@/services/clinic-owner/service';
import { idBlock } from '../helpers/id-blocks';

const { BASE, END } = idBlock('services/clinic-owner.service.test.ts');
const SOLO = BASE + 1; // one active doctor: DOC_A
const SHARED = BASE + 2; // DOC_A + DOC_B, DOC_B ticked
const WITH_INACTIVE = BASE + 3; // DOC_A active + DOC_OFF inactive → solo for DOC_A
const UNTICKED = BASE + 4; // DOC_A + DOC_B, nobody ticked
const DOC_A = BASE + 500;
const DOC_B = BASE + 501;
const DOC_OFF = BASE + 502;
const PATIENT = BASE + 503; // not a doctor at all

function caps(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function wpUser(id: number, name: string, role: string, status?: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `own${id}`, userEmail: `own${id}@test.local`, displayName: name, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) } });
  if (status !== undefined) {
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: status } });
  }
}

async function clinic(id: number, name: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    id, name, `c${id}@test.local`,
  );
}

let mapId = BASE + 9000;
async function map(doctorId: number, clinicId: number) {
  mapId += 1;
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(mapId), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() },
  });
}

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(DOC_A, 'Dr A', 'kiviCare_doctor'); // no status meta → ACTIVE
  await wpUser(DOC_B, 'Dr B', 'kiviCare_doctor', 'ACTIVE');
  await wpUser(DOC_OFF, 'Dr Off', 'kiviCare_doctor', 'INACTIVE');
  await wpUser(PATIENT, 'Pasien', 'kiviCare_patient');
  await clinic(SOLO, 'Klinik Solo');
  await clinic(SHARED, 'Klinik Bersama');
  await clinic(WITH_INACTIVE, 'Klinik Satu Aktif');
  await clinic(UNTICKED, 'Klinik Tanpa Pemilik');
  await map(DOC_A, SOLO);
  await map(DOC_A, SHARED);
  await map(DOC_B, SHARED);
  await map(DOC_A, WITH_INACTIVE);
  await map(DOC_OFF, WITH_INACTIVE);
  await map(DOC_A, UNTICKED);
  await map(DOC_B, UNTICKED);
  await prisma.clinicOwner.create({ data: { clinicId: BigInt(SHARED), doctorWpUserId: BigInt(DOC_B), createdBy: 'test' } });
});

afterAll(async () => {
  await wipe();
});

describe('listOwnedClinics', () => {
  it('gives a sole active psychologist their clinic as solo, an inactive colleague not counting', async () => {
    expect(await listOwnedClinics(BigInt(DOC_A))).toEqual([
      { id: SOLO, name: 'Klinik Solo', source: 'solo' },
      { id: WITH_INACTIVE, name: 'Klinik Satu Aktif', source: 'solo' },
    ]);
  });

  it('gives a ticked psychologist of a shared clinic that clinic as manual', async () => {
    expect(await listOwnedClinics(BigInt(DOC_B))).toEqual([
      { id: SHARED, name: 'Klinik Bersama', source: 'manual' },
    ]);
  });

  it('gives an inactive psychologist nothing, even at a clinic they are mapped to', async () => {
    expect(await listOwnedClinics(BigInt(DOC_OFF))).toEqual([]);
  });

  it('ignores a clinic_owners row whose psychologist is no longer mapped there', async () => {
    await prisma.clinicOwner.create({ data: { clinicId: BigInt(SOLO), doctorWpUserId: BigInt(DOC_B), createdBy: 'test' } });
    try {
      expect((await listOwnedClinics(BigInt(DOC_B))).map((c) => c.id)).toEqual([SHARED]);
    } finally {
      await prisma.clinicOwner.deleteMany({ where: { clinicId: BigInt(SOLO), doctorWpUserId: BigInt(DOC_B) } });
    }
  });
});

describe('isClinicOwner', () => {
  it('is true for solo and ticked, false for an unticked shared clinic and for a non-doctor', async () => {
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(SOLO))).toBe(true);
    expect(await isClinicOwner(BigInt(DOC_B), BigInt(SHARED))).toBe(true);
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(SHARED))).toBe(false);
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(UNTICKED))).toBe(false);
    expect(await isClinicOwner(BigInt(PATIENT), BigInt(SOLO))).toBe(false);
  });
});

describe('listClinicOwnerRoster', () => {
  it('lists active psychologists with owner flag and source', async () => {
    expect(await listClinicOwnerRoster(BigInt(SHARED))).toEqual([
      { doctorId: DOC_A, name: 'Dr A', owner: false, source: null },
      { doctorId: DOC_B, name: 'Dr B', owner: true, source: 'manual' },
    ]);
    expect(await listClinicOwnerRoster(BigInt(WITH_INACTIVE))).toEqual([
      { doctorId: DOC_A, name: 'Dr A', owner: true, source: 'solo' },
    ]);
  });
});

describe('setClinicOwners', () => {
  it('replaces the manual set: grants the new, revokes the dropped', async () => {
    const roster = await setClinicOwners(BigInt(UNTICKED), [DOC_A], 'actor-x');
    expect(roster.find((r) => r.doctorId === DOC_A)).toEqual({ doctorId: DOC_A, name: 'Dr A', owner: true, source: 'manual' });
    const row = await prisma.clinicOwner.findUnique({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(UNTICKED), doctorWpUserId: BigInt(DOC_A) } },
    });
    expect(row?.createdBy).toBe('actor-x');

    await setClinicOwners(BigInt(UNTICKED), [DOC_B], 'actor-x');
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(UNTICKED))).toBe(false);
    expect(await isClinicOwner(BigInt(DOC_B), BigInt(UNTICKED))).toBe(true);

    await setClinicOwners(BigInt(UNTICKED), [], 'actor-x');
    expect(await prisma.clinicOwner.count({ where: { clinicId: BigInt(UNTICKED) } })).toBe(0);
  });

  it('refuses someone who is not an active psychologist of the clinic, writing nothing', async () => {
    await expect(setClinicOwners(BigInt(UNTICKED), [DOC_A, DOC_OFF, PATIENT], 'actor-x')).rejects.toMatchObject({
      name: 'NotAClinicProfessionalError',
      doctorIds: [DOC_OFF, PATIENT],
    });
    expect(await prisma.clinicOwner.count({ where: { clinicId: BigInt(UNTICKED) } })).toBe(0);
  });

  it('exports the error class', () => {
    expect(new NotAClinicProfessionalError([1])).toBeInstanceOf(Error);
  });
});
