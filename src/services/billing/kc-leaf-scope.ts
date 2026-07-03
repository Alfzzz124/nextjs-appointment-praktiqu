import type { KcActor } from '@/services/billing/kc-actor';

export interface KcLeafScope {
  patientId?: bigint;
  encDoctorId?: bigint;
  encClinicId?: bigint;
}

export function leafScopeFor(kc: KcActor): KcLeafScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { encClinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { encDoctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { encClinicId: -1n };
  }
}
