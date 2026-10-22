/**
 * Endpoint yang dipanggil cron per jam. Tidak dijaga sesi pengguna, jadi penjagaannya sendiri
 * yang harus benar — dan GAGAL TERTUTUP ketika rahasianya belum diatur.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/services/schedule/conflict-scan.service', () => ({
  scanScheduleConflicts: vi.fn(async () => ({ pairs: 2, recipients: 3, notified: 3, failed: 0 })),
}));
vi.mock('@/lib/logging', () => ({
  logging: { system: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}) },
}));

import { POST } from '@/app/api/v1/internal/schedule-conflicts/scan/route';
import { scanScheduleConflicts } from '@/services/schedule/conflict-scan.service';
import { logging } from '@/lib/logging';

const RAHASIA = 'rahasia-cron-yang-panjang-sekali';

function req(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['x-cron-secret'] = secret;
  return new NextRequest('http://x/api/v1/internal/schedule-conflicts/scan', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = RAHASIA;
});

describe('POST schedule-conflicts/scan', () => {
  it('menjalankan pemindaian, mencatat ringkasannya, dan mengembalikannya', async () => {
    const res = await POST(req(RAHASIA));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { pairs: 2, recipients: 3, notified: 3, failed: 0 } });
    expect(scanScheduleConflicts).toHaveBeenCalledOnce();
    expect(logging.system).toHaveBeenCalledWith(
      '[schedule-conflict-scan] selesai',
      expect.anything(),
      expect.objectContaining({ action: 'schedule.conflict-scan' }),
    );
  });

  it('menolak rahasia yang salah', async () => {
    const res = await POST(req('salah'));
    expect(res.status).toBe(401);
    expect(scanScheduleConflicts).not.toHaveBeenCalled();
  });

  it('menolak permintaan tanpa rahasia', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(scanScheduleConflicts).not.toHaveBeenCalled();
  });

  it('gagal tertutup ketika CRON_SECRET belum diatur', async () => {
    delete process.env.CRON_SECRET;
    const tercatat = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req(RAHASIA));
      expect(res.status).toBe(503);
      expect(scanScheduleConflicts).not.toHaveBeenCalled();
      expect(tercatat).toHaveBeenCalled();
    } finally {
      tercatat.mockRestore();
    }
  });

  it('menjawab 500 dan mencatatnya ketika pemindaian melempar', async () => {
    vi.mocked(scanScheduleConflicts).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(req(RAHASIA));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'scan_failed', status: 500 });
    expect(logging.error).toHaveBeenCalled();
  });
});
