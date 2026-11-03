// Dipanggil cron: dorong janji yang sudah pasti ke Google Calendar psikolog,
// lalu rekonsiliasi apa yang seharusnya ada dengan apa yang tercatat.
//
// Pola yang sama dengan conflict-scan di sebelah, dan karena alasan yang sama:
// Action Scheduler di instalasi ini pernah mati diam-diam berbulan-bulan. Satu
// baris crontab sembuh sendiri — putaran yang gagal terlewat, putaran berikutnya
// tetap berjalan, dan rekonsiliasi menutup selisih yang terjadi sementara itu.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import {
  runEventSweep,
  reconcileCalendarIntents,
} from '@/services/integrations/google-event-sync.service';
import { unauthorized, serviceUnavailable } from '@/lib/problem-details';
import { logging } from '@/lib/logging';
import { LogLevel } from '@prisma/client';

export const dynamic = 'force-dynamic';

function secretMatches(diberikan: string | null, diharapkan: string): boolean {
  if (!diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(diharapkan);
  // Panjang diperiksa lebih dulu karena timingSafeEqual melempar bila berbeda,
  // dan panjang sebuah rahasia bukan rahasia.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const diharapkan = process.env.CRON_SECRET;
  if (!diharapkan) {
    // Gagal tertutup, sama seperti conflict-scan: endpoint internal yang terbuka
    // karena satu variabel lupa diisi adalah kebocoran yang paling sunyi.
    console.error('[gcal-event-sync] CRON_SECRET belum diatur — permintaan ditolak');
    const p = serviceUnavailable('cron_not_configured', 'Sinkronisasi belum dikonfigurasi.');
    return NextResponse.json(p, { status: p.status });
  }

  if (!secretMatches(req.headers.get('x-cron-secret'), diharapkan)) {
    const p = unauthorized('invalid_cron_secret');
    return NextResponse.json(p, { status: p.status });
  }

  const mulai = Date.now();

  // Rekonsiliasi lebih dulu: baris yang ditemukannya ikut terkerjakan pada
  // putaran yang sama, bukan menunggu satu putaran lagi.
  const rekonsiliasi = await reconcileCalendarIntents();
  const sapuan = await runEventSweep();

  const hasil = { ...rekonsiliasi, ...sapuan };
  logging.system('[gcal-event-sync] selesai', LogLevel.INFO, {
    action: 'google.event-sync',
    metadata: { ...hasil, ms: Date.now() - mulai },
  });

  return NextResponse.json({ data: hasil });
}
