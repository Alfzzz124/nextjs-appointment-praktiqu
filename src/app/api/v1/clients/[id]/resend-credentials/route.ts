/**
 * POST /api/v1/clients/:id/resend-credentials — stub (not yet implemented)
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { type: '/errors/not-implemented', title: 'Not implemented', status: 501 },
    { status: 501 },
  );
}
