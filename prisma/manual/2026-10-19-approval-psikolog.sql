-- Psychologist approval for paid online bookings (spec 2026-10-19-approval-psikolog-design.md §5).
-- Apply by hand, per environment, BEFORE the Next.js that reads these tables goes live:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-19-approval-psikolog.sql
--
-- Written out rather than generated because this database also holds KiviCare's wp_*
-- tables, and `prisma db push` would try to reconcile them against a schema that does
-- not describe them.
--
-- professional_approval_settings: one psychologist's switch. No row = off.
-- session_approvals: one paid booking that waits for (or was decided by) its
--   psychologist. KiviCare has no status for "paid, waiting for approval", so the
--   appointment stays PENDING and this row says why.
--
-- `updatedBy`, `decidedBy`, `refundedBy` are users.id (a cuid). NULL decidedBy means
-- the system or a change made outside the app (KiviCare's own dashboard).

CREATE TABLE IF NOT EXISTS `professional_approval_settings` (
  `doctorWpUserId`    bigint unsigned NOT NULL,
  `requiresApproval`  tinyint(1)      NOT NULL DEFAULT 0,
  `updatedBy`         varchar(191)    NULL,
  `updatedAt`         datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`doctorWpUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_approvals` (
  `appointmentId`   bigint unsigned NOT NULL,
  `doctorWpUserId`  bigint unsigned NOT NULL,
  `clinicId`        bigint unsigned NOT NULL,
  `paymentOrderId`  varchar(191)    NULL,
  `state`           varchar(16)     NOT NULL,
  `requestedAt`     datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decidedAt`       datetime(3)     NULL,
  `decidedBy`       varchar(191)    NULL,
  `rejectReason`    varchar(500)    NULL,
  `refundStatus`    varchar(8)      NOT NULL DEFAULT 'NONE',
  `refundedAt`      datetime(3)     NULL,
  `refundedBy`      varchar(191)    NULL,
  `refundNote`      varchar(500)    NULL,
  `lastReminderAt`  datetime(3)     NULL,
  `escalatedAt`     datetime(3)     NULL,
  PRIMARY KEY (`appointmentId`),
  KEY `session_approvals_doctor_state_idx` (`doctorWpUserId`, `state`),
  KEY `session_approvals_clinic_state_idx` (`clinicId`, `state`),
  KEY `session_approvals_refund_idx` (`refundStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
