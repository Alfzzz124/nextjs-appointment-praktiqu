/**
 * Resolve a clinic's international payment settings (spec §1, rules 1–5).
 *
 * The payment variants throw `PaymentSettingsUnavailableError` on a database error so
 * the gate can answer a retryable 503. The display variants never throw: a failed read
 * shows rupiah and Xendit only (rule 5) and is logged.
 */
import { logging } from '@/lib/logging';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  notInternational,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  type ClinicPaymentSettings,
  type GlobalDefaults,
} from '@/services/payments/intl-pricing';

export { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';

function isRealClinicId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

/** Throws PaymentSettingsUnavailableError. Every requested id gets an entry. */
export async function resolveClinicPaymentMany(clinicIds: number[]): Promise<Map<number, ClinicPaymentSettings>> {
  const result = new Map<number, ClinicPaymentSettings>();
  const ids = [...new Set(clinicIds)];
  for (const id of ids) if (!isRealClinicId(id)) result.set(id, notInternational(id));

  const real = ids.filter(isRealClinicId);
  if (real.length === 0) return result;

  const raw = await readRawPaymentOptions(real);
  const globals = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  for (const id of real) {
    const settings = resolveSettings(id, parseStoredOption(raw.byClinic.get(id)), globals);
    if (settings.problems.length > 0) {
      await logging.warn('Clinic payment settings problem', {
        resource: 'clinic',
        resourceId: String(id),
        metadata: { problems: settings.problems },
      });
    }
    result.set(id, settings);
  }
  return result;
}

/** Throws PaymentSettingsUnavailableError. A clinic id of 0 or below is not international. */
export async function resolveClinicPayment(clinicId: number): Promise<ClinicPaymentSettings> {
  if (!isRealClinicId(clinicId)) return notInternational(clinicId);
  const many = await resolveClinicPaymentMany([clinicId]);
  return many.get(clinicId) ?? notInternational(clinicId);
}

/** Never throws: a failed read is logged and every clinic reads as not international. */
export async function resolveClinicPaymentManyForDisplay(clinicIds: number[]): Promise<Map<number, ClinicPaymentSettings>> {
  try {
    return await resolveClinicPaymentMany(clinicIds);
  } catch (err) {
    await logging.error('Clinic payment settings unavailable — showing rupiah and Xendit only', err, {
      metadata: { clinicIds },
    });
    return new Map(clinicIds.map((id) => [id, notInternational(id)]));
  }
}

/** Never throws: see resolveClinicPaymentManyForDisplay. */
export async function resolveClinicPaymentForDisplay(clinicId: number): Promise<ClinicPaymentSettings> {
  const many = await resolveClinicPaymentManyForDisplay([clinicId]);
  return many.get(clinicId) ?? notInternational(clinicId);
}

/** The two global options, for the settings page placeholders. Throws PaymentSettingsUnavailableError. */
export async function readGlobalDefaults(): Promise<GlobalDefaults> {
  const raw = await readRawPaymentOptions([]);
  return parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
}
