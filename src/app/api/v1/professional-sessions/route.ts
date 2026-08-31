import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { doctorSessionListQuerySchema, doctorSessionCreateSchema } from '@/services/billing/validation';
import { listDoctorSessions, createDoctorSession } from '@/services/billing/doctor-session.service';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_read');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listDoctorSessions(parsed.data as any, doctorSessionScopeFor(kc)), 'Doctor sessions retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'doctor_session_manage');
  const kc = await resolveKcActor(actor);
  const parsed = doctorSessionCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createDoctorSession(parsed.data as any, kc), 'Doctor session created successfully');
}));
