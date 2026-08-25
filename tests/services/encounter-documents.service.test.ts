/**
 * The service owns three decisions the repositories deliberately do not:
 * which section a document lands in, whether the caller may manage it, and what
 * `contentPath` the front-end should call. Everything below the service is mocked
 * so those decisions are tested on their own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/wp/encounter-documents.repo', () => ({
  ENCOUNTER_DOC_MODULE_TYPE: 'praktiqu_report_encounter',
  listLinkedReportIds: vi.fn(),
  listBookingAttachments: vi.fn(),
  linkReportToEncounter: vi.fn(),
  unlinkReport: vi.fn(),
}));
vi.mock('@/repositories/wp/clinical-records.repo', () => ({
  findEncounterById: vi.fn(),
}));
vi.mock('@/services/billing/patient-medical-report.service', () => ({
  listMedReports: vi.fn(),
  listMedReportsByIds: vi.fn(),
  createMedReport: vi.fn(),
}));
vi.mock('@/lib/wp-endpoint', () => ({ uploadMedia: vi.fn() }));

import { listEncounterDocuments, uploadEncounterDocument } from '@/services/encounter-documents/service';
import { listBookingAttachments, listLinkedReportIds, linkReportToEncounter } from '@/repositories/wp/encounter-documents.repo';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import { listMedReports, listMedReportsByIds, createMedReport } from '@/services/billing/patient-medical-report.service';
import { uploadMedia } from '@/lib/wp-endpoint';

const ENCOUNTER = { id: 55, clinicId: 1, doctorId: 7, patientId: 9, appointmentId: 77, description: null, status: 1, addedBy: 7, encounterDate: null, createdAt: null };

const PROFESSIONAL: any = { actor: { role: 'PROFESSIONAL' }, wpUserId: 7n, clinicId: 1n };
const CLIENT: any = { actor: { role: 'CLIENT' }, wpUserId: 9n, clinicId: 1n };

function report(id: number, name: string) {
  return { id, name, patient_id: 9, upload_report: String(1000 + id), date: '2026-08-01', patient_name: 'Klien' };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findEncounterById).mockResolvedValue(ENCOUNTER as any);
  vi.mocked(listLinkedReportIds).mockResolvedValue([]);
  vi.mocked(listBookingAttachments).mockResolvedValue([]);
  vi.mocked(listMedReports).mockResolvedValue({ reports: [], pagination: { page: 1, perPage: 20, total: 0 } } as any);
  vi.mocked(listMedReportsByIds).mockResolvedValue([]);
});

describe('listEncounterDocuments', () => {
  it('puts booking attachments in the session section, marked as such', async () => {
    vi.mocked(listBookingAttachments).mockResolvedValue([
      { mediaId: 301, filename: 'hasil-tes.pdf', mimeType: 'application/pdf', missing: false },
    ]);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments).toHaveLength(1);
    expect(out.sessionDocuments[0]).toMatchObject({
      id: 301,
      source: 'booking',
      filename: 'hasil-tes.pdf',
      contentPath: '/api/v1/sessions/77/attachments/301/content',
    });
  });

  it('never offers manage on a booking attachment, even to staff', async () => {
    vi.mocked(listBookingAttachments).mockResolvedValue([
      { mediaId: 301, filename: 'x.pdf', mimeType: 'application/pdf', missing: false },
    ]);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    // We never write appointment_report, so rename/delete could not work.
    expect(out.sessionDocuments[0].canManage).toBe(false);
  });

  it('puts a linked report in the session section and the rest in the archive, and total agrees with the archive page', async () => {
    // The archive query is expected to have already excluded id 11 (via `excludeIds`),
    // so both its rows and its COUNT(*) reflect only the un-linked remainder.
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReportsByIds).mockResolvedValue([report(11, 'Resume sesi')]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(12, 'Hasil tes lama')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments.map((d) => d.id)).toEqual([11]);
    expect(out.sessionDocuments[0]).toMatchObject({
      source: 'report',
      name: 'Resume sesi',
      contentPath: '/api/v1/patient-medical-reports/11/content',
      canManage: true,
    });
    expect(out.patientDocuments.map((d) => d.id)).toEqual([12]);
    // total (1) equals the length of patientDocuments (1): the section and the count agree.
    expect(out.pagination.total).toBe(out.patientDocuments.length);

    expect(listMedReportsByIds).toHaveBeenCalledWith([11], expect.anything());
    expect(listMedReports).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: [11] }),
      expect.anything(),
    );
  });

  it('does not call listMedReportsByIds, and requests no exclusion, when nothing is linked', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(12, 'Hasil tes lama')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(listMedReportsByIds).not.toHaveBeenCalled();
    expect(listMedReports).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: [] }),
      expect.anything(),
    );
    expect(out.sessionDocuments).toEqual([]);
    expect(out.patientDocuments.map((d) => d.id)).toEqual([12]);
  });

  it('denies manage to a CLIENT on every document', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReportsByIds).mockResolvedValue([report(11, 'Resume sesi')]);

    const out = await listEncounterDocuments(55, CLIENT, { page: 1, perPage: 20 });

    expect(out.sessionDocuments[0].canManage).toBe(false);
  });

  it('drops a link that points at a document which no longer exists', async () => {
    // listMedReportsByIds is the source of truth for which linked ids still resolve;
    // 999 is simply absent from what it returns (deleted, or scoped out).
    vi.mocked(listLinkedReportIds).mockResolvedValue([11, 999]);
    vi.mocked(listMedReportsByIds).mockResolvedValue([report(11, 'Resume sesi')]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [],
      pagination: { page: 1, perPage: 20, total: 0 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments.map((d) => d.id)).toEqual([11]);
    expect(out.patientDocuments).toEqual([]);
    expect(listMedReportsByIds).toHaveBeenCalledWith([11, 999], expect.anything());
  });

  it('returns an empty session section when the encounter has no appointment', async () => {
    vi.mocked(findEncounterById).mockResolvedValue({ ...ENCOUNTER, appointmentId: null } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(listBookingAttachments).not.toHaveBeenCalled();
    expect(out.sessionDocuments).toEqual([]);
  });

  it('throws 404 for an encounter that does not exist', async () => {
    vi.mocked(findEncounterById).mockResolvedValue(null);

    await expect(listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('throws 404 when the encounter belongs to another professional', async () => {
    const otherDoctor: any = { actor: { role: 'PROFESSIONAL' }, wpUserId: 8n, clinicId: 1n };

    await expect(listEncounterDocuments(55, otherDoctor, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('throws 404 when the encounter belongs to another client', async () => {
    const otherClient: any = { actor: { role: 'CLIENT' }, wpUserId: 10n, clinicId: 1n };

    await expect(listEncounterDocuments(55, otherClient, { page: 1, perPage: 20 }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  it('passes pagination through to the archive read', async () => {
    await listEncounterDocuments(55, PROFESSIONAL, { page: 3, perPage: 5 });

    expect(listMedReports).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, perPage: 5, patientId: 9 }),
      expect.anything(),
    );
  });
});

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('uploadEncounterDocument', () => {
  beforeEach(() => {
    vi.mocked(uploadMedia).mockResolvedValue({ mediaId: 4242, url: '', name: 'resume.pdf' } as any);
    vi.mocked(createMedReport).mockResolvedValue({ id: 88 } as any);
    vi.mocked(linkReportToEncounter).mockResolvedValue(undefined as any);
  });

  it('writes media, then the document row, then the link — in that order', async () => {
    const order: string[] = [];
    vi.mocked(uploadMedia).mockImplementation(async () => { order.push('media'); return { mediaId: 4242, url: '', name: 'resume.pdf' } as any; });
    vi.mocked(createMedReport).mockImplementation(async () => { order.push('report'); return { id: 88 } as any; });
    vi.mocked(linkReportToEncounter).mockImplementation(async () => { order.push('link'); });

    const out = await uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'Resume sesi' }, PROFESSIONAL,
    );

    // MyISAM cannot roll back, so the order is the safety mechanism: a failure after
    // the report row still leaves a usable document in the patient archive.
    expect(order).toEqual(['media', 'report', 'link']);
    expect(out).toEqual({ id: 88, mediaId: 4242, linked: true });
  });

  it('always uploads into the protected medical-report folder', async () => {
    await uploadEncounterDocument(55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL);

    // kivicare-uploads is world-readable; clinical documents must never land there.
    expect(uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ context: 'medical-report' }));
  });

  it('refuses a file whose bytes are not an allowed type', async () => {
    await expect(uploadEncounterDocument(
      55, { filename: 'notes.pdf', bytes: new TextEncoder().encode('hello'), name: 'R' }, PROFESSIONAL,
    )).rejects.toMatchObject({ httpStatus: 422 });

    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('refuses a file whose extension disagrees with its bytes', async () => {
    await expect(uploadEncounterDocument(
      55, { filename: 'resume.png', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL,
    )).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('refuses a CLIENT (403) before touching the media library', async () => {
    // Deliberately a *different* id than the encounter's patientId (9): `assertCan`
    // denies CLIENT for `patient_report_manage` regardless of whose encounter this
    // is, so giving this client the patient's own id would only prove assertCan
    // fires first, not that the role gate itself is what stops it. See I1.
    const unrelatedClient: any = { actor: { role: 'CLIENT' }, wpUserId: 999n, clinicId: 1n };

    await expect(uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, unrelatedClient,
    )).rejects.toMatchObject({ httpStatus: 403 });

    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('throws 404 when a professional other than the encounter\'s doctor attempts to upload', async () => {
    // I1: a reviewer deleted `assertEncounterVisible(encounter, kc)` from
    // `uploadEncounterDocument` and every existing upload test still passed,
    // because every one of them used a professional whose wpUserId equals the
    // encounter's doctorId (7). This professional's id (8) does not, so this
    // only passes when that ownership check actually runs.
    const otherDoctor: any = { actor: { role: 'PROFESSIONAL' }, wpUserId: 8n, clinicId: 1n };

    await expect(uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, otherDoctor,
    )).rejects.toMatchObject({ httpStatus: 404 });

    // The ownership check must fail before any bytes are touched.
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(createMedReport).not.toHaveBeenCalled();
  });

  it('reports linked:false rather than failing when only the link write fails', async () => {
    vi.mocked(linkReportToEncounter).mockRejectedValue(new Error('MyISAM said no'));

    const out = await uploadEncounterDocument(
      55, { filename: 'resume.pdf', bytes: PDF_BYTES, name: 'R' }, PROFESSIONAL,
    );

    // The document exists and is reachable from the patient archive. Failing the
    // whole request would strand a file the caller cannot see or retry cleanly.
    expect(out).toEqual({ id: 88, mediaId: 4242, linked: false });
  });
});
