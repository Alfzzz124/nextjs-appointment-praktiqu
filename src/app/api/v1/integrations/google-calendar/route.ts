// The professional's own Google Calendar connection: look at it, or remove it.
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';
import {
  getConnectionStatus,
  disconnectCalendar,
} from '@/services/integrations/google-calendar-connection.service';
import { forbidden } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

function onlyProfessional(role: string) {
  return role === 'PROFESSIONAL'
    ? null
    : forbidden('not_a_professional', 'Only a professional can manage a calendar connection');
}

export const GET = withAuth(async (_req: NextRequest, { actor }) => {
  const denied = onlyProfessional(actor.role);
  if (denied) return NextResponse.json(denied, { status: denied.status });

  const { wpUserId } = await resolveKcActor(actor);
  return NextResponse.json({ data: await getConnectionStatus(Number(wpUserId)) });
});

export const DELETE = withAuth(async (_req: NextRequest, { actor }) => {
  const denied = onlyProfessional(actor.role);
  if (denied) return NextResponse.json(denied, { status: denied.status });

  const { wpUserId } = await resolveKcActor(actor);
  await disconnectCalendar(Number(wpUserId));
  // The row is gone, so there is nothing to return. Revoking our access at Google's
  // end is the professional's to do from their account settings; we cannot do it
  // for them without the token we just deleted.
  return new NextResponse(null, { status: 204 });
});
