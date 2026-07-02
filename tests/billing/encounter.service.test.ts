import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
