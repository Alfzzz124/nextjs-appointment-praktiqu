/**
 * The `paymentMethods` + `usd` fields of one public catalogue/booking row.
 *
 * Kept apart from intl-pricing (pure) and clinic-payment.service because it needs
 * `computePublicAmount`, and payment.service imports both of those — putting this
 * there would close an import cycle.
 *
 * The quote comes from the same `computePublicAmount` + `buildUsdQuote` used to charge,
 * so for the same settings the displayed and charged USD figures match.
 */
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { logging } from '@/lib/logging';
import { computePublicAmount } from '@/services/payments/payment.service';
import {
  XENDIT_ONLY,
  buildUsdQuote,
  toUsdView,
  type ClinicPaymentSettings,
  type PublicUsdView,
} from '@/services/payments/intl-pricing';

export interface RowPayment {
  paymentMethods: PaymentMethod[];
  usd: PublicUsdView | null;
}

export async function rowPaymentFor(
  args: { clinicId: number; doctorId: number; serviceId: number; name: string; price: number | string },
  settings: ClinicPaymentSettings,
): Promise<RowPayment> {
  // No tax query for the common case: a clinic that cannot take PayPal shows rupiah.
  if (!settings.methods.includes('paypal')) return { paymentMethods: [...XENDIT_ONLY], usd: null };

  const { items, taxes } = await computePublicAmount({
    name: args.name,
    price: args.price,
    serviceId: args.serviceId,
    clinicId: args.clinicId,
    doctorId: args.doctorId,
  });
  const quote = buildUsdQuote(items, taxes, settings);
  if (quote === null) return { paymentMethods: [...XENDIT_ONLY], usd: null };
  return { paymentMethods: [...settings.methods], usd: toUsdView(quote) };
}

/**
 * Display variant: never throws. A failed tax read is logged and the row shows rupiah
 * and Xendit only — the same fail-closed answer as a failed settings read (spec §1
 * rule 5). Used where the row is shown, never where it is charged: a booking that is
 * already written must not answer an error because its USD preview could not be built.
 */
export async function rowPaymentForDisplay(
  args: { clinicId: number; doctorId: number; serviceId: number; name: string; price: number | string },
  settings: ClinicPaymentSettings,
): Promise<RowPayment> {
  try {
    return await rowPaymentFor(args, settings);
  } catch (err) {
    await logging.error('USD price unavailable — showing rupiah and Xendit only', err, {
      resource: 'clinic',
      resourceId: String(args.clinicId),
      metadata: { doctorId: args.doctorId, serviceId: args.serviceId },
    });
    return { paymentMethods: [...XENDIT_ONLY], usd: null };
  }
}
