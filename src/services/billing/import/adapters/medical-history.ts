import { createMedicalHistory } from '@/services/billing/medical-history.service';
import type { ImportAdapter } from '../adapters';

export const medicalHistoryAdapter: ImportAdapter = {
  // Medical-history records are never deduped — always insert.
  async findExisting() {
    return null;
  },
  async insert(row, kc) {
    // createMedicalHistory validates the encounter is within the actor's scope.
    await createMedicalHistory(
      {
        encounterId: row.encounter_id,
        patientId: row.patient_id,
        type: row.type,
        title: row.title,
      },
      kc,
    );
  },
};
