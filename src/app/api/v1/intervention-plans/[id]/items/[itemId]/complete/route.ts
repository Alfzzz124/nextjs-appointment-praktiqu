/**
 * PATCH /api/v1/intervention-plans/:id/items/:itemId/complete
 *   Client marks a recommendation item COMPLETED.
 *   Only the client who owns the plan can call this — not the professional.
 *
 * Source of truth: specs/009-intervention-plan/spec.md (FR-003)
 */

import { NextRequest, NextResponse } from 'next/server';
import { InterventionPlanError, interventionPlanService } from '@/services/intervention-plan/service';
import { CompleteItemInput } from '@/types/intervention-plan';
import { callerFromRequest } from '@/lib/auth/caller';
import { problemResponse, validationProblemResponse } from '@/lib/http/problem';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string; itemId: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const caller = await callerFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const parsed = CompleteItemInput.safeParse(body ?? {});
    if (!parsed.success) {
      return validationProblemResponse(parsed.error.flatten());
    }
    const item = await interventionPlanService.completeItem(
      ctx.params.id,
      ctx.params.itemId,
      parsed.data,
      caller,
    );
    return NextResponse.json(item);
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}
