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

// Registry is assembled in Tasks 2-4. Import the per-entity adapters and map them:
export const adapters: Record<ImportEntity, ImportAdapter> = {} as any;
