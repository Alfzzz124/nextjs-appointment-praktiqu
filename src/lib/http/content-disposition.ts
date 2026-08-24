/**
 * `Content-Disposition` for a file we are handing back inline.
 *
 * Filenames here come from clinicians and from clients' own uploads, so they carry
 * quotes, backslashes, newlines and Indonesian diacritics. The quoted form is
 * reduced to safe ASCII — a stray quote truncates the header and a newline injects
 * a second one — while `filename*` carries the real name per RFC 5987.
 */
export function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
