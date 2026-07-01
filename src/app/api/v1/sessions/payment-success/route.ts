/**
 * POST /api/v1/sessions/payment-success — payment success callback stub
 *
 * Not yet implemented — payment gateway integration pending.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { status: false, message: 'Payment gateway integration not yet configured.' },
    { status: 501 },
  );
}
