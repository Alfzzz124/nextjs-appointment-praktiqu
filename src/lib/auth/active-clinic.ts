/**
 * X-Praktiqu-Clinic-Id — which of their clinics a CLINIC_ADMIN is acting in for this request.
 *
 * A clinic admin may hold several clinics (wp_kc_clinics.clinic_admin_id on several rows).
 * The Laravel FE keeps one of them "active" and sends it on every call; getActor() checks
 * it here, so every route sees one validated clinic per request and no route has to know
 * about the header.
 *
 * Only CLINIC_ADMIN is affected. Every other role ignores the header without an error.
 */
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { listAdminClinicIds } from '@/services/billing/kc-actor';

/** Lower-case, as `Headers.get()` is case-insensitive anyway. */
export const ACTIVE_CLINIC_HEADER = 'x-praktiqu-clinic-id';

const CLINIC_ID = /^[1-9][0-9]{0,18}$/;

export type ActiveClinicResult =
  | { ok: true; clinicId: bigint | undefined }
  | { ok: false; status: 400; code: 'invalid_clinic_header' }
  | { ok: false; status: 403; code: 'clinic_not_in_scope' };

export async function resolveActiveClinic(
  actorId: string,
  role: Actor['role'],
  raw: string | null,
): Promise<ActiveClinicResult> {
  if (role !== 'CLINIC_ADMIN') return { ok: true, clinicId: undefined };

  const value = raw?.trim() ?? '';
  if (value === '') return { ok: true, clinicId: undefined };
  if (!CLINIC_ID.test(value)) return { ok: false, status: 400, code: 'invalid_clinic_header' };

  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { wpUserId: true } });
  if (!user?.wpUserId) return { ok: false, status: 403, code: 'clinic_not_in_scope' };

  const clinicId = BigInt(value);
  const own = await listAdminClinicIds(user.wpUserId);
  // A clinic that does not exist gets the same answer as someone else's, so the header
  // cannot be used to probe which clinic ids exist.
  return own.includes(clinicId)
    ? { ok: true, clinicId }
    : { ok: false, status: 403, code: 'clinic_not_in_scope' };
}
