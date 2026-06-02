/**
 * Resolve the authenticated caller from a Next.js request.
 *
 * Source of truth: specs/001-auth-foundation/spec.md (NextAuth v5)
 * For now the dashboard auth middleware sets `x-praktiqu-user-id` and
 * `x-praktiqu-user-role` headers; once NextAuth is fully wired in, this
 * function should call `auth()` (server-side) and return the same shape.
 */

import { NextRequest } from 'next/server';
import { InterventionPlanError } from '@/services/intervention-plan/service';
import type { Caller } from '@/services/intervention-plan/service';

const ALLOWED_ROLES: readonly Caller['role'][] = [
  'PROFESSIONAL',
  'CLIENT',
  'RECEPTIONIST',
  'CLINIC_ADMIN',
  'SUPER_ADMIN',
] as const;

export async function callerFromRequest(req: NextRequest): Promise<Caller> {
  const userId = req.headers.get('x-praktiqu-user-id');
  const roleRaw = req.headers.get('x-praktiqu-user-role');
  if (!userId || !roleRaw) {
    throw new InterventionPlanError('forbidden', 'unauthenticated', 401);
  }
  if (!ALLOWED_ROLES.includes(roleRaw as Caller['role'])) {
    throw new InterventionPlanError('forbidden', 'invalid role', 403);
  }
  return { userId, role: roleRaw as Caller['role'] };
}
