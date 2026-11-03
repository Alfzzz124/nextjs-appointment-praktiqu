/**
 * X-Praktiqu-Clinic-Id — which clinic the caller is acting in for this request.
 *
 * - CLINIC_ADMIN: one of their own clinics (wp_kc_clinics.clinic_admin_id). The Laravel FE
 *   keeps one "active" and sends it on every call.
 * - PROFESSIONAL: a clinic they OWN (src/services/clinic-owner). This is owner mode; see
 *   src/lib/auth/owner-routes.ts for what it opens. Absent = their ordinary view.
 *
 * getActor() checks it here, so every route sees one validated clinic per request and no
 * route has to know about the header. Every other role ignores it without an error.
 */
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { listAdminClinicIds } from '@/services/billing/kc-actor';
import { isClinicOwner } from '@/services/clinic-owner/service';

/** Lower-case, as `Headers.get()` is case-insensitive anyway. */
export const ACTIVE_CLINIC_HEADER = 'x-praktiqu-clinic-id';

const CLINIC_ID = /^[1-9][0-9]{0,18}$/;

export type ActiveClinicResult =
  | { ok: true; clinicId: bigint | undefined; ownerClinicId?: bigint }
  | { ok: false; status: 400; code: 'invalid_clinic_header' }
  | { ok: false; status: 403; code: 'clinic_not_in_scope' };

export async function resolveActiveClinic(
  actorId: string,
  role: Actor['role'],
  raw: string | null,
): Promise<ActiveClinicResult> {
  if (role !== 'CLINIC_ADMIN' && role !== 'PROFESSIONAL') return { ok: true, clinicId: undefined };

  const value = raw?.trim() ?? '';
  if (value === '') return { ok: true, clinicId: undefined };
  if (!CLINIC_ID.test(value)) return { ok: false, status: 400, code: 'invalid_clinic_header' };

  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { wpUserId: true } });
  if (!user?.wpUserId) return { ok: false, status: 403, code: 'clinic_not_in_scope' };

  const clinicId = BigInt(value);
  // A clinic that does not exist gets the same answer as someone else's, so the header
  // cannot be used to probe which clinic ids exist.
  if (role === 'PROFESSIONAL') {
    return (await isClinicOwner(user.wpUserId, clinicId))
      ? { ok: true, clinicId: undefined, ownerClinicId: clinicId }
      : { ok: false, status: 403, code: 'clinic_not_in_scope' };
  }

  const own = await listAdminClinicIds(user.wpUserId);
  return own.includes(clinicId)
    ? { ok: true, clinicId }
    : { ok: false, status: 403, code: 'clinic_not_in_scope' };
}
