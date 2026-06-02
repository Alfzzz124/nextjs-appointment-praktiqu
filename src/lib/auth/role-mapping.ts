/**
 * Role mapping — WordPress role slugs ↔ PraktiQU canonical roles.
 *
 * Source of truth: docs/architecture/role-taxonomy.md
 * WordPress prefix: kiviCare_ (defined in kivicare-clinic-management-system.php:45)
 *
 * The PraktiQU User table stores the CANONICAL role in `role` (UserRole enum)
 * and mirrors the raw WP slug in `wpRole` for cross-system lookups.
 */

import { UserRole } from '@prisma/client';

export const KIVI_CARE_PREFIX = 'kiviCare_';

/** WordPress role slugs (without prefix) as used by KiviCare plugin. */
export type WpRoleSlug =
  | 'administrator'
  | 'kiviCare_clinic_admin'
  | 'kiviCare_doctor'
  | 'kiviCare_receptionist'
  | 'kiviCare_patient';

/** Full slug including prefix (as it appears in wp_users.roles). */
export const WP_ROLES = {
  ADMIN: 'administrator',
  CLINIC_ADMIN: `${KIVI_CARE_PREFIX}clinic_admin`,
  DOCTOR: `${KIVI_CARE_PREFIX}doctor`,
  RECEPTIONIST: `${KIVI_CARE_PREFIX}receptionist`,
  PATIENT: `${KIVI_CARE_PREFIX}patient`,
} as const;

/**
 * Map a WordPress role slug to the PraktiQU canonical role.
 * Returns null if the slug is not recognized.
 *
 * @example
 *   wpRoleToPraktiQU('kiviCare_doctor') === 'PROFESSIONAL'
 *   wpRoleToPraktiQU('administrator') === 'SUPER_ADMIN'
 */
export function wpRoleToPraktiQU(wpRole: string | null | undefined): UserRole | null {
  if (!wpRole) return null;
  // Strip prefix if present (defensive — some WP contexts omit it)
  const clean = wpRole.startsWith(KIVI_CARE_PREFIX)
    ? wpRole.slice(KIVI_CARE_PREFIX.length)
    : wpRole;

  switch (clean) {
    case 'administrator':
      return UserRole.SUPER_ADMIN;
    case 'clinic_admin':
      return UserRole.CLINIC_ADMIN;
    case 'doctor':
      return UserRole.PROFESSIONAL;
    case 'receptionist':
      return UserRole.RECEPTIONIST;
    case 'patient':
      return UserRole.CLIENT;
    default:
      return null;
  }
}

/**
 * Map a PraktiQU canonical role to the WordPress role slug (with prefix).
 * Returns null if the role is unrecognized.
 *
 * @example
 *   praktiQURoleToWp('PROFESSIONAL') === 'kiviCare_doctor'
 */
export function praktiQURoleToWp(role: UserRole): WpRoleSlug | null {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return WP_ROLES.ADMIN;
    case UserRole.CLINIC_ADMIN:
      return WP_ROLES.CLINIC_ADMIN;
    case UserRole.PROFESSIONAL:
      return WP_ROLES.DOCTOR;
    case UserRole.RECEPTIONIST:
      return WP_ROLES.RECEPTIONIST;
    case UserRole.CLIENT:
      return WP_ROLES.PATIENT;
    default:
      return null;
  }
}

/**
 * Extract the role from a list of WordPress role slugs.
 * Used when WP returns the full `wp_user.roles` array (which can contain
 * multiple roles if a user has more than one).
 *
 * Priority: SUPER_ADMIN > CLINIC_ADMIN > PROFESSIONAL > RECEPTIONIST > CLIENT
 * (highest privilege wins).
 */
export function highestPraktiQURole(wpRoles: readonly string[]): UserRole {
  const priority: UserRole[] = [
    UserRole.SUPER_ADMIN,
    UserRole.CLINIC_ADMIN,
    UserRole.PROFESSIONAL,
    UserRole.RECEPTIONIST,
    UserRole.CLIENT,
  ];
  for (const role of priority) {
    const slug = praktiQURoleToWp(role);
    if (slug && wpRoles.includes(slug)) {
      return role;
    }
  }
  return UserRole.CLIENT; // default
}

/**
 * Default role for new self-registered users (client self-signup flow).
 * Maps to the KiviCare `kiviCare_patient` WP role.
 */
export const DEFAULT_REGISTRATION_ROLE = UserRole.CLIENT;
