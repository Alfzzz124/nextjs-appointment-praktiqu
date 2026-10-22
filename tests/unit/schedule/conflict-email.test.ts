import { describe, expect, it } from 'vitest';
import { buildScheduleConflictEmail, type ConflictMailPair } from '@/services/schedule/conflict-email';

const pasangan: ConflictMailPair = {
  date: '2026-10-23', // a Friday
  professionalName: 'Dianda Uji',
  low: {
    id: 3401, startTime: '09:00:00', endTime: '10:00:00', clientName: 'Klien A',
    serviceName: 'Konseling Individu', clinicName: 'Klinik Uji', status: 1,
  },
  high: {
    id: 3405, startTime: '09:30:00', endTime: '10:30:00', clientName: 'Klien B',
    serviceName: 'Konseling Individu', clinicName: 'Klinik Uji', status: 2,
  },
};

describe('buildScheduleConflictEmail', () => {
  it('counts the pairs in the subject', () => {
    expect(buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan] }).subject).toBe(
      'Jadwal bentrok: 1 pasang janji temu tumpang tindih',
    );
    expect(
      buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan, { ...pasangan, date: '2026-10-24' }] })
        .subject,
    ).toBe('Jadwal bentrok: 2 pasang janji temu tumpang tindih');
  });

  it('lists each pair by date and psikolog, one line per appointment', () => {
    const { text } = buildScheduleConflictEmail({ recipientName: 'Admin Klinik', pairs: [pasangan] });
    expect(text).toContain('Halo Admin Klinik,');
    expect(text).toContain('Jumat, 23 Oktober 2026 — Dianda Uji');
    expect(text).toContain('#3401 · 09:00–10:00 · Klien A · Konseling Individu · Klinik Uji · Terjadwal');
    expect(text).toContain('#3405 · 09:30–10:30 · Klien B · Konseling Individu · Klinik Uji · Menunggu');
  });

  it('says nothing was changed and what to do', () => {
    const { text, html } = buildScheduleConflictEmail({ recipientName: 'Dianda', pairs: [pasangan] });
    const penutup = 'Tidak ada yang kami ubah otomatis — kedua janji temu tetap berlaku dan klien tidak diberi tahu. Pindahkan atau batalkan salah satunya.';
    expect(text).toContain(penutup);
    expect(html).toContain(penutup);
  });

  it('labels check-in and falls back for an unknown status', () => {
    const { text } = buildScheduleConflictEmail({
      recipientName: 'Dianda',
      pairs: [{ ...pasangan, low: { ...pasangan.low, status: 4 }, high: { ...pasangan.high, status: 9 } }],
    });
    expect(text).toContain('· Check-in');
    expect(text).toContain('· Status 9');
  });

  it('escapes names in the html but not in the text', () => {
    const { html, text } = buildScheduleConflictEmail({
      recipientName: '<b>Admin</b>',
      pairs: [{ ...pasangan, low: { ...pasangan.low, clientName: 'A & <i>B</i>' } }],
    });
    expect(html).toContain('Halo &lt;b&gt;Admin&lt;/b&gt;,');
    expect(html).toContain('A &amp; &lt;i&gt;B&lt;/i&gt;');
    expect(html).not.toContain('<i>B</i>');
    expect(text).toContain('A & <i>B</i>');
  });
});
