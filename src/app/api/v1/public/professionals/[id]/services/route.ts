import { NextRequest, NextResponse } from 'next/server';
import { getPublicProfessionalServices } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const services = await getPublicProfessionalServices(params.id);
  return NextResponse.json({ data: services });
}
