# Untuk Rafiq — hasil audit FE Laravel (26 Sep 2026)

Halo Raf. Aku audit repo `raakanaka/laravel-praktiqu` @ `1e23c3b` (17 Sep). Semua tes kamu lulus (phpunit 434/434, JS 11/11), jadi yang di bawah ini ada di bagian yang belum ketutup tes. Tiap temuan sudah dicek ulang oleh agen lain yang tugasnya membantah. Detail lengkap (file:line, skenario, usulan perbaikan) ada di `docs/audits/2026-09-25-audit-frontend-laravel.md` di repo backend. ID di kurung (BK-1, SEC-3, …) merujuk ke dokumen itu.

## 1. Sudah kami beresin dari sisi backend

Tidak perlu ubah apa-apa di FE, tinggal tunggu deploy staging2:

- **`GET /sessions` sekarang menerima `practiceId`.** Dulu 422, makanya daftar Appointments admin klinik selalu kosong (DD-1). Parameter ini hanya bisa menyempitkan cakupan, tidak melebarkan.
- **`/auth/login`, `/auth/me`, OTP, dan register sekarang mengirim `user.clinicId`** untuk CLINIC_ADMIN dan RECEPTIONIST. `extractPracticeId()` kamu sudah membaca kunci itu, jadi sapuan `/practices` di `lookupScopeIds()` tidak perlu dipakai lagi untuk admin, dan resepsionis akhirnya dapat klinik (API-16, DD-6). Psikolog **sengaja** dapat `null`: dia bisa praktik di beberapa klinik, dan `practiceId` di profil dipakai sebagai override klinik (misalnya `DoctorSessionController:26`).
- **`GET /practices` sekarang di-scope ke klinik admin.** Spanduk "data di luar cakupan" dan statistik yang tersembunyi di dashboard admin klinik harusnya hilang sendiri (API-2, DD-7).
- **`GET /clients` untuk psikolog sekarang hanya berisi kliennya sendiri** (yang pernah punya sesi dengannya). Dulu seluruh klien klinik ikut terkirim (DD-5).

## 2. Butuh keputusan bareng

**URL kembali dari Xendit (BK-1, paling parah).** Backend memasang `returnUrl = <APP_PUBLIC_URL>/book/payment/success?appt=<token>` dan `cancelUrl = …/book/payment/cancel?appt=<token>`. FE tidak punya route `/book/*`, jadi **setiap pasien yang baru bayar mendarat di 404**. Nomor register-nya cuma ada di sessionStorage, yang kosong kalau checkout dibuka di tab atau aplikasi lain. Ini juga penyebab asli "404 order Rp0" dulu.

Usulanku: URL-nya dibiarkan apa adanya di backend. FE menambah `Route::get('/book/payment/{hasil}')->whereIn('hasil', ['success','cancel'])`. Handler-nya membaca `appt`, mencocokkannya ke booking (misalnya lewat kolom `token_hash` di `patient_registers`), lalu menampilkan status: poll `/booking/verify`, tampilkan nomor register, dan untuk cancel beri tombol bayar ulang. Kalau kamu lebih suka bentuk URL lain, kabari saja, backend yang menyesuaikan.

**Meneruskan IP asli pengguna (SEC-1, BK-7).** Semua request FE sampai ke kami dengan IP server FE. Akibatnya limiter login dan booking cuma menghitung per email, dan akun staf bisa dikunci orang lain. Backend sekarang menerima dua header ini:

```
X-Praktiqu-Client-Ip:     <request()->ip() pengguna>
X-Praktiqu-Forwarder-Key: <FE_FORWARDER_SECRET>
```

Secret-nya akan aku kirim lewat jalur privat, jangan di-commit. Karena terpadu ada di belakang Cloudflare, pastikan `TrustProxies` dikonfigurasi, supaya `request()->ip()` berisi IP pengunjung, bukan IP Cloudflare. Header ini cukup ditambahkan di `PraktiquApi::dispatch()` dan `BookingApi`.

## 3. Perlu diperbaiki di FE — prioritas tinggi

| ID | Masalah | Lokasi |
|---|---|---|
| SEC-3, CRUD-1, API-7 | **Appointment Manual mati total.** `manual-meta` memilih kolom `phone` yang tidak ada di `patient_registers` (500). **Hati-hati kalau memperbaikinya:** query yang sama mengambil 200 klien **semua klinik** (nama + email) untuk staf mana pun. `/services` juga dipanggil dengan `perPage=all` (422) dan balasannya dibaca dengan bentuk yang salah. | `ManualAppointmentController.php:31-40` |
| PP-1 | **Limiter PIN pasien bisa di-reset penyerang sendiri.** Cukup 9 tebakan salah lalu 1 PIN miliknya yang sah, `RateLimiter::clear` jalan, dan itu bisa diulang terus. | `PatientResultController.php:108-133` |
| BK-7, SEC-1 | **Tidak ada `throttle` di `/booking/submit` dan kedua POST login.** Sebuah skrip bisa memenuhi kalender psikolog, dan WordPress akan mengirim email berisi password ke alamat acak. | `routes/web.php:38,40,226` |
| BK-2 | **Kupon hardcoded** (`PRAKTIQU10`, `PROMO50`, `HEMAT20`, `KONSULGRATIS`) cuma memotong tampilan. Layar bisa bilang "Gratis", lalu Xendit menagih harga penuh. Saranku fiturnya dibuang dulu. | `booking.blade.php:279-284` |
| DD-4, UI-7 | **Laporan super admin per klinik:** sesinya disaring, tagihannya tidak, jadi pendapatannya berisi seluruh platform. Filter klinik juga diwarisi diam-diam dari halaman Services. | `ReportController.php:96`, `dashboard.blade.php:846` |
| DD-2 | Dashboard memuat 100 appointment dan klien **tertua**, bukan terbaru. | `DashboardController.php:31` |
| UI-1, CRUD-5, CRUD-6 | **Edit jadwal lalu Simpan tanpa mengubah apa pun tetap menggeser dan memotong jadwal.** Backend hanya menyimpan satu `timeSlot`, jadi `days[].slots` dibuang. | `dashboard.blade.php:413-604` |
| UI-2 | Laporan rentang tanggal memanggil `rupiah()` dan `idDate()` di luar scope Alpine, sehingga kolom uang dan tanggal kosong. | `dashboard.blade.php:3567` |
| SEC-14, PP-7, API-8 | Dokumen encounter dan upload foto memakai `Http` langsung, tanpa refresh token, jadi gagal setelah 15 menit. | `EncounterDocumentController.php:95-137` |
| BK-4, BK-5 | Setelah pembayaran gagal atau kedaluwarsa, "Coba Bayar Lagi" tidak berbuat apa-apa. Checkout yang sudah ditutup tidak bisa dibuka lagi selama 1 jam. | `BookingApi.php:743`, `booking.blade.php:559` |
| CRUD-7, CRUD-8, API-6, DD-3, API-20 | **Form yang selalu gagal:** Tambah Psikolog (`professionalType` dan `registrationNumber` tidak dikirim), Tambah Tagihan (payload tidak cocok `billCreateSchema`), sakelar status pasien/psikolog (huruf kecil, 422), sakelar Resepsionis (terbalik), dan Add Clinic (501 setelah foto terlanjur terunggah). | `ResourceController.php` |
| SEC-2, CRUD-3 | Psikolog menambah klien: backend menolak (403), tapi FE diam-diam menyimpan baris lokal lalu bilang "berhasil". | `ResourceController.php:296` |
| PP-4, BK-15 | Pasien yang bayar tidak pernah dikirimi PIN, padahal semua layar menjanjikannya. | `BookingController.php:437` |
| API-10 | Halaman Services hanya memuat 20 layanan aktif, dan layanan yang dinonaktifkan hilang selamanya. | `DashboardController.php:1210` |

## 4. Setelah itu

- **Sesi Laravel 120 menit:** simpan berakhir dengan "CSRF token mismatch.", logout/login berakhir 419 (SEC-7, UI-9, BK-16).
- **Refresh token berbalapan antar-request paralel,** sehingga staf logout acak (SEC-6, API-9).
- **Export CSV rentan formula injection** lewat nama klien (DD-12).
- **Booking belum mengirim `Idempotency-Key`** yang sudah disediakan backend (BK-13, API-13).
- **Tombol "Ekspor" jadwal membuka route yang tidak ada** (UI-12).
- **Item #5 filter tanggal Appointments sekarang bisa dikerjakan:** `/sessions` menerima `dateFrom` dan `dateTo`. `probe-filters` selama ini salah membaca 422-nya (API-15).
- **Tes `BookingBackendSibukTest` makan ±65 detik** karena jeda retry-nya sungguhan. Tambahkan `Sleep::fake()`.

Kalau ada yang menurutmu salah baca, bilang saja. Semua ini analisis statis, jadi bisa saja ada konteks deploy yang tidak kelihatan dari kode.
