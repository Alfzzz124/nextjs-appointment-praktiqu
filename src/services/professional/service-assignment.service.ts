/**
 * Doctor↔service assignments — backed by `wp_kc_service_doctor_mapping`.
 *
 * Replaces three shadow tables that all modelled the same thing:
 * `professional_service_assignments`, `doctor_service_mappings` and
 * `clinic_service_prices`. KiviCare keeps the assignment, the doctor's own charge and
 * the appointment duration in a single row.
 *
 * Direct SQL for both reads and writes. KiviCare hooks the service *catalogue*
 * (`kc_service_add` / `kc_service_update`) but registers nothing for this mapping, so a
 * direct write skips no listener.
 *
 * Ids are `number` — `wp_users.ID` for the doctor, `wp_kc_services.id` for the service.
 */

import {
  assignServiceToDoctor,
  findServiceById,
  listServicesForDoctor,
  setDoctorServiceStatus,
  unassignServiceFromDoctor,
} from '@/repositories/wp/services.repo';
import { serviceAssignmentAudit } from '@/lib/audit';

export interface AssignedService {
  /** The mapping row id, not the service id. */
  id: number;
  doctorId: number;
  serviceId: number;
  serviceName: string;
  /** Minutes. Null when the mapping defers to the clinic session's slot size. */
  durationMinutes: number | null;
  /** The doctor's charge, which overrides the service's list price. */
  charges: string | null;
  isPublic: boolean;
}

export type ServiceAssignmentError =
  | { _tag: 'validation'; errors: Record<string, string[]> }
  | { _tag: 'not_found'; entity?: string }
  | { _tag: 'conflict'; code: string; message: string };

export function isServiceAssignmentError(err: unknown): err is ServiceAssignmentError {
  return typeof err === 'object' && err !== null && '_tag' in err;
}

type DoctorServiceRow = Awaited<ReturnType<typeof listServicesForDoctor>>[number];

function toAssigned(m: DoctorServiceRow): AssignedService {
  return {
    id: Number(m.mappingId),
    doctorId: Number(m.doctorId),
    serviceId: Number(m.serviceId),
    // A doctor-specific alias wins over the catalogue name, which is what KiviCare
    // displays when one is set.
    serviceName: m.nameAlias ?? m.name,
    durationMinutes: m.durationMinutes,
    charges: m.charges,
    isPublic: m.isPublic,
  };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function listAssignedServices(
  doctorId: number,
  clinicId?: number,
): Promise<AssignedService[]> {
  const rows = await listServicesForDoctor({
    doctorId: BigInt(doctorId),
    clinicId: clinicId !== undefined ? BigInt(clinicId) : undefined,
  });
  return rows.map(toAssigned);
}

/* ------------------------------------------------------------------ */
/* Assign / unassign                                                   */
/* ------------------------------------------------------------------ */

export async function assignService(
  doctorId: number,
  serviceId: number,
  clinicId: number,
  actorId: string,
  opts: { charges?: string; durationMinutes?: number; isPublic?: boolean } = {},
): Promise<{ id: number }> {
  const service = await findServiceById(BigInt(serviceId));
  if (!service) {
    throw { _tag: 'not_found' as const, entity: 'service' };
  }
  if (!service.isActive) {
    throw {
      _tag: 'validation' as const,
      errors: { serviceId: ['Only ACTIVE services can be assigned'] },
    };
  }

  // Re-assigning is not an error here, unlike the old shadow-table version: unassign is
  // a soft status flip, so the row still exists and the repository reactivates it. The
  // mapping table has no unique constraint, so a blind insert would duplicate instead.
  const mappingId = await assignServiceToDoctor({
    doctorId: BigInt(doctorId),
    serviceId: BigInt(serviceId),
    clinicId: BigInt(clinicId),
    charges: opts.charges,
    durationMinutes: opts.durationMinutes,
    isPublic: opts.isPublic,
  });

  await serviceAssignmentAudit(String(doctorId), actorId, String(serviceId), service.name, true);

  return { id: Number(mappingId) };
}

/**
 * Unassign — a soft status flip, not a delete.
 *
 * Existing appointments reference the mapping for their price and duration; deleting
 * the row would strip both from historical bookings.
 */
export async function unassignService(
  doctorId: number,
  serviceId: number,
  actorId: string,
  clinicId?: number,
): Promise<void> {
  const affected = await unassignServiceFromDoctor({
    doctorId: BigInt(doctorId),
    serviceId: BigInt(serviceId),
    clinicId: clinicId !== undefined ? BigInt(clinicId) : undefined,
  });

  if (affected === 0) {
    throw { _tag: 'not_found' as const, entity: 'assignment' };
  }

  const service = await findServiceById(BigInt(serviceId));
  await serviceAssignmentAudit(
    String(doctorId),
    actorId,
    String(serviceId),
    service?.name ?? 'Unknown Service',
    false,
  );
}

/* ------------------------------------------------------------------ */
/* Bulk                                                                */
/* ------------------------------------------------------------------ */

/** Soft-unassign several services at once. Returns how many rows changed. */
export async function bulkDeleteDoctorServices(
  doctorId: number,
  serviceIds: number[],
): Promise<number> {
  let affected = 0;
  for (const serviceId of serviceIds) {
    affected += await unassignServiceFromDoctor({
      doctorId: BigInt(doctorId),
      serviceId: BigInt(serviceId),
    });
  }
  return affected;
}

/**
 * Flip assignment status in bulk.
 *
 * Takes MAPPING ids, not service ids: the mapping carries the status, and one service
 * can be mapped to a doctor at several clinics with different states.
 */
export async function bulkSetDoctorServiceStatus(
  doctorId: number,
  mappingIds: number[],
  status: string,
): Promise<number> {
  const active = !(status === 'inactive' || status === '0');
  return setDoctorServiceStatus({
    mappingIds: mappingIds.map((id) => BigInt(id)),
    doctorId: BigInt(doctorId),
    status: active ? 1 : 0,
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export async function exportDoctorServices(
  doctorId: number,
  clinicId?: number,
): Promise<AssignedService[]> {
  return listAssignedServices(doctorId, clinicId);
}
