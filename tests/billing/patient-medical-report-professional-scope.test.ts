/**
 * A psikolog sees the documents of the clients they have actually seen (BR-10.01,
 * the same rule as their client list), not of every client of their clinic, and
 * not only of the first clinic they happen to be mapped to.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  assertTestDb, cleanup, useIdBlock,
  seedPatientClinicMapping, seedAppointment, seedMedReport,
} from './fixtures';
import {
  listMedReports, getMedReport, renameMedReport, deleteMedReport,
  bulkDeleteMedReports, exportMedReports, assertPatientInScope,
} from '@/services/billing/patient-medical-report.service';
import { medReportScopeFor } from '@/services/billing/med-report-scope';

const { BASE } = useIdBlock('billing/patient-medical-report-professional-scope.test.ts');

const CLINIC_1 = BASE + 1, CLINIC_2 = BASE + 2;
const DOC_A = BASE + 10, DOC_B = BASE + 11;
const PAT_A = BASE + 20;        // only ever seen by A (clinic 1)
const PAT_B = BASE + 21;        // only ever seen by B (clinic 1)
const PAT_A2 = BASE + 22;       // seen by A at clinic 2 only
const PAT_CANCELLED = BASE + 23; // A's only appointment was cancelled
const REP_A = BASE + 100, REP_B = BASE + 101, REP_A2 = BASE + 102, REP_CANCELLED = BASE + 103;

const kc = (role: string, wpUserId: number, clinicId: number) =>
  ({ actor: { id: 'x', role, practiceId: null }, wpUserId: BigInt(wpUserId), clinicId: BigInt(clinicId) }) as any;

// Doctor A's first (and so the resolved) clinic is clinic 1.
const doctorA = kc('PROFESSIONAL', DOC_A, CLINIC_1);

describe('medical reports: professional scope', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedPatientClinicMapping({ id: BASE + 50, patientId: PAT_A, clinicId: CLINIC_1 });
    await seedPatientClinicMapping({ id: BASE + 51, patientId: PAT_B, clinicId: CLINIC_1 });
    await seedPatientClinicMapping({ id: BASE + 52, patientId: PAT_A2, clinicId: CLINIC_2 });
    await seedPatientClinicMapping({ id: BASE + 53, patientId: PAT_CANCELLED, clinicId: CLINIC_1 });
    await seedAppointment({ id: BASE + 60, clinicId: CLINIC_1, doctorId: DOC_A, patientId: PAT_A, status: 1 });
    await seedAppointment({ id: BASE + 61, clinicId: CLINIC_1, doctorId: DOC_B, patientId: PAT_B, status: 3 });
    await seedAppointment({ id: BASE + 62, clinicId: CLINIC_2, doctorId: DOC_A, patientId: PAT_A2, status: 1 });
    await seedAppointment({ id: BASE + 63, clinicId: CLINIC_1, doctorId: DOC_A, patientId: PAT_CANCELLED, status: 0 });
    await seedMedReport({ id: REP_A, patientId: PAT_A, name: 'Milik klien A' });
    await seedMedReport({ id: REP_B, patientId: PAT_B, name: 'Milik klien B' });
    await seedMedReport({ id: REP_A2, patientId: PAT_A2, name: 'Klien A di klinik 2' });
    await seedMedReport({ id: REP_CANCELLED, patientId: PAT_CANCELLED, name: 'Janji batal' });
  });
  afterAll(cleanup);

  it('list: psikolog A sees only their own clients, at every clinic they work in', async () => {
    const out = await listMedReports({ page: 1, perPage: 50 }, medReportScopeFor(doctorA));
    const ids = out.reports.map((r) => r.id).filter((id) => id >= BASE && id < BASE + 1000);
    expect(ids.sort()).toEqual([REP_A, REP_A2].sort());
    expect(out.pagination.total).toBe(2);
  });

  it('export carries the same restriction as the list', async () => {
    const out = await exportMedReports({ page: 1, perPage: 50 }, medReportScopeFor(doctorA));
    expect(out.reports.map((r) => r.id).sort()).toEqual([REP_A, REP_A2].sort());
  });

  it('get / rename / delete: a colleague\'s client document is a 404', async () => {
    const scope = medReportScopeFor(doctorA);
    await expect(getMedReport(REP_B, scope)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(renameMedReport(REP_B, 'Diganti', scope)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(deleteMedReport(REP_B, scope)).rejects.toMatchObject({ httpStatus: 404 });
    // untouched
    expect((await getMedReport(REP_B, null)).name).toBe('Milik klien B');
  });

  it('bulk delete skips a colleague\'s client document', async () => {
    const n = await bulkDeleteMedReports([REP_B], medReportScopeFor(doctorA));
    expect(n).toBe(0);
    expect((await getMedReport(REP_B, null)).id).toBe(REP_B);
  });

  it('a cancelled appointment does not grant access', async () => {
    await expect(getMedReport(REP_CANCELLED, medReportScopeFor(doctorA))).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('psikolog A reads and renames their own client\'s document', async () => {
    const scope = medReportScopeFor(doctorA);
    expect((await getMedReport(REP_A, scope)).id).toBe(REP_A);
    expect(await renameMedReport(REP_A, 'Resume', scope)).toEqual({ id: REP_A, name: 'Resume' });
  });

  it('a multi-clinic psikolog reaches the client of their second clinic', async () => {
    // kc.clinicId is clinic 1 only; the client is mapped to clinic 2 only.
    expect((await getMedReport(REP_A2, medReportScopeFor(doctorA))).id).toBe(REP_A2);
  });

  it('assertPatientInScope (upload path) follows the same rule', async () => {
    await expect(assertPatientInScope(PAT_B, doctorA)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(assertPatientInScope(PAT_A2, doctorA)).resolves.toBeUndefined();
    await expect(assertPatientInScope(PAT_A, doctorA)).resolves.toBeUndefined();
  });

  it('clinic admin still sees every document of their clinic, and nothing of other clinics', async () => {
    const admin = kc('CLINIC_ADMIN', BASE + 30, CLINIC_1);
    const out = await listMedReports({ page: 1, perPage: 50 }, medReportScopeFor(admin));
    const ids = out.reports.map((r) => r.id).filter((id) => id >= BASE && id < BASE + 1000);
    expect(ids.sort()).toEqual([REP_A, REP_B, REP_CANCELLED].sort());
    await expect(assertPatientInScope(PAT_B, admin)).resolves.toBeUndefined();
  });

  it('receptionist is clinic-scoped like the admin', async () => {
    const rec = kc('RECEPTIONIST', BASE + 31, CLINIC_1);
    expect((await getMedReport(REP_B, medReportScopeFor(rec))).id).toBe(REP_B);
    await expect(getMedReport(REP_A2, medReportScopeFor(rec))).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('super admin is unbounded; a client sees only their own', async () => {
    expect(medReportScopeFor(kc('SUPER_ADMIN', BASE + 32, CLINIC_1))).toBeNull();
    expect(medReportScopeFor(kc('CLIENT', PAT_A, CLINIC_1))).toEqual({ patientId: BigInt(PAT_A) });
  });
});
