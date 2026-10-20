/**
 * Clinic writes for CRUD klinik, against the test database: insertClinic, setClinicAdmin,
 * listClinicNames, findClinicIdByEmail, countClinicReferences, deleteClinicRow, plus
 * wpUserEmailExists.
 *
 * insertClinic takes an AUTO_INCREMENT id, so those rows are found and removed by the name
 * prefix PREFIX rather than by the id range. The tests of one file run in order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  CLINIC_REFERENCE_TABLES,
  countClinicReferences,
  deleteClinicRow,
  findClinicIdByEmail,
  insertClinic,
  listClinicNames,
  setClinicAdmin,
} from '@/repositories/wp/clinics.repo';
import { wpUserEmailExists } from '@/repositories/wp/clinic-admins.repo';
import { clinicPaymentOptionName } from '@/repositories/wp/clinic-payment-settings.repo';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/practice/clinics-repo-write.test.ts');
const FIXED = BASE + 1; // inserted with an explicit id, for the reference counts
const WP_USER = BASE + 500;
const DOCTOR = BASE + 600;
const PREFIX = 'Klinik Uji Repo 8850';
const DOMAIN = 'crud-repo.test.local';

async function wipe() {
  const named = await prisma.kcClinic.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const id of [...named.map((c) => c.id), BigInt(FIXED)]) {
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM wp_options WHERE option_name = ?`, clinicPaymentOptionName(Number(id)));
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = ?`, DOCTOR);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE (id >= ? AND id < ?) OR name LIKE ?`, BASE, END, `${PREFIX}%`);
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
});

afterAll(async () => {
  await wipe();
});

describe('insertClinic and friends', () => {
  let id: bigint;

  it('inserts a row KiviCare can read and returns its id', async () => {
    id = await insertClinic({
      name: `${PREFIX} A`,
      email: `a@${DOMAIN}`,
      telephone: '0221234567',
      address: 'Jl. Uji 1',
      city: 'Bandung',
      state: 'Jawa Barat',
      country: 'Indonesia',
      postalCode: '40111',
      countryCode: 'ID',
      countryCallingCode: '+62',
      status: 1,
      clinicAdminId: 0n,
    });
    expect(id > 0n).toBe(true);

    const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_clinics WHERE id = ?`, id);
    expect(row).toMatchObject({
      name: `${PREFIX} A`,
      email: `a@${DOMAIN}`,
      telephone_no: '0221234567',
      address: 'Jl. Uji 1',
      city: 'Bandung',
      state: 'Jawa Barat',
      country: 'Indonesia',
      postal_code: '40111',
      country_code: 'ID',
      country_calling_code: '+62',
      status: 1,
      specialties: '[]',
      profile_image: null,
      extra: null,
    });
    expect(Number(row.clinic_admin_id)).toBe(0);
    expect(Number(row.clinic_logo)).toBe(0);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('setClinicAdmin points the clinic at an admin', async () => {
    await setClinicAdmin(id, BigInt(WP_USER));
    const row = await prisma.kcClinic.findUnique({ where: { id }, select: { clinicAdminId: true } });
    expect(Number(row!.clinicAdminId)).toBe(WP_USER);
  });

  it('listClinicNames includes inactive clinics', async () => {
    await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinics SET status = 0 WHERE id = ?`, id);
    expect(await listClinicNames()).toContainEqual({ id: Number(id), name: `${PREFIX} A` });
  });

  it('findClinicIdByEmail ignores case and spaces, and can skip one clinic', async () => {
    expect(await findClinicIdByEmail(`  A@${DOMAIN.toUpperCase()} `)).toBe(Number(id));
    expect(await findClinicIdByEmail(`a@${DOMAIN}`, Number(id))).toBeNull();
    expect(await findClinicIdByEmail(`tidak-ada@${DOMAIN}`)).toBeNull();
  });
});

describe('countClinicReferences and deleteClinicRow', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, 1, 0, 0, NOW())`,
      FIXED,
      `${PREFIX} Tetap`,
    );
  });

  it('answers every key, all zero, for a new clinic', async () => {
    const counts = await countClinicReferences(BigInt(FIXED));
    expect(Object.keys(counts).sort()).toEqual(Object.keys(CLINIC_REFERENCE_TABLES).sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('counts a psychologist mapping', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, owner, created_at) VALUES (?, ?, 0, NOW())`,
      DOCTOR,
      FIXED,
    );
    expect((await countClinicReferences(BigInt(FIXED))).doctors).toBe(1);
  });

  it('deleteClinicRow removes the clinic, its holidays and its payment option', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinic_schedule (start_date, end_date, module_type, module_id, description, status, created_at)
       VALUES ('2026-12-25', '2026-12-25', 'clinic', ?, 'Natal', 1, NOW())`,
      FIXED,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, '{}', 'no')`,
      clinicPaymentOptionName(FIXED),
    );

    await deleteClinicRow(BigInt(FIXED));

    expect(await prisma.kcClinic.count({ where: { id: BigInt(FIXED) } })).toBe(0);
    const [holidays] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`,
      FIXED,
    );
    expect(Number(holidays.n)).toBe(0);
    expect(await prisma.kcOption.count({ where: { optionName: clinicPaymentOptionName(FIXED) } })).toBe(0);
  });
});

describe('wpUserEmailExists', () => {
  it('matches a WordPress email in any case', async () => {
    await prisma.kcUser.create({
      data: { id: BigInt(WP_USER), userLogin: `u${WP_USER}`, userEmail: `u${WP_USER}@${DOMAIN}`, displayName: 'U', userRegistered: new Date() },
    });
    expect(await wpUserEmailExists(`U${WP_USER}@${DOMAIN.toUpperCase()}`)).toBe(true);
    expect(await wpUserEmailExists(`tidak-ada@${DOMAIN}`)).toBe(false);
  });
});
