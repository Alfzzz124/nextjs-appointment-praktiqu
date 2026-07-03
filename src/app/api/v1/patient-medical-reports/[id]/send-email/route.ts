import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';

export const POST = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'patient_report_manage');
  return NextResponse.json(
    { code: 'NOT_IMPLEMENTED', message: 'Emailing medical reports is not yet configured' },
    { status: 501 },
  );
}));
