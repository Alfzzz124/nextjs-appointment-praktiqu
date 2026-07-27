/**
 * Clinic reads, straight from KiviCare's `wp_kc_clinics`.
 *
 * Not our `clinics` shadow table — see docs/architecture/shadow-tables-audit.md.
 * Unlike patients and doctors, clinics are a plain table with a mapped Prisma model
 * (`KcClinic`), so this uses the typed client rather than raw SQL. The repository
 * still earns its place: it normalises `status` to a boolean, decodes the
 * `specialties` LongText JSON, and keeps the WP column names out of the app.
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer (D1).
 */
import { prisma } from '@/lib/db';
import { paginate } from './wp-user';

/** KiviCare uses 1 = active, 0 = inactive across its tables. */
const STATUS_ACTIVE = 1;

export type WpClinic = {
  id: bigint;
  name: string | null;
  email: string | null;
  telephone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  specialties: string[];
  isActive: boolean;
  clinicAdminId: bigint;
  createdAt: Date;
};

export type ListClinicsQuery = {
  page: number;
  perPage: number;
  search?: string;
  /** Inactive clinics are excluded unless explicitly requested. */
  includeInactive?: boolean;
};

export type PaginatedClinics = {
  items: WpClinic[];
  total: number;
  page: number;
  perPage: number;
};

type ClinicRow = {
  id: bigint;
  name: string | null;
  email: string | null;
  telephoneNo: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  specialties: string | null;
  status: number;
  clinicAdminId: bigint;
  createdAt: Date;
};

/**
 * `specialties` is a LongText column holding a JSON array — sometimes of strings,
 * sometimes of `{label}`/`{name}` objects depending on which KiviCare version wrote
 * it. Anything unparseable degrades to an empty list rather than failing the read.
 */
function decodeSpecialties(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          const o = entry as Record<string, unknown>;
          const v = o.label ?? o.name ?? o.value;
          return v === undefined || v === null ? '' : String(v).trim();
        }
        return '';
      })
      .filter((s) => s !== '');
  } catch {
    return [];
  }
}

function toClinic(row: ClinicRow): WpClinic {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    telephone: row.telephoneNo,
    address: row.address,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postalCode,
    specialties: decodeSpecialties(row.specialties),
    isActive: row.status === STATUS_ACTIVE,
    clinicAdminId: row.clinicAdminId,
    createdAt: row.createdAt,
  };
}

const SELECT = {
  id: true,
  name: true,
  email: true,
  telephoneNo: true,
  address: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  specialties: true,
  status: true,
  clinicAdminId: true,
  createdAt: true,
} as const;

export async function findClinicById(id: bigint): Promise<WpClinic | null> {
  const row = await prisma.kcClinic.findUnique({ where: { id }, select: SELECT });
  return row ? toClinic(row as ClinicRow) : null;
}

export async function listClinics(query: ListClinicsQuery): Promise<PaginatedClinics> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);

  const where: Record<string, unknown> = {};
  if (!query.includeInactive) where.status = STATUS_ACTIVE;

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
      { city: { contains: search } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.kcClinic.findMany({
      where,
      select: SELECT,
      orderBy: { id: 'asc' },
      skip: offset,
      take: perPage,
    }),
    prisma.kcClinic.count({ where }),
  ]);

  return { items: (rows as ClinicRow[]).map(toClinic), total, page, perPage };
}
