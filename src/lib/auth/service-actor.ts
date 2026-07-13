/**
 * Adapter between the canonical `Actor` (from `withAuth`/`getActor`, which uses
 * `.id`) and the service-layer actor shape (which uses `.userId`).
 *
 * Introduced by the 2026-07 auth migration so that routes moving onto canonical
 * JWT auth can feed the existing session / intervention-plan / session-notes
 * services without renaming `Actor.id` across the ~85 already-canonical routes.
 */

import type { Actor } from '@/lib/auth';

export interface ServiceActor {
  userId: string;
  role: Actor['role'];
  practiceId: string | null;
}

/** Map a canonical `Actor` ({ id, role, practiceId }) to the service shape ({ userId, ... }). */
export function toServiceActor(actor: Actor): ServiceActor {
  return { userId: actor.id, role: actor.role, practiceId: actor.practiceId };
}
