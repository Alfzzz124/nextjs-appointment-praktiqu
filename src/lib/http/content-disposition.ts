/**
 * `Content-Disposition` for a file we are handing back inline.
 *
 * Filenames here come from clinicians and from clients' own uploads, so they carry
 * quotes, backslashes, newlines and Indonesian diacritics. The quoted form is
 * reduced to safe ASCII — a stray quote truncates the header and a newline injects
 * a second one — while `filename*` carries the real name per RFC 5987.
 */

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

export function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}
