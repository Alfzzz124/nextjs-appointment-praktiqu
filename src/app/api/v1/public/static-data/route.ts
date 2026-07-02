import { NextResponse } from 'next/server';
import { getPublicStaticData } from '@/services/public/public-catalog.service';
export const dynamic = 'force-dynamic';
export async function GET() {
  const data = await getPublicStaticData();
  return NextResponse.json({ data });
}
