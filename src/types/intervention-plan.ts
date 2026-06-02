/**
 * Intervention Plan — domain types and Zod validation schemas.
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 *
 * Conventions:
 *   - All IDs are CUIDs (cuid() default in Prisma).
 *   - Timestamps are ISO 8601 strings on the wire; Date in the service layer.
 *   - Plan status is ACTIVE → COMPLETED.
 *   - Item status is ACTIVE → COMPLETED. Only the client can complete items.
 */

import { z } from 'zod';
import { PlanStatus, ItemStatus } from '@prisma/client';

// -------------------------------------------------------------
// Enum-like string unions for runtime validation
// -------------------------------------------------------------

export const PlanStatusEnum = z.enum(['ACTIVE', 'COMPLETED']);
export const ItemStatusEnum = z.enum(['ACTIVE', 'COMPLETED']);

// -------------------------------------------------------------
// Entity shapes (returned by the service layer)
// -------------------------------------------------------------

export interface InterventionPlanDto {
  id: string;
  sessionId: string;
  professionalId: string;
  clientId: string;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecommendationItemDto {
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
}

export interface InterventionPlanWithItems extends InterventionPlanDto {
  items: RecommendationItemDto[];
}

// -------------------------------------------------------------
// Wire format (API responses — Dates serialised to ISO strings)
// -------------------------------------------------------------

const PlanWireSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  professionalId: z.string().min(1),
  clientId: z.string().min(1),
  status: PlanStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ItemWireSchema = z.object({
  id: z.string().min(1),
  interventionPlanId: z.string().min(1),
  description: z.string().min(1),
  frequency: z.string().nullable(),
  durationDays: z.number().int().nonnegative().nullable(),
  instructions: z.string().nullable(),
  status: ItemStatusEnum,
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PlanWithItemsWireSchema = PlanWireSchema.extend({
  items: z.array(ItemWireSchema),
});

export type PlanWithItemsWire = z.infer<typeof PlanWithItemsWireSchema>;

// -------------------------------------------------------------
// Request payloads
// -------------------------------------------------------------

/**
 * Body for POST /api/v1/intervention-plans (US1).
 * The professionalId comes from the authenticated session, not the body.
 */
export const CreatePlanInput = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  clientId: z.string().min(1, 'clientId is required'),
});
export type CreatePlanInput = z.infer<typeof CreatePlanInput>;

/**
 * Body for POST /api/v1/intervention-plans/:id/items (US2).
 */
export const AddItemInput = z.object({
  description: z.string().trim().min(1, 'description is required').max(10_000),
  frequency: z.string().trim().min(1).max(200).optional(),
  durationDays: z.number().int().positive().max(3650).optional(),
  instructions: z.string().trim().min(1).max(10_000).optional(),
});
export type AddItemInput = z.infer<typeof AddItemInput>;

/**
 * No body for the "mark complete" endpoint, but expose a schema for symmetry
 * and to allow client tooling to assert the empty payload.
 */
export const CompleteItemInput = z.object({}).strict();
export type CompleteItemInput = z.infer<typeof CompleteItemInput>;

// -------------------------------------------------------------
// List query
// -------------------------------------------------------------

export const ListPlansQuery = z.object({
  status: PlanStatusEnum.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ListPlansQuery = z.infer<typeof ListPlansQuery>;

// -------------------------------------------------------------
// Errors (RFC 7807-style problem payloads)
// -------------------------------------------------------------

export const InterventionPlanErrorCodes = {
  PLAN_NOT_FOUND: 'intervention_plan_not_found',
  ITEM_NOT_FOUND: 'recommendation_item_not_found',
  PLAN_ALREADY_EXISTS: 'intervention_plan_already_exists',
  ITEM_ALREADY_COMPLETED: 'recommendation_item_already_completed',
  FORBIDDEN: 'forbidden',
  VALIDATION_FAILED: 'validation_failed',
} as const;

export type InterventionPlanErrorCode =
  (typeof InterventionPlanErrorCodes)[keyof typeof InterventionPlanErrorCodes];
