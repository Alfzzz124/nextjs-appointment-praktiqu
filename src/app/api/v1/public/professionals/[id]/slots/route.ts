// Bookable slots for a professional, from wp_kc_clinic_sessions minus real bookings.
import { NextRequest, NextResponse } from 'next/server';
import { getPublicSlots } from '@/services/public/public-catalog.service';
import { localDate } from '@/services/booking/booking-policy';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  // Today in the clinic zone. toISOString() is the UTC date, still yesterday until 07:00
  // WIB, and every slot of yesterday is past.
  const date = searchParams.get('date') ?? localDate(new Date());
  const serviceId = Number(searchParams.get('serviceId'));

  const professionalId = Number(params.id);
  if (!Number.isSafeInteger(professionalId) || professionalId <= 0) {
    const p = notFound('professional_not_found', 'No active professional with that id');
    return NextResponse.json(p, { status: p.status });
  }

  if (!DATE_RE.test(date)) {
    const p = badRequest('invalid_date', 'date must be YYYY-MM-DD');
    return NextResponse.json(p, { status: p.status });
  }

  // Required now: the slot length is the doctor's own duration for that service, so
  // there is no honest default. The old route fell back to 60 minutes and could
  // therefore advertise slots that were not bookable.
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    const p = badRequest('invalid_service', 'serviceId is required');
    return NextResponse.json(p, { status: p.status });
  }

  const clinicParam = searchParams.get('clinicId');
  const clinicId = clinicParam === null ? undefined : Number(clinicParam);
  if (clinicId !== undefined && (!Number.isSafeInteger(clinicId) || clinicId <= 0)) {
    const p = badRequest('invalid_clinic', 'clinicId must be a positive integer');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const slots = await getPublicSlots({ professionalId, date, serviceId, clinicId });
    if (slots === null) {
      const p = notFound('professional_not_found', 'No active professional offering that service');
      return NextResponse.json(p, { status: p.status });
    }

    return NextResponse.json({ date, slots });
  } catch (err) {
    console.error('[public/professionals/slots] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
