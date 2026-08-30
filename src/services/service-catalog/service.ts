/**
 * Clinic services — the business rules over `wp_kc_services` and
 * `wp_kc_service_doctor_mapping`.
 *
 * The resource is a mapping row: one service as offered by one psychologist at one
 * clinic. See docs/superpowers/specs/2026-08-30-services-crud-design.md.
 */
import {
  listClinicServices,
  findMappingById,
  type ClinicServiceRow,
} from '@/repositories/wp/services.repo';
import {
  findCatalogueByNameAndType,
  createCatalogue,
  createServiceWithMappings,
  doctorsMappedToClinic,
  findConflictingMapping,
  updateMapping,
  type MappingPatch,
} from '@/repositories/wp/services.write';
import { findServiceTypeById } from '@/repositories/wp/static-data.repo';
import { audit } from '@/lib/logging';
import type { ServiceScope } from './scope';
import type { ListServicesQuery, CreateServiceInput, UpdateServiceInput } from './validation';

export type ServiceCategory = { id: number; label: string | null; value: string | null };

export type ServiceSummary = {
  /** The mapping id — what `/api/v1/services/{id}` addresses. */
  id: number;
  serviceId: number;
  doctorId: number;
  clinicId: number;
  name: string;
  category: ServiceCategory | null;
  /** The doctor's charge, which is what a client actually pays. */
  price: number | null;
  durationMinutes: number | null;
  telemedService: 'yes' | 'no';
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
};

export type ServiceCatalogError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'bad_request'; code: string; message: string }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string; count?: number };

export function isServiceCatalogError(err: unknown): err is ServiceCatalogError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

/**
 * KiviCare stores the category as a JSON snapshot rather than a foreign key, so the
 * label survives the static-data row being deleted. A snapshot written by hand, or by an
 * older KiviCare, may not parse — treat that as "no category" rather than a 500.
 */
function parseCategory(raw: string | null): ServiceCategory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceCategory>;
    if (typeof parsed?.id !== 'number') return null;
    return { id: parsed.id, label: parsed.label ?? null, value: parsed.value ?? null };
  } catch {
    return null;
  }
}

/**
 * `charges` is a bare nullable varchar that KiviCare's own PHP UI writes with no format
 * constraint, so a legacy row can hold `"Rp 250.000"` or `"-"`. `Number()` turns those
 * into `NaN`, which is not representable in JSON — `JSON.stringify` emits `null` — so the
 * declared `number | null` contract would be violated at runtime by a value that still
 * passes a `typeof === 'number'` check. Return `null` deliberately instead of stumbling
 * into it.
 */
function parsePrice(raw: string | null): number | null {
  if (raw === null) return null;
  // `Number('')` is 0, not NaN — a JS quirk, not the data's intent. An empty `charges`
  // means nobody set a price; a genuinely free service is stored as the string '0'.
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toSummary(row: ClinicServiceRow): ServiceSummary {
  return {
    id: Number(row.id),
    serviceId: Number(row.serviceId),
    doctorId: Number(row.doctorId),
    clinicId: Number(row.clinicId),
    // A doctor-specific alias wins over the catalogue name, matching what KiviCare shows.
    name: row.nameAlias ?? row.name,
    category: parseCategory(row.category),
    price: parsePrice(row.charges),
    durationMinutes: row.durationMinutes,
    telemedService: row.telemedService === 'yes' ? 'yes' : 'no',
    isPublic: row.isPublic,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Visible to this scope? Both dimensions must pass; `null` means unrestricted. */
function inScope(row: ClinicServiceRow, scope: ServiceScope): boolean {
  if (scope.clinicId !== null && row.clinicId !== scope.clinicId) return false;
  if (scope.doctorId !== null && row.doctorId !== scope.doctorId) return false;
  return true;
}

export async function listServices(
  query: ListServicesQuery,
  scope: ServiceScope,
): Promise<{ services: ServiceSummary[]; total: number; page: number; perPage: number }> {
  if (scope.empty) {
    return { services: [], total: 0, page: query.page, perPage: query.perPage };
  }

  // The scope wins over the query string. A clinic admin asking for another clinic gets
  // their own, not a 403 — the other clinic simply is not addressable for them.
  const clinicId =
    scope.clinicId ?? (query.clinicId !== undefined ? BigInt(query.clinicId) : undefined);
  const doctorId =
    scope.doctorId ?? (query.professionalId !== undefined ? BigInt(query.professionalId) : undefined);

  const page = await listClinicServices({
    page: query.page,
    perPage: query.perPage,
    search: query.search,
    clinicId,
    doctorId,
    includeInactive: query.includeInactive,
  });

  return {
    services: page.items.map(toSummary),
    total: page.total,
    page: page.page,
    perPage: page.perPage,
  };
}

/**
 * One mapping, or `null`.
 *
 * Out of scope and does-not-exist collapse into the same `null` on purpose: the route
 * answers 404 for both, so a clinic admin cannot probe for another clinic's ids.
 */
export async function getService(
  mappingId: number,
  scope: ServiceScope,
): Promise<ServiceSummary | null> {
  if (scope.empty) return null;

  const row = await findMappingById(BigInt(mappingId));
  if (!row || !inScope(row, scope)) return null;
  return toSummary(row);
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export type CreatedService = {
  serviceId: number;
  name: string;
  category: ServiceCategory;
  mappings: Array<{ id: number; doctorId: number }>;
};

/**
 * Resolve `categoryId` into the two things the catalogue row needs: the `type` string
 * and the JSON snapshot KiviCare keeps beside it.
 */
async function resolveCategory(categoryId: number): Promise<{ type: string; json: string; category: ServiceCategory }> {
  const row = await findServiceTypeById(BigInt(categoryId));
  if (!row) {
    throw {
      _tag: 'validation',
      errors: { categoryId: ['Unknown service category'] },
    } satisfies ServiceCatalogError;
  }
  const category: ServiceCategory = { id: Number(row.id), label: row.label, value: row.value };
  return { type: row.value ?? '', json: JSON.stringify(category), category };
}

export async function createService(
  input: CreateServiceInput,
  clinicId: number,
  actorId: string,
): Promise<CreatedService> {
  const { type, json, category } = await resolveCategory(input.categoryId);

  // A duplicate id (`doctorIds: [5, 5]`) would otherwise insert twin mapping rows: the
  // table has no unique constraint, and `findConflictingMapping` only catches conflicts
  // against *existing* rows, not duplicates within the same request. De-duplicate before
  // any check runs, keeping first-seen order so the response's doctor order matches what
  // the caller sent.
  const doctorIds = [...new Set(input.doctorIds.map((d) => BigInt(d)))];
  const clinic = BigInt(clinicId);

  // KiviCare refuses the whole request when any doctor is not at the clinic rather than
  // silently creating the subset, and that is the right call: a partially applied create
  // is harder to notice than a rejection.
  const mapped = await doctorsMappedToClinic(doctorIds, clinic);
  const unmapped = doctorIds.filter((d) => !mapped.includes(d));
  if (unmapped.length > 0) {
    throw {
      _tag: 'bad_request',
      code: 'doctors_not_in_clinic',
      message: `Professionals not assigned to this clinic: ${unmapped.join(', ')}`,
    } satisfies ServiceCatalogError;
  }

  const conflict = await findConflictingMapping({ doctorIds, clinicId: clinic, name: input.name });
  if (conflict) {
    throw {
      _tag: 'conflict',
      code: 'service_already_offered',
      message: `Professional ${conflict.doctorId} already offers a service named "${input.name}" at this clinic`,
    } satisfies ServiceCatalogError;
  }

  const price = String(input.price);

  // The catalogue is global, so an identical name+type from another clinic is reused
  // rather than duplicated — this is KiviCare's own behaviour. The reuse decision stays
  // here, as a business rule; only the resulting `{ reuseId }` or the fields for a new row
  // cross into the repository.
  const existing = await findCatalogueByNameAndType(input.name, type);
  const catalogue = existing
    ? { reuseId: existing.id }
    : { name: input.name, type, category: json, price, status: 1 as const };

  // One transaction for the catalogue row (reuse or insert) and every mapping: a failure
  // on any mapping rolls the whole thing back rather than leaving a partial create behind.
  const { serviceId, mappingIds } = await createServiceWithMappings({
    catalogue,
    mappings: doctorIds.map((doctorId) => ({
      doctorId,
      clinicId: clinic,
      charges: price,
      duration: input.duration,
      telemedService: input.telemedService,
      status: input.status,
      isPublic: input.isPublic,
    })),
  });

  const mappings = mappingIds.map((id, i) => ({ id: Number(id), doctorId: Number(doctorIds[i]) }));

  await audit('service.created', {
    userId: actorId,
    resource: 'service',
    resourceId: String(serviceId),
    metadata: { name: input.name, clinicId, mappingIds: mappings.map((m) => m.id) },
  });

  return { serviceId: Number(serviceId), name: input.name, category, mappings };
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

/**
 * Update one offering.
 *
 * A rename never renames the catalogue row: it is global, and another clinic may be
 * offering the same service from it. Instead the mapping is repointed at a row carrying
 * the new name and type, created if none exists — KiviCare's own approach (:1455-1499).
 *
 * `price` updates only `charges`. KiviCare also rewrites `wp_kc_services.price` here,
 * which silently changes the list price other clinics see; the effective price is
 * `charges` either way, so the cross-clinic write buys nothing.
 */
export async function updateService(
  mappingId: number,
  input: UpdateServiceInput,
  scope: ServiceScope,
  actorId: string,
): Promise<ServiceSummary> {
  const existing = scope.empty ? null : await findMappingById(BigInt(mappingId));
  if (!existing || !inScope(existing, scope)) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }

  const patch: MappingPatch = {};
  if (input.price !== undefined) patch.charges = String(input.price);
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.telemedService !== undefined) patch.telemedService = input.telemedService;
  if (input.status !== undefined) patch.status = input.status;
  if (input.isPublic !== undefined) patch.isPublic = input.isPublic;

  const renaming = input.name !== undefined && input.name !== existing.name;
  // A `categoryId` equal to the row's current category is a no-op, not a recategorise —
  // otherwise a request that merely echoes the existing category would still take the
  // repoint branch below, and because `wp_kc_services` has no unique constraint on
  // `(name, type)`, `findCatalogueByNameAndType` could hand back a *different* row than
  // `existing.serviceId` and silently repoint the mapping away from it. When the current
  // category can't be determined (missing or unparseable snapshot), any supplied
  // `categoryId` counts as a change, since we cannot prove otherwise.
  const currentCategory = parseCategory(existing.category);
  const recategorising =
    input.categoryId !== undefined &&
    (currentCategory === null || input.categoryId !== currentCategory.id);

  if (renaming || recategorising) {
    // The catalogue row's identity is name *and* type, so changing either means finding
    // or creating a different row.
    const resolved = recategorising ? await resolveCategory(input.categoryId!) : null;
    const type = resolved?.type ?? existing.type ?? '';
    const name = input.name ?? existing.name;

    const conflict = await findConflictingMapping({
      doctorIds: [existing.doctorId],
      clinicId: existing.clinicId,
      name,
      excludeMappingId: existing.id,
    });
    if (conflict) {
      throw {
        _tag: 'conflict',
        code: 'service_name_taken',
        message: `This professional already offers a service named "${name}" at this clinic`,
      } satisfies ServiceCatalogError;
    }

    const reuse = await findCatalogueByNameAndType(name, type);
    patch.serviceId =
      reuse?.id ??
      (await createCatalogue({
        name,
        type,
        category: resolved?.json ?? existing.category,
        price: patch.charges ?? existing.charges ?? '0',
        status: 1,
      }));
  }

  // `patch` is empty exactly when the caller sent nothing that changes anything —
  // `updateMapping` itself short-circuits on that, and the audit trail should too, or a
  // no-op request leaves behind a change record for a change that never happened.
  const wroteSomething = Object.keys(patch).length > 0;

  await updateMapping(existing.id, patch);

  if (wroteSomething) {
    await audit('service.updated', {
      userId: actorId,
      resource: 'service',
      resourceId: String(existing.id),
      metadata: { patch: { ...patch, serviceId: patch.serviceId?.toString() } },
    });
  }

  const refreshed = await findMappingById(existing.id);
  if (!refreshed) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  return toSummary(refreshed);
}
