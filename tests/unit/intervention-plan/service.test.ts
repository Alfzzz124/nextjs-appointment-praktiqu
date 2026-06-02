/**
 * Unit tests for the InterventionPlan service.
 *
 * Uses an in-memory stub Prisma client. No real DB. No Next.js runtime.
 *
 * Coverage:
 *   - createPlan: success, duplicate-sessionId 409, forbidden for client
 *   - getPlan: success, 404, professional/client/receptionist read access
 *   - listPlans: scoping by role
 *   - addItem: success, forbidden for client
 *   - completeItem: success, already-completed 409, wrong-plan 404, forbidden
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PlanStatus, ItemStatus, PrismaClient } from '@prisma/client';
import {
  createInterventionPlanService,
  InterventionPlanError,
  type Caller,
  type InterventionPlanService,
} from '@/services/intervention-plan/service';
import { InterventionPlanErrorCodes } from '@/types/intervention-plan';

// -------------------------------------------------------------
// In-memory Prisma stub
// -------------------------------------------------------------

type Item = {
  id: string;
  interventionPlanId: string;
  description: string;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
  status: ItemStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Plan = {
  id: string;
  sessionId: string;
  professionalId: string;
  clientId: string;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
  items: Item[];
};

class StubPrisma {
  plans: Plan[] = [];
  id = 0;

  interventionPlan = {
    findUnique: async ({ where }: { where: { id?: string; sessionId?: string } }) => {
      const plan = this.plans.find(
        (p) => (where.id && p.id === where.id) || (where.sessionId && p.sessionId === where.sessionId),
      );
      return plan ?? null;
    },
    create: async ({ data, include }: { data: Omit<Plan, 'id' | 'createdAt' | 'updatedAt' | 'items'> & { items?: { create: unknown[] } }; include?: { items: boolean } }) => {
      const plan: Plan = {
        id: `plan_${++this.id}`,
        sessionId: data.sessionId,
        professionalId: data.professionalId,
        clientId: data.clientId,
        status: data.status,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      };
      this.plans.push(plan);
      return include?.items ? plan : plan;
    },
    findMany: async ({
      where,
      include,
      take,
      cursor,
      skip,
      orderBy: _orderBy,
    }: {
      where?: Partial<Plan>;
      include?: { items: boolean };
      take?: number;
      cursor?: { id: string };
      skip?: number;
      orderBy?: unknown;
    }) => {
      let rows = this.plans.filter((p) => {
        if (!where) return true;
        return Object.entries(where).every(([k, v]) => (p as unknown as Record<string, unknown>)[k] === v);
      });
      if (cursor) {
        const idx = rows.findIndex((p) => p.id === cursor.id);
        if (idx >= 0) rows = rows.slice(idx + (skip ?? 0));
      }
      return take ? rows.slice(0, take) : rows;
    },
  };

  recommendationItem = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      for (const p of this.plans) {
        const item = p.items.find((i) => i.id === where.id);
        if (item) return item;
      }
      return null;
    },
    create: async ({ data }: { data: Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'completedAt'> & Partial<Pick<Item, 'status' | 'completedAt'>> }) => {
      const item: Item = {
        id: `item_${++this.id}`,
        interventionPlanId: data.interventionPlanId,
        description: data.description,
        frequency: data.frequency ?? null,
        durationDays: data.durationDays ?? null,
        instructions: data.instructions ?? null,
        status: data.status ?? 'ACTIVE',
        completedAt: data.completedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const plan = this.plans.find((p) => p.id === data.interventionPlanId);
      plan?.items.push(item);
      return item;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
      for (const p of this.plans) {
        const idx = p.items.findIndex((i) => i.id === where.id);
        if (idx >= 0) {
          p.items[idx] = { ...p.items[idx]!, ...data, updatedAt: new Date() };
          return p.items[idx]!;
        }
      }
      throw new Error('item not found');
    },
  };
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

const professional: Caller = { userId: 'prof_1', role: 'PROFESSIONAL' };
const client: Caller = { userId: 'client_1', role: 'CLIENT' };
const otherClient: Caller = { userId: 'client_2', role: 'CLIENT' };
const receptionist: Caller = { userId: 'rec_1', role: 'RECEPTIONIST' };
const admin: Caller = { userId: 'admin_1', role: 'SUPER_ADMIN' };

let stub: StubPrisma;
let service: InterventionPlanService;

beforeEach(() => {
  stub = new StubPrisma();
  // The service only calls PrismaClient methods we stub; cast is safe.
  service = createInterventionPlanService(stub as unknown as PrismaClient);
});

describe('createPlan', () => {
  it('creates a plan linked to a session', async () => {
    const plan = await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    expect(plan.sessionId).toBe('sess_1');
    expect(plan.professionalId).toBe('prof_1');
    expect(plan.clientId).toBe('client_1');
    expect(plan.status).toBe('ACTIVE');
    expect(plan.items).toEqual([]);
  });

  it('rejects duplicate plan for the same session (409)', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    await expect(
      service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional),
    ).rejects.toMatchObject({ code: InterventionPlanErrorCodes.PLAN_ALREADY_EXISTS, status: 409 });
  });

  it('forbids clients from creating plans', async () => {
    await expect(
      service.createPlan({ sessionId: 'sess_x', clientId: 'client_1' }, client),
    ).rejects.toBeInstanceOf(InterventionPlanError);
  });
});

describe('getPlan', () => {
  beforeEach(async () => {
    await service.createPlan({ sessionId: 'sess_a', clientId: 'client_1' }, professional);
  });

  it('returns the plan to the owning professional', async () => {
    const list = await service.listPlans(professional);
    const plan = await service.getPlan(list.plans[0]!.id, professional);
    expect(plan.id).toBe(list.plans[0]!.id);
  });

  it('returns the plan to the owning client', async () => {
    const list = await service.listPlans(professional);
    const plan = await service.getPlan(list.plans[0]!.id, client);
    expect(plan.id).toBe(list.plans[0]!.id);
  });

  it('returns the plan to a receptionist (read-only)', async () => {
    const list = await service.listPlans(professional);
    const plan = await service.getPlan(list.plans[0]!.id, receptionist);
    expect(plan.id).toBe(list.plans[0]!.id);
  });

  it('forbids a different client from reading the plan', async () => {
    const list = await service.listPlans(professional);
    await expect(service.getPlan(list.plans[0]!.id, otherClient)).rejects.toMatchObject({
      code: InterventionPlanErrorCodes.FORBIDDEN,
      status: 403,
    });
  });

  it('returns 404 for an unknown plan', async () => {
    await expect(service.getPlan('missing', admin)).rejects.toMatchObject({
      code: InterventionPlanErrorCodes.PLAN_NOT_FOUND,
      status: 404,
    });
  });
});

describe('listPlans', () => {
  beforeEach(async () => {
    await service.createPlan({ sessionId: 'sess_a', clientId: 'client_1' }, professional);
    await service.createPlan({ sessionId: 'sess_b', clientId: 'client_2' }, professional);
  });

  it('scopes to the calling professional', async () => {
    const { plans } = await service.listPlans(professional);
    expect(plans).toHaveLength(2);
  });

  it('scopes to the calling client', async () => {
    const { plans } = await service.listPlans(client);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.clientId).toBe('client_1');
  });

  it('returns all plans to a super admin', async () => {
    const { plans } = await service.listPlans(admin);
    expect(plans).toHaveLength(2);
  });
});

describe('addItem', () => {
  it('adds a recommendation item as the owning professional', async () => {
    const { plans } = await service.listPlans(
      await (async () => {
        await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
        return professional;
      })(),
    );
    const item = await service.addItem(
      plans[0]!.id,
      { description: 'Daily journaling', frequency: 'Daily', durationDays: 30 },
      professional,
    );
    expect(item.description).toBe('Daily journaling');
    expect(item.frequency).toBe('Daily');
    expect(item.durationDays).toBe(30);
    expect(item.status).toBe('ACTIVE');
  });

  it('forbids a client from adding items', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    const { plans } = await service.listPlans(professional);
    await expect(
      service.addItem(plans[0]!.id, { description: 'X' }, client),
    ).rejects.toMatchObject({ code: InterventionPlanErrorCodes.FORBIDDEN, status: 403 });
  });
});

describe('completeItem', () => {
  it('lets the owning client mark an item COMPLETED', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    const { plans } = await service.listPlans(professional);
    const item = await service.addItem(plans[0]!.id, { description: 'X' }, professional);
    const completed = await service.completeItem(plans[0]!.id, item.id, {}, client);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeInstanceOf(Date);
  });

  it('rejects double-completion (409)', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    const { plans } = await service.listPlans(professional);
    const item = await service.addItem(plans[0]!.id, { description: 'X' }, professional);
    await service.completeItem(plans[0]!.id, item.id, {}, client);
    await expect(
      service.completeItem(plans[0]!.id, item.id, {}, client),
    ).rejects.toMatchObject({ code: InterventionPlanErrorCodes.ITEM_ALREADY_COMPLETED, status: 409 });
  });

  it('forbids the professional from completing on behalf of the client', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    const { plans } = await service.listPlans(professional);
    const item = await service.addItem(plans[0]!.id, { description: 'X' }, professional);
    await expect(
      service.completeItem(plans[0]!.id, item.id, {}, professional),
    ).rejects.toMatchObject({ code: InterventionPlanErrorCodes.FORBIDDEN, status: 403 });
  });

  it('returns 404 for an item belonging to a different plan', async () => {
    await service.createPlan({ sessionId: 'sess_1', clientId: 'client_1' }, professional);
    await service.createPlan({ sessionId: 'sess_2', clientId: 'client_1' }, professional);
    const list = await service.listPlans(professional);
    const firstPlan = list.plans.find((p) => p.sessionId === 'sess_1')!;
    const secondPlan = list.plans.find((p) => p.sessionId === 'sess_2')!;
    const item = await service.addItem(firstPlan.id, { description: 'X' }, professional);
    await expect(
      service.completeItem(secondPlan.id, item.id, {}, client),
    ).rejects.toMatchObject({ code: InterventionPlanErrorCodes.ITEM_NOT_FOUND, status: 404 });
  });
});
