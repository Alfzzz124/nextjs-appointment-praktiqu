/**
 * Releases a public booking that nobody went on to pay for.
 *
 * A guest booking is born PENDING, and PENDING holds its slot: it is in ACTIVE_STATUSES,
 * which is what stops a second guest taking the same hour while the first one pays.
 * Until now the only thing that ever released such a booking was the payment
 * auto-cancel, and that job is scheduled by `initiatePublicPayment`. A guest who
 * submitted the form and closed the tab before reaching checkout therefore left a
 * PENDING row that blocked the slot for good, and nobody was told.
 *
 * So every guest booking gets its own follow-up job when it is created. When the job
 * fires it re-reads everything and cancels only a booking that is still PENDING and
 * has no payment order that is `pending` (a payment in progress, which its own
 * auto-cancel already owns) or `paid` (never touched). Anything else is left alone:
 * confirmed, cancelled, checked in, or gone.
 *
 * The job keeps no state, so nothing has to be unscheduled when the booking is paid or
 * cancelled first. The guards turn a late run into a no-op, and they have to anyway:
 * WordPress-side unscheduling is best-effort and WP-Cron fires late.
 */
import type { NextRequest } from 'next/server';
import { optionalActor, type Actor } from '@/lib/auth';
import { JWT_CONFIG } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { jobs } from '@/lib/jobs/client';
import { registerJobHandler } from '@/lib/jobs/webhook-handler';
import { logging } from '@/lib/logging';
import { cancelAppointment } from '@/repositories/wp/appointments.write';
import { SESSION_STATUS, findSessionById } from '@/repositories/wp/sessions.repo';
import type { PaymentStatus } from '@/services/payments/payment.service';

/** Action Scheduler hook. Must match the allow-list in the plugin's Jobs::enqueue(). */
export const UNPAID_CANCEL_HOOK = 'praktiqu_booking_unpaid_cancel' as const;

/** Webhook event the plugin's Jobs::handle_booking_unpaid_cancel() calls back with. */
export const UNPAID_CANCEL_EVENT = 'booking.unpaid_cancel' as const;

export const DEFAULT_UNPAID_TTL_MINUTES = 60;

/**
 * Payment states that mean "someone is paying, or has paid". A `failed`, `expired` or
 * `cancelled` order is over, and the booking behind it is as unpaid as one that never
 * reached checkout.
 */
const LIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = ['pending', 'paid'];

/** Roles that book on someone else's behalf. CLIENT is the patient themself. */
const STAFF_ROLES: readonly Actor['role'][] = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'RECEPTIONIST',
  'PROFESSIONAL',
];

/**
 * How long an unpaid guest booking may hold its slot, from PUBLIC_BOOKING_UNPAID_TTL_MINUTES.
 *
 * 0 turns the release off. A value that does not parse falls back to the default rather
 * than to 0: a typo in an env key must not quietly bring back slots that are held for
 * good. It is read on every call, not at module load, so a changed value takes effect
 * without a rebuild.
 */
export function unpaidBookingTtlMinutes(): number {
  const raw = process.env.PUBLIC_BOOKING_UNPAID_TTL_MINUTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_UNPAID_TTL_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(
      `[public/appointments] PUBLIC_BOOKING_UNPAID_TTL_MINUTES=${JSON.stringify(raw)} is not a ` +
        `non-negative number; using ${DEFAULT_UNPAID_TTL_MINUTES}`,
    );
    return DEFAULT_UNPAID_TTL_MINUTES;
  }
  return n;
}

/**
 * Args for the hook. An OBJECT, never an array: the plugin's REST schema declares `args`
 * as `object`. The two disagreeing once (schema `array`, client object) got every
 * enqueue rejected with 400, and no job ran from July to September. Action Scheduler
 * hands the values to the PHP handler positionally (`array_values`), which with a
 * single key is just the id.
 */
export function unpaidCancelArgs(appointmentId: number): { appointmentId: number } {
  return { appointmentId };
}

/**
 * Was this booking made by a member of staff, rather than by the guest themself?
 *
 * The Laravel FE's "Appointment Manual" (ManualAppointmentController::store) books
 * through this same public endpoint: staff help a client who cannot book alone, and
 * mark the booking paid later from the Appointments list. Auto-cancelling that booking
 * would delete the staff member's work in silence, and mail the patient a
 * cancellation for an appointment the clinic meant to keep.
 *
 * It is recognisable by the bearer it carries. The FE sends it through
 * `PraktiquApi::post()`, which attaches the session's access token whenever one exists,
 * and only staff sign into the FE: its portal maps CLIENT to "no access". A guest on
 * the booking page has no session, so sends no bearer at all. (A signed-in staff member
 * using that page sends theirs, and treating the booking as staff work is right then too.)
 *
 * Expired tokens count, within the refresh-token lifetime. The FE refreshes only when a
 * NON-public call answers 401, and nothing on the manual form's new-client path makes
 * one: the hold and the booking are public calls, and the backend never answers 401 to
 * them. A receptionist who opens the form, spends twenty minutes on the phone taking a
 * new client's details and then submits sends a token that expired five minutes ago.
 * Requiring a fresh token would release exactly the bookings this exemption exists to
 * protect.
 *
 * The signature is still checked, so the bearer has to be one we issued to a staff
 * account. The most a stolen token buys here is a booking that holds its slot until
 * someone cancels it, which is how every booking behaved before this job existed.
 */
export async function isStaffRequest(req: NextRequest): Promise<boolean> {
  const actor = await optionalActor(req, { expiredGraceSeconds: JWT_CONFIG.refreshTtlSeconds });
  return actor !== null && STAFF_ROLES.includes(actor.role);
}

/**
 * Schedule the release of a new guest booking. Never throws.
 *
 * The booking is already written by the time this runs. If scheduling threw, the route
 * would answer 500 for a booking that exists, and would hand the Idempotency-Key back
 * so that a retry books the patient twice. `jobs.enqueue` already swallows its own
 * failures; the try/catch covers the rest.
 */
export async function scheduleUnpaidBookingCancel(
  appointmentId: number,
  now: Date = new Date(),
): Promise<void> {
  try {
    const ttlMinutes = unpaidBookingTtlMinutes();
    if (ttlMinutes === 0) return;
    await jobs.enqueue({
      hook: UNPAID_CANCEL_HOOK,
      runAt: new Date(now.getTime() + ttlMinutes * 60_000),
      args: unpaidCancelArgs(appointmentId),
    });
  } catch (err) {
    console.error(
      '[public/appointments] could not schedule the unpaid-booking release; the slot stays held until someone cancels it',
      { appointmentId, err },
    );
  }
}

/**
 * Webhook handler: cancel the booking if, right now, it is still PENDING and unpaid.
 *
 * Cancels through `cancelAppointment`, the same plugin call the guest's own
 * cancellation uses, so KiviCare's `kc_appointment_cancelled` listeners run: the
 * cancellation email to the patient and the doctor, reminder and telemed teardown, and
 * Pro's follow-up revert. A raw status write would skip all of them.
 */
export async function handleUnpaidBookingCancel(data: Record<string, unknown>): Promise<void> {
  // Crosses a JSON boundary from WordPress, which may send the id as "7". Coerced before
  // it is checked; null, undefined and "abc" all become NaN and are refused.
  const appointmentId = Number(data.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    await logging.warn(`${UNPAID_CANCEL_EVENT}: invalid appointmentId`, { metadata: { data } });
    return;
  }
  const resourceId = String(appointmentId);

  const row = await findSessionById(appointmentId);
  if (!row) {
    await logging.warn(`${UNPAID_CANCEL_EVENT}: appointment not found`, {
      resource: 'appointment',
      resourceId,
    });
    return;
  }

  if (row.status !== SESSION_STATUS.PENDING) {
    await logging.audit(`${UNPAID_CANCEL_EVENT}.skipped`, {
      resource: 'appointment',
      resourceId,
      metadata: { reason: 'status', status: row.status },
    });
    return;
  }

  // Every order for the booking, not just the newest. A paid order anywhere in its
  // history means the patient paid, and that booking must never be released here.
  const live = await prisma.paymentOrder.findFirst({
    where: { appointmentId: resourceId, status: { in: [...LIVE_PAYMENT_STATUSES] } },
    select: { status: true, wcOrderId: true },
  });
  if (live) {
    await logging.audit(`${UNPAID_CANCEL_EVENT}.skipped`, {
      resource: 'appointment',
      resourceId,
      metadata: { reason: 'payment', paymentStatus: live.status, wcOrderId: live.wcOrderId },
    });
    return;
  }

  // Allowed to throw: processWebhook logs a failed handler with its event and data,
  // which is the trail an operator needs to cancel the booking by hand.
  await cancelAppointment(appointmentId);
  await logging.audit(`${UNPAID_CANCEL_EVENT}.cancelled`, {
    resource: 'appointment',
    resourceId,
  });
}

// Side effect on load. The jobs webhook route imports this module for exactly this; see
// the comment in src/app/api/v1/webhooks/wordpress-jobs/route.ts.
registerJobHandler(UNPAID_CANCEL_EVENT, (data) => handleUnpaidBookingCancel(data));
