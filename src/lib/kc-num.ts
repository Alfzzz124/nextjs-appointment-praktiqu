/** Parse a KiviCare varchar amount into a number; non-numeric → fallback. */
export function toNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 2 decimals (currency). */
export function toMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** JSON-safe BigInt → number (kc ids fit in JS safe range in practice). */
export function bigToNum(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'bigint' ? Number(v) : v;
}
