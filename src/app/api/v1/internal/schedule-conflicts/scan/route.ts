// Dipanggil cron server tiap jam: cari janji temu aktif satu psikolog yang tumpang tindih,
// lalu beri tahu psikolognya dan admin kliniknya.
//
// Cron server, bukan Action Scheduler — alasannya sama dengan pemindaian bentrok Google
// (route google-calendar/conflict-scan): Action Scheduler di instalasi ini pernah macet
// berminggu-minggu tanpa ada yang sadar, sedangkan satu baris crontab sembuh sendiri.
// Spec: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md
import { NextRequest, NextResponse } from 'next/server';
import { LogLevel } from '@prisma/client';
import { checkCronSecret } from '@/lib/cron-secret';
import { logging } from '@/lib/logging';
import { problem } from '@/lib/problem-details';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ditolak = checkCronSecret(req, 'schedule-conflict-scan');
  if (ditolak) return ditolak;

  const mulai = Date.now();
  try {
    const hasil = await scanScheduleConflicts();
    await logging.system('[schedule-conflict-scan] selesai', LogLevel.INFO, {
      action: 'schedule.conflict-scan',
      metadata: { ...hasil, ms: Date.now() - mulai },
    });
    return NextResponse.json({ data: hasil });
  } catch (err) {
    // Kueri deteksi gagal: tabel catatan tidak tersentuh, dan log cron mencatat 500-nya.
    await logging.error('[schedule-conflict-scan] gagal', err, { action: 'schedule.conflict-scan' });
    const p = problem({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'scan_failed',
      detail: 'Pemindaian bentrok jadwal gagal.',
    });
    return NextResponse.json(p, { status: 500 });
  }
}
