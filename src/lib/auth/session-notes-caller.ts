/**
 * Resolve the authenticated caller for session-notes API routes.
 *
 * Pattern mirrors `callerFromRequest` in src/lib/auth/caller.ts. The
 * dashboard auth middleware / test harness sets `x-praktiqu-user-id`
 * and `x-praktiqu-user-role`; once NextAuth is fully wired in this
 * helper should call `auth()` and return the same shape.
 */

import { NextRequest } from 'next/server';
import { SessionNoteAccessError, type SessionNoteActor } from '@/services/session-notes/service';

const ALLOWED_ROLES: readonly SessionNoteActor['role'][] = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'PROFESSIONAL',
  'RECEPTIONIST',
  'CLIENT',
] as const;

export function callerFromHeaders(req: NextRequest): SessionNoteActor & { clinicId: string | null } {
  const userId = req.headers.get('x-praktiqu-user-id');
  const roleRaw = req.headers.get('x-praktiqu-user-role');
  if (!userId || !roleRaw) {
    throw new SessionNoteAccessError('unauthenticated', 401);
  }
  if (!ALLOWED_ROLES.includes(roleRaw as SessionNoteActor['role'])) {
    throw new SessionNoteAccessError('invalid role', 403);
  }
  return {
    userId,
    role: roleRaw as SessionNoteActor['role'],
    ip: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
    requestId: req.headers.get('x-request-id') ?? null,
    clinicId: req.headers.get('x-praktiqu-clinic-id') ?? null,
  };
}
