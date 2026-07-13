/**
 * JWT-backed actor resolver for the `sessions/*` API routes.
 *
 * Returns the service-layer shape ({ userId, role, practiceId }) expected by
 * `session.service`, verifying the Bearer JWT via the canonical `getActor`.
 * Throws `AuthError` (401) if the request is unauthenticated.
 *
 * Replaces the per-route `x-user-*` header placeholders removed in the 2026-07
 * auth migration.
 */

import { NextRequest } from 'next/server';
import { getActor } from '@/lib/auth';
import { toServiceActor, type ServiceActor } from '@/lib/auth/service-actor';

export async function sessionActorFromRequest(req: NextRequest): Promise<ServiceActor> {
  return toServiceActor(await getActor(req));
}
