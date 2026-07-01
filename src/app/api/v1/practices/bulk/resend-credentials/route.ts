/**
 * POST /api/v1/practices/bulk/resend-credentials — stub (not yet implemented)
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';

export const POST = withAuth(async (_req, ctx) => {
  const { actor } = ctx as any;
  if (!['SUPER_ADMIN', 'CLINIC_ADMIN'].includes(actor.role)) {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }

  return NextResponse.json(
    { status: false, message: 'Credential email delivery not yet configured.' },
    { status: 501 },
  );
});
