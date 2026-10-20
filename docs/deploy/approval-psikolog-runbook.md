# Runbook — Approval Psikolog

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`. Semua langkah yang
menyentuh produksi butuh persetujuan user di saat itu.

## Urutan

Urutan wajib: **plugin → SQL → backend → FE**, dan setiap langkah baru boleh dimulai setelah
langkah sebelumnya terverifikasi di produksi. Saklar default mati, tetapi itu **tidak** membuat
backend aman sendirian:

- **Plugin 1.8.3 dan SQL masing-masing aman dijalankan sendirian.** Plugin hanya mendaftarkan satu
  hook yang belum di-enqueue siapa pun. SQL hanya `CREATE TABLE IF NOT EXISTS` untuk dua tabel yang
  belum dibaca kode lama.
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

1. **Plugin 1.8.3** di Hostinger WP (`ssh praktiqu-hostinger`; matikan Cloudflare WARP dulu).
   - Cocokkan dulu isi server dengan git 1.8.2. Buat backup `~/plugin-backups/praktiqu-endpoint-1.8.2-<UTC>.tgz`.
   - Hanya dua file plugin yang berubah, ditambah readme: `includes/class-praktiqu-endpoint-jobs.php` dan `praktiqu-endpoint.php`.
   - `tests/test-jobs-approval-reminder.php` ikut di git tetapi **tidak di-deploy**.
   - Tukar **`includes/class-praktiqu-endpoint-jobs.php` dulu**, baru `praktiqu-endpoint.php`, lalu `readme.txt`. Tidak ada kelas baru yang di-require, jadi urutan ini sengaja berbeda dari §2.1 langkah 5 di `international-clinic-runbook.md` (lihat bullet berikutnya).
   - Mekanisme tukar file yang persis (cocokkan md5, backup tar, `php -l`, `cp` lalu `mv`, cek plugin masih aktif): `docs/deploy/international-clinic-runbook.md` §2.1, langkah 1–6.
   - Verifikasi: `GET https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/health` (header `X-PraktiQU-Service-Token`; jalankan dari server, bukan dari luar, karena WAF menahan curl; token dibaca di server seperti di §2.1 langkah 7 runbook itu) menjawab `"version":"1.8.3"`; plugin masih ada di `active_plugins` (§2.1 langkah 6); tidak ada baris baru di `error_log`.
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

## Rollback

- FE dan backend: revert merge, lalu auto-deploy. Tabel baru boleh dibiarkan; backend lama tidak membacanya.
- **Sesi yang sedang `AWAITING` saat rollback backend akan tertinggal `PENDING`.** Sebelum rollback, putuskan dulu semuanya: `SELECT appointmentId FROM session_approvals WHERE state='AWAITING';`. Kalau tidak, job auto-cancel lama bisa melepasnya.
- Plugin: kembalikan backup 1.8.2 (mekanismenya: `docs/deploy/international-clinic-runbook.md`, bagian Rollback). Tanpa Next.js baru, tidak ada yang meng-enqueue hook baru.
- Job pengingat yang sudah di-enqueue dengan hook `praktiqu_approval_reminder` tetap ada di Action Scheduler. Setelah plugin kembali ke 1.8.2, yang tidak lagi mendaftarkan hook itu, job tersebut tidak melakukan apa-apa: tidak ada callback dan tidak ada webhook ke Next.js. Action Scheduler boleh mencatatnya selesai atau gagal (tergantung versinya); biarkan saja.
