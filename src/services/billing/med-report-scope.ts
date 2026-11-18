import type { KcActor } from '@/services/billing/kc-actor';

/**
 * `seenByDoctorId`: only patients this doctor has a QUALIFYING appointment with
 * (BR-10.01, same rule as the psychologist's client list), at any clinic.
 */
export interface MedReportScope { patientId?: bigint; clinicId?: bigint; seenByDoctorId?: bigint }

export function medReportScopeFor(kc: KcActor): MedReportScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLIENT': return { patientId: kc.wpUserId };
    // Not the clinic: that handed a psychologist every colleague's client documents,
    // and `kc.clinicId` is only their first clinic, hiding the clients of a second one.
    case 'PROFESSIONAL': return { seenByDoctorId: kc.wpUserId };
    default: return { clinicId: kc.clinicId ?? -1n };
  }
}
