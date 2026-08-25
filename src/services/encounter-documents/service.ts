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
import { listMedReports, listMedReportsByIds, createMedReport } from '@/services/billing/patient-medical-report.service';
import { findEncounterById } from '@/repositories/wp/clinical-records.repo';
import {
  listBookingAttachments,
  listLinkedReportIds,
  linkReportToEncounter,
} from '@/repositories/wp/encounter-documents.repo';
import { assertCan } from '@/services/billing/kc-permissions';
import { validateUpload } from '@/services/uploads/validate-upload';
import { uploadMedia } from '@/lib/wp-endpoint';

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

/** Map an archive row (from `listMedReports`/`listMedReportsByIds`) to the shape the front-end sees. */
function toReportDocument(r: { id: number; name: string | null; date: unknown }, manage: boolean): EncounterDocument {
  return {
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

  // 2. Documents linked to this encounter join the session section. A link whose
  //    target no longer exists (or fell out of scope) is simply absent from the
  //    result — dropped, not surfaced as an error.
  const linkedIds = await listLinkedReportIds(encounterId);
  const scope = medReportScopeFor(kc);

  if (linkedIds.length > 0) {
    const linkedReports = await listMedReportsByIds(linkedIds, scope);
    for (const r of linkedReports) sessionDocuments.push(toReportDocument(r, manage));
  }

  // 3. The rest of the patient's archive, paginated. `excludeIds` keeps the linked
  //    rows out of both the page and the COUNT(*), so `pagination.total` counts the
  //    same set `patientDocuments` is drawn from.
  const archive = await listMedReports(
    { page: opts.page, perPage: opts.perPage, patientId: encounter.patientId, excludeIds: linkedIds },
    scope,
  );

  const patientDocuments: EncounterDocument[] = archive.reports.map((r) => toReportDocument(r, manage));

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

export interface UploadDocumentInput {
  filename: string;
  bytes: Uint8Array;
  name: string;
}

/**
 * Attach a new document to an encounter.
 *
 * Write order is the only safety mechanism available — `wp_kc_*` is MyISAM, so there
 * is no transaction to roll back:
 *
 *   1. media   — an orphan attachment costs disk and nothing else
 *   2. report  — from here the document is usable from the patient archive
 *   3. link    — failing here leaves a coherent state, so it is reported, not thrown
 */
export async function uploadEncounterDocument(
  encounterId: number,
  input: UploadDocumentInput,
  kc: KcActor,
): Promise<{ id: number; mediaId: number; linked: boolean }> {
  assertCan(kc.actor, 'patient_report_manage');

  const encounter = await findEncounterById(encounterId);
  if (!encounter) throw new KcError('Encounter not found', 404);
  assertEncounterVisible(encounter, kc);

  const validation = validateUpload({ name: input.filename, bytes: input.bytes });
  // `=== false` rather than `!validation.ok`: this project runs with
  // strictNullChecks off, where the negation does not narrow the union.
  if (validation.ok === false) {
    throw new KcError(validation.message, 422);
  }

  const uploaded = await uploadMedia({
    filename: input.filename,
    contentType: validation.mime,
    bytes: input.bytes,
    context: 'medical-report',
  });

  const created = await createMedReport(
    {
      patientId: encounter.patientId,
      name: input.name.trim() === '' ? input.filename : input.name.trim(),
      // Trusted: the id `uploadMedia` just returned for the bytes this same
      // request uploaded — never a caller-supplied id. See the trust-boundary
      // note on `MedReportCreateInput.verifiedMediaId`.
      verifiedMediaId: String(uploaded.mediaId),
    },
    kc,
  );

  try {
    await linkReportToEncounter(encounterId, created.id);
  } catch (err) {
    // The document is already in the archive; only its tie to this encounter is
    // missing. Say so instead of failing a request that mostly succeeded.
    // eslint-disable-next-line no-console
    console.error('[encounter-documents] link failed', { encounterId, reportId: created.id, err });
    return { id: created.id, mediaId: uploaded.mediaId, linked: false };
  }

  return { id: created.id, mediaId: uploaded.mediaId, linked: true };
}
