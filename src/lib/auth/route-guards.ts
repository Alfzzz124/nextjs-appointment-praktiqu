/**
 * Reusable JWT + role guard for API route handlers that keep the
 * `export async function GET(req, ctx)` shape (i.e. not wrapped in `withAuth`).
 *
 * Verifies the Bearer JWT via the canonical `getActor` and checks the actor's
 * role against an allow-list. Returns either the resolved actor or a ready-to
 * -return `NextResponse` (401 if unauthenticated, 403 if role not permitted),
 * both as RFC 7807 problem+json.
 *
 * Usage:
 *   const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
 *   if ('response' in gate) return gate.response;
 *   const { actor } = gate;   // { id, role, practiceId }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActor, AuthError, type Actor } from '@/lib/auth';
import { unauthorized, forbidden, badRequest } from '@/lib/problem-details';

const PROBLEM_HEADERS = { 'Content-Type': 'application/problem+json' } as const;

export type RoleGuardResult = { actor: Actor } | { response: NextResponse };

export async function requireRoles(
  req: NextRequest,
  roles: readonly Actor['role'][],
): Promise<RoleGuardResult> {
  let actor: Actor;
  try {
    actor = await getActor(req);
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        response: NextResponse.json(authProblem(err), {
          status: err.status,
          headers: PROBLEM_HEADERS,
        }),
      };
    }
    throw err;
  }
  if (!roles.includes(actor.role)) {
    return {
      response: NextResponse.json(forbidden('forbidden', 'insufficient role'), {
        status: 403,
        headers: PROBLEM_HEADERS,
      }),
    };
  }
  return { actor };
}

/** Authenticate only (any valid role). Returns the actor or a 401 response. */
export async function requireAuth(req: NextRequest): Promise<RoleGuardResult> {
  return requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST', 'CLIENT']);
}

/**
 * Problem body for an AuthError. 401 stays `unauthorized`. 400/403 come from the
 * X-Praktiqu-Clinic-Id check in getActor(), whose message IS its code, so it becomes the
 * problem `code` the client acts on (the Laravel FE ends the session on it).
 */
function authProblem(err: AuthError) {
  if (err.status === 403) return forbidden(err.message, err.message);
  if (err.status === 400) return badRequest(err.message, err.message);
  return unauthorized('unauthorized', err.message);
}
