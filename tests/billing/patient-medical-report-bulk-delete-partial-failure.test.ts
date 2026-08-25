/**
 * `bulkDeleteMedReports` processes each document as unlink-then-delete, one
 * unit at a time, and stops at the first failure. This proves the state left
 * behind by a failure partway through is coherent: documents processed
 * before the failure are fully gone (row and link), the document that failed
 * and everything queued after it are completely untouched, and the count the
 * function returns matches how many actually got deleted — not how many were
 * requested.
 *
 * The failure is injected into `prepareUnlinkBatch`'s returned per-document
 * step (not `unlinkReport`, which `bulkDeleteMedReports` no longer calls —
 * see the O(N × table) fix in encounter-documents.repo.ts) so it can be
 * pinned to one specific document while every other call runs for real
 * against the test database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from './fixtures';
import { bulkDeleteMedReports } from '@/services/billing/patient-medical-report.service';
import {
  ENCOUNTER_DOC_MODULE_TYPE,
  linkReportToEncounter,
  listLinkedReportIds,
} from '@/repositories/wp/encounter-documents.repo';

const control: { throwForReportId: number | null } = { throwForReportId: null };

// vi.mock calls are hoisted above these imports by Vitest, so the service
// above resolves against this mocked module regardless of source order.
vi.mock('@/repositories/wp/encounter-documents.repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/repositories/wp/encounter-documents.repo')>();
  return {
    ...actual,
    prepareUnlinkBatch: async (reportIds: number[]) => {
      const real = await actual.prepareUnlinkBatch(reportIds);
      return async (reportId: number) => {
        if (reportId === control.throwForReportId) {
          throw new Error(`unlink failed (test) for report ${reportId}`);
        }
        return real(reportId);
      };
    },
  };
});

const BASE = 9_200_000;
const END = BASE + 1_000;
const PATIENT = BASE + 1;
const ENCOUNTER = BASE + 2;
const REPORT_1 = BASE + 10;
const REPORT_2 = BASE + 11;
const REPORT_3 = BASE + 12;
const REPORT_4 = BASE + 13;
const REPORT_5 = BASE + 14;
const ALL_REPORTS = [REPORT_1, REPORT_2, REPORT_3, REPORT_4, REPORT_5];

async function wipe() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_patient_medical_report WHERE id >= ? AND id < ?`, BASE, END,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_custom_fields_data WHERE module_type = ? AND module_id >= ? AND module_id < ?`,
    ENCOUNTER_DOC_MODULE_TYPE, BASE, END,
  );
}

async function seedReport(id: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_medical_report (id, name, patient_id, upload_report, date)
     VALUES (?, ?, ?, ?, NOW())`,
    id, `Report ${id}`, PATIENT, '4242',
  );
  await linkReportToEncounter(ENCOUNTER, id);
}

beforeEach(async () => {
  assertTestDb();
  control.throwForReportId = null;
  await wipe();
  for (const id of ALL_REPORTS) await seedReport(id);
});

afterEach(() => { control.throwForReportId = null; });
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

describe('bulkDeleteMedReports — partial failure', () => {
  it('fully finishes documents before the failure, leaves the failing one and everything after untouched, and returns the real count', async () => {
    // Fail on the 3rd of 5 documents (REPORT_3).
    control.throwForReportId = REPORT_3;

    const n = await bulkDeleteMedReports(ALL_REPORTS, null);

    expect(n).toBe(2); // REPORT_1 and REPORT_2 only

    // Before the failure: row AND link both gone.
    for (const id of [REPORT_1, REPORT_2]) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM wp_kc_patient_medical_report WHERE id = ?`, id,
      );
      expect(rows).toHaveLength(0);
    }

    // At and after the failure: row AND link both still present, untouched.
    for (const id of [REPORT_3, REPORT_4, REPORT_5]) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM wp_kc_patient_medical_report WHERE id = ?`, id,
      );
      expect(rows).toHaveLength(1);
    }

    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([REPORT_3, REPORT_4, REPORT_5]);
  });

  it('deletes everything when nothing fails', async () => {
    const n = await bulkDeleteMedReports(ALL_REPORTS, null);
    expect(n).toBe(5);
    expect(await listLinkedReportIds(ENCOUNTER)).toEqual([]);
  });
});
