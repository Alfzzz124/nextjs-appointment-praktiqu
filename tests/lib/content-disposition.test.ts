import { describe, expect, it } from 'vitest';
import { inlineDisposition } from '@/lib/http/content-disposition';

describe('inlineDisposition', () => {
  it('emits both the ASCII fallback and the UTF-8 form', () => {
    expect(inlineDisposition('resume.pdf'))
      .toBe(`inline; filename="resume.pdf"; filename*=UTF-8''resume.pdf`);
  });

  it('neutralises a quote, which would otherwise truncate the header', () => {
    const out = inlineDisposition('he said "hi".pdf');
    expect(out).toContain('filename="he said _hi_.pdf"');
    expect(out.split('filename="')[1].split('"')[0]).not.toContain('"');
  });

  it('neutralises a backslash', () => {
    expect(inlineDisposition('a\\b.pdf')).toContain('filename="a_b.pdf"');
  });

  it('keeps non-ASCII in the UTF-8 form and replaces it in the fallback', () => {
    const out = inlineDisposition('sesi-ké-3.pdf');
    expect(out).toContain('filename="sesi-k_-3.pdf"');
    expect(out).toContain(`filename*=UTF-8''${encodeURIComponent('sesi-ké-3.pdf')}`);
  });

  it('replaces a newline, which would inject a second header', () => {
    expect(inlineDisposition('a\nb.pdf')).toContain('filename="a_b.pdf"');
  });

  it('replaces a lone carriage return, which would also inject a second header', () => {
    expect(inlineDisposition('a\rb.pdf'))
      .toBe(`inline; filename="a_b.pdf"; filename*=UTF-8''a%0Db.pdf`);
  });

  it('keeps a semicolon inside the quoted string — it is valid there', () => {
    expect(inlineDisposition('a;b.pdf'))
      .toBe(`inline; filename="a;b.pdf"; filename*=UTF-8''a%3Bb.pdf`);
  });

  it('handles the empty string', () => {
    expect(inlineDisposition(''))
      .toBe(`inline; filename=""; filename*=UTF-8''`);
  });

  it("encodes ! ' ( ) * in filename* like PHP's rawurlencode, not bare encodeURIComponent", () => {
    // encodeURIComponent treats these five as safe "sub-delims" and leaves them
    // unescaped; rawurlencode (and the PHP side of this API) escapes them. Assert
    // the exact percent-encoding, not just that it "looks encoded", so a
    // regression back to bare encodeURIComponent is caught.
    const out = inlineDisposition("a!b'c(d)e*f.pdf");
    expect(out).toBe(
      `inline; filename="a!b'c(d)e*f.pdf"; filename*=UTF-8''a%21b%27c%28d%29e%2Af.pdf`,
    );
  });
});
