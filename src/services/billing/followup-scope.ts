import type { KcActor } from '@/services/billing/kc-actor';

export interface FollowupScope {
  clinicId?: bigint;
  doctorId?: bigint;
}

/** Role-based row scope for followups + chains (direct clinic_id/doctor_id columns). null = unrestricted. */
export function followupScopeFor(kc: KcActor): FollowupScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null; // unrestricted
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
