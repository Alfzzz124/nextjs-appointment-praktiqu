import type { KcActor } from '@/services/billing/kc-actor';
import type { ImportEntity } from './validation';

export type ConflictStrategy = 'error' | 'skip' | 'update';
export interface RowOutcome { action: 'imported' | 'updated' | 'skipped'; }

export interface ImportAdapter {
  /** Find an existing row's id by the natural conflict key; null if none. */
  findExisting(row: any, kc: KcActor): Promise<number | null>;
  /** Insert a validated row. For non-super actors, clinic is forced to kc.clinicId (handled here). */
  insert(row: any, kc: KcActor): Promise<void>;
  /** Update an existing row (only used when conflictStrategy='update'). Optional; if absent, 'update' behaves as 'skip'. */
  update?(id: number, row: any, kc: KcActor): Promise<void>;
}

import { taxesAdapter } from './adapters/taxes';
import { servicesAdapter } from './adapters/services';
import { clinicsAdapter } from './adapters/clinics';
import { appointmentsAdapter } from './adapters/appointments';
import { encountersAdapter } from './adapters/encounters';
import { prescriptionsAdapter } from './adapters/prescriptions';
import { medicalHistoryAdapter } from './adapters/medical-history';
import { doctorsAdapter } from './adapters/doctors';
import { patientsAdapter } from './adapters/patients';

// Registry assembled from the per-entity adapters (Tasks 3-4).
export const adapters: Record<ImportEntity, ImportAdapter> = {
  taxes: taxesAdapter,
  services: servicesAdapter,
  clinics: clinicsAdapter,
  appointments: appointmentsAdapter,
  encounters: encountersAdapter,
  prescriptions: prescriptionsAdapter,
  'medical-history': medicalHistoryAdapter,
  doctors: doctorsAdapter,
  patients: patientsAdapter,
};
