/**
 * If nothing imports `unpaid-booking`, `registerJobHandler` never runs and the
 * `booking.unpaid_cancel` webhook falls into the "No handler registered" branch: answered
 * 200, not done, never retried by WordPress. The abandoned booking keeps its slot and
 * nothing anywhere says so.
 *
 * This file deliberately does NOT import `@/services/public/unpaid-booking` itself. It
 * goes in through the jobs route and `processWebhook`, the path production takes, so it
 * fails when someone deletes the route's side-effect import as "unused".
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'unpaid-booking-webhook-secret';
process.env.WORDPRESS_WEBHOOK_SECRET = SECRET;

const repo = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => repo.findSessionById(...a),
}));

const db = vi.hoisted(() => ({
  prisma: { paymentOrder: { findFirst: vi.fn().mockResolvedValue(null) } },
}));
vi.mock('@/lib/db', () => db);

// Psychologist approval (spec 2026-10-19) is out of scope here: no session waits for a
// psychologist and no psychologist has the switch on.
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: async () => null,
  findApprovals: async () => new Map(),
  claimDecision: async () => false,
}));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: async () => false,
  professionalsRequiringApproval: async () => new Set<number>(),
}));

const write = vi.hoisted(() => ({
  cancelAppointment: vi.fn().mockResolvedValue({ id: 0, status: 0, cancelled: true }),
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => write);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const APPT = 8_750_002;

describe('registration of booking.unpaid_cancel', () => {
  it('importing the jobs webhook route makes booking.unpaid_cancel do its work', async () => {
    repo.findSessionById.mockResolvedValue({ id: APPT, status: 'PENDING' });

    // Import the route, exactly as Next.js does when a request arrives.
    await import('@/app/api/v1/webhooks/wordpress-jobs/route');
    const { processWebhook } = await import('@/lib/jobs/webhook-handler');

    const body = JSON.stringify({ event: 'booking.unpaid_cancel', data: { appointmentId: APPT } });
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(await processWebhook(body, signature)).toBe(true);
    expect(repo.findSessionById).toHaveBeenCalledWith(APPT);
    expect(write.cancelAppointment).toHaveBeenCalledWith(APPT);
  });
});
