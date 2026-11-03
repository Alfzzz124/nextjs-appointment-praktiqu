/**
 * slugifyName must agree with the Laravel FE's BookingApi::slugify() on every input,
 * because the FE builds personal links with it and we resolve them with this.
 *
 * Expected values are what the PHP produces:
 *   trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9]+/', '-', strtolower($name))), '-')
 */
import { describe, expect, it } from 'vitest';
import { slugifyName } from '@/lib/public/professional-slug';

describe('slugifyName', () => {
  it('turns titles and punctuation into single dashes', () => {
    expect(slugifyName('Dianda Azani, M.Psi., Psikolog')).toBe('dianda-azani-m-psi-psikolog');
  });

  it('trims dashes at both ends and collapses runs', () => {
    expect(slugifyName('  --Dr.  Budi -- Santoso--  ')).toBe('dr-budi-santoso');
  });

  it('keeps digits', () => {
    expect(slugifyName('Praktik 24 Jam')).toBe('praktik-24-jam');
  });

  it('folds only ASCII letters, as PHP strtolower does', () => {
    // Full-Unicode toLowerCase would make 'İ' an 'i' plus a combining dot and slug this
    // to "dr-i-lham-elik"; the byte-wise PHP leaves both non-ASCII letters to become '-'.
    expect(slugifyName('Dr. İlham Çelik')).toBe('dr-lham-elik');
    // U+212A KELVIN SIGN lowercases to 'k' in JavaScript, and to nothing in PHP.
    expect(slugifyName('Karin')).toBe('arin');
  });

  it('treats a character outside the BMP as one run, like its UTF-8 bytes', () => {
    expect(slugifyName('Ana 😀 Putri')).toBe('ana-putri');
  });

  it('is idempotent, so an incoming slug normalises to itself', () => {
    const slug = slugifyName('Dianda Azani, M.Psi., Psikolog');
    expect(slugifyName(slug)).toBe(slug);
    expect(slugifyName('Dianda-Azani--M.Psi.-Psikolog-')).toBe(slug);
  });

  it('yields the empty string when nothing is left', () => {
    expect(slugifyName('')).toBe('');
    expect(slugifyName('---')).toBe('');
    expect(slugifyName('Ñ')).toBe('');
  });
});
