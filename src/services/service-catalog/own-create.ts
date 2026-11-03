/**
 * Where a psychologist's own new service goes (POST /api/v1/services as PROFESSIONAL).
 *
 * A psychologist may add offerings for themselves only, at an active clinic they practise at.
 * The answer is a clinic id or the reason to refuse; the route turns the reason into a
 * response. Spec: docs/superpowers/specs/2026-10-19-psikolog-tambah-layanan-design.md §B3.
 */
import { listPracticeClinics } from '@/services/billing/kc-actor';

export type OwnCreateRefusal = 'not_self' | 'no_clinic' | 'clinic_not_yours' | 'clinic_required';

export type OwnCreateTarget = { clinicId: number } | { refusal: OwnCreateRefusal };

export async function resolveOwnCreateTarget(input: {
  /** The psychologist's wp user id, from the token — never from the body. */
  self: bigint;
  doctorIds: number[];
  clinicId?: number;
}): Promise<OwnCreateTarget> {
  // A body naming anyone else is the caller's mistake. Dropping the other ids silently would
  // create the service for a different set of people than the one asked for.
  if (input.doctorIds.some((d) => BigInt(d) !== input.self)) return { refusal: 'not_self' };

  const clinics = await listPracticeClinics(input.self);
  if (clinics.length === 0) return { refusal: 'no_clinic' };

  if (input.clinicId !== undefined) {
    return clinics.some((c) => c.id === input.clinicId)
      ? { clinicId: input.clinicId }
      : { refusal: 'clinic_not_yours' };
  }
  return clinics.length === 1 ? { clinicId: clinics[0].id } : { refusal: 'clinic_required' };
}
