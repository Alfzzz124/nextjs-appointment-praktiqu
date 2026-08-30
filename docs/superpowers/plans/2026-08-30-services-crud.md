# Service CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose create/read/update/delete for clinic services under `/api/v1`, so clinic admins can manage their own service list from the dashboard.

**Architecture:** The resource is one row of `wp_kc_service_doctor_mapping` — a service *as offered by one psychologist at one clinic* — because price, duration, telemed flag and status all live there and the `wp_kc_services` catalogue has no `clinic_id` to scope by. Reads and writes both go through direct SQL/Prisma against KiviCare's tables, split into `services.repo.ts` (read) and `services.write.ts` (write), with a thin service layer holding KiviCare's catalogue-reuse and rename-repoint rules.

**Tech Stack:** Next.js App Router route handlers, Prisma (MySQL, KiviCare tables via `@@map`), zod 3.23, vitest 2.1 with `vi.hoisted` prisma mocks.

**Spec:** `docs/superpowers/specs/2026-08-30-services-crud-design.md`

## Global Constraints

- Roles are `SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT`. Write is `SUPER_ADMIN` and `CLINIC_ADMIN` only.
- Out-of-scope rows answer **404**, never 403 — existence must not leak.
- Never fire `kc_service_add` / `kc_service_update` / `kc_service_delete`. We never send `session_days`, so nothing listens.
- `APPOINTMENT_STATUS.CANCELLED` is **0**, not 1. Import the constant from `@/repositories/wp/appointments.repo`; never write the literal.
- Numeric path segments are parsed with an integer guard that returns 400 on failure. `NaN` reaching a SQL parameter has crashed this codebase before.
- Response envelope follows the `/professionals` family: `NextResponse.json` plus helpers from `@/lib/problem-details`. Do **not** use `kcOk` / `kcHandle`.
- `vi.mock` factories are hoisted above top-level `const`s. Every mock object referenced inside a factory must be created inside `vi.hoisted`.
- Run a single test file with `npx vitest run <path>`. Run the type checker with `npm run type-check`.
- Money is stored as a string in both `wp_kc_services.price` and `wp_kc_service_doctor_mapping.charges`. Convert with `String(n)`, never write a JS number into those columns.

---

### Task 1: `service_type` lookup and `GET /api/v1/service-categories`

**Files:**
- Modify: `src/repositories/wp/static-data.repo.ts:14-19` (add the type), append two functions
- Create: `src/app/api/v1/service-categories/route.ts`
- Test: `tests/services/service-categories.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STATIC_DATA_TYPE.SERVICE_TYPE: 'service_type'`
  - `listServiceTypes(opts?: { includeInactive?: boolean }): Promise<WpStaticData[]>`
  - `findServiceTypeById(id: bigint): Promise<WpStaticData | null>` — returns `null` when the id exists but is a different `type`, or is inactive.

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-categories.test.ts`:

```ts
/**
 * Service categories — `wp_kc_static_data` rows of type `service_type`.
 *
 * These are what KiviCare's `category` parameter points at, and their `value` is what
 * lands in `wp_kc_services.type`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcStaticData: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  STATIC_DATA_TYPE,
  listServiceTypes,
  findServiceTypeById,
} from '@/repositories/wp/static-data.repo';

const row = {
  id: 7n,
  type: 'service_type',
  label: 'Psychology Services',
  value: 'psychology_services',
  parentId: null,
  status: 1n,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  db.kcStaticData.findMany.mockReset();
  db.kcStaticData.findFirst.mockReset();
});

describe('listServiceTypes', () => {
  it('queries only active service_type rows', async () => {
    db.kcStaticData.findMany.mockResolvedValue([row]);

    const result = await listServiceTypes();

    expect(db.kcStaticData.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'service_type', status: 1n } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('psychology_services');
    expect(result[0].isActive).toBe(true);
  });

  it('drops the status filter when includeInactive is set', async () => {
    db.kcStaticData.findMany.mockResolvedValue([]);

    await listServiceTypes({ includeInactive: true });

    expect(db.kcStaticData.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'service_type' } }),
    );
  });
});

describe('findServiceTypeById', () => {
  it('returns the row when it is an active service_type', async () => {
    db.kcStaticData.findFirst.mockResolvedValue(row);

    const found = await findServiceTypeById(7n);

    expect(db.kcStaticData.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7n, type: 'service_type', status: 1n } }),
    );
    expect(found?.value).toBe('psychology_services');
  });

  it('returns null when the id belongs to another type or is inactive', async () => {
    db.kcStaticData.findFirst.mockResolvedValue(null);

    expect(await findServiceTypeById(999n)).toBeNull();
  });
});

describe('STATIC_DATA_TYPE', () => {
  it('carries the service_type key KiviCare writes', () => {
    expect(STATIC_DATA_TYPE.SERVICE_TYPE).toBe('service_type');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-categories.test.ts`
Expected: FAIL — `listServiceTypes is not a function`, `findServiceTypeById is not a function`.

- [ ] **Step 3: Add the type and the two functions**

In `src/repositories/wp/static-data.repo.ts`, extend the vocabulary:

```ts
/** The `type` vocabulary KiviCare writes. */
export const STATIC_DATA_TYPE = {
  SPECIALIZATION: 'specialization',
  BLOOD_GROUP: 'blood_group',
  QUALIFICATION: 'qualification',
  SERVICE_LIST: 'service_list',
  /** Service categories. `value` is what lands in `wp_kc_services.type`. */
  SERVICE_TYPE: 'service_type',
} as const;
```

Append at the end of the file, after `listQualifications`:

```ts
export function listServiceTypes(opts: { includeInactive?: boolean } = {}) {
  return listStaticData({ type: STATIC_DATA_TYPE.SERVICE_TYPE, ...opts });
}

/**
 * One active `service_type` row by id.
 *
 * The `type` guard is not decoration: `category` arrives from a client as a bare
 * integer, and every other enumeration KiviCare owns lives in this same table. Without
 * it, a blood-group id would happily become a service category.
 */
export async function findServiceTypeById(id: bigint): Promise<WpStaticData | null> {
  const row = await prisma.kcStaticData.findFirst({
    where: { id, type: STATIC_DATA_TYPE.SERVICE_TYPE, status: STATUS_ACTIVE },
    select: SELECT,
  });
  return row ? toStaticData(row as StaticDataRow) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-categories.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the route**

Create `src/app/api/v1/service-categories/route.ts`:

```ts
/**
 * GET /api/v1/service-categories — the `service_type` vocabulary.
 *
 * `categoryId` on POST /api/v1/services points at one of these rows. Every logged-in
 * role may read it: it is a lookup list with no clinic dimension.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { listServiceTypes } from '@/repositories/wp/static-data.repo';

export const GET = withAuth(async () => {
  const rows = await listServiceTypes();

  return NextResponse.json({
    categories: rows.map((r) => ({
      id: Number(r.id),
      label: r.label,
      value: r.value,
    })),
  });
});
```

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/wp/static-data.repo.ts src/app/api/v1/service-categories/route.ts tests/services/service-categories.test.ts
git commit -m "feat(services): expose the service_type category vocabulary"
```

---

### Task 2: Clinic service reads in `services.repo.ts`

**Files:**
- Modify: `src/repositories/wp/services.repo.ts` — append to the read section, above the `Writes` banner at line 177
- Test: `tests/services/service-catalog.repo.test.ts`

**Interfaces:**
- Consumes: `paginate` from `./wp-user` (already imported by this file).
- Produces:

```ts
export type ClinicServiceRow = {
  id: bigint;              // the mapping row id — this is the API's {id}
  serviceId: bigint;       // the catalogue row id
  doctorId: bigint;
  clinicId: bigint;
  name: string;
  type: string | null;
  category: string | null; // raw JSON snapshot from wp_kc_services.category
  charges: string | null;
  durationMinutes: number | null;
  telemedService: string | null;
  isPublic: boolean;
  isActive: boolean;
  nameAlias: string | null;
  createdAt: Date;
};

export type ListClinicServicesQuery = {
  page: number;
  perPage: number;
  search?: string;
  clinicId?: bigint;
  doctorId?: bigint;
  includeInactive?: boolean;
};

export type PaginatedClinicServices = {
  items: ClinicServiceRow[];
  total: number;
  page: number;
  perPage: number;
};

export function listClinicServices(query: ListClinicServicesQuery): Promise<PaginatedClinicServices>;
/** Ignores `status` — an inactive mapping must still be fetchable by id. */
export function findMappingById(id: bigint): Promise<ClinicServiceRow | null>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.repo.test.ts`:

```ts
/**
 * Clinic service reads — the mapping joined to its catalogue row.
 *
 * `KcServiceDoctorMapping` has no Prisma relation to `KcService`, so these are two
 * queries stitched in memory. The tests pin that shape, including the orphan case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcServiceDoctorMapping: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  kcService: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { listClinicServices, findMappingById } from '@/repositories/wp/services.repo';

const mapping = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  charges: '250000',
  duration: 60,
  isPublic: 1,
  status: 1,
  telemedService: 'no',
  serviceNameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const service = {
  id: 101n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
};

beforeEach(() => {
  Object.values(db).forEach((m) => Object.values(m).forEach((f: any) => f.mockReset()));
});

describe('listClinicServices', () => {
  it('joins the mapping to its catalogue row', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValue([service]);

    const page = await listClinicServices({ page: 1, perPage: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 501n,
      serviceId: 101n,
      name: 'Konseling Individu',
      type: 'psychology_services',
      charges: '250000',
      durationMinutes: 60,
      isActive: true,
      isPublic: true,
    });
  });

  it('filters to active mappings unless includeInactive is set', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(0);

    await listClinicServices({ page: 1, perPage: 20 });
    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 1 }) }),
    );

    db.kcServiceDoctorMapping.findMany.mockClear();
    await listClinicServices({ page: 1, perPage: 20, includeInactive: true });
    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('narrows by clinic and doctor when given', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(0);

    await listClinicServices({ page: 1, perPage: 20, clinicId: 3n, doctorId: 8100001n });

    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clinicId: 3n, doctorId: 8100001n }),
      }),
    );
  });

  it('resolves a name search through the catalogue first', async () => {
    db.kcService.findMany.mockResolvedValueOnce([{ id: 101n }]);
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValueOnce([service]);

    await listClinicServices({ page: 1, perPage: 20, search: 'Konseling' });

    expect(db.kcServiceDoctorMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ serviceId: { in: [101n] } }),
      }),
    );
  });

  it('short-circuits to an empty page when nothing matches the search', async () => {
    db.kcService.findMany.mockResolvedValueOnce([]);

    const page = await listClinicServices({ page: 1, perPage: 20, search: 'nope' });

    expect(page).toEqual({ items: [], total: 0, page: 1, perPage: 20 });
    expect(db.kcServiceDoctorMapping.findMany).not.toHaveBeenCalled();
  });

  it('drops a mapping whose catalogue row is gone rather than emitting a nameless entry', async () => {
    db.kcServiceDoctorMapping.findMany.mockResolvedValue([mapping]);
    db.kcServiceDoctorMapping.count.mockResolvedValue(1);
    db.kcService.findMany.mockResolvedValue([]);

    const page = await listClinicServices({ page: 1, perPage: 20 });

    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(1);
  });
});

describe('findMappingById', () => {
  it('returns the joined row', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(mapping);
    db.kcService.findMany.mockResolvedValue([service]);

    const row = await findMappingById(501n);

    expect(row?.name).toBe('Konseling Individu');
    expect(row?.clinicId).toBe(3n);
  });

  it('returns an inactive mapping too — status is not a filter here', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue({ ...mapping, status: 0 });
    db.kcService.findMany.mockResolvedValue([service]);

    const row = await findMappingById(501n);

    expect(row?.isActive).toBe(false);
  });

  it('returns null when the mapping is missing', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(null);

    expect(await findMappingById(999n)).toBeNull();
  });

  it('returns null when the catalogue row is gone', async () => {
    db.kcServiceDoctorMapping.findUnique.mockResolvedValue(mapping);
    db.kcService.findMany.mockResolvedValue([]);

    expect(await findMappingById(501n)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.repo.test.ts`
Expected: FAIL — `listClinicServices is not a function`.

- [ ] **Step 3: Implement the reads**

In `src/repositories/wp/services.repo.ts`, insert immediately **above** the `/* Writes — doctor↔service assignments */` banner:

```ts
/* ------------------------------------------------------------------ */
/* Clinic service listing — the mapping is the resource                */
/* ------------------------------------------------------------------ */
/**
 * `/api/v1/services` treats a mapping row as the resource, not the catalogue: price,
 * duration, telemed flag and status all live on the mapping, and only the mapping has a
 * `clinic_id` to scope by.
 */

export type ClinicServiceRow = {
  /** The mapping row id — this is the `{id}` in `/api/v1/services/{id}`. */
  id: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  name: string;
  type: string | null;
  /** Raw JSON snapshot KiviCare keeps in `wp_kc_services.category`. */
  category: string | null;
  charges: string | null;
  durationMinutes: number | null;
  telemedService: string | null;
  isPublic: boolean;
  isActive: boolean;
  nameAlias: string | null;
  createdAt: Date;
};

export type ListClinicServicesQuery = {
  page: number;
  perPage: number;
  search?: string;
  clinicId?: bigint;
  doctorId?: bigint;
  includeInactive?: boolean;
};

export type PaginatedClinicServices = {
  items: ClinicServiceRow[];
  total: number;
  page: number;
  perPage: number;
};

const MAPPING_SELECT = {
  id: true,
  serviceId: true,
  doctorId: true,
  clinicId: true,
  charges: true,
  duration: true,
  isPublic: true,
  status: true,
  telemedService: true,
  serviceNameAlias: true,
  createdAt: true,
} as const;

type MappingRow = {
  id: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  charges: string | null;
  duration: number | null;
  isPublic: number;
  status: number;
  telemedService: string | null;
  serviceNameAlias: string | null;
  createdAt: Date;
};

type CatalogueRow = { id: bigint; name: string; type: string | null; category: string | null };

/** Fetch the catalogue rows for a set of mappings, keyed by id-as-string. */
async function catalogueFor(mappings: MappingRow[]): Promise<Map<string, CatalogueRow>> {
  if (mappings.length === 0) return new Map();
  const rows = await prisma.kcService.findMany({
    where: { id: { in: mappings.map((m) => m.serviceId) } },
    select: { id: true, name: true, type: true, category: true },
  });
  return new Map((rows as CatalogueRow[]).map((r) => [r.id.toString(), r]));
}

function toClinicService(m: MappingRow, s: CatalogueRow): ClinicServiceRow {
  return {
    id: m.id,
    serviceId: m.serviceId,
    doctorId: m.doctorId,
    clinicId: m.clinicId,
    name: s.name,
    type: s.type,
    category: s.category,
    charges: m.charges,
    durationMinutes: m.duration ?? null,
    telemedService: m.telemedService,
    isPublic: m.isPublic === 1,
    isActive: m.status === STATUS_ACTIVE,
    nameAlias: m.serviceNameAlias,
    createdAt: m.createdAt,
  };
}

export async function listClinicServices(
  query: ListClinicServicesQuery,
): Promise<PaginatedClinicServices> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);

  const where: Record<string, unknown> = {};
  if (!query.includeInactive) where.status = STATUS_ACTIVE;
  if (query.clinicId !== undefined) where.clinicId = query.clinicId;
  if (query.doctorId !== undefined) where.doctorId = query.doctorId;

  const search = query.search?.trim();
  if (search) {
    // The name lives on the catalogue, which has no Prisma relation to the mapping.
    // Resolve matching catalogue ids first, then filter the mapping on them.
    const matches = await prisma.kcService.findMany({
      where: { name: { contains: search } },
      select: { id: true },
    });
    if (matches.length === 0) return { items: [], total: 0, page, perPage };
    where.serviceId = { in: matches.map((m) => m.id) };
  }

  const [rows, total] = await Promise.all([
    prisma.kcServiceDoctorMapping.findMany({
      where,
      select: MAPPING_SELECT,
      orderBy: { id: 'asc' },
      skip: offset,
      take: perPage,
    }),
    prisma.kcServiceDoctorMapping.count({ where }),
  ]);

  const mappings = rows as MappingRow[];
  const byId = await catalogueFor(mappings);

  // `total` deliberately counts mappings, not survivors: it is the count the pagination
  // arithmetic is built on, and dropping orphans from it would make page sizes lie.
  return {
    items: mappings
      .filter((m) => byId.has(m.serviceId.toString()))
      .map((m) => toClinicService(m, byId.get(m.serviceId.toString())!)),
    total,
    page,
    perPage,
  };
}

/**
 * One mapping by id, regardless of `status`.
 *
 * Soft-deleted rows stay fetchable by id on purpose — `GET /services/{id}` should show
 * an admin what they just deactivated rather than 404.
 */
export async function findMappingById(id: bigint): Promise<ClinicServiceRow | null> {
  const row = await prisma.kcServiceDoctorMapping.findUnique({
    where: { id },
    select: MAPPING_SELECT,
  });
  if (!row) return null;

  const mapping = row as MappingRow;
  const byId = await catalogueFor([mapping]);
  const service = byId.get(mapping.serviceId.toString());
  return service ? toClinicService(mapping, service) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.repo.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Verify nothing else regressed**

Run: `npx vitest run tests/integration/professional tests/public-booking`
Expected: PASS — `services.repo.ts` gained functions but changed none.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/wp/services.repo.ts tests/services/service-catalog.repo.test.ts
git commit -m "feat(services): add clinic service listing to the wp services repo"
```

---

### Task 3: Read/write scope helper

**Files:**
- Create: `src/services/service-catalog/scope.ts`
- Test: `tests/services/service-catalog.scope.test.ts`

**Interfaces:**
- Consumes: `resolveKcActor(actor): Promise<{ actor, wpUserId: bigint, clinicId: bigint | null }>` from `@/services/billing/kc-actor`; `Actor` from `@/lib/auth`.
- Produces:

```ts
export type ServiceScope = {
  /** Restrict to this clinic. `null` = unrestricted (SUPER_ADMIN only). */
  clinicId: bigint | null;
  /** Restrict to this doctor. `null` = unrestricted. */
  doctorId: bigint | null;
  /** The role can see nothing at all — answer with an empty page, not an error. */
  empty: boolean;
};

export function readScopeFor(actor: Actor): Promise<ServiceScope>;
export function canWrite(role: Actor['role']): boolean;
export function parseServiceId(raw: string): number | null;
export function invalidIdResponse(): NextResponse;

/** Mirrors `RoleGuardResult` in src/lib/auth/route-guards.ts:22. */
export type ScopeResult = { scope: ServiceScope } | { response: NextResponse };
export function scopeForRequest(actor: Actor): Promise<ScopeResult>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.scope.test.ts`:

```ts
/**
 * Scope matrix for /api/v1/services, mirroring KiviCare's own getServices
 * (DoctorServiceController.php:623-652).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

import { KcError } from '@/lib/kc-response';
import {
  readScopeFor,
  canWrite,
  parseServiceId,
  scopeForRequest,
} from '@/services/service-catalog/scope';

const actorOf = (role: string) => ({ id: 'u1', role, practiceId: null }) as any;

// Block body, not `beforeEach(() => mock.mockReset())`. A concise arrow returns the mock,
// and Vitest registers a function returned from `beforeEach` as a per-test teardown — so it
// would CALL the mock after each test. After a test that set `mockRejectedValue`, that call
// produces an unawaited rejected promise and the test fails as an unhandled rejection.
beforeEach(() => {
  kcActor.resolveKcActor.mockReset();
});

describe('readScopeFor', () => {
  it('leaves SUPER_ADMIN unrestricted', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 1n, clinicId: null });

    expect(await readScopeFor(actorOf('SUPER_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: false,
    });
  });

  it('locks CLINIC_ADMIN to their own clinic', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: 3n });

    expect(await readScopeFor(actorOf('CLINIC_ADMIN'))).toEqual({
      clinicId: 3n,
      doctorId: null,
      empty: false,
    });
  });

  it('locks RECEPTIONIST to their own clinic', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 30n, clinicId: 4n });

    expect(await readScopeFor(actorOf('RECEPTIONIST'))).toEqual({
      clinicId: 4n,
      doctorId: null,
      empty: false,
    });
  });

  it('gives a clinic-less admin an empty scope rather than the whole table', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: null });

    expect(await readScopeFor(actorOf('CLINIC_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: true,
    });
  });

  it('locks PROFESSIONAL to their own rows, across clinics', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 8100001n, clinicId: 3n });

    expect(await readScopeFor(actorOf('PROFESSIONAL'))).toEqual({
      clinicId: null,
      doctorId: 8100001n,
      empty: false,
    });
  });

  it('shows a CLIENT nothing', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 99n, clinicId: null });

    expect(await readScopeFor(actorOf('CLIENT'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: true,
    });
  });
});

describe('canWrite', () => {
  it('admits only the two admin roles', () => {
    expect(canWrite('SUPER_ADMIN')).toBe(true);
    expect(canWrite('CLINIC_ADMIN')).toBe(true);
    expect(canWrite('RECEPTIONIST')).toBe(false);
    expect(canWrite('PROFESSIONAL')).toBe(false);
    expect(canWrite('CLIENT')).toBe(false);
  });
});

describe('parseServiceId', () => {
  it('accepts a positive integer', () => {
    expect(parseServiceId('501')).toBe(501);
  });

  it('rejects anything that would become NaN in a SQL parameter', () => {
    expect(parseServiceId('abc')).toBeNull();
    expect(parseServiceId('')).toBeNull();
    expect(parseServiceId('0')).toBeNull();
    expect(parseServiceId('-1')).toBeNull();
    expect(parseServiceId('1.5')).toBeNull();
  });
});

describe('scopeForRequest', () => {
  it('returns the scope when the actor resolves', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 20n, clinicId: 3n });

    const result = await scopeForRequest(actorOf('CLINIC_ADMIN'));

    expect(result).toEqual({ scope: { clinicId: 3n, doctorId: null, empty: false } });
  });

  it('turns an unlinked WordPress account into a 403, not an uncaught 500', async () => {
    kcActor.resolveKcActor.mockRejectedValue(
      new KcError('User is not linked to a WordPress account', 403),
    );

    const result = await scopeForRequest(actorOf('CLINIC_ADMIN'));

    expect('response' in result).toBe(true);
    expect((result as { response: Response }).response.status).toBe(403);
  });

  it('lets an unexpected error through rather than masking it as 403', async () => {
    kcActor.resolveKcActor.mockRejectedValue(new Error('connection lost'));

    await expect(scopeForRequest(actorOf('CLINIC_ADMIN'))).rejects.toThrow('connection lost');
  });
});

describe('the shared scope constants', () => {
  it('cannot be mutated by one request into a scope every later request inherits', async () => {
    kcActor.resolveKcActor.mockResolvedValue({ wpUserId: 1n, clinicId: null });

    const first = await readScopeFor(actorOf('SUPER_ADMIN'));
    expect(() => {
      (first as { clinicId: bigint | null }).clinicId = 999n;
    }).toThrow();

    expect(await readScopeFor(actorOf('SUPER_ADMIN'))).toEqual({
      clinicId: null,
      doctorId: null,
      empty: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.scope.test.ts`
Expected: FAIL — cannot resolve `@/services/service-catalog/scope`.

- [ ] **Step 3: Write the scope helper**

Create `src/services/service-catalog/scope.ts`:

```ts
/**
 * Who may see and touch which service mappings.
 *
 * The read matrix is KiviCare's own, from `DoctorServiceController::getServices`
 * (:623-652): administrators see everything, clinic admins and receptionists see their
 * clinic, doctors see their own rows across clinics, everyone else sees nothing.
 *
 * The write gate is deliberately *not* KiviCare's. There the gate is
 * `KCPermissions::can_user_perform_action('service_add'|…)`, a matrix stored in
 * `wp_options` and configurable per install — unpredictable from an API's point of view.
 * Here it is fixed: the two admin roles, per the product decision that a clinic's shape
 * is set by its admin.
 */
import { NextResponse } from 'next/server';
import type { Actor } from '@/lib/auth';
import { KcError } from '@/lib/kc-response';
import { forbidden } from '@/lib/problem-details';
import { resolveKcActor } from '@/services/billing/kc-actor';

export type ServiceScope = {
  /** Restrict to this clinic. `null` means unrestricted, which only SUPER_ADMIN gets. */
  clinicId: bigint | null;
  /** Restrict to this doctor. `null` means unrestricted. */
  doctorId: bigint | null;
  /**
   * The actor can see nothing at all. A clinic admin with no clinic mapping lands here,
   * and the answer is an empty page — not a 500, and not the whole table.
   */
  empty: boolean;
};

// Frozen because both are handed out by reference to every matching request. A consumer
// assigning to `scope.clinicId` would otherwise corrupt every later request in the process.
const UNRESTRICTED: ServiceScope = Object.freeze({ clinicId: null, doctorId: null, empty: false });
const NOTHING: ServiceScope = Object.freeze({ clinicId: null, doctorId: null, empty: true });

export async function readScopeFor(actor: Actor): Promise<ServiceScope> {
  if (actor.role === 'SUPER_ADMIN') return UNRESTRICTED;
  if (actor.role === 'CLIENT') return NOTHING;

  const kc = await resolveKcActor(actor);

  if (actor.role === 'PROFESSIONAL') {
    return { clinicId: null, doctorId: kc.wpUserId, empty: false };
  }

  // CLINIC_ADMIN and RECEPTIONIST.
  if (kc.clinicId === null) return NOTHING;
  return { clinicId: kc.clinicId, doctorId: null, empty: false };
}

export function canWrite(role: Actor['role']): boolean {
  return role === 'SUPER_ADMIN' || role === 'CLINIC_ADMIN';
}

/**
 * Parse a numeric mapping id from the path.
 *
 * A non-numeric segment must fail here as 400: unchecked it becomes `NaN`, and `NaN`
 * reaching a SQL parameter has crashed the public booking page before.
 */
export function parseServiceId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function invalidIdResponse(): NextResponse {
  return NextResponse.json(
    { type: '/errors/validation-error', title: 'Invalid service id', status: 400 },
    { status: 400 },
  );
}

/** Mirrors `RoleGuardResult` in `src/lib/auth/route-guards.ts` — scope, or the response to send. */
export type ScopeResult = { scope: ServiceScope } | { response: NextResponse };

/**
 * `readScopeFor` for route handlers.
 *
 * `resolveKcActor` throws `KcError(..., 403)` when the JWT subject has no `wp_users` link,
 * and that is a live condition here — a WordPress account does not imply a `users` row.
 * `withAuth` only catches `AuthError`, so an uncaught `KcError` would surface as a 500 and
 * tell the caller nothing. It is the only thrower reachable from this call, and it always
 * uses 403.
 */
export async function scopeForRequest(actor: Actor): Promise<ScopeResult> {
  try {
    return { scope: await readScopeFor(actor) };
  } catch (err) {
    if (err instanceof KcError) {
      return { response: NextResponse.json(forbidden(err.message), { status: 403 }) };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.scope.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/scope.ts tests/services/service-catalog.scope.test.ts
git commit -m "feat(services): add the service scope matrix"
```

---

### Task 4: Validation schemas

**Files:**
- Create: `src/services/service-catalog/validation.ts`
- Test: `tests/services/service-catalog.validation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export const createServiceSchema: z.ZodType<{
  name: string; categoryId: number; price: number; duration: number;
  doctorIds: number[]; clinicId?: number;
  telemedService: 'yes' | 'no'; status: 0 | 1; isPublic: 0 | 1;
}>;
export const updateServiceSchema: z.ZodType<{
  name?: string; categoryId?: number; price?: number; duration?: number;
  telemedService?: 'yes' | 'no'; status?: 0 | 1; isPublic?: 0 | 1;
}>;
export const listServicesQuerySchema: z.ZodType<{
  page: number; perPage: number; search?: string;
  clinicId?: number; professionalId?: number; includeInactive?: boolean;
}>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export function toFieldErrors(err: z.ZodError): Record<string, string[]>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  toFieldErrors,
} from '@/services/service-catalog/validation';

const valid = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001],
};

describe('createServiceSchema', () => {
  it('accepts a minimal body and fills the defaults KiviCare uses', () => {
    const parsed = createServiceSchema.parse(valid);
    expect(parsed.telemedService).toBe('no');
    expect(parsed.status).toBe(1);
    expect(parsed.isPublic).toBe(1);
  });

  it('trims the name and rejects an empty one', () => {
    expect(createServiceSchema.parse({ ...valid, name: '  Terapi  ' }).name).toBe('Terapi');
    expect(createServiceSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('holds KiviCare duration bounds of 1..1440 minutes', () => {
    expect(createServiceSchema.safeParse({ ...valid, duration: 1 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, duration: 1440 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, duration: 0 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, duration: 1441 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, duration: 30.5 }).success).toBe(false);
  });

  it('requires at least one doctor', () => {
    expect(createServiceSchema.safeParse({ ...valid, doctorIds: [] }).success).toBe(false);
  });

  it('rejects a negative price but allows a free service', () => {
    expect(createServiceSchema.safeParse({ ...valid, price: 0 }).success).toBe(true);
    expect(createServiceSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('constrains the flags to what the columns hold', () => {
    expect(createServiceSchema.safeParse({ ...valid, telemedService: 'maybe' }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, status: 2 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...valid, isPublic: 2 }).success).toBe(false);
  });

  it('rejects maxClients rather than accepting a field the server would drop', () => {
    const parsed = createServiceSchema.parse({ ...valid, maxClients: 4 } as any);
    expect('maxClients' in parsed).toBe(false);
  });
});

describe('updateServiceSchema', () => {
  it('accepts a single field', () => {
    expect(updateServiceSchema.safeParse({ price: 300000 }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(updateServiceSchema.safeParse({}).success).toBe(false);
  });

  it('does not accept doctorIds or clinicId — moving a service means delete and recreate', () => {
    const parsed = updateServiceSchema.parse({ price: 1, doctorIds: [1], clinicId: 3 } as any);
    expect('doctorIds' in parsed).toBe(false);
    expect('clinicId' in parsed).toBe(false);
  });
});

describe('listServicesQuerySchema', () => {
  it('defaults the pagination', () => {
    const q = listServicesQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, perPage: 20 });
  });

  it('coerces numeric strings from the query string', () => {
    const q = listServicesQuerySchema.parse({ page: '2', perPage: '50', clinicId: '3' });
    expect(q).toMatchObject({ page: 2, perPage: 50, clinicId: 3 });
  });

  it('reads includeInactive=false as false, which z.coerce.boolean would not', () => {
    expect(listServicesQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
    expect(listServicesQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(listServicesQuerySchema.parse({}).includeInactive).toBeUndefined();
  });

  it('caps perPage at 100', () => {
    expect(listServicesQuerySchema.safeParse({ perPage: '500' }).success).toBe(false);
  });
});

describe('toFieldErrors', () => {
  it('groups zod issues by field path', () => {
    const result = createServiceSchema.safeParse({ ...valid, duration: 0, name: '' });
    expect(result.success).toBe(false);
    const fields = toFieldErrors((result as z.SafeParseError<unknown>).error);
    expect(Object.keys(fields).sort()).toEqual(['duration', 'name']);
    expect(fields.duration[0]).toMatch(/1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.validation.test.ts`
Expected: FAIL — cannot resolve `@/services/service-catalog/validation`.

- [ ] **Step 3: Write the schemas**

Create `src/services/service-catalog/validation.ts`:

```ts
/**
 * Request shapes for `/api/v1/services`.
 *
 * The bounds are KiviCare's, read off `DoctorServiceController::validateDuration` and
 * `::validateStatus` — 1..1440 minutes, status 0 or 1 — not invented here.
 */
import { z } from 'zod';

const flag = z.union([z.literal(0), z.literal(1)]);

const nameSchema = z.string().trim().min(1, 'Service name is required').max(255);
const durationSchema = z
  .number()
  .int('Duration must be a whole number of minutes')
  .min(1, 'Duration must be between 1 and 1440 minutes')
  .max(1440, 'Duration must be between 1 and 1440 minutes');
const priceSchema = z.number().min(0, 'Price cannot be negative');
const idSchema = z.number().int().positive();

/**
 * `.strip()` is the default, and it is load-bearing here: `maxClients` has no column
 * anywhere, and silently accepting it would be the exact pattern this dashboard has
 * already had cleaned out twice. Unknown keys are dropped, never stored.
 */
export const createServiceSchema = z.object({
  name: nameSchema,
  categoryId: idSchema,
  price: priceSchema,
  duration: durationSchema,
  doctorIds: z.array(idSchema).min(1, 'At least one professional is required'),
  /** Ignored for CLINIC_ADMIN, who is pinned to their own clinic. */
  clinicId: idSchema.optional(),
  telemedService: z.enum(['yes', 'no']).default('no'),
  status: flag.default(1),
  isPublic: flag.default(1),
});

/**
 * `doctorIds` and `clinicId` are absent on purpose. Moving a service to another
 * psychologist means deleting this mapping and creating another; that keeps PUT to one
 * row and one meaning.
 */
export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    categoryId: idSchema.optional(),
    price: priceSchema.optional(),
    duration: durationSchema.optional(),
    telemedService: z.enum(['yes', 'no']).optional(),
    status: flag.optional(),
    isPublic: flag.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

/**
 * `includeInactive` is parsed as a literal string rather than with `z.coerce.boolean()`,
 * which turns the string `'false'` into `true` — every non-empty string is truthy.
 */
export const listServicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  clinicId: z.coerce.number().int().positive().optional(),
  professionalId: z.coerce.number().int().positive().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

/** RFC 7807 `fields`: one array of messages per offending path. */
export function toFieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.validation.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/validation.ts tests/services/service-catalog.validation.test.ts
git commit -m "feat(services): add request schemas for the service endpoints"
```

---

### Task 5: Write repository

**Files:**
- Create: `src/repositories/wp/services.write.ts`
- Test: `tests/services/service-catalog.write.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `APPOINTMENT_STATUS` from `@/repositories/wp/appointments.repo`.
- Produces:

```ts
export function findCatalogueByNameAndType(name: string, type: string): Promise<{ id: bigint } | null>;
export function createCatalogue(input: {
  name: string; type: string; category: string | null; price: string; status: 0 | 1;
}): Promise<bigint>;
export function doctorsMappedToClinic(doctorIds: bigint[], clinicId: bigint): Promise<bigint[]>;
export function findConflictingMapping(opts: {
  doctorIds: bigint[]; clinicId: bigint; name: string; excludeMappingId?: bigint;
}): Promise<{ mappingId: bigint; doctorId: bigint } | null>;
export function insertMapping(input: {
  serviceId: bigint; doctorId: bigint; clinicId: bigint; charges: string;
  duration: number; telemedService: 'yes' | 'no'; status: 0 | 1; isPublic: 0 | 1;
}): Promise<bigint>;
export type MappingPatch = {
  serviceId?: bigint; charges?: string; duration?: number;
  telemedService?: 'yes' | 'no'; status?: 0 | 1; isPublic?: 0 | 1;
};
export function updateMapping(id: bigint, patch: MappingPatch): Promise<void>;
export function softDeleteMapping(id: bigint): Promise<number>;
export function countBlockingAppointments(opts: { serviceId: bigint; doctorId: bigint }): Promise<number>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.write.test.ts`:

```ts
/**
 * Service catalogue and mapping writes.
 *
 * Direct SQL on purpose: KiviCare's `kc_service_*` hooks only fire when `session_days`
 * is present, and we never send it. See services.write.ts for the full argument.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcService: { findFirst: vi.fn() },
  kcServiceDoctorMapping: { findFirst: vi.fn(), updateMany: vi.fn() },
  kcDoctorClinicMapping: { findMany: vi.fn() },
  $executeRawUnsafe: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  findCatalogueByNameAndType,
  createCatalogue,
  doctorsMappedToClinic,
  findConflictingMapping,
  insertMapping,
  updateMapping,
  softDeleteMapping,
  countBlockingAppointments,
} from '@/repositories/wp/services.write';

beforeEach(() => {
  db.kcService.findFirst.mockReset();
  db.kcServiceDoctorMapping.findFirst.mockReset();
  db.kcServiceDoctorMapping.updateMany.mockReset();
  db.kcDoctorClinicMapping.findMany.mockReset();
  db.$executeRawUnsafe.mockReset();
  db.$queryRawUnsafe.mockReset();
});

describe('findCatalogueByNameAndType', () => {
  it('matches on name and type together', async () => {
    db.kcService.findFirst.mockResolvedValue({ id: 101n });

    expect(await findCatalogueByNameAndType('Konseling', 'psychology_services')).toEqual({ id: 101n });
    expect(db.kcService.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'Konseling', type: 'psychology_services' } }),
    );
  });

  it('returns null when nothing matches', async () => {
    db.kcService.findFirst.mockResolvedValue(null);
    expect(await findCatalogueByNameAndType('Nope', 'x')).toBeNull();
  });
});

describe('createCatalogue', () => {
  it('inserts and returns the new id', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);
    db.$queryRawUnsafe.mockResolvedValue([{ id: 202 }]);

    const id = await createCatalogue({
      name: 'Terapi Keluarga',
      type: 'psychology_services',
      category: '{"id":7}',
      price: '400000',
      status: 1,
    });

    expect(id).toBe(202n);
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_services');
    expect(args).toEqual(['Terapi Keluarga', 'psychology_services', '{"id":7}', '400000', 1]);
  });
});

describe('doctorsMappedToClinic', () => {
  it('returns only the doctors actually mapped to the clinic', async () => {
    db.kcDoctorClinicMapping.findMany.mockResolvedValue([{ doctorId: 1n }, { doctorId: 2n }]);

    expect(await doctorsMappedToClinic([1n, 2n, 3n], 3n)).toEqual([1n, 2n]);
    expect(db.kcDoctorClinicMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 3n, doctorId: { in: [1n, 2n, 3n] } } }),
    );
  });

  it('short-circuits on an empty list without querying', async () => {
    expect(await doctorsMappedToClinic([], 3n)).toEqual([]);
    expect(db.kcDoctorClinicMapping.findMany).not.toHaveBeenCalled();
  });
});

describe('findConflictingMapping', () => {
  it('finds an existing mapping for the same doctor, clinic and service name', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ mapping_id: 501, doctor_id: 8100001 }]);

    const hit = await findConflictingMapping({
      doctorIds: [8100001n],
      clinicId: 3n,
      name: 'Konseling',
    });

    expect(hit).toEqual({ mappingId: 501n, doctorId: 8100001n });
    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('wp_kc_service_doctor_mapping');
    expect(args).toEqual([3n, 'Konseling', 8100001n]);
  });

  it('excludes the row being edited when asked', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);

    await findConflictingMapping({
      doctorIds: [8100001n],
      clinicId: 3n,
      name: 'Konseling',
      excludeMappingId: 501n,
    });

    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('sdm.id <> ?');
    expect(args).toEqual([3n, 'Konseling', 8100001n, 501n]);
  });

  it('returns null on an empty doctor list without querying', async () => {
    expect(await findConflictingMapping({ doctorIds: [], clinicId: 3n, name: 'x' })).toBeNull();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('insertMapping', () => {
  it('writes every column and returns the new id', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);
    db.$queryRawUnsafe.mockResolvedValue([{ id: 777 }]);

    const id = await insertMapping({
      serviceId: 101n,
      doctorId: 8100001n,
      clinicId: 3n,
      charges: '250000',
      duration: 60,
      telemedService: 'no',
      status: 1,
      isPublic: 1,
    });

    expect(id).toBe(777n);
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO wp_kc_service_doctor_mapping');
    expect(args).toEqual([101n, 8100001n, 3n, '250000', 60, 'no', 1, 1]);
  });
});

describe('updateMapping', () => {
  it('only writes the columns present in the patch', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    await updateMapping(501n, { charges: '300000', status: 0 });

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('charges = ?');
    expect(sql).toContain('status = ?');
    expect(sql).not.toContain('duration = ?');
    expect(args).toEqual(['300000', 0, 501n]);
  });

  it('does nothing at all for an empty patch', async () => {
    await updateMapping(501n, {});
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('can repoint the mapping to another catalogue row', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    await updateMapping(501n, { serviceId: 202n });

    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('service_id = ?');
    expect(args).toEqual([202n, 501n]);
  });
});

describe('softDeleteMapping', () => {
  it('sets status to 0 rather than deleting the row', async () => {
    db.$executeRawUnsafe.mockResolvedValue(1);

    expect(await softDeleteMapping(501n)).toBe(1);
    const [sql, ...args] = db.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain('SET status = 0');
    expect(sql).not.toContain('DELETE');
    expect(args).toEqual([501n]);
  });
});

describe('countBlockingAppointments', () => {
  it('counts future, non-cancelled appointments for the service and doctor', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ c: 2n }]);

    const count = await countBlockingAppointments({ serviceId: 101n, doctorId: 8100001n });

    expect(count).toBe(2);
    const [sql, ...args] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('wp_kc_appointment_service_mapping');
    expect(sql).toContain('a.appointment_start_date >= CURDATE()');
    // 0 is CANCELLED — the count must exclude it, and the literal must not be inlined.
    expect(args).toEqual([101n, 8100001n, 0]);
  });

  it('reads an empty result as zero', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    expect(await countBlockingAppointments({ serviceId: 1n, doctorId: 2n })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.write.test.ts`
Expected: FAIL — cannot resolve `@/repositories/wp/services.write`.

- [ ] **Step 3: Write the repository**

Create `src/repositories/wp/services.write.ts`:

```ts
/**
 * Service catalogue and doctor-mapping writes — direct SQL, deliberately.
 *
 * KiviCare exposes `kc_service_add` / `kc_service_update` / `kc_service_delete`, and the
 * only listener is `KCProServiceControllerFilters`, which writes `kc_service_sessions`
 * from `session_days`. In the controller itself, `kc_service_add` is only fired when
 * `session_days` is non-empty (DoctorServiceController.php:1398). We never send
 * `session_days` and have no UI for it, so writing straight to the tables skips no
 * listener.
 *
 * This is the opposite of appointments, where five listeners fire unconditionally and
 * writes therefore go through the praktiqu-endpoint plugin. If service-based timeslot
 * sessions are ever adopted, this file is what has to move behind the plugin.
 *
 * Reads live in `services.repo.ts`.
 */
import { prisma } from '@/lib/db';
import { APPOINTMENT_STATUS } from './appointments.repo';

/** Fetch the id of the last row this connection inserted. */
async function lastInsertId(): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT LAST_INSERT_ID() AS id`,
  );
  return BigInt(rows[0].id);
}

/* ------------------------------------------------------------------ */
/* Catalogue — wp_kc_services                                          */
/* ------------------------------------------------------------------ */

/**
 * The catalogue is global: it has no `clinic_id`, and KiviCare reuses a row whose name
 * *and* type both match rather than creating a near-duplicate. Two clinics offering
 * "Konseling Individu" share one row, which is why renames repoint instead of renaming.
 */
export async function findCatalogueByNameAndType(
  name: string,
  type: string,
): Promise<{ id: bigint } | null> {
  const row = await prisma.kcService.findFirst({
    where: { name, type },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return row ? { id: row.id } : null;
}

export async function createCatalogue(input: {
  name: string;
  type: string;
  /** JSON snapshot of the static-data row, as KiviCare stores it. */
  category: string | null;
  price: string;
  status: 0 | 1;
}): Promise<bigint> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_services (name, type, category, price, status, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    input.name,
    input.type,
    input.category,
    input.price,
    input.status,
  );
  return lastInsertId();
}

/* ------------------------------------------------------------------ */
/* Mapping — wp_kc_service_doctor_mapping                              */
/* ------------------------------------------------------------------ */

/** Which of these doctors actually work at this clinic. */
export async function doctorsMappedToClinic(
  doctorIds: bigint[],
  clinicId: bigint,
): Promise<bigint[]> {
  if (doctorIds.length === 0) return [];
  const rows = await prisma.kcDoctorClinicMapping.findMany({
    where: { clinicId, doctorId: { in: doctorIds } },
    select: { doctorId: true },
  });
  return rows.map((r) => r.doctorId);
}

/**
 * An existing mapping for any of these doctors, at this clinic, to a service of this
 * name — regardless of the catalogue row's `type`.
 *
 * Stricter than KiviCare, which only blocks when the type differs and otherwise inserts
 * a second identical mapping (:1249-1252). The table has no unique constraint, so those
 * twins are real, and `listServicesForDoctor` would return the service twice on the
 * booking page. `assignServiceToDoctor` already decided against twins; this follows it.
 */
export async function findConflictingMapping(opts: {
  doctorIds: bigint[];
  clinicId: bigint;
  name: string;
  excludeMappingId?: bigint;
}): Promise<{ mappingId: bigint; doctorId: bigint } | null> {
  if (opts.doctorIds.length === 0) return null;

  const placeholders = opts.doctorIds.map(() => '?').join(',');
  const exclude = opts.excludeMappingId !== undefined ? ' AND sdm.id <> ?' : '';
  const args: unknown[] = [opts.clinicId, opts.name, ...opts.doctorIds];
  if (opts.excludeMappingId !== undefined) args.push(opts.excludeMappingId);

  const rows = await prisma.$queryRawUnsafe<Array<{ mapping_id: bigint | number; doctor_id: bigint | number }>>(
    `SELECT sdm.id AS mapping_id, sdm.doctor_id AS doctor_id
       FROM wp_kc_service_doctor_mapping sdm
       JOIN wp_kc_services s ON s.id = sdm.service_id
      WHERE sdm.clinic_id = ?
        AND s.name = ?
        AND sdm.doctor_id IN (${placeholders})${exclude}
      LIMIT 1`,
    ...args,
  );

  if (rows.length === 0) return null;
  return { mappingId: BigInt(rows[0].mapping_id), doctorId: BigInt(rows[0].doctor_id) };
}

export async function insertMapping(input: {
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  charges: string;
  duration: number;
  telemedService: 'yes' | 'no';
  status: 0 | 1;
  isPublic: 0 | 1;
}): Promise<bigint> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_service_doctor_mapping
       (service_id, doctor_id, clinic_id, charges, duration, telemed_service, status, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    input.serviceId,
    input.doctorId,
    input.clinicId,
    input.charges,
    input.duration,
    input.telemedService,
    input.status,
    input.isPublic,
  );
  return lastInsertId();
}

export type MappingPatch = {
  /** Set when a rename repoints this mapping at a different catalogue row. */
  serviceId?: bigint;
  charges?: string;
  duration?: number;
  telemedService?: 'yes' | 'no';
  status?: 0 | 1;
  isPublic?: 0 | 1;
};

const PATCH_COLUMNS: Array<[keyof MappingPatch, string]> = [
  ['serviceId', 'service_id'],
  ['charges', 'charges'],
  ['duration', 'duration'],
  ['telemedService', 'telemed_service'],
  ['status', 'status'],
  ['isPublic', 'is_public'],
];

export async function updateMapping(id: bigint, patch: MappingPatch): Promise<void> {
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
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET ${sets.join(', ')} WHERE id = ?`,
    ...args,
  );
}

/**
 * Soft delete, matching `unassignServiceFromDoctor`.
 *
 * KiviCare hard-deletes here (:1643). We do not: the row carries the price and duration
 * a booking was made against, and a mistaken delete should be recoverable.
 */
export async function softDeleteMapping(id: bigint): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = 0 WHERE id = ?`,
    id,
  );
}

/**
 * Appointments that would be stranded by removing this offering.
 *
 * `wp_kc_appointment_service_mapping.service_id` points at the *catalogue*, so past
 * appointments keep their service name whatever happens to this mapping. What breaks is
 * a booking that has not happened yet: the service is still on it, but the psychologist
 * no longer offers it.
 */
export async function countBlockingAppointments(opts: {
  serviceId: bigint;
  doctorId: bigint;
}): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c
       FROM wp_kc_appointment_service_mapping asm
       JOIN wp_kc_appointments a ON a.id = asm.appointment_id
      WHERE asm.service_id = ?
        AND a.doctor_id = ?
        AND a.status <> ?
        AND a.appointment_start_date >= CURDATE()`,
    opts.serviceId,
    opts.doctorId,
    APPOINTMENT_STATUS.CANCELLED,
  );
  return rows.length === 0 ? 0 : Number(rows[0].c);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.write.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/services.write.ts tests/services/service-catalog.write.test.ts
git commit -m "feat(services): add catalogue and mapping writes"
```

---

### Task 6: Service layer — list and get

**Files:**
- Create: `src/services/service-catalog/service.ts`
- Test: `tests/services/service-catalog.read.test.ts`

**Interfaces:**
- Consumes: `listClinicServices`, `findMappingById`, `ClinicServiceRow` (Task 2); `ServiceScope` (Task 3); `ListServicesQuery` (Task 4).
- Produces:

```ts
export type ServiceSummary = {
  id: number; serviceId: number; doctorId: number; clinicId: number;
  name: string; category: { id: number; label: string | null; value: string | null } | null;
  price: number | null; durationMinutes: number | null;
  telemedService: 'yes' | 'no'; isPublic: boolean; isActive: boolean;
  createdAt: string;
};
export type ServiceCatalogError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'bad_request'; code: string; message: string }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string; count?: number };
export function isServiceCatalogError(err: unknown): err is ServiceCatalogError;
export function listServices(query: ListServicesQuery, scope: ServiceScope): Promise<{
  services: ServiceSummary[]; total: number; page: number; perPage: number;
}>;
export function getService(mappingId: number, scope: ServiceScope): Promise<ServiceSummary | null>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.read.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  listClinicServices: vi.fn(),
  findMappingById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', () => repo);

// Tasks 7-9 add write, static-data and logging imports to the same module. Mocking them
// here keeps this file hermetic as the module grows, rather than quietly pulling a real
// Prisma client in behind it.
vi.mock('@/repositories/wp/services.write', () => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/static-data.repo', () => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/lib/logging', () => ({ audit: vi.fn() }));

import { listServices, getService } from '@/services/service-catalog/service';
import type { ServiceScope } from '@/services/service-catalog/scope';

const row = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
  charges: '250000',
  durationMinutes: 60,
  telemedService: 'no',
  isPublic: true,
  isActive: true,
  nameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const superAdmin: ServiceScope = { clinicId: null, doctorId: null, empty: false };
const clinicAdmin: ServiceScope = { clinicId: 3n, doctorId: null, empty: false };
const otherClinic: ServiceScope = { clinicId: 9n, doctorId: null, empty: false };
const professional: ServiceScope = { clinicId: null, doctorId: 8100001n, empty: false };
const nothing: ServiceScope = { clinicId: null, doctorId: null, empty: true };

beforeEach(() => {
  repo.listClinicServices.mockReset();
  repo.findMappingById.mockReset();
  repo.listClinicServices.mockResolvedValue({ items: [row], total: 1, page: 1, perPage: 20 });
});

describe('listServices', () => {
  it('parses the category snapshot and normalises ids to numbers', async () => {
    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);

    expect(res.services[0]).toMatchObject({
      id: 501,
      serviceId: 101,
      doctorId: 8100001,
      clinicId: 3,
      name: 'Konseling Individu',
      price: 250000,
      durationMinutes: 60,
      telemedService: 'no',
    });
    expect(res.services[0].category).toEqual({
      id: 7,
      label: 'Psychology Services',
      value: 'psychology_services',
    });
  });

  it('survives a category snapshot that is not valid JSON', async () => {
    repo.listClinicServices.mockResolvedValue({
      items: [{ ...row, category: 'not json' }],
      total: 1,
      page: 1,
      perPage: 20,
    });

    const res = await listServices({ page: 1, perPage: 20 } as any, superAdmin);
    expect(res.services[0].category).toBeNull();
  });

  it("lets the scope's clinic override whatever the caller asked for", async () => {
    await listServices({ page: 1, perPage: 20, clinicId: 99 } as any, clinicAdmin);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 3n }),
    );
  });

  it('honours a clinicId filter when the scope is unrestricted', async () => {
    await listServices({ page: 1, perPage: 20, clinicId: 99 } as any, superAdmin);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 99n }),
    );
  });

  it("pins a professional to their own rows regardless of professionalId", async () => {
    await listServices({ page: 1, perPage: 20, professionalId: 42 } as any, professional);

    expect(repo.listClinicServices).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: 8100001n }),
    );
  });

  it('returns an empty page for an empty scope without touching the database', async () => {
    const res = await listServices({ page: 2, perPage: 20 } as any, nothing);

    expect(res).toEqual({ services: [], total: 0, page: 2, perPage: 20 });
    expect(repo.listClinicServices).not.toHaveBeenCalled();
  });
});

describe('getService', () => {
  it('returns the mapping when it is in scope', async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect((await getService(501, clinicAdmin))?.id).toBe(501);
  });

  it('returns null for a mapping in another clinic — the route turns this into a 404', async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect(await getService(501, otherClinic)).toBeNull();
  });

  it("returns null for another professional's mapping", async () => {
    repo.findMappingById.mockResolvedValue(row);

    expect(await getService(501, { clinicId: null, doctorId: 999n, empty: false })).toBeNull();
  });

  it('returns null when the mapping does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    expect(await getService(501, superAdmin)).toBeNull();
  });

  it('returns null for an empty scope without touching the database', async () => {
    expect(await getService(501, nothing)).toBeNull();
    expect(repo.findMappingById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.read.test.ts`
Expected: FAIL — cannot resolve `@/services/service-catalog/service`.

- [ ] **Step 3: Write the read half of the service layer**

Create `src/services/service-catalog/service.ts`:

```ts
/**
 * Clinic services — the business rules over `wp_kc_services` and
 * `wp_kc_service_doctor_mapping`.
 *
 * The resource is a mapping row: one service as offered by one psychologist at one
 * clinic. See docs/superpowers/specs/2026-08-30-services-crud-design.md.
 */
import {
  listClinicServices,
  findMappingById,
  type ClinicServiceRow,
} from '@/repositories/wp/services.repo';
import type { ServiceScope } from './scope';
import type { ListServicesQuery } from './validation';

export type ServiceCategory = { id: number; label: string | null; value: string | null };

export type ServiceSummary = {
  /** The mapping id — what `/api/v1/services/{id}` addresses. */
  id: number;
  serviceId: number;
  doctorId: number;
  clinicId: number;
  name: string;
  category: ServiceCategory | null;
  /** The doctor's charge, which is what a client actually pays. */
  price: number | null;
  durationMinutes: number | null;
  telemedService: 'yes' | 'no';
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
};

export type ServiceCatalogError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'bad_request'; code: string; message: string }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string; count?: number };

export function isServiceCatalogError(err: unknown): err is ServiceCatalogError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

/**
 * KiviCare stores the category as a JSON snapshot rather than a foreign key, so the
 * label survives the static-data row being deleted. A snapshot written by hand, or by an
 * older KiviCare, may not parse — treat that as "no category" rather than a 500.
 */
function parseCategory(raw: string | null): ServiceCategory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceCategory>;
    if (typeof parsed?.id !== 'number') return null;
    return { id: parsed.id, label: parsed.label ?? null, value: parsed.value ?? null };
  } catch {
    return null;
  }
}

function toSummary(row: ClinicServiceRow): ServiceSummary {
  return {
    id: Number(row.id),
    serviceId: Number(row.serviceId),
    doctorId: Number(row.doctorId),
    clinicId: Number(row.clinicId),
    // A doctor-specific alias wins over the catalogue name, matching what KiviCare shows.
    name: row.nameAlias ?? row.name,
    category: parseCategory(row.category),
    price: row.charges === null ? null : Number(row.charges),
    durationMinutes: row.durationMinutes,
    telemedService: row.telemedService === 'yes' ? 'yes' : 'no',
    isPublic: row.isPublic,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Visible to this scope? Both dimensions must pass; `null` means unrestricted. */
function inScope(row: ClinicServiceRow, scope: ServiceScope): boolean {
  if (scope.clinicId !== null && row.clinicId !== scope.clinicId) return false;
  if (scope.doctorId !== null && row.doctorId !== scope.doctorId) return false;
  return true;
}

export async function listServices(
  query: ListServicesQuery,
  scope: ServiceScope,
): Promise<{ services: ServiceSummary[]; total: number; page: number; perPage: number }> {
  if (scope.empty) {
    return { services: [], total: 0, page: query.page, perPage: query.perPage };
  }

  // The scope wins over the query string. A clinic admin asking for another clinic gets
  // their own, not a 403 — the other clinic simply is not addressable for them.
  const clinicId =
    scope.clinicId ?? (query.clinicId !== undefined ? BigInt(query.clinicId) : undefined);
  const doctorId =
    scope.doctorId ?? (query.professionalId !== undefined ? BigInt(query.professionalId) : undefined);

  const page = await listClinicServices({
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    clinicId,
    doctorId,
    includeInactive: query.includeInactive,
  });

  return {
    services: page.items.map(toSummary),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
  };
}

/**
 * One mapping, or `null`.
 *
 * Out of scope and does-not-exist collapse into the same `null` on purpose: the route
 * answers 404 for both, so a clinic admin cannot probe for another clinic's ids.
 */
export async function getService(
  mappingId: number,
  scope: ServiceScope,
): Promise<ServiceSummary | null> {
  if (scope.empty) return null;

  const row = await findMappingById(BigInt(mappingId));
  if (!row || !inScope(row, scope)) return null;
  return toSummary(row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.read.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/service.ts tests/services/service-catalog.read.test.ts
git commit -m "feat(services): add service listing and lookup with scope"
```

---

### Task 7: Service layer — create

**Files:**
- Modify: `src/services/service-catalog/service.ts` (append)
- Test: `tests/services/service-catalog.create.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 5, 6.
- Produces:

```ts
export type CreatedService = {
  serviceId: number;
  name: string;
  category: ServiceCategory;
  mappings: Array<{ id: number; doctorId: number }>;
};
export function createService(
  input: CreateServiceInput,
  clinicId: number,
  actorId: string,
): Promise<CreatedService>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.create.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/services.write', () => write);

const staticData = vi.hoisted(() => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/repositories/wp/static-data.repo', () => staticData);

const logging = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('@/lib/logging', () => logging);

import { createService } from '@/services/service-catalog/service';

const input = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001, 8100002],
  telemedService: 'no' as const,
  status: 1 as const,
  isPublic: 1 as const,
};

const category = {
  id: 7n,
  type: 'service_type',
  label: 'Psychology Services',
  value: 'psychology_services',
  parentId: null,
  isActive: true,
  createdAt: new Date(),
};

beforeEach(() => {
  Object.values(write).forEach((f) => f.mockReset());
  staticData.findServiceTypeById.mockReset();
  logging.audit.mockReset();

  staticData.findServiceTypeById.mockResolvedValue(category);
  write.doctorsMappedToClinic.mockResolvedValue([8100001n, 8100002n]);
  write.findConflictingMapping.mockResolvedValue(null);
  write.findCatalogueByNameAndType.mockResolvedValue(null);
  write.createCatalogue.mockResolvedValue(101n);
  write.insertMapping.mockResolvedValueOnce(501n).mockResolvedValueOnce(502n);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('createService', () => {
  it('creates one catalogue row and one mapping per psychologist', async () => {
    const result = await createService(input, 3, 'actor-1');

    expect(write.createCatalogue).toHaveBeenCalledWith({
      name: 'Konseling Individu',
      type: 'psychology_services',
      category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
      price: '250000',
      status: 1,
    });
    expect(write.insertMapping).toHaveBeenCalledTimes(2);
    expect(result.mappings).toEqual([
      { id: 501, doctorId: 8100001 },
      { id: 502, doctorId: 8100002 },
    ]);
  });

  it('writes the price as a string into both columns', async () => {
    await createService(input, 3, 'actor-1');

    expect(write.createCatalogue.mock.calls[0][0].price).toBe('250000');
    expect(write.insertMapping.mock.calls[0][0].charges).toBe('250000');
  });

  it('reuses an existing catalogue row with the same name and type', async () => {
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    const result = await createService(input, 3, 'actor-1');

    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(result.serviceId).toBe(909);
    expect(write.insertMapping.mock.calls[0][0].serviceId).toBe(909n);
  });

  it('rejects an unknown category with a validation error', async () => {
    staticData.findServiceTypeById.mockResolvedValue(null);
    await expectError(() => createService(input, 3, 'actor-1'), 'validation');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('rejects psychologists who do not work at the clinic', async () => {
    write.doctorsMappedToClinic.mockResolvedValue([8100001n]);
    await expectError(() => createService(input, 3, 'actor-1'), 'bad_request');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('rejects a duplicate offering with a conflict', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await expectError(() => createService(input, 3, 'actor-1'), 'conflict');
    expect(write.insertMapping).not.toHaveBeenCalled();
  });

  it('checks for a duplicate before creating any catalogue row', async () => {
    write.findConflictingMapping.mockResolvedValue({ mappingId: 400n, doctorId: 8100001n });
    await createService(input, 3, 'actor-1').catch(() => undefined);
    expect(write.createCatalogue).not.toHaveBeenCalled();
  });

  it('audits the creation', async () => {
    await createService(input, 3, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.created',
      expect.objectContaining({ userId: 'actor-1', resource: 'service' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.create.test.ts`
Expected: FAIL — `createService is not a function`.

- [ ] **Step 3: Implement create**

Append to `src/services/service-catalog/service.ts`. First extend the imports at the top of the file:

```ts
import {
  findCatalogueByNameAndType,
  createCatalogue,
  doctorsMappedToClinic,
  findConflictingMapping,
  insertMapping,
  type MappingPatch,
} from '@/repositories/wp/services.write';
import { findServiceTypeById } from '@/repositories/wp/static-data.repo';
import { audit } from '@/lib/logging';
import type { CreateServiceInput } from './validation';
```

Then append:

```ts
/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export type CreatedService = {
  serviceId: number;
  name: string;
  category: ServiceCategory;
  mappings: Array<{ id: number; doctorId: number }>;
};

/**
 * Resolve `categoryId` into the two things the catalogue row needs: the `type` string
 * and the JSON snapshot KiviCare keeps beside it.
 */
async function resolveCategory(categoryId: number): Promise<{ type: string; json: string; category: ServiceCategory }> {
  const row = await findServiceTypeById(BigInt(categoryId));
  if (!row) {
    throw {
      _tag: 'validation',
      errors: { categoryId: ['Unknown service category'] },
    } satisfies ServiceCatalogError;
  }
  const category: ServiceCategory = { id: Number(row.id), label: row.label, value: row.value };
  return { type: row.value ?? '', json: JSON.stringify(category), category };
}

export async function createService(
  input: CreateServiceInput,
  clinicId: number,
  actorId: string,
): Promise<CreatedService> {
  const { type, json, category } = await resolveCategory(input.categoryId);

  const doctorIds = input.doctorIds.map((d) => BigInt(d));
  const clinic = BigInt(clinicId);

  // KiviCare refuses the whole request when any doctor is not at the clinic rather than
  // silently creating the subset, and that is the right call: a partially applied create
  // is harder to notice than a rejection.
  const mapped = await doctorsMappedToClinic(doctorIds, clinic);
  const unmapped = doctorIds.filter((d) => !mapped.includes(d));
  if (unmapped.length > 0) {
    throw {
      _tag: 'bad_request',
      code: 'doctors_not_in_clinic',
      message: `Professionals not assigned to this clinic: ${unmapped.join(', ')}`,
    } satisfies ServiceCatalogError;
  }

  const conflict = await findConflictingMapping({ doctorIds, clinicId: clinic, name: input.name });
  if (conflict) {
    throw {
      _tag: 'conflict',
      code: 'service_already_offered',
      message: `Professional ${conflict.doctorId} already offers a service named "${input.name}" at this clinic`,
    } satisfies ServiceCatalogError;
  }

  const price = String(input.price);

  // The catalogue is global, so an identical name+type from another clinic is reused
  // rather than duplicated — this is KiviCare's own behaviour.
  const existing = await findCatalogueByNameAndType(input.name, type);
  const serviceId =
    existing?.id ??
    (await createCatalogue({ name: input.name, type, category: json, price, status: 1 }));

  const mappings: Array<{ id: number; doctorId: number }> = [];
  for (const doctorId of doctorIds) {
    const id = await insertMapping({
      serviceId,
      doctorId,
      clinicId: clinic,
      charges: price,
      duration: input.duration,
      telemedService: input.telemedService,
      status: input.status,
      isPublic: input.isPublic,
    });
    mappings.push({ id: Number(id), doctorId: Number(doctorId) });
  }

  await audit('service.created', {
    userId: actorId,
    resource: 'service',
    resourceId: String(serviceId),
    metadata: { name: input.name, clinicId, mappingIds: mappings.map((m) => m.id) },
  });

  return { serviceId: Number(serviceId), name: input.name, category, mappings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.create.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Re-run the read tests, which share the module**

Run: `npx vitest run tests/services/service-catalog.read.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/service-catalog/service.ts tests/services/service-catalog.create.test.ts
git commit -m "feat(services): create a service with its per-professional mappings"
```

---

### Task 8: Service layer — update

**Files:**
- Modify: `src/services/service-catalog/service.ts` (append)
- Test: `tests/services/service-catalog.update.test.ts`

**Interfaces:**
- Consumes: Task 7's `resolveCategory`, `MappingPatch` (Task 5), `updateMapping`, `findCatalogueByNameAndType`, `createCatalogue`, `findConflictingMapping`.
- Produces: `updateService(mappingId: number, input: UpdateServiceInput, scope: ServiceScope, actorId: string): Promise<ServiceSummary>`

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.update.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/services.write', () => write);

const staticData = vi.hoisted(() => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/repositories/wp/static-data.repo', () => staticData);

const logging = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('@/lib/logging', () => logging);

import { updateService } from '@/services/service-catalog/service';
import type { ServiceScope } from '@/services/service-catalog/scope';

const row = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: '{"id":7,"label":"Psychology Services","value":"psychology_services"}',
  charges: '250000',
  durationMinutes: 60,
  telemedService: 'no',
  isPublic: true,
  isActive: true,
  nameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const clinicAdmin: ServiceScope = { clinicId: 3n, doctorId: null, empty: false };
const otherClinic: ServiceScope = { clinicId: 9n, doctorId: null, empty: false };

beforeEach(() => {
  Object.values(write).forEach((f) => f.mockReset());
  repo.findMappingById.mockReset();
  staticData.findServiceTypeById.mockReset();
  logging.audit.mockReset();

  repo.findMappingById.mockResolvedValue(row);
  write.findConflictingMapping.mockResolvedValue(null);
  write.updateMapping.mockResolvedValue(undefined);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('updateService', () => {
  it('writes price into charges and leaves the shared catalogue row alone', async () => {
    await updateService(501, { price: 300000 }, clinicAdmin, 'actor-1');

    expect(write.updateMapping).toHaveBeenCalledWith(501n, { charges: '300000' });
    expect(write.createCatalogue).not.toHaveBeenCalled();
  });

  it('patches only the fields it was given', async () => {
    await updateService(501, { duration: 90, status: 0 }, clinicAdmin, 'actor-1');

    expect(write.updateMapping).toHaveBeenCalledWith(501n, { duration: 90, status: 0 });
  });

  it('repoints to an existing catalogue row on rename instead of renaming it', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).not.toHaveBeenCalled();
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 909n });
  });

  it('creates a new catalogue row when the new name and type are unknown', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(202n);

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.createCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Terapi Keluarga', type: 'psychology_services' }),
    );
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 202n });
  });

  it('repoints on a category change even when the name is unchanged', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 9n, label: 'Assessment', value: 'assessment',
    });
    write.findCatalogueByNameAndType.mockResolvedValue(null);
    write.createCatalogue.mockResolvedValue(303n);

    await updateService(501, { categoryId: 9 }, clinicAdmin, 'actor-1');

    expect(write.findCatalogueByNameAndType).toHaveBeenCalledWith('Konseling Individu', 'assessment');
    expect(write.updateMapping).toHaveBeenCalledWith(501n, { serviceId: 303n });
  });

  it('rejects a rename that collides with another service of the same professional', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findConflictingMapping.mockResolvedValue({ mappingId: 600n, doctorId: 8100001n });

    await expectError(
      () => updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1'),
      'conflict',
    );
    expect(write.updateMapping).not.toHaveBeenCalled();
  });

  it('excludes the row being edited from the collision check', async () => {
    staticData.findServiceTypeById.mockResolvedValue({
      id: 7n, label: 'Psychology Services', value: 'psychology_services',
    });
    write.findCatalogueByNameAndType.mockResolvedValue({ id: 909n });

    await updateService(501, { name: 'Terapi Keluarga' }, clinicAdmin, 'actor-1');

    expect(write.findConflictingMapping).toHaveBeenCalledWith(
      expect.objectContaining({ excludeMappingId: 501n }),
    );
  });

  it('rejects an unknown category', async () => {
    staticData.findServiceTypeById.mockResolvedValue(null);

    await expectError(() => updateService(501, { categoryId: 99 }, clinicAdmin, 'actor-1'), 'validation');
  });

  it('404s a mapping in another clinic', async () => {
    await expectError(() => updateService(501, { price: 1 }, otherClinic, 'actor-1'), 'not_found');
  });

  it('404s a mapping that does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    await expectError(() => updateService(501, { price: 1 }, clinicAdmin, 'actor-1'), 'not_found');
  });

  it('audits the update', async () => {
    await updateService(501, { price: 300000 }, clinicAdmin, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.updated',
      expect.objectContaining({ userId: 'actor-1', resource: 'service', resourceId: '501' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.update.test.ts`
Expected: FAIL — `updateService is not a function`.

- [ ] **Step 3: Implement update**

Two import lines change first. Add `updateMapping` to the `@/repositories/wp/services.write`
import (Task 7 added the block but not this name), and add `UpdateServiceInput` to the
`./validation` type import:

```ts
import {
  findCatalogueByNameAndType,
  createCatalogue,
  doctorsMappedToClinic,
  findConflictingMapping,
  insertMapping,
  updateMapping,
  type MappingPatch,
} from '@/repositories/wp/services.write';
import type { CreateServiceInput, UpdateServiceInput } from './validation';
```

Then append:

```ts
/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

/**
 * Update one offering.
 *
 * A rename never renames the catalogue row: it is global, and another clinic may be
 * offering the same service from it. Instead the mapping is repointed at a row carrying
 * the new name and type, created if none exists — KiviCare's own approach (:1455-1499).
 *
 * `price` updates only `charges`. KiviCare also rewrites `wp_kc_services.price` here,
 * which silently changes the list price other clinics see; the effective price is
 * `charges` either way, so the cross-clinic write buys nothing.
 */
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

  const patch: MappingPatch = {};
  if (input.price !== undefined) patch.charges = String(input.price);
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.telemedService !== undefined) patch.telemedService = input.telemedService;
  if (input.status !== undefined) patch.status = input.status;
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic;

  const renaming = input.name !== undefined && input.name !== existing.name;
  const recategorising = input.categoryId !== undefined;

  if (renaming || recategorising) {
    // The catalogue row's identity is name *and* type, so changing either means finding
    // or creating a different row.
    const resolved = recategorising ? await resolveCategory(input.categoryId!) : null;
    const type = resolved?.type ?? existing.type ?? '';
    const name = input.name ?? existing.name;

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

    const reuse = await findCatalogueByNameAndType(name, type);
    patch.serviceId =
      reuse?.id ??
      (await createCatalogue({
        name,
        type,
        category: resolved?.json ?? existing.category,
        price: patch.charges ?? existing.charges ?? '0',
        status: 1,
      }));
  }

  await updateMapping(existing.id, patch);

  await audit('service.updated', {
    userId: actorId,
    resource: 'service',
    resourceId: String(existing.id),
    metadata: { patch: { ...patch, serviceId: patch.serviceId?.toString() } },
  });

  const refreshed = await findMappingById(existing.id);
  if (!refreshed) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  return toSummary(refreshed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.update.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/service-catalog/service.ts tests/services/service-catalog.update.test.ts
git commit -m "feat(services): update an offering, repointing the catalogue on rename"
```

---

### Task 9: Service layer — delete

**Files:**
- Modify: `src/services/service-catalog/service.ts` (append)
- Test: `tests/services/service-catalog.delete.test.ts`

**Interfaces:**
- Consumes: `softDeleteMapping`, `countBlockingAppointments` (Task 5).
- Produces: `deleteService(mappingId: number, scope: ServiceScope, actorId: string): Promise<{ ok: true }>`

- [ ] **Step 1: Write the failing test**

Create `tests/services/service-catalog.delete.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ listClinicServices: vi.fn(), findMappingById: vi.fn() }));
vi.mock('@/repositories/wp/services.repo', () => repo);

const write = vi.hoisted(() => ({
  findCatalogueByNameAndType: vi.fn(),
  createCatalogue: vi.fn(),
  doctorsMappedToClinic: vi.fn(),
  findConflictingMapping: vi.fn(),
  insertMapping: vi.fn(),
  updateMapping: vi.fn(),
  softDeleteMapping: vi.fn(),
  countBlockingAppointments: vi.fn(),
}));
vi.mock('@/repositories/wp/services.write', () => write);

const staticData = vi.hoisted(() => ({ findServiceTypeById: vi.fn() }));
vi.mock('@/repositories/wp/static-data.repo', () => staticData);

const logging = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('@/lib/logging', () => logging);

import { deleteService } from '@/services/service-catalog/service';
import type { ServiceScope } from '@/services/service-catalog/scope';

const row = {
  id: 501n,
  serviceId: 101n,
  doctorId: 8100001n,
  clinicId: 3n,
  name: 'Konseling Individu',
  type: 'psychology_services',
  category: null,
  charges: '250000',
  durationMinutes: 60,
  telemedService: 'no',
  isPublic: true,
  isActive: true,
  nameAlias: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const clinicAdmin: ServiceScope = { clinicId: 3n, doctorId: null, empty: false };
const otherClinic: ServiceScope = { clinicId: 9n, doctorId: null, empty: false };

beforeEach(() => {
  Object.values(write).forEach((f) => f.mockReset());
  repo.findMappingById.mockReset();
  logging.audit.mockReset();

  repo.findMappingById.mockResolvedValue(row);
  write.countBlockingAppointments.mockResolvedValue(0);
  write.softDeleteMapping.mockResolvedValue(1);
});

const expectError = async (fn: () => Promise<unknown>, tag: string) => {
  await expect(fn()).rejects.toMatchObject({ _tag: tag });
};

describe('deleteService', () => {
  it('soft-deletes when nothing upcoming uses the service', async () => {
    expect(await deleteService(501, clinicAdmin, 'actor-1')).toEqual({ ok: true });
    expect(write.softDeleteMapping).toHaveBeenCalledWith(501n);
  });

  it('checks the catalogue service id against this mapping’s doctor', async () => {
    await deleteService(501, clinicAdmin, 'actor-1');

    expect(write.countBlockingAppointments).toHaveBeenCalledWith({
      serviceId: 101n,
      doctorId: 8100001n,
    });
  });

  it('refuses with a conflict when upcoming appointments exist, and reports how many', async () => {
    write.countBlockingAppointments.mockResolvedValue(3);

    await expect(deleteService(501, clinicAdmin, 'actor-1')).rejects.toMatchObject({
      _tag: 'conflict',
      count: 3,
    });
    expect(write.softDeleteMapping).not.toHaveBeenCalled();
  });

  it('404s a mapping in another clinic', async () => {
    await expectError(() => deleteService(501, otherClinic, 'actor-1'), 'not_found');
    expect(write.countBlockingAppointments).not.toHaveBeenCalled();
  });

  it('404s a mapping that does not exist', async () => {
    repo.findMappingById.mockResolvedValue(null);

    await expectError(() => deleteService(501, clinicAdmin, 'actor-1'), 'not_found');
  });

  it('audits the deletion', async () => {
    await deleteService(501, clinicAdmin, 'actor-1');

    expect(logging.audit).toHaveBeenCalledWith(
      'service.deleted',
      expect.objectContaining({ userId: 'actor-1', resource: 'service', resourceId: '501' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/service-catalog.delete.test.ts`
Expected: FAIL — `deleteService is not a function`.

- [ ] **Step 3: Implement delete**

Add `softDeleteMapping` and `countBlockingAppointments` to the `services.write` import, then append:

```ts
/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

/**
 * Retire an offering.
 *
 * Soft, and refused while a future booking still points at it. Past appointments are
 * safe either way — `wp_kc_appointment_service_mapping` references the catalogue, which
 * we never delete — but an upcoming one would be left naming a service its psychologist
 * no longer offers.
 */
export async function deleteService(
  mappingId: number,
  scope: ServiceScope,
  actorId: string,
): Promise<{ ok: true }> {
  const existing = scope.empty ? null : await findMappingById(BigInt(mappingId));
  if (!existing || !inScope(existing, scope)) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }

  const blocking = await countBlockingAppointments({
    serviceId: existing.serviceId,
    doctorId: existing.doctorId,
  });
  if (blocking > 0) {
    throw {
      _tag: 'conflict',
      code: 'service_has_upcoming_appointments',
      message: `${blocking} upcoming appointment(s) still use this service. Cancel or reschedule them first.`,
      count: blocking,
    } satisfies ServiceCatalogError;
  }

  await softDeleteMapping(existing.id);

  await audit('service.deleted', {
    userId: actorId,
    resource: 'service',
    resourceId: String(existing.id),
    metadata: { serviceId: Number(existing.serviceId), clinicId: Number(existing.clinicId) },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/service-catalog.delete.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole service-catalog suite and the type checker**

Run: `npx vitest run tests/services && npm run type-check`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/service-catalog/service.ts tests/services/service-catalog.delete.test.ts
git commit -m "feat(services): soft-delete an offering, gated on upcoming appointments"
```

---

### Task 10: Collection route — `GET` and `POST /api/v1/services`

**Files:**
- Create: `src/app/api/v1/services/route.ts`
- Test: `tests/integration/services/collection-route.test.ts`

**Interfaces:**
- Consumes: `listServices`, `createService`, `isServiceCatalogError` (Tasks 6–7); `readScopeFor`, `canWrite` (Task 3); `listServicesQuerySchema`, `createServiceSchema`, `toFieldErrors` (Task 4).
- Produces: `GET` and `POST` handlers.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/services/collection-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ actor: { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
}));

const scope = vi.hoisted(() => ({ scopeForRequest: vi.fn(), canWrite: vi.fn() }));
vi.mock('@/services/service-catalog/scope', async (orig) => ({
  ...(await orig<any>()),
  ...scope,
}));

const svc = vi.hoisted(() => ({ listServices: vi.fn(), createService: vi.fn() }));
vi.mock('@/services/service-catalog/service', async (orig) => ({
  ...(await orig<any>()),
  ...svc,
}));

import { NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/v1/services/route';

const get = (qs = '') => new NextRequest(`http://localhost/api/v1/services${qs}`);
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/services', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const validBody = {
  name: 'Konseling Individu',
  categoryId: 7,
  price: 250000,
  duration: 60,
  doctorIds: [8100001],
};

beforeEach(() => {
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  scope.scopeForRequest.mockReset();
  scope.canWrite.mockReset();
  svc.listServices.mockReset();
  svc.createService.mockReset();

  scope.scopeForRequest.mockResolvedValue({
    scope: { clinicId: 3n, doctorId: null, empty: false },
  });
  scope.canWrite.mockReturnValue(true);
  svc.listServices.mockResolvedValue({ services: [], total: 0, page: 1, perPage: 20 });
  svc.createService.mockResolvedValue({
    serviceId: 101,
    name: 'Konseling Individu',
    category: { id: 7, label: 'Psychology Services', value: 'psychology_services' },
    mappings: [{ id: 501, doctorId: 8100001 }],
  });
});

describe('GET /api/v1/services', () => {
  it('returns the paginated list', async () => {
    const res = await GET(get('?page=1&perPage=20'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ services: [], total: 0 });
  });

  it('rejects an unparseable query with 422', async () => {
    const res = await GET(get('?perPage=500'));

    expect(res.status).toBe(422);
    expect(svc.listServices).not.toHaveBeenCalled();
  });

  it('passes the parsed query and scope straight through', async () => {
    await GET(get('?search=Konseling&includeInactive=true'));

    expect(svc.listServices).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Konseling', includeInactive: true }),
      expect.objectContaining({ clinicId: 3n }),
    );
  });
});

describe('POST /api/v1/services', () => {
  it('creates and answers 201', async () => {
    const res = await POST(post(validBody));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ serviceId: 101 });
    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 3, 'actor-1');
  });

  it('refuses a role that cannot write with 403', async () => {
    scope.canWrite.mockReturnValue(false);

    const res = await POST(post(validBody));

    expect(res.status).toBe(403);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400', async () => {
    const res = await POST(post('{ not json'));

    expect(res.status).toBe(400);
  });

  it('rejects an invalid body with 422 and field errors', async () => {
    const res = await POST(post({ ...validBody, duration: 0 }));

    expect(res.status).toBe(422);
    expect((await res.json()).fields).toHaveProperty('duration');
  });

  it("ignores a clinicId the admin does not own", async () => {
    await POST(post({ ...validBody, clinicId: 99 }));

    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 3, 'actor-1');
  });

  it('lets a SUPER_ADMIN choose the clinic', async () => {
    auth.actor = { id: 'root', role: 'SUPER_ADMIN', practiceId: null };
    scope.scopeForRequest.mockResolvedValue({
      scope: { clinicId: null, doctorId: null, empty: false },
    });

    await POST(post({ ...validBody, clinicId: 99 }));

    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 99, 'root');
  });

  it('asks a SUPER_ADMIN for a clinic when none is given', async () => {
    auth.actor = { id: 'root', role: 'SUPER_ADMIN', practiceId: null };
    scope.scopeForRequest.mockResolvedValue({
      scope: { clinicId: null, doctorId: null, empty: false },
    });

    const res = await POST(post(validBody));

    expect(res.status).toBe(422);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('maps a service-layer conflict to 409', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_already_offered',
      message: 'already offered',
    });

    expect((await POST(post(validBody))).status).toBe(409);
  });

  it('maps a doctors-not-in-clinic error to 400', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'bad_request',
      code: 'doctors_not_in_clinic',
      message: 'nope',
    });

    expect((await POST(post(validBody))).status).toBe(400);
  });

  it('passes a scope-layer 403 straight through instead of throwing', async () => {
    scope.scopeForRequest.mockResolvedValue({
      response: NextResponse.json({ status: 403 }, { status: 403 }),
    });

    expect((await POST(post(validBody))).status).toBe(403);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('maps an unknown-category error to 422', async () => {
    svc.createService.mockRejectedValue({
      _tag: 'validation',
      errors: { categoryId: ['Unknown service category'] },
    });

    expect((await POST(post(validBody))).status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/services/collection-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/v1/services/route`.

- [ ] **Step 3: Write the route**

Create `src/app/api/v1/services/route.ts`:

```ts
/**
 * GET  /api/v1/services — list the services offered at a clinic
 * POST /api/v1/services — create one, with a mapping per psychologist
 *
 * A "service" here is a `wp_kc_service_doctor_mapping` row. See
 * docs/superpowers/specs/2026-08-30-services-crud-design.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { Actor } from '@/lib/auth';
import { badRequest, conflict, forbidden, validationError } from '@/lib/problem-details';
import { scopeForRequest, canWrite } from '@/services/service-catalog/scope';
import {
  listServices,
  createService,
  isServiceCatalogError,
} from '@/services/service-catalog/service';
import {
  listServicesQuerySchema,
  createServiceSchema,
  toFieldErrors,
} from '@/services/service-catalog/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as { actor: Actor };

  const parsed = listServicesQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      validationError('invalid_query', 'Invalid query parameters', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  return NextResponse.json(await listServices(parsed.data, scoped.scope));
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as { actor: Actor };

  if (!canWrite(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin and Clinic Admin can create services'),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      validationError('invalid_json', 'Request body must be valid JSON'),
      { status: 400 },
    );
  }

  const parsed = createServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid service data', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  // A clinic admin is pinned to their own clinic whatever the body says. A super admin
  // has no clinic of their own, so they must name one.
  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  const clinicId = scoped.scope.clinicId ?? (parsed.data.clinicId ?? null);
  if (clinicId === null) {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['clinicId is required for this role'],
      }),
      { status: 422 },
    );
  }

  try {
    const created = await createService(parsed.data, Number(clinicId), actor.id);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isServiceCatalogError(err)) {
      if (err._tag === 'validation') {
        return NextResponse.json(
          validationError('validation_failed', 'Invalid service data', undefined, err.errors),
          { status: 422 },
        );
      }
      if (err._tag === 'bad_request') {
        return NextResponse.json(badRequest(err.code, err.message), { status: 400 });
      }
      if (err._tag === 'conflict') {
        return NextResponse.json(conflict(err.code, err.message), { status: 409 });
      }
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/services/collection-route.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/services/route.ts tests/integration/services/collection-route.test.ts
git commit -m "feat(services): add GET and POST /api/v1/services"
```

---

### Task 11: Item route — `GET`, `PUT`, `DELETE /api/v1/services/{id}`

**Files:**
- Create: `src/app/api/v1/services/[id]/route.ts`
- Test: `tests/integration/services/item-route.test.ts`

**Interfaces:**
- Consumes: `getService`, `updateService`, `deleteService`, `isServiceCatalogError` (Tasks 6, 8, 9); `readScopeFor`, `canWrite`, `parseServiceId`, `invalidIdResponse` (Task 3); `updateServiceSchema`, `toFieldErrors` (Task 4).
- Produces: `GET`, `PUT`, `DELETE` handlers.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/services/item-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ actor: { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null } }));
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: any) => (req: any, ctx?: any) =>
    handler(req, { actor: auth.actor, params: ctx?.params ?? {} }),
}));

const scope = vi.hoisted(() => ({ scopeForRequest: vi.fn(), canWrite: vi.fn() }));
vi.mock('@/services/service-catalog/scope', async (orig) => ({
  ...(await orig<any>()),
  ...scope,
}));

const svc = vi.hoisted(() => ({
  getService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
}));
vi.mock('@/services/service-catalog/service', async (orig) => ({
  ...(await orig<any>()),
  ...svc,
}));

import { NextResponse } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/v1/services/[id]/route';

const url = 'http://localhost/api/v1/services/501';
const ctx = (id: string) => ({ params: { id } });
const req = (method = 'GET', body?: unknown) =>
  new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
  });

const summary = { id: 501, serviceId: 101, name: 'Konseling Individu' };

beforeEach(() => {
  auth.actor = { id: 'actor-1', role: 'CLINIC_ADMIN', practiceId: null };
  scope.scopeForRequest.mockReset();
  scope.canWrite.mockReset();
  Object.values(svc).forEach((f) => f.mockReset());

  scope.scopeForRequest.mockResolvedValue({
    scope: { clinicId: 3n, doctorId: null, empty: false },
  });
  scope.canWrite.mockReturnValue(true);
  svc.getService.mockResolvedValue(summary);
  svc.updateService.mockResolvedValue(summary);
  svc.deleteService.mockResolvedValue({ ok: true });
});

describe('GET /api/v1/services/{id}', () => {
  it('returns the service', async () => {
    const res = await GET(req(), ctx('501'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 501 });
  });

  it('404s when the service is missing or out of scope', async () => {
    svc.getService.mockResolvedValue(null);

    expect((await GET(req(), ctx('501'))).status).toBe(404);
  });

  it('passes a scope-layer 403 straight through instead of throwing', async () => {
    scope.scopeForRequest.mockResolvedValue({
      response: NextResponse.json({ status: 403 }, { status: 403 }),
    });

    expect((await GET(req(), ctx('501'))).status).toBe(403);
    expect(svc.getService).not.toHaveBeenCalled();
  });

  it('400s a non-numeric id before it can become NaN in SQL', async () => {
    const res = await GET(req(), ctx('abc'));

    expect(res.status).toBe(400);
    expect(svc.getService).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/services/{id}', () => {
  it('updates and returns the fresh row', async () => {
    const res = await PUT(req('PUT', { price: 300000 }), ctx('501'));

    expect(res.status).toBe(200);
    expect(svc.updateService).toHaveBeenCalledWith(
      501,
      { price: 300000 },
      expect.anything(),
      'actor-1',
    );
  });

  it('403s a role that cannot write', async () => {
    scope.canWrite.mockReturnValue(false);

    expect((await PUT(req('PUT', { price: 1 }), ctx('501'))).status).toBe(403);
    expect(svc.updateService).not.toHaveBeenCalled();
  });

  it('400s a malformed body', async () => {
    expect((await PUT(req('PUT', '{ not json'), ctx('501'))).status).toBe(400);
  });

  it('422s an empty patch', async () => {
    expect((await PUT(req('PUT', {}), ctx('501'))).status).toBe(422);
  });

  it('404s when the service layer says not found', async () => {
    svc.updateService.mockRejectedValue({ _tag: 'not_found', entity: 'service' });

    expect((await PUT(req('PUT', { price: 1 }), ctx('501'))).status).toBe(404);
  });

  it('409s a name collision', async () => {
    svc.updateService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_name_taken',
      message: 'taken',
    });

    expect((await PUT(req('PUT', { name: 'x' }), ctx('501'))).status).toBe(409);
  });
});

describe('DELETE /api/v1/services/{id}', () => {
  it('deletes and returns ok', async () => {
    const res = await DELETE(req('DELETE'), ctx('501'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('403s a role that cannot write', async () => {
    scope.canWrite.mockReturnValue(false);

    expect((await DELETE(req('DELETE'), ctx('501'))).status).toBe(403);
  });

  it('409s when upcoming appointments still use the service, and passes the count on', async () => {
    svc.deleteService.mockRejectedValue({
      _tag: 'conflict',
      code: 'service_has_upcoming_appointments',
      message: '3 upcoming appointment(s) still use this service.',
      count: 3,
    });

    const res = await DELETE(req('DELETE'), ctx('501'));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'service_has_upcoming_appointments',
      count: 3,
    });
  });

  it('404s when the service layer says not found', async () => {
    svc.deleteService.mockRejectedValue({ _tag: 'not_found', entity: 'service' });

    expect((await DELETE(req('DELETE'), ctx('501'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/services/item-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/v1/services/[id]/route`.

- [ ] **Step 3: Write the route**

Create `src/app/api/v1/services/[id]/route.ts`:

```ts
/**
 * GET    /api/v1/services/{id}
 * PUT    /api/v1/services/{id}
 * DELETE /api/v1/services/{id}
 *
 * `{id}` is a `wp_kc_service_doctor_mapping` row, matching KiviCare's own
 * `/doctor-services/{id}`. A row outside the actor's clinic answers 404, never 403.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import type { Actor } from '@/lib/auth';
import { conflict, forbidden, notFound, validationError } from '@/lib/problem-details';
import {
  scopeForRequest,
  canWrite,
  parseServiceId,
  invalidIdResponse,
} from '@/services/service-catalog/scope';
import {
  getService,
  updateService,
  deleteService,
  isServiceCatalogError,
} from '@/services/service-catalog/service';
import { updateServiceSchema, toFieldErrors } from '@/services/service-catalog/validation';

type RouteParams = { params: { id: string } };

/** One place for the shared tail of PUT and DELETE error handling. */
function toErrorResponse(err: unknown): NextResponse {
  if (isServiceCatalogError(err)) {
    if (err._tag === 'not_found') {
      return NextResponse.json(notFound('service_not_found', 'Service not found'), { status: 404 });
    }
    if (err._tag === 'validation') {
      return NextResponse.json(
        validationError('validation_failed', 'Invalid service data', undefined, err.errors),
        { status: 422 },
      );
    }
    if (err._tag === 'conflict') {
      const body = conflict(err.code, err.message);
      // The count is what lets the dashboard say "3 appointments" instead of "some".
      return NextResponse.json(
        err.count === undefined ? body : { ...body, count: err.count },
        { status: 409 },
      );
    }
  }
  throw err;
}

export const GET = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  const service = await getService(id, scoped.scope);
  if (!service) {
    return NextResponse.json(notFound('service_not_found', 'Service not found'), { status: 404 });
  }

  return NextResponse.json(service);
});

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  if (!canWrite(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can edit services'), {
      status: 403,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(validationError('invalid_json', 'Request body must be valid JSON'), {
      status: 400,
    });
  }

  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      validationError('validation_failed', 'Invalid service data', undefined, toFieldErrors(parsed.error)),
      { status: 422 },
    );
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  try {
    return NextResponse.json(await updateService(id, parsed.data, scoped.scope, actor.id));
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const id = parseServiceId(ctx.params.id);
  if (id === null) return invalidIdResponse();

  if (!canWrite(actor.role)) {
    return NextResponse.json(forbidden('Only Super Admin and Clinic Admin can delete services'), {
      status: 403,
    });
  }

  const scoped = await scopeForRequest(actor);
  if ('response' in scoped) return scoped.response;

  try {
    return NextResponse.json(await deleteService(id, scoped.scope, actor.id));
  } catch (err) {
    return toErrorResponse(err);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/services/item-route.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run everything and type-check**

Run: `npx vitest run && npm run type-check`
Expected: the whole suite green (the branch baseline is 134/134 files, 1218/1218 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/services/[id]/route.ts tests/integration/services/item-route.test.ts
git commit -m "feat(services): add GET, PUT and DELETE /api/v1/services/{id}"
```

---

### Task 12: OpenAPI registration

**Files:**
- Modify: `src/services/service-catalog/validation.ts` (add response schemas)
- Modify: `scripts/generate-openapi.ts:55-61` (owned prefixes) and append `registerPath` calls
- Modify: `docs/api/openapi.yaml` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: schemas from Task 4.
- Produces: `serviceSummarySchema`, `serviceListResponseSchema`, `createdServiceSchema`, `serviceCategoryListSchema` exported from `validation.ts`.

- [ ] **Step 1: Add response schemas**

Append to `src/services/service-catalog/validation.ts`:

```ts
/* ------------------------------------------------------------------ */
/* Response shapes — consumed by scripts/generate-openapi.ts           */
/* ------------------------------------------------------------------ */

export const serviceCategorySchema = z.object({
  id: z.number().int(),
  label: z.string().nullable(),
  value: z.string().nullable(),
});

export const serviceSummarySchema = z.object({
  id: z.number().int().describe('The doctor-service mapping id'),
  serviceId: z.number().int().describe('The catalogue row id'),
  doctorId: z.number().int(),
  clinicId: z.number().int(),
  name: z.string(),
  category: serviceCategorySchema.nullable(),
  price: z.number().nullable().describe('The charge that applies, from the mapping'),
  durationMinutes: z.number().int().nullable(),
  telemedService: z.enum(['yes', 'no']),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export const serviceListResponseSchema = z.object({
  services: z.array(serviceSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  perPage: z.number().int(),
});

export const createdServiceSchema = z.object({
  serviceId: z.number().int(),
  name: z.string(),
  category: serviceCategorySchema,
  mappings: z.array(z.object({ id: z.number().int(), doctorId: z.number().int() })),
});

export const serviceCategoryListSchema = z.object({
  categories: z.array(serviceCategorySchema),
});

export const deleteServiceResponseSchema = z.object({ ok: z.literal(true) });
```

- [ ] **Step 2: Register the paths**

In `scripts/generate-openapi.ts`, extend `OWNED_PREFIXES`:

```ts
/** Route-path prefixes this generator owns. Everything else is left alone. */
const OWNED_PREFIXES = [
  '/api/v1/clients',
  // Added in E5: E3 and E4 changed both payloads, so the hand-written entries for these
  // were describing an API that no longer exists.
  '/api/v1/session-notes',
  '/api/v1/intervention-plans',
  // Added with the service CRUD — these paths were never hand-written, so the generator
  // owns them from birth.
  '/api/v1/services',
  '/api/v1/service-categories',
];
```

Add the import beside the other schema imports at the top of the file:

```ts
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  serviceListResponseSchema,
  serviceSummarySchema,
  createdServiceSchema,
  serviceCategoryListSchema,
  deleteServiceResponseSchema,
} from '../src/services/service-catalog/validation';
```

Append at the end of the `registerPath` block, before the file's write/compare logic:

```ts
registry.registerPath({
  method: 'get',
  path: '/api/v1/service-categories',
  tags: ['services'],
  summary: 'List service categories',
  description:
    'The `service_type` rows of `wp_kc_static_data`. `categoryId` on POST /api/v1/services ' +
    'points at one of these, and its `value` becomes `wp_kc_services.type`.',
  security: auth,
  responses: {
    200: {
      description: 'Service categories',
      content: { 'application/json': { schema: serviceCategoryListSchema } },
    },
    401: problem,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/services',
  tags: ['services'],
  summary: 'List clinic services',
  description:
    'One entry per `wp_kc_service_doctor_mapping` row — a service as offered by one ' +
    "professional at one clinic. Scoped to the actor's clinic for CLINIC_ADMIN and " +
    'RECEPTIONIST, and to their own rows for PROFESSIONAL; `clinicId` and ' +
    '`professionalId` are ignored where the scope already pins them.',
  security: auth,
  request: { query: listServicesQuerySchema },
  responses: {
    200: {
      description: 'Paginated services',
      content: { 'application/json': { schema: serviceListResponseSchema } },
    },
    401: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/services',
  tags: ['services'],
  summary: 'Create a service',
  description:
    'Creates one `wp_kc_services` row — reused when an identical name and type already ' +
    'exist, because the catalogue is global — plus one mapping per professional. ' +
    'SUPER_ADMIN and CLINIC_ADMIN only.',
  security: auth,
  request: {
    body: { content: { 'application/json': { schema: createServiceSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: createdServiceSchema } },
    },
    400: problem,
    401: problem,
    403: problem,
    409: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/services/{id}',
  tags: ['services'],
  summary: 'Get one service',
  description: 'A row outside the actor\'s scope answers 404, not 403.',
  security: auth,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    200: {
      description: 'The service',
      content: { 'application/json': { schema: serviceSummarySchema } },
    },
    400: problem,
    401: problem,
    404: problem,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/services/{id}',
  tags: ['services'],
  summary: 'Update a service',
  description:
    'Price, duration, telemed flag, status and visibility touch only this mapping row. ' +
    'A rename repoints the mapping at a catalogue row carrying the new name and type — ' +
    'creating one if needed — rather than renaming a row other clinics may share. ' +
    '`doctorIds` and `clinicId` cannot be changed here.',
  security: auth,
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: { content: { 'application/json': { schema: updateServiceSchema } }, required: true },
  },
  responses: {
    200: {
      description: 'The updated service',
      content: { 'application/json': { schema: serviceSummarySchema } },
    },
    400: problem,
    401: problem,
    403: problem,
    404: problem,
    409: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/services/{id}',
  tags: ['services'],
  summary: 'Retire a service',
  description:
    'Sets `status = 0` rather than deleting the row. Answers 409 with a `count` when ' +
    'upcoming, non-cancelled appointments still reference this service and professional.',
  security: auth,
  request: { params: z.object({ id: z.coerce.number().int().positive() }) },
  responses: {
    200: {
      description: 'Retired',
      content: { 'application/json': { schema: deleteServiceResponseSchema } },
    },
    400: problem,
    401: problem,
    403: problem,
    404: problem,
    409: problem,
  },
});
```

- [ ] **Step 3: Regenerate the spec**

Run: `npm run openapi`
Expected: `docs/api/openapi.yaml` gains `/api/v1/services`, `/api/v1/services/{id}` and `/api/v1/service-categories`.

- [ ] **Step 4: Verify the spec is not stale**

Run: `npm run openapi:check`
Expected: exit 0, no drift reported.

- [ ] **Step 5: Full suite and type-check**

Run: `npx vitest run && npm run type-check`
Expected: no new failures, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/service-catalog/validation.ts scripts/generate-openapi.ts docs/api/openapi.yaml
git commit -m "docs(api): describe the service endpoints in the generated OpenAPI spec"
```

---

## Handoff note for the Laravel front-end

Not a task — this is what to hand Rafiq once Task 12 lands. `Front-End Laravel/` is read-only for us.

- `GET /api/v1/service-categories` → `{ categories: [{ id, label, value }] }`. Feeds the category select; `id` is what `categoryId` wants.
- `GET /api/v1/services?clinicId=&professionalId=&search=&page=&perPage=&includeInactive=` → `{ services, total, page, perPage }`. This replaces the current per-psychologist fan-out on `/dashboard/services` (1 roster request + 1 per psychologist) with a single request.
- `POST /api/v1/services` body: `{ name, categoryId, price, duration, doctorIds: [], telemedService: 'yes'|'no', status: 0|1, isPublic: 0|1 }`. `clinicId` is ignored for a clinic admin.
- `PUT /api/v1/services/{id}` takes any subset of `{ name, categoryId, price, duration, telemedService, status, isPublic }`. Not `doctorIds`, not `clinicId`.
- `DELETE /api/v1/services/{id}` answers 409 with `count` when upcoming appointments still use the service. That count is worth showing verbatim.
- `ResourceController::RESOURCES` entry: `'services' => ['create' => ['POST', 'api/v1/services'], 'update' => ['PUT', 'api/v1/services/{id}'], 'delete' => ['DELETE', 'api/v1/services/{id}']]` with `'roles' => ['super', 'admin']`.
- **There is no "jumlah klien" field.** Do not add the input; the server would drop it. See §6 of the spec.
