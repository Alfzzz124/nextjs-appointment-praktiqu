import { describe, it, expect } from 'vitest';
import { can } from '@/services/billing/kc-permissions';
import type { Actor } from '@/lib/auth';

const a = (role: Actor['role']): Actor => ({ id: 'x', role, practiceId: null });

describe('kc-permissions.can', () => {
  it('tax_manage allowed for admins only', () => {
    expect(can(a('SUPER_ADMIN'), 'tax_manage')).toBe(true);
    expect(can(a('CLINIC_ADMIN'), 'tax_manage')).toBe(true);
    expect(can(a('PROFESSIONAL'), 'tax_manage')).toBe(false);
    expect(can(a('RECEPTIONIST'), 'tax_manage')).toBe(false);
  });

  it('patient_bill_add denied for CLIENT', () => {
    expect(can(a('CLIENT'), 'patient_bill_add')).toBe(false);
    expect(can(a('RECEPTIONIST'), 'patient_bill_add')).toBe(true);
  });

  it('patient_bill_delete denied for PROFESSIONAL', () => {
    expect(can(a('PROFESSIONAL'), 'patient_bill_delete')).toBe(false);
    expect(can(a('CLINIC_ADMIN'), 'patient_bill_delete')).toBe(true);
  });

  it('tax read allowed for staff, denied for client', () => {
    expect(can(a('PROFESSIONAL'), 'tax_read')).toBe(true);
    expect(can(a('CLIENT'), 'tax_read')).toBe(false);
  });
});

describe('encounter capabilities', () => {
  it('grants encounter_read to CLIENT and encounter_manage to PROFESSIONAL', () => {
    expect(can({ id: 'x', role: 'CLIENT', practiceId: null }, 'encounter_read')).toBe(true);
    expect(can({ id: 'x', role: 'PROFESSIONAL', practiceId: null }, 'encounter_manage')).toBe(true);
  });
  it('denies encounter_manage to CLIENT', () => {
    expect(can({ id: 'x', role: 'CLIENT', practiceId: null }, 'encounter_manage')).toBe(false);
  });
});

describe('prescription + medical_history capabilities', () => {
  it('read granted to CLIENT, manage denied to CLIENT', () => {
    const client = { id: 'x', role: 'CLIENT', practiceId: null } as const;
    expect(can(client, 'prescription_read')).toBe(true);
    expect(can(client, 'prescription_manage')).toBe(false);
    expect(can(client, 'medical_history_read')).toBe(true);
    expect(can(client, 'medical_history_manage')).toBe(false);
  });
  it('manage granted to PROFESSIONAL', () => {
    const pro = { id: 'x', role: 'PROFESSIONAL', practiceId: null } as const;
    expect(can(pro, 'prescription_manage')).toBe(true);
    expect(can(pro, 'medical_history_manage')).toBe(true);
  });
});
