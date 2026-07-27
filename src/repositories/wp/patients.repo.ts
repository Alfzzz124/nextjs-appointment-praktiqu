/**
 * Patient reads, straight from WordPress.
 *
 * A patient is not a row in a `clients` table — it is a `wp_users` row carrying the
 * `kiviCare_patient` capability, with its profile spread across `wp_usermeta`. This
 * module mirrors how KiviCare itself reads them:
 *   - role filter:  PatientController via KCWPUser.php:135-136
 *   - meta joins:   PatientController.php:1083-1121
 *   - basic_data:   KCPatient.php:128-145 (a JSON blob, not columns)
 *
 * Reads go direct to SQL, matching the 15 `billing/*` services. Writes do NOT live
 * here — they go through the praktiqu-endpoint plugin's REST layer so KiviCare's
 * hooks (notifications, calendar sync, telemed) still fire. See
 * docs/architecture/shadow-tables-audit.md §6 D1.
 */
import { prisma } from '@/lib/db';

/** WordPress role slug. KIVI_CARE_PREFIX . 'patient' on the PHP side. */
export const PATIENT_ROLE = 'kiviCare_patient';

/**
 * WordPress table prefix. The capability meta key is `<prefix>capabilities`, so a
 * multisite or renamed-prefix install would use a different key.
 */
const WP_PREFIX = process.env.WP_TABLE_PREFIX ?? 'wp_';
const CAPABILITIES_KEY = `${WP_PREFIX}capabilities`;

/** Meta keys we lift out of `wp_usermeta` for a patient record. */
const META_KEYS = ['first_name', 'last_name', 'basic_data', 'patient_unique_id', 'timezone'] as const;

export type WpPatient = {
  id: bigint;
  email: string;
  displayName: string;
  registeredAt: Date;
  firstName: string | null;
  lastName: string | null;
  patientUniqueId: string | null;
  timezone: string | null;
  // Fields unpacked from the `basic_data` JSON blob.
  mobileNumber: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  bloodGroup: string | null;
};

export type ListPatientsQuery = {
  page: number;
  perPage: number;
  search?: string;
};

export type PaginatedPatients = {
  items: WpPatient[];
  total: number;
  page: number;
  perPage: number;
};

type RawRow = {
  ID: bigint | number;
  user_email: string;
  display_name: string;
  user_registered: Date;
  first_name: string | null;
  last_name: string | null;
  basic_data: string | null;
  patient_unique_id: string | null;
  timezone: string | null;
};

/**
 * KiviCare stores capabilities as a serialised PHP array, e.g.
 *   a:1:{s:17:"kiviCare_patient";b:1;}
 * so the role must be matched with its surrounding quotes. Without them,
 * `kiviCare_patient` would also match a hypothetical `kiviCare_patient_admin`.
 */
const ROLE_LIKE = `%"${PATIENT_ROLE}"%`;

/** LEFT JOIN one aliased wp_usermeta row per meta key. */
function metaJoins(): string {
  return META_KEYS.map(
    (key) =>
      `LEFT JOIN wp_usermeta AS m_${key} ON m_${key}.user_id = u.ID AND m_${key}.meta_key = '${key}'`,
  ).join('\n       ');
}

function metaSelects(): string {
  return META_KEYS.map((key) => `m_${key}.meta_value AS ${key}`).join(',\n              ');
}

/**
 * `basic_data` is written by KCPatient::save as JSON. It can be absent, empty, or
 * malformed on rows touched outside KiviCare — never let that fail a read.
 */
function decodeBasicData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toPatient(row: RawRow): WpPatient {
  const basic = decodeBasicData(row.basic_data);
  return {
    id: BigInt(row.ID),
    email: row.user_email,
    displayName: row.display_name,
    registeredAt: row.user_registered,
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    patientUniqueId: str(row.patient_unique_id),
    timezone: str(row.timezone),
    mobileNumber: str(basic.mobile_number),
    gender: str(basic.gender),
    dateOfBirth: str(basic.dob),
    address: str(basic.address),
    city: str(basic.city),
    country: str(basic.country),
    postalCode: str(basic.postal_code),
    bloodGroup: str(basic.blood_group),
  };
}

/** The capability check, as an EXISTS subquery. */
const HAS_PATIENT_ROLE = `
  EXISTS (
    SELECT 1 FROM wp_usermeta cap
    WHERE cap.user_id = u.ID
      AND cap.meta_key = ?
      AND cap.meta_value LIKE ?
  )`;

export async function findPatientById(id: bigint): Promise<WpPatient | null> {
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT u.ID, u.user_email, u.display_name, u.user_registered,
            ${metaSelects()}
       FROM wp_users AS u
       ${metaJoins()}
      WHERE u.ID = ? AND ${HAS_PATIENT_ROLE}
      LIMIT 1`,
    id,
    CAPABILITIES_KEY,
    ROLE_LIKE,
  );

  return rows.length > 0 ? toPatient(rows[0]) : null;
}

export async function listPatients(query: ListPatientsQuery): Promise<PaginatedPatients> {
  const page = Math.max(1, Math.trunc(query.page));
  const perPage = Math.min(100, Math.max(1, Math.trunc(query.perPage)));
  const offset = (page - 1) * perPage;

  const where: string[] = [HAS_PATIENT_ROLE];
  const args: unknown[] = [CAPABILITIES_KEY, ROLE_LIKE];

  const search = query.search?.trim();
  if (search) {
    // Escape LIKE wildcards so a search for "100%" doesn't match everything.
    const term = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      `(u.user_email LIKE ? OR u.display_name LIKE ? OR m_first_name.meta_value LIKE ? OR m_last_name.meta_value LIKE ?)`,
    );
    args.push(term, term, term, term);
  }

  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(DISTINCT u.ID) AS n
       FROM wp_users AS u
       ${metaJoins()}
      WHERE ${whereSql}`,
    ...args,
  );

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT u.ID, u.user_email, u.display_name, u.user_registered,
            ${metaSelects()}
       FROM wp_users AS u
       ${metaJoins()}
      WHERE ${whereSql}
      ORDER BY u.ID ASC
      LIMIT ? OFFSET ?`,
    ...args,
    perPage,
    offset,
  );

  return {
    items: rows.map(toPatient),
    total: Number(countRows[0]?.n ?? 0),
    page,
    perPage,
  };
}
