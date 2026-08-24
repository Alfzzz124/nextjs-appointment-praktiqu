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
}));

import { listEncounterDocuments } from '@/services/encounter-documents/service';
import { listBookingAttachments, listLinkedReportIds } from '@/repositories/wp/encounter-documents.repo';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import { listMedReports } from '@/services/billing/patient-medical-report.service';

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

  it('puts a linked report in the session section and the rest in the archive', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi'), report(12, 'Hasil tes lama')],
      pagination: { page: 1, perPage: 20, total: 2 },
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
  });

  it('denies manage to a CLIENT on every document', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, CLIENT, { page: 1, perPage: 20 });

    expect(out.sessionDocuments[0].canManage).toBe(false);
  });

  it('drops a link that points at a document which no longer exists', async () => {
    vi.mocked(listLinkedReportIds).mockResolvedValue([11, 999]);
    vi.mocked(listMedReports).mockResolvedValue({
      reports: [report(11, 'Resume sesi')],
      pagination: { page: 1, perPage: 20, total: 1 },
    } as any);

    const out = await listEncounterDocuments(55, PROFESSIONAL, { page: 1, perPage: 20 });

    expect(out.sessionDocuments.map((d) => d.id)).toEqual([11]);
    expect(out.patientDocuments).toEqual([]);
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
