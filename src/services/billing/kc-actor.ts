import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';

export interface KcActor {
  actor: Actor;
  wpUserId: bigint;          // = wp_users.ID; used as doctor_id / patient_id
  clinicId: bigint | null;   // resolved clinic for CLINIC_ADMIN / RECEPTIONIST / PROFESSIONAL
}

/** Resolve the JWT actor to KiviCare ids. */
export async function resolveKcActor(actor: Actor): Promise<KcActor> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { wpUserId: true },
  });
  if (!user?.wpUserId) {
    throw new KcError('User is not linked to a WordPress account', 403);
  }
  const wpUserId = user.wpUserId;

  let clinicId: bigint | null = null;
  if (actor.role === 'CLINIC_ADMIN' || actor.role === 'PROFESSIONAL' || actor.role === 'RECEPTIONIST') {
    const mapping = await prisma.kcDoctorClinicMapping.findFirst({
      where: { doctorId: wpUserId },
      select: { clinicId: true },
    });
    clinicId = mapping?.clinicId ?? null;
    // Fallback for clinic admins who own a clinic but have no doctor mapping.
    if (clinicId === null && actor.role === 'CLINIC_ADMIN') {
      const owned = await prisma.kcClinic.findFirst({
        where: { clinicAdminId: wpUserId },
        select: { id: true },
      });
      clinicId = owned?.id ?? null;
    }
  }
  return { actor, wpUserId, clinicId };
}
