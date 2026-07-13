import { NextRequest, NextResponse } from 'next/server';
import { getRatingPrompt } from '@/services/public/public-catalog.service';
import { badRequest } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const prompt = await getRatingPrompt(params.id);
    if (!prompt) {
      const p = badRequest('invalid_token', 'Invalid appointment token');
      return NextResponse.json(p, { status: p.status });
    }
    return NextResponse.json({ data: prompt });
  } catch (err) {
    console.error('[public/rating] error:', err);
    return NextResponse.json(
      { type: 'about:blank', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
