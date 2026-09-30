/**
 * GET /api/v1/professionals/{id} carries `clinicIds`.
 *
 * POST /professionals answers only `{ id }`, and the detail had no clinic field, so the
 * FE could not confirm which clinic a newly created psychologist was mapped to.
 *
 * Runs against the real test database, including a mapping row with a MySQL zero-date
 * `created_at` — KiviCare writes those, Prisma fails a whole query on one, and a mocked
 * Prisma would hand back a tidy Date and hide exactly that. Only auth is stubbed: the
 * JWT actor and its resolution to a WordPress id belong to other suites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';

const auth = vi.hoisted(() => ({
  actor: { id: 'actor-1', role: 'SUPER_ADMIN', practiceId: null } as {
    id: string;
    role: string;
    practiceId: null;
  },
  clinicId: null as bigint | null,
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
}));
vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(async (actor: unknown) => ({
    actor,
    wpUserId: 1n,
    clinicId: auth.clinicId,
  })),
}));

import { GET } from '@/app/api/v1/professionals/[id]/route';

/** Test-owned range, inside this suite's allocation (8_800_000 – 8_849_999). */
const BASE = 8_840_000;
const END = BASE + 5_000;

const DOCTOR = BASE + 1;
const LONE_DOCTOR = BASE + 2;
const CLINIC_A = BASE + 501;
const CLINIC_B = BASE + 502;

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedDoctor(id: number, first: string, last: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `detail${id}`,
      userEmail: `detail${id}@test.local`,
      displayName: `${first} ${last}`,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities('kiviCare_doctor') },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: last },
      { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`,
    BASE,
    END,
  );
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  await seedDoctor(DOCTOR, 'Rina', 'Klinik Ganda');
  await seedDoctor(LONE_DOCTOR, 'Sendiri', 'Tanpa Klinik');

  // Seeded higher clinic first, and CLINIC_A twice: the table has no unique constraint,
  // and the answer must still be each clinic once, in order.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    DOCTOR,
    CLINIC_B,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    DOCTOR,
    CLINIC_A,
  );
  // The zero-date row. Strict mode refuses it, so relax sql_mode for this one statement,
  // on one pinned connection, and put it back before the connection returns to the pool.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET @praktiqu_saved_sql_mode = @@SESSION.sql_mode`);
    await tx.$executeRawUnsafe(`SET SESSION sql_mode = ''`);
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at)
       VALUES (?, ?, '0000-00-00 00:00:00')`,
      DOCTOR,
      CLINIC_A,
    );
    await tx.$executeRawUnsafe(`SET SESSION sql_mode = @praktiqu_saved_sql_mode`);
  });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

beforeEach(() => {
  auth.actor = { id: 'actor-1', role: 'SUPER_ADMIN', practiceId: null };
  auth.clinicId = null;
});

async function detail(id: number) {
  return GET(new NextRequest(`http://localhost/api/v1/professionals/${id}`), {
    params: { id: String(id) },
  });
}

describe('GET /api/v1/professionals/{id} — clinicIds', () => {
  it('lists every mapped clinic once, lowest first, despite a zero-dated mapping row', async () => {
    const res = await detail(DOCTOR);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.clinicIds).toEqual([CLINIC_A, CLINIC_B]);

    // Additive: the existing fields are all still there.
    expect(body.id).toBe(DOCTOR);
    expect(body.fullName).toBe('Rina Klinik Ganda');
    expect(body.status).toBe('ACTIVE');
    expect(body.email).toBe(`detail${DOCTOR}@test.local`);
  });

  it('answers an empty list, not a missing field, for a professional with no clinic', async () => {
    const body = await (await detail(LONE_DOCTOR)).json();
    expect(body.clinicIds).toEqual([]);
  });

  it('is what a clinic admin of one of those clinics sees too', async () => {
    auth.actor = { id: 'actor-2', role: 'CLINIC_ADMIN', practiceId: null };
    auth.clinicId = BigInt(CLINIC_B);

    const res = await detail(DOCTOR);
    expect(res.status).toBe(200);
    expect((await res.json()).clinicIds).toEqual([CLINIC_A, CLINIC_B]);
  });
});
