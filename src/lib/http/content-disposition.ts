/**
 * `Content-Disposition` for a file we are handing back to the client.
 *
 * Filenames here come from clinicians and from clients' own uploads, so they carry
 * quotes, backslashes, newlines and Indonesian diacritics. The quoted form is
 * reduced to safe ASCII — a stray quote truncates the header and a newline injects
 * a second one — while `filename*` carries the real name per RFC 5987.
 */
import { ALLOWED_MIME_TYPES } from '@/services/uploads/validate-upload';

/**
 * Percent-encode a filename for RFC 5987's `filename*`, matching the PHP side's
 * `rawurlencode` (see `class-praktiqu-endpoint-media.php`).
 *
 * `encodeURIComponent` alone leaves `! ' ( ) *` unescaped — RFC 3986 treats them
 * as "sub-delims" safe in a URI component, but RFC 5987 does not carve out that
 * exception for `filename*`, and `rawurlencode` escapes them too. Left alone the
 * two sides of this API disagree, byte for byte, on what the header should say.
 */
function rfc5987Encode(filename: string): string {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** ASCII-only fallback for the quoted `filename` parameter. */
function asciiFallback(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

export function inlineDisposition(filename: string): string {
  return `inline; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}

export function attachmentDisposition(filename: string): string {
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}

/**
 * Decide `inline` vs `attachment` for a file being streamed back, based on its
 * declared mime type.
 *
 * Not every row served through the two `/content` routes went through
 * `validateUpload`: KiviCare's own "Uploaded Reports" panel and every booking
 * attachment in `appointment_report` bypass it entirely, so their mime type is
 * whatever WordPress happened to accept at upload time. `X-Content-Type-Options:
 * nosniff` stops the browser from *guessing* a different type, but it does
 * nothing to stop an honestly-declared `text/html` or `image/svg+xml` from
 * rendering inline and running as script on this origin, where the session
 * lives. So only the five types `validateUpload` itself sniffs and accepts are
 * served `inline`; everything else is still served — just as `attachment`, so a
 * clinician can still download a legitimate `.docx` from the archive.
 */
export function contentDispositionFor(mimeType: string, filename: string): string {
  // `mimeType` here is often a raw upstream `Content-Type` header value verbatim
  // (see `fetchMedia` in `@/lib/wp-endpoint`), which can carry a `; charset=...` /
  // `; boundary=...` parameter and mixed case (`Application/PDF`). `ALLOWED_MIME_TYPES`
  // is the bare, lowercase type only, so an unparsed header missed the allowlist and
  // downgraded a legitimate PDF to `attachment` — safe, but wrong: WordPress hosts are
  // free to emit `application/pdf; charset=binary` and this treated that as unknown.
  const bareType = mimeType.split(';')[0].trim().toLowerCase();
  return ALLOWED_MIME_TYPES.includes(bareType as (typeof ALLOWED_MIME_TYPES)[number])
    ? inlineDisposition(filename)
    : attachmentDisposition(filename);
}
