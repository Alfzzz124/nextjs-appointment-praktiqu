import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail } from '@/lib/kc-response';
import { assertCan, assertBillingEnabled } from '@/services/billing/kc-permissions';
import { generateBillPdf } from '@/services/billing/bill-document.service';
import { KcError } from '@/lib/kc-response';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    await assertBillingEnabled();
    assertCan(actor, 'patient_bill_view');
    const pdf = await generateBillPdf(Number(params.id));
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
