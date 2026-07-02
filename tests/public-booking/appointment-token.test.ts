import { describe, it, expect } from 'vitest';
import { signAppointmentToken, verifyAppointmentToken } from '@/lib/public/appointment-token';

describe('appointment-token', () => {
  it('round-trips a signed token back to the appointment id', () => {
    const token = signAppointmentToken('appt-123');
    expect(token).toContain('.');
    expect(verifyAppointmentToken(token)).toBe('appt-123');
  });

  it('rejects a tampered signature', () => {
    const token = signAppointmentToken('appt-123');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyAppointmentToken(tampered)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyAppointmentToken('garbage')).toBeNull();
    expect(verifyAppointmentToken('')).toBeNull();
    expect(verifyAppointmentToken('a.b.c')).toBeNull();
  });

  it('rejects a token whose id part was swapped', () => {
    const token = signAppointmentToken('appt-123');
    const sig = token.split('.')[1];
    const forgedId = Buffer.from('appt-999').toString('base64url');
    expect(verifyAppointmentToken(`${forgedId}.${sig}`)).toBeNull();
  });
});
