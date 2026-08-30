/**
 * Who may see and touch which service mappings.
 *
 * The read matrix is KiviCare's own, from `DoctorServiceController::getServices`
 * (:623-652): administrators see everything, clinic admins and receptionists see their
 * clinic, doctors see their own rows across clinics, everyone else sees nothing.
 *
 * The write gate is deliberately *not* KiviCare's. There the gate is
 * `KCPermissions::can_user_perform_action('service_add'|…)`, a matrix stored in
 * `wp_options` and configurable per install — unpredictable from an API's point of view.
 * Here it is fixed: the two admin roles, per the product decision that a clinic's shape
 * is set by its admin.
 */
import { NextResponse } from 'next/server';
import type { Actor } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';

export type ServiceScope = {
  /** Restrict to this clinic. `null` means unrestricted, which only SUPER_ADMIN gets. */
  clinicId: bigint | null;
  /** Restrict to this doctor. `null` means unrestricted. */
  doctorId: bigint | null;
  /**
   * The actor can see nothing at all. A clinic admin with no clinic mapping lands here,
   * and the answer is an empty page — not a 500, and not the whole table.
   */
  empty: boolean;
};

const UNRESTRICTED: ServiceScope = { clinicId: null, doctorId: null, empty: false };
const NOTHING: ServiceScope = { clinicId: null, doctorId: null, empty: true };

export async function readScopeFor(actor: Actor): Promise<ServiceScope> {
  if (actor.role === 'SUPER_ADMIN') return UNRESTRICTED;
  if (actor.role === 'CLIENT') return NOTHING;

  const kc = await resolveKcActor(actor);

  if (actor.role === 'PROFESSIONAL') {
    return { clinicId: null, doctorId: kc.wpUserId, empty: false };
  }

  // CLINIC_ADMIN and RECEPTIONIST.
  if (kc.clinicId === null) return NOTHING;
  return { clinicId: kc.clinicId, doctorId: null, empty: false };
}

export function canWrite(role: Actor['role']): boolean {
  return role === 'SUPER_ADMIN' || role === 'CLINIC_ADMIN';
}

/**
 * Parse a numeric mapping id from the path.
 *
 * A non-numeric segment must fail here as 400: unchecked it becomes `NaN`, and `NaN`
 * reaching a SQL parameter has crashed the public booking page before.
 */
export function parseServiceId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function invalidIdResponse(): NextResponse {
  return NextResponse.json(
    { type: '/errors/validation-error', title: 'Invalid service id', status: 400 },
    { status: 400 },
  );
}
