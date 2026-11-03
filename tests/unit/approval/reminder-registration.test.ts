/**
 * If nothing imports reminder-handler, registerJobHandler never runs and the webhook
 * approval.reminder falls into "No handler registered" — answered 200, never done, never
 * retried by WordPress. This enters through processWebhook, the path production uses,
 * so it catches the import being removed as "unused".
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'rahasia-webhook-untuk-test';
process.env.WORDPRESS_WEBHOOK_SECRET = SECRET;

const store = vi.hoisted(() => ({ findApproval: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => store.findApproval(...a),
}));

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

describe('registering approval.reminder', () => {
  it('importing the route module makes the webhook reach the handler', async () => {
    store.findApproval.mockResolvedValue(null);
    await import('@/app/api/v1/webhooks/wordpress-jobs/route');
    const { processWebhook } = await import('@/lib/jobs/webhook-handler');

    const body = JSON.stringify({ event: 'approval.reminder', data: { appointmentId: 7 } });
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(await processWebhook(body, signature)).toBe(true);
    expect(store.findApproval).toHaveBeenCalledWith(7);
  });
});
