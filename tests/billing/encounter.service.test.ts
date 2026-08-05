import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * Encounter WRITES go through the praktiqu-endpoint plugin now (phase E1), so they
 * need a live WordPress and a service token. This suite is about the service's own
 * logic — scoping, status transitions, bulk operations — so the plugin hop is replaced
 * with the equivalent direct write and everything else still hits the real test DB.
 *
 * This test had been failing silently since E1: a broken cleanup() aborted beforeAll,
 * and vitest reported the whole suite as SKIPPED rather than failed.
 */
vi.mock('@/repositories/wp/encounters.write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/repositories/wp/encounters.write')>();
  const { prisma } = await import('@/lib/db');
  return {
    ...actual,
    createEncounter: vi.fn(async (input: Record<string, unknown>) => {
      const created = await prisma.kcPatientEncounter.create({
        data: {
          patientId: BigInt(input.patientId as number),
          clinicId: BigInt(input.clinicId as number),
          doctorId: BigInt(input.doctorId as number),
          appointmentId: input.appointmentId ? BigInt(input.appointmentId as number) : null,
          encounterDate: new Date(),
          description: (input.description as string) ?? null,
          status: 1,
          addedBy: BigInt(input.doctorId as number),
          createdAt: new Date(),
        },
        select: { id: true },
      });
      return { id: Number(created.id), status: 1, notified: false };
    }),
    updateEncounter: vi.fn(async (id: number, input: Record<string, unknown>) => {
      await prisma.kcPatientEncounter.update({
        where: { id: BigInt(id) },
        data: { description: (input.description as string) ?? undefined },
      });
      return { id, updated: Object.keys(input) };
    }),
    setEncounterStatus: vi.fn(async (id: number, status: number) => {
      await prisma.kcPatientEncounter.update({ where: { id: BigInt(id) }, data: { status } });
      return { id, status, closed: status === 0, notified: false };
    }),
  };
});

import { assertTestDb, seedEncounter, cleanup } from './fixtures';
import {
  listEncounters, getEncounter, createEncounter, updateEncounter,
  deleteEncounter, bulkSetEncounterStatus, bulkDeleteEncounters,
} from '@/services/billing/encounter.service';

const CLINIC = 9_000_701, DOCTOR = 9_000_702, PATIENT = 9_000_703;
const kcSuper = { actor: { id: 'a', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;

describe('encounter.service', () => {
  beforeAll(async () => { assertTestDb(); await cleanup(); });
  afterAll(cleanup);

  it('creates, reads, lists, updates status, and deletes an encounter', async () => {
    const { id } = await createEncounter({ patientId: PATIENT, clinicId: CLINIC, doctorId: DOCTOR, description: 'hello' }, kcSuper);
    expect(id).toBeGreaterThan(0);

    const got = await getEncounter(id, null);
    expect(got.description).toBe('hello');

    const list = await listEncounters({ page: 1, perPage: 10, clinicId: CLINIC } as any, null);
    expect(list.encounters.some((e) => e.id === id)).toBe(true);

    await updateEncounter(id, { status: 0 }, null);
    expect((await getEncounter(id, null)).status).toBe(0);

    const n = await bulkSetEncounterStatus([id], 1, null);
    expect(n).toBe(1);

    await deleteEncounter(id, null);
    await expect(getEncounter(id, null)).rejects.toThrow();
  });

  it('bulk deletes only rows within scope', async () => {
    const a = await seedEncounter({ id: 9_000_705, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    const b = await seedEncounter({ id: 9_000_706, clinicId: CLINIC + 1, doctorId: DOCTOR, patientId: PATIENT });
    const n = await bulkDeleteEncounters([Number(a.id), Number(b.id)], { clinicId: BigInt(CLINIC) });
    expect(n).toBe(1);
    await expect(getEncounter(Number(a.id), null)).rejects.toThrow();
    // b (other clinic) survives the scoped delete
    expect((await getEncounter(Number(b.id), null)).id).toBe(Number(b.id));
  });

  it('scopes reads: a CLIENT cannot see another patient\'s encounter', async () => {
    const seeded = await seedEncounter({ id: 9_000_710, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
    await expect(getEncounter(Number(seeded.id), { patientId: BigInt(PATIENT + 999) })).rejects.toThrow();
  });
});
