/**
 * POST /api/v1/webhooks/wordpress-jobs
 *
 * Receives job-completion callbacks from the WordPress praktiqu-endpoint
 * plugin (via Action Scheduler). See `src/lib/jobs/webhook-handler.ts` for
 * the dispatcher and handler-registration mechanism.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processWebhook } from '@/lib/jobs/webhook-handler';
// Diimpor demi efek sampingnya: modul ini memanggil registerJobHandler('session.reminder')
// di lingkup modul. Route handler Next.js adalah modul per-request, jadi impor inilah
// satu-satunya yang membuat handler terdaftar. JANGAN hapus sebagai "impor tak terpakai" —
// tests/unit/session/reminder-registration.test.ts menjaga ini.
import '@/services/session/reminder-handler';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-praktiqu-webhook-signature');

  const ok = await processWebhook(rawBody, signature);
  if (!ok) {
    return NextResponse.json(
      { error: 'invalid_signature' },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true });
}
