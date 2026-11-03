/**
 * International clinic pricing — the pure module (spec §1–§2, tests per §7).
 *
 * No mocks: intl-pricing does no I/O. The golden vectors come from the 2026-09-02
 * PayPal sandbox run and must be reproduced exactly.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_METHODS,
  INTL_FEE_LINE_NAME,
  XENDIT_ONLY,
  amountToCents,
  buildUsdQuote,
  gateUsdPayment,
  isUsableMarkup,
  isUsableRate,
  notInternational,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  toCharge,
  toUsdView,
  type GlobalDefaults,
} from '@/services/payments/intl-pricing';

const NO_GLOBALS: GlobalDefaults = { fxRate: null, markupPercent: null };

function option(fields: Record<string, unknown>): string {
  return JSON.stringify({
    international: true,
    fx_rate: null,
    markup_percent: null,
    fixed_fee_idr: null,
    updated_at: '2026-10-06T08:00:00+00:00',
    updated_by: 123,
    ...fields,
  });
}

/** Settings for a flagged clinic with its own rate/markup/fee. */
function intl(rate: number | null, markup: number | null, fee: number | null = null, clinicId = 4) {
  return resolveSettings(
    clinicId,
    parseStoredOption(option({ fx_rate: rate, markup_percent: markup, fixed_fee_idr: fee })),
    NO_GLOBALS,
  );
}

describe('buildUsdQuote — golden vectors', () => {
  it.each([
    [800_000, 18_000, 10, '48.89'],
    [900_000, 18_000, 10, '55.00'],
    [200_000, 18_000, 10, '12.23'],
    [200_000, 18_000, 0, '11.12'],
    // A divide-first implementation gives 6.01 here.
    [90_000, 16_500, 10, '6.00'],
  ])('Rp %i at %i with %i%% markup is $%s', (idr, rate, markup, usd) => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: idr }], [], intl(rate, markup));
    expect(quote).not.toBeNull();
    expect(quote!.lines).toEqual([{ kind: 'item', name: 'Konsultasi', idr, usd }]);
    expect(quote!.totalUsd).toBe(usd);
  });
});

describe('buildUsdQuote — worked example (rate 18,000, markup 10%, fee Rp 25,000)', () => {
  it('produces 12.23 + 1.39 = 13.62 with the snapshot and effective rate', () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [], intl(18_000, 10, 25_000));

    expect(quote).toEqual({
      lines: [
        { kind: 'item', name: 'Konsultasi', idr: 200_000, usd: '12.23' },
        { kind: 'fee', name: INTL_FEE_LINE_NAME, idr: 25_000, usd: '1.39' },
      ],
      totalUsd: '13.62',
      totalCents: 1362,
      expectedIdr: 200_000,
      effectiveFxRate: '16363.636363636363636',
      snapshot: {
        clinicId: 4,
        fxRate: '18000',
        markupPercent: '10',
        fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
  });
});

describe('buildUsdQuote — lines', () => {
  it('does not apply the markup to the fixed fee', () => {
    // 18,000 / 18,000 = exactly 100 cents; with the 50% markup it would be 150.
    const quote = buildUsdQuote([{ name: 'Svc', price: 180_000 }], [], intl(18_000, 50, 18_000));
    expect(quote!.lines[1]).toEqual({ kind: 'fee', name: INTL_FEE_LINE_NAME, idr: 18_000, usd: '1.00' });
  });

  it('adds no fee line when the fee is 0', () => {
    const quote = buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10, 0));
    expect(quote!.lines.map((l) => l.kind)).toEqual(['item']);
    expect(quote!.totalUsd).toBe('12.23');
  });

  it('keeps a 0.00 line for a Rp 0 item next to a paid item, so counts match', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }, { name: 'Gratis', price: 0 }],
      [],
      intl(18_000, 10),
    );
    expect(quote!.lines).toEqual([
      { kind: 'item', name: 'Svc', idr: 200_000, usd: '12.23' },
      { kind: 'item', name: 'Gratis', idr: 0, usd: '0.00' },
    ]);
  });

  it('skips a tax of 0 or less and converts a positive tax with the markup', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }],
      [{ name: 'Zero', amount: 0 }, { name: 'Negative', amount: -500 }, { name: 'PPN', amount: 22_000 }],
      intl(18_000, 10),
    );
    // ceil(22000 × 110 / 18000) = ceil(134.4…) = 135
    expect(quote!.lines).toEqual([
      { kind: 'item', name: 'Svc', idr: 200_000, usd: '12.23' },
      { kind: 'tax', name: 'PPN', idr: 22_000, usd: '1.35' },
    ]);
    expect(quote!.totalUsd).toBe('13.58');
    expect(quote!.totalCents).toBe(1358);
    expect(quote!.expectedIdr).toBe(222_000);
  });

  it('returns null for a free order even when the clinic has a fee', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 0 }], [], intl(18_000, 10, 25_000))).toBeNull();
  });

  it('returns null for a clinic that is not international', () => {
    const settings = resolveSettings(4, parseStoredOption(option({ international: false, fx_rate: 18_000 })), NO_GLOBALS);
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], settings)).toBeNull();
  });

  it('returns null when no rate is usable', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(null, 10))).toBeNull();
  });

  it('gives the market rate itself as the effective rate when there is no markup', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 0))!.effectiveFxRate).toBe('18000');
  });
});

describe('resolveSettings — value sources', () => {
  it('uses the clinic values and marks them clinic', () => {
    const s = intl(16_500, 12.5, 25_000);
    expect(s.international).toBe(true);
    expect(s.methods).toEqual(ALL_METHODS);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.markupPercent.toString()).toBe('12.5');
    expect(s.fixedFeeIdr.toString()).toBe('25000');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(s.problems).toEqual([]);
  });

  it('falls back to the global rate and markup, and to a 0 fee', () => {
    const s = resolveSettings(4, parseStoredOption(option({})), { fxRate: 18_000, markupPercent: 10 });
    expect(s.rate!.toString()).toBe('18000');
    expect(s.markupPercent.toString()).toBe('10');
    expect(s.fixedFeeIdr.toString()).toBe('0');
    expect(s.source).toEqual({ fxRate: 'global', markupPercent: 'global', fixedFeeIdr: 'default' });
  });

  it('defaults the markup to 0 when neither the clinic nor the global has one', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), NO_GLOBALS);
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.source.markupPercent).toBe('default');
  });

  it('resolves the values even when the flag is off, but offers Xendit only', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false })), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.rate!.toString()).toBe('18000');
    expect(s.source.fxRate).toBe('global');
  });

  it('treats a missing option as not international (rule 1) and logs nothing', () => {
    const s = resolveSettings(4, parseStoredOption(null), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems).toEqual([]);
  });
});

describe('resolveSettings — rate validation on read', () => {
  it.each([16.5, 500_000])('a clinic rate of %s counts as missing and falls back to the global', (bad) => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: bad })), { fxRate: 16_500, markupPercent: null });
    expect(s.rate!.toString()).toBe('16500');
    expect(s.source.fxRate).toBe('global');
    expect(s.problems.join(' ')).toContain(`fx_rate ${bad}`);
  });

  it.each([16.5, 500_000])('a global rate of %s counts as missing: international stays true, no rate (rule 3)', (bad) => {
    const s = resolveSettings(4, parseStoredOption(option({})), { fxRate: bad, markupPercent: null });
    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.source.fxRate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems.join(' ')).toContain(`global fx rate ${bad}`);
  });

  it('a global markup of 150 that would be used voids the rate (rule 3)', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), { fxRate: null, markupPercent: 150 });
    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.problems.join(' ')).toContain('global markup 150');

    // More than 2 decimals is treated exactly like out of range.
    const d = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), { fxRate: null, markupPercent: 10.125 });
    expect(d.rate).toBeNull();
    expect(d.methods).toEqual(XENDIT_ONLY);
    expect(d.problems.join(' ')).toContain('global markup 10.125');
  });

  it.each(['1e1', '.5', '+10', '10.', 'abc'])(
    'a global markup %j that cannot be parsed voids the rate like an out-of-range one (rule 3), never 0%%',
    (bad) => {
      const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), parseGlobalDefaults(null, bad));
      expect(s.international).toBe(true);
      expect(s.rate).toBeNull();
      expect(s.source.fxRate).toBeNull();
      expect(s.methods).toEqual(XENDIT_ONLY);
      expect(s.problems).toHaveLength(1);
      expect(s.problems[0]).toContain(`"${bad}"`);
      expect(s.problems[0]).toContain('clinic 4 has no usable rate');
    },
  );

  it('an unparseable global markup makes the USD gate say rate_missing, not not_allowed', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), {
      fxRate: null,
      markupPercent: null,
      invalid: { markupPercent: '1e1' },
    });
    expect(s.rate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems.join(' ')).toContain('1e1');
    expect(gateUsdPayment([{ name: 'Svc', price: 200_000 }], [], s)).toEqual({ ok: false, reason: 'rate_missing' });
  });

  it('an unparseable global markup is harmless when the clinic has its own markup', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000, markup_percent: 10 })), parseGlobalDefaults(null, '1e1'));
    expect(s.rate!.toString()).toBe('18000');
    expect(s.source.markupPercent).toBe('clinic');
    expect(s.problems).toEqual([]);
  });

  it('an unparseable global markup is reported for a flagged clinic only', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false, fx_rate: 18_000 })), parseGlobalDefaults(null, '1e1'));
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems).toEqual([]);
  });

  it('an unparseable global rate that would be used leaves no rate (rule 3) and logs the raw text', () => {
    const s = resolveSettings(4, parseStoredOption(option({})), parseGlobalDefaults('16,500', null));
    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.source.fxRate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toContain('"16,500"');
    expect(gateUsdPayment([{ name: 'Svc', price: 200_000 }], [], s)).toEqual({ ok: false, reason: 'rate_missing' });
  });

  it('an unparseable global rate is harmless when the clinic has a usable rate of its own', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), parseGlobalDefaults('16,500', null));
    expect(s.rate!.toString()).toBe('18000');
    expect(s.source.fxRate).toBe('clinic');
    expect(s.problems).toEqual([]);
  });

  it('an unparseable global rate is not reported for a clinic that is not flagged', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false })), parseGlobalDefaults('16,500', null));
    expect(s.problems).toEqual([]);
  });

  it('a global markup of 150 is harmless when the clinic has its own markup', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000, markup_percent: 10 })), { fxRate: null, markupPercent: 150 });
    expect(s.rate!.toString()).toBe('18000');
    expect(s.problems).toEqual([]);
  });

  it('reports no range problems for a clinic that is not flagged', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false })), { fxRate: 500_000, markupPercent: 150 });
    expect(s.problems).toEqual([]);
  });
});

describe('parseStoredOption — fail closed', () => {
  it('reads null, undefined and an empty string as absent', () => {
    expect(parseStoredOption(null)).toEqual({ status: 'absent' });
    expect(parseStoredOption(undefined)).toEqual({ status: 'absent' });
    expect(parseStoredOption('  ')).toEqual({ status: 'absent' });
  });

  it('maps snake_case storage to camelCase', () => {
    expect(parseStoredOption(option({ fx_rate: 16_500, markup_percent: 10, fixed_fee_idr: 25_000 }))).toEqual({
      status: 'ok',
      value: {
        international: true,
        fxRate: 16_500,
        markupPercent: 10,
        fixedFeeIdr: 25_000,
        updatedAt: '2026-10-06T08:00:00+00:00',
        updatedBy: 123,
      },
    });
  });

  it('treats missing nullable keys as null', () => {
    expect(parseStoredOption('{"international":true}')).toEqual({
      status: 'ok',
      value: { international: true, fxRate: null, markupPercent: null, fixedFeeIdr: null, updatedAt: null, updatedBy: null },
    });
  });

  it('flags malformed JSON', () => {
    expect(parseStoredOption('{"international":tru')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
  });

  it('flags JSON that is not an object', () => {
    expect(parseStoredOption('[1,2]')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
    expect(parseStoredOption('null')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
  });

  it('flags a PHP-serialized value', () => {
    const serialized = 'a:6:{s:13:"international";b:1;s:7:"fx_rate";i:16500;s:14:"markup_percent";i:10;s:13:"fixed_fee_idr";i:0;s:10:"updated_at";s:0:"";s:10:"updated_by";N;}';
    expect(parseStoredOption(serialized)).toMatchObject({ status: 'invalid', reason: 'serialized' });
  });

  it.each([
    ['international is not a boolean', { international: 'yes' }],
    ['international is missing', { international: undefined }],
    ['fx_rate is a string', { fx_rate: '16500' }],
    ['markup above 100', { markup_percent: 150 }],
    ['markup below 0', { markup_percent: -1 }],
    ['markup with 3 decimals', { markup_percent: 10.125 }],
    ['fee is not an integer', { fixed_fee_idr: 1.5 }],
    ['fee below 0', { fixed_fee_idr: -1 }],
    ['fee above 10,000,000', { fixed_fee_idr: 10_000_001 }],
    ['updated_by is 0', { updated_by: 0 }],
    ['updated_at is a number', { updated_at: 5 }],
  ])('flags an invalid field: %s', (_label, fields) => {
    expect(parseStoredOption(option(fields))).toMatchObject({ status: 'invalid', reason: 'invalid_field' });
  });

  it('accepts a markup with 2 decimals despite float noise', () => {
    expect(parseStoredOption(option({ markup_percent: 10.15 }))).toMatchObject({ status: 'ok' });
  });
});

describe('resolveSettings — an unusable option (rule 4)', () => {
  it.each([
    ['malformed_json', '{nope'],
    ['serialized', 'a:1:{s:13:"international";b:1;}'],
    ['invalid_field', option({ markup_percent: 150 })],
  ])('%s resolves to not international with a logged problem, never the globals', (reason, raw) => {
    const s = resolveSettings(4, parseStoredOption(raw), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.rate).toBeNull();
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toContain(`clinic_payment_option_${reason}`);
  });
});

describe('notInternational', () => {
  it('is Xendit only, no rate, zero markup and fee', () => {
    const s = notInternational(7);
    expect(s).toMatchObject({
      clinicId: 7,
      international: false,
      methods: XENDIT_ONLY,
      rate: null,
      source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' },
      problems: [],
    });
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.fixedFeeIdr.toString()).toBe('0');
  });
});

describe('parseGlobalDefaults', () => {
  it('parses numeric option strings', () => {
    expect(parseGlobalDefaults('16500', '10')).toEqual({ fxRate: 16_500, markupPercent: 10 });
    expect(parseGlobalDefaults(' 16500.50 ', '0')).toEqual({ fxRate: 16_500.5, markupPercent: 0 });
  });

  it('reads empty, whitespace and missing values as "not set": null, and no invalid marker', () => {
    expect(parseGlobalDefaults('', null)).toEqual({ fxRate: null, markupPercent: null });
    expect(parseGlobalDefaults('', '  ')).toEqual({ fxRate: null, markupPercent: null });
    expect(parseGlobalDefaults(null, null)).toEqual({ fxRate: null, markupPercent: null });
    expect(parseGlobalDefaults('', '  ')).not.toHaveProperty('invalid');
    expect(parseGlobalDefaults(null, null)).not.toHaveProperty('invalid');
  });

  it('reads a non-empty value it cannot parse as null AND records the raw text in invalid', () => {
    expect(parseGlobalDefaults('16,500', '1e1')).toEqual({
      fxRate: null,
      markupPercent: null,
      invalid: { fxRate: '16,500', markupPercent: '1e1' },
    });
    expect(parseGlobalDefaults('abc', '10%')).toEqual({
      fxRate: null,
      markupPercent: null,
      invalid: { fxRate: 'abc', markupPercent: '10%' },
    });
  });

  it.each(['1e1', '.5', '+10', '10.', 'abc', '1,5'])('marks the markup %j invalid, and leaves a good rate alone', (bad) => {
    expect(parseGlobalDefaults('16500', bad)).toEqual({ fxRate: 16_500, markupPercent: null, invalid: { markupPercent: bad } });
  });

  it('marks only the side that is bad, and keeps the trimmed text', () => {
    expect(parseGlobalDefaults(' 16,500 ', '10')).toEqual({ fxRate: null, markupPercent: 10, invalid: { fxRate: '16,500' } });
  });

  it('keeps an out-of-range number so resolveSettings can report it', () => {
    expect(parseGlobalDefaults('500000', '150')).toEqual({ fxRate: 500_000, markupPercent: 150 });
  });
});

describe('isUsableRate', () => {
  it.each([
    [1000, true],
    [100_000, true],
    [16_500.25, true],
    [16_500.123, false],
    [100_000.01, false],
    [16.5, false],
    [Number.NaN, false],
    ['16500', false],
    [null, false],
    [16_500.000000001, false],
  ])('%s -> %s', (v, expected) => {
    expect(isUsableRate(v)).toBe(expected);
  });
});

describe('isUsableMarkup', () => {
  it.each([
    [0, true],
    [100, true],
    [4.4, true],
    [10.15, true],
    [100.01, false],
    [-1, false],
    [10.125, false],
    [10.000000001, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    ['10', false],
    [null, false],
  ])('%s -> %s', (v, expected) => {
    expect(isUsableMarkup(v)).toBe(expected);
  });
});

describe('gateUsdPayment', () => {
  const paid = [{ name: 'Svc', price: 200_000 }];
  const free = [{ name: 'Svc', price: 0 }];

  it('refuses a clinic that is not international, before looking at the rate', () => {
    expect(gateUsdPayment(paid, [], notInternational(4))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('refuses a free order, even when the rate is missing', () => {
    expect(gateUsdPayment(free, [], intl(null, 10))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('reports a missing rate for a flagged clinic (503, not 403)', () => {
    expect(gateUsdPayment(paid, [], intl(null, 10))).toEqual({ ok: false, reason: 'rate_missing' });
  });

  it('passes with the quote', () => {
    const gate = gateUsdPayment(paid, [], intl(18_000, 10, 25_000));
    expect(gate.ok).toBe(true);
    expect(gate.ok && gate.quote.totalUsd).toBe('13.62');
  });
});

describe('toUsdView', () => {
  it('is null for a null quote', () => {
    expect(toUsdView(null)).toBeNull();
  });

  it('sums the item lines into price and lists taxes, fee and total', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }, { name: 'Extra', price: 90_000 }],
      [{ name: 'PPN', amount: 22_000 }],
      intl(18_000, 10, 25_000),
    );
    // 12.23 + ceil(90000 × 110 / 18000 = 550) 5.50 = 17.73; tax 1.35; fee 1.39
    expect(toUsdView(quote)).toEqual({
      price: '17.73',
      taxes: [{ name: 'PPN', amount: '1.35' }],
      fee: '1.39',
      total: '20.47',
    });
  });

  it('reports fee as null when there is no fee line', () => {
    const quote = buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10));
    expect(toUsdView(quote)).toEqual({ price: '12.23', taxes: [], fee: null, total: '12.23' });
  });
});

describe('amountToCents', () => {
  it('rounds float noise to whole cents', () => {
    expect(amountToCents(13.62)).toBe(1362);
    expect(amountToCents(0.29)).toBe(29);
    expect(amountToCents(55)).toBe(5500);
  });
});

describe('toCharge', () => {
  it('turns the worked example into the plugin wire format', () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [{ name: 'PPN', amount: 22_000 }], intl(18_000, 10, 25_000))!;
    expect(toCharge(quote)).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [{ name: 'PPN', amount: '1.35' }],
      fee: { name: INTL_FEE_LINE_NAME, amount: '1.39' },
      total: '14.97',
      snapshot: quote.snapshot,
    });
  });

  it('leaves fee out entirely (not null) when there is no fee line', () => {
    const charge = toCharge(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10))!);
    expect(charge).not.toHaveProperty('fee');
    expect(charge.total).toBe('12.23');
  });
});
