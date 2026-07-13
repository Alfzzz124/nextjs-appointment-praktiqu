import { NextRequest, NextResponse } from 'next/server';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import {
  cancelPublicAppointment,
  AppointmentNotFoundError,
  NotCancellableError,
} from '@/services/public/public-booking.service';
import { badRequest, notFound, conflict } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const id = verifyAppointmentToken(params.token);
  if (!id) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }
  try {
    const appointment = await cancelPublicAppointment(id);
    return NextResponse.json({ data: appointment });
  } catch (err) {
    if (err instanceof AppointmentNotFoundError) {
      const p = notFound('appointment_not_found', 'No appointment for that token');
      return NextResponse.json(p, { status: p.status });
    }
    if (err instanceof NotCancellableError) {
      const p = conflict('not_cancellable', 'Appointment cannot be cancelled in its current state');
      return NextResponse.json(p, { status: p.status });
    }
    console.error('[public/appointments/cancel] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
