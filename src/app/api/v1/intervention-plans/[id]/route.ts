/**
 * GET /api/v1/intervention-plans/:id
 *   Read a single plan with items. Visible to the professional, the client,
 *   or receptionist / clinic admin (read-only).
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { InterventionPlanError, interventionPlanService } from '@/services/intervention-plan/service';
import { callerFromRequest } from '@/lib/auth/caller';
import { problemResponse } from '@/lib/http/problem';

export const dynamic = 'force-dynamic';

export interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const caller = await callerFromRequest(req);
    const plan = await interventionPlanService.getPlan(ctx.params.id, caller);
    return NextResponse.json(plan);
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}
