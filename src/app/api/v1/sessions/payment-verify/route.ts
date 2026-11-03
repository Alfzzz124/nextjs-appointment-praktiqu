import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { ensureSessionPayment } from '@/services/payments/payment.service';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { billScopeFor } from '@/services/billing/kc-permissions';
import { badRequest } from '@/lib/problem-details';
import { KcError } from '@/lib/kc-response';
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { paymentErrorProblem, statusProblem } from '@/services/payments/payment-errors';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;

// `satisfies` ties this list to `PaymentMethod` at compile time: adding a method to one
// without the other is now a type error, not a silent gap. No runtime behaviour change —
// `as const satisfies` only narrows the literal type checked by `tsc`.
const PAYMENT_METHODS = ['xendit', 'paypal', 'card'] as const satisfies readonly PaymentMethod[];

const bodySchema = z.object({
  billId: z.string().min(1),
  method: z.enum(PAYMENT_METHODS).default('xendit'),
});

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
    // Same row scope as GET /bills/:id. SUPER_ADMIN is unscoped and skips the WordPress
    // lookup, which would 403 a super admin account with no wp_users link.
    const { actor } = gate;
    const scope = actor.role === 'SUPER_ADMIN' ? null : billScopeFor(await resolveKcActor(actor));
    const result = await ensureSessionPayment(parsed.data.billId, parsed.data.method, scope);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof KcError) {
      const p = statusProblem(err.httpStatus, err.message);
      return NextResponse.json(p, { status: p.status });
    }
    const paymentProblem = paymentErrorProblem(err);
    if (paymentProblem) return NextResponse.json(paymentProblem, { status: paymentProblem.status });
    console.error('[sessions/payment-verify] unexpected error:', err);
    const fallback = statusProblem(500, 'Internal Server Error');
    return NextResponse.json(fallback, { status: fallback.status });
  }
}
