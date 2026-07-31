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

export interface RouteContext {
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
    // Plan and item ids are KiviCare integers (encounter id, prescription id).
    const planId = Number(ctx.params.id);
    if (!Number.isSafeInteger(planId) || planId <= 0) {
      return NextResponse.json({ title: 'not_found', status: 404 }, { status: 404 });
    }

    // Rebuilt explicitly — `strictNullChecks: false` makes z.infer mark `description`
    // optional even though the schema requires it.
    const item = await interventionPlanService.addItem(
      planId,
      {
        description: String(parsed.data.description),
        frequency: parsed.data.frequency,
        durationDays: parsed.data.durationDays,
        instructions: parsed.data.instructions,
      },
      caller,
    );
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}
