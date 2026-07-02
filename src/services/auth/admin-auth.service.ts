/**
 * Admin-facing auth operations: admin user registration, password change (WP-backed),
 * and soft-delete (status = 0).
 *
 * Note: The User model has NO password column — WordPress owns credentials.
 * - registerAdminUser: creates a User record for admin-provisioned staff/patients.
 *   The WP account must be created separately; wpUserId can be linked later.
 * - changeUserPassword: delegates to WP via the existing changePassword service function.
 * - softDeleteUser: sets User.status = 0 (inactive).
 */

import { UserRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AuthError } from '@/services/auth/service';

// ─── Register (admin-provisioned user) ───────────────────────────────────

export interface AdminRegisterInput {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface AdminRegisterResult {
  id: string;
  email: string;
  role: UserRole;
}

export async function registerAdminUser(input: AdminRegisterInput): Promise<AdminRegisterResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError('duplicate_email', 409, 'Email already registered');

  // Derive a unique username from email (prefix before @)
  const base = email.split('@')[0]!.replace(/[^a-z0-9_-]/gi, '_');
  const ts = Date.now();
  const username = `${base}_${ts}`;

  const displayName = `${input.firstName} ${input.lastName}`.trim() || email;

  const user = await prisma.user.create({
    data: {
      email,
      username,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName,
      role: input.role,
      status: 1,
    },
    select: { id: true, email: true, role: true },
  });

  return user;
}

// ─── Soft-delete user ─────────────────────────────────────────────────────

export async function softDeleteUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError('not_found', 404, 'User not found');

  await prisma.user.update({
    where: { id: userId },
    data: { status: 0 },
  });
}
