/**
 * WordPress praktiqu-endpoint plugin client — payments bridge.
 *
 * Mirrors the fetch-with-service-token pattern in `src/lib/jobs/client.ts`.
 */

export interface PaymentOrderItem {
  name: string;
  price: number;
}

export interface PaymentOrderTax {
  name: string;
  amount: number;
}

export interface CreateWcOrderInput {
  source: 'public' | 'session';
  appointmentId?: string;
  billId?: string;
  encounterId?: string;
  customerName: string;
  customerEmail: string;
  items: PaymentOrderItem[];
  taxes: PaymentOrderTax[];
  returnUrl: string;
  cancelUrl: string;
}

export interface CreateWcOrderResult {
  orderId: number;
  checkoutUrl: string;
}

export interface WcOrderStatus {
  orderId: number;
  status: string;
  isPaid: boolean;
  transactionId: string | null;
  amount: number;
}

const WP_ENDPOINT = process.env.WORDPRESS_URL ?? 'http://localhost:9001';
const WP_PAYMENTS_BASE = `${WP_ENDPOINT}/wp-json/praktiqu/v1/payments`;

export class WpEndpointError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'WpEndpointError';
  }
}

function serviceToken(): string {
  const token = process.env.WORDPRESS_SERVICE_TOKEN ?? '';
  if (!token) throw new WpEndpointError('WORDPRESS_SERVICE_TOKEN not set', 500);
  return token;
}

export async function createWcOrder(input: CreateWcOrderInput): Promise<CreateWcOrderResult> {
  const res = await fetch(`${WP_PAYMENTS_BASE}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PraktiQU-Service-Token': serviceToken() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order create failed ${res.status}: ${text}`, res.status);
  }
  const data = await res.json();
  return { orderId: data.orderId, checkoutUrl: data.checkoutUrl };
}

export async function getWcOrderStatus(orderId: number): Promise<WcOrderStatus> {
  const res = await fetch(`${WP_PAYMENTS_BASE}/order/${orderId}`, {
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order status fetch failed ${res.status}: ${text}`, res.status);
  }
  const data = await res.json();
  return {
    orderId: data.orderId,
    status: data.status,
    isPaid: data.isPaid,
    transactionId: data.transactionId ?? null,
    amount: data.amount,
  };
}
