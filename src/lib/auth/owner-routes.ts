/**
 * Owner mode: which routes a psychologist who owns the clinic they picked with
 * X-Praktiqu-Clinic-Id may use AS that clinic's admin.
 *
 * getActor() swaps the actor for `asClinicManager(...)` on these routes only, so the
 * existing CLINIC_ADMIN scoping applies unchanged — services, schedules, appointments,
 * clients, billing reads, dashboard figures, all pinned to the owned clinic. Every route
 * NOT listed keeps a plain PROFESSIONAL actor; that is what keeps other psychologists'
 * clinical records (encounters, notes, results, medical history, reports) closed, and
 * what keeps a route added later closed until someone decides otherwise.
 *
 * Patterns are anchored and ids are numeric, so `/sessions/77/notes` can never ride on
 * the `/sessions/77` entry. Spec: docs/superpowers/specs/2026-10-16-psikolog-pemilik-klinik-design.md §3.
 */
import type { Actor } from '@/lib/auth';

const ID = '[1-9][0-9]*';
const SCHEDULES = '(?:professional|doctor)-sessions';

type Rule = { path: RegExp; methods: readonly string[] };

const rule = (path: string, methods: readonly string[]): Rule => ({ path: new RegExp(`^${path}$`), methods });

export const OWNER_ROUTES: readonly Rule[] = [
  // Services offered at the clinic
  rule('/api/v1/services', ['GET', 'POST']),
  rule(`/api/v1/services/${ID}`, ['GET', 'PUT', 'DELETE']),

  // Practice schedules of every psychologist at the clinic
  rule(`/api/v1/${SCHEDULES}`, ['GET', 'POST']),
  rule(`/api/v1/${SCHEDULES}/${ID}`, ['GET', 'PUT', 'DELETE']),
  rule(`/api/v1/${SCHEDULES}/week`, ['GET', 'PUT', 'DELETE']),
  rule(`/api/v1/${SCHEDULES}/(?:grouped|module|export)`, ['GET']),
  rule(`/api/v1/${SCHEDULES}/bulk/delete`, ['POST']),

  // Appointments (not their notes, summaries, attachments or custom fields)
  rule('/api/v1/sessions', ['GET']),
  rule('/api/v1/sessions/(?:calendar|pending|export)', ['GET']),
  rule('/api/v1/sessions/bulk/delete', ['POST']),
  rule(`/api/v1/sessions/${ID}`, ['GET']),
  rule(`/api/v1/sessions/${ID}/(?:approve|reject|cancel|check-in|check-out)`, ['POST']),

  // Clients: identity and contact only
  rule('/api/v1/clients', ['GET', 'POST']),
  rule('/api/v1/clients/export', ['GET']),
  rule('/api/v1/clients/bulk/(?:delete|status)', ['POST']),
  rule(`/api/v1/clients/${ID}`, ['GET', 'PATCH', 'DELETE']),
  rule(`/api/v1/clients/${ID}/status`, ['PATCH']),

  // Billing and report figures (read)
  rule('/api/v1/bills', ['GET']),
  rule('/api/v1/bills/export', ['GET']),
  rule(`/api/v1/bills/${ID}`, ['GET']),
  rule('/api/v1/dashboard/(?:statistics|revenue-chart|recent-payments|upcoming-sessions|top-professionals)', ['GET']),
];

export function isOwnerRoute(method: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const verb = method.toUpperCase();
  return OWNER_ROUTES.some((r) => r.methods.includes(verb) && r.path.test(path));
}

/** The actor as admin of the clinic they own, for one allowlisted request. */
export function asClinicManager(actor: Actor, clinicId: bigint): Actor {
  return { ...actor, role: 'CLINIC_ADMIN', activeClinicId: clinicId, ownerClinicId: clinicId };
}
