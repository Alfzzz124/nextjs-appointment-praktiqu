import { NextRequest, NextResponse } from 'next/server';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';
import { notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // A professional id is a wp_users.ID integer; anything else is a 404 rather than a
  // NaN query.
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const p = notFound('professional_not_found', 'No active professional with that id');
    return NextResponse.json(p, { status: p.status });
  }

  try {
    const services = await getPublicProfessionalServices(id);
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
