import { calculateTax } from '@/services/billing/bill.service';
import type { BillDetail } from '@/services/billing/bill.service';
import { toNum } from '@/lib/kc-num';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaymentLineItem {
  name: string;
  price: number;
}

export interface PaymentTaxLine {
  name: string;
  amount: number;
}

export interface ComputedAmount {
  expectedAmount: number;
  items: PaymentLineItem[];
  taxes: PaymentTaxLine[];
}

/** Round to a whole rupiah — IDR has no fractional subunit in practice. */
function toRupiah(n: number): number {
  return Math.round(n);
}

/**
 * Public/guest booking amount. Only GLOBAL taxes (clinicId -1/null) apply —
 * app-table Clinic cuids have no bridge to the legacy wp_kc numeric clinic id
 * that clinic-scoped kcTax rows are keyed on, so clinic-specific taxes are out
 * of scope until that bridge exists.
 */
export async function computePublicAmount(service: { name: string; price: number | string }): Promise<ComputedAmount> {
  const price = toNum(service.price);
  const { total_tax, calculated_taxes } = await calculateTax({
    serviceItems: [{ serviceId: 0, service_name: service.name, price, quantity: 1 }],
  });
  const taxes: PaymentTaxLine[] = calculated_taxes.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return {
    expectedAmount: toRupiah(price + total_tax),
    items: [{ name: service.name, price: toRupiah(price) }],
    taxes,
  };
}

/** Staff/session amount — the bill's own totals (already tax-inclusive) drive the WC order. */
export function computeSessionAmountFromBill(bill: BillDetail): ComputedAmount {
  const items: PaymentLineItem[] = bill.serviceItems.map((i) => ({
    name: i.service_name || 'Service',
    price: toRupiah(i.price * i.quantity),
  }));
  const taxes: PaymentTaxLine[] = bill.taxItems.map((t) => ({ name: t.tax_name, amount: toRupiah(t.tax_amount) }));
  return { expectedAmount: toRupiah(bill.total_amount), items, taxes };
}

/**
 * Constant-time HMAC-SHA256 verification for `sessions/payment-webhook`.
 * Deliberately a SEPARATE secret from WORDPRESS_WEBHOOK_SECRET/AUTH_SECRET —
 * see Global Constraints in the implementation plan.
 */
export function verifyPaymentWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false;
    return true; // dev-only fallback, mirrors src/lib/jobs/webhook-handler.ts
  }
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
