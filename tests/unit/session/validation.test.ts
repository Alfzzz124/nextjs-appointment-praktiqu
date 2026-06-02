/**
 * Unit tests for session validation schemas.
 * T025: All Zod schemas covered.
 */

import { describe, it, expect } from 'vitest';
import {
  createSessionSchema,
  rejectSessionSchema,
  cancelSessionSchema,
  listSessionsQuerySchema,
  calendarQuerySchema,
  assertDateRange,
} from '@/services/session/validation';
import { z } from 'zod';

describe('createSessionSchema', () => {
  it('accepts valid input', () => {
    const input = {
      clientId: 'clt_abc123',
      professionalId: 'pro_xyz',
      serviceId: 'svc_123',
      slotDate: '2026-06-10',
      startTime: '2026-06-10T09:00:00.000Z',
    };
    expect(() => createSessionSchema.parse(input)).not.toThrow();
  });

  it('rejects invalid slotDate format', () => {
    expect(() =>
      createSessionSchema.parse({ clientId: 'x', professionalId: 'x', serviceId: 'x', slotDate: '06-10-2026', startTime: '2026-06-10T09:00:00.000Z' })
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => createSessionSchema.parse({ clientId: 'x' })).toThrow();
  });

  it('accepts optional createdBy', () => {
    const input = {
      clientId: 'clt_abc123',
      professionalId: 'pro_xyz',
      serviceId: 'svc_123',
      slotDate: '2026-06-10',
      startTime: '2026-06-10T09:00:00.000Z',
      createdBy: 'staff_user_123',
    };
    expect(() => createSessionSchema.parse(input)).not.toThrow();
  });
});

describe('rejectSessionSchema', () => {
  it('accepts reason within limit', () => {
    expect(() =>
      rejectSessionSchema.parse({ reason: 'Schedule conflict, please rebook' })
    ).not.toThrow();
  });

  it('rejects empty reason', () => {
    expect(() => rejectSessionSchema.parse({ reason: '   ' })).toThrow();
  });

  it('rejects reason exceeding 500 chars', () => {
    const longReason = 'x'.repeat(501);
    expect(() => rejectSessionSchema.parse({ reason: longReason })).toThrow();
  });
});

describe('cancelSessionSchema', () => {
  it('accepts empty body (reason optional)', () => {
    expect(() => cancelSessionSchema.parse({})).not.toThrow();
  });

  it('accepts empty string reason', () => {
    expect(() => cancelSessionSchema.parse({ reason: '' })).not.toThrow();
  });

  it('rejects reason exceeding 500 chars', () => {
    expect(() => cancelSessionSchema.parse({ reason: 'x'.repeat(501) })).toThrow();
  });
});

describe('listSessionsQuerySchema', () => {
  it('applies defaults', () => {
    const result = listSessionsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts valid enum for status', () => {
    const result = listSessionsQuerySchema.parse({ status: 'PENDING' });
    expect(result.status).toBe('PENDING');
  });

  it('clamps limit to max 100', () => {
    const result = listSessionsQuerySchema.parse({ limit: 200 });
    expect(result.limit).toBe(100);
  });

  it('rejects limit < 1', () => {
    expect(() => listSessionsQuerySchema.parse({ limit: 0 })).toThrow();
  });
});

describe('calendarQuerySchema', () => {
  it('accepts valid views', () => {
    expect(calendarQuerySchema.parse({ view: 'day' }).view).toBe('day');
    expect(calendarQuerySchema.parse({ view: 'week' }).view).toBe('week');
    expect(calendarQuerySchema.parse({ view: 'month' }).view).toBe('month');
  });

  it('defaults to day', () => {
    expect(calendarQuerySchema.parse({}).view).toBe('day');
  });

  it('rejects invalid view', () => {
    expect(() => calendarQuerySchema.parse({ view: 'year' })).toThrow();
  });
});

describe('assertDateRange', () => {
  it('does not throw when dateFrom <= dateTo', () => {
    expect(() => assertDateRange({ dateFrom: '2026-06-01', dateTo: '2026-06-30' })).not.toThrow();
  });

  it('does not throw when only one bound is set', () => {
    expect(() => assertDateRange({ dateFrom: '2026-06-01' })).not.toThrow();
    expect(() => assertDateRange({ dateTo: '2026-06-30' })).not.toThrow();
  });

  it('throws when dateFrom > dateTo', () => {
    expect(() => assertDateRange({ dateFrom: '2026-06-30', dateTo: '2026-06-01' })).toThrow();
  });
});