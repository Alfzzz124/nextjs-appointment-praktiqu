import { NextRequest, NextResponse } from 'next/server';
import { verifyAppointmentToken } from '@/lib/public/appointment-token';
import { getPublicAppointmentById } from '@/services/public/public-booking.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const id = verifyAppointmentToken(params.token);
  if (!id) {
    const p = badRequest('invalid_token', 'Invalid or expired appointment token');
    return NextResponse.json(p, { status: p.status });
  }
  try {
    const appointment = await getPublicAppointmentById(id);
    if (!appointment) {
      const p = notFound('appointment_not_found', 'No appointment for that token');
      return NextResponse.json(p, { status: p.status });
    }
    return NextResponse.json({ data: appointment });
  } catch (err) {
    console.error('[public/appointments/token] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
