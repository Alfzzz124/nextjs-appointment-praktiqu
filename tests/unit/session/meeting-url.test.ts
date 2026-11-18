/**
 * Tautan Meet sebuah janji, dibaca dari baris sinkronisasi Google.
 *
 * Satu kueri `IN` per panggilan (daftar janji tidak boleh N+1), dan hanya baris yang
 * acaranya memang masih diinginkan ada: baris 'absent' menunjuk acara yang sudah
 * dihapus, jadi tautannya mati.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { googleCalendarEventSync: { findMany: db.findMany } } }));

const log = vi.hoisted(() => ({ logging: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logging', () => log);

import { meetingUrlsFor } from '@/services/session/meeting-url';

beforeEach(() => {
  db.findMany.mockReset().mockResolvedValue([]);
  log.logging.warn.mockReset();
  log.logging.error.mockReset();
});

describe('meetingUrlsFor', () => {
  it('mengambil semua id dalam satu kueri dan memetakan id -> tautan', async () => {
    db.findMany.mockResolvedValue([
      { appointmentId: 7n, hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' },
      { appointmentId: 9n, hangoutLink: 'https://meet.google.com/ddd-eeee-fff' },
    ]);

    const m = await meetingUrlsFor([7, 8, 9]);

    expect(db.findMany).toHaveBeenCalledTimes(1);
    expect(db.findMany.mock.calls[0][0].where).toMatchObject({
      appointmentId: { in: [7n, 8n, 9n] },
      desiredState: 'present',
      hangoutLink: { not: null },
    });
    expect(m.get(7)).toBe('https://meet.google.com/aaa-bbbb-ccc');
    expect(m.get(9)).toBe('https://meet.google.com/ddd-eeee-fff');
    expect(m.has(8)).toBe(false);
  });

  it('tidak menyentuh database untuk daftar kosong', async () => {
    expect((await meetingUrlsFor([])).size).toBe(0);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it('gagal baca hanya menghilangkan tautan, tidak melempar', async () => {
    db.findMany.mockRejectedValue(new Error('db down'));

    const m = await meetingUrlsFor([7]);

    expect(m.size).toBe(0);
    expect(log.logging.error).toHaveBeenCalled();
  });
});
