/**
 * Email a client's uploaded report to them.
 *
 * The recipient arrives already decided. Only the route knows whether the caller
 * is staff — who may send a copy to, say, a referring psychologist — or the
 * client themself, so the policy lives there and this function is handed one
 * finished address. Mirrors `emailBill` in `bill-document.service.ts`.
 *
 * Copy is Indonesian, in the register the rest of the client-facing mail uses:
 * sesi, klien, psikolog. This product moves KiviCare, written for medical
 * clinics, onto a psychology practice, and "pasien" is the wrong word for the
 * person reading this.
 */
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import { sendEmail } from '@/lib/email';
import { fetchMedia } from '@/lib/wp-endpoint';
import { getMedReport } from '@/services/billing/patient-medical-report.service';
import { findPatientById } from '@/repositories/wp/patients.repo';
import type { MedReportScope } from '@/services/billing/med-report-scope';

/**
 * Largest document we will attach, in bytes.
 *
 * Resend accepts 40 MB, but base64 inflates the payload by about a third and
 * Gmail rejects at 25 MB, so 15 MB raw lands near 20 MB on the wire. Past this
 * we fail loudly: without a cap the failure arrives as an email that simply
 * never turns up, with nothing on our side to show for it.
 */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface ReportEmailCopy {
  clientName: string | null;
  reportName: string | null;
  clinicName: string | null;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Read the whole stream, refusing once it passes `limit`.
 *
 * Counted here rather than read from `Content-Length`: that header is optional
 * (`fetchMedia` returns `null` when it is absent) and is an upstream claim in
 * any case. A document that lies about its size still cannot get past this.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new KcError(
        `Dokumen melebihi batas ${Math.floor(limit / (1024 * 1024))} MB untuk lampiran email`,
        413,
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/** The name the client sees on the attachment: what the clinician typed, with a usable extension. */
export function attachmentName(reportName: string | null, uploadFilename: string): string {
  const safe = (reportName ?? '').replace(/[\\/\r\n"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (safe === '') return uploadFilename;
  if (/\.[A-Za-z0-9]{1,8}$/.test(safe)) return safe;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(uploadFilename)?.[0] ?? '';
  return `${safe}${ext}`;
}

export function renderReportEmailHtml(input: ReportEmailCopy): string {
  const sapaan = input.clientName?.trim() ? escapeHtml(input.clientName.trim()) : 'Bapak/Ibu';
  const nama = input.reportName?.trim() ? escapeHtml(input.reportName.trim()) : 'laporan sesi Anda';
  const dari = input.clinicName?.trim() ? ` dari ${escapeHtml(input.clinicName.trim())}` : '';

  return `<p>Halo ${sapaan},</p>
<p>Terlampir <strong>${nama}</strong>${dari}.</p>
<p>Dokumen ini bersifat pribadi. Bila Anda menerima email ini tanpa pernah memintanya, mohon beri tahu klinik dan hapus lampirannya.</p>
<p>Salam,<br>Tim klinik</p>`;
}

export function renderReportEmailText(input: ReportEmailCopy): string {
  const sapaan = input.clientName?.trim() ?? 'Bapak/Ibu';
  const nama = input.reportName?.trim() ?? 'laporan sesi Anda';
  const dari = input.clinicName?.trim() ? ` dari ${input.clinicName.trim()}` : '';

  return `Halo ${sapaan},

Terlampir ${nama}${dari}.

Dokumen ini bersifat pribadi. Bila Anda menerima email ini tanpa pernah memintanya, mohon beri tahu klinik dan hapus lampirannya.

Salam,
Tim klinik`;
}

/** The clinic's name, or null when the client is mapped to no clinic or the row is unnamed. */
async function clinicNameFor(clinicId: bigint | null): Promise<string | null> {
  if (clinicId === null) return null;
  const clinic = await prisma.kcClinic.findUnique({ where: { id: clinicId }, select: { name: true } });
  const name = clinic?.name?.trim();
  return name ? name : null;
}

export async function emailMedReport(
  id: number,
  to: string,
  scope: MedReportScope | null = null,
): Promise<true> {
  if (!to) throw new KcError('Recipient email is required', 400);

  // Scope + existence, before a single byte is fetched or sent.
  const report = await getMedReport(id, scope);

  const mediaId = Number.parseInt(String(report.upload_report), 10);
  if (!Number.isFinite(mediaId)) throw new KcError('Document has no file', 404);

  const patient = await findPatientById(BigInt(report.patient_id));
  const clinicName = await clinicNameFor(patient?.clinicId ?? null);

  // The document's own name stays out of the subject: subjects surface in
  // lock-screen notifications, and the client did not choose to publish a
  // clinical filename there. It is in the body and on the attachment instead.
  const subject = clinicName ? `Laporan sesi dari ${clinicName}` : 'Laporan sesi Anda';

  const media = await fetchMedia(mediaId);
  const bytes = await readCapped(media.body, MAX_ATTACHMENT_BYTES);

  const copy: ReportEmailCopy = {
    clientName: report.patient_name,
    reportName: report.name,
    clinicName,
  };

  const result = await sendEmail({
    to,
    subject,
    html: renderReportEmailHtml(copy),
    text: renderReportEmailText(copy),
    // A label for the audit log only. Feature 018's templates are not wired to
    // any sender; see the spec's "Di luar cakupan".
    template: 'kivicare_patient_report',
    attachments: [{
      filename: attachmentName(report.name, media.filename),
      content: bytes.toString('base64'),
    }],
  });

  if (!result.ok) throw new KcError('Failed to send the report email', 502);
  return true;
}
