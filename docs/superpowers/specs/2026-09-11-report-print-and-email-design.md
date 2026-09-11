# Mencetak dan mengirim laporan klien

2026-09-11 · menutup dua stub 501 terakhir di `patient-medical-reports`.

## Masalah

Dua endpoint menjawab 501 sejak dibuat pada 2026-07-03:

| Endpoint | Kapabilitas |
|---|---|
| `GET /api/v1/patient-medical-reports/{id}/print` | `patient_report_read` |
| `POST /api/v1/patient-medical-reports/{id}/send-email` | `patient_report_manage` |

Keduanya sudah terdaftar di `openapi.yaml` dan `API-ACCESS-GUIDE.md` sebagai stub,
sehingga tombol cetak dan kirim di antarmuka tidak melakukan apa pun.

## Temuan yang membentuk rancangan ini

**Laporan bukan dokumen yang kita hasilkan — ia berkas yang diunggah.** Satu baris
`wp_kc_patient_medical_report` hanya menyimpan `name`, `patient_id`, `date`, dan
`upload_report`, yaitu sebuah id media WordPress. Seluruh isi klinisnya ada di berkas
itu: PDF, JPG, atau DOCX.

Karena itu tidak ada data yang bisa dirender menjadi PDF. Pola Puppeteer di
`bill-document.service.ts` berlaku untuk tagihan, yang memang kita susun dari baris
basis data, dan tidak berlaku di sini.

Implementasi acuannya ada di plugin yang sudah kita pasang,
`Wordpress-Plugin/kivicare-pro/app/controllers/api/KCProPatientMedicalReportController.php`:

- `printReport()` (baris 716) — "Print (stream) a report file for blob usage": ia
  menstream berkas unggahan, bukan membuat PDF.
- `sendReportsViaEmail()` (baris 757) — melampirkan berkas itu ke email penerima.

Jadi `print` berarti *menyerahkan berkasnya*, dan itulah yang dikerjakan rancangan ini.

## Kosakata

Proyek ini memindahkan KiviCare, yang ditulis untuk klinik medis, ke klinik psikologi.
Setiap teks yang dibaca klien memakai register psikologi: **sesi**, **klien**,
**psikolog**. Bukan "pasien", "dokter", atau "medis".

Preseden yang mengikat: `src/services/session/reminder-email.ts`.

Nama tabel dan kolom (`wp_kc_patient_medical_report`, `patient_id`) tetap apa adanya —
itu skema KiviCare dan bukan teks yang dibaca siapa pun.

## Rancangan

### 1. Satu helper, dua route

`/print` dan `/content` yang sudah ada mengerjakan hal yang sama persis: memeriksa
cakupan, mengambil berkas, menstreamnya. Modul baru `src/services/billing/report-file.ts`
mengekspor `reportFileResponse(id, scope)` yang mengembalikan `NextResponse` berisi
stream itu. Kedua route memanggilnya; yang membedakan hanya nama di kontrak API.

`/content` yang sekarang berdiri sendiri dipotong menjadi pemanggil helper tersebut,
lengkap dengan komentar-komentarnya yang menjelaskan mengapa route ini ada.

**Satu perilaku KiviCare yang sengaja tidak disalin.** PHP-nya memasang
`Content-Disposition: inline` untuk tipe apa pun. Sebuah `.html` atau `.svg` yang
diunggah akan dijalankan sebagai skrip di origin kita, tempat sesi login klien berada.
Helper ini memakai `contentDispositionFor`, yang hanya menyajikan `inline` untuk lima
tipe yang disaring `validateUpload` dan menurunkan sisanya menjadi `attachment`.

### 2. Mengirim laporan lewat email

Pembagian tugasnya mengikuti `/api/v1/bills/[id]/email` yang sudah ada: **route** yang
memutuskan siapa penerimanya, karena hanya route yang tahu peran pemanggil; **service**
menerima satu alamat yang sudah jadi.

Route `POST /{id}/send-email`:

1. `assertCan` lalu `resolveKcActor`.
2. Baca `to` dari body. Bila peran pemanggil `CLIENT`, abaikan sepenuhnya. Bila terisi
   tetapi bukan string, tolak 400.
3. Bila tidak ada penimpaan, ambil alamat klien lewat `findPatientById`. Bila klien itu
   tidak punya alamat, tolak 400 — bukan 500 di tengah pengiriman.
4. Panggil `emailMedReport(id, to, scope)`.

Modul baru `src/services/billing/report-email.service.ts` mengekspor
`emailMedReport(id, to, scope)`:

1. `getMedReport(id, scope)` — 404 bila di luar cakupan pemanggil, sebelum apa pun
   dikirim.
2. Mengambil berkas lewat `fetchMedia`, membaca stream sambil menghitung byte.
3. Mengirim lewat `sendEmail` dengan lampiran base64.
4. Kegagalan Resend menjadi `KcError(502)`, bukan 200 yang berbohong.

Nama klinik untuk subjek diambil dari `findPatientById(...).clinicId` lalu
`prisma.kcClinic.name`. Bila klien tidak terpetakan ke klinik mana pun, atau baris
kliniknya tidak bernama, subjeknya menjadi `Laporan sesi Anda`.

## Keputusan

### Penerima: klien, dengan penimpaan untuk staf

Body boleh memuat `to`. Peran staf boleh menimpanya, misalnya untuk mengirim ke
psikolog rujukan. Bila pemanggil berperan `CLIENT`, field itu diabaikan sepenuhnya dan
laporan selalu dikirim ke alamat klien itu sendiri.

**Koreksi 2026-09-11, ditemukan saat menulis rencana implementasi.** Aturan `CLIENT` di
atas hari ini tidak pernah tercapai: endpoint ini dijaga `patient_report_manage`, dan
peta kapabilitas di `kc-permissions.ts:56` tidak memuat `CLIENT` sama sekali. Jadi klien
mendapat 403 di gerbang kapabilitas, sebelum baris penerima mana pun dijalankan — klien
tidak bisa mengirimkan laporannya sendiri lewat email, hanya staf yang bisa
mengirimkannya kepada mereka.

Kapabilitasnya tetap `patient_report_manage`, karena itulah yang sudah tertulis di
`openapi.yaml` dan `API-ACCESS-GUIDE.md`. Penjagaan `CLIENT` tetap ditulis di kode
sebagai lapis kedua: bila suatu hari `CLIENT` ditambahkan ke kapabilitas itu, mereka
tidak ikut mendapat hak memilih alamat penerima tanpa ada yang menyadarinya.

Ini mengikuti `/api/v1/bills/[id]/email` persis, termasuk penjagaannya: `to` yang bukan
string ditolak 400, karena penyedia email menerima array penerima dan sebuah `to` yang
tidak divalidasi mengubah "kirim ke satu alamat" menjadi "sebarkan ke daftar alamat".

Konsekuensi yang diterima secara sadar: satu akun staf yang dibobol dapat menarik
dokumen klinis mana pun dalam cakupannya ke alamat luar, sebagai lampiran. Penimpaan ini
**tidak** dicatat di audit log — keputusan pemilik proyek pada 2026-09-11, setelah opsi
beraudit ditawarkan.

### Batas ukuran 15 MB

Berkas yang lebih besar dari 15 MB ditolak dengan `KcError(413)` dan pesan yang
menyebutkan batasnya.

Resend menerima 40 MB, tetapi base64 menggelembungkan muatan sekitar 33% dan Gmail
menolak di 25 MB. Berkas 15 MB menjadi sekitar 20 MB di kawat, yang aman. Tanpa batas,
kegagalan muncul sebagai email yang tidak pernah tiba tanpa jejak apa pun di sisi kita.

Ukuran dihitung sambil membaca stream, bukan dari `Content-Length`: header itu boleh
kosong (`fetchMedia` mengembalikan `contentLength: null`), dan nilai yang dikirim hulu
bukan janji.

### Nama laporan tidak masuk subjek

Subjek: `Laporan sesi dari {nama klinik}`. Nama laporannya ada di badan email dan
menjadi nama lampiran.

Subjek muncul di notifikasi ponsel yang terbaca di layar terkunci. Sebuah nama berkas
klinis di sana adalah kebocoran yang tidak pernah dipilih oleh kliennya.

## Pengujian

Route:

- 401 tanpa token, 403 untuk peran yang tidak berhak, pada kedua endpoint.
- 404 ketika baris laporan tidak punya berkas (`upload_report` bukan angka).

`/print`:

- Menstream byte berkas dengan `Content-Type` dan `Content-Length` yang benar.
- Tipe di luar daftar aman tetap turun menjadi `attachment` — ini tes keamanan, bukan
  tes fitur, dan ia yang menjaga perbedaan kita dari KiviCare tetap ada.

`send-email`:

- `CLIENT` ditolak 403 di gerbang kapabilitas, dan `sendEmail` tidak pernah dipanggil.
- Peran staf dapat menimpa penerima.
- `to` yang bukan string ditolak 400.
- Klien tanpa alamat email ditolak 400, dan `sendEmail` tidak pernah dipanggil.
- Berkas di atas 15 MB ditolak 413 dan `sendEmail` tidak pernah dipanggil.
- `sendEmail` yang mengembalikan `{ ok: false }` menjadi 502.
- Subjek tidak memuat nama laporan.

## Di luar cakupan

- `POST /api/v1/patient-medical-reports` tetap 501. Itu disengaja: temuan C1 menutup
  jalan membuat baris laporan dari id media yang datang lewat body.
- `GET /{id}/preview` tetap 501; ia bagian dari pekerjaan lain di backlog.
- Menyambungkan fitur 018 (email templates) ke pengirim mana pun. Parameter `template`
  pada `sendEmail` hanya label untuk audit, dan tetap begitu di sini.
