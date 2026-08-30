/**
 * Service catalogue and doctor-mapping writes — direct SQL, deliberately.
 *
 * KiviCare exposes `kc_service_add` / `kc_service_update` / `kc_service_delete`, and the
 * only listener is `KCProServiceControllerFilters`, which writes `kc_service_sessions`
 * from `session_days`. In the controller itself, `kc_service_add` is only fired when
 * `session_days` is non-empty (DoctorServiceController.php:1398). We never send
 * `session_days` and have no UI for it, so writing straight to the tables skips no
 * listener.
 *
 * This is the opposite of appointments, where five listeners fire unconditionally and
 * writes therefore go through the praktiqu-endpoint plugin. If service-based timeslot
 * sessions are ever adopted, this file is what has to move behind the plugin.
 *
 * Reads live in `services.repo.ts`.
 */
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { ACTIVE_STATUSES } from './appointments.repo';

/**
 * Fetch the id of the last row inserted on this same connection.
 *
 * `LAST_INSERT_ID()` is per-connection, so this must run on the same `tx` that issued
 * the INSERT — never on a fresh `prisma.$queryRawUnsafe`, which may check out a
 * different connection from the pool and return `0` or another request's id.
 */
async function lastInsertId(tx: Prisma.TransactionClient): Promise<bigint> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT LAST_INSERT_ID() AS id`,
  );
  if (rows.length === 0) throw new Error('LAST_INSERT_ID() returned no row');
  return BigInt(rows[0].id);
}

/* ------------------------------------------------------------------ */
/* Catalogue — wp_kc_services                                          */
/* ------------------------------------------------------------------ */

/**
 * The catalogue is global: it has no `clinic_id`, and KiviCare reuses a row whose name
 * *and* type both match rather than creating a near-duplicate. Two clinics offering
 * "Konseling Individu" share one row, which is why renames repoint instead of renaming.
 */
export async function findCatalogueByNameAndType(
  name: string,
  type: string,
): Promise<{ id: bigint } | null> {
  const row = await prisma.kcService.findFirst({
    where: { name, type },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return row ? { id: row.id } : null;
}

type CatalogueRowInput = {
  name: string;
  type: string;
  /** JSON snapshot of the static-data row, as KiviCare stores it. */
  category: string | null;
  price: string;
  status: 0 | 1;
};

/** The bare INSERT, on whatever connection `tx` is pinned to. No transaction of its own. */
async function insertCatalogueRow(tx: Prisma.TransactionClient, input: CatalogueRowInput): Promise<bigint> {
  await tx.$executeRawUnsafe(
    `INSERT INTO wp_kc_services (name, type, category, price, status, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    input.name,
    input.type,
    input.category,
    input.price,
    input.status,
  );
  return lastInsertId(tx);
}

export async function createCatalogue(input: CatalogueRowInput): Promise<bigint> {
  return prisma.$transaction(async (tx) => insertCatalogueRow(tx, input));
}

/* ------------------------------------------------------------------ */
/* Mapping — wp_kc_service_doctor_mapping                              */
/* ------------------------------------------------------------------ */

/** Which of these doctors actually work at this clinic. */
export async function doctorsMappedToClinic(
  doctorIds: bigint[],
  clinicId: bigint,
): Promise<bigint[]> {
  if (doctorIds.length === 0) return [];
  const rows = await prisma.kcDoctorClinicMapping.findMany({
    where: { clinicId, doctorId: { in: doctorIds } },
    select: { doctorId: true },
  });
  return rows.map((r) => r.doctorId);
}

/**
 * An existing mapping for any of these doctors, at this clinic, to a service of this
 * name — regardless of the catalogue row's `type`.
 *
 * Stricter than KiviCare, which only blocks when the type differs and otherwise inserts
 * a second identical mapping (:1249-1252). The table has no unique constraint, so those
 * twins are real, and `listServicesForDoctor` would return the service twice on the
 * booking page. `assignServiceToDoctor` already decided against twins; this follows it.
 */
export async function findConflictingMapping(opts: {
  doctorIds: bigint[];
  clinicId: bigint;
  name: string;
  excludeMappingId?: bigint;
}): Promise<{ mappingId: bigint; doctorId: bigint } | null> {
  if (opts.doctorIds.length === 0) return null;

  const placeholders = opts.doctorIds.map(() => '?').join(',');
  const exclude = opts.excludeMappingId !== undefined ? ' AND sdm.id <> ?' : '';
  const args: unknown[] = [opts.clinicId, opts.name, ...opts.doctorIds];
  if (opts.excludeMappingId !== undefined) args.push(opts.excludeMappingId);

  const rows = await prisma.$queryRawUnsafe<Array<{ mapping_id: bigint | number; doctor_id: bigint | number }>>(
    `SELECT sdm.id AS mapping_id, sdm.doctor_id AS doctor_id
       FROM wp_kc_service_doctor_mapping sdm
       JOIN wp_kc_services s ON s.id = sdm.service_id
      WHERE sdm.clinic_id = ?
        AND s.name = ?
        AND sdm.doctor_id IN (${placeholders})${exclude}
      LIMIT 1`,
    ...args,
  );

  if (rows.length === 0) return null;
  return { mappingId: BigInt(rows[0].mapping_id), doctorId: BigInt(rows[0].doctor_id) };
}

type MappingRowInput = {
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  charges: string;
  duration: number;
  telemedService: 'yes' | 'no';
  status: 0 | 1;
  isPublic: 0 | 1;
};

/** The bare INSERT, on whatever connection `tx` is pinned to. No transaction of its own. */
async function insertMappingRow(tx: Prisma.TransactionClient, input: MappingRowInput): Promise<bigint> {
  await tx.$executeRawUnsafe(
    `INSERT INTO wp_kc_service_doctor_mapping
       (service_id, doctor_id, clinic_id, charges, duration, telemed_service, status, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    input.serviceId,
    input.doctorId,
    input.clinicId,
    input.charges,
    input.duration,
    input.telemedService,
    input.status,
    input.isPublic,
  );
  return lastInsertId(tx);
}

export async function insertMapping(input: MappingRowInput): Promise<bigint> {
  return prisma.$transaction(async (tx) => insertMappingRow(tx, input));
}

/**
 * Create (or reuse) the catalogue row and every per-psychologist mapping in one
 * transaction, so a failure on mapping N rolls back the catalogue insert and mappings
 * 1..N-1 rather than leaving them committed. See `createService`'s own comment on why a
 * partially applied create is worse than a rejection.
 */
export async function createServiceWithMappings(input: {
  /** Reuse an existing catalogue row, or create one. */
  catalogue: { reuseId: bigint } | CatalogueRowInput;
  mappings: Array<{
    doctorId: bigint;
    clinicId: bigint;
    charges: string;
    duration: number;
    telemedService: 'yes' | 'no';
    status: 0 | 1;
    isPublic: 0 | 1;
  }>;
}): Promise<{ serviceId: bigint; mappingIds: bigint[] }> {
  return prisma.$transaction(async (tx) => {
    const serviceId =
      'reuseId' in input.catalogue ? input.catalogue.reuseId : await insertCatalogueRow(tx, input.catalogue);

    const mappingIds: bigint[] = [];
    for (const mapping of input.mappings) {
      const id = await insertMappingRow(tx, { ...mapping, serviceId });
      mappingIds.push(id);
    }

    return { serviceId, mappingIds };
  });
}

export type MappingPatch = {
  /** Set when a rename repoints this mapping at a different catalogue row. */
  serviceId?: bigint;
  charges?: string;
  duration?: number;
  telemedService?: 'yes' | 'no';
  status?: 0 | 1;
  isPublic?: 0 | 1;
};

const PATCH_COLUMNS: Array<[keyof MappingPatch, string]> = [
  ['serviceId', 'service_id'],
  ['charges', 'charges'],
  ['duration', 'duration'],
  ['telemedService', 'telemed_service'],
  ['status', 'status'],
  ['isPublic', 'is_public'],
];

export async function updateMapping(id: bigint, patch: MappingPatch): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];

  for (const [key, column] of PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(value);
  }

  // An empty patch must not become `SET  WHERE id = ?`, which is a syntax error.
  if (sets.length === 0) return;

  args.push(id);
  await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET ${sets.join(', ')} WHERE id = ?`,
    ...args,
  );
}

/**
 * Soft delete, matching `unassignServiceFromDoctor`.
 *
 * KiviCare hard-deletes here (:1643). We do not: the row carries the price and duration
 * a booking was made against, and a mistaken delete should be recoverable.
 */
export async function softDeleteMapping(id: bigint): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = 0 WHERE id = ?`,
    id,
  );
}

/**
 * Appointments that would be stranded by removing this offering.
 *
 * `wp_kc_appointment_service_mapping.service_id` points at the *catalogue*, so past
 * appointments keep their service name whatever happens to this mapping. What breaks is
 * a booking that has not happened yet: the service is still on it, but the psychologist
 * no longer offers it.
 *
 * Counts only `ACTIVE_STATUSES` — the states that still occupy a slot — rather than
 * "not cancelled". `CHECK_OUT` is a finished visit: it still satisfies
 * `appointment_start_date >= CURDATE()` on the day it happened, but the service is not
 * actually in use by it any more, so it must not block the delete.
 */
export async function countBlockingAppointments(opts: {
  serviceId: bigint;
  doctorId: bigint;
}): Promise<number> {
  const statusPlaceholders = ACTIVE_STATUSES.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c
       FROM wp_kc_appointment_service_mapping asm
       JOIN wp_kc_appointments a ON a.id = asm.appointment_id
      WHERE asm.service_id = ?
        AND a.doctor_id = ?
        AND a.status IN (${statusPlaceholders})
        AND a.appointment_start_date >= CURDATE()`,
    opts.serviceId,
    opts.doctorId,
    ...ACTIVE_STATUSES,
  );
  return rows.length === 0 ? 0 : Number(rows[0].c);
}
