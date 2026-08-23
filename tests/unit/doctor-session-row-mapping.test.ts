import { describe, it, expect } from 'vitest';
import { mapDoctorSessionRow } from '@/services/billing/doctor-session.service';

/**
 * Regression: GET /api/v1/doctor-sessions returned mangled practice hours
 * ("1970 18:") because the mapper sliced `String(date)` — which is Date.toString()
 * ("Thu Jan 01 1970 18:00:00 GMT+0000"), not an ISO string. Minutes were lost too,
 * so the FE could not recover the real time.
 *
 * A MySQL TIME column comes back from Prisma raw queries as a Date on 1970-01-01
 * whose UTC clock carries the stored wall-clock, so the whole codebase reads it
 * with toISOString().slice(11, 19) (see repositories/wp/clinic-sessions.repo.ts).
 */
describe('mapDoctorSessionRow — TIME column mapping', () => {
  const row = (start: unknown, end: unknown) => ({
    id: 5, clinic_id: 2, doctor_id: 7, day: 'mon', time_slot: 30,
    start_time: start, end_time: end, clinic_name: 'C', doctor_name: 'D',
  });

  it('formats a Date from a TIME column as HH:mm:ss', () => {
    const m = mapDoctorSessionRow(row(new Date('1970-01-01T18:00:00.000Z'), new Date('1970-01-01T21:00:00.000Z')));
    expect(m.start_time).toBe('18:00:00');
    expect(m.end_time).toBe('21:00:00');
  });

  it('keeps the minutes of a half-hour session', () => {
    const m = mapDoctorSessionRow(row(new Date('1970-01-01T08:30:00.000Z'), new Date('1970-01-01T12:45:00.000Z')));
    expect(m.start_time).toBe('08:30:00');
    expect(m.end_time).toBe('12:45:00');
  });

  it('passes an already-formatted string through untouched', () => {
    const m = mapDoctorSessionRow(row('09:00:00', '17:00:00'));
    expect(m.start_time).toBe('09:00:00');
    expect(m.end_time).toBe('17:00:00');
  });

  it('maps a missing time to null', () => {
    const m = mapDoctorSessionRow(row(null, undefined));
    expect(m.start_time).toBeNull();
    expect(m.end_time).toBeNull();
  });
});
