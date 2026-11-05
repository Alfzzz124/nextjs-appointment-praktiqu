# Opsi durasi layanan

**Tanggal:** 2026-11-05
**Status:** desain disetujui, menunggu review spec
**Cabang:** `feat/opsi-durasi-layanan` (BE, dari `origin/main` 07b6579) + cabang bernama sama di FE

## Ringkasan

Klien ingin satu layanan punya beberapa durasi dengan harga berbeda, misalnya
Konseling Individu 60 menit Rp425rb dan 90 menit Rp600rb. Pasien tetap melihat
**satu** layanan, lalu memilih durasinya. Fitur ini tambahan: layanan yang tidak
diberi opsi berperilaku persis seperti sekarang.

Di backend, setiap opsi adalah layanan tersendiri yang diberi penanda "aku opsi
durasi dari layanan X". Mesin slot, booking, pembayaran, email, invoice, Google
Calendar, dan reschedule tidak perlu tahu fitur ini ada.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
| --- | --- | --- |
| Di mana opsi tampil digabung | Booking pasien (termasuk tautan pribadi `/{nama}`), janji manual di dashboard, daftar kelola layanan | Diputuskan pemilik produk |
| Nama opsi | Otomatis: `<nama induk> (90 menit)`, ikut berubah saat induk diganti nama atau durasi opsi diubah | Nama itu muncul di email, invoice, Google Calendar, dan admin WP, jadi harus menyebut durasinya dan konsisten |
| Jumlah | Durasi utama + maksimal 4 opsi (total 5) | Biayanya hampir sama dengan 2 durasi, dan tidak perlu dibongkar kalau klien minta 3 |
| Menggabungkan layanan lama yang sudah terpisah | Tidak didukung | Layanan lama yang dobel cukup dinonaktifkan; riwayat janjinya tetap aman |
| Tempat penanda | Kolom `extra` di `wp_kc_service_doctor_mapping` | Lihat bagian berikut |
| Bentuk daftar dari backend | Tetap datar; opsi diberi field `durationOf`, FE yang menggabungkan | Laporan dan janji manual mencari layanan berdasarkan id di daftar itu (lihat "Kenapa daftar tetap datar") |

## Kenapa opsi harus jadi layanan katalog tersendiri

Durasi dan harga disimpan per psikolog × klinik di `wp_kc_service_doctor_mapping`,
bukan per layanan global. Janji temu hanya menyimpan id **katalog**
(`wp_kc_appointment_service_mapping.service_id` → `wp_kc_services.id`), dan booking
mencari harga dan durasi lewat `listServicesForDoctor(...).find(s => s.serviceId === serviceId)`.

Kalau opsi 90′ hanya baris mapping kedua untuk id katalog yang sama, sistem tidak
bisa membedakan janji 60′ dan 90′, dan booking bisa mengambil harga yang salah.
Jadi setiap opsi butuh id katalog sendiri, dan nama yang berbeda: katalog dipakai
ulang berdasarkan nama + tipe (`findCatalogueByNameAndType`), dan
`findConflictingMapping` menolak dua mapping bernama sama untuk psikolog dan klinik
yang sama.

## Kenapa kolom `extra`, bukan postmeta atau tabel baru

**Bukan postmeta:** layanan KiviCare bukan WordPress post. Layanannya adalah baris
di tabel KiviCare sendiri, jadi tidak punya `post_id`.

**Bukan tabel baru:** tabel pasangan (induk, opsi) berarti dua sumber kebenaran
yang harus dijaga sinkron, plus SQL manual di Hostinger yang bisa kelupaan
(kejadian `clinic_owners`). Penanda di `extra` menempel di baris yang sama, jadi
tidak bisa terpisah dari opsinya.

**`extra` aman dipakai.** Sudah diperiksa di semua kode yang bisa menulis ke tabel
mapping: KiviCare inti, KiviCare Pro (termasuk `KCImportController`), addon
telemed, Google Meet, mu-plugins, `praktiqu-endpoint`, dan BE ini.
- KiviCare cuma membaca kolom ini dan meneruskan isinya di 2 respons API
  (`DoctorServiceController.php:831`, `AppointmentsController.php:3110`). Tidak ada
  yang menulisnya. Satu-satunya `extra` yang ditulis KiviCare ada di tabel klinik
  (`SetupWizardController.php:268`).
- Plugin dan kode lain tidak menyentuh tabel ini sama sekali.

Selain itu, **kita tidak pernah menulis `extra` di baris yang sudah ada.** Penanda
hanya ditulis di baris opsi yang kita buat sendiri, sedangkan baris induk tidak
pernah disentuh. Saat membaca, sebuah baris dianggap opsi hanya kalau `extra`-nya
JSON yang punya kunci `praktiqu_duration_of`. Isi lain atau teks yang bukan JSON
dianggap layanan biasa.

Sebelum rilis tetap ada satu query read-only ke DB produksi untuk memastikan kolom
itu memang kosong semua. Query ini butuh izin pemilik produk dulu.

## Model data

Satu opsi =

- **Satu baris `wp_kc_services`:**
  - `name` = `<nama induk> (<durasi> menit)`. Kalau lebih dari 255 karakter, bagian
    nama induk yang dipotong, akhirannya tidak.
  - `type` dan `category` sama dengan katalog induk.
  - Dipakai ulang kalau nama + tipe sudah ada, sama seperti pembuatan layanan biasa.
- **Satu baris `wp_kc_service_doctor_mapping`:**
  - `doctor_id` dan `clinic_id` sama dengan induk.
  - `duration` dan `charges` diisi milik opsi sendiri.
  - `telemed_service`, `is_public`, dan `status` disalin dari induk.
  - `extra` = `{"praktiqu_duration_of": <id mapping induk>}`.

Opsi tidak bisa punya opsi: induk sebuah opsi harus baris yang bukan opsi.

### Sinkronisasi dari induk (saat menulis)

Setiap jalur yang mengubah baris induk menerapkan perubahan yang sama ke semua
opsinya yang masih hidup, dalam satu transaksi:

| Perubahan induk | Efek ke opsi |
| --- | --- |
| Ganti nama | Setiap opsi dipindahkan ke katalog `<nama baru> (<durasi> menit)` (pakai ulang atau buat), dengan cara yang sama seperti rename induk |
| Ganti kategori/tipe | Ikut, lewat katalog yang sama |
| `telemed_service`, `is_public` | Disalin |
| `status` (nonaktif/aktif) | Disalin |
| Hapus (soft delete) | Semua opsi ikut di-soft delete. Ditolak (409, perilaku hapus yang sudah ada) kalau induk **atau salah satu opsinya** masih punya janji mendatang. |
| Ganti durasi induk | Tidak menyentuh opsi, tapi ditolak (422 `duration_option_duplicate`) kalau durasi barunya sama dengan durasi salah satu opsi |

Jalur tulis yang wajib ikut menyinkronkan:
- `updateService` dan `deleteService` (`src/services/service-catalog/service.ts`).
- `setDoctorServiceStatus`: toggle status massal psikolog,
  `/professionals/{id}/services/bulk/status`.
- `unassignServiceFromDoctor`: hapus massal psikolog,
  `/professionals/{id}/services/bulk/delete`.
- `assignServiceToDoctor`: reaktivasi. Opsi yang sebelumnya nonaktif *karena
  induknya* ikut aktif lagi.

Jalur yang menghapus semua mapping seorang psikolog atau sebuah klinik sudah
otomatis mengenai opsinya, karena opsi punya `doctor_id`/`clinic_id` yang sama.

### Menghapus opsi

Menghapus opsi = soft delete (`status = 0`) **dan** mengganti kuncinya menjadi
`praktiqu_duration_of_removed`. Dengan begitu opsi yang sudah dibuang tidak ikut
hidup lagi saat induknya diaktifkan ulang, tapi jejaknya tetap ada.

### Pengaman saat membaca

`listServicesForDoctor` (sumber data booking, slot, pembayaran, dan katalog publik)
membuang opsi yang induknya tidak ada di hasil query yang sama, yaitu induk yang
nonaktif, tidak publik (untuk `publicOnly`), atau hilang. Akibatnya opsi seperti
itu tidak pernah tampil dan **tidak bisa dibooking**, walaupun ada jalur tulis yang
lupa menyinkronkan.

Daftar staf (`listClinicServices`) juga membuang opsi yang induknya hilang, atau
induknya nonaktif saat opsi itu sendiri aktif. Statusnya dicek lewat query id induk,
**bukan dari isi halaman**, karena daftar ini berhalaman dan induk bisa ada di
halaman lain. Alasan yang sama berlaku untuk `durationOptions` di baris induk: isinya
diambil dengan query tersendiri, bukan dirakit dari baris di halaman yang sama.

**Jebakan Prisma:** filter "bukan opsi" pada kolom nullable harus eksplisit
`OR: [{ extra: null }, { extra: { not: { contains: ... } } }]`. `NOT LIKE` pada
NULL bernilai NULL, sehingga baris tanpa `extra` (hampir semua baris) ikut terbuang.

## API (BE)

### Kenapa daftar tetap datar

Dua konsumen di FE mencari layanan berdasarkan id di daftar dari backend:
- `ReportController::namaLayanan` memetakan `serviceId → nama` dari `/api/v1/services`.
- `ManualAppointmentController` (`:317` dan `:553`) mencari durasi layanan terpilih
  dengan `firstWhere('id', serviceId)` dari `/public/professionals/{id}/services`.

Kalau backend menyembunyikan opsi dari daftar, janji yang dibooking dengan opsi
kehilangan nama di laporan, dan janji manual menolak opsi sebagai "tidak dibuka".
Karena itu kedua daftar tetap memuat opsi sebagai baris biasa, ditambah satu field
penanda, dan pengelompokan dikerjakan FE untuk tampilan saja.

### `GET /api/v1/services` dan `GET /api/v1/services/{id}`

- Setiap baris mendapat `durationOf: string | null`, berisi id mapping induk untuk
  baris opsi.
- Baris induk mendapat `durationOptions: Array<{ id, name, durationMinutes, charges }>`,
  terurut dari durasi terpendek. Isinya `[]` kalau tidak punya opsi.
- Pagination dan `total` tidak berubah, tetap menghitung semua baris. FE sudah
  menyapu semua halaman (`DashboardController:1234`), jadi aman.

### `PUT /api/v1/services/{id}`

Field baru opsional: `durationOptions: Array<{ id?: string, durationMinutes: number, charges: number }>`.

- Field tidak dikirim → opsi tidak disentuh, jadi FE lama tetap aman.
- Field dikirim → dianggap daftar lengkap:
  - baris tanpa `id` = opsi baru;
  - baris dengan `id` = ubah durasi/harga opsi itu;
  - opsi yang ada di DB tapi tidak dikirim = dihapus.
- Diproses dalam satu transaksi bersama perubahan induk.
- PUT dan DELETE langsung ke baris opsi ditolak dengan **422 `edit_via_parent`**.
- Hak akses sama dengan mengedit induk: admin, admin klinik, pemilik klinik, atau
  psikolog untuk layanannya sendiri. Tidak ada aturan cakupan baru.

| Kondisi | Respons |
| --- | --- |
| Lebih dari 4 opsi | 422 `duration_option_limit` |
| Durasi kembar (dengan induk atau opsi lain), termasuk karena durasi induk diubah di PUT yang sama | 422 `duration_option_duplicate` |
| Durasi/harga tidak valid | 422, aturan sama dengan layanan biasa (1–1440 menit, harga ≥ 0) |
| `id` opsi bukan milik induk ini | 422 `duration_option_not_found` |
| Hapus opsi, atau ubah durasinya, padahal masih ada janji mendatang | 409 `duration_option_has_appointments` dengan jumlah janjinya. Mengubah durasi janji yang sudah dipesan diam-diam tidak boleh. |
| Nama opsi bentrok dengan layanan lain psikolog itu di klinik itu (termasuk karena induk diganti nama) | 409 konflik nama yang sudah ada, menyebut layanan yang bentrok |

Harga opsi masih boleh diubah walau ada janji mendatang: janji menyimpan
tagihannya sendiri, sama seperti mengubah harga layanan biasa sekarang.

### `POST /api/v1/services`

Tidak berubah. Opsi ditambahkan dari form edit setelah layanan tersimpan.

### `GET /public/professionals/{id}/services`

- Setiap baris mendapat `durationOf: number | null`, berisi id publik (id katalog)
  induk di respons yang sama.
- Induk dan opsinya selalu berada di klinik yang sama. FE mengelompokkan dengan
  kunci (`clinicId`, `durationOf`).
- Pengaman saat membaca menjamin induk setiap opsi selalu ada di respons yang sama.

### Slot, submit booking, pembayaran

Tidak berubah. FE cukup mengirim `serviceId` milik opsi yang dipilih.

## FE (Laravel)

### Booking pasien (`booking.blade.php`, langkah 0)

- Satu kartu per induk. Opsi tidak tampil sebagai kartu sendiri.
- Kartu tanpa opsi tampil persis seperti sekarang.
- Kartu dengan opsi menampilkan chip `60 menit · Rp425rb` / `90 menit · Rp600rb`
  di dalam kartu, terurut dari durasi terpendek. Klik kartu memilih durasi induk.
  Klik chip memilih opsi itu, sehingga `serviceId` = id opsi. Harga (termasuk USD)
  dan durasi di kartu mengikuti chip yang dipilih.
- Ganti chip setelah tanggal/jam dipilih → pilihan tanggal/jam di-reset lalu slot
  dipindai ulang, karena durasinya beda.
- Chip adalah grup radio tersendiri (Tab, Enter/Spasi, `aria-checked`), mengikuti
  pola aksesibilitas kartu yang sudah ada.
- Ringkasan dan langkah berikutnya memakai nama opsi apa adanya, misalnya
  "Konseling Individu (90 menit)".
- Halaman tautan pribadi (`/{nama}`) ikut, karena view-nya sama.

### Janji manual di dashboard

- Modal pilih layanan memakai pola chip yang sama.
- Pencarian durasi di `ManualAppointmentController` (`:317`, `:553`) tetap jalan
  tanpa diubah, karena opsi tetap ada di daftar datar.

### Daftar kelola layanan (`DashboardController`)

- Baris dengan `durationOf` tidak ditampilkan sebagai baris sendiri.
- Baris induk menampilkan semua durasinya di kolom durasi/harga, misalnya
  `60′ Rp425rb · 90′ Rp600rb`.
- Hitungan "jumlah layanan" di halaman itu menghitung induk saja.

### Form edit layanan (`ServiceController`)

- Bagian baru **"Opsi durasi lain"**: baris [durasi (menit)] [harga] [hapus] dan
  tombol **+ Tambah durasi**. Tombolnya hilang setelah 4 opsi.
- Teks bantu: "Kategori, status online, dan tampil publik mengikuti layanan ini.
  Nama opsi dibuat otomatis, misalnya *Konseling Individu (90 menit)*."
- Simpan mengirim `durationOptions` lengkap bersama field lain dalam satu PUT.
- Pesan galat dalam bahasa Indonesia untuk setiap kode di tabel API di atas.
  Pesan 409 janji mendatang menyebut jumlah janjinya.
- Membuka URL edit milik baris opsi mengarahkan ke edit induknya.

### Form tambah layanan

Tidak berubah.

## Di luar cakupan (sengaja)

- Laporan/statistik per layanan tetap menghitung opsi dengan namanya sendiri.
- Admin WordPress/KiviCare dan widget lama KiviCare melihat opsi sebagai layanan
  terpisah.
- Mengganti durasi janji yang sudah dipesan.
- Menggabungkan layanan lama yang sudah terpisah menjadi opsi.
- Opsi di form tambah layanan.

## Pengujian

**Unit BE:**
- Membaca penanda: JSON valid dengan kunci, JSON tanpa kunci, bukan JSON, NULL,
  dan kunci `_removed`.
- Pembentuk nama, termasuk pemotongan di 255 karakter.
- Validasi `durationOptions`: batas jumlah, durasi kembar, opsi bertingkat, dan
  id asing.
- Pengaman saat membaca di `listServicesForDoctor`: opsi yatim dibuang, opsi
  dengan induk aktif tetap ada.

**E2E BE di test DB** (blok id sendiri lewat `idBlock()`):
- PUT tambah, ubah, dan hapus opsi, lalu baris katalog + mapping + `extra`-nya benar.
- `GET /services` dan `/services/{id}` membawa `durationOf` / `durationOptions`.
- `GET /public/professionals/{id}/services` membawa `durationOf`.
- Slot dengan id opsi memakai durasi opsi.
- Booking publik dengan id opsi tercatat dengan harga dan durasi opsi.
- Sinkronisasi: ganti nama, nonaktif/aktif, `is_public`, telemed, bulk status,
  bulk delete, dan reaktivasi lewat assign.
- Opsi yang dihapus tidak hidup lagi saat induk diaktifkan ulang.
- Hapus opsi atau ganti durasinya ditolak saat ada janji mendatang.
- Konflik nama, termasuk lewat rename induk, membatalkan seluruh perubahan.
- Pengaman saat membaca: opsi berstatus 1 dengan induk berstatus 0 tidak tampil
  dan booking-nya ditolak.
- PUT/DELETE langsung ke baris opsi → 422 `edit_via_parent`.
- Baris dengan `extra` berisi teks bebas tetap tampil sebagai layanan biasa dan
  tidak pernah ditimpa.

**FE:**
- PHPUnit: controller meneruskan `durationOptions`, daftar kelola menyembunyikan
  baris opsi, dan pesan galat per kode.
- Tes JS: pengelompokan per (`clinicId`, `durationOf`), pemilihan chip, dan reset
  jadwal saat chip diganti.
- Smoke test di browser lokal (stub backend): booking pasien, janji manual, dan
  form edit.

## Urutan rilis

Tidak ada migrasi SQL.

1. Minta izin, lalu jalankan query read-only ke DB produksi:
   `SELECT COUNT(*) FROM wp_kc_service_doctor_mapping WHERE extra IS NOT NULL AND extra <> ''`.
   Hasilnya harus 0. Kalau tidak 0, lihat isinya dulu sebelum lanjut.
2. Merge BE, lalu pastikan build Hostinger benar-benar jalan (pernah ter-skip).
   - BE baru dengan FE lama aman: field baru diabaikan FE lama.
   - Opsi belum bisa dibuat sebelum FE baru rilis.
3. Merge FE.
4. Coba di produksi:
   - satu layanan diberi opsi;
   - booking pasien dengan opsi itu sampai halaman pembayaran (tanpa membayar);
   - janji manual dengan opsi;
   - hapus opsi tersebut.
