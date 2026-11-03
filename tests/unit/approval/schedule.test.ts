/**
 * When the approval reminder job runs and what it does (spec §4.4). Pure functions:
 * every scenario is a fixed clock, so the arithmetic is pinned exactly.
 */
import { describe, expect, it } from 'vitest';
import { firstReminderAt, isOverdue, planReminder } from '@/services/approval/schedule';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-20T03:00:00.000Z');
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

describe('firstReminderAt', () => {
  it('a session three days out: the first run is a day later', () => {
    expect(firstReminderAt(T0, at(72))).toEqual(at(24));
  });

  it('a session 30 hours out: the first run is when it gets within a day', () => {
    expect(firstReminderAt(T0, at(30))).toEqual(at(6));
  });

  it('a session within a day: runs in a minute, so the admin hears at once', () => {
    expect(firstReminderAt(T0, at(10))).toEqual(new Date(T0.getTime() + 60_000));
  });

  it('a session with no start time: a day later', () => {
    expect(firstReminderAt(T0, null)).toEqual(at(24));
  });
});

describe('planReminder', () => {
  it('72 h out, first run: reminds, escalates, runs again a day later', () => {
    expect(
      planReminder({ now: at(24), startsAt: at(72), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: true, escalate: true, nextRunAt: at(48) });
  });

  it('72 h out, second run: reminds again, does not escalate twice, then stops', () => {
    expect(
      planReminder({ now: at(48), startsAt: at(72), requestedAt: T0, lastReminderAt: at(24), escalatedAt: at(24) }),
    ).toEqual({ remindProfessional: true, escalate: false, nextRunAt: null });
  });

  it('30 h out, run at the 24 h mark: escalates (start within a day), no second reminder yet', () => {
    expect(
      planReminder({ now: at(6), startsAt: at(30), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: true, nextRunAt: null });
  });

  it('10 h out, run a minute after the request: escalates only', () => {
    const now = new Date(T0.getTime() + 60_000);
    expect(
      planReminder({ now, startsAt: at(10), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: true, nextRunAt: null });
  });

  it('started already: nothing', () => {
    expect(
      planReminder({ now: at(5), startsAt: at(5), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: false, nextRunAt: null });
  });

  it('a reminder 19 h ago is too recent to repeat', () => {
    const plan = planReminder({ now: at(43), startsAt: at(200), requestedAt: T0, lastReminderAt: at(24), escalatedAt: at(24) });
    expect(plan.remindProfessional).toBe(false);
    expect(plan.nextRunAt).toEqual(at(67));
  });
});

describe('isOverdue', () => {
  it('only when the start has passed', () => {
    expect(isOverdue(at(1), T0)).toBe(false);
    expect(isOverdue(T0, T0)).toBe(true);
    expect(isOverdue(null, T0)).toBe(false);
  });
});
