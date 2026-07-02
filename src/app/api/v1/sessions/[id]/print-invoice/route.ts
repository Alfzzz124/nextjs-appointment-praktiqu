/**
 * GET /api/v1/sessions/:id/print-invoice — redirect to bill for this encounter
 *
 * Auth: delegated to the bills/by-encounter endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const billUrl = new URL(`/api/v1/bills/by-encounter/${id}`, req.url);
  return NextResponse.redirect(billUrl);
}
