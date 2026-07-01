/**
 * POST /api/v1/practices/:id/resend-credentials — stub (not yet implemented)
 */
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { status: false, message: 'Credential email delivery not yet configured.' },
    { status: 501 },
  );
}
