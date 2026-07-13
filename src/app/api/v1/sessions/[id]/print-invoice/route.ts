/**
 * GET /api/v1/sessions/:id/print-invoice — redirect to bill for this encounter
 *
 * Auth: delegated to the bills/by-encounter endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requireAuth(req);
  if ('response' in gate) return gate.response;

  const { id } = await params;
  const billUrl = new URL(`/api/v1/bills/by-encounter/${id}`, req.url);
  return NextResponse.redirect(billUrl);
}
