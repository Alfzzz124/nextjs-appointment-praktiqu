import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionUpdateSchema } from '@/services/billing/validation';
import { getDoctorSession, updateDoctorSession, deleteDoctorSession } from '@/services/billing/doctor-session.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getDoctorSession(Number(params.id), doctorSessionScopeFor(kc)), 'Doctor session retrieved successfully');
}));

export const PUT = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  await updateDoctorSession(Number(params.id), parsed.data, doctorSessionScopeFor(kc));
  return kcOk(null, 'Doctor session updated successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  await deleteDoctorSession(Number(params.id), doctorSessionScopeFor(kc));
  return kcOk(null, 'Doctor session deleted successfully');
}));
