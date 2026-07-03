import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedEncounter, cleanup } from './fixtures';
import {
  listMedicalHistory, getMedicalHistory, createMedicalHistory,
  updateMedicalHistory, deleteMedicalHistory,
} from '@/services/billing/medical-history.service';

const CLINIC = 9_000_851, DOCTOR = 9_000_852, PATIENT = 9_000_853;
const ENC = 9_000_860;
const kcSuper = { actor: { id: 'a', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC) } as any;

describe('medical-history.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedEncounter({ id: ENC, clinicId: CLINIC, doctorId: DOCTOR, patientId: PATIENT });
  });
  afterAll(cleanup);

  it('creates, reads, lists, updates, and deletes a medical history record', async () => {
    const { id } = await createMedicalHistory(
      { encounterId: ENC, patientId: PATIENT, type: 'allergy', title: 'Penicillin allergy' },
      kcSuper,
    );
    expect(id).toBeGreaterThan(0);

    const got = await getMedicalHistory(id, null);
    expect(got.title).toBe('Penicillin allergy');
    expect(got.type).toBe('allergy');

    const list = await listMedicalHistory({ page: 1, perPage: 10, encounterId: ENC } as any, null);
    expect(list.medicalHistory.some((m) => m.id === id)).toBe(true);

    await updateMedicalHistory(id, { title: 'Aspirin sensitivity' }, null);
    expect((await getMedicalHistory(id, null)).title).toBe('Aspirin sensitivity');

    await deleteMedicalHistory(id, null);
    await expect(getMedicalHistory(id, null)).rejects.toThrow();
  });

  it('scopes reads: a CLIENT cannot see another patient\'s medical history', async () => {
    const { id } = await createMedicalHistory(
      { encounterId: ENC, patientId: PATIENT, type: 'general', title: 'Hypertension' },
      kcSuper,
    );
    await expect(getMedicalHistory(id, { patientId: BigInt(PATIENT + 999) })).rejects.toThrow();
    // owner still sees it
    expect((await getMedicalHistory(id, { patientId: BigInt(PATIENT) })).id).toBe(id);
  });
});
