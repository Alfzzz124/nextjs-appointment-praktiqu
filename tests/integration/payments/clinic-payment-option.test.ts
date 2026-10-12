/**
 * The plugin's stored option, read back through KcOption (spec §7: "Integration against
 * the Docker test database").
 *
 * PLUGIN_FIXTURE is byte-for-byte what ClinicPaymentSettings::encode() writes — pinned in
 * Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings.php ("exact stored
 * string"). If that string changes, change it here too: this test exists so a storage-format
 * change on one side cannot silently turn every clinic into a not-international one on the
 * other.
 *
 * Needs the Docker test database (`wordpress-praktiqu-test`). Skipped when DATABASE_URL is
 * not a test database; assertTestDb() refuses to write anywhere else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import { assertTestDb } from '../../billing/fixtures';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import { resolveClinicPayment } from '@/services/payments/clinic-payment.service';
import { buildUsdQuote } from '@/services/payments/intl-pricing';

/** ClinicPaymentSettings::encode() output for the §1 example (plugin Task A1). */
const PLUGIN_FIXTURE =
  '{"international":true,"fx_rate":16500,"markup_percent":10,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}';
/** What WordPress would store had the plugin passed update_option() an array. */
const SERIALIZED =
  'a:6:{s:13:"international";b:1;s:7:"fx_rate";i:16500;s:14:"markup_percent";i:10;s:13:"fixed_fee_idr";i:25000;s:10:"updated_at";s:25:"2026-10-06T08:00:00+00:00";s:10:"updated_by";i:123;}';

/** Test-owned clinic ids. Only the options are needed — no wp_kc_clinics row. */
const CLINIC = 7_960_001;
const SERIALIZED_CLINIC = 7_960_002;
const NAMES = [CLINIC, SERIALIZED_CLINIC].map((id) => `praktiqu_endpoint_clinic_${id}_payment`);

const onTestDb = /test/i.test(process.env.DATABASE_URL ?? '');

async function wipe() {
  await prisma.kcOption.deleteMany({ where: { optionName: { in: NAMES } } });
}

describe.skipIf(!onTestDb)('clinic payment option through KcOption (Docker test database)', () => {
  beforeAll(async () => {
    assertTestDb();
    await wipe();
    await prisma.kcOption.createMany({
      data: [
        { optionName: NAMES[0], optionValue: PLUGIN_FIXTURE },
        { optionName: NAMES[1], optionValue: SERIALIZED },
      ],
    });
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('reads back exactly the string the plugin wrote', async () => {
    const raw = await readRawPaymentOptions([CLINIC]);

    expect(raw.byClinic.get(CLINIC)).toBe(PLUGIN_FIXTURE);
  });

  it('resolves the plugin fixture as an international clinic with its own values', async () => {
    const s = await resolveClinicPayment(CLINIC);

    expect(s.international).toBe(true);
    expect(s.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.markupPercent.toString()).toBe('10');
    expect(s.fixedFeeIdr.toString()).toBe('25000');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(s.problems).toEqual([]);
  });

  it('quotes from it: Rp 200,000 at 16,500 with 10% and a Rp 25,000 fee', async () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [], await resolveClinicPayment(CLINIC));

    // ceil(200000 × 110 / 16500) = ceil(1333.3…) = 1334; ceil(25000 × 100 / 16500) = ceil(151.5…) = 152
    expect(quote!.lines.map((l) => l.usd)).toEqual(['13.34', '1.52']);
    expect(quote!.totalUsd).toBe('14.86');
  });

  it('fails closed on a PHP-serialized value and logs it (rule 4)', async () => {
    const s = await resolveClinicPayment(SERIALIZED_CLINIC);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: String(SERIALIZED_CLINIC),
        metadata: { problems: [expect.stringContaining('clinic_payment_option_serialized')] },
      }),
    );
  });
});
