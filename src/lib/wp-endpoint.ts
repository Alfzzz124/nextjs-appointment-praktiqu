/**
 * WordPress praktiqu-endpoint plugin client — payments bridge.
 *
 * Mirrors the fetch-with-service-token pattern in `src/lib/jobs/client.ts`.
 */

import type { AllowedMime } from '@/services/uploads/validate-upload';

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
const WP_MEDIA_URL = `${WP_ENDPOINT}/wp-json/praktiqu/v1/media`;

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

/** Base for every plugin route, e.g. `${WP_API_BASE}/patients`. */
export const WP_API_BASE = `${WP_ENDPOINT}/wp-json/praktiqu/v1`;

/**
 * JSON request against the plugin, with the service token attached.
 *
 * Every caller previously repeated the same fetch → check `ok` → parse → rethrow
 * dance; this centralises it so error shapes stay consistent. WordPress reports
 * errors as `{ code, message, data: { status } }`, so surface `message` when present
 * rather than dumping the raw body.
 */
export async function wpRequestJson<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${WP_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-PraktiQU-Service-Token': serviceToken(),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const raw = await res.text();

  if (!res.ok) {
    let message = raw || res.statusText;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.message === 'string') message = parsed.message;
    } catch {
      // Not JSON — a PHP fatal or an HTML error page. Keep the raw text.
    }
    throw new WpEndpointError(`${path} failed ${res.status}: ${message}`, res.status);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new WpEndpointError(`${path} returned invalid JSON`, res.status);
  }
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
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new WpEndpointError('WC order create returned invalid JSON', res.status);
  }
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
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new WpEndpointError('WC order status returned invalid JSON', res.status);
  }
  return {
    orderId: data.orderId,
    status: data.status,
    isPaid: data.isPaid,
    transactionId: data.transactionId ?? null,
    amount: data.amount,
  };
}

/* ---------------------------------------------------------------- media --- */

export type UploadContext = 'medical-report' | 'custom-field';

export interface UploadMediaInput {
  filename: string;
  contentType: AllowedMime;
  bytes: Uint8Array;
  context: UploadContext;
}

export interface UploadMediaResult {
  mediaId: number;
  url: string;
  name: string;
}

/**
 * Sideload one file into the WordPress media library via the plugin.
 *
 * Content-Type is deliberately left unset so fetch generates the multipart
 * boundary itself; setting it by hand produces a body WP cannot parse.
 */
export async function uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
  const form = new FormData();
  form.append('context', input.context);
  form.append(
    'file',
    // `input.bytes` is typed as plain `Uint8Array` (i.e. `Uint8Array<ArrayBufferLike>`),
    // but DOM's `BlobPart` requires `ArrayBufferView<ArrayBuffer>`. Re-wrapping via the
    // `new Uint8Array(source)` overload yields a concrete `Uint8Array<ArrayBuffer>` copy
    // that satisfies the type without an unsafe cast.
    new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
    input.filename,
  );

  const res = await fetch(WP_MEDIA_URL, {
    method: 'POST',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`Media upload failed ${res.status}: ${text}`, res.status);
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new WpEndpointError('Media upload returned invalid JSON', res.status);
  }

  if (typeof data?.mediaId !== 'number' || !Number.isFinite(data.mediaId)) {
    throw new WpEndpointError('Media upload returned no media id', res.status);
  }

  return { mediaId: data.mediaId, url: String(data.url ?? ''), name: String(data.name ?? input.filename) };
}

export interface FetchedMedia {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filename: string;
  contentLength: number | null;
}

/**
 * Stream one attachment out of the WordPress media library.
 *
 * The bytes are never buffered here: the upstream body is handed straight to the
 * caller, which pipes it to the client. A 10 MB PDF must not become 10 MB of our
 * heap per concurrent reader.
 *
 * Authorisation is NOT performed here and cannot be — this call carries a service
 * token, not a user. Every caller must have already proven the requester may see
 * the row that owns this media id.
 */
export async function fetchMedia(mediaId: number): Promise<FetchedMedia> {
  const res = await fetch(`${WP_MEDIA_URL}/${mediaId}`, {
    method: 'GET',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`Media fetch failed ${res.status}: ${text}`, res.status);
  }
  if (!res.body) {
    throw new WpEndpointError('Media fetch returned no body', res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const lengthHeader = res.headers.get('content-length');

  return {
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    filename: match ? match[1] : `document-${mediaId}`,
    contentLength: lengthHeader === null ? null : Number(lengthHeader),
  };
}
