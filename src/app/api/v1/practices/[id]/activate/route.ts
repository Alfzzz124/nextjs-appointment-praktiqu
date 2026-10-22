/**
 * POST /api/v1/practices/:id/activate — SUPER_ADMIN: switch a deactivated clinic back on.
 *
 * Its own action rather than PATCH {status: 1}, so the FE has one clear button and PATCH
 * need not tell roles apart for a single field.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { practiceProblem } from '@/lib/practice-problems';
import { assertPracticeInScope, setPracticeStatus } from '@/services/practice/service';
import { logging } from '@/lib/logging';

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    // Also turns a non-numeric :id into a 404 before BigInt() can throw.
    await assertPracticeInScope(gate.actor, Number(params.id));
    const dto = await setPracticeStatus(Number(params.id), 1, { actorId: gate.actor.id });
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('activatePractice failed', err, { path: `/api/v1/practices/${params.id}/activate` });
    return NextResponse.json({ type: '/errors/internal', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
