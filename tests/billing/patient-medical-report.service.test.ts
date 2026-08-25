import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedPatientClinicMapping, cleanup } from './fixtures';
import {
  listMedReports, getMedReport, createMedReport, deleteMedReport,
  bulkDeleteMedReports, assertPatientInScope, resolveReportFile,
} from '@/services/billing/patient-medical-report.service';
import { idsSchema, medReportCreateSchema } from '@/services/billing/validation';

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
      { patientId: PATIENT, name: 'Blood test', verifiedMediaId: '0' },
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
      { patientId: PATIENT, name: 'X-ray', verifiedMediaId: '0' },
      kcStaff,
    );
    // Different patient's CLIENT scope -> not found
    await expect(getMedReport(id, { patientId: BigInt(OTHER_PATIENT) })).rejects.toThrow();
    // Owning patient's CLIENT scope still sees it
    expect((await getMedReport(id, { patientId: BigInt(PATIENT) })).id).toBe(id);
  });

  it('bulk deletes only reports within scope', async () => {
    const inScope = await createMedReport({ patientId: PATIENT, name: 'InScope', verifiedMediaId: '0' }, kcStaff);
    // Out-of-scope report: patient not mapped to CLINIC (seeded directly, bypassing scope check).
    const outScope = await createMedReport(
      { patientId: OTHER_PATIENT, name: 'OutScope', verifiedMediaId: '0' },
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

  it('idsSchema (shared by every bulk/delete endpoint, including this one) refuses an over-sized batch', () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => i + 1);
    const refused = idsSchema.safeParse({ ids: tooMany });
    expect(refused.success).toBe(false);

    const atLimit = idsSchema.safeParse({ ids: tooMany.slice(0, 100) });
    expect(atLimit.success).toBe(true);
  });

  it('resolveReportFile returns the authenticated content path, not a WordPress URL', async () => {
    const { id } = await createMedReport({ patientId: PATIENT, name: 'No media', verifiedMediaId: '0' }, kcStaff);
    const resolved = await resolveReportFile(id, clinicScope);
    expect(resolved.reportId).toBe(id);
    expect(resolved.contentPath).toBe(`/api/v1/patient-medical-reports/${id}/content`);
    expect(resolved).not.toHaveProperty('fileUrl');
  });

  // C1 (pre-merge review, 2026-08-25): a request body naming a WP media id used
  // to be able to mint a report row over another clinic's attachment, then read
  // its bytes via GET /{id}/content. The fix is that `medReportCreateSchema` (the
  // public POST body) no longer has any media-id field, so there is nothing to
  // carry an attacker's id through — `createMedReport` only accepts one via
  // `verifiedMediaId`, supplied by a caller that uploaded the bytes itself.
  describe('C1 — a request body cannot mint a report over media it does not own', () => {
    it('medReportCreateSchema drops a body-supplied media id instead of passing it through', () => {
      const parsed = medReportCreateSchema.safeParse({
        patientId: PATIENT,
        name: 'Attack',
        uploadReport: 'victim-media-id', // what an attacker would send
      });

      expect(parsed.success).toBe(true);
      // Not just "ignored for validation purposes" — genuinely absent from the
      // parsed value a route would go on to use.
      expect(parsed.success && parsed.data).not.toHaveProperty('uploadReport');
    });

    it('createMedReport has no parameter a parsed request body could satisfy with a media id', async () => {
      const parsed = medReportCreateSchema.parse({
        patientId: PATIENT,
        name: 'Attack',
        uploadReport: 'victim-media-id',
      });

      // The parsed body is missing `verifiedMediaId` entirely, so passing it
      // straight through — the shape a route handler would be tempted to use —
      // fails loudly (a required column has no value) rather than quietly
      // filing the row under `undefined`/null and definitely not under the
      // attacker-chosen id.
      await expect(createMedReport(parsed as any, kcStaff)).rejects.toThrow();
    });
  });
});
