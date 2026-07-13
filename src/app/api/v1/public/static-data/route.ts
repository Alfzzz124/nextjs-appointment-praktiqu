import { NextResponse } from 'next/server';
import { getPublicStaticData } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getPublicStaticData();
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[public/static-data] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
