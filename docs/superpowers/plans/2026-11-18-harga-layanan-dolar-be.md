# Harga layanan dalam dolar — Implementation Plan (Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klinik internasional bisa menetapkan harga layanan langsung dalam dolar; dolar itu
yang ditagih persis, dan rupiah diturunkan darinya.

**Architecture:** Harga dolar disimpan per baris pemetaan sebagai kunci JSON
`praktiqu_price_usd` di `wp_kc_service_doctor_mapping.extra`. `buildUsdQuote()` mendapat cabang
baru di depan: kalau setiap baris item punya harga dolar, totalnya adalah jumlah harga itu —
tanpa markup, tanpa biaya tetap, tanpa baris pajak. Rupiah selalu diturunkan ulang dari dolar
pada kurs saat itu; `charges` hanya cermin untuk layar KiviCare.

**Tech Stack:** Next.js 14 App Router, Prisma (MySQL, satu DB berisi tabel app + `wp_*`), zod,
vitest, `Prisma.Decimal` untuk semua uang.

**Spec:** `docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md`

## Global Constraints

- **Uang selalu `Prisma.Decimal`, tidak pernah float.** Urutan operasinya tetap: semua perkalian
  dulu, lalu TEPAT SATU pembagian, lalu pembulatan.
- **Harga dolar disimpan sebagai string 2 desimal**, hasil `Decimal.toFixed(2)`. Tidak pernah
  sebagai JSON number.
- **Rupiah turunan** = `Decimal(usd).mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)`.
  `ROUND_HALF_UP`, bukan `ceil`.
- **Kurs yang dipakai menurunkan rupiah adalah kurs efektif klinik TANPA markup.**
- **`extra` ditulis baca-gabung-tulis.** Kolom itu sudah berisi `praktiqu_duration_of` dan JSON
  `product_id` warisan. Menimpanya memutus fitur opsi durasi.
- **Lima vektor emas di `tests/payments/intl-pricing.test.ts` wajib tetap hijau tanpa diubah.**
  Jalur konversi lama tidak boleh bergeser satu sen pun.
- **Plugin WordPress tidak disentuh.** Tidak ada hook job baru (ada allow-list di
  `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php:92`).
- **Rentang harga dolar:** 0,00 sampai 100.000,00; maksimal 2 desimal. `"0.00"` sah dan
  berarti gratis.
- Perintah: `npm run type-check`, `npx vitest run <path>`, `npm test`.

---

### Task 1: Modul penanda harga dolar

**Files:**
- Create: `src/repositories/wp/usd-price-marker.ts`
- Test: `tests/unit/repositories/usd-price-marker.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  - `USD_PRICE_KEY = 'praktiqu_price_usd'`
  - `readUsdPrice(extra: string | null | undefined): Prisma.Decimal | null`
  - `formatUsd(v: Prisma.Decimal): string` — selalu 2 desimal
  - `withUsdPrice(extra: string | null | undefined, usd: Prisma.Decimal | null): string`
  - `parseUsdInput(raw: unknown): Prisma.Decimal | null` — validasi masukan API
  - `idrFromUsd(usd: Prisma.Decimal, rate: Prisma.Decimal): number`
  - `ANY_USD_PRICE_PROBE` — `where` Prisma untuk mencari baris ber-harga-dolar

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// tests/unit/repositories/usd-price-marker.test.ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  idrFromUsd, parseUsdInput, readUsdPrice, withUsdPrice,
} from '@/repositories/wp/usd-price-marker';

const D = (s: string) => new Prisma.Decimal(s);

describe('readUsdPrice', () => {
  it('membaca harga yang sah', () => {
    expect(readUsdPrice('{"praktiqu_price_usd":"55.00"}')?.toFixed(2)).toBe('55.00');
  });
  it('0.00 sah dan berarti gratis, bukan tidak ada', () => {
    expect(readUsdPrice('{"praktiqu_price_usd":"0.00"}')?.toFixed(2)).toBe('0.00');
  });
  it.each([
    ['null', null],
    ['kosong', ''],
    ['bukan JSON', 'bukan json'],
    ['array', '[1,2]'],
    ['kunci tidak ada', '{"product_id":9}'],
    ['number, bukan string', '{"praktiqu_price_usd":55}'],
    ['tiga desimal', '{"praktiqu_price_usd":"55.123"}'],
    ['di atas batas', '{"praktiqu_price_usd":"100000.01"}'],
    ['negatif', '{"praktiqu_price_usd":"-1.00"}'],
  ])('%s dibaca sebagai tidak ada', (_label, extra) => {
    expect(readUsdPrice(extra)).toBeNull();
  });
});

describe('withUsdPrice', () => {
  it('mempertahankan penanda opsi durasi', () => {
    const out = withUsdPrice('{"praktiqu_duration_of":12}', D('30'));
    const parsed = JSON.parse(out);
    expect(parsed.praktiqu_duration_of).toBe(12);
    expect(parsed.praktiqu_price_usd).toBe('30.00');
  });
  it('mempertahankan product_id warisan', () => {
    const parsed = JSON.parse(withUsdPrice('{"product_id":"771"}', D('5.5')));
    expect(parsed.product_id).toBe('771');
    expect(parsed.praktiqu_price_usd).toBe('5.50');
  });
  it('null membuang kuncinya dan menyisakan sisanya', () => {
    const parsed = JSON.parse(withUsdPrice('{"praktiqu_duration_of":12,"praktiqu_price_usd":"30.00"}', null));
    expect(parsed.praktiqu_duration_of).toBe(12);
    expect('praktiqu_price_usd' in parsed).toBe(false);
  });
  it('extra yang tidak terbaca diganti objek baru', () => {
    expect(JSON.parse(withUsdPrice('rusak', D('1')))).toEqual({ praktiqu_price_usd: '1.00' });
  });
});

describe('parseUsdInput', () => {
  it.each(['55', '55.0', '55.00', '0', '0.00', '100000.00'])('menerima %s', (raw) => {
    expect(parseUsdInput(raw)).not.toBeNull();
  });
  it.each([55, '55.123', '-1', '', ' ', 'abc', '100000.01', '1e3', '.5', '+5', null, undefined])(
    'menolak %s', (raw) => { expect(parseUsdInput(raw)).toBeNull(); },
  );
});

describe('idrFromUsd', () => {
  it('membulatkan setengah ke atas', () => {
    expect(idrFromUsd(D('55.00'), D('16500'))).toBe(907500);
    expect(idrFromUsd(D('1.00'), D('16432.75'))).toBe(16433);
  });
  it('tidak merayap walau diturunkan sepuluh kali', () => {
    const hasil = Array.from({ length: 10 }, () => idrFromUsd(D('55.00'), D('16500')));
    expect(new Set(hasil).size).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/unit/repositories/usd-price-marker.test.ts`
Expected: FAIL — `Cannot find module '@/repositories/wp/usd-price-marker'`

- [ ] **Step 3: Tulis implementasinya**

```ts
// src/repositories/wp/usd-price-marker.ts
/**
 * Harga dolar satu baris pemetaan, disimpan di `wp_kc_service_doctor_mapping.extra`.
 *
 * Kolom yang sama dipakai `duration-option-marker.ts` dan berisi JSON `product_id` warisan
 * di produksi, jadi setiap penulisan di sini baca-gabung-tulis. Isi yang tidak sah dibaca
 * sebagai "tidak ada harga dolar", tidak pernah melempar: satu baris rusak tidak boleh
 * menjatuhkan daftar layanan.
 *
 * Spec: docs/superpowers/specs/2026-11-18-harga-layanan-dolar-design.md §1
 */
import { Prisma } from '@prisma/client';

export const USD_PRICE_KEY = 'praktiqu_price_usd';
export const USD_MIN = 0;
export const USD_MAX = 100_000;

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

/** Masukan API: hanya string berformat polos. Angka JSON ditolak (lihat Global Constraints). */
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

/** Rupiah turunan. ROUND_HALF_UP, dan selalu dari USD — tidak pernah dari rupiah sebelumnya. */
export function idrFromUsd(usd: Prisma.Decimal, rate: Prisma.Decimal): number {
  return usd.mul(rate).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Kandidat baris ber-harga-dolar. Sengaja tanpa kutip penutup, sama seperti
 * `ANY_OPTION_PROBE`: konfirmasi dengan `readUsdPrice`, karena teks bebas bisa memuat
 * karakter yang sama.
 */
export const ANY_USD_PRICE_PROBE = { extra: { contains: `"${USD_PRICE_KEY}` } };
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/unit/repositories/usd-price-marker.test.ts`
Expected: PASS, semuanya.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/usd-price-marker.ts tests/unit/repositories/usd-price-marker.test.ts
git commit -m "feat(harga-dolar): penanda harga dolar di extra pemetaan layanan"
```

---

### Task 2: Cabang dolar di `buildUsdQuote`

**Files:**
- Modify: `src/services/payments/intl-pricing.ts`
- Test: `tests/payments/intl-pricing.usd-direct.test.ts` (baru; file tes yang ada TIDAK diubah)

**Interfaces:**
- Consumes: `idrFromUsd` (Task 1).
- Produces:
  - `PaymentLineItem` bertambah `priceUsd?: string | null`
  - `isUsdDirect(items: PaymentLineItem[]): boolean`
  - `ChargeSnapshot` bertambah `pricing: 'usd_direct' | 'converted'`
  - `buildUsdQuote` dan `gateUsdPayment` sadar jalur dolar

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// tests/payments/intl-pricing.usd-direct.test.ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { buildUsdQuote, gateUsdPayment, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';

const settings = (over: Partial<ClinicPaymentSettings> = {}): ClinicPaymentSettings => ({
  clinicId: 44,
  international: true,
  methods: ['xendit', 'paypal', 'card'],
  rate: new Prisma.Decimal('16500'),
  markupPercent: new Prisma.Decimal('10'),
  fixedFeeIdr: new Prisma.Decimal('25000'),
  source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
  problems: [],
  ...over,
});

describe('jalur dolar', () => {
  it('menagih persis harga dolarnya, tanpa markup dan tanpa biaya tetap', () => {
    const q = buildUsdQuote([{ name: 'Konseling', price: 907500, priceUsd: '55.00' }], [], settings());
    expect(q!.totalUsd).toBe('55.00');
    expect(q!.lines).toHaveLength(1);
    expect(q!.snapshot.pricing).toBe('usd_direct');
  });

  it('mengabaikan baris pajak', () => {
    const q = buildUsdQuote(
      [{ name: 'Konseling', price: 907500, priceUsd: '55.00' }],
      [{ name: 'PPN', amount: 90750 }],
      settings(),
    );
    expect(q!.totalUsd).toBe('55.00');
    expect(q!.lines.every((l) => l.kind === 'item')).toBe(true);
  });

  it('menurunkan rupiah dari dolar, bukan memakai `price` yang basi', () => {
    const q = buildUsdQuote([{ name: 'Konseling', price: 1, priceUsd: '55.00' }], [], settings());
    expect(q!.lines[0].idr).toBe(907500);
    expect(q!.expectedIdr).toBe(907500);
  });

  it('kurs yang dicatat tanpa markup', () => {
    const q = buildUsdQuote([{ name: 'K', price: 0, priceUsd: '55.00' }], [], settings());
    expect(q!.effectiveFxRate).toBe('16500');
  });

  it('menjumlahkan beberapa baris', () => {
    const q = buildUsdQuote(
      [{ name: 'A', price: 0, priceUsd: '55.00' }, { name: 'B', price: 0, priceUsd: '12.50' }],
      [], settings(),
    );
    expect(q!.totalUsd).toBe('67.50');
  });

  it('satu baris tanpa harga dolar mengembalikan SELURUH order ke jalur lama', () => {
    const q = buildUsdQuote(
      [{ name: 'A', price: 200000, priceUsd: '55.00' }, { name: 'B', price: 200000 }],
      [], settings({ markupPercent: new Prisma.Decimal('10'), fixedFeeIdr: new Prisma.Decimal('0'), rate: new Prisma.Decimal('18000') }),
    );
    expect(q!.snapshot.pricing).toBe('converted');
    expect(q!.lines[0].usd).toBe('12.23');
  });

  it('order dolar nol tetap gratis walau rupiahnya bukan nol', () => {
    expect(buildUsdQuote([{ name: 'A', price: 907500, priceUsd: '0.00' }], [], settings())).toBeNull();
  });

  it('gerbang menolak order dolar nol dengan not_allowed, bukan rate_missing', () => {
    const g = gateUsdPayment([{ name: 'A', price: 907500, priceUsd: '0.00' }], [], settings());
    expect(g).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('gerbang menjawab rate_missing saat klinik internasional tanpa kurs', () => {
    const g = gateUsdPayment([{ name: 'A', price: 0, priceUsd: '55.00' }], [], settings({ rate: null, source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' } }));
    expect(g).toEqual({ ok: false, reason: 'rate_missing' });
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/payments/intl-pricing.usd-direct.test.ts`
Expected: FAIL — `snapshot.pricing` undefined dan total `60.50`, bukan `55.00`.

- [ ] **Step 3: Ubah `intl-pricing.ts`**

Tambahkan impor dan tipe:

```ts
import { idrFromUsd } from '@/repositories/wp/usd-price-marker';
```

`PaymentLineItem` ada di `payment.service.ts`; tambahkan ruas opsionalnya di sana:

```ts
export interface PaymentLineItem {
  name: string;
  price: number;
  /** Harga dolar baris ini kalau layanannya ber-harga-dolar. Spec §2. */
  priceUsd?: string | null;
}
```

Di `intl-pricing.ts`:

```ts
/** Order dolar penuh: ada barisnya, dan SETIAP baris item punya harga dolar. */
export function isUsdDirect(items: PaymentLineItem[]): boolean {
  return items.length > 0 && items.every((i) => typeof i.priceUsd === 'string' && i.priceUsd !== '');
}

function usdCentsOf(items: PaymentLineItem[]): Decimal {
  return items.reduce((sum, i) => sum.plus(new Decimal(i.priceUsd as string).mul(100)), new Decimal(0));
}

/**
 * Jalur dolar (spec §2). Angka yang diketik admin adalah angka terakhir: tidak ada markup,
 * tidak ada biaya tetap, tidak ada baris pajak. Rupiahnya diturunkan ULANG dari dolar pada
 * kurs saat ini — `item.price` bisa saja cermin `charges` yang belum distempel ulang.
 */
function usdDirectQuote(
  items: PaymentLineItem[],
  settings: ClinicPaymentSettings,
  rate: Decimal,
  rateSource: ValueSource,
): UsdQuote | null {
  const totalCents = usdCentsOf(items);
  if (totalCents.lte(0)) return null;

  const lines: UsdLine[] = items.map((i) => {
    const usd = new Decimal(i.priceUsd as string);
    return { kind: 'item' as const, name: i.name, idr: idrFromUsd(usd, rate), usd: usd.toFixed(2) };
  });

  return {
    lines,
    totalUsd: centsToUsd(totalCents),
    totalCents: totalCents.toNumber(),
    expectedIdr: lines.reduce((sum, l) => sum + l.idr, 0),
    effectiveFxRate: rate.toString(),
    snapshot: {
      clinicId: settings.clinicId,
      fxRate: rate.toString(),
      markupPercent: settings.markupPercent.toString(),
      fixedFeeIdr: settings.fixedFeeIdr.toString(),
      source: { fxRate: rateSource, markupPercent: settings.source.markupPercent, fixedFeeIdr: settings.source.fixedFeeIdr },
      pricing: 'usd_direct',
    },
  };
}
```

`ChargeSnapshot` bertambah satu ruas, dan jalur lama mengisinya `'converted'`:

```ts
export interface ChargeSnapshot {
  clinicId: number;
  fxRate: string;
  markupPercent: string;
  fixedFeeIdr: string;
  source: { fxRate: ValueSource; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
  /** Jalur mana yang dipakai. Supaya riwayat order bisa dibaca tanpa menebak. */
  pricing: 'usd_direct' | 'converted';
}
```

`buildUsdQuote` mendapat cabang di depan, SEBELUM pemeriksaan order gratis versi rupiah:

```ts
export function buildUsdQuote(items, taxes, settings): UsdQuote | null {
  const rate = settings.rate;
  const rateSource = settings.source.fxRate;
  if (!settings.international || rate === null || rateSource === null) return null;

  if (isUsdDirect(items)) return usdDirectQuote(items, settings, rate, rateSource);

  const expectedIdr = paidTotalIdr(items, taxes);
  if (expectedIdr <= 0) return null;
  // ... sisanya tidak berubah, selain `pricing: 'converted'` di snapshot
}
```

`gateUsdPayment` memakai definisi "gratis" yang sesuai jalurnya, supaya order dolar pada baris
`charges` yang basi tidak salah dibaca sebagai gratis:

```ts
export function gateUsdPayment(items, taxes, settings): UsdGate {
  if (!settings.international) return { ok: false, reason: 'not_allowed' };
  const free = isUsdDirect(items) ? usdCentsOf(items).lte(0) : paidTotalIdr(items, taxes) <= 0;
  if (free) return { ok: false, reason: 'not_allowed' };
  if (settings.rate === null) return { ok: false, reason: 'rate_missing' };
  const quote = buildUsdQuote(items, taxes, settings);
  if (quote === null) return { ok: false, reason: 'rate_missing' };
  return { ok: true, quote };
}
```

- [ ] **Step 4: Jalankan kedua berkas tes**

Run: `npx vitest run tests/payments/intl-pricing.usd-direct.test.ts tests/payments/intl-pricing.test.ts`
Expected: PASS keduanya. Lima vektor emas di berkas lama **tidak berubah** dan tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add src/services/payments/intl-pricing.ts src/services/payments/payment.service.ts tests/payments/intl-pricing.usd-direct.test.ts
git commit -m "feat(harga-dolar): jalur tagih langsung dolar tanpa markup dan biaya tetap"
```

---

### Task 3: Baca harga dolar dari repositori layanan

**Files:**
- Modify: `src/repositories/wp/services.repo.ts` (`ClinicServiceRow`, `toClinicService`)
- Test: `tests/repositories/wp-services-usd.repo.test.ts`

**Interfaces:**
- Consumes: `readUsdPrice`, `formatUsd` (Task 1).
- Produces: `ClinicServiceRow` bertambah `priceUsd: string | null` dan `extra: string | null`.

`extra` ikut diekspos karena jalur tulis (Task 4) harus menggabungkannya, dan membacanya
ulang dari DB berarti satu query tambahan per baris.

- [ ] **Step 1: Tulis tes yang gagal** — baris pemetaan dengan `extra`
  `{"praktiqu_duration_of":12,"praktiqu_price_usd":"30.00"}` menghasilkan
  `priceUsd === '30.00'` **dan** `optionOf.parentId === 12n`. Baris tanpa kunci itu
  menghasilkan `priceUsd === null`.

- [ ] **Step 2: Jalankan, pastikan gagal** — `priceUsd` tidak ada di tipe.

- [ ] **Step 3: Implementasi** — tambahkan ke tipe dan ke `toClinicService`:

```ts
  extra: m.extra,
  priceUsd: (() => { const d = readUsdPrice(m.extra); return d === null ? null : formatUsd(d); })(),
```

- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): priceUsd pada baris layanan`

---

### Task 4: Tulis harga dolar lewat API layanan

**Files:**
- Modify: `src/services/service-catalog/validation.ts`
- Modify: `src/services/service-catalog/service.ts`
- Modify: `src/repositories/wp/services.write.ts`
- Modify: `src/repositories/wp/duration-option-marker.ts`
- Test: `tests/services/service-catalog.usd-price.test.ts`

**Interfaces:**
- Consumes: `parseUsdInput`, `withUsdPrice`, `idrFromUsd`, `formatUsd` (Task 1);
  `ClinicServiceRow.priceUsd`, `.extra` (Task 3); `resolveClinicPayment` dari
  `src/services/payments/clinic-payment.service.ts`.
- Produces: `ServiceSummary` bertambah `priceUsd` dan `priceUsdSuggested`;
  `MappingPatch` bertambah `extra?: string`; `OptionInsert` bertambah `priceUsd?: string | null`.

- [ ] **Step 1: Tulis tes yang gagal.** Kasusnya:
  - `priceUsd: '55.00'` pada klinik internasional kurs 16500 → `charges` jadi `'907500'`
    dan `extra` memuat `praktiqu_price_usd`.
  - `priceUsd` **dan** `price` bersamaan → 422 `price_conflict`.
  - `priceUsd` pada klinik non-internasional → 422 `usd_price_not_allowed`.
  - `priceUsd` pada klinik internasional tanpa kurs → 422 `fx_rate_required`.
  - `price` rupiah pada baris yang sudah ber-harga-dolar → kunci `praktiqu_price_usd` hilang
    dan penanda opsi durasi tetap ada.
  - Opsi durasi ikut menerima `priceUsd` per entri.
  - `priceUsdSuggested` terisi hasil konversi jalur lama untuk baris yang `priceUsd`-nya null.

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Implementasi.**

`validation.ts` — skema baru, dan `.superRefine` untuk aturan silang:

```ts
const priceUsdSchema = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'priceUsd must be a plain amount with at most 2 decimals');

export const durationOptionInputSchema = z.object({
  id: idSchema.optional(),
  duration: durationSchema,
  price: priceSchema.optional(),
  priceUsd: priceUsdSchema.optional(),
}).superRefine(bothOrNeither);

function bothOrNeither(v: { price?: number; priceUsd?: string }, ctx: z.RefinementCtx) {
  if (v.price !== undefined && v.priceUsd !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['priceUsd'], message: 'Send price or priceUsd, not both' });
  }
  if (v.price === undefined && v.priceUsd === undefined) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'price or priceUsd is required' });
  }
}
```

`createServiceSchema` dan `updateServiceSchema` mendapat `priceUsd: priceUsdSchema.optional()`
dengan refinement yang sama (pada create: wajib salah satu; pada update: boleh tidak ada
keduanya).

`services.write.ts` — `MappingPatch` bertambah `extra?: string`, dan `PATCH_COLUMNS` bertambah
`['extra', 'extra']`. `OptionInsert` bertambah `priceUsd?: string | null`, dan `INSERT`-nya
memakai `withUsdPrice(optionMarker(i.parentMappingId), usd)` alih-alih `optionMarker(...)` saja.
`optionRemovals` bertambah `priceUsd: string | null`, dan `UPDATE`-nya memakai
`withUsdPrice(removedMarker(r.parentMappingId), usd)` — opsi yang dihapus tetap memegang
harga dolarnya.

`service.ts` — satu pembantu yang dipakai create maupun update:

```ts
type PriceWrite = { charges: string; extra?: string };

/**
 * Harga satu baris, dari `price` rupiah atau `priceUsd`.
 *
 * `priceUsd` menuntut klinik internasional dengan kurs yang bisa dipakai; tanpa itu simpan
 * ditolak, bukan diam-diam jatuh ke rupiah. `price` rupiah pada baris yang sudah
 * ber-harga-dolar MEMBUANG harga dolarnya — ini jalan sadar untuk membatalkan konversi.
 */
function priceWrite(
  input: { price?: number; priceUsd?: string },
  existingExtra: string | null,
  settings: ClinicPaymentSettings,
): PriceWrite {
  if (input.priceUsd !== undefined) {
    if (!settings.international) {
      throw { _tag: 'unprocessable', code: 'usd_price_not_allowed', message: 'This clinic is not international' } satisfies ServiceCatalogError;
    }
    if (settings.rate === null) {
      throw { _tag: 'unprocessable', code: 'fx_rate_required', message: 'This clinic has no usable exchange rate' } satisfies ServiceCatalogError;
    }
    const usd = parseUsdInput(input.priceUsd)!;
    return { charges: String(idrFromUsd(usd, settings.rate)), extra: withUsdPrice(existingExtra, usd) };
  }
  return { charges: String(input.price), extra: withUsdPrice(existingExtra, null) };
}
```

`toSummary`/`toOptionSummary` menambahkan `priceUsd: row.priceUsd` dan
`priceUsdSuggested`, yang dihitung dari jalur lama untuk baris yang `priceUsd`-nya null:

```ts
/** Nilai awal form saat mengonversi layanan rupiah. null di luar klinik internasional. */
function suggestUsd(row: ClinicServiceRow, settings: ClinicPaymentSettings): string | null {
  if (row.priceUsd !== null || !settings.international || settings.rate === null) return null;
  const price = parsePrice(row.charges);
  if (price === null) return null;
  const quote = buildUsdQuote([{ name: row.name, price }], [], settings);
  return quote === null ? null : quote.totalUsd;
}
```

`listServices` dan `getService` memanggil `resolveClinicPayment(clinicId)` sekali per klinik
yang muncul di halaman itu, bukan sekali per baris.

- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): terima priceUsd di POST/PUT layanan`

---

### Task 5: Blok `currency` di respons layanan

**Files:**
- Modify: `src/app/api/v1/services/route.ts`, `src/app/api/v1/services/[id]/route.ts`
- Test: `tests/integration/services/usd-currency-route.test.ts`

**Interfaces:**
- Consumes: `resolveClinicPayment`, `ServiceSummary.priceUsd` (Task 4).
- Produces: bentuk respons `{ services: [...], currency: { code, fxRate } }`.

- [ ] **Step 1: Tulis tes yang gagal.** Psikolog (bukan admin) di klinik internasional
  mendapat `currency.code === 'USD'`; klinik biasa mendapat `'IDR'` dengan `fxRate: null`;
  klinik internasional tanpa kurs juga `'IDR'`.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasi** — `currencyBlockFor(settings)` di `service-catalog/service.ts`:

```ts
export function currencyBlockFor(s: ClinicPaymentSettings): { code: 'USD' | 'IDR'; fxRate: string | null } {
  return s.international && s.rate !== null
    ? { code: 'USD', fxRate: s.rate.toString() }
    : { code: 'IDR', fxRate: null };
}
```

- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): blok currency di respons layanan`

---

### Task 6: Stempel ulang `charges` saat kurs berubah

**Files:**
- Create: `src/services/practice/restamp-prices.ts`
- Modify: `src/services/practice/payment-settings.service.ts`
- Test: `tests/services/practice.restamp-prices.test.ts`

**Interfaces:**
- Consumes: `ANY_USD_PRICE_PROBE`, `readUsdPrice`, `idrFromUsd` (Task 1).
- Produces: `restampClinicPrices(clinicId: number, rate: Prisma.Decimal): Promise<{ updated: number; statements: number }>`

- [ ] **Step 1: Tulis tes yang gagal.** Kasusnya:
  - 450 baris ber-harga-dolar → `statements === 3` (batch 200), bukan 450.
  - Baris tanpa harga dolar tidak disentuh.
  - Kegagalan dicatat `warn` dan **tidak** melempar ke pemanggil.
  - Dipanggil hanya saat kurs efektif berubah, tidak saat hanya markup yang berubah.

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Implementasi.** Satu `UPDATE ... CASE` per 200 baris, di dalam satu transaksi:

```ts
const BATCH = 200;

export async function restampClinicPrices(clinicId: number, rate: Prisma.Decimal) {
  const rows = await prisma.kcServiceDoctorMapping.findMany({
    where: { clinicId: BigInt(clinicId), ...ANY_USD_PRICE_PROBE },
    select: { id: true, extra: true },
  });
  const pairs = rows
    .map((r) => ({ id: r.id, usd: readUsdPrice(r.extra) }))
    .filter((p): p is { id: bigint; usd: Prisma.Decimal } => p.usd !== null)
    .map((p) => ({ id: p.id, charges: String(idrFromUsd(p.usd, rate)) }));

  let statements = 0;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const chunk = pairs.slice(i, i + BATCH);
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(() => '?').join(', ');
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_service_doctor_mapping SET charges = CASE id ${cases} END WHERE id IN (${ids})`,
      ...chunk.flatMap((c) => [c.id, c.charges]),
      ...chunk.map((c) => c.id),
    );
    statements += 1;
  }
  return { updated: pairs.length, statements };
}
```

Di `updatePaymentSettings`, setelah plugin menulis dan audit tercatat, sebelum
`getPaymentSettingsView`:

```ts
  // Cermin rupiah untuk layar KiviCare. Alur kami sudah tidak membacanya, jadi kegagalan
  // di sini TIDAK boleh menggagalkan simpan yang sudah berhasil.
  const after = resolveSettings(clinicId, parseStoredOption(raw.byClinic.get(clinicId)), globals);
  if (next.international && nextRate !== null && !nextRate.equals(after.rate ?? new Decimal(-1))) {
    try {
      await restampClinicPrices(clinicId, nextRate);
    } catch (err) {
      await logging.warn('Rupiah mirror not restamped after a rate change', {
        resource: 'clinic', resourceId: String(clinicId),
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
```

- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): stempel ulang cermin rupiah saat kurs berubah`

---

### Task 7: Alur pembayaran membawa harga dolar

**Files:**
- Modify: `src/services/payments/payment.service.ts` (`computePublicAmount`, `computeSessionAmountFromBill`)
- Modify: `src/services/public/public-catalog.service.ts`, `src/services/public/public-booking.service.ts`
- Test: `tests/payments/public-usd-direct.test.ts`

**Interfaces:**
- Consumes: `ClinicServiceRow.priceUsd` (Task 3), `isUsdDirect` (Task 2).
- Produces: `computePublicAmount` menerima `priceUsd?: string | null` dan meneruskannya ke
  `items[0].priceUsd`.

- [ ] **Step 1: Tulis tes yang gagal.** Booking publik atas layanan ber-harga-dolar
  menagih persis `$55.00`, tanpa baris "International service fee", dan menulis
  `payment_orders.expectedAmount = 907500`, `chargedAmount = 55`, `fxRate = '16500'`.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasi** — teruskan `priceUsd` dari baris pemetaan ke `computePublicAmount`,
  dan dari `bill.serviceItems` ke `computeSessionAmountFromBill`. Tagihan staf membaca harga
  dolar lewat `serviceId` + `clinicId` pada pemetaannya.
- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): booking dan tagihan memakai harga dolar layanan`

---

### Task 8: Blok `currency` di tagihan dan dasbor

**Files:**
- Modify: `src/app/api/v1/bills/route.ts`, `bills/[id]/route.ts`, `bills/export/route.ts`
- Modify: `src/app/api/v1/dashboard/statistics/route.ts`, `revenue-chart/route.ts`,
  `recent-payments/route.ts`, `top-professionals/route.ts`
- Test: `tests/integration/billing/usd-currency.test.ts`

**Interfaces:**
- Consumes: `currencyBlockFor` (Task 5).
- Produces: tiap respons membawa `currency`, dan tiap angka rupiah mendapat pasangan
  `*Usd` yang dikonversi pada kurs efektif klinik.

- [ ] **Step 1: Tulis tes yang gagal** — statistik satu klinik internasional membawa
  `currency.code === 'USD'` dan `revenueUsd` yang konsisten dengan `revenue / fxRate`.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasi.** Angka historis dikonversi pada kurs HARI INI — perkiraan,
  bukan yang ditagih; FE menandainya `≈` (spec §4).
- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** — `feat(harga-dolar): blok currency di tagihan dan dasbor`

---

### Task 9: Gerbang akhir

- [ ] **Step 1:** `npm run type-check` → tanpa galat.
- [ ] **Step 2:** `npm test` → seluruh suite hijau, termasuk lima vektor emas yang tidak diubah.
- [ ] **Step 3: Commit** apa pun yang tersisa, lalu push cabang `feat/harga-layanan-dolar`.
