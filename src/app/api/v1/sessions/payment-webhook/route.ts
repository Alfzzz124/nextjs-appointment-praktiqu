import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logging } from '@/lib/logging';
import {
  verifyPaymentWebhookSignature,
  getPaymentOrderByWcOrderId,
  markPaid,
  markFailed,
  markExpired,
  applyPaidSideEffectsPublic,
  applyPaidSideEffectsSession,
  cancelIfStillPending,
  AmountMismatchError,
} from '@/services/payments/payment.service';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  event: z.enum(['payment.completed', 'payment.failed', 'payment.expired']),
  wcOrderId: z.number(),
  amountPaid: z.number().optional(),
  transactionId: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-praktiqu-webhook-signature');

  if (!verifyPaymentWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ status: false, message: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: false, message: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ status: false, message: 'Invalid payload' }, { status: 400 });
  }
  const { event, wcOrderId, amountPaid, transactionId } = parsed.data;

  const order = await getPaymentOrderByWcOrderId(wcOrderId);
  if (!order) {
    await logging.warn('Payment webhook for unknown wcOrderId', { metadata: { wcOrderId, event } });
    return NextResponse.json({ status: false, message: 'Unknown order' }, { status: 404 });
  }

  try {
    if (event === 'payment.completed') {
      await markPaid({
        wcOrderId,
        amountPaid: amountPaid ?? 0,
        transactionId: transactionId ?? '',
        webhookPayload: parsed.data,
      });
      // Re-fetch current state rather than branching on markPaid's return
      // value: markPaid returns null both when this webhook lost a race to
      // an earlier delivery AND when a prior process crash left the row
      // 'paid' with its side effect never applied. Re-checking and applying
      // (idempotently — see payment.service.ts's guard-first side-effect
      // functions) is the only way to self-heal the second case.
      const current = await getPaymentOrderByWcOrderId(wcOrderId);
      if (current?.status === 'paid') {
        if (current.source === 'public') await applyPaidSideEffectsPublic(current);
        else await applyPaidSideEffectsSession(current);
      }
    } else if (event === 'payment.failed') {
      await markFailed(wcOrderId, parsed.data);
    } else if (event === 'payment.expired') {
      const updated = await markExpired(wcOrderId);
      if (updated) await cancelIfStillPending(updated);
    }
  } catch (err) {
    if (err instanceof AmountMismatchError) {
      await logging.error('Payment webhook amount mismatch', err, { metadata: { wcOrderId, event } });
      return NextResponse.json({ status: false, message: 'Amount mismatch' }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ status: true, message: 'ok' }, { status: 200 });
}
