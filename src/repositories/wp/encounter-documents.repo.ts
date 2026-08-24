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
 */
import { prisma } from '@/lib/db';

export const ENCOUNTER_DOC_MODULE_TYPE = 'praktiqu_report_encounter';

/**
 * Attach a document to an encounter. Idempotent: linking the same pair twice
 * leaves one row, because KiviCare puts no unique index on this table and the
 * duplicate would surface as the same document listed twice.
 */
export async function linkReportToEncounter(
  encounterId: number,
  reportId: number,
): Promise<void> {
  const existing = await prisma.kcCustomFieldData.findFirst({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      moduleId: BigInt(encounterId),
      fieldsData: JSON.stringify(reportId),
    },
    select: { id: true },
  });
  if (existing) return;

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
  const result = await prisma.kcCustomFieldData.deleteMany({
    where: {
      moduleType: ENCOUNTER_DOC_MODULE_TYPE,
      fieldsData: JSON.stringify(reportId),
    },
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
    const id = Number(JSON.parse(row.fieldsData ?? 'null'));
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
