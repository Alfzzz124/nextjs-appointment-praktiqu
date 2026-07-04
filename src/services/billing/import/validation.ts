import { z } from 'zod';

export const IMPORT_ENTITIES = [
  'taxes', 'services', 'clinics', 'appointments',
  'encounters', 'prescriptions', 'medical-history', 'doctors', 'patients',
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const importRequestSchema = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  conflictStrategy: z.enum(['error', 'skip', 'update']).default('error'),
  dryRun: z.boolean().default(false),
  rows: z.array(z.record(z.unknown())).min(1).max(10000).optional(), // JSON path; CSV path fills this
});

// Per-entity row schemas (coerce strings — CSV values arrive as strings).
export const rowSchemas: Record<ImportEntity, z.ZodType> = {
  taxes: z.object({ name: z.string().min(1), tax_type: z.enum(['percentage', 'fixed']).default('percentage'), tax_value: z.coerce.number(), clinic_id: z.coerce.number().int().optional(), status: z.coerce.number().int().min(0).max(1).default(1) }),
  services: z.object({ name: z.string().min(1), type: z.string().optional(), price: z.coerce.number().optional(), status: z.coerce.number().int().default(1) }),
  clinics: z.object({ name: z.string().min(1), email: z.string().email().optional(), telephone_no: z.string().optional(), address: z.string().optional(), city: z.string().optional(), country: z.string().optional(), status: z.coerce.number().int().min(0).max(1).default(1) }),
  appointments: z.object({ clinic_id: z.coerce.number().int(), doctor_id: z.coerce.number().int(), patient_id: z.coerce.number().int(), appointment_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointment_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/), status: z.coerce.number().int().default(2), timezone: z.string().default('Asia/Jakarta') }),
  encounters: z.object({ clinic_id: z.coerce.number().int(), doctor_id: z.coerce.number().int(), patient_id: z.coerce.number().int(), encounter_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), description: z.string().optional() }),
  prescriptions: z.object({ encounter_id: z.coerce.number().int(), patient_id: z.coerce.number().int(), name: z.string().min(1), frequency: z.string().optional(), duration: z.string().optional(), instruction: z.string().optional() }),
  'medical-history': z.object({ encounter_id: z.coerce.number().int(), patient_id: z.coerce.number().int(), type: z.string().default('general'), title: z.string().min(1) }),
  doctors: z.object({ name: z.string().min(1), email: z.string().email(), clinic_id: z.coerce.number().int().optional() }),
  patients: z.object({ name: z.string().min(1), email: z.string().email(), clinic_id: z.coerce.number().int().optional() }),
};
