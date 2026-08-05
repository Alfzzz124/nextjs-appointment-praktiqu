# Panduan Endpoint Practices (Clinic) & Services

**Tanggal:** 2026-08-05
**Base URL staging:** `https://staging2.praktiqu.com`
**Base URL lokal:** `http://localhost:3000`

Panduan pemakaian dua kelompok endpoint di backend **Next.js** (`/api/v1`) — bukan API
plugin WordPress. Isinya diverifikasi langsung dari route file, bukan dari spec, karena
sebagian besar `docs/api/openapi.yaml` masih hand-maintained (lihat §9).

---

## 1. Dua hal yang paling sering bikin salah

**Pertama: clinic dinamai `practices`.** Tidak ada path `/api/v1/clinics` di backend kita.
Entitasnya sama (`wp_kc_clinics`), namanya saja yang beda. `/kivicare/v1/clinics` itu
milik plugin WordPress dan tidak dibahas di sini.

**Kedua: "services" di sini artinya penugasan dokter↔service, bukan katalog service.**

| Yang kamu mau | Endpoint | Tabel |
|---|---|---|
| Lihat/atur service yang ditawarkan seorang dokter | `/api/v1/professionals/{id}/services` | `wp_kc_service_doctor_mapping` |
| Bikin/edit service baru di katalog | **tidak ada** | `wp_kc_services` |

Katalog service belum punya endpoint CRUD. Satu-satunya jalur tulis ke `wp_kc_services`
di kode kita adalah importer ([`import/adapters/services.ts`](../../src/services/billing/import/adapters/services.ts))
dan pembuatan service ad-hoc dari bill service. Untuk bikin service baru secara normal,
masih lewat admin KiviCare.

---

## 2. Autentikasi

Semua endpoint di §4 dan §5 butuh **Bearer JWT**. Endpoint `/api/v1/public/*` (§6) tidak.

```bash
curl -X POST https://staging2.praktiqu.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@praktiqu.com","password":"..."}'
```

Responsnya:

```json
{
  "user": { "id": "cmrhxo22l0006usokhbjug1fe", "wpUserId": 204, "role": "CLINIC_ADMIN" },
  "accessToken": "eyJhbGciOi...",
  "accessTokenExpiresAt": "2026-08-05T12:00:00.000Z",
  "refreshToken": "...",
  "refreshTokenExpiresAt": "..."
}
```

Pakai `accessToken` sebagai `Authorization: Bearer <token>`.

> ⚠️ **`user.id` bukan id yang dipakai resource.** `user.id` masih cuid (id auth).
> Setiap resource — termasuk `{id}` di `/professionals/{id}/services` — dikunci ke
> **`user.wpUserId`** (integer, `wp_users.ID`). Memakai `user.id` untuk membangun URL
> menghasilkan 400/404 yang membingungkan. Detailnya di
> [`docs/handover/2026-07-31-frontend-breaking-changes.md`](../handover/2026-07-31-frontend-breaking-changes.md).

---

## 3. Ringkasan hak akses

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST |
|---|---|---|---|---|
| `GET/POST /practices` | ✅ | ✅ | ❌ | ❌ |
| `GET/PATCH/DELETE /practices/{id}` | ✅ | ✅ | ❌ | ❌ |
| `/practices/{id}/settings` | ✅ | ✅ | ❌ | ❌ |
| `/practices/{id}/holidays` | ✅ | ✅ | ❌ | ❌ |
| `GET /practices/{id}/users` | ✅ | ✅ | ❌ | ❌ |
| `POST /practices/{id}/change-admin` | ✅ | ❌ | ❌ | ❌ |
| `/practices/bulk/*`, `/practices/export` | ✅ | ❌ | ❌ | ❌ |
| `GET /professionals/{id}/services` | ✅ | 🔸 se-klinik | 🔸 diri sendiri | 🔸 se-klinik |
| `POST/DELETE /professionals/{id}/services` | ✅ | 🔸 se-klinik | ❌ | ❌ |
| `/professionals/{id}/services/bulk/*`, `/export` | ✅ | ⚠️ tanpa cek klinik | ❌ | ❌ |

🔸 = dibatasi scope. Untuk `/professionals/*`, scope klinik diambil dari
`wp_kc_doctor_clinic_mappings` — **bukan** dari `practiceId` di JWT (field itu cuid
peninggalan skema lama dan tidak bisa dibandingkan dengan id klinik KiviCare). Lihat
[`route-scope.ts`](../../src/services/professional/route-scope.ts).

⚠️ Endpoint `/practices/*` **tidak** membatasi CLINIC_ADMIN ke klinik miliknya sendiri —
role check-nya hanya mengecek role. Lihat §9.

---

## 4. Endpoints — Practices

### 4.1 `GET /api/v1/practices` — daftar praktik

Query param: `page` (default 1), `limit` (default 20), `status`.

```bash
curl https://staging2.praktiqu.com/api/v1/practices?page=1&limit=20 \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    {
      "id": 1,
      "name": "PraktiQU Jakarta",
      "email": "halo@praktiqu.com",
      "telephoneNo": "+62211234567",
      "address": "Jl. Sudirman No. 1",
      "city": "Jakarta",
      "state": "DKI Jakarta",
      "country": "Indonesia",
      "postalCode": "10220",
      "countryCode": "ID",
      "countryCallingCode": "+62",
      "timezone": "Asia/Jakarta",
      "logoUrl": "https://cdn.praktiqu.com/logo.png",
      "status": 1,
      "businessHours": [
        { "dayOfWeek": 1, "open": true, "startTime": "08:00", "endTime": "17:00" }
      ],
      "createdAt": "2026-01-10T03:00:00.000Z",
      "updatedAt": "2026-01-10T03:00:00.000Z"
    }
  ],
  "total": 3
}
```

Catatan yang perlu diketahui sebelum dipakai:

- **Respons tidak mengembalikan `page`/`limit`.** Cuma `data` dan `total`. Simpan sendiri
  di sisi front-end.
- **Filter `status` cuma punya satu perilaku berguna: `?status=1`.** Route-nya menghitung
  `includeInactive = status !== 1` ([`practices/route.ts:23`](../../src/app/api/v1/practices/route.ts:23)),
  jadi `?status=0` **tidak** memfilter yang nonaktif saja — hasilnya sama dengan tanpa
  filter (aktif + nonaktif). Kalau butuh daftar nonaktif saja, saring di klien.
- **Tanpa `status`, yang nonaktif ikut terbawa.** Ini kebalikan dari dugaan umum.
- **`search` belum tersambung.** Service layer mendukungnya, route-nya tidak membaca
  query param itu.
- `updatedAt` selalu sama dengan `createdAt`. `wp_kc_clinics` tidak punya kolom
  `updated_at`, dan ini sengaja tidak dikarang.

### 4.2 `POST /api/v1/practices` — ❌ belum ada

Selalu balas **501 Not Implemented**:

```json
{
  "type": "/errors/not-implemented",
  "title": "Not Implemented",
  "detail": "Practice creation is delegated to the WordPress provisioning flow. Use PATCH /api/v1/practices/:id to update an existing practice.",
  "status": 501
}
```

Pembuatan klinik baru lewat provisioning WordPress.

### 4.3 `GET /api/v1/practices/{id}`

```bash
curl https://staging2.praktiqu.com/api/v1/practices/1 -H "Authorization: Bearer $TOKEN"
```

Balas `{ "data": { ...PracticeDTO } }`, atau 404 kalau tidak ada.

### 4.4 `PATCH /api/v1/practices/{id}` — update

Semua field opsional (semantik PATCH). Skemanya `.strict()` — **kirim field yang tidak
dikenal → 422**, bukan diabaikan diam-diam.

```bash
curl -X PATCH https://staging2.praktiqu.com/api/v1/practices/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "PraktiQU Jakarta Pusat",
    "timezone": "Asia/Jakarta",
    "businessHours": [
      { "dayOfWeek": 1, "open": true, "startTime": "08:00", "endTime": "17:00" },
      { "dayOfWeek": 0, "open": false, "startTime": null, "endTime": null }
    ]
  }'
```

Aturan validasi ([`src/types/practice.ts`](../../src/types/practice.ts)):

| Field | Aturan |
|---|---|
| `name` | 1–120 karakter |
| `email` | format email, boleh `null` |
| `telephoneNo` | 3–40 karakter, boleh `null` |
| `address` | maks 255 |
| `city` / `state` / `country` | maks 80 |
| `postalCode` | maks 20 |
| `countryCode` | tepat 2 huruf (ISO 3166-1 alpha-2), mis. `"ID"` |
| `countryCallingCode` | E.164, regex `^\+\d{1,4}$`, mis. `"+62"` |
| `timezone` | nama IANA valid, mis. `"Asia/Jakarta"` |
| `logoUrl` | URL `http(s)`, boleh `null` |
| `status` | `0` atau `1` saja |
| `businessHours` | array maks 7 item; `dayOfWeek` 0–6 (0 = Minggu, konvensi JS Date); `startTime`/`endTime` format `HH:mm` |

**`timezone`, `logoUrl`, dan `businessHours` tidak punya kolom sendiri** — ketiganya
disimpan di blob `extra`. Merge-nya parsial: field yang tidak dikirim tidak ikut
terhapus. Tapi `businessHours` diganti **utuh** kalau dikirim, bukan digabung per hari.

Respons 200 `{ "data": { ...PracticeDTO } }`. Validasi gagal → 422:

```json
{
  "type": "/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Invalid practice input",
  "issues": [{ "path": "countryCode", "message": "countryCode must be ISO 3166-1 alpha-2" }]
}
```

### 4.5 `DELETE /api/v1/practices/{id}` — nonaktifkan

**Soft delete**, bukan hapus permanen — cuma set `status = 0`. Balas **204 No Content**
tanpa body. Untuk mengaktifkan lagi: `PATCH` dengan `{"status": 1}`.

### 4.6 `GET` / `PATCH /api/v1/practices/{id}/settings`

Alias tipis dari §4.3 dan §4.4 — perilaku, skema, dan responsnya identik. Dipisah supaya
nanti bisa punya RBAC sendiri. Pakai yang mana saja.

### 4.7 `GET /api/v1/practices/{id}/holidays` — daftar hari libur

```json
{
  "data": [
    {
      "id": 12,
      "practiceId": 1,
      "title": "Idul Fitri",
      "startDate": "2026-03-20",
      "endDate": "2026-03-22",
      "isAllDay": true,
      "startTime": null,
      "endTime": null
    }
  ]
}
```

> `isAllDay` adalah **kebalikan** dari kolom `time_specific` di KiviCare —
> `time_specific = true` di sana artinya tutup **sebagian** hari. Pembalikan ini
> disengaja dan sudah ditangani di service layer; kamu cukup pakai `isAllDay`.

### 4.8 `POST /api/v1/practices/{id}/holidays` — tambah libur

```bash
# Libur sehari penuh
curl -X POST https://staging2.praktiqu.com/api/v1/practices/1/holidays \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Idul Fitri","startDate":"2026-03-20","endDate":"2026-03-22"}'

# Tutup sebagian hari
curl -X POST https://staging2.praktiqu.com/api/v1/practices/1/holidays \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Rapat internal","startDate":"2026-04-01","endDate":"2026-04-01",
       "isAllDay":false,"startTime":"13:00","endTime":"15:00"}'
```

| Field | Aturan |
|---|---|
| `title` | wajib, 1–120 karakter |
| `startDate`, `endDate` | wajib, `YYYY-MM-DD` |
| `isAllDay` | default `true` |
| `startTime`, `endTime` | `HH:mm`; **wajib keduanya kalau `isAllDay: false`** |

Validasi tambahan: `endDate` tidak boleh lebih awal dari `startDate` (422). Libur
sebagian hari tanpa kedua jam juga 422 — kalau dibolehkan, generator slot tidak bisa tahu
rentang mana yang tertutup.

Sukses → **201** `{ "data": { ...HolidayDTO } }`.

### 4.9 Hapus hari libur — ⚠️ belum bisa dipakai

Handler `DELETE`-nya ada dan membaca `params.holidayId`, tapi **folder rute
`[holidayId]` tidak pernah dibuat**. Praktisnya:

- `DELETE /practices/{id}/holidays/{holidayId}` → **404** (rute tidak ada)
- `DELETE /practices/{id}/holidays` → **500** (`holidayId` jadi `undefined` → `NaN`)

Sementara ini hapus barisnya lewat SQL di `wp_kc_clinic_schedule`. Lihat §9.

### 4.10 `GET /api/v1/practices/{id}/users`

Semua orang yang terpetakan ke praktik itu, digabung dari tiga tabel mapping KiviCare
(dokter, pasien, resepsionis).

```json
{ "data": [ { "userId": 204, "role": "doctor" }, { "userId": 512, "role": "receptionist" } ] }
```

### 4.11 `POST /api/v1/practices/{id}/change-admin` — ⚠️ rusak

SUPER_ADMIN saja. Body: `{ "newAdminId": "<string>" }`.

Endpoint ini punya id yang saling bertabrakan dan **tidak bisa berhasil dengan input apa
pun**: `newAdminId` dicari di tabel auth `User` (id-nya cuid), lalu nilai yang sama
di-`Number()`-kan untuk ditulis ke `wp_kc_clinics.clinic_admin_id` (butuh integer).

- Kirim cuid → lolos lookup, lalu `Number(cuid)` = `NaN` masuk ke SQL.
- Kirim `wpUserId` numerik → lookup gagal duluan → 404.

Pakai SQL langsung sampai ini diperbaiki. Lihat §9.

### 4.12 `POST /api/v1/practices/{id}/resend-credentials` — belum ada

Selalu 501: `{"status": false, "message": "Credential email delivery not yet configured."}`

### 4.13 `POST /api/v1/practices/bulk/delete` — SUPER_ADMIN

```bash
curl -X POST https://staging2.praktiqu.com/api/v1/practices/bulk/delete \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"ids":[3,4,5]}'
```

Nonaktifkan (status = 0), bukan hapus. Balas `{"message":"Practices deactivated","data":{"updated":3}}`.
`ids` harus integer positif, minimal satu.

### 4.14 `POST /api/v1/practices/bulk/status` — SUPER_ADMIN

Body: `{"ids":[3,4], "status":1}` — `status` harus `0` atau `1`.
Balas `{"message":"Practice statuses updated","data":{"updated":2}}`.

### 4.15 `GET /api/v1/practices/export` — SUPER_ADMIN

Unduhan JSON (`Content-Disposition: attachment; filename="practices-export.json"`),
isinya array `PracticeDTO` tanpa pembungkus. Query `?status=0` atau `?status=1` menyaring
hasilnya — dan di sini filternya benar-benar bekerja dua arah, beda dengan §4.1.

---

## 5. Endpoints — Services (penugasan dokter)

`{id}` di semua path ini adalah **`wp_users.ID` dokter** (= `wpUserId`), bukan cuid.
Segmen non-numerik ditolak 400 sebelum menyentuh database.

### 5.1 `GET /api/v1/professionals/{id}/services`

```bash
curl https://staging2.praktiqu.com/api/v1/professionals/204/services \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "professionalId": 204,
  "services": [
    {
      "id": 88,
      "serviceId": 12,
      "serviceName": "Konsultasi Psikologi",
      "durationMinutes": 60,
      "charges": "350000",
      "isPublic": true
    }
  ]
}
```

Yang penting dari bentuk ini:

- **`id` adalah id baris mapping, bukan id service.** Keduanya beda dan tidak bisa
  dipertukarkan. `id` dipakai untuk `bulk/status`; `serviceId` untuk `POST` dan `DELETE`.
- `durationMinutes` dan `charges` diambil dari baris mapping milik dokter itu — bukan
  harga/durasi katalog. Inilah yang benar-benar dipakai untuk booking dan tagihan.
- `durationMinutes` bisa `null`, artinya durasi mengikuti `time_slot` dari sesi klinik
  dokter tersebut (lihat `wp_kc_clinic_sessions`).
- `serviceName` memakai alias khusus dokter kalau ada, jatuh ke nama katalog kalau tidak.

### 5.2 `POST /api/v1/professionals/{id}/services` — assign

```bash
curl -X POST https://staging2.praktiqu.com/api/v1/professionals/204/services \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"serviceId": 12, "clinicId": 1}'
```

| Field | Wajib | Keterangan |
|---|---|---|
| `serviceId` | ✅ | id di `wp_kc_services` |
| `clinicId` | ❌ | default: klinik si aktor; `0` kalau aktor tak punya klinik |

Sukses → **201** `{"id": 88, "professionalId": 204, "serviceId": 12}` (`id` = mapping id).

Perilaku yang perlu diantisipasi:

- **Service nonaktif ditolak 422** — hanya service ACTIVE yang bisa di-assign.
- **Assign ulang bukan error.** Unassign itu soft flip status, jadi barisnya masih ada
  dan akan diaktifkan kembali, bukan diduplikasi. Tabel mapping tidak punya unique
  constraint, jadi insert buta memang akan menggandakan — makanya ditangani begini.
- `serviceId` tidak ada → 404 `service_not_found`.
- **`charges`, `durationMinutes`, dan `isPublic` belum bisa diset dari API.** Service
  layer mendukungnya, tapi route-nya tidak meneruskan ketiganya, jadi baris baru memakai
  default. Ubah lewat admin KiviCare atau SQL.

### 5.3 `DELETE /api/v1/professionals/{id}/services?serviceId=...` — unassign

```bash
curl -X DELETE "https://staging2.praktiqu.com/api/v1/professionals/204/services?serviceId=12" \
  -H "Authorization: Bearer $TOKEN"
```

`serviceId` lewat **query param**, bukan body. Tanpa itu → 400.

Balas `{"ok": true}`. **Ini soft flip (`status = 0`), bukan DELETE row** — appointment
lama merujuk baris mapping ini untuk harga dan durasinya; menghapusnya akan mencabut
keduanya dari booking historis. Mapping tidak ditemukan → 404.

### 5.4 `POST /api/v1/professionals/{id}/services/bulk/delete`

Body `{"serviceIds": [12, 13, 14]}` → `{"updated": 3}`. Isinya **service id**, dan sama
seperti §5.3 ini soft flip.

### 5.5 `POST /api/v1/professionals/{id}/services/bulk/status`

```bash
curl -X POST https://staging2.praktiqu.com/api/v1/professionals/204/services/bulk/status \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"serviceIds": [88, 89], "status": "inactive"}'
```

> ⚠️ **Field-nya bernama `serviceIds`, tapi yang dibaca adalah MAPPING id** (kolom `id`
> dari respons §5.1), bukan `serviceId`. Penamaannya menyesatkan; ini yang membedakannya
> dari `bulk/delete` di §5.4. Alasannya: status menempel di baris mapping, dan satu
> service bisa dipetakan ke satu dokter di beberapa klinik dengan status berbeda.

`status`: `"inactive"` atau `"0"` → nonaktif; **nilai lain apa pun** → aktif. Balas
`{"updated": n}`.

### 5.6 `GET /api/v1/professionals/{id}/services/export`

Unduhan JSON (`doctor-services-{id}.json`), array `AssignedService` tanpa pembungkus.

---

## 6. Endpoints publik (tanpa auth)

Untuk halaman booking. Semuanya `force-dynamic`, jadi tidak di-cache.

### `GET /api/v1/public/practices`

Klinik **aktif saja**, diurutkan menurut nama, **dibatasi 100 dan tanpa paginasi**.

```json
{
  "data": [
    {
      "id": 1, "name": "PraktiQU Jakarta", "email": "halo@praktiqu.com",
      "telephoneNo": "+62211234567", "address": "Jl. Sudirman No. 1",
      "city": "Jakarta", "state": "DKI Jakarta", "country": "Indonesia",
      "postalCode": "10220", "specialties": ["Psikologi Klinis"]
    }
  ]
}
```

Field internal seperti `status`, `timezone`, `logoUrl`, dan `businessHours` sengaja tidak
ikut. Sebagai gantinya ada `specialties`.

### `GET /api/v1/public/practices/{id}`

`{ "data": PublicClinic }`. Klinik nonaktif dibalas **404**, bukan 403 — bagi publik
klinik itu memang harus tidak ada.

### `GET /api/v1/public/professionals/{id}/services`

```json
{
  "data": [
    { "id": 12, "name": "Konsultasi Psikologi", "price": "350000",
      "durationMinutes": 60, "serviceType": "consultation" }
  ]
}
```

Beda dari §5.1, dan bedanya penting:

- **`id` di sini adalah `serviceId`**, bukan mapping id.
- Hanya service yang ditandai **publik** yang muncul (`is_public = 1`).
- `price` adalah tarif si dokter (`charges`), bukan harga katalog — itu yang dibayar
  pasien. Default `"0"` kalau kosong.
- Dokter nonaktif / tidak ada → 404.

---

## 7. Format error

Sebagian besar error mengikuti RFC 7807 (`problem+json`):

```json
{ "type": "/errors/resource-not-found", "title": "Practice not found",
  "status": 404, "detail": "Practice 99 does not exist." }
```

Error validasi menambahkan `issues`:

```json
{ "type": "/errors/validation-error", "title": "Validation Error", "status": 422,
  "issues": [{ "path": "endDate", "message": "endDate must be on or after startDate" }] }
```

| Status | Kapan muncul |
|---|---|
| 400 | JSON tidak valid; id path bukan numerik; `serviceId` query hilang |
| 401 | Token tidak ada / kedaluwarsa |
| 403 | Role tidak cukup, atau di luar scope klinik |
| 404 | Resource tidak ada (juga dipakai agar keberadaan resource tidak bocor lewat 403) |
| 409 | Konflik penugasan service |
| 422 | Gagal validasi skema |
| 501 | Endpoint stub (§4.2, §4.12) |

Perlu diingat: **rute service bulk (§5.4–§5.6) tidak memakai format ini.** Mereka membalas
`{"error": "..."}` polos. Kalau front-end punya error handler terpusat, siapkan
penanganan untuk kedua bentuk.

---

## 8. Alur umum

**Menyiapkan katalog service seorang dokter**

1. `GET /api/v1/professionals/{id}/services` — lihat yang sudah ada.
2. `POST` dengan `{serviceId, clinicId}` untuk menambah.
3. Atur `charges` / `durationMinutes` / `isPublic` lewat admin KiviCare (belum ada di API).
4. Cek hasil publiknya di `GET /api/v1/public/professionals/{id}/services`.

**Mengubah jam operasional & libur klinik**

1. `PATCH /api/v1/practices/{id}` dengan `businessHours` (7 hari sekaligus).
2. `POST /api/v1/practices/{id}/holidays` untuk penutupan tertentu.
3. Verifikasi lewat `GET /api/v1/public/professionals/{id}/slots` — slot generator
   mengurangi off-day dan booking yang sudah ada.

**Menonaktifkan klinik**

`DELETE /api/v1/practices/{id}` (soft). Klinik langsung hilang dari semua endpoint
publik. Aktifkan lagi dengan `PATCH {"status": 1}`.

---

## 9. Batasan & bug yang sudah diketahui

Semua sudah diverifikasi dari kode per 2026-08-05, bukan dugaan.

| # | Masalah | Dampak |
|---|---|---|
| 1 | `POST /practices` balas 501 | Klinik baru harus lewat provisioning WordPress |
| 2 | Rute `[holidayId]` tidak ada (§4.9) | Hapus hari libur mustahil lewat API — 404 atau 500 |
| 3 | `change-admin` mencampur id cuid dan integer (§4.11) | Endpoint gagal untuk input apa pun |
| 4 | `?status=0` di `GET /practices` tidak menyaring (§4.1) | Diam-diam mengembalikan semua baris |
| 5 | `search` tidak tersambung di `GET /practices` | Pencarian harus di sisi klien |
| 6 | `bulk/status` menerima mapping id lewat field `serviceIds` (§5.5) | Kirim service id → 0 baris berubah, tanpa error |
| 7 | `charges`/`durationMinutes`/`isPublic` tak bisa diset saat assign (§5.2) | Baris baru memakai default |
| 8 | `/practices/*` tidak membatasi CLINIC_ADMIN ke kliniknya | CLINIC_ADMIN mana pun bisa baca & PATCH praktik lain — **paling perlu perhatian** |
| 9 | Rute bulk service hanya cek role, tanpa `canEdit` | CLINIC_ADMIN bisa bulk-edit dokter di luar kliniknya |
| 10 | Tidak ada CRUD katalog service | Service baru harus lewat admin KiviCare |

**Soal spec.** [`docs/api/openapi.yaml`](openapi.yaml) hanya di-generate dari Zod untuk
tiga prefix: `/api/v1/clients`, `/api/v1/session-notes`, `/api/v1/intervention-plans`
([`scripts/generate-openapi.ts:56`](../../scripts/generate-openapi.ts:56)). Path practices
dan services **masih hand-maintained** — daftar endpoint-nya benar, tapi detail payload
belum tentu. Dokumen ini dan kode-nya yang jadi acuan sampai kedua prefix itu ikut
di-generate.

---

## 10. Rujukan file

| Bagian | File |
|---|---|
| Route practices | [`src/app/api/v1/practices/`](../../src/app/api/v1/practices/route.ts) |
| Logika practices | [`src/services/practice/service.ts`](../../src/services/practice/service.ts) |
| Skema & DTO practices | [`src/types/practice.ts`](../../src/types/practice.ts) |
| Repo klinik | [`src/repositories/wp/clinics.repo.ts`](../../src/repositories/wp/clinics.repo.ts) |
| Route services | [`src/app/api/v1/professionals/[id]/services/`](../../src/app/api/v1/professionals/%5Bid%5D/services/route.ts) |
| Logika penugasan service | [`src/services/professional/service-assignment.service.ts`](../../src/services/professional/service-assignment.service.ts) |
| Scope & RBAC professionals | [`src/services/professional/route-scope.ts`](../../src/services/professional/route-scope.ts) |
| Katalog publik | [`src/services/public/public-catalog.service.ts`](../../src/services/public/public-catalog.service.ts) |
| Tabel yang dipakai | `wp_kc_clinics`, `wp_kc_clinic_schedule`, `wp_kc_services`, `wp_kc_service_doctor_mapping` |

Dokumen terkait: [`API-ACCESS-GUIDE.md`](API-ACCESS-GUIDE.md) ·
[`KIVICARE-PORT.md`](KIVICARE-PORT.md) ·
[`2026-08-02-frontend-checklist.md`](../handover/2026-08-02-frontend-checklist.md)
