/**
 * POST /api/v1/public/approvals/:token/approve — approve the booking as its psychologist,
 * from the email link. Same decision as the dashboard's. Body ignored. Spec 2026-10-29 §6.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { approveByLink } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[POST /public/approvals/:token/approve]', () => approveByLink(token));
}
