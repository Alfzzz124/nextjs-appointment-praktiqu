import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import {
  initiatePublicPayment,
  AppointmentNotFoundError,
  AppointmentNotPendingError,
  PaymentAlreadyInitiatedError,
} from '@/services/payments/payment.service';
import { badRequest, notFound, conflict } from '@/lib/problem-details';

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
    const result = await initiatePublicPayment(appointmentId);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) {
      const p = notFound('appointment_not_found', 'Appointment not found');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof AppointmentNotPendingError) {
      const p = conflict('appointment_not_pending', 'Appointment is not awaiting payment');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof PaymentAlreadyInitiatedError) {
      const p = conflict('payment_already_initiated', 'Payment already initiated — check status instead');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[public/payments] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
