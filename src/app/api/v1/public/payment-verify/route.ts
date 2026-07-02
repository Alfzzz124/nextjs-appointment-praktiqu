import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Payment verification is not yet configured' },
    { status: 501 },
  );
}
