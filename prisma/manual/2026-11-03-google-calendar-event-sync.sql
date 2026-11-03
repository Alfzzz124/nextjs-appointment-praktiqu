-- Niat sinkronisasi acara Google Calendar untuk tiap janji.
--
-- DIJALANKAN MANUAL. Jangan `prisma migrate dev` dan jangan `prisma db push`:
-- DATABASE_URL di proyek ini MENUNJUK ke basis data WordPress yang hidup, dan
-- skemanya bercampur antara tabel aplikasi dan tabel wp_*. Perintah migrasi
-- Prisma akan menawarkan diri menghapus tabel WordPress yang tidak dikenalnya.
--
-- Nama kolom camelCase, mengikuti tabel aplikasi sekeluarganya
-- (google_calendar_connections, google_busy_cache, google_conflict_warnings,
-- booking_idempotency_keys) — yang snake_case di basis data ini hanyalah tabel
-- wp_* milik WordPress.
--
-- Pasangan di schema.prisma: model GoogleCalendarEventSync.

CREATE TABLE IF NOT EXISTS `google_calendar_event_sync` (
  -- wp_kc_appointments.id. PRIMARY KEY, bukan sekadar indeks unik: satu janji
  -- tidak boleh punya dua baris niat yang saling bertabrakan, dan kunci utama
  -- membuat INSERT ... ON DUPLICATE KEY menjadi mutex yang murah.
  `appointmentId` BIGINT UNSIGNED NOT NULL,

  -- wp_users.ID milik psikolog. Disalin ke sini, bukan selalu di-JOIN: penyapu
  -- mengelompokkan pekerjaan per psikolog untuk menukar satu access token saja
  -- untuk banyak acara, dan janji yang terhapus tidak boleh menyembunyikan
  -- acaranya dari penghapusan.
  `professionalId` BIGINT UNSIGNED NOT NULL,

  -- 'present' | 'absent'. Keadaan yang SEHARUSNYA ada di Google, bukan yang ada.
  `desiredState` VARCHAR(16) NOT NULL,

  -- Sidik jari isi acara yang diinginkan. Sinkron berarti desiredHash sama
  -- dengan syncedHash; keduanya berbeda berarti ada pekerjaan.
  `desiredHash` CHAR(64) NOT NULL,

  -- Sidik jari yang benar-benar sudah mendarat di Google. NULL berarti belum
  -- pernah berhasil sekali pun.
  `syncedHash` CHAR(64) NULL DEFAULT NULL,

  -- Id acara dari Google. NULL sebelum acaranya dibuat, dan dikosongkan lagi
  -- setelah penghapusan berhasil.
  `googleEventId` VARCHAR(255) NULL DEFAULT NULL,

  -- Kalender tujuan. Kolom tersendiri supaya id kalender "PraktiQu" yang kita
  -- buat sendiri per psikolog bisa disimpan tanpa mengubah skema.
  `calendarId` VARCHAR(255) NOT NULL DEFAULT 'primary',

  -- Percobaan sejak terakhir berhasil; dinolkan tiap kali sinkron tercapai.
  `attempts` INT NOT NULL DEFAULT 0,

  -- Jeda mundur. NULL berarti boleh dicoba sekarang.
  `nextAttemptAt` DATETIME NULL DEFAULT NULL,

  `lastError` TEXT NULL DEFAULT NULL,

  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`appointmentId`),

  -- Kueri penyapu: baris yang belum sinkron dan sudah boleh dicoba, per psikolog.
  KEY `idx_gces_pekerjaan` (`professionalId`, `nextAttemptAt`),

  -- Rekonsiliasi mencari baris yang belum sinkron tanpa menyaring psikolog.
  KEY `idx_gces_belum_sinkron` (`nextAttemptAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
