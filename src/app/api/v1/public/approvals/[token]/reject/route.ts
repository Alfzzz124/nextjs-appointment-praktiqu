/**
 * POST /api/v1/public/approvals/:token/reject — reject the booking as its psychologist, from
 * the email link. The reason is internal and never shown to the client. Spec 2026-10-29 §6.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectByLink } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[POST /public/approvals/:token/reject]', token, async () => {
    const { reason } = rejectBody.parse(await req.json().catch(() => ({})));
    return rejectByLink(token, reason);
  });
}
