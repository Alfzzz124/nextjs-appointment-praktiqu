-- Idempotency keys for public booking, so a timed-out POST can be retried safely.
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-11-booking-idempotency-keys.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- WHY: the gateway gives up at ~8s while the write carries on, so the front end
-- cannot tell "the booking landed" from "the booking was lost". It currently
-- guesses by re-reading /slots, which is wrong whenever a slot disappears for
-- some other reason. With a key it stops guessing: the same key returns the same
-- appointment instead of creating a second one.
--
-- `key` is the primary key on purpose. Two concurrent attempts race to INSERT and
-- exactly one wins; the loser reads the row and learns it is in flight. That
-- mutual exclusion is the table's real job, so it must not be reduced to a plain
-- index.
--
-- `appointmentId` NULL means an attempt is in flight. Rows are deleted when an
-- attempt fails, so a legitimate retry can claim the key again.

CREATE TABLE IF NOT EXISTS `booking_idempotency_keys` (
  `key`           varchar(191) NOT NULL,
  `fingerprint`   char(64)     NOT NULL,
  `appointmentId` int          NULL,
  `completedAt`   datetime(3)  NULL,
  `createdAt`     datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  KEY `booking_idempotency_keys_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
