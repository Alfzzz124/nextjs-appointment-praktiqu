/**
 * Contract tests for the WordPress patient read repository.
 *
 * These assert we read patients the way KiviCare does — a patient IS a `wp_users`
 * row carrying the `kiviCare_patient` capability, with its profile spread across
 * `wp_usermeta`. Reference: PatientController.php:1083-1160 and KCPatient.php:128-145.
 *
 * There is deliberately no `clients` table here. See
 * docs/architecture/shadow-tables-audit.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  findPatientById,
  listPatients,
  PATIENT_ROLE,
} from '@/repositories/wp/patients.repo';

/** Test-owned ID range, matching the convention in tests/billing/fixtures.ts. */
const BASE = 9_400_000;

/** Serialised PHP array as WordPress writes it into wp_capabilities. */
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
  uniqueId?: string;
}) {
  assertTestDb();
  await prisma.kcUser.create({
    data: {
      id: BigInt(opts.id),
      userLogin: `u${opts.id}`,
      userEmail: opts.email,
      displayName: `${opts.firstName} ${opts.lastName}`,
      userRegistered: new Date('2026-01-15T00:00:00Z'),
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
  if (opts.uniqueId) {
    meta.push({ metaKey: 'patient_unique_id', metaValue: opts.uniqueId });
  }

  await prisma.kcUserMeta.createMany({
    data: meta.map((m) => ({ userId: BigInt(opts.id), ...m })),
  });
}

describe('wp patients repository', () => {
  beforeAll(async () => {
    assertTestDb();
    await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE) } } });
    await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE) } } });

    await seedWpUser({
      id: BASE + 1,
      role: PATIENT_ROLE,
      email: 'siti@test.local',
      firstName: 'Siti',
      lastName: 'Rahayu',
      uniqueId: 'PAT-0001',
      basicData: {
        mobile_number: '+628123456789',
        gender: 'female',
        dob: '1990-04-02',
        address: 'Jl. Merdeka 1',
        city: 'Bandung',
        country: 'Indonesia',
        postal_code: '40111',
        blood_group: 'O+',
      },
    });

    // A doctor — must never appear in patient listings.
    await seedWpUser({
      id: BASE + 2,
      role: 'kiviCare_doctor',
      email: 'dr.budi@test.local',
      firstName: 'Budi',
      lastName: 'Santoso',
    });

    // A patient with no basic_data at all — WordPress permits this.
    await seedWpUser({
      id: BASE + 3,
      role: PATIENT_ROLE,
      email: 'kosong@test.local',
      firstName: 'Kosong',
      lastName: 'Data',
    });
  });

  afterAll(async () => {
    await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE) } } });
    await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE) } } });
    await prisma.$disconnect();
  });

  it('reads a patient from wp_users + wp_usermeta', async () => {
    const patient = await findPatientById(BigInt(BASE + 1));

    expect(patient).not.toBeNull();
    expect(patient!.id).toBe(BigInt(BASE + 1));
    expect(patient!.firstName).toBe('Siti');
    expect(patient!.lastName).toBe('Rahayu');
    expect(patient!.email).toBe('siti@test.local');
    expect(patient!.patientUniqueId).toBe('PAT-0001');
  });

  it('decodes the basic_data JSON blob into typed fields', async () => {
    const patient = await findPatientById(BigInt(BASE + 1));

    expect(patient!.mobileNumber).toBe('+628123456789');
    expect(patient!.gender).toBe('female');
    expect(patient!.dateOfBirth).toBe('1990-04-02');
    expect(patient!.address).toBe('Jl. Merdeka 1');
    expect(patient!.city).toBe('Bandung');
    expect(patient!.country).toBe('Indonesia');
    expect(patient!.postalCode).toBe('40111');
    expect(patient!.bloodGroup).toBe('O+');
  });

  it('returns nulls rather than throwing when basic_data is absent', async () => {
    const patient = await findPatientById(BigInt(BASE + 3));

    expect(patient).not.toBeNull();
    expect(patient!.firstName).toBe('Kosong');
    expect(patient!.mobileNumber).toBeNull();
    expect(patient!.dateOfBirth).toBeNull();
    expect(patient!.bloodGroup).toBeNull();
  });

  it('does not return a user who lacks the patient capability', async () => {
    expect(await findPatientById(BigInt(BASE + 2))).toBeNull();
  });

  it('lists only users carrying the kiviCare_patient capability', async () => {
    const { items } = await listPatients({ page: 1, perPage: 50 });
    const ids = items.map((p) => Number(p.id));

    expect(ids).toContain(BASE + 1);
    expect(ids).toContain(BASE + 3);
    expect(ids).not.toContain(BASE + 2); // the doctor
  });

  it('searches across name and email', async () => {
    const byName = await listPatients({ page: 1, perPage: 50, search: 'Rahayu' });
    expect(byName.items.map((p) => Number(p.id))).toEqual([BASE + 1]);

    const byEmail = await listPatients({ page: 1, perPage: 50, search: 'kosong@' });
    expect(byEmail.items.map((p) => Number(p.id))).toEqual([BASE + 3]);
  });

  it('reports a total count independent of the current page', async () => {
    const firstPage = await listPatients({ page: 1, perPage: 1, search: '@test.local' });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBeGreaterThanOrEqual(2);
  });
});
