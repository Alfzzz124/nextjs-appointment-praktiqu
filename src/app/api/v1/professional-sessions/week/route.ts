/**
 * The weekly schedule of one doctor at one clinic — the unit the scheduling screen edits.
 *
 * GET    /api/v1/doctor-sessions/week?doctorId=&clinicId=  — load the form
 * PUT    /api/v1/doctor-sessions/week                      — replace the whole week
 * DELETE /api/v1/doctor-sessions/week?doctorId=&clinicId=  — drop the whole schedule
 *
 * Stored rows are per (day, window); a day with a break is two rows. The service does
 * that translation so the client can send and receive the shape a user edits.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionWeekQuerySchema, doctorSessionWeekSaveSchema } from '@/services/billing/validation';
import {
  getDoctorSessionWeek,
  saveDoctorSessionWeek,
  deleteDoctorSessionWeek,
} from '@/services/billing/doctor-session.service';
import type { KcActor } from '@/services/billing/kc-actor';

/**
 * Super admins name the clinic; everyone else is bound to their own.
 *
 * A clinic-bound actor asking for another clinic gets told so, rather than being handed
 * their own clinic's schedule under someone else's id.
 */
function resolveClinicId(kc: KcActor, asked?: number): { clinicId: number } | { error: string; status: number } {
  if (kc.actor.role === 'SUPER_ADMIN') {
    return asked ? { clinicId: asked } : { error: 'clinicId is required', status: 400 };
  }
  const own = kc.clinicId != null ? Number(kc.clinicId) : null;
  if (asked !== undefined && own !== null && asked !== own) {
    return { error: "Cannot read another clinic's schedule", status: 403 };
  }
  const clinicId = own ?? asked ?? 0;
  return clinicId ? { clinicId } : { error: 'clinicId is required', status: 400 };
}

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionWeekQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('doctorId is required', 400);
  const resolved = resolveClinicId(kc, parsed.data.clinicId);
  if ('error' in resolved) return kcFail(resolved.error, resolved.status);
  const week = await getDoctorSessionWeek(parsed.data.doctorId, resolved.clinicId, doctorSessionScopeFor(kc));
  return kcOk(week, 'Doctor session week retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionWeekSaveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  const saved = await saveDoctorSessionWeek(parsed.data as any, kc);
  return kcOk(saved, 'Doctor session saved successfully');
}));

export const DELETE = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionWeekQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('doctorId is required', 400);
  const resolved = resolveClinicId(kc, parsed.data.clinicId);
  if ('error' in resolved) return kcFail(resolved.error, resolved.status);
  const removed = await deleteDoctorSessionWeek(parsed.data.doctorId, resolved.clinicId, doctorSessionScopeFor(kc));
  return kcOk({ removed }, `${removed} doctor sessions deleted.`);
}));
