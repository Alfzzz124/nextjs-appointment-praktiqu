import { NextResponse } from 'next/server';
import { listPublicPractices } from '@/services/public/public-catalog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const practices = await listPublicPractices();
    return NextResponse.json({ data: practices });
  } catch (err) {
    console.error('[public/practices] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
