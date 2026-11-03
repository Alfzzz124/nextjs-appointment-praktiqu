/**
 * The two "jadwal dipindah" emails (spec 2026-10-21 §5.2). Pure builders, like the approval
 * emails: the copy is pinned without a mock. Names and the reason are free text and must
 * be escaped in HTML.
 */
import { describe, expect, it } from 'vitest';
import {
  buildClientRescheduledEmail,
  buildProfessionalRescheduledEmail,
  type RescheduleMailFacts,
} from '@/services/session/reschedule-email';

// Rabu, 21 Oktober 2026 09:00 WIB → Kamis, 22 Oktober 2026 10:00 WIB.
const FACTS: RescheduleMailFacts = {
  clientName: 'Ada <b>Lovelace</b>',
  professionalName: 'Dianda Psikolog',
  serviceName: 'Konseling Individu',
  startsAtUtc: new Date('2026-10-22T03:00:00.000Z'),
  previousStartsAtUtc: new Date('2026-10-21T02:00:00.000Z'),
  timezone: 'Asia/Jakarta',
  reason: 'Psikolog <i>sakit</i>',
};

describe('buildClientRescheduledEmail', () => {
  it('tells the client the old and the new time', () => {
    const m = buildClientRescheduledEmail(FACTS);
    expect(m.subject).toBe('Jadwal sesi Anda dipindah');
    expect(m.text).toContain('Jadwal lama: Rabu, 21 Oktober 2026, 09:00');
    expect(m.text).toContain('Jadwal baru: Kamis, 22 Oktober 2026, 10:00');
    expect(m.text).toContain('Layanan: Konseling Individu');
    expect(m.text).toContain('Psikolog: Dianda Psikolog');
    expect(m.text).toContain('Alasan: Psikolog <i>sakit</i>');
  });

  it('leaves the reason out when there is none', () => {
    const m = buildClientRescheduledEmail({ ...FACTS, reason: undefined });
    expect(m.text).not.toContain('Alasan');
    expect(m.html).not.toContain('Alasan');
  });

  it('carries the online session link when there is one', () => {
    const m = buildClientRescheduledEmail({ ...FACTS, meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(m.text).toContain('Link sesi online: https://meet.google.com/abc-defg-hij');
    expect(m.html).toContain('<a href="https://meet.google.com/abc-defg-hij">');
    expect(buildClientRescheduledEmail(FACTS).text).not.toContain('Link sesi online');
  });

  it('escapes names and the reason in the HTML part only', () => {
    const m = buildClientRescheduledEmail(FACTS);
    expect(m.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(m.html).toContain('Psikolog &lt;i&gt;sakit&lt;/i&gt;');
    expect(m.html).not.toContain('<i>sakit</i>');
  });
});

describe('buildProfessionalRescheduledEmail', () => {
  it('tells the psychologist whose session moved, and where to', () => {
    const m = buildProfessionalRescheduledEmail(FACTS);
    expect(m.subject).toBe('Jadwal sesi dipindah: Ada <b>Lovelace</b>');
    expect(m.text).toContain('Halo Dianda Psikolog,');
    expect(m.text).toContain('Klien: Ada <b>Lovelace</b>');
    expect(m.text).toContain('Jadwal lama: Rabu, 21 Oktober 2026, 09:00');
    expect(m.text).toContain('Jadwal baru: Kamis, 22 Oktober 2026, 10:00');
    expect(m.text).toContain('Alasan: Psikolog <i>sakit</i>');
    expect(m.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
  });
});
