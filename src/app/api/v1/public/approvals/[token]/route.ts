/**
 * GET /api/v1/public/approvals/:token — the booking behind a psychologist's email link,
 * and which buttons the page may offer. No login: the signed token is the authority.
 * Decides nothing (email scanners open every link). Spec 2026-10-29 §6.1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { linkView } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[GET /public/approvals/:token]', () => linkView(token));
}
