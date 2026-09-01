/**
 * WordPress praktiqu-endpoint plugin client — payments bridge.
 *
 * Mirrors the fetch-with-service-token pattern in `src/lib/jobs/client.ts`.
 */

import type { AllowedMime } from '@/services/uploads/validate-upload';
import { toNum } from '@/lib/kc-num';

export interface PaymentOrderItem {
  name: string;
  price: number;
}

export interface PaymentOrderTax {
  name: string;
  amount: number;
}

/** Payment methods the WP plugin's create_order() accepts. */
export type PaymentMethod = 'xendit' | 'paypal' | 'card';

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
  /** Omitted means 'xendit' — the plugin applies the same default. */
  method?: PaymentMethod;
}

export interface CreateWcOrderResult {
  orderId: number;
  checkoutUrl: string;
  /** What the payer will actually be billed, in `chargedCurrency`. Null from a
   *  pre-1.5.0 plugin, which does not report it. */
  chargedAmount: number | null;
  /** ISO 4217 code. 'IDR' for Xendit; 'USD' for paypal/card. */
  chargedCurrency: string;
  /** Rupiah per 1 unit of `chargedCurrency`; null when no conversion happened. */
  fxRate: number | null;
}

export interface WcOrderStatus {
  orderId: number;
  status: string;
  isPaid: boolean;
  transactionId: string | null;
  amount: number;
  /** ISO 4217 code. Absent from a pre-1.5.0 plugin, in which case 'IDR'. */
  currency: string;
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

/**
 * Raised when the request could not be *made* — a missing service token, not a refusal
 * the plugin sent back. It extends `WpEndpointError` so every existing `instanceof`
 * catch keeps behaving exactly as before; what it adds is the ability to tell the two
 * apart where that matters.
 *
 * It matters wherever a caller swallows a plugin failure on purpose. Refusing one row
 * is per-row and safe to skip; not holding a token is global and permanent, and
 * swallowing it turns a misconfigured deploy into silent, accumulating data loss
 * instead of a loud failure on the first request. See `resolvePatient` in
 * `services/public/public-booking.service.ts`.
 */
export class WpConfigError extends WpEndpointError {
  constructor(message: string) {
    super(message, 500);
    this.name = 'WpConfigError';
  }
}

/**
 * `fetch`, with "WordPress never answered" turned into a `WpEndpointError` of status 0.
 *
 * Undici throws a plain `TypeError` when the request never reaches WordPress at all —
 * connection refused, reset mid-flight, DNS failure, connect timeout. That is not an
 * HTTP status, so it slipped past every `instanceof WpEndpointError` check in this
 * codebase and arrived at the client as a bare 500 with no code and no Retry-After.
 *
 * Which is backwards: no answer at all is the *most* transient failure there is, and
 * the one most worth retrying. Status 0 says exactly that — distinct from every status
 * WordPress could actually send, so a caller can tell "the far side refused" from "the
 * far side was not there".
 *
 * The label is a path, never the full URL: these messages reach clients through
 * `client.service.ts` and friends, and the WordPress host is not a caller's business.
 */
async function wpFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // undici hangs the real reason (ECONNREFUSED, ECONNRESET, ...) off `cause`. Read
    // through a cast rather than the typed property: this project's `lib` predates
    // ES2022, where `Error.cause` was standardised, and one log line is not worth
    // moving the whole compilation target.
    const cause = (err as { cause?: unknown })?.cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    throw new WpEndpointError(`${label} unreachable${detail}`, 0);
  }
}

function serviceToken(): string {
  const token = process.env.WORDPRESS_SERVICE_TOKEN ?? '';
  if (!token) throw new WpConfigError('WORDPRESS_SERVICE_TOKEN not set');
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
  const res = await wpFetch(`${WP_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-PraktiQU-Service-Token': serviceToken(),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  }, path);

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
  const res = await wpFetch(`${WP_PAYMENTS_BASE}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PraktiQU-Service-Token': serviceToken() },
    body: JSON.stringify(input),
  }, '/payments/order');
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
  // A plugin older than 1.5.0 omits these three. Report chargedAmount as null
  // rather than coercing it to 0 — the service layer substitutes the rupiah
  // expectedAmount for null, whereas a 0 would be stored as a real charge of nothing.
  return {
    orderId: data.orderId,
    checkoutUrl: data.checkoutUrl,
    chargedAmount: data.chargedAmount === null || data.chargedAmount === undefined ? null : toNum(data.chargedAmount),
    chargedCurrency: typeof data.chargedCurrency === 'string' ? data.chargedCurrency : 'IDR',
    fxRate: data.fxRate === null || data.fxRate === undefined ? null : toNum(data.fxRate),
  };
}

export async function getWcOrderStatus(orderId: number): Promise<WcOrderStatus> {
  const res = await wpFetch(`${WP_PAYMENTS_BASE}/order/${orderId}`, {
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  }, `/payments/order/${orderId}`);
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
    currency: typeof data.currency === 'string' ? data.currency : 'IDR',
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

  const res = await wpFetch(WP_MEDIA_URL, {
    method: 'POST',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
    body: form,
  }, '/media');

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
  const res = await wpFetch(`${WP_MEDIA_URL}/${mediaId}`, {
    method: 'GET',
    headers: { 'X-PraktiQU-Service-Token': serviceToken() },
  }, `/media/${mediaId}`);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`Media fetch failed ${res.status}: ${text}`, res.status);
  }
  if (!res.body) {
    throw new WpEndpointError('Media fetch returned no body', res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const lengthHeader = res.headers.get('content-length');

  return {
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    filename: parseDispositionFilename(disposition) ?? `document-${mediaId}`,
    contentLength: lengthHeader === null ? null : Number(lengthHeader),
  };
}

/**
 * Parse a filename out of a `Content-Disposition` header per RFC 6266/5987.
 *
 * The plugin (see `class-praktiqu-endpoint-media.php::stream()`) emits both
 * forms: `filename*=UTF-8''<percent-encoded>` carries the real, possibly
 * non-ASCII name, while `filename="..."` is an ASCII-safe fallback. Prefer
 * the starred form and decode it; only fall back to the quoted form when it's
 * missing. The quoted-form regex must not match the `filename*=` parameter,
 * so it requires `filename=` not preceded by a `*`.
 */
function parseDispositionFilename(disposition: string): string | null {
  const starMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch {
      // Malformed percent-encoding — fall through to the quoted form.
    }
  }

  const quotedMatch = /(?<!\*)filename="([^"]+)"/i.exec(disposition);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  return null;
}
