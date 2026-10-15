# CRUD Klinik (Tambah, Edit, Nonaktifkan, Hapus) — Desain

**Tanggal:** 2026-10-15
**Status:** Disetujui user (2026-10-15). Rencana implementasi: `docs/superpowers/plans/2026-10-15-crud-klinik.md`.
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu` (branch `feat/crud-klinik`, dari `origin/main` 0b16fc7)
- Plugin WordPress `praktiqu-endpoint` (folder `Wordpress-Plugin/praktiqu-endpoint` di repo backend), 1.7.0 → **1.8.0**
- FE Laravel `raakanaka/laravel-praktiqu` (branch baru dari `main`, hanya lewat PR)

## Masalah

Super admin tidak bisa mengelola klinik dari aplikasi. Yang ada hari ini:

| Operasi | Backend `/api/v1/practices` | FE (tab Clinics) |
|---|---|---|
| Lihat daftar/detail | ada | grid kartu klinik (aktif dan nonaktif, dengan badge) |
| Tambah | `POST` stub, selalu **501** (`src/app/api/v1/practices/route.ts`) | tombol dicabut, diganti tulisan "Klinik baru dibuat lewat WordPress/KiviCare" |
| Edit | `PATCH /:id` jalan | tidak ada form |
| Nonaktifkan | `DELETE /:id` = status 0 | tidak ada tombol |
| Aktifkan lagi | `PATCH` `status: 1` | tidak ada tombol |
| Hapus permanen | tidak ada | tidak ada |

Ada juga celah hak akses: `PATCH` dan `DELETE /practices/:id` menerima `CLINIC_ADMIN` untuk
kliniknya sendiri, termasuk mengubah `status`. Akibatnya admin klinik bisa menonaktifkan
kliniknya sendiri.

## Tujuan

1. Super admin bisa **menambah** klinik dari FE. Admin kliniknya bisa dipilih dari akun yang
   sudah ada, dibuat baru (kata sandi dikirim lewat email), atau diatur nanti.
2. Super admin dan admin klinik (untuk kliniknya sendiri) bisa **mengedit** profil klinik.
3. Super admin bisa **menonaktifkan / mengaktifkan kembali** klinik.
4. Super admin bisa **menghapus permanen** klinik yang belum punya data sama sekali. Klinik
   yang sudah punya data hanya bisa dinonaktifkan.
5. Admin klinik tidak lagi bisa mengubah status kliniknya sendiri.

## Keputusan user (2026-10-15)

| Pertanyaan | Keputusan |
|---|---|
| Admin saat tambah klinik | **C**: pilih admin yang ada, buat akun admin baru, atau atur nanti |
| Arti "hapus" | **B**: nonaktifkan (bisa diaktifkan lagi) + hapus permanen hanya untuk klinik kosong |
| Hak akses | **A**: super admin semua; admin klinik hanya edit profil kliniknya sendiri |
| Cara membangun | Baris klinik ditulis backend (SQL langsung). Akun admin baru dibuat lewat plugin `praktiqu-endpoint`. |
| Letak form FE | Halaman tersendiri (`/dashboard/klinik/baru`, `/dashboard/klinik/{id}/edit`), bukan modal |

## Konteks yang perlu diketahui pelaksana

- **Klinik = baris `wp_kc_clinics`** (tabel KiviCare). Model Prisma: `KcClinic`. Kolom:
  `id, name, email, telephone_no, specialties, address, city, state, country, postal_code,
  status, clinic_admin_id, clinic_logo, profile_image, extra, country_code, created_at,
  country_calling_code, google_map_url`. Status: `1` aktif, `0` nonaktif.
- Tabel `clinics` (camelCase, tanpa prefix `wp_`) adalah **shadow table lama**. Jangan disentuh.
  Lihat `docs/architecture/shadow-tables-audit.md`.
- `DATABASE_URL` **adalah** database WordPress. Jangan pernah `prisma db push` atau
  `prisma migrate dev`. Fitur ini tidak butuh tabel atau kolom baru.
- KiviCare **tidak** memasang listener untuk hook klinik, jadi menulis `wp_kc_clinics` langsung
  dengan SQL aman (alasan yang sama dipakai `updatePractice`). Lihat komentar di
  `src/services/practice/service.ts` dan `src/repositories/wp/clinics.repo.ts`.
- Akun WordPress **tidak boleh** dibuat dengan insert langsung ke `wp_users`. Cara itu
  menghasilkan hash `!disabled-…` sehingga akun tidak bisa login (insiden resepsionis, lihat
  header `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-receptionists.php`).
  Akun dibuat lewat plugin dengan `wp_insert_user`.
- Rujukan KiviCare asli untuk membuat klinik + admin:
  `Wordpress-Plugin/kivicare-pro/app/controllers/api/KCProClinicController.php::createClinic`.
  Alurnya: tolak email klinik yang sudah dipakai (409) → tolak email admin yang sudah dipakai
  (409) → buat klinik → buat user lewat model `KCClinicAdmin` (role `kiviCare_clinic_admin`)
  → isi `clinic_admin_id` → kirim email template `kiviCare_clinic_admin_registration` →
  `do_action('kcpro_clinic_save', …)` dan `do_action('kivicare_clinic_admin_registered', …)`.
- **Link booking publik** sebuah klinik adalah `/{slug}` dengan
  `slug = slugify(nama klinik)`. FE: `BookingApi::slugify()`; backend punya padanan persis:
  `slugifyName()` di `src/lib/public/professional-slug.ts`. FE mencari klinik dulu (id persis,
  lalu slug nama), baru psikolog (`psikologDariTautan`). Artinya:
  - Mengganti nama klinik **mengganti linknya**. Link lama jadi 404.
  - Dua klinik dengan slug sama: yang id-nya lebih kecil menang, yang lain tidak terjangkau.
  - Klinik yang slug-nya sama dengan link pribadi psikolog **menutupi** link psikolog itu.
  - Slug yang seluruhnya angka bisa tertukar dengan id klinik lain.
  - Kata-kata berikut dipakai route FE dan tidak boleh jadi slug: `admin, klinik, psikolog,
    login, logout, booking, staff, doctor, pasien, cek-hasil, up, forgot-password,
    reset-password, lupa-sandi, atur-ulang-sandi` (regex `{tenant}` di `routes/web.php` FE).
- Pemilik klinik ditentukan `wp_kc_clinics.clinic_admin_id`. Satu admin boleh memegang
  beberapa klinik (fitur multi-klinik, spec `2026-10-13-admin-multi-klinik-design.md`).
  Halaman FE "Admin klinik ›" (`/dashboard/klinik/{id}/admin`) dan
  `POST /practices/:id/change-admin` sudah live untuk mengganti admin.

## Desain

### 1. Plugin `praktiqu-endpoint` 1.8.0: `POST /praktiqu/v1/clinic-admins`

Kelas baru `includes/class-praktiqu-endpoint-clinic-admins.php` (`final class ClinicAdmins`),
didaftarkan di `class-praktiqu-endpoint-rest-controller.php` seperti `Receptionists`, dengan
otentikasi yang sama (secret header plugin).

**Request**
```json
{ "name": "Dewi Lestari", "email": "dewi@contoh.id", "clinic_id": 57 }
```

**Perilaku**, berurutan:
1. `email` wajib dan valid, kalau tidak 400 `praktiqu_invalid_email`. Sudah terdaftar: 409
   `praktiqu_email_taken`.
2. `name` wajib (setelah `sanitize_text_field`, tidak kosong), kalau tidak 400
   `praktiqu_invalid_name`.
3. `clinic_id` harus baris `wp_kc_clinics` yang ada **dan** `clinic_admin_id`-nya `0`. Kalau
   tidak ada: 404 `praktiqu_clinic_not_found`. Kalau sudah punya admin: 409
   `praktiqu_clinic_has_admin`. Ini mencegah endpoint dipakai untuk merebut klinik lain.
4. Buat user dengan `wp_insert_user`: `user_login` unik dari bagian depan email (pola
   `unique_username()` resepsionis), kata sandi `wp_generate_password(12, true)`,
   `first_name`/`last_name` dipecah dari `name` (sisa kosong → `-`), `display_name = name`,
   role `kiviCare_clinic_admin`. Lalu `(new \WP_User($id))->set_role('kiviCare_clinic_admin')`.
   - Kalau kelas `\App\models\KCClinicAdmin` tersedia, boleh dipakai sebagai gantinya supaya
     meta KiviCare (`basic_data`, dll.) ikut terisi. Pilih **salah satu**, jangan keduanya.
     Kalau ragu, pakai `wp_insert_user` (sudah terbukti di resepsionis).
5. `UPDATE wp_kc_clinics SET clinic_admin_id = <user id> WHERE id = <clinic_id> AND
   clinic_admin_id = 0` lewat `$wpdb->update`. Kalau 0 baris berubah (ada balapan), hapus user
   yang baru dibuat (`wp_delete_user`) dan balas 409 `praktiqu_clinic_has_admin`.
6. Kirim email selamat datang berisi username dan kata sandi:
   - Kalau `\App\emails\KCEmailSender` ada: `sendEmailByTemplate('kiviCare_clinic_admin_registration',
     $email, $data)` dengan kunci data sama seperti `sendClinicAdminRegistrationEmail()` di
     `KCProClinicController` (`user_name, user_email, user_password, user_role, clinic_name,
     clinic_email, clinic_contact_number, clinic_address, first_name, last_name, display_name`).
   - Kalau kelas itu tidak ada: `wp_new_user_notification($id, null, 'user')` (email link atur
     kata sandi bawaan WordPress).
   - Gagal kirim email **tidak** menggagalkan request. Catat ke `error_log`, dan kembalikan
     `email_sent: false`.
7. `do_action('kivicare_clinic_admin_registered', $data)` (SMS KiviCare Pro, kalau aktif).
   **Jangan** memicu `kcpro_clinic_save`, karena listener-nya mengirim email "user baru" ke
   admin situs dan bukan bagian alur ini.

**Respons 201**
```json
{ "id": 912, "email": "dewi@contoh.id", "username": "dewi", "clinic_id": 57, "email_sent": true }
```
Kata sandi **tidak** ikut dikembalikan (beda dengan resepsionis). Backend tidak butuh, dan
log respons tidak boleh memuatnya.

**Versi**: naikkan header `Version:` dan konstanta `PRAKTIQU_ENDPOINT_VERSION` ke `1.8.0`,
tambahkan entri changelog di `readme.txt`. Uji sintaks dengan `php -l` (lihat catatan Docker di
memori `docker-mysql-and-wsl-gotchas`). Tambahkan tes PHP di `tests/` mengikuti pola
`test-clinic-payment-settings-rest.php`, minimal untuk validasi input (400/404/409).

### 2. Backend

#### 2a. Repository: `src/repositories/wp/clinics.repo.ts`

Tambahkan:
- `insertClinic(input: InsertClinicInput): Promise<bigint>` — `INSERT INTO wp_kc_clinics`
  dalam `prisma.$transaction` interaktif, lalu `SELECT LAST_INSERT_ID()` di koneksi transaksi
  yang sama. **Wajib** pakai helper bersama `lastInsertId(tx)` dari `src/lib/last-insert-id.ts`
  (ada tes invarian yang gagal kalau `LAST_INSERT_ID()` ditulis langsung).
  Kolom yang diisi: `name, email, telephone_no, address, city, state, country, postal_code,
  country_code, country_calling_code, status, clinic_admin_id, specialties ('[]'),
  clinic_logo (0), profile_image (NULL), extra (NULL atau JSON timezone), created_at (NOW())`.
  Nilai kosong ditulis `''` untuk kolom teks yang `NOT NULL` (cek definisi kolom di DB tes).
- `setClinicAdmin(id: bigint, adminId: bigint)` — dipindah dari SQL inline di
  `changePracticeAdmin` supaya dipakai bersama.
- `findClinicsByEmail(email)` dan `listClinicNames()` (id + nama semua klinik, termasuk
  nonaktif) untuk cek bentrok.
- `countClinicReferences(id: bigint): Promise<ClinicReferenceCounts>` — satu query `SELECT`
  dengan subquery `COUNT(*)` per tabel di bawah, mengembalikan objek berkunci nama ramah.
- `deleteClinicRow(id: bigint)` — menghapus baris klinik beserta data milik klinik yang tidak
  bermakna tanpa kliniknya (lihat 2d). Tanpa transaksi: tabel produksi MyISAM, jadi baris
  klinik dihapus **paling akhir** supaya kegagalan di tengah bisa diulang.

Tabel yang dihitung `countClinicReferences` (semua kolom `clinic_id`, kecuali disebut lain):

| Kunci | Tabel |
|---|---|
| `appointments` | `wp_kc_appointments` |
| `bills` | `wp_kc_bills` |
| `encounters` | `wp_kc_patient_encounters` |
| `doctors` | `wp_kc_doctor_clinic_mappings` |
| `patients` | `wp_kc_patient_clinic_mappings` |
| `receptionists` | `wp_kc_receptionist_clinic_mappings` |
| `sessions` | `wp_kc_clinic_sessions` |
| `services` | `wp_kc_service_doctor_mapping` |
| `followups` | `wp_kc_followups` |
| `followupChains` | `wp_kc_followup_chains` |
| `taxes` | `wp_kc_taxes` |
| `notifications` | `wp_kc_custom_notifications` |

Daftar ini diambil dari `information_schema` DB tes pada 2026-10-15. Pelaksana **wajib**
menjalankan ulang query berikut di DB tes sebelum menulis kode, dan menambahkan tabel `wp_kc_*`
baru yang muncul:
```sql
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name LIKE 'wp\_kc\_%'
   AND column_name = 'clinic_id';
```

#### 2b. Validasi dan tipe: `src/types/practice.ts`

`practiceCreateSchema` (zod):
- Field klinik sama seperti `practiceUpdateSchema`, tetapi `name` **wajib** (trim, 1–120).
- `status`: `0 | 1`, bawaan `1`.
- `admin`: discriminated union pada `mode`:
  - `{ mode: 'existing', wpUserId: number }` (bilangan bulat positif)
  - `{ mode: 'new', name: string (1–120), email: string (email) }`
  - `{ mode: 'none' }`
  - Tidak dikirim = `{ mode: 'none' }`.

`practiceUpdateSchema` tetap. Larangan `status` untuk admin klinik dicek di route (2e), bukan
di schema, karena super admin tetap boleh.

#### 2c. Cek bentrok: `src/services/practice/clinic-slug.ts` (baru)

`assertClinicNameAvailable(name: string, opts: { exceptId?: number })` melempar
`ClinicNameConflictError` dengan `reason`:
- `empty_slug`: `slugifyName(name)` kosong (nama hanya simbol/huruf non-Latin).
- `numeric_slug`: slug seluruhnya angka.
- `reserved_slug`: slug ada di daftar kata route FE (lihat Konteks).
- `clinic_slug_taken`: slug sama dengan slug klinik lain (aktif **maupun** nonaktif, kecuali
  `exceptId`). Sertakan `conflictId` dan `conflictName`.
- `professional_slug_taken`: slug sama dengan link pribadi psikolog aktif. Pakai fungsi
  pencocokan yang sama dengan `public-catalog.service.ts` (`slugifyName(publicFullName(d))`).

`assertClinicEmailAvailable(email, { exceptId })`: email klinik (kalau diisi) tidak boleh
sama dengan klinik lain, case-insensitive. Melempar `ClinicEmailConflictError`. Ini meniru
KiviCare (`createClinic` menolak email klinik ganda).

Untuk `PATCH`, kedua cek hanya dijalankan kalau `name` / `email` ikut dikirim **dan** berubah.

#### 2d. Service: `src/services/practice/service.ts`

**`createPractice(input: unknown, ctx: { actorId: string }): Promise<CreatePracticeResult>`**
1. Parse `practiceCreateSchema`, gagal → `PracticeValidationError` (422).
2. `assertClinicNameAvailable`, `assertClinicEmailAvailable` → 409.
3. Admin:
   - `existing`: `isClinicAdminUser(wpUserId)` harus true, kalau tidak `NotAClinicAdminError`
     (422, sudah ada).
   - `new`: cek `wp_users.user_email` belum dipakai (409 `admin_email_taken`) **sebelum**
     menulis apa pun.
4. `insertClinic` dengan `clinic_admin_id` = `wpUserId` (mode existing) atau `0`.
5. Mode `new`: panggil `createClinicAdminViaPlugin({ name, email, clinicId })`
   (`src/repositories/wp/clinic-admins.write.ts`, baru, meniru `receptionists.write.ts`).
   - Gagal (`WpEndpointError` apa pun, termasuk timeout): **hapus lagi** baris klinik yang baru
     dibuat dengan `deleteClinicRow` (klinik itu pasti kosong), lalu lempar ulang sebagai
     `KcError` dengan status plugin (409 tetap 409, lainnya 502). Kalau penghapusan ikut gagal,
     catat `logging.error` dengan id klinik supaya bisa dibersihkan manual, dan tetap balas
     error aslinya.
6. `logging.audit('practice.create', { userId: ctx.actorId, resource: 'clinic',
   resourceId, metadata: { adminMode, adminId } })`. `userId` adalah `users.id` (cuid) pemanggil,
   bukan id WordPress (lihat komentar di `changePracticeAdmin`).
7. Kembalikan `{ practice: PracticeDTO, admin: { mode, wpUserId: number | null, emailSent:
   boolean | null } }`.

**`setPracticeStatus(id, status, ctx)`**: menggantikan pemakaian `updatePractice(id, { status: 0 })`
di route `DELETE`. Audit `practice.deactivate` / `practice.activate`.

**`deletePracticePermanently(id, ctx)`**
1. Klinik harus ada (404).
2. `countClinicReferences`. Ada yang > 0 → `ClinicNotEmptyError` membawa objek hitungan (409).
3. `deleteClinicRow` menghapus, berurutan (baris klinik paling akhir):
   - `wp_kc_clinic_schedule` dengan `module_type = OFF_DAY_MODULE.CLINIC` (nilainya `'clinic'`, dari
     `src/repositories/wp/off-days.repo.ts`) `AND module_id = id` (libur klinik),
   - `wp_options` dengan `option_name = clinicPaymentOptionName(id)`
     (`src/repositories/wp/clinic-payment-settings.repo.ts`),
   - baris `wp_kc_clinics` itu sendiri.
   Akun admin **tidak** dihapus.
4. Audit `practice.delete` dengan metadata nama dan `clinic_admin_id` lama.

**`updatePractice`**: tambahkan cek nama/email (2c) sebelum menulis, dan audit dengan
`ctx.actorId` yang benar (saat ini route mengirim `actorId: null`).

#### 2e. Route

| Method & path | Role | Perilaku |
|---|---|---|
| `POST /api/v1/practices` | `SUPER_ADMIN` | `createPractice`. 201 `{ data: PracticeDTO, admin: {...} }` |
| `PATCH /api/v1/practices/:id` | `SUPER_ADMIN`, `CLINIC_ADMIN` (scope) | Kalau aktor `CLINIC_ADMIN` dan body memuat `status` → 403 `/errors/forbidden` detail `status_change_forbidden`. Selebihnya seperti sekarang. |
| `DELETE /api/v1/practices/:id` | `SUPER_ADMIN` | Tanpa query: nonaktifkan, 204. |
| `DELETE /api/v1/practices/:id?permanent=true` | `SUPER_ADMIN` | `deletePracticePermanently`. 204, atau 409 berisi hitungan. |
| `POST /api/v1/practices/:id/activate` | `SUPER_ADMIN` | Aktifkan kembali, 200 `{ data: PracticeDTO }`. |
| `POST /api/v1/practices/bulk/status`, `bulk/delete` | `SUPER_ADMIN` | Tidak berubah (sudah khusus super admin, dicek 2026-10-15). |

Endpoint `activate` terpisah (bukan `PATCH status`) supaya FE punya aksi yang jelas dan route
`PATCH` tidak perlu tahu perbedaan role untuk satu field. `PATCH` dengan `status` oleh super
admin tetap diizinkan demi kompatibilitas.

Bentuk error mengikuti RFC 7807 yang dipakai route lain (`type`, `title`, `status`, `detail`),
ditambah field **`code`** (slug stabil yang dicocokkan FE). Pemetaannya satu tempat:
`src/lib/practice-problems.ts`.

| Kasus | Status | `code` | Tambahan |
|---|---|---|---|
| Validasi zod | 422 | `validation_error` | `issues[]` |
| Nama/slug bentrok | 409 | `clinic_name_conflict` | `reason`, `slug`, `conflictId?`, `conflictName?` |
| Email klinik dipakai | 409 | `clinic_email_conflict` | `conflictId` |
| Email admin dipakai | 409 | `admin_email_taken` | — |
| Bukan clinic admin (mode existing) | 422 | `not_a_clinic_admin` | — |
| Klinik tidak kosong | 409 | `clinic_not_empty` | `counts` (hanya kunci > 0) |
| Plugin gagal | 502 | `admin_provision_failed` | `detail` dari plugin |
| Admin klinik ubah status | 403 | `status_change_forbidden` | — |
| Klinik tidak ada / di luar scope | 404 | `practice_not_found` | — |

Hapus komentar "stub — actual creation deferred to WP-side provisioning" di
`practices/route.ts`, dan perbarui `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (kontrak
/api/v1 yang sebenarnya; `openapi.yaml` adalah spec plugin KiviCare, jangan diubah).

### 3. FE Laravel

#### 3a. Route (`routes/web.php`, di dalam grup `['staff:any', 'klinik.halaman']`)

| Route | Nama | Akses |
|---|---|---|
| `GET /dashboard/klinik/baru` | `klinik.baru` | super |
| `POST /dashboard/klinik` | `klinik.simpan` | super |
| `GET /dashboard/klinik/{id}/edit` | `klinik.edit` | super; admin untuk klinik aktifnya sendiri |
| `POST /dashboard/klinik/{id}` | `klinik.ubah` | sama dengan edit |
| `POST /dashboard/klinik/{id}/status` | `klinik.status` | super (`aksi=nonaktifkan|aktifkan`) |
| `POST /dashboard/klinik/{id}/hapus` | `klinik.hapus` | super |

Semua `{id}` memakai `->whereNumber('id')`. Akses yang ditolak dijawab `abort(404)` seperti
`KlinikAdminController`. Untuk admin klinik, id harus sama dengan `practiceId` di profil sesi
(klinik aktif).

#### 3b. Controller: `app/Http/Controllers/KlinikController.php` (baru)

Pola mengikuti `KlinikAdminController` dan `KlinikPembayaranController`: `PraktiquApi` di-inject,
error API (`ApiException`) diubah jadi `withErrors` per kolom + pesan umum, redirect balik dengan
input lama (`withInput`).

- `baru()`: ambil `GET api/v1/practices/clinic-admins` untuk dropdown admin. Kalau gagal, form
  tetap tampil tanpa opsi "pilih admin yang ada" dan dengan pesan kecil.
- `simpan()`: validasi Laravel ringan (nama wajib, email format), susun body `POST
  api/v1/practices` (lihat 2b), lalu:
  - 201 → `Cache::forget('pq_public_practices')`, `Cache::forget('pq_tenant_miss:'.$slug)`,
    redirect ke dashboard tab Clinics dengan flash sukses. Mode `new` dengan
    `emailSent=false`: flash peringatan "Klinik dibuat, tetapi email kata sandi gagal dikirim.
    Minta admin memakai Lupa sandi."
  - 409 `clinic-name-conflict` → error di kolom `name`, kalimat per `reason` (lihat 3d).
  - 409 `clinic-email-conflict` → error di kolom `email`.
  - 409 `admin-email-taken` → error di kolom `admin_email`.
  - 422 → peta `issues[].path` ke kolom.
- `edit()`: `GET api/v1/practices/{id}`. 404 → `abort(404)`.
- `ubah()`: `PATCH api/v1/practices/{id}` hanya dengan field yang berubah. Admin klinik tidak
  pernah mengirim `status`. Sukses → buang cache yang sama + `pq_tenant_miss` untuk slug baru.
- `status()`: nonaktifkan = `DELETE api/v1/practices/{id}`, aktifkan =
  `POST api/v1/practices/{id}/activate`. Buang cache publik.
- `hapus()`: wajib field `konfirmasi_nama` sama persis dengan nama klinik (cek di controller
  dengan nama dari `GET` terbaru). `DELETE api/v1/practices/{id}?permanent=true`.
  - 204 → redirect ke tab Clinics, flash "Klinik X dihapus permanen."
  - 409 `clinic-not-empty` → kembali ke halaman edit dengan pesan berisi hitungan, misalnya
    "Tidak bisa dihapus: 12 appointment, 3 psikolog. Nonaktifkan saja." (label per kunci di 3d).

Dashboard memuat ulang daftar klinik setiap request (tidak ada cache sesi untuk `practices`),
jadi setelah redirect klinik baru langsung tampil. Pastikan ini benar saat implementasi; kalau
ternyata ada cache, buang juga.

#### 3c. View

`resources/views/dashboard/klinik-form.blade.php` (satu view untuk baru dan edit), gaya visual
sama dengan `klinik-admin.blade.php` (layout, kartu, tombol, warna `#425FAD`).

Isi:
- **Data klinik**: Nama*, Email, Telepon, Alamat, Kota, Provinsi, Negara, Kode pos.
- **Pratinjau link**: di bawah Nama, teks `appointment.praktiqu.com/<slug>` yang diperbarui
  saat mengetik (Alpine, fungsi slugify yang sama dengan `BookingApi::slugify`). Domain
  diambil dari `config('app.url')`, bukan ditulis mati.
- **Mode edit + nama berubah sehingga slug berubah**: kotak peringatan kuning "Link booking akan
  berubah dari /lama ke /baru. Link lama tidak berlaku lagi, termasuk yang sudah dibagikan ke
  pasien."
- **Admin klinik** (hanya mode baru): tiga radio.
  - "Pilih admin yang sudah ada" → `<select>` nama + email, dengan keterangan jumlah klinik
    yang sudah dipegang ("memegang 2 klinik").
  - "Buat akun admin baru" → Nama admin*, Email admin*, catatan "Kata sandi dikirim ke email
    ini."
  - "Atur nanti" (bawaan) → catatan "Bisa diatur lewat Admin klinik › setelah klinik dibuat."
- **Zona berbahaya** (hanya mode edit, hanya super admin), kotak berbingkai merah:
  - Klinik aktif: tombol "Nonaktifkan klinik" + `confirm()` "Klinik tidak akan muncul di
    booking publik. Data tetap tersimpan dan bisa diaktifkan lagi."
  - Klinik nonaktif: tombol "Aktifkan kembali".
  - "Hapus permanen": input ketik nama klinik + tombol yang aktif hanya bila sama persis.
    Keterangan: "Hanya untuk klinik yang belum punya data sama sekali."

#### 3d. Teks pesan (Bahasa Indonesia)

| Kode | Teks |
|---|---|
| `empty_slug` | Nama klinik harus memuat huruf atau angka latin. |
| `numeric_slug` | Nama klinik tidak boleh hanya angka. |
| `reserved_slug` | Nama ini dipakai sistem untuk alamat halaman. Pilih nama lain. |
| `clinic_slug_taken` | Link /:slug sudah dipakai klinik ":nama". Bedakan namanya. |
| `professional_slug_taken` | Link /:slug sudah dipakai halaman pribadi seorang psikolog. Bedakan namanya. |
| email klinik | Email ini sudah dipakai klinik lain. |
| email admin | Email ini sudah terdaftar. Pilih "Pilih admin yang sudah ada" kalau orangnya sama. |

Label hitungan `clinic-not-empty`: `appointments` appointment, `bills` tagihan, `encounters`
encounter, `doctors` psikolog, `patients` pasien, `receptionists` resepsionis, `sessions` sesi
jadwal, `services` layanan, `followups` follow-up, `followupChains` rangkaian follow-up,
`taxes` pajak, `notifications` notifikasi.

#### 3e. Tab Clinics (`resources/views/dashboard.blade.php`)

- Ganti tulisan "Klinik baru dibuat lewat WordPress/KiviCare…" dengan tombol
  `<a class="btn-red" href="/dashboard/klinik/baru">Add Clinic</a>` (super admin saja, di
  dalam `@if (($role ?? null) === 'super')`). Admin klinik tidak melihat tombol maupun tulisan.
- Filter status di samping kotak cari: Semua / Aktif / Nonaktif (state Alpine baru,
  getter baru `fClinicsTab`; `fClinics` tetap dipakai pemilih klinik di tab Services).
  Bawaan: Semua.
- Di setiap kartu (super admin) tambahkan tautan "Edit ›" (gaya sama dengan "Admin klinik ›").
- Menu role `admin` **tidak punya tab Clinics**, jadi pintu edit admin klinik adalah kartu
  **"Profil Klinik"** di tab Settings (pola kartu "Pembayaran Internasional"), lewat
  `$editKlinikUrl` dari `DashboardController::render()`.
- Setelah redirect dengan flash `klinikPesan`/`klinikPeringatan`, dashboard super admin terbuka
  langsung di tab Clinics.
- Flash sukses/peringatan dari 3b tampil di atas grid.
- Komentar di `ResourceController.php` yang menjelaskan `'clinics'` dicabut diperbarui: aksi
  klinik kini lewat `KlinikController`, allowlist tetap tanpa `'clinics'`.

### 4. Pengujian

**Plugin** (`Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-admins.php`): validasi input
(400 email/nama, 404 klinik tidak ada, 409 email dipakai, 409 klinik sudah punya admin). `php -l`
untuk semua file yang berubah.

**Backend** (vitest, DB tes `wordpress-praktiqu-test`; pola
`tests/integration/practice/change-admin.test.ts`, perhatikan urutan argumen helper `token(sub,
role)`):
- `tests/integration/practice/practice-create.test.ts`
  - super admin, mode `none` → 201, baris ada, `clinic_admin_id = 0`, status 1.
  - mode `existing` dengan clinic admin sungguhan → `clinic_admin_id` terisi.
  - mode `existing` dengan user bukan clinic admin → 422.
  - mode `new` dengan plugin di-mock sukses → 201, `emailSent` diteruskan.
  - mode `new` dengan plugin di-mock gagal 502 → error, dan **baris klinik tidak tersisa**.
  - mode `new` dengan email admin sudah ada → 409 dan tidak ada baris klinik baru.
  - nama bentrok dengan klinik lain / psikolog / kata route / hanya angka / hanya simbol → 409
    dengan `reason` yang benar.
  - email klinik ganda → 409.
  - `CLINIC_ADMIN` → 403.
- `tests/integration/practice/practice-status.test.ts`
  - `CLINIC_ADMIN` `PATCH { status: 0 }` kliniknya sendiri → 403, status tidak berubah.
  - `CLINIC_ADMIN` `PATCH { name }` kliniknya sendiri → 200.
  - `CLINIC_ADMIN` `DELETE` → 403.
  - super admin `DELETE` → 204, status 0; `POST /activate` → 200, status 1.
- `tests/integration/practice/practice-delete-permanent.test.ts`
  - klinik kosong (+ satu libur + satu option pembayaran) → 204, ketiganya hilang.
  - klinik dengan satu mapping dokter → 409, `counts.doctors = 1`, baris tetap ada.
  - id tidak ada → 404.
- Unit `tests/unit/practice/clinic-slug.test.ts` untuk `assertClinicNameAvailable`.
- Seluruh suite + `npx tsc --noEmit` harus hijau.

**FE** (`tests/Feature/KlinikTambahTest.php`, `KlinikUbahTest.php`, `KlinikStatusHapusTest.php`,
`KlinikTabTest.php`; pola `AdminKlinikSuperTest.php` dengan
`Http::fake`):
- super melihat `/dashboard/klinik/baru`; admin dan psikolog 404.
- simpan memetakan 409 `clinic-name-conflict` ke error kolom `name`.
- simpan sukses membuang cache `pq_public_practices` dan redirect dengan flash.
- admin klinik bisa membuka edit kliniknya sendiri, 404 untuk klinik lain, dan form-nya tidak
  memuat zona berbahaya.
- hapus dengan `konfirmasi_nama` salah tidak memanggil API.
- hapus 409 menampilkan kalimat hitungan.
- tab Clinics: tombol Add Clinic hanya untuk super.
- Lalu smoke test di browser lokal (memori `fe-local-browser-smoke-test`).

### 5. Rilis

Urutan wajib: **plugin → backend → FE**. Kalau backend lebih dulu, mode "buat admin baru"
gagal 404 dari plugin (klinik yang dibuat tetap dihapus lagi, jadi aman, tetapi fiturnya
belum jalan).

1. Plugin 1.8.0 ke WordPress Hostinger (`api-appointment.praktiqu.com`), cara yang sama
   dengan rilis 1.7.0. Verifikasi `POST /praktiqu/v1/clinic-admins` tanpa secret → 401/403.
2. Merge PR backend → auto-deploy Hostinger. Cek `console.log` setelah restart.
3. Merge PR FE → GitHub Actions deploy.
4. Uji coba oleh user di produksi: buat klinik uji mode "Atur nanti", edit namanya, nonaktifkan,
   aktifkan, lalu hapus permanen. Klinik dengan mode "buat admin baru" diuji dengan email milik
   user sendiri, lalu klinik dan akunnya dibersihkan.

## Di luar cakupan

- Upload logo/foto klinik (`clinic_logo`, `profile_image`). Kartu sekarang memakai foto
  pemilik; mengunggah gambar butuh alur media terpisah.
- Spesialisasi klinik (`specialties`), `google_map_url`, jam operasional (`extra.businessHours`).
- Redirect otomatis dari slug lama ke slug baru saat nama diganti. Bisa memakai fitur
  aturan redirect FE (`feat/aturan-redirect`) secara manual.
- Menghapus akun admin klinik bersama kliniknya.
- Admin klinik membuat klinik sendiri.
