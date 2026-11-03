/**
 * A clinic's international payment settings — the admin view and the save path.
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §1
 * ("Write and read paths") and §3 (`GET` / `PUT /api/v1/practices/{id}/payment-settings`).
 *
 * Reads come straight from `wp_options` (one KcOption query: the clinic's option plus
 * both global defaults). Writes go through the plugin, so WordPress's object cache stays
 * consistent. The PUT answer is then built by RE-READING the option, so a storage-format
 * mismatch (a PHP-serialized value, say) shows on the first save instead of weeks later
 * as a clinic that silently stopped being international.
 */
import { z } from 'zod';
import type { Actor } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import { WpEndpointError, putClinicPaymentSettings, type PaymentMethod } from '@/lib/wp-endpoint';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  FEE_MAX,
  MARKUP_MAX,
  RATE_MAX,
  RATE_MIN,
  buildUsdQuote,
  hasAtMostTwoDecimals,
  isUsableRate,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  toUsdView,
  type GlobalDefaults,
  type ParsedOption,
  type PublicUsdView,
  type ValueSource,
} from '@/services/payments/intl-pricing';

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface PaymentSettingsInput {
  international: boolean;
  fxRate: number | null;
  markupPercent: number | null;
  fixedFeeIdr: number | null;
}

const TWO_DECIMALS = 'must have at most 2 decimals';
const RATE_RANGE = `fxRate must be from ${RATE_MIN} to ${RATE_MAX} (rupiah per 1 USD)`;
const MARKUP_RANGE = `markupPercent must be from 0 to ${MARKUP_MAX}`;
const FEE_RANGE = `fixedFeeIdr must be a whole rupiah amount from 0 to ${FEE_MAX}`;

/**
 * Spec §1 "Validation". Every key is required (null means "use the global value" for
 * the rate and markup, and "no fee" for the fee): a PUT replaces the clinic's whole
 * object. The 1,000–100,000 range rejects an inverted or mistyped rate such as 0.00006,
 * or "16.500" read as 16.5. The cross-field rule (international needs a usable rate)
 * needs the global option, so `updatePaymentSettings` checks it after parsing.
 *
 * The cast is for the compiler only: with `strict: false` (tsconfig) zod infers every
 * key as optional, although the schema itself requires all four.
 */
export const paymentSettingsInputSchema = z
  .object({
    international: z.boolean(),
    fxRate: z
      .number()
      .min(RATE_MIN, RATE_RANGE)
      .max(RATE_MAX, RATE_RANGE)
      .refine(hasAtMostTwoDecimals, `fxRate ${TWO_DECIMALS}`)
      .nullable(),
    markupPercent: z
      .number()
      .min(0, MARKUP_RANGE)
      .max(MARKUP_MAX, MARKUP_RANGE)
      .refine(hasAtMostTwoDecimals, `markupPercent ${TWO_DECIMALS}`)
      .nullable(),
    fixedFeeIdr: z.number().int(FEE_RANGE).min(0, FEE_RANGE).max(FEE_MAX, FEE_RANGE).nullable(),
  })
  .strict() as z.ZodType<PaymentSettingsInput>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** The body failed the schema. `fields` is keyed by field name (`body` for the object itself). */
export class PaymentSettingsValidationError extends Error {
  constructor(public fields: Record<string, string[]>) {
    super('Invalid payment settings');
    this.name = 'PaymentSettingsValidationError';
  }
}

/** International without a usable rate from the clinic or the global option. 422. */
export class FxRateRequiredError extends Error {}

const FX_RATE_REQUIRED =
  'An international clinic needs a usable FX rate: enter one, or set the global rate in WordPress first';

function issuesToFields(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    // An unknown key (.strict()) or a body that is not an object has no path.
    const key = issue.path.length > 0 ? issue.path.join('.') : 'body';
    if (!fields[key]) fields[key] = [];
    fields[key].push(issue.message);
  }
  return fields;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export interface PaymentSettingsView {
  clinicId: number;
  /** The clinic's own values; with no (usable) option, international false and every field null. */
  stored: { international: boolean; fxRate: number | null; markupPercent: number | null; fixedFeeIdr: number | null };
  /** Resolved with their sources whatever the flag — the rate may be null. */
  effective: {
    international: boolean;
    methods: PaymentMethod[];
    fxRate: string | null;
    markupPercent: string;
    fixedFeeIdr: string;
    source: { fxRate: ValueSource | null; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
  };
  /** The global rate and markup, for form placeholders. */
  globalDefaults: GlobalDefaults;
  /** Rp 200,000 in USD with the effective values, whenever a usable rate exists. */
  example: (PublicUsdView & { idr: number }) | null;
  updatedAt: string | null;
  updatedBy: { wpUserId: number; name: string } | null;
}

const EXAMPLE_IDR = 200_000;

function storedOf(parsed: ParsedOption): PaymentSettingsView['stored'] {
  if (parsed.status !== 'ok') return { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };
  const { international, fxRate, markupPercent, fixedFeeIdr } = parsed.value;
  return { international, fxRate, markupPercent, fixedFeeIdr };
}

/**
 * `users.displayName`, else `wp_users.display_name`, else the bare WordPress id.
 *
 * Never throws: the name is a label, and this view is also the answer to a PUT that has
 * already saved and been audited — a failed lookup must not turn that save into an error.
 */
async function editorName(wpUserId: number): Promise<string> {
  try {
    const user = await prisma.user.findUnique({ where: { wpUserId: BigInt(wpUserId) }, select: { displayName: true } });
    if (user?.displayName?.trim()) return user.displayName.trim();
    const wpUser = await prisma.kcUser.findUnique({ where: { id: BigInt(wpUserId) }, select: { displayName: true } });
    if (wpUser?.displayName?.trim()) return wpUser.displayName.trim();
  } catch (err) {
    await logging.warn('Clinic payment settings editor name unavailable', {
      metadata: { wpUserId, error: err instanceof Error ? err.message : String(err) },
    });
  }
  return `WordPress user #${wpUserId}`;
}

/** Throws PaymentSettingsUnavailableError when wp_options cannot be read. */
export async function getPaymentSettingsView(clinicId: number): Promise<PaymentSettingsView> {
  const raw = await readRawPaymentOptions([clinicId]);
  const parsed = parseStoredOption(raw.byClinic.get(clinicId));
  const globalDefaults = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  const settings = resolveSettings(clinicId, parsed, globalDefaults);
  if (settings.problems.length > 0) {
    await logging.warn('Clinic payment settings problem', {
      resource: 'clinic',
      resourceId: String(clinicId),
      metadata: { problems: settings.problems },
    });
  }

  // Forced international so an admin can preview the price before flagging the clinic.
  const preview =
    settings.rate === null
      ? null
      : toUsdView(buildUsdQuote([{ name: 'Example', price: EXAMPLE_IDR }], [], { ...settings, international: true }));

  const stored = parsed.status === 'ok' ? parsed.value : null;
  return {
    clinicId,
    stored: storedOf(parsed),
    effective: {
      international: settings.international,
      methods: settings.methods,
      fxRate: settings.rate === null ? null : settings.rate.toString(),
      markupPercent: settings.markupPercent.toString(),
      fixedFeeIdr: settings.fixedFeeIdr.toString(),
      source: settings.source,
    },
    globalDefaults,
    example: preview === null ? null : { ...preview, idr: EXAMPLE_IDR },
    updatedAt: stored?.updatedAt ?? null,
    updatedBy:
      stored?.updatedBy == null ? null : { wpUserId: stored.updatedBy, name: await editorName(stored.updatedBy) },
  };
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate, write through the plugin, audit, and answer with the option read back.
 *
 * Throws PaymentSettingsValidationError, FxRateRequiredError (ours or the plugin's own
 * re-check), PaymentSettingsUnavailableError, or the plugin's WpEndpointError. The
 * caller has already checked scope and that the clinic exists.
 */
export async function updatePaymentSettings(
  clinicId: number,
  input: unknown,
  actor: Actor,
): Promise<PaymentSettingsView> {
  const parsed = paymentSettingsInputSchema.safeParse(input);
  if (!parsed.success) throw new PaymentSettingsValidationError(issuesToFields(parsed.error));
  const next = parsed.data;

  // One read: the option as it stands (for the audit trail) and the global rate (for
  // the cross-field rule). The plugin re-checks the rule against its own read.
  const raw = await readRawPaymentOptions([clinicId]);
  const globals = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  if (next.international && !isUsableRate(next.fxRate) && !isUsableRate(globals.fxRate)) {
    throw new FxRateRequiredError(FX_RATE_REQUIRED);
  }

  // users.id -> wp_users.ID. Not resolveKcActor: it skips SUPER_ADMIN and 403s an
  // account with no WordPress link, and neither may block a save (spec §1).
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { wpUserId: true } });
  const wpUserId = user?.wpUserId ? Number(user.wpUserId) : null;

  try {
    await putClinicPaymentSettings(clinicId, {
      international: next.international,
      fx_rate: next.fxRate,
      markup_percent: next.markupPercent,
      fixed_fee_idr: next.fixedFeeIdr,
      updated_by: wpUserId,
    });
  } catch (err) {
    if (err instanceof WpEndpointError && err.code === 'fx_rate_required') throw new FxRateRequiredError(FX_RATE_REQUIRED);
    throw err;
  }

  // userId is the caller's users.id (a cuid): log_entries.userId is a foreign key to
  // users.id, and logging swallows insert errors, so a wp_users.ID here would drop the row.
  await logging.audit('clinic.payment_settings.updated', {
    userId: actor.id,
    resource: 'clinic',
    resourceId: String(clinicId),
    metadata: { wpUserId, before: storedOf(parseStoredOption(raw.byClinic.get(clinicId))), after: next },
  });

  return getPaymentSettingsView(clinicId);
}
