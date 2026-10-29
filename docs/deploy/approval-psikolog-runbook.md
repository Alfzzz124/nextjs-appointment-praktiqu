# Runbook — Approval Psikolog

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`. Semua langkah yang
menyentuh produksi butuh persetujuan user di saat itu.

## Urutan

Urutan wajib: **plugin → SQL → backend → FE**, dan setiap langkah baru boleh dimulai setelah
langkah sebelumnya terverifikasi di produksi. Saklar default mati, tetapi itu **tidak** membuat
backend aman sendirian:

- **Plugin 1.8.4 dan SQL masing-masing aman dijalankan sendirian.** Plugin (1.8.4 berisi 1.8.3)
  mendaftarkan satu hook yang belum di-enqueue siapa pun, dan menambah argumen opsional
  `expect_status` di `/appointments/{id}/status` yang hanya dikirim backend baru. SQL hanya
  `CREATE TABLE IF NOT EXISTS` untuk dua tabel yang belum dibaca kode lama.
- **Backend baru di atas plugin 1.8.3 tetap jalan**, karena `expect_status` diabaikan. Hanya saja
  race batal-vs-setujui (spec `2026-10-20-approval-claim-first-design.md`) belum tertutup, jadi
  urutan plugin dulu tetap wajib.
- **Backend baru membaca `session_approvals` / `professional_approval_settings` di banyak jalur,
  bukan hanya saat saklar menyala:** setiap `GET /sessions`, `GET /sessions/{id}` dan
  `GET /sessions/pending`; approve, reject dan cancel; webhook dan pengecekan pembayaran;
  `/public/payment-verify`, `/public/appointments/{token}` (dan `/cancel`); serta katalog psikolog
  publik. Kalau backend sudah live (Hostinger auto-deploy saat PR di-merge) sebelum SQL jalan di
  produksi, semua jalur itu error karena tabelnya tidak ada.
  **PR backend tidak boleh di-merge sebelum SQL (langkah 2) terverifikasi di produksi.**
- **FE memanggil endpoint baru** (`/sessions/approvals`, `/sessions/{id}/approval`, `/refund-done`,
  `/professionals/{id}/approval-setting`). **PR FE tidak boleh di-merge sebelum backend
  (langkah 3) terverifikasi live.**

1. **Plugin 1.8.4** di Hostinger WP (`ssh praktiqu-hostinger`; matikan Cloudflare WARP dulu).
   - Cocokkan dulu isi server dengan git versi yang sedang terpasang (1.8.2, atau 1.8.3 kalau itu sudah sempat di-deploy). Buat backup `~/plugin-backups/praktiqu-endpoint-<versi>-<UTC>.tgz`.
   - File plugin yang berubah, ditambah readme:
     - dari 1.8.2: `includes/class-praktiqu-endpoint-jobs.php`, `includes/class-praktiqu-endpoint-appointments.php`, `includes/class-praktiqu-endpoint-rest-controller.php` dan `praktiqu-endpoint.php`;
     - dari 1.8.3: sama, tanpa `class-praktiqu-endpoint-jobs.php`.
   - `tests/test-jobs-approval-reminder.php` dan `tests/test-appointments-set-status.php` ikut di git tetapi **tidak di-deploy**.
   - Tukar **file `includes/` dulu**, baru `praktiqu-endpoint.php`, lalu `readme.txt`. Tidak ada kelas baru yang di-require, jadi urutan ini sengaja berbeda dari §2.1 langkah 5 di `international-clinic-runbook.md` (lihat bullet berikutnya).
   - Mekanisme tukar file yang persis (cocokkan md5, backup tar, `php -l`, `cp` lalu `mv`, cek plugin masih aktif): `docs/deploy/international-clinic-runbook.md` §2.1, langkah 1–6.
   - Verifikasi: `GET https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/health` (header `X-PraktiQU-Service-Token`; jalankan dari server, bukan dari luar, karena WAF menahan curl; token dibaca di server seperti di §2.1 langkah 7 runbook itu) menjawab `"version":"1.8.4"`; plugin masih ada di `active_plugins` (§2.1 langkah 6); tidak ada baris baru di `error_log`.
2. **SQL** `prisma/manual/2026-10-19-approval-psikolog.sql` di DB produksi:
   ```bash
   mysql -u <user> -p <database> < prisma/manual/2026-10-19-approval-psikolog.sql
   ```
   Jalankan di database yang sama dengan `DATABASE_URL` app produksi (itu database WordPress). Aman diulang (`IF NOT EXISTS`).
   Verifikasi `SHOW TABLES LIKE '%approval%';` → `professional_approval_settings`, `session_approvals`.
3. **Backend**
   - **Prasyarat, jangan di-merge sebelum keduanya terpenuhi:** (a) langkah 2 selesai dan `SHOW TABLES` di produksi menampilkan kedua tabel; (b) pra-cek `APP_PUBLIC_URL` di bawah lolos.
   - Pra-cek `APP_PUBLIC_URL`: tautan di email ke psikolog (`/dashboard/persetujuan/{id}`) dibentuk dari env itu lewat `src/lib/public-url.ts`. Nilainya harus host FE yang dipakai psikolog, **bukan** host API (`endpoint.praktiqu.com`). Cek di server: `grep '^APP_PUBLIC_URL=' ~/domains/endpoint.praktiqu.com/hbuilds/config/.env`. Kalau kosong, kode jatuh ke `NEXT_PUBLIC_APP_URL`, lalu `AUTH_URL`; cek keduanya juga. Kalau env proses yang berjalan terlihat berbeda dari `.env`, pakai nilai proses. Perbaiki lewat hPanel (Node.js app → environment variables), bukan lewat SSH: `config/.env` ditulis ulang dari hPanel setiap deploy.
   - User me-merge PR → Hostinger auto-deploy. Verifikasi dengan `GET /api/v1/sessions/approvals` (token psikolog) → 200 dengan `counts`.
4. **FE**: **prasyarat:** langkah 3 terverifikasi live. User me-merge PR → deploy GitHub Actions.

## Uji coba (user, dengan satu psikolog uji)

1. Nyalakan saklar psikolog uji di Persetujuan → Pengaturan.
2. Booking publik psikolog itu dan bayar. Klien menerima "menunggu konfirmasi psikolog"; psikolog menerima "Booking baru…"; halaman kembali dari pembayaran menyebut "menunggu konfirmasi psikolog".
3. Psikolog membuka tautan email → login → detail → **Setujui**. Klien menerima email booking KiviCare; status "Terjadwal · lunas".
4. Booking kedua → bayar → **Tolak** (dengan alasan). Klien menerima email "tidak dapat diterima"; sesi muncul di tab **Perlu refund**.
5. Admin mengembalikan dana di Xendit/WooCommerce → **Tandai sudah direfund**.
6. Matikan saklar psikolog uji.

## Operasional

- **Booking menunggu tanpa job pengingat.** Kalau WordPress menolak atau tak terjangkau saat
  booking masuk antrean (atau saat job pengingat menjadwalkan run berikutnya), booking tetap ada di
  antrean psikolog, dan email permintaan pertamanya tetap terkirim. Yang hilang: pengingat
  berikutnya dan eskalasi ke admin klinik. Setiap kejadian dicatat sebagai error:
  ```sql
  SELECT resourceId AS appointmentId, occurredAt, metadata
  FROM log_entries
  WHERE level = 'ERROR' AND message = 'approval: the reminder job could not be scheduled'
  ORDER BY occurredAt DESC;
  ```
  Untuk appointment yang `session_approvals.state`-nya masih `AWAITING`, beri tahu psikolog atau
  admin kliniknya, atau putuskan dari antrean.
- **Penolakan yang setengah jadi** (`REJECTED` + janji temu `PENDING`, misalnya proses mati tepat
  setelah tombol Tolak) diselesaikan oleh pembacaan antrean/detail atau oleh job pengingat. Hanya
  jalur job pengingat yang mengirim email penolakan ke klien dan menulis audit
  `session.approval_decided` (`recovered: true`). Kalau pembacaan lebih dulu, tidak ada email. Yang
  tertinggal hanya audit `session.status_changed` (`finishedRejection: true`). Kalau perlu, kabari
  kliennya secara manual.

## Rollback

- FE dan backend: revert merge, lalu auto-deploy. Tabel baru boleh dibiarkan; backend lama tidak membacanya.
- **Putuskan dulu semua sesi yang sedang `AWAITING` sebelum rollback backend:** `SELECT appointmentId FROM session_approvals WHERE state='AWAITING';`. Backend lama tidak membaca `session_approvals`, jadi baginya sesi itu hanya `PENDING` biasa:
  - Yang dibayar lewat order akan **di-BOOKED-kan otomatis** oleh backend lama. Setiap kali status pembayarannya dibaca lagi (`/public/payment-verify` dari halaman klien, atau webhook yang datang ulang), `ensurePaidSideEffectsApplied` → `applyPaidSideEffectsPublic` melihat janji temu `PENDING` dengan order `paid` dan langsung mem-`BOOKED`-kannya, tanpa keputusan psikolog dan tanpa menutup catatan approval-nya.
  - Yang ditandai lunas manual (tanpa order) tertinggal `PENDING`, dan job auto-cancel lama bisa melepasnya.
- Plugin: kembalikan backup versi sebelumnya (mekanismenya: `docs/deploy/international-clinic-runbook.md`, bagian Rollback). Tanpa Next.js baru, tidak ada yang meng-enqueue hook baru. Kembali ke 1.8.3 dengan backend baru tetap jalan: `expect_status` diabaikan, dan race batal-vs-setujui terbuka lagi.
- Job pengingat yang sudah di-enqueue dengan hook `praktiqu_approval_reminder` tetap ada di Action Scheduler. Setelah plugin kembali ke 1.8.2, yang tidak lagi mendaftarkan hook itu, job tersebut tidak melakukan apa-apa: tidak ada callback dan tidak ada webhook ke Next.js. Action Scheduler boleh mencatatnya selesai atau gagal (tergantung versinya); biarkan saja.

## Tautan email tanpa login (spec 2026-10-29)

Urutan rilis **FE dulu, baru backend** (kebalikan biasanya):

1. Merge PR FE `feat/approval-tautan-email` → deploy GitHub Actions. Aman sendirian: belum ada
   email yang membawa tautan baru; kalaupun halaman dibuka, backend lama menjawab 404 dan halaman
   menampilkan "Tautan ini tidak berlaku".
2. Merge PR backend `feat/approval-tautan-email` → Hostinger auto-deploy. **Cek build benar-benar
   berjalan**: hPanel → Penempatan, atau `ls -t ~/domains/endpoint.praktiqu.com/hbuilds/logs | head -3`
   lalu `grep "Checking out commit"` di log terbaru; harus sama dengan `git log -1 origin/main`.
   Tidak ada SQL, tidak ada plugin.
3. Verifikasi tanpa data nyata: `GET https://endpoint.praktiqu.com/api/v1/public/approvals/rusak`
   → `404` dengan `"title":"approval_link_invalid"`; halaman
   `https://appointment.praktiqu.com/persetujuan/t/xxxxxxxxxxxxxxxxxxxxxxxx` → "Tautan ini tidak berlaku".
4. Uji coba (user): booking nyata ke psikolog uji → setujui dari tautan email asli; booking kedua →
   tolak dari tautan; buka ulang tautan pertama → "Sudah disetujui oleh …".

Rollback: revert backend dulu (email kembali tanpa tautan). Tautan yang sudah terkirim lalu dijawab
404 oleh backend lama, dan halaman FE menampilkan "tidak berlaku" dengan tombol login. FE boleh dibiarkan.
