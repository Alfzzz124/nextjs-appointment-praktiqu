import { createPrescription } from '@/services/billing/prescription.service';
import type { ImportAdapter } from '../adapters';

export const prescriptionsAdapter: ImportAdapter = {
  // Prescriptions are never deduped — always insert.
  async findExisting() {
    return null;
  },
  async insert(row, kc) {
    // createPrescription validates the encounter is within the actor's scope.
    await createPrescription(
      {
        encounterId: row.encounter_id,
        patientId: row.patient_id,
        name: row.name,
        frequency: row.frequency,
        duration: row.duration,
        instruction: row.instruction,
      },
      kc,
    );
  },
};
