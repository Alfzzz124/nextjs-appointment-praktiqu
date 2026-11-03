-- Kalender "PraktiQu" terpisah yang kita buat di akun psikolog, satu kali.
--
-- DIJALANKAN MANUAL. Jangan `prisma migrate dev` dan jangan `prisma db push`:
-- DATABASE_URL di proyek ini MENUNJUK ke basis data WordPress yang hidup.
--
-- Pasangan di schema.prisma: GoogleCalendarConnection.appCalendarId.
--
-- Nama kolom camelCase, mengikuti tabel itu sendiri — kolom wp_* yang
-- snake_case adalah milik WordPress, bukan konvensi tabel aplikasi kita.
--
-- NULL sampai arah tulis dinyalakan untuk orang itu. Kolomnya ada karena izin
-- `calendar.app.created` hanya memberi akses ke kalender yang dibuat aplikasi
-- ini sendiri — kalender asli psikolog di luar jangkauan secara struktural,
-- bukan sekadar tidak kita sentuh.

ALTER TABLE `google_calendar_connections`
  ADD COLUMN `appCalendarId` VARCHAR(255) NULL DEFAULT NULL AFTER `calendarIds`;
