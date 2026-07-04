import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  assertTestDb, cleanup, seedConsent, seedAppointment, seedEncounter,
} from './fixtures';
import {
  createConsentVersion, activateConsentVersion, getConsentVersion,
  grantConsent, withdrawConsent, listConsents, getConsent,
  listAuditLog, exportSubjectData, softDeleteSubject,
} from '@/services/billing/gdpr.service';

// TEST_MARKER-range ids
const SUBJECT = 9_001_003;
const OTHER = 9_001_004;
const CLINIC_ID = 9_001_001;
const DOCTOR = 9_001_002;
const APPOINTMENT_ID = 9_001_400;
const ENCOUNTER_ID = 9_001_500;
const CONSENT_TYPE = 'gdpr-service-test-type';

const kcClient = { actor: { id: 'c', role: 'CLIENT', practiceId: null }, wpUserId: BigInt(SUBJECT), clinicId: null } as any;
const kcAdmin = { actor: { id: 'a', role: 'CLINIC_ADMIN', practiceId: null }, wpUserId: BigInt(9_001_000), clinicId: BigInt(CLINIC_ID) } as any;
const kcSuper = { actor: { id: 's', role: 'SUPER_ADMIN', practiceId: null }, wpUserId: BigInt(9_001_005), clinicId: null } as any;

const clientScope = { userId: BigInt(SUBJECT) };

/** Seed a wp_users subject row directly (kcUser maps to wp_users; cleaned by cleanup id>=TEST_MARKER). */
async function seedSubjectUser(id: number) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id), userLogin: `subject${id}`,
      userEmail: `subject${id}@test.local`, displayName: `Subject ${id}`,
      userRegistered: new Date('2026-01-01'),
    },
  });
}

describe('gdpr.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedSubjectUser(SUBJECT);
    await seedSubjectUser(OTHER);
  });
  afterAll(cleanup);

  it('createConsentVersion auto-increments version_number per consent_type; activate flips is_active', async () => {
    const v1 = await createConsentVersion(
      { consentType: CONSENT_TYPE, title: 'v1', bodyText: 'body1', legalBasis: 'consent' }, kcAdmin,
    );
    const v2 = await createConsentVersion(
      { consentType: CONSENT_TYPE, title: 'v2', bodyText: 'body2', legalBasis: 'consent' }, kcAdmin,
    );
    const r1 = await getConsentVersion(v1.id);
    const r2 = await getConsentVersion(v2.id);
    expect(r1.version_number).toBe(1);
    expect(r2.version_number).toBe(2); // auto-incremented per consent_type

    // Activate v1 → is_active=1 for v1, 0 for others of the same type.
    await activateConsentVersion(v1.id);
    expect((await getConsentVersion(v1.id)).is_active).toBe(1);
    expect((await getConsentVersion(v2.id)).is_active).toBe(0);
  });

  it('grantConsent as CLIENT forces user_id to the actor (ignores passed userId)', async () => {
    const { id } = await grantConsent(
      { userId: OTHER /* should be ignored */, consentType: 'consent-forced', consentVersionId: '1' },
      kcClient, '127.0.0.1',
    );
    const row = await getConsent(id, null);
    expect(row.user_id).toBe(SUBJECT); // forced to the actor, not OTHER
    expect(row.status).toBe('granted');

    // withdrawConsent sets status + withdrawn_at.
    await withdrawConsent(id, null);
    const after = await getConsent(id, null);
    expect(after.status).toBe('withdrawn');
    expect(after.withdrawn_at).not.toBeNull();
  });

  it('listConsents scope: a CLIENT sees only their own rows', async () => {
    await seedConsent({ id: 9_001_301, userId: SUBJECT, consentType: 'scope-test', consentVersionId: '1', status: 'granted' });
    await seedConsent({ id: 9_001_302, userId: OTHER, consentType: 'scope-test', consentVersionId: '1', status: 'granted' });

    const list = await listConsents({ page: 1, perPage: 100, consentType: 'scope-test' }, clientScope);
    expect(list.consents.length).toBeGreaterThan(0);
    expect(list.consents.every((c) => c.user_id === SUBJECT)).toBe(true);
    expect(list.consents.some((c) => c.id === 9_001_301)).toBe(true);
    expect(list.consents.some((c) => c.id === 9_001_302)).toBe(false);
  });

  it('listAuditLog reads a filtered page (SELECT-only, no writes)', async () => {
    const res = await listAuditLog({ page: 1, perPage: 5, action: 'read' });
    expect(Array.isArray(res.entries)).toBe(true);
    expect(res.entries.length).toBeLessThanOrEqual(5);
    expect(res.pagination).toMatchObject({ page: 1, perPage: 5 });
    expect(typeof res.pagination.total).toBe('number');
  });

  it('exportSubjectData returns profile + datasets + a bills array', async () => {
    await seedAppointment({ id: APPOINTMENT_ID, clinicId: CLINIC_ID, doctorId: DOCTOR, patientId: SUBJECT });
    await seedEncounter({ id: ENCOUNTER_ID, clinicId: CLINIC_ID, doctorId: DOCTOR, patientId: SUBJECT });

    const bundle = await exportSubjectData(SUBJECT);
    expect(bundle.subject.id).toBe(SUBJECT);
    expect(bundle.subject.email).toBe(`subject${SUBJECT}@test.local`);
    expect(bundle.appointments.some((a: any) => Number(a.id) === APPOINTMENT_ID)).toBe(true);
    expect(bundle.encounters.some((e: any) => Number(e.id) === ENCOUNTER_ID)).toBe(true);
    expect(Array.isArray(bundle.bills)).toBe(true);
    expect(Array.isArray(bundle.prescriptions)).toBe(true);
    expect(Array.isArray(bundle.medicalHistory)).toBe(true);
  });

  it('softDeleteSubject sets user_status=1 + usermeta markers and deletes NO rows', async () => {
    const apptId = 9_001_401;
    await seedAppointment({ id: apptId, clinicId: CLINIC_ID, doctorId: DOCTOR, patientId: SUBJECT });

    const res = await softDeleteSubject(SUBJECT, kcSuper);
    expect(res.status).toBe('flagged');
    expect(res.subjectUserId).toBe(SUBJECT);

    // user_status flipped to 1.
    const u = await prisma.$queryRawUnsafe<any[]>(`SELECT user_status FROM wp_users WHERE ID = ?`, SUBJECT);
    expect(Number(u[0].user_status)).toBe(1);

    // Both usermeta markers present.
    const meta = await prisma.$queryRawUnsafe<any[]>(
      `SELECT meta_key FROM wp_usermeta WHERE user_id = ? AND meta_key IN ('kivicare_gdpr_erased_at','kivicare_gdpr_erased_by')`,
      SUBJECT,
    );
    expect(meta.length).toBe(2);

    // The seeded appointment STILL EXISTS (reversible soft-flag deletes no rows).
    const appt = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM wp_kc_appointments WHERE id = ?`, apptId);
    expect(appt.length).toBe(1);
  });
});
