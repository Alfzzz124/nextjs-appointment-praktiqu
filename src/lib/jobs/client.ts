/**
 * WordPress Action Scheduler enqueue client.
 *
 * PraktiQU uses this to schedule background work on WordPress's Action Scheduler.
 *
 * Pattern (per C8):
 *   1. PraktiQU calls `enqueue()` → POSTs to WP /jobs endpoint
 *   2. WordPress's praktiqu-endpoint plugin schedules it via Action Scheduler
 *   3. WP-Cron fires the handler at runAt
 *   4. The handler optionally calls back to PraktiQU via webhook
 *
 * Flow is fire-and-forget. Errors on the WordPress side are logged by the WP plugin.
 */

export interface EnqueueJobOptions {
  hook: JobHook;
  runAt: Date;
  args?: Record<string, unknown>;
}

export type JobHook =
  | 'praktiqu_session_auto_complete'
  | 'praktiqu_session_send_reminder'
  | 'praktiqu_log_purge'
  | 'praktiqu_payment_auto_cancel'
  | 'praktiqu_booking_unpaid_cancel'
  | 'praktiqu_approval_reminder';

/** Cancel a previously enqueued job by hook + matcher args. */
export interface CancelJobOptions {
  hook: JobHook;
  args?: Record<string, unknown>;
}

const WP_ENDPOINT = process.env.WORDPRESS_URL ?? 'http://localhost:9001';
const WP_SERVICE_TOKEN = process.env.WORDPRESS_SERVICE_TOKEN ?? '';
const WP_ENDPOINT_JOBS = `${WP_ENDPOINT}/wp-json/praktiqu/v1/jobs`;

// Re-export the job completion webhook receiver types so callers can type their handlers.
export { type JobHandler } from './webhook-handler';

/**
 * Enqueue a job on WordPress Action Scheduler.
 *
 * @example
 *   await jobs.enqueue({ hook: 'praktiqu_session_auto_complete', runAt: session.endTimePlus24h, args: { sessionId } });
 *
 * Never throws: a failure is logged to the console and reported as false, so a caller
 * that cannot do without the job can say so somewhere durable.
 *
 * @returns true when WordPress accepted the job; false when it was not scheduled.
 */
export async function enqueue(options: EnqueueJobOptions): Promise<boolean> {
  if (!WP_SERVICE_TOKEN) {
    console.warn('[jobs] WORDPRESS_SERVICE_TOKEN not set — job not scheduled:', options.hook);
    return false;
  }

  try {
    const res = await fetch(WP_ENDPOINT_JOBS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PraktiQU-Service-Token': WP_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        hook: options.hook,
        runAt: Math.floor(options.runAt.getTime() / 1000), // Unix seconds (WP AS expects seconds)
        args: options.args ?? {},
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.error(`[jobs] enqueue failed ${res.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[jobs] enqueue failed:', err);
    return false;
  }
}

/**
 * Cancel all jobs matching hook + args on WordPress Action Scheduler.
 *
 * @example
 *   await jobs.cancel({ hook: 'praktiqu_session_send_reminder', args: { sessionId } });
 */
export async function cancel(options: CancelJobOptions): Promise<void> {
  if (!WP_SERVICE_TOKEN) return;
  await fetch(WP_ENDPOINT_JOBS, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-PraktiQU-Service-Token': WP_SERVICE_TOKEN,
    },
    body: JSON.stringify({ hook: options.hook, args: options.args ?? {} }),
  }).catch(console.error);
}

export const jobs = { enqueue, cancel };
