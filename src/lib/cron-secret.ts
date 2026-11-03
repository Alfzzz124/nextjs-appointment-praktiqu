// Penjaga untuk route yang dipanggil cron server dengan header `x-cron-secret`.
//
// Route semacam ini tidak dijaga sesi pengguna, jadi penjagaannya sendiri yang harus benar —
// dan GAGAL TERTUTUP ketika rahasianya belum diatur, bukan terbuka.
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { serviceUnavailable, unauthorized } from '@/lib/problem-details';

function secretMatches(diberikan: string | null, diharapkan: string): boolean {
  if (!diberikan) return false;
  const a = Buffer.from(diberikan);
  const b = Buffer.from(diharapkan);
  // Panjang diperiksa lebih dulu karena timingSafeEqual melempar bila berbeda,
  // dan panjang sebuah rahasia bukan rahasia.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `null` bila permintaan boleh lewat; selain itu respons yang harus dikembalikan route. */
export function checkCronSecret(req: NextRequest, label: string): NextResponse | null {
  const diharapkan = process.env.CRON_SECRET;
  if (!diharapkan) {
    // Gagal tertutup. Endpoint internal yang diam-diam terbuka karena satu
    // variabel lupa diisi adalah cara paling sunyi untuk membocorkan jalur ini.
    console.error(`[${label}] CRON_SECRET belum diatur — permintaan ditolak`);
    const p = serviceUnavailable('cron_not_configured', 'Pemindaian belum dikonfigurasi.');
    return NextResponse.json(p, { status: p.status });
  }

  if (!secretMatches(req.headers.get('x-cron-secret'), diharapkan)) {
    const p = unauthorized('invalid_cron_secret');
    return NextResponse.json(p, { status: p.status });
  }

  return null;
}
