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
  listOptionRowsOf,
  type ClinicServiceRow,
} from '@/repositories/wp/services.repo';
import { parseServiceCategory, type ServiceCategory } from '@/repositories/wp/service-category';
import {
  findCatalogueByNameAndType,
  createCatalogue,
  createServiceWithMappings,
  doctorsMappedToClinic,
  findConflictingMapping,
  saveServiceUpdate,
  softDeleteMapping,
  countBlockingAppointments,
  type MappingPatch,
  type OptionInsert,
} from '@/repositories/wp/services.write';
import {
  optionName,
  planDurationOptions,
  type ExistingOption,
  type OptionPlan,
  type WantedOption,
} from './duration-options';
import { findServiceTypeById } from '@/repositories/wp/static-data.repo';
import { audit } from '@/lib/logging';
import type { ServiceScope } from './scope';
import type { ListServicesQuery, CreateServiceInput, UpdateServiceInput } from './validation';

export type { ServiceCategory };

export type DurationOptionSummary = {
  /** The option's own mapping id. */
  id: number;
  /** The option's catalogue id — what a booking sends. */
  serviceId: number;
  name: string;
  durationMinutes: number | null;
  price: number | null;
  isActive: boolean;
};

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
  /** Parent mapping id when this row is a duration option (live or removed), else null. */
  durationOf: number | null;
  /** This service's live duration options, shortest first. Empty for an option row. */
  durationOptions: DurationOptionSummary[];
};

export type ServiceCatalogError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'bad_request'; code: string; message: string }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string; count?: number }
  | { _tag: 'unprocessable'; code: string; message: string };

export function isServiceCatalogError(err: unknown): err is ServiceCatalogError {
  return typeof err === 'object' && err !== null && '_tag' in err;
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

function toOptionSummary(o: ClinicServiceRow): DurationOptionSummary {
  return {
    id: Number(o.id),
    serviceId: Number(o.serviceId),
    name: o.name,
    durationMinutes: o.durationMinutes,
    price: parsePrice(o.charges),
    isActive: o.isActive,
  };
}

/** `options`: this row's option rows, live or removed; only live ones are reported. */
function toSummary(row: ClinicServiceRow, options: ClinicServiceRow[] = []): ServiceSummary {
  return {
    id: Number(row.id),
    serviceId: Number(row.serviceId),
    doctorId: Number(row.doctorId),
    clinicId: Number(row.clinicId),
    name: row.name,
    category: parseServiceCategory(row.category),
    price: parsePrice(row.charges),
    durationMinutes: row.durationMinutes,
    telemedService: row.telemedService === 'yes' ? 'yes' : 'no',
    isPublic: row.isPublic,
    isActive: row.isActive,
    durationOf: row.optionOf ? Number(row.optionOf.parentId) : null,
    durationOptions: options.filter((o) => o.optionOf && !o.optionOf.removed).map(toOptionSummary),
  };
}

/** The LIVE option rows of one parent, shortest first. */
async function liveOptionsOf(parentId: bigint): Promise<ClinicServiceRow[]> {
  return (await listOptionRowsOf([parentId])).filter((o) => o.optionOf && !o.optionOf.removed);
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

  // Options of this page's parents, fetched by parent id — not assembled from this page,
  // where an option may be missing because it fell on another page.
  const parentIds = page.items.filter((r) => !r.optionOf).map((r) => r.id);
  const optionRows = await listOptionRowsOf(parentIds);
  const byParent = new Map<string, ClinicServiceRow[]>();
  for (const o of optionRows) {
    const key = o.optionOf!.parentId.toString();
    byParent.set(key, [...(byParent.get(key) ?? []), o]);
  }

  return {
    services: page.items.map((r) => toSummary(r, r.optionOf ? [] : byParent.get(r.id.toString()) ?? [])),
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
  return toSummary(row, row.optionOf ? [] : await listOptionRowsOf([row.id]));
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

function editViaParent(parentId: bigint): ServiceCatalogError {
  return {
    _tag: 'unprocessable',
    code: 'edit_via_parent',
    message: `This row is a duration option of service ${parentId}. Edit it through that service.`,
  };
}

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
 *
 * Duration options are planned, checked and written with the parent: every decision is
 * made before the first write, and every mapping write lands in one transaction.
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
  if (existing.optionOf) throw editViaParent(existing.optionOf.parentId);

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
  const currentCategory = parseServiceCategory(existing.category);
  const recategorising =
    input.categoryId !== undefined &&
    (currentCategory === null || input.categoryId !== currentCategory.id);

  // ---- Decide everything; write nothing yet. A rejection must leave no trace. ----

  const resolved = recategorising ? await resolveCategory(input.categoryId!) : null;
  // The catalogue row's identity is name *and* type, so changing either means finding
  // or creating a different row — for the parent and, below, for every option.
  const name = input.name ?? existing.name;
  const type = resolved?.type ?? existing.type ?? '';
  const categoryJson = resolved?.json ?? existing.category;

  let parentReuse: bigint | null = null;
  if (renaming || recategorising) {
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
    parentReuse = (await findCatalogueByNameAndType(name, type))?.id ?? null;
  }

  const optionRows = await listOptionRowsOf([existing.id]);
  const liveRows = optionRows.filter((o) => o.optionOf && !o.optionOf.removed);
  const existingOptions: ExistingOption[] = liveRows.map((o) => ({
    mappingId: o.id,
    serviceId: o.serviceId,
    durationMinutes: o.durationMinutes,
    charges: o.charges,
  }));
  // No list sent: the options stay as they are, but still have to fit a changed parent
  // duration, and still follow a rename or a status change.
  const wanted: WantedOption[] =
    input.durationOptions !== undefined
      ? input.durationOptions.map((o) => ({ id: o.id, duration: o.duration, charges: String(o.price) }))
      : existingOptions.map((o) => ({
          id: Number(o.mappingId),
          duration: o.durationMinutes ?? 0,
          charges: o.charges ?? '0',
        }));

  const planned = planDurationOptions(existingOptions, wanted, input.duration ?? existing.durationMinutes);
  if ('error' in planned) {
    throw { _tag: 'unprocessable', code: planned.error.code, message: planned.error.message } satisfies ServiceCatalogError;
  }
  const { plan } = planned;

  // An upcoming booking pins its option: removing it, or changing its length under the
  // booking, would silently change what the client booked. A price change is allowed —
  // a booking keeps its own bill, exactly as for an ordinary service.
  const lengthChanged = (k: OptionPlan['keep'][number]) => k.duration !== (k.existing.durationMinutes ?? 0);
  const pinned = [...plan.remove, ...plan.keep.filter(lengthChanged).map((k) => k.existing)];
  let blocking = 0;
  for (const o of pinned) {
    blocking += await countBlockingAppointments({ serviceId: o.serviceId, doctorId: existing.doctorId });
  }
  if (blocking > 0) {
    throw {
      _tag: 'conflict',
      code: 'duration_option_has_appointments',
      message: `${blocking} upcoming appointment(s) use a duration option being removed or changed. Cancel or reschedule them first.`,
      count: blocking,
    } satisfies ServiceCatalogError;
  }

  // Option names follow the parent's name and their own duration.
  const nameNow = new Map(liveRows.map((o) => [o.id.toString(), o.name]));
  const keeps = plan.keep.map((k) => ({ ...k, target: optionName(name, k.duration) }));
  const creates = plan.create.map((c) => ({ ...c, target: optionName(name, c.duration) }));
  const repointed = new Set(
    keeps.filter((k) => recategorising || k.target !== nameNow.get(k.existing.mappingId.toString())),
  );

  // The parent and all its options (removed ones too) are being rewritten here, so none
  // of them can be the "other service" a name clashes with.
  const excludeMappingIds = [existing.id, ...optionRows.map((o) => o.id)];
  for (const t of [...repointed, ...creates]) {
    const clash = await findConflictingMapping({
      doctorIds: [existing.doctorId],
      clinicId: existing.clinicId,
      name: t.target,
      excludeMappingIds,
    });
    if (clash) {
      throw {
        _tag: 'conflict',
        code: 'service_name_taken',
        message: `This professional already offers a service named "${t.target}" at this clinic`,
      } satisfies ServiceCatalogError;
    }
  }

  // ---- Write. Catalogue rows first (harmless if left unused), then one transaction. ----

  if (renaming || recategorising) {
    patch.serviceId =
      parentReuse ??
      (await createCatalogue({
        name,
        type,
        category: categoryJson,
        price: patch.charges ?? existing.charges ?? '0',
        status: 1,
      }));
  }

  const catalogueFor = async (target: string, charges: string): Promise<bigint> =>
    (await findCatalogueByNameAndType(target, type))?.id ??
    (await createCatalogue({ name: target, type, category: categoryJson, price: charges, status: 1 }));

  const cascade: MappingPatch = {};
  if (input.telemedService !== undefined) cascade.telemedService = input.telemedService;
  if (input.status !== undefined) cascade.status = input.status;
  if (input.isPublic !== undefined) cascade.isPublic = input.isPublic;

  const optionUpdates: Array<{ mappingId: bigint; patch: MappingPatch }> = [];
  for (const k of keeps) {
    const p: MappingPatch = { ...cascade };
    if (lengthChanged(k)) p.duration = k.duration;
    if (k.charges !== (k.existing.charges ?? '0')) p.charges = k.charges;
    if (repointed.has(k)) p.serviceId = await catalogueFor(k.target, k.charges);
    if (Object.keys(p).length > 0) optionUpdates.push({ mappingId: k.existing.mappingId, patch: p });
  }

  const optionInserts: OptionInsert[] = [];
  for (const c of creates) {
    optionInserts.push({
      parentMappingId: existing.id,
      serviceId: await catalogueFor(c.target, c.charges),
      doctorId: existing.doctorId,
      clinicId: existing.clinicId,
      charges: c.charges,
      duration: c.duration,
      telemedService: input.telemedService ?? (existing.telemedService === 'yes' ? 'yes' : 'no'),
      status: input.status ?? (existing.isActive ? 1 : 0),
      isPublic: input.isPublic ?? (existing.isPublic ? 1 : 0),
    });
  }

  const optionRemovals = plan.remove.map((o) => ({ mappingId: o.mappingId, parentMappingId: existing.id }));

  // Nothing to write exactly when the caller sent nothing that changes anything; the
  // audit trail must then stay silent too, or a no-op leaves a record of a change that
  // never happened.
  const wroteSomething =
    Object.keys(patch).length > 0 || optionUpdates.length > 0 || optionInserts.length > 0 || optionRemovals.length > 0;

  await saveServiceUpdate({ parent: { mappingId: existing.id, patch }, optionUpdates, optionInserts, optionRemovals });

  if (wroteSomething) {
    await audit('service.updated', {
      userId: actorId,
      resource: 'service',
      resourceId: String(existing.id),
      metadata: {
        patch: { ...patch, serviceId: patch.serviceId?.toString() },
        durationOptions: {
          created: optionInserts.map((i) => i.duration),
          changed: optionUpdates.map((u) => Number(u.mappingId)),
          removed: optionRemovals.map((r) => Number(r.mappingId)),
        },
      },
    });
  }

  const refreshed = await findMappingById(existing.id);
  if (!refreshed) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  return toSummary(refreshed, await liveOptionsOf(refreshed.id));
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

/**
 * Retire an offering.
 *
 * Soft, and refused while a future booking still points at it. Past appointments are
 * safe either way — `wp_kc_appointment_service_mapping` references the catalogue, which
 * we never delete — but an upcoming one would be left naming a service its psychologist
 * no longer offers.
 */
export async function deleteService(
  mappingId: number,
  scope: ServiceScope,
  actorId: string,
): Promise<{ ok: true }> {
  const existing = scope.empty ? null : await findMappingById(BigInt(mappingId));
  if (!existing || !inScope(existing, scope)) {
    throw { _tag: 'not_found', entity: 'service' } satisfies ServiceCatalogError;
  }
  if (existing.optionOf) throw editViaParent(existing.optionOf.parentId);

  // `findMappingById` deliberately ignores `status`, so a mapping already retired is
  // still found here. Deleting it again would be a no-op UPDATE that nonetheless issues
  // a second `service.deleted` audit event for the same resource — stop before any of
  // that, and keep the response idempotent.
  if (!existing.isActive) {
    return { ok: true };
  }

  // The parent's live options go with it, so their bookings block it as much as its own.
  const live = await liveOptionsOf(existing.id);
  let blocking = await countBlockingAppointments({
    serviceId: existing.serviceId,
    doctorId: existing.doctorId,
  });
  for (const o of live) {
    blocking += await countBlockingAppointments({ serviceId: o.serviceId, doctorId: existing.doctorId });
  }
  if (blocking > 0) {
    throw {
      _tag: 'conflict',
      code: 'service_has_upcoming_appointments',
      message: `${blocking} upcoming appointment(s) still use this service. Cancel or reschedule them first.`,
      count: blocking,
    } satisfies ServiceCatalogError;
  }

  // Live options keep their marker: reactivating the parent (PUT status 1) brings them back.
  await softDeleteMapping(existing.id);
  for (const o of live) await softDeleteMapping(o.id);

  await audit('service.deleted', {
    userId: actorId,
    resource: 'service',
    resourceId: String(existing.id),
    metadata: {
      serviceId: Number(existing.serviceId),
      clinicId: Number(existing.clinicId),
      optionIds: live.map((o) => Number(o.id)),
    },
  });

  return { ok: true };
}
