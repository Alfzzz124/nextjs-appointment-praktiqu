// tests/unit/repositories/duration-option-marker.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANY_OPTION_PROBE,
  optionMarker,
  parseDurationOf,
  readMarker,
  removedMarker,
} from '@/repositories/wp/duration-option-marker';

describe('readMarker', () => {
  it('reads a live marker', () => {
    expect(readMarker('{"praktiqu_duration_of":501}')).toEqual({ parentId: 501n, removed: false });
  });

  it('reads a removed marker', () => {
    expect(readMarker('{"praktiqu_duration_of_removed":501}')).toEqual({ parentId: 501n, removed: true });
  });

  it('accepts the id as a numeric string and tolerates other keys and whitespace', () => {
    expect(readMarker('{ "note": "x", "praktiqu_duration_of" : "77" }')).toEqual({ parentId: 77n, removed: false });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['free text', 'catatan admin: jangan dihapus'],
    ['a JSON array', '[501]'],
    ['a JSON number', '501'],
    ['JSON without our key', '{"currency":"IDR"}'],
    ['zero', '{"praktiqu_duration_of":0}'],
    ['a negative id', '{"praktiqu_duration_of":-3}'],
    ['a fraction', '{"praktiqu_duration_of":1.5}'],
    ['a non-numeric string', '{"praktiqu_duration_of":"abc"}'],
  ])('treats %s as no marker at all', (_label, extra) => {
    expect(readMarker(extra as string | null | undefined)).toBeNull();
  });
});

describe('parseDurationOf', () => {
  it('returns the parent of a live option', () => {
    expect(parseDurationOf(optionMarker(501n))).toBe(501n);
  });

  it('returns null for a removed option: it is no longer an option of anything', () => {
    expect(parseDurationOf(removedMarker(501n))).toBeNull();
  });

  it('returns null for text KiviCare or an admin might have left there', () => {
    expect(parseDurationOf('catatan')).toBeNull();
  });
});

describe('ANY_OPTION_PROBE', () => {
  it('is a substring of both markers, so one LIKE finds live and removed rows', () => {
    const probe = ANY_OPTION_PROBE.extra.contains;
    expect(optionMarker(501n).includes(probe)).toBe(true);
    expect(removedMarker(501n).includes(probe)).toBe(true);
    expect('{"currency":"IDR"}'.includes(probe)).toBe(false);
  });
});
