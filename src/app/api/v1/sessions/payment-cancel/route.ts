import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { checkSessionPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'PROFESSIONAL', 'RECEPTIONIST'] as const;
const bodySchema = z.object({ billId: z.string().min(1) });

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
    const result = await checkSessionPaymentStatus(parsed.data.billId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this bill');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[sessions/payment-cancel] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
