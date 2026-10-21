/**
 * The four approval emails (spec §7.6). Pure builders, so the copy is pinned without a
 * single mock. Names come from free-text profile fields and must be escaped in HTML.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAdminEscalationEmail,
  buildClientAwaitingEmail,
  buildClientRejectedEmail,
  buildProfessionalRequestEmail,
  type SessionMailFacts,
} from '@/services/approval/emails';

// Kamis, 22 Oktober 2026 10:00 WIB.
const FACTS: SessionMailFacts = {
  clientName: 'Ada <b>Lovelace</b>',
  professionalName: 'Dianda Psikolog',
  serviceName: 'Konseling Individu',
  startsAtUtc: new Date('2026-10-22T03:00:00.000Z'),
  timezone: 'Asia/Jakarta',
};
const LINK = 'https://appointment.praktiqu.test/dashboard/persetujuan/7';

describe('buildClientAwaitingEmail', () => {
  it('says the payment arrived and the psychologist still has to confirm', () => {
    const m = buildClientAwaitingEmail(FACTS);
    expect(m.subject).toBe('Pembayaran diterima — menunggu konfirmasi psikolog');
    expect(m.text).toContain('Layanan: Konseling Individu');
    expect(m.text).toContain('Tanggal: Kamis, 22 Oktober 2026');
    expect(m.text).toContain('Waktu: 10:00');
    expect(m.text).toContain('Psikolog Dianda Psikolog akan mengonfirmasi jadwal ini');
    expect(m.text).toContain('klinik akan mengembalikan dana Anda');
  });

  it('escapes names in the HTML part only', () => {
    const m = buildClientAwaitingEmail(FACTS);
    expect(m.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Lovelace</b>');
    expect(m.text).toContain('Ada <b>Lovelace</b>');
  });
});

describe('buildProfessionalRequestEmail', () => {
  it('first mail: new booking, with the link', () => {
    const m = buildProfessionalRequestEmail({ ...FACTS, link: LINK, waitingSince: null });
    expect(m.subject).toBe('Booking baru menunggu persetujuan Anda: Kamis, 22 Oktober 2026 pukul 10:00');
    expect(m.html).toContain(`<a href="${LINK}">Buka permintaan</a>`);
    expect(m.text).toContain(`Buka permintaan: ${LINK}`);
    expect(m.text).toContain('sudah membayar sesi berikut');
  });

  it('reminder: names the client and how long it has waited', () => {
    const m = buildProfessionalRequestEmail({
      ...FACTS,
      link: LINK,
      waitingSince: new Date('2026-10-20T02:00:00.000Z'),
    });
    expect(m.subject).toBe('Pengingat: booking Ada <b>Lovelace</b> masih menunggu persetujuan Anda');
    expect(m.text).toContain('sejak Selasa, 20 Oktober 2026 pukul 09:00');
  });
});

describe('buildAdminEscalationEmail', () => {
  it('names the psychologist, the wait and the link', () => {
    const m = buildAdminEscalationEmail({
      ...FACTS,
      adminName: 'Rina',
      link: 'https://appointment.praktiqu.test/dashboard/persetujuan/7',
      requestedAt: new Date('2026-10-20T02:00:00.000Z'),
    });
    expect(m.subject).toBe('Booking menunggu persetujuan psikolog: Dianda Psikolog, Kamis, 22 Oktober 2026');
    expect(m.text).toContain('Halo Rina,');
    expect(m.text).toContain('sejak Selasa, 20 Oktober 2026 pukul 09:00');
    expect(m.text).toContain('atas nama psikolog');
  });
});

describe('buildClientRejectedEmail', () => {
  it('apologises, promises the refund and gives the clinic contact', () => {
    const m = buildClientRejectedEmail({
      ...FACTS,
      clinicName: 'Klinik Sehat',
      clinicEmail: 'halo@klinik.test',
      clinicPhone: '0221234567',
    });
    expect(m.subject).toBe('Jadwal sesi Anda tidak dapat diterima');
    expect(m.text).toContain('psikolog Dianda Psikolog tidak dapat menerima jadwal berikut');
    expect(m.text).toContain('Pembayaran Anda akan dikembalikan oleh Klinik Sehat');
    expect(m.text).toContain('halo@klinik.test · 0221234567');
  });

  it('leaves the contact line out when the clinic has none', () => {
    const m = buildClientRejectedEmail({ ...FACTS, clinicName: 'Klinik Sehat', clinicEmail: null, clinicPhone: null });
    expect(m.text).toContain('hubungi Klinik Sehat.');
    expect(m.text).not.toContain(' · ');
  });
});
