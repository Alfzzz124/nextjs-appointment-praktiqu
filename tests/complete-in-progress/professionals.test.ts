import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkDeleteProfessionals,
  bulkSetProfessionalStatus,
  exportProfessionals,
} from '@/services/professional/professional.service';
import { ProfessionalStatus, ProfessionalType } from '@prisma/client';
// ProfessionalType values: PSIKOLOG_KLINIS, PSIKOLOG_ANAK, PSIKIATER, KONSELOR

const ts = Date.now();
let clinicId: string;
let userId1: string;
let userId2: string;
let prof1Id: string;
let prof2Id: string;

beforeAll(async () => {
  // Guard: only run against a test DB
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) throw new Error('Refusing to run: DATABASE_URL does not look like a test DB');

  let clinic = await prisma.clinic.findFirst();
  if (!clinic) {
    clinic = await prisma.clinic.create({ data: { name: `Test Clinic ${ts}`, status: 1 } });
  }
  clinicId = clinic.id;

  // Create test users then attach professionals
  const [u1, u2] = await Promise.all([
    prisma.user.create({
      data: {
        id: `test-prof-user-1-${ts}`,
        email: `prof-user-1-${ts}@test.invalid`,
        username: `prof-user-1-${ts}`,
        firstName: 'Bulk',
        lastName: 'Pro1',
        displayName: 'Bulk Pro1',
        role: 'PROFESSIONAL',
        status: 1,
      },
    }),
    prisma.user.create({
      data: {
        id: `test-prof-user-2-${ts}`,
        email: `prof-user-2-${ts}@test.invalid`,
        username: `prof-user-2-${ts}`,
        firstName: 'Bulk',
        lastName: 'Pro2',
        displayName: 'Bulk Pro2',
        role: 'PROFESSIONAL',
        status: 1,
      },
    }),
  ]);
  userId1 = u1.id;
  userId2 = u2.id;

  const [p1, p2] = await Promise.all([
    prisma.professional.create({
      data: {
        userId: userId1,
        fullName: 'Bulk Test Pro 1',
        email: `bulk-pro-1-${ts}@test.invalid`,
        registrationNumber: `BT1-${ts}`,
        professionalType: ProfessionalType.KONSELOR,
        status: ProfessionalStatus.ACTIVE,
        practiceId: clinicId,
      },
    }),
    prisma.professional.create({
      data: {
        userId: userId2,
        fullName: 'Bulk Test Pro 2',
        email: `bulk-pro-2-${ts}@test.invalid`,
        registrationNumber: `BT2-${ts}`,
        professionalType: ProfessionalType.KONSELOR,
        status: ProfessionalStatus.ACTIVE,
        practiceId: clinicId,
      },
    }),
  ]);
  prof1Id = p1.id;
  prof2Id = p2.id;
});

afterAll(async () => {
  await prisma.professional.deleteMany({ where: { id: { in: [prof1Id, prof2Id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId1, userId2] } } });
});

describe('bulkDeleteProfessionals', () => {
  it('soft-deletes professionals by setting status to INACTIVE', async () => {
    const n = await bulkDeleteProfessionals([prof1Id]);
    expect(n).toBe(1);
    const p = await prisma.professional.findUnique({ where: { id: prof1Id } });
    expect(p?.status).toBe(ProfessionalStatus.INACTIVE);
  });
});

describe('bulkSetProfessionalStatus', () => {
  it('sets status on multiple professionals and persists to DB', async () => {
    const n = await bulkSetProfessionalStatus([prof1Id, prof2Id], ProfessionalStatus.INACTIVE);
    expect(n).toBe(2);
    const p = await prisma.professional.findUnique({ where: { id: prof2Id } });
    expect(p?.status).toBe(ProfessionalStatus.INACTIVE);
  });
});

describe('exportProfessionals', () => {
  it('returns an array of professional records', async () => {
    const rows = await exportProfessionals({ practiceId: clinicId });
    expect(Array.isArray(rows)).toBe(true);
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(prof1Id);
  });
});
