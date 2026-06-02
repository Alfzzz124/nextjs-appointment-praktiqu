/**
 * POST /api/v1/intervention-plans/:id/items
 *   Professional adds a recommendation item to an existing plan.
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { InterventionPlanError, interventionPlanService } from '@/services/intervention-plan/service';
import { AddItemInput } from '@/types/intervention-plan';
import { callerFromRequest } from '@/lib/auth/caller';
import { problemResponse, validationProblemResponse } from '@/lib/http/problem';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const caller = await callerFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const parsed = AddItemInput.safeParse(body);
    if (!parsed.success) {
      return validationProblemResponse(parsed.error.flatten());
    }
    const item = await interventionPlanService.addItem(ctx.params.id, parsed.data, caller);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}
