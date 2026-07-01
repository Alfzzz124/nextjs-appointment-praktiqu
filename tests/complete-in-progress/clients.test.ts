import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  bulkArchiveClients,
  bulkSetClientStatus,
  exportClients,
  getClientStatistics,
} from '@/services/client/client.service';
import { GET as statisticsGet } from '@/app/api/v1/clients/[id]/statistics/route';
import { ClientStatus, Gender } from '@prisma/client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'dev-secret-change-me',
);

async function makeToken(role: string, sub: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

function makeReq(jwt: string, clientId: string) {
  return new NextRequest(`http://localhost/api/v1/clients/${clientId}/statistics`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
}

let client1Id: string;
let client2Id: string;
let user1Id: string;
let user2Id: string;
let practiceId: string;

beforeAll(async () => {
  const clinic = await prisma.clinic.findFirst();
  if (!clinic) throw new Error('Need a clinic in DB');
  practiceId = clinic.id;

  const ts = Date.now();

  // Create minimal User records (required by Client.userId unique constraint)
  const [user1, user2] = await Promise.all([
    prisma.user.create({
      data: {
        email: `bulk-u1-${ts}@test.invalid`,
        username: `bulk-u1-${ts}`,
        firstName: 'Bulk',
        lastName: 'One',
        displayName: 'Bulk One',
        role: 'CLIENT',
      },
    }),
    prisma.user.create({
      data: {
        email: `bulk-u2-${ts}@test.invalid`,
        username: `bulk-u2-${ts}`,
        firstName: 'Bulk',
        lastName: 'Two',
        displayName: 'Bulk Two',
        role: 'CLIENT',
      },
    }),
  ]);
  user1Id = user1.id;
  user2Id = user2.id;

  const [c1, c2] = await Promise.all([
    prisma.client.create({
      data: {
        userId: user1Id,
        practiceId,
        uniqueClientId: `CLT-TEST-${ts}-1`,
        fullName: 'Bulk Test Client One',
        email: `bulk-c1-${ts}@test.invalid`,
        mobileNumber: '0000000001',
        dateOfBirth: new Date('1990-01-01'),
        gender: Gender.MALE,
        status: ClientStatus.ACTIVE,
      },
    }),
    prisma.client.create({
      data: {
        userId: user2Id,
        practiceId,
        uniqueClientId: `CLT-TEST-${ts}-2`,
        fullName: 'Bulk Test Client Two',
        email: `bulk-c2-${ts}@test.invalid`,
        mobileNumber: '0000000002',
        dateOfBirth: new Date('1991-01-01'),
        gender: Gender.FEMALE,
        status: ClientStatus.ACTIVE,
      },
    }),
  ]);
  client1Id = c1.id;
  client2Id = c2.id;
});

afterAll(async () => {
  await prisma.client.deleteMany({ where: { id: { in: [client1Id, client2Id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [user1Id, user2Id] } } });
});

describe('bulkArchiveClients', () => {
  it('archives clients by setting status to ARCHIVED', async () => {
    const n = await bulkArchiveClients([client1Id]);
    expect(n).toBe(1);
    const c = await prisma.client.findUnique({ where: { id: client1Id } });
    expect(c?.status).toBe(ClientStatus.ARCHIVED);
  });

  it('returns 0 for empty array', async () => {
    const n = await bulkArchiveClients([]);
    expect(n).toBe(0);
  });
});

describe('bulkSetClientStatus', () => {
  it('sets status and persists to DB', async () => {
    const n = await bulkSetClientStatus([client1Id, client2Id], ClientStatus.INACTIVE);
    expect(n).toBe(2);
    const c = await prisma.client.findUnique({ where: { id: client2Id } });
    expect(c?.status).toBe(ClientStatus.INACTIVE);
  });
});

describe('exportClients', () => {
  it('returns an array', async () => {
    const rows = await exportClients({});
    expect(Array.isArray(rows)).toBe(true);
  });

  it('filters by practiceId', async () => {
    const rows = await exportClients({ practiceId }) as Array<{ practiceId: string }>;
    expect(rows.every((r) => r.practiceId === practiceId)).toBe(true);
  });
});

describe('getClientStatistics', () => {
  it('returns session count for a client', async () => {
    const stats = await getClientStatistics(client1Id);
    expect(typeof stats.totalSessions).toBe('number');
    expect(stats.totalSessions).toBeGreaterThanOrEqual(0);
  });

  it('returns zero for a client with no patient record', async () => {
    const stats = await getClientStatistics(client1Id);
    expect(stats.lastSessionAt).toBeNull();
  });
});

describe('GET /clients/:id/statistics — CLIENT self-access auth', () => {
  it('returns 200 when CLIENT actor userId matches the client record', async () => {
    // user1Id is the userId on client1's record
    const jwt = await makeToken('CLIENT', user1Id);
    const res = await statisticsGet(makeReq(jwt, client1Id), {
      params: Promise.resolve({ id: client1Id }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('data');
  });

  it('returns 403 when CLIENT actor userId does NOT match the client record', async () => {
    // user2Id belongs to client2, not client1
    const jwt = await makeToken('CLIENT', user2Id);
    const res = await statisticsGet(makeReq(jwt, client1Id), {
      params: Promise.resolve({ id: client1Id }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 200 for CLINIC_ADMIN accessing any client', async () => {
    const jwt = await makeToken('CLINIC_ADMIN', 'admin-user-id');
    const res = await statisticsGet(makeReq(jwt, client1Id), {
      params: Promise.resolve({ id: client1Id }),
    });
    expect(res.status).toBe(200);
  });
});
