-- Psychologists marked as owners of a clinic ("pemilik klinik").
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-16-clinic-owners.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- Not stored in wp_kc_doctor_clinic_mappings.owner: KiviCare deletes and recreates a
-- doctor's mappings every time the doctor is saved (DoctorController.php:1627-1633),
-- which would silently reset the flag to 0.
--
-- A row only grants anything while the psychologist is still an ACTIVE doctor mapped to
-- the clinic; the check lives in src/services/clinic-owner/service.ts, so a stale row
-- left behind by an unmapping is harmless. A clinic with exactly one active
-- psychologist makes them owner without any row here.
--
-- `createdBy` is users.id (a cuid) of whoever ticked the box.

CREATE TABLE IF NOT EXISTS `clinic_owners` (
  `id`              bigint unsigned NOT NULL AUTO_INCREMENT,
  `clinicId`        bigint unsigned NOT NULL,
  `doctorWpUserId`  bigint unsigned NOT NULL,
  `createdBy`       varchar(191)    NOT NULL,
  `createdAt`       datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `clinic_owners_clinicId_doctorWpUserId_key` (`clinicId`, `doctorWpUserId`),
  KEY `clinic_owners_doctorWpUserId_idx` (`doctorWpUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
