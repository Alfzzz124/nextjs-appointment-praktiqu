/**
 * InterventionPlan service.
 *
 * Owns all reads and writes for `InterventionPlan` and `RecommendationItem`.
 * Source of truth: specs/009-intervention-plan/spec.md
 *
 * Authorization model:
 *   - PROFESSIONAL: can create plans (linked to their own session), add items,
 *     and read any plan they own.
 *   - CLIENT: can read their own plan, and can mark recommendation items as
 *     COMPLETED. Cannot mutate plan content.
 *   - RECEPTIONIST / CLINIC_ADMIN: read-only on plans in their clinic.
 *
 * Audit (FR-004):
 *   - Plan creation logs `intervention_plan.create` at AUDIT level.
 *   - Item completion logs `intervention_plan.item.complete` at AUDIT level.
 *
 * All Prisma access is funnelled through a single injected client so unit
 * tests can pass a stub.
 */

import type { PrismaClient, PlanStatus, ItemStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import {
  AddItemInput,
  CompleteItemInput,
  CreatePlanInput,
  InterventionPlanErrorCodes,
  type InterventionPlanWithItems,
  type RecommendationItemDto,
} from '@/types/intervention-plan';

// -------------------------------------------------------------
// Custom errors
// -------------------------------------------------------------

export class InterventionPlanError extends Error {
  readonly code: (typeof InterventionPlanErrorCodes)[keyof typeof InterventionPlanErrorCodes];
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: (typeof InterventionPlanErrorCodes)[keyof typeof InterventionPlanErrorCodes],
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'InterventionPlanError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// -------------------------------------------------------------
// Caller context (the authenticated user)
// -------------------------------------------------------------

export type CallerRole = 'PROFESSIONAL' | 'CLIENT' | 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'SUPER_ADMIN';

export interface Caller {
  userId: string;
  role: CallerRole;
}

// -------------------------------------------------------------
// Service contract
// -------------------------------------------------------------

export interface InterventionPlanService {
  /**
   * US1 — Professional creates a plan linked to a session + client.
   * One plan per session — duplicate (sessionId) is rejected with 409.
   */
  createPlan(input: CreatePlanInput, caller: Caller): Promise<InterventionPlanWithItems>;

  /** US1/US3 — Read a plan with all items. */
  getPlan(planId: string, caller: Caller): Promise<InterventionPlanWithItems>;

  /** List plans visible to the caller. */
  listPlans(
    caller: Caller,
    options?: { status?: PlanStatus; limit?: number; cursor?: string },
  ): Promise<{ plans: InterventionPlanWithItems[]; nextCursor: string | null }>;

  /** US2 — Professional adds a recommendation item. */
  addItem(
    planId: string,
    input: AddItemInput,
    caller: Caller,
  ): Promise<RecommendationItemDto>;

  /** US3 — Client marks an item COMPLETED. */
  completeItem(
    planId: string,
    itemId: string,
    input: CompleteItemInput,
    caller: Caller,
  ): Promise<RecommendationItemDto>;
}

// -------------------------------------------------------------
// Authorization helpers
// -------------------------------------------------------------

function assertReadAccess(plan: { professionalId: string; clientId: string }, caller: Caller): void {
  if (caller.role === 'SUPER_ADMIN' || caller.role === 'RECEPTIONIST' || caller.role === 'CLINIC_ADMIN') {
    return;
  }
  if (caller.role === 'PROFESSIONAL' && plan.professionalId === caller.userId) return;
  if (caller.role === 'CLIENT' && plan.clientId === caller.userId) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

function assertWriteAccessForPlan(
  plan: { professionalId: string; clientId: string },
  caller: Caller,
): void {
  // Only the owning professional (or a super admin) can mutate plan content.
  if (caller.role === 'SUPER_ADMIN') return;
  if (caller.role === 'PROFESSIONAL' && plan.professionalId === caller.userId) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

function assertClientCanComplete(
  plan: { clientId: string },
  caller: Caller,
): void {
  if (caller.role === 'CLIENT' && plan.clientId === caller.userId) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

// -------------------------------------------------------------
// Mapper (Prisma row → DTO)
// -------------------------------------------------------------

function toItemDto(row: {
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
}): RecommendationItemDto {
  return {
    id: row.id,
    interventionPlanId: row.interventionPlanId,
    description: row.description,
    frequency: row.frequency,
    durationDays: row.durationDays,
    instructions: row.instructions,
    status: row.status,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPlanWithItems(plan: {
  id: string;
  sessionId: string;
  professionalId: string;
  clientId: string;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
  items?: {
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
  }[];
}): InterventionPlanWithItems {
  return {
    id: plan.id,
    sessionId: plan.sessionId,
    professionalId: plan.professionalId,
    clientId: plan.clientId,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    items: (plan.items ?? []).map(toItemDto),
  };
}

// -------------------------------------------------------------
// Implementation
// -------------------------------------------------------------

class DefaultInterventionPlanService implements InterventionPlanService {
  constructor(private readonly db: PrismaClient) {}

  async createPlan(input: CreatePlanInput, caller: Caller): Promise<InterventionPlanWithItems> {
    if (caller.role !== 'PROFESSIONAL' && caller.role !== 'SUPER_ADMIN') {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.FORBIDDEN,
        'only the professional can create a plan',
        403,
      );
    }

    // sessionId has a @unique constraint — surface a friendlier 409.
    const existing = await this.db.interventionPlan.findUnique({ where: { sessionId: input.sessionId } });
    if (existing) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_ALREADY_EXISTS,
        'a plan already exists for this session',
        409,
      );
    }

    const created = await this.db.interventionPlan.create({
      data: {
        sessionId: input.sessionId,
        professionalId: caller.userId,
        clientId: input.clientId,
        items: { create: [] },
      },
      include: { items: true },
    });

    await logging.audit('intervention_plan.create', {
      userId: caller.userId,
      resource: 'intervention_plan',
      resourceId: created.id,
      metadata: { sessionId: created.sessionId, clientId: created.clientId },
    });

    return toPlanWithItems(created);
  }

  async getPlan(planId: string, caller: Caller): Promise<InterventionPlanWithItems> {
    const plan = await this.db.interventionPlan.findUnique({
      where: { id: planId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!plan) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'intervention plan not found',
        404,
      );
    }
    assertReadAccess(plan, caller);
    return toPlanWithItems(plan);
  }

  async listPlans(
    caller: Caller,
    options: { status?: PlanStatus; limit?: number; cursor?: string } = {},
  ): Promise<{ plans: InterventionPlanWithItems[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (caller.role === 'PROFESSIONAL') where.professionalId = caller.userId;
    else if (caller.role === 'CLIENT') where.clientId = caller.userId;
    // RECEPTIONIST / CLINIC_ADMIN / SUPER_ADMIN see all (clinic scoping deferred
    // to the API layer when that data is wired in).

    const rows = await this.db.interventionPlan.findMany({
      where,
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      plans: slice.map(toPlanWithItems),
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  }

  async addItem(planId: string, input: AddItemInput, caller: Caller): Promise<RecommendationItemDto> {
    const plan = await this.db.interventionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'intervention plan not found',
        404,
      );
    }
    assertWriteAccessForPlan(plan, caller);

    const item = await this.db.recommendationItem.create({
      data: {
        interventionPlanId: plan.id,
        description: input.description,
        frequency: input.frequency ?? null,
        durationDays: input.durationDays ?? null,
        instructions: input.instructions ?? null,
      },
    });

    await logging.activity('intervention_plan.item.add', {
      userId: caller.userId,
      resource: 'recommendation_item',
      resourceId: item.id,
      metadata: { planId: plan.id, description: item.description },
    });

    return toItemDto(item);
  }

  async completeItem(
    planId: string,
    itemId: string,
    _input: CompleteItemInput,
    caller: Caller,
  ): Promise<RecommendationItemDto> {
    const plan = await this.db.interventionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'intervention plan not found',
        404,
      );
    }
    assertClientCanComplete(plan, caller);

    const item = await this.db.recommendationItem.findUnique({ where: { id: itemId } });
    if (!item || item.interventionPlanId !== planId) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.ITEM_NOT_FOUND,
        'recommendation item not found',
        404,
      );
    }
    if (item.status === 'COMPLETED') {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.ITEM_ALREADY_COMPLETED,
        'item is already completed',
        409,
      );
    }

    const updated = await this.db.recommendationItem.update({
      where: { id: itemId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await logging.audit('intervention_plan.item.complete', {
      userId: caller.userId,
      resource: 'recommendation_item',
      resourceId: updated.id,
      metadata: { planId: plan.id, completedAt: updated.completedAt },
    });

    return toItemDto(updated);
  }
}

// -------------------------------------------------------------
// Singleton export
// -------------------------------------------------------------

export const interventionPlanService: InterventionPlanService = new DefaultInterventionPlanService(
  defaultPrisma,
);

/** Test seam — build a service against a stub Prisma client. */
export function createInterventionPlanService(db: PrismaClient): InterventionPlanService {
  return new DefaultInterventionPlanService(db);
}
