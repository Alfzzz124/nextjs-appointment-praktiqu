/**
 * The personal-link slug the Laravel front end derives from a professional's name.
 *
 * It must be exactly what `BookingApi::slugify()` produces: the FE builds the link
 * terpadu.praktiqu.com/{slug} with that function and then asks us to resolve it, so any
 * divergence is a 404 for a real patient. The PHP, which this mirrors step for step, is
 *
 *   trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9]+/', '-', strtolower($name))), '-')
 *
 * Two details decide the port:
 *  - `strtolower` is byte-wise and folds only A–Z (PHP 8.2+ ignores the locale). JavaScript's
 *    `toLowerCase()` is full Unicode: it turns 'İ' into 'i' plus a combining dot, so
 *    "İlham" would slug to "i-lham" here while the FE links to "lham".
 *  - The regex runs without the /u flag, i.e. on bytes. Every byte of a multibyte UTF-8
 *    character lies outside [a-z0-9], so a non-ASCII character dissolves into a '-' run
 *    there exactly as its UTF-16 code units do here. No transliteration on either side.
 */
export function slugifyName(name: string): string {
  return name
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
