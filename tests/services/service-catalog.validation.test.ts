import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  toFieldErrors,
} from '@/services/service-catalog/validation';

const valid = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001],
};

describe('createServiceSchema', () => {
  it('accepts a minimal body and fills the defaults KiviCare uses', () => {
    const parsed = createServiceSchema.parse(valid);
    expect(parsed.telemedService).toBe('no');
    expect(parsed.status).toBe(1);
    expect(parsed.isPublic).toBe(1);
  });

  it('trims the name and rejects an empty one', () => {
    expect(createServiceSchema.parse({ ...valid, name: '  Terapi  ' }).name).toBe('Terapi');
    expect(createServiceSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('holds KiviCare duration bounds of 1..1440 minutes', () => {
    expect(createServiceSchema.safeParse({ ...valid, duration: 1 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, duration: 1440 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, duration: 0 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, duration: 1441 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, duration: 30.5 }).success).toBe(false);
  });

  it('requires at least one doctor', () => {
    expect(createServiceSchema.safeParse({ ...valid, doctorIds: [] }).success).toBe(false);
  });

  it('rejects a negative price but allows a free service', () => {
    expect(createServiceSchema.safeParse({ ...valid, price: 0 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('constrains the flags to what the columns hold', () => {
    expect(createServiceSchema.safeParse({ ...valid, telemedService: 'maybe' }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, status: 2 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, isPublic: 2 }).success).toBe(false);
  });

  it('rejects maxClients rather than accepting a field the server would drop', () => {
    const parsed = createServiceSchema.parse({ ...valid, maxClients: 4 } as any);
    expect('maxClients' in parsed).toBe(false);
  });
});

describe('updateServiceSchema', () => {
  it('accepts a single field', () => {
    expect(updateServiceSchema.safeParse({ price: 300000 }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('does not accept doctorIds or clinicId — moving a service means delete and recreate', () => {
    const parsed = updateServiceSchema.parse({ price: 1, doctorIds: [1], clinicId: 3 } as any);
    expect('doctorIds' in parsed).toBe(false);
    expect('clinicId' in parsed).toBe(false);
  });
});

describe('listServicesQuerySchema', () => {
  it('defaults the pagination', () => {
    const q = listServicesQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, perPage: 20 });
  });

  it('coerces numeric strings from the query string', () => {
    const q = listServicesQuerySchema.parse({ page: '2', perPage: '50', clinicId: '3' });
    expect(q).toMatchObject({ page: 2, perPage: 50, clinicId: 3 });
  });

  it('reads includeInactive=false as false, which z.coerce.boolean would not', () => {
    expect(listServicesQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
    expect(listServicesQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(listServicesQuerySchema.parse({}).includeInactive).toBeUndefined();
  });

  it('caps perPage at 100', () => {
    expect(listServicesQuerySchema.safeParse({ perPage: '500' }).success).toBe(false);
  });
});

describe('toFieldErrors', () => {
  it('groups zod issues by field path', () => {
    const result = createServiceSchema.safeParse({ ...valid, duration: 0, name: '' });
    expect(result.success).toBe(false);
    const fields = toFieldErrors((result as z.SafeParseError<unknown>).error);
    expect(Object.keys(fields).sort()).toEqual(['duration', 'name']);
    expect(fields.duration[0]).toMatch(/1/);
  });
});
