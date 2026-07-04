import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { ratingScopeFor, getRating, deleteRating } from '@/services/billing/rating.service';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'rating_read');
  const kc = await resolveKcActor(actor);
  return kcOk(await getRating(Number(params.id), ratingScopeFor(kc)), 'Rating retrieved successfully');
}));

export const DELETE = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor, params } = ctx as any;
  assertCan(actor, 'rating_manage');
  const kc = await resolveKcActor(actor);
  await deleteRating(Number(params.id), ratingScopeFor(kc));
  return kcOk(null, 'Rating deleted successfully');
}));
