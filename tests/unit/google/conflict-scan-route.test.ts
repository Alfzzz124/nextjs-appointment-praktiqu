/**
 * Endpoint yang dipanggil cron harian.
 *
 * Ini satu-satunya jalur di aplikasi yang tidak dijaga sesi pengguna, jadi
 * penjagaannya sendiri yang harus benar — dan harus GAGAL TERTUTUP ketika
 * rahasianya belum diatur, bukan terbuka.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/integrations/conflict-scan.service', () => ({
  scanBackwardConflicts: vi.fn(async () => ({ scanned: 3, conflicts: 1, notified: 1 })),
}));

import { POST } from '@/app/api/v1/internal/google-calendar/conflict-scan/route';
import { scanBackwardConflicts } from '@/services/integrations/conflict-scan.service';

const RAHASIA = 'rahasia-cron-yang-panjang-sekali';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['x-cron-secret'] = secret;
  return new NextRequest('http://x/api/v1/internal/google-calendar/conflict-scan', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = RAHASIA;
});

describe('POST conflict-scan', () => {
  it('menjalankan pemindaian dan mengembalikan ringkasannya', async () => {
    const res = await POST(req(RAHASIA));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { scanned: 3, conflicts: 1, notified: 1 } });
    expect(scanBackwardConflicts).toHaveBeenCalledOnce();
  });

  it('menolak rahasia yang salah', async () => {
    const res = await POST(req('salah'));
    expect(res.status).toBe(401);
    expect(scanBackwardConflicts).not.toHaveBeenCalled();
  });

  it('menolak permintaan tanpa rahasia', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(scanBackwardConflicts).not.toHaveBeenCalled();
  });

  it('menolak rahasia yang panjangnya berbeda tanpa melempar', async () => {
    // timingSafeEqual melempar kalau panjangnya beda; panjang tanda tangan
    // bukan rahasia, jadi diperiksa lebih dulu.
    const res = await POST(req('pendek'));
    expect(res.status).toBe(401);
  });

  it('gagal tertutup ketika CRON_SECRET belum diatur', async () => {
    // Bukan 200. Endpoint tanpa penjagaan yang diam-diam terbuka adalah cara
    // paling sunyi untuk membocorkan jalur internal.
    delete process.env.CRON_SECRET;
    // Route ini mencatatnya, dan memang seharusnya — dibungkam agar keluaran uji
    // tetap terbaca, lalu ditegaskan supaya membungkamnya tidak bisa menyembunyikan
    // hilangnya log itu.
    const tercatat = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req(RAHASIA));
      expect(res.status).toBe(503);
      expect(scanBackwardConflicts).not.toHaveBeenCalled();
      expect(tercatat).toHaveBeenCalled();
    } finally {
      tercatat.mockRestore();
    }
  });
});
