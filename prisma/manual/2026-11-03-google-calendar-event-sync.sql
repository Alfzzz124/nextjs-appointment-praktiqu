-- Niat sinkronisasi acara Google Calendar untuk tiap janji.
--
-- DIJALANKAN MANUAL. Jangan `prisma migrate dev` dan jangan `prisma db push`:
-- DATABASE_URL di proyek ini MENUNJUK ke basis data WordPress yang hidup, dan
-- skemanya bercampur antara tabel aplikasi dan tabel wp_*. Perintah migrasi
-- Prisma akan menawarkan diri menghapus tabel WordPress yang tidak dikenalnya.
--
-- Pasangan di schema.prisma: model GoogleCalendarEventSync.

CREATE TABLE IF NOT EXISTS `google_calendar_event_sync` (
  -- wp_kc_appointments.id. PRIMARY KEY, bukan sekadar indeks unik: satu janji
  -- tidak boleh punya dua baris niat yang saling bertabrakan, dan kunci utama
  -- membuat INSERT ... ON DUPLICATE KEY menjadi mutex yang murah.
  `appointment_id` BIGINT UNSIGNED NOT NULL,

  -- wp_users.ID milik psikolog. Disalin ke sini, bukan selalu di-JOIN: penyapu
  -- mengelompokkan pekerjaan per psikolog untuk menukar satu access token saja
  -- untuk banyak acara, dan janji yang terhapus tidak boleh menyembunyikan
  -- acaranya dari penghapusan.
  `professional_id` BIGINT UNSIGNED NOT NULL,

  -- 'present' | 'absent'. Keadaan yang SEHARUSNYA ada di Google, bukan yang ada.
  `desired_state` VARCHAR(16) NOT NULL,

  -- Sidik jari isi acara yang diinginkan. Sinkron berarti desired_hash sama
  -- dengan synced_hash; keduanya berbeda berarti ada pekerjaan.
  `desired_hash` CHAR(64) NOT NULL,

  -- Sidik jari yang benar-benar sudah mendarat di Google. NULL berarti belum
  -- pernah berhasil sekali pun.
  `synced_hash` CHAR(64) NULL DEFAULT NULL,

  -- Id acara dari Google. NULL sebelum acaranya dibuat, dan dikosongkan lagi
  -- setelah penghapusan berhasil.
  `google_event_id` VARCHAR(255) NULL DEFAULT NULL,

  -- 'primary' hari ini. Kolom tersendiri supaya pindah ke kalender buatan
  -- aplikasi (calendar.app.created) tidak perlu mengubah skema.
  `calendar_id` VARCHAR(255) NOT NULL DEFAULT 'primary',

  -- Percobaan sejak terakhir berhasil; dinolkan tiap kali sinkron tercapai.
  `attempts` INT NOT NULL DEFAULT 0,

  -- Jeda mundur. NULL berarti boleh dicoba sekarang.
  `next_attempt_at` DATETIME NULL DEFAULT NULL,

  `last_error` TEXT NULL DEFAULT NULL,

  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`appointment_id`),

  -- Kueri penyapu: baris yang belum sinkron dan sudah boleh dicoba, per psikolog.
  KEY `idx_gces_pekerjaan` (`professional_id`, `next_attempt_at`),

  -- Rekonsiliasi mencari baris yang belum sinkron tanpa menyaring psikolog.
  KEY `idx_gces_belum_sinkron` (`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
