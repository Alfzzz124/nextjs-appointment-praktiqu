import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { checkSessionPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { billScopeFor } from '@/services/billing/kc-permissions';
import { getBill } from '@/services/billing/bill.service';
import { KcError } from '@/lib/kc-response';
import { statusProblem } from '@/services/payments/payment-errors';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;
const bodySchema = z.object({ billId: z.string().regex(/^\d+$/) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, STAFF_ROLES);
  if ('response' in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'billId is required');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    // Same row scope as payment-verify and GET /bills/:id, checked before the order is
    // looked up: the status, amount and reconciliation of another clinic's order must not
    // be reachable by guessing a bill id. SUPER_ADMIN is unscoped and may have no WP link.
    const { actor } = gate;
    if (actor.role !== 'SUPER_ADMIN') {
      await getBill(Number(parsed.data.billId), billScopeFor(await resolveKcActor(actor)));
    }
    const result = await checkSessionPaymentStatus(parsed.data.billId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this bill');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof KcError) {
      const p = statusProblem(err.httpStatus, err.message);
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[sessions/payment-success] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
