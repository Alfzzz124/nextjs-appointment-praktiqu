/**
 * InterventionPlan API routes — the HTTP contract.
 *
 * The old suite was DB-backed against `intervention_plans`, which no longer exists: a
 * plan is a KiviCare encounter now (phase E4). Persistence has its own coverage in
 * tests/repositories/wp-clinical-records.repo.test.ts and the service's own suite, so
 * what is left to check here is what only a route can get wrong — auth, id parsing,
 * validation, and status-code mapping.
 *
 * The service is mocked for that reason. `callerFromRequest` is left real, so the 401
 * path still exercises genuine JWT verification.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authHeaders } from '../../helpers/auth';

vi.mock('@/services/billing/kc-actor', () => ({
  // Every authenticated caller resolves to a WordPress id; which one does not matter
  // here because the service is mocked.
  resolveKcActor: vi.fn(async (actor: { id: string; role: string }) => ({
    actor,
    wpUserId: 29n,
    clinicId: 3n,
  })),
}));

const svc = vi.hoisted(() => ({
  createPlan: vi.fn(),
  getPlan: vi.fn(),
  listPlans: vi.fn(),
  addItem: vi.fn(),
  completeItem: vi.fn(),
}));
vi.mock('@/services/intervention-plan/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/intervention-plan/service')>();
  return { ...actual, interventionPlanService: svc };
});

import { GET, POST } from '@/app/api/v1/intervention-plans/route';
import { GET as getPlan } from '@/app/api/v1/intervention-plans/[id]/route';
import { POST as addItem } from '@/app/api/v1/intervention-plans/[id]/items/route';
import { PATCH as completeItem } from '@/app/api/v1/intervention-plans/[id]/items/[itemId]/complete/route';
import { InterventionPlanError } from '@/services/intervention-plan/service';

const PLAN = 91;
const ITEM = 700;
const SESSION = 5150;

let PROFESSIONAL_HEADERS: Record<string, string>;
let CLIENT_HEADERS: Record<string, string>;

beforeAll(async () => {
  PROFESSIONAL_HEADERS = await authHeaders({ userId: 'prof_1', role: 'PROFESSIONAL' });
  CLIENT_HEADERS = await authHeaders({ userId: 'client_1', role: 'CLIENT' });
});

function plan() {
  return {
    id: PLAN,
    sessionId: String(SESSION),
    professionalId: '29',
    clientId: '461',
    status: 'ACTIVE',
    createdAt: new Date('2026-07-15T00:00:00Z'),
    items: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.createPlan.mockResolvedValue(plan());
  svc.getPlan.mockResolvedValue(plan());
  svc.listPlans.mockResolvedValue({ plans: [plan()], total: 1 });
  svc.addItem.mockResolvedValue({ id: ITEM, interventionPlanId: PLAN, description: 'x' });
  svc.completeItem.mockResolvedValue({ id: ITEM, status: 'COMPLETED' });
});

function req(url: string, init: RequestInit = {}) {
  return new NextRequest(url, init);
}

describe('POST /api/v1/intervention-plans', () => {
  it('creates a plan and returns 201', async () => {
    const res = await POST(
      req('http://localhost/api/v1/intervention-plans', {
        method: 'POST',
        headers: PROFESSIONAL_HEADERS,
        body: JSON.stringify({ sessionId: String(SESSION), clientId: '461' }),
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).sessionId).toBe(String(SESSION));
  });

  it('returns 400 for missing sessionId', async () => {
    const res = await POST(
      req('http://localhost/api/v1/intervention-plans', {
        method: 'POST',
        headers: PROFESSIONAL_HEADERS,
        body: JSON.stringify({ clientId: '461' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await POST(
      req('http://localhost/api/v1/intervention-plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: String(SESSION), clientId: '461' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/intervention-plans', () => {
  it('lists plans with page-based pagination', async () => {
    const res = await GET(
      req('http://localhost/api/v1/intervention-plans', { headers: PROFESSIONAL_HEADERS }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    // `nextCursor` is gone: encounters have no stable cursor, and the old one was an
    // `intervention_plans` cuid that no longer exists.
    expect(body).toHaveProperty('total');
    expect(body).not.toHaveProperty('nextCursor');
  });
});

describe('GET /api/v1/intervention-plans/:id', () => {
  it('404s for a non-numeric id instead of querying NaN', async () => {
    const res = await getPlan(req('http://localhost/api/v1/intervention-plans/missing', { headers: PROFESSIONAL_HEADERS }), {
      params: { id: 'missing' },
    });

    expect(res.status).toBe(404);
    // Rejected before the service is reached at all.
    expect(svc.getPlan).not.toHaveBeenCalled();
  });

  it('passes a numeric id through as a number', async () => {
    const res = await getPlan(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}`, { headers: PROFESSIONAL_HEADERS }),
      { params: { id: String(PLAN) } },
    );

    expect(res.status).toBe(200);
    expect(svc.getPlan.mock.calls[0][0]).toBe(PLAN);
  });

  it('maps a service 404 onto an HTTP 404', async () => {
    svc.getPlan.mockRejectedValue(
      new InterventionPlanError('intervention_plan_not_found', 'not found', 404),
    );

    const res = await getPlan(
      req('http://localhost/api/v1/intervention-plans/99999', { headers: PROFESSIONAL_HEADERS }),
      { params: { id: '99999' } },
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/intervention-plans/:id/items', () => {
  it('404s for a non-numeric plan id', async () => {
    const res = await addItem(
      req('http://localhost/api/v1/intervention-plans/missing/items', {
        method: 'POST',
        headers: PROFESSIONAL_HEADERS,
        body: JSON.stringify({ description: 'Meditate daily' }),
      }),
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for a missing description', async () => {
    const res = await addItem(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}/items`, {
        method: 'POST',
        headers: PROFESSIONAL_HEADERS,
        body: JSON.stringify({}),
      }),
      { params: { id: String(PLAN) } },
    );
    expect(res.status).toBe(400);
  });

  it('creates an item and returns 201', async () => {
    const res = await addItem(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}/items`, {
        method: 'POST',
        headers: PROFESSIONAL_HEADERS,
        body: JSON.stringify({ description: 'Journaling', durationDays: 30 }),
      }),
      { params: { id: String(PLAN) } },
    );

    expect(res.status).toBe(201);
    expect(svc.addItem.mock.calls[0][0]).toBe(PLAN);
    expect(svc.addItem.mock.calls[0][1]).toMatchObject({
      description: 'Journaling',
      durationDays: 30,
    });
  });
});

describe('PATCH /api/v1/intervention-plans/:id/items/:itemId/complete', () => {
  it('404s for a non-numeric plan id', async () => {
    const res = await completeItem(
      req('http://localhost/api/v1/intervention-plans/missing/items/1/complete', {
        method: 'PATCH',
        headers: CLIENT_HEADERS,
        body: JSON.stringify({}),
      }),
      { params: { id: 'missing', itemId: '1' } },
    );
    expect(res.status).toBe(404);
  });

  it('404s for a non-numeric item id', async () => {
    const res = await completeItem(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}/items/item_1/complete`, {
        method: 'PATCH',
        headers: CLIENT_HEADERS,
        body: JSON.stringify({}),
      }),
      { params: { id: String(PLAN), itemId: 'item_1' } },
    );
    expect(res.status).toBe(404);
    expect(svc.completeItem).not.toHaveBeenCalled();
  });

  it('completes an item with both ids as numbers', async () => {
    const res = await completeItem(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}/items/${ITEM}/complete`, {
        method: 'PATCH',
        headers: CLIENT_HEADERS,
        body: JSON.stringify({}),
      }),
      { params: { id: String(PLAN), itemId: String(ITEM) } },
    );

    expect(res.status).toBe(200);
    expect(svc.completeItem.mock.calls[0].slice(0, 2)).toEqual([PLAN, ITEM]);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await completeItem(
      req(`http://localhost/api/v1/intervention-plans/${PLAN}/items/${ITEM}/complete`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { id: String(PLAN), itemId: String(ITEM) } },
    );
    expect(res.status).toBe(401);
  });
});
