/**
 * Service catalogue reads, straight from KiviCare's `wp_kc_services` and
 * `wp_kc_service_doctor_mapping`.
 *
 * Not our `services` / `professional_service_assignments` / `clinic_service_prices`
 * shadow tables — see docs/architecture/shadow-tables-audit.md. KiviCare keeps the
 * base catalogue in `wp_kc_services` and the per-doctor, per-clinic price and
 * duration in the mapping table; the mapping's `charges` is what a patient pays.
 *
 * Reads are direct SQL. Assignment WRITES are too — see the Writes section: KiviCare
 * hooks the service catalogue but not the doctor-service mapping.
 */
import { prisma } from '@/lib/db';
import { paginate } from './wp-user';

const STATUS_ACTIVE = 1;

export type WpService = {
  id: bigint;
  name: string;
  type: string | null;
  /** Base list price. The per-doctor mapping overrides it — see WpDoctorService. */
  price: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: Date;
};

/** A service as offered by a specific doctor at a specific clinic. */
export type WpDoctorService = {
  mappingId: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  name: string;
  type: string | null;
  /** The doctor's charge; overrides the service's base price. */
  charges: string | null;
  durationMinutes: number | null;
  isPublic: boolean;
  isActive: boolean;
  telemedService: string | null;
  /** Doctor-specific display name, when set. */
  nameAlias: string | null;
};

export type ListServicesQuery = {
  page: number;
  perPage: number;
  search?: string;
  includeInactive?: boolean;
};

export type PaginatedServices = {
  items: WpService[];
  total: number;
  page: number;
  perPage: number;
};

const SERVICE_SELECT = {
  id: true,
  name: true,
  type: true,
  price: true,
  category: true,
  status: true,
  createdAt: true,
} as const;

type ServiceRow = {
  id: bigint;
  name: string;
  type: string | null;
  price: string | null;
  category: string | null;
  status: number;
  createdAt: Date;
};

function toService(row: ServiceRow): WpService {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    price: row.price,
    category: row.category,
    isActive: row.status === STATUS_ACTIVE,
    createdAt: row.createdAt,
  };
}

export async function findServiceById(id: bigint): Promise<WpService | null> {
  const row = await prisma.kcService.findUnique({ where: { id }, select: SERVICE_SELECT });
  return row ? toService(row as ServiceRow) : null;
}

export async function listServices(query: ListServicesQuery): Promise<PaginatedServices> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);

  const where: Record<string, unknown> = {};
  if (!query.includeInactive) where.status = STATUS_ACTIVE;

  const search = query.search?.trim();
  if (search) where.name = { contains: search };

  const [rows, total] = await Promise.all([
    prisma.kcService.findMany({
      where,
      select: SERVICE_SELECT,
      orderBy: { id: 'asc' },
      skip: offset,
      take: perPage,
    }),
    prisma.kcService.count({ where }),
  ]);

  return { items: (rows as ServiceRow[]).map(toService), total, page, perPage };
}

/**
 * The services a doctor offers, with the charge and duration that actually apply.
 *
 * Two queries rather than a join: `KcServiceDoctorMapping` has no Prisma relation to
 * `KcService` (the Kc* models are standalone `@@map`s onto KiviCare's tables, and
 * adding relations would change the schema KiviCare owns).
 */
export async function listServicesForDoctor(opts: {
  doctorId: bigint;
  clinicId?: bigint;
  /** Restrict to services exposed on the public booking page. */
  publicOnly?: boolean;
}): Promise<WpDoctorService[]> {
  const where: Record<string, unknown> = {
    doctorId: opts.doctorId,
    status: STATUS_ACTIVE,
  };
  if (opts.clinicId !== undefined) where.clinicId = opts.clinicId;
  if (opts.publicOnly) where.isPublic = 1;

  const mappings = await prisma.kcServiceDoctorMapping.findMany({
    where,
    select: {
      id: true,
      serviceId: true,
      doctorId: true,
      clinicId: true,
      charges: true,
      duration: true,
      isPublic: true,
      status: true,
      telemedService: true,
      serviceNameAlias: true,
    },
    orderBy: { id: 'asc' },
  });

  if (mappings.length === 0) return [];

  const services = await prisma.kcService.findMany({
    where: { id: { in: mappings.map((m) => m.serviceId) } },
    select: { id: true, name: true, type: true },
  });
  const byId = new Map(services.map((s) => [s.id.toString(), s]));

  return mappings
    // A mapping can outlive its service if the service row was deleted directly in
    // the DB; skip those rather than emitting a nameless entry.
    .filter((m) => byId.has(m.serviceId.toString()))
    .map((m) => {
      const service = byId.get(m.serviceId.toString())!;
      return {
        mappingId: m.id,
        serviceId: m.serviceId,
        doctorId: m.doctorId,
        clinicId: m.clinicId,
        name: service.name,
        type: service.type,
        charges: m.charges,
        durationMinutes: m.duration ?? null,
        isPublic: m.isPublic === 1,
        isActive: m.status === STATUS_ACTIVE,
        telemedService: m.telemedService,
        nameAlias: m.serviceNameAlias,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Clinic service listing — the mapping is the resource                */
/* ------------------------------------------------------------------ */
/**
 * `/api/v1/services` treats a mapping row as the resource, not the catalogue: price,
 * duration, telemed flag and status all live on the mapping, and only the mapping has a
 * `clinic_id` to scope by.
 */

export type ClinicServiceRow = {
  /** The mapping row id — this is the `{id}` in `/api/v1/services/{id}`. */
  id: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  name: string;
  type: string | null;
  /** Raw JSON snapshot KiviCare keeps in `wp_kc_services.category`. */
  category: string | null;
  charges: string | null;
  durationMinutes: number | null;
  telemedService: string | null;
  isPublic: boolean;
  isActive: boolean;
  nameAlias: string | null;
};

export type ListClinicServicesQuery = {
  page: number;
  perPage: number;
  search?: string;
  clinicId?: bigint;
  doctorId?: bigint;
  includeInactive?: boolean;
};

export type PaginatedClinicServices = {
  items: ClinicServiceRow[];
  total: number;
  page: number;
  perPage: number;
};

const MAPPING_SELECT = {
  id: true,
  serviceId: true,
  doctorId: true,
  clinicId: true,
  charges: true,
  duration: true,
  isPublic: true,
  status: true,
  telemedService: true,
  serviceNameAlias: true,
  // `created_at` is deliberately NOT selected. It is `datetime NOT NULL`, but KiviCare has
  // filled it with MySQL zero-dates: 273 of 277 rows on staging read `0000-00-00 00:00:00`.
  // Prisma refuses to decode those ("Value out of range for the type"), so selecting the
  // column throws for essentially every row. The field was never part of this feature, so
  // it is dropped rather than bought back with a third query. Do not add it back without
  // checking the data first.
} as const;

type MappingRow = {
  id: bigint;
  serviceId: bigint;
  doctorId: bigint;
  clinicId: bigint;
  charges: string | null;
  duration: number | null;
  isPublic: number;
  status: number;
  telemedService: string | null;
  serviceNameAlias: string | null;
};

type CatalogueRow = { id: bigint; name: string; type: string | null; category: string | null };

/** Fetch the catalogue rows for a set of mappings, keyed by id-as-string. */
async function catalogueFor(mappings: MappingRow[]): Promise<Map<string, CatalogueRow>> {
  if (mappings.length === 0) return new Map();
  const rows = await prisma.kcService.findMany({
    where: { id: { in: mappings.map((m) => m.serviceId) } },
    select: { id: true, name: true, type: true, category: true },
  });
  return new Map((rows as CatalogueRow[]).map((r) => [r.id.toString(), r]));
}

function toClinicService(m: MappingRow, s: CatalogueRow): ClinicServiceRow {
  return {
    id: m.id,
    serviceId: m.serviceId,
    doctorId: m.doctorId,
    clinicId: m.clinicId,
    name: s.name,
    type: s.type,
    category: s.category,
    charges: m.charges,
    durationMinutes: m.duration ?? null,
    telemedService: m.telemedService,
    isPublic: m.isPublic === 1,
    isActive: m.status === STATUS_ACTIVE,
    nameAlias: m.serviceNameAlias,
  };
}

export async function listClinicServices(
  query: ListClinicServicesQuery,
): Promise<PaginatedClinicServices> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);

  const where: Record<string, unknown> = {};
  if (!query.includeInactive) where.status = STATUS_ACTIVE;
  if (query.clinicId !== undefined) where.clinicId = query.clinicId;
  if (query.doctorId !== undefined) where.doctorId = query.doctorId;

  const search = query.search?.trim();
  if (search) {
    // The name lives on the catalogue, which has no Prisma relation to the mapping.
    // Resolve matching catalogue ids first, then filter the mapping on them.
    const matches = await prisma.kcService.findMany({
      where: { name: { contains: search } },
      select: { id: true },
    });
    if (matches.length === 0) return { items: [], total: 0, page, perPage };
    where.serviceId = { in: matches.map((m) => m.id) };
  }

  const [rows, total] = await Promise.all([
    prisma.kcServiceDoctorMapping.findMany({
      where,
      select: MAPPING_SELECT,
      orderBy: { id: 'asc' },
      skip: offset,
      take: perPage,
    }),
    prisma.kcServiceDoctorMapping.count({ where }),
  ]);

  const mappings = rows as MappingRow[];
  const byId = await catalogueFor(mappings);

  // `total` deliberately counts mappings, not survivors: it is the count the pagination
  // arithmetic is built on, and dropping orphans from it would make page sizes lie.
  return {
    items: mappings
      .filter((m) => byId.has(m.serviceId.toString()))
      .map((m) => toClinicService(m, byId.get(m.serviceId.toString())!)),
    total,
    page,
    perPage,
  };
}

/**
 * One mapping by id, regardless of `status`.
 *
 * Soft-deleted rows stay fetchable by id on purpose — `GET /services/{id}` should show
 * an admin what they just deactivated rather than 404.
 */
export async function findMappingById(id: bigint): Promise<ClinicServiceRow | null> {
  const row = await prisma.kcServiceDoctorMapping.findUnique({
    where: { id },
    select: MAPPING_SELECT,
  });
  if (!row) return null;

  const mapping = row as MappingRow;
  const byId = await catalogueFor([mapping]);
  const service = byId.get(mapping.serviceId.toString());
  return service ? toClinicService(mapping, service) : null;
}

/* ------------------------------------------------------------------ */
/* Writes — doctor↔service assignments                                 */
/* ------------------------------------------------------------------ */
/**
 * Direct SQL, like clinic sessions. KiviCare fires `kc_service_add`/`kc_service_update`
 * for the SERVICE CATALOGUE, but registers nothing for the doctor↔service mapping,
 * which is what these functions touch — so a direct write skips no listener.
 */

/** Assign a service to a doctor at a clinic. Idempotent: re-assigning reactivates. */
export async function assignServiceToDoctor(opts: {
  doctorId: bigint;
  serviceId: bigint;
  clinicId: bigint;
  charges?: string;
  durationMinutes?: number;
  isPublic?: boolean;
}): Promise<bigint> {
  const existing = await prisma.kcServiceDoctorMapping.findFirst({
    where: { doctorId: opts.doctorId, serviceId: opts.serviceId, clinicId: opts.clinicId },
    select: { id: true },
  });

  if (existing) {
    // The table has no unique constraint, so a plain insert would duplicate. Reactivate
    // instead — a previously unassigned service should come back, not appear twice.
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_service_doctor_mapping
          SET status = 1, charges = COALESCE(?, charges), duration = COALESCE(?, duration)
        WHERE id = ?`,
      opts.charges ?? null,
      opts.durationMinutes ?? null,
      existing.id,
    );
    return existing.id;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_service_doctor_mapping
       (service_id, doctor_id, clinic_id, charges, duration, status, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NOW())`,
    opts.serviceId,
    opts.doctorId,
    opts.clinicId,
    opts.charges ?? '0',
    opts.durationMinutes ?? null,
    opts.isPublic === false ? 0 : 1,
  );

  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint | number }>>(
    `SELECT LAST_INSERT_ID() AS id`,
  );
  return BigInt(rows[0].id);
}

/**
 * Unassign — soft, by setting status = 0.
 *
 * Not a DELETE: existing appointments reference the service, and removing the row would
 * strip the price and duration from historical bookings.
 */
export async function unassignServiceFromDoctor(opts: {
  doctorId: bigint;
  serviceId: bigint;
  clinicId?: bigint;
}): Promise<number> {
  const where: string[] = ['doctor_id = ?', 'service_id = ?', 'status = 1'];
  const args: unknown[] = [opts.doctorId, opts.serviceId];
  if (opts.clinicId !== undefined) {
    where.push('clinic_id = ?');
    args.push(opts.clinicId);
  }

  return prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = 0 WHERE ${where.join(' AND ')}`,
    ...args,
  );
}

export async function setDoctorServiceStatus(opts: {
  mappingIds: bigint[];
  doctorId: bigint;
  status: 0 | 1;
}): Promise<number> {
  if (opts.mappingIds.length === 0) return 0;

  // doctor_id is in the WHERE so one professional cannot flip another's assignments.
  return prisma.$executeRawUnsafe(
    `UPDATE wp_kc_service_doctor_mapping SET status = ?
      WHERE doctor_id = ? AND id IN (${opts.mappingIds.map(() => '?').join(',')})`,
    opts.status,
    opts.doctorId,
    ...opts.mappingIds,
  );
}
