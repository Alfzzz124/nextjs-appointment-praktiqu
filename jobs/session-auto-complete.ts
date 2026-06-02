/**
 * Session auto-completion background job.
 *
 * Source of truth: plan.md ("Auto-Completion Background Job") and spec.md (FR-008, SC-007).
 *
 * Logic:
 *   1. Query all sessions with status = CHECK_OUT AND checkedOutAt < NOW() - 24 hours.
 *   2. Update each to status = COMPLETED with AUDIT log.
 *   3. Optionally enqueue a WordPress Action Scheduler job for follow-up (billing, etc.).
 *
 * Usage:
 *   - Cron: run every hour via Vercel cron, external cron service, or WP AS.
 *   - Direct: node jobs/session-auto-complete.ts
 *
 * Environment:
 *   - Uses Prisma singleton (src/lib/db.ts) — compatible with Next.js / standalone.
 *   - WORDPRESS_SERVICE_TOKEN for enqueuing follow-up jobs on WP side.
 */

import { autoCompleteOldSessions } from '@/services/session/session.service';
import { logging } from '@/lib/logging';
import { jobs } from '@/lib/jobs/client';

// 24 hours in milliseconds (FR-008).
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function runSessionAutoComplete(): Promise<{ completed: number; durationMs: number }> {
  const start = Date.now();
  logging.system('session_auto_complete: started');

  try {
    const updated = await autoCompleteOldSessions(TWENTY_FOUR_HOURS_MS);
    const elapsed = Date.now() - start;

    if (updated > 0) {
      logging.system(
        `session_auto_complete: marked ${updated} session(s) as COMPLETED`,
        'INFO',
        { metadata: { count: updated, elapsedMs: elapsed } },
      );

      // Optionally enqueue WP follow-up job for billing trigger.
      await jobs.enqueue({
        hook: 'praktiqu_session_billing_trigger',
        runAt: new Date(),
        args: { count: updated },
      }).catch((err) => {
        logging.warn('session_auto_complete: failed to enqueue billing trigger job', {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      });
    } else {
      logging.system('session_auto_complete: no sessions to complete', 'INFO');
    }

    return { completed: updated, durationMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    logging.error('session_auto_complete: job failed', err, {
      metadata: { elapsedMs: elapsed },
    });
    throw err;
  }
}

// Allow direct invocation: node jobs/session-auto-complete.ts
if (require.main === module) {
  runSessionAutoComplete()
    .then(({ completed, durationMs }) => {
      console.log(`[auto-complete] Completed: ${completed}, Duration: ${durationMs}ms`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[auto-complete] Failed:', err);
      process.exit(1);
    });
}

export { runSessionAutoComplete };