/**
 * Professional Service — core business logic for Feature 002.
 *
 * T007: create, read, update, list, deactivate, activate methods
 * T031: self-edit field restriction (US2)
 * T046: practice-scoped query (US4)
 *
 * Uses Prisma for DB, Zod for validation, audit.ts for state-change logging.
 */

import { prisma } from '@/lib/db';
import { z } from 'zod';
import {
  createProfessionalInputSchema,
  updateProfessionalInputSchema,
  selfUpdateProfessionalInputSchema,
  statusChangeInputSchema,
  professionalListQuerySchema,
  checkUniqueRegistrationNumber,
  checkUniqueEmail,
  buildFieldErrors,
} from './validation';
import {
  professionalAudit,
  statusChangeAudit,
} from '@/lib/audit';
import { ProfessionalStatus } from '@prisma/client';

// ============================================
// Types
// ============================================

export interface ProfessionalListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProfessionalStatus;
  practiceId?: string;
  sortBy?: 'fullName' | 'email' | 'createdAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

// ============================================
// Create (T007, T022)
// ============================================

export async function createProfessional(
  input: z.infer<typeof createProfessionalInputSchema>,
  actorId: string,
): Promise<{ id: string }> {
  // Validate uniqueness (T023, T024)
  await checkUniqueRegistrationNumber(input.registrationNumber);
  await checkUniqueEmail(input.email);

  const data = createProfessionalInputSchema.parse(input);

  const professional = await prisma.professional.create({
    data: {
      userId: data.userId,
      practiceId: data.practiceId ?? null,
      fullName: data.fullName,
      email: data.email,
      professionalType: data.professionalType,
      registrationNumber: data.registrationNumber,
      status: ProfessionalStatus.PENDING_ACTIVATION,
      biography: data.biography ?? null,
      specialties: data.specialties ?? null,
      contactInfo: (data.contactInfo as Record<string, unknown>) ?? null,
    },
  });

  // T022: WP user provisioning — WordPress user account already exists
  // (linked via userId). We don't call WP directly; the WP plugin handles
  // sync via the WordPress webhook system (see src/lib/jobs/webhook-handler.ts).

  // Audit log (FR-012)
  await professionalAudit('professional.created', {
    professionalId: professional.id,
    actorId,
    after: {
      userId: professional.userId,
      fullName: professional.fullName,
      professionalType: professional.professionalType,
      status: professional.status,
    },
  });

  return { id: professional.id };
}

// ============================================
// Read (T007)
// ============================================

export async function getProfessional(id: string) {
  return prisma.professional.findUnique({
    where: { id },
    include: {
      practice: { select: { id: true, name: true } },
      serviceAssignments: {
        include: {
          service: { select: { id: true, name: true, duration: true, status: true } },
        },
      },
      _count: {
        select: {
          availability: true,
          offDays: true,
        },
      },
    },
  });
}

/**
 * Get professional by userId (for self-service profile).
 */
export async function getProfessionalByUserId(userId: string) {
  return prisma.professional.findUnique({
    where: { userId },
    include: {
      practice: { select: { id: true, name: true, timezone: true } },
      availability: { orderBy: { dayOfWeek: 'asc' } },
      offDays: { orderBy: { startDate: 'desc' } },
      serviceAssignments: {
        include: {
          service: { select: { id: true, name: true, duration: true, status: true, price: true } },
        },
      },
    },
  });
}

// ============================================
// Update (T007, T031)
// ============================================

export async function updateProfessional(
  id: string,
  input: unknown,
  actorId: string,
  isSelfEdit = false,
): Promise<void> {
  let validated: z.infer<typeof updateProfessionalInputSchema>;

  if (isSelfEdit) {
    // T031: Self-edit restrictions — only biography, specialties, contactInfo (US2)
    const result = selfUpdateProfessionalInputSchema.safeParse(input);
    if (!result.success) {
      const err = result.error;
      throw {
        _tag: 'validation' as const,
        errors: buildFieldErrors(err.issues),
      };
    }
    validated = result.data;
  } else {
    const result = updateProfessionalInputSchema.safeParse(input);
    if (!result.success) {
      const err = result.error;
      throw {
        _tag: 'validation' as const,
        errors: buildFieldErrors(err.issues),
      };
    }
    validated = result.data;
  }

  if (Object.keys(validated).length === 0) {
    return; // nothing to update
  }

  const existing = await prisma.professional.findUnique({ where: { id } });
  if (!existing) {
    throw { _tag: 'not_found' as const };
  }

  await prisma.professional.update({
    where: { id },
    data: {
      fullName: validated.fullName ?? undefined,
      biography: validated.biography ?? undefined,
      specialties: validated.specialties ?? undefined,
      contactInfo: validated.contactInfo ? validated.contactInfo as Record<string, unknown> : undefined,
      practiceId: validated.practiceId !== undefined ? validated.practiceId ?? undefined : undefined,
    },
  });

  // AUDIT (FR-012)
  await professionalAudit('professional.updated', {
    professionalId: id,
    actorId,
    before: {
      fullName: existing.fullName,
      biography: existing.biography,
      specialties: existing.specialties,
    },
    after: validated,
  });
}

// ============================================
// List (T007, T046, T012)
// ============================================

export async function listProfessionals(
  params: ProfessionalListParams,
  actorPracticeId?: string | null,
): Promise<PaginatedResult<unknown[]>> {
  const parsed = professionalListQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(parsed.error.issues) };
  }
  const { page, pageSize, search, status, practiceId, sortBy, sortOrder } = parsed.data;

  const where: Record<string, unknown> = {};

  // T046: Practice-scoped query — Clinic Admin sees only their practice's professionals
  if (actorPracticeId) {
    where.practiceId = actorPracticeId;
  } else if (practiceId) {
    where.practiceId = practiceId;
  }

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { registrationNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, totalItems] = await Promise.all([
    prisma.professional.findMany({
      where,
      include: {
        practice: { select: { id: true, name: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.professional.count({ where }),
  ]);

  return {
    data: items,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    },
  };
}

// ============================================
// Status Change (T007, T015, T046)
// ============================================

export async function setProfessionalStatus(
  id: string,
  newStatus: ProfessionalStatus,
  actorId: string,
): Promise<void> {
  const parsed = statusChangeInputSchema.safeParse({ status: newStatus });
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(parsed.error.issues) };
  }

  const existing = await prisma.professional.findUnique({ where: { id } });
  if (!existing) {
    throw { _tag: 'not_found' as const };
  }

  if (existing.status === newStatus) return; // no-op

  await prisma.professional.update({
    where: { id },
    data: { status: newStatus },
  });

  // AUDIT (FR-012)
  await statusChangeAudit(id, actorId, existing.status, newStatus);
}

// ============================================
// Deactivate / Activate (T007)
// ============================================

export async function deactivateProfessional(id: string, actorId: string): Promise<void> {
  await setProfessionalStatus(id, ProfessionalStatus.INACTIVE, actorId);
}

export async function activateProfessional(id: string, actorId: string): Promise<void> {
  await setProfessionalStatus(id, ProfessionalStatus.ACTIVE, actorId);
}

// ============================================
// Error types for route handlers
// ============================================

export type ServiceError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'not_found' }
  | { _tag: 'conflict'; code: string; message: string }
  | { _tag: 'forbidden'; message: string };

export function isServiceError(err: unknown): err is ServiceError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

// ============================================
// Bulk operations
// ============================================

export async function bulkDeleteProfessionals(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.professional.updateMany({
    where: { id: { in: ids } },
    data: { status: ProfessionalStatus.INACTIVE },
  });
  return result.count;
}

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