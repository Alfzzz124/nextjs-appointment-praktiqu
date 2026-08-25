/**
 * Deleting a document must take its encounter link with it. A link left behind
 * points at a row that no longer exists, and every encounter listing then has to
 * work around it forever.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { deleteMedReport, resolveReportFile } from '@/services/billing/patient-medical-report.service';
import { ENCOUNTER_DOC_MODULE_TYPE, listLinkedReportIds, linkReportToEncounter } from '@/repositories/wp/encounter-documents.repo';

const BASE = 9_000_000;
const END = BASE + 1_000;
const REPORT = BASE + 1;
const PATIENT = BASE + 50;
const ENCOUNTER = BASE + 90;

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_medical_report WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE module_type = ? AND module_id >= ? AND module_id < ?`,
    ENCOUNTER_DOC_MODULE_TYPE, BASE, END,
  );
}

beforeEach(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_medical_report (id, name, patient_id, upload_report, date)
     VALUES (?, ?, ?, ?, NOW())`,
    REPORT, 'Resume sesi', PATIENT, '4242',
  );
  await linkReportToEncounter(ENCOUNTER, REPORT);
});

afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('deleteMedReport', () => {
  it('removes the encounter link along with the document', async () => {
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT]);

    await deleteMedReport(REPORT, null);

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });
});

describe('resolveReportFile', () => {
  it('returns a path the front-end can actually call, not a WordPress URL', async () => {
    const out = await resolveReportFile(REPORT, null);

    expect(out).toEqual({
      reportId: REPORT,
      name: 'Resume sesi',
      mediaId: '4242',
      contentPath: `/api/v1/patient-medical-reports/${REPORT}/content`,
    });
    // The old `fileUrl` pointed into uploads/kivicare-reports, which is Deny from all.
    expect(out).not.toHaveProperty('fileUrl');
  });
});
