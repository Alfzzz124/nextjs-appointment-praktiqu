/**
 * Hourly scan for overlapping ACTIVE appointments of one psikolog — the clashes that slipped
 * past the plugin's per-doctor schedule lock because a path the lead chose not to patch wrote
 * them: KiviCare's WP admin, KiviCare Pro's inbound Google Calendar reschedule, CSV import.
 * It also catches a bug in our own writers; it cannot tell which, so the email does not guess.
 *
 * Never cancels or moves anything. It tells the psikolog and the clinic admin(s), once per
 * clash per recipient, and people decide.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md
 */
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { logging } from '@/lib/logging';
import {
  findOverlappingAppointmentPairs,
  type OverlapPair,
  type OverlapSide,
} from '@/repositories/wp/appointments.repo';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { listSessionsByIds } from '@/repositories/wp/sessions.repo';
import { clinicAdminContact, serviceNameOf } from '@/services/approval/service';
import { buildScheduleConflictEmail, type ConflictMailPair, type ConflictMailSide } from './conflict-email';
import { fingerprintOf, isUpcoming, planNotices, scanFromDate, type Recipient } from './conflict-pairs';

export interface ScheduleConflictScanResult {
  /** Upcoming overlapping pairs found, reported before or not. */
  pairs: number;
  /** Recipients who had something new to hear this run. */
  recipients: number;
  /** Emails that went out and were recorded. */
  notified: number;
  /** Emails that failed; the next run tries them again. */
  failed: number;
}

const TAG = '[schedule-conflict-scan]';

const pairWhere = (p: OverlapPair) => ({ appointmentLowId: p.low.id, appointmentHighId: p.high.id });

export async function scanScheduleConflicts(now: Date = new Date()): Promise<ScheduleConflictScanResult> {
  const pairs = (await findOverlappingAppointmentPairs(scanFromDate(now))).filter((p) => isUpcoming(p, now));

  // Forget clashes that are gone — cancelled, moved apart, or over — so one that comes back is
  // reported again. Only after the read above succeeded: a failed read never wipes the record.
  await prisma.scheduleConflictNotice.deleteMany({
    where: pairs.length > 0 ? { NOT: { OR: pairs.map(pairWhere) } } : {},
  });

  const result: ScheduleConflictScanResult = { pairs: pairs.length, recipients: 0, notified: 0, failed: 0 };
  if (pairs.length === 0) return result;

  const sessions = new Map(
    (await listSessionsByIds(pairs.flatMap((p) => [p.low.id, p.high.id]))).map((s) => [s.id, s]),
  );
  const serviceNames = new Map<number, string>();
  for (const s of sessions.values()) serviceNames.set(s.id, await serviceNameOf(s));

  const clinics = new Map<number, { name: string; admin: Recipient | null }>();
  for (const id of new Set(pairs.flatMap((p) => [p.low.clinicId, p.high.clinicId]))) {
    const [clinic, admin] = await Promise.all([findClinicById(BigInt(id)), clinicAdminContact(id)]);
    clinics.set(id, { name: clinic?.name || `Klinik #${id}`, admin });
    if (!admin) {
      await logging.warn(`${TAG} klinik tanpa admin yang bisa dihubungi`, { resource: 'clinic', resourceId: String(id) });
    }
  }

  const side = (s: OverlapSide): ConflictMailSide => ({
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    clientName: sessions.get(s.id)?.clientName || 'Klien',
    serviceName: serviceNames.get(s.id) ?? 'Sesi',
    clinicName: clinics.get(s.clinicId)?.name ?? `Klinik #${s.clinicId}`,
    status: s.status,
  });

  const mailPairs = new Map<OverlapPair, ConflictMailPair>();
  const entries: Array<{ pair: OverlapPair; recipients: Recipient[] }> = [];
  for (const pair of pairs) {
    const owner = sessions.get(pair.low.id);
    const psikolog: Recipient = { email: owner?.professionalEmail ?? '', name: owner?.professionalName || 'Psikolog' };
    if (!psikolog.email) {
      await logging.warn(`${TAG} psikolog tanpa alamat email`, { resource: 'professional', resourceId: String(pair.doctorId) });
    }
    const admins = [pair.low.clinicId, pair.high.clinicId]
      .map((id) => clinics.get(id)?.admin ?? null)
      .filter((a): a is Recipient => a !== null);

    mailPairs.set(pair, { date: pair.date, professionalName: psikolog.name, low: side(pair.low), high: side(pair.high) });
    entries.push({ pair, recipients: [psikolog, ...admins] });
  }

  const sent = await prisma.scheduleConflictNotice.findMany({
    where: { OR: pairs.map(pairWhere) },
    select: { appointmentLowId: true, appointmentHighId: true, recipient: true, fingerprint: true },
  });
  const plan = planNotices(entries, sent);
  result.recipients = plan.length;

  for (const { recipient, pairs: theirs } of plan) {
    try {
      const built = buildScheduleConflictEmail({
        recipientName: recipient.name,
        pairs: theirs.map((p) => mailPairs.get(p) as ConflictMailPair),
      });
      const res = await sendEmail({
        to: recipient.email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        template: 'schedule_conflict',
      });
      if (!res.ok) {
        result.failed += 1;
        await logging.warn(`${TAG} email gagal terkirim; dicoba lagi pada run berikutnya`, {
          metadata: { recipient: recipient.email, error: res.error },
        });
        continue;
      }

      // Recorded only once it went out. Recording first would make the next run treat a lost
      // email as delivered, and that recipient would never hear of the clash.
      const notifiedAt = new Date();
      for (const p of theirs) {
        const key = { ...pairWhere(p), recipient: recipient.email };
        await prisma.scheduleConflictNotice.upsert({
          where: { pairRecipient: key },
          create: { ...key, fingerprint: fingerprintOf(p), notifiedAt },
          update: { fingerprint: fingerprintOf(p), notifiedAt },
        });
      }
      result.notified += 1;
    } catch (err) {
      result.failed += 1;
      await logging.error(`${TAG} gagal memberi tahu satu penerima`, err, { metadata: { recipient: recipient.email } });
    }
  }

  return result;
}
