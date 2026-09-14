-- One Google Calendar connection per professional.
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-11-google-calendar-connections.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- `refreshTokenEncrypted` is AES-256-GCM (see src/lib/secret-box.ts), never the raw
-- token. It is nullable because a revoked connection keeps its row -- so the person
-- can see it and reconnect -- while holding no credential.
--
-- `connectedAt` is separate from `createdAt`: reconnecting after a revocation
-- reuses the row, and the first question anyone asks about a misbehaving sync is
-- "since when has it been connected", which `createdAt` would answer wrongly.
--
-- `status` is one of 'active' | 'revoked' | 'error'. Left as a plain string rather
-- than an ENUM so adding a state does not need a table rebuild on a live WP database.

CREATE TABLE IF NOT EXISTS `google_calendar_connections` (
  `id`                    varchar(191) NOT NULL,
  `professionalId`        bigint unsigned NOT NULL,
  `googleAccountEmail`    varchar(255) NOT NULL,
  `refreshTokenEncrypted` text         NULL,
  `scopeGranted`          text         NOT NULL,
  `calendarIds`           json         NOT NULL,
  `status`                varchar(16)  NOT NULL DEFAULT 'active',
  `connectedAt`           datetime(3)  NOT NULL,
  `lastCheckedAt`         datetime(3)  NULL,
  `lastErrorAt`           datetime(3)  NULL,
  `lastErrorMessage`      text         NULL,
  `createdAt`             datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `google_calendar_connections_professionalId_key` (`professionalId`),
  KEY `google_calendar_connections_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
