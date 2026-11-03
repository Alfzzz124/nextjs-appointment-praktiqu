/**
 * GET /api/v1/sessions/approvals — the psychologist-approval queue.
 *
 * Auth: PROFESSIONAL (own only), CLINIC_ADMIN (active clinic), SUPER_ADMIN (all, or ?clinicId=).
 * Answers { data, pagination, counts } — more than one key, so the Laravel FE's unwrap
 * leaves it whole and the badge counts survive.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §7.3
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { listQueue } from '@/services/approval/service';
import { QUEUE_FILTERS, type QueueFilter } from '@/services/approval/store';

const querySchema = z.object({
  state: z
    .string()
    .default('AWAITING')
    .refine((s): s is QueueFilter => (QUEUE_FILTERS as readonly string[]).includes(s), 'Unknown state'),
  professionalId: z.coerce.number().int().positive().optional(),
  clinicId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await sessionActorFromRequest(req);
    const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const page = await listQueue(actor, {
      filter: q.state as QueueFilter,
      professionalId: q.professionalId,
      clinicId: q.clinicId,
      page: q.page,
      limit: q.limit,
    });
    return NextResponse.json(page, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[GET /sessions/approvals]');
  }
}
