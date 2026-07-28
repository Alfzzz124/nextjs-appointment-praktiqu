// tests/integration/intervention-plan/plan-creation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { POST, GET } from '@/app/api/v1/intervention-plans/route';
import { authHeaders } from '../../helpers/auth';

// Auth is now JWT-based; mint a professional Bearer token once for the suite.
let AUTH: Record<string, string>;
/** Test-owned actor id, so cleanup can find exactly this suite's rows. */
const PROFESSIONAL_ID = 'itest-prof-plan-creation';

/** Session ids this suite writes. InterventionPlan.sessionId is @unique. */
const OWNED_SESSION_IDS = ['s1', 's1-no-items'];

async function wipe() {
  // Items reference plans, so they go first. RecommendationItem has no relation filter
  // back to the plan, only interventionPlanId — hence the two-step.
  // Match by sessionId as well as professional: sessionId is @unique, so a row written
  // by any earlier actor still blocks this suite's create with a 409.
  const plans = await prisma.interventionPlan.findMany({
    where: { OR: [{ professionalId: PROFESSIONAL_ID }, { sessionId: { in: OWNED_SESSION_IDS } }] },
    select: { id: true },
  });
  if (plans.length > 0) {
    await prisma.recommendationItem.deleteMany({
      where: { interventionPlanId: { in: plans.map((p) => p.id) } },
    });
  }
  await prisma.interventionPlan.deleteMany({ where: { professionalId: PROFESSIONAL_ID } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  AUTH = await authHeaders({ userId: PROFESSIONAL_ID, role: 'PROFESSIONAL' });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/**
 * Runs against the real test database rather than a hand-rolled @prisma/client mock.
 *
 * The mock only defined `interventionPlan` and `recommendationItem`, so it broke as soon
 * as the service touched anything else and every request came back 500 — while the route
 * against a real client returns 201. The mock was testing itself, not the code.
 */

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any;
}

describe('POST /api/v1/intervention-plans', () => {
  it('creates plan', async () => {
    const req = makeReq('http://localhost/api/v1/intervention-plans', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ sessionId: 's1', clientId: 'c1', items: [{ description: 'Test' }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('ignores an items array — items are added through a separate endpoint', async () => {
    // CreatePlanInput accepts only sessionId and clientId; recommendation items are
    // added via POST /:id/items. This asserted 400 for `items: []`, a contract the API
    // has never had — and it only ever "failed loudly" because it reused the sessionId
    // above, so the @unique constraint returned 409 before validation was reached.
    const req = makeReq('http://localhost/api/v1/intervention-plans', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ sessionId: 's1-no-items', clientId: 'c1', items: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

describe('GET /api/v1/intervention-plans', () => {
  it('returns empty list', async () => {
    const req = makeReq('http://localhost/api/v1/intervention-plans', { headers: AUTH });
    const res = await GET(req);
    expect(res.status).toBe(200);
    // The route returns { plans, nextCursor } — this asserted `items`, which the API
    // has never returned.
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
  });
});