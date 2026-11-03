/**
 * The per-clinic payment settings view and save path (spec §1 "Write and read paths",
 * §3 "GET / PUT /api/v1/practices/{id}/payment-settings").
 *
 * Prisma, the logger and the plugin call are mocked; the repo and the pure pricing
 * module are real, so the view is built exactly as the payment gate would see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcOption: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  kcUser: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  putClinicPaymentSettings: vi.fn(),
}));

import {
  FxRateRequiredError,
  PaymentSettingsValidationError,
  getPaymentSettingsView,
  paymentSettingsInputSchema,
  updatePaymentSettings,
} from '@/services/practice/payment-settings.service';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError, putClinicPaymentSettings } from '@/lib/wp-endpoint';
import type { Actor } from '@/lib/auth';

const CLINIC = 4;
const OPTION_NAME = 'praktiqu_endpoint_clinic_4_payment';
const SUPER: Actor = { id: 'ckadmin0000000000super', role: 'SUPER_ADMIN', practiceId: null };
const VALID = { international: true, fxRate: 18000, markupPercent: 10, fixedFeeIdr: 25000 };
const NOTHING_STORED = { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };

/** The option as the plugin stores it: a JSON string with snake_case keys. */
function optionRow(fields: Record<string, unknown> = {}) {
  return {
    optionName: OPTION_NAME,
    optionValue: JSON.stringify({
      international: true,
      fx_rate: 18000,
      markup_percent: 10,
      fixed_fee_idr: 25000,
      updated_at: '2026-10-06T08:00:00+00:00',
      updated_by: 123,
      ...fields,
    }),
  };
}
const globalRate = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: v });
const globalMarkup = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_markup_percent', optionValue: v });

beforeEach(() => {
  vi.clearAllMocks();
  db.kcOption.findMany.mockReset().mockResolvedValue([]);
  // users.id -> wp_users.ID for the actor; wp_users.ID -> users.displayName for the editor.
  db.user.findUnique.mockReset().mockImplementation(async (args: any) => {
    if (args.where.id === SUPER.id) return { wpUserId: 123n };
    if (args.where.wpUserId === 123n) return { displayName: 'Dewi Admin' };
    return null;
  });
  db.kcUser.findUnique.mockReset().mockResolvedValue(null);
  vi.mocked(putClinicPaymentSettings).mockReset().mockResolvedValue(undefined);
});

describe('paymentSettingsInputSchema', () => {
  it.each([
    ['the worked example', VALID],
    ['all nulls on a clinic that is not international', NOTHING_STORED],
    ['the lower edges', { international: true, fxRate: 1000, markupPercent: 0, fixedFeeIdr: 0 }],
    ['the upper edges', { international: true, fxRate: 100_000, markupPercent: 100, fixedFeeIdr: 10_000_000 }],
    ['2 decimals despite float noise', { international: true, fxRate: 16500.25, markupPercent: 10.15, fixedFeeIdr: null }],
  ])('accepts %s', (_label, body) => {
    expect(paymentSettingsInputSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['fxRate', '"16.500" read as 16.5', { fxRate: 16.5 }],
    ['fxRate', 'an inverted rate', { fxRate: 0.00006 }],
    ['fxRate', 'a rate above 100,000', { fxRate: 100_000.01 }],
    ['fxRate', 'a rate with 3 decimals', { fxRate: 16500.125 }],
    ['fxRate', 'a rate sent as a string', { fxRate: '16500' }],
    ['markupPercent', 'a negative markup', { markupPercent: -1 }],
    ['markupPercent', 'a markup above 100', { markupPercent: 100.5 }],
    ['markupPercent', 'a markup with 3 decimals', { markupPercent: 10.125 }],
    ['fixedFeeIdr', 'a fractional fee', { fixedFeeIdr: 1.5 }],
    ['fixedFeeIdr', 'a negative fee', { fixedFeeIdr: -1 }],
    ['fixedFeeIdr', 'a fee above 10,000,000', { fixedFeeIdr: 10_000_001 }],
    ['international', 'a non-boolean flag', { international: 'yes' }],
    ['international', 'a missing flag', { international: undefined }],
  ])('rejects %s: %s', (field, _label, patch) => {
    const result = paymentSettingsInputSchema.safeParse({ ...VALID, ...patch });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].path).toEqual([field]);
  });

  it('rejects an unknown key (strict) and a missing one (a PUT replaces the whole object)', () => {
    expect(paymentSettingsInputSchema.safeParse({ ...VALID, currency: 'USD' }).success).toBe(false);
    const { fixedFeeIdr: _omitted, ...missing } = VALID;
    expect(paymentSettingsInputSchema.safeParse(missing).success).toBe(false);
  });
});

describe('getPaymentSettingsView', () => {
  it('shows a flagged clinic with the worked example and the editor name from users', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow(), globalRate('16500'), globalMarkup('5')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view).toEqual({
      clinicId: 4,
      stored: VALID,
      effective: {
        international: true,
        methods: ['xendit', 'paypal', 'card'],
        fxRate: '18000',
        markupPercent: '10',
        fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
      globalDefaults: { fxRate: 16500, markupPercent: 5 },
      example: { price: '12.23', taxes: [], fee: '1.39', total: '13.62', idr: 200000 },
      updatedAt: '2026-10-06T08:00:00+00:00',
      updatedBy: { wpUserId: 123, name: 'Dewi Admin' },
    });
    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { wpUserId: 123n }, select: { displayName: true } });
  });

  it('answers the empty stored values for a clinic with no option, and previews with the global rate', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000'), globalMarkup('10')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.stored).toEqual(NOTHING_STORED);
    expect(view.effective).toEqual({
      international: false,
      methods: ['xendit'],
      fxRate: '18000',
      markupPercent: '10',
      fixedFeeIdr: '0',
      source: { fxRate: 'global', markupPercent: 'global', fixedFeeIdr: 'default' },
    });
    // Forced international for the preview: the admin sees the price before flagging.
    expect(view.example).toEqual({ price: '12.23', taxes: [], fee: null, total: '12.23', idr: 200000 });
    expect(view.updatedAt).toBeNull();
    expect(view.updatedBy).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('has no example when no rate is usable', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('500000')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.effective.fxRate).toBeNull();
    expect(view.effective.source.fxRate).toBeNull();
    expect(view.example).toBeNull();
    expect(view.globalDefaults).toEqual({ fxRate: 500000, markupPercent: null });
  });

  it('names the editor from wp_users when there is no users row, else by WordPress id', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow({ updated_by: 77 })]);
    db.kcUser.findUnique.mockResolvedValueOnce({ displayName: 'wp-editor' }).mockResolvedValueOnce(null);

    expect((await getPaymentSettingsView(CLINIC)).updatedBy).toEqual({ wpUserId: 77, name: 'wp-editor' });
    expect(db.kcUser.findUnique).toHaveBeenCalledWith({ where: { id: 77n }, select: { displayName: true } });
    expect((await getPaymentSettingsView(CLINIC)).updatedBy).toEqual({ wpUserId: 77, name: 'WordPress user #77' });
  });

  it('reads an unusable option as not international, with no preview, and logs it', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: OPTION_NAME, optionValue: 'a:1:{s:13:"international";b:1;}' },
      globalRate('18000'),
    ]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.stored).toEqual(NOTHING_STORED);
    expect(view.effective.international).toBe(false);
    expect(view.effective.fxRate).toBeNull();
    expect(view.example).toBeNull();
    expect(logging.logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: '4',
        metadata: { problems: [expect.stringContaining('clinic_payment_option_serialized')] },
      }),
    );
  });

  it('lets PaymentSettingsUnavailableError through on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    await expect(getPaymentSettingsView(CLINIC)).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });
});

describe('updatePaymentSettings', () => {
  it('rejects invalid input with per-field messages, before any read or write', async () => {
    const err = await updatePaymentSettings(CLINIC, { ...VALID, fxRate: 16.5, currency: 'USD' }, SUPER).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsValidationError);
    expect(Object.keys(err.fields).sort()).toEqual(['body', 'fxRate']);
    expect(err.fields.fxRate).toEqual(['fxRate must be from 1000 to 100000 (rupiah per 1 USD)']);
    expect(err.fields.body[0]).toContain('currency');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('reports a body that is not an object under body', async () => {
    const err = await updatePaymentSettings(CLINIC, null, SUPER).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsValidationError);
    expect(Object.keys(err.fields)).toEqual(['body']);
  });

  it.each([
    ['no clinic rate and no global rate', []],
    ['no clinic rate and an out-of-range global rate', [globalRate('500000')]],
  ])('refuses international with %s (fx_rate_required), without calling the plugin', async (_label, rows) => {
    db.kcOption.findMany.mockResolvedValue(rows);

    await expect(updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER)).rejects.toBeInstanceOf(FxRateRequiredError);
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('accepts international with no clinic rate when the global rate is usable', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);

    await updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, expect.objectContaining({ international: true, fx_rate: null }));
  });

  it('does not require a rate for a clinic that is not international', async () => {
    await updatePaymentSettings(CLINIC, NOTHING_STORED, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, {
      international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null, updated_by: 123,
    });
  });

  it('forwards the snake_case body with updated_by from users.wpUserId, audits before/after, and re-reads', async () => {
    db.kcOption.findMany
      .mockResolvedValueOnce([optionRow({ international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null })])
      .mockResolvedValueOnce([optionRow()]);

    const view = await updatePaymentSettings(CLINIC, VALID, SUPER);

    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: SUPER.id }, select: { wpUserId: true } });
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, {
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    expect(logging.logging.audit).toHaveBeenCalledWith('clinic.payment_settings.updated', {
      userId: SUPER.id,
      resource: 'clinic',
      resourceId: '4',
      metadata: { wpUserId: 123, before: NOTHING_STORED, after: VALID },
    });
    // The answer is the option read back, not the input echoed.
    expect(db.kcOption.findMany).toHaveBeenCalledTimes(2);
    expect(view.stored).toEqual(VALID);
    expect(view.updatedBy).toEqual({ wpUserId: 123, name: 'Dewi Admin' });
  });

  it.each([
    ['a users row with no WordPress link', { wpUserId: null }],
    ['no users row at all', null],
  ])('sends updated_by null for %s', async (_label, row) => {
    db.user.findUnique.mockImplementation(async (args: any) => (args.where.id ? row : null));

    await updatePaymentSettings(CLINIC, NOTHING_STORED, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, expect.objectContaining({ updated_by: null }));
    expect(logging.logging.audit).toHaveBeenCalledWith(
      'clinic.payment_settings.updated',
      expect.objectContaining({ userId: SUPER.id, metadata: expect.objectContaining({ wpUserId: null }) }),
    );
  });

  it("turns the plugin's own fx_rate_required into FxRateRequiredError, without an audit row", async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 422: A usable rate is required', 422, 'fx_rate_required'),
    );

    await expect(updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER)).rejects.toBeInstanceOf(FxRateRequiredError);
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('lets any other plugin error through, without an audit row', async () => {
    const saveFailed = new WpEndpointError('/clinics/4/payment-settings failed 500: could not be saved', 500, 'save_failed');
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(saveFailed);

    await expect(updatePaymentSettings(CLINIC, VALID, SUPER)).rejects.toBe(saveFailed);
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('answers a save that went through even when the editor name cannot be read', async () => {
    db.kcOption.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([optionRow()]);
    db.user.findUnique.mockImplementation(async (args: any) => {
      if (args.where.id === SUPER.id) return { wpUserId: 123n };
      throw new Error('Too many connections');
    });

    const view = await updatePaymentSettings(CLINIC, VALID, SUPER);

    expect(logging.logging.audit).toHaveBeenCalledTimes(1);
    expect(view.stored).toEqual(VALID);
    expect(view.updatedBy).toEqual({ wpUserId: 123, name: 'WordPress user #123' });
    expect(logging.logging.warn).toHaveBeenCalledWith('Clinic payment settings editor name unavailable', {
      metadata: { wpUserId: 123, error: 'Too many connections' },
    });
  });
});
