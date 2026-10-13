# Admin Klinik Multi-Klinik ("Klinik Aktif") — Desain

**Tanggal:** 2026-10-13
**Status:** Disetujui per bagian oleh user (2026-10-13). Menunggu review spec tertulis.
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu` (branch `feat/multi-klinik`, dari `origin/main` 82d17ce)
- FE Laravel `raakanaka/laravel-praktiqu` (branch baru dari `main`, hanya lewat PR)
- Plugin WordPress `praktiqu-endpoint`: **tidak berubah**

## Masalah

Seorang admin klinik (role `CLINIC_ADMIN`) hanya bisa memegang satu klinik. Bisnis ingin
satu admin memegang beberapa klinik, tetapi tetap jauh di bawah super admin: ia hanya
melihat dan mengelola klinik yang memang miliknya.

Hari ini satu user yang tercatat di dua klinik **diam-diam hanya melihat satu**:

- `src/services/billing/kc-actor.ts` `resolveClinicId()` memilih **satu** klinik dengan
  `findFirst` tanpa `orderBy`:
  - CLINIC_ADMIN: mapping dokter pertama (`wp_kc_doctor_clinic_mappings`). Kalau tidak ada,
    klinik pertama dengan `wp_kc_clinics.clinic_admin_id = wpUserId`.
  - RECEPTIONIST: mapping resepsionis pertama.
  - PROFESSIONAL: mapping dokter pertama.
- `KcActor.clinicId` dipakai di 146 tempat (94 file) untuk men-scope daftar, single read,
  dan target tulis. Akses di luar scope dijawab 404 (konvensi repo).
- `/auth/me` hanya mengirim satu `clinicId`; FE menyimpannya sebagai satu `practiceId`.
- Super admin tidak punya cara menugaskan klinik ke admin. Endpoint
  `POST /practices/:id/change-admin` ada tetapi **rusak**: ia mencari user berdasarkan cuid
  lalu menulis `Number(cuid)` (= `NaN`) ke `clinic_admin_id`.

## Tujuan

1. Admin klinik punya daftar klinik miliknya dan memilih **satu klinik aktif** lewat dropdown
   di dashboard.
2. Semua halaman dashboard hanya menampilkan dan menulis ke klinik aktif.
3. Backend memvalidasi di setiap request bahwa klinik aktif memang milik admin itu.
4. Super admin bisa menugaskan klinik ke admin dari FE.
5. Tidak ada tabel/kolom baru, tidak ada perubahan plugin, tidak ada staf yang ter-logout
   paksa saat rilis.

## Bukan tujuan

- Resepsionis dan psikolog **tidak** mendapat switcher. Perilaku mereka tidak berubah.
- Satu klinik tetap punya **satu** admin (`clinic_admin_id` satu kolom).
- Membuat akun admin baru tetap lewat KiviCare/WordPress.
- Pilihan klinik **tidak** diingat antar-login.
- Memperbaiki kebocoran scope yang sudah ada (lihat "Di luar cakupan"). Itu tugas terpisah.

## Keputusan (diambil user saat brainstorming 2026-10-13)

| # | Pertanyaan | Keputusan | Alasan |
|---|---|---|---|
| D1 | Role mana yang dapat switcher? | **Hanya CLINIC_ADMIN** | Pilihan user. |
| D2 | Sumber daftar klinik admin | **`wp_kc_clinics.clinic_admin_id`**; mapping dokter hanya cadangan kalau admin tidak memiliki klinik sama sekali | Definisi KiviCare sendiri; paling ketat: menjadi psikolog di klinik X tidak memberi hak admin di X. Cadangan menjaga akun lama tetap punya akses. |
| D3 | Cara menugaskan klinik | **Perbaiki `change-admin` + halaman super admin di FE** | Super admin bisa melakukannya sendiri. |
| D4 | Default & persistensi | **Per sesi; default = klinik milik admin yang aktif dengan id terkecil** | Tanpa penyimpanan tambahan. Login ulang kembali ke default. |
| D5 | Cara FE mengirim klinik aktif | **Header `X-Praktiqu-Clinic-Id`, divalidasi di `getActor()`** | Satu titik di FE (`PraktiquApi::dispatch`) dan satu titik di BE (`getActor`); 146 pemanggil `resolveKcActor` ikut tanpa diubah. JWT claim ditolak karena refresh token opaque dan berotasi (klaim hilang tanpa kolom baru). Query param ditolak karena `clinicId` sudah berarti "filter super admin" di banyak route. |

## Desain

### Gambaran alur

```
Login ─► /auth/me ─► user.clinicId (default) + user.clinics [{id,name,active}]
                         │
FE sesi pq_profile: practiceId = clinicId, clinics = [...]
                         │
Dropdown ─► POST /dashboard/klinik-aktif ─► pq_profile.practiceId = pilihan
                         │
Setiap request FE ─► PraktiquApi::dispatch() + header X-Praktiqu-Clinic-Id: <practiceId>
                         │
BE getActor(req): role CLINIC_ADMIN? header ada? ─► milik admin? ─ ya ─► actor.activeClinicId
                         │                                       └ tidak ─► 403 clinic_not_in_scope
resolveKcActor(actor) ─► clinicId = actor.activeClinicId ?? default
                         │
146 pemanggil (scope daftar, assertPracticeInScope, billScopeFor, …) ikut otomatis
```

### B1. Daftar klinik milik admin (`src/services/billing/kc-actor.ts`)

Fungsi baru `listAdminClinicIds(wpUserId: bigint): Promise<bigint[]>`:

1. Ambil `wp_kc_clinics` dengan `clinic_admin_id = wpUserId`, urut `id` naik.
2. Susun ulang: klinik `status = 1` dulu (urutan id tetap), lalu klinik nonaktif.
3. Kalau hasil langkah 1 kosong: ambil `clinic_id` dari `wp_kc_doctor_clinic_mappings`
   dengan `doctor_id = wpUserId`, urut `id` mapping naik, buang duplikat. Ini cadangan.
4. Kembalikan daftar (boleh kosong).

`resolveClinicId('CLINIC_ADMIN', wpUserId)` = elemen pertama `listAdminClinicIds`, atau `null`.

RECEPTIONIST dan PROFESSIONAL: logika tetap, hanya `findFirst` diberi `orderBy: { id: 'asc' }`
supaya "pertama" pasti. Dalam praktik urutannya sama dengan sekarang (InnoDB).

> **Perubahan perilaku:** admin yang memiliki klinik A **dan** punya mapping dokter ke klinik B
> hari ini mendapat B; setelah fitur ini mendapat A. Lihat "Gerbang data" di urutan rilis.

Fungsi kedua `listAdminClinics(wpUserId)` mengembalikan `{ id, name, active }[]` dengan urutan
yang **sama persis** dengan `listAdminClinicIds` (dipakai `/auth/me`). Default `clinicId` di
`/auth/me` harus selalu sama dengan `clinics[0].id`.

### B2. Header klinik aktif di `getActor()` (`src/lib/auth.ts`)

- `Actor` mendapat field opsional `activeClinicId?: bigint`. **Hanya `getActor` yang boleh
  mengisinya** (field ini berarti "sudah divalidasi").
- Nama header: `X-Praktiqu-Clinic-Id` (HTTP header tidak peka huruf besar/kecil).
- Aturan, setelah JWT terverifikasi:
  1. Role bukan `CLINIC_ADMIN` → header **diabaikan** (tidak ada error).
  2. Header tidak ada atau kosong → tidak ada `activeClinicId` (pakai default).
  3. Nilai tidak cocok `^[1-9][0-9]{0,18}$` → `AuthError('invalid_clinic_header', 400)`.
  4. Cari `users.wpUserId` untuk `actor.id`. Kalau null → `AuthError('clinic_not_in_scope', 403)`.
  5. `listAdminClinicIds(wpUserId)` tidak memuat nilai itu →
     `AuthError('clinic_not_in_scope', 403)`. Klinik yang tidak ada sama sekali mendapat
     jawaban yang sama (tidak membocorkan keberadaan klinik).
  6. Lolos → `actor.activeClinicId = BigInt(nilai)`.
- **Pesan `AuthError` = kode error itu sendiri** (`clinic_not_in_scope` /
  `invalid_clinic_header`), supaya kode itu muncul di body respons apa pun pembungkusnya.
  FE mendeteksinya dengan mencari string kode di body.
- `optionalActor()` (route publik) **tidak** membaca header ini.
- Logika validasi ditaruh di modul sendiri (mis. `src/lib/auth/active-clinic.ts`) yang
  dipanggil `getActor`, supaya bisa dites terpisah.

### B3. `resolveKcActor(actor)`

```
clinicId = actor.activeClinicId ?? await resolveClinicId(actor.role, wpUserId)
```

Kalau `activeClinicId` ada, lookup mapping dilewati. Tidak ada pemanggil yang diubah.

Yang otomatis ikut menyempit ke klinik aktif (contoh, bukan daftar lengkap):
`assertPracticeInScope` (`src/services/practice/service.ts:86`) termasuk
`/practices/:id/payment-settings`; `listPractices` (hanya klinik aktif); `billScopeFor`,
`taxScopeFor`, `encounterScopeFor`, `followupScopeFor`, `scheduleScopeFor`,
`dashboardScopeFor` (`kc-permissions.ts` dll.); daftar pasien; `route-scope.ts`
"berbagi klinik"; target tulis `kc.clinicId ?? input.clinicId`.

### B4. Pembungkus auth meneruskan status asli

Sekarang dua pembungkus mengubah setiap `AuthError` menjadi 401, yang membuat FE me-refresh
token lalu retry dengan sia-sia:

- `src/lib/auth/route-guards.ts` `requireRoles()` — status 401 di-hardcode.
- `src/lib/auth/caller.ts` `callerFromRequest()` — selalu `InterventionPlanError(..., 401)`.

Keduanya diubah supaya memakai `err.status` dan menyertakan `err.message`. Periksa juga
`src/lib/auth/session-notes-caller.ts`. `withAuth()` sudah benar (`{ error: err.message }`
dengan `err.status`).

### B5. `/auth/me`, login, register, OTP verify

`scopeClinicId()` di `src/services/auth/service.ts:266` diganti helper yang mengembalikan
`{ clinicId, clinics? }`:

- CLINIC_ADMIN: `clinics = listAdminClinics(wpUserId)`, `clinicId = clinics[0]?.id ?? null`.
- RECEPTIONIST: `clinicId` seperti sekarang; **tanpa** field `clinics`.
- Role lain: `clinicId: null`; **tanpa** field `clinics`.

Dipakai di keempat tempat yang sekarang memanggil `scopeClinicId`: login (`:250`),
`getMeFromAccessToken` (`:478`), register (`:777`), `src/services/auth/otp.service.ts:239`.

Bentuk `user` di respons menjadi:
```json
{ "user": { "...": "…", "clinicId": 4,
            "clinics": [ { "id": 4, "name": "Klinik A", "active": true },
                         { "id": 20, "name": "Klinik B", "active": true } ] } }
```

### B6. Akses pasien yang terdaftar di beberapa klinik

`enforceClientReadAccess` (`src/services/client/client.service.ts:212-219`) untuk
CLINIC_ADMIN/RECEPTIONIST membandingkan `patient.clinicId` (mapping **pertama** pasien, lihat
`patients.repo.ts:189`) dengan `kc.clinicId`. Pasien klinik A+B muncul di daftar klinik B
(daftar memakai `EXISTS`), tetapi dijawab 403 saat dibuka.

Ubah menjadi: pasien punya baris di `wp_kc_patient_clinic_mappings` dengan
`clinic_id = kc.clinicId` (raw SQL `SELECT 1 … LIMIT 1`, sama seperti `patients.repo.ts:255`).
Status error tetap 403 dengan kode `forbidden` supaya FE tidak berubah.

### B7. `POST /api/v1/practices/:id/change-admin` diperbaiki

File: `src/app/api/v1/practices/[id]/change-admin/route.ts`,
`src/services/practice/service.ts` `changePracticeAdmin`.

- Hanya SUPER_ADMIN (lainnya 403, seperti sekarang).
- `:id` harus bilangan bulat positif dan kliniknya ada → selain itu 404.
- Body: `{ "newAdminId": <wp_users.ID> }` — angka atau string angka. **Bukan cuid lagi.**
  Tidak valid → 422.
- User WP dengan ID itu harus ada **dan** punya capability `kiviCare_clinic_admin`.
  Pakai `HAS_ROLE_SQL` + `roleLikePattern(KIVICARE_ROLES.clinicAdmin)` dari
  `src/repositories/wp/wp-user.ts` (LIKE, bukan `unserialize` — ada baris capability yang
  serialisasinya rusak). Gagal → 422 kode `not_a_clinic_admin`.
- Kalau `newAdminId` sama dengan admin sekarang → 200 tanpa menulis dan tanpa audit
  (`unchanged: true`).
- Tulis: `UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`.
- Audit: `logging.audit('practice.admin_changed', { userId: actor.id, resource: 'clinic',
  resourceId: String(clinicId), metadata: { previousAdminId, newAdminId } })`.
  `userId` adalah cuid `users.id` (lihat komentar di `payment-settings.service.ts:248`).
- Respons 200:
  ```json
  { "message": "Practice admin updated",
    "data": { "clinicId": 20, "adminId": 911, "previousAdminId": 512,
              "previousAdminClinicCount": 0, "unchanged": false } }
  ```
  `previousAdminClinicCount` = jumlah klinik yang masih dimiliki admin lama **setelah**
  update (UI memakainya untuk peringatan).
- Admin lama kehilangan akses mulai request berikutnya (sesinya dapat 403
  `clinic_not_in_scope` → FE memaksa login ulang).

### B8. `GET /api/v1/practices/clinic-admins` (baru)

File baru: `src/app/api/v1/practices/clinic-admins/route.ts` (segmen statis menang atas
`[id]`).

- Hanya SUPER_ADMIN (lainnya 403).
- Sumber: `wp_users` dengan capability `kiviCare_clinic_admin` (bukan tabel `users`, karena
  admin yang baru dibuat di KiviCare belum punya baris `users` sampai login pertama).
- Respons:
  ```json
  { "data": [ { "wpUserId": 911, "name": "…", "email": "…", "clinicIds": [4, 20] } ],
    "total": 1 }
  ```
  `name` = `display_name`, cadangan `user_login`. `clinicIds` = klinik dengan
  `clinic_admin_id` = user itu, urut id naik. Daftar urut nama.

### F1. Profil sesi (`app/Http/Controllers/AuthController.php`)

- Kunci baru `clinics` di `pq_profile`: daftar `{id:int, name:string, active:bool}` dari
  `user.clinics`. Hanya diisi kalau backend mengirimnya (yaitu CLINIC_ADMIN). Nilai yang
  bentuknya tidak sah dibuang.
- `practiceId` tetap dari `clinicId` (sudah = `clinics[0].id`).
- **`PROFILE_VERSION` tetap 5.** Sesi lama tanpa `clinics` tetap sah; dropdown baru muncul
  setelah login berikutnya. Tes `KelolaPembayaranLoginTest` yang mengunci versi 5 tetap hijau.
- `login()` menghapus `pq_profile` lama sebelum memanggil backend, supaya header klinik dari
  sesi sebelumnya tidak ikut terkirim bersama token baru.

### F2. Pindah klinik

- Route baru `POST /dashboard/klinik-aktif`, middleware `staff:admin`, CSRF.
- Controller baru `KlinikAktifController@ganti`:
  - `clinicId` wajib bilangan bulat dan ada di `pq_profile.clinics[*].id`. Kalau tidak
    (termasuk resepsionis yang tidak punya `clinics`) → 422 (JSON) atau redirect balik
    dengan pesan galat.
  - Set `pq_profile.practiceId = clinicId` (tulis ulang seluruh array profil ke sesi).
  - Redirect ke `/klinik` dengan flash "Klinik aktif: <nama>". Reload penuh disengaja: state
    Alpine yang sudah dimuat milik klinik lama.
- Semua kode yang sudah membaca `practiceId` (dashboard `scopedQuery`, `rosterKlinik`,
  `services`, `ManualAppointmentController::klinikPesanan`, `CustomSessionController`,
  `ServiceController::klinik`, `PatientResultUploadController::scoped`,
  `KlinikPembayaranController::bolehMengatur`) otomatis memakai klinik aktif.

### F3. Header di `app/Services/PraktiquApi.php`

- Helper baru `headerKlinikAktif()`: kalau `pq_profile.role === 'admin'` dan `practiceId`
  berupa bilangan bulat positif → `['X-Praktiqu-Clinic-Id' => (string) $practiceId]`, selain
  itu `[]`. (Resepsionis juga `admin` di FE; backend mengabaikan header untuk mereka.)
- `dispatch()` (:157-171): `->withHeaders(self::headerIpKlien() + self::headerKlinikAktif() + $headers)`.
- `EncounterDocumentController::kirimMentah()` (:101-102, :160-162) memanggil `Http::`
  langsung dan menambahkan `headerIpKlien()` sendiri → tambahkan `headerKlinikAktif()` juga.
- `tukarRefresh()` tidak perlu header.
- Efek samping yang diinginkan: `ReportController` (yang sengaja tidak mengirim klinik untuk
  admin) otomatis ter-scope ke klinik aktif.

### F4. Klinik dicabut di tengah sesi

Di `PraktiquApi::call()`, sebelum `throw new ApiException`: kalau status 400 atau 403 **dan**
body mentah mengandung `clinic_not_in_scope` atau `invalid_clinic_header`:

1. `$this->clearSession()`.
2. Lempar exception baru `KlinikTidakBerlakuException` (**bukan** turunan `ApiException`,
   supaya `catch (ApiException)` di controller tidak menelannya).

Render di `bootstrap/app.php` `withExceptions`:
- `expectsJson()` → 401 JSON `{ "message": "Akses klinik Anda berubah. Silakan masuk lagi." }`.
- Selain itu → redirect ke portal login admin (lihat `ROLE_PORTAL`/`PORTAL_PATH` di
  `AuthController`) dengan flash pesan yang sama.

### F5. Dropdown klinik aktif (`resources/views/dashboard.blade.php`)

- `DashboardController::render()` (:1592-1646) menambah `payload.clinics` (dari
  `pq_profile.clinics`, atau `[]`) dan `payload.profile.practiceId`.
  (Sekalian memperbaiki bug: JS dashboard membaca `this.profile.practiceId` di :527, :784,
  :829 yang selama ini selalu `undefined`.)
- Pil `.pq-clinic` di top bar mobile (:2356-2358) dan sidebar (:2380-2384):
  - `count(clinics) <= 1` → tetap pil statis seperti sekarang.
  - `count(clinics) > 1` → `<form method="POST" action="/dashboard/klinik-aktif">` + `@csrf` +
    `<select name="clinicId" onchange="this.form.submit()">` berisi semua klinik, klinik aktif
    `selected`, klinik nonaktif diberi akhiran " (Nonaktif)", plus `<noscript>` tombol
    "Ganti". Label aksesibel: "Klinik aktif".
  - Gaya mengikuti `.pq-clinic` (`public/css/app.css:375-386`). Saat sidebar dikuncupkan,
    tetap tersembunyi seperti pil hari ini.

### F6. Guard dua tab

Pilihan klinik disimpan di sesi, jadi pindah klinik di tab B diam-diam mengubah tab A.
Form yang dikirim dari tab A bisa menulis ke klinik yang salah.

- Saat inisialisasi `dashApp()`, pasang pembungkus `window.fetch` satu kali: untuk request
  same-origin, tambahkan header `X-Klinik-Halaman: <payload.profile.practiceId>` (kalau ada).
  Tangani `headers` berupa objek biasa maupun `Headers`.
- Middleware baru `CocokKlinikHalaman` (alias `klinik.halaman`), dipasang di **setiap route
  `routes/web.php` yang memakai middleware `staff:any` atau `staff:admin`**, kecuali
  `POST /dashboard/klinik-aktif`. Aturannya: kalau header `X-Klinik-Halaman` ada **dan**
  profil berrole `admin` **dan** nilainya ≠ `pq_profile.practiceId` → 409 JSON
  `{ "message": "Klinik aktif sudah berganti di tab lain. Muat ulang halaman ini." }`.
  Tanpa header, atau role bukan `admin` → lolos.
- Jangan dipasang di `/booking/*` atau `/public/*` (live FE membaca 409 pada
  `/public/payments` sebagai "pending").

### F7. Halaman super admin "Admin klinik"

- Route baru (middleware `staff:super`):
  - `GET  /dashboard/klinik/{id}/admin` → `KlinikAdminController@index`
  - `POST /dashboard/klinik/{id}/admin` → `KlinikAdminController@simpan`
- Pola mengikuti `KlinikPembayaranController` + `resources/views/dashboard/klinik-pembayaran.blade.php`.
- `index`: ambil `GET api/v1/practices/{id}` (nama klinik; 404 → abort 404) dan
  `GET api/v1/practices/clinic-admins`. Admin saat ini = kandidat yang `clinicIds`-nya memuat
  `{id}`; kalau tidak ada → tulis "Admin saat ini bukan akun admin klinik". Tampilkan
  `<select name="newAdminId">` berformat "Nama — email — memegang N klinik", dan teks
  peringatan "Admin lama akan kehilangan akses ke klinik ini."
- `simpan`: validasi `newAdminId` bilangan bulat → `POST api/v1/practices/{id}/change-admin`.
  Sukses → redirect ke halaman yang sama dengan flash sukses; kalau
  `previousAdminClinicCount === 0` dan `previousAdminId` ada → flash peringatan tambahan
  "Admin lama tidak lagi memegang klinik apa pun." 422 → tampilkan pesan galat di form.
- Tautan "Admin klinik ›" di kartu klinik tampilan "Clinics"
  (`dashboard.blade.php` sekitar :4560, di samping "Pengaturan pembayaran ›", hanya super).

### F8. Pengaturan pembayaran internasional

Tidak ada perubahan logika. `KlinikPembayaranController::bolehMengatur` sudah mensyaratkan
`practiceId === {id}`, dan backend `payment-settings` memakai `assertPracticeInScope` yang
kini mengikuti klinik aktif. Admin hanya bisa mengatur klinik yang sedang aktif; tautan di
dashboard dibangun dari klinik aktif. Untuk mengatur klinik lain, pindah klinik dulu.

## Kontrak ringkas

| Hal | Nilai |
|---|---|
| Header klinik aktif (FE → BE) | `X-Praktiqu-Clinic-Id: <wp_kc_clinics.id>` |
| Header halaman (browser → FE) | `X-Klinik-Halaman: <practiceId saat render>` |
| Format rusak | 400, body memuat `invalid_clinic_header` |
| Bukan klinik milik admin / tidak ada | 403, body memuat `clinic_not_in_scope` |
| Role selain CLINIC_ADMIN | header diabaikan |
| Tanpa header | klinik default (perilaku lama) |
| `/auth/me` | `user.clinicId` + `user.clinics` (hanya CLINIC_ADMIN) |
| Super admin | `GET /practices/clinic-admins`, `POST /practices/:id/change-admin {newAdminId: wp_users.ID}` |
| Tab basi | FE 409 "Klinik aktif sudah berganti di tab lain…" |

## Edge case

- **Admin tanpa klinik dan tanpa mapping dokter:** `clinicId: null`, `clinics: []`. FE
  menampilkan galat "belum terhubung ke klinik" seperti sekarang.
- **Klinik nonaktif:** boleh dipilih (data historis), tidak pernah jadi default selama ada
  klinik aktif.
- **Admin dicabut dari klinik aktifnya:** request berikutnya 403 → sesi dibersihkan → login
  ulang → default baru.
- **Sesi FE lama (sebelum rilis) dengan `practiceId` hasil aturan default lama** yang bukan
  milik admin lagi: header dikirim → 403 → login ulang. Membereskan diri sendiri.
- **Resepsionis:** FE mengirim header (role FE `admin`), backend mengabaikan. `clinics` tidak
  ada → tidak ada dropdown → `POST /dashboard/klinik-aktif` dijawab 422.
- **Super admin/psikolog:** FE tidak mengirim header (`role` bukan `admin`); kalau terkirim
  pun diabaikan.
- **Header dari klien lain (curl/Postman) dengan token CLINIC_ADMIN:** divalidasi sama persis.
- **KiviCare WP-admin** untuk admin multi-klinik hanya menampilkan klinik pertama
  (`kcGetClinicIdOfClinicAdmin` memakai `get_var`). Diterima: staf memakai FE Laravel.

## Tes

Backend (`npx vitest run`, DB test lokal Docker `praktiqu-mysql`, URL dari `.env.test.local`
yang harus mengandung "test"):

- `listAdminClinicIds` / `listAdminClinics`: aktif dulu lalu id naik; cadangan mapping dokter;
  kosong; urutan kedua fungsi identik.
- `getActor`: header diabaikan untuk SUPER_ADMIN/RECEPTIONIST/PROFESSIONAL/CLIENT; klinik sah
  → `activeClinicId`; klinik milik admin lain → 403; klinik tidak ada → 403; format rusak
  (`abc`, `0`, `-1`, `1.5`, 20 digit) → 400; user tanpa `wpUserId` → 403.
- `resolveKcActor` memakai `activeClinicId` tanpa query mapping.
- `requireRoles` dan `callerFromRequest` meneruskan 400/403.
- Integrasi admin pemilik A dan B: `GET /practices` hanya klinik aktif; `GET /practices/B`
  dengan header A → 404, dengan header B → 200; daftar bills mengikuti header;
  `GET /practices/B/payment-settings` mengikuti header; tanpa header → klinik default.
- `/auth/me` dan login: `clinics` hanya untuk CLINIC_ADMIN; `clinicId === clinics[0].id`.
- Pasien A+B: dibuka saat klinik aktif B → 200; pasien hanya A saat aktif B → 403.
- `change-admin`: non-super 403; klinik tidak ada 404; body rusak 422; user bukan admin klinik
  422 `not_a_clinic_admin`; sukses menulis `clinic_admin_id` + baris audit;
  `previousAdminClinicCount` benar; admin sama → `unchanged: true` tanpa audit.
- `clinic-admins`: non-super 403; hanya user ber-capability admin klinik; `clinicIds` benar;
  baris capability serialisasi rusak tetap terbaca (LIKE).

FE (`DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`):

- Login menyimpan `clinics`; `PROFILE_VERSION` tetap 5.
- `POST /dashboard/klinik-aktif`: klinik sah → `practiceId` berubah + redirect; di luar daftar
  → 422; resepsionis → 422; psikolog/super → ditolak middleware.
- `PraktiquApi` mengirim `X-Praktiqu-Clinic-Id` untuk `admin` dengan `practiceId`; tidak untuk
  super/psikolog; `kirimMentah` juga mengirimnya.
- 403 berisi `clinic_not_in_scope` → sesi kosong + redirect login (non-JSON) / 401 (JSON).
- Dashboard: >1 klinik → `<select name="clinicId">`; 1 klinik → pil statis; `payload.profile.practiceId` ada.
- `CocokKlinikHalaman`: header berbeda → 409; sama → lolos; tanpa header → lolos.
- Halaman admin klinik: non-super ditolak; daftar kandidat tampil; simpan memanggil backend
  dengan `newAdminId`; peringatan saat `previousAdminClinicCount === 0`; 422 tampil di form.

## Urutan rilis & rollback

1. **Gerbang data (wajib sebelum deploy BE).** Jalankan skrip di Lampiran A di WordPress
   Hostinger. Catat: admin yang memiliki >1 klinik, dan admin yang mapping dokternya berbeda
   dari klinik miliknya (default mereka akan berubah — kabari mereka).
2. **Deploy backend** (Next.js saja). Kompatibel ke belakang: tanpa header = perilaku lama;
   `clinics` hanya field tambahan. Perbarui `openapi.yaml` (header, kode error, dua endpoint).
3. **Deploy FE** lewat branch + PR ke `raakanaka/laravel-praktiqu` (user yang merge; `main`
   auto-deploy). Verifikasi rilis benar-benar sampai di `https://appointment.praktiqu.com`.
4. **Uji coba:** tugaskan klinik kedua ke satu admin percobaan lewat halaman super admin,
   login sebagai admin itu, coba dropdown, cek daftar pasien/bills/laporan berganti.

**Rollback:** BE dan FE bisa di-revert sendiri-sendiri. BE lama mengabaikan header yang tidak
dikenalnya; FE lama tidak mengirim header. Penugasan `clinic_admin_id` yang sudah dibuat tetap
ada dan, di BE lama, admin itu hanya melihat klinik pertamanya.

## Di luar cakupan (tugas terpisah)

Kebocoran scope yang **sudah ada** dan tidak diperbaiki fitur ini (dari survei 2026-10-13):

- `clients/export` — `exportClients` tidak men-scope non-super (`client.service.ts:557`).
- `sessions/export` — `clinicId` hanya untuk SUPER_ADMIN.
- `professionals/export` — memakai `actor.practiceId` (selalu null) dengan kunci yang
  diabaikan service.
- `clients/[id]/statistics` — staf mana pun bisa membaca klien mana pun.
- `sessions/bulk/delete`, `clients/bulk/delete`, `clients/bulk/status`,
  `professionals/bulk/delete`, `professionals/bulk/status`,
  `professionals/[id]/services/export` — tanpa scope klinik.
- GDPR: `consentScopeFor` memberi CLINIC_ADMIN semuanya; `gdpr/data-export` menerima
  `userId` apa pun.
- `professionals/[id]/availability` dan `slots` — `?clinicId` menang atas klinik actor tanpa
  cek keanggotaan (PUT bisa menulis jadwal di klinik mana pun).
- Session notes single read — `assertCanRead` langsung lolos untuk CLINIC_ADMIN.
- Intervention plans — `caller.ts` membuang `clinicId`; RECEPTIONIST/CLINIC_ADMIN melihat
  semua klinik.
- Halaman server-rendered `(dashboard)/practice/settings` dan `/holidays` memakai klinik
  pertama global dari tabel shadow.

## Risiko

- **Default berubah** untuk admin yang punya mapping dokter ke klinik lain (D2). Dimitigasi
  gerbang data.
- **Query tambahan:** request admin dengan header menambah ±2 query kecil di `getActor`.
  `max_user_connections` Hostinger 75 — aman.
- **Pencabutan instan:** `change-admin` langsung mencabut akses admin lama. Disengaja; UI
  memperingatkan sebelum dan sesudah simpan.

## Lampiran A — skrip cek data (read-only)

Jalankan dengan **satu** koneksi (Hostinger menolak banyak koneksi beruntun):

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger \
  'cd ~/domains/api-appointment.praktiqu.com/public_html && php' < cek-multi-klinik.php
```

```php
<?php
// Read-only: siapa saja staf yang tercatat di >1 klinik. Hanya ID, tanpa nama/email.
require 'wp-load.php';
global $wpdb;

$q = [
  'admin_pemilik_banyak_klinik' => "SELECT clinic_admin_id, COUNT(*) n,
      GROUP_CONCAT(id ORDER BY id) klinik, GROUP_CONCAT(status ORDER BY id) status
    FROM wp_kc_clinics GROUP BY clinic_admin_id HAVING n > 1",
  'dokter_banyak_klinik' => "SELECT doctor_id, COUNT(*) n, GROUP_CONCAT(clinic_id ORDER BY id) klinik
    FROM wp_kc_doctor_clinic_mappings GROUP BY doctor_id HAVING n > 1",
  'resepsionis_banyak_klinik' => "SELECT receptionist_id, COUNT(*) n, GROUP_CONCAT(clinic_id ORDER BY id) klinik
    FROM wp_kc_receptionist_clinic_mappings GROUP BY receptionist_id HAVING n > 1",
  'klinik' => "SELECT id, status, clinic_admin_id FROM wp_kc_clinics ORDER BY id",
  'staf_semua_sumber' => "SELECT u.wpUserId, u.role, u.status,
      (SELECT GROUP_CONCAT(clinic_id ORDER BY id) FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = u.wpUserId) mapping_dokter,
      (SELECT GROUP_CONCAT(clinic_id ORDER BY id) FROM wp_kc_receptionist_clinic_mappings WHERE receptionist_id = u.wpUserId) mapping_resepsionis,
      (SELECT GROUP_CONCAT(id ORDER BY id) FROM wp_kc_clinics WHERE clinic_admin_id = u.wpUserId) klinik_dimiliki
    FROM users u WHERE u.role IN ('CLINIC_ADMIN','RECEPTIONIST','SUPER_ADMIN') ORDER BY u.role, u.wpUserId",
  'pemilik_tanpa_user_app' => "SELECT c.clinic_admin_id, GROUP_CONCAT(c.id ORDER BY c.id) klinik
    FROM wp_kc_clinics c LEFT JOIN users u ON u.wpUserId = c.clinic_admin_id
    WHERE u.id IS NULL GROUP BY c.clinic_admin_id",
  'jumlah_role_app' => "SELECT role, COUNT(*) n FROM users GROUP BY role",
];

$out = [];
foreach ($q as $k => $sql) {
  $rows = $wpdb->get_results($sql, ARRAY_A);
  $out[$k] = $wpdb->last_error ? ['error' => $wpdb->last_error] : $rows;
}
echo json_encode($out, JSON_PRETTY_PRINT), "\n";
```

Yang dicari: baris `staf_semua_sumber` dengan `role = CLINIC_ADMIN` yang `mapping_dokter`-nya
tidak kosong **dan** berbeda dari `klinik_dimiliki` — default mereka berubah.
