/**
 * International clinic pricing — pure.
 *
 * One function turns rupiah lines into the USD lines that are both displayed on the
 * booking page and sent to WooCommerce as `charge`, so the two figures cannot drift.
 * Nothing here touches the database or the network: the option strings are read by
 * `repositories/wp/clinic-payment-settings.repo.ts` and handed in.
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §1–§2.
 *
 * Money is `Prisma.Decimal`, never a float. The order of operations is fixed: every
 * multiplication first, then exactly ONE division, then `ceil`. Dividing first (the
 * plugin's old `(idr / rate) × (1 + markup/100) × 100`) can push an exact amount up a
 * cent — Rp 90,000 at 16,500 with 10% gives 601 cents instead of 600.
 */
import { Prisma } from '@prisma/client';
import type { PaymentMethod } from '@/lib/wp-endpoint';
import type { PaymentLineItem, PaymentTaxLine } from '@/services/payments/payment.service';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const RATE_MIN = 1000;
export const RATE_MAX = 100_000;
export const MARKUP_MAX = 100;
export const FEE_MAX = 10_000_000;
export const INTL_FEE_LINE_NAME = 'International service fee';
export const ALL_METHODS: PaymentMethod[] = ['xendit', 'paypal', 'card'];
export const XENDIT_ONLY: PaymentMethod[] = ['xendit'];
export type ValueSource = 'clinic' | 'global' | 'default';

export interface StoredClinicPayment {
  international: boolean;
  fxRate: number | null;
  markupPercent: number | null;
  fixedFeeIdr: number | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

export type ParsedOption =
  | { status: 'absent' }
  | { status: 'ok'; value: StoredClinicPayment }
  | { status: 'invalid'; reason: 'malformed_json' | 'serialized' | 'invalid_field'; detail: string };

/**
 * A usable rate is a finite number from 1,000 to 100,000 (rupiah per 1 USD) with at most
 * 2 decimals. The decimal limit is what keeps the single Decimal division exact (spec §2);
 * a many-decimal rate counts as missing, exactly like an out-of-range one.
 */
export function isUsableRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= RATE_MIN && v <= RATE_MAX && hasAtMostTwoDecimals(v);
}

/** At most two decimals, tolerant of binary float noise (10.15 * 100 = 1014.9999…). */
function hasAtMostTwoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function invalidField(detail: string): ParsedOption {
  return { status: 'invalid', reason: 'invalid_field', detail };
}

/**
 * Decode the per-clinic option (`praktiqu_endpoint_clinic_{id}_payment`).
 *
 * The plugin stores a JSON string with snake_case keys. Anything else fails closed:
 * a PHP-serialized value (`a:6:{…}`, what WordPress writes when handed an array),
 * unparseable JSON, a non-object, or a field that breaks the §1 rules. `fx_rate` is
 * only type-checked here — an out-of-range clinic rate "counts as missing" and falls
 * back to the global rate in `resolveSettings` (spec §7), it does not void the option.
 */
export function parseStoredOption(raw: string | null | undefined): ParsedOption {
  if (raw === null || raw === undefined || raw.trim() === '') return { status: 'absent' };
  const text = raw.trim();
  if (text.startsWith('a:')) {
    return { status: 'invalid', reason: 'serialized', detail: 'value is PHP-serialized, not JSON' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'malformed_json', detail: 'value is not valid JSON' };
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { status: 'invalid', reason: 'malformed_json', detail: 'value is not a JSON object' };
  }
  const o = decoded as Record<string, unknown>;

  if (typeof o.international !== 'boolean') return invalidField('international must be a boolean');

  const fxRate = o.fx_rate ?? null;
  if (fxRate !== null && (typeof fxRate !== 'number' || !Number.isFinite(fxRate))) {
    return invalidField('fx_rate must be a number or null');
  }

  const markup = o.markup_percent ?? null;
  if (markup !== null) {
    if (typeof markup !== 'number' || !Number.isFinite(markup) || markup < 0 || markup > MARKUP_MAX) {
      return invalidField('markup_percent must be a number from 0 to 100 or null');
    }
    if (!hasAtMostTwoDecimals(markup)) return invalidField('markup_percent has more than 2 decimals');
  }

  const fee = o.fixed_fee_idr ?? null;
  if (fee !== null && (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0 || fee > FEE_MAX)) {
    return invalidField('fixed_fee_idr must be an integer from 0 to 10000000 or null');
  }

  const updatedAt = o.updated_at ?? null;
  if (updatedAt !== null && typeof updatedAt !== 'string') return invalidField('updated_at must be a string or null');

  const updatedBy = o.updated_by ?? null;
  if (updatedBy !== null && (typeof updatedBy !== 'number' || !Number.isInteger(updatedBy) || updatedBy <= 0)) {
    return invalidField('updated_by must be a positive integer or null');
  }

  return {
    status: 'ok',
    value: {
      international: o.international,
      fxRate: fxRate as number | null,
      markupPercent: markup as number | null,
      fixedFeeIdr: fee as number | null,
      updatedAt: updatedAt as string | null,
      updatedBy: updatedBy as number | null,
    },
  };
}

export interface GlobalDefaults {
  fxRate: number | null;
  markupPercent: number | null;
}

/** WordPress stores option values as text. Empty or non-numeric means "not set". */
function parseOptionNumber(raw: string | null): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The two global options, parsed. Range is NOT checked here — `resolveSettings` does. */
export function parseGlobalDefaults(rateRaw: string | null, markupRaw: string | null): GlobalDefaults {
  return { fxRate: parseOptionNumber(rateRaw), markupPercent: parseOptionNumber(markupRaw) };
}

export interface ClinicPaymentSettings {
  clinicId: number;
  /** The stored flag (false for an absent or invalid option). */
  international: boolean;
  /** ALL_METHODS only when international && rate !== null, else XENDIT_ONLY. */
  methods: PaymentMethod[];
  /** Usable rate (clinic, else global) or null. */
  rate: Prisma.Decimal | null;
  /** Clinic, else valid global, else 0. */
  markupPercent: Prisma.Decimal;
  /** Clinic, else 0. */
  fixedFeeIdr: Prisma.Decimal;
  source: { fxRate: ValueSource | null; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
  /** Human-readable reasons to log. */
  problems: string[];
}

function dec(n: number): Decimal {
  return new Decimal(String(n));
}

/** Rule 1/5 fallback: rupiah and Xendit only. */
export function notInternational(clinicId: number): ClinicPaymentSettings {
  return {
    clinicId,
    international: false,
    methods: [...XENDIT_ONLY],
    rate: null,
    markupPercent: new Decimal(0),
    fixedFeeIdr: new Decimal(0),
    source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' },
    problems: [],
  };
}

/**
 * Spec §1 rules 1–4.
 *
 * The rate, markup and fee are resolved whatever the flag, so the settings page can
 * preview them before a clinic is flagged; `methods` and `buildUsdQuote` still honour
 * the flag. An unusable option (rule 4) never falls back to the global values.
 * Range problems are only reported for a flagged clinic — for any other clinic they
 * change nothing and would only add a log row per page view.
 */
export function resolveSettings(clinicId: number, parsed: ParsedOption, globals: GlobalDefaults): ClinicPaymentSettings {
  if (parsed.status === 'invalid') {
    return {
      ...notInternational(clinicId),
      problems: [`clinic_payment_option_${parsed.reason}: clinic ${clinicId}: ${parsed.detail}`],
    };
  }

  const stored: StoredClinicPayment =
    parsed.status === 'ok'
      ? parsed.value
      : { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null, updatedAt: null, updatedBy: null };
  const international = stored.international;
  const problems: string[] = [];
  const report = (msg: string) => {
    if (international) problems.push(msg);
  };

  // Markup: clinic, else a valid global, else 0. An out-of-range global that would be
  // used voids the rate (rule 3) rather than being clamped.
  let markupPercent = new Decimal(0);
  let markupSource: ValueSource = 'default';
  let markupBroken = false;
  if (stored.markupPercent !== null) {
    markupPercent = dec(stored.markupPercent);
    markupSource = 'clinic';
  } else if (globals.markupPercent !== null) {
    if (globals.markupPercent >= 0 && globals.markupPercent <= MARKUP_MAX && hasAtMostTwoDecimals(globals.markupPercent)) {
      markupPercent = dec(globals.markupPercent);
      markupSource = 'global';
    } else {
      markupBroken = true;
      report(`global markup ${globals.markupPercent} is outside 0–100 or has more than 2 decimals; clinic ${clinicId} has no usable rate`);
    }
  }

  // Rate: the clinic's if usable, else the global if usable.
  let rate: Decimal | null = null;
  let rateSource: ValueSource | null = null;
  if (isUsableRate(stored.fxRate)) {
    rate = dec(stored.fxRate);
    rateSource = 'clinic';
  } else {
    if (stored.fxRate !== null) report(`clinic ${clinicId} fx_rate ${stored.fxRate} is outside 1000–100000 or has more than 2 decimals; ignored`);
    if (isUsableRate(globals.fxRate)) {
      rate = dec(globals.fxRate);
      rateSource = 'global';
    } else if (globals.fxRate !== null) {
      report(`global fx rate ${globals.fxRate} is outside 1000–100000 or has more than 2 decimals; ignored`);
    }
  }
  if (markupBroken) {
    rate = null;
    rateSource = null;
  }

  const fixedFeeIdr = stored.fixedFeeIdr !== null ? dec(stored.fixedFeeIdr) : new Decimal(0);
  const feeSource: ValueSource = stored.fixedFeeIdr !== null ? 'clinic' : 'default';

  return {
    clinicId,
    international,
    methods: international && rate !== null ? [...ALL_METHODS] : [...XENDIT_ONLY],
    rate,
    markupPercent,
    fixedFeeIdr,
    source: { fxRate: rateSource, markupPercent: markupSource, fixedFeeIdr: feeSource },
    problems,
  };
}

export interface UsdLine {
  kind: 'item' | 'tax' | 'fee';
  name: string;
  idr: number;
  /** 2-decimal string. */
  usd: string;
}

export interface ChargeSnapshot {
  clinicId: number;
  fxRate: string;
  markupPercent: string;
  fixedFeeIdr: string;
  source: { fxRate: ValueSource; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
}

export interface UsdQuote {
  lines: UsdLine[];
  totalUsd: string;
  totalCents: number;
  /** Items plus taxes (> 0), excluding the fee — what the clinic is owed. */
  expectedIdr: number;
  /** rate / (1 + markup/100); same meaning as payment_orders.fxRate. Ignores the fee. */
  effectiveFxRate: string;
  snapshot: ChargeSnapshot;
}

function centsToUsd(cents: Decimal): string {
  return cents.div(100).toFixed(2);
}

/** Items plus taxes above zero — the amount that decides whether an order is free. */
function paidTotalIdr(items: PaymentLineItem[], taxes: PaymentTaxLine[]): number {
  const itemTotal = items.reduce((sum, i) => sum + i.price, 0);
  const taxTotal = taxes.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  return itemTotal + taxTotal;
}

/**
 * The USD lines for an order, or null when the clinic is not international, has no
 * usable rate, or the order is free (a free order is never charged in USD and never
 * gets the fee on its own).
 *
 * Every rupiah item becomes exactly one line, even at 0.00, so the lines stay 1:1 with
 * the rupiah `items` the plugin also receives. Taxes ≤ 0 are skipped, as the plugin
 * skips them. The fee line carries no markup and is omitted when the fee is 0.
 */
export function buildUsdQuote(
  items: PaymentLineItem[],
  taxes: PaymentTaxLine[],
  settings: ClinicPaymentSettings,
): UsdQuote | null {
  const rate = settings.rate;
  const rateSource = settings.source.fxRate;
  if (!settings.international || rate === null || rateSource === null) return null;

  const expectedIdr = paidTotalIdr(items, taxes);
  if (expectedIdr <= 0) return null;

  const factor = new Decimal(100).plus(settings.markupPercent);
  const withMarkup = (idr: number): Decimal => dec(idr).mul(factor).div(rate).ceil();

  const lines: UsdLine[] = [];
  let totalCents = new Decimal(0);
  const push = (kind: UsdLine['kind'], name: string, idr: number, cents: Decimal) => {
    lines.push({ kind, name, idr, usd: centsToUsd(cents) });
    totalCents = totalCents.plus(cents);
  };

  for (const item of items) push('item', item.name, item.price, withMarkup(item.price));
  for (const tax of taxes) {
    if (tax.amount <= 0) continue;
    push('tax', tax.name, tax.amount, withMarkup(tax.amount));
  }
  if (settings.fixedFeeIdr.gt(0)) {
    push('fee', INTL_FEE_LINE_NAME, settings.fixedFeeIdr.toNumber(), settings.fixedFeeIdr.mul(100).div(rate).ceil());
  }

  return {
    lines,
    totalUsd: centsToUsd(totalCents),
    totalCents: totalCents.toNumber(),
    expectedIdr,
    effectiveFxRate: rate.mul(100).div(factor).toString(),
    snapshot: {
      clinicId: settings.clinicId,
      fxRate: rate.toString(),
      markupPercent: settings.markupPercent.toString(),
      fixedFeeIdr: settings.fixedFeeIdr.toString(),
      source: { fxRate: rateSource, markupPercent: settings.source.markupPercent, fixedFeeIdr: settings.source.fixedFeeIdr },
    },
  };
}

export type UsdGate = { ok: true; quote: UsdQuote } | { ok: false; reason: 'not_allowed' | 'rate_missing' };

/**
 * The payment gate for `paypal` / `card` (spec §2). It checks the flag, the amount and
 * the rate — never `methods`, which is `['xendit']` under rule 3 and would turn every
 * 503 into a 403.
 */
export function gateUsdPayment(items: PaymentLineItem[], taxes: PaymentTaxLine[], settings: ClinicPaymentSettings): UsdGate {
  if (!settings.international) return { ok: false, reason: 'not_allowed' };
  if (paidTotalIdr(items, taxes) <= 0) return { ok: false, reason: 'not_allowed' };
  if (settings.rate === null) return { ok: false, reason: 'rate_missing' };
  const quote = buildUsdQuote(items, taxes, settings);
  if (quote === null) return { ok: false, reason: 'rate_missing' };
  return { ok: true, quote };
}

export interface PublicUsdView {
  price: string;
  taxes: { name: string; amount: string }[];
  fee: string | null;
  total: string;
}

/** The `usd` block of the public API. `price` is the sum of the item lines. */
export function toUsdView(quote: UsdQuote | null): PublicUsdView | null {
  if (quote === null) return null;
  const price = quote.lines
    .filter((l) => l.kind === 'item')
    .reduce((sum, l) => sum.plus(l.usd), new Decimal(0));
  const fee = quote.lines.find((l) => l.kind === 'fee');
  return {
    price: price.toFixed(2),
    taxes: quote.lines.filter((l) => l.kind === 'tax').map((l) => ({ name: l.name, amount: l.usd })),
    fee: fee ? fee.usd : null,
    total: quote.totalUsd,
  };
}

/** Integer cents of a plugin-reported amount, for the backstop comparison. */
export function amountToCents(n: number): number {
  return Math.round(n * 100);
}
