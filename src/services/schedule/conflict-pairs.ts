/**
 * Pure rules of the hourly schedule-conflict scan: which pairs still matter, how a reported
 * clash is identified, and who has yet to hear about which clash. No database, network or
 * clock — `now` is passed in — so each rule is testable on its own.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md
 */
import { buildUtcDateTime, timeToMinutes } from '@/lib/time';
import type { OverlapPair } from '@/repositories/wp/appointments.repo';

const DAY_MS = 86_400_000;
const FALLBACK_ZONE = 'Asia/Jakarta';

/**
 * Lower bound for the detection query: the UTC date of the day before `now`. Loose on
 * purpose — no clinic zone's "today" starts before it — and independent of the process TZ.
 * isUpcoming() makes the exact cut.
 */
export function scanFromDate(now: Date): string {
  return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
}

/** When the two stop overlapping: the earlier of the two ends, in the low side's zone. */
export function overlapEndsAt(pair: OverlapPair): Date {
  const end = pair.low.endTime < pair.high.endTime ? pair.low.endTime : pair.high.endTime;
  return buildUtcDateTime(pair.date, timeToMinutes(end), pair.timezone || FALLBACK_ZONE);
}

/**
 * Still worth telling anyone: the overlap has not ended. An unreadable zone yields an
 * Invalid Date and counts as upcoming — one email too many beats a missed clash.
 */
export function isUpcoming(pair: OverlapPair, now: Date): boolean {
  const end = overlapEndsAt(pair).getTime();
  return Number.isNaN(end) || end > now.getTime();
}

/** Which clash was reported. A move that still overlaps changes it; a status change does not. */
export function fingerprintOf(pair: OverlapPair): string {
  return `${pair.date}|${pair.low.startTime}-${pair.low.endTime}|${pair.high.startTime}-${pair.high.endTime}`;
}

export interface Recipient {
  email: string;
  name: string;
}

/** A row of schedule_conflict_notices, as far as planning cares. */
export interface SentNotice {
  appointmentLowId: number;
  appointmentHighId: number;
  recipient: string;
  fingerprint: string;
}

/** The form stored in schedule_conflict_notices.recipient. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Per recipient, the clashes they have not been told about in their current shape. One
 * entry per distinct address (a clinic owner who is also the psikolog hears once), in the
 * order addresses first appear. Empty addresses are skipped; the caller logs those.
 */
export function planNotices(
  entries: Array<{ pair: OverlapPair; recipients: Recipient[] }>,
  sent: SentNotice[],
): Array<{ recipient: Recipient; pairs: OverlapPair[] }> {
  const told = new Map(
    sent.map((s) => [`${s.appointmentLowId}:${s.appointmentHighId}|${s.recipient}`, s.fingerprint]),
  );
  const plan = new Map<string, { recipient: Recipient; pairs: OverlapPair[] }>();

  for (const { pair, recipients } of entries) {
    const fingerprint = fingerprintOf(pair);
    const seen = new Set<string>();
    for (const r of recipients) {
      const email = normalizeEmail(r.email);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      if (told.get(`${pair.low.id}:${pair.high.id}|${email}`) === fingerprint) continue;

      const entry = plan.get(email) ?? { recipient: { email, name: r.name }, pairs: [] };
      entry.pairs.push(pair);
      plan.set(email, entry);
    }
  }

  return [...plan.values()];
}
