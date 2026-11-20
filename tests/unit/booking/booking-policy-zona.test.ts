// "Sekarang" untuk aturan booking dihitung di zona klinik, bukan zona proses.
// Setiap kasus dijalankan di TZ proses UTC dan Asia/Jakarta (Node membaca ulang
// process.env.TZ saat diubah) dan hasilnya harus identik.

import { afterEach, describe, expect, it } from 'vitest';
import {
  addDaysTo,
  isTooSoon,
  localDate,
  minutesUntil,
} from '@/services/booking/booking-policy';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function inTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  return fn();
}

const ZONES = ['UTC', 'Asia/Jakarta', 'America/New_York'];

describe('booking-policy memakai zona klinik, bukan zona proses', () => {
  // 04:00Z = 11:00 WIB
  const now = new Date('2026-11-18T04:00:00Z');

  it.each(ZONES)('slot 10:00 sudah lewat, 11:30 terlalu dekat, 12:00 boleh (TZ=%s)', (tz) => {
    const hasil = inTz(tz, () => [
      isTooSoon('2026-11-18', '10:00', now),
      isTooSoon('2026-11-18', '11:30', now),
      isTooSoon('2026-11-18', '12:00', now),
    ]);
    expect(hasil).toEqual([true, true, false]);
  });

  it.each(ZONES)('minutesUntil dihitung dari jam dinding WIB (TZ=%s)', (tz) => {
    expect(inTz(tz, () => minutesUntil('2026-11-18', '12:00', now))).toBe(60);
  });

  it.each(ZONES)('dekat tengah malam WIB, tanggal "hari ini" adalah tanggal WIB (TZ=%s)', (tz) => {
    // 17:30Z = 00:30 WIB keesokan harinya
    const malam = new Date('2026-11-18T17:30:00Z');
    expect(inTz(tz, () => localDate(malam))).toBe('2026-11-19');
    // Slot 01:00 WIB esok hari itu belum 60 menit lagi; 01:30 baru boleh.
    expect(inTz(tz, () => isTooSoon('2026-11-19', '01:00', malam))).toBe(true);
    expect(inTz(tz, () => isTooSoon('2026-11-19', '01:30', malam))).toBe(false);
  });

  it('zona opsional untuk pemanggil yang punya zona klinik', () => {
    // 04:00Z = 13:00 di Asia/Tokyo
    expect(localDate(now, 'Asia/Tokyo')).toBe('2026-11-18');
    expect(minutesUntil('2026-11-18', '14:00', now, 'Asia/Tokyo')).toBe(60);
    expect(localDate(new Date('2026-11-18T16:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-19');
  });

  it.each(ZONES)('addDaysTo melangkah per hari kalender tanpa melompat/mengulang (TZ=%s)', (tz) => {
    const hasil = inTz(tz, () => {
      const out: string[] = [];
      for (let i = 0; i < 5; i += 1) out.push(addDaysTo('2026-11-18', i));
      out.push(addDaysTo('2026-12-31', 1), addDaysTo('2026-03-08', 1), addDaysTo('2026-11-01', 1));
      return out;
    });
    expect(hasil).toEqual([
      '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
      '2027-01-01', '2026-03-09', '2026-11-02',
    ]);
  });
});
