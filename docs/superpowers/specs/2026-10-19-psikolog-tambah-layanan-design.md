# Psikolog Menambah Layanannya Sendiri — Desain

**Tanggal:** 2026-10-19
**Status:** Desain disetujui user (2026-10-19). Menunggu review spec tertulis.
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu`: branch `feat/psikolog-tambah-layanan` dari `origin/main` e319e73
- FE Laravel `raakanaka/laravel-praktiqu`: branch `feat/psikolog-tambah-layanan` dari `origin/main` cd7f75f
- Plugin WordPress `praktiqu-endpoint`: **tidak berubah**

## Masalah

Psikolog (role `PROFESSIONAL`) sejak 2026-10-15 (PR #34/#43) boleh **mengubah** layanannya
sendiri, tapi tidak bisa **menambah**. Akibatnya, psikolog yang dulu menambah layanan sendiri
di dashboard KiviCare lama sekarang harus minta admin klinik, atau harus dijadikan pemilik
klinik. Contoh: feedback Dianda Azani (wp 34, klinik 4), 2026-10-19.

Dua jalan keluar yang ada sekarang terlalu lebar untuk kebutuhan ini:
- **Mode pemilik** (2026-10-16) membuka seluruh operasional klinik: jadwal semua psikolog,
  janji temu, klien, dan billing.
- **Akun admin klinik** terpisah.

Yang dibutuhkan hanya: psikolog bisa menambah layanannya sendiri.

## Keputusan user

| # | Keputusan |
|---|---|
| K1 | Setiap psikolog boleh **menambah dan mengubah layanannya sendiri** tanpa menjadi admin klinik atau pemilik klinik. |
| K2 | Layanan buatan psikolog **langsung berlaku** seperti layanan buatan admin. Status Aktif → langsung bisa dipesan. Tidak ada alur persetujuan. |
| K3 | Pendekatan: **perluas `POST /api/v1/services`**, bukan endpoint baru. |
| K4 | **Hapus/pensiunkan tetap khusus admin.** Psikolog bisa menonaktifkan layanannya lewat Ubah (status Nonaktif), dan itu sudah ada. |

## Matriks akses setelah perubahan

| Aksi | Super Admin | Admin Klinik / Pemilik (mode Kelola) | Psikolog ("Praktik saya") |
|---|---|---|---|
| Lihat | semua | kliniknya | barisnya sendiri (tetap) |
| **Tambah** | klinik mana pun | kliniknya | **baru:** hanya untuk dirinya, di klinik aktif tempat ia praktik |
| Ubah | semua | kliniknya | barisnya sendiri (tetap) |
| Hapus | ✓ | ✓ | ✗ (tetap) |

Resepsionis tetap tidak bisa menulis layanan. Mode pemilik tidak berubah: di "Kelola: Klinik X"
psikolog bertindak sebagai admin klinik X (`OWNER_ROUTES` sudah memuat `POST /api/v1/services`).

## Backend

### B1. Daftar klinik praktik seorang psikolog

Fungsi baru `listPracticeClinics(wpUserId)` di `src/services/billing/kc-actor.ts`, bersebelahan
dengan `listAdminClinics`. Isinya klinik **aktif** (`wp_kc_clinics.status = 1`) yang dipetakan
ke psikolog itu di `wp_kc_doctor_clinic_mappings`. Hasilnya berbentuk `{ id, name }[]`, urut
id naik, tanpa duplikat. Fungsi ini menjadi satu-satunya sumber untuk B2 dan B3.

Klinik nonaktif sengaja dikeluarkan. Enam psikolog masih punya mapping ke klinik nonaktif 33.
Kalau klinik itu ikut dihitung, mereka akan dipaksa memilih klinik padahal hanya satu yang
hidup, dan layanan di klinik nonaktif memang tidak bisa dipesan.

### B2. `practiceClinics` di login dan `/auth/me`

`scopeClinics()` (`src/services/auth/service.ts`) cabang PROFESSIONAL menambahkan
`practiceClinics: listPracticeClinics(wpUserId)` di samping `ownedClinics`. Aturan yang
berlaku:

- **Nama field.** Field baru ini bukan `clinics`. Kunci `clinics` sengaja hanya untuk
  CLINIC_ADMIN, karena FE memakainya sebagai tanda "ada pemilih klinik admin".
- **Kalau gagal.** Kegagalan memuatnya tidak boleh menjatuhkan login, sama seperti
  `ownedClinics`: kegagalan dicatat di log dan hasilnya `practiceClinics: []`.
- **Psikolog tanpa wpUserId.** Hasilnya `practiceClinics: []`.
- **`clinicId`.** Tetap `null` untuk PROFESSIONAL dan tidak diubah.

### B3. `POST /api/v1/services` untuk PROFESSIONAL

Pintu masuknya `canCreate(role)` yang baru: `canWrite(role) || role === 'PROFESSIONAL'`.
`canWrite` tetap dipakai DELETE dan tidak berubah.

Keputusan sasaran create untuk psikolog dibuat di modul kecil baru
`src/services/service-catalog/own-create.ts`, fungsi
`resolveOwnCreateTarget({ self, doctorIds, clinicId })`. Fungsi ini mengembalikan
`{ clinicId }` atau satu kode tolak. Route mengubah kode tolak menjadi respons:

| Kondisi | Respons |
|---|---|
| `doctorIds` (setelah dedup) bukan tepat `[self]` | **403** `Psychologists can only add services for themselves` |
| Psikolog tidak punya klinik aktif sama sekali | **403** `Professional is not assigned to an active clinic` |
| `clinicId` dikirim, tapi bukan salah satu `listPracticeClinics` | **403** `Not a clinic this professional practises at` |
| `clinicId` tidak dikirim, tepat 1 klinik aktif | klinik itu dipakai |
| `clinicId` tidak dikirim, > 1 klinik aktif | **422** `clinic_required`, `fields.clinicId` |

`self` = `scope.doctorId` dari `readScopeFor`, yaitu wp user id psikolog dari token, bukan
dari body. Setelah sasaran ditemukan, `createService(input, clinicId, actor.id)` dipanggil apa
adanya. Semua aturan yang sudah ada tetap berlaku tanpa perubahan:

- validasi nama, harga, dan durasi;
- kategori harus dikenal (422);
- anti-duplikat nama per psikolog per klinik (409);
- `doctors_not_in_clinic` (400) sebagai jaring kedua;
- transaksi katalog + mapping;
- audit `service.created` dengan `userId` = psikolognya.

Penolakan 403 ini disengaja, bukan pembuangan diam-diam. Body yang menyebut psikolog lain
adalah kesalahan pemanggil, dan menelannya berarti layanan dibuat untuk orang yang berbeda
dari yang diminta.

### B4. Dokumen API

- `docs/api/SERVICES-CRUD-GUIDE.md`: §3 Hak akses, §6 POST, dan §12 Referensi error, sesuai
  matriks dan tabel error PROFESSIONAL di atas.
- `docs/api/PRACTICES-AND-SERVICES-GUIDE.md`: tempat `ownedClinics` didokumentasikan.
  Tambahkan field `practiceClinics` di sana.
- Komentar kepala `src/services/service-catalog/scope.ts`: kalimat "Adding and retiring
  offerings stays with the admins" diganti.

## FE (Laravel)

### F1. Profil membawa `practiceClinics`

Login dan refresh `/auth/me` menyimpan `practiceClinics` ke profil sesi psikolog.

- **Mekanisme refresh.** `AuthController::segarkanKlinikPemilik()` sudah memanggil
  `/auth/me` setiap 5 menit untuk `ownedClinics`. Fungsi itu juga menyimpan `practiceClinics`.
- **Pemicu refresh.** Kunci `practiceClinics` yang belum ada di sesi (login sebelum fitur ini)
  ikut memicu refresh, sama seperti `ownedClinics`.
- **Klinik baru.** Psikolog yang baru dipetakan ke klinik baru akan melihatnya paling lambat 5
  menit kemudian.

### F2. `ServiceController::store`

- **Izin.** `penulis(psikologBoleh: true)` dipakai untuk `store`, sementara `destroy` tetap
  admin saja.
- **Isian `doctors`.** Untuk psikolog, `doctors` **tidak dibaca dari request**. `doctorIds`
  diisi `[professionalId]` dari profil sesi, dan aturan `doctors required` tidak berlaku
  baginya.
- **Klinik.**
  - `clinicId` diambil dari request. Kalau kosong dan profil hanya punya 1
    `practiceClinics`, klinik itu yang dipakai.
  - Kalau kosong dan ada > 1 klinik, jawabannya 422 "Pilih dulu klinik tempat layanan ini
    berlaku." tanpa memanggil backend.
  - Kalau `practiceClinics` kosong atau tidak ada, `clinicId` tidak dikirim dan keputusannya
    diserahkan ke backend.
- **Pesan.** `tolak()` diganti menjadi "Peran Anda tidak boleh menambah atau menghapus
  layanan." Pesan lama menyebut "Hanya Super Admin dan Admin Klinik", padahal kini psikolog
  pun boleh menambah.

### F3. Tampilan (`dashboard.blade.php`)

- **Tombol.** **Add Service** tampil juga untuk psikolog: syarat `peranUi !== 'psikolog'`
  dibuang dari `x-show` tombol itu. Tombol **Hapus** tetap tersembunyi.
- **Form Tambah untuk psikolog:**
  - Pilihan "Ditawarkan oleh" diganti teks baca-saja berisi nama psikolog itu sendiri, dan
    roster klinik tidak dimuat.
  - Muncul pilihan **Klinik** yang hanya berisi `practiceClinics`, dan hanya kalau jumlahnya
    > 1. Kalau 1, nama kliniknya tampil di kalimat "Untuk klinik …".
  - Tombol Simpan tidak lagi menunggu `svcForm.doctors.length` untuk psikolog. Kalau
    kliniknya > 1, tombol menunggu klinik dipilih.
- **Sesudah simpan.** Daftar dimuat ulang lewat jalur psikolog yang sudah ada:
  `/dashboard/services` tanpa clinicId.

## Pengujian

**Backend** (Vitest; route test memakai mock seperti `tests/integration/services/collection-route.test.ts`):

- `own-create`, unit, dengan `listPracticeClinics` dimock:
  - diri sendiri + 1 klinik → klinik itu;
  - diri sendiri + 2 klinik tanpa clinicId → `clinic_required`;
  - clinicId milik sendiri → klinik itu;
  - clinicId bukan miliknya → `clinic_not_yours`;
  - ada id psikolog lain → `not_self`;
  - `[self, self]` → diterima;
  - tanpa klinik aktif → `no_clinic`.
- Route POST:
  - PROFESSIONAL → 201, dan `createService` menerima `doctorIds: [self]` dan klinik hasil
    `resolveOwnCreateTarget`;
  - setiap kode tolak dipetakan ke 403/422 tanpa memanggil `createService`;
  - test lama "role yang tidak bisa menulis → 403" tetap ada untuk RECEPTIONIST.
- `canCreate`: SUPER_ADMIN, CLINIC_ADMIN, PROFESSIONAL ya; RECEPTIONIST, CLIENT tidak.
  `canWrite` tetap menolak PROFESSIONAL.
- `listPracticeClinics` **dengan test DB**:
  - klinik aktif saja, urut id, dan tanpa duplikat kalau mapping ganda;
  - psikolog tanpa mapping → `[]`.

  Alasannya: mock tidak bisa melihat masalah skema prod, misalnya zero-date dan tipe kolom.
- `scopeClinics` PROFESSIONAL membawa `practiceClinics`; kegagalannya → `[]` tanpa melempar.
- Full suite + `tsc` dijalankan di sini (ada test DB) sebelum push.

**FE** (PHPUnit, pola test ServiceController yang ada):

- `store` sebagai psikolog:
  - mengirim `doctorIds = [professionalId]` walau request menyebut psikolog lain;
  - mengirim `clinicId` yang dipilih;
  - 1 klinik → otomatis;
  - > 1 tanpa pilihan → 422 tanpa memanggil backend.
- `destroy` sebagai psikolog → tetap 403. `store` sebagai admin tidak berubah.
- `segarkanKlinikPemilik` menyimpan `practiceClinics`, dan sesi tanpa kunci itu ikut
  disegarkan.
- Tampilan: tombol Add Service ada untuk psikolog; tombol Hapus tetap tidak.

## Rilis

1. **Merge BE dulu.** Hostinger auto-deploy ~1,5 menit. Setelah BE live, psikolog sudah bisa
   menambah lewat API, tapi tombolnya belum ada.
2. **Merge FE.** Kalau urutannya terbalik, psikolog akan melihat tombol Add Service yang
   dijawab 403 oleh BE lama.
3. Uji coba oleh user: login sebagai psikolog di mode "Praktik saya", tambah 1 layanan
   Nonaktif, cek kartunya muncul, lalu hapus lewat akun admin.

## Di luar cakupan

- Psikolog menghapus/memensiunkan layanannya (K4).
- Alur persetujuan admin (K2).
- Psikolog memindahkan layanannya ke klinik lain. Caranya tetap: buat baru, lalu admin
  menghapus yang lama.
