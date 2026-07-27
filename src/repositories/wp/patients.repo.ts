/**
 * Patient reads, straight from WordPress.
 *
 * A patient is not a row in a `clients` table — it is a `wp_users` row carrying the
 * `kiviCare_patient` capability, with its profile spread across `wp_usermeta`. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * Mirrors KiviCare: PatientController.php:1083-1121 (meta joins) and
 * KCPatient.php:128-145 (basic_data shape).
 *
 * Reads go direct to SQL, consistent with the 15 `billing/*` services. Writes do NOT
 * live here — they go through the praktiqu-endpoint plugin's REST layer so KiviCare's
 * hooks (notifications, calendar sync, telemed) still fire. See audit doc §6 D1.
 */
import { prisma } from '@/lib/db';
import {
  BaseUserRow,
  CAPABILITIES_KEY,
  HAS_ROLE_SQL,
  KIVICARE_ROLES,
  USER_COLUMNS,
  decodeBasicData,
  likeTerm,
  metaJoins,
  metaSelects,
  paginate,
  roleLikePattern,
  str,
} from './wp-user';

/** Re-exported for callers that only deal in patients. */
export const PATIENT_ROLE = KIVICARE_ROLES.patient;

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
  // From `basic_data`.
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
  /**
   * Restrict to patients mapped to at least one of these clinics.
   *
   * This is the WordPress equivalent of the old `Client.practiceId` scoping, and it
   * is an access-control boundary — an empty array means "no clinics", which must
   * return nothing rather than everything.
   */
  clinicIds?: bigint[];
};

export type PaginatedPatients = {
  items: WpPatient[];
  total: number;
  page: number;
  perPage: number;
};

type RawRow = BaseUserRow & {
  first_name: string | null;
  last_name: string | null;
  basic_data: string | null;
  patient_unique_id: string | null;
  timezone: string | null;
};

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

const ROLE_ARGS = [CAPABILITIES_KEY, roleLikePattern(KIVICARE_ROLES.patient)] as const;

export async function findPatientById(id: bigint): Promise<WpPatient | null> {
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT ${USER_COLUMNS},
            ${metaSelects(META_KEYS)}
       FROM wp_users AS u
       ${metaJoins(META_KEYS)}
      WHERE u.ID = ? AND ${HAS_ROLE_SQL}
      LIMIT 1`,
    id,
    ...ROLE_ARGS,
  );

  return rows.length > 0 ? toPatient(rows[0]) : null;
}

export async function listPatients(query: ListPatientsQuery): Promise<PaginatedPatients> {
  const { page, perPage, offset } = paginate(query.page, query.perPage);

  const where: string[] = [HAS_ROLE_SQL];
  const args: unknown[] = [...ROLE_ARGS];

  const search = query.search?.trim();
  if (search) {
    const term = likeTerm(search);
    where.push(
      `(u.user_email LIKE ? OR u.display_name LIKE ? OR m_first_name.meta_value LIKE ? OR m_last_name.meta_value LIKE ?)`,
    );
    args.push(term, term, term, term);
  }

  if (query.clinicIds !== undefined) {
    if (query.clinicIds.length === 0) {
      // "Scoped to no clinics" must yield nothing. Omitting the clause here would
      // silently widen an access-control filter to every patient in the install.
      where.push('1 = 0');
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM wp_kc_patient_clinic_mappings pcm
        WHERE pcm.patient_id = u.ID
          AND pcm.clinic_id IN (${query.clinicIds.map(() => '?').join(',')})
      )`);
      args.push(...query.clinicIds);
    }
  }

  const whereSql = where.join(' AND ');

  const countRows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(DISTINCT u.ID) AS n
       FROM wp_users AS u
       ${metaJoins(META_KEYS)}
      WHERE ${whereSql}`,
    ...args,
  );

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT ${USER_COLUMNS},
            ${metaSelects(META_KEYS)}
       FROM wp_users AS u
       ${metaJoins(META_KEYS)}
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
