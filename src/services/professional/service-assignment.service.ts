/**
 * Service Assignment Service — assign/unassign services to professionals.
 *
 * T009: assignService(), unassignService(), listAssignedServices()
 * T052: ACTIVE service filter (FR-011)
 * T053: no duplicate assignment check
 */

import { prisma } from '@/lib/db';
import { serviceAssignmentAudit } from '@/lib/audit';
import { assignServiceInputSchema } from './validation';
import { z } from 'zod';

// ============================================
// Types
// ============================================

export interface AssignedService {
  id: string;
  professionalId: string;
  serviceId: string;
  serviceName: string;
  serviceDuration: number;
  createdAt: Date;
}

// ============================================
// List (T009)
// ============================================

export async function listAssignedServices(professionalId: string): Promise<AssignedService[]> {
  const assignments = await prisma.professionalServiceAssignment.findMany({
    where: { professionalId },
    include: {
      service: { select: { id: true, name: true, duration: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return assignments
    .filter((a) => a.service.status === 1) // Only ACTIVE services
    .map((a) => ({
      id: a.id,
      professionalId: a.professionalId,
      serviceId: a.serviceId,
      serviceName: a.service.name,
      serviceDuration: a.service.duration,
      createdAt: a.createdAt,
    }));
}

// ============================================
// Assign (T009, T052, T053)
// ============================================

export async function assignService(
  professionalId: string,
  serviceId: string,
  actorId: string,
): Promise<{ id: string }> {
  const parsed = assignServiceInputSchema.safeParse({ serviceId });
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }

  // T052: Only ACTIVE services can be assigned (FR-011)
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    throw { _tag: 'not_found' as const, entity: 'service' };
  }
  if (service.status !== 1) {
    throw { _tag: 'validation' as const, errors: { serviceId: ['Only ACTIVE services can be assigned'] } };
  }

  // T053: No duplicate assignment
  const existing = await prisma.professionalServiceAssignment.findUnique({
    where: {
      professionalId_serviceId: {
        professionalId,
        serviceId,
      },
    },
  });
  if (existing) {
    throw { _tag: 'conflict' as const, code: 'duplicate_assignment', message: 'This service is already assigned to this professional' };
  }

  const assignment = await prisma.professionalServiceAssignment.create({
    data: { professionalId, serviceId },
  });

  // AUDIT (FR-012)
  await serviceAssignmentAudit(professionalId, actorId, serviceId, service.name, true);

  return { id: assignment.id };
}

// ============================================
// Unassign (T009)
// ============================================

export async function unassignService(
  professionalId: string,
  serviceId: string,
  actorId: string,
): Promise<void> {
  const assignment = await prisma.professionalServiceAssignment.findUnique({
    where: {
      professionalId_serviceId: {
        professionalId,
        serviceId,
      },
    },
  });

  if (!assignment) {
    throw { _tag: 'not_found' as const, entity: 'assignment' };
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });

  await prisma.professionalServiceAssignment.delete({
    where: { id: assignment.id },
  });

  // AUDIT (FR-012)
  await serviceAssignmentAudit(
    professionalId,
    actorId,
    serviceId,
    service?.name ?? 'Unknown Service',
    false,
  );
}

// ============================================
// Error types
// ============================================

export type ServiceAssignmentError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string };

export function isServiceAssignmentError(err: unknown): err is ServiceAssignmentError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}