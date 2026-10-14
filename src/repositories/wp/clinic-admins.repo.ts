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
