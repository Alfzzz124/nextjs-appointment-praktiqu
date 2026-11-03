/**
 * When the approval reminder job runs, and what each run does (spec §4.4).
 *
 * Pure: the clock is an argument. The job runs at most once a day per booking; the
 * psychologist is mailed at most once per ~day, the clinic admin exactly once, and
 * nothing runs past the session's start.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A reminder this soon after the last mail would be noise. */
export const REMIND_AFTER_MS = 20 * HOUR;

export function isOverdue(startsAt: Date | null, now: Date): boolean {
  return startsAt !== null && startsAt.getTime() <= now.getTime();
}

/**
 * The first run, scheduled when the booking is held. A session within a day runs in a
 * minute, so the clinic admin hears about it straight away; otherwise a day later, or
 * as the session comes within a day, whichever is first.
 */
export function firstReminderAt(now: Date, startsAt: Date | null): Date {
  const n = now.getTime();
  if (startsAt && startsAt.getTime() - n <= DAY) return new Date(n + MINUTE);
  const candidates = [n + DAY];
  if (startsAt) candidates.push(startsAt.getTime() - DAY);
  return new Date(Math.max(Math.min(...candidates), n + MINUTE));
}

export type ReminderInput = {
  now: Date;
  startsAt: Date;
  requestedAt: Date;
  lastReminderAt: Date | null;
  escalatedAt: Date | null;
};

export type ReminderPlan = {
  remindProfessional: boolean;
  escalate: boolean;
  /** Null: do not schedule again (the next run would be at or after the start). */
  nextRunAt: Date | null;
};

export function planReminder(i: ReminderInput): ReminderPlan {
  const n = i.now.getTime();
  const s = i.startsAt.getTime();
  if (s <= n) return { remindProfessional: false, escalate: false, nextRunAt: null };

  const lastMail = (i.lastReminderAt ?? i.requestedAt).getTime();
  const remindProfessional = n - lastMail >= REMIND_AFTER_MS;
  const escalate = i.escalatedAt === null && (n - i.requestedAt.getTime() >= DAY || s - n <= DAY);

  const candidates = [n + DAY];
  if (s - DAY > n + HOUR) candidates.push(s - DAY);
  const next = Math.min(...candidates);

  return { remindProfessional, escalate, nextRunAt: next < s ? new Date(next) : null };
}
