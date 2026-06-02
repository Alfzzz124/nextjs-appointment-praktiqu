/**
 * AUDIT logging helper for Professional Management feature.
 *
 * All professional state changes MUST be logged as AUDIT events per FR-012.
 * This helper wraps the generic `logging.audit()` with feature-specific
 * semantics (actor, before/after, resourceId).
 *
 * Audit events (per plan.md §Audit Events):
 *   professional.created
 *   professional.updated
 *   professional.status_changed
 *   professional.service_assigned
 *   professional.service_unassigned
 *   professional.availability_changed
 *   professional.off_day_added
 *   professional.off_day_removed
 */

import { audit as logAudit, activity } from './logging';
import { UserRole } from '@prisma/client';

export type AuditAction =
  | 'professional.created'
  | 'professional.updated'
  | 'professional.status_changed'
  | 'professional.service_assigned'
  | 'professional.service_unassigned'
  | 'professional.availability_changed'
  | 'professional.off_day_added'
  | 'professional.off_day_removed';

export interface AuditMeta {
  professionalId: string;
  actorId: string; // User who performed the action
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  extra?: Record<string, unknown>; // any additional context
}

/**
 * Log an AUDIT event for a professional state change.
 * Wraps logging.audit() with the correct action, resource, and metadata.
 */
export async function professionalAudit(
  action: AuditAction,
  meta: AuditMeta,
): Promise<void> {
  await logAudit(action, {
    userId: meta.actorId,
    resource: 'professional',
    resourceId: meta.professionalId,
    metadata: {
      before: meta.before ?? null,
      after: meta.after ?? null,
      ...meta.extra,
    },
  });
}

/**
 * Log an AUDIT event when a professional updates their own profile (US2).
 * This is the same as professionalAudit but explicitly marks self-edit.
 */
export async function selfProfileAudit(
  professionalId: string,
  actorId: string,
  changes: Record<string, { before: unknown; after: unknown }>,
): Promise<void> {
  await logAudit('professional.updated', {
    userId: actorId,
    resource: 'professional',
    resourceId: professionalId,
    metadata: {
      selfEdit: true,
      changes,
    },
  });
}

/**
 * Log a status change with before/after values.
 */
export async function statusChangeAudit(
  professionalId: string,
  actorId: string,
  beforeStatus: string,
  afterStatus: string,
): Promise<void> {
  await logAudit('professional.status_changed', {
    userId: actorId,
    resource: 'professional',
    resourceId: professionalId,
    metadata: {
      before: { status: beforeStatus },
      after: { status: afterStatus },
    },
  });
}

/**
 * Log service assignment/unassignment.
 */
export async function serviceAssignmentAudit(
  professionalId: string,
  actorId: string,
  serviceId: string,
  serviceName: string,
  assigned: boolean,
): Promise<void> {
  await logAudit(
    assigned ? 'professional.service_assigned' : 'professional.service_unassigned',
    {
      userId: actorId,
      resource: 'professional',
      resourceId: professionalId,
      metadata: {
        serviceId,
        serviceName,
      },
    },
  );
}