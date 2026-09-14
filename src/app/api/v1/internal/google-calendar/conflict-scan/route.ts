// Dipanggil cron harian: cari janji temu yang tertimpa agenda pribadi psikolog,
// lalu beri tahu psikolognya.
//
// Dipicu cron server, bukan Action Scheduler. Alasannya sejarah: Action Scheduler
// di instalasi ini pernah macet dan mati berminggu-minggu tanpa ada yang sadar,
// dan pola "job menjadwalkan dirinya untuk besok" punya kelemahan yang sama —
// satu kegagalan memutus rantainya selamanya. Satu baris crontab sembuh sendiri:
// hari yang gagal terlewat, hari berikutnya tetap berjalan.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { scanBackwardConflicts } from '@/services/integrations/conflict-scan.service';
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
    // Gagal tertutup. Endpoint internal yang diam-diam terbuka karena satu
    // variabel lupa diisi adalah cara paling sunyi untuk membocorkan jalur ini.
    console.error('[conflict-scan] CRON_SECRET belum diatur — permintaan ditolak');
    const p = serviceUnavailable('cron_not_configured', 'Pemindaian belum dikonfigurasi.');
    return NextResponse.json(p, { status: p.status });
  }

  if (!secretMatches(req.headers.get('x-cron-secret'), diharapkan)) {
    const p = unauthorized('invalid_cron_secret');
    return NextResponse.json(p, { status: p.status });
  }

  const mulai = Date.now();
  const hasil = await scanBackwardConflicts();
  logging.system('[conflict-scan] selesai', LogLevel.INFO, {
    action: 'google.conflict-scan',
    metadata: { ...hasil, ms: Date.now() - mulai },
  });

  return NextResponse.json({ data: hasil });
}
