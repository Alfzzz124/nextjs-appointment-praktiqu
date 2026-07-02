import { NextRequest, NextResponse } from 'next/server';
import { getPublicPractice } from '@/services/public/public-catalog.service';
import { notFound } from '@/lib/problem-details';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const practice = await getPublicPractice(params.id);
  if (!practice) {
    const p = notFound('practice_not_found', 'No active clinic with that id');
    return NextResponse.json(p, { status: p.status });
  }
  return NextResponse.json({ data: practice });
}
