/**
 * InterventionPlan service — a plan IS a KiviCare encounter (phase E4).
 *
 * Retires `intervention_plans` and `recommendation_items`. Both held 0 rows on staging
 * while KiviCare carried 319 encounters and 88 prescriptions: another parallel record
 * nobody used.
 *
 * The mapping:
 *   plan                → the `wp_kc_patient_encounters` row for the session's
 *                         appointment. **The same encounter a session note uses** —
 *                         both are one-per-session, and an encounter IS the clinical
 *                         record of that session. A plan and a note are two views of
 *                         one row, so creating one where the other exists reuses it.
 *   recommendation item → `wp_kc_prescription`: description / frequency / durationDays
 *                         / instructions map to name / frequency / duration /
 *                         instruction field for field.
 *   item completion     → `wp_kc_custom_fields_data` under our own module type
 *                         (decision D1). KiviCare has no column for it, because it
 *                         treats a prescription as written-and-finished rather than
 *                         something a client ticks off over time.
 *
 * Ids are `number`: the plan id is the encounter id, an item id is a prescription id.
 *
 * Writes go through the plugin, which is what fires KiviCare's encounter listeners.
 */

import { logging } from '@/lib/logging';
import { findSessionById } from '@/repositories/wp/sessions.repo';
import {
  findEncounterByAppointmentId,
  findEncounterById,
  getRecommendationStates,
  listEncounterPrescriptions,
  listEncounters,
  listPrescriptionsForEncounters,
  setRecommendationState,
  type RecommendationState,
  type WpEncounter,
  type WpPrescription,
} from '@/repositories/wp/clinical-records.repo';
import {
  createEncounter,
  replaceEncounterPrescriptions,
  type PrescriptionItem,
} from '@/repositories/wp/encounters.write';
import { InterventionPlanErrorCodes } from '@/types/intervention-plan';

// -------------------------------------------------------------
// Errors
// -------------------------------------------------------------

export class InterventionPlanError extends Error {
  readonly code: (typeof InterventionPlanErrorCodes)[keyof typeof InterventionPlanErrorCodes];
  readonly status: number;
  /** Field-level detail, surfaced as RFC-7807 `invalid-params` by the problem mapper. */
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

export type CallerRole = 'PROFESSIONAL' | 'CLIENT' | 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'SUPER_ADMIN';

export interface Caller {
  /** Auth-mirror id (a cuid) — used for the audit log only. */
  userId: string;
  /**
   * The same person's `wp_users.ID`.
   *
   * Ownership is compared on this: an encounter's doctor and patient are KiviCare user
   * ids, and the two id spaces do not match.
   */
  wpUserId: number;
  role: CallerRole;
}

// -------------------------------------------------------------
// DTOs
// -------------------------------------------------------------

export type PlanStatus = 'ACTIVE' | 'COMPLETED';
export type ItemStatus = 'ACTIVE' | 'COMPLETED';

export interface RecommendationItemDto {
  id: number;
  interventionPlanId: number;
  description: string;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
  status: ItemStatus;
  completedAt: Date | null;
  createdAt: Date | null;
}

export interface InterventionPlanWithItems {
  id: number;
  sessionId: string;
  professionalId: string;
  clientId: string;
  status: PlanStatus;
  createdAt: Date | null;
  items: RecommendationItemDto[];
}

/**
 * `durationDays` is an integer for us and a varchar(199) for KiviCare, which stores
 * whatever a clinician typed — "30 hari", "2 minggu". Only a plain number round-trips;
 * anything else reads back as null rather than as a wrong number.
 */
function parseDurationDays(duration: string | null): number | null {
  if (!duration) return null;
  return /^\d+$/.test(duration.trim()) ? Number(duration.trim()) : null;
}

function toItemDto(
  planId: number,
  p: WpPrescription,
  state: RecommendationState | undefined,
): RecommendationItemDto {
  return {
    id: p.id,
    interventionPlanId: planId,
    description: p.name,
    frequency: p.frequency,
    durationDays: parseDurationDays(p.duration),
    instructions: p.instruction,
    status: state?.status ?? 'ACTIVE',
    completedAt: state?.completedAt ?? null,
    createdAt: p.createdAt,
  };
}

function toPlan(
  encounter: WpEncounter,
  prescriptions: WpPrescription[],
  states: Map<number, RecommendationState>,
): InterventionPlanWithItems {
  const items = prescriptions.map((p) => toItemDto(encounter.id, p, states.get(p.id)));
  return {
    id: encounter.id,
    sessionId: encounter.appointmentId === null ? '' : String(encounter.appointmentId),
    professionalId: String(encounter.doctorId),
    clientId: String(encounter.patientId),
    // Complete when every recommendation is. An empty plan is NOT complete — there is
    // nothing in it to have finished.
    status:
      items.length > 0 && items.every((i) => i.status === 'COMPLETED') ? 'COMPLETED' : 'ACTIVE',
    createdAt: encounter.createdAt,
    items,
  };
}

// -------------------------------------------------------------
// Authorization
// -------------------------------------------------------------

function assertReadAccess(plan: InterventionPlanWithItems, caller: Caller): void {
  if (
    caller.role === 'SUPER_ADMIN' ||
    caller.role === 'RECEPTIONIST' ||
    caller.role === 'CLINIC_ADMIN'
  ) {
    return;
  }
  if (caller.role === 'PROFESSIONAL' && plan.professionalId === String(caller.wpUserId)) return;
  if (caller.role === 'CLIENT' && plan.clientId === String(caller.wpUserId)) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

function assertWriteAccess(plan: InterventionPlanWithItems, caller: Caller): void {
  // Only the owning professional (or a super admin) can mutate plan content.
  if (caller.role === 'SUPER_ADMIN') return;
  if (caller.role === 'PROFESSIONAL' && plan.professionalId === String(caller.wpUserId)) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

function assertClientCanComplete(plan: InterventionPlanWithItems, caller: Caller): void {
  if (caller.role === 'CLIENT' && plan.clientId === String(caller.wpUserId)) return;
  throw new InterventionPlanError(InterventionPlanErrorCodes.FORBIDDEN, 'forbidden', 403);
}

// -------------------------------------------------------------
// Inputs
// -------------------------------------------------------------

export interface CreatePlanInput {
  sessionId: string;
  clientId: string;
}

export interface AddItemInput {
  description: string;
  frequency?: string;
  durationDays?: number;
  instructions?: string;
}

// -------------------------------------------------------------
// Service
// -------------------------------------------------------------

export class InterventionPlanService {
  private async load(encounterId: number): Promise<InterventionPlanWithItems> {
    const encounter = await findEncounterById(encounterId);
    if (!encounter) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'intervention plan not found',
        404,
      );
    }
    const prescriptions = await listEncounterPrescriptions(encounterId);
    const states = await getRecommendationStates(prescriptions.map((p) => p.id));
    return toPlan(encounter, prescriptions, states);
  }

  async createPlan(input: CreatePlanInput, caller: Caller): Promise<InterventionPlanWithItems> {
    if (caller.role !== 'PROFESSIONAL' && caller.role !== 'SUPER_ADMIN') {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.FORBIDDEN,
        'only the professional can create a plan',
        403,
      );
    }

    const sessionId = Number(input.sessionId);
    const session = await findSessionById(sessionId);
    if (!session) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'session not found',
        404,
      );
    }

    // A plan and a session note are two views of the same encounter. If one already
    // exists for this appointment — written here or in KiviCare's own UI — reuse it
    // rather than refusing: the clinician is adding recommendations to the record of
    // that session, not creating a second record.
    const existing = await findEncounterByAppointmentId(sessionId);
    if (existing) {
      const plan = await this.load(existing.id);
      assertWriteAccess(plan, caller); // reuse still respects ownership
      if (plan.items.length > 0) {
        // Recommendations already recorded — that is a genuine conflict.
        throw new InterventionPlanError(
          InterventionPlanErrorCodes.PLAN_ALREADY_EXISTS,
          'a plan already exists for this session',
          409,
        );
      }
      return plan;
    }

    const created = await createEncounter({
      clinicId: session.clinicId,
      doctorId: session.professionalId,
      patientId: session.clientId,
      appointmentId: sessionId,
      addedBy: caller.wpUserId,
    });

    await logging.audit('intervention_plan.create', {
      userId: caller.userId,
      resource: 'intervention_plan',
      resourceId: String(created.id),
      metadata: { sessionId: input.sessionId, clientId: String(session.clientId) },
    });

    return this.load(created.id);
  }

  async getPlan(planId: number, caller: Caller): Promise<InterventionPlanWithItems> {
    const plan = await this.load(planId);
    assertReadAccess(plan, caller);
    return plan;
  }

  async listPlans(
    caller: Caller,
    options: { status?: PlanStatus; limit?: number; page?: number } = {},
  ): Promise<{ plans: InterventionPlanWithItems[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    const query: Parameters<typeof listEncounters>[0] = { page: options.page ?? 1, perPage: limit };
    if (caller.role === 'PROFESSIONAL') query.doctorId = caller.wpUserId;
    else if (caller.role === 'CLIENT') query.patientId = caller.wpUserId;
    // RECEPTIONIST / CLINIC_ADMIN / SUPER_ADMIN see all; clinic scoping stays in the
    // API layer, unchanged.

    const { items, total } = await listEncounters(query);

    // Two batched queries for the whole page rather than two per plan.
    const prescriptionsByEncounter = await listPrescriptionsForEncounters(items.map((e) => e.id));
    const allPrescriptionIds = [...prescriptionsByEncounter.values()].flat().map((p) => p.id);
    const states = await getRecommendationStates(allPrescriptionIds);

    let plans = items.map((e) => toPlan(e, prescriptionsByEncounter.get(e.id) ?? [], states));

    // Status is derived from the items, so it cannot be a SQL filter.
    if (options.status) plans = plans.filter((p) => p.status === options.status);

    return { plans, total };
  }

  async addItem(
    planId: number,
    input: AddItemInput,
    caller: Caller,
  ): Promise<RecommendationItemDto> {
    const plan = await this.load(planId);
    assertWriteAccess(plan, caller);

    const encounter = await findEncounterById(planId);
    if (!encounter) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'intervention plan not found',
        404,
      );
    }

    // The plugin route replaces the whole set, so existing items are resent with the
    // new one appended. Replace-not-append is what makes a retry safe: the same request
    // twice leaves the same rows instead of duplicating every recommendation.
    const items: PrescriptionItem[] = [
      ...plan.items.map((i) => ({
        name: i.description,
        frequency: i.frequency ?? undefined,
        duration: i.durationDays === null ? undefined : String(i.durationDays),
        instruction: i.instructions ?? undefined,
      })),
      {
        name: input.description,
        frequency: input.frequency,
        duration: input.durationDays === undefined ? undefined : String(input.durationDays),
        instruction: input.instructions,
      },
    ];

    await replaceEncounterPrescriptions({
      encounterId: planId,
      patientId: encounter.patientId,
      items,
      addedBy: caller.wpUserId,
    });

    const reloaded = await this.load(planId);
    const added = reloaded.items[reloaded.items.length - 1];
    if (!added) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.PLAN_NOT_FOUND,
        'item was created but could not be read back',
        502,
      );
    }
    return added;
  }

  async completeItem(
    planId: number,
    itemId: number,
    caller: Caller,
  ): Promise<RecommendationItemDto> {
    const plan = await this.load(planId);
    assertClientCanComplete(plan, caller);

    const item = plan.items.find((i) => i.id === itemId);
    if (!item) {
      throw new InterventionPlanError(
        InterventionPlanErrorCodes.ITEM_NOT_FOUND,
        'recommendation item not found',
        404,
      );
    }

    if (item.status === 'COMPLETED') return item; // idempotent

    const completedAt = new Date();
    await setRecommendationState(itemId, { status: 'COMPLETED', completedAt });

    await logging.audit('intervention_plan.item.complete', {
      userId: caller.userId,
      resource: 'recommendation_item',
      resourceId: String(itemId),
      metadata: { planId: String(planId), completedAt: completedAt.toISOString() },
    });

    return { ...item, status: 'COMPLETED', completedAt };
  }
}

// -------------------------------------------------------------
// Singleton export
// -------------------------------------------------------------

export const interventionPlanService = new InterventionPlanService();
