/**
 * JWT-backed actor resolver for the `sessions/*` API routes.
 *
 * Returns the canonical `Actor` directly. It previously mapped to a `ServiceActor`
 * with `.userId`, because the session service predated the 2026-07 auth migration and
 * used that name. The service now takes the canonical shape, so the adapter is gone
 * rather than kept as a no-op indirection.
 *
 * Throws `AuthError` (401) if the request is unauthenticated.
 */

import { NextRequest } from 'next/server';
import { getActor, type Actor } from '@/lib/auth';

export async function sessionActorFromRequest(req: NextRequest): Promise<Actor> {
  return getActor(req);
}
