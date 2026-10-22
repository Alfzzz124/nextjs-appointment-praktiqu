import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertTestDb, seedRating, seedDoctorClinicMapping, cleanup, useIdBlock } from './fixtures';
import {
  listRatings, getRating, createRating, deleteRating, ratingStats,
} from '@/services/billing/rating.service';

const { BASE } = useIdBlock('billing/rating.service.test.ts');

// TEST_MARKER-range ids
const CLINIC_ID = BASE + 991;
const DOCTOR = BASE + 992;
const OTHER_DOCTOR = BASE + 993;
const PATIENT = BASE + 994;
const OTHER_PATIENT = BASE + 995;

const kcClient = { actor: { id: 'c', role: 'CLIENT', practiceId: null }, wpUserId: BigInt(PATIENT), clinicId: null } as any;
const kcAdmin = { actor: { id: 'a', role: 'CLINIC_ADMIN', practiceId: null }, wpUserId: BigInt(BASE + 990), clinicId: BigInt(CLINIC_ID) } as any;

const clinicScope = { clinicId: BigInt(CLINIC_ID) };
const doctorScope = { doctorId: BigInt(DOCTOR) };
const otherDoctorScope = { doctorId: BigInt(OTHER_DOCTOR) };
const patientScope = { patientId: BigInt(PATIENT) };

describe('rating.service', () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    // Map DOCTOR (but not OTHER_DOCTOR) to CLINIC so clinic-admin scope resolves via the EXISTS join.
    await seedDoctorClinicMapping({ id: BASE + 961, doctorId: DOCTOR, clinicId: CLINIC_ID });
  });
  afterAll(cleanup);

  it('CLIENT create forces patient_id to the actor (ignores passed patientId)', async () => {
    const { id } = await createRating(
      { doctorId: DOCTOR, patientId: OTHER_PATIENT /* should be ignored */, review: 5 },
      kcClient,
    );
    expect(id).toBeGreaterThan(0);
    // Read back with SUPER_ADMIN scope to inspect the stored row.
    const row = await getRating(id, null);
    expect(row.patient_id).toBe(PATIENT); // forced to the actor, not OTHER_PATIENT
    expect(row.doctor_id).toBe(DOCTOR);
    expect(row.review).toBe(5);
    await deleteRating(id, null);
  });

  it('CLINIC_ADMIN create uses the row patient_id', async () => {
    const { id } = await createRating(
      { doctorId: DOCTOR, patientId: PATIENT, review: 4 },
      kcAdmin,
    );
    const row = await getRating(id, null);
    expect(row.patient_id).toBe(PATIENT);
    expect(row.review).toBe(4);
    await deleteRating(id, null);
  });

  it('get/list are scoped: clinic-admin sees ratings for their clinic doctors only', async () => {
    const inScope = await seedRating({ id: BASE + 971, review: 5, patientId: PATIENT, doctorId: DOCTOR });
    // OTHER_DOCTOR is not mapped to CLINIC, so this rating is out of the admin's clinic scope.
    const outScope = await seedRating({ id: BASE + 972, review: 3, patientId: OTHER_PATIENT, doctorId: OTHER_DOCTOR });

    // In clinic scope: visible
    expect((await getRating(inScope.id, clinicScope)).id).toBe(inScope.id);
    // Out of clinic scope: not found
    await expect(getRating(outScope.id, clinicScope)).rejects.toThrow();

    const list = await listRatings({ page: 1, perPage: 100 } as any, clinicScope);
    expect(list.ratings.some((r) => r.id === inScope.id)).toBe(true);
    expect(list.ratings.some((r) => r.id === outScope.id)).toBe(false);

    await deleteRating(inScope.id, null);
    await deleteRating(outScope.id, null);
  });

  it('PROFESSIONAL scope sees only ratings about their doctor_id', async () => {
    const mine = await seedRating({ id: BASE + 973, review: 5, patientId: PATIENT, doctorId: DOCTOR });
    const others = await seedRating({ id: BASE + 974, review: 2, patientId: PATIENT, doctorId: OTHER_DOCTOR });

    expect((await getRating(mine.id, doctorScope)).id).toBe(mine.id);
    // A different doctor's scope does not see it.
    await expect(getRating(mine.id, otherDoctorScope)).rejects.toThrow();
    // Their own scope sees only their rating in the list.
    const list = await listRatings({ page: 1, perPage: 100 } as any, doctorScope);
    expect(list.ratings.every((r) => r.doctor_id === DOCTOR)).toBe(true);
    expect(list.ratings.some((r) => r.id === mine.id)).toBe(true);
    expect(list.ratings.some((r) => r.id === others.id)).toBe(false);

    await deleteRating(mine.id, null);
    await deleteRating(others.id, null);
  });

  it('CLIENT (patient) scope sees only ratings they authored', async () => {
    const mine = await seedRating({ id: BASE + 975, review: 4, patientId: PATIENT, doctorId: DOCTOR });
    const others = await seedRating({ id: BASE + 976, review: 1, patientId: OTHER_PATIENT, doctorId: DOCTOR });

    expect((await getRating(mine.id, patientScope)).id).toBe(mine.id);
    await expect(getRating(others.id, patientScope)).rejects.toThrow();

    await deleteRating(mine.id, null);
    await deleteRating(others.id, null);
  });

  it('deleteRating removes the row', async () => {
    const { id } = await seedRating({ id: BASE + 977, review: 5, patientId: PATIENT, doctorId: DOCTOR });
    await deleteRating(id, null);
    await expect(getRating(id, null)).rejects.toThrow();
  });

  it('ratingStats returns avg + count grouped by doctor', async () => {
    await seedRating({ id: BASE + 978, review: 4, patientId: PATIENT, doctorId: DOCTOR });
    await seedRating({ id: BASE + 979, review: 2, patientId: OTHER_PATIENT, doctorId: DOCTOR });

    const { stats } = await ratingStats(null);
    const forDoctor = stats.find((s) => s.doctor_id === DOCTOR);
    expect(forDoctor).toBeDefined();
    expect(forDoctor!.count).toBe(2);
    expect(forDoctor!.avg_review).toBe(3); // (4 + 2) / 2

    await deleteRating(BASE + 978, null);
    await deleteRating(BASE + 979, null);
  });
});
