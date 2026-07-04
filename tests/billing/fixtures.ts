import { prisma } from '@/lib/db';

const TEST_MARKER = 9_000_000; // ids in this range belong to tests

export function assertTestDb(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/test/i.test(url)) {
    throw new Error('Refusing to seed fixtures: DATABASE_URL does not look like a test DB');
  }
}

export async function seedClinicAdmin(opts: { userId: number; clinicId: number }) {
  assertTestDb();
  await prisma.kcUser.create({
    data: {
      id: BigInt(opts.userId), userLogin: `admin${opts.userId}`,
      userEmail: `admin${opts.userId}@test.local`, displayName: 'Admin',
      userRegistered: new Date(),
    },
  });
  await prisma.kcClinic.create({
    data: { id: BigInt(opts.clinicId), name: 'Test Clinic', clinicAdminId: BigInt(opts.userId), clinicLogo: 0n, status: 1, createdAt: new Date() } as any,
  });
  // Link the PraktiQU user (cuid) → wpUserId for resolveKcActor.
  await prisma.user.create({
    data: {
      id: `test-admin-${opts.userId}`, email: `admin${opts.userId}@test.local`,
      username: `admin${opts.userId}`, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(opts.userId), status: 1,
    },
  });
}

export async function seedTax(data: Partial<{ id: number; name: string; taxType: string; taxValue: string; clinicId: number; status: number }>) {
  assertTestDb();
  return prisma.kcTax.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 1),
      name: data.name ?? 'VAT', taxType: data.taxType ?? 'percentage',
      taxValue: data.taxValue ?? '10', clinicId: BigInt(data.clinicId ?? -1),
      doctorId: -1n, serviceId: -1n, addedBy: 1n, status: data.status ?? 1, createdAt: new Date(),
    },
  });
}

export async function seedEncounter(data: Partial<{
  id: number; clinicId: number; doctorId: number; patientId: number;
  status: number; description: string; encounterDate: Date;
}>) {
  assertTestDb();
  return prisma.kcPatientEncounter.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 500),
      clinicId: BigInt(data.clinicId ?? TEST_MARKER + 1),
      doctorId: BigInt(data.doctorId ?? TEST_MARKER + 2),
      patientId: BigInt(data.patientId ?? TEST_MARKER + 3),
      status: data.status ?? 1,
      description: data.description ?? 'Test encounter',
      encounterDate: data.encounterDate ?? new Date('2026-01-15'),
      addedBy: BigInt(TEST_MARKER + 2),
      createdAt: new Date('2026-01-15'),
    },
  });
}

export async function seedPrescription(data: Partial<{
  id: number; encounterId: number; patientId: number;
  name: string; frequency: string; duration: string; instruction: string; addedBy: number;
}>) {
  assertTestDb();
  return prisma.kcPrescription.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 800),
      encounterId: BigInt(data.encounterId ?? TEST_MARKER + 500),
      patientId: BigInt(data.patientId ?? TEST_MARKER + 3),
      name: data.name ?? 'Test medicine',
      frequency: data.frequency ?? '1-0-1',
      duration: data.duration ?? '5 days',
      instruction: data.instruction ?? 'After meals',
      addedBy: BigInt(data.addedBy ?? TEST_MARKER + 2),
      createdAt: new Date('2026-01-15'),
      isFromTemplate: 0,
    },
  });
}

export async function seedMedicalHistory(data: Partial<{
  id: number; encounterId: number; patientId: number;
  type: string; title: string; addedBy: number;
}>) {
  assertTestDb();
  return prisma.kcMedicalHistory.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 850),
      encounterId: BigInt(data.encounterId ?? TEST_MARKER + 500),
      patientId: BigInt(data.patientId ?? TEST_MARKER + 3),
      type: data.type ?? 'general',
      title: data.title ?? 'Test condition',
      addedBy: BigInt(data.addedBy ?? TEST_MARKER + 2),
      createdAt: new Date('2026-01-15'),
      isFromTemplate: 0,
    },
  });
}

export async function seedMedReport(data: Partial<{
  id: number; patientId: number; name: string; uploadReport: string; date: Date;
}>) {
  assertTestDb();
  return prisma.kcPatientMedicalReport.create({
    data: {
      id: BigInt(data.id ?? TEST_MARKER + 900),
      patientId: BigInt(data.patientId ?? TEST_MARKER + 3),
      name: data.name ?? 'Test report',
      uploadReport: data.uploadReport ?? '0',
      date: data.date ?? new Date('2026-01-15'),
    },
  });
}

/** Insert a patient→clinic mapping row so clinic-scoped reads can be exercised. */
export async function seedPatientClinicMapping(data: Partial<{
  id: number; patientId: number; clinicId: number;
}>) {
  assertTestDb();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_clinic_mappings (id, patient_id, clinic_id, created_at) VALUES (?, ?, ?, ?)`,
    data.id ?? TEST_MARKER + 950,
    data.patientId ?? TEST_MARKER + 3,
    data.clinicId ?? TEST_MARKER + 1,
    new Date('2026-01-15'),
  );
}

/**
 * Provision a receptionist directly: wp_users row + the receptionist capability
 * meta (+ first/last name) + a clinic mapping. Ids are in the TEST_MARKER range.
 */
export async function seedReceptionist(data: Partial<{
  id: number; email: string; name: string; clinicId: number; status: number;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 100;
  const name = data.name ?? 'Test Receptionist';
  const email = data.email ?? `recp${id}@test.local`;
  const clinicId = data.clinicId ?? TEST_MARKER + 1;
  const status = data.status ?? 0;
  const login = email.split('@')[0].slice(0, 60);
  const first = name.split(' ')[0];
  const last = name.split(' ').slice(1).join(' ') || '-';
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, display_name, user_email, user_url, user_registered, user_activation_key, user_status)
     VALUES (?, ?, '', ?, ?, ?, '', NOW(), '', ?)`,
    id, login, login, name, email, status,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
     (?, 'first_name', ?), (?, 'last_name', ?),
     (?, 'wp_capabilities', 'a:1:{s:21:"kiviCare_receptionist";b:1;}'),
     (?, 'wp_user_level', '0')`,
    id, first, id, last, id, id,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_receptionist_clinic_mappings (id, receptionist_id, clinic_id, created_at) VALUES (?, ?, ?, NOW())`,
    id, id, clinicId,
  );
  return { id };
}

/**
 * Insert a doctor session row (wp_kc_clinic_sessions) via raw SQL so TIME columns
 * take plain 'HH:mm:ss' strings (avoids Prisma @db.Time DateTime conversion).
 */
export async function seedClinicSession(data: Partial<{
  id: number; clinicId: number; doctorId: number; day: string;
  startTime: string; endTime: string; timeSlot: number;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 200;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_sessions (id, clinic_id, doctor_id, day, start_time, end_time, time_slot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    id,
    data.clinicId ?? TEST_MARKER + 1,
    data.doctorId ?? TEST_MARKER + 2,
    data.day ?? 'mon',
    data.startTime ?? '09:00:00',
    data.endTime ?? '17:00:00',
    data.timeSlot ?? 30,
  );
  return { id };
}

/**
 * Insert a clinic-schedule row (wp_kc_clinic_schedule) via raw SQL so date/time
 * columns take plain 'YYYY-MM-DD' / 'HH:mm:ss' strings. Ids in TEST_MARKER range.
 */
export async function seedClinicSchedule(data: Partial<{
  id: number; moduleType: string; moduleId: number; selectionMode: string;
  startDate: string; endDate: string; selectedDates: string; timeSpecific: number;
  startTime: string; endTime: string; timezone: string; description: string; status: number;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 300;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule
     (id, start_date, end_date, selection_mode, selected_dates, time_specific, start_time, end_time, timezone, module_type, module_id, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    id,
    data.startDate ?? '2026-07-01',
    data.endDate ?? '2026-07-05',
    data.selectionMode ?? 'range',
    data.selectedDates ?? null,
    data.timeSpecific ?? 0,
    data.startTime ?? null,
    data.endTime ?? null,
    data.timezone ?? 'Asia/Jakarta',
    data.moduleType ?? 'clinic',
    data.moduleId ?? TEST_MARKER + 1,
    data.description ?? 'Test schedule',
    data.status ?? 1,
  );
  return { id };
}

/**
 * Insert an appointment row (wp_kc_appointments) via raw SQL. Provides sensible
 * defaults for the NOT-NULL columns (appointment_start_time, appointment_timezone,
 * status, created_at). Ids in TEST_MARKER range.
 */
export async function seedAppointment(data: Partial<{
  id: number; clinicId: number; doctorId: number; patientId: number;
  status: number; startDate: string; startTime: string;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 400;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
     (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time, appointment_timezone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    id,
    data.clinicId ?? TEST_MARKER + 1,
    data.doctorId ?? TEST_MARKER + 2,
    data.patientId ?? TEST_MARKER + 3,
    data.startDate ?? '2026-07-10',
    data.startTime ?? '09:00:00',
    'Asia/Jakarta',
    data.status ?? 1,
  );
  return { id };
}

/**
 * Insert a bill row (wp_kc_bills) via raw SQL. actual_amount is a varchar; status
 * is bigint NOT NULL; created_at NOT NULL. Ids in TEST_MARKER range.
 */
export async function seedBill(data: Partial<{
  id: number; clinicId: number; encounterId: number; actualAmount: string; createdAt: string;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 600;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_bills
     (id, encounter_id, actual_amount, status, payment_status, created_at, clinic_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.encounterId ?? TEST_MARKER + 500,
    data.actualAmount ?? '100.00',
    1,
    'paid',
    data.createdAt ?? '2026-07-10 12:00:00',
    data.clinicId ?? TEST_MARKER + 1,
  );
  return { id };
}

/** Insert a doctor→clinic mapping row so clinic-scoped rating reads can be exercised. */
export async function seedDoctorClinicMapping(data: Partial<{
  id: number; doctorId: number; clinicId: number;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 960;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
    id,
    data.doctorId ?? TEST_MARKER + 2,
    data.clinicId ?? TEST_MARKER + 1,
  );
  return { id };
}

/** Insert a patient-review row (wp_kc_patient_review) via raw SQL. Ids in TEST_MARKER range. */
export async function seedRating(data: Partial<{
  id: number; review: number; reviewDescription: string; patientId: number; doctorId: number;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 970;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_patient_review (id, review, review_description, patient_id, doctor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    id,
    data.review ?? 5,
    data.reviewDescription ?? null,
    data.patientId ?? TEST_MARKER + 3,
    data.doctorId ?? TEST_MARKER + 2,
  );
  return { id };
}

/**
 * Insert a followup-chain row (wp_kc_followup_chains) via raw SQL. Provides
 * defaults for NOT-NULL columns (clinic_id, patient_id, doctor_id, status,
 * created_at_utc). Ids in TEST_MARKER range.
 */
export async function seedFollowupChain(data: Partial<{
  id: number; clinicId: number; doctorId: number; patientId: number; status: string;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 1000;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followup_chains
     (id, clinic_id, patient_id, doctor_id, name, status, created_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    id,
    data.clinicId ?? TEST_MARKER + 1,
    data.patientId ?? TEST_MARKER + 3,
    data.doctorId ?? TEST_MARKER + 2,
    'Test chain',
    data.status ?? 'active',
  );
  return { id };
}

/**
 * Insert a followup row (wp_kc_followups) via raw SQL. Provides defaults for the
 * NOT-NULL columns (clinic_id, doctor_id, patient_id, chain_id, reason,
 * created_at_utc, suggested_date_utc, suggested_deadline_utc, status). Ids in
 * TEST_MARKER range.
 */
export async function seedFollowup(data: Partial<{
  id: number; chainId: number; clinicId: number; doctorId: number; patientId: number;
  status: string; reason: string; suggestedDate: string; suggestedDeadline: string;
}>) {
  assertTestDb();
  const id = data.id ?? TEST_MARKER + 1100;
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_followups
     (id, clinic_id, doctor_id, patient_id, chain_id, reason, priority, status,
      created_at_utc, suggested_date_utc, suggested_deadline_utc)
     VALUES (?, ?, ?, ?, ?, ?, 'routine', ?, UTC_TIMESTAMP(), ?, ?)`,
    id,
    data.clinicId ?? TEST_MARKER + 1,
    data.doctorId ?? TEST_MARKER + 2,
    data.patientId ?? TEST_MARKER + 3,
    data.chainId ?? TEST_MARKER + 1000,
    data.reason ?? 'Test followup reason',
    data.status ?? 'pending',
    data.suggestedDate ?? '2026-07-10 09:00:00',
    data.suggestedDeadline ?? '2026-07-20 09:00:00',
  );
  return { id };
}

export async function cleanup() {
  assertTestDb();
  // Import-created rows use real auto-increment ids (below TEST_MARKER), so they
  // are matched by their TEST_MARKER-range clinic scope / *.import.test email.
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE clinic_id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_usermeta WHERE user_id IN (SELECT ID FROM wp_users WHERE user_email LIKE '%.import.test')`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id IN (SELECT ID FROM wp_users WHERE user_email LIKE '%.import.test')`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_clinic_mappings WHERE patient_id IN (SELECT ID FROM wp_users WHERE user_email LIKE '%.import.test')`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_users WHERE user_email LIKE '%.import.test'`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_taxes WHERE clinic_id >= ${TEST_MARKER}`);
  // FK-safe order: leaf tables reference encounters, so delete them first.
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_bills WHERE id >= ${TEST_MARKER}`);
  await prisma.kcPatientMedicalReport.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_clinic_mappings WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_sessions WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_receptionist_clinic_mappings WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_review WHERE id >= ${TEST_MARKER}`);
  // Followups: FK-safe order (activity log + reminders reference followups; followups reference chains).
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_activity_log WHERE id >= ${TEST_MARKER} OR followup_id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_reminders WHERE id >= ${TEST_MARKER} OR followup_id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followups WHERE id >= ${TEST_MARKER}`);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_followup_chains WHERE id >= ${TEST_MARKER}`);
  await prisma.kcPrescription.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcMedicalHistory.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcPatientEncounter.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcTax.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBillItem.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcBill.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcTaxData.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.kcClinic.deleteMany({ where: { id: { gte: BigInt(TEST_MARKER) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'test-' } } });
}
