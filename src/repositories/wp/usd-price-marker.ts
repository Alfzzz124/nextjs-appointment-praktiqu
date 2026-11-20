/**
 * Harga dolar satu baris pemetaan layanan.
 *
 * Disimpan di `wp_kc_service_doctor_mapping.extra` (LONGTEXT), kunci `praktiqu_price_usd`,
 * sebagai string 2 desimal. Kolom yang sama sudah dipakai `duration-option-marker.ts` dan
 * berisi JSON `product_id` warisan di produksi, jadi SETIAP penulisan di sini
 * baca-gabung-tulis — menimpa kolomnya akan memutus fitur opsi durasi.
 *
 * Isi yang tidak sah dibaca sebagai "tidak ada harga dolar", tidak pernah melempar: satu
 * baris rusak tidak boleh menjatuhkan daftar layanan.
 *
 * Kenapa string dan bukan JSON number: `55.10` sebagai number kembali sebagai `55.1`, dan
 * menjumlahkannya sebagai float membuka pintu yang justru ditutup spec 2026-10-06 dengan
 * `Prisma.Decimal`.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { Prisma } from '@prisma/client';

export const USD_PRICE_KEY = 'praktiqu_price_usd';
export const USD_MIN = 0;
export const USD_MAX = 100_000;

/**
 * Desimal polos saja. Notasi ilmiah (`1e3`), tanda (`+5`), titik menggantung (`55.`) dan
 * desimal telanjang (`.5`) semuanya ditolak — `Number()` menerimanya dan akan menyimpan
 * angka yang bukan yang diketik siapa pun.
 */
const SHAPE = /^\d{1,6}(\.\d{1,2})?$/;

/** Selalu 2 desimal — apa yang disimpan dan apa yang dikirim keluar. */
export function formatUsd(v: Prisma.Decimal): string {
  return v.toFixed(2);
}

function toDecimal(text: string): Prisma.Decimal | null {
  if (!SHAPE.test(text)) return null;
  const d = new Prisma.Decimal(text);
  if (d.lt(USD_MIN) || d.gt(USD_MAX)) return null;
  return d;
}

/**
 * Masukan API: hanya string berformat polos. Angka JSON ditolak di sini supaya format
 * penyimpanan dan format masukan punya satu aturan, bukan dua yang bisa berbeda.
 */
export function parseUsdInput(raw: unknown): Prisma.Decimal | null {
  if (typeof raw !== 'string') return null;
  return toDecimal(raw.trim());
}

function parseObject(extra: string | null | undefined): Record<string, unknown> | null {
  if (!extra) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extra);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Harga dolar pada baris ini, atau null. Tidak pernah melempar. */
export function readUsdPrice(extra: string | null | undefined): Prisma.Decimal | null {
  const obj = parseObject(extra);
  if (obj === null) return null;
  const raw = obj[USD_PRICE_KEY];
  if (typeof raw !== 'string') return null;
  return toDecimal(raw.trim());
}

/** `extra` baru dengan harga dolar disetel atau dibuang; kunci lain dipertahankan utuh. */
export function withUsdPrice(extra: string | null | undefined, usd: Prisma.Decimal | null): string {
  const obj = parseObject(extra) ?? {};
  if (usd === null) delete obj[USD_PRICE_KEY];
  else obj[USD_PRICE_KEY] = formatUsd(usd);
  return JSON.stringify(obj);
}

/**
 * Rupiah turunan.
 *
 * `ROUND_HALF_UP`, bukan `ceil`: pembulatan ke atas menaikkan harga tiap kali disimpan.
 * Dan karena rupiahnya selalu diturunkan dari USD — tidak pernah dari rupiah sebelumnya —
 * tidak ada efek merayap berapa kali pun ini dipanggil.
 */
export function idrFromUsd(usd: Prisma.Decimal, rate: Prisma.Decimal): number {
  return usd.mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Prisma `where` untuk kandidat baris ber-harga-dolar. Sengaja tanpa kutip penutup, sama
 * seperti `ANY_OPTION_PROBE`: konfirmasi dengan `readUsdPrice`, karena teks bebas bisa
 * memuat karakter yang sama.
 */
export const ANY_USD_PRICE_PROBE = { extra: { contains: `"${USD_PRICE_KEY}` } };
