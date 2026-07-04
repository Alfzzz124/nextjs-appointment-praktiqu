import { createEncounter } from '@/services/billing/encounter.service';
import type { ImportAdapter } from '../adapters';

export const encountersAdapter: ImportAdapter = {
  // Encounters are never deduped — always insert.
  async findExisting() {
    return null;
  },
  async insert(row, kc) {
    // createEncounter derives clinic/doctor from kc for non-super actors; SUPER_ADMIN may pass the row's.
    await createEncounter(
      {
        patientId: row.patient_id,
        clinicId: row.clinic_id,
        doctorId: row.doctor_id,
        encounterDate: row.encounter_date,
        description: row.description,
      },
      kc,
    );
  },
};
