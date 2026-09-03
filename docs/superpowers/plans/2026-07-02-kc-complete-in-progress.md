# KiviCare Complete In-Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the ~45 missing KiviCare endpoints that extend already-started modules: bulk delete/status/export for professionals, sessions, practices, clients; payment stubs for sessions; missing auth flows; consent-form and custom-field gaps; doctor-service bulk ops.

**Architecture:** Each task extends an existing module using that module's established pattern (service method → route handler → test). No new top-level modules. Each module's pattern is described in the task — do not mix patterns across modules.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5 + MySQL, Zod, Vitest, `NextResponse.json` (all non-KC modules), `kcOk/kcFail/kcHandle` (KC modules: bills/taxes only).

---

## File Structure

**New files to create:**
```
src/app/api/v1/professionals/bulk/delete/route.ts
src/app/api/v1/professionals/bulk/status/route.ts
src/app/api/v1/professionals/bulk/resend-credentials/route.ts
src/app/api/v1/professionals/export/route.ts
src/app/api/v1/professionals/[id]/resend-credentials/route.ts
src/app/api/v1/sessions/bulk/delete/route.ts
src/app/api/v1/sessions/export/route.ts
src/app/api/v1/sessions/[id]/print-invoice/route.ts
src/app/api/v1/sessions/[id]/summary/route.ts
src/app/api/v1/sessions/payment-cancel/route.ts
src/app/api/v1/sessions/payment-success/route.ts
src/app/api/v1/sessions/payment-verify/route.ts
src/app/api/v1/sessions/payment-webhook/route.ts
src/app/api/v1/sessions/[id]/regenerate-video-conference/route.ts
src/app/api/v1/practices/bulk/delete/route.ts
src/app/api/v1/practices/bulk/status/route.ts
src/app/api/v1/practices/bulk/resend-credentials/route.ts
src/app/api/v1/practices/export/route.ts
src/app/api/v1/practices/[id]/resend-credentials/route.ts
src/app/api/v1/practices/[id]/users/route.ts
src/app/api/v1/practices/[id]/change-admin/route.ts
src/app/api/v1/clients/bulk/delete/route.ts
src/app/api/v1/clients/bulk/status/route.ts
src/app/api/v1/clients/bulk/resend-credentials/route.ts
src/app/api/v1/clients/export/route.ts
src/app/api/v1/clients/[id]/resend-credentials/route.ts
src/app/api/v1/clients/[id]/statistics/route.ts
src/app/api/v1/auth/register/route.ts
src/app/api/v1/auth/change-password/route.ts
src/app/api/v1/auth/reset-password/route.ts
src/app/api/v1/auth/delete-account/route.ts
src/app/api/v1/consent-forms/[id]/status/route.ts
src/app/api/v1/custom-fields/[id]/status/route.ts
src/app/api/v1/custom-fields/[id]/save-data/route.ts
src/app/api/v1/custom-fields/[id]/get-data/route.ts
src/app/api/v1/custom-fields/file-upload/route.ts
src/app/api/v1/professionals/[id]/services/bulk/delete/route.ts
src/app/api/v1/professionals/[id]/services/bulk/status/route.ts
src/app/api/v1/professionals/[id]/services/export/route.ts
tests/complete-in-progress/professionals.test.ts
tests/complete-in-progress/sessions.test.ts
tests/complete-in-progress/practices.test.ts
tests/complete-in-progress/clients.test.ts
tests/complete-in-progress/auth.test.ts
tests/complete-in-progress/forms-fields.test.ts
tests/complete-in-progress/routes.integration.test.ts
```

**Existing files to modify:**
```
src/services/professional/professional.service.ts   — add bulk + export functions
src/services/session/session.service.ts             — add bulk delete + export functions
src/services/practice/service.ts                    — add bulk + export + users + change-admin
src/services/client/client.service.ts               — add bulk + export + statistics
src/services/auth/*.ts or new src/services/auth/auth.service.ts
src/services/consent/service.ts                     — add status method
src/app/api/v1/consent-forms/[id]/route.ts          — add DELETE handler
src/app/api/v1/custom-fields/[id]/route.ts          — verify DELETE handler exists; add if not
```

---

## Task 1: Branch setup

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull
git checkout -b feat/kc-complete-in-progress
```

- [ ] **Step 2: Confirm starting point**

```bash
git status
npx tsc --noEmit 2>&1 | grep -c "error" || echo "0 errors"
```

Expected: clean working tree, 0 TypeScript errors (or confirm pre-existing errors are unrelated to this slice).

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: start feat/kc-complete-in-progress slice"
```

---

## Task 2: Professionals — bulk delete, bulk status, export

**Files:**
- Modify: `src/services/professional/professional.service.ts`
- Create: `src/app/api/v1/professionals/bulk/delete/route.ts`
- Create: `src/app/api/v1/professionals/bulk/status/route.ts`
- Create: `src/app/api/v1/professionals/export/route.ts`
- Create: `tests/complete-in-progress/professionals.test.ts`

**Context:** The professional service uses standard Prisma (not raw SQL). Read the existing `listProfessionals` and `setProfessionalStatus` in `src/services/professional/professional.service.ts` before implementing. Route pattern: `withAuth` from `@/lib/auth`, `NextResponse.json`, `forbidden` from `@/lib/problem-details`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/complete-in-progress/professionals.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkDeleteProfessionals,
  bulkSetProfessionalStatus,
  exportProfessionals,
} from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';

// Use a seeded practice — read the first practice in the DB
let practiceId: string;
let prof1Id: string;
let prof2Id: string;

beforeAll(async () => {
  const practice = await prisma.practice.findFirst();
  if (!practice) throw new Error('No practice in DB — seed one first');
  practiceId = practice.id;

  const [p1, p2] = await Promise.all([
    prisma.professional.create({
      data: {
        fullName: 'Bulk Test Pro 1',
        email: `bulk-pro-1-${Date.now()}@test.invalid`,
        registrationNumber: `BT1-${Date.now()}`,
        status: ProfessionalStatus.ACTIVE,
        practiceId,
      },
    }),
    prisma.professional.create({
      data: {
        fullName: 'Bulk Test Pro 2',
        email: `bulk-pro-2-${Date.now()}@test.invalid`,
        registrationNumber: `BT2-${Date.now()}`,
        status: ProfessionalStatus.ACTIVE,
        practiceId,
      },
    }),
  ]);
  prof1Id = p1.id;
  prof2Id = p2.id;
});

afterAll(async () => {
  await prisma.professional.deleteMany({ where: { id: { in: [prof1Id, prof2Id] } } });
});

describe('bulkDeleteProfessionals', () => {
  it('soft-deletes professionals by setting status to INACTIVE', async () => {
    const n = await bulkDeleteProfessionals([prof1Id]);
    expect(n).toBe(1);
    const p = await prisma.professional.findUnique({ where: { id: prof1Id } });
    expect(p?.status).toBe(ProfessionalStatus.INACTIVE);
  });
});

describe('bulkSetProfessionalStatus', () => {
  it('sets status on multiple professionals', async () => {
    const n = await bulkSetProfessionalStatus([prof1Id, prof2Id], ProfessionalStatus.INACTIVE);
    expect(n).toBe(2);
  });
});

describe('exportProfessionals', () => {
  it('returns an array of professional records', async () => {
    const rows = await exportProfessionals({ practiceId });
    expect(Array.isArray(rows)).toBe(true);
    // our fixtures should be in the export
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(prof1Id);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/professionals.test.ts 2>&1 | tail -20
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Add service functions**

Append to the bottom of `src/services/professional/professional.service.ts`:

```typescript
// ============================================
// Bulk operations
// ============================================

/**
 * Soft-delete professionals by setting status INACTIVE.
 * Returns count of updated records.
 */
export async function bulkDeleteProfessionals(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.professional.updateMany({
    where: { id: { in: ids } },
    data: { status: ProfessionalStatus.INACTIVE },
  });
  return result.count;
}

/**
 * Set status on a batch of professionals.
 * Returns count of updated records.
 */
export async function bulkSetProfessionalStatus(
  ids: string[],
  status: ProfessionalStatus,
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.professional.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
  return result.count;
}

// ============================================
// Export
// ============================================

export interface ProfessionalExportParams {
  practiceId?: string;
  status?: ProfessionalStatus;
}

/**
 * Return all professionals matching filters as a flat array for export.
 */
export async function exportProfessionals(
  params: ProfessionalExportParams,
): Promise<unknown[]> {
  const where: Record<string, unknown> = {};
  if (params.practiceId) where.practiceId = params.practiceId;
  if (params.status) where.status = params.status;

  return prisma.professional.findMany({
    where,
    include: { practice: { select: { id: true, name: true } } },
    orderBy: { fullName: 'asc' },
  });
}
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/complete-in-progress/professionals.test.ts 2>&1 | tail -10
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Create bulk delete route**

```typescript
// src/app/api/v1/professionals/bulk/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkDeleteProfessionals } from '@/services/professional/professional.service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', 'ids must be a non-empty array of strings'), { status: 400 });
  }
  const count = await bulkDeleteProfessionals(parsed.data.ids);
  return NextResponse.json({ message: `${count} professionals deactivated successfully`, data: { updated: count } });
});
```

- [ ] **Step 6: Create bulk status route**

```typescript
// src/app/api/v1/professionals/bulk/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkSetProfessionalStatus } from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';
import { z } from 'zod';

const schema = z.object({
  ids: z.array(z.string()).min(1),
  status: z.nativeEnum(ProfessionalStatus),
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input'), { status: 400 });
  }
  const count = await bulkSetProfessionalStatus(parsed.data.ids, parsed.data.status);
  return NextResponse.json({ message: `${count} professionals updated`, data: { updated: count } });
});
```

- [ ] **Step 7: Create export route**

```typescript
// src/app/api/v1/professionals/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { exportProfessionals } from '@/services/professional/professional.service';
import { ProfessionalStatus } from '@prisma/client';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const { searchParams } = req.nextUrl;
  const params = {
    practiceId: actor.role === 'CLINIC_ADMIN' ? actor.practiceId : (searchParams.get('practiceId') ?? undefined),
    status: (searchParams.get('status') as ProfessionalStatus | null) ?? undefined,
  };
  const data = await exportProfessionals(params);
  return NextResponse.json(
    { status: true, message: 'Professionals data retrieved successfully', data },
    { headers: { 'Content-Disposition': 'attachment; filename="professionals-export.json"' } },
  );
});
```

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "professionals" | head -20
```

Expected: no new errors related to these files.

- [ ] **Step 9: Commit**

```bash
git add src/services/professional/professional.service.ts \
  src/app/api/v1/professionals/bulk/ \
  src/app/api/v1/professionals/export/ \
  tests/complete-in-progress/professionals.test.ts
git commit -m "feat(professionals): bulk delete/status + export endpoints"
```

---

## Task 3: Professionals — resend-credentials (single + bulk)

**Files:**
- Create: `src/app/api/v1/professionals/[id]/resend-credentials/route.ts`
- Create: `src/app/api/v1/professionals/bulk/resend-credentials/route.ts`

**Context:** "Resend credentials" in KiviCare triggers a WordPress email with login link. PraktiQU does not yet have a WordPress credential email integration, so these routes return a success-shaped `501 Not Implemented` stub with a clear message. Do NOT wire up actual email sending — that belongs in a future slice when the WP credential email integration is designed.

- [ ] **Step 1: Create single resend-credentials route**

```typescript
// src/app/api/v1/professionals/[id]/resend-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';

type RouteParams = { params: { id: string } };

export const POST = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  // Stub: WordPress credential email integration not yet implemented
  return NextResponse.json(
    {
      status: false,
      message: 'Credential email delivery is not yet configured. Contact your system administrator.',
    },
    { status: 501 },
  );
});
```

- [ ] **Step 2: Create bulk resend-credentials route**

```typescript
// src/app/api/v1/professionals/bulk/resend-credentials/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';

export const POST = withAuth(async (_req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  return NextResponse.json(
    {
      status: false,
      message: 'Credential email delivery is not yet configured. Contact your system administrator.',
    },
    { status: 501 },
  );
});
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/professionals/[id]/resend-credentials/ \
  src/app/api/v1/professionals/bulk/resend-credentials/
git commit -m "feat(professionals): resend-credentials stub endpoints"
```

---

## Task 4: Sessions — bulk delete + export

**Files:**
- Modify: `src/services/session/session.service.ts`
- Create: `src/app/api/v1/sessions/bulk/delete/route.ts`
- Create: `src/app/api/v1/sessions/export/route.ts`
- Create: `tests/complete-in-progress/sessions.test.ts`

**Context:** Read `src/services/session/session.service.ts` before implementing. The session service uses Prisma (not raw SQL). Sessions use `SessionStatus` from `@prisma/client`. The route pattern for sessions uses a local `getActor` helper that reads from headers (see `src/app/api/v1/sessions/route.ts`) — but for these new routes, use the same `getActor` from `@/lib/auth` that clients use (more mature pattern).

- [ ] **Step 1: Write failing tests**

```typescript
// tests/complete-in-progress/sessions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { bulkDeleteSessions, exportSessions } from '@/services/session/session.service';
import { SessionStatus } from '@prisma/client';

let clientId: string;
let professionalId: string;
let practiceId: string;
let session1Id: string;
let session2Id: string;

beforeAll(async () => {
  const practice = await prisma.practice.findFirst();
  if (!practice) throw new Error('Need a practice in DB');
  practiceId = practice.id;

  const client = await prisma.user.findFirst({ where: { role: 'CLIENT' } });
  const professional = await prisma.professional.findFirst({ where: { practiceId } });
  if (!client || !professional) throw new Error('Need at least one CLIENT user and one professional');
  clientId = client.id;
  professionalId = professional.id;

  const now = new Date();
  const [s1, s2] = await Promise.all([
    prisma.session.create({
      data: {
        clientId,
        professionalId,
        practiceId,
        status: SessionStatus.PENDING,
        startAt: new Date(now.getTime() + 86400000),
        endAt: new Date(now.getTime() + 90000000),
      },
    }),
    prisma.session.create({
      data: {
        clientId,
        professionalId,
        practiceId,
        status: SessionStatus.PENDING,
        startAt: new Date(now.getTime() + 172800000),
        endAt: new Date(now.getTime() + 176400000),
      },
    }),
  ]);
  session1Id = s1.id;
  session2Id = s2.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { id: { in: [session1Id, session2Id] } } });
});

describe('bulkDeleteSessions', () => {
  it('cancels sessions by setting status to CANCELLED', async () => {
    const n = await bulkDeleteSessions([session1Id]);
    expect(n).toBe(1);
    const s = await prisma.session.findUnique({ where: { id: session1Id } });
    expect(s?.status).toBe(SessionStatus.CANCELLED);
  });
});

describe('exportSessions', () => {
  it('returns an array of session records', async () => {
    const rows = await exportSessions({ practiceId });
    expect(Array.isArray(rows)).toBe(true);
    const ids = rows.map((r: any) => r.id);
    expect(ids).toContain(session2Id);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/sessions.test.ts 2>&1 | tail -20
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Add service functions**

Read `src/services/session/session.service.ts` to understand imports and types, then append:

```typescript
// Add to src/services/session/session.service.ts

/**
 * Cancel a batch of sessions by ID.
 * Returns count of updated records.
 */
export async function bulkDeleteSessions(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.session.updateMany({
    where: { id: { in: ids } },
    data: { status: SessionStatus.CANCELLED },
  });
  return result.count;
}

export interface SessionExportParams {
  practiceId?: string;
  status?: SessionStatus;
  from?: Date;
  to?: Date;
}

/**
 * Return all sessions matching filters as flat array for export.
 */
export async function exportSessions(params: SessionExportParams): Promise<unknown[]> {
  const where: Record<string, unknown> = {};
  if (params.practiceId) where.practiceId = params.practiceId;
  if (params.status) where.status = params.status;
  if (params.from || params.to) {
    where.startAt = {};
    if (params.from) (where.startAt as any).gte = params.from;
    if (params.to) (where.startAt as any).lte = params.to;
  }
  return prisma.session.findMany({
    where,
    include: {
      client: { select: { id: true, fullName: true, email: true } },
      professional: { select: { id: true, fullName: true } },
    },
    orderBy: { startAt: 'desc' },
  });
}
```

Note: `SessionStatus` import — verify it's already imported in the file; add it if not:
```typescript
import { SessionStatus } from '@prisma/client';
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/complete-in-progress/sessions.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Create bulk delete route**

```typescript
// src/app/api/v1/sessions/bulk/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { bulkDeleteSessions } from '@/services/session/session.service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400, detail: 'ids must be a non-empty array of strings' }, { status: 400 });
    }
    const count = await bulkDeleteSessions(parsed.data.ids);
    return NextResponse.json({ message: `${count} sessions cancelled`, data: { updated: count } });
  } catch (err) {
    console.error('[POST /sessions/bulk/delete]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create export route**

```typescript
// src/app/api/v1/sessions/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { exportSessions } from '@/services/session/session.service';
import { SessionStatus } from '@prisma/client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const { searchParams } = req.nextUrl;
    const params = {
      practiceId: actor.role === 'SUPER_ADMIN' ? (searchParams.get('practiceId') ?? undefined) : (actor.practiceId ?? undefined),
      status: (searchParams.get('status') as SessionStatus | null) ?? undefined,
      from: searchParams.get('from') ? new Date(searchParams.get('from')!) : undefined,
      to: searchParams.get('to') ? new Date(searchParams.get('to')!) : undefined,
    };
    const data = await exportSessions(params);
    return NextResponse.json(
      { status: true, message: 'Sessions data retrieved successfully', data },
      { headers: { 'Content-Disposition': 'attachment; filename="sessions-export.json"' } },
    );
  } catch (err) {
    console.error('[GET /sessions/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "session" | grep -v "node_modules" | head -20
```

- [ ] **Step 8: Commit**

```bash
git add src/services/session/session.service.ts \
  src/app/api/v1/sessions/bulk/ \
  src/app/api/v1/sessions/export/ \
  tests/complete-in-progress/sessions.test.ts
git commit -m "feat(sessions): bulk delete + export endpoints"
```

---

## Task 5: Sessions — print-invoice, summary, view, payment stubs, video conference stub

**Files:**
- Create: `src/app/api/v1/sessions/[id]/print-invoice/route.ts`
- Create: `src/app/api/v1/sessions/[id]/summary/route.ts`
- Create: `src/app/api/v1/sessions/payment-cancel/route.ts`
- Create: `src/app/api/v1/sessions/payment-success/route.ts`
- Create: `src/app/api/v1/sessions/payment-verify/route.ts`
- Create: `src/app/api/v1/sessions/payment-webhook/route.ts`
- Create: `src/app/api/v1/sessions/[id]/regenerate-video-conference/route.ts`

**Context:** These are stubs — payment gateway and video conference integrations are not yet configured. Print-invoice redirects to the bill print endpoint if a bill exists. Summary returns session detail. All payment routes return 501. Video conference route returns 501.

- [ ] **Step 1: Create print-invoice route**

Read `src/app/api/v1/sessions/[id]/route.ts` to understand how to fetch a session. Then:

```typescript
// src/app/api/v1/sessions/[id]/print-invoice/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { getSession } from '@/services/session/session.service';

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const session = await getSession(params.id, actor);
    if (!session) {
      return NextResponse.json({ type: '/errors/not-found', title: 'Session not found', status: 404 }, { status: 404 });
    }
    // Redirect client to bills/by-encounter if a bill exists for this session
    const billUrl = `/api/v1/bills/by-encounter/${params.id}`;
    return NextResponse.redirect(new URL(billUrl, req.url));
  } catch (err) {
    console.error('[GET /sessions/[id]/print-invoice]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

Note: If `getSession` is not exported from the session service, read the service file and use whatever the correct export name is (e.g. `getSessionById`). Adjust import accordingly.

- [ ] **Step 2: Create summary route**

```typescript
// src/app/api/v1/sessions/[id]/summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { getSession } from '@/services/session/session.service';

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const session = await getSession(params.id, actor);
    if (!session) {
      return NextResponse.json({ type: '/errors/not-found', title: 'Session not found', status: 404 }, { status: 404 });
    }
    return NextResponse.json({ status: true, message: 'Session summary retrieved', data: session });
  } catch (err) {
    console.error('[GET /sessions/[id]/summary]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create payment stub routes**

```typescript
// src/app/api/v1/sessions/payment-cancel/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Payment gateway integration not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/sessions/payment-success/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Payment gateway integration not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/sessions/payment-verify/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Payment gateway integration not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/sessions/payment-webhook/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Payment gateway integration not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/sessions/[id]/regenerate-video-conference/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Video conference integration not yet configured.' }, { status: 501 });
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "session" | grep -v "node_modules" | head -20
```

Fix any import errors (e.g. if `getSession` is named differently in the service). If the function doesn't exist, read the session service and use whatever function returns a single session by id.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/sessions/[id]/print-invoice/ \
  src/app/api/v1/sessions/[id]/summary/ \
  src/app/api/v1/sessions/payment-cancel/ \
  src/app/api/v1/sessions/payment-success/ \
  src/app/api/v1/sessions/payment-verify/ \
  src/app/api/v1/sessions/payment-webhook/ \
  src/app/api/v1/sessions/[id]/regenerate-video-conference/
git commit -m "feat(sessions): print-invoice redirect + summary + payment/video stubs"
```

---

## Task 6: Practices — bulk delete, status, export, users, change-admin, resend-credentials

**Files:**
- Modify: `src/services/practice/service.ts`
- Create: `src/app/api/v1/practices/bulk/delete/route.ts`
- Create: `src/app/api/v1/practices/bulk/status/route.ts`
- Create: `src/app/api/v1/practices/bulk/resend-credentials/route.ts`
- Create: `src/app/api/v1/practices/export/route.ts`
- Create: `src/app/api/v1/practices/[id]/resend-credentials/route.ts`
- Create: `src/app/api/v1/practices/[id]/users/route.ts`
- Create: `src/app/api/v1/practices/[id]/change-admin/route.ts`
- Create: `tests/complete-in-progress/practices.test.ts`

**Context:** Read `src/services/practice/service.ts` before implementing to understand the Practice model shape. The practice routes use `NextResponse.json` and `logging` from `@/lib/logging`. In Prisma, the Practice model may be named differently than "Practice" — verify in the service file.

- [ ] **Step 1: Read service file**

Read `src/services/practice/service.ts` fully to understand: what the Practice model is called in Prisma, what fields exist (id, name, status, adminId, etc.), what functions are already exported.

- [ ] **Step 2: Write failing tests**

```typescript
// tests/complete-in-progress/practices.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkDeletePractices,
  bulkSetPracticeStatus,
  exportPractices,
  listPracticeUsers,
} from '@/services/practice/service';

// These tests use the first existing practices in the DB — do NOT create/delete practices
// as they are linked to many other records
let practice1Id: string;
let practice2Id: string;

beforeAll(async () => {
  const practices = await prisma.practice.findMany({ take: 2 });
  if (practices.length < 1) throw new Error('Need at least 1 practice in DB');
  practice1Id = practices[0].id;
  practice2Id = practices[1]?.id ?? practices[0].id;
});

describe('bulkDeletePractices', () => {
  it('returns count of updated records without erroring', async () => {
    // We do not actually delete — use an empty array to avoid side effects
    const n = await bulkDeletePractices([]);
    expect(n).toBe(0);
  });
});

describe('bulkSetPracticeStatus', () => {
  it('returns count 0 for empty ids', async () => {
    const n = await bulkSetPracticeStatus([], 'INACTIVE');
    expect(n).toBe(0);
  });
});

describe('exportPractices', () => {
  it('returns an array', async () => {
    const rows = await exportPractices({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('listPracticeUsers', () => {
  it('returns an array for a valid practice', async () => {
    const users = await listPracticeUsers(practice1Id);
    expect(Array.isArray(users)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/practices.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Add service functions**

After reading the practice service to understand model name and status enum, append to `src/services/practice/service.ts`:

```typescript
// Bulk operations
export async function bulkDeletePractices(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  // "Delete" practices by setting status to INACTIVE
  const result = await prisma.practice.updateMany({
    where: { id: { in: ids } },
    data: { status: 'INACTIVE' },  // adjust status string to match Prisma enum if needed
  });
  return result.count;
}

export async function bulkSetPracticeStatus(ids: string[], status: string): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.practice.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
  return result.count;
}

export async function exportPractices(params: { status?: string }): Promise<unknown[]> {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  return prisma.practice.findMany({ where, orderBy: { name: 'asc' } });
}

export async function listPracticeUsers(practiceId: string): Promise<unknown[]> {
  // Return all users (professionals + receptionist role) linked to this practice
  return prisma.user.findMany({
    where: { practiceId },
    select: { id: true, email: true, role: true, createdAt: true },
  });
}

export async function changePracticeAdmin(
  practiceId: string,
  newAdminId: string,
): Promise<void> {
  await prisma.practice.update({
    where: { id: practiceId },
    data: { adminId: newAdminId },
  });
}
```

Note: Adjust field names (`status`, `adminId`) to match the actual Practice Prisma model. Read `prisma/schema.prisma` or the service file to verify.

- [ ] **Step 5: Run tests, confirm they pass**

```bash
npx vitest run tests/complete-in-progress/practices.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Create routes**

```typescript
// src/app/api/v1/practices/bulk/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkDeletePractices } from '@/services/practice/service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Only Super Admin can delete practices'), { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', 'ids required'), { status: 400 });
  }
  const count = await bulkDeletePractices(parsed.data.ids);
  return NextResponse.json({ message: `${count} practices deactivated`, data: { updated: count } });
});
```

```typescript
// src/app/api/v1/practices/bulk/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { bulkSetPracticeStatus } from '@/services/practice/service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1), status: z.string() });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Only Super Admin can update practice status'), { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input'), { status: 400 });
  }
  const count = await bulkSetPracticeStatus(parsed.data.ids, parsed.data.status);
  return NextResponse.json({ message: `${count} practices updated`, data: { updated: count } });
});
```

```typescript
// src/app/api/v1/practices/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { exportPractices } from '@/services/practice/service';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Only Super Admin can export practices'), { status: 403 });
  }
  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const data = await exportPractices({ status });
  return NextResponse.json(
    { status: true, message: 'Practices data retrieved successfully', data },
    { headers: { 'Content-Disposition': 'attachment; filename="practices-export.json"' } },
  );
});
```

```typescript
// src/app/api/v1/practices/bulk/resend-credentials/route.ts
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

export const POST = withAuth(async () => {
  return NextResponse.json({ status: false, message: 'Credential email delivery not yet configured.' }, { status: 501 });
});
```

```typescript
// src/app/api/v1/practices/[id]/resend-credentials/route.ts
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

export const POST = withAuth(async () => {
  return NextResponse.json({ status: false, message: 'Credential email delivery not yet configured.' }, { status: 501 });
});
```

```typescript
// src/app/api/v1/practices/[id]/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { listPracticeUsers } from '@/services/practice/service';

type RouteParams = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const users = await listPracticeUsers(ctx.params.id);
  return NextResponse.json({ status: true, message: 'Practice users retrieved', data: users });
});
```

```typescript
// src/app/api/v1/practices/[id]/change-admin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { changePracticeAdmin } from '@/services/practice/service';
import { z } from 'zod';

type RouteParams = { params: { id: string } };
const schema = z.object({ newAdminId: z.string().cuid() });

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Only Super Admin can change practice admin'), { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', 'newAdminId (cuid) required'), { status: 400 });
  }
  await changePracticeAdmin(ctx.params.id, parsed.data.newAdminId);
  return NextResponse.json({ status: true, message: 'Practice admin updated successfully' });
});
```

- [ ] **Step 7: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "practice" | grep -v "node_modules" | head -20
git add src/services/practice/service.ts \
  src/app/api/v1/practices/ \
  tests/complete-in-progress/practices.test.ts
git commit -m "feat(practices): bulk delete/status/export + users + change-admin + resend-creds stub"
```

---

## Task 7: Clients — bulk delete, status, export, statistics, resend-credentials

**Files:**
- Modify: `src/services/client/client.service.ts`
- Create: `src/app/api/v1/clients/bulk/delete/route.ts`
- Create: `src/app/api/v1/clients/bulk/status/route.ts`
- Create: `src/app/api/v1/clients/bulk/resend-credentials/route.ts`
- Create: `src/app/api/v1/clients/export/route.ts`
- Create: `src/app/api/v1/clients/[id]/resend-credentials/route.ts`
- Create: `src/app/api/v1/clients/[id]/statistics/route.ts`
- Create: `tests/complete-in-progress/clients.test.ts`

**Context:** Read `src/services/client/client.service.ts` before implementing. Client uses `ClientStatus` from `@prisma/client`. Client status change is done via `setClientStatus` (or similar) — read the file to find the exact method name. Route pattern: use `getActor` from `@/lib/auth`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/complete-in-progress/clients.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bulkArchiveClients,
  bulkSetClientStatus,
  exportClients,
  getClientStatistics,
} from '@/services/client/client.service';
import { ClientStatus } from '@prisma/client';

let client1Id: string;
let client2Id: string;
let practiceId: string;

beforeAll(async () => {
  const practice = await prisma.practice.findFirst();
  if (!practice) throw new Error('Need a practice in DB');
  practiceId = practice.id;

  const ts = Date.now();
  const [c1, c2] = await Promise.all([
    prisma.client.create({
      data: {
        fullName: 'Bulk Client 1',
        email: `bulk-c1-${ts}@test.invalid`,
        practiceId,
        status: ClientStatus.ACTIVE,
      },
    }),
    prisma.client.create({
      data: {
        fullName: 'Bulk Client 2',
        email: `bulk-c2-${ts}@test.invalid`,
        practiceId,
        status: ClientStatus.ACTIVE,
      },
    }),
  ]);
  client1Id = c1.id;
  client2Id = c2.id;
});

afterAll(async () => {
  await prisma.client.deleteMany({ where: { id: { in: [client1Id, client2Id] } } });
});

describe('bulkArchiveClients', () => {
  it('archives clients by setting status ARCHIVED', async () => {
    const n = await bulkArchiveClients([client1Id]);
    expect(n).toBe(1);
    const c = await prisma.client.findUnique({ where: { id: client1Id } });
    expect(c?.status).toBe(ClientStatus.ARCHIVED);
  });
});

describe('bulkSetClientStatus', () => {
  it('sets status on multiple clients', async () => {
    const n = await bulkSetClientStatus([client1Id, client2Id], ClientStatus.INACTIVE);
    expect(n).toBe(2);
  });
});

describe('exportClients', () => {
  it('returns an array', async () => {
    const rows = await exportClients({ practiceId });
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe('getClientStatistics', () => {
  it('returns session count and bill total for a client', async () => {
    const stats = await getClientStatistics(client1Id);
    expect(typeof stats.totalSessions).toBe('number');
    expect(typeof stats.totalBilled).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/clients.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Add service functions**

Append to `src/services/client/client.service.ts`:

```typescript
// Bulk operations

export async function bulkArchiveClients(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.client.updateMany({
    where: { id: { in: ids } },
    data: { status: ClientStatus.ARCHIVED },
  });
  return result.count;
}

export async function bulkSetClientStatus(ids: string[], status: ClientStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.client.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
  return result.count;
}

export interface ClientExportParams {
  practiceId?: string;
  status?: ClientStatus;
}

export async function exportClients(params: ClientExportParams): Promise<unknown[]> {
  const where: Record<string, unknown> = {};
  if (params.practiceId) where.practiceId = params.practiceId;
  if (params.status) where.status = params.status;
  return prisma.client.findMany({ where, orderBy: { fullName: 'asc' } });
}

export interface ClientStatistics {
  totalSessions: number;
  totalBilled: number;
  lastSessionAt: Date | null;
}

export async function getClientStatistics(clientId: string): Promise<ClientStatistics> {
  const [sessionCount, lastSession] = await Promise.all([
    prisma.session.count({ where: { clientId } }),
    prisma.session.findFirst({ where: { clientId }, orderBy: { startAt: 'desc' }, select: { startAt: true } }),
  ]);
  return {
    totalSessions: sessionCount,
    totalBilled: 0, // bill total requires joining wp_kc_bills — left as 0 until KC billing link is needed
    lastSessionAt: lastSession?.startAt ?? null,
  };
}
```

Note: If `ClientStatus` is not yet imported, add: `import { ClientStatus } from '@prisma/client';`

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/complete-in-progress/clients.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Create routes**

```typescript
// src/app/api/v1/clients/bulk/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { bulkArchiveClients } from '@/services/client/client.service';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400 }, { status: 400 });
    }
    const count = await bulkArchiveClients(parsed.data.ids);
    return NextResponse.json({ message: `${count} clients archived`, data: { updated: count } });
  } catch (err) {
    console.error('[POST /clients/bulk/delete]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/clients/bulk/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { bulkSetClientStatus } from '@/services/client/client.service';
import { ClientStatus } from '@prisma/client';
import { z } from 'zod';

const schema = z.object({ ids: z.array(z.string()).min(1), status: z.nativeEnum(ClientStatus) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400, detail: parsed.error.issues[0]?.message }, { status: 400 });
    }
    const count = await bulkSetClientStatus(parsed.data.ids, parsed.data.status);
    return NextResponse.json({ message: `${count} clients updated`, data: { updated: count } });
  } catch (err) {
    console.error('[POST /clients/bulk/status]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/clients/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { exportClients } from '@/services/client/client.service';
import { ClientStatus } from '@prisma/client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    if (!['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const { searchParams } = req.nextUrl;
    const params = {
      practiceId: actor.role === 'SUPER_ADMIN' ? (searchParams.get('practiceId') ?? undefined) : (actor.practiceId ?? undefined),
      status: (searchParams.get('status') as ClientStatus | null) ?? undefined,
    };
    const data = await exportClients(params);
    return NextResponse.json(
      { status: true, message: 'Clients data retrieved successfully', data },
      { headers: { 'Content-Disposition': 'attachment; filename="clients-export.json"' } },
    );
  } catch (err) {
    console.error('[GET /clients/export]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/clients/bulk/resend-credentials/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Credential email delivery not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/clients/[id]/resend-credentials/route.ts
import { NextResponse } from 'next/server';
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Credential email delivery not yet configured.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/clients/[id]/statistics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { getClientStatistics } from '@/services/client/client.service';

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const actor = await getActor(req);
    const canView = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'].includes(actor.role)
      || (actor.role === 'CLIENT' && actor.id === params.id);
    if (!canView) {
      return NextResponse.json({ type: '/errors/forbidden', title: 'Forbidden', status: 403 }, { status: 403 });
    }
    const data = await getClientStatistics(params.id);
    return NextResponse.json({ status: true, message: 'Client statistics retrieved', data });
  } catch (err) {
    console.error('[GET /clients/[id]/statistics]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "client" | grep -v "node_modules" | head -20
git add src/services/client/client.service.ts \
  src/app/api/v1/clients/ \
  tests/complete-in-progress/clients.test.ts
git commit -m "feat(clients): bulk archive/status/export + statistics + resend-creds stub"
```

---

## Task 8: Auth — register, change-password, reset-password, delete-account

**Files:**
- Create: `src/app/api/v1/auth/register/route.ts`
- Create: `src/app/api/v1/auth/change-password/route.ts`
- Create: `src/app/api/v1/auth/reset-password/route.ts`
- Create: `src/app/api/v1/auth/delete-account/route.ts`
- Create: `tests/complete-in-progress/auth.test.ts`

**Context:** Read the existing auth routes (`src/app/api/v1/auth/login/route.ts`, `src/app/api/v1/auth/forgot-password/route.ts`) and `src/services/auth/` before implementing. The auth service may already have password-related utilities — reuse them. `register` creates a CLIENT-role user. `delete-account` soft-deletes (sets user inactive). `reset-password` and `change-password` both hash the new password with bcrypt (same library the login flow uses).

- [ ] **Step 1: Read existing auth**

Read `src/app/api/v1/auth/login/route.ts` and `src/app/api/v1/auth/forgot-password/route.ts` to understand: the password hashing library (bcrypt? argon2?), the User prisma model fields, the JWT library used.

- [ ] **Step 2: Write failing tests**

```typescript
// tests/complete-in-progress/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  registerUser,
  changeUserPassword,
} from '@/services/auth/auth.service';

const testEmail = `auth-test-${Date.now()}@test.invalid`;
let userId: string;

beforeAll(async () => {
  // Clean up any leftover test user
  await prisma.user.deleteMany({ where: { email: testEmail } });
});

afterAll(async () => {
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe('registerUser', () => {
  it('creates a CLIENT user and returns id + email', async () => {
    const result = await registerUser({ email: testEmail, password: 'TestPass123!', fullName: 'Auth Test User' });
    expect(result.email).toBe(testEmail);
    expect(result.id).toBeTruthy();
    userId = result.id;
  });

  it('rejects duplicate email', async () => {
    await expect(
      registerUser({ email: testEmail, password: 'TestPass123!', fullName: 'Dup' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
  });
});

describe('changeUserPassword', () => {
  it('updates password hash', async () => {
    await expect(
      changeUserPassword({ userId, currentPassword: 'TestPass123!', newPassword: 'NewPass456!' }),
    ).resolves.not.toThrow();
  });

  it('rejects wrong current password', async () => {
    await expect(
      changeUserPassword({ userId, currentPassword: 'WrongPass!', newPassword: 'Anything1!' }),
    ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/auth.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Add service functions**

Read the existing `src/services/auth/` directory. If there is no `auth.service.ts`, create it. Add:

```typescript
// src/services/auth/auth.service.ts  (create if not exists, or append to existing auth service)
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';  // use whichever bcrypt library is already in package.json

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
}

export async function registerUser(input: RegisterInput): Promise<{ id: string; email: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw { code: 'DUPLICATE_EMAIL', message: 'Email already registered' };

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: 'CLIENT',
    },
  });
  return { id: user.id, email: user.email };
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export async function changeUserPassword(input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw { code: 'USER_NOT_FOUND', message: 'User not found' };

  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) throw { code: 'WRONG_PASSWORD', message: 'Current password is incorrect' };

  const newHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({ where: { id: input.userId }, data: { passwordHash: newHash } });
}

export async function softDeleteUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
}
```

Note: Check the actual field names in the User Prisma model — `passwordHash` may be called `password` or `hashedPassword`. Check `prisma/schema.prisma` or the existing login route to confirm. Adjust accordingly.

- [ ] **Step 5: Run tests, confirm they pass**

```bash
npx vitest run tests/complete-in-progress/auth.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Create route files**

```typescript
// src/app/api/v1/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { registerUser } from '@/services/auth/auth.service';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ type: '/errors/validation', title: 'Validation failed', status: 400, detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const result = await registerUser(parsed.data);
    return NextResponse.json({ status: true, message: 'User registered successfully', data: result }, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'DUPLICATE_EMAIL') {
      return NextResponse.json({ type: '/errors/conflict', title: 'Email already registered', status: 409 }, { status: 409 });
    }
    console.error('[POST /auth/register]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/auth/change-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { changeUserPassword } from '@/services/auth/auth.service';
import { z } from 'zod';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400, detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    await changeUserPassword({ userId: actor.id, ...parsed.data });
    return NextResponse.json({ status: true, message: 'Password changed successfully' });
  } catch (err: any) {
    if (err?.code === 'WRONG_PASSWORD') {
      return NextResponse.json({ type: '/errors/unauthorized', title: 'Incorrect current password', status: 401 }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
```

```typescript
// src/app/api/v1/auth/reset-password/route.ts
import { NextResponse } from 'next/server';
// Reset-password requires a token-based flow (email link → token → new password).
// The token generation/verification is implemented in the forgot-password + this route pair.
// Stub until token flow is designed in a future slice.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'Password reset via token is not yet implemented. Use /auth/forgot-password to initiate.' }, { status: 501 });
}
```

```typescript
// src/app/api/v1/auth/delete-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { softDeleteUser } from '@/services/auth/auth.service';

export const POST = withAuth(async (_req: NextRequest, ctx) => {
  const { actor } = ctx as any;
  await softDeleteUser(actor.id);
  return NextResponse.json({ status: true, message: 'Account deactivated successfully' });
});
```

- [ ] **Step 7: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "auth" | grep -v "node_modules" | head -20
git add src/services/auth/ \
  src/app/api/v1/auth/register/ \
  src/app/api/v1/auth/change-password/ \
  src/app/api/v1/auth/reset-password/ \
  src/app/api/v1/auth/delete-account/ \
  tests/complete-in-progress/auth.test.ts
git commit -m "feat(auth): register + change-password + delete-account; reset-password stub"
```

---

## Task 9: Consent forms + Custom fields — missing operations

**Files:**
- Modify: `src/app/api/v1/consent-forms/[id]/route.ts` — add DELETE handler
- Modify: `src/services/consent/service.ts` — add `setFormStatus`, `setFieldStatus`, `saveCustomFieldData`, `getCustomFieldData`
- Create: `src/app/api/v1/consent-forms/[id]/status/route.ts`
- Modify: `src/app/api/v1/custom-fields/[id]/route.ts` — verify DELETE exists; add if not
- Create: `src/app/api/v1/custom-fields/[id]/status/route.ts`
- Create: `src/app/api/v1/custom-fields/[id]/save-data/route.ts`
- Create: `src/app/api/v1/custom-fields/[id]/get-data/route.ts`
- Create: `src/app/api/v1/custom-fields/file-upload/route.ts`
- Create: `tests/complete-in-progress/forms-fields.test.ts`

**Context:** Read `src/services/consent/service.ts` and `src/app/api/v1/consent-forms/[id]/route.ts` and `src/services/custom-fields/` (if it exists) before implementing. The `ConsentService` is a class — add new methods to it. For custom-fields, read the existing `src/app/api/v1/custom-fields/[id]/route.ts` to understand what's already there.

- [ ] **Step 1: Read existing service + routes**

Read:
- `src/services/consent/service.ts` (or wherever ConsentService is defined)
- `src/app/api/v1/consent-forms/[id]/route.ts`
- `src/app/api/v1/custom-fields/[id]/route.ts`

Note the Prisma model names used.

- [ ] **Step 2: Write failing tests**

```typescript
// tests/complete-in-progress/forms-fields.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { ConsentService } from '@/services/consent/service';

const service = new ConsentService(prisma);

describe('ConsentService.setFormStatus', () => {
  it('exists as a method', () => {
    expect(typeof service.setFormStatus).toBe('function');
  });
});

describe('ConsentService.deleteForm', () => {
  it('exists as a method', () => {
    expect(typeof service.deleteForm).toBe('function');
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

```bash
npx vitest run tests/complete-in-progress/forms-fields.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Add methods to ConsentService**

Read the ConsentService class fully, then add methods:

```typescript
// Add to ConsentService class in src/services/consent/service.ts

async setFormStatus(id: string, status: string): Promise<unknown> {
  return this.prisma.consentForm.update({
    where: { id },
    data: { status },
  });
}

async deleteForm(id: string): Promise<void> {
  await this.prisma.consentForm.delete({ where: { id } });
}
```

Note: use the correct Prisma model name — it may be `consentForm` or something else. Check the existing `getForm` method to see which model it queries.

- [ ] **Step 5: Add DELETE to consent-forms route**

Edit `src/app/api/v1/consent-forms/[id]/route.ts` — append:

```typescript
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const form = await service.getForm(params.id);
  if (!form) return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
  await service.deleteForm(params.id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 6: Create consent-forms status route**

```typescript
// src/app/api/v1/consent-forms/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ConsentService } from '@/services/consent/service';
import { z } from 'zod';

const prisma = new PrismaClient();
const service = new ConsentService(prisma);
const schema = z.object({ status: z.string().min(1) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ type: 'about:blank', title: 'Validation failed', status: 400 }, { status: 400 });
  }
  try {
    const updated = await service.setFormStatus(params.id, parsed.data.status);
    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 7: Create custom-fields status, save-data, get-data routes**

Read `src/app/api/v1/custom-fields/[id]/route.ts` to understand the custom-field model. Then:

```typescript
// src/app/api/v1/custom-fields/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const schema = z.object({ status: z.string().min(1) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400 }, { status: 400 });
  }
  try {
    // Use whatever prisma model name custom-fields uses — read existing route to confirm
    const updated = await (prisma as any).customField.update({
      where: { id: params.id },
      data: { status: parsed.data.status },
    });
    return NextResponse.json({ status: true, message: 'Custom field status updated', data: updated });
  } catch (err: any) {
    if (err?.code === 'P2025') return NextResponse.json({ type: '/errors/not-found', title: 'Not found', status: 404 }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/custom-fields/[id]/save-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';

// Custom field values are stored as JSON in a separate table (CustomFieldValue or similar).
// Read the Prisma schema to confirm the model name.
const schema = z.object({ value: z.unknown(), entityId: z.string() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ type: '/errors/validation', title: 'Invalid input', status: 400, detail: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    // Upsert the custom field value for this entity
    const record = await (prisma as any).customFieldValue.upsert({
      where: { customFieldId_entityId: { customFieldId: params.id, entityId: parsed.data.entityId } },
      update: { value: JSON.stringify(parsed.data.value) },
      create: { customFieldId: params.id, entityId: parsed.data.entityId as string, value: JSON.stringify(parsed.data.value) },
    });
    return NextResponse.json({ status: true, message: 'Custom field value saved', data: record });
  } catch (err) {
    console.error('[POST /custom-fields/[id]/save-data]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/custom-fields/[id]/get-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const entityId = req.nextUrl.searchParams.get('entityId');
  if (!entityId) {
    return NextResponse.json({ type: '/errors/validation', title: 'entityId query param required', status: 400 }, { status: 400 });
  }
  try {
    const record = await (prisma as any).customFieldValue.findUnique({
      where: { customFieldId_entityId: { customFieldId: params.id, entityId } },
    });
    return NextResponse.json({ status: true, message: 'Custom field data retrieved', data: record ?? null });
  } catch (err) {
    console.error('[GET /custom-fields/[id]/get-data]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

```typescript
// src/app/api/v1/custom-fields/file-upload/route.ts
import { NextResponse } from 'next/server';
// File upload for custom fields requires multipart/form-data + storage integration.
// Stub until storage (S3/local) is configured.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ status: false, message: 'File upload for custom fields is not yet configured.' }, { status: 501 });
}
```

Note: For `save-data` and `get-data`, if the `CustomFieldValue` model or its unique constraint name is different, read `prisma/schema.prisma` and adjust the model name and `where` clause.

- [ ] **Step 8: Run tests**

```bash
npx vitest run tests/complete-in-progress/forms-fields.test.ts 2>&1 | tail -10
```

- [ ] **Step 9: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "consent|custom" | grep -v "node_modules" | head -20
git add src/services/consent/ \
  src/app/api/v1/consent-forms/ \
  src/app/api/v1/custom-fields/ \
  tests/complete-in-progress/forms-fields.test.ts
git commit -m "feat(consent-forms,custom-fields): delete, status, save-data, get-data endpoints"
```

---

## Task 10: Doctor services — bulk delete, status, export

**Files:**
- Create: `src/app/api/v1/professionals/[id]/services/bulk/delete/route.ts`
- Create: `src/app/api/v1/professionals/[id]/services/bulk/status/route.ts`
- Create: `src/app/api/v1/professionals/[id]/services/export/route.ts`

**Context:** Read `src/app/api/v1/professionals/[id]/services/route.ts` to understand the DoctorService model (may be `ProfessionalService` in Prisma). The services route uses a specific prisma model — read it to get the correct model name and fields.

- [ ] **Step 1: Read existing services route**

Read `src/app/api/v1/professionals/[id]/services/route.ts` and note: the Prisma model name for doctor services (e.g. `doctorService`, `professionalService`), the fields (id, professionalId, status, etc.).

- [ ] **Step 2: Create bulk delete route**

```typescript
// src/app/api/v1/professionals/[id]/services/bulk/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { prisma } from '@/lib/db';
import { z } from 'zod';

type RouteParams = { params: { id: string } };
const schema = z.object({ ids: z.array(z.number().int()).min(1) });

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', 'ids must be a non-empty array of integers'), { status: 400 });
  }
  // Use the correct model name from the services route
  const result = await (prisma as any).doctorService.updateMany({
    where: { id: { in: parsed.data.ids }, professionalId: ctx.params.id },
    data: { status: 0 },  // 0 = inactive in KiviCare convention
  });
  return NextResponse.json({ status: true, message: `${result.count} services deactivated`, data: { updated: result.count } });
});
```

- [ ] **Step 3: Create bulk status route**

```typescript
// src/app/api/v1/professionals/[id]/services/bulk/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden, validationError } from '@/lib/problem-details';
import { prisma } from '@/lib/db';
import { z } from 'zod';

type RouteParams = { params: { id: string } };
const schema = z.object({ ids: z.array(z.number().int()).min(1), status: z.number().int().min(0).max(1) });

export const POST = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(validationError('invalid_input', parsed.error.issues[0]?.message ?? 'Invalid input'), { status: 400 });
  }
  const result = await (prisma as any).doctorService.updateMany({
    where: { id: { in: parsed.data.ids }, professionalId: ctx.params.id },
    data: { status: parsed.data.status },
  });
  return NextResponse.json({ status: true, message: `${result.count} services updated`, data: { updated: result.count } });
});
```

- [ ] **Step 4: Create export route**

```typescript
// src/app/api/v1/professionals/[id]/services/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { prisma } from '@/lib/db';

type RouteParams = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  const data = await (prisma as any).doctorService.findMany({
    where: { professionalId: ctx.params.id },
    orderBy: { id: 'asc' },
  });
  return NextResponse.json(
    { status: true, message: 'Doctor services data retrieved successfully', data },
    { headers: { 'Content-Disposition': `attachment; filename="doctor-${ctx.params.id}-services-export.json"` } },
  );
});
```

Note: If the Prisma model name is different (e.g. `professionalService` instead of `doctorService`), update accordingly. Read the existing services route to confirm.

- [ ] **Step 5: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | grep "services" | grep -v "node_modules" | head -20
git add src/app/api/v1/professionals/[id]/services/
git commit -m "feat(doctor-services): bulk delete/status + export endpoints"
```

---

## Task 11: Route integration tests + full suite

**Files:**
- Create: `tests/complete-in-progress/routes.integration.test.ts`

**Context:** Integration tests verify envelope shape, 401 on missing token, and 403 on wrong role. Use the same pattern as `tests/billing/routes.integration.test.ts`.

- [ ] **Step 1: Write integration tests**

```typescript
// tests/complete-in-progress/routes.integration.test.ts
import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_API_URL ?? 'http://localhost:3000';

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token?: string) {
  return fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('bulk delete routes — auth matrix', () => {
  it('returns 401 on missing token for professionals bulk delete', async () => {
    const res = await post('/api/v1/professionals/bulk/delete', { ids: [] });
    expect(res.status).toBe(401);
  });

  it('returns 401 on missing token for sessions bulk delete', async () => {
    const res = await post('/api/v1/sessions/bulk/delete', { ids: [] });
    expect(res.status).toBe(401);
  });

  it('returns 401 on missing token for clients bulk delete', async () => {
    const res = await post('/api/v1/clients/bulk/delete', { ids: [] });
    expect(res.status).toBe(401);
  });

  it('returns 401 on missing token for practices bulk delete', async () => {
    const res = await post('/api/v1/practices/bulk/delete', { ids: [] });
    expect(res.status).toBe(401);
  });
});

describe('export routes — auth matrix', () => {
  it('returns 401 on missing token for professionals export', async () => {
    const res = await get('/api/v1/professionals/export');
    expect(res.status).toBe(401);
  });

  it('returns 401 on missing token for sessions export', async () => {
    const res = await get('/api/v1/sessions/export');
    expect(res.status).toBe(401);
  });

  it('returns 401 on missing token for clients export', async () => {
    const res = await get('/api/v1/clients/export');
    expect(res.status).toBe(401);
  });
});

describe('payment stub routes', () => {
  it('POST /sessions/payment-cancel returns 501', async () => {
    const res = await post('/api/v1/sessions/payment-cancel', {});
    expect(res.status).toBe(501);
  });

  it('POST /sessions/payment-success returns 501', async () => {
    const res = await post('/api/v1/sessions/payment-success', {});
    expect(res.status).toBe(501);
  });
});

describe('auth register — public endpoint', () => {
  it('returns 400 on empty body', async () => {
    const res = await post('/api/v1/auth/register', {});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run full vitest suite**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Fix any type errors. Common issues:
- Model name mismatches (e.g. `prisma.doctorService` vs `prisma.professionalService`) — read schema to confirm
- Missing imports (`SessionStatus`, `ClientStatus`)
- `getSession` export name in session service

- [ ] **Step 4: Lint**

```bash
npx next lint 2>&1 | grep -v "node_modules" | head -20
```

- [ ] **Step 5: Commit tests**

```bash
git add tests/complete-in-progress/routes.integration.test.ts
git commit -m "test(complete-in-progress): route integration tests — auth matrix + stubs"
```

- [ ] **Step 6: Final status**

```bash
npx vitest run 2>&1 | grep -E "passed|failed"
git log --oneline -10
```

Expected:
- All tests passing
- ~8-10 commits visible on this branch

---

## Notes for Implementer

**Pattern lookup:** When a module's existing code uses a different Prisma model name than expected, always read the existing route/service file first — don't guess.

**Prisma model names:** All custom-field and doctor-service routes use `(prisma as any).modelName` as a safety escape hatch because the Prisma model names may differ from the Next.js convention. After reading the schema, replace `(prisma as any).modelName` with the typed version.

**Stub routes are intentional:** `resend-credentials`, `payment-*`, `regenerate-video-conference`, `file-upload`, and `reset-password` return 501. This is correct — do not wire up unimplemented integrations.

**getActor vs withAuth:** Sessions use `getActor` (from `@/lib/auth`); professionals use `withAuth`. Both are valid — use whichever matches the existing pattern in that module's route files.
