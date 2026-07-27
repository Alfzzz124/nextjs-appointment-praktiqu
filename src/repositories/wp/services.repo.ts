/**
 * Service catalogue reads, straight from KiviCare's `wp_kc_services` and
 * `wp_kc_service_doctor_mapping`.
 *
 * Not our `services` / `professional_service_assignments` / `clinic_service_prices`
 * shadow tables — see docs/architecture/shadow-tables-audit.md. KiviCare keeps the
 * base catalogue in `wp_kc_services` and the per-doctor, per-clinic price and
 * duration in the mapping table; the mapping's `charges` is what a patient pays.
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer (D1).
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
