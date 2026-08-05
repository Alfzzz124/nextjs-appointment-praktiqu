# PraktiQu — versi Laravel

Konversi frontend PraktiQu (aslinya Next.js di `../fe-praktiqu`) ke **Laravel 13 + Blade + Alpine.js**. Aplikasi ini **mengonsumsi API backend** `staging2.praktiqu.com/api/v1` yang sama — tidak punya database domain sendiri (SQLite hanya untuk session/cache Laravel).

## Kenapa arsitektur ini

Semua panggilan API dilakukan **server-side dari PHP**, jadi tidak ada masalah CORS maupun WAF edge yang menghantui FE Next.js (lihat `../fe-praktiqu/MASALAH-KONEKSI-API.txt`). Blade merender HTML awal berisi data API; Alpine.js menangani interaktivitas (wizard booking, perpindahan view dashboard, modal) di klien.

## Cara agar TIDAK terblokir backend

Inti masalah FE Next.js lama: request dari browser/edge Vercel diblokir WAF hosting (415) dan CORS. Di Laravel **semua request keluar dari server PHP**, jadi masalah itu lenyap dari akarnya. Sisanya ditangani lapisan ketahanan di `app/Services/PraktiquApi.php`:

- **Retry + backoff** untuk penolakan sesaat: `415` (WAF menolak sebelum sampai aplikasi — aman diulang), `429` (rate limit — hormati header `Retry-After`), `502/503/504` (galat gateway). `500` hanya diulang untuk method idempoten (GET/HEAD/PUT/DELETE), tidak untuk POST (menghindari tulis ganda). Maks 3 percobaan.
- **Auto-refresh token** saat `401` (single-flight), lalu ulangi sekali — bukan login ulang yang memicu rate limit.
- **Concurrency dibatasi** (`allSettled` berurutan) karena backend hanya punya 3 koneksi MySQL — fan-out serentak membuat semua endpoint 500.
- **connectTimeout 10s + timeout 30s** supaya backend yang menggantung tidak menyandera worker; kegagalan koneksi (sebelum ada respons) diulang.

Yang **tidak bisa** dilewati dari sisi ini: outage backend nyata (mis. `auth/login` yang sekarang 503 karena rantai auth WordPress-nya down) dan `403` capability — itu keputusan sah backend.

## Menjalankan

```bash
composer install
php artisan key:generate      # kalau APP_KEY belum ada
php artisan migrate           # buat tabel session/cache SQLite
php artisan serve --port=8100
```

Base URL backend diatur di `.env`:

```
PRAKTIQU_API_BASE=https://staging2.praktiqu.com
```

## Peta ke kode Next.js lama

| Next.js (`fe-praktiqu`) | Laravel (`laravel-praktiqu`) |
|---|---|
| `lib/api.js` (klien + refresh 401) | `app/Services/PraktiquApi.php` |
| `lib/booking-api.js` | `app/Services/BookingApi.php` |
| `lib/auth.js` | `app/Http/Controllers/AuthController.php` |
| `lib/dashboard-api.js` + `lib/scope.js` | `app/Http/Controllers/DashboardController.php` |
| `components/AuthGuard.js` | `app/Http/Middleware/StaffAuth.php` |
| `app/page.js` (login) | `resources/views/login.blade.php` |
| `app/[tenant]/page.js` + `components/booking/*` + `lib/useBooking.js` | `resources/views/booking.blade.php` (Alpine) |
| `app/{admin,klinik,psikolog}` + `components/dashboard/DashboardApp.js` | `resources/views/dashboard.blade.php` (Alpine) |
| `app/globals.css` + inline JSX style | `public/css/app.css` |

## Rute

- `GET /` — login staf (redirect ke area sesuai role kalau sudah login)
- `POST /login`, `POST /logout`
- `GET /admin | /klinik | /psikolog` — dashboard per role (dijaga middleware `staff:*`)
- `GET /{tenant}` — halaman booking publik per klinik/psikolog
- `GET /booking/slots`, `POST /booking/{submit,pay,verify}` — AJAX booking
- `POST /dashboard/upload` — teruskan unggahan foto ke backend
- `POST /dashboard/{resource}/create`, `DELETE /dashboard/{resource}/{id}`, `PATCH /dashboard/{resource}/{id}/status` — CRUD ke backend (`app/Http/Controllers/ResourceController.php`, allowlist entitas)

## CRUD ke API asli

`ResourceController` menulis ke backend untuk 6 entitas ber-allowlist: `patients`(clients), `doctors`(professionals), `receptionists`, `billing`(bills), `clinics`(practices), `sessions`(doctor-sessions). Bukan proxy terbuka — hanya pasangan entitas→endpoint terdaftar yang boleh dipanggil. **Hapus & toggle status** memakai id baris asli dari API (paling andal). **Create** mengirim payload tebakan-terbaik (nama field dari bentuk respons yang teramati); kalau backend membalas 422, pesannya diteruskan apa adanya ke modal supaya nama field bisa disetel. Entitas non-allowlist (services, jadwal non-reguler, libur) masih lokal karena endpoint-nya butuh relasi id yang belum ada di form.

## Status verifikasi (24 Jul 2026)

- ✅ Booking flow: resolve tenant, 17 layanan asli, slot live per tanggal, tanggal kosong non-bookable — diuji di browser end-to-end.
- ✅ Ikon SVG: seluruh ikon (nav, kartu statistik, aksi tabel, tombol) diport dari `DashIcons.js` ke komponen Blade `<x-icon>` — dashboard dirender & discreenshot, 78 SVG, tanpa emoji.
- ✅ Lapisan anti-blokir: retry+backoff terpasang, tidak memperlambat happy-path (booking/slots tetap 200).
- ✅ Proteksi: dashboard redirect ke login tanpa sesi; route write balas 401 JSON tanpa sesi.
- ⚠️ **CRUD write belum teruji end-to-end** karena butuh sesi login, sedangkan backend `auth/login` sedang **503** (rantai auth WordPress down). Route + controller + payload sudah siap; uji begitu login pulih (+ akun WordPress asli). Create bill/practice/session mungkin perlu penyesuaian field karena butuh relasi id — akan terlihat dari pesan 422 backend.
- Layout mobile sengaja disederhanakan (satu kolom, sidebar disembunyikan) sesuai permintaan.
