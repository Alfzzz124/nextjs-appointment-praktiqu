import type { Actor } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { KcActor } from './kc-actor';
import type { BillScope } from './bill.service';

export type Capability =
  | 'patient_bill_list'
  | 'patient_bill_view'
  | 'patient_bill_add'
  | 'patient_bill_delete'
  | 'tax_read'
  | 'tax_manage'
  | 'encounter_read'
  | 'encounter_manage'
  | 'prescription_read'
  | 'prescription_manage'
  | 'medical_history_read'
  | 'medical_history_manage'
  | 'patient_report_read'
  | 'patient_report_manage';

type Role = Actor['role'];

const MATRIX: Record<Capability, Role[]> = {
  patient_bill_list:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_bill_view:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_bill_add:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  patient_bill_delete: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'],
  tax_read:            ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
  tax_manage:          ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  encounter_read:      ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  encounter_manage:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
  prescription_read:      ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  prescription_manage:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
  medical_history_read:   ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  medical_history_manage: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL'],
  patient_report_read:    ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  patient_report_manage:  ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'],
};

export function can(actor: Actor, cap: Capability): boolean {
  return MATRIX[cap].includes(actor.role);
}

/** Gate: throw 403 unless allowed. */
export function assertCan(actor: Actor, cap: Capability): void {
  if (!can(actor, cap)) throw new KcError('Permission denied', 403);
}

/** Faithful equivalent of isModuleEnabled('billing'). */
export async function assertBillingEnabled(): Promise<void> {
  const opt = await prisma.kcOption.findFirst({
    where: { optionName: 'kivicare_pro_modules_config' },
    select: { optionValue: true },
  });
  // Absent option = module enabled (KiviCare defaults modules on).
  if (!opt) return;
  try {
    const cfg = JSON.parse(opt.optionValue) as Record<string, unknown>;
    if (cfg.billing === false || cfg.billing === '0') {
      throw new KcError('Billing module is disabled', 403);
    }
  } catch (err) {
    if (err instanceof KcError) throw err;
    // Non-JSON / unknown shape → treat as enabled.
  }
}

/** Translate a KcActor into a bill query scope (null = unrestricted). */
export function billScopeFor(kc: KcActor): BillScope | null {
  switch (kc.actor.role) {
    case 'SUPER_ADMIN': return null;
    case 'CLINIC_ADMIN':
    case 'RECEPTIONIST': return { clinicId: kc.clinicId ?? -1n };
    case 'PROFESSIONAL': return { doctorId: kc.wpUserId };
    case 'CLIENT': return { patientId: kc.wpUserId };
    default: return { clinicId: -1n };
  }
}
