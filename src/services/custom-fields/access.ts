/**
 * Who may read or write the custom-field values of an entity.
 *
 * A value hangs off a client, an appointment or an encounter, so the question is the same
 * as "may this actor open that entity" — answered by the guard each entity's own route
 * already uses, never by a second rule here:
 *
 * - client       -> assertClientAccess (GET /clients/{id})
 * - appointment  -> loadForActor       (GET /sessions/{id})
 * - session_note -> getEncounter + encounterScopeFor (GET /encounters/{id}); a session
 *                   note is a KiviCare encounter
 *
 * Writing is staff-only on top of that. A type none of these can guard is refused for
 * everyone but SUPER_ADMIN, so a new module type fails closed.
 */
import { NextResponse } from 'next/server';
import type { Actor } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { KcError } from '@/lib/kc-response';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { getEncounter, encounterScopeFor } from '@/services/billing/encounter.service';
import { assertClientAccess, ClientServiceError } from '@/services/client/client.service';
import { loadForActor, SessionServiceError } from '@/services/session/session.service';
import type { ModuleType } from './service';

export class CustomFieldAccessError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'CustomFieldAccessError';
  }
}

const WRITE_ROLES: readonly Actor['role'][] = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'];

export async function assertEntityAccess(
  actor: Actor,
  entityType: ModuleType,
  entityId: number,
  mode: 'read' | 'write',
): Promise<void> {
  if (mode === 'write' && !WRITE_ROLES.includes(actor.role)) {
    throw new CustomFieldAccessError('Forbidden: only staff may change custom field values', 403);
  }
  if (actor.role === 'SUPER_ADMIN') return;

  switch (entityType) {
    case 'client':
      return assertClientAccess(actor, entityId);
    case 'appointment':
      await loadForActor(await resolveKcActor(actor), entityId);
      return;
    case 'session_note': {
      const kc = await resolveKcActor(actor);
      await getEncounter(entityId, encounterScopeFor(kc));
      return;
    }
    default:
      throw new CustomFieldAccessError('Forbidden', 403);
  }
}

/** The problem response for a refusal from assertEntityAccess; null for any other error. */
export function entityAccessProblem(err: unknown): NextResponse | null {
  let status: number | null = null;
  let title = '';
  let code: string | undefined;
  if (err instanceof CustomFieldAccessError) {
    status = err.status;
    title = err.message;
  } else if (err instanceof ClientServiceError || err instanceof SessionServiceError) {
    status = err.status;
    title = err.message;
    code = err.code;
  } else if (err instanceof KcError) {
    status = err.httpStatus;
    title = err.message;
  }
  if (status === null) return null;
  if (status === 403 && code === undefined) {
    return NextResponse.json(forbidden('forbidden', title), { status });
  }
  return NextResponse.json({ type: 'about:blank', title, status, ...(code ? { code } : {}) }, { status });
}
