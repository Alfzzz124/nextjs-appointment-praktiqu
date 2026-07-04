import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { ratingScopeFor, ratingStats } from '@/services/billing/rating.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'rating_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await ratingStats(ratingScopeFor(kc)), 'Rating stats retrieved successfully');
}));
