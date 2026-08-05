/**
 * Resolve the authenticated caller for session-notes API routes.
 *
 * Verifies the JWT via the canonical `getActor` (Authorization: Bearer <token>)
 * and maps it to the `SessionNoteActor` shape. `clinicId` is derived from the
 * actor's `practiceId` claim.
 *
 * (Previously this trusted spoofable `x-praktiqu-user-*` headers — replaced in
 * the 2026-07 auth migration. Now async because JWT verification is async.)
 */

import { NextRequest } from 'next/server';
import { getActor, AuthError } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { SessionNoteAccessError, type SessionNoteActor } from '@/services/session-notes/service';

const ALLOWED_ROLES: readonly SessionNoteActor['role'][] = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'PROFESSIONAL',
  'RECEPTIONIST',
  'CLIENT',
] as const;

export async function callerFromHeaders(
  req: NextRequest,
): Promise<SessionNoteActor & { clinicId: number | null }> {
  let actor;
  try {
    actor = await getActor(req);
  } catch (err) {
    if (err instanceof AuthError) {
      throw new SessionNoteAccessError('unauthenticated', 401);
    }
    throw err;
  }
  if (!ALLOWED_ROLES.includes(actor.role as SessionNoteActor['role'])) {
    throw new SessionNoteAccessError('invalid role', 403);
  }

  // Notes are authored by a KiviCare doctor id, so the caller needs their wp_users.ID
  // as well as their auth id. The clinic comes from the same resolver rather than the
  // `practiceId` claim, which was a cuid from the old `practices` table.
  let kc;
  try {
    kc = await resolveKcActor(actor);
  } catch {
    throw new SessionNoteAccessError('User is not linked to a WordPress account', 403);
  }

  return {
    userId: actor.id,
    wpUserId: Number(kc.wpUserId),
    role: actor.role as SessionNoteActor['role'],
    ip: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
    requestId: req.headers.get('x-request-id') ?? null,
    clinicId: kc.clinicId === null ? null : Number(kc.clinicId),
  };
}
