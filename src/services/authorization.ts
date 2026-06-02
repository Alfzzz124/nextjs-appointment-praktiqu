/**
 * Authorization service — RBAC layer for protected resources.
 *
 * Source of truth: `docs/architecture/role-taxonomy.md`.
 * Per FR-016 the interface is `can(user, action, resource?): boolean`; the
 * default implementation enforces role-based capabilities, but callers can
 * swap in a custom service to layer in per-resource policies without changing
 * the call sites (T004a/T004b).
 */

import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';

/** Anything quacking like a Prisma `User` (we only need role + id). */
export interface UserLike {
  id: string;
  role: UserRole;
  status: number;
}

/** Generic resource passed to `can()` for permission-based extensions. */
export type AuthzResource = unknown;

/** Authorization service contract. Implementations decide if `user` may `action` on `resource`. */
export interface AuthorizationService {
  can(user: UserLike | null, action: string, resource?: AuthzResource): boolean;
}

// ─── Role × Action Matrix (subset covering auth + user + audit) ──────────
// The full matrix is in `docs/architecture/role-taxonomy.md`. The actions
// below are the ones the auth foundation enforces. New actions are added here
// as feature specs land.

type ActionSet = Record<string, ReadonlyArray<UserRole>>;

const AUTH_ACTIONS: ActionSet = {
  // Auth lifecycle
  'auth.login': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.register': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.forgot-password': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.reset-password': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.change-password': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.logout': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'auth.me': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],

  // User management
  'user.create': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  'user.read.own': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'user.read.practice': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST'],
  'user.read.global': ['SUPER_ADMIN'],
  'user.update.own': ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'],
  'user.update.others': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  'user.change-role': ['SUPER_ADMIN'],
  'user.deactivate': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  'user.delete': ['SUPER_ADMIN'],

  // Audit (FR-021)
  'audit.read': ['SUPER_ADMIN'],

  // Settings (a sample of items the matrix calls out)
  'settings.general.read': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  'settings.general.write': ['SUPER_ADMIN'],
  'settings.session.write': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
  'settings.email.write': ['SUPER_ADMIN', 'CLINIC_ADMIN'],
};

const ROLE_ACTIONS: Record<UserRole, Set<string>> = {
  SUPER_ADMIN: new Set(),
  CLINIC_ADMIN: new Set(),
  PROFESSIONAL: new Set(),
  RECEPTIONIST: new Set(),
  CLIENT: new Set(),
};

for (const [action, roles] of Object.entries(AUTH_ACTIONS)) {
  for (const role of roles) {
    ROLE_ACTIONS[role].add(action);
  }
}

/** Check the default role matrix for an action. */
export function roleCan(role: UserRole, action: string): boolean {
  return ROLE_ACTIONS[role].has(action);
}

/**
 * Default RBAC implementation. Permits the action iff the user's role is
 * listed for the action in `AUTH_ACTIONS`. Inactive users are denied
 * everything.
 */
export class RbacAuthorizationService implements AuthorizationService {
  can(user: UserLike | null, action: string, _resource?: AuthzResource): boolean {
    if (!user) return false;
    if (user.status === 0) return false; // inactive
    return roleCan(user.role, action);
  }
}

/** Singleton default service. Swap via `setAuthorizationService` for tests. */
let activeService: AuthorizationService = new RbacAuthorizationService();

export function getAuthorizationService(): AuthorizationService {
  return activeService;
}

export function setAuthorizationService(svc: AuthorizationService): void {
  activeService = svc;
}

export function resetAuthorizationService(): void {
  activeService = new RbacAuthorizationService();
}

/** Convenience wrapper: `can(user, action, resource?)`. */
export function can(user: UserLike | null, action: string, resource?: AuthzResource): boolean {
  return activeService.can(user, action, resource);
}

// Re-export for tests
export { AUTH_ACTIONS, ROLE_ACTIONS };

// Suppress unused-import warning for the Prisma User type when the consumer
// only uses `UserLike`.
export type _PrismaUser = User;
