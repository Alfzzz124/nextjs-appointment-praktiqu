# Unify Slot Generators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one piece of code decide whether a slot is bookable, so the public booking page, the public catalog, and the staff calendar can no longer disagree.

**Architecture:** Extract the slot arithmetic into a pure, dependency-free module, have the existing `generateSlots` delegate to it, add a range-aware public reader built on the same core, then delete the two duplicate generators. Nothing here touches Google Calendar — this is Phase 1 of `docs/superpowers/specs/2026-08-28-google-calendar-sync-design.md` and is a prerequisite for it, but it stands on its own as a bug fix.

**Tech Stack:** TypeScript, Next.js App Router (server components), Prisma over MySQL, Vitest.

## Why this is worth doing on its own

`src/app/(public)/book/[professionalId]/[serviceId]/page.tsx` — the page patients actually browse — has its own `generateSlots` over raw SQL. Compared to the shared `generateSlots` in `src/services/professional/availability.service.ts` it:

- **never subtracts off-days** — it issues no query against `wp_kc_doctor_off_days` at all
- **does not check the professional is ACTIVE**, nor that the service is public (`is_public`), nor scope anything to a clinic
- **very likely fails to subtract existing appointments.** Its overlap test compares strings: `` `${bookDate} ${booking.appointment_start_time}` ``, where `bookDate` comes from `$queryRawUnsafe` on a MySQL `DATE` column and therefore arrives as a JS `Date`. Interpolated, that renders `"Thu Aug 28 2026 00:00:00 GMT+0000 (…)"`, which is compared against `"2026-08-28 09:00"`. `'2'` sorts below `'T'`, so both halves of the comparison are false and `isBooked` never fires.

That last point is a live double-booking risk, but it is an inference from reading the code, not an observation. **Task 1 proves or disproves it with a test before anything is deleted.** If the characterization test shows booked slots *are* filtered, say so and adjust — do not quietly drop the finding.

## Global Constraints

- Times are `HH:MM:SS` in **local clinic time**; all overlap arithmetic is in minutes past local midnight. No UTC conversion anywhere in this plan.
- Overlap is **half-open**: `b.start < slotEnd && b.end > slotStart`. A slot ending exactly when a block starts stays bookable.
- **No schema changes.** No Prisma migration, no new tables. `DATABASE_URL` points at the live WordPress database; `prisma migrate dev` and `db push` are forbidden in this repo.
- Tests run with `npm test` (`vitest run`, `fileParallelism: false`).
- **Docker is currently unreachable from this WSL distro**, so no database is available. Every test in this plan is a pure-function or `vi.mock` test and must pass with no database. Do not write a test that needs one.
- Follow the existing repo idiom: services in `src/services/`, repositories in `src/repositories/wp/`, path alias `@/` → `src/`.

## File Structure

| File | Responsibility |
|---|---|
| `src/services/booking/slot-math.ts` | **Create.** Pure slot arithmetic: given windows and blocked ranges, produce slots. No I/O, no clock, no timezone. The single place a slot is decided to exist — and therefore the single place Phase 3 will merge Google busy blocks. |
| `tests/unit/booking/slot-math.test.ts` | **Create.** Unit tests for the above. |
| `src/services/professional/availability.service.ts` | **Modify.** `generateSlots` delegates its inner loop to `buildDaySlots`; local `toMinutes`/`toTime` replaced by the shared ones. |
| `src/services/public/public-catalog.service.ts` | **Modify.** Add `getPublicSlotsForRange`, a range-aware reader that makes five queries for a fortnight instead of five per day. |
| `tests/unit/public/public-slots-range.test.ts` | **Create.** `vi.mock`ed repository tests for the range reader. |
| `src/app/(public)/book/[professionalId]/[serviceId]/page.tsx` | **Modify.** Drop the local generator, the raw SQL, and the five local date/time helpers; call `getPublicSlotsForRange`. |
| `src/services/booking/slot-generator.ts` | **Delete.** Third generator, imported by nothing but its own test. |
| `tests/unit/booking/slot-generator.test.ts` | **Delete.** Tests the deleted file. |

---

### Task 1: Pure slot arithmetic

**Files:**
- Create: `src/services/booking/slot-math.ts`
- Create: `tests/unit/booking/slot-math.test.ts`
- Modify: `src/services/professional/availability.service.ts:87-100` (helpers), `:324-346` (the loop inside `generateSlots`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `TimeWindow = { startTime: string; endTime: string; slotDurationMinutes: number }`
  - `BlockedRange = { start: number; end: number }` (minutes past local midnight)
  - `DaySlot = { startTime: string; endTime: string }` (`HH:MM:SS`)
  - `buildDaySlots(input: { windows: TimeWindow[]; blocked: BlockedRange[]; durationMinutes?: number }): DaySlot[]`
  - `eachDate(from: string, to: string): string[]` (inclusive, `YYYY-MM-DD`)
  - `toMinutes(time: string): number`, `toTime(minutes: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/booking/slot-math.test.ts`:

```ts
// tests/unit/booking/slot-math.test.ts
import { describe, it, expect } from 'vitest';
import { buildDaySlots, eachDate, toMinutes, toTime } from '@/services/booking/slot-math';

const nineToTwelve = { startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 };

describe('buildDaySlots', () => {
  it('fills a window back to back', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [] })).toEqual([
      { startTime: '09:00:00', endTime: '10:00:00' },
      { startTime: '10:00:00', endTime: '11:00:00' },
      { startTime: '11:00:00', endTime: '12:00:00' },
    ]);
  });

  it('drops a slot a block partially overlaps', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60 + 30, end: 11 * 60 }], // 10:30–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('keeps the slots on either side of an exactly-aligned block', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60, end: 11 * 60 }], // 10:00–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('lets a service duration override the window slot size', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [], durationMinutes: 90 })).toEqual([
      { startTime: '09:00:00', endTime: '10:30:00' },
      { startTime: '10:30:00', endTime: '12:00:00' },
    ]);
  });

  it('emits nothing when the window cannot fit one slot', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '09:30:00', slotDurationMinutes: 60 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('skips a window whose duration is not positive', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 0 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('handles several windows in one day', () => {
    const slots = buildDaySlots({
      windows: [
        nineToTwelve,
        { startTime: '14:00:00', endTime: '15:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [],
    });
    expect(slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00', '14:00:00',
    ]);
  });
});

describe('eachDate', () => {
  it('includes both ends', () => {
    expect(eachDate('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28', '2026-08-29', '2026-08-30',
    ]);
  });

  it('returns one date when from equals to', () => {
    expect(eachDate('2026-08-28', '2026-08-28')).toEqual(['2026-08-28']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDate('2026-08-30', '2026-08-28')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(eachDate('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01',
    ]);
  });
});

describe('toMinutes / toTime', () => {
  it('round-trips a time', () => {
    expect(toTime(toMinutes('14:45:00'))).toBe('14:45:00');
  });

  it('converts midnight to zero', () => {
    expect(toMinutes('00:00:00')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/booking/slot-math.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/booking/slot-math"`.

- [ ] **Step 3: Write the implementation**

Create `src/services/booking/slot-math.ts`:

```ts
// src/services/booking/slot-math.ts
// Pure slot arithmetic. No database, no clock, no timezone conversion.
//
// Everything here works in local clinic time — `HH:MM:SS` strings and minutes
// past local midnight — which is the basis KiviCare stores clinic sessions and
// appointments in.
//
// This is the one place a slot is decided to exist or not, which makes it the
// one place a new source of unavailability has to be merged into.

/** A stretch of the day the professional works, from `wp_kc_clinic_sessions`. */
export interface TimeWindow {
  /** `HH:MM:SS`, local clinic time. */
  startTime: string;
  /** `HH:MM:SS`, local clinic time. */
  endTime: string;
  /** Slot size to use when the caller has no service-specific duration. */
  slotDurationMinutes: number;
}

/** Minutes past local midnight, half-open: `[start, end)`. */
export interface BlockedRange {
  start: number;
  end: number;
}

export interface DaySlot {
  /** `HH:MM:SS` */
  startTime: string;
  /** `HH:MM:SS` */
  endTime: string;
}

/** `HH:MM:SS` → minutes past midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes past midnight → `HH:MM:SS`. */
export function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Slots for a single day.
 *
 * Overlap is half-open, so a slot ending exactly when a block starts is still
 * bookable — the same rule that lets appointments sit back to back.
 *
 * `durationMinutes` overrides each window's own slot size when supplied; that
 * is the professional's duration for the service being booked.
 */
export function buildDaySlots(input: {
  windows: TimeWindow[];
  blocked: BlockedRange[];
  durationMinutes?: number;
}): DaySlot[] {
  const { windows, blocked, durationMinutes } = input;
  const slots: DaySlot[] = [];

  for (const w of windows) {
    const duration = durationMinutes ?? w.slotDurationMinutes;
    if (duration <= 0) continue;

    const windowStart = toMinutes(w.startTime);
    const windowEnd = toMinutes(w.endTime);

    for (let start = windowStart; start + duration <= windowEnd; start += duration) {
      const end = start + duration;
      if (blocked.some((b) => b.start < end && b.end > start)) continue;
      slots.push({ startTime: toTime(start), endTime: toTime(end) });
    }
  }

  return slots;
}

/**
 * Inclusive `YYYY-MM-DD` dates from `from` to `to`.
 *
 * Stepped in UTC deliberately: these are calendar labels rather than instants,
 * and advancing a local-midnight Date would drop or repeat a day wherever a
 * DST boundary falls.
 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/booking/slot-math.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit the new module**

```bash
git add src/services/booking/slot-math.ts tests/unit/booking/slot-math.test.ts
git commit -m "feat(booking): extract pure slot arithmetic into slot-math"
```

- [ ] **Step 6: Delegate `generateSlots` to the new module**

In `src/services/professional/availability.service.ts`, add to the import block near the top:

```ts
import { buildDaySlots, toMinutes, toTime } from '@/services/booking/slot-math';
```

Delete the local `toMinutes` and `toTime` definitions (the two functions directly under the `const TIME_RE` line) — the imported ones are identical, and `TIME_RE` stays where it is.

Then replace the slot-building loop at the end of `generateSlots` — everything from `const slots: BookableSlot[] = [];` through `return slots;` — with:

```ts
  const daySlots = buildDaySlots({
    windows: windows
      .filter((w) => w.startTime !== null && w.endTime !== null)
      .map((w) => ({
        startTime: w.startTime as string,
        endTime: w.endTime as string,
        slotDurationMinutes: w.slotDurationMinutes,
      })),
    blocked,
    durationMinutes: service.durationMinutes ?? undefined,
  });

  return daySlots.map((s) => ({
    date,
    startTime: s.startTime,
    endTime: s.endTime,
    serviceId,
    doctorId,
  }));
```

This is a pure refactor: the loop it replaces used `service.durationMinutes ?? w.slotDurationMinutes` per window, which is exactly what `durationMinutes` does inside `buildDaySlots`.

- [ ] **Step 7: Verify nothing else broke**

Run: `npm test`
Expected: PASS. No test should change its result — this step altered no behaviour. If anything fails, the delegation is wrong; fix it rather than adjusting the test.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/professional/availability.service.ts
git commit -m "refactor(availability): generateSlots delegates to slot-math"
```

---

### Task 2: Range-aware public slot reader

**Files:**
- Modify: `src/services/public/public-catalog.service.ts` (add a new export beside `getPublicSlots`)
- Create: `tests/unit/public/public-slots-range.test.ts`

**Interfaces:**
- Consumes: `buildDaySlots`, `eachDate`, `toMinutes` from Task 1.
- Produces:
  - `PublicDaySlots = { date: string; slots: PublicSlot[] }`
  - `getPublicSlotsForRange(opts: { professionalId: number; serviceId: number; from: string; to: string; clinicId?: number }): Promise<PublicDaySlots[] | null>`
  - `null` means no such active professional, or the service is not offered publicly — a 404 either way. An empty `slots` array on a day means "open, nothing free".
  - `PublicProfessionalSummary = { id: number; fullName: string }`
  - `getPublicProfessionalSummary(professionalId: number): Promise<PublicProfessionalSummary | null>`

`getPublicProfessionalSummary` is a new addition, not a rename: `public-catalog.service.ts` today exports `listPublicProfessionals` (a directory listing) and `getPublicProfessionalServices`, but nothing that reads one professional's display name. The booking page needs it, and gets it today from raw SQL against `wp_users` — which Task 3 deletes.

The existing per-date `getPublicSlots` stays as it is; the authenticated slots API still uses it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/public/public-slots-range.test.ts`:

```ts
// tests/unit/public/public-slots-range.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mock list is wider than this test strictly uses. vi.mock replaces a module
// wholesale, so every name public-catalog.service.ts (and availability.service.ts,
// which it imports for dayOfWeekFor) pulls from these modules has to exist here or
// the import fails. Anything left unmocked reaches the real Prisma client.
vi.mock('@/repositories/wp/doctors.repo', () => ({
  PROFESSIONAL_STATUS: { ACTIVE: 1 },
  findDoctorById: vi.fn(),
  listDoctors: vi.fn(),
}));
vi.mock('@/repositories/wp/clinics.repo', () => ({
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', () => ({
  STATIC_DATA_TYPE: {},
  listStaticData: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => ({
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/repositories/wp/clinic-sessions.repo', () => ({
  DAYS_OF_WEEK: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  listClinicSessions: vi.fn(),
  getWeeklyAvailability: vi.fn(),
  replaceWeeklySchedule: vi.fn(),
}));
vi.mock('@/repositories/wp/off-days.repo', () => ({
  OFF_DAY_MODULE: 'doctor',
  createOffDay: vi.fn(),
  deleteOffDay: vi.fn(),
  isOffOn: vi.fn(() => false),
  listDoctorOffDays: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.repo', () => ({
  ACTIVE_STATUSES: [1, 2, 4, 5],
  listAppointments: vi.fn(),
}));

import {
  getPublicSlotsForRange,
  getPublicProfessionalSummary,
} from '@/services/public/public-catalog.service';
import * as doctors from '@/repositories/wp/doctors.repo';
import * as services from '@/repositories/wp/services.repo';
import * as sessions from '@/repositories/wp/clinic-sessions.repo';
import * as offDays from '@/repositories/wp/off-days.repo';
import * as appts from '@/repositories/wp/appointments.repo';

const DOCTOR_ID = 7;
const SERVICE_ID = 3;

/** 2026-08-31 is a Monday. */
const MONDAY = '2026-08-31';
const TUESDAY = '2026-09-01';

function happyPath() {
  (doctors.findDoctorById as any).mockResolvedValue({ id: 7n, status: 1 });
  (services.listServicesForDoctor as any).mockResolvedValue([
    { serviceId: 3n, clinicId: 1n, durationMinutes: 60, isActive: true, isPublic: true },
  ]);
  (sessions.listClinicSessions as any).mockResolvedValue([
    { day: 'mon', startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 30 },
  ]);
  (offDays.listDoctorOffDays as any).mockResolvedValue([]);
  (offDays.isOffOn as any).mockReturnValue(false);
  (appts.listAppointments as any).mockResolvedValue({ items: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('getPublicSlotsForRange', () => {
  it('returns one entry per day in the range, inclusive', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
    });
    expect(days?.map((d) => d.date)).toEqual([MONDAY, TUESDAY]);
  });

  it('uses the service duration, not the window slot size', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00',
    ]);
  });

  it('leaves a day with no matching session empty', async () => {
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
    });
    expect(days?.[1].slots).toEqual([]);
  });

  it('subtracts an existing appointment', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [{ startDate: MONDAY, startTime: '10:00:00', endTime: '11:00:00' }],
    });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('ignores an appointment on a different day in the range', async () => {
    (appts.listAppointments as any).mockResolvedValue({
      items: [{ startDate: TUESDAY, startTime: '10:00:00', endTime: '11:00:00' }],
    });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: TUESDAY,
    });
    expect(days?.[0].slots).toHaveLength(3);
  });

  it('empties a day covered by a full-day off day', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([{ timeSpecific: false }]);
    (offDays.isOffOn as any).mockReturnValue(true);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days?.[0].slots).toEqual([]);
  });

  it('subtracts a time-specific off day', async () => {
    (offDays.listDoctorOffDays as any).mockResolvedValue([
      { timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' },
    ]);
    (offDays.isOffOn as any).mockReturnValue(true);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days?.[0].slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('returns null for an inactive professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({ id: 7n, status: 0 });
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days).toBeNull();
  });

  it('returns null when the service is not offered publicly', async () => {
    (services.listServicesForDoctor as any).mockResolvedValue([]);
    const days = await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect(days).toBeNull();
  });

  it('queries the repositories once for the whole range, not once per day', async () => {
    await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: '2026-09-13',
    });
    expect((appts.listAppointments as any).mock.calls).toHaveLength(1);
    expect((sessions.listClinicSessions as any).mock.calls).toHaveLength(1);
    expect((offDays.listDoctorOffDays as any).mock.calls).toHaveLength(1);
  });

  it('asks for public services only', async () => {
    await getPublicSlotsForRange({
      professionalId: DOCTOR_ID, serviceId: SERVICE_ID, from: MONDAY, to: MONDAY,
    });
    expect((services.listServicesForDoctor as any).mock.calls[0][0]).toMatchObject({
      publicOnly: true,
    });
  });
});

describe('getPublicProfessionalSummary', () => {
  it('returns the display name of an active professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({
      id: 7n, status: 1, displayName: 'Pamela',
    });
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toEqual({ id: 7, fullName: 'Pamela' });
  });

  it('returns null for an inactive professional', async () => {
    (doctors.findDoctorById as any).mockResolvedValue({
      id: 7n, status: 0, displayName: 'Pamela',
    });
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toBeNull();
  });

  it('returns null when the professional does not exist', async () => {
    (doctors.findDoctorById as any).mockResolvedValue(null);
    expect(await getPublicProfessionalSummary(DOCTOR_ID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/public/public-slots-range.test.ts`
Expected: FAIL — `getPublicSlotsForRange is not a function`.

If it instead fails with `No "<name>" export is defined on the mock`, a module in the
import chain needs that name adding to its `vi.mock` factory. Add it as `vi.fn()` and
re-run; that is a mock-completeness problem, not a sign the test is wrong.

- [ ] **Step 3: Write the implementation**

In `src/services/public/public-catalog.service.ts`, extend the existing imports so these names are available (merge into the existing import statements rather than adding duplicates):

```ts
import { listClinicSessions } from '@/repositories/wp/clinic-sessions.repo';
import { isOffOn, listDoctorOffDays } from '@/repositories/wp/off-days.repo';
import { ACTIVE_STATUSES, listAppointments } from '@/repositories/wp/appointments.repo';
import { buildDaySlots, eachDate, toMinutes } from '@/services/booking/slot-math';
```

Then add, directly after `getPublicSlots`:

```ts
export interface PublicDaySlots {
  date: string;
  slots: PublicSlot[];
}

/**
 * Bookable slots for one professional and service across a date range.
 *
 * Same rules as `getPublicSlots`, in one pass: five queries for a fortnight
 * rather than five per day. The booking page renders two weeks at once, so the
 * per-date version would have issued seventy.
 *
 * `null` means no such active professional, or the service is not one they
 * offer publicly — a 404 either way, distinct from "nothing free" (`slots: []`).
 */
export async function getPublicSlotsForRange(opts: {
  professionalId: number;
  serviceId: number;
  from: string;
  to: string;
  clinicId?: number;
}): Promise<PublicDaySlots[] | null> {
  const doctor = await findDoctorById(BigInt(opts.professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;

  const offered = await listServicesForDoctor({
    doctorId: BigInt(opts.professionalId),
    clinicId: opts.clinicId !== undefined ? BigInt(opts.clinicId) : undefined,
    publicOnly: true,
  });
  const mapping = offered.find((s) => Number(s.serviceId) === opts.serviceId && s.isActive);
  if (!mapping) return null;

  const doctorId = BigInt(opts.professionalId);
  const clinicId = BigInt(mapping.clinicId);

  const [sessions, offDays, appointments] = await Promise.all([
    listClinicSessions({ clinicId, doctorId }),
    listDoctorOffDays(doctorId, { from: opts.from, to: opts.to }),
    listAppointments({
      page: 1,
      perPage: 1000,
      doctorId,
      dateFrom: opts.from,
      dateTo: opts.to,
      statuses: ACTIVE_STATUSES,
    }).then((r) => r.items),
  ]);

  return eachDate(opts.from, opts.to).map((date) => {
    const onThisDay = offDays.filter((o) => isOffOn(o, date));

    // A full-day closure ends it here; time-specific ones become blocked ranges.
    if (onThisDay.some((o) => !o.timeSpecific)) return { date, slots: [] };

    const blocked = onThisDay
      .filter((o) => o.timeSpecific && o.startTime && o.endTime)
      .map((o) => ({ start: toMinutes(o.startTime as string), end: toMinutes(o.endTime as string) }));

    for (const a of appointments) {
      if (a.startDate === date && a.startTime && a.endTime) {
        blocked.push({ start: toMinutes(a.startTime), end: toMinutes(a.endTime) });
      }
    }

    const day = dayOfWeekFor(date);
    const windows = sessions
      .filter((s) => s.day === day && s.startTime !== null && s.endTime !== null)
      .map((s) => ({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        slotDurationMinutes: s.slotDurationMinutes,
      }));

    const slots = buildDaySlots({
      windows,
      blocked,
      durationMinutes: mapping.durationMinutes ?? undefined,
    });

    return {
      date,
      slots: slots.map((s) => ({ date, startTime: s.startTime, endTime: s.endTime })),
    };
  });
}

export interface PublicProfessionalSummary {
  id: number;
  fullName: string;
}

/**
 * Just enough about one professional to head a public page.
 *
 * `listPublicProfessionals` is a directory listing and does far more work than a
 * detail page needs; this is the single-row counterpart. `null` for an unknown or
 * non-ACTIVE professional, so the caller can 404.
 */
export async function getPublicProfessionalSummary(
  professionalId: number,
): Promise<PublicProfessionalSummary | null> {
  const doctor = await findDoctorById(BigInt(professionalId));
  if (!doctor || doctor.status !== PROFESSIONAL_STATUS.ACTIVE) return null;
  return { id: Number(doctor.id), fullName: doctor.displayName };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/public/public-slots-range.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite and the type checker**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/public/public-catalog.service.ts tests/unit/public/public-slots-range.test.ts
git commit -m "feat(public): add range-aware slot reader and professional summary"
```

---

### Task 3: Move the public booking page onto the shared reader

**Files:**
- Modify: `src/app/(public)/book/[professionalId]/[serviceId]/page.tsx` (replace lines 1-237; the JSX from `return (` onward stays)

**Interfaces:**
- Consumes: `getPublicSlotsForRange` and `PublicDaySlots` from Task 2.
- Produces: nothing other tasks depend on.

This is the task that changes behaviour. Two changes are intended and one is a risk:

- **Intended:** off-days now block slots; the professional must be ACTIVE; the service must be mapped and active.
- **Intended:** existing appointments are subtracted — see the pre-flight check below for what to expect.
- **Risk:** `getPublicSlotsForRange` passes `publicOnly: true`, which the page never did. If `wp_kc_service_doctor_mapping.is_public` is not set for the services in use, the page will render nothing at all. **Step 1 checks this before any code changes.**

- [ ] **Step 1: Pre-flight — confirm the services are flagged public**

This needs a database. Docker is unreachable from this WSL distro, so either enable Docker Desktop's WSL integration or run the query read-only on staging.

```sql
SELECT is_public, COUNT(*) AS mappings
FROM wp_kc_service_doctor_mapping
WHERE status = 1
GROUP BY is_public;
```

Expected: a healthy count with `is_public = 1`. **If every row is `0`, stop and report it** — the page would go blank on deploy, and the right fix (backfill the flag, or drop `publicOnly` from this call) is a decision for the user, not for this task.

- [ ] **Step 2: Characterize the current appointment-filtering behaviour**

Still against a database, before changing anything. Pick a professional with an appointment in the next fortnight, open `/book/<professionalId>/<serviceId>`, and check whether the booked time still appears as a selectable slot.

Record the answer in the commit message in Step 7. The plan predicts the booked slot **is** still offered, because of the `Date`-interpolated string comparison at the old `page.tsx:179-189`. If it is correctly hidden, the prediction was wrong — say so plainly rather than repeating the claim.

If no database is reachable at all, note that both checks are outstanding and hand back rather than guessing.

- [ ] **Step 3: Rewrite the page**

Replace everything from line 1 through the `daySlots` assignment (the old line 237) with the following. The `return (` JSX block below it is unchanged except for the `days` prop, given in Step 4.

```tsx
// src/app/(public)/book/[professionalId]/[serviceId]/page.tsx
// Step 3: Date and time slot selection
import { WizardLayout } from '@/components/booking/wizard-layout';
import { SlotPicker } from '@/components/booking/slot-picker';
import {
  getPublicProfessionalServices,
  getPublicProfessionalSummary,
  getPublicSlotsForRange,
} from '@/services/public/public-catalog.service';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/** How far ahead the picker offers dates. */
const DAYS_AHEAD = 14;

/** `HH:MM:SS` → `HH:MM`, the shape SlotPicker renders and the hold API expects. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** Local calendar date as `YYYY-MM-DD` — never via toISOString, which shifts to UTC. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

The old file derived its date strings with `date.toISOString().slice(0, 10)`. On a server running ahead of UTC that names the **previous** day, because `setHours(0,0,0,0)` produces local midnight and `toISOString` converts it back to UTC. `localDate` above avoids that; use it everywhere a `Date` becomes a date string.

Then the page component:

```tsx
export default async function BookStep3Page({
  params,
}: {
  params: { professionalId: string; serviceId: string };
}) {
  const professionalId = Number(params.professionalId);
  const serviceId = Number(params.serviceId);

  const today = new Date();
  const from = localDate(today);
  const last = new Date(today);
  last.setDate(last.getDate() + DAYS_AHEAD - 1);
  const to = localDate(last);

  const [professional, services, days] = await Promise.all([
    getPublicProfessionalSummary(professionalId),
    getPublicProfessionalServices(professionalId),
    getPublicSlotsForRange({ professionalId, serviceId, from, to }),
  ]);

  const service = services?.find((s) => s.id === serviceId) ?? null;

  // One guard for all three cases. An unknown professional, an inactive one, and a
  // service they do not offer publicly all render the same card the page showed
  // before.
  if (!professional || !service || !days) {
    return (
      <WizardLayout currentStep={3}>
        <div className="card text-center text-sm text-[#777587]">Layanan tidak ditemukan.</div>
      </WizardLayout>
    );
  }
```

`getPublicProfessionalServices` already returns `PublicService[] | null` with `id: number` and
`durationMinutes: number | null`, and both it and `getPublicProfessionalSummary` apply the
ACTIVE check themselves — so the page does not repeat it.

- [ ] **Step 4: Feed the picker**

Replace the `<SlotPicker … />` element's props with:

```tsx
      <SlotPicker
        professionalId={params.professionalId}
        serviceId={params.serviceId}
        days={days.map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => ({
            startTime: hhmm(s.startTime),
            endTime: hhmm(s.endTime),
            startUtc: `${d.date}T${s.startTime}`,
          })),
        }))}
      />
```

`hhmm` matters: `SlotPicker` renders `startTime` straight onto the button and posts it to `/api/v1/public/booking/hold`. Passing `09:00:00` would both display wrong and change what that endpoint receives.

Update the heading line that reads the duration. `durationMinutes` is nullable and the raw SQL
it replaces used `COALESCE(sdm.duration, 60)`, so keep that fallback:

```tsx
        <p className="mt-1 text-sm text-[#464555]">
          {service.name} dengan <strong>{professional.fullName}</strong> ({service.durationMinutes ?? 60} menit)
        </p>
```

- [ ] **Step 5: Confirm the dead code is gone**

Run: `grep -nE "queryRawUnsafe|DAY_MAP|function generateSlots|timeToMinutes|parseTime|formatTime|toISOString" 'src/app/(public)/book/[professionalId]/[serviceId]/page.tsx'`
Expected: no output. Every one of those belonged to the local generator or the UTC-shifting date derivation.

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/(public)/book/[professionalId]/[serviceId]/page.tsx'
git commit -m "fix(booking): public page uses the shared slot reader

The page had its own generateSlots over raw SQL: no off-day subtraction,
no ACTIVE check, no clinic scoping, and an overlap test that compared a
Date-interpolated string against a formatted one, so booked slots were
offered anyway. It now goes through getPublicSlotsForRange, the same path
as the catalog and the staff calendar.

Date strings are derived locally rather than via toISOString, which named
the previous day wherever the server runs ahead of UTC."
```

Add a line to that message recording what Step 2 actually observed.

---

### Task 4: Delete the orphaned third generator

**Files:**
- Delete: `src/services/booking/slot-generator.ts`
- Delete: `tests/unit/booking/slot-generator.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

`slot-generator.ts` exports `generateSlots` and `formatSlotLabel`. Nothing in `src/` imports either; the only importer is its own test file. It is a third, divergent copy of the same arithmetic, and leaving it invites someone to wire it up later.

- [ ] **Step 1: Prove it is unreferenced**

Run: `grep -rn "slot-generator\|formatSlotLabel" src/ tests/ --include=*.ts --include=*.tsx`
Expected: matches only inside `src/services/booking/slot-generator.ts` and `tests/unit/booking/slot-generator.test.ts`.

If anything else appears, **stop** — the file is live after all. Port that caller onto `buildDaySlots` first, and note the extra work.

- [ ] **Step 2: Delete both files**

```bash
git rm src/services/booking/slot-generator.ts tests/unit/booking/slot-generator.test.ts
```

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS, with the slot-generator suite no longer collected.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(booking): drop the unused third slot generator

slot-generator.ts was imported by nothing but its own test, and duplicated
arithmetic that now lives in slot-math."
```

---

## Done when

- One module — `slot-math.ts` — decides whether a slot exists, and three callers share it.
- The public booking page subtracts off-days and existing appointments, and honours the ACTIVE and public-service checks.
- `npm test` and `npx tsc --noEmit` both pass.
- The pre-flight findings from Task 3 Steps 1 and 2 are recorded, including the case where the appointment-filtering prediction turned out wrong.

Phase 2 of the spec (Google connection, OAuth, token encryption) is the next plan, and depends on this one only for `buildDaySlots` being the single merge point.
