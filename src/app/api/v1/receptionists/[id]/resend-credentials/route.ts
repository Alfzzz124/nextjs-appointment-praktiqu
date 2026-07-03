import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcHandle } from '@/lib/kc-response';
import { assertCan } from '@/services/billing/kc-permissions';

export const POST = withAuth(async (_req: NextRequest, ctx) => kcHandle(async () => {
  const { actor } = ctx as any;
  assertCan(actor, 'receptionist_manage');
  return NextResponse.json(
    { status: false, message: 'Credential email delivery is not yet configured. Contact your system administrator.' },
    { status: 501 },
  );
}));
