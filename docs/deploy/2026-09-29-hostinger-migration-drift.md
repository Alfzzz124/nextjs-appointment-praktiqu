# Migrasi ke Hostinger — data yang berbeda antara server lama dan baru

Dicatat 2026-09-29. Status: **tabel aplikasi sudah diimpor** (dump 10:51 WIB, 64 tabel, 851 `users`); **baris `wp_kc_*` di bagian 2 belum**.

| | Server lama (Jagoan) | Server baru (Hostinger) |
|---|---|---|
| SSH | `praktiqu@101.50.1.106 -p 45022` | `ssh praktiqu-hostinger` |
| Database | `praktiqu_wp580` (MariaDB 10.6, utf8mb3) | `u580667380_nnmkapn` (MariaDB 11.8, utf8mb4) |
| WordPress | `appointment.praktiqu.com` (masih hidup) | `api-appointment.praktiqu.com` |
| API Next.js | `staging2.praktiqu.com` (masih hidup) | `endpoint.praktiqu.com` |

Sumber data server baru adalah backup UpdraftPlus
`backup_2026-09-28-0150_Praktiqu_9d73c03ff303` — **27 Sep 18:50 UTC (28 Sep 01:50 WIB)**.
Semua yang ditulis ke server lama setelah jam itu tidak ada di server baru.

## 1. Tabel aplikasi — tidak ikut sama sekali

UpdraftPlus hanya mem-backup tabel ber-prefix `wp_`. Server baru punya **0** tabel non-`wp_`;
server lama punya **64** (4,2 MB), antara lain `users` (851 baris), `audit_logs`,
`payment_orders`, `refresh_tokens`, `google_calendar_connections` (1 koneksi), `professionals`,
`services`, `log_entries`.

Tanpa tabel ini, setiap login di `endpoint.praktiqu.com` gagal 503
(`The table audit_logs does not exist`).

Cara memindahkan: `mysqldump --single-transaction --no-tablespaces --skip-add-drop-table
--skip-add-locks --default-character-set=utf8mb4 --hex-blob` atas daftar tabel non-`wp_`,
lalu impor ke DB baru. Tanpa `DROP TABLE`, impor ini hanya menambah tabel dan tidak bisa
menimpa apa pun. **Jangan** membuat tabelnya lewat `prisma db push` / `migrate dev` — schema
Prisma ikut memuat tabel `wp_`.

Syarat agar data yang diimpor bisa dipakai:
- `GOOGLE_TOKEN_ENCRYPTION_KEY` di Hostinger harus sama persis dengan milik `staging2`, atau token
  Google Calendar yang diimpor tidak bisa didekripsi.
- `refresh_tokens` hanya berlaku jika `JWT_SECRET`/`AUTH_SECRET` juga sama; kalau berbeda, semua
  pengguna cukup login ulang.

## 2. Data KiviCare yang berubah di server lama setelah backup

Semua perubahan milik profesional **Dianda Azani, M.Psi., Psikolog** (WP user 34) di klinik
**AzaniDianda.com** (clinic 4), dilakukan oleh **Admin Azani Dianda** (`CLINIC_ADMIN`, WP user 24,
app user `cmsieoi290008177v8d7kibcz`) lewat FE.

Dari `log_entries` (level `AUDIT`) server lama:

| Waktu (UTC) | Kejadian | Isi |
|---|---|---|
| 28 Sep 10:06:05 | `service.deleted` mapping **437** | layanan 515 "Asesmen Minat", klinik 4 — `status` mapping jadi `0` |
| 28 Sep 10:06:37 | `service.updated` mapping **435** | dipindah ke layanan baru **516**, 2.500.000, 90 menit |

Baris hasilnya di server lama:

- `wp_kc_services` **id 516** — `asesmen`, "Paket Asesmen ADHD (3 Sesi)", 2.500.000, status 1,
  `created_at 2026-09-28 17:06:37` (waktu WIB). **Tidak ada di server baru** (514 baris vs 513).
- `wp_kc_service_doctor_mapping` **id 435** — `service_id 516`, doctor 34, clinic 4,
  charges 2.500.000, duration 90, status 1. **Di server baru masih `service_id 512`** (dipastikan).
- `wp_kc_service_doctor_mapping` **id 437** — `status 0`. **Di server baru masih `1`** (dipastikan).

## 3. Hasil perbandingan isi seluruh tabel `wp_*`

Diperiksa 2026-09-29 11:00 WIB: `CHECKSUM TABLE` untuk 215 tabel, lalu hash per baris untuk tabel
yang berbeda. Untuk `wp_posts`, `wp_postmeta`, `wp_usermeta`, `wp_comments`, `wp_options`, hash
dihitung setelah `api-appointment.praktiqu.com` dikembalikan ke `appointment.praktiqu.com` dan
panjang string serialisasi (`s:NN:`) diabaikan, supaya hasil search-replace migrasi tidak ikut
terhitung.

**Data nyata yang berbeda — perlu dipindah:**

| Tabel | Baris | Isi |
|---|---|---|
| `wp_kc_services` | 516 | layanan baru Dianda Azani (bagian 2) |
| `wp_kc_service_doctor_mapping` | 435, 437 | bagian 2 |
| `wp_users` | 917 | pasien #917 **mengganti password** di server lama, 28 Sep 04:44 UTC. Tanpa dipindah, password barunya ditolak di server baru. |
| `wp_usermeta` | user 917 | `praktiqu_password_changed_at = 2026-09-28 04:44:09` |

**Berbeda tetapi tidak perlu dipindah:**

- `wp_kc_gdpr_audit_log` 1373–1381 — aktivitas pasien 917 di server lama (login, buka dashboard,
  appointment, laporan, tagihan). Id 1373 di server baru sudah dipakai login admin 204. Tabel ini
  rantai hash (`checksum` = sha256 atas checksum baris sebelumnya, lihat
  `KCGdprAuditService.php:362`), jadi baris lama **tidak bisa disisipkan** tanpa memutus rantainya.
  Arsipnya tetap ada di `praktiqu_wp580`.
- `wp_woocommerce_api_keys` 879 (lama) vs 763 (baru) — kunci `kivicare_app` milik user 917 yang
  dibuat ulang saat ia login di server lama; dibuat ulang lagi saat ia login di server baru.
- `wp_usermeta` lain — `session_tokens`, `wc_last_active`, `client_public_key`, keranjang kosong:
  sesi login, bukan data.
- `wp_options` — 1.646 dari 1.651 baris yang hanya ada di server lama adalah transient; 3 sisanya
  ada juga di server baru dengan `option_id` berbeda.
- `wp_posts` / `wp_postmeta` — `od_url_metrics` dan cache CSS Elementor.
- `wp_wc_customer_lookup` — selisih tepat 7 jam: kolom `TIMESTAMP` ditampilkan dalam zona waktu
  sesi (Jagoan +07, Hostinger UTC). Nilainya sama.
- `wp_kc_payments_appointment_mappings`, `wp_comments`, Yoast, Redirection — hanya hasil
  search-replace domain.
- Action Scheduler, MailPoet, Wordfence, log SMTP, sesi WooCommerce — log dan antrean yang memang
  berjalan terpisah di tiap server.

**SQL perbaikan** (satu transaksi, dibuat dari server lama): `INSERT` layanan 516, `REPLACE`
mapping 435 & 437, `UPDATE wp_users.user_pass` untuk 917, `INSERT` meta
`praktiqu_password_changed_at`. Cadangan baris-baris itu di server baru sebelum diubah:
`~/migration/pre-drift-fix-20260929.sql` di Hostinger.

## 4. FE masih login ke server lama

Keempat `LOGIN_SUCCESS` setelah backup (terakhir **29 Sep 01:31 UTC**) datang dari
`GuzzleHttp/7` di `2a02:4780:6:1965:…` — FE Laravel yang sudah berada di Hostinger, tetapi masih
memanggil **`staging2.praktiqu.com`**. Selama base URL API di FE belum diganti ke
`endpoint.praktiqu.com`, semua perubahan dari FE terus masuk ke server lama dan selisih di atas
akan bertambah.

## Urutan pemindahan

1. Bekukan server lama: minta staf berhenti mengedit, lalu arahkan FE ke `endpoint.praktiqu.com`.
2. Dump ulang tabel non-`wp_` dari `praktiqu_wp580` (dump sebelumnya sudah basi begitu ada login baru).
3. Impor ke `u580667380_nnmkapn`; pastikan 64 tabel ada.
4. Jalankan SQL perbaikan di bagian 3 (layanan 516, mapping 435 & 437, password pasien 917).
5. Restart app, tes login dengan password salah → harus **401**, bukan 503.

## 5. Pemeriksaan ulang 2026-10-05

Perbaikan di bagian 3 **belum pernah diterapkan** — di Hostinger layanan 516 masih tidak ada dan
mapping 435/437 masih versi lama. Sementara itu **situs lama terus dipakai**: semua booking dan
pembayaran sejak migrasi masuk ke Jagoan, Hostinger tidak menerima satu pun order baru.

Cara membandingkan (supaya bisa diulang): hash md5 per baris untuk **semua** tabel di kedua sisi,
dengan `SET time_zone='+00:00'` (kolom `TIMESTAMP` tampil +07 di Jagoan, UTC di Hostinger),
`api-appointment.praktiqu.com` → `appointment.praktiqu.com`, dan prefiks panjang serialisasi
`s:NN:` diabaikan. Query di Hostinger dipecah per 3 tabel — satu koneksi raksasa diputus
(`Server has gone away`). Di Jagoan, cari proses app dengan `pgrep -f "^lsnode:/home/praktiqu/staging2"`:
`pgrep -f staging2.praktiqu.com` saja bisa mengenai shell SSH sendiri setelah PID berputar.

**Data nyata yang hanya ada di Jagoan** (semua ID-nya di atas ID tertinggi Hostinger, jadi tidak
ada yang bentrok):

| Apa | Baris |
|---|---|
| 4 appointment | #3354–#3357 — 3 dengan Pamela Anggia Dewi (klinik 5), 1 dengan Dianda Azani (klinik 4); semuanya tanggal 2–5 Okt, sudah lewat |
| + mapping layanan, reminder, pembayaran | `appointment_service_mapping` 3458–3461, `reminder_mapping` 1312–1313, `payments_appointment_mappings` 93–96 (2 lunas via Xendit, 1 pending, 1 PayPal pending) |
| 3 order WooCommerce | #49856 & #49858 lunas (Xendit, Rp800.000), #49857 kedaluwarsa — beserta 155 postmeta, 3 item + 33 itemmeta, `order_stats`, `order_product_lookup`, 8 catatan order + 5 commentmeta |
| Jadwal baru | `wp_kc_clinic_sessions` #3457 — Pamela, Jumat 13:30–16:30 |
| Harga produk #49789 | Rp700.000 → **Rp800.000** (1 Okt), `total_sales` 6 → 8 |
| Pelanggan | `wc_customer_lookup` #489 baru (pasien #1031), #485 diperbarui |
| Password pasien | #205 (3 Okt), #1031 (1 Okt), #917 (28 Sep) — tercatat di `praktiqu_password_changed_at` hanya di Jagoan |
| Usermeta pasien | data billing pasien #1031, nama depan/belakang #1031, `praktiqu_password_changed_at` |
| Sinkron Google Calendar KiviCare | option `kc_appointment_google_events_3354/3356`, `kc_gcal_event_to_appointment_*` |
| Dari bagian 3 | layanan #516, mapping #435 & #437 |

**Sengaja tidak dipindah:** log GDPR (rantai hash), log conflict-scan Jagoan, probe login,
`session_tokens`, kunci API `kivicare_app` (dibuat ulang saat login), cache Elementor
(`_elementor_page_assets` dkk., 1.237 baris), `od_url_metrics`, Action Scheduler, MailPoet,
Wordfence, Yoast, Redirection, transient. Token `kc_google_calendar_token` dokter #29 berbeda di
kedua sisi tetapi terenkripsi, jadi tidak bisa dipastikan mana yang lebih baru — dibiarkan.

**Yang berubah hanya di Hostinger dan dipertahankan:** audit log, refresh token, log GDPR
(3.184 baris), kunci API, login staf lewat FE sejak 1 Okt.

**SQL sinkron**: satu transaksi, 0 `DROP/DELETE/TRUNCATE/ALTER`; `INSERT` untuk baris baru,
`REPLACE` hanya untuk 7 baris yang memang berubah, `UPDATE` terarah untuk password dan tanggal
ubah produk. 15 URL domain lama ditulis ulang ke `api-appointment` (tidak ada yang di dalam data
serialisasi). Berkasnya di luar repo karena memuat hash password: `~/praktiqu-migration/` di mesin
lokal, dijalankan dengan `~/praktiqu-migration/apply-sync-20261005.sh` — skrip itu mem-backup
baris Hostinger yang akan ditimpa ke `~/migration/pre-sync-backup-20261005.sql` sebelum menerapkan.

**Selama situs lama masih menerima booking, selisih ini akan muncul lagi.** Yang perlu ditutup:
arahkan `appointment.praktiqu.com` (atau setidaknya halaman booking & dasbor pasien KiviCare)
ke Hostinger, dan pastikan URL callback Xendit menunjuk ke `api-appointment.praktiqu.com`.

**Diterapkan 2026-10-05 ~17:10 WIB** (atas permintaan; DB Hostinger baru dipakai tim dev). Hasil:
appointment 3354–3357, layanan 516, mapping `435:516:1` & `437:515:0`, order 49856–49858, harga
49789 = 800.000, tanggal ganti password ketiga pasien, jadwal 3457 — semuanya ada. Judul produk
49789 ("1 Jam" → "1,5 Jam") ikut diubah setelah verifikasi ulang menemukannya. Backup baris yang
ditimpa: `~/migration/pre-sync-backup-20261005.sql` (Hostinger, 242 baris).

Verifikasi ulang 26 tabel bisnis (KiviCare, order WooCommerce, `wp_users`): sisa selisih hanya
`od_url_metrics`, satu auto-draft, dan `date_last_active` pasien #917 di `wc_customer_lookup`.
`wp_postmeta`/`wp_usermeta` tidak ikut diverifikasi ulang (dibandingkan sebelum sinkron).
Setelahnya: `wp-json` 200, API publik 200, login salah 401.

Sinkron ini adalah potret 5 Okt ~17:00 WIB; apa pun yang masuk ke Jagoan setelah itu belum ada.
