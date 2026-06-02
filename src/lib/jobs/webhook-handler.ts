/**
 * PraktiQU webhook receiver for WordPress job-completion callbacks.
 *
 * When the WordPress praktiqu-endpoint plugin runs a job, it can POST back
 * to this handler so PraktiQU can update its own state (e.g., mark a
 * session COMPLETED, send a reminder email, etc.).
 *
 * Signature: HMAC-SHA256 of raw body with `WORDPRESS_WEBHOOK_SECRET`,
 * sent in the `X-PraktiQU-Webhook-Signature` header.
 *
 * @packageDocumentation
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logging } from '../logging';

const WEBHOOK_SECRET = process.env.WORDPRESS_WEBHOOK_SECRET ?? '';

export interface WebhookPayload {
  /** 'praktiqu-endpoint' */
  source: string;
  /** Event name, e.g. 'session.auto_complete', 'session.reminder' */
  event: string;
  /** Event-specific data */
  data: Record<string, unknown>;
  /** ISO timestamp */
  at: string;
}

/**
 * Verify the HMAC-SHA256 signature on an incoming webhook request.
 * Returns true if the signature is valid OR no secret is configured (dev only).
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) {
    // No secret configured → dev mode; accept everything. Log a warning.
    if (process.env.NODE_ENV === 'production') {
      console.warn('[webhook] WORDPRESS_WEBHOOK_SECRET is not set in production — rejecting all webhooks');
      return false;
    }
    return true;
  }
  if (!signature) return false;

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

/**
 * Dispatcher that maps event names to handler functions. Each feature spec
 * registers its handlers here.
 */
const handlers: Map<string, JobHandler> = new Map();

export function registerJobHandler(event: string, handler: JobHandler): void {
  handlers.set(event, handler);
}

/**
 * Process an incoming webhook request.
 *
 * @param rawBody The raw request body (string)
 * @param signature The X-PraktiQU-Webhook-Signature header value
 * @returns true if handled, false if rejected (signature failure)
 * @throws if a handler throws (caller should still return 200 to prevent retries)
 */
export async function processWebhook(rawBody: string, signature: string | null): Promise<boolean> {
  if (!verifyWebhookSignature(rawBody, signature)) {
    return false;
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    await logging.error('Failed to parse WordPress webhook body', err, { metadata: { rawLength: rawBody.length } });
    return true; // signature OK → don't retry
  }

  const handler = handlers.get(payload.event);
  if (!handler) {
    await logging.warn(`No handler registered for webhook event: ${payload.event}`, {
      metadata: { event: payload.event },
    });
    return true;
  }

  try {
    await handler(payload.data);
    await logging.audit(`webhook.${payload.event}`, { metadata: { event: payload.event, data: payload.data } });
  } catch (err) {
    await logging.error(`Webhook handler failed for ${payload.event}`, err, {
      metadata: { event: payload.event, data: payload.data },
    });
    // Swallow — WP should not retry. Persist failure in the audit log for debugging.
  }

  return true;
}
