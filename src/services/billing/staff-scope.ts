import type { KcActor } from '@/services/billing/kc-actor';

// Receptionists: by clinic membership (mapping table). Scope shape:
export interface ReceptionistScope { clinicId?: bigint }  // null = SUPER_ADMIN
export function receptionistScopeFor(kc: KcActor): ReceptionistScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    default: return { clinicId: -1n };  // others can't read (gated by capability anyway)
  }
}

// Doctor sessions: direct columns.
export interface DoctorSessionScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function doctorSessionScopeFor(kc: KcActor): DoctorSessionScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
