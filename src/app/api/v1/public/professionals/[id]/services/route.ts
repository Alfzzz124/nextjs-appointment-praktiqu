import { NextRequest, NextResponse } from 'next/server';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';
import { badRequest, notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // A professional id is a wp_users.ID integer; anything else is a 404 rather than a
  // NaN query.
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const p = notFound('professional_not_found', 'No active professional with that id');
    return NextResponse.json(p, { status: p.status });
  }

  // Optional: only the services offered at one clinic. Staff manual booking books into
  // its own clinic, so a service the professional only offers elsewhere must not be
  // offered there. Same validation as /slots: a bad value is a 400, never "all clinics".
  const clinicParam = req.nextUrl.searchParams.get('clinicId');
  const clinicId = clinicParam === null ? undefined : Number(clinicParam);
  if (clinicId !== undefined && (!Number.isSafeInteger(clinicId) || clinicId <= 0)) {
    const p = badRequest('invalid_clinic', 'clinicId must be a positive integer');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const services = await getPublicProfessionalServices(id, clinicId);
    if (services === null) {
      const p = notFound('professional_not_found', 'No active professional with that id');
      return NextResponse.json(p, { status: p.status });
    }
    return NextResponse.json({ data: services });
  } catch (err) {
    console.error('[public/professionals/services] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
