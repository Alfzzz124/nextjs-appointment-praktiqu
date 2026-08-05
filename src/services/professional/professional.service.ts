/**
 * Professional service — backed by WordPress, not the `professionals` shadow table.
 *
 * A professional IS a `wp_users` row carrying the `kiviCare_doctor` capability. The
 * `professionals` and `doctors` shadow tables were mirrors kept in sync by an importer
 * that Phase 4 deletes. See docs/architecture/shadow-tables-audit.md.
 *
 *  - Reads  → `repositories/wp/doctors.repo.ts` (direct SQL, as `billing/*` does)
 *  - Writes → `repositories/wp/doctors.write.ts` → plugin REST, so `kc_doctor_save`
 *             fires the welcome email, KiviCare's bookkeeping and Pro's custom fields.
 *  - Type, registration number and status live in `praktiqu_*` usermeta: KiviCare has
 *    no field for them, and its own `wp_users.user_status` is self-contradictory.
 *
 * Ids are `number` (`wp_users.ID`) — the same D2 break applied to clients.
 */

import { z } from 'zod';
import {
  PROFESSIONAL_STATUS,
  findDoctorById,
  listDoctors,
  type ProfessionalStatus,
  type ProfessionalType,
  type WpDoctor,
} from '@/repositories/wp/doctors.repo';
import { createDoctor, updateDoctor } from '@/repositories/wp/doctors.write';
import { WpEndpointError } from '@/lib/wp-endpoint';
import {
  createProfessionalInputSchema,
  professionalListQuerySchema,
  statusChangeInputSchema,
  checkUniqueEmail,
  checkUniqueRegistrationNumber,
  buildFieldErrors,
} from './validation';
import { professionalAudit, statusChangeAudit } from '@/lib/audit';

export { PROFESSIONAL_STATUS };
export type { ProfessionalStatus, ProfessionalType };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ProfessionalListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ProfessionalStatus;
  /** WordPress clinic id (`wp_kc_clinics.id`). */
  clinicId?: number;
  sortBy?: 'fullName' | 'email' | 'createdAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

/** API-facing shape, assembled from `wp_users` + `wp_usermeta`. */
export interface Professional {
  id: number;
  fullName: string;
  email: string;
  professionalType: ProfessionalType | null;
  registrationNumber: string | null;
  status: ProfessionalStatus;
  biography: string | null;
  specialties: string[];
  qualifications: string[];
  yearsOfExperience: string | null;
  contactNumber: string | null;
  timezone: string | null;
  createdAt: Date;
}

export type ServiceError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'not_found' }
  | { _tag: 'conflict'; code: string; message: string }
  | { _tag: 'forbidden'; message: string };

export function isServiceError(err: unknown): err is ServiceError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function composeName(d: WpDoctor): string {
  const composed = [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
  return composed || d.displayName || d.email;
}

export function toProfessional(d: WpDoctor): Professional {
  return {
    id: Number(d.id),
    fullName: composeName(d),
    email: d.email,
    professionalType: d.professionalType,
    registrationNumber: d.registrationNumber,
    status: d.status,
    biography: d.description,
    specialties: d.specialties,
    qualifications: d.qualifications,
    yearsOfExperience: d.yearsOfExperience,
    contactNumber: d.mobileNumber,
    timezone: d.timezone,
    createdAt: d.registeredAt,
  };
}

/** Map a plugin transport failure onto this service's error shape. */
function rethrowWpError(err: unknown): never {
  if (err instanceof WpEndpointError) {
    throw {
      _tag: 'conflict' as const,
      code: err.status === 409 ? 'conflict' : 'wp_write_failed',
      message: err.message,
    };
  }
  throw err;
}

function asValidationError(err: unknown): never {
  if (err instanceof z.ZodError) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(err.issues) };
  }
  throw err;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createProfessional(
  input: z.infer<typeof createProfessionalInputSchema>,
  actorId: string,
  clinicIdOverride?: number,
): Promise<{ id: number }> {
  const parsed = createProfessionalInputSchema.safeParse(input);
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(parsed.error.issues) };
  }
  const data = parsed.data;

  try {
    await checkUniqueRegistrationNumber(data.registrationNumber);
    await checkUniqueEmail(data.email);
  } catch (err) {
    asValidationError(err);
  }

  const [firstName, ...rest] = data.fullName.trim().split(/\s+/);

  let created;
  try {
    created = await createDoctor({
      email: data.email,
      firstName: firstName ?? data.fullName,
      lastName: rest.join(' '),
      professionalType: data.professionalType as ProfessionalType,
      registrationNumber: data.registrationNumber,
      description: data.biography ?? undefined,
      specialties: data.specialties as string[] | undefined,
      clinicId: clinicIdOverride ?? data.clinicId,
    });
  } catch (err) {
    rethrowWpError(err);
  }

  await professionalAudit('professional.created', {
    professionalId: String(created.id),
    actorId,
    after: {
      fullName: data.fullName,
      professionalType: created.professionalType,
      status: created.status,
    },
  });

  return { id: created.id };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getProfessional(id: number): Promise<Professional | null> {
  const doctor = await findDoctorById(BigInt(id));
  return doctor ? toProfessional(doctor) : null;
}

/**
 * Self-service lookup. The JWT subject is a cuid in the auth mirror, so callers must
 * resolve it to a WordPress id (via `resolveKcActor`) before calling this.
 */
export async function getProfessionalByWpUserId(wpUserId: number): Promise<Professional | null> {
  return getProfessional(wpUserId);
}

export async function listProfessionals(
  params: ProfessionalListParams,
  actorClinicId?: number | null,
): Promise<PaginatedResult<Professional>> {
  const parsed = professionalListQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(parsed.error.issues) };
  }
  const { page, pageSize, search, status, sortBy, sortOrder } = parsed.data;

  // A scoped actor never widens past their own clinic, even if the query names another.
  const clinicId = actorClinicId ?? parsed.data.clinicId;

  const { items, total } = await listDoctors({
    page,
    perPage: pageSize,
    search,
    clinicIds: clinicId !== undefined && clinicId !== null ? [BigInt(clinicId)] : undefined,
    statuses: status ? [status as ProfessionalStatus] : undefined,
  });

  const data = items.map(toProfessional);

  // Sorted here rather than in SQL: fullName and status are assembled from wp_usermeta
  // with fallbacks, and duplicating that logic in SQL would let the two drift. A page
  // is at most 100 rows.
  const dir = sortOrder === 'desc' ? -1 : 1;
  data.sort((a, b) => {
    if (sortBy === 'createdAt') return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
    const av = String(a[sortBy] ?? '');
    const bv = String(b[sortBy] ?? '');
    return av.localeCompare(bv) * dir;
  });

  return {
    data,
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

/** Fields a professional may change on their own profile (US2). */
const SELF_EDITABLE = new Set(['biography', 'specialties', 'contactNumber']);

export async function updateProfessional(
  id: number,
  input: Record<string, unknown>,
  actorId: string,
  isSelfEdit = false,
): Promise<Professional> {
  const existing = await findDoctorById(BigInt(id));
  if (!existing) throw { _tag: 'not_found' as const };

  if (isSelfEdit) {
    const rejected = Object.keys(input).filter((k) => !SELF_EDITABLE.has(k));
    if (rejected.length > 0) {
      // Rejected rather than silently stripped: registrationNumber and
      // professionalType are read-only for the professional themselves.
      throw {
        _tag: 'forbidden' as const,
        message: `Not editable on your own profile: ${rejected.join(', ')}`,
      };
    }
  }

  if (typeof input.registrationNumber === 'string') {
    try {
      await checkUniqueRegistrationNumber(input.registrationNumber, id);
    } catch (err) {
      asValidationError(err);
    }
  }
  if (typeof input.email === 'string') {
    try {
      await checkUniqueEmail(input.email, id);
    } catch (err) {
      asValidationError(err);
    }
  }

  const payload: Parameters<typeof updateDoctor>[1] = {};
  if (typeof input.fullName === 'string') {
    const [first, ...rest] = input.fullName.trim().split(/\s+/);
    payload.firstName = first;
    payload.lastName = rest.join(' ');
  }
  if (typeof input.email === 'string') payload.email = input.email;
  if (typeof input.registrationNumber === 'string') payload.registrationNumber = input.registrationNumber;
  if (typeof input.professionalType === 'string') {
    payload.professionalType = input.professionalType as ProfessionalType;
  }
  // null clears the field, so `=== null` must reach the plugin as ''.
  if (typeof input.biography === 'string' || input.biography === null) {
    payload.description = (input.biography as string | null) ?? '';
  }
  if (Array.isArray(input.specialties)) payload.specialties = input.specialties as string[];
  if (Array.isArray(input.qualifications)) payload.qualifications = input.qualifications as string[];
  if (typeof input.contactNumber === 'string') payload.contactNumber = input.contactNumber;
  if (typeof input.timezone === 'string') payload.timezone = input.timezone;
  if (typeof input.clinicId === 'number') payload.clinicId = input.clinicId;

  if (Object.keys(payload).length > 0) {
    try {
      await updateDoctor(id, payload);
    } catch (err) {
      rethrowWpError(err);
    }
  }

  await professionalAudit('professional.updated', {
    professionalId: String(id),
    actorId,
    after: { fields: Object.keys(payload) },
  });

  const updated = await findDoctorById(BigInt(id));
  if (!updated) throw { _tag: 'not_found' as const };
  return toProfessional(updated);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export async function setProfessionalStatus(
  id: number,
  newStatus: ProfessionalStatus,
  actorId: string,
): Promise<void> {
  const parsed = statusChangeInputSchema.safeParse({ status: newStatus });
  if (!parsed.success) {
    throw { _tag: 'validation' as const, errors: buildFieldErrors(parsed.error.issues) };
  }

  const existing = await findDoctorById(BigInt(id));
  if (!existing) throw { _tag: 'not_found' as const };
  if (existing.status === newStatus) return;

  try {
    await updateDoctor(id, { status: newStatus });
  } catch (err) {
    rethrowWpError(err);
  }

  await statusChangeAudit(String(id), actorId, existing.status, newStatus);
}

export async function deactivateProfessional(id: number, actorId: string): Promise<void> {
  await setProfessionalStatus(id, PROFESSIONAL_STATUS.INACTIVE, actorId);
}

export async function activateProfessional(id: number, actorId: string): Promise<void> {
  await setProfessionalStatus(id, PROFESSIONAL_STATUS.ACTIVE, actorId);
}

/* ------------------------------------------------------------------ */
/* Bulk                                                                */
/* ------------------------------------------------------------------ */

/**
 * Sequential, not parallel: each call is an HTTP round trip that fires KiviCare hooks.
 * Individual failures are counted rather than thrown, so one bad id cannot abandon the
 * batch with no report of how far it got.
 */
async function bulkApplyStatus(ids: number[], status: ProfessionalStatus): Promise<number> {
  let applied = 0;
  for (const id of ids) {
    try {
      await updateDoctor(id, { status });
      applied += 1;
    } catch {
      // Swallowed deliberately — the returned count is the caller's signal.
    }
  }
  return applied;
}

/** Soft-delete: sets INACTIVE. Named to match KiviCare's /doctors/bulk/delete. */
export async function bulkDeleteProfessionals(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  return bulkApplyStatus(ids, PROFESSIONAL_STATUS.INACTIVE);
}

export async function bulkSetProfessionalStatus(
  ids: number[],
  status: ProfessionalStatus,
): Promise<number> {
  if (ids.length === 0) return 0;
  return bulkApplyStatus(ids, status);
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ProfessionalExportParams {
  clinicId?: number;
  status?: ProfessionalStatus;
}

const EXPORT_PAGE = 100;

export async function exportProfessionals(
  params: ProfessionalExportParams,
): Promise<Professional[]> {
  const out: Professional[] = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await listDoctors({
      page,
      perPage: EXPORT_PAGE,
      clinicIds: params.clinicId ? [BigInt(params.clinicId)] : undefined,
      statuses: params.status ? [params.status] : undefined,
    });
    out.push(...items.map(toProfessional));
    // items.length === 0 also guards against a total that shrinks mid-sweep.
    if (items.length === 0 || out.length >= total) break;
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
