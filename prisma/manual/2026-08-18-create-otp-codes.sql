-- One-time sign-in codes. Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-08-18-create-otp-codes.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id`        varchar(191) NOT NULL,
  `userId`    varchar(191) NOT NULL,
  `codeHash`  varchar(191) NOT NULL,
  `expiresAt` datetime(3)  NOT NULL,
  `usedAt`    datetime(3)      NULL,
  `attempts`  int(11)      NOT NULL DEFAULT 0,
  `createdAt` datetime(3)  NOT NULL DEFAULT current_timestamp(3),
  `ipAddress` varchar(191)     NULL,
  `userAgent` text             NULL,
  PRIMARY KEY (`id`),
  KEY `otp_codes_userId_idx` (`userId`),
  KEY `otp_codes_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `otp_codes_userId_fkey` FOREIGN KEY (`userId`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
