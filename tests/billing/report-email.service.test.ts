/**
 * Emailing a report is the one path that takes a clinical document off this
 * system and hands it to a mail provider. These tests pin the three things that
 * make that safe rather than merely working: the caller's row scope is carried
 * through, an oversized file fails loudly instead of vanishing into a message
 * nobody receives, and the subject line never names the document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KcError } from '@/lib/kc-response';

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) }));
vi.mock('@/lib/db', () => ({
  prisma: { kcClinic: { findUnique: vi.fn().mockResolvedValue({ name: 'Klinik Tenang' }) } },
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  getMedReport: vi.fn().mockResolvedValue({
    id: 5, name: 'Hasil asesmen awal', patient_id: 9000001,
    upload_report: '42', date: new Date('2026-01-02'), patient_name: 'Budi Santoso',
  }),
}));
vi.mock('@/repositories/wp/patients.repo', () => ({
  findPatientById: vi.fn().mockResolvedValue({
    id: 9000001n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: 3n,
  }),
}));
vi.mock('@/lib/wp-endpoint', () => ({ fetchMedia: vi.fn() }));

import {
  emailMedReport, attachmentName, renderReportEmailHtml, renderReportEmailText, MAX_ATTACHMENT_BYTES,
} from '@/services/billing/report-email.service';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { findPatientById } from '@/repositories/wp/patients.repo';
import { sendEmail } from '@/lib/email';
import { fetchMedia } from '@/lib/wp-endpoint';

/** A media response of exactly `size` bytes, delivered in 64 KB chunks. */
function media(size: number, contentType = 'application/pdf', filename = 'upload-42.pdf') {
  return {
    contentType,
    filename,
    contentLength: null,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        let left = size;
        while (left > 0) {
          const n = Math.min(left, 64 * 1024);
          c.enqueue(new Uint8Array(n));
          left -= n;
        }
        c.close();
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchMedia as any).mockResolvedValue(media(1024));
});

describe('emailMedReport', () => {
  it('sends the document as a base64 attachment', async () => {
    await expect(emailMedReport(5, 'budi@example.test')).resolves.toBe(true);

    expect(sendEmail).toHaveBeenCalledOnce();
    const arg = (sendEmail as any).mock.calls[0][0];
    expect(arg.to).toBe('budi@example.test');
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0].content).toBe(Buffer.alloc(1024).toString('base64'));
  });

  it('forwards its scope argument to getMedReport', async () => {
    const scope = { patientId: 9000001n };
    await emailMedReport(5, 'budi@example.test', scope as any);
    expect(getMedReport).toHaveBeenCalledWith(5, scope);
  });

  it('sends nothing when the report is out of the caller\'s scope', async () => {
    (getMedReport as any).mockRejectedValueOnce(new KcError('Medical report not found', 404));

    await expect(emailMedReport(5, 'budi@example.test', { clinicId: 99n } as any))
      .rejects.toMatchObject({ httpStatus: 404 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s when the report row has no file', async () => {
    (getMedReport as any).mockResolvedValueOnce({
      id: 5, name: 'Hasil asesmen awal', patient_id: 9000001,
      upload_report: null, date: new Date(), patient_name: 'Budi Santoso',
    });

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 404 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  /**
   * The cap is counted while reading, not taken from Content-Length: the header
   * is optional (fetchMedia returns null for it) and is an upstream claim either
   * way. This media reports no length at all and is still rejected.
   */
  it('refuses a document over the size cap, and sends nothing', async () => {
    (fetchMedia as any).mockResolvedValue(media(MAX_ATTACHMENT_BYTES + 1));

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 413 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('accepts a document exactly at the cap', async () => {
    (fetchMedia as any).mockResolvedValue(media(MAX_ATTACHMENT_BYTES));

    await expect(emailMedReport(5, 'budi@example.test')).resolves.toBe(true);
  });

  it('rejects an empty recipient before touching the report', async () => {
    await expect(emailMedReport(5, '')).rejects.toMatchObject({ httpStatus: 400 });
    expect(getMedReport).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only recipient before touching the report', async () => {
    await expect(emailMedReport(5, '   ')).rejects.toMatchObject({ httpStatus: 400 });
    expect(getMedReport).not.toHaveBeenCalled();
  });

  it('turns a refused send into a 502 rather than reporting success', async () => {
    (sendEmail as any).mockResolvedValueOnce({ ok: false, error: 'domain not verified' });

    await expect(emailMedReport(5, 'budi@example.test')).rejects.toMatchObject({ httpStatus: 502 });
  });
});

describe('the subject line', () => {
  it('names the clinic, never the document', async () => {
    await emailMedReport(5, 'budi@example.test');

    const { subject } = (sendEmail as any).mock.calls[0][0];
    expect(subject).toBe('Laporan sesi dari Klinik Tenang');
    expect(subject).not.toContain('asesmen');
  });

  it('falls back when the client belongs to no clinic', async () => {
    (findPatientById as any).mockResolvedValueOnce({
      id: 9000001n, email: 'budi@example.test', displayName: 'Budi Santoso', clinicId: null,
    });

    await emailMedReport(5, 'budi@example.test');

    expect((sendEmail as any).mock.calls[0][0].subject).toBe('Laporan sesi Anda');
  });
});

describe('the email body', () => {
  it('addresses the client in the psychology register, not the medical one', () => {
    const html = renderReportEmailHtml({
      clientName: 'Budi Santoso', reportName: 'Hasil asesmen awal', clinicName: 'Klinik Tenang',
    });

    expect(html).toContain('Budi Santoso');
    expect(html).toContain('Hasil asesmen awal');
    expect(html).not.toMatch(/\b(pasien|dokter|medis)\b/i);
  });

  it('escapes a name that carries markup', () => {
    const html = renderReportEmailHtml({
      clientName: '<script>alert(1)</script>', reportName: null, clinicName: null,
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes markup in the report name and the clinic name too', () => {
    const html = renderReportEmailHtml({
      clientName: 'Budi Santoso',
      reportName: '<b>Hasil</b>',
      clinicName: '<i>Klinik</i>',
    });

    expect(html).not.toContain('<b>Hasil</b>');
    expect(html).toContain('&lt;b&gt;Hasil&lt;/b&gt;');
    expect(html).not.toContain('<i>Klinik</i>');
    expect(html).toContain('&lt;i&gt;Klinik&lt;/i&gt;');
  });
});

describe('renderReportEmailText', () => {
  it('addresses the client in the psychology register, not the medical one', () => {
    const text = renderReportEmailText({
      clientName: 'Budi Santoso', reportName: 'Hasil asesmen awal', clinicName: 'Klinik Tenang',
    });

    expect(text).toContain('Budi Santoso');
    expect(text).toContain('Hasil asesmen awal');
    expect(text).toContain('Klinik Tenang');
    expect(text).not.toMatch(/\b(pasien|dokter|medis)\b/i);
  });

  it('falls back to the generic greeting, report name and no clinic clause when all copy is null', () => {
    const text = renderReportEmailText({ clientName: null, reportName: null, clinicName: null });

    expect(text).toContain('Halo Bapak/Ibu,');
    expect(text).toContain('Terlampir laporan sesi Anda.');
    expect(text).not.toMatch(/\b(pasien|dokter|medis)\b/i);
  });
});

describe('attachmentName', () => {
  it('uses the name the clinician typed', () => {
    expect(attachmentName('Hasil asesmen awal.pdf', 'upload-42.pdf')).toBe('Hasil asesmen awal.pdf');
  });

  it('borrows the extension when the typed name has none', () => {
    expect(attachmentName('Hasil asesmen awal', 'upload-42.pdf')).toBe('Hasil asesmen awal.pdf');
  });

  it('falls back to the upload name when the report is unnamed', () => {
    expect(attachmentName(null, 'upload-42.pdf')).toBe('upload-42.pdf');
    expect(attachmentName('   ', 'upload-42.pdf')).toBe('upload-42.pdf');
  });

  it('strips characters that would break the MIME header or escape the filename', () => {
    expect(attachmentName('../../etc/passwd', 'upload-42.pdf')).not.toContain('/');
    expect(attachmentName('a"b\nc', 'upload-42.pdf')).not.toMatch(/["\n]/);
  });
});
