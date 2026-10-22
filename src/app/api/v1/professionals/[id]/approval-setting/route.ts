/**
 * GET /api/v1/professionals/:id/approval-setting — a psychologist's approval switch.
 * PUT — change it. Body { requiresApproval: boolean }.
 *
 * Reading needs the same right as changing (route-scope canEdit): the psychologist
 * themself, a CLINIC_ADMIN whose active clinic maps them, SUPER_ADMIN. `id` is the
 * wp_users.ID, the same `professionalId` the session responses carry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, type Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { forbidden, notFound } from '@/lib/problem-details';
import { getApprovalSetting, setApprovalSetting } from '@/services/approval/settings';
import { approvalSettingView } from '@/services/approval/service';
import { canEdit, invalidIdResponse, parseProfessionalId, scopeFor } from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

const bodySchema = z.object({ requiresApproval: z.boolean() }).strict();

async function guard(actor: Actor, rawId: string): Promise<{ id: number } | { response: NextResponse }> {
  const id = parseProfessionalId(rawId);
  if (id === null) return { response: invalidIdResponse() };
  const scope = await scopeFor(actor, id);
  if (!scope) {
    return { response: NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 }) };
  }
  if (!canEdit(scope, actor.role)) {
    return {
      response: NextResponse.json(forbidden('forbidden', "Cannot see or change this professional's approval setting"), {
        status: 403,
      }),
    };
  }
  return { id };
}

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const g = await guard(actor, ctx.params.id);
  if ('response' in g) return g.response;

  return NextResponse.json({ data: await approvalSettingView(await getApprovalSetting(g.id)) });
});

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const g = await guard(actor, ctx.params.id);
  if ('response' in g) return g.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        detail: parsed.error.issues[0]?.message ?? 'Body must be { requiresApproval: boolean }',
      },
      { status: 422 },
    );
  }

  const { before, after } = await setApprovalSetting(g.id, parsed.data.requiresApproval, actor.id);
  await logging.audit('professional.approval_setting_changed', {
    userId: actor.id,
    resource: 'professional',
    resourceId: String(g.id),
    action: 'professional.approval_setting_changed',
    metadata: { from: before, to: after.requiresApproval },
  });

  return NextResponse.json({ data: await approvalSettingView(after) });
});
