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
};

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
