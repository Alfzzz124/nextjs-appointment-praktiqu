# CRUD Service di `/api/v1` — desain

**Tanggal:** 30 Agustus 2026
**Status:** disetujui, siap direncanakan
**Cakupan:** backend saja. Front-End Laravel di luar cakupan (lihat §9).

---

## 1. Masalah

Admin klinik ingin menambah, mengubah, dan menghapus layanan sendiri. Kemampuan itu
sudah ada dan sudah jadi di plugin KiviCare (`DoctorServiceController`, CRUD penuh lewat
REST WordPress). Yang tidak ada adalah jembatannya ke `/api/v1` yang dipakai dashboard.

Yang sudah ada di `/api/v1` seluruhnya soal **penugasan**, bukan pembuatan:

| Endpoint | Guna |
| --- | --- |
| `GET /professionals/{id}/services` | daftar layanan yang ditawarkan seorang psikolog |
| `POST /professionals/{id}/services` | tugaskan layanan yang sudah ada (`serviceId` wajib) |
| `DELETE /professionals/{id}/services?serviceId=` | lepas penugasan |
| `POST /professionals/{id}/services/bulk/status` | aktif/nonaktif penugasan, massal |
| `POST /professionals/{id}/services/bulk/delete` | lepas penugasan, massal |
| `GET /public/professionals/{id}/services` | daftar publik, dipakai halaman booking |

Tidak satu pun membuat, mengubah, atau menghapus layanan, dan tidak ada yang mendaftar
katalog layanan sama sekali. Akibat berantainya: `POST /professionals/{id}/services`
sendiri tidak terpakai dari dashboard, karena ia menuntut `serviceId` sementara tidak ada
jalan untuk mengetahui id yang sah.

Diprobe 30 Agu 2026 — `GET /api/v1/services`, `/clinic-services`, `/service-list`
ketiganya 404.

---

## 2. Di mana datanya tinggal

Dua tabel KiviCare, bukan satu:

- **`wp_kc_services`** — katalog dasar: `id · type · category · name · price · status ·
  created_at`. **Global — tidak punya `clinic_id`.**
- **`wp_kc_service_doctor_mapping`** — layanan itu sebagaimana ditawarkan satu psikolog di
  satu klinik: `id · service_id · doctor_id · clinic_id · charges · extra ·
  telemed_service · service_name_alias · multiple · image · status · is_public ·
  created_at · duration`.

Harga yang berlaku adalah `charges` di mapping, bukan `price` di katalog.

`wp_kc_appointment_service_mapping.service_id` menunjuk ke **katalog**, bukan ke baris
mapping (`Wordpress-Plugin/kivicare-clinic-management-system/app/database/migrations/2025_05_04_CreateAppointmentServiceMappingTable.php:16`). Ini menggugurkan kekhawatiran awal bahwa menghapus mapping
akan membuat janji temu lama kehilangan nama layanannya — katalognya tetap utuh. Yang
benar-benar rusak adalah janji temu yang belum jalan: layanannya masih tercatat, tapi
psikolognya sudah tidak menawarkannya lagi. Itu yang dijaga di §5.

---

## 3. Identitas resource

`{id}` adalah **`wp_kc_service_doctor_mapping.id`**, persis seperti KiviCare
(`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1421`, dan `do_action('kc_service_update', $id)`
yang didokumentasikan sebagai `$mapping_id`).

Satu "service" di dashboard = *satu layanan sebagaimana ditawarkan satu psikolog di satu
klinik*. Pilihan ini yang membuat sisanya konsisten:

- Harga, durasi, online/offline, dan status memang tinggal di baris itu.
- Cakupan per-klinik jatuh dengan sendirinya — mapping punya `clinic_id`, katalog tidak.
- Ganti nama tidak pernah perlu me-rename baris katalog yang dipakai bersama klinik lain.

---

## 4. Endpoint dan peran

| Method | Path | Peran |
| --- | --- | --- |
| `GET` | `/api/v1/service-categories` | semua yang login |
| `GET` | `/api/v1/services` | lihat matriks cakupan di bawah |
| `POST` | `/api/v1/services` | `SUPER_ADMIN`, `CLINIC_ADMIN` |
| `GET` | `/api/v1/services/{id}` | sama dengan list |
| `PUT` | `/api/v1/services/{id}` | `SUPER_ADMIN`, `CLINIC_ADMIN` |
| `DELETE` | `/api/v1/services/{id}` | `SUPER_ADMIN`, `CLINIC_ADMIN` |

### Cakupan baca — meniru `getServices` KiviCare (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:623-652`)

| Peran | Yang terlihat |
| --- | --- |
| `SUPER_ADMIN` | semua mapping |
| `CLINIC_ADMIN` | `clinic_id` = kliniknya. Tidak punya klinik → daftar kosong, bukan error |
| `RECEPTIONIST` | `clinic_id` = kliniknya. Tidak punya klinik → daftar kosong |
| `PROFESSIONAL` | `doctor_id` = dirinya, lintas klinik |
| `CLIENT` | daftar kosong |

Klinik diambil dari `resolveKcActor()` (`{ actor, wpUserId, clinicId }`), bukan dari
`practiceId` di JWT — field itu cuid dari skema bayangan yang sudah dipensiunkan dan tidak
bisa dibandingkan dengan id klinik KiviCare.

Untuk `CLINIC_ADMIN` dan `RECEPTIONIST`, parameter `clinicId` **dipaksa** ke kliniknya
sendiri — dikirim atau tidak. Mapping klinik lain dijawab **404**, bukan 403, supaya
keberadaannya tidak bocor.

### Cakupan tulis

Hanya `SUPER_ADMIN` dan `CLINIC_ADMIN`, sesuai permintaan ("di akun admin aja dulu supaya
jalannya klinik diatur oleh admin"). Ini **sengaja tidak** meniru KiviCare: gerbang tulis
di sana adalah `KCPermissions::can_user_perform_action('service_add'|'service_edit'|
'service_delete')`, sebuah matriks izin yang disimpan di `wp_options` dan bisa disetel
per instalasi. Meniru matriks itu berarti membaca opsi WordPress dari Next.js, dan
hasilnya tetap tidak bisa diprediksi dari sisi API.

`CLINIC_ADMIN` hanya boleh menulis di kliniknya sendiri. Mapping klinik lain → 404.

### Bentuk respons

Ikut keluarga `/professionals`: `NextResponse.json` + `problem-details`
(`validationError`, `notFound`, `forbidden`, `conflict`), **bukan** keluarga `kcOk/kcHandle`
milik billing. Alasannya route ini berbagi helper RBAC dan pola cakupan dengan
`/professionals/{id}/services`, dan kedua keluarga sudah sama-sama dikonsumsi FE.

---

## 5. Aturan tulis

Aturan di bawah dibaca dari `DoctorServiceController`, bukan ditebak. Di tiga tempat kita
sengaja menyimpang — anti-duplikat pada `POST`, `price` pada `PUT`, dan semantik `DELETE`
— dan ketiganya diberi alasan di tempatnya masing-masing.

### `GET /api/v1/service-categories`

Baca `wp_kc_static_data` dengan `type = 'service_type'` dan `status = 1`. Kembalikan
`{ id, label, value }`. Pola sama dengan `listSpecializations()` /
`listQualifications()` yang sudah ada di `static-data.repo.ts`.

### `POST /api/v1/services`

Satu request menghasilkan **1 baris katalog + N baris mapping**.

1. Resolve `categoryId` → baris `wp_kc_static_data`. Tidak ketemu atau bukan
   `service_type` aktif → **422**. Dari baris itu: `type` = `value`, dan `category` =
   snapshot JSON `{id, label, value}` — dua kolom, keduanya ditulis, seperti KiviCare
   (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1196-1213`).
2. Tolak **409** kalau ada pasangan `(doctorId, clinicId)` di daftar yang sudah punya
   mapping ke baris katalog bernama sama — tanpa memandang `type`. (Deviasi; lihat
   catatan di bawah.)
3. Katalog: cari baris dengan `name` **dan** `type` yang sama → **pakai ulang** id-nya.
   Tidak ada → buat baris baru. Katalog global, jadi dua klinik memang berbagi baris.
4. Verifikasi tiap `doctorId` benar-benar terpetakan ke `clinicId` lewat
   `wp_kc_doctor_clinic_mappings`. Tidak → **400**, pesan sama semangatnya dengan
   KiviCare ("psikolog yang dipilih tidak terhubung dengan klinik tersebut").
5. Insert satu baris mapping per psikolog, dengan `charges`, `duration`,
   `telemed_service`, `status`, `is_public`, `created_at = NOW()`.

Balasan **201** berisi mapping yang dibuat, satu entri per psikolog.

**Deviasi pada langkah 2.** KiviCare hanya menolak kalau namanya sama tapi **tipenya
berbeda** (400). Kalau nama **dan** tipe sama, ia memakai ulang `service_id` lalu tetap
menyisipkan baris mapping **kedua** untuk psikolog+klinik yang sama
(`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1249-1252`).
Tabel itu tidak punya unique constraint, jadi barisnya benar-benar berganda — dan
`listServicesForDoctor()` akan mengembalikan layanan itu dua kali ke halaman booking.

`assignServiceToDoctor()` di repo ini sudah memutuskan sebaliknya: cari dulu, aktifkan
ulang kalau ada, jangan pernah menyisipkan kembar. Kita ikut keputusan itu — 409, apa pun
tipenya — dan memakai 409 alih-alih 400 karena ini konflik keadaan, bukan bentuk request
yang salah.

### `PUT /api/v1/services/{id}`

`price`, `duration`, `telemedService`, `status`, `isPublic` hanya menyentuh baris mapping
itu — `price` masuk ke `charges`, dan baris katalog tidak disentuh (lihat §6).

Ganti nama **tidak pernah** me-rename baris katalog bersama. Alurnya (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1455-1499`):

1. Tolak **409** kalau psikolog+klinik yang sama sudah punya mapping lain ke layanan
   bernama sama.
2. Cari baris katalog dengan `name` + `type` baru → ada: **repoint** `service_id` mapping
   ke sana. Tidak ada: buat baris katalog baru, lalu repoint.
3. Baris katalog lama ditinggalkan apa adanya — klinik lain mungkin masih memakainya.

`clinicId` dan `doctorId` **tidak bisa diubah** lewat PUT. Memindahkan layanan ke psikolog
lain artinya hapus lalu buat baru; ini menjaga PUT tetap satu baris, satu maksud.

### `DELETE /api/v1/services/{id}`

1. Hitung janji temu dengan `service_id` (katalog) **dan** `doctor_id` mapping ini, yang
   tanggalnya belum lewat dan statusnya bukan `CANCELLED`.
   > `CANCELLED = 0`, bukan 1. Pakai konstanta `APPOINTMENT_STATUS` dari
   > `appointments.repo.ts`, jangan angka telanjang.
2. Ada → **409** beserta jumlahnya, admin diminta membatalkan atau memindahkan dulu.
3. Tidak ada → `status = 0`. Baris tidak pernah benar-benar dihapus.

Ini **berbeda** dari KiviCare, yang `DELETE` keras tanpa cek apa pun
(`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1643`). Yang diikuti di sini adalah keputusan yang sudah diambil di
`unassignServiceFromDoctor()` pada tabel yang sama, lengkap dengan komentar alasannya.

### Hook KiviCare — sengaja tidak dipicu

`kc_service_add` / `kc_service_update` / `kc_service_delete` **tidak** kita panggil.

Satu-satunya pendengar adalah `KCProServiceControllerFilters`, yang menulis
`kc_service_sessions` dari `session_days` — fitur timeslot-per-layanan milik KiviCare Pro.
Di controller aslinya, `kc_service_add` bahkan hanya di-`do_action` kalau `session_days`
tidak kosong (`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1398`). Kita tidak pernah mengirim `session_days` dan tidak
punya UI untuknya, jadi menulis lewat SQL langsung **tidak melewatkan pendengar apa pun**.

Ini beda tajam dengan appointment, di mana lima listener jalan tanpa syarat — dan itulah
sebabnya appointment ditulis lewat plugin sementara ini tidak.

Alasannya ditulis sebagai komentar di `services.write.ts`, sejajar dengan komentar yang
sudah ada di `src/repositories/wp/services.repo.ts:184`.

---

## 6. Validasi

| Field | Aturan |
| --- | --- |
| `name` | wajib, 1–255, di-trim |
| `categoryId` | wajib, harus `wp_kc_static_data` bertipe `service_type` dan aktif |
| `price` | wajib, numerik ≥ 0 — satu field, dua kolom (lihat catatan) |
| `duration` | wajib, integer 1–1440 menit |
| `telemedService` | `'yes' \| 'no'`, default `'no'` |
| `status` | `0 \| 1`, default `1` |
| `isPublic` | `0 \| 1`, default `1` |
| `doctorIds` | wajib, array integer, tidak boleh kosong |
| `clinicId` | opsional untuk `SUPER_ADMIN`; diabaikan dan dipaksa untuk `CLINIC_ADMIN` |

Batas 1–1440 menit dan `status` 0/1 diambil dari `validateDuration` / `validateStatus`
KiviCare, bukan dikarang.

### `price` — satu field, dua kolom

KiviCare hanya punya satu parameter harga, dan ia menuliskannya ke dua tempat:
`wp_kc_services.price` (harga daftar) dan `wp_kc_service_doctor_mapping.charges` (yang
benar-benar ditagih) — `'charges' => $params['price']` di
`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorServiceController.php:1360`.
API ini mengikuti: satu field `price`, dan `POST` menulis keduanya.

**Pada `PUT`, `price` hanya memperbarui `charges` di mapping.** Baris katalog tidak
disentuh. Ini menyimpang dari KiviCare, yang ikut menulis ulang `wp_kc_services.price`
saat update (`:1477`) — dan karena katalog itu global, satu klinik menaikkan harga akan
mengubah harga daftar yang dilihat klinik lain. Harga yang berlaku memang `charges`, jadi
efeknya di sini kosmetik; tapi menulis lintas klinik tanpa diminta bukan sesuatu yang
layak ditiru.

Id numerik di path di-parse dengan penjaga yang sama seperti `parseProfessionalId` —
non-numerik → 400. `NaN` yang lolos ke parameter SQL pernah membuat halaman booking publik
crash; jangan diulang.

### `maxClients` — ditunda, bukan lupa

"Jumlah klien" tidak diterima maupun dikembalikan API ini.

Tidak ada kolomnya di mana pun: tidak di katalog, tidak di mapping, tidak di
`wp_kc_appointments`. Yang namanya mirip, `multiple` di mapping, artinya lain — "boleh
memilih beberapa layanan sekaligus saat booking" (`allow_multi` di REST KiviCare), bukan
berapa orang dalam satu sesi.

Angka itu baru berarti kalau booking benar-benar menahan slot setelah N orang, dan itu
menuntut lebih dari satu kolom: penahanan slot, daftar peserta, dan tagihan per orang.
Menerima field yang lalu dibuang diam-diam di server adalah pola yang sudah beberapa kali
dibersihkan dari dashboard ini. Kalau sesi kelompok jadi dikerjakan, ia dapat spec
sendiri.

---

## 7. Berkas

| Berkas | Isi |
| --- | --- |
| `src/repositories/wp/services.repo.ts` | *ubah* — `listClinicServices()` (mapping ⋈ katalog, paginasi + search + filter peran) dan `findMappingById()` |
| `src/repositories/wp/services.write.ts` | *baru* — reuse-or-create katalog, insert/update/soft-delete mapping, hitung janji temu mendatang |
| `src/repositories/wp/static-data.repo.ts` | *ubah* — `SERVICE_TYPE: 'service_type'` di `STATIC_DATA_TYPE` + `listServiceTypes()` |
| `src/services/service-catalog/service.ts` | *baru* — aturan §5 |
| `src/services/service-catalog/validation.ts` | *baru* — skema zod §6 |
| `src/services/service-catalog/scope.ts` | *baru* — cakupan klinik/psikolog, cermin `professional/route-scope.ts` |
| `src/app/api/v1/services/route.ts` | *baru* — `GET`, `POST` |
| `src/app/api/v1/services/[id]/route.ts` | *baru* — `GET`, `PUT`, `DELETE` |
| `src/app/api/v1/service-categories/route.ts` | *baru* — `GET` |
| `openapi.yaml` | *ubah* — empat path baru |

Repositori dipecah baca/tulis (`services.repo.ts` / `services.write.ts`) mengikuti pasangan
`appointments.repo.ts` / `appointments.write.ts` yang sudah ada.

`service-catalog/` dipisah dari `professional/` karena resource-nya beda: yang satu tentang
psikolog dan penugasannya, yang ini tentang layanan itu sendiri. Keduanya menyentuh tabel
yang sama, jadi `services.write.ts` menjadi satu-satunya tempat mapping ditulis — termasuk
nanti kalau `assignServiceToDoctor` dipindah ke sana.

---

## 8. Pengujian

Vitest dengan prisma ter-mock, gaya rumah (lihat `tests/complete-in-progress/doctor-services.test.ts`).

**`tests/services/service-catalog.service.test.ts`**
- katalog dipakai ulang saat `name`+`type` sudah ada; baris baru saat belum
- 409 saat `(doctor, clinic)` sudah punya layanan bernama sama — termasuk saat `type`-nya
  identik, kasus yang di KiviCare justru menghasilkan mapping kembar
- mapping kembar tidak pernah tercipta walau `POST` diulang dengan body yang sama
- 400 saat `doctorId` tidak terpetakan ke `clinicId`
- ganti nama me-*repoint* mapping, tidak me-rename baris katalog lama
- `POST` menulis `price` ke katalog **dan** `charges`; `PUT` hanya ke `charges`
- ganti nama ke nama yang sudah ada di psikolog+klinik yang sama → 409
- delete dengan janji temu mendatang → 409; tanpa → `status = 0`
- janji temu `CANCELLED` (= 0) tidak menghalangi delete
- `duration` 0, 1441, dan non-integer ditolak

**`tests/integration/services/scope.test.ts`**
- tiap peran melihat persis yang dijanjikan matriks §4
- `CLINIC_ADMIN` yang mengirim `clinicId` klinik lain tetap dapat kliniknya sendiri
- `GET`/`PUT`/`DELETE` mapping klinik lain → 404, bukan 403
- `PROFESSIONAL` dan `RECEPTIONIST` menulis → 403
- `CLINIC_ADMIN` tanpa klinik → daftar kosong, bukan 500

**`tests/integration/services/routes.test.ts`**
- id non-numerik di path → 400
- body bukan JSON → 400
- `categoryId` tidak dikenal → 422

---

## 9. Di luar cakupan

**Front-End Laravel.** `SERVICE_CREATE_ENABLED`, `addConfigs.service`, dan
`ResourceController::RESOURCES` ada di `Front-End Laravel/laravel-praktiqu-main/`, yang
dipelihara Rafiq dan kita perlakukan sebagai referensi baca-saja. Setelah endpoint jadi,
yang kita serahkan adalah catatan bentuk request/response — bukan perubahan berkasnya.

Catatan itu perlu menyebut satu hal yang mengejutkan: halaman Services sekarang memuat
per klinik lewat `/dashboard/services` (1 request roster + 1 per psikolog).
`GET /api/v1/services?clinicId=` menggantikan seluruh rangkaian itu dengan satu request.

**Bulk action dan export.** `POST /services/bulk/*` dan `GET /services/export` sudah ada
padanannya di bawah `/professionals/{id}/services/*`. Menduplikasinya di level katalog
menunggu sampai ada yang benar-benar memakainya.

**`maxClients` / sesi kelompok.** Lihat §6.

---

## 10. Koreksi terhadap laporan awal

Tiga hal di laporan 30 Agu 2026 tidak akurat, dan keputusan di atas berdiri di atas
versi yang sudah dikoreksi:

1. **"Menghapus baris mapping akan membuat janji temu lama kehilangan nama layanannya."**
   Tidak. `wp_kc_appointment_service_mapping.service_id` menunjuk katalog, bukan mapping.
   Yang berisiko adalah janji temu yang belum jalan — dan itu yang dijaga §5.

2. **"Teruskan lewat plugin supaya hook KiviCare tetap jalan."** Hook `kc_service_*` hanya
   di-`do_action` kalau `session_days` tidak kosong, dan kita tidak pernah mengirimnya.
   Lagipula `checkPermission` KiviCare adalah `current_user_can('read')` — Next.js tidak
   punya sesi WordPress, jadi "lewat plugin" berarti menambah route baru di
   `praktiqu-endpoint`, bukan memanggil `/doctor-services` langsung.

3. **§3 laporan tidak menyebut `category`.** Kolom itu wajib di KiviCare, menunjuk
   `wp_kc_static_data` bertipe `service_type`, dan ikut menentukan logika anti-duplikat
   (nama **+** tipe). Form tanpa kolom ini akan membuat semua layanan jatuh ke satu tipe.

Satu hal yang laporan benar dan mudah terlewat: `POST /professionals/{id}/services`
memang belum terpakai karena tidak ada cara mengetahui `serviceId`. `GET /api/v1/services`
sekaligus memperbaiki itu.

---

