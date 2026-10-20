// tests/unit/booking/slot-math.test.ts
import { describe, it, expect } from 'vitest';
import {
  blockedRangesFor,
  buildDaySlots,
  eachDate,
  toMinutes,
  toTime,
} from '@/services/booking/slot-math';

const nineToTwelve = { startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 60 };

describe('buildDaySlots', () => {
  it('fills a window back to back', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [] })).toEqual([
      { startTime: '09:00:00', endTime: '10:00:00' },
      { startTime: '10:00:00', endTime: '11:00:00' },
      { startTime: '11:00:00', endTime: '12:00:00' },
    ]);
  });

  it('drops a slot a block partially overlaps', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60 + 30, end: 11 * 60 }], // 10:30–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('keeps the slots on either side of an exactly-aligned block', () => {
    const slots = buildDaySlots({
      windows: [nineToTwelve],
      blocked: [{ start: 10 * 60, end: 11 * 60 }], // 10:00–11:00
    });
    expect(slots.map((s) => s.startTime)).toEqual(['09:00:00', '11:00:00']);
  });

  it('lets a service duration override the window slot size', () => {
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [], durationMinutes: 90 })).toEqual([
      { startTime: '09:00:00', endTime: '10:30:00' },
      { startTime: '10:30:00', endTime: '12:00:00' },
    ]);
  });

  it('emits nothing when the window cannot fit one slot', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '09:30:00', slotDurationMinutes: 60 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('treats a zero service duration as no override, not as zero-length slots', () => {
    // `duration = 0` on a service mapping is meaningless data, not an instruction.
    // `??` only falls back on null, so a stored 0 used to survive as the slot size
    // and silently emitted nothing — a booking page that was simply empty, with
    // nothing on screen or in the logs to say why. Two of 250 live mappings had it.
    expect(buildDaySlots({ windows: [nineToTwelve], blocked: [], durationMinutes: 0 })).toEqual([
      { startTime: '09:00:00', endTime: '10:00:00' },
      { startTime: '10:00:00', endTime: '11:00:00' },
      { startTime: '11:00:00', endTime: '12:00:00' },
    ]);
  });

  it('treats a negative service duration the same way', () => {
    expect(
      buildDaySlots({ windows: [nineToTwelve], blocked: [], durationMinutes: -30 }).length,
    ).toBe(3);
  });

  it('still emits nothing when the window itself has no usable slot size', () => {
    // Berbeda: di sini memang tidak ada ukuran slot yang bisa dipakai sama sekali,
    // jadi hari itu benar-benar tidak bisa dipesan.
    expect(
      buildDaySlots({
        windows: [{ startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 0 }],
        blocked: [],
        durationMinutes: 0,
      }),
    ).toEqual([]);
  });

  it('skips a window whose duration is not positive', () => {
    const slots = buildDaySlots({
      windows: [{ startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 0 }],
      blocked: [],
    });
    expect(slots).toEqual([]);
  });

  it('handles several windows in one day', () => {
    const slots = buildDaySlots({
      windows: [
        nineToTwelve,
        { startTime: '14:00:00', endTime: '15:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [],
    });
    expect(slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00', '14:00:00',
    ]);
  });
});

describe('buildDaySlots — layanan sepanjang beberapa sesi', () => {
  const nineToFive = { startTime: '09:00:00', endTime: '17:00:00', slotDurationMinutes: 60 };

  it('menawarkan layanan 180 menit di tiga sesi 60 menit kosong yang diapit janji lain', () => {
    // Laporan 2026-10-20: tiga sesi 60′ kosong berturut-turut, tapi layanan 180′
    // tidak mendapat satu slot pun. Jam mulai dulu melompat selebar durasi layanan
    // dari awal jendela (09:00, 12:00, 15:00), jadi janji jam 09:00 dan 13:00
    // menutup semuanya — padahal 10:00–13:00 dan 14:00–17:00 kosong.
    const slots = buildDaySlots({
      windows: [nineToFive],
      blocked: [
        { start: 9 * 60, end: 10 * 60 },
        { start: 13 * 60, end: 14 * 60 },
      ],
      durationMinutes: 180,
    });
    expect(slots).toEqual([
      { startTime: '10:00:00', endTime: '13:00:00' },
      { startTime: '14:00:00', endTime: '17:00:00' },
    ]);
  });

  it('boleh mulai di batas sesi mana saja bila durasinya kelipatan sesi', () => {
    const slots = buildDaySlots({ windows: [nineToFive], blocked: [], durationMinutes: 180 });
    expect(slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:00:00', '11:00:00', '12:00:00', '13:00:00', '14:00:00',
    ]);
  });

  it('menyeberang ke jendela berikutnya yang bersambung tanpa jeda', () => {
    // Baris wp_kc_clinic_sessions yang bersambung (mis. 08:00–16:00 + 16:00–20:00
    // milik psikolog 179) adalah jam kerja yang menerus, bukan dua sesi terpisah.
    const slots = buildDaySlots({
      windows: [
        { startTime: '09:00:00', endTime: '10:00:00', slotDurationMinutes: 60 },
        { startTime: '10:00:00', endTime: '11:00:00', slotDurationMinutes: 60 },
        { startTime: '11:00:00', endTime: '12:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [],
      durationMinutes: 180,
    });
    expect(slots).toEqual([{ startTime: '09:00:00', endTime: '12:00:00' }]);
  });

  it('tidak menyeberangi istirahat', () => {
    const slots = buildDaySlots({
      windows: [
        { startTime: '09:00:00', endTime: '11:00:00', slotDurationMinutes: 60 },
        { startTime: '11:30:00', endTime: '13:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [],
      durationMinutes: 180,
    });
    expect(slots).toEqual([]);
  });

  it('jendela bersambung tetap tidak boleh menembus janji yang ada', () => {
    const slots = buildDaySlots({
      windows: [
        { startTime: '08:00:00', endTime: '16:00:00', slotDurationMinutes: 60 },
        { startTime: '16:00:00', endTime: '20:00:00', slotDurationMinutes: 60 },
      ],
      blocked: [{ start: 8 * 60, end: 15 * 60 }],
      durationMinutes: 180,
    });
    expect(slots.map((s) => `${s.startTime}-${s.endTime}`)).toEqual([
      '15:00:00-18:00:00', '16:00:00-19:00:00', '17:00:00-20:00:00',
    ]);
  });

  it('layanan yang bukan kelipatan sesi tetap berjarak selebar durasinya sendiri', () => {
    // 90′ di kisi 60′ bukan sejumlah sesi utuh; jaraknya dibiarkan seperti dulu
    // (09:00, 10:30, …) agar hari yang penuh tetap muat sebanyak mungkin janji.
    const slots = buildDaySlots({ windows: [nineToFive], blocked: [], durationMinutes: 90 });
    expect(slots.map((s) => s.startTime)).toEqual([
      '09:00:00', '10:30:00', '12:00:00', '13:30:00', '15:00:00',
    ]);
  });

  it('tidak pernah menghilangkan slot yang ditawarkan aturan lama', () => {
    // Aturan lama: per jendela, melompat selebar durasi, harus muat di jendelanya.
    const oldRule = (windows: { startTime: string; endTime: string; slotDurationMinutes: number }[],
      blocked: { start: number; end: number }[], duration: number) =>
      windows.flatMap((w) => {
        const out: string[] = [];
        for (let s = toMinutes(w.startTime); s + duration <= toMinutes(w.endTime); s += duration) {
          if (!blocked.some((b) => b.start < s + duration && b.end > s)) out.push(toTime(s));
        }
        return out;
      });

    const layouts = [
      [nineToFive],
      [{ startTime: '08:00:00', endTime: '16:00:00', slotDurationMinutes: 60 },
        { startTime: '16:00:00', endTime: '20:00:00', slotDurationMinutes: 60 }],
      [{ startTime: '09:00:00', endTime: '12:00:00', slotDurationMinutes: 45 },
        { startTime: '13:00:00', endTime: '17:30:00', slotDurationMinutes: 45 }],
      [{ startTime: '17:00:00', endTime: '18:30:00', slotDurationMinutes: 30 },
        { startTime: '18:30:00', endTime: '20:00:00', slotDurationMinutes: 90 }],
    ];
    const blocks = [[], [{ start: 600, end: 660 }], [{ start: 540, end: 590 }, { start: 780, end: 840 }]];

    for (const windows of layouts) {
      for (const blocked of blocks) {
        for (const duration of [30, 45, 50, 60, 90, 120, 135, 180, 240]) {
          const now = buildDaySlots({ windows, blocked, durationMinutes: duration }).map((s) => s.startTime);
          for (const start of oldRule(windows, blocked, duration)) expect(now).toContain(start);
        }
      }
    }
  });
});

describe('blockedRangesFor', () => {
  it('returns null when a full-day off day covers the date', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: false, startTime: null, endTime: null }],
      appointments: [],
    });
    expect(blocked).toBeNull();
  });

  it('returns an empty list when nothing blocks', () => {
    expect(blockedRangesFor({ offDays: [], appointments: [] })).toEqual([]);
  });

  it('converts a time-specific off day', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' }],
      appointments: [],
    });
    expect(blocked).toEqual([{ start: 600, end: 660 }]);
  });

  it('converts an appointment', () => {
    const blocked = blockedRangesFor({
      offDays: [],
      appointments: [{ startTime: '14:00:00', endTime: '15:00:00' }],
    });
    expect(blocked).toEqual([{ start: 840, end: 900 }]);
  });

  it('combines off days and appointments', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: '10:00:00', endTime: '11:00:00' }],
      appointments: [{ startTime: '14:00:00', endTime: '15:00:00' }],
    });
    expect(blocked).toEqual([{ start: 600, end: 660 }, { start: 840, end: 900 }]);
  });

  it('skips a time-specific off day with no times recorded', () => {
    const blocked = blockedRangesFor({
      offDays: [{ timeSpecific: true, startTime: null, endTime: null }],
      appointments: [],
    });
    expect(blocked).toEqual([]);
  });

  it('skips an appointment with no times recorded', () => {
    const blocked = blockedRangesFor({
      offDays: [],
      appointments: [{ startTime: '14:00:00', endTime: null }],
    });
    expect(blocked).toEqual([]);
  });
});

describe('eachDate', () => {
  it('includes both ends', () => {
    expect(eachDate('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28', '2026-08-29', '2026-08-30',
    ]);
  });

  it('returns one date when from equals to', () => {
    expect(eachDate('2026-08-28', '2026-08-28')).toEqual(['2026-08-28']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(eachDate('2026-08-30', '2026-08-28')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(eachDate('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01',
    ]);
  });
});

describe('toMinutes / toTime', () => {
  it('round-trips a time', () => {
    expect(toTime(toMinutes('14:45:00'))).toBe('14:45:00');
  });

  it('converts midnight to zero', () => {
    expect(toMinutes('00:00:00')).toBe(0);
  });
});
