/**
 * GET  /api/v1/intervention-plans
 *   List plans visible to the authenticated user.
 *
 * POST /api/v1/intervention-plans
 *   Professional creates a plan linked to a session.
 *
 * Source of truth: specs/009-intervention-plan/spec.md
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  InterventionPlanError,
  interventionPlanService,
} from '@/services/intervention-plan/service';
import { CreatePlanInput, ListPlansQuery, PlanStatusEnum } from '@/types/intervention-plan';
import { callerFromRequest } from '@/lib/auth/caller';
import { problemResponse, validationProblemResponse } from '@/lib/http/problem';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const caller = await callerFromRequest(req);
    const url = new URL(req.url);
    const parsed = ListPlansQuery.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
    });
    if (!parsed.success) {
      return validationProblemResponse(parsed.error.flatten());
    }

    const status = parsed.data.status ? PlanStatusEnum.parse(parsed.data.status) : undefined;
    const { plans, total } = await interventionPlanService.listPlans(caller, {
      status,
      limit: parsed.data.limit,
      page: parsed.data.page,
    });
    return NextResponse.json({ plans, total, page: parsed.data.page, limit: parsed.data.limit });
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const caller = await callerFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const parsed = CreatePlanInput.safeParse(body);
    if (!parsed.success) {
      return validationProblemResponse(parsed.error.flatten());
    }
    // Rebuilt explicitly: the project compiles with `strictNullChecks: false`, under
    // which z.infer marks both fields optional even though the schema requires them.
    const plan = await interventionPlanService.createPlan(
      { sessionId: String(parsed.data.sessionId), clientId: String(parsed.data.clientId) },
      caller,
    );
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    if (err instanceof InterventionPlanError) return problemResponse(err);
    return NextResponse.json({ title: 'internal_error', status: 500 }, { status: 500 });
  }
}
