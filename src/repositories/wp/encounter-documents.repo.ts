/**
 * Documents attached to an encounter.
 *
 * Two stores meet here, and they are not symmetric:
 *
 * - `wp_kc_patient_medical_report` is the patient's archive. KiviCare owns the
 *   table; we add rows to it and link them to an encounter through a row of our
 *   own in `wp_kc_custom_fields_data`.
 * - `wp_kc_appointments.appointment_report` is a JSON array of WP attachment ids
 *   written once, at booking. We only ever read it.
 *
 * The link row is namespaced (`praktiqu_report_encounter`) and carries a NULL
 * `field_id`, which together make it invisible to every KiviCare query — the same
 * two constraints the intervention-plan completion state relies on.
 *
 * One row per (encounter, report). Never an array in one row: `wp_kc_*` is MyISAM,
 * so a read-modify-write on a blob has no way to avoid losing a concurrent write.
 *
 * `fields_data` holds a JSON-encoded report id, but not always in the same shape:
 * older writers have stored it as a JSON number (`11`) or a JSON string (`"11"`).
 * Every read of this column — the existence check below, the delete in
 * `unlinkReport`, and the listing in `listLinkedReportIds` — goes through
 * `parseReportId` so all three treat both shapes as the same id.
 */
import { prisma } from '@/lib/db';

export const ENCOUNTER_DOC_MODULE_TYPE = 'praktiqu_report_encounter';

/**
 * Parse a `fields_data` value into the report id it encodes, or null if it isn't one.
 *
 * Singular — one column holding one id. Not to be confused with `parseReportIds`
 * below, which parses the JSON *array* stored in `appointment_report`.
 */
function parseReportId(fieldsData: string | null): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fieldsData ?? 'null');
  } catch {
    return null;
  }
  const id = Number(parsed);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Attach a document to an encounter.
 *
 * The existence check and the insert are two separate statements with no lock
 * between them, and MyISAM gives us nothing to close that window — under
 * concurrent calls for the same pair, two rows can land. That is harmless
 * rather than a bug to chase: `listLinkedReportIds` de-duplicates by value on
 * read, and `unlinkReport` deletes every row matching a report id, not just
 * one. What this guard actually buys is narrower: a normal, sequential call
 * for a pair that is already linked is a no-op instead of growing the table.
 */
export async function linkReportToEncounter(
  encounterId: number,
  reportId: number,
): Promise<void> {
  const candidates = await prisma.kcCustomFieldData.findMany({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
    },
    select: { fieldsData: true },
  });
  const alreadyLinked = candidates.some((row) => parseReportId(row.fieldsData) === reportId);
  if (alreadyLinked) return;

  await prisma.kcCustomFieldData.create({
    data: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
      fieldsData: JSON.stringify(reportId),
      fieldId: null,
      createdAt: new Date(),
    },
  });
}

/** Remove every link pointing at this document. Returns the number of rows removed. */
export async function unlinkReport(reportId: number): Promise<number> {
  const candidates = await prisma.kcCustomFieldData.findMany({
    where: { moduleType: ENCOUNTER_DOC_MODULE_TYPE },
    select: { id: true, fieldsData: true },
  });
  const matchingIds = candidates
    .filter((row) => parseReportId(row.fieldsData) === reportId)
    .map((row) => row.id);
  if (matchingIds.length === 0) return 0;

  const result = await prisma.kcCustomFieldData.deleteMany({
    where: { id: { in: matchingIds } },
  });
  return result.count;
}

/** Document ids attached to one encounter, in the order they were attached. */
export async function listLinkedReportIds(encounterId: number): Promise<number[]> {
  const rows = await prisma.kcCustomFieldData.findMany({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
    },
    select: { fieldsData: true },
    orderBy: { id: 'asc' },
  });

  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const id = parseReportId(row.fieldsData);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Booking attachments — wp_kc_appointments.appointment_report         */
/* ------------------------------------------------------------------ */

export interface BookingAttachment {
  mediaId: number;
  filename: string;
  mimeType: string | null;
  /** True when the attachment row is gone from wp_posts — listed, not hidden. */
  missing: boolean;
}

/**
 * Parse the JSON array KiviCare stores in `appointment_report`.
 *
 * The column is a longtext written by a PHP `json_encode` of whatever the booking
 * form sent, so it may hold `null`, `''`, a non-array, or ids as strings. Anything
 * that is not a finite number is dropped; a malformed column yields an empty list
 * rather than an exception, because one bad row must not break a clinician's screen.
 */
function parseReportIds(raw: string | null): number[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const entry of parsed) {
    const id = Number(entry);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type AttachmentRow = { ID: bigint; post_title: string | null; post_mime_type: string | null; attached_file: string | null };

/** Filename, preferring the real file on disk over the editable post title. */
function attachmentFilename(row: AttachmentRow, mediaId: number): string {
  const file = row.attached_file ?? '';
  if (file !== '') {
    const slash = file.lastIndexOf('/');
    return slash === -1 ? file : file.slice(slash + 1);
  }
  const title = row.post_title ?? '';
  return title !== '' ? title : `document-${mediaId}`;
}

async function loadAttachments(ids: number[]): Promise<Map<number, AttachmentRow>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<AttachmentRow[]>(
    `SELECT p.ID, p.post_title, p.post_mime_type, pm.meta_value AS attached_file
       FROM wp_posts p
       LEFT JOIN wp_postmeta pm ON pm.post_id = p.ID AND pm.meta_key = '_wp_attached_file'
      WHERE p.post_type = 'attachment' AND p.ID IN (${placeholders})`,
    ...ids,
  );
  return new Map(rows.map((r) => [Number(r.ID), r]));
}

/**
 * The files that arrived with a booking, in the order KiviCare stored them.
 *
 * An id whose attachment has since been deleted is returned with `missing: true`
 * rather than skipped: the clinician should see that something was attached and is
 * now gone, instead of a list that quietly disagrees with what the client sent.
 */
export async function listBookingAttachments(appointmentId: number): Promise<BookingAttachment[]> {
  const appointment = await prisma.kcAppointment.findUnique({
    where: { id: BigInt(appointmentId) },
    select: { appointmentReport: true },
  });
  if (!appointment) return [];

  const ids = parseReportIds(appointment.appointmentReport);
  if (ids.length === 0) return [];

  const found = await loadAttachments(ids);

  return ids.map((mediaId) => {
    const row = found.get(mediaId);
    if (!row) {
      return { mediaId, filename: `document-${mediaId}`, mimeType: null, missing: true };
    }
    return {
      mediaId,
      filename: attachmentFilename(row, mediaId),
      mimeType: row.post_mime_type ?? null,
      missing: false,
    };
  });
}

/**
 * The authorisation guard for streaming a booking attachment.
 *
 * A media id has no owner of its own, so it is only ever safe to serve one after
 * proving it belongs to an appointment the caller may already read.
 */
export async function attachmentBelongsToAppointment(
  appointmentId: number,
  mediaId: number,
): Promise<boolean> {
  const appointment = await prisma.kcAppointment.findUnique({
    where: { id: BigInt(appointmentId) },
    select: { appointmentReport: true },
  });
  if (!appointment) return false;
  return parseReportIds(appointment.appointmentReport).includes(mediaId);
}
