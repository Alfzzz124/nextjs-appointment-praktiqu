import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled, billScopeFor } from '@/services/billing/kc-permissions';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { generateBillPdf } from '@/services/billing/bill-document.service';
import { KcError } from '@/lib/kc-response';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const kc = await resolveKcActor(actor);
    const pdf = await generateBillPdf(Number(params.id), billScopeFor(kc));
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="bill_${params.id}_${Date.now()}.pdf"`,
      },
    });
  } catch (err) {
    if (err instanceof KcError) return kcFail(err.message, err.httpStatus);
    // eslint-disable-next-line no-console
    console.error('[kc] print failed', err);
    return kcFail('Failed to generate PDF', 500);
  }
});
