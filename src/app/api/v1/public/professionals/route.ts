// Public directory of active professionals, read from wp_users.
import { NextRequest, NextResponse } from 'next/server';
import { listPublicProfessionals } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const specialty = searchParams.get('specialty') ?? undefined;

  const clinicParam = searchParams.get('clinicId');
  const clinicId = clinicParam === null ? undefined : Number(clinicParam);
  if (clinicId !== undefined && (!Number.isSafeInteger(clinicId) || clinicId <= 0)) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid clinicId', status: 400 },
      { status: 400 },
    );
  }

  try {
    const items = await listPublicProfessionals({ specialty, clinicId });
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[public/professionals] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
