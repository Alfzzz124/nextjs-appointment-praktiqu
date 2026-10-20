/**
 * POST /api/v1/services as a psychologist, end to end on the test DB: the real route, a real
 * JWT, the real scope, own-create and service layer. Nothing is mocked, because the rules
 * under test live in the seams between them — whose id `doctorIds` is pinned to, which
 * clinics count as "practises at", and what the create finally writes to wp_kc_*.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const { POST } = await import('@/app/api/v1/services/route');

const { BASE, END } = idBlock('integration/services/professional-create.test.ts');
const ACTIVE = BASE + 1;
const RETIRED = BASE + 2;
const CATEGORY = BASE + 3;
const D = BASE + 500; // the psychologist posting; mapped to ACTIVE and RETIRED
const OTHER = BASE + 501; // a colleague at ACTIVE
const D_CUID = 'prof-create-test-d';

/** Every service this file creates starts with this, so cleanup can find it by name. */
const NAME_PREFIX = `Uji E2E Psikolog ${BASE}`;

async function linkAuthUser(cuid: string, wpUserId: number, role: string) {
  await prisma.user.create({
    data: {
      id: cuid, email: `${cuid}@test.local`, username: cuid, firstName: 'T', lastName: 'U',
      displayName: 'T U', role: role as never, wpUserId: BigInt(wpUserId), status: 1,
    },
  });
}

async function wipe() {
  // Created by the route, so they carry auto-increment ids outside our range: find them by
  // doctor id and by the unique name instead.
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_service_doctor_mapping
      WHERE (doctor_id >= ? AND doctor_id < ?)
         OR service_id IN (SELECT id FROM wp_kc_services WHERE name LIKE ?)`,
    BASE, END, `${NAME_PREFIX}%`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE name LIKE ?`, `${NAME_PREFIX}%`);
  await prisma.kcStaticData.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.logEntry.deleteMany({ where: { userId: { startsWith: 'prof-create-test-' } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'prof-create-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  for (const [id, status, name] of [
    [ACTIVE, 1, 'Klinik Aktif'],
    [RETIRED, 0, 'Klinik Lama'],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', ?, 0, 0, NOW())`,
      id, name, `c${id}@test.local`, status,
    );
  }

  let m = BASE + 100;
  for (const [doctorId, clinicId] of [[D, ACTIVE], [D, RETIRED], [OTHER, ACTIVE]] as const) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({
      data: { id: BigInt(m), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() },
    });
  }

  await prisma.kcStaticData.create({
    data: {
      id: BigInt(CATEGORY), type: 'service_type', label: 'Layanan Uji', value: `layanan_uji_${BASE}`,
      status: BigInt(1), createdAt: new Date(),
    },
  });

  await linkAuthUser(D_CUID, D, 'PROFESSIONAL');
});

afterAll(async () => {
  await wipe();
});

/** The real handler, called the way Next.js calls it, with a real bearer token for D. */
async function postAsD(body: Record<string, unknown>) {
  const { token } = await issueAccessToken({
    userId: D_CUID, role: 'PROFESSIONAL', email: `${D_CUID}@test.local`, username: D_CUID,
  });
  const res = await POST(
    new NextRequest('http://localhost/api/v1/services', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { res, json: (await res.json()) as Record<string, any> };
}

function validBody(name: string, extra: Record<string, unknown> = {}) {
  return { name, categoryId: CATEGORY, price: 250000, duration: 60, ...extra };
}

/** Every mapping row, at any clinic and for any doctor, whose catalogue row has this name. */
async function mappingsNamed(name: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ doctor_id: bigint | number; clinic_id: bigint | number }>>(
    `SELECT sdm.doctor_id, sdm.clinic_id
       FROM wp_kc_service_doctor_mapping sdm
       JOIN wp_kc_services s ON s.id = sdm.service_id
      WHERE s.name = ?
      ORDER BY sdm.id`,
    name,
  );
  return rows.map((r) => ({ doctorId: Number(r.doctor_id), clinicId: Number(r.clinic_id) }));
}

async function cataloguesNamed(name: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(*) AS n FROM wp_kc_services WHERE name = ?`,
    name,
  );
  return Number(rows[0].n);
}

describe('POST /api/v1/services as a PROFESSIONAL (real route, real DB)', () => {
  it('refuses doctorIds naming a colleague with 403 and writes nothing', async () => {
    const name = `${NAME_PREFIX} a`;

    const { res, json } = await postAsD(validBody(name, { doctorIds: [OTHER] }));

    expect(res.status).toBe(403);
    expect(json.code).toBe('Psychologists can only add services for themselves');
    expect(await mappingsNamed(name)).toEqual([]);
    expect(await cataloguesNamed(name)).toBe(0);
  });

  it('refuses a clinic they only hold a retired mapping to with 403 and writes nothing', async () => {
    const name = `${NAME_PREFIX} b`;

    const { res, json } = await postAsD(validBody(name, { doctorIds: [D], clinicId: RETIRED }));

    expect(res.status).toBe(403);
    expect(json.code).toBe('Not a clinic this professional practises at');
    expect(await mappingsNamed(name)).toEqual([]);
    expect(await cataloguesNamed(name)).toBe(0);
  });

  it('creates one mapping at the single active clinic for doctorIds [D, D] without a clinicId', async () => {
    const name = `${NAME_PREFIX} c`;

    const { res, json } = await postAsD(validBody(name, { doctorIds: [D, D] }));

    expect(res.status).toBe(201);
    expect(json.name).toBe(name);
    expect(json.category).toEqual({ id: CATEGORY, label: 'Layanan Uji', value: `layanan_uji_${BASE}` });
    expect(json.mappings).toHaveLength(1);
    expect(json.mappings[0].doctorId).toBe(D);

    // The retired clinic is not a choice, so there is exactly one row and it is at ACTIVE.
    expect(await mappingsNamed(name)).toEqual([{ doctorId: D, clinicId: ACTIVE }]);
    expect(await cataloguesNamed(name)).toBe(1);
  });
});
