/**
 * listPracticeClinics: the active clinics a psychologist is mapped to — the one source for
 * where they may add a service and for the FE's clinic picker. Runs on the test DB because
 * a mock cannot see the real wp_kc_* schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { listPracticeClinics } from '@/services/billing/kc-actor';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const { BASE, END } = idBlock('integration/services/practice-clinics.test.ts');
const ACTIVE_A = BASE + 1;
const ACTIVE_B = BASE + 2;
const RETIRED = BASE + 3;
const DOC = BASE + 500;
const LONER = BASE + 501; // mapped nowhere

async function wipe() {
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, status, name] of [
    [ACTIVE_A, 1, 'Klinik A'],
    [ACTIVE_B, 1, '  '],
    [RETIRED, 0, 'Klinik Lama'],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', ?, 0, 0, NOW())`,
      id, name, `c${id}@test.local`, status,
    );
  }
  // Out of id order, and ACTIVE_B twice: the answer must still be ascending and unique.
  let m = BASE + 900;
  for (const clinicId of [ACTIVE_B, RETIRED, ACTIVE_A, ACTIVE_B]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({
      data: { id: BigInt(m), doctorId: BigInt(DOC), clinicId: BigInt(clinicId), createdAt: new Date() },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('listPracticeClinics', () => {
  it('lists active clinics only, ascending by id, each once, with a fallback name', async () => {
    expect(await listPracticeClinics(BigInt(DOC))).toEqual([
      { id: ACTIVE_A, name: 'Klinik A' },
      { id: ACTIVE_B, name: `Klinik #${ACTIVE_B}` },
    ]);
  });

  it('answers [] for a psychologist with no mapping', async () => {
    expect(await listPracticeClinics(BigInt(LONER))).toEqual([]);
  });
});
