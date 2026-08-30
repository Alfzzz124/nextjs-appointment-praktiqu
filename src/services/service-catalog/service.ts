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
import type { ServiceScope } from './scope';
import type { ListServicesQuery } from './validation';

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

function toSummary(row: ClinicServiceRow): ServiceSummary {
  return {
    id: Number(row.id),
    serviceId: Number(row.serviceId),
    doctorId: Number(row.doctorId),
    clinicId: Number(row.clinicId),
    // A doctor-specific alias wins over the catalogue name, matching what KiviCare shows.
    name: row.nameAlias ?? row.name,
    category: parseCategory(row.category),
    price: row.charges === null ? null : Number(row.charges),
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
