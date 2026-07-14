import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import { checkPublicPaymentStatus, UnknownOrderError } from '@/services/payments/payment.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const p = badRequest('invalid_input', 'token is required');
    return NextResponse.json(p, { status: p.status });
  }

  const appointmentId = verifyAppointmentToken(parsed.data.token);
  if (!appointmentId) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const result = await checkPublicPaymentStatus(appointmentId);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownOrderError) {
      const p = notFound('payment_not_found', 'No payment found for this appointment');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[public/payment-verify] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
