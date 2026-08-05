/**
 * Shared route plumbing for `/api/v1/professionals/*`.
 *
 * Every one of these routes needs the same three things, and repeating them fifteen
 * times is how the RBAC checks drifted apart in the first place:
 *
 *   1. Parse a numeric professional id (a `wp_users.ID`) from the path.
 *   2. Resolve the JWT actor to their WordPress id and clinic — the JWT subject is a
 *      cuid in the auth mirror, NOT the professional's id, so self-access must compare
 *      resolved WordPress ids.
 *   3. Decide whether the actor may see or edit that professional.
 */

import { NextResponse } from 'next/server';
import type { Actor } from '@/lib/auth';
import { resolveKcActor, type KcActor } from '@/services/billing/kc-actor';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { prisma } from '@/lib/db';

/**
 * Professional ids are numeric now. A non-numeric segment must fail as 400 here —
 * unchecked it becomes NaN, and NaN reaching a SQL parameter has crashed this codebase
 * before.
 */
export function parseProfessionalId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function invalidIdResponse(): NextResponse {
  return NextResponse.json(
    { type: '/errors/validation-error', title: 'Invalid professional id', status: 400 },
    { status: 400 },
  );
}

export type ProfessionalScope = {
  kc: KcActor;
  isSelf: boolean;
  /** True when the actor's clinic also maps this doctor. */
  sharesClinic: boolean;
};

/**
 * Resolve the actor and work out their relationship to this professional.
 *
 * Returns `null` when the professional does not exist, so callers 404 rather than
 * leaking existence through a 403.
 */
export async function scopeFor(actor: Actor, professionalId: number): Promise<ProfessionalScope | null> {
  const kc = await resolveKcActor(actor);
  const doctor = await findDoctorById(BigInt(professionalId));
  if (!doctor) return null;

  // Clinic scoping comes from wp_kc_doctor_clinic_mappings, not the JWT's practiceId —
  // that field is a cuid from the retired shadow schema and cannot be compared to a
  // KiviCare clinic id.
  let sharesClinic = false;
  if (kc.clinicId !== null) {
    const mapping = await prisma.kcDoctorClinicMapping.findFirst({
      where: { doctorId: doctor.id, clinicId: kc.clinicId },
      select: { id: true },
    });
    sharesClinic = mapping !== null;
  }

  return { kc, isSelf: kc.wpUserId === doctor.id, sharesClinic };
}

/** May the actor read this professional? */
export function canView(scope: ProfessionalScope, actorRole: Actor['role']): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  // Clinic staff see only their own clinic's professionals.
  if (actorRole === 'CLINIC_ADMIN' || actorRole === 'RECEPTIONIST') return scope.sharesClinic;
  // A professional sees only themselves; anyone else is refused.
  return actorRole === 'PROFESSIONAL' && scope.isSelf;
}

/**
 * May the actor edit this professional?
 *
 * A professional may edit their own profile, but only a restricted field set — the
 * service enforces that separately via `isSelfEdit`.
 */
export function canEdit(scope: ProfessionalScope, actorRole: Actor['role']): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole === 'CLINIC_ADMIN') return scope.sharesClinic;
  return actorRole === 'PROFESSIONAL' && scope.isSelf;
}
