# Deteksi Bentrok Jadwal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An hourly scan that finds overlapping ACTIVE appointments of one psikolog and emails the psikolog plus the clinic admin(s), once per clash per recipient.

**Architecture:** An hPanel cron line calls `POST /api/v1/internal/schedule-conflicts/scan` with `x-cron-secret`. The route runs `scanScheduleConflicts()`: one read-only self-join on `wp_kc_appointments` (same predicate as the plugin's `Schedule_Write::assertFree`), a pure filter/plan step, a dedupe table `schedule_conflict_notices`, and `sendEmail`. No plugin change.

**Tech Stack:** Next.js 14 route handlers, Prisma 5 (MySQL, raw SQL for `wp_*`), vitest, date-fns-tz via `src/lib/time.ts`.

Spec: `docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md`.

## Global Constraints

- Active statuses come from `ACTIVE_STATUSES` in `src/repositories/wp/appointments.repo.ts` (1 BOOKED, 2 PENDING, 4 CHECK_IN). Never hard-code them in TS.
- Overlap predicate = `Schedule_Write::assertFree`: same `doctor_id`, same `appointment_start_date`, `b.start < a.end AND b.end > a.start` (half-open).
- Never bind a JS `Date` against a TIME column. The detection query binds only a `'YYYY-MM-DD'` string and the statuses.
- `wp_kc_*` is read only from this code. Nothing here writes to it.
- The app table is created by hand-written SQL in `prisma/manual/`. **Never `prisma db push` / `migrate dev`** — the database also holds the `wp_*` tables.
- User-facing copy is Indonesian. Email sign-off `— PraktiQu`. Email template name `schedule_conflict`.
- Log tag `[schedule-conflict-scan]`; system log action `schedule.conflict-scan`.
- Integration tests run against the Docker test DB (`wordpress-praktiqu-test`, `.env.test.local`), guarded by `assertTestDb()`, with fixed id ranges: repo suite `8_890_000..8_895_000`, service suite `8_895_000..8_900_000`.
- Commit messages in Indonesian, conventional prefix, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run vitest with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`.

## File Structure

| File | Responsibility |
|---|---|
| `src/repositories/wp/appointments.repo.ts` (modify) | `OverlapPair` types + `findOverlappingAppointmentPairs(fromDate)` |
| `src/services/schedule/conflict-pairs.ts` (create) | Pure rules: scan lower bound, "still upcoming", fingerprint, who-hears-what plan |
| `src/services/schedule/conflict-email.ts` (create) | Pure email builder |
| `src/services/schedule/conflict-scan.service.ts` (create) | Orchestration: query → filter → reconcile table → mail → record |
| `prisma/manual/2026-10-21-schedule-conflict-notices.sql` (create) + `prisma/schema.prisma` (modify) | Dedupe table |
| `src/lib/cron-secret.ts` (create) | Shared `x-cron-secret` guard, fails closed |
| `src/app/api/v1/internal/google-calendar/conflict-scan/route.ts` (modify) | Uses the shared guard |
| `src/app/api/v1/internal/schedule-conflicts/scan/route.ts` (create) | The cron endpoint |
| `docs/deploy/2026-10-21-schedule-conflict-scan-cron.md` (create), `.env.example` (modify) | Release + ops |

---

### Task 1: Detection query

**Files:**
- Modify: `src/repositories/wp/appointments.repo.ts` (append after `findConflictingAppointments`)
- Test: `tests/integration/schedule/overlap-pairs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OverlapSide = { id: number; clinicId: number; status: number; startTime: string; endTime: string };
  export type OverlapPair = { doctorId: number; date: string; timezone: string; low: OverlapSide; high: OverlapSide };
  export async function findOverlappingAppointmentPairs(fromDate: string): Promise<OverlapPair[]>;
  ```
  `low.id < high.id`; times `HH:MM:SS`; `date` `YYYY-MM-DD`; `timezone` is the low side's `appointment_timezone` (`''` when NULL). Ordered by date, low start time, low id, high id. Throws on a malformed `fromDate`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/schedule/overlap-pairs.test.ts`:

```ts
/**
 * findOverlappingAppointmentPairs melawan database test sungguhan.
 *
 * Predikatnya harus sama persis dengan Schedule_Write::assertFree di plugin, dan hanya MySQL
 * yang bisa membuktikan perbandingan TIME-nya benar — mock hanya akan mengulang asumsiku.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  APPOINTMENT_STATUS,
  findOverlappingAppointmentPairs,
  type OverlapPair,
} from '@/repositories/wp/appointments.repo';

const BASE = 8_890_000;
const END = BASE + 5_000;
const CLINIC = BASE + 1;
const DOC = BASE + 20;
const DOC2 = BASE + 21;
const PATIENT = BASE + 30;

const YEAR = new Date().getUTCFullYear() + 1;
const DATE = `${YEAR}-04-14`;
const NEXT_DATE = `${YEAR}-04-15`;
const TRIPLE_DATE = `${YEAR}-04-16`;
const PAST_DATE = `${new Date().getUTCFullYear() - 1}-04-14`;

const { BOOKED, PENDING, CANCELLED, CHECK_OUT, CHECK_IN } = APPOINTMENT_STATUS;

async function appt(id: number, doctor: number, date: string, start: string, end: string, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Jakarta', '', '', ?, NOW())`,
    id, CLINIC, doctor, PATIENT, date, start, date, end, status,
  );
}

const ours = (pairs: OverlapPair[]) => pairs.filter((p) => p.low.id >= BASE && p.low.id < END);
const ids = (pairs: OverlapPair[]) => ours(pairs).map((p) => [p.low.id - BASE, p.high.id - BASE]);

async function wipe() {
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?', BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await appt(BASE + 100, DOC, DATE, '09:00:00', '10:00:00', BOOKED);
  await appt(BASE + 101, DOC, DATE, '09:30:00', '10:30:00', PENDING); // → (100, 101)
  await appt(BASE + 102, DOC, DATE, '10:30:00', '11:00:00', BOOKED); // back-to-back with 101
  await appt(BASE + 103, DOC, DATE, '09:00:00', '10:00:00', CANCELLED);
  await appt(BASE + 104, DOC, DATE, '09:15:00', '09:45:00', CHECK_OUT);
  await appt(BASE + 105, DOC2, DATE, '09:00:00', '10:00:00', BOOKED); // another psikolog
  await appt(BASE + 106, DOC, NEXT_DATE, '09:00:00', '10:00:00', BOOKED); // another date
  await appt(BASE + 110, DOC, TRIPLE_DATE, '13:00:00', '14:00:00', BOOKED);
  await appt(BASE + 111, DOC, TRIPLE_DATE, '13:30:00', '14:30:00', CHECK_IN);
  await appt(BASE + 112, DOC, TRIPLE_DATE, '13:45:00', '14:15:00', PENDING);
  await appt(BASE + 120, DOC, PAST_DATE, '09:00:00', '10:00:00', BOOKED);
  await appt(BASE + 121, DOC, PAST_DATE, '09:30:00', '10:30:00', BOOKED);
  await appt(BASE + 130, 0, DATE, '09:00:00', '10:00:00', BOOKED); // KiviCare junk: no doctor
  await appt(BASE + 131, 0, DATE, '09:30:00', '10:30:00', BOOKED);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('findOverlappingAppointmentPairs', () => {
  it('finds exactly the overlapping active pairs of one psikolog, each once, low id first', async () => {
    const pairs = await findOverlappingAppointmentPairs(`${YEAR}-01-01`);
    expect(ids(pairs)).toEqual([
      [100, 101],
      [110, 111],
      [110, 112],
      [111, 112],
    ]);
  });

  it('returns dates and times as strings, with clinic, status and zone', async () => {
    const [pair] = ours(await findOverlappingAppointmentPairs(DATE));
    expect(pair).toEqual({
      doctorId: DOC,
      date: DATE,
      timezone: 'Asia/Jakarta',
      low: { id: BASE + 100, clinicId: CLINIC, status: BOOKED, startTime: '09:00:00', endTime: '10:00:00' },
      high: { id: BASE + 101, clinicId: CLINIC, status: PENDING, startTime: '09:30:00', endTime: '10:30:00' },
    });
  });

  it('leaves out dates before fromDate', async () => {
    expect(ids(await findOverlappingAppointmentPairs(PAST_DATE))).toContainEqual([120, 121]);
    expect(ids(await findOverlappingAppointmentPairs(DATE))).not.toContainEqual([120, 121]);
  });

  it('rejects a malformed fromDate instead of binding it', async () => {
    await expect(findOverlappingAppointmentPairs('2026-1-1')).rejects.toThrow(/YYYY-MM-DD/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/schedule/overlap-pairs.test.ts`
Expected: FAIL — `findOverlappingAppointmentPairs` is not exported (TypeError: ... is not a function).

- [ ] **Step 3: Write the implementation**

Append to `src/repositories/wp/appointments.repo.ts` (after `findConflictingAppointments`; `assertDate` and `ACTIVE_STATUSES` are already in this file):

```ts
/** One side of an overlapping pair. Times are local `HH:MM:SS` on the pair's date. */
export type OverlapSide = {
  id: number;
  clinicId: number;
  status: number;
  startTime: string;
  endTime: string;
};

/** Two active appointments of one doctor whose times overlap on one date; `low.id < high.id`. */
export type OverlapPair = {
  doctorId: number;
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  /** `appointment_timezone` of the low side; empty when KiviCare left it NULL. */
  timezone: string;
  low: OverlapSide;
  high: OverlapSide;
};

/**
 * Every pair of ACTIVE appointments of one doctor that overlap on the same local date, from
 * `fromDate` on. This is the after-the-fact check for writers that bypass the plugin's
 * per-doctor schedule lock (KiviCare's WP admin, KiviCare Pro's inbound Google Calendar
 * reschedule, CSV import) — docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md.
 *
 * The predicate is Schedule_Write::assertFree's, column for column: same doctor, same
 * appointment_start_date, half-open time overlap. Change one, change the other.
 *
 * Nothing time-valued is bound — only the date string and the statuses — so the TIME-vs-Date
 * trap described at assertTime cannot apply. Dates and times come back as strings from
 * DATE_FORMAT/TIME_FORMAT rather than as Prisma Dates.
 */
export async function findOverlappingAppointmentPairs(fromDate: string): Promise<OverlapPair[]> {
  const from = assertDate(fromDate);
  const statuses = ACTIVE_STATUSES.map(() => '?').join(',');

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT a.id AS low_id, b.id AS high_id, a.doctor_id,
            DATE_FORMAT(a.appointment_start_date, '%Y-%m-%d') AS date,
            a.appointment_timezone AS timezone,
            a.clinic_id AS low_clinic_id, a.status AS low_status,
            TIME_FORMAT(a.appointment_start_time, '%H:%i:%s') AS low_start,
            TIME_FORMAT(a.appointment_end_time,   '%H:%i:%s') AS low_end,
            b.clinic_id AS high_clinic_id, b.status AS high_status,
            TIME_FORMAT(b.appointment_start_time, '%H:%i:%s') AS high_start,
            TIME_FORMAT(b.appointment_end_time,   '%H:%i:%s') AS high_end
       FROM wp_kc_appointments a
       JOIN wp_kc_appointments b
         ON b.doctor_id = a.doctor_id
        AND b.appointment_start_date = a.appointment_start_date
        AND b.id > a.id
        -- half-open overlap: back-to-back slots do not conflict
        AND b.appointment_start_time < a.appointment_end_time
        AND b.appointment_end_time   > a.appointment_start_time
      WHERE a.doctor_id > 0
        AND a.status IN (${statuses})
        AND b.status IN (${statuses})
        AND a.appointment_start_date >= ?
      ORDER BY a.appointment_start_date, a.appointment_start_time, a.id, b.id`,
    ...ACTIVE_STATUSES,
    ...ACTIVE_STATUSES,
    from,
  );

  return rows.map((r) => ({
    doctorId: Number(r.doctor_id),
    date: String(r.date),
    timezone: (r.timezone as string | null) ?? '',
    low: {
      id: Number(r.low_id),
      clinicId: Number(r.low_clinic_id),
      status: Number(r.low_status),
      startTime: String(r.low_start),
      endTime: String(r.low_end),
    },
    high: {
      id: Number(r.high_id),
      clinicId: Number(r.high_clinic_id),
      status: Number(r.high_status),
      startTime: String(r.high_start),
      endTime: String(r.high_end),
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/schedule/overlap-pairs.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/appointments.repo.ts tests/integration/schedule/overlap-pairs.test.ts
git commit -m "feat(jadwal): kueri pasangan janji temu aktif yang tumpang tindih, predikat sama dengan assertFree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure pair rules

**Files:**
- Create: `src/services/schedule/conflict-pairs.ts`
- Test: `tests/unit/schedule/conflict-pairs.test.ts`

**Interfaces:**
- Consumes: `OverlapPair` (Task 1); `buildUtcDateTime(dateStr, minutes, tz)` and `timeToMinutes('HH:MM[:SS]')` from `@/lib/time`. `buildUtcDateTime` returns an Invalid Date (NaN), not a throw, for an unknown zone.
- Produces:
  ```ts
  export function scanFromDate(now: Date): string;
  export function overlapEndsAt(pair: OverlapPair): Date;
  export function isUpcoming(pair: OverlapPair, now: Date): boolean;
  export function fingerprintOf(pair: OverlapPair): string;
  export function normalizeEmail(email: string): string;
  export interface Recipient { email: string; name: string }
  export interface SentNotice { appointmentLowId: number; appointmentHighId: number; recipient: string; fingerprint: string }
  export function planNotices(
    entries: Array<{ pair: OverlapPair; recipients: Recipient[] }>,
    sent: SentNotice[],
  ): Array<{ recipient: Recipient; pairs: OverlapPair[] }>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule/conflict-pairs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { OverlapPair } from '@/repositories/wp/appointments.repo';
import {
  fingerprintOf,
  isUpcoming,
  overlapEndsAt,
  planNotices,
  scanFromDate,
  type SentNotice,
} from '@/services/schedule/conflict-pairs';

function pair(over: Partial<OverlapPair> = {}, lowId = 3401, highId = 3405): OverlapPair {
  return {
    doctorId: 34,
    date: '2026-10-23',
    timezone: 'Asia/Jakarta',
    low: { id: lowId, clinicId: 4, status: 1, startTime: '09:00:00', endTime: '10:00:00' },
    high: { id: highId, clinicId: 4, status: 2, startTime: '09:30:00', endTime: '10:30:00' },
    ...over,
  };
}

const psikolog = { email: 'dianda@klinik.test', name: 'Dianda' };
const admin = { email: 'admin@klinik.test', name: 'Admin Klinik' };

describe('scanFromDate', () => {
  it('is the UTC date of the day before now, whatever the hour', () => {
    expect(scanFromDate(new Date('2026-10-22T01:00:00Z'))).toBe('2026-10-21');
    expect(scanFromDate(new Date('2026-10-22T23:30:00Z'))).toBe('2026-10-21');
    expect(scanFromDate(new Date('2026-03-01T00:00:00Z'))).toBe('2026-02-28');
  });
});

describe('overlapEndsAt', () => {
  it('is the earlier end, in the pair zone', () => {
    // 10:00 WIB = 03:00 UTC
    expect(overlapEndsAt(pair()).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });

  it('takes the high side end when that one is earlier', () => {
    const p = pair({
      low: { id: 1, clinicId: 4, status: 1, startTime: '09:00:00', endTime: '11:00:00' },
      high: { id: 2, clinicId: 4, status: 1, startTime: '09:30:00', endTime: '10:00:00' },
    });
    expect(overlapEndsAt(p).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });

  it('reads the clock of another zone', () => {
    // London is on BST (UTC+1) on 23 October 2026
    expect(overlapEndsAt(pair({ timezone: 'Europe/London' })).toISOString()).toBe('2026-10-23T09:00:00.000Z');
  });

  it('falls back to Asia/Jakarta when KiviCare left the zone empty', () => {
    expect(overlapEndsAt(pair({ timezone: '' })).toISOString()).toBe('2026-10-23T03:00:00.000Z');
  });
});

describe('isUpcoming', () => {
  it('keeps a clash until its overlap ends, and drops it at that instant', () => {
    expect(isUpcoming(pair(), new Date('2026-10-22T12:00:00Z'))).toBe(true);
    expect(isUpcoming(pair(), new Date('2026-10-23T02:59:59Z'))).toBe(true); // still running
    expect(isUpcoming(pair(), new Date('2026-10-23T03:00:00Z'))).toBe(false);
    expect(isUpcoming(pair(), new Date('2026-10-24T00:00:00Z'))).toBe(false);
  });

  it('counts an unreadable zone as upcoming: one email too many beats a missed clash', () => {
    expect(isUpcoming(pair({ timezone: 'Mars/Olympus' }), new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });
});

describe('fingerprintOf', () => {
  it('captures the date and both time ranges, not the statuses', () => {
    expect(fingerprintOf(pair())).toBe('2026-10-23|09:00:00-10:00:00|09:30:00-10:30:00');
    const statusOnly = pair({ high: { ...pair().high, status: 1 } });
    expect(fingerprintOf(statusOnly)).toBe(fingerprintOf(pair()));
  });
});

describe('planNotices', () => {
  const told = (p: OverlapPair, recipient: string, fingerprint = fingerprintOf(p)): SentNotice => ({
    appointmentLowId: p.low.id,
    appointmentHighId: p.high.id,
    recipient,
    fingerprint,
  });

  it('gives a new clash to every recipient', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [psikolog, admin] }], [])).toEqual([
      { recipient: psikolog, pairs: [p] },
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('mails one address once, whatever its case, under the name it first appeared with', () => {
    const p = pair();
    const owner = { email: ' Dianda@Klinik.TEST ', name: 'Pemilik' };
    expect(planNotices([{ pair: p, recipients: [psikolog, owner] }], [])).toEqual([
      { recipient: psikolog, pairs: [p] },
    ]);
  });

  it('skips an empty address', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [{ email: '', name: 'X' }, admin] }], [])).toEqual([
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('skips what a recipient was already told, but not someone else', () => {
    const p = pair();
    expect(planNotices([{ pair: p, recipients: [psikolog, admin] }], [told(p, psikolog.email)])).toEqual([
      { recipient: admin, pairs: [p] },
    ]);
  });

  it('tells again when the clash moved but still overlaps', () => {
    const p = pair();
    const old = told(p, psikolog.email, '2026-10-23|09:00:00-10:00:00|09:45:00-10:45:00');
    expect(planNotices([{ pair: p, recipients: [psikolog] }], [old])).toEqual([
      { recipient: psikolog, pairs: [p] },
    ]);
  });

  it('collects every new clash of one recipient into one entry, in order', () => {
    const a = pair({}, 1, 2);
    const b = pair({ date: '2026-10-24' }, 3, 4);
    expect(
      planNotices(
        [
          { pair: a, recipients: [psikolog] },
          { pair: b, recipients: [psikolog, admin] },
        ],
        [],
      ),
    ).toEqual([
      { recipient: psikolog, pairs: [a, b] },
      { recipient: admin, pairs: [b] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule/conflict-pairs.test.ts`
Expected: FAIL — cannot resolve `@/services/schedule/conflict-pairs`.

- [ ] **Step 3: Write the implementation**

Create `src/services/schedule/conflict-pairs.ts`:

```ts
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
```

Note on the expected output in the tests: `planNotices` returns the normalized (trimmed, lowercased) email. The fixtures `psikolog` and `admin` are already lowercase, so `toEqual` holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule/conflict-pairs.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/schedule/conflict-pairs.ts tests/unit/schedule/conflict-pairs.test.ts
git commit -m "feat(jadwal): aturan murni pemindaian bentrok (batas tanggal, masih berlaku, sidik, rencana kirim)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Email builder

**Files:**
- Create: `src/services/schedule/conflict-email.ts`
- Test: `tests/unit/schedule/conflict-email.test.ts`

**Interfaces:**
- Consumes: `escapeHtml(s)`, `formatWaktu(utcDate, tz) → { tanggal, jam }`, `type BuiltEmail = { subject; html; text }` from `@/services/session/reminder-email`.
- Produces:
  ```ts
  export interface ConflictMailSide { id: number; startTime: string; endTime: string; clientName: string; serviceName: string; clinicName: string; status: number }
  export interface ConflictMailPair { date: string; professionalName: string; low: ConflictMailSide; high: ConflictMailSide }
  export function buildScheduleConflictEmail(input: { recipientName: string; pairs: ConflictMailPair[] }): BuiltEmail;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule/conflict-email.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildScheduleConflictEmail, type ConflictMailPair } from '@/services/schedule/conflict-email';

const pasangan: ConflictMailPair = {
  date: '2026-10-23', // a Friday
  professionalName: 'Dianda Uji',
  low: {
    id: 3401, startTime: '09:00:00', endTime: '10:00:00', clientName: 'Klien A',
    serviceName: 'Konseling Individu', clinicName: 'Klinik Uji', status: 1,
  },
  high: {
    id: 3405, startTime: '09:30:00', endTime: '10:30:00', clientName: 'Klien B',
    serviceName: 'Konseling Individu', clinicName: 'Klinik Uji', status: 2,
  },
};

describe('buildScheduleConflictEmail', () => {
  it('counts the pairs in the subject', () => {
    expect(buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan] }).subject).toBe(
      'Jadwal bentrok: 1 pasang janji temu tumpang tindih',
    );
    expect(
      buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan, { ...pasangan, date: '2026-10-24' }] })
        .subject,
    ).toBe('Jadwal bentrok: 2 pasang janji temu tumpang tindih');
  });

  it('lists each pair by date and psikolog, one line per appointment', () => {
    const { text } = buildScheduleConflictEmail({ recipientName: 'Admin Klinik', pairs: [pasangan] });
    expect(text).toContain('Halo Admin Klinik,');
    expect(text).toContain('Jumat, 23 Oktober 2026 — Dianda Uji');
    expect(text).toContain('#3401 · 09:00–10:00 · Klien A · Konseling Individu · Klinik Uji · Terjadwal');
    expect(text).toContain('#3405 · 09:30–10:30 · Klien B · Konseling Individu · Klinik Uji · Menunggu');
  });

  it('says nothing was changed and what to do', () => {
    const { text, html } = buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan] });
    const penutup = 'Tidak ada yang kami ubah otomatis — kedua janji temu tetap berlaku dan klien tidak diberi tahu. Pindahkan atau batalkan salah satunya.';
    expect(text).toContain(penutup);
    expect(html).toContain(penutup);
  });

  it('labels check-in and falls back for an unknown status', () => {
    const { text } = buildScheduleConflictEmail({
      recipientName: 'Dianda',
      pairs: [{ ...pasangan, low: { ...pasangan.low, status: 4 }, high: { ...pasangan.high, status: 9 } }],
    });
    expect(text).toContain('· Check-in');
    expect(text).toContain('· Status 9');
  });

  it('escapes names in the html but not in the text', () => {
    const { html, text } = buildScheduleConflictEmail({
      recipientName: '<b>Admin</b>',
      pairs: [{ ...pasangan, low: { ...pasangan.low, clientName: 'A & <i>B</i>' } }],
    });
    expect(html).toContain('Halo &lt;b&gt;Admin&lt;/b&gt;,');
    expect(html).toContain('A &amp; &lt;i&gt;B&lt;/i&gt;');
    expect(html).not.toContain('<i>B</i>');
    expect(text).toContain('A & <i>B</i>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule/conflict-email.test.ts`
Expected: FAIL — cannot resolve `@/services/schedule/conflict-email`.

- [ ] **Step 3: Write the implementation**

Create `src/services/schedule/conflict-email.ts`:

```ts
/**
 * Email for the hourly schedule-conflict scan. Pure: everything arrives as arguments — no
 * database, network or clock. Indonesian, like the session reminders.
 *
 * Source of truth: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md §6.2
 */
import { escapeHtml, formatWaktu, type BuiltEmail } from '@/services/session/reminder-email';

export interface ConflictMailSide {
  id: number;
  /** Local `HH:MM:SS`. */
  startTime: string;
  endTime: string;
  clientName: string;
  serviceName: string;
  clinicName: string;
  /** Raw KiviCare status. */
  status: number;
}

export interface ConflictMailPair {
  /** Local `YYYY-MM-DD`. */
  date: string;
  professionalName: string;
  low: ConflictMailSide;
  high: ConflictMailSide;
}

const STATUS_LABEL: Record<number, string> = { 1: 'Terjadwal', 2: 'Menunggu', 4: 'Check-in' };

const PEMBUKA = 'Kami menemukan janji temu yang jadwalnya tumpang tindih untuk psikolog yang sama:';
const PENUTUP =
  'Tidak ada yang kami ubah otomatis — kedua janji temu tetap berlaku dan klien tidak diberi tahu. ' +
  'Pindahkan atau batalkan salah satunya.';

/** 'Jumat, 23 Oktober 2026'. The date is already local: noon UTC, read in UTC, is that same day. */
function tanggalPanjang(date: string): string {
  return formatWaktu(new Date(`${date}T12:00:00Z`), 'UTC').tanggal;
}

function judul(p: ConflictMailPair): string {
  return `${tanggalPanjang(p.date)} — ${p.professionalName}`;
}

function baris(s: ConflictMailSide): string {
  return [
    `#${s.id}`,
    `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`,
    s.clientName,
    s.serviceName,
    s.clinicName,
    STATUS_LABEL[s.status] ?? `Status ${s.status}`,
  ].join(' · ');
}

export function buildScheduleConflictEmail(input: {
  recipientName: string;
  pairs: ConflictMailPair[];
}): BuiltEmail {
  const subject = `Jadwal bentrok: ${input.pairs.length} pasang janji temu tumpang tindih`;

  const text = [
    `Halo ${input.recipientName},`,
    '',
    PEMBUKA,
    '',
    ...input.pairs.flatMap((p) => [judul(p), `  ${baris(p.low)}`, `  ${baris(p.high)}`, '']),
    PENUTUP,
    '',
    '— PraktiQu',
  ].join('\n');

  const html = [
    `<p>Halo ${escapeHtml(input.recipientName)},</p>`,
    `<p>${PEMBUKA}</p>`,
    ...input.pairs.map(
      (p) =>
        `<p><strong>${escapeHtml(judul(p))}</strong></p>\n<ul>\n` +
        `  <li>${escapeHtml(baris(p.low))}</li>\n  <li>${escapeHtml(baris(p.high))}</li>\n</ul>`,
    ),
    `<p>${PENUTUP}</p>`,
    '<p>— PraktiQu</p>',
  ].join('\n');

  return { subject, html, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule/conflict-email.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/schedule/conflict-email.ts tests/unit/schedule/conflict-email.test.ts
git commit -m "feat(jadwal): email peringatan bentrok jadwal untuk psikolog dan admin klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dedupe table + scan service

**Files:**
- Create: `prisma/manual/2026-10-21-schedule-conflict-notices.sql`
- Modify: `prisma/schema.prisma` (add model after `GoogleConflictWarning`)
- Create: `src/services/schedule/conflict-scan.service.ts`
- Test: `tests/integration/schedule/conflict-scan.test.ts`

**Interfaces:**
- Consumes: `findOverlappingAppointmentPairs` (Task 1); everything from `conflict-pairs.ts` (Task 2); `buildScheduleConflictEmail`, `ConflictMailPair`, `ConflictMailSide` (Task 3); `listSessionsByIds(ids: number[]): Promise<SessionRow[]>` (`@/repositories/wp/sessions.repo`; `SessionRow` has `id`, `clientName`, `professionalName`, `professionalEmail`, `serviceIds`); `findClinicById(id: bigint): Promise<WpClinic | null>` (`@/repositories/wp/clinics.repo`; `name: string | null`); `clinicAdminContact(clinicId: number): Promise<{ email; name } | null>` and `serviceNameOf(row: Pick<SessionRow,'serviceIds'>): Promise<string>` from `@/services/approval/service`; `sendEmail({ to, subject, html, text, template }): Promise<{ ok: boolean; error?: string }>` from `@/lib/email`.
- Produces:
  ```ts
  export interface ScheduleConflictScanResult { pairs: number; recipients: number; notified: number; failed: number }
  export async function scanScheduleConflicts(now?: Date): Promise<ScheduleConflictScanResult>;
  ```
  Prisma model `ScheduleConflictNotice` (`prisma.scheduleConflictNotice`), compound unique input `pairRecipient`.

- [ ] **Step 1: Create the table SQL**

Create `prisma/manual/2026-10-21-schedule-conflict-notices.sql`:

```sql
-- Bentrok jadwal yang sudah dikabarkan, per penerima, agar pemindaian per jam tidak mengirim
-- email yang sama tiap jam.
-- Terapkan manual, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-21-schedule-conflict-notices.sql
--
-- Ditulis tangan, bukan digenerate, karena database ini juga memuat tabel wp_* milik KiviCare
-- dan `prisma db push` akan mencoba menyelaraskannya dengan schema yang tidak memuatnya.
--
-- Satu baris per (pasangan janji temu, penerima). Per penerima, bukan per pasangan: email ke
-- admin klinik yang gagal harus diulang tanpa mengirim ulang ke psikolog yang sudah
-- menerimanya. `fingerprint` (= tanggal|jam A|jam B) menyimpan bentrok MANA yang sudah
-- dikabarkan: digeser tapi masih tumpang tindih → dikabarkan lagi; ganti status saja → tidak.
-- Baris untuk pasangan yang sudah tidak bentrok dihapus oleh pemindaian, jadi bentrok yang
-- kembali nanti dikabarkan lagi. Spec: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md

CREATE TABLE IF NOT EXISTS `schedule_conflict_notices` (
  `id`                varchar(191) NOT NULL,
  `appointmentLowId`  int          NOT NULL,
  `appointmentHighId` int          NOT NULL,
  `recipient`         varchar(191) NOT NULL,
  `fingerprint`       varchar(64)  NOT NULL,
  `notifiedAt`        datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `schedule_conflict_notices_pair_recipient_key` (`appointmentLowId`, `appointmentHighId`, `recipient`),
  KEY `schedule_conflict_notices_notifiedAt_idx` (`notifiedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Add the Prisma model and generate**

In `prisma/schema.prisma`, directly after the closing `}` of `model GoogleConflictWarning`, add:

```prisma
/// Bentrok jadwal yang sudah dikabarkan, per penerima. Tabel ditulis tangan:
/// prisma/manual/2026-10-21-schedule-conflict-notices.sql — jangan `db push`.
model ScheduleConflictNotice {
  id                String   @id @default(cuid())
  /// id janji temu yang lebih kecil dari pasangan itu
  appointmentLowId  Int
  appointmentHighId Int
  /// Alamat email penerima, huruf kecil.
  recipient         String   @db.VarChar(191)
  /// `date|lowStart-lowEnd|highStart-highEnd`. Berubah → dikabarkan lagi.
  fingerprint       String   @db.VarChar(64)
  notifiedAt        DateTime

  @@unique([appointmentLowId, appointmentHighId, recipient], name: "pairRecipient", map: "schedule_conflict_notices_pair_recipient_key")
  @@index([notifiedAt])
  @@map("schedule_conflict_notices")
}
```

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`.

Apply the table to the **test** database only:

```bash
docker exec -i praktiqu-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" wordpress-praktiqu-test' < prisma/manual/2026-10-21-schedule-conflict-notices.sql
```

Expected: only the "Using a password on the command line" warning.

- [ ] **Step 3: Write the failing integration test**

Create `tests/integration/schedule/conflict-scan.test.ts`:

```ts
/**
 * Pemindaian bentrok jadwal per jam, melawan database test sungguhan.
 *
 * Yang dijaga sebagian besar adalah STATUS: apakah peringatan yang sama terkirim dua kali,
 * apakah bentrok yang berubah memicu peringatan baru, apakah bentrok yang selesai membersihkan
 * jejaknya, dan apakah email yang gagal diulang hanya untuk penerimanya. Email di-mock;
 * database tidak.
 *
 * Kueri melihat SELURUH database test, termasuk sisa suite lain, jadi setiap asersi disaring
 * ke alamat dan id milik suite ini.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';

const BASE = 8_895_000;
const END = BASE + 5_000;
const CLINIC_A = BASE + 1; // admin ADMIN_A
const CLINIC_B = BASE + 2; // admin ADMIN_B
const CLINIC_NO_ADMIN = BASE + 3;
const CLINIC_OWNED = BASE + 4; // admin is the psikolog herself
const DOC = BASE + 20;
const PATIENT = BASE + 30;
const ADMIN_A = BASE + 40;
const ADMIN_B = BASE + 41;
const A1 = BASE + 100;
const A2 = BASE + 101;

const DOMAIN = '@schedule-conflict.test.local';
const mailOf = (id: number) => `u${id}${DOMAIN}`;
const DATE = `${new Date().getUTCFullYear() + 1}-05-12`;
const { BOOKED, PENDING, CANCELLED } = APPOINTMENT_STATUS;
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: mailOf(id),
      displayName: `${first} Uji`,
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: 'Uji' },
    ],
  });
}

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id - BASE}`,
    `klinik${id}${DOMAIN}`,
    adminId,
  );
}

async function appt(id: number, clinicId: number, start: string, end: string, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Jakarta', '', '', ?, NOW())`,
    id, clinicId, DOC, PATIENT, DATE, start, DATE, end, status,
  );
}

const update = (sql: string, ...args: unknown[]) =>
  prisma.$executeRawUnsafe(`UPDATE wp_kc_appointments SET ${sql}`, ...args);

/** Addresses of this suite that got a mail, sorted. */
function sentTo(): string[] {
  return email.sendEmail.mock.calls
    .map(([m]) => (m as { to: string }).to)
    .filter((to) => to.endsWith(DOMAIN))
    .sort();
}

const ourNotices = () =>
  prisma.scheduleConflictNotice.findMany({
    where: { appointmentLowId: { gte: BASE, lt: END } },
    orderBy: { recipient: 'asc' },
  });

async function wipe() {
  // The table belongs to this feature alone; scans here also record other suites' leftovers.
  await prisma.scheduleConflictNotice.deleteMany({});
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?', BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?', BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });

  await wpUser(DOC, 'kiviCare_doctor', 'Dianda');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  await wpUser(ADMIN_A, 'kiviCare_clinic_admin', 'AdminA');
  await wpUser(ADMIN_B, 'kiviCare_clinic_admin', 'AdminB');
  await clinic(CLINIC_A, ADMIN_A);
  await clinic(CLINIC_B, ADMIN_B);
  await clinic(CLINIC_NO_ADMIN, 0);
  await clinic(CLINIC_OWNED, DOC);
});

beforeEach(async () => {
  await wipe();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
  await prisma.$executeRawUnsafe('DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?', BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$disconnect();
});

describe('scanScheduleConflicts', () => {
  it('mails the psikolog and the clinic admin once, then stays quiet', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);

    const first = await scanScheduleConflicts();
    expect(first.pairs).toBeGreaterThanOrEqual(1);
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());

    // Leftover pairs of other suites may be mailed first; pick ours.
    const mail = email.sendEmail.mock.calls
      .map(([m]) => m as { to: string; subject: string; text: string; template: string })
      .find((m) => m.to === mailOf(DOC))!;
    expect(mail.subject).toBe('Jadwal bentrok: 1 pasang janji temu tumpang tindih');
    expect(mail.text).toContain(`#${A1} · 09:00–10:00`);
    expect(mail.text).toContain(`#${A2} · 09:30–10:30`);
    expect(mail.template).toBe('schedule_conflict');

    const notices = await ourNotices();
    expect(notices.map((n) => n.recipient)).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
    expect(notices.every((n) => n.fingerprint === `${DATE}|09:00:00-10:00:00|09:30:00-10:30:00`)).toBe(true);

    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
  });

  it('tells the admin of each clinic when the pair spans two', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_B, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A), mailOf(ADMIN_B)].sort());
  });

  it('still tells the psikolog when the clinic has no admin', async () => {
    await appt(A1, CLINIC_NO_ADMIN, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_NO_ADMIN, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC)]);
  });

  it('sends one email to an owner who is both admin and psikolog', async () => {
    await appt(A1, CLINIC_OWNED, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_OWNED, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC)]);
  });

  it('tells everyone again when the clash moves but still overlaps', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);
    await scanScheduleConflicts();

    await update("appointment_start_time = '09:45:00', appointment_end_time = '10:45:00' WHERE id = ?", A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();

    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
    const notices = await ourNotices();
    expect(notices.every((n) => n.fingerprint === `${DATE}|09:00:00-10:00:00|09:45:00-10:45:00`)).toBe(true);
  });

  it('does not mail again for a status change alone', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);
    await scanScheduleConflicts();

    await update('status = ? WHERE id = ?', BOOKED, A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
  });

  it('forgets a resolved clash and reports it again if it comes back', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', PENDING);
    await scanScheduleConflicts();

    await update('status = ? WHERE id = ?', CANCELLED, A2);
    email.sendEmail.mockClear();
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([]);
    expect(await ourNotices()).toEqual([]);

    await update('status = ? WHERE id = ?', PENDING, A2);
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
  });

  it('retries only the recipient whose email failed', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);
    email.sendEmail.mockImplementation(async (m: { to: string }) =>
      m.to === mailOf(ADMIN_A) ? { ok: false, error: 'smtp down' } : { ok: true },
    );

    const first = await scanScheduleConflicts();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect((await ourNotices()).map((n) => n.recipient)).toEqual([mailOf(DOC)]);

    email.sendEmail.mockReset();
    email.sendEmail.mockResolvedValue({ ok: true });
    await scanScheduleConflicts();
    expect(sentTo()).toEqual([mailOf(ADMIN_A)]);
  });

  it('ignores a clash whose overlap is already over, but not one still running', async () => {
    await appt(A1, CLINIC_A, '09:00:00', '10:00:00', BOOKED);
    await appt(A2, CLINIC_A, '09:30:00', '10:30:00', BOOKED);

    // 11:00 WIB: the overlap ended at 10:00 WIB (03:00 UTC).
    await scanScheduleConflicts(new Date(`${DATE}T04:00:00Z`));
    expect(sentTo()).toEqual([]);
    expect(await ourNotices()).toEqual([]);

    // 09:40 WIB: both sessions are running.
    await scanScheduleConflicts(new Date(`${DATE}T02:40:00Z`));
    expect(sentTo()).toEqual([mailOf(DOC), mailOf(ADMIN_A)].sort());
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/integration/schedule/conflict-scan.test.ts`
Expected: FAIL — cannot resolve `@/services/schedule/conflict-scan.service`.

- [ ] **Step 5: Write the implementation**

Create `src/services/schedule/conflict-scan.service.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/schedule/conflict-scan.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add prisma/manual/2026-10-21-schedule-conflict-notices.sql prisma/schema.prisma src/services/schedule/conflict-scan.service.ts tests/integration/schedule/conflict-scan.test.ts
git commit -m "feat(jadwal): pemindaian bentrok jadwal, dedupe per penerima di schedule_conflict_notices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cron guard + scan route

**Files:**
- Create: `src/lib/cron-secret.ts`
- Modify: `src/app/api/v1/internal/google-calendar/conflict-scan/route.ts` (replace the inline guard)
- Create: `src/app/api/v1/internal/schedule-conflicts/scan/route.ts`
- Test: `tests/unit/schedule/conflict-scan-route.test.ts`; existing `tests/unit/google/conflict-scan-route.test.ts` must stay green unchanged.

**Interfaces:**
- Consumes: `scanScheduleConflicts()` (Task 4); `unauthorized(code)`, `serviceUnavailable(code, detail)`, `problem({...})` from `@/lib/problem-details`.
- Produces: `export function checkCronSecret(req: NextRequest, label: string): NextResponse | null;` — `null` when the request may pass; otherwise 503 (`cron_not_configured`, logs `console.error`) or 401 (`invalid_cron_secret`).

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/schedule/conflict-scan-route.test.ts`:

```ts
/**
 * Endpoint yang dipanggil cron per jam. Tidak dijaga sesi pengguna, jadi penjagaannya sendiri
 * yang harus benar — dan GAGAL TERTUTUP ketika rahasianya belum diatur.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/schedule/conflict-scan.service', () => ({
  scanScheduleConflicts: vi.fn(async () => ({ pairs: 2, recipients: 3, notified: 3, failed: 0 })),
}));
vi.mock('@/lib/logging', () => ({
  logging: { system: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}) },
}));

import { POST } from '@/app/api/v1/internal/schedule-conflicts/scan/route';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';
import { logging } from '@/lib/logging';

const RAHASIA = 'rahasia-cron-yang-panjang-sekali';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['x-cron-secret'] = secret;
  return new NextRequest('http://x/api/v1/internal/schedule-conflicts/scan', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = RAHASIA;
});

describe('POST schedule-conflicts/scan', () => {
  it('menjalankan pemindaian, mencatat ringkasannya, dan mengembalikannya', async () => {
    const res = await POST(req(RAHASIA));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { pairs: 2, recipients: 3, notified: 3, failed: 0 } });
    expect(scanScheduleConflicts).toHaveBeenCalledOnce();
    expect(logging.system).toHaveBeenCalledWith(
      '[schedule-conflict-scan] selesai',
      expect.anything(),
      expect.objectContaining({ action: 'schedule.conflict-scan' }),
    );
  });

  it('menolak rahasia yang salah', async () => {
    const res = await POST(req('salah'));
    expect(res.status).toBe(401);
    expect(scanScheduleConflicts).not.toHaveBeenCalled();
  });

  it('menolak permintaan tanpa rahasia', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(scanScheduleConflicts).not.toHaveBeenCalled();
  });

  it('gagal tertutup ketika CRON_SECRET belum diatur', async () => {
    delete process.env.CRON_SECRET;
    const tercatat = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req(RAHASIA));
      expect(res.status).toBe(503);
      expect(scanScheduleConflicts).not.toHaveBeenCalled();
      expect(tercatat).toHaveBeenCalled();
    } finally {
      tercatat.mockRestore();
    }
  });

  it('menjawab 500 dan mencatatnya ketika pemindaian melempar', async () => {
    vi.mocked(scanScheduleConflicts).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(req(RAHASIA));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'scan_failed', status: 500 });
    expect(logging.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule/conflict-scan-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/v1/internal/schedule-conflicts/scan/route`.

- [ ] **Step 3: Extract the shared guard**

Create `src/lib/cron-secret.ts`:

```ts
// Penjaga untuk route yang dipanggil cron server dengan header `x-cron-secret`.
//
// Route semacam ini tidak dijaga sesi pengguna, jadi penjagaannya sendiri yang harus benar —
// dan GAGAL TERTUTUP ketika rahasianya belum diatur, bukan terbuka.
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { serviceUnavailable, unauthorized } from '@/lib/problem-details';

function secretMatches(diberikan: string | null, diharapkan: string): boolean {
  if (!diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(diharapkan);
  // Panjang diperiksa lebih dulu karena timingSafeEqual melempar bila berbeda,
  // dan panjang sebuah rahasia bukan rahasia.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `null` bila permintaan boleh lewat; selain itu respons yang harus dikembalikan route. */
export function checkCronSecret(req: NextRequest, label: string): NextResponse | null {
  const diharapkan = process.env.CRON_SECRET;
  if (!diharapkan) {
    // Gagal tertutup. Endpoint internal yang diam-diam terbuka karena satu
    // variabel lupa diisi adalah cara paling sunyi untuk membocorkan jalur ini.
    console.error(`[${label}] CRON_SECRET belum diatur — permintaan ditolak`);
    const p = serviceUnavailable('cron_not_configured', 'Pemindaian belum dikonfigurasi.');
    return NextResponse.json(p, { status: p.status });
  }

  if (!secretMatches(req.headers.get('x-cron-secret'), diharapkan)) {
    const p = unauthorized('invalid_cron_secret');
    return NextResponse.json(p, { status: p.status });
  }

  return null;
}
```

Replace the body of `src/app/api/v1/internal/google-calendar/conflict-scan/route.ts` (keep its header comment lines 1-8 as they are) so the rest of the file reads:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { scanBackwardConflicts } from '@/services/integrations/conflict-scan.service';
import { checkCronSecret } from '@/lib/cron-secret';
import { logging } from '@/lib/logging';
import { LogLevel } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ditolak = checkCronSecret(req, 'conflict-scan');
  if (ditolak) return ditolak;

  const mulai = Date.now();
  const hasil = await scanBackwardConflicts();
  logging.system('[conflict-scan] selesai', LogLevel.INFO, {
    action: 'google.conflict-scan',
    metadata: { ...hasil, ms: Date.now() - mulai },
  });

  return NextResponse.json({ data: hasil });
}
```

- [ ] **Step 4: Write the new route**

Create `src/app/api/v1/internal/schedule-conflicts/scan/route.ts`:

```ts
// Dipanggil cron server tiap jam: cari janji temu aktif satu psikolog yang tumpang tindih,
// lalu beri tahu psikolognya dan admin kliniknya.
//
// Cron server, bukan Action Scheduler — alasannya sama dengan pemindaian bentrok Google
// (route google-calendar/conflict-scan): Action Scheduler di instalasi ini pernah macet
// berminggu-minggu tanpa ada yang sadar, sedangkan satu baris crontab sembuh sendiri.
// Spec: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md
import { NextRequest, NextResponse } from 'next/server';
import { LogLevel } from '@prisma/client';
import { checkCronSecret } from '@/lib/cron-secret';
import { logging } from '@/lib/logging';
import { problem } from '@/lib/problem-details';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ditolak = checkCronSecret(req, 'schedule-conflict-scan');
  if (ditolak) return ditolak;

  const mulai = Date.now();
  try {
    const hasil = await scanScheduleConflicts();
    await logging.system('[schedule-conflict-scan] selesai', LogLevel.INFO, {
      action: 'schedule.conflict-scan',
      metadata: { ...hasil, ms: Date.now() - mulai },
    });
    return NextResponse.json({ data: hasil });
  } catch (err) {
    // Kueri deteksi gagal: tabel catatan tidak tersentuh, dan log cron mencatat 500-nya.
    await logging.error('[schedule-conflict-scan] gagal', err, { action: 'schedule.conflict-scan' });
    const p = problem({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'scan_failed',
      detail: 'Pemindaian bentrok jadwal gagal.',
    });
    return NextResponse.json(p, { status: 500 });
  }
}
```

- [ ] **Step 5: Run both route tests**

Run: `npx vitest run tests/unit/schedule/conflict-scan-route.test.ts tests/unit/google/conflict-scan-route.test.ts`
Expected: PASS, 10 tests (5 new + 5 existing Google tests, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron-secret.ts src/app/api/v1/internal/google-calendar/conflict-scan/route.ts src/app/api/v1/internal/schedule-conflicts/scan/route.ts tests/unit/schedule/conflict-scan-route.test.ts
git commit -m "feat(jadwal): POST /internal/schedule-conflicts/scan untuk cron per jam; penjaga x-cron-secret dipakai bersama

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Release doc, full verification, push

**Files:**
- Create: `docs/deploy/2026-10-21-schedule-conflict-scan-cron.md`
- Modify: `.env.example` (the `CRON_SECRET` comment block, ~line 198)

- [ ] **Step 1: Read the live Google cron script**

Run: `ssh praktiqu-hostinger 'cat ~/google-conflict-scan.sh'` (40 s ConnectTimeout; Cloudflare WARP blocks it — ask the user to switch WARP off if it times out). Use it to make sure the `sed` patterns in Step 2 match the script. If they do not, write the new script's full contents into the doc instead.

- [ ] **Step 2: Write the deploy doc**

Create `docs/deploy/2026-10-21-schedule-conflict-scan-cron.md`:

````markdown
# Cron pemindaian bentrok jadwal (per jam)

Spec: `docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md`.

## Urutan rilis: SQL → BE → cron

Tidak ada perubahan plugin.

1. **SQL** — terapkan di database Hostinger (`u580667380_nnmkapn`) sebelum merge:

   ```bash
   mysql -u <user> -p u580667380_nnmkapn < prisma/manual/2026-10-21-schedule-conflict-notices.sql
   ```

   `CREATE TABLE IF NOT EXISTS`, jadi aman dijalankan ulang. Tanpa tabel ini setiap run menjawab 500.

2. **BE** — merge PR ke `main`. Build Hostinger menjalankan `prisma generate && next build`, jadi model
   `ScheduleConflictNotice` ikut otomatis. Periksa build-nya benar-benar jalan
   (`hbuilds/logs/<build>/…_deploy.log` menyebut commit merge-nya) — auto-deploy pernah melewatkan merge.

3. **Cron** — skripnya salinan skrip pemindaian Google, dengan URL dan berkas log baru:

   ```bash
   sed -e 's#google-calendar/conflict-scan#schedule-conflicts/scan#' \
       -e 's#google-conflict-scan\.log#schedule-conflict-scan.log#' \
       ~/google-conflict-scan.sh > ~/schedule-conflict-scan.sh
   chmod 700 ~/schedule-conflict-scan.sh
   ```

   Lalu di hPanel → Advanced → Cron Jobs (tidak ada `crontab` lewat SSH), tambahkan:

   ```
   0 * * * * /home/u580667380/schedule-conflict-scan.sh
   ```

   Rahasia dioper ke curl lewat **stdin** (`curl -K -`), bukan argumen: di shared hosting daftar
   argumen setiap proses terbaca lewat `ps`.

## Yang dibutuhkan environment

- Tabel `schedule_conflict_notices`.
- `CRON_SECRET` — sudah terpasang untuk pemindaian Google. Kosong berarti endpoint-nya menolak semua
  permintaan (503), dan itu disengaja.

## Run pertama

Run pertama melaporkan setiap bentrok yang SUDAH ada di antara janji temu aktif yang akan datang. Itu
disengaja — bentroknya nyata. Untuk melihat lebih dulu apa yang akan dikirim, jalankan kueri di
`findOverlappingAppointmentPairs` (`src/repositories/wp/appointments.repo.ts`) secara read-only dengan
tanggal kemarin.

## Memeriksa bahwa ia benar-benar berjalan

```bash
tail -5 ~/schedule-conflict-scan.log
```

Tiap baris memuat ringkasan `{pairs, recipients, notified, failed}` dan status HTTP. `pairs: 0` berarti
tidak ada bentrok — bukan kegagalan. Status selain 200, atau tidak ada baris baru dalam satu jam, berarti
cron atau endpoint-nya mati.

Menjalankannya manual:

```bash
~/schedule-conflict-scan.sh && tail -1 ~/schedule-conflict-scan.log
```

## Mematikannya

Hapus baris cron di hPanel. Tabelnya boleh dibiarkan; ia hanya dibaca dan ditulis oleh pemindaian ini.
````

- [ ] **Step 3: Update `.env.example`**

In the `CRON_SECRET` comment block of `.env.example`, below the existing line
`#   POST /api/v1/internal/google-calendar/conflict-scan   (header x-cron-secret)`, add:

```
#   POST /api/v1/internal/schedule-conflicts/scan         (header x-cron-secret, tiap jam)
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx vitest run`
Expected: all files pass — baseline on `main` was 244 files / 2736 tests; now 249 files (+ overlap-pairs, conflict-pairs, conflict-email, conflict-scan, conflict-scan-route) and 2736 + 37 tests.

- [ ] **Step 5: Commit and push**

```bash
git add docs/deploy/2026-10-21-schedule-conflict-scan-cron.md .env.example
git commit -m "docs(deploy): rilis cron pemindaian bentrok jadwal per jam (SQL → BE → cron)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/deteksi-bentrok-jadwal
```

Push uses the repo-scoped SSH key (see memory `git-push-ssh-key-setup`); there is no `gh`, so the PR goes out as a prefilled compare link:
`https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/deteksi-bentrok-jadwal?expand=1&title=...&body=...` (URL-encode the title and body; body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
