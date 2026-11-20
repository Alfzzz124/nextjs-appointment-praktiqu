/**
 * Who may touch which consent form.
 *
 * `ConsentForm.practiceId` is a KiviCare clinic id as text, so the actor's clinic comes
 * from `resolveKcActor` (which honours a CLINIC_ADMIN's active clinic) — the same rule
 * POST /consent-forms already applies. `ConsentSignature.clientId` is the app `User.id`,
 * which for a CLIENT is simply `actor.id`; no WordPress lookup is involved.
 */
import { NextResponse } from 'next/server';
import type { Actor } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import { KcError } from '@/lib/kc-response';
import { resolveKcActor } from '@/services/billing/kc-actor';

export type ConsentScope =
  | { kind: 'all' }
  | { kind: 'clinic'; clinicId: string }
  // A CLIENT, or staff with no clinic: matches no form.
  | { kind: 'none' };

export const CONSENT_STAFF_ROLES: readonly Actor['role'][] = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'RECEPTIONIST',
  'PROFESSIONAL',
];

export async function consentScopeFor(actor: Actor): Promise<ConsentScope> {
  if (actor.role === 'SUPER_ADMIN') return { kind: 'all' };
  if (actor.role === 'CLIENT') return { kind: 'none' };
  const kc = await resolveKcActor(actor);
  return kc.clinicId === null ? { kind: 'none' } : { kind: 'clinic', clinicId: String(kc.clinicId) };
}

export function formInScope(scope: ConsentScope, practiceId: string): boolean {
  return scope.kind === 'all' || (scope.kind === 'clinic' && scope.clinicId === practiceId);
}

/** Only admins read the signatures (client names, signature, IP) of a form. */
export function canReadSignatures(actor: Actor): boolean {
  return actor.role === 'SUPER_ADMIN' || actor.role === 'CLINIC_ADMIN';
}

export function notFoundResponse(): NextResponse {
  return NextResponse.json({ type: 'about:blank', title: 'Not Found', status: 404 }, { status: 404 });
}

export function forbiddenResponse(detail?: string): NextResponse {
  return NextResponse.json(forbidden('forbidden', detail), { status: 403 });
}

/** resolveKcActor refuses an account not linked to WordPress; surface that as its status. */
export function kcErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof KcError) {
    return NextResponse.json({ type: 'about:blank', title: err.message, status: err.httpStatus }, { status: err.httpStatus });
  }
  return null;
}
