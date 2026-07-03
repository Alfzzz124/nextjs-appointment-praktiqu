import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';

export const GET = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_read');
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Medical report PDF print is not yet configured' },
    { status: 501 },
  );
}));
