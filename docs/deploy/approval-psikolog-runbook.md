# Runbook — Approval Psikolog

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`. Semua langkah yang
menyentuh produksi butuh persetujuan user di saat itu.

## Urutan

Urutan wajib: **plugin → SQL → backend → FE**. Setiap langkah aman sendirian, karena saklar
default mati.

1. **Plugin 1.8.3** di Hostinger WP (`ssh praktiqu-hostinger`; matikan Cloudflare WARP dulu).
   - Cocokkan dulu isi server dengan git 1.8.2. Buat backup `~/plugin-backups/praktiqu-endpoint-1.8.2-<UTC>.tgz`.
   - Hanya dua file plugin yang berubah, ditambah readme: `includes/class-praktiqu-endpoint-jobs.php` dan `praktiqu-endpoint.php`.
   - Tukar **`includes/class-praktiqu-endpoint-jobs.php` dulu**, baru `praktiqu-endpoint.php`, lalu `readme.txt`. Tidak ada kelas baru yang di-require.
   - Verifikasi: versi 1.8.3 aktif dan tidak ada baris baru di `error_log`.
2. **SQL** `prisma/manual/2026-10-19-approval-psikolog.sql` di DB produksi:
   ```bash
   mysql -u <user> -p <database> < prisma/manual/2026-10-19-approval-psikolog.sql
   ```
   Verifikasi `SHOW TABLES LIKE '%approval%';` → `professional_approval_settings`, `session_approvals`.
3. **Backend**: user me-merge PR → Hostinger auto-deploy. Verifikasi dengan `GET /api/v1/sessions/approvals` (token psikolog) → 200 dengan `counts`.
4. **FE**: user me-merge PR → deploy GitHub Actions.

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
- Plugin: kembalikan backup 1.8.2. Tanpa Next.js baru, tidak ada yang meng-enqueue hook baru.
