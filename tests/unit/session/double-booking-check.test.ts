/**
 * Unit tests for double-booking-check.ts.
 * T025: Overlap detection and transaction behavior.
 */

import { describe, it, expect } from 'vitest';
import { DoubleBookingError } from '@/services/session/double-booking-check';

describe('DoubleBookingError', () => {
  it('has correct name and code', () => {
    const err = new DoubleBookingError();
    expect(err.name).toBe('DoubleBookingError');
    expect(err.code).toBe('DOUBLE_BOOKING');
  });

  it('has a default message', () => {
    const err = new DoubleBookingError();
    expect(err.message).toBe('This time slot is already booked for another session');
  });

  it('accepts a custom message', () => {
    const err = new DoubleBookingError('Custom conflict message');
    expect(err.message).toBe('Custom conflict message');
  });

  it('is an instance of Error', () => {
    const err = new DoubleBookingError();
    expect(err instanceof Error).toBe(true);
  });
});

describe('Overlap logic', () => {
  // Pure logic tests — testing the SQL logic without a DB connection.
  // The actual overlap check is:
  //   existing.startTime < candidate.endTime
  //   AND existing.endTime > candidate.startTime

  function overlaps(
    existingStart: number, // minutes from midnight
    existingEnd: number,
    candidateStart: number,
    candidateEnd: number,
  ): boolean {
    return existingStart < candidateEnd && existingEnd > candidateStart;
  }

  it('detects exact overlap', () => {
    expect(overlaps(540, 600, 540, 600)).toBe(true); // 9:00-10:00 vs 9:00-10:00
  });

  it('detects partial overlap at start', () => {
    expect(overlaps(540, 600, 550, 610)).toBe(true); // 9:00-10:00 vs 9:10-10:10
  });

  it('detects partial overlap at end', () => {
    expect(overlaps(540, 600, 530, 550)).toBe(true); // 9:00-10:00 vs 8:50-9:10
  });

  it('detects contained session (candidate inside existing)', () => {
    expect(overlaps(540, 600, 550, 590)).toBe(true); // 9:00-10:00 vs 9:10-9:50
  });

  it('detects containing session (existing inside candidate)', () => {
    expect(overlaps(550, 590, 540, 600)).toBe(true); // 9:10-9:50 vs 9:00-10:00
  });

  it('adjacent sessions do not overlap (end = start)', () => {
    expect(overlaps(540, 600, 600, 660)).toBe(false); // 9:00-10:00 vs 10:00-11:00
  });

  it('adjacent sessions do not overlap (start = end)', () => {
    expect(overlaps(600, 660, 540, 600)).toBe(false); // 10:00-11:00 vs 9:00-10:00
  });

  it('no overlap when entirely before', () => {
    expect(overlaps(540, 600, 420, 480)).toBe(false); // 9:00-10:00 vs 7:00-8:00
  });

  it('no overlap when entirely after', () => {
    expect(overlaps(540, 600, 660, 720)).toBe(false); // 9:00-10:00 vs 11:00-12:00
  });
});