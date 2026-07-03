import type { KcActor } from '@/services/billing/kc-actor';

export interface MedReportScope { patientId?: bigint; clinicId?: bigint }

export function medReportScopeFor(kc: KcActor): MedReportScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: kc.clinicId ?? -1n };
  }
}
