/**
 * Clinic admin accounts as WordPress knows them: wp_users rows holding the
 * kiviCare_clinic_admin capability, and the clinics they own (wp_kc_clinics.clinic_admin_id).
 *
 * The capability is matched with LIKE, never unserialize(): live rows exist whose length
 * prefix is wrong, which unserialize() rejects (see roleLikePattern in wp-user.ts).
 */
import { prisma } from '@/lib/db';
import { CAPABILITIES_KEY, HAS_ROLE_SQL, KIVICARE_ROLES, roleLikePattern } from './wp-user';

/** Whether this WordPress user exists and holds the clinic admin capability. */
export async function isClinicAdminUser(wpUserId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM wp_users u WHERE u.ID = ? AND ${HAS_ROLE_SQL}`,
    wpUserId,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.clinicAdmin),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** How many clinics name this user as their admin. */
export async function countOwnedClinics(wpUserId: bigint): Promise<number> {
  return prisma.kcClinic.count({ where: { clinicAdminId: wpUserId } });
}

export interface ClinicAdminRow {
  wpUserId: number;
  name: string;
  email: string;
  /** Clinics naming this user as their admin, by id. */
  clinicIds: number[];
}

/** Every clinic admin account, by name. */
export async function listClinicAdmins(): Promise<ClinicAdminRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ID: bigint; display_name: string | null; user_login: string; user_email: string; clinic_ids: string | null }>
  >(
    `SELECT u.ID, u.display_name, u.user_login, u.user_email,
            (SELECT GROUP_CONCAT(c.id ORDER BY c.id) FROM wp_kc_clinics c WHERE c.clinic_admin_id = u.ID) AS clinic_ids
       FROM wp_users u
      WHERE ${HAS_ROLE_SQL}
      ORDER BY COALESCE(NULLIF(TRIM(u.display_name), ''), u.user_login), u.ID`,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.clinicAdmin),
  );
  return rows.map((r) => ({
    wpUserId: Number(r.ID),
    name: (r.display_name ?? '').trim() || r.user_login,
    email: r.user_email,
    clinicIds: r.clinic_ids ? r.clinic_ids.split(',').map(Number) : [],
  }));
}

/** Whether any WordPress account already uses this email (case ignored). */
export async function wpUserEmailExists(email: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM wp_users WHERE LOWER(user_email) = LOWER(?)`,
    email.trim(),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
