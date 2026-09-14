-- Peringatan bentrok mundur yang sudah pernah dikirim, agar tidak terkirim ulang.
-- Terapkan manual, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-14-google-conflict-warnings.sql
--
-- Ditulis tangan, bukan digenerate, karena database ini juga memuat tabel wp_*
-- milik KiviCare dan `prisma db push` akan mencoba menyelaraskannya dengan schema
-- yang tidak memuatnya.
--
-- KENAPA: pemindaiannya harian. Tanpa catatan ini, satu agenda pribadi yang
-- dibiarkan begitu saja akan menghasilkan satu email setiap hari sampai janji
-- temunya lewat — dan peringatan yang datang tiap hari berhenti dibaca, yang
-- justru menghapus gunanya.
--
-- Kunci unik di (professionalId, appointmentId), bukan per blok: satu janji temu
-- cukup diperingatkan sekali. `fingerprint` menyimpan bentrok mana yang sudah
-- diberitahukan, sehingga bentrok yang BERUBAH (psikolognya menggeser agendanya
-- ke jam lain yang masih menimpa) tetap memicu satu peringatan baru, sementara
-- bentrok yang sama tidak.

CREATE TABLE IF NOT EXISTS `google_conflict_warnings` (
  `id`             varchar(191) NOT NULL,
  `professionalId` bigint unsigned NOT NULL,
  `appointmentId`  int          NOT NULL,
  `fingerprint`    varchar(64)  NOT NULL,
  `notifiedAt`     datetime(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `google_conflict_warnings_professionalId_appointmentId_key` (`professionalId`, `appointmentId`),
  KEY `google_conflict_warnings_notifiedAt_idx` (`notifiedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
