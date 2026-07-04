import { IMPORT_ENTITIES, type ImportEntity } from './validation';

const SAMPLES: Record<ImportEntity, { columns: string[]; sample: Record<string, unknown> }> = {
  taxes: { columns: ['name', 'tax_type', 'tax_value', 'status'], sample: { name: 'VAT', tax_type: 'percentage', tax_value: 10, status: 1 } },
  services: { columns: ['name', 'type', 'price', 'status'], sample: { name: 'Consultation', type: 'general', price: 150000, status: 1 } },
  clinics: { columns: ['name', 'email', 'telephone_no', 'address', 'city', 'country', 'status'], sample: { name: 'Clinic A', email: 'clinic@a.test', telephone_no: '021-1234', address: 'Jl. X', city: 'Jakarta', country: 'ID', status: 1 } },
  appointments: { columns: ['clinic_id', 'doctor_id', 'patient_id', 'appointment_start_date', 'appointment_start_time', 'status'], sample: { clinic_id: 1, doctor_id: 2, patient_id: 3, appointment_start_date: '2026-08-01', appointment_start_time: '09:00:00', status: 2 } },
  encounters: { columns: ['clinic_id', 'doctor_id', 'patient_id', 'encounter_date', 'description'], sample: { clinic_id: 1, doctor_id: 2, patient_id: 3, encounter_date: '2026-08-01', description: 'Initial visit' } },
  prescriptions: { columns: ['encounter_id', 'patient_id', 'name', 'frequency', 'duration', 'instruction'], sample: { encounter_id: 10, patient_id: 3, name: 'Paracetamol 500mg', frequency: '3x daily', duration: '5 days', instruction: 'After meals' } },
  'medical-history': { columns: ['encounter_id', 'patient_id', 'type', 'title'], sample: { encounter_id: 10, patient_id: 3, type: 'allergy', title: 'Penicillin allergy' } },
  doctors: { columns: ['name', 'email', 'clinic_id'], sample: { name: 'Dr. Jane', email: 'jane@clinic.test', clinic_id: 1 } },
  patients: { columns: ['name', 'email', 'clinic_id'], sample: { name: 'John Doe', email: 'john@patient.test', clinic_id: 1 } },
};

export function importTemplates(entity?: ImportEntity) {
  const keys = entity ? [entity] : [...IMPORT_ENTITIES];
  return { templates: keys.map((e) => ({ entity: e, ...SAMPLES[e] })) };
}
