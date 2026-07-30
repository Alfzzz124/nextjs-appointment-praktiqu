/**
 * Clinic reads, straight from KiviCare's `wp_kc_clinics`.
 *
 * Not our `clinics` shadow table — see docs/architecture/shadow-tables-audit.md.
 * Unlike patients and doctors, clinics are a plain table with a mapped Prisma model
 * (`KcClinic`), so this uses the typed client rather than raw SQL. The repository
 * still earns its place: it normalises `status` to a boolean, decodes the
 * `specialties` LongText JSON, and keeps the WP column names out of the app.
 *
 * Reads AND writes are direct SQL. KiviCare registers no listener for its clinic
 * hooks, so a direct write skips nothing — see the Writes section below.
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
  countryCode: string | null;
  countryCallingCode: string | null;
  /**
   * Decoded `extra` blob. KiviCare has no columns for timezone, logo or business
   * hours, so those round-trip through here rather than through a schema change.
   */
  extra: Record<string, unknown>;
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
  countryCode: string | null;
  countryCallingCode: string | null;
  extra: string | null;
  createdAt: Date;
};

function decodeExtra(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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
    countryCode: row.countryCode,
    countryCallingCode: row.countryCallingCode,
    extra: decodeExtra(row.extra),
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
  countryCode: true,
  countryCallingCode: true,
  extra: true,
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

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */
/**
 * Direct SQL. KiviCare declares `kc_clinic_delete` and `kcpro_clinic_update` but
 * registers no listener for either, so a direct write skips nothing — same evidence
 * that justified it for clinic sessions and holidays.
 */

export type UpdateClinicInput = {
  name?: string;
  email?: string | null;
  telephone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  countryCallingCode?: string | null;
  status?: 0 | 1;
  /**
   * Merged into the `extra` LongText JSON, not replaced.
   *
   * `timezone`, `logoUrl` and `businessHours` have no columns on KiviCare's table and
   * live here. Replacing the blob would drop whichever of them the caller omitted, and
   * would also discard keys KiviCare itself may have written.
   */
  extra?: Record<string, unknown>;
};

const COLUMN_FOR: Record<string, string> = {
  name: 'name',
  email: 'email',
  telephone: 'telephone_no',
  address: 'address',
  city: 'city',
  state: 'state',
  country: 'country',
  postalCode: 'postal_code',
  countryCode: 'country_code',
  countryCallingCode: 'country_calling_code',
  status: 'status',
};

export async function updateClinic(id: bigint, input: UpdateClinicInput): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];

  for (const [key, column] of Object.entries(COLUMN_FOR)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      sets.push(`\`${column}\` = ?`);
      args.push(value);
    }
  }

  if (input.extra !== undefined) {
    const row = await prisma.kcClinic.findUnique({ where: { id }, select: { extra: true } });
    let existing: Record<string, unknown> = {};
    if (row?.extra) {
      try {
        const parsed = JSON.parse(row.extra);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
      } catch {
        // A malformed blob is replaced rather than allowed to block the update; the
        // caller's fields are the ones that matter and the old value was unreadable.
      }
    }
    sets.push('`extra` = ?');
    args.push(JSON.stringify({ ...existing, ...input.extra }));
  }

  if (sets.length === 0) return false;

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE wp_kc_clinics SET ${sets.join(', ')} WHERE id = ?`,
    ...args,
    id,
  );
  return affected > 0;
}

export async function setClinicStatus(ids: bigint[], status: 0 | 1): Promise<number> {
  if (ids.length === 0) return 0;
  return prisma.$executeRawUnsafe(
    `UPDATE wp_kc_clinics SET status = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    status,
    ...ids,
  );
}

/** People attached to a clinic, across all three KiviCare mapping tables. */
export async function listClinicMembers(clinicId: bigint): Promise<
  Array<{ userId: bigint; role: 'doctor' | 'receptionist' | 'patient' }>
> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: bigint | number; role: string }>>(
    `SELECT doctor_id AS user_id, 'doctor' AS role FROM wp_kc_doctor_clinic_mappings WHERE clinic_id = ?
     UNION ALL
     SELECT receptionist_id, 'receptionist' FROM wp_kc_receptionist_clinic_mappings WHERE clinic_id = ?
     UNION ALL
     SELECT patient_id, 'patient' FROM wp_kc_patient_clinic_mappings WHERE clinic_id = ?`,
    clinicId, clinicId, clinicId,
  );
  return rows.map((r) => ({
    userId: BigInt(r.user_id),
    role: r.role as 'doctor' | 'receptionist' | 'patient',
  }));
}
