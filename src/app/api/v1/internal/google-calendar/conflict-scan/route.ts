// Dipanggil cron harian: cari janji temu yang tertimpa agenda pribadi psikolog,
// lalu beri tahu psikolognya.
//
// Dipicu cron server, bukan Action Scheduler. Alasannya sejarah: Action Scheduler
// di instalasi ini pernah macet dan mati berminggu-minggu tanpa ada yang sadar,
// dan pola "job menjadwalkan dirinya untuk besok" punya kelemahan yang sama —
// satu kegagalan memutus rantainya selamanya. Satu baris crontab sembuh sendiri:
// hari yang gagal terlewat, hari berikutnya tetap berjalan.
import { NextRequest, NextResponse } from 'next/server';
import { scanBackwardConflicts } from '@/services/integrations/conflict-scan.service';
import { checkCronSecret } from '@/lib/cron-secret';
import { logging } from '@/lib/logging';
import { LogLevel } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ditolak = checkCronSecret(req, 'conflict-scan');
  if (ditolak) return ditolak;

  const mulai = Date.now();
  const hasil = await scanBackwardConflicts();
  logging.system('[conflict-scan] selesai', LogLevel.INFO, {
    action: 'google.conflict-scan',
    metadata: { ...hasil, ms: Date.now() - mulai },
  });

  return NextResponse.json({ data: hasil });
}
