import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle, kcOk, kcFail } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { ratingScopeFor, listRatings, createRating } from '@/services/billing/rating.service';
import { ratingListQuerySchema, ratingCreateSchema } from '@/services/billing/validation';

export const GET = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'rating_read');
  const kc = await resolveKcActor(actor);
  const parsed = ratingListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return kcFail('Invalid query', 400);
  return kcOk(await listRatings(parsed.data as any, ratingScopeFor(kc)), 'Ratings retrieved successfully');
}));

export const POST = withAuth(async (req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'rating_manage');
  const kc = await resolveKcActor(actor);
  const parsed = ratingCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return kcFail('Invalid input', 400);
  return kcOk(await createRating(parsed.data as any, kc), 'Rating created successfully');
}));
