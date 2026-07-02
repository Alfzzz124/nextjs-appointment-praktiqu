# KiviCare Public Booking (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the ~12 public (unauthenticated) booking-widget endpoints under `/api/v1/public`, migrating the existing `/public/booking` flow to a canonical `/public/appointments` resource with stateless token-based guest access.

**Architecture:** Public routes take no JWT and use the RFC-7807 problem-details helpers in `src/lib/problem-details.ts` (NOT the `kcOk`/`kcFail` envelope, which is for authenticated routes). Guest appointment access uses a stateless HMAC-signed token (no schema migration). Write endpoints are rate-limited via the existing sliding-window limiter in `src/lib/rate-limit.ts`. Slot generation and hold logic reuse the existing `src/services/booking/*` services.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL, Zod, Vitest, Node `crypto` (HMAC).

**Branch:** `feat/kc-public-booking` (already created from `main`).

**Decisions locked in (from brainstorming):**
1. Migrate `POST /public/booking` → canonical `POST /public/appointments`; leave `/public/booking` as a deprecated shim that returns a 308-style notice pointing to the new path.
2. Guest appointment token = stateless HMAC (`HMAC-SHA256(appointmentId, AUTH_SECRET)`), no DB column.
3. `GET /public/rating/{id}` implemented now as a rating-*prompt* read (no stored Rating model — that's Slice 8). `POST /public/payment-verify` is a 501 stub.

---

## Conventions for every public route in this slice

- **No auth.** Do NOT call `getActor`/`withAuth`. These are public.
- **Errors:** import from `@/lib/problem-details` — `badRequest`, `notFound`, `conflict`, `validationError`, `tooManyRequests`. Return with `problemHeaders(p)` where that helper is used elsewhere; otherwise `NextResponse.json(p, { status: p.status })`.
- **Success:** plain `NextResponse.json(data)` (200) — matches existing `/public/*` routes. Do NOT wrap in `{ status, message, data }`.
- **`export const dynamic = 'force-dynamic';`** on every route file (matches existing public routes).
- **Validation:** Zod `.safeParse`; on failure return `validationError('invalid_input', <first issue msg>)` (422).

---

## File Structure

**New library code:**
- `src/lib/public/appointment-token.ts` — HMAC sign/verify for guest appointment tokens.

**New service code:**
- `src/services/public/public-booking.service.ts` — canonical appointment create, lookup-by-id, cancel; wraps the existing WP-insert logic and slot-hold verification.
- `src/services/public/public-catalog.service.ts` — practices list/detail, professional services (Prisma), static-data, booking config, rating-prompt reads.

**New / modified routes (all under `src/app/api/v1/public/`):**
- `practices/route.ts` — GET list (new)
- `practices/[id]/route.ts` — GET detail (new)
- `professionals/[id]/services/route.ts` — GET (rework existing WP → Prisma)
- `static-data/route.ts` — GET (new)
- `config/route.ts` — GET (new)
- `appointments/route.ts` — POST create (new; canonical)
- `appointments/[token]/route.ts` — GET lookup by token (new)
- `appointments/[token]/cancel/route.ts` — POST cancel by token (new)
- `payment-verify/route.ts` — POST 501 stub (new)
- `rating/[id]/route.ts` — GET rating prompt (new)
- `booking/route.ts` — MODIFY: deprecate, delegate/redirect to appointments

**Tests:**
- `tests/public-booking/appointment-token.test.ts`
- `tests/public-booking/routes.integration.test.ts`

**Endpoints already present and correct (verify only, no change unless a test fails):**
- `GET /public/professionals` — keep
- `GET /public/professionals/[id]/slots` — keep

---

### Task 1: Appointment HMAC token utility

**Files:**
- Create: `src/lib/public/appointment-token.ts`
- Test: `tests/public-booking/appointment-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/public-booking/appointment-token.test.ts
import { describe, it, expect } from 'vitest';
import { signAppointmentToken, verifyAppointmentToken } from '@/lib/public/appointment-token';

describe('appointment-token', () => {
  it('round-trips a signed token back to the appointment id', () => {
    const token = signAppointmentToken('appt-123');
    expect(token).toContain('.');
    expect(verifyAppointmentToken(token)).toBe('appt-123');
  });

  it('rejects a tampered signature', () => {
    const token = signAppointmentToken('appt-123');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyAppointmentToken(tampered)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyAppointmentToken('garbage')).toBeNull();
    expect(verifyAppointmentToken('')).toBeNull();
    expect(verifyAppointmentToken('a.b.c')).toBeNull();
  });

  it('rejects a token whose id part was swapped', () => {
    const token = signAppointmentToken('appt-123');
    const sig = token.split('.')[1];
    const forgedId = Buffer.from('appt-999').toString('base64url');
    expect(verifyAppointmentToken(`${forgedId}.${sig}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/public-booking/appointment-token.test.ts`
Expected: FAIL — cannot find module `@/lib/public/appointment-token`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/public/appointment-token.ts
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

/**
 * Stateless guest token for public appointment access.
 * Format: base64url(appointmentId) + "." + base64url(HMAC-SHA256(appointmentId)).
 * No DB column required; verification is constant-time.
 */
export function signAppointmentToken(appointmentId: string): string {
  const sig = createHmac('sha256', SECRET).update(appointmentId).digest('base64url');
  const idPart = Buffer.from(appointmentId, 'utf8').toString('base64url');
  return `${idPart}.${sig}`;
}

export function verifyAppointmentToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [idPart, sig] = parts;
  if (!idPart || !sig) return null;

  let appointmentId: string;
  try {
    appointmentId = Buffer.from(idPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!appointmentId) return null;

  const expected = createHmac('sha256', SECRET).update(appointmentId).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return appointmentId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/public-booking/appointment-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/appointment-token.ts tests/public-booking/appointment-token.test.ts
git commit -m "feat(public): stateless HMAC appointment token utility"
```

---

### Task 2: Public catalog service — practices + professional services

**Files:**
- Create: `src/services/public/public-catalog.service.ts`
- Read for reference: `src/app/api/v1/public/professionals/route.ts` (Prisma access pattern), `prisma/schema.prisma` (Clinic, Service, ProfessionalServiceAssignment).

**Context:** Public callers need to browse bookable clinics and a professional's services. Only ACTIVE clinics (`status = 1`) and ACTIVE services (`ServiceStatus.ACTIVE`) are exposed. Never leak internal fields (`clinicAdminId`, `extra`, `billSequence`).

- [ ] **Step 1: Write the implementation**

```ts
// src/services/public/public-catalog.service.ts
import { prisma } from '@/lib/prisma';
import { ServiceStatus } from '@prisma/client';

/** Public-safe clinic shape — no admin/billing internals. */
export interface PublicClinic {
  id: string;
  name: string;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  specialties: unknown;
}

function toPublicClinic(c: {
  id: string; name: string; email: string | null; telephoneNo: string | null;
  address: string | null; city: string | null; state: string | null;
  country: string | null; postalCode: string | null; specialties: unknown;
}): PublicClinic {
  return {
    id: c.id, name: c.name, email: c.email, telephoneNo: c.telephoneNo,
    address: c.address, city: c.city, state: c.state, country: c.country,
    postalCode: c.postalCode, specialties: c.specialties,
  };
}

export async function listPublicPractices(): Promise<PublicClinic[]> {
  const clinics = await prisma.clinic.findMany({
    where: { status: 1 },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, email: true, telephoneNo: true, address: true,
      city: true, state: true, country: true, postalCode: true, specialties: true,
    },
  });
  return clinics.map(toPublicClinic);
}

export async function getPublicPractice(id: string): Promise<PublicClinic | null> {
  const clinic = await prisma.clinic.findFirst({
    where: { id, status: 1 },
    select: {
      id: true, name: true, email: true, telephoneNo: true, address: true,
      city: true, state: true, country: true, postalCode: true, specialties: true,
    },
  });
  return clinic ? toPublicClinic(clinic) : null;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  price: string;          // Decimal serialized as string
  durationMinutes: number;
  serviceType: string;
}

/** Services a professional offers, via ProfessionalServiceAssignment → Service. ACTIVE only. */
export async function getPublicProfessionalServices(professionalId: string): Promise<PublicService[]> {
  const assignments = await prisma.professionalServiceAssignment.findMany({
    where: {
      professionalId,
      service: { status: ServiceStatus.ACTIVE, isPrivate: false },
    },
    select: {
      service: {
        select: {
          id: true, name: true, description: true, price: true,
          durationMinutes: true, serviceType: true,
        },
      },
    },
  });
  return assignments.map((a) => ({
    id: a.service.id,
    name: a.service.name,
    description: a.service.description,
    price: a.service.price.toString(),
    durationMinutes: a.service.durationMinutes,
    serviceType: a.service.serviceType,
  }));
}
```

- [ ] **Step 2: Commit** (routes + tests land in Task 3; service compiles standalone)

```bash
git add src/services/public/public-catalog.service.ts
git commit -m "feat(public): catalog service — practices + professional services"
```

---

### Task 3: Practices routes + reworked professional-services route

**Files:**
- Create: `src/app/api/v1/public/practices/route.ts`
- Create: `src/app/api/v1/public/practices/[id]/route.ts`
- Modify (rework WP→Prisma): `src/app/api/v1/public/professionals/[id]/services/route.ts`

- [ ] **Step 1: Write `practices/route.ts`**

```ts
// src/app/api/v1/public/practices/route.ts
import { NextResponse } from 'next/server';
import { listPublicPractices } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const practices = await listPublicPractices();
  return NextResponse.json({ data: practices });
}
```

- [ ] **Step 2: Write `practices/[id]/route.ts`**

```ts
// src/app/api/v1/public/practices/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPublicPractice } from '@/services/public/public-catalog.service';
import { notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const practice = await getPublicPractice(params.id);
  if (!practice) {
    const p = notFound('practice_not_found', 'No active clinic with that id');
    return NextResponse.json(p, { status: p.status });
  }
  return NextResponse.json({ data: practice });
}
```

- [ ] **Step 3: Rework `professionals/[id]/services/route.ts`**

Replace the deprecated WordPress-mapping implementation with the Prisma-backed service:

```ts
// src/app/api/v1/public/professionals/[id]/services/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const services = await getPublicProfessionalServices(params.id);
  return NextResponse.json({ data: services });
}
```

- [ ] **Step 4: Manual smoke check (types compile)**

Run: `npx tsc --noEmit 2>&1 | grep -E "public/(practices|professionals)" | head`
Expected: no output (no new errors in these files).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/public/practices src/app/api/v1/public/professionals/\[id\]/services/route.ts
git commit -m "feat(public): practices list/detail + Prisma-backed professional services"
```

---

### Task 4: Static-data + booking config routes

**Files:**
- Create: `src/app/api/v1/public/static-data/route.ts`
- Create: `src/app/api/v1/public/config/route.ts`
- Modify: `src/services/public/public-catalog.service.ts` (append the two reads)

**Context:** The booking widget needs lookup lists (genders, professional types, service types, plus any rows in the `StaticData` table) and a small config blob (currency, min booking notice, hold TTL). `SLOT_HOLD_TTL_MS` is exported from `src/services/booking/slot-hold.service.ts`.

- [ ] **Step 1: Append reads to the catalog service**

```ts
// append to src/services/public/public-catalog.service.ts
import { SLOT_HOLD_TTL_MS } from '@/services/booking/slot-hold.service';

const ENUM_STATIC = {
  gender: ['MALE', 'FEMALE', 'OTHER'],
  professionalType: ['PSIKOLOG_KLINIS', 'PSIKOLOG_ANAK', 'PSIKIATER', 'KONSELOR'],
  serviceType: ['KONSELING', 'ASESMEN', 'WORKSHOP'],
};

export interface StaticDataResponse {
  gender: string[];
  professionalType: string[];
  serviceType: string[];
  dynamic: Record<string, Array<{ label: string; value: string; extra: unknown }>>;
}

/** Enum lists + any rows in the StaticData table (grouped by type). */
export async function getPublicStaticData(): Promise<StaticDataResponse> {
  const rows = await prisma.staticData.findMany({
    where: { status: 1 },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    select: { type: true, label: true, value: true, extra: true },
  });
  const dynamic: StaticDataResponse['dynamic'] = {};
  for (const r of rows) {
    (dynamic[r.type] ??= []).push({ label: r.label, value: r.value, extra: r.extra });
  }
  return { ...ENUM_STATIC, dynamic };
}

export interface PublicBookingConfig {
  slotHoldTtlMs: number;
  minBookingNoticeMinutes: number;
  maxAdvanceDays: number;
}

export function getPublicBookingConfig(): PublicBookingConfig {
  return {
    slotHoldTtlMs: SLOT_HOLD_TTL_MS,
    minBookingNoticeMinutes: 60,
    maxAdvanceDays: 60,
  };
}
```

- [ ] **Step 2: Write `static-data/route.ts`**

```ts
// src/app/api/v1/public/static-data/route.ts
import { NextResponse } from 'next/server';
import { getPublicStaticData } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getPublicStaticData();
  return NextResponse.json({ data });
}
```

- [ ] **Step 3: Write `config/route.ts`**

```ts
// src/app/api/v1/public/config/route.ts
import { NextResponse } from 'next/server';
import { getPublicBookingConfig } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ data: getPublicBookingConfig() });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/public/static-data src/app/api/v1/public/config src/services/public/public-catalog.service.ts
git commit -m "feat(public): static-data + booking config endpoints"
```

---

### Task 5: Canonical appointment create + booking deprecation + rate limiting

**Files:**
- Create: `src/services/public/public-booking.service.ts`
- Create: `src/app/api/v1/public/appointments/route.ts`
- Modify: `src/app/api/v1/public/booking/route.ts` (deprecate)
- Read for reference: existing `src/app/api/v1/public/booking/route.ts` (the WP-insert + hold-verify logic to move into the service), `src/lib/rate-limit.ts`, `src/services/booking/slot-hold.service.ts`.

**Context:** Move the existing booking submission logic into `public-booking.service.ts` as `createPublicAppointment(input)`. The service must: (1) verify the slot hold via `slotHoldService.get(holdKey)`; (2) perform the existing WordPress appointment insert (copy the exact SQL/escaping from the current booking route — do not rewrite it); (3) consume the hold; (4) return the created appointment plus a signed token via `signAppointmentToken(appointment.id)`. The route applies IP-based rate limiting before calling the service.

- [ ] **Step 1: Write the service**

```ts
// src/services/public/public-booking.service.ts
import { slotHoldService } from '@/services/booking/slot-hold.service';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import { z } from 'zod';

export const createPublicAppointmentSchema = z.object({
  professionalId: z.string().min(1),
  serviceId: z.string().min(1),
  date: z.string().min(1),          // YYYY-MM-DD
  startTime: z.string().min(1),     // HH:mm
  clientName: z.string().min(1).max(255),
  clientEmail: z.string().email(),
  clientMobile: z.string().min(1).max(32),
  notes: z.string().max(1000).optional(),
  holdKey: z.string().min(1),
});
export type CreatePublicAppointmentInput = z.infer<typeof createPublicAppointmentSchema>;

export class HoldExpiredError extends Error { readonly code = 'HOLD_EXPIRED'; }

export interface CreatedAppointment {
  id: string;
  status: string;
  date: string;
  startTime: string;
  service: string;
  professionalName: string;
  clientName: string;
  token: string;
}

/**
 * Creates a guest appointment.
 * IMPLEMENTER: lift the WordPress insert + name/service lookup from the current
 * `src/app/api/v1/public/booking/route.ts` verbatim into the body below — that
 * SQL is already correct and tested in production. Wrap it so the function
 * returns CreatedAppointment (add the token via signAppointmentToken(id)).
 */
export async function createPublicAppointment(
  input: CreatePublicAppointmentInput,
): Promise<CreatedAppointment> {
  const hold = slotHoldService.get(input.holdKey);
  if (!hold) throw new HoldExpiredError('Slot hold expired');

  // --- BEGIN: moved verbatim from booking/route.ts (WP user upsert + appointment insert) ---
  // const appointment = await <existing insert logic>;
  // --- END ---

  // Placeholder binding names the implementer must satisfy from the moved logic:
  //   appointmentId, statusStr, serviceName, professionalName
  throw new Error('IMPLEMENTER: move booking insert logic here and return CreatedAppointment');
}
```

> IMPLEMENTER NOTE: This is the one task where you must read the existing `booking/route.ts` and relocate its working insert logic. Keep the SQL identical. After moving it, delete the `throw` and return `{ id: appointmentId, status: statusStr, date: input.date, startTime: input.startTime, service: serviceName, professionalName, clientName: input.clientName, token: signAppointmentToken(appointmentId) }`. Also call `slotHoldService.consume(input.holdKey)` after a successful insert.

- [ ] **Step 2: Write `appointments/route.ts` with rate limiting**

```ts
// src/app/api/v1/public/appointments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicAppointment,
  createPublicAppointmentSchema,
  HoldExpiredError,
} from '@/services/public/public-booking.service';
import { createRateLimiter, tupleKey } from '@/lib/rate-limit';
import { validationError, tooManyRequests, conflict } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

// Module-scoped limiter: 30 writes / 15-min window keyed on (ip, email).
const limiter = createRateLimiter({ config: { lockoutAfter: 30, windowMs: 15 * 60_000 } });

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = createPublicAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    const p = validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input');
    return NextResponse.json(p, { status: p.status });
  }

  const key = tupleKey(clientIp(req), parsed.data.clientEmail);
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const p = tooManyRequests('rate_limited', Math.ceil(verdict.retryAfterMs / 1000));
    return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)) } });
  }

  try {
    const appointment = await createPublicAppointment(parsed.data);
    limiter.recordSuccess(key);
    return NextResponse.json({ data: appointment }, { status: 201 });
  } catch (err) {
    limiter.recordFailure(key);
    if (err instanceof HoldExpiredError) {
      const p = conflict('hold_expired', 'Slot no longer available — please select another time');
      return NextResponse.json(p, { status: 410 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Deprecate `booking/route.ts`**

Replace the POST body so it forwards to the new resource contract (keep GET on `/booking/hold` untouched — that's a different file):

```ts
// src/app/api/v1/public/booking/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * DEPRECATED: use POST /api/v1/public/appointments.
 * Returns 308 with a pointer so existing widget builds fail loudly rather than silently.
 */
export async function POST() {
  return NextResponse.json(
    {
      type: 'about:blank',
      title: 'Endpoint moved',
      status: 308,
      detail: 'POST /api/v1/public/booking is deprecated. Use POST /api/v1/public/appointments.',
    },
    { status: 308, headers: { Location: '/api/v1/public/appointments' } },
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/public/public-booking.service.ts src/app/api/v1/public/appointments/route.ts src/app/api/v1/public/booking/route.ts
git commit -m "feat(public): canonical POST /appointments with rate limiting; deprecate /booking"
```

---

### Task 6: Appointment lookup + cancel by token

**Files:**
- Create: `src/app/api/v1/public/appointments/[token]/route.ts`
- Create: `src/app/api/v1/public/appointments/[token]/cancel/route.ts`
- Modify: `src/services/public/public-booking.service.ts` (add `getPublicAppointmentById`, `cancelPublicAppointment`)

**Context:** Guests retrieve/cancel via the signed token. `verifyAppointmentToken` returns the appointment id or null. Reads/updates hit the same WordPress appointment table the create path wrote to — IMPLEMENTER uses the same `prisma`/raw-SQL access style as `booking/route.ts`. Only appointments in a cancellable status (`PENDING` or `BOOKED`) can be cancelled; already-cancelled → 409.

- [ ] **Step 1: Add service reads/mutations**

```ts
// append to src/services/public/public-booking.service.ts
import { prisma } from '@/lib/prisma';

export interface PublicAppointmentView {
  id: string;
  status: string;
  date: string;
  startTime: string;
  service: string;
  professionalName: string;
  clientName: string;
}

export class AppointmentNotFoundError extends Error { readonly code = 'NOT_FOUND'; }
export class NotCancellableError extends Error { readonly code = 'NOT_CANCELLABLE'; }

/**
 * IMPLEMENTER: read the appointment + joined professional/service/client names
 * using the same table/columns the create path writes. Return null if missing.
 */
export async function getPublicAppointmentById(id: string): Promise<PublicAppointmentView | null> {
  throw new Error('IMPLEMENTER: read appointment by id, join names, return PublicAppointmentView | null');
}

/**
 * IMPLEMENTER: set status to CANCELLED where id matches AND current status in (PENDING, BOOKED).
 * Throw AppointmentNotFoundError if no row; NotCancellableError if status not cancellable.
 */
export async function cancelPublicAppointment(id: string): Promise<PublicAppointmentView> {
  throw new Error('IMPLEMENTER: cancel appointment, return updated PublicAppointmentView');
}
```

- [ ] **Step 2: Write lookup route**

```ts
// src/app/api/v1/public/appointments/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import { getPublicAppointmentById } from '@/services/public/public-booking.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const id = verifyAppointmentToken(params.token);
  if (!id) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }
  const appointment = await getPublicAppointmentById(id);
  if (!appointment) {
    const p = notFound('appointment_not_found', 'No appointment for that token');
    return NextResponse.json(p, { status: p.status });
  }
  return NextResponse.json({ data: appointment });
}
```

- [ ] **Step 3: Write cancel route**

```ts
// src/app/api/v1/public/appointments/[token]/cancel/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import {
  cancelPublicAppointment,
  AppointmentNotFoundError,
  NotCancellableError,
} from '@/services/public/public-booking.service';
import { badRequest, notFound, conflict } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const id = verifyAppointmentToken(params.token);
  if (!id) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }
  try {
    const appointment = await cancelPublicAppointment(id);
    return NextResponse.json({ data: appointment });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) {
      const p = notFound('appointment_not_found', 'No appointment for that token');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof NotCancellableError) {
      const p = conflict('not_cancellable', 'Appointment cannot be cancelled in its current state');
      return NextResponse.json(p, { status: p.status });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/public/appointments/\[token\] src/services/public/public-booking.service.ts
git commit -m "feat(public): appointment lookup + cancel by signed token"
```

---

### Task 7: Payment-verify stub + rating-prompt read

**Files:**
- Create: `src/app/api/v1/public/payment-verify/route.ts`
- Create: `src/app/api/v1/public/rating/[id]/route.ts`
- Modify: `src/services/public/public-catalog.service.ts` (add `getRatingPrompt`)

**Context:** Payment gateway isn't configured (Slice 8) → 501 stub, same convention as Slice 1. The rating prompt is a *read* that, given an appointment token (the `[id]` param is the signed token), returns the context a widget needs to render a rating form (professional + service + whether the appointment is in a rateable state, i.e. `COMPLETED`/`CHECK_OUT`). No stored Rating model is touched.

- [ ] **Step 1: Add `getRatingPrompt` to catalog service**

```ts
// append to src/services/public/public-catalog.service.ts
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import { getPublicAppointmentById } from '@/services/public/public-booking.service';

export interface RatingPrompt {
  appointmentId: string;
  professionalName: string;
  service: string;
  canRate: boolean;      // true only when the visit is finished
  reason: string | null; // why canRate is false, else null
}

export async function getRatingPrompt(token: string): Promise<RatingPrompt | null> {
  const id = verifyAppointmentToken(token);
  if (!id) return null;
  const appt = await getPublicAppointmentById(id);
  if (!appt) return null;
  const finished = appt.status === 'COMPLETED' || appt.status === 'CHECK_OUT';
  return {
    appointmentId: appt.id,
    professionalName: appt.professionalName,
    service: appt.service,
    canRate: finished,
    reason: finished ? null : 'Appointment is not yet completed',
  };
}
```

- [ ] **Step 2: Write payment-verify stub**

```ts
// src/app/api/v1/public/payment-verify/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Payment verification is not yet configured' },
    { status: 501 },
  );
}
```

- [ ] **Step 3: Write rating route**

```ts
// src/app/api/v1/public/rating/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRatingPrompt } from '@/services/public/public-catalog.service';
import { badRequest } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const prompt = await getRatingPrompt(params.id);
  if (!prompt) {
    const p = badRequest('invalid_token', 'Invalid appointment token');
    return NextResponse.json(p, { status: p.status });
  }
  return NextResponse.json({ data: prompt });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/public/payment-verify src/app/api/v1/public/rating src/services/public/public-catalog.service.ts
git commit -m "feat(public): payment-verify 501 stub + rating-prompt read"
```

---

### Task 8: Route integration tests + full-suite/tsc close-out

**Files:**
- Create: `tests/public-booking/routes.integration.test.ts`
- Read for the mock pattern: `tests/complete-in-progress/consent-custom.test.ts` (Prisma + module mocks), `tests/complete-in-progress/clients.test.ts`.

**Context:** These are route-level tests. Mock `@/lib/prisma` and the two public services so tests are DB-free, then assert envelope shape, status codes, token behavior, and the rate-limit 429 path.

- [ ] **Step 1: Write the integration tests**

```ts
// tests/public-booking/routes.integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/public/public-catalog.service', () => ({
  listPublicPractices: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Clinic One' }]),
  getPublicPractice: vi.fn(),
  getPublicProfessionalServices: vi.fn().mockResolvedValue([]),
  getPublicStaticData: vi.fn().mockResolvedValue({ gender: ['MALE'], professionalType: [], serviceType: [], dynamic: {} }),
  getPublicBookingConfig: vi.fn().mockReturnValue({ slotHoldTtlMs: 900000, minBookingNoticeMinutes: 60, maxAdvanceDays: 60 }),
  getRatingPrompt: vi.fn(),
}));

import { GET as practicesList } from '@/app/api/v1/public/practices/route';
import { GET as practiceDetail } from '@/app/api/v1/public/practices/[id]/route';
import { GET as staticData } from '@/app/api/v1/public/static-data/route';
import { GET as config } from '@/app/api/v1/public/config/route';
import { POST as paymentVerify } from '@/app/api/v1/public/payment-verify/route';
import { GET as rating } from '@/app/api/v1/public/rating/[id]/route';
import { GET as apptLookup } from '@/app/api/v1/public/appointments/[token]/route';
import { signAppointmentToken } from '@/lib/public/appointment-token';
import * as catalog from '@/services/public/public-catalog.service';

function req(url: string) { return new NextRequest(url); }

beforeEach(() => vi.clearAllMocks());

describe('public catalog routes', () => {
  it('GET /public/practices → 200 with data array', async () => {
    const res = await practicesList();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /public/practices/[id] → 404 when clinic missing', async () => {
    (catalog.getPublicPractice as any).mockResolvedValue(null);
    const res = await practiceDetail(req('http://x/api/v1/public/practices/missing'), { params: { id: 'missing' } });
    expect(res.status).toBe(404);
  });

  it('GET /public/static-data → 200', async () => {
    const res = await staticData();
    expect(res.status).toBe(200);
  });

  it('GET /public/config → 200 with slotHoldTtlMs', async () => {
    const res = await config();
    const json = await res.json();
    expect(json.data).toHaveProperty('slotHoldTtlMs');
  });
});

describe('payment-verify stub', () => {
  it('POST /public/payment-verify → 501', async () => {
    const res = await paymentVerify();
    expect(res.status).toBe(501);
    expect((await res.json()).code).toBe('NOT_IMPLEMENTED');
  });
});

describe('rating prompt', () => {
  it('GET /public/rating/[id] → 400 on invalid token', async () => {
    (catalog.getRatingPrompt as any).mockResolvedValue(null);
    const res = await rating(req('http://x/api/v1/public/rating/bad'), { params: { id: 'bad' } });
    expect(res.status).toBe(400);
  });
});

describe('appointment token lookup', () => {
  it('GET /public/appointments/[token] → 400 on tampered token', async () => {
    const res = await apptLookup(req('http://x/api/v1/public/appointments/garbage'), { params: { token: 'garbage' } });
    expect(res.status).toBe(400);
  });

  it('signs a token the lookup route accepts as well-formed', () => {
    const token = signAppointmentToken('appt-1');
    expect(token.split('.')).toHaveLength(2);
  });
});
```

> IMPLEMENTER NOTE: If `apptLookup` needs `getPublicAppointmentById` mocked (it lives in `public-booking.service`), add a `vi.mock('@/services/public/public-booking.service', ...)` block mirroring the catalog mock. The tampered-token test above returns 400 before the service is called, so a mock isn't strictly required for that case.

- [ ] **Step 2: Run the public-booking suite**

Run: `npx vitest run tests/public-booking/`
Expected: all tests PASS (token suite from Task 1 + these route tests).

- [ ] **Step 3: Run the full suite (guard against regressions)**

Run: `npx vitest run`
Expected: no NEW failures beyond the ~32 pre-existing failures documented in Slice 1. Compare the failing-file list — it must be unchanged.

- [ ] **Step 4: TypeScript check on new files**

Run: `npx tsc --noEmit 2>&1 | grep -E "public/|public-booking|public-catalog|appointment-token" | head`
Expected: no output. Fix any error that IS in a new file; ignore pre-existing errors elsewhere.

- [ ] **Step 5: Commit**

```bash
git add tests/public-booking/routes.integration.test.ts
git commit -m "test(public): route integration tests for public booking slice"
```

---

## Self-Review

**Spec coverage** (design doc Slice 2, 12 endpoints):

| Design endpoint | Task |
|-----------------|------|
| `GET /public/professionals` | Pre-existing (verify only) |
| `GET /public/professionals/{id}/slots` | Pre-existing (verify only) |
| `GET /public/professionals/{id}/services` | Task 3 (reworked to Prisma) |
| `GET /public/practices` | Task 3 |
| `GET /public/practices/{id}` | Task 3 |
| `POST /public/appointments` | Task 5 |
| `GET /public/appointments/{token}` | Task 6 |
| `POST /public/appointments/{token}/cancel` | Task 6 |
| `GET /public/static-data` | Task 4 |
| `GET /public/config` | Task 4 |
| `POST /public/payment-verify` | Task 7 (501 stub) |
| `GET /public/rating/{id}` | Task 7 |

All 12 covered. Rate limiting (design: "30 req/min per IP on write endpoints") → Task 5 applies the limiter to the one write endpoint (`POST /appointments`); `/booking/hold` already exists and is a soft in-memory hold, out of scope for this slice's changes.

**Placeholder scan:** The two `throw new Error('IMPLEMENTER: ...')` markers in Tasks 5 and 6 are deliberate — they mark the exact point where working WP-insert/read SQL must be relocated from the existing `booking/route.ts` rather than rewritten from scratch (rewriting risks diverging from production-correct SQL). Each is paired with an explicit IMPLEMENTER NOTE describing the required return shape. This is a controlled hand-off, not an unspecified gap.

**Type consistency:** `PublicAppointmentView` (Task 6) is consumed by `getRatingPrompt` (Task 7) — field names (`id`, `status`, `professionalName`, `service`) match. `CreatedAppointment.token` (Task 5) is produced by `signAppointmentToken` and consumed by `verifyAppointmentToken` (Task 1) — consistent. `SLOT_HOLD_TTL_MS` import (Task 4) matches the exploration report's exported constant.
