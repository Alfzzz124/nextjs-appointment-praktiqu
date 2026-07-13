/**
 * Resolve the authenticated caller from a Next.js request.
 *
 * Source of truth: specs/001-auth-foundation/spec.md.
 * Verifies the JWT via the canonical `getActor` (Authorization: Bearer <token>)
 * and maps the canonical `Actor.id` to the service `Caller.userId` shape.
 *
 * (Previously this trusted spoofable `x-praktiqu-user-*` headers — replaced in
 * the 2026-07 auth migration.)
 */

import { NextRequest } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
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
  let actor;
  try {
    actor = await getActor(req);
  } catch (err) {
    if (err instanceof AuthError) {
      throw new InterventionPlanError('forbidden', 'unauthenticated', 401);
    }
    throw err;
  }
  if (!ALLOWED_ROLES.includes(actor.role as Caller['role'])) {
    throw new InterventionPlanError('forbidden', 'invalid role', 403);
  }
  return { userId: actor.id, role: actor.role as Caller['role'] };
}
