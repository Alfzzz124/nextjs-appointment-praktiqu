/**
 * Id blocks for integration suites that write to the shared MySQL test DB.
 *
 * Every suite that seeds rows at fixed ids, or deletes rows by an id range, owns exactly
 * one block of BLOCK_SIZE ids and keeps every id it writes (primary keys and the
 * doctor_id / clinic_id / patient_id / module_id it range-deletes by) inside it. Blocks
 * never overlap, on any table, so one suite's cleanup cannot delete another suite's rows
 * even when two runs share the DB.
 *
 * They used to be picked by hand. Copied BASE constants and 100k-wide repository ranges
 * left a dozen suites wiping each other's rows (wp-catalog's [8.6M, 8.7M) covered seven
 * clinic suites, owner-mode-header and clinics-repo-write both sat at 8_770_000, and all
 * 26 billing suites shared one TEST_MARKER range). Only `fileParallelism: false` hid it.
 *
 * Adding a suite: take the next free BASE below, add a row, and call
 * `idBlock('<path under tests/>')` (or `useIdBlock(...)` from tests/billing/fixtures.ts
 * when the suite uses its seed defaults or `cleanup()`). The suite's ids are then
 * `BASE + n` with n < BLOCK_SIZE. tests/unit/test-id-blocks.test.ts fails on an overlap,
 * a row whose file does not claim it, or a suite that hard-codes its own BASE.
 *
 * Rows that app code inserts get AUTO_INCREMENT ids. tests/global-setup.ts lifts every
 * wp_* counter to ID_BLOCK_CEILING, so those rows land above all blocks rather than in
 * whichever block happened to hold the highest fixed id. Suites delete them by a foreign
 * key that points into their block, never by an open-ended `id >= BASE`.
 *
 * The tables column lists what each suite range-deletes ("kc_" = "wp_kc_"). It is a
 * reading aid; the overlap check does not need it, because blocks are disjoint outright.
 */

export const BLOCK_SIZE = 10_000;
export const ID_BLOCK_FLOOR = 7_000_000;
export const ID_BLOCK_CEILING = 10_000_000;

type Row = readonly [base: number, file: string, tables: string];

export const ID_BLOCKS: readonly Row[] = [
  [7_800_000, 'complete-in-progress/practices.test.ts', 'kc_clinics'],
  [7_900_000, 'integration/practice/practice-wp.test.ts', 'kc_clinics, kc_clinic_schedule'],
  [7_950_000, 'integration/practice/practice-list-scope.test.ts', 'kc_clinics'],
  [7_960_000, 'integration/payments/clinic-payment-option.test.ts', 'wp_options (by clinic id)'],
  [8_000_000, 'repositories/wp-sessions.repo.test.ts', 'kc_appointments, wp_users, wp_usermeta'],
  [8_100_000, 'integration/professional/professional-wp.test.ts', 'kc_clinic_sessions, kc_clinic_schedule, kc_service_doctor_mapping, kc_doctor_clinic_mappings, kc_appointments, kc_services, wp_users, wp_usermeta'],
  [8_200_000, 'repositories/wp-off-days.repo.test.ts', 'kc_clinic_schedule'],
  [8_300_000, 'complete-in-progress/clients.test.ts', 'kc_patient_clinic_mappings, kc_appointments, wp_users, wp_usermeta'],
  [8_400_000, 'complete-in-progress/clients-professional-scope.test.ts', 'kc_patient_clinic_mappings, kc_doctor_clinic_mappings, kc_appointments, wp_users, wp_usermeta'],
  [8_410_000, 'repositories/wp-patients.repo.test.ts', 'kc_patient_clinic_mappings, wp_users, wp_usermeta'],
  [8_500_000, 'repositories/wp-doctors.repo.test.ts', 'kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_510_000, 'integration/session/sessions-practice-filter.test.ts', 'kc_appointments, kc_clinics'],
  [8_600_000, 'integration/auth/auth-me-clinic-id.test.ts', 'kc_clinics, kc_doctor_clinic_mappings, kc_receptionist_clinic_mappings'],
  [8_610_000, 'repositories/wp-catalog.repo.test.ts', 'kc_clinics, kc_services, kc_service_doctor_mapping'],
  [8_620_000, 'integration/practice/clinic-admins.test.ts', 'kc_clinics, wp_users, wp_usermeta'],
  [8_630_000, 'repositories/wp-custom-fields.repo.test.ts', 'kc_custom_fields, kc_custom_fields_data'],
  [8_640_000, 'integration/practice/practice-delete-permanent.test.ts', 'kc_clinics, kc_clinic_schedule, kc_doctor_clinic_mappings, wp_options'],
  [8_650_000, 'integration/auth/admin-clinics.test.ts', 'kc_clinics, kc_doctor_clinic_mappings, kc_receptionist_clinic_mappings'],
  [8_660_000, 'integration/auth/active-clinic-header.test.ts', 'kc_clinics'],
  [8_670_000, 'integration/practice/practice-active-clinic.test.ts', 'kc_clinics'],
  [8_680_000, 'integration/client/client-multi-clinic-access.test.ts', 'kc_clinics, kc_patient_clinic_mappings, wp_users, wp_usermeta'],
  [8_690_000, 'integration/practice/change-admin.test.ts', 'kc_clinics, wp_users, wp_usermeta'],
  [8_700_000, 'integration/auth/refresh-inactive-account.test.ts', 'wp_users, wp_usermeta'],
  [8_710_000, 'integration/services/practice-clinics.test.ts', 'kc_clinics, kc_doctor_clinic_mappings'],
  [8_720_000, 'integration/services/professional-create.test.ts', 'kc_clinics, kc_doctor_clinic_mappings, kc_static_data, kc_services (by name)'],
  [8_730_000, 'repositories/wp-appointments.repo.test.ts', 'kc_appointments'],
  [8_740_000, 'integration/practice/practice-create.test.ts', 'kc_clinics, wp_users, wp_usermeta'],
  [8_750_000, 'integration/practice/practice-status.test.ts', 'kc_clinics, wp_users, wp_usermeta'],
  [8_760_000, 'services/clinic-owner.service.test.ts', 'clinic_owners, kc_clinics, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_770_000, 'integration/auth/owner-mode-header.test.ts', 'clinic_owners, kc_clinics, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_780_000, 'integration/auth/owner-mode-scope.test.ts', 'clinic_owners, kc_clinics, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_790_000, 'integration/practice/clinic-owners-route.test.ts', 'clinic_owners, kc_clinics, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_800_000, 'repositories/wp-clinic-sessions.repo.test.ts', 'kc_clinic_sessions'],
  [8_810_000, 'repositories/wp-encounter-documents.repo.test.ts', 'kc_custom_fields_data, kc_appointments, wp_posts'],
  [8_820_000, 'repositories/wp-clinical-records.repo.test.ts', 'kc_medical_history, kc_prescription'],
  [8_830_000, 'integration/booking/professional-lookup.test.ts', 'kc_clinic_sessions, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_840_000, 'integration/professional/professional-detail-clinics.test.ts', 'kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_850_000, 'integration/practice/clinics-repo-write.test.ts', 'kc_clinics, kc_doctor_clinic_mappings, wp_users'],
  [8_860_000, 'integration/auth/auth-me-owned-clinics.test.ts', 'kc_clinics, kc_doctor_clinic_mappings, wp_users, wp_usermeta'],
  [8_870_000, 'integration/approval/approval-routes.test.ts', 'session_approvals, professional_approval_settings, payment_orders, kc_appointments, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta'],
  [8_880_000, 'integration/approval/approval-reconcile.test.ts', 'session_approvals, kc_appointments, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta'],
  [8_890_000, 'integration/schedule/overlap-pairs.test.ts', 'kc_appointments'],
  [8_900_000, 'billing/patient-medical-report-rename.test.ts', 'kc_patient_medical_report'],
  [8_910_000, 'repositories/wp-static-data.repo.test.ts', 'kc_static_data'],
  [8_920_000, 'integration/schedule/conflict-scan.test.ts', 'schedule_conflict_notices (whole table), kc_appointments, kc_clinics, wp_users, wp_usermeta'],
  [8_930_000, 'integration/approval/approval-store.test.ts', 'session_approvals, professional_approval_settings, payment_orders, wp_users'],
  [8_940_000, 'integration/approval/public-requires-approval.test.ts', 'professional_approval_settings, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta'],
  [8_950_000, 'billing/attachment-ownership-guard.integration.test.ts', 'kc_appointments, wp_posts'],
  [8_960_000, 'integration/session/export-pending-clinic-scope.test.ts', 'kc_appointments, kc_patient_clinic_mappings, kc_receptionist_clinic_mappings, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta'],
  [8_970_000, 'complete-in-progress/sessions.test.ts', 'users (one row by id; its unique wpUserId is BASE + 900)'],
  [8_980_000, 'integration/approval/approval-email-link.test.ts', 'session_approvals, payment_orders, kc_appointments, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta, users (approval-link-test-*)'],
  [9_000_000, 'billing/patient-medical-report-delete-unlink.test.ts', 'kc_patient_medical_report, kc_custom_fields_data'],

  // Billing suites. Each calls cleanup() from tests/billing/fixtures.ts, which deletes
  // across ~25 wp_kc_* tables plus wp_users / wp_usermeta, all within the suite's block.
  [9_010_000, 'billing/bill-email-route.test.ts', 'cleanup()'],
  [9_020_000, 'billing/bill-routes-scope.integration.test.ts', 'cleanup()'],
  [9_030_000, 'billing/bill-scope.test.ts', 'kc_bills, kc_bill_items, kc_patient_encounters'],
  [9_040_000, 'billing/bill.service.test.ts', 'cleanup()'],
  [9_050_000, 'billing/clinic-schedule.service.test.ts', 'cleanup()'],
  [9_060_000, 'billing/dashboard.service.test.ts', 'cleanup()'],
  [9_070_000, 'billing/doctor-session.service.test.ts', 'cleanup()'],
  [9_080_000, 'billing/encounter-routes.integration.test.ts', 'cleanup()'],
  [9_090_000, 'billing/encounter.service.test.ts', 'cleanup()'],
  [9_100_000, 'billing/followup.service.test.ts', 'cleanup()'],
  [9_110_000, 'billing/gdpr.service.test.ts', 'cleanup(), cleanupTestConsentVersions()'],
  [9_120_000, 'billing/import.service.test.ts', 'cleanup(), cleanupImportedUsers()'],
  [9_130_000, 'billing/medical-history.service.test.ts', 'cleanup()'],
  [9_140_000, 'billing/patient-medical-report-exclude-ids.test.ts', 'cleanup()'],
  [9_150_000, 'billing/patient-medical-report.service.test.ts', 'cleanup()'],
  [9_160_000, 'billing/practice-routes-scope.integration.test.ts', 'cleanup()'],
  [9_170_000, 'billing/practice-scope.test.ts', 'cleanup()'],
  [9_180_000, 'billing/prescription.service.test.ts', 'cleanup()'],
  [9_190_000, 'billing/professional-session-week-routes.integration.test.ts', 'cleanup()'],
  [9_200_000, 'billing/patient-medical-report-bulk-delete-partial-failure.test.ts', 'kc_patient_medical_report, kc_custom_fields_data'],
  [9_210_000, 'billing/rating.service.test.ts', 'cleanup()'],
  [9_220_000, 'billing/receptionist.service.test.ts', 'cleanup()'],
  [9_230_000, 'billing/routes.integration.test.ts', 'cleanup()'],
  [9_240_000, 'billing/tax-routes-scope.integration.test.ts', 'cleanup()'],
  [9_250_000, 'billing/tax-scope.test.ts', 'cleanup()'],
  [9_260_000, 'billing/tax.service.test.ts', 'cleanup()'],
  [9_270_000, 'integration/professional/availability-overlap.test.ts', 'cleanup()'],
];

export interface IdBlock {
  /** First id of the block. */
  BASE: number;
  /** One past the last id: a suite's range deletes are `>= BASE AND < END`. */
  END: number;
}

/** The block registered for `file`, given as its path under tests/. */
export function idBlock(file: string): IdBlock {
  const row = ID_BLOCKS.find(([, f]) => f === file);
  if (!row) {
    throw new Error(`No id block registered for tests/${file}. Add a row to tests/helpers/id-blocks.ts.`);
  }
  return { BASE: row[0], END: row[0] + BLOCK_SIZE };
}
