// tests/services/service-catalog.duration-options.test.ts
import { describe, it, expect } from 'vitest';
import {
  MAX_DURATION_OPTIONS,
  optionName,
  planDurationOptions,
  type ExistingOption,
} from '@/services/service-catalog/duration-options';

const opt = (mappingId: number, durationMinutes: number, charges = '600000'): ExistingOption => ({
  mappingId: BigInt(mappingId), serviceId: BigInt(mappingId + 1000), durationMinutes, charges,
});

describe('optionName', () => {
  it('appends the duration in minutes', () => {
    expect(optionName('Konseling Individu', 90)).toBe('Konseling Individu (90 menit)');
  });

  it('cuts the parent part, never the suffix, to stay within 255 characters', () => {
    const name = optionName('x'.repeat(300), 120);
    expect(name.length).toBe(255);
    expect(name.endsWith(' (120 menit)')).toBe(true);
  });
});

describe('planDurationOptions', () => {
  it('splits the wanted list into create, keep and remove', () => {
    const existing = [opt(11, 90), opt(12, 120)];
    const res = planDurationOptions(existing, [
      { id: 11, duration: 90, charges: '650000' },
      { duration: 150, charges: '900000' },
    ], 60);

    expect(res).toEqual({
      plan: {
        create: [{ duration: 150, charges: '900000' }],
        keep: [{ existing: existing[0], duration: 90, charges: '650000' }],
        remove: [existing[1]],
      },
    });
  });

  it('an empty wanted list removes every option', () => {
    const existing = [opt(11, 90)];
    expect(planDurationOptions(existing, [], 60)).toEqual({ plan: { create: [], keep: [], remove: existing } });
  });

  it(`refuses more than ${MAX_DURATION_OPTIONS} options`, () => {
    const wanted = [30, 45, 90, 120, 150].map((d) => ({ duration: d, charges: '1' }));
    expect(planDurationOptions([], wanted, 60)).toMatchObject({ error: { code: 'duration_option_limit' } });
  });

  it('refuses a duration equal to the parent duration', () => {
    expect(planDurationOptions([], [{ duration: 60, charges: '1' }], 60))
      .toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses two options with the same duration', () => {
    expect(planDurationOptions([], [{ duration: 90, charges: '1' }, { duration: 90, charges: '2' }], 60))
      .toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses the same option id twice', () => {
    expect(planDurationOptions([opt(11, 90)], [
      { id: 11, duration: 90, charges: '1' },
      { id: 11, duration: 120, charges: '1' },
    ], 60)).toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses an id that is not an option of this service', () => {
    expect(planDurationOptions([opt(11, 90)], [{ id: 99, duration: 90, charges: '1' }], 60))
      .toMatchObject({ error: { code: 'duration_option_not_found' } });
  });

  it('with no parent duration only checks the options against each other', () => {
    expect(planDurationOptions([], [{ duration: 60, charges: '1' }], null)).toHaveProperty('plan');
  });
});
