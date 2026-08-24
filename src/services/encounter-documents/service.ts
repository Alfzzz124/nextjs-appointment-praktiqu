/**
 * The documents visible from one encounter.
 *
 * Two sections, because the two stores mean different things:
 *
 * - `sessionDocuments` — what belongs to this session: the files that arrived with
 *   the booking, plus documents a clinician linked to this encounter.
 * - `patientDocuments` — the rest of the patient's archive, paginated, because an
 *   archive grows without bound while a session's set does not.
 *
 * Authorisation happens twice on purpose. The encounter itself is scoped here, so a
 * professional cannot browse another doctor's session; the archive read is scoped by
 * `medReportScopeFor` inside `listMedReports`, which is clinic-wide. That asymmetry
 * predates this feature and is documented as D7 in the design — it is inherited
 * deliberately, not overlooked.
 */
import { KcError } from '@/lib/kc-response';
import type { KcActor } from '@/services/billing/kc-actor';
import { medReportScopeFor } from '@/services/billing/med-report-scope';
import { listMedReports } from '@/services/billing/patient-medical-report.service';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import {
  listBookingAttachments,
  listLinkedReportIds,
} from '@/repositories/wp/encounter-documents.repo';
import { assertCan } from '@/services/billing/kc-permissions';

export type DocumentSource = 'booking' | 'report';

export interface EncounterDocument {
  /** Report id for `report`; WP attachment id for `booking`. */
  id: number;
  source: DocumentSource;
  name: string;
  filename: string;
  mimeType: string | null;
  /** `YYYY-MM-DD`, or null when KiviCare stored none. */
  date: string | null;
  contentPath: string;
  canManage: boolean;
  missing: boolean;
}

export interface EncounterDocuments {
  sessionDocuments: EncounterDocument[];
  patientDocuments: EncounterDocument[];
  pagination: { page: number; perPage: number; total: number };
}

/** Row scope for the encounter itself, mirroring `encounterScopeFor`. */
function assertEncounterVisible(
  encounter: { doctorId: number; patientId: number; clinicId: number },
  kc: KcActor,
): void {
  const role = kc.actor.role;
  if (role === 'SUPER_ADMIN') return;
  if (role === 'PROFESSIONAL') {
    if (encounter.doctorId === Number(kc.wpUserId)) return;
    throw new KcError('Encounter not found', 404);
  }
  if (role === 'CLIENT') {
    if (encounter.patientId === Number(kc.wpUserId)) return;
    throw new KcError('Encounter not found', 404);
  }
  if (kc.clinicId !== null && encounter.clinicId === Number(kc.clinicId)) return;
  throw new KcError('Encounter not found', 404);
}

/**
 * Whether this actor may rename or delete documents.
 *
 * Booking attachments are always false regardless: we never write
 * `appointment_report`, so a manage button on one would be a button that cannot work.
 */
function canManageReports(kc: KcActor): boolean {
  try {
    assertCan(kc.actor, 'patient_report_manage');
    return true;
  } catch {
    return false;
  }
}

function toDateString(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function listEncounterDocuments(
  encounterId: number,
  kc: KcActor,
  opts: { page: number; perPage: number },
): Promise<EncounterDocuments> {
  const encounter = await findEncounterById(encounterId);
  if (!encounter) throw new KcError('Encounter not found', 404);
  assertEncounterVisible(encounter, kc);

  const manage = canManageReports(kc);

  // 1. Booking attachments — only when the encounter records an appointment.
  const booking = encounter.appointmentId === null
    ? []
    : await listBookingAttachments(encounter.appointmentId);

  const sessionDocuments: EncounterDocument[] = booking.map((b) => ({
    id: b.mediaId,
    source: 'booking' as const,
    name: b.filename,
    filename: b.filename,
    mimeType: b.mimeType,
    date: null,
    contentPath: `/api/v1/sessions/${encounter.appointmentId}/attachments/${b.mediaId}/content`,
    canManage: false,
    missing: b.missing,
  }));

  // 2. The patient's archive, split by whether each row is linked to this encounter.
  const linkedIds = new Set(await listLinkedReportIds(encounterId));
  const archive = await listMedReports(
    { page: opts.page, perPage: opts.perPage, patientId: encounter.patientId },
    medReportScopeFor(kc),
  );

  const patientDocuments: EncounterDocument[] = [];
  for (const r of archive.reports) {
    const doc: EncounterDocument = {
      id: r.id,
      source: 'report',
      name: r.name ?? `document-${r.id}`,
      filename: r.name ?? `document-${r.id}`,
      mimeType: null,
      date: toDateString(r.date),
      contentPath: `/api/v1/patient-medical-reports/${r.id}/content`,
      canManage: manage,
      missing: false,
    };
    if (linkedIds.has(r.id)) sessionDocuments.push(doc);
    else patientDocuments.push(doc);
  }

  return {
    sessionDocuments,
    patientDocuments,
    pagination: {
      page: archive.pagination.page,
      perPage: Number(archive.pagination.perPage),
      total: archive.pagination.total,
    },
  };
}
