-- Bentrok jadwal yang sudah dikabarkan, per penerima, agar pemindaian per jam tidak mengirim
-- email yang sama tiap jam.
-- Terapkan manual, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-21-schedule-conflict-notices.sql
--
-- Ditulis tangan, bukan digenerate, karena database ini juga memuat tabel wp_* milik KiviCare
-- dan `prisma db push` akan mencoba menyelaraskannya dengan schema yang tidak memuatnya.
--
-- Satu baris per (pasangan janji temu, penerima). Per penerima, bukan per pasangan: email ke
-- admin klinik yang gagal harus diulang tanpa mengirim ulang ke psikolog yang sudah
-- menerimanya. `fingerprint` (= tanggal|jam A|jam B) menyimpan bentrok MANA yang sudah
-- dikabarkan: digeser tapi masih tumpang tindih → dikabarkan lagi; ganti status saja → tidak.
-- Baris untuk pasangan yang sudah tidak bentrok dihapus oleh pemindaian, jadi bentrok yang
-- kembali nanti dikabarkan lagi. Spec: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md

CREATE TABLE IF NOT EXISTS `schedule_conflict_notices` (
  `id`                varchar(191) NOT NULL,
  `appointmentLowId`  int          NOT NULL,
  `appointmentHighId` int          NOT NULL,
  `recipient`         varchar(191) NOT NULL,
  `fingerprint`       varchar(64)  NOT NULL,
  `notifiedAt`        datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `schedule_conflict_notices_pair_recipient_key` (`appointmentLowId`, `appointmentHighId`, `recipient`),
  KEY `schedule_conflict_notices_notifiedAt_idx` (`notifiedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
