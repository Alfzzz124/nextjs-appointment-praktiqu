import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedPatientClinicMapping, cleanup } from './fixtures';
import {
  listMedReports, getMedReport, createMedReport, deleteMedReport,
  bulkDeleteMedReports, assertPatientInScope, resolveReportFile,
} from '@/services/billing/patient-medical-report.service';

const CLINIC = 9_000_901, PATIENT = 9_000_903, OTHER_PATIENT = 9_000_904;

// Staff actor scoped to CLINIC; PATIENT is mapped to CLINIC below.
const kcStaff = { actor: { id: 'a', role: 'CLINIC_ADMIN', practiceId: null }, wpUserId: BigInt(9_000_902), clinicId: BigInt(CLINIC) } as any;
const clinicScope = { clinicId: BigInt(CLINIC) };

describe('patient-medical-report.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedPatientClinicMapping({ id: 9_000_950, patientId: PATIENT, clinicId: CLINIC });
  });
  afterAll(cleanup);

  it('creates, reads, lists, and deletes a report within clinic scope', async () => {
    const { id } = await createMedReport(
      { patientId: PATIENT, name: 'Blood test', uploadReport: '0' },
      kcStaff,
    );
    expect(id).toBeGreaterThan(0);

    const got = await getMedReport(id, clinicScope);
    expect(got.name).toBe('Blood test');
    expect(got.patient_id).toBe(PATIENT);

    const list = await listMedReports({ page: 1, perPage: 10 } as any, clinicScope);
    expect(list.reports.some((r) => r.id === id)).toBe(true);

    await deleteMedReport(id, clinicScope);
    await expect(getMedReport(id, clinicScope)).rejects.toThrow();
  });

  it('scopes reads: a CLIENT cannot see another patient\'s report', async () => {
    const { id } = await createMedReport(
      { patientId: PATIENT, name: 'X-ray', uploadReport: '0' },
      kcStaff,
    );
    // Different patient's CLIENT scope -> not found
    await expect(getMedReport(id, { patientId: BigInt(OTHER_PATIENT) })).rejects.toThrow();
    // Owning patient's CLIENT scope still sees it
    expect((await getMedReport(id, { patientId: BigInt(PATIENT) })).id).toBe(id);
  });

  it('bulk deletes only reports within scope', async () => {
    const inScope = await createMedReport({ patientId: PATIENT, name: 'InScope', uploadReport: '0' }, kcStaff);
    // Out-of-scope report: patient not mapped to CLINIC (seeded directly, bypassing scope check).
    const outScope = await createMedReport(
      { patientId: OTHER_PATIENT, name: 'OutScope', uploadReport: '0' },
      { actor: { id: 's', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(9_000_902), clinicId: null } as any,
    );

    const n = await bulkDeleteMedReports([inScope.id, outScope.id], clinicScope);
    expect(n).toBe(1);
    await expect(getMedReport(inScope.id, clinicScope)).rejects.toThrow();
    // out-of-clinic report survives the scoped delete
    expect((await getMedReport(outScope.id, null)).id).toBe(outScope.id);
  });

  it('assertPatientInScope rejects a patient outside the actor\'s clinic', async () => {
    await expect(assertPatientInScope(OTHER_PATIENT, kcStaff)).rejects.toThrow();
    // patient mapped to the clinic passes
    await expect(assertPatientInScope(PATIENT, kcStaff)).resolves.toBeUndefined();
  });

  it('resolveReportFile returns fileUrl: null (does not throw) when the attachment is absent', async () => {
    const { id } = await createMedReport({ patientId: PATIENT, name: 'No media', uploadReport: '0' }, kcStaff);
    const resolved = await resolveReportFile(id, clinicScope);
    expect(resolved.reportId).toBe(id);
    expect(resolved.fileUrl).toBeNull();
  });
});
