/**
 * `excludeIds` and `listMedReportsByIds` exist so `listEncounterDocuments` can make
 * the archive query mean "the patient's documents excluding those linked to this
 * encounter" — both the page AND the COUNT(*) it reports as `total`. These tests
 * exercise the real SQL against the test database, not mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedMedReport, cleanup } from './fixtures';
import { listMedReports, listMedReportsByIds } from '@/services/billing/patient-medical-report.service';

const PATIENT = 9_000_910;
const OTHER_PATIENT = 9_000_911;

const REPORT_A = 9_000_960;
const REPORT_B = 9_000_961;
const REPORT_C = 9_000_962;
const OTHER_REPORT = 9_000_970;

describe('patient-medical-report.service — excludeIds / listMedReportsByIds', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedMedReport({ id: REPORT_A, patientId: PATIENT, name: 'Report A' });
    await seedMedReport({ id: REPORT_B, patientId: PATIENT, name: 'Report B' });
    await seedMedReport({ id: REPORT_C, patientId: PATIENT, name: 'Report C' });
    await seedMedReport({ id: OTHER_REPORT, patientId: OTHER_PATIENT, name: 'Someone else\'s report' });
  });
  afterAll(cleanup);

  it('excludeIds removes rows from both the page and the COUNT(*)', async () => {
    const withExclusion = await listMedReports(
      { page: 1, perPage: 10, patientId: PATIENT, excludeIds: [REPORT_B] } as any,
      null,
    );

    expect(withExclusion.reports.map((r) => r.id).sort((a, b) => a - b)).toEqual([REPORT_A, REPORT_C]);
    // The bug this fixes: total must equal the length of the returned page, not the
    // size of the whole archive the excluded row still belongs to.
    expect(withExclusion.pagination.total).toBe(2);
  });

  it('an empty excludeIds array changes nothing', async () => {
    const withEmpty = await listMedReports(
      { page: 1, perPage: 10, patientId: PATIENT, excludeIds: [] } as any,
      null,
    );
    const withoutKey = await listMedReports(
      { page: 1, perPage: 10, patientId: PATIENT } as any,
      null,
    );

    expect(withEmpty.pagination.total).toBe(3);
    expect(withEmpty.pagination.total).toBe(withoutKey.pagination.total);
    expect(withEmpty.reports.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      withoutKey.reports.map((r) => r.id).sort((a, b) => a - b),
    );
  });

  it('listMedReportsByIds returns the requested rows in one query, mapped like listMedReports', async () => {
    const rows = await listMedReportsByIds([REPORT_A, REPORT_C], null);

    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([REPORT_A, REPORT_C]);
    const a = rows.find((r) => r.id === REPORT_A);
    expect(a).toMatchObject({ id: REPORT_A, name: 'Report A', patient_id: PATIENT });
  });

  it('listMedReportsByIds returns [] without querying when ids is empty', async () => {
    // An unguarded `IN ()` is invalid SQL, so this only passes if the empty case is
    // special-cased before any query runs.
    await expect(listMedReportsByIds([], null)).resolves.toEqual([]);
  });

  it('listMedReportsByIds respects scope: a caller scoped to one patient cannot read another patient\'s report by id', async () => {
    const blocked = await listMedReportsByIds([OTHER_REPORT], { patientId: BigInt(PATIENT) });
    expect(blocked).toEqual([]);

    // Sanity check: the same id IS visible to a caller scoped to the right patient.
    const visible = await listMedReportsByIds([OTHER_REPORT], { patientId: BigInt(OTHER_PATIENT) });
    expect(visible.map((r) => r.id)).toEqual([OTHER_REPORT]);
  });
});
