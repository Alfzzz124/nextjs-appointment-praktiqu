# Opsi Durasi Layanan — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One service can carry up to 4 extra durations with their own prices. Each option is its own catalogue row + mapping, tied to its parent by a JSON marker in `wp_kc_service_doctor_mapping.extra`. The API exposes the link (`durationOf`, `durationOptions`) and lets an editor manage options through `PUT /api/v1/services/{id}`.

**Architecture:** A pure marker module reads and writes the JSON in `extra`. The repository attaches the marker to every row it reads. It also hides options whose parent is gone, and copies status from parents to options on the psychologist write paths. A pure planner diffs the requested option list against what exists. `updateService` makes every decision before writing anything, then commits all mapping writes in one transaction (`saveServiceUpdate`). Lists stay flat: an option is still a normal row, just carrying `durationOf`.

**Tech Stack:** Next.js 14 route handlers, TypeScript, Prisma 5 (raw SQL for writes), zod, vitest. Real-DB suites use the Docker MySQL test DB.

**Spec:** `docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md`

## Global Constraints

- Work in the worktree `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/opsi-durasi-layanan`, branch `feat/opsi-durasi-layanan`. Never `cd` to the main checkout.
- **Never** run `prisma db push` / `prisma migrate dev`: `DATABASE_URL` is the WordPress DB. This feature needs **no schema change**, since `extra` already exists on `KcServiceDoctorMapping`.
- Marker JSON on an option row: `{"praktiqu_duration_of":<parent mapping id>}`. A removed option gets `{"praktiqu_duration_of_removed":<parent mapping id>}`. We write `extra` **only** on option rows we create or remove; never on any other row.
- Option name: `<parent name> (<minutes> menit)`. When that exceeds 255 characters, the parent's part is cut, never the suffix.
- At most **4** extra durations per service (`MAX_DURATION_OPTIONS = 4`).
- Error codes, exact strings:
  - 422: `edit_via_parent`, `duration_option_limit`, `duration_option_duplicate`, `duration_option_not_found`;
  - 409: `duration_option_has_appointments` (with `count`) and the existing `service_name_taken`.
- API field names, exact:
  - `ServiceSummary.durationOf: number | null` — parent mapping id, for live **and** removed options;
  - `ServiceSummary.durationOptions: DurationOptionSummary[]` — live options only, shortest first;
  - `PublicService.durationOf: number | null` — the parent's public (catalogue) id;
  - PUT body `durationOptions: Array<{ id?: number; duration: number; price: number }>`.
- Lists stay **flat**: option rows remain in `/api/v1/services` and `/public/professionals/{id}/services`.
- Run single test files with `npx vitest run <path>`. Real-DB suites need Docker Desktop running (container `praktiqu-mysql`); `.env.test.local` already points at `wordpress-praktiqu-test`.
- Every real-DB suite claims a block in `tests/helpers/id-blocks.ts`. This plan uses `9_290_000` and `9_300_000`.
- Commit after every task with `git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit`, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- RTK rewrites `grep`/`diff`: use `/bin/grep` and `/usr/bin/diff -u` when exact output matters.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/repositories/wp/duration-option-marker.ts` (new) | Read/write the marker JSON. Pure, never throws. |
| `src/repositories/wp/services.repo.ts` | `optionOf` / `durationOf` on read rows; stranded-option guards; `listOptionRowsOf`; `findLiveOptionIds`; status cascade on assign/unassign/bulk-status |
| `src/services/service-catalog/duration-options.ts` (new) | `optionName`, `planDurationOptions`, `MAX_DURATION_OPTIONS`. Pure business rules. |
| `src/services/service-catalog/validation.ts` | `durationOptions` request schema; `durationOf` / `durationOptions` response schemas |
| `src/repositories/wp/services.write.ts` | `excludeMappingIds` on the conflict check; `updateMappingOn`; `saveServiceUpdate` (one transaction) |
| `src/services/service-catalog/service.ts` | Summaries carry `durationOf`/`durationOptions`; `updateService` plans + cascades options; `deleteService` cascades; new `unprocessable` error tag |
| `src/app/api/v1/services/[id]/route.ts` | Map `unprocessable` → 422 |
| `src/services/public/public-catalog.service.ts` | `PublicService.durationOf` |
| `scripts/generate-openapi.ts`, `openapi.yaml`, `docs/api/SERVICES-CRUD-GUIDE.md` | Contract + docs |

---

### Task 1: Marker module

**Files:**
- Create: `src/repositories/wp/duration-option-marker.ts`
- Test: `tests/unit/repositories/duration-option-marker.test.ts`

**Interfaces:**
- Produces:
  - `DURATION_OF_KEY = 'praktiqu_duration_of'`, `REMOVED_KEY = 'praktiqu_duration_of_removed'`;
  - `type OptionMarker = { parentId: bigint; removed: boolean }`;
  - `readMarker(extra: string | null | undefined): OptionMarker | null` — live or removed;
  - `parseDurationOf(extra: string | null | undefined): bigint | null` — live only;
  - `optionMarker(parentId: bigint): string`, `removedMarker(parentId: bigint): string`;
  - `ANY_OPTION_PROBE: { extra: { contains: string } }` — a Prisma `where` that matches live and removed markers.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/repositories/duration-option-marker.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANY_OPTION_PROBE,
  optionMarker,
  parseDurationOf,
  readMarker,
  removedMarker,
} from '@/repositories/wp/duration-option-marker';

describe('readMarker', () => {
  it('reads a live marker', () => {
    expect(readMarker('{"praktiqu_duration_of":501}')).toEqual({ parentId: 501n, removed: false });
  });

  it('reads a removed marker', () => {
    expect(readMarker('{"praktiqu_duration_of_removed":501}')).toEqual({ parentId: 501n, removed: true });
  });

  it('accepts the id as a numeric string and tolerates other keys and whitespace', () => {
    expect(readMarker('{ "note": "x", "praktiqu_duration_of" : "77" }')).toEqual({ parentId: 77n, removed: false });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['free text', 'catatan admin: jangan dihapus'],
    ['a JSON array', '[501]'],
    ['a JSON number', '501'],
    ['JSON without our key', '{"currency":"IDR"}'],
    ['zero', '{"praktiqu_duration_of":0}'],
    ['a negative id', '{"praktiqu_duration_of":-3}'],
    ['a fraction', '{"praktiqu_duration_of":1.5}'],
    ['a non-numeric string', '{"praktiqu_duration_of":"abc"}'],
  ])('treats %s as no marker at all', (_label, extra) => {
    expect(readMarker(extra as string | null | undefined)).toBeNull();
  });
});

describe('parseDurationOf', () => {
  it('returns the parent of a live option', () => {
    expect(parseDurationOf(optionMarker(501n))).toBe(501n);
  });

  it('returns null for a removed option: it is no longer an option of anything', () => {
    expect(parseDurationOf(removedMarker(501n))).toBeNull();
  });

  it('returns null for text KiviCare or an admin might have left there', () => {
    expect(parseDurationOf('catatan')).toBeNull();
  });
});

describe('ANY_OPTION_PROBE', () => {
  it('is a substring of both markers, so one LIKE finds live and removed rows', () => {
    const probe = ANY_OPTION_PROBE.extra.contains;
    expect(optionMarker(501n).includes(probe)).toBe(true);
    expect(removedMarker(501n).includes(probe)).toBe(true);
    expect('{"currency":"IDR"}'.includes(probe)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/repositories/duration-option-marker.test.ts`
Expected: FAIL — cannot resolve `@/repositories/wp/duration-option-marker`.

- [ ] **Step 3: Write the module**

```ts
// src/repositories/wp/duration-option-marker.ts
/**
 * The marker that makes a doctor-service mapping a duration option of another mapping.
 *
 * Stored in `wp_kc_service_doctor_mapping.extra` (LONGTEXT). KiviCare declares that column
 * but never writes it — core, Pro, the telemed and Meet add-ons and praktiqu-endpoint were
 * all checked on 2026-11-05; KiviCare only echoes it back in two API responses. We write it
 * only on option rows we create (and when we remove one), never on an existing row, so
 * anything else found in the column is left alone and read as "not an option".
 *
 * Spec: docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md
 */
export const DURATION_OF_KEY = 'praktiqu_duration_of';
export const REMOVED_KEY = 'praktiqu_duration_of_removed';

export type OptionMarker = {
  /** The parent's mapping id. */
  parentId: bigint;
  /** Removed options keep their parent for reports and the dashboard, but are dead. */
  removed: boolean;
};

function toId(raw: unknown): bigint | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return BigInt(raw);
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) return BigInt(raw);
  return null;
}

/** The marker on this row, live or removed, or null. Never throws. */
export function readMarker(extra: string | null | undefined): OptionMarker | null {
  if (!extra) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extra);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const live = toId(obj[DURATION_OF_KEY]);
  if (live !== null) return { parentId: live, removed: false };
  const removed = toId(obj[REMOVED_KEY]);
  if (removed !== null) return { parentId: removed, removed: true };
  return null;
}

/** The parent of a LIVE option, or null (not an option, or a removed one). */
export function parseDurationOf(extra: string | null | undefined): bigint | null {
  const m = readMarker(extra);
  return m && !m.removed ? m.parentId : null;
}

export function optionMarker(parentId: bigint): string {
  return JSON.stringify({ [DURATION_OF_KEY]: Number(parentId) });
}

export function removedMarker(parentId: bigint): string {
  return JSON.stringify({ [REMOVED_KEY]: Number(parentId) });
}

/**
 * Prisma `where` matching rows that carry either marker. Deliberately no closing quote:
 * `"praktiqu_duration_of` is a prefix of both keys. Candidates only — confirm with
 * `readMarker`, since free text could contain the same characters.
 */
export const ANY_OPTION_PROBE = { extra: { contains: `"${DURATION_OF_KEY}` } };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/repositories/duration-option-marker.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/duration-option-marker.ts tests/unit/repositories/duration-option-marker.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): penanda opsi durasi di kolom extra mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Repository reads — marker on every row, stranded options hidden

**Files:**
- Modify: `src/repositories/wp/services.repo.ts`
- Modify: `tests/helpers/id-blocks.ts` (register block 9_290_000)
- Modify: `tests/public-booking/service-name-category.test.ts:47-63` and `tests/payments/public-catalog-payment.test.ts:99-115` (add `durationOf: null` to the `mapping()` helpers; type-check needs it)
- Test: `tests/repositories/wp-duration-options.repo.test.ts` (new, real DB)

**Interfaces:**
- Consumes: `readMarker`, `parseDurationOf`, `ANY_OPTION_PROBE`, `OptionMarker` (Task 1).
- Produces:
  - `WpDoctorService.durationOf: bigint | null` (live parent mapping id);
  - `ClinicServiceRow.optionOf: OptionMarker | null`;
  - `listOptionRowsOf(parentIds: bigint[]): Promise<ClinicServiceRow[]>` — live **and** removed options of these parents, any status, shortest first.
- Guards:
  - `listServicesForDoctor` drops an option whose parent is not in the same result;
  - `listClinicServices` drops an option whose parent is missing, or is inactive while the option is active (checked by id, not by page).

- [ ] **Step 1: Register the id block**

In `tests/helpers/id-blocks.ts`, add this row to `ID_BLOCKS` right after the `9_280_000` row:

```ts
  [9_290_000, 'repositories/wp-duration-options.repo.test.ts', 'kc_services, kc_service_doctor_mapping'],
```

- [ ] **Step 2: Write the failing real-DB test**

```ts
// tests/repositories/wp-duration-options.repo.test.ts
/**
 * Duration options on the real test DB: the marker in `extra` decides which rows are
 * options, and an option never outlives (or out-shows) its parent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import { idBlock } from '../helpers/id-blocks';
import { optionMarker, removedMarker } from '@/repositories/wp/duration-option-marker';
import {
  findMappingById,
  listClinicServices,
  listOptionRowsOf,
  listServicesForDoctor,
} from '@/repositories/wp/services.repo';

const { BASE, END } = idBlock('repositories/wp-duration-options.repo.test.ts');
const D = BASE + 500; // doctor of the main group
const D2 = BASE + 501; // doctor whose parent is not public
const C = BASE + 600;

// Catalogue rows
const S_PARENT = BASE + 1;
const S_OPT = BASE + 2;
const S_ORPHAN = BASE + 3;
const S_Q = BASE + 4;
const S_QOPT = BASE + 5;
const S_NOTE = BASE + 6;
const S_REMOVED = BASE + 7;
const S_P2 = BASE + 8;
const S_O2 = BASE + 9;

// Mapping rows
const P = BASE + 101; // active parent, 60′
const O = BASE + 102; // live option of P, 90′
const ORPHAN = BASE + 103; // live marker pointing at a mapping that does not exist
const Q = BASE + 104; // inactive parent
const QO = BASE + 105; // ACTIVE option of inactive Q — inconsistent on purpose
const NOTE = BASE + 106; // free text in extra: an ordinary service
const REMOVED = BASE + 107; // removed option of P (status 0)
const P2 = BASE + 108; // parent, not public
const O2 = BASE + 109; // public option of P2

const svc = (id: number, name: string) => ({
  id: BigInt(id), name, type: `uji_${BASE}`, price: '0', category: null, status: 1, createdAt: new Date(),
});
const map = (
  id: number, serviceId: number, doctorId: number,
  o: Partial<{ status: number; isPublic: number; duration: number; charges: string; extra: string | null }> = {},
) => ({
  id: BigInt(id), serviceId: BigInt(serviceId), doctorId: BigInt(doctorId), clinicId: BigInt(C),
  charges: o.charges ?? '425000', duration: o.duration ?? 60, status: o.status ?? 1,
  isPublic: o.isPublic ?? 1, telemedService: 'no', extra: o.extra ?? null, createdAt: new Date(),
});

async function wipe() {
  await prisma.kcServiceDoctorMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcService.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.kcService.createMany({
    data: [
      svc(S_PARENT, 'Konseling Uji'), svc(S_OPT, 'Konseling Uji (90 menit)'), svc(S_ORPHAN, 'Yatim Uji'),
      svc(S_Q, 'Terapi Uji'), svc(S_QOPT, 'Terapi Uji (90 menit)'), svc(S_NOTE, 'Layanan Bercatatan'),
      svc(S_REMOVED, 'Konseling Uji (120 menit)'), svc(S_P2, 'Privat Uji'), svc(S_O2, 'Privat Uji (90 menit)'),
    ] as never,
  });
  await prisma.kcServiceDoctorMapping.createMany({
    data: [
      map(P, S_PARENT, D),
      map(O, S_OPT, D, { duration: 90, charges: '600000', extra: optionMarker(BigInt(P)) }),
      map(ORPHAN, S_ORPHAN, D, { extra: optionMarker(BigInt(BASE + 999)) }),
      map(Q, S_Q, D, { status: 0 }),
      map(QO, S_QOPT, D, { duration: 90, extra: optionMarker(BigInt(Q)) }),
      map(NOTE, S_NOTE, D, { extra: 'catatan admin: jangan dihapus' }),
      map(REMOVED, S_REMOVED, D, { duration: 120, status: 0, extra: removedMarker(BigInt(P)) }),
      map(P2, S_P2, D2, { isPublic: 0 }),
      map(O2, S_O2, D2, { duration: 90, extra: optionMarker(BigInt(P2)) }),
    ] as never,
  });
});

afterAll(wipe);

const ids = (rows: Array<{ mappingId?: bigint; id?: bigint }>) =>
  rows.map((r) => Number(r.mappingId ?? r.id)).sort((a, b) => a - b);

describe('listServicesForDoctor', () => {
  it('keeps a live option beside its parent and drops stranded ones', async () => {
    const rows = await listServicesForDoctor({ doctorId: BigInt(D) });

    // ORPHAN: parent does not exist. QO: parent inactive, so not in the result.
    expect(ids(rows)).toEqual([P, O, NOTE]);
    expect(rows.find((r) => Number(r.mappingId) === O)!.durationOf).toBe(BigInt(P));
    expect(rows.find((r) => Number(r.mappingId) === O)!.durationMinutes).toBe(90);
    expect(rows.find((r) => Number(r.mappingId) === NOTE)!.durationOf).toBeNull();
  });

  it('hides a public option whose parent is not public', async () => {
    expect(ids(await listServicesForDoctor({ doctorId: BigInt(D2), publicOnly: true }))).toEqual([]);
    expect(ids(await listServicesForDoctor({ doctorId: BigInt(D2) }))).toEqual([P2, O2]);
  });
});

describe('listClinicServices', () => {
  it('lists options flat with their marker, without stranded ones', async () => {
    const page = await listClinicServices({ page: 1, perPage: 100, doctorId: BigInt(D), includeInactive: true });

    // ORPHAN (no parent) and QO (active under an inactive parent) are hidden.
    expect(ids(page.items)).toEqual([P, O, Q, NOTE, REMOVED]);
    expect(page.items.find((r) => Number(r.id) === O)!.optionOf).toEqual({ parentId: BigInt(P), removed: false });
    expect(page.items.find((r) => Number(r.id) === REMOVED)!.optionOf).toEqual({ parentId: BigInt(P), removed: true });
    expect(page.items.find((r) => Number(r.id) === NOTE)!.optionOf).toBeNull();
  });

  it('checks the parent by id, so an option on a later page than its parent survives', async () => {
    // Active rows of D in id order: P, O, ORPHAN, QO, NOTE. Page 2 of size 1 is O alone.
    const page = await listClinicServices({ page: 2, perPage: 1, doctorId: BigInt(D) });
    expect(ids(page.items)).toEqual([O]);
  });
});

describe('listOptionRowsOf', () => {
  it('returns live and removed options of the given parents, shortest first', async () => {
    const rows = await listOptionRowsOf([BigInt(P)]);
    expect(rows.map((r) => Number(r.id))).toEqual([O, REMOVED]);
    expect(rows.map((r) => r.name)).toEqual(['Konseling Uji (90 menit)', 'Konseling Uji (120 menit)']);
  });

  it('returns nothing for no parents', async () => {
    expect(await listOptionRowsOf([])).toEqual([]);
  });
});

describe('findMappingById', () => {
  it('carries the marker', async () => {
    expect((await findMappingById(BigInt(O)))!.optionOf).toEqual({ parentId: BigInt(P), removed: false });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/repositories/wp-duration-options.repo.test.ts`
Expected: FAIL — `listOptionRowsOf` is not exported (import error).

- [ ] **Step 4: Implement in `services.repo.ts`**

1. Imports, at the top beside the existing ones:

```ts
import {
  ANY_OPTION_PROBE,
  parseDurationOf,
  readMarker,
  type OptionMarker,
} from './duration-option-marker';
```

2. In `type WpDoctorService`, after `nameAlias`, add:

```ts
  /**
   * The parent MAPPING id when this row is a live duration option of another service,
   * else null. See duration-option-marker.ts.
   */
  durationOf: bigint | null;
```

3. In `listServicesForDoctor`, add `extra: true,` to the `select` of the `kcServiceDoctorMapping.findMany` call. Then replace the final `return mappings.filter(...).map(...)` block with:

```ts
  const rows: WpDoctorService[] = mappings
    // A mapping can outlive its service if the service row was deleted directly in
    // the DB; skip those rather than emitting a nameless entry.
    .filter((m) => byId.has(m.serviceId.toString()))
    .map((m) => {
      const service = byId.get(m.serviceId.toString())!;
      return {
        mappingId: m.id,
        serviceId: m.serviceId,
        doctorId: m.doctorId,
        clinicId: m.clinicId,
        name: service.name,
        type: service.type,
        category: service.category,
        charges: m.charges,
        durationMinutes: m.duration ?? null,
        isPublic: m.isPublic === 1,
        isActive: m.status === STATUS_ACTIVE,
        telemedService: m.telemedService,
        nameAlias: m.serviceNameAlias,
        durationOf: parseDurationOf(m.extra),
      };
    });

  // An option is offered only beside its parent. The parent went through the same
  // filters (active, public, clinic); when it is not here, neither is the option — even
  // if some write path forgot to copy the parent's status onto it. This is what keeps a
  // stranded option unbookable: booking, slots and payment all read this function.
  const present = new Set(rows.map((r) => r.mappingId.toString()));
  return rows.filter((r) => r.durationOf === null || present.has(r.durationOf.toString()));
```

4. In `type ClinicServiceRow`, after `nameAlias`, add:

```ts
  /**
   * The duration-option marker: set for live AND removed options, null for an ordinary
   * service. Removed options keep it so reports can still name past bookings and the
   * dashboard can hide them under their parent.
   */
  optionOf: OptionMarker | null;
```

5. In `MAPPING_SELECT`, add `extra: true,` after `serviceNameAlias: true,`. In `type MappingRow`, add `extra: string | null;`. In `toClinicService`, add `optionOf: readMarker(m.extra),` as the last property.

6. Replace the `return { items: ..., total, page, perPage };` at the end of `listClinicServices` with:

```ts
  const items = mappings
    .filter((m) => byId.has(m.serviceId.toString()))
    .map((m) => toClinicService(m, byId.get(m.serviceId.toString())!));

  // `total` deliberately counts mappings, not survivors: it is the count the pagination
  // arithmetic is built on, and dropping orphans from it would make page sizes lie.
  return { items: await withoutStrandedOptions(items), total, page, perPage };
```

7. Add these two functions below `listClinicServices`:

```ts
/**
 * Drop options whose parent is gone, or whose parent is inactive while the option is
 * active. The parent is looked up by id, not searched for on this page: the list is
 * paginated and the parent may well sit on another page.
 */
async function withoutStrandedOptions(items: ClinicServiceRow[]): Promise<ClinicServiceRow[]> {
  const parentIds = [
    ...new Set(items.flatMap((i) => (i.optionOf ? [i.optionOf.parentId.toString()] : []))),
  ];
  if (parentIds.length === 0) return items;

  const parents = await prisma.kcServiceDoctorMapping.findMany({
    where: { id: { in: parentIds.map((id) => BigInt(id)) } },
    select: { id: true, status: true },
  });
  const parentActive = new Map(parents.map((p) => [p.id.toString(), p.status === STATUS_ACTIVE]));

  return items.filter((i) => {
    if (!i.optionOf) return true;
    const active = parentActive.get(i.optionOf.parentId.toString());
    if (active === undefined) return false;
    return active || !i.isActive;
  });
}

/**
 * Every duration option of these parents — live AND removed, any status — shortest first.
 *
 * Found by the marker, not by doctor: option rows are few, and one LIKE on `extra` covers
 * any mix of parents. `readMarker` then confirms each candidate.
 */
export async function listOptionRowsOf(parentIds: bigint[]): Promise<ClinicServiceRow[]> {
  if (parentIds.length === 0) return [];
  const wanted = new Set(parentIds.map((id) => id.toString()));

  const candidates = (await prisma.kcServiceDoctorMapping.findMany({
    where: ANY_OPTION_PROBE,
    select: MAPPING_SELECT,
    orderBy: [{ duration: 'asc' }, { id: 'asc' }],
  })) as MappingRow[];

  const mine = candidates.filter((m) => {
    const marker = readMarker(m.extra);
    return marker !== null && wanted.has(marker.parentId.toString());
  });
  const byId = await catalogueFor(mine);
  return mine
    .filter((m) => byId.has(m.serviceId.toString()))
    .map((m) => toClinicService(m, byId.get(m.serviceId.toString())!));
}
```

8. In `tests/public-booking/service-name-category.test.ts`, inside `function mapping(...)`, add `durationOf: null,` after `nameAlias: 'couplefamilysessionbahasaindonesia',`. In `tests/payments/public-catalog-payment.test.ts`, inside `function mapping(...)`, add `durationOf: null,` after `category: null,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/repositories/wp-duration-options.repo.test.ts tests/repositories/wp-catalog.repo.test.ts tests/services/service-catalog.repo.test.ts`
Expected: PASS. If a real-DB suite fails with `Can't reach database server`, start Docker Desktop and rerun. That error is not a code failure.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/wp/services.repo.ts tests/helpers/id-blocks.ts tests/repositories/wp-duration-options.repo.test.ts tests/public-booking/service-name-category.test.ts tests/payments/public-catalog-payment.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): baca penanda opsi durasi dan sembunyikan opsi yatim

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Status cascade on the psychologist write paths

**Files:**
- Modify: `src/repositories/wp/services.repo.ts` (`assignServiceToDoctor`, `unassignServiceFromDoctor`, `setDoctorServiceStatus`, plus two helpers)
- Test: `tests/repositories/wp-duration-options.repo.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `parseDurationOf`, `ANY_OPTION_PROBE` (Task 1).
- Produces: `findLiveOptionIds(parentIds: bigint[], db?: Prisma.TransactionClient): Promise<bigint[]>` (exported; Task 8 does not need it, but keep it exported for reuse).
- Behaviour:
  - `setDoctorServiceStatus` copies its status onto the live options of the parents it actually updated (same doctor);
  - `unassignServiceFromDoctor` sets the matched rows and their live options to 0, and still returns the number of parent rows changed;
  - `assignServiceToDoctor`'s reactivation branch sets live options back to 1;
  - removed options are never touched.

- [ ] **Step 1: Append the failing tests**

Append to `tests/repositories/wp-duration-options.repo.test.ts`. First add these imports to the existing import block from `@/repositories/wp/services.repo`: `assignServiceToDoctor`, `setDoctorServiceStatus`, `unassignServiceFromDoctor`.

```ts
describe('status follows the parent on the psychologist write paths', () => {
  const D3 = BASE + 502;
  const S_P3 = BASE + 10;
  const S_O3 = BASE + 11;
  const S_R3 = BASE + 12;
  const P3 = BASE + 110;
  const O3 = BASE + 111;
  const R3 = BASE + 112; // removed option of P3 — must never come back to life

  const statusOf = async (id: number) =>
    (await prisma.kcServiceDoctorMapping.findUnique({ where: { id: BigInt(id) }, select: { status: true } }))!.status;

  beforeAll(async () => {
    await prisma.kcService.createMany({
      data: [svc(S_P3, 'Kaskade Uji'), svc(S_O3, 'Kaskade Uji (90 menit)'), svc(S_R3, 'Kaskade Uji (45 menit)')] as never,
    });
    await prisma.kcServiceDoctorMapping.createMany({
      data: [
        map(P3, S_P3, D3),
        map(O3, S_O3, D3, { duration: 90, extra: optionMarker(BigInt(P3)) }),
        map(R3, S_R3, D3, { duration: 45, status: 0, extra: removedMarker(BigInt(P3)) }),
      ] as never,
    });
  });

  it('bulk status flips the option with its parent', async () => {
    await setDoctorServiceStatus({ mappingIds: [BigInt(P3)], doctorId: BigInt(D3), status: 0 });
    expect([await statusOf(P3), await statusOf(O3)]).toEqual([0, 0]);

    await setDoctorServiceStatus({ mappingIds: [BigInt(P3)], doctorId: BigInt(D3), status: 1 });
    expect([await statusOf(P3), await statusOf(O3), await statusOf(R3)]).toEqual([1, 1, 0]);
  });

  it('bulk status for a mapping of another doctor touches neither it nor its options', async () => {
    await setDoctorServiceStatus({ mappingIds: [BigInt(P3)], doctorId: BigInt(D), status: 0 });
    expect([await statusOf(P3), await statusOf(O3)]).toEqual([1, 1]);
  });

  it('unassign retires the option too, and counts only the parent', async () => {
    const affected = await unassignServiceFromDoctor({ doctorId: BigInt(D3), serviceId: BigInt(S_P3) });
    expect(affected).toBe(1);
    expect([await statusOf(P3), await statusOf(O3)]).toEqual([0, 0]);
  });

  it('re-assigning revives the live option but not the removed one', async () => {
    await assignServiceToDoctor({ doctorId: BigInt(D3), serviceId: BigInt(S_P3), clinicId: BigInt(C) });
    expect([await statusOf(P3), await statusOf(O3), await statusOf(R3)]).toEqual([1, 1, 0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/repositories/wp-duration-options.repo.test.ts`
Expected: FAIL — the first new test sees `O3` still `1` after setting the parent to 0.

- [ ] **Step 3: Implement**

In `src/repositories/wp/services.repo.ts`:

1. Add `import type { Prisma } from '@prisma/client';` to the imports.

2. Add these helpers above the `/* Writes — doctor↔service assignments */` banner:

```ts
/** Ids of the LIVE duration options of these parents, any status. */
export async function findLiveOptionIds(
  parentIds: bigint[],
  db: Prisma.TransactionClient = prisma,
): Promise<bigint[]> {
  if (parentIds.length === 0) return [];
  const wanted = new Set(parentIds.map((id) => id.toString()));
  const rows = await db.kcServiceDoctorMapping.findMany({
    where: ANY_OPTION_PROBE,
    select: { id: true, extra: true },
  });
  return rows
    .filter((r) => {
      const parent = parseDurationOf(r.extra);
      return parent !== null && wanted.has(parent.toString());
    })
    .map((r) => r.id);
}

/**
 * Options follow their parent's status. Removed options carry the `_removed` key and are
 * not "live", so they are never revived here.
 */
async function cascadeStatusToOptions(parentIds: bigint[], status: 0 | 1): Promise<void> {
  const ids = await findLiveOptionIds(parentIds);
  if (ids.length === 0) return;
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    status,
    ...ids,
  );
}
```

3. In `assignServiceToDoctor`, inside `if (existing) { ... }`, insert this line between the `await prisma.$executeRawUnsafe(...)` and `return existing.id;`:

```ts
    await cascadeStatusToOptions([existing.id], 1);
```

4. Replace the body of `unassignServiceFromDoctor` (keep its doc comment and signature) with:

```ts
  const where: string[] = ['doctor_id = ?', 'service_id = ?', 'status = 1'];
  const args: unknown[] = [opts.doctorId, opts.serviceId];
  if (opts.clinicId !== undefined) {
    where.push('clinic_id = ?');
    args.push(opts.clinicId);
  }

  // Select first: the options to retire are found by their parents' ids.
  const targets = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT id FROM wp_kc_service_doctor_mapping WHERE ${where.join(' AND ')}`,
    ...args,
  );
  if (targets.length === 0) return 0;
  const ids = targets.map((t) => BigInt(t.id));

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  await cascadeStatusToOptions(ids, 0);
  return affected;
```

5. Replace the body of `setDoctorServiceStatus` (keep its signature) with:

```ts
  if (opts.mappingIds.length === 0) return 0;

  // doctor_id is in the WHERE so one professional cannot flip another's assignments.
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = ?
      WHERE doctor_id = ? AND id IN (${opts.mappingIds.map(() => '?').join(',')})`,
    opts.status,
    opts.doctorId,
    ...opts.mappingIds,
  );

  // Only the parents that really are this doctor's: ids belonging to someone else were
  // not updated above, so their options must not be either.
  const owned = await prisma.kcServiceDoctorMapping.findMany({
    where: { id: { in: opts.mappingIds }, doctorId: opts.doctorId },
    select: { id: true },
  });
  await cascadeStatusToOptions(owned.map((o) => o.id), opts.status);
  return affected;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/repositories/wp-duration-options.repo.test.ts tests/services tests/unit`
Expected: PASS. If a unit test that mocks `prisma` for `unassignServiceFromDoctor` breaks because of the new `SELECT`, update its mock: `$queryRawUnsafe` must resolve the ids first. Paste the failing test name into the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/services.repo.ts tests/repositories/wp-duration-options.repo.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): status opsi durasi ikut induk di jalur psikolog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Option planner and name builder (pure)

**Files:**
- Create: `src/services/service-catalog/duration-options.ts`
- Test: `tests/services/service-catalog.duration-options.test.ts`

**Interfaces:**
- Produces:
  - `MAX_DURATION_OPTIONS = 4`;
  - `optionName(parentName: string, minutes: number): string`;
  - `type ExistingOption = { mappingId: bigint; serviceId: bigint; durationMinutes: number | null; charges: string | null }`;
  - `type WantedOption = { id?: number; duration: number; charges: string }`;
  - `type OptionPlan = { create: Array<{ duration: number; charges: string }>; keep: Array<{ existing: ExistingOption; duration: number; charges: string }>; remove: ExistingOption[] }`;
  - `type OptionPlanError = { code: 'duration_option_limit' | 'duration_option_duplicate' | 'duration_option_not_found'; message: string }`;
  - `planDurationOptions(existing: ExistingOption[], wanted: WantedOption[], parentDuration: number | null): { plan: OptionPlan } | { error: OptionPlanError }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/services/service-catalog.duration-options.test.ts
import { describe, it, expect } from 'vitest';
import {
  MAX_DURATION_OPTIONS,
  optionName,
  planDurationOptions,
  type ExistingOption,
} from '@/services/service-catalog/duration-options';

const opt = (mappingId: number, durationMinutes: number, charges = '600000'): ExistingOption => ({
  mappingId: BigInt(mappingId), serviceId: BigInt(mappingId + 1000), durationMinutes, charges,
});

describe('optionName', () => {
  it('appends the duration in minutes', () => {
    expect(optionName('Konseling Individu', 90)).toBe('Konseling Individu (90 menit)');
  });

  it('cuts the parent part, never the suffix, to stay within 255 characters', () => {
    const name = optionName('x'.repeat(300), 120);
    expect(name.length).toBe(255);
    expect(name.endsWith(' (120 menit)')).toBe(true);
  });
});

describe('planDurationOptions', () => {
  it('splits the wanted list into create, keep and remove', () => {
    const existing = [opt(11, 90), opt(12, 120)];
    const res = planDurationOptions(existing, [
      { id: 11, duration: 90, charges: '650000' },
      { duration: 150, charges: '900000' },
    ], 60);

    expect(res).toEqual({
      plan: {
        create: [{ duration: 150, charges: '900000' }],
        keep: [{ existing: existing[0], duration: 90, charges: '650000' }],
        remove: [existing[1]],
      },
    });
  });

  it('an empty wanted list removes every option', () => {
    const existing = [opt(11, 90)];
    expect(planDurationOptions(existing, [], 60)).toEqual({ plan: { create: [], keep: [], remove: existing } });
  });

  it(`refuses more than ${MAX_DURATION_OPTIONS} options`, () => {
    const wanted = [30, 45, 90, 120, 150].map((d) => ({ duration: d, charges: '1' }));
    expect(planDurationOptions([], wanted, 60)).toMatchObject({ error: { code: 'duration_option_limit' } });
  });

  it('refuses a duration equal to the parent duration', () => {
    expect(planDurationOptions([], [{ duration: 60, charges: '1' }], 60))
      .toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses two options with the same duration', () => {
    expect(planDurationOptions([], [{ duration: 90, charges: '1' }, { duration: 90, charges: '2' }], 60))
      .toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses the same option id twice', () => {
    expect(planDurationOptions([opt(11, 90)], [
      { id: 11, duration: 90, charges: '1' },
      { id: 11, duration: 120, charges: '1' },
    ], 60)).toMatchObject({ error: { code: 'duration_option_duplicate' } });
  });

  it('refuses an id that is not an option of this service', () => {
    expect(planDurationOptions([opt(11, 90)], [{ id: 99, duration: 90, charges: '1' }], 60))
      .toMatchObject({ error: { code: 'duration_option_not_found' } });
  });

  it('with no parent duration only checks the options against each other', () => {
    expect(planDurationOptions([], [{ duration: 60, charges: '1' }], null)).toHaveProperty('plan');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/service-catalog.duration-options.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/services/service-catalog/duration-options.ts
/**
 * Duration options — one service offered at several lengths, each with its own price.
 *
 * Each option is its own catalogue row + mapping, because an appointment records only the
 * catalogue id: 60′ and 90′ must differ there. The option is tied to its parent by the
 * marker in `extra` (repositories/wp/duration-option-marker.ts).
 *
 * Pure: these rules decide; service.ts reads and writes.
 * Spec: docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md
 */

/** Extra durations beside the service's own — five lengths in all. */
export const MAX_DURATION_OPTIONS = 4;

const NAME_MAX = 255;

/**
 * `Konseling Individu (90 menit)`. The name lands in emails, invoices, Google Calendar and
 * WP admin, so it always states the length. Over 255 characters the parent's part is cut,
 * never the suffix.
 */
export function optionName(parentName: string, minutes: number): string {
  const suffix = ` (${minutes} menit)`;
  const room = NAME_MAX - suffix.length;
  const base = parentName.length > room ? parentName.slice(0, room).trimEnd() : parentName;
  return `${base}${suffix}`;
}

export type ExistingOption = {
  mappingId: bigint;
  serviceId: bigint;
  durationMinutes: number | null;
  charges: string | null;
};

/** One wanted option. `id` names an existing option's mapping; absent means a new one. */
export type WantedOption = { id?: number; duration: number; charges: string };

export type OptionPlan = {
  create: Array<{ duration: number; charges: string }>;
  keep: Array<{ existing: ExistingOption; duration: number; charges: string }>;
  remove: ExistingOption[];
};

export type OptionPlanError = {
  code: 'duration_option_limit' | 'duration_option_duplicate' | 'duration_option_not_found';
  message: string;
};

/**
 * Diff the wanted list against what exists. The wanted list is complete: an existing
 * option it does not mention is removed.
 */
export function planDurationOptions(
  existing: ExistingOption[],
  wanted: WantedOption[],
  parentDuration: number | null,
): { plan: OptionPlan } | { error: OptionPlanError } {
  if (wanted.length > MAX_DURATION_OPTIONS) {
    return {
      error: {
        code: 'duration_option_limit',
        message: `A service can have at most ${MAX_DURATION_OPTIONS} extra durations`,
      },
    };
  }

  const byId = new Map(existing.map((o) => [o.mappingId.toString(), o]));
  const seen = new Set<string>();
  for (const w of wanted) {
    if (w.id === undefined) continue;
    const key = String(w.id);
    if (!byId.has(key)) {
      return {
        error: { code: 'duration_option_not_found', message: `Duration option ${w.id} does not belong to this service` },
      };
    }
    if (seen.has(key)) {
      return { error: { code: 'duration_option_duplicate', message: `Duration option ${w.id} is listed twice` } };
    }
    seen.add(key);
  }

  const durations = wanted.map((w) => w.duration);
  if (parentDuration !== null) durations.push(parentDuration);
  if (new Set(durations).size !== durations.length) {
    return {
      error: {
        code: 'duration_option_duplicate',
        message: "Each duration may appear only once, the service's own duration included",
      },
    };
  }

  return {
    plan: {
      create: wanted.filter((w) => w.id === undefined).map((w) => ({ duration: w.duration, charges: w.charges })),
      keep: wanted
        .filter((w) => w.id !== undefined)
        .map((w) => ({ existing: byId.get(String(w.id))!, duration: w.duration, charges: w.charges })),
      remove: existing.filter((o) => !seen.has(o.mappingId.toString())),
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.duration-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/duration-options.ts tests/services/service-catalog.duration-options.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): perencana opsi durasi dan pembentuk nama opsi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Request and response schemas

**Files:**
- Modify: `src/services/service-catalog/validation.ts`
- Test: `tests/services/service-catalog.validation.test.ts` (append)

**Interfaces:**
- Produces:
  - `durationOptionInputSchema` (`{ id?: positive int; duration: 1..1440 int; price: >= 0 }`);
  - `updateServiceSchema.durationOptions?: Array<...>`;
  - `durationOptionSummarySchema` (`{ id, serviceId, name, durationMinutes, price, isActive }`);
  - `serviceSummarySchema` gains `durationOf` and `durationOptions`;
  - `UpdateServiceInput['durationOptions']` type.

- [ ] **Step 1: Append the failing tests**

Append to `tests/services/service-catalog.validation.test.ts`. If `updateServiceSchema` is not already imported there, add it to the import from `@/services/service-catalog/validation`.

```ts
describe('updateServiceSchema.durationOptions', () => {
  it('accepts new and existing options', () => {
    const r = updateServiceSchema.safeParse({
      durationOptions: [{ duration: 90, price: 600000 }, { id: 12, duration: 120, price: 800000 }],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.durationOptions).toEqual([
      { duration: 90, price: 600000 },
      { id: 12, duration: 120, price: 800000 },
    ]);
  });

  it('an empty list is a valid update on its own: it removes every option', () => {
    expect(updateServiceSchema.safeParse({ durationOptions: [] }).success).toBe(true);
  });

  it('applies the service duration bounds to each option', () => {
    const r = updateServiceSchema.safeParse({ durationOptions: [{ duration: 0, price: 1 }] });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].path).toEqual(['durationOptions', 0, 'duration']);
  });

  it('refuses a negative price', () => {
    expect(updateServiceSchema.safeParse({ durationOptions: [{ duration: 90, price: -1 }] }).success).toBe(false);
  });

  it('drops unknown keys inside an option instead of storing them', () => {
    const r = updateServiceSchema.safeParse({ durationOptions: [{ duration: 90, price: 1, name: 'x' }] });
    expect(r.success && r.data.durationOptions).toEqual([{ duration: 90, price: 1 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/service-catalog.validation.test.ts`
Expected: FAIL — `durationOptions` is stripped (`undefined`).

- [ ] **Step 3: Implement**

In `src/services/service-catalog/validation.ts`:

1. After the `idSchema` line, add:

```ts
/**
 * One duration option in a PUT. Same bounds as the service's own duration and price.
 * `id` is the option's mapping id; absent means "create".
 */
export const durationOptionInputSchema = z.object({
  id: idSchema.optional(),
  duration: durationSchema,
  price: priceSchema,
});
```

2. In `updateServiceSchema`'s object, after `isPublic: flag.optional(),`, add:

```ts
    /**
     * The complete list of extra durations. Absent: options untouched. Present: rows
     * without `id` are created, rows with `id` updated, and options not listed removed.
     */
    durationOptions: z.array(durationOptionInputSchema).optional(),
```

3. Before `export const serviceSummarySchema`, add:

```ts
export const durationOptionSummarySchema = z.object({
  id: z.number().int().describe("The option's own mapping id"),
  serviceId: z.number().int().describe("The option's catalogue row id — what booking sends"),
  name: z.string(),
  durationMinutes: z.number().int().nullable(),
  price: z.number().nullable(),
  isActive: z.boolean(),
});
```

4. In `serviceSummarySchema`, after `isActive: z.boolean(),`, add:

```ts
  durationOf: z
    .number()
    .int()
    .nullable()
    .describe('Parent mapping id when this row is a duration option (live or removed) of another service'),
  durationOptions: z
    .array(durationOptionSummarySchema)
    .describe("This service's live duration options, shortest first. Empty for an option row."),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/validation.ts tests/services/service-catalog.validation.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): skema durationOptions di PUT dan respons layanan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write primitives — conflict exclusions and the one-transaction save

**Files:**
- Modify: `src/repositories/wp/services.write.ts`
- Test: `tests/services/service-catalog.write.test.ts` (append)

**Interfaces:**
- Consumes: `optionMarker`, `removedMarker` (Task 1).
- Produces:
  - `findConflictingMapping({ ..., excludeMappingIds?: bigint[] })`;
  - `updateMappingOn(db: Prisma.TransactionClient, id: bigint, patch: MappingPatch): Promise<void>`;
  - `type OptionInsert = { parentMappingId, serviceId, doctorId, clinicId: bigint; charges: string; duration: number; telemedService: 'yes' | 'no'; status: 0 | 1; isPublic: 0 | 1 }`;
  - `type ServiceUpdateWrites = { parent: { mappingId: bigint; patch: MappingPatch }; optionUpdates: Array<{ mappingId: bigint; patch: MappingPatch }>; optionInserts: OptionInsert[]; optionRemovals: Array<{ mappingId: bigint; parentMappingId: bigint }> }`;
  - `saveServiceUpdate(w: ServiceUpdateWrites): Promise<void>` — one transaction, in this order: parent, removals, updates, inserts. Returns without a transaction when there is nothing to write.

- [ ] **Step 1: Append the failing tests**

Append to `tests/services/service-catalog.write.test.ts`. Add `saveServiceUpdate` to the import list from `@/repositories/wp/services.write`. The file already defines the `db` mock and `expectPlaceholdersMatchArgs`.

```ts
describe('findConflictingMapping — excludeMappingIds', () => {
  it('excludes every listed mapping, after the single exclusion', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);

    await findConflictingMapping({
      doctorIds: [8100001n],
      clinicId: 3n,
      name: 'Konseling (90 menit)',
      excludeMappingId: 501n,
      excludeMappingIds: [601n, 602n],
    });

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('sdm.id <> ?');
    expect(sql).toContain('sdm.id NOT IN (?,?)');
    expect(args).toEqual([3n, 'Konseling (90 menit)', 8100001n, 501n, 601n, 602n]);
    expectPlaceholdersMatchArgs(sql, args);
  });
});

describe('saveServiceUpdate', () => {
  beforeEach(() => {
    db.$executeRawUnsafe.mockReset();
    db.$transaction.mockClear();
    db.$executeRawUnsafe.mockResolvedValue(1);
  });

  it('writes parent, removals, updates and inserts in that order, in one transaction', async () => {
    await saveServiceUpdate({
      parent: { mappingId: 501n, patch: { charges: '450000' } },
      optionRemovals: [{ mappingId: 602n, parentMappingId: 501n }],
      optionUpdates: [{ mappingId: 601n, patch: { duration: 120 } }],
      optionInserts: [{
        parentMappingId: 501n, serviceId: 909n, doctorId: 8100001n, clinicId: 3n,
        charges: '900000', duration: 150, telemedService: 'no', status: 1, isPublic: 1,
      }],
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const calls = db.$executeRawUnsafe.mock.calls;
    expect(calls).toHaveLength(4);

    expect(calls[0][0]).toContain('charges = ?');
    expect(calls[0].slice(1)).toEqual(['450000', 501n]);

    expect(calls[1][0]).toContain('SET status = 0, extra = ?');
    expect(calls[1].slice(1)).toEqual(['{"praktiqu_duration_of_removed":501}', 602n]);

    expect(calls[2][0]).toContain('duration = ?');
    expect(calls[2].slice(1)).toEqual([120, 601n]);

    expect(calls[3][0]).toContain('INSERT INTO wp_kc_service_doctor_mapping');
    expect(calls[3].slice(1)).toEqual([909n, 8100001n, 3n, '900000', 150, 'no', 1, 1, '{"praktiqu_duration_of":501}']);
    for (const [sql, ...args] of calls) expectPlaceholdersMatchArgs(sql, args);
  });

  it('opens no transaction when there is nothing to write', async () => {
    await saveServiceUpdate({ parent: { mappingId: 501n, patch: {} }, optionUpdates: [], optionInserts: [], optionRemovals: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/service-catalog.write.test.ts`
Expected: FAIL — `saveServiceUpdate` is not a function, and the exclusion SQL is missing.

- [ ] **Step 3: Implement**

In `src/repositories/wp/services.write.ts`:

1. Add the import: `import { optionMarker, removedMarker } from './duration-option-marker';`

2. In `findConflictingMapping`, extend the options type with `excludeMappingIds?: bigint[];` and replace the lines from `const placeholders = ...` through the `args.push(opts.excludeMappingId)` line with:

```ts
  const placeholders = opts.doctorIds.map(() => '?').join(',');
  const exclude = opts.excludeMappingId !== undefined ? ' AND sdm.id <> ?' : '';
  const many = opts.excludeMappingIds ?? [];
  const excludeMany = many.length > 0 ? ` AND sdm.id NOT IN (${many.map(() => '?').join(',')})` : '';
  const args: unknown[] = [opts.clinicId, opts.name, ...opts.doctorIds];
  if (opts.excludeMappingId !== undefined) args.push(opts.excludeMappingId);
  args.push(...many);
```

   Then change the SQL line `AND sdm.doctor_id IN (${placeholders})${exclude}` to `AND sdm.doctor_id IN (${placeholders})${exclude}${excludeMany}`.

3. Replace `export async function updateMapping(...) { ... }` with:

```ts
/** `updateMapping` on whatever connection `db` is — the pool, or a transaction. */
export async function updateMappingOn(
  db: Prisma.TransactionClient,
  id: bigint,
  patch: MappingPatch,
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];

  for (const [key, column] of PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(value);
  }

  // An empty patch must not become `SET  WHERE id = ?`, which is a syntax error.
  if (sets.length === 0) return;

  args.push(id);
  await db.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET ${sets.join(', ')} WHERE id = ?`,
    ...args,
  );
}

export async function updateMapping(id: bigint, patch: MappingPatch): Promise<void> {
  await updateMappingOn(prisma, id, patch);
}

export type OptionInsert = {
  parentMappingId: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  charges: string;
  duration: number;
  telemedService: 'yes' | 'no';
  status: 0 | 1;
  isPublic: 0 | 1;
};

export type ServiceUpdateWrites = {
  parent: { mappingId: bigint; patch: MappingPatch };
  optionUpdates: Array<{ mappingId: bigint; patch: MappingPatch }>;
  optionInserts: OptionInsert[];
  optionRemovals: Array<{ mappingId: bigint; parentMappingId: bigint }>;
};

/**
 * Every mapping write of one service edit, in one transaction: the parent's own columns,
 * then option removals, option updates, and new options. A failure halfway leaves the
 * service as it was rather than with half its options.
 *
 * Catalogue rows are resolved before this runs (a catalogue row without a mapping is
 * invisible and harmless). New options need no LAST_INSERT_ID, so nothing here depends
 * on connection pinning beyond the transaction itself.
 */
export async function saveServiceUpdate(w: ServiceUpdateWrites): Promise<void> {
  const nothing =
    Object.keys(w.parent.patch).length === 0 &&
    w.optionUpdates.length === 0 &&
    w.optionInserts.length === 0 &&
    w.optionRemovals.length === 0;
  if (nothing) return;

  await prisma.$transaction(async (tx) => {
    await updateMappingOn(tx, w.parent.mappingId, w.parent.patch);

    // Removed before anything is added: a re-added duration then never sits beside its
    // removed twin as two live rows, not even inside the transaction.
    for (const r of w.optionRemovals) {
      await tx.$executeRawUnsafe(
        `UPDATE wp_kc_service_doctor_mapping SET status = 0, extra = ? WHERE id = ?`,
        removedMarker(r.parentMappingId),
        r.mappingId,
      );
    }

    for (const u of w.optionUpdates) {
      await updateMappingOn(tx, u.mappingId, u.patch);
    }

    for (const i of w.optionInserts) {
      await tx.$executeRawUnsafe(
        `INSERT INTO wp_kc_service_doctor_mapping
           (service_id, doctor_id, clinic_id, charges, duration, telemed_service, status, is_public, extra, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        i.serviceId,
        i.doctorId,
        i.clinicId,
        i.charges,
        i.duration,
        i.telemedService,
        i.status,
        i.isPublic,
        optionMarker(i.parentMappingId),
      );
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/services/service-catalog.write.test.ts`
Expected: PASS, including the pre-existing `findConflictingMapping`, `insertMapping` and `updateMapping` tests.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/services.write.ts tests/services/service-catalog.write.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): simpan induk dan opsi durasi dalam satu transaksi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Read API — `durationOf` and `durationOptions` in every summary; `durationOf` in the public list

**Files:**
- Modify: `src/services/service-catalog/service.ts` (`ServiceSummary`, `toSummary`, `listServices`, `getService`)
- Modify: `src/services/public/public-catalog.service.ts` (`PublicService`, `getPublicProfessionalServices`)
- Modify: `tests/services/service-catalog.read.test.ts`, `tests/services/service-catalog.update.test.ts`, `tests/services/service-catalog.delete.test.ts` (add the `listOptionRowsOf` mock only)
- Modify: `tests/payments/public-catalog-payment.test.ts:178-200` (add `durationOf: null` to the three expected rows)
- Test: `tests/services/service-catalog.read.test.ts` (append), `tests/public-booking/duration-of.test.ts` (new)

**Interfaces:**
- Consumes: `listOptionRowsOf`, `ClinicServiceRow.optionOf` (Task 2); `WpDoctorService.durationOf` (Task 2).
- Produces:
  - `type DurationOptionSummary = { id: number; serviceId: number; name: string; durationMinutes: number | null; price: number | null; isActive: boolean }`;
  - `ServiceSummary.durationOf: number | null`, `ServiceSummary.durationOptions: DurationOptionSummary[]`;
  - internal `toSummary(row: ClinicServiceRow, options?: ClinicServiceRow[]): ServiceSummary`;
  - internal `liveOptionsOf(parentId: bigint): Promise<ClinicServiceRow[]>`;
  - `PublicService.durationOf: number | null`.

- [ ] **Step 1: Add the repo mock to the three service-catalog unit test files**

In each of `tests/services/service-catalog.read.test.ts`, `service-catalog.update.test.ts` and `service-catalog.delete.test.ts`:
- add `listOptionRowsOf: vi.fn(),` to the object inside `const repo = vi.hoisted(() => ({ ... }))`;
- add these two lines to the existing `beforeEach`, after the existing `repo.findMappingById.mockReset();`:

```ts
  repo.listOptionRowsOf.mockReset();
  repo.listOptionRowsOf.mockResolvedValue([]);
```

- [ ] **Step 2: Append the failing read tests**

Append to `tests/services/service-catalog.read.test.ts`:

```ts
describe('duration options in summaries', () => {
  const option = {
    ...row, id: 601n, serviceId: 201n, name: 'Konseling Individu (90 menit)', charges: '600000',
    durationMinutes: 90, optionOf: { parentId: 501n, removed: false },
  };
  const removed = {
    ...row, id: 602n, serviceId: 202n, name: 'Konseling Individu (120 menit)', charges: '800000',
    durationMinutes: 120, isActive: false, optionOf: { parentId: 501n, removed: true },
  };

  it('lists an option flat, pointing at its parent, and the parent carries its live options', async () => {
    repo.listClinicServices.mockResolvedValue({ items: [{ ...row, optionOf: null }, option], total: 2, page: 1, perPage: 20 });
    repo.listOptionRowsOf.mockResolvedValue([option, removed]);

    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);

    expect(repo.listOptionRowsOf).toHaveBeenCalledWith([501n]);
    expect(res.services[0].durationOf).toBeNull();
    expect(res.services[0].durationOptions).toEqual([
      { id: 601, serviceId: 201, name: 'Konseling Individu (90 menit)', durationMinutes: 90, price: 600000, isActive: true },
    ]);
    expect(res.services[1].durationOf).toBe(501);
    expect(res.services[1].durationOptions).toEqual([]);
  });

  it('getService on an option reports its parent and no options of its own', async () => {
    repo.findMappingById.mockResolvedValue(option);

    const svc = await getService(601, superAdmin);

    expect(svc!.durationOf).toBe(501);
    expect(svc!.durationOptions).toEqual([]);
    expect(repo.listOptionRowsOf).not.toHaveBeenCalled();
  });

  it('a removed option still reports its parent', async () => {
    repo.findMappingById.mockResolvedValue(removed);
    expect((await getService(602, superAdmin))!.durationOf).toBe(501);
  });
});
```

- [ ] **Step 3: Write the failing public test**

```ts
// tests/public-booking/duration-of.test.ts
/**
 * Public services name each duration option's parent by the parent's PUBLIC id (the
 * catalogue id the booking page sends), not by its mapping id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/services.repo')>()),
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/static-data.repo')>()),
  listStaticData: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
// Same as tests/public-booking/service-name-category.test.ts: keeps the payment modules
// behind the catalogue from reaching a real logger.
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor, type WpDoctorService } from '@/repositories/wp/services.repo';
import { listStaticData } from '@/repositories/wp/static-data.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational } from '@/services/payments/intl-pricing';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';

const DOCTOR = 34;

function mapping(over: Partial<WpDoctorService>): WpDoctorService {
  return {
    mappingId: 501n, serviceId: 101n, doctorId: BigInt(DOCTOR), clinicId: 4n,
    name: 'Konseling Individu', type: 'konseling', category: null, charges: '425000',
    durationMinutes: 60, isPublic: true, isActive: true, telemedService: null, nameAlias: null,
    durationOf: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'ACTIVE' } as never);
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(
    async (ids: number[]) => new Map(ids.map((id) => [id, notInternational(id)])),
  );
  vi.mocked(listStaticData).mockResolvedValue([]);
});

describe('PublicService.durationOf', () => {
  it("is null for a parent and the parent's catalogue id for its option", async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping({}),
      mapping({ mappingId: 601n, serviceId: 201n, name: 'Konseling Individu (90 menit)', charges: '600000', durationMinutes: 90, durationOf: 501n }),
    ]);

    const rows = (await getPublicProfessionalServices(DOCTOR))!;

    expect(rows.map((r) => [r.id, r.durationOf])).toEqual([[101, null], [201, 101]]);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/services/service-catalog.read.test.ts tests/public-booking/duration-of.test.ts`
Expected: FAIL — `durationOptions` / `durationOf` are undefined.

- [ ] **Step 5: Implement in `service.ts`**

1. Change the repo import to:

```ts
import {
  listClinicServices,
  findMappingById,
  listOptionRowsOf,
  type ClinicServiceRow,
} from '@/repositories/wp/services.repo';
```

2. Add before `export type ServiceSummary`:

```ts
export type DurationOptionSummary = {
  /** The option's own mapping id. */
  id: number;
  /** The option's catalogue id — what a booking sends. */
  serviceId: number;
  name: string;
  durationMinutes: number | null;
  price: number | null;
  isActive: boolean;
};
```

3. In `type ServiceSummary`, after `isActive: boolean;`, add:

```ts
  /** Parent mapping id when this row is a duration option (live or removed), else null. */
  durationOf: number | null;
  /** This service's live duration options, shortest first. Empty for an option row. */
  durationOptions: DurationOptionSummary[];
```

4. Replace `function toSummary(row: ClinicServiceRow): ServiceSummary { ... }` with:

```ts
function toOptionSummary(o: ClinicServiceRow): DurationOptionSummary {
  return {
    id: Number(o.id),
    serviceId: Number(o.serviceId),
    name: o.name,
    durationMinutes: o.durationMinutes,
    price: parsePrice(o.charges),
    isActive: o.isActive,
  };
}

/** `options`: this row's option rows, live or removed; only live ones are reported. */
function toSummary(row: ClinicServiceRow, options: ClinicServiceRow[] = []): ServiceSummary {
  return {
    id: Number(row.id),
    serviceId: Number(row.serviceId),
    doctorId: Number(row.doctorId),
    clinicId: Number(row.clinicId),
    name: row.name,
    category: parseServiceCategory(row.category),
    price: parsePrice(row.charges),
    durationMinutes: row.durationMinutes,
    telemedService: row.telemedService === 'yes' ? 'yes' : 'no',
    isPublic: row.isPublic,
    isActive: row.isActive,
    durationOf: row.optionOf ? Number(row.optionOf.parentId) : null,
    durationOptions: options.filter((o) => o.optionOf && !o.optionOf.removed).map(toOptionSummary),
  };
}

/** The LIVE option rows of one parent, shortest first. */
async function liveOptionsOf(parentId: bigint): Promise<ClinicServiceRow[]> {
  return (await listOptionRowsOf([parentId])).filter((o) => o.optionOf && !o.optionOf.removed);
}
```

5. In `listServices`, replace the final `return { services: page.items.map(toSummary), ... }` with:

```ts
  // Options of this page's parents, fetched by parent id — not assembled from this page,
  // where an option may be missing because it fell on another page.
  const parentIds = page.items.filter((r) => !r.optionOf).map((r) => r.id);
  const optionRows = await listOptionRowsOf(parentIds);
  const byParent = new Map<string, ClinicServiceRow[]>();
  for (const o of optionRows) {
    const key = o.optionOf!.parentId.toString();
    byParent.set(key, [...(byParent.get(key) ?? []), o]);
  }

  return {
    services: page.items.map((r) => toSummary(r, r.optionOf ? [] : byParent.get(r.id.toString()) ?? [])),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
  };
```

6. In `getService`, replace `return toSummary(row);` with:

```ts
  return toSummary(row, row.optionOf ? [] : await listOptionRowsOf([row.id]));
```

7. In `updateService`, replace the final `return toSummary(refreshed);` with `return toSummary(refreshed, await liveOptionsOf(refreshed.id));`. Task 8 rewrites this function; the line keeps it compiling now.

- [ ] **Step 6: Implement in `public-catalog.service.ts`**

1. In `interface PublicService`, after `usd: PublicUsdView | null;`, add:

```ts
  /**
   * When this row is a duration option of another service: that parent's public `id` (its
   * catalogue id), in this same list and at this same clinic. The booking page shows one
   * card per parent and the options as durations to choose from. null for every other row.
   */
  durationOf: number | null;
```

2. In `getPublicProfessionalServices`, right after `const categoryOf = await serviceCategoryLabeller(rows);`, add:

```ts
  // An option names its parent by MAPPING id; the public id is the catalogue id.
  // listServicesForDoctor never returns an option without its parent.
  const publicIdByMapping = new Map(rows.map((r) => [r.mappingId.toString(), Number(r.serviceId)]));
```

3. In the `services.push({ ... })` object, after `usd,`, add:

```ts
      durationOf: s.durationOf ? publicIdByMapping.get(s.durationOf.toString()) ?? null : null,
```

4. In `tests/payments/public-catalog-payment.test.ts`, in the `expect(rows).toEqual([...])` block (around line 178), add `durationOf: null,` after the `clinicId: ...,` line of each of the three expected objects.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/services tests/public-booking tests/payments tests/unit/public`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/service-catalog/service.ts src/services/public/public-catalog.service.ts tests/services tests/public-booking/duration-of.test.ts tests/payments/public-catalog-payment.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): durationOf dan durationOptions di respons layanan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `updateService` and `deleteService` manage options; route maps 422

**Files:**
- Modify: `src/services/service-catalog/service.ts` (`ServiceCatalogError`, `updateService`, `deleteService`)
- Modify: `src/app/api/v1/services/[id]/route.ts` (`toErrorResponse`)
- Modify: `tests/services/service-catalog.update.test.ts` (rewrite the assertions on `updateMapping`, then append new tests)
- Modify: `tests/services/service-catalog.delete.test.ts` (append)

**Interfaces:**
- Consumes:
  - `planDurationOptions`, `optionName`, `ExistingOption`, `WantedOption` (Task 4);
  - `saveServiceUpdate`, `OptionInsert`, `findConflictingMapping({ excludeMappingIds })` (Task 6);
  - `listOptionRowsOf`, `toSummary`, `liveOptionsOf` (Tasks 2 and 7);
  - `UpdateServiceInput.durationOptions` (Task 5).
- Produces:
  - `ServiceCatalogError` gains `{ _tag: 'unprocessable'; code: string; message: string }`, which the route maps to 422 with `code`;
  - `updateService` no longer calls `updateMapping`; all its mapping writes go through one `saveServiceUpdate` call.

- [ ] **Step 1: Rewrite the existing update-test assertions for the new write call**

In `tests/services/service-catalog.update.test.ts`:

1. Add `saveServiceUpdate: vi.fn(),` to the `write` hoisted object.
2. In `beforeEach`, replace `write.updateMapping.mockResolvedValue(undefined);` with `write.saveServiceUpdate.mockResolvedValue(undefined);`.
3. Add this helper below `expectError`:

```ts
/** The parent patch handed to the one transactional save. */
const parentPatch = () => write.saveServiceUpdate.mock.calls[0][0].parent.patch;
```

4. Replace each old assertion with the new one:

| Old | New |
| --- | --- |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { charges: '300000' });` | `expect(parentPatch()).toEqual({ charges: '300000' });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { duration: 90, status: 0 });` | `expect(parentPatch()).toEqual({ duration: 90, status: 0 });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 909n });` (both places) | `expect(parentPatch()).toEqual({ serviceId: 909n });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 202n });` | `expect(parentPatch()).toEqual({ serviceId: 202n });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { charges: '400000', serviceId: 202n });` | `expect(parentPatch()).toEqual({ charges: '400000', serviceId: 202n });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 303n });` (both places) | `expect(parentPatch()).toEqual({ serviceId: 303n });` |
| `expect(write.updateMapping).toHaveBeenCalledWith(501n, {});` (both places) | `expect(parentPatch()).toEqual({});` |
| `expect(write.updateMapping).not.toHaveBeenCalled();` | `expect(write.saveServiceUpdate).not.toHaveBeenCalled();` |

5. Run: `npx vitest run tests/services/service-catalog.update.test.ts`
   Expected: FAIL, because `updateService` still calls `updateMapping`. That is correct at this point.

- [ ] **Step 2: Append the new failing update tests**

Append to `tests/services/service-catalog.update.test.ts`:

```ts
describe('updateService — duration options', () => {
  const option = (id: bigint, serviceId: bigint, minutes: number, extra: Partial<Record<string, unknown>> = {}) => ({
    ...row, id, serviceId, name: `Konseling Individu (${minutes} menit)`, charges: '600000',
    durationMinutes: minutes, optionOf: { parentId: 501n, removed: false }, ...extra,
  });
  const saved = () => write.saveServiceUpdate.mock.calls[0][0];

  beforeEach(() => {
    write.countBlockingAppointments.mockResolvedValue(0);
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(909n);
  });

  it('refuses to edit an option row directly', async () => {
    repo.findMappingById.mockResolvedValue({ ...row, id: 601n, optionOf: { parentId: 501n, removed: false } });

    await expect(updateService(601, { price: 1 }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable', code: 'edit_via_parent',
    });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('creates a new option inheriting doctor, clinic, telemed, status and visibility', async () => {
    await updateService(501, { durationOptions: [{ duration: 90, price: 600000 }] }, clinicAdmin, 'a');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu (90 menit)', 'psychology_services');
    expect(write.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Konseling Individu (90 menit)', type: 'psychology_services', price: '600000', status: 1,
    }));
    expect(saved().optionInserts).toEqual([{
      parentMappingId: 501n, serviceId: 909n, doctorId: 8100001n, clinicId: 3n,
      charges: '600000', duration: 90, telemedService: 'no', status: 1, isPublic: 1,
    }]);
  });

  it('removes an option not in the list', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await updateService(501, { durationOptions: [] }, clinicAdmin, 'a');

    expect(saved().optionRemovals).toEqual([{ mappingId: 601n, parentMappingId: 501n }]);
  });

  it('refuses to remove an option an upcoming booking uses, and says how many', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.countBlockingAppointments.mockResolvedValue(2);

    await expect(updateService(501, { durationOptions: [] }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'conflict', code: 'duration_option_has_appointments', count: 2,
    });
    expect(write.countBlockingAppointments).toHaveBeenCalledWith({ serviceId: 201n, doctorId: 8100001n });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it("refuses to change an option's length under an upcoming booking, but allows a price change", async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.countBlockingAppointments.mockResolvedValue(1);

    await expect(updateService(501, { durationOptions: [{ id: 601, duration: 120, price: 600000 }] }, clinicAdmin, 'a'))
      .rejects.toMatchObject({ code: 'duration_option_has_appointments' });

    write.saveServiceUpdate.mockClear();
    await updateService(501, { durationOptions: [{ id: 601, duration: 90, price: 650000 }] }, clinicAdmin, 'a');
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { charges: '650000' } }]);
  });

  it('renames and repoints an option whose duration changes', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await updateService(501, { durationOptions: [{ id: 601, duration: 120, price: 600000 }] }, clinicAdmin, 'a');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu (120 menit)', 'psychology_services');
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { duration: 120, serviceId: 909n } }]);
  });

  it('carries a parent rename onto its options without being asked', async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);
    write.findCatalogueByNameAndType.mockImplementation(async (name: string) =>
      name === 'Terapi Keluarga' ? { id: 808n } : null);

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'a');

    expect(parentPatch()).toEqual({ serviceId: 808n });
    expect(write.createCatalogue).toHaveBeenCalledWith(expect.objectContaining({ name: 'Terapi Keluarga (90 menit)' }));
    expect(saved().optionUpdates).toEqual([{ mappingId: 601n, patch: { serviceId: 909n } }]);
  });

  it('copies status, visibility and telemed from the parent onto every live option', async () => {
    repo.listOptionRowsOf.mockResolvedValue([
      option(601n, 201n, 90),
      option(602n, 202n, 120, { isActive: false, optionOf: { parentId: 501n, removed: true } }),
    ]);

    await updateService(501, { status: 0, isPublic: 0, telemedService: 'yes' }, clinicAdmin, 'a');

    // The removed option (602) is not live: it is neither cascaded to nor removed again.
    expect(saved().optionUpdates).toEqual([
      { mappingId: 601n, patch: { telemedService: 'yes', status: 0, isPublic: 0 } },
    ]);
    expect(saved().optionRemovals).toEqual([]);
  });

  it("refuses a parent duration equal to an option's", async () => {
    repo.listOptionRowsOf.mockResolvedValue([option(601n, 201n, 90)]);

    await expect(updateService(501, { duration: 90 }, clinicAdmin, 'a')).rejects.toMatchObject({
      _tag: 'unprocessable', code: 'duration_option_duplicate',
    });
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('refuses more than four options', async () => {
    const durationOptions = [30, 45, 90, 120, 150].map((duration) => ({ duration, price: 1 }));
    await expect(updateService(501, { durationOptions }, clinicAdmin, 'a')).rejects.toMatchObject({
      code: 'duration_option_limit',
    });
  });

  it("refuses an option name another of this professional's services already has, writing nothing", async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 700n, doctorId: 8100001n });

    await expect(updateService(501, { durationOptions: [{ duration: 90, price: 1 }] }, clinicAdmin, 'a'))
      .rejects.toMatchObject({ _tag: 'conflict', code: 'service_name_taken' });
    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(write.saveServiceUpdate).not.toHaveBeenCalled();
  });

  it('leaves the parent and its options out of the option-name conflict check, removed ones included', async () => {
    repo.listOptionRowsOf.mockResolvedValue([
      option(602n, 202n, 120, { isActive: false, optionOf: { parentId: 501n, removed: true } }),
    ]);

    await updateService(501, { durationOptions: [{ duration: 120, price: 1 }] }, clinicAdmin, 'a');

    expect(write.findConflictingMapping).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Konseling Individu (120 menit)', excludeMappingIds: [501n, 602n],
    }));
  });

  it('audits option changes even when the parent itself is unchanged', async () => {
    await updateService(501, { durationOptions: [{ duration: 90, price: 600000 }] }, clinicAdmin, 'a');

    expect(logging.audit).toHaveBeenCalledWith('service.updated', expect.objectContaining({
      metadata: expect.objectContaining({ durationOptions: { created: [90], changed: [], removed: [] } }),
    }));
  });
});
```

- [ ] **Step 3: Append the failing delete tests**

Append to `tests/services/service-catalog.delete.test.ts`:

```ts
describe('deleteService — duration options', () => {
  const live = { ...row, id: 601n, serviceId: 201n, optionOf: { parentId: 501n, removed: false } };
  const gone = { ...row, id: 602n, serviceId: 202n, isActive: false, optionOf: { parentId: 501n, removed: true } };

  it('refuses to delete an option row directly', async () => {
    repo.findMappingById.mockResolvedValue({ ...row, id: 601n, optionOf: { parentId: 501n, removed: false } });

    await expect(deleteService(601, clinicAdmin, 'a')).rejects.toMatchObject({ _tag: 'unprocessable', code: 'edit_via_parent' });
    expect(write.softDeleteMapping).not.toHaveBeenCalled();
  });

  it('retires the live options with their parent, leaving removed ones alone', async () => {
    repo.listOptionRowsOf.mockResolvedValue([live, gone]);

    await deleteService(501, clinicAdmin, 'a');

    expect(write.softDeleteMapping.mock.calls.map((c) => c[0])).toEqual([501n, 601n]);
  });

  it("counts an option's upcoming bookings as blocking the parent's delete", async () => {
    repo.listOptionRowsOf.mockResolvedValue([live]);
    write.countBlockingAppointments.mockImplementation(async ({ serviceId }: { serviceId: bigint }) =>
      serviceId === 201n ? 2 : 0);

    await expect(deleteService(501, clinicAdmin, 'a')).rejects.toMatchObject({ _tag: 'conflict', count: 2 });
    expect(write.softDeleteMapping).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/services/service-catalog.update.test.ts tests/services/service-catalog.delete.test.ts`
Expected: FAIL (old assertions and new ones).

- [ ] **Step 5: Implement `service.ts`**

1. Change the write import block to:

```ts
import {
  findCatalogueByNameAndType,
  createCatalogue,
  createServiceWithMappings,
  doctorsMappedToClinic,
  findConflictingMapping,
  saveServiceUpdate,
  softDeleteMapping,
  countBlockingAppointments,
  type MappingPatch,
  type OptionInsert,
} from '@/repositories/wp/services.write';
import {
  optionName,
  planDurationOptions,
  type ExistingOption,
  type WantedOption,
} from './duration-options';
```

   `updateMapping` is no longer imported here. It stays exported from services.write.ts for its own tests and other callers.

2. Extend `ServiceCatalogError` with a new member:

```ts
  | { _tag: 'unprocessable'; code: string; message: string }
```

3. Add this helper above `updateService`:

```ts
function editViaParent(parentId: bigint): ServiceCatalogError {
  return {
    _tag: 'unprocessable',
    code: 'edit_via_parent',
    message: `This row is a duration option of service ${parentId}. Edit it through that service.`,
  };
}
```

4. Replace the entire `updateService` function (keep its doc comment, and append one paragraph to it: "Duration options are planned, checked and written with the parent: every decision is made before the first write, and every mapping write lands in one transaction.") with:

```ts
export async function updateService(
  mappingId: number,
  input: UpdateServiceInput,
  scope: ServiceScope,
  actorId: string,
): Promise<ServiceSummary> {
  const existing = scope.empty ? null : await findMappingById(BigInt(mappingId));
  if (!existing || !inScope(existing, scope)) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  if (existing.optionOf) throw editViaParent(existing.optionOf.parentId);

  const patch: MappingPatch = {};
  if (input.price !== undefined) patch.charges = String(input.price);
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.telemedService !== undefined) patch.telemedService = input.telemedService;
  if (input.status !== undefined) patch.status = input.status;
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic;

  const renaming = input.name !== undefined && input.name !== existing.name;
  // A `categoryId` equal to the row's current category is a no-op, not a recategorise —
  // otherwise a request that merely echoes the existing category would still take the
  // repoint branch below, and because `wp_kc_services` has no unique constraint on
  // `(name, type)`, `findCatalogueByNameAndType` could hand back a *different* row than
  // `existing.serviceId` and silently repoint the mapping away from it. When the current
  // category can't be determined (missing or unparseable snapshot), any supplied
  // `categoryId` counts as a change, since we cannot prove otherwise.
  const currentCategory = parseServiceCategory(existing.category);
  const recategorising =
    input.categoryId !== undefined &&
    (currentCategory === null || input.categoryId !== currentCategory.id);

  // ---- Decide everything; write nothing yet. A rejection must leave no trace. ----

  const resolved = recategorising ? await resolveCategory(input.categoryId!) : null;
  // The catalogue row's identity is name *and* type, so changing either means finding
  // or creating a different row — for the parent and, below, for every option.
  const name = input.name ?? existing.name;
  const type = resolved?.type ?? existing.type ?? '';
  const categoryJson = resolved?.json ?? existing.category;

  let parentReuse: bigint | null = null;
  if (renaming || recategorising) {
    const conflict = await findConflictingMapping({
      doctorIds: [existing.doctorId],
      clinicId: existing.clinicId,
      name,
      excludeMappingId: existing.id,
    });
    if (conflict) {
      throw {
        _tag: 'conflict',
        code: 'service_name_taken',
        message: `This professional already offers a service named "${name}" at this clinic`,
      } satisfies ServiceCatalogError;
    }
    parentReuse = (await findCatalogueByNameAndType(name, type))?.id ?? null;
  }

  const optionRows = await listOptionRowsOf([existing.id]);
  const liveRows = optionRows.filter((o) => o.optionOf && !o.optionOf.removed);
  const existingOptions: ExistingOption[] = liveRows.map((o) => ({
    mappingId: o.id,
    serviceId: o.serviceId,
    durationMinutes: o.durationMinutes,
    charges: o.charges,
  }));
  // No list sent: the options stay as they are, but still have to fit a changed parent
  // duration, and still follow a rename or a status change.
  const wanted: WantedOption[] =
    input.durationOptions !== undefined
      ? input.durationOptions.map((o) => ({ id: o.id, duration: o.duration, charges: String(o.price) }))
      : existingOptions.map((o) => ({
          id: Number(o.mappingId),
          duration: o.durationMinutes ?? 0,
          charges: o.charges ?? '0',
        }));

  const planned = planDurationOptions(existingOptions, wanted, input.duration ?? existing.durationMinutes);
  if ('error' in planned) {
    throw { _tag: 'unprocessable', code: planned.error.code, message: planned.error.message } satisfies ServiceCatalogError;
  }
  const { plan } = planned;

  // An upcoming booking pins its option: removing it, or changing its length under the
  // booking, would silently change what the client booked. A price change is allowed —
  // a booking keeps its own bill, exactly as for an ordinary service.
  const lengthChanged = (k: OptionPlan['keep'][number]) => k.duration !== (k.existing.durationMinutes ?? 0);
  const pinned = [...plan.remove, ...plan.keep.filter(lengthChanged).map((k) => k.existing)];
  let blocking = 0;
  for (const o of pinned) {
    blocking += await countBlockingAppointments({ serviceId: o.serviceId, doctorId: existing.doctorId });
  }
  if (blocking > 0) {
    throw {
      _tag: 'conflict',
      code: 'duration_option_has_appointments',
      message: `${blocking} upcoming appointment(s) use a duration option being removed or changed. Cancel or reschedule them first.`,
      count: blocking,
    } satisfies ServiceCatalogError;
  }

  // Option names follow the parent's name and their own duration.
  const nameNow = new Map(liveRows.map((o) => [o.id.toString(), o.name]));
  const keeps = plan.keep.map((k) => ({ ...k, target: optionName(name, k.duration) }));
  const creates = plan.create.map((c) => ({ ...c, target: optionName(name, c.duration) }));
  const repointed = new Set(
    keeps.filter((k) => recategorising || k.target !== nameNow.get(k.existing.mappingId.toString())),
  );

  // The parent and all its options (removed ones too) are being rewritten here, so none
  // of them can be the "other service" a name clashes with.
  const excludeMappingIds = [existing.id, ...optionRows.map((o) => o.id)];
  for (const t of [...repointed, ...creates]) {
    const clash = await findConflictingMapping({
      doctorIds: [existing.doctorId],
      clinicId: existing.clinicId,
      name: t.target,
      excludeMappingIds,
    });
    if (clash) {
      throw {
        _tag: 'conflict',
        code: 'service_name_taken',
        message: `This professional already offers a service named "${t.target}" at this clinic`,
      } satisfies ServiceCatalogError;
    }
  }

  // ---- Write. Catalogue rows first (harmless if left unused), then one transaction. ----

  if (renaming || recategorising) {
    patch.serviceId =
      parentReuse ??
      (await createCatalogue({
        name,
        type,
        category: categoryJson,
        price: patch.charges ?? existing.charges ?? '0',
        status: 1,
      }));
  }

  const catalogueFor = async (target: string, charges: string): Promise<bigint> =>
    (await findCatalogueByNameAndType(target, type))?.id ??
    (await createCatalogue({ name: target, type, category: categoryJson, price: charges, status: 1 }));

  const cascade: MappingPatch = {};
  if (input.telemedService !== undefined) cascade.telemedService = input.telemedService;
  if (input.status !== undefined) cascade.status = input.status;
  if (input.isPublic !== undefined) cascade.isPublic = input.isPublic;

  const optionUpdates: Array<{ mappingId: bigint; patch: MappingPatch }> = [];
  for (const k of keeps) {
    const p: MappingPatch = { ...cascade };
    if (lengthChanged(k)) p.duration = k.duration;
    if (k.charges !== (k.existing.charges ?? '0')) p.charges = k.charges;
    if (repointed.has(k)) p.serviceId = await catalogueFor(k.target, k.charges);
    if (Object.keys(p).length > 0) optionUpdates.push({ mappingId: k.existing.mappingId, patch: p });
  }

  const optionInserts: OptionInsert[] = [];
  for (const c of creates) {
    optionInserts.push({
      parentMappingId: existing.id,
      serviceId: await catalogueFor(c.target, c.charges),
      doctorId: existing.doctorId,
      clinicId: existing.clinicId,
      charges: c.charges,
      duration: c.duration,
      telemedService: input.telemedService ?? (existing.telemedService === 'yes' ? 'yes' : 'no'),
      status: input.status ?? (existing.isActive ? 1 : 0),
      isPublic: input.isPublic ?? (existing.isPublic ? 1 : 0),
    });
  }

  const optionRemovals = plan.remove.map((o) => ({ mappingId: o.mappingId, parentMappingId: existing.id }));

  // Nothing to write exactly when the caller sent nothing that changes anything; the
  // audit trail must then stay silent too, or a no-op leaves a record of a change that
  // never happened.
  const wroteSomething =
    Object.keys(patch).length > 0 || optionUpdates.length > 0 || optionInserts.length > 0 || optionRemovals.length > 0;

  await saveServiceUpdate({ parent: { mappingId: existing.id, patch }, optionUpdates, optionInserts, optionRemovals });

  if (wroteSomething) {
    await audit('service.updated', {
      userId: actorId,
      resource: 'service',
      resourceId: String(existing.id),
      metadata: {
        patch: { ...patch, serviceId: patch.serviceId?.toString() },
        durationOptions: {
          created: optionInserts.map((i) => i.duration),
          changed: optionUpdates.map((u) => Number(u.mappingId)),
          removed: optionRemovals.map((r) => Number(r.mappingId)),
        },
      },
    });
  }

  const refreshed = await findMappingById(existing.id);
  if (!refreshed) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  return toSummary(refreshed, await liveOptionsOf(refreshed.id));
}
```

   Also add `type OptionPlan` to the import from `./duration-options` (the `lengthChanged` helper uses it).

5. In `deleteService`, right after the `not_found` throw, add:

```ts
  if (existing.optionOf) throw editViaParent(existing.optionOf.parentId);
```

   Then replace everything from `const blocking = await countBlockingAppointments({` through the `await softDeleteMapping(existing.id);` line with:

```ts
  // The parent's live options go with it, so their bookings block it as much as its own.
  const live = await liveOptionsOf(existing.id);
  let blocking = await countBlockingAppointments({
    serviceId: existing.serviceId,
    doctorId: existing.doctorId,
  });
  for (const o of live) {
    blocking += await countBlockingAppointments({ serviceId: o.serviceId, doctorId: existing.doctorId });
  }
  if (blocking > 0) {
    throw {
      _tag: 'conflict',
      code: 'service_has_upcoming_appointments',
      message: `${blocking} upcoming appointment(s) still use this service. Cancel or reschedule them first.`,
      count: blocking,
    } satisfies ServiceCatalogError;
  }

  // Live options keep their marker: reactivating the parent (PUT status 1) brings them back.
  await softDeleteMapping(existing.id);
  for (const o of live) await softDeleteMapping(o.id);
```

   In the `audit('service.deleted', ...)` call, add `optionIds: live.map((o) => Number(o.id)),` to `metadata`.

- [ ] **Step 6: Map `unprocessable` in the item route**

In `src/app/api/v1/services/[id]/route.ts`, inside `toErrorResponse`, add this branch before the `bad_request` branch:

```ts
    if (err._tag === 'unprocessable') {
      return NextResponse.json(validationError(err.code, err.message), { status: 422 });
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/services tests/integration/services`
Expected: PASS.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. In particular `src/app/api/v1/services/route.ts` must still compile: it may not handle `unprocessable`, but the collection route never receives it.

- [ ] **Step 8: Commit**

```bash
git add src/services/service-catalog/service.ts "src/app/api/v1/services/[id]/route.ts" tests/services/service-catalog.update.test.ts tests/services/service-catalog.delete.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): kelola opsi durasi lewat PUT /services/{id}

Opsi baru, ubah, hapus; status/tampil publik/telemed/nama ikut induk;
opsi yang dipakai janji mendatang tidak bisa dihapus atau diganti
durasinya. Semua tulisan mapping dalam satu transaksi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: End-to-end on the real DB through the real route

**Files:**
- Modify: `tests/helpers/id-blocks.ts` (register block 9_300_000)
- Test: `tests/integration/services/duration-options-route.test.ts` (new)

**Interfaces:**
- Consumes: the real `GET`/`PUT`/`DELETE` handlers from `@/app/api/v1/services/[id]/route` and `GET` from `@/app/api/v1/services/route`; `issueAccessToken` from `@/lib/auth/jwt`.

- [ ] **Step 1: Register the id block**

Add after the `9_290_000` row in `tests/helpers/id-blocks.ts`:

```ts
  [9_300_000, 'integration/services/duration-options-route.test.ts', 'kc_service_doctor_mapping (by doctor_id), kc_services (by name), kc_appointments, kc_appointment_service_mapping, users (durasi-opsi-test-*)'],
```

- [ ] **Step 2: Write the test**

```ts
// tests/integration/services/duration-options-route.test.ts
/**
 * Duration options end to end: the real routes, a real JWT, and real wp_kc_* rows. The
 * steps build on each other in order, the way an admin would use the form.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const item = await import('@/app/api/v1/services/[id]/route');
const collection = await import('@/app/api/v1/services/route');

const { BASE, END } = idBlock('integration/services/duration-options-route.test.ts');
const D = BASE + 500;
const C = BASE + 600;
const S = BASE + 1; // the parent's catalogue row
const S_TAKEN = BASE + 2; // catalogue of a standalone service that will clash on name
const S_NOTE = BASE + 3;
const P = BASE + 101; // the parent mapping
const TAKEN = BASE + 102;
const NOTE = BASE + 103; // free text in extra
const APPT = BASE + 700;
const ASM = BASE + 701;
const SUPER = 'durasi-opsi-test-super';
const PREFIX = `Uji Durasi ${BASE}`;
const TYPE = `uji_durasi_${BASE}`;

let token = '';

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointment_service_mapping WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  // Options are inserted by the route with auto-increment ids: find them by doctor.
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_service_doctor_mapping WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_services WHERE name LIKE ? OR (id >= ? AND id < ?)`, `${PREFIX}%`, BASE, END);
  await prisma.logEntry.deleteMany({ where: { userId: { startsWith: 'durasi-opsi-test-' } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'durasi-opsi-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.kcService.createMany({
    data: [
      { id: BigInt(S), name: `${PREFIX} Konseling`, type: TYPE, price: '425000', category: null, status: 1, createdAt: new Date() },
      { id: BigInt(S_TAKEN), name: `${PREFIX} Konseling Pasangan (120 menit)`, type: TYPE, price: '1', category: null, status: 1, createdAt: new Date() },
      { id: BigInt(S_NOTE), name: `${PREFIX} Bercatatan`, type: TYPE, price: '1', category: null, status: 1, createdAt: new Date() },
    ] as never,
  });
  const map = (id: number, serviceId: number, extra: string | null = null) => ({
    id: BigInt(id), serviceId: BigInt(serviceId), doctorId: BigInt(D), clinicId: BigInt(C), charges: '425000',
    duration: 60, status: 1, isPublic: 1, telemedService: 'no', extra, createdAt: new Date(),
  });
  await prisma.kcServiceDoctorMapping.createMany({
    data: [map(P, S), map(TAKEN, S_TAKEN), map(NOTE, S_NOTE, 'catatan admin: jangan dihapus')] as never,
  });
  await prisma.user.create({
    data: {
      id: SUPER, email: `${SUPER}@test.local`, username: SUPER, firstName: 'S', lastName: 'A',
      displayName: 'S A', role: 'SUPER_ADMIN' as never, wpUserId: BigInt(BASE + 900), status: 1,
    },
  });
  ({ token } = await issueAccessToken({ userId: SUPER, role: 'SUPER_ADMIN', email: `${SUPER}@test.local`, username: SUPER }));
});

afterAll(wipe);

async function call(method: 'GET' | 'PUT' | 'DELETE', id: number, body?: unknown) {
  const req = new NextRequest(`http://localhost/api/v1/services/${id}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await item[method](req, { params: { id: String(id) } });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function optionRows() {
  return prisma.$queryRawUnsafe<Array<{ id: bigint; status: number; is_public: number; telemed_service: string; duration: number; extra: string; name: string }>>(
    `SELECT sdm.id, sdm.status, sdm.is_public, sdm.telemed_service, sdm.duration, sdm.extra, s.name
       FROM wp_kc_service_doctor_mapping sdm JOIN wp_kc_services s ON s.id = sdm.service_id
      WHERE sdm.doctor_id = ? AND sdm.extra LIKE ? ORDER BY sdm.id`,
    D, '%praktiqu_duration_of%',
  );
}

let optionId = 0;

describe('duration options through PUT /api/v1/services/{id}', () => {
  it('adds an option that inherits the parent and is named after it', async () => {
    const { status, json } = await call('PUT', P, { durationOptions: [{ duration: 90, price: 600000 }] });

    expect(status).toBe(200);
    expect(json.durationOptions).toHaveLength(1);
    expect(json.durationOptions[0]).toMatchObject({ name: `${PREFIX} Konseling (90 menit)`, durationMinutes: 90, price: 600000, isActive: true });
    optionId = json.durationOptions[0].id;

    const [row] = await optionRows();
    expect(Number(row.id)).toBe(optionId);
    expect(JSON.parse(row.extra)).toEqual({ praktiqu_duration_of: P });
    expect([row.status, row.is_public, row.telemed_service]).toEqual([1, 1, 'no']);
  });

  it('GET of the option names its parent; the flat list carries both', async () => {
    expect((await call('GET', optionId)).json.durationOf).toBe(P);

    const req = new NextRequest(`http://localhost/api/v1/services?professionalId=${D}&perPage=100`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const list = (await (await collection.GET(req, { params: {} } as never)).json()) as Record<string, any>;
    const byId = new Map(list.services.map((s: any) => [s.id, s]));
    expect((byId.get(P) as any).durationOptions.map((o: any) => o.id)).toEqual([optionId]);
    expect((byId.get(optionId) as any).durationOf).toBe(P);
  });

  it('a parent rename renames the option', async () => {
    expect((await call('PUT', P, { name: `${PREFIX} Konseling Pasangan` })).status).toBe(200);
    expect((await optionRows())[0].name).toBe(`${PREFIX} Konseling Pasangan (90 menit)`);
  });

  it('status, visibility and telemed follow the parent', async () => {
    await call('PUT', P, { status: 0, isPublic: 0, telemedService: 'yes' });
    let [row] = await optionRows();
    expect([row.status, row.is_public, row.telemed_service]).toEqual([0, 0, 'yes']);

    await call('PUT', P, { status: 1, isPublic: 1, telemedService: 'no' });
    [row] = await optionRows();
    expect([row.status, row.is_public, row.telemed_service]).toEqual([1, 1, 'no']);
  });

  it('refuses a parent duration equal to an option and changes nothing', async () => {
    const { status, json } = await call('PUT', P, { duration: 90 });
    expect(status).toBe(422);
    expect(json.code).toBe('duration_option_duplicate');
    const parent = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: BigInt(P) }, select: { duration: true } });
    expect(parent!.duration).toBe(60);
  });

  it('refuses a fifth extra duration', async () => {
    const durationOptions = [30, 45, 90, 120, 150].map((duration) => ({ duration, price: 1 }));
    expect((await call('PUT', P, { durationOptions })).json.code).toBe('duration_option_limit');
  });

  it('refuses to edit or delete the option row directly', async () => {
    expect((await call('PUT', optionId, { price: 1 })).json.code).toBe('edit_via_parent');
    expect((await call('DELETE', optionId)).json.code).toBe('edit_via_parent');
  });

  it('refuses an option name another service of this professional already has, inserting nothing', async () => {
    const { status } = await call('PUT', P, {
      durationOptions: [{ id: optionId, duration: 90, price: 600000 }, { duration: 120, price: 800000 }],
    });
    expect(status).toBe(409);
    expect(await optionRows()).toHaveLength(1);
  });

  it('will not remove an option an upcoming booking uses, then will once it is cancelled', async () => {
    const [{ service_id: optionServiceId }] = await prisma.$queryRawUnsafe<Array<{ service_id: bigint }>>(
      `SELECT service_id FROM wp_kc_service_doctor_mapping WHERE id = ?`, optionId,
    );
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointments
         (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
          appointment_end_date, appointment_end_time, appointment_timezone, visit_type, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:30:00', 'Asia/Jakarta', '', '', 1, NOW())`,
      APPT, C, D, BASE + 800, tomorrow, tomorrow,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_appointment_service_mapping (id, appointment_id, service_id, status, created_at) VALUES (?, ?, ?, 1, NOW())`,
      ASM, APPT, optionServiceId,
    );

    const refused = await call('PUT', P, { durationOptions: [] });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('duration_option_has_appointments');
    expect(refused.json.count).toBe(1);

    await prisma.$executeRawUnsafe(`UPDATE wp_kc_appointments SET status = 0 WHERE id = ?`, APPT);

    const ok = await call('PUT', P, { durationOptions: [] });
    expect(ok.status).toBe(200);
    expect(ok.json.durationOptions).toEqual([]);
    const [row] = await optionRows();
    expect(row.status).toBe(0);
    expect(JSON.parse(row.extra)).toEqual({ praktiqu_duration_of_removed: P });
  });

  it('re-adding a removed duration is not a name clash', async () => {
    const { status, json } = await call('PUT', P, { durationOptions: [{ duration: 90, price: 610000 }] });
    expect(status).toBe(200);
    expect(json.durationOptions.map((o: any) => [o.durationMinutes, o.price])).toEqual([[90, 610000]]);
  });

  it('never touches a row whose extra holds someone else\'s text', async () => {
    expect((await call('PUT', NOTE, { price: 1 })).status).toBe(200);
    const row = await prisma.kcServiceDoctorMapping.findUnique({ where: { id: BigInt(NOTE) }, select: { extra: true } });
    expect(row!.extra).toBe('catatan admin: jangan dihapus');
  });

  it('deleting the parent retires its live option too', async () => {
    expect((await call('DELETE', P)).status).toBe(200);
    const live = (await optionRows()).filter((r) => JSON.parse(r.extra).praktiqu_duration_of === P);
    expect(live.map((r) => r.status)).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/integration/services/duration-options-route.test.ts tests/unit/test-id-blocks.test.ts`
Expected: PASS. If `collection.GET` needs a different second argument, mirror `tests/integration/services/collection-route.test.ts`. If a column is missing from the test DB's `wp_kc_appointments`, copy the column list from `tests/integration/schedule/overlap-pairs.test.ts:33-39`; it is known to work on that DB.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/id-blocks.ts tests/integration/services/duration-options-route.test.ts
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
test(layanan): opsi durasi end-to-end lewat route asli di DB uji

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Contract, docs, full verification, push

**Files:**
- Modify: `scripts/generate-openapi.ts` (PUT description only), `openapi.yaml` (regenerated)
- Modify: `docs/api/SERVICES-CRUD-GUIDE.md` (new section)

- [ ] **Step 1: Extend the PUT description in `scripts/generate-openapi.ts`**

In the `registry.registerPath` for `put /api/v1/services/{id}`, append this to the `description` string concatenation:

```ts
      ' `durationOptions`, when sent, is the complete list of extra durations: rows without `id` ' +
      'are created, rows with `id` updated, options not listed removed (422 `duration_option_limit`, ' +
      '`duration_option_duplicate`, `duration_option_not_found`; 409 `duration_option_has_appointments` ' +
      'with `count`). PUT or DELETE on an option row answers 422 `edit_via_parent`.'
```

- [ ] **Step 2: Regenerate and check**

Run: `npm run openapi && npm run openapi:check`
Expected: the first writes `openapi.yaml`; the second exits 0. `git diff --stat openapi.yaml` shows `durationOf`, `durationOptions` and the PUT description.

- [ ] **Step 3: Document in `docs/api/SERVICES-CRUD-GUIDE.md`**

Append this section:

```markdown
## Opsi durasi (2026-11-06)

Satu layanan boleh punya sampai 4 durasi tambahan dengan harga sendiri. Setiap opsi adalah
layanan tersendiri (baris katalog + mapping), bernama `<nama induk> (<menit> menit)`, dan
ditandai dengan `extra = {"praktiqu_duration_of": <id mapping induk>}`.

- `GET /api/v1/services` dan `GET /api/v1/services/{id}`:
  - setiap baris membawa `durationOf` (id mapping induk, untuk opsi hidup maupun yang sudah dihapus);
  - induk membawa `durationOptions` (opsi hidup saja, durasi terpendek dulu);
  - daftar tetap datar: baris opsi tetap ada, supaya pencarian nama berdasarkan id tetap jalan.
- `PUT /api/v1/services/{id}` menerima `durationOptions: [{ id?, duration, price }]` sebagai daftar lengkap.
  - Kategori, status, tampil publik, telemed, dan nama ikut induk secara otomatis.
  - Opsi tidak bisa diubah atau dihapus langsung (422 `edit_via_parent`).
- `GET /api/v1/public/professionals/{id}/services`: setiap baris membawa `durationOf`, yaitu id publik
  (id katalog) induknya. FE mengelompokkan per (`clinicId`, `durationOf`).
- Slot, booking, dan pembayaran tidak berubah: kirim `serviceId` milik opsi yang dipilih.
```

- [ ] **Step 4: Full verification**

Run, with Docker Desktop running:
- `npx tsc --noEmit -p tsconfig.json` — expected: no errors.
- `npx vitest run` — expected: all pass. A failure caused only by `Can't reach database server` means Docker is down; start it and rerun.
- `npx next build` — expected: build succeeds.

- [ ] **Step 5: Commit and push**

```bash
git add scripts/generate-openapi.ts openapi.yaml docs/api/SERVICES-CRUD-GUIDE.md
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
docs(layanan): kontrak dan panduan opsi durasi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/opsi-durasi-layanan
```

Push uses the repo-scoped SSH key, already configured for this remote. There is no usable `gh`, so give the user the compare link to open the PR: `https://github.com/Alfzzz124/<repo>/compare/main...feat/opsi-durasi-layanan`. Read `<repo>` from `git remote get-url origin`.
