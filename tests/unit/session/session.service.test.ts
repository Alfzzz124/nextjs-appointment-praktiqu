/**
 * Unit tests for session.service.ts — status transitions and validation rules.
 * T024: All status transitions and validation rules covered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canTransition, VALID_TRANSITIONS, STATUS_COLOR } from '@/types/session';
import { SessionStatus } from '@prisma/client';

describe('canTransition', () => {
  // PENDING transitions
  it('PENDING -> BOOKED is valid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.BOOKED)).toBe(true);
  });
  it('PENDING -> REJECTED is valid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.REJECTED)).toBe(true);
  });
  it('PENDING -> CANCELLED is valid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.CANCELLED)).toBe(true);
  });
  it('PENDING -> CHECK_IN is invalid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.CHECK_IN)).toBe(false);
  });
  it('PENDING -> CHECK_OUT is invalid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.CHECK_OUT)).toBe(false);
  });
  it('PENDING -> COMPLETED is invalid', () => {
    expect(canTransition(SessionStatus.PENDING, SessionStatus.COMPLETED)).toBe(false);
  });

  // BOOKED transitions
  it('BOOKED -> CHECK_IN is valid', () => {
    expect(canTransition(SessionStatus.BOOKED, SessionStatus.CHECK_IN)).toBe(true);
  });
  it('BOOKED -> CANCELLED is valid', () => {
    expect(canTransition(SessionStatus.BOOKED, SessionStatus.CANCELLED)).toBe(true);
  });
  it('BOOKED -> PENDING is invalid', () => {
    expect(canTransition(SessionStatus.BOOKED, SessionStatus.PENDING)).toBe(false);
  });

  // CHECK_IN transitions
  it('CHECK_IN -> CHECK_OUT is valid', () => {
    expect(canTransition(SessionStatus.CHECK_IN, SessionStatus.CHECK_OUT)).toBe(true);
  });
  it('CHECK_IN -> CANCELLED is invalid', () => {
    expect(canTransition(SessionStatus.CHECK_IN, SessionStatus.CANCELLED)).toBe(false);
  });

  // CHECK_OUT transitions
  it('CHECK_OUT -> COMPLETED is valid', () => {
    expect(canTransition(SessionStatus.CHECK_OUT, SessionStatus.COMPLETED)).toBe(true);
  });

  // Terminal states
  it('REJECTED has no valid transitions', () => {
    expect(VALID_TRANSITIONS[SessionStatus.REJECTED]).toHaveLength(0);
  });
  it('CANCELLED has no valid transitions', () => {
    expect(VALID_TRANSITIONS[SessionStatus.CANCELLED]).toHaveLength(0);
  });
  it('COMPLETED has no valid transitions', () => {
    expect(VALID_TRANSITIONS[SessionStatus.COMPLETED]).toHaveLength(0);
  });
});

describe('STATUS_COLOR', () => {
  it('has a color for every status', () => {
    const statuses = Object.keys(VALID_TRANSITIONS) as SessionStatus[];
    statuses.forEach((s) => {
      expect(STATUS_COLOR[s]).toBeTruthy();
      expect(STATUS_COLOR[s]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('PENDING is yellow', () => {
    expect(STATUS_COLOR.PENDING).toBe('#eab308');
  });
  it('BOOKED is green', () => {
    expect(STATUS_COLOR.BOOKED).toBe('#22c55e');
  });
  it('CHECK_IN is blue', () => {
    expect(STATUS_COLOR.CHECK_IN).toBe('#3b82f6');
  });
  it('CHECK_OUT is purple', () => {
    expect(STATUS_COLOR.CHECK_OUT).toBe('#8b5cf6');
  });
  it('REJECTED is red', () => {
    expect(STATUS_COLOR.REJECTED).toBe('#ef4444');
  });
  it('COMPLETED and CANCELLED are gray', () => {
    expect(STATUS_COLOR.COMPLETED).toBe('#6b7280');
    expect(STATUS_COLOR.CANCELLED).toBe('#6b7280');
  });
});

describe('VALID_TRANSITIONS completeness', () => {
  it('covers all SessionStatus values', () => {
    const statuses = Object.keys(VALID_TRANSITIONS) as SessionStatus[];
    expect(statuses).toHaveLength(7);
  });
});