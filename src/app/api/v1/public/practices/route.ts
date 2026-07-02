import { NextResponse } from 'next/server';
import { listPublicPractices } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const practices = await listPublicPractices();
  return NextResponse.json({ data: practices });
}
