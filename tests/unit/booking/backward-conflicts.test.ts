/**
 * Mencari janji temu yang bentrok dengan agenda pribadi psikolog di Google.
 *
 * Arahnya mundur: janji temunya sudah ada lebih dulu, lalu agenda pribadinya
 * ditambahkan di atasnya. Pembacaan slot tidak menolong di sini — slot itu
 * dihitung untuk yang BELUM dipesan.
 *
 * Aturannya tetap sama dengan seluruh jalur slot: tumpang tindih half-open,
 * jadi janji temu yang selesai tepat saat blok mulai bukan bentrok.
 */
import { describe, it, expect } from 'vitest';
import { findBackwardConflicts } from '@/services/booking/backward-conflicts';

const janji = (date: string, startTime: string, endTime: string, id = 1) => ({
  id,
  startDate: date,
  startTime,
  endTime,
});

describe('findBackwardConflicts', () => {
  it('menemukan janji temu yang tertimpa blok Google', () => {
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '14:00:00', '15:00:00', 11)],
      busyByDate: { '2026-09-20': [{ start: 14 * 60, end: 15 * 60 }] },
    });
    expect(out).toEqual([
      { appointmentId: 11, date: '2026-09-20', startTime: '14:00:00', endTime: '15:00:00',
        busy: { start: 840, end: 900 } },
    ]);
  });

  it('menemukan tumpang tindih sebagian', () => {
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '14:00:00', '15:00:00', 11)],
      busyByDate: { '2026-09-20': [{ start: 14 * 60 + 30, end: 16 * 60 }] },
    });
    expect(out).toHaveLength(1);
  });

  it('tidak menganggap bentrok janji temu yang selesai tepat saat blok mulai', () => {
    // Half-open, sama seperti seluruh aritmetika slot. Tanpa ini setiap janji
    // temu yang bersambung langsung dengan agenda pribadi akan dilaporkan.
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '13:00:00', '14:00:00', 11)],
      busyByDate: { '2026-09-20': [{ start: 14 * 60, end: 15 * 60 }] },
    });
    expect(out).toEqual([]);
  });

  it('tidak menganggap bentrok janji temu yang mulai tepat saat blok selesai', () => {
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '15:00:00', '16:00:00', 11)],
      busyByDate: { '2026-09-20': [{ start: 14 * 60, end: 15 * 60 }] },
    });
    expect(out).toEqual([]);
  });

  it('mengabaikan blok pada tanggal lain', () => {
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '14:00:00', '15:00:00', 11)],
      busyByDate: { '2026-09-21': [{ start: 14 * 60, end: 15 * 60 }] },
    });
    expect(out).toEqual([]);
  });

  it('melaporkan satu baris per janji temu meski tertimpa beberapa blok', () => {
    // Yang perlu diketahui psikolognya adalah "janji temu ini bentrok", bukan
    // rincian setiap potongan agendanya. Blok pertama yang menimpa sudah cukup
    // untuk mengenali jamnya.
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '14:00:00', '16:00:00', 11)],
      busyByDate: {
        '2026-09-20': [
          { start: 14 * 60, end: 14 * 60 + 30 },
          { start: 15 * 60, end: 15 * 60 + 30 },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].busy).toEqual({ start: 840, end: 870 });
  });

  it('melewati janji temu tanpa jam tercatat', () => {
    const out = findBackwardConflicts({
      appointments: [{ id: 11, startDate: '2026-09-20', startTime: null, endTime: null }],
      busyByDate: { '2026-09-20': [{ start: 0, end: 1440 }] },
    });
    expect(out).toEqual([]);
  });

  it('mengembalikan kosong ketika tidak ada blok sama sekali', () => {
    const out = findBackwardConflicts({
      appointments: [janji('2026-09-20', '14:00:00', '15:00:00')],
      busyByDate: {},
    });
    expect(out).toEqual([]);
  });
});
