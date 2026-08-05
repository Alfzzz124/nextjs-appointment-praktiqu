/**
 * Doctor reads, straight from WordPress.
 *
 * What our shadow schema called a "professional" is a `wp_users` row carrying the
 * `kiviCare_doctor` capability. There is no `professionals` or `doctors` table to
 * consult — see docs/architecture/shadow-tables-audit.md.
 *
 * Mirrors KiviCare: DoctorController.php:1079-1106 (meta joins) and
 * KCDoctor.php:139-151 (basic_data shape).
 *
 * Reads only. Writes go through the praktiqu-endpoint plugin's REST layer (D1).
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
  strArray,
} from './wp-user';

/**
 * Professional attributes PraktiQU tracks that KiviCare has no field for.
 *
 * Kept under our own prefix for the same reason as the client status meta: KiviCare's
 * own columns carry meanings we must not reinterpret. `wp_users.user_status` in
 * particular is self-contradictory in KiviCare's code — see
 * docs/architecture/client-service-migration.md §3.
 */
export const PROFESSIONAL_TYPE_META_KEY = 'praktiqu_professional_type';
export const REGISTRATION_NUMBER_META_KEY = 'praktiqu_registration_number';
export const PROFESSIONAL_STATUS_META_KEY = 'praktiqu_professional_status';

/** Praktiqu-specific professional classification. */
export const PROFESSIONAL_TYPE = {
  PSIKOLOG_KLINIS: 'PSIKOLOG_KLINIS',
  PSIKOLOG_ANAK: 'PSIKOLOG_ANAK',
  PSIKIATER: 'PSIKIATER',
  KONSELOR: 'KONSELOR',
} as const;

export type ProfessionalType = (typeof PROFESSIONAL_TYPE)[keyof typeof PROFESSIONAL_TYPE];

export const PROFESSIONAL_STATUS = {
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type ProfessionalStatus = (typeof PROFESSIONAL_STATUS)[keyof typeof PROFESSIONAL_STATUS];

/**
 * Meta keys lifted for a doctor. `doctor_signature` and `doctor_profile_image` are
 * deliberately excluded — the signature is sensitive and the image is an attachment
 * ID needing a separate `wp_posts` lookup. Add them behind explicit callers.
 */
const META_KEYS = [
  'first_name',
  'last_name',
  'basic_data',
  'doctor_description',
  'timezone',
  PROFESSIONAL_TYPE_META_KEY,
  REGISTRATION_NUMBER_META_KEY,
  PROFESSIONAL_STATUS_META_KEY,
] as const;

export type WpDoctor = {
  id: bigint;
  email: string;
  displayName: string;
  registeredAt: Date;
  firstName: string | null;
  lastName: string | null;
  description: string | null;
  timezone: string | null;
  /** PraktiQU classification; null for doctors created directly in KiviCare. */
  professionalType: ProfessionalType | null;
  registrationNumber: string | null;
  /**
   * Absent meta reads as ACTIVE. A doctor created in KiviCare's own UI has no status
   * meta and must not be hidden as pending or inactive.
   */
  status: ProfessionalStatus;
  // From `basic_data`.
  mobileNumber: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
  qualifications: string[];
  specialties: string[];
  yearsOfExperience: string | null;
};

export type ListDoctorsQuery = {
  page: number;
  perPage: number;
  search?: string;
  /**
   * Restrict to doctors mapped to one of these clinics. An access-control boundary —
   * an empty array means "no clinics" and must return nothing, never everything.
   */
  clinicIds?: bigint[];
  /** Including ACTIVE also matches doctors with no status meta (KiviCare-created). */
  statuses?: readonly ProfessionalStatus[];
  professionalTypes?: readonly ProfessionalType[];
  /**
   * Narrow to doctors listing this specialty.
   *
   * Specialties live inside the `basic_data` JSON blob, which has no index and no
   * per-value column, so this can only be a LIKE over the whole blob — it may
   * over-match another field holding the same word. Callers that need an exact answer
   * should re-filter the page against the decoded `specialties` array.
   */
  specialty?: string;
};

export type PaginatedDoctors = {
  items: WpDoctor[];
  total: number;
  page: number;
  perPage: number;
};

type RawRow = BaseUserRow & {
  first_name: string | null;
  last_name: string | null;
  basic_data: string | null;
  doctor_description: string | null;
  timezone: string | null;
  praktiqu_professional_type: string | null;
  praktiqu_registration_number: string | null;
  praktiqu_professional_status: string | null;
};

function toProfessionalType(raw: string | null): ProfessionalType | null {
  const v = str(raw);
  return v && v in PROFESSIONAL_TYPE ? (v as ProfessionalType) : null;
}

function toProfessionalStatus(raw: string | null): ProfessionalStatus {
  const v = str(raw);
  return v === PROFESSIONAL_STATUS.PENDING_ACTIVATION || v === PROFESSIONAL_STATUS.INACTIVE
    ? v
    : PROFESSIONAL_STATUS.ACTIVE;
}

function toDoctor(row: RawRow): WpDoctor {
  const basic = decodeBasicData(row.basic_data);

  // NOTE: basic_data also carries `temp_password` — a plaintext password KiviCare
  // keeps for the welcome email (KCDoctor.php:150). Fields are mapped explicitly
  // rather than spread, so it cannot leak into a response.
  return {
    id: BigInt(row.ID),
    email: row.user_email,
    displayName: row.display_name,
    registeredAt: row.user_registered,
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    description: str(row.doctor_description),
    timezone: str(row.timezone),
    professionalType: toProfessionalType(row.praktiqu_professional_type),
    registrationNumber: str(row.praktiqu_registration_number),
    status: toProfessionalStatus(row.praktiqu_professional_status),
    mobileNumber: str(basic.mobile_number),
    gender: str(basic.gender),
    dateOfBirth: str(basic.dob),
    address: str(basic.address),
    city: str(basic.city),
    country: str(basic.country),
    postalCode: str(basic.postal_code),
    // KiviCare writes `''` rather than `[]` when these are unset.
    qualifications: strArray(basic.qualifications),
    specialties: strArray(basic.specialties),
    yearsOfExperience: str(basic.no_of_experience),
  };
}

const ROLE_ARGS = [CAPABILITIES_KEY, roleLikePattern(KIVICARE_ROLES.doctor)] as const;

export async function findDoctorById(id: bigint): Promise<WpDoctor | null> {
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

  return rows.length > 0 ? toDoctor(rows[0]) : null;
}

export async function listDoctors(query: ListDoctorsQuery): Promise<PaginatedDoctors> {
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
      where.push('1 = 0');
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM wp_kc_doctor_clinic_mappings dcm
        WHERE dcm.doctor_id = u.ID
          AND dcm.clinic_id IN (${query.clinicIds.map(() => '?').join(',')})
      )`);
      args.push(...query.clinicIds);
    }
  }

  if (query.statuses !== undefined) {
    if (query.statuses.length === 0) {
      where.push('1 = 0');
    } else {
      const ph = query.statuses.map(() => '?').join(',');
      // Absent meta reads as ACTIVE, so an ACTIVE filter must also match NULL —
      // otherwise every KiviCare-created doctor disappears from the list.
      const nullIsActive = query.statuses.includes(PROFESSIONAL_STATUS.ACTIVE)
        ? `OR m_${PROFESSIONAL_STATUS_META_KEY}.meta_value IS NULL OR m_${PROFESSIONAL_STATUS_META_KEY}.meta_value = ''`
        : '';
      where.push(`(m_${PROFESSIONAL_STATUS_META_KEY}.meta_value IN (${ph}) ${nullIsActive})`);
      args.push(...query.statuses);
    }
  }

  if (query.professionalTypes !== undefined) {
    if (query.professionalTypes.length === 0) {
      where.push('1 = 0');
    } else {
      const ph = query.professionalTypes.map(() => '?').join(',');
      where.push(`m_${PROFESSIONAL_TYPE_META_KEY}.meta_value IN (${ph})`);
      args.push(...query.professionalTypes);
    }
  }

  const specialty = query.specialty?.trim();
  if (specialty) {
    where.push('m_basic_data.meta_value LIKE ?');
    args.push(likeTerm(specialty));
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
    items: rows.map(toDoctor),
    total: Number(countRows[0]?.n ?? 0),
    page,
    perPage,
  };
}

/**
 * Look up a doctor by registration number.
 *
 * Registration numbers must be unique, but `wp_usermeta` cannot enforce that — the
 * table has no unique index on (meta_key, meta_value). Uniqueness is therefore a
 * check-then-write, which is racy under concurrency; the plugin re-checks on write so
 * the window stays small. Returns the lowest id if duplicates somehow exist, so the
 * result is at least deterministic.
 */
export async function findDoctorByRegistrationNumber(
  registrationNumber: string,
): Promise<WpDoctor | null> {
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT ${USER_COLUMNS},
            ${metaSelects(META_KEYS)}
       FROM wp_users AS u
       ${metaJoins(META_KEYS)}
      WHERE m_${REGISTRATION_NUMBER_META_KEY}.meta_value = ? AND ${HAS_ROLE_SQL}
      ORDER BY u.ID ASC
      LIMIT 1`,
    registrationNumber,
    ...ROLE_ARGS,
  );

  return rows.length > 0 ? toDoctor(rows[0]) : null;
}
