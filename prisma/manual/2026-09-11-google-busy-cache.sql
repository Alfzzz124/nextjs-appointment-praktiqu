-- Cached Google free/busy answers, one row per professional per local date.
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-11-google-busy-cache.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- WHY: without it, every render of a booking page for a connected professional
-- costs two round trips to Google -- a token refresh and a freebusy query.
--
-- KEYED PER DATE, not per requested range. The design document said range, but the
-- booking page asks for a fortnight while the slots API asks for one day, so
-- range-keyed rows would never share a single hit between them.
--
-- `busy` holds local minute ranges ([{start,end}], minutes past local midnight),
-- already converted -- not Google's UTC instants. The conversion needs the
-- professional's timezone, and storing the converted form means a timezone change
-- invalidates nothing silently: `timeZone` is stored alongside so a mismatch can be
-- treated as a miss.
--
-- Holds no event content. freebusy returns none, and none is derived.

CREATE TABLE IF NOT EXISTS `google_busy_cache` (
  `id`             varchar(191) NOT NULL,
  `professionalId` bigint unsigned NOT NULL,
  `date`           date         NOT NULL,
  `timeZone`       varchar(64)  NOT NULL,
  `busy`           json         NOT NULL,
  `fetchedAt`      datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `google_busy_cache_professionalId_date_key` (`professionalId`, `date`),
  KEY `google_busy_cache_fetchedAt_idx` (`fetchedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
