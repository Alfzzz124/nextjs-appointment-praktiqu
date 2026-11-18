/**
 * Money that arrived for a booking that was already cancelled.
 *
 * WooCommerce completes payment even on a cancelled order, so closing the order when the
 * booking is cancelled (close-orders-on-cancel) narrows the window but cannot shut it.
 * When the money comes in anyway the booking stays cancelled — its slot may already be
 * someone else's — and the payment has to go back. This puts it on the refund list the
 * clinic already works from (the Refund tab of the Persetujuan page), writes an audit row
 * and tells the clinic admin.
 *
 * Only the call that creates the debt does the last two, so a replayed webhook or a
 * status poll for the same order adds nothing.
 */
import type { PaymentOrder } from '@prisma/client';
import { sendEmail } from '@/lib/email';
import { logging } from '@/lib/logging';
import { getPublicAppUrl } from '@/lib/public-url';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import type { SessionRow } from '@/repositories/wp/sessions.repo';
import { findWpUserContact, recordRefundNeeded } from '@/services/approval/store';
import { escapeHtml } from '@/services/session/reminder-email';

export async function recordPaidAfterCancel(
  appt: SessionRow,
  order: PaymentOrder,
  now: Date = new Date(),
): Promise<void> {
  // The record first: a replay that arrives while this call is still mailing must
  // already find the debt, or it would mail a second time.
  const owed = await recordRefundNeeded({
    appointmentId: appt.id,
    doctorWpUserId: appt.professionalId,
    clinicId: appt.clinicId,
    paymentOrderId: order.id,
    now,
  });
  if (!owed) return;

  await logging.audit('payment.paid_after_cancel', {
    userId: null,
    resource: 'session',
    resourceId: String(appt.id),
    action: 'payment.paid_after_cancel',
    metadata: {
      wcOrderId: order.wcOrderId,
      paymentOrderId: order.id,
      clinicId: appt.clinicId,
      gateway: order.gateway,
    },
  });

  const to = await refundRecipient(appt.clinicId);
  if (!to) {
    // The refund list still shows it; only the nudge is missing.
    await logging.warn('Paid after cancellation: the clinic has no admin or clinic email to tell', {
      resource: 'session',
      resourceId: String(appt.id),
      metadata: { clinicId: appt.clinicId, wcOrderId: order.wcOrderId },
    });
    return;
  }

  try {
    const built = buildEmail(appt, order, to.name);
    await sendEmail({
      to: to.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
      template: 'payment-paid-after-cancel',
    });
  } catch (err) {
    // The money and its record are what matter; a lost mail must not undo either.
    await logging.error('Paid after cancellation: the mail to the clinic failed', err, {
      resource: 'session',
      resourceId: String(appt.id),
    });
  }
}

/** The clinic's admin, or the clinic's own address when it has no admin with an email. */
async function refundRecipient(clinicId: number): Promise<{ email: string; name: string } | null> {
  const clinic = await findClinicById(BigInt(clinicId));
  if (!clinic) return null;
  if (clinic.clinicAdminId > 0n) {
    const admin = await findWpUserContact(Number(clinic.clinicAdminId));
    if (admin?.email) return admin;
  }
  const email = (clinic.email ?? '').trim();
  return email ? { email, name: clinic.name } : null;
}

function buildEmail(
  appt: SessionRow,
  order: PaymentOrder,
  name: string,
): { subject: string; text: string; html: string } {
  const when = [appt.slotDate, appt.startTime?.slice(0, 5)].filter(Boolean).join(' ');
  const link = `${getPublicAppUrl()}/dashboard/persetujuan?tab=refund`;
  const paragraphs = [
    `Halo ${name},`,
    `${appt.clientName} membayar setelah booking dibatalkan. Uangnya sudah masuk, tetapi janji temunya tetap batal, jadi pembayaran ini perlu dikembalikan ke klien.`,
    `Janji temu: ${when} dengan ${appt.professionalName} (ID ${appt.id}). Order WooCommerce #${order.wcOrderId} (${order.gateway}).`,
    'Booking ini sudah masuk tab Refund di halaman Persetujuan. Setelah dananya dikembalikan, tandai selesai di sana.',
  ];
  return {
    subject: `Pembayaran masuk untuk booking yang sudah dibatalkan: ${appt.clientName}`,
    text: [...paragraphs, link].join('\n\n'),
    html:
      paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') +
      `\n<p><a href="${escapeHtml(link)}">Buka tab Refund</a></p>`,
  };
}
