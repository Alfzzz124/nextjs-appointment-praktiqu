import { NextResponse } from 'next/server';
import { getPublicBookingConfig } from '@/services/public/public-catalog.service';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ data: getPublicBookingConfig() });
}
