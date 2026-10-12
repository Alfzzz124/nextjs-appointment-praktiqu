/**
 * Per-clinic payment settings, straight from `wp_options`.
 *
 * One option per clinic, `praktiqu_endpoint_clinic_{id}_payment`, holding a JSON
 * string the praktiqu-endpoint plugin writes (spec §1). The two global options live in
 * the same table. Reads only — writes go through the plugin's
 * `PUT /praktiqu/v1/clinics/{id}/payment-settings` so WordPress's object cache stays
 * consistent.
 *
 * Returns the raw strings; decoding and validation are the pure job of
 * `services/payments/intl-pricing.ts`.
 */
import { prisma } from '@/lib/db';

export const GLOBAL_RATE_OPTION = 'praktiqu_endpoint_paypal_idr_rate';
export const GLOBAL_MARKUP_OPTION = 'praktiqu_endpoint_paypal_markup_percent';

export function clinicPaymentOptionName(clinicId: number): string {
  return `praktiqu_endpoint_clinic_${clinicId}_payment`;
}

/**
 * The settings could not be read at all (a database error). Display paths treat the
 * clinic as not international; the payment gate answers a retryable 503 — a temporary
 * outage must never look like a permanent "not allowed".
 */
export class PaymentSettingsUnavailableError extends Error {
  // `cause` by hand: this project's `lib` (ES2020) predates the standard Error.cause.
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'PaymentSettingsUnavailableError';
  }
}

export interface RawPaymentOptions {
  byClinic: Map<number, string>;
  globalRate: string | null;
  globalMarkup: string | null;
}

/** One query for every requested clinic plus both global options. */
export async function readRawPaymentOptions(clinicIds: number[]): Promise<RawPaymentOptions> {
  const nameToClinic = new Map<string, number>();
  for (const id of clinicIds) nameToClinic.set(clinicPaymentOptionName(id), id);

  let rows: Array<{ optionName: string; optionValue: string }>;
  try {
    rows = await prisma.kcOption.findMany({
      where: { optionName: { in: [...nameToClinic.keys(), GLOBAL_RATE_OPTION, GLOBAL_MARKUP_OPTION] } },
      select: { optionName: true, optionValue: true },
    });
  } catch (err) {
    throw new PaymentSettingsUnavailableError('Could not read clinic payment settings from wp_options', err);
  }

  const result: RawPaymentOptions = { byClinic: new Map(), globalRate: null, globalMarkup: null };
  for (const row of rows) {
    if (row.optionName === GLOBAL_RATE_OPTION) result.globalRate = row.optionValue;
    else if (row.optionName === GLOBAL_MARKUP_OPTION) result.globalMarkup = row.optionValue;
    else {
      const clinicId = nameToClinic.get(row.optionName);
      if (clinicId !== undefined) result.byClinic.set(clinicId, row.optionValue);
    }
  }
  return result;
}
