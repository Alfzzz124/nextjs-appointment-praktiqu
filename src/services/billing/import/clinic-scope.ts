import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';

/**
 * Resolve the clinic_id an actor may write to during import.
 *
 * SECURITY: a NON-super actor is forced to their own `kc.clinicId` — the
 * row-supplied `clinic_id` is NEVER consulted (that would let a misconfigured
 * CLINIC_ADMIN write into an arbitrary clinic named in the CSV). Only a
 * SUPER_ADMIN may target the row's clinic_id.
 *
 * Returns `-1n` when a non-super actor has no clinic (an impossible clinic id,
 * so dedup lookups match nothing). Use {@link requireClinicId} when a valid
 * clinic is mandatory (e.g. inserts).
 */
export function resolveClinicId(row: any, kc: KcActor): bigint {
  if (kc.actor.role === 'SUPER_ADMIN') return BigInt(row.clinic_id ?? -1);
  return kc.clinicId ?? -1n;
}

/**
 * Like {@link resolveClinicId}, but throws when the resolved clinic is invalid
 * (null / <= 0). For a non-super actor the clinic comes STRICTLY from
 * `kc.clinicId` — never from the row.
 */
export function requireClinicId(row: any, kc: KcActor): bigint {
  const clinicId =
    kc.actor.role === 'SUPER_ADMIN' ? BigInt(row.clinic_id ?? 0) : (kc.clinicId ?? 0n);
  if (!clinicId || clinicId <= 0n) {
    throw new KcError('clinicId could not be resolved for this actor', 400);
  }
  return clinicId;
}
