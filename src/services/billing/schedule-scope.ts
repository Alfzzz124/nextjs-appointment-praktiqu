import type { KcActor } from '@/services/billing/kc-actor';

export interface ScheduleScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function scheduleScopeFor(kc: KcActor): ScheduleScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}

export interface DashboardScope { clinicId?: bigint; doctorId?: bigint }  // null = SUPER_ADMIN
export function dashboardScopeFor(kc: KcActor): DashboardScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
