/**
 * Contract tests for the WordPress doctor read repository.
 *
 * A doctor (what our shadow schema called a "professional") is a `wp_users` row
 * carrying the `kiviCare_doctor` capability. Reference: KCDoctor.php:139-151 and
 * DoctorController.php:1079-1106.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { strArray } from '@/repositories/wp/wp-user';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  PROFESSIONAL_STATUS,
  PROFESSIONAL_TYPE,
  findDoctorById,
  findDoctorByRegistrationNumber,
  listDoctors,
} from '@/repositories/wp/doctors.repo';
import { KIVICARE_ROLES } from '@/repositories/wp/wp-user';

/** Test-owned range. Cleanup is bounded by END — see the note in wp-patients.repo.test.ts. */
const BASE = 8_500_000;
const END = BASE + 100_000;

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedWpUser(opts: {
  id: number;
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  basicData?: Record<string, unknown>;
  extraMeta?: Record<string, string>;
}) {
  assertTestDb();
  await prisma.kcUser.create({
    data: {
      id: BigInt(opts.id),
      userLogin: `u${opts.id}`,
      userEmail: opts.email,
      displayName: `${opts.firstName} ${opts.lastName}`,
      userRegistered: new Date('2026-02-01T00:00:00Z'),
    },
  });

  const meta: Array<{ metaKey: string; metaValue: string }> = [
    { metaKey: 'wp_capabilities', metaValue: capabilities(opts.role) },
    { metaKey: 'first_name', metaValue: opts.firstName },
    { metaKey: 'last_name', metaValue: opts.lastName },
  ];
  if (opts.basicData) {
    meta.push({ metaKey: 'basic_data', metaValue: JSON.stringify(opts.basicData) });
  }
  for (const [metaKey, metaValue] of Object.entries(opts.extraMeta ?? {})) {
    meta.push({ metaKey, metaValue });
  }

  await prisma.kcUserMeta.createMany({
    data: meta.map((m) => ({ userId: BigInt(opts.id), ...m })),
  });
}

describe('wp doctors repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

    await seedWpUser({
      id: BASE + 1,
      role: KIVICARE_ROLES.doctor,
      email: 'dr.ayu@test.local',
      firstName: 'Ayu',
      lastName: 'Pratiwi',
      basicData: {
        mobile_number: '+628111222333',
        gender: 'female',
        dob: '1985-09-12',
        address: 'Jl. Sudirman 10',
        city: 'Jakarta',
        country: 'Indonesia',
        postal_code: '10220',
        qualifications: ['S.Psi', 'M.Psi'],
        no_of_experience: '12',
        specialties: ['Psikolog Klinis'],
        temp_password: 'super-secret-plaintext',
      },
      extraMeta: {
        doctor_description: 'Fokus pada terapi kognitif.',
        timezone: 'Asia/Jakarta',
      },
    });

    // A patient — must never appear in doctor listings.
    await seedWpUser({
      id: BASE + 2,
      role: KIVICARE_ROLES.patient,
      email: 'pasien@test.local',
      firstName: 'Pasien',
      lastName: 'Biasa',
    });

    // A doctor whose array fields are empty strings, as KiviCare writes when unset.
    await seedWpUser({
      id: BASE + 3,
      role: KIVICARE_ROLES.doctor,
      email: 'dr.kosong@test.local',
      firstName: 'Kosong',
      lastName: 'Dokter',
      basicData: { qualifications: '', specialties: '', no_of_experience: '' },
    });
  });

  afterAll(async () => {
    await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
    await prisma.$disconnect();
  });

  it('reads a doctor from wp_users + wp_usermeta', async () => {
    const doctor = await findDoctorById(BigInt(BASE + 1));

    expect(doctor).not.toBeNull();
    expect(doctor!.id).toBe(BigInt(BASE + 1));
    expect(doctor!.firstName).toBe('Ayu');
    expect(doctor!.lastName).toBe('Pratiwi');
    expect(doctor!.email).toBe('dr.ayu@test.local');
    expect(doctor!.description).toBe('Fokus pada terapi kognitif.');
    expect(doctor!.timezone).toBe('Asia/Jakarta');
  });

  it('decodes the doctor-specific basic_data fields', async () => {
    const doctor = await findDoctorById(BigInt(BASE + 1));

    expect(doctor!.mobileNumber).toBe('+628111222333');
    expect(doctor!.qualifications).toEqual(['S.Psi', 'M.Psi']);
    expect(doctor!.specialties).toEqual(['Psikolog Klinis']);
    expect(doctor!.yearsOfExperience).toBe('12');
  });

  it('never exposes temp_password from basic_data', async () => {
    const doctor = await findDoctorById(BigInt(BASE + 1));

    // KiviCare stores a plaintext welcome-email password in basic_data
    // (KCDoctor.php:150). It must not escape the repository.
    // BigInt ids need a replacer — JSON.stringify throws on them.
    const serialised = JSON.stringify(doctor, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialised).not.toContain('super-secret-plaintext');
    expect(Object.keys(doctor!)).not.toContain('tempPassword');
  });

  it('coerces empty-string array fields to empty arrays', async () => {
    const doctor = await findDoctorById(BigInt(BASE + 3));

    expect(doctor!.qualifications).toEqual([]);
    expect(doctor!.specialties).toEqual([]);
    expect(doctor!.yearsOfExperience).toBeNull();
  });

  it('does not return a user who lacks the doctor capability', async () => {
    expect(await findDoctorById(BigInt(BASE + 2))).toBeNull();
  });

  it('lists only users carrying the kiviCare_doctor capability', async () => {
    const { items } = await listDoctors({ page: 1, perPage: 50 });
    const ids = items.map((d) => Number(d.id));

    expect(ids).toContain(BASE + 1);
    expect(ids).toContain(BASE + 3);
    expect(ids).not.toContain(BASE + 2); // the patient
  });

  it('searches across name and email', async () => {
    const byName = await listDoctors({ page: 1, perPage: 50, search: 'Pratiwi' });
    expect(byName.items.map((d) => Number(d.id))).toEqual([BASE + 1]);
  });

  describe('PraktiQU professional fields (wp_usermeta, not KiviCare columns)', () => {
    const CLINIC_A = BigInt(BASE + 600);

    beforeAll(async () => {
      await prisma.kcUserMeta.createMany({
        data: [
          { userId: BigInt(BASE + 1), metaKey: 'praktiqu_professional_type', metaValue: PROFESSIONAL_TYPE.PSIKOLOG_KLINIS },
          { userId: BigInt(BASE + 1), metaKey: 'praktiqu_registration_number', metaValue: 'REG-0001' },
          { userId: BigInt(BASE + 1), metaKey: 'praktiqu_professional_status', metaValue: PROFESSIONAL_STATUS.INACTIVE },
        ],
      });
      await prisma.$executeRawUnsafe(
        `DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`,
        BASE, END,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
        BASE + 1, CLINIC_A,
      );
    });

    it('reads type, registration number and status', async () => {
      const doctor = await findDoctorById(BigInt(BASE + 1));

      expect(doctor!.professionalType).toBe(PROFESSIONAL_TYPE.PSIKOLOG_KLINIS);
      expect(doctor!.registrationNumber).toBe('REG-0001');
      expect(doctor!.status).toBe(PROFESSIONAL_STATUS.INACTIVE);
    });

    it('treats a doctor with no status meta as ACTIVE', async () => {
      // BASE+3 was created in the outer fixture with no praktiqu_* meta at all —
      // exactly like a doctor created through KiviCare's own UI.
      const doctor = await findDoctorById(BigInt(BASE + 3));

      expect(doctor!.status).toBe(PROFESSIONAL_STATUS.ACTIVE);
      expect(doctor!.professionalType).toBeNull();
      expect(doctor!.registrationNumber).toBeNull();
    });

    it('finds a doctor by registration number', async () => {
      const doctor = await findDoctorByRegistrationNumber('REG-0001');
      expect(Number(doctor!.id)).toBe(BASE + 1);
    });

    it('returns null for an unknown registration number', async () => {
      expect(await findDoctorByRegistrationNumber('REG-NOPE')).toBeNull();
    });

    it('filters by status, and ACTIVE also matches doctors with no meta', async () => {
      const inactive = await listDoctors({ page: 1, perPage: 50, statuses: [PROFESSIONAL_STATUS.INACTIVE] });
      expect(inactive.items.map((d) => Number(d.id))).toContain(BASE + 1);
      expect(inactive.items.map((d) => Number(d.id))).not.toContain(BASE + 3);

      const active = await listDoctors({ page: 1, perPage: 50, statuses: [PROFESSIONAL_STATUS.ACTIVE] });
      expect(active.items.map((d) => Number(d.id))).toContain(BASE + 3);
      expect(active.items.map((d) => Number(d.id))).not.toContain(BASE + 1);
    });

    it('filters by professional type', async () => {
      const { items } = await listDoctors({
        page: 1, perPage: 50, professionalTypes: [PROFESSIONAL_TYPE.PSIKOLOG_KLINIS],
      });
      expect(items.map((d) => Number(d.id))).toEqual([BASE + 1]);
    });

    it('scopes by clinic', async () => {
      const { items } = await listDoctors({ page: 1, perPage: 50, clinicIds: [CLINIC_A] });
      const ids = items.map((d) => Number(d.id));

      expect(ids).toContain(BASE + 1);
      expect(ids).not.toContain(BASE + 3);
    });

    it('returns nothing — not everything — when scoped to no clinics', async () => {
      const { items, total } = await listDoctors({ page: 1, perPage: 50, clinicIds: [] });

      expect(items).toEqual([]);
      expect(total).toBe(0);
    });
  });
});

/**
 * Regression for what real staging data exposed and an empty local database could not:
 * `specialties` and `qualifications` inside `basic_data` are arrays of OBJECTS, not
 * strings. Stringifying them put "[object Object]" in the public professional directory.
 */
describe('basic_data list fields carry objects, not strings', () => {
  it('reads the label out of a specialty entry', () => {
    // Exactly the shape staging holds: [{"id":"27","label":"Psikolog"}]
    expect(strArray([{ id: '27', label: 'Psikolog' }])).toEqual(['Psikolog']);
  });

  it('reads the degree out of a qualification entry', () => {
    expect(
      strArray([{ degree: 'S2 Profesi Psikolog', university: 'Universitas Padjadjaran', year: '2006' }]),
    ).toEqual(['S2 Profesi Psikolog']);
  });

  it('still accepts plain strings, which older KiviCare versions wrote', () => {
    expect(strArray(['Psikolog', 'Konselor'])).toEqual(['Psikolog', 'Konselor']);
  });

  it('drops an entry with no recognisable label instead of emitting [object Object]', () => {
    expect(strArray([{ file: '' }, { id: '9' }])).toEqual([]);
  });

  it('returns an empty list for the empty string KiviCare writes when unset', () => {
    expect(strArray('')).toEqual([]);
  });
});
