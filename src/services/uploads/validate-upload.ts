/**
 * Pure validation for uploaded files. No I/O — every branch is unit-testable.
 *
 * The type is decided by magic bytes and must also agree with the filename
 * extension. Extension alone is never trusted: a PHP script named `.png` must
 * not pass, and real PNG bytes named `.php` must not pass either.
 */

export const MAX_UPLOAD_MB = 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export type AllowedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

/** Extensions each sniffed type is allowed to carry. */
export const EXTENSIONS_BY_MIME: Record<AllowedMime, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
};

export type UploadValidationError =
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'EXTENSION_MISMATCH';

export interface UploadCandidate {
  name: string;
  bytes: Uint8Array;
}

export type ValidationResult =
  | { ok: true; mime: AllowedMime; ext: string }
  | { ok: false; error: UploadValidationError; message: string };

/** Identify an allowed type by its magic bytes, or null if unrecognised. */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  const at = (sig: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // WebP is a RIFF container: "RIFF" .... "WEBP". Both markers are required.
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** Lowercased extension without the dot, or '' when absent. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function validateUpload(file: UploadCandidate): ValidationResult {
  if (file.bytes.length === 0) {
    return { ok: false, error: 'EMPTY_FILE', message: 'File is empty' };
  }
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'TOO_LARGE',
      message: `File exceeds the ${MAX_UPLOAD_MB} MB limit`,
    };
  }
  const mime = sniffMime(file.bytes);
  if (!mime) {
    return {
      ok: false,
      error: 'UNSUPPORTED_TYPE',
      message: 'Unsupported file type — allowed: JPG, PNG, WebP, GIF, PDF',
    };
  }
  const ext = extensionOf(file.name);
  if (!EXTENSIONS_BY_MIME[mime].includes(ext)) {
    return {
      ok: false,
      error: 'EXTENSION_MISMATCH',
      message: `File content (${mime}) does not match the "${ext || 'missing'}" extension`,
    };
  }
  return { ok: true, mime, ext };
}
