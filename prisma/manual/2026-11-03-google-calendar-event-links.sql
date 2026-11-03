-- Tautan yang Google kembalikan saat acara dibuat, dan selama ini dibuang.
--
-- DIJALANKAN MANUAL. Jangan `prisma migrate dev` dan jangan `prisma db push`.
--
-- Pasangan di schema.prisma: GoogleCalendarEventSync.htmlLink dan .hangoutLink.
--
-- htmlLink    : tautan ke acaranya di Google Calendar
-- hangoutLink : tautan Meet, hanya untuk layanan ber-telemed_service = 'yes'.
--               NULL bisa berarti bukan sesi online, ATAU Google menolak
--               membuatkannya — keduanya dibedakan lewat lastError, bukan
--               ditebak dari kolom ini.

ALTER TABLE `google_calendar_event_sync`
  ADD COLUMN `htmlLink` TEXT NULL DEFAULT NULL AFTER `calendarId`,
  ADD COLUMN `hangoutLink` VARCHAR(255) NULL DEFAULT NULL AFTER `htmlLink`;
