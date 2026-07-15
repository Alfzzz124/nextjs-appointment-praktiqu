import { describe, it, expect } from 'vitest';
import {
  sniffMime,
  extensionOf,
  validateUpload,
  MAX_UPLOAD_BYTES,
} from '@/services/uploads/validate-upload';

/** Minimal valid magic-byte prefixes, padded so they are non-empty. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size (ignored)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const PHP_SCRIPT = new Uint8Array([...Buffer.from('<?php system($_GET["c"]); ?>', 'utf8')]);
const SVG = new Uint8Array([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')]);

describe('sniffMime', () => {
  it('detects each allowed type from its magic bytes', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(GIF)).toBe('image/gif');
    expect(sniffMime(WEBP)).toBe('image/webp');
    expect(sniffMime(PDF)).toBe('application/pdf');
  });

  it('returns null for content that is not an allowed type', () => {
    expect(sniffMime(PHP_SCRIPT)).toBeNull();
    expect(sniffMime(SVG)).toBeNull();
    expect(sniffMime(new Uint8Array([0x00]))).toBeNull();
  });

  it('does not mistake a bare RIFF container for WebP', () => {
    const riffWav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffMime(riffWav)).toBeNull();
  });
});

describe('extensionOf', () => {
  it('lowercases and strips the leading dot', () => {
    expect(extensionOf('Scan.PDF')).toBe('pdf');
    expect(extensionOf('a.b.png')).toBe('png');
  });

  it('returns an empty string when there is no usable extension', () => {
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('validateUpload', () => {
  it('accepts a well-formed PNG', () => {
    expect(validateUpload({ name: 'x.png', bytes: PNG })).toEqual({
      ok: true, mime: 'image/png', ext: 'png',
    });
  });

  it('accepts jpg and jpeg for JPEG content', () => {
    expect(validateUpload({ name: 'x.jpg', bytes: JPEG }).ok).toBe(true);
    expect(validateUpload({ name: 'x.jpeg', bytes: JPEG }).ok).toBe(true);
  });

  it('accepts a PDF', () => {
    expect(validateUpload({ name: 'report.pdf', bytes: PDF })).toEqual({
      ok: true, mime: 'application/pdf', ext: 'pdf',
    });
  });

  it('rejects an empty file', () => {
    const r = validateUpload({ name: 'x.png', bytes: new Uint8Array(0) });
    expect(r).toMatchObject({ ok: false, error: 'EMPTY_FILE' });
  });

  it('rejects a file over the 10 MB limit', () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(PNG, 0);
    const r = validateUpload({ name: 'x.png', bytes: oversized });
    expect(r).toMatchObject({ ok: false, error: 'TOO_LARGE' });
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES);
    atLimit.set(PNG, 0);
    expect(validateUpload({ name: 'x.png', bytes: atLimit }).ok).toBe(true);
  });

  it('rejects a PHP script even when named .png', () => {
    const r = validateUpload({ name: 'shell.png', bytes: PHP_SCRIPT });
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_TYPE' });
  });

  it('rejects an SVG', () => {
    const r = validateUpload({ name: 'x.svg', bytes: SVG });
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_TYPE' });
  });

  // The dangerous case: real image bytes carrying an executable extension.
  it('rejects real PNG bytes named .php', () => {
    const r = validateUpload({ name: 'payload.php', bytes: PNG });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });

  it('rejects content whose type disagrees with its extension', () => {
    const r = validateUpload({ name: 'x.png', bytes: PDF });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });

  it('rejects a file with no extension', () => {
    const r = validateUpload({ name: 'noext', bytes: PNG });
    expect(r).toMatchObject({ ok: false, error: 'EXTENSION_MISMATCH' });
  });
});
