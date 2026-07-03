import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedEncounter, cleanup } from './fixtures';
import {
  listPrescriptions, getPrescription, createPrescription, updatePrescription,
  deletePrescription, bulkDeletePrescriptions,
} from '@/services/billing/prescription.service';

const CLINIC = 9_000_801, DOCTOR = 9_000_802, PATIENT = 9_000_803;
const ENC = 9_000_810, ENC_OTHER = 9_000_811;
const kcSuper = { actor: { id: 'a', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;

describe('prescription.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedEncounter({ id: ENC, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
  });
  afterAll(cleanup);

  it('creates, reads, lists, updates, and deletes a prescription', async () => {
    const { id } = await createPrescription(
      { encounterId: ENC, patientId: PATIENT, name: 'Amoxicillin', frequency: '1-0-1', duration: '5 days', instruction: 'After meals' },
      kcSuper,
    );
    expect(id).toBeGreaterThan(0);

    const got = await getPrescription(id, null);
    expect(got.name).toBe('Amoxicillin');

    const list = await listPrescriptions({ page: 1, perPage: 10, encounterId: ENC } as any, null);
    expect(list.prescriptions.some((p) => p.id === id)).toBe(true);

    await updatePrescription(id, { name: 'Ibuprofen' }, null);
    expect((await getPrescription(id, null)).name).toBe('Ibuprofen');

    await deletePrescription(id, null);
    await expect(getPrescription(id, null)).rejects.toThrow();
  });

  it('scopes reads: a CLIENT cannot see another patient\'s prescription', async () => {
    const { id } = await createPrescription(
      { encounterId: ENC, patientId: PATIENT, name: 'Paracetamol' },
      kcSuper,
    );
    await expect(getPrescription(id, { patientId: BigInt(PATIENT + 999) })).rejects.toThrow();
    // owner still sees it
    expect((await getPrescription(id, { patientId: BigInt(PATIENT) })).id).toBe(id);
  });

  it('bulk deletes only prescriptions within scope', async () => {
    await seedEncounter({ id: ENC_OTHER, clinicId: CLINIC + 1, doctorId: DOCTOR, patientId: PATIENT });
    const inScope = await createPrescription({ encounterId: ENC, patientId: PATIENT, name: 'InScope Rx' }, kcSuper);
    const outScope = await createPrescription({ encounterId: ENC_OTHER, patientId: PATIENT, name: 'OutScope Rx' }, kcSuper);

    const n = await bulkDeletePrescriptions([inScope.id, outScope.id], { encClinicId: BigInt(CLINIC) });
    expect(n).toBe(1);
    await expect(getPrescription(inScope.id, null)).rejects.toThrow();
    // out-of-clinic prescription survives the scoped delete
    expect((await getPrescription(outScope.id, null)).id).toBe(outScope.id);
  });
});
