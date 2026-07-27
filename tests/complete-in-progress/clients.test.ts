/**
 * Client service tests — against `wp_users`, not a `clients` table.
 *
 * The previous version of this file seeded `prisma.client`: the shadow table that held
 * 0 rows in production while 752 real patients lived in `wp_users`. It was therefore
 * testing an implementation that could never see a real client. See
 * docs/architecture/shadow-tables-audit.md.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { CLIENT_STATUS } from '@/repositories/wp/patients.repo';

/**
 * Stand in for the praktiqu-endpoint plugin.
 *
 * Writes go over HTTP so KiviCare's hooks fire; there is no WordPress here, so this
 * performs the wp_usermeta write the plugin would. The service's own logic — status
 * transitions, scoping, bulk accounting — stays under test.
 */
vi.mock('@/repositories/wp/patients.write', () => ({
  createPatient: vi.fn(async () => {
    throw new Error('createPatient is not exercised by this suite');
  }),
  updatePatient: vi.fn(async (id: number, input: Record<string, unknown>) => {
    const { prisma: db } = await import('@/lib/db');
    if (typeof input.status === 'string') {
      // update_user_meta semantics: one row per key, replaced in place.
      await db.$executeRawUnsafe(
        `DELETE FROM wp_usermeta WHERE user_id = ? AND meta_key = 'praktiqu_client_status'`,
        id,
      );
      await db.$executeRawUnsafe(
        `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, 'praktiqu_client_status', ?)`,
        id,
        input.status,
      );
    }
    return { id, email: '', firstName: '', lastName: '', contactNumber: '', patientUniqueId: null };
  }),
}));

const {
  bulkArchiveClients,
  bulkSetClientStatus,
  exportClients,
  getClientStatistics,
} = await import('@/services/client/client.service');
const { GET: statisticsGet } = await import('@/app/api/v1/clients/[id]/statistics/route');

const BASE = 8_300_000;
const END = BASE + 100_000;
const CLINIC = BigInt(BASE + 900);

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function makeToken(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

function makeReq(jwt: string, clientId: number) {
  return new NextRequest(`http://localhost/api/v1/clients/${clientId}/statistics`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
}

function capabilities(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function seedPatient(id: number, name: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `${id}@clients.test.local`,
      displayName: name,
      userRegistered: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities('kiviCare_patient') },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: name.split(' ')[0] },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: name.split(' ').slice(1).join(' ') || '-' },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_clinic_mappings (patient_id, clinic_id, created_at) VALUES (?, ?, NOW())`,
    id,
    CLINIC,
  );
}

/** Auth-mirror row linking a JWT subject (cuid) to a WordPress user id. */
async function linkAuthUser(cuid: string, wpUserId: number, role: 'CLIENT' | 'CLINIC_ADMIN') {
  await prisma.user.create({
    data: {
      id: cuid,
      email: `${cuid}@clients.test.local`,
      username: cuid,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role,
      wpUserId: BigInt(wpUserId),
      status: 1,
    },
  });
}

async function statusOf(id: number): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ meta_value: string }>>(
    `SELECT meta_value FROM wp_usermeta WHERE user_id = ? AND meta_key = 'praktiqu_client_status' LIMIT 1`,
    id,
  );
  return rows[0]?.meta_value ?? null;
}

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_clinic_mappings WHERE patient_id >= ? AND patient_id < ?`,
    BASE,
    END,
  );
  await prisma.kcAppointment.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'clients-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await seedPatient(BASE + 1, 'Client One');
  await seedPatient(BASE + 2, 'Client Two');
  await linkAuthUser('clients-test-self', BASE + 1, 'CLIENT');
  await linkAuthUser('clients-test-other', BASE + 2, 'CLIENT');
  await linkAuthUser('clients-test-admin', BASE + 800, 'CLINIC_ADMIN');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('bulkArchiveClients', () => {
  it('archives clients by writing the status meta', async () => {
    const n = await bulkArchiveClients([BASE + 1]);
    expect(n).toBe(1);
    expect(await statusOf(BASE + 1)).toBe(CLIENT_STATUS.ARCHIVED);
  });

  it('returns 0 for an empty array', async () => {
    expect(await bulkArchiveClients([])).toBe(0);
  });
});

describe('bulkSetClientStatus', () => {
  it('sets status on several clients and reports how many applied', async () => {
    const n = await bulkSetClientStatus([BASE + 1, BASE + 2], CLIENT_STATUS.INACTIVE);
    expect(n).toBe(2);
    expect(await statusOf(BASE + 2)).toBe(CLIENT_STATUS.INACTIVE);
  });
});

describe('exportClients', () => {
  it('returns an array', async () => {
    expect(Array.isArray(await exportClients({}))).toBe(true);
  });

  it('filters by clinic', async () => {
    const rows = await exportClients({ clinicId: Number(CLINIC) });
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(BASE + 1);
    expect(ids).toContain(BASE + 2);
    // Every row must belong to the requested clinic — this is an access boundary.
    expect(rows.every((r) => r.clinicId === Number(CLINIC))).toBe(true);
  });

  it('returns nothing for a clinic with no patients', async () => {
    expect(await exportClients({ clinicId: Number(CLINIC) + 12_345 })).toEqual([]);
  });
});

describe('getClientStatistics', () => {
  it('returns zero sessions for a client with no appointments', async () => {
    const stats = await getClientStatistics(BASE + 1);

    expect(stats.totalSessions).toBe(0);
    expect(stats.lastSessionAt).toBeNull();
  });

  it('counts the client’s KiviCare appointments', async () => {
    await prisma.kcAppointment.create({
      data: {
        id: BigInt(BASE + 5000),
        clinicId: CLINIC,
        doctorId: BigInt(BASE + 700),
        patientId: BigInt(BASE + 2),
        appointmentStartDate: new Date('2026-05-04T00:00:00Z'),
        appointmentStartTime: new Date('1970-01-01T10:00:00Z'),
        appointmentEndDate: new Date('2026-05-04T00:00:00Z'),
        appointmentEndTime: new Date('1970-01-01T11:00:00Z'),
        appointmentTimezone: 'Asia/Jakarta',
        status: 1,
        createdAt: new Date(),
      } as never,
    });

    const stats = await getClientStatistics(BASE + 2);
    expect(stats.totalSessions).toBe(1);
    expect(stats.lastSessionAt).not.toBeNull();

    await prisma.kcAppointment.deleteMany({ where: { id: BigInt(BASE + 5000) } });
  });
});

describe('GET /clients/:id/statistics — CLIENT self-access auth', () => {
  it('returns 200 when the CLIENT actor resolves to that patient', async () => {
    const jwt = await makeToken('CLIENT', 'clients-test-self');
    const res = await statisticsGet(makeReq(jwt, BASE + 1), {
      params: Promise.resolve({ id: String(BASE + 1) }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('data');
  });

  it('returns 403 when the CLIENT actor is a different patient', async () => {
    const jwt = await makeToken('CLIENT', 'clients-test-other');
    const res = await statisticsGet(makeReq(jwt, BASE + 1), {
      params: Promise.resolve({ id: String(BASE + 1) }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 200 for CLINIC_ADMIN accessing any client', async () => {
    const jwt = await makeToken('CLINIC_ADMIN', 'clients-test-admin');
    const res = await statisticsGet(makeReq(jwt, BASE + 1), {
      params: Promise.resolve({ id: String(BASE + 1) }),
    });

    expect(res.status).toBe(200);
  });

  it('rejects a non-numeric client id rather than letting NaN reach SQL', async () => {
    const jwt = await makeToken('CLINIC_ADMIN', 'clients-test-admin');
    const res = await statisticsGet(makeReq(jwt, BASE + 1), {
      params: Promise.resolve({ id: 'not-a-number' }),
    });

    expect(res.status).toBe(400);
  });
});
