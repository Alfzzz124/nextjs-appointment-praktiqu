/**
 * Murni, tanpa mock: sesi + penerima + offset → subjek dan isi.
 *
 * Yang dipaku di sini adalah hal-hal yang gampang rusak diam-diam: tanggal berbahasa
 * Indonesia, dan perbedaan sudut pandang antara email untuk klien ("sesi Anda dengan
 * Pamela Dewi") dan untuk profesional ("sesi Anda dengan Ada Lovelace").
 */
import { describe, expect, it } from 'vitest';
import { buildSessionReminderEmail } from '@/services/session/reminder-email';

// Kamis, 10 September 2026, 09:30 di Asia/Jakarta = 02:30 UTC.
const STARTS_AT = new Date('2026-09-10T02:30:00Z');

const base = {
  clientName: 'Ada Lovelace',
  professionalName: 'Pamela Dewi',
  startsAtUtc: STARTS_AT,
  timezone: 'Asia/Jakarta',
} as const;

describe('buildSessionReminderEmail', () => {
  it('menulis tanggal dan jam dalam Bahasa Indonesia pada zona waktu klinik', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });

    expect(mail.text).toContain('Kamis, 10 September 2026');
    expect(mail.text).toContain('09:30');
  });

  it('memberi tahu klien nama profesionalnya', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });

    expect(mail.text).toContain('Pamela Dewi');
    expect(mail.html).toContain('Ada Lovelace'); // sapaan
  });

  it('memberi tahu profesional nama kliennya', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'professional' });

    expect(mail.text).toContain('Ada Lovelace');
    expect(mail.html).toContain('Pamela Dewi'); // sapaan
  });

  it('membedakan subjek pengingat besok dari yang satu jam lagi', () => {
    const h24 = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });
    const h1 = buildSessionReminderEmail({ ...base, offset: 'email_1h', recipient: 'client' });

    expect(h24.subject).not.toBe(h1.subject);
    expect(h24.subject.toLowerCase()).toContain('besok');
    expect(h1.subject).toContain('1 jam');
  });

  it('mengisi ketiga bagian untuk setiap kombinasi', () => {
    for (const offset of ['email_24h', 'email_1h'] as const) {
      for (const recipient of ['client', 'professional'] as const) {
        const mail = buildSessionReminderEmail({ ...base, offset, recipient });
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('menghormati zona waktu yang diberikan, bukan zona server', () => {
    const jakarta = buildSessionReminderEmail({ ...base, offset: 'email_1h', recipient: 'client' });
    const utc = buildSessionReminderEmail({ ...base, timezone: 'UTC', offset: 'email_1h', recipient: 'client' });

    expect(jakarta.text).toContain('09:30');
    expect(utc.text).toContain('02:30');
  });
});
