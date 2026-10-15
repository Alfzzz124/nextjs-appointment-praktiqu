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

**Kedua: "services" di bagian §5 artinya penugasan dokter↔service, bukan katalog service.**

| Yang kamu mau | Endpoint | Tabel |
|---|---|---|
| Lihat service yang ditawarkan seorang dokter | `GET /api/v1/professionals/{id}/services` (§5.1) | `wp_kc_service_doctor_mapping` |
| **Bikin / ubah / pensiunkan service** | **`/api/v1/services`** — lihat [`SERVICES-CRUD-GUIDE.md`](SERVICES-CRUD-GUIDE.md) | `wp_kc_services` + mapping |

> **Diperbarui 17 Sep 2026.** Versi lama panduan ini menulis "katalog service belum punya
> endpoint CRUD" dan menyuruh lewat admin KiviCare. Itu **sudah tidak berlaku** sejak
> `/api/v1/services` ada (30 Agu 2026). Semua endpoint **tulis** di §5 kini dipensiunkan dan
> menjawab `410` — yang dibaca (§5.1, §5.6) tetap hidup.

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

### Klinik aktif (admin yang memegang beberapa klinik)

Sejak 2026-10, satu `CLINIC_ADMIN` boleh memegang beberapa klinik (beberapa baris
`wp_kc_clinics` dengan `clinic_admin_id` yang sama). Respons login dan `GET /auth/me`
untuk CLINIC_ADMIN membawa daftarnya, klinik default lebih dulu:

```json
{ "user": { "role": "CLINIC_ADMIN", "clinicId": 4,
            "clinics": [ { "id": 4, "name": "Klinik A", "active": true },
                         { "id": 20, "name": "Klinik B", "active": true } ] } }
```

Pilih klinik untuk satu request dengan header **`X-Praktiqu-Clinic-Id: <id>`**. Tanpa header =
klinik default (`clinicId`). Header hanya dibaca untuk CLINIC_ADMIN; role lain mengabaikannya.

| Kasus | Jawaban |
|---|---|
| Format bukan bilangan bulat positif | 400, body memuat `invalid_clinic_header` |
| Klinik bukan milik admin ini, atau tidak ada | 403, body memuat `clinic_not_in_scope` |

Setiap endpoint ter-scope (daftar, detail, bills, pasien, laporan, pengaturan pembayaran)
mengikuti klinik aktif ini. Klinik di luar klinik aktif tetap 404 seperti biasa.

---

## 3. Ringkasan hak akses

| Endpoint | SUPER_ADMIN | CLINIC_ADMIN | PROFESSIONAL | RECEPTIONIST |
|---|---|---|---|---|
| `GET /practices` | ✅ | 🔸 kliniknya sendiri | ❌ | ❌ |
| `POST /practices` | ✅ | ❌ | ❌ | ❌ |
| `GET/PATCH /practices/{id}` | ✅ | 🔸 kliniknya sendiri, `PATCH` tanpa `status` | ❌ | ❌ |
| `DELETE /practices/{id}`, `POST /practices/{id}/activate` | ✅ | ❌ | ❌ | ❌ |
| `/practices/{id}/settings` | ✅ | ✅ | ❌ | ❌ |
| `/practices/{id}/holidays` | ✅ | ✅ | ❌ | ❌ |
| `GET/PUT /practices/{id}/payment-settings` | ✅ | 🔸 kliniknya sendiri | ❌ | ❌ |
| `GET /practices/{id}/users` | ✅ | ✅ | ❌ | ❌ |
| `POST /practices/{id}/change-admin` | ✅ | ❌ | ❌ | ❌ |
| `/practices/bulk/*`, `/practices/export` | ✅ | ❌ | ❌ | ❌ |
| `GET /professionals/{id}/services` | ✅ | 🔸 se-klinik | 🔸 diri sendiri | 🔸 se-klinik |
| `GET /professionals/{id}/services/export` | ✅ | ⚠️ tanpa cek klinik | ❌ | ❌ |
| `POST/DELETE /professionals/{id}/services` | ⛔ 410 | ⛔ 410 | ⛔ 410 | ⛔ 410 |
| `/professionals/{id}/services/bulk/*` | ⛔ 410 | ⛔ 410 | ⛔ 410 | ⛔ 410 |
| `/api/v1/services` (CRUD katalog) | ✅ | 🔸 kliniknya | baca saja | baca saja |

⛔ = dipensiunkan, menjawab `410 Gone` tanpa memeriksa token sama sekali.

🔸 = dibatasi scope. Untuk `/professionals/*`, scope klinik diambil dari
`wp_kc_doctor_clinic_mappings` — **bukan** dari `practiceId` di JWT (field itu cuid
peninggalan skema lama dan tidak bisa dibandingkan dengan id klinik KiviCare). Lihat
[`route-scope.ts`](../../src/services/professional/route-scope.ts).

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
      "international": false,
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
- `international` (read only) adalah flag Klinik Internasional yang tersimpan — untuk
  badge admin saja. Diubah lewat §4.16, bukan lewat PATCH. Nilainya `false` kalau
  pengaturannya gagal dibaca. Field ini juga ada di §4.3, jawaban §4.4, dan §4.15.

> CLINIC_ADMIN hanya melihat **klinik aktifnya** (header `X-Praktiqu-Clinic-Id`, atau klinik
> default bila tanpa header) — satu baris, walau ia memegang beberapa klinik. Daftar lengkap
> klinik miliknya ada di `user.clinics` respons `/auth/me` (§2).

### 4.2 `POST /api/v1/practices` — tambah klinik (SUPER_ADMIN)

```bash
curl -X POST https://endpoint.praktiqu.com/api/v1/practices \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Klinik Sehat Cimahi",
    "email": "cimahi@kliniksehat.id",
    "telephoneNo": "0226651234",
    "address": "Jl. Amir Machmud 12",
    "city": "Cimahi",
    "country": "Indonesia",
    "admin": { "mode": "new", "name": "Dewi Lestari", "email": "dewi@kliniksehat.id" }
  }'
```

Field klinik sama dengan §4.4, tetapi `name` **wajib** dan `timezone`/`logoUrl`/`businessHours`
tidak diterima (isi lewat `PATCH`). `status` bawaan `1`. Skema `.strict()`.

`admin` (bawaan `{ "mode": "none" }`):

| `mode` | Field lain | Hasil |
|---|---|---|
| `none` | — | `clinic_admin_id = 0`; atur nanti lewat §4.11 |
| `existing` | `wpUserId` (id WordPress akun clinic admin, dari §4.17) | klinik milik akun itu |
| `new` | `name`, `email` | plugin `praktiqu-endpoint` ≥ 1.8.0 membuat akun `kiviCare_clinic_admin` dan mengirim email selamat datang |

Nama klinik menentukan link booking publik `/{slug}`, jadi nama ditolak (409
`clinic_name_conflict`) bila slug-nya kosong (`empty_slug`), hanya angka (`numeric_slug`), kata
route FE (`reserved_slug`), sama dengan klinik lain termasuk yang nonaktif
(`clinic_slug_taken`, dengan `conflictId`/`conflictName`), atau sama dengan link pribadi
psikolog aktif (`professional_slug_taken`).

Respons **201** (tanpa `message`):

```json
{
  "data": { "id": 57, "name": "Klinik Sehat Cimahi", "status": 1, "...": "PracticeDTO" },
  "admin": { "mode": "new", "wpUserId": 912, "emailSent": true }
}
```

`emailSent: false` berarti akun jadi tetapi email gagal terkirim — admin memakai "Lupa sandi".

Error: 422 `validation_error`, 409 `clinic_name_conflict` / `clinic_email_conflict` /
`admin_email_taken`, 422 `not_a_clinic_admin`, 502 `admin_provision_failed` (akun gagal dibuat;
klinik **sudah dihapus lagi**, aman untuk dicoba ulang). Semua pengecekan berjalan sebelum
apa pun ditulis.

### 4.3 `GET /api/v1/practices/{id}`

```bash
curl https://staging2.praktiqu.com/api/v1/practices/1 -H "Authorization: Bearer $TOKEN"
```

Balas `{ "data": { ...PracticeDTO } }`, atau 404 kalau tidak ada.

### 4.4 `PATCH /api/v1/practices/{id}` — update

Semua field opsional (semantik PATCH). Skemanya `.strict()` — **kirim field yang tidak
dikenal → 422**, bukan diabaikan diam-diam.

CLINIC_ADMIN hanya untuk kliniknya sendiri dan **tidak boleh mengirim key `status`** sama
sekali (403 `status_change_forbidden`, walaupun nilainya sama). Nama dan email yang berubah
dicek seperti saat tambah (409 `clinic_name_conflict` / `clinic_email_conflict`). Ingat:
**mengganti nama mengganti link booking publik**, link lama menjadi 404.

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

### 4.5 `DELETE /api/v1/practices/{id}` — nonaktifkan / hapus permanen (SUPER_ADMIN)

Tanpa query: **nonaktifkan** (`status = 0`), semua data tetap. Balas **204**. Aktifkan lagi
dengan §4.18.

`?permanent=true`: **hapus baris klinik**, hanya bila klinik belum punya data sama sekali
(appointment, tagihan, encounter, mapping psikolog/pasien/resepsionis, sesi, layanan,
follow-up, pajak, notifikasi). Hari libur dan pengaturan pembayaran internasional klinik itu
ikut terhapus; akun admin tidak. Balas **204**, atau **409**:

```json
{ "type": "/errors/clinic-not-empty", "status": 409, "code": "clinic_not_empty",
  "counts": { "appointments": 12, "doctors": 3 } }
```

`counts` hanya memuat kunci yang > 0.

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

### 4.11 `POST /api/v1/practices/{id}/change-admin` — SUPER_ADMIN

Menjadikan seorang admin klinik sebagai admin klinik `{id}`. Satu klinik punya satu admin;
satu admin boleh memegang beberapa klinik. Admin lama kehilangan klinik ini seketika.

Body: `{ "newAdminId": 911 }` — `wp_users.ID` (angka atau string angka) yang punya
capability `kiviCare_clinic_admin`.

| Kasus | Jawaban |
|---|---|
| Bukan SUPER_ADMIN | 403 |
| Klinik tidak ada / id bukan angka | 404 |
| Body bukan JSON | 400 |
| `newAdminId` hilang/tidak sah | 422 |
| Akun bukan admin klinik / tidak ada | 422, `code: "not_a_clinic_admin"` |

Sukses (200):

```json
{ "message": "Practice admin updated",
  "data": { "clinicId": 20, "adminId": 911, "previousAdminId": 512,
            "previousAdminClinicCount": 0, "unchanged": false } }
```

`previousAdminClinicCount` = jumlah klinik yang masih dipegang admin lama; `0` berarti ia
kini tidak memegang klinik apa pun. `unchanged: true` = akun itu sudah admin klinik ini
(tidak ada yang ditulis, tidak ada audit). Perubahan dicatat di audit log
`practice.admin_changed`.

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

### 4.16 `GET` / `PUT /api/v1/practices/{id}/payment-settings` — pembayaran internasional

Pengaturan **Klinik Internasional**: klinik yang ditandai menerima PayPal & kartu (USD),
dengan kurs, markup persen, dan fee flat rupiah miliknya sendiri. Klinik lain hanya Xendit.

- **Akses:** SUPER_ADMIN untuk klinik mana pun; CLINIC_ADMIN hanya kliniknya sendiri
  (klinik lain → **404**, bukan 403); role lain → **403**. Id yang tidak ada di
  `wp_kc_clinics` → 404, dan PUT-nya tidak pernah sampai ke plugin.
- **Disimpan** di `wp_options` `praktiqu_endpoint_clinic_{id}_payment` (string JSON), ditulis
  lewat plugin `PUT /praktiqu/v1/clinics/{id}/payment-settings`. Setiap simpan dicatat di
  `log_entries` (AUDIT, action `clinic.payment_settings.updated`, berisi `before`/`after`).
- Sengaja **terpisah** dari §4.6: pengaturan uang butuh jejak audit yang jelas.

`PUT` — semua key **wajib** (PUT mengganti seluruh objek); `null` artinya "pakai nilai
global" untuk kurs/markup dan "tanpa fee" untuk fee:

```bash
curl -X PUT https://endpoint.praktiqu.com/api/v1/practices/4/payment-settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"international":true,"fxRate":18000,"markupPercent":10,"fixedFeeIdr":25000}'
```

| Field | Aturan |
|---|---|
| `international` | boolean |
| `fxRate` | `null`, atau 1.000–100.000 **rupiah per 1 USD**, maks 2 desimal |
| `markupPercent` | `null`, atau 0–100, maks 2 desimal |
| `fixedFeeIdr` | `null`, atau bilangan bulat 0–10.000.000 |
| silang | `international: true` butuh kurs yang bisa dipakai — dari klinik atau dari opsi global WordPress |

`GET` dan jawaban `PUT` (PUT membaca ulang opsi yang tersimpan, bukan menggemakan input):

```json
{
  "data": {
    "clinicId": 4,
    "stored": { "international": true, "fxRate": 18000, "markupPercent": 10, "fixedFeeIdr": 25000 },
    "effective": {
      "international": true,
      "methods": ["xendit", "paypal", "card"],
      "fxRate": "18000", "markupPercent": "10", "fixedFeeIdr": "25000",
      "source": { "fxRate": "clinic", "markupPercent": "clinic", "fixedFeeIdr": "clinic" }
    },
    "globalDefaults": { "fxRate": 16500, "markupPercent": 5 },
    "example": { "price": "12.23", "taxes": [], "fee": "1.39", "total": "13.62", "idr": 200000 },
    "updatedAt": "2026-10-06T08:00:00+00:00",
    "updatedBy": { "wpUserId": 123, "name": "Dewi Admin" }
  }
}
```

- `stored` = nilai milik klinik; tanpa pengaturan: `international: false`, sisanya `null`.
- `effective` = yang akan dipakai pembayaran, beserta sumbernya (`clinic` / `global` /
  `default`), apa pun flag-nya. `fxRate` bisa `null` kalau tidak ada kurs yang bisa dipakai
  (termasuk saat markup global yang akan dipakai terisi tapi tidak valid, lihat di bawah).
- `globalDefaults` = kurs & markup global, untuk placeholder form. Angkanya hanya hasil
  baca, belum tentu bisa dipakai (kurs 1.000–100.000, markup 0–100, maks 2 desimal).
  Kalau sebuah opsi global **terisi tapi bukan desimal biasa** (mis. `1e1`, `.5`, `+10`),
  objek ini membawa `invalid` berisi teks mentahnya, misalnya
  `"globalDefaults": { "fxRate": 16500, "markupPercent": null, "invalid": { "markupPercent": "1e1" } }`.
  Itu **bukan** "belum diisi": markup global yang tidak valid (dan klinik tidak punya markup
  sendiri) mengosongkan kurs klinik itu, termasuk kurs miliknya sendiri, sehingga PayPal/kartu
  menjawab 503 `paypal_rate_missing`; kurs global yang tidak valid diabaikan, jadi klinik tanpa
  kurs sendiri juga tanpa kurs. Tampilkan peringatan ke admin supaya opsinya dibetulkan di
  WordPress; `invalid` tidak ada kalau semuanya terbaca.
- `example` = Rp 200.000 dalam USD dengan nilai efektif; dihitung selama ada kurs, bahkan
  sebelum klinik ditandai, supaya admin bisa melihat pratinjau. `null` kalau tidak ada kurs.
- `updatedBy` = `null`, atau nama dari `users.displayName` (cadangan `wp_users.display_name`).

Error (`problem+json` dengan `code`):

| Status | `code` | Kapan |
|---|---|---|
| 400 | `invalid_json` | Body bukan JSON |
| 404 | `practice_not_found` | Klinik tidak ada / di luar scope CLINIC_ADMIN |
| 422 | `invalid_input` | Gagal validasi; `fields` berisi pesan per field (`body` untuk key tak dikenal). Juga saat validasi WordPress sendiri menolak: `fields.body` = `["WordPress rejected the settings"]`, mengulang body yang sama akan gagal lagi |
| 422 | `fx_rate_required` | `international: true` tanpa kurs yang bisa dipakai; `fields.fxRate` |
| 500 | `internal_error` | Kegagalan tak terduga; tercatat di log |
| 502 | `payment_settings_save_failed` | WordPress gagal menyimpan; tidak ada audit |
| 503 | `payment_settings_unavailable` | Pengaturan gagal dibaca. Pada PUT bisa juga berarti simpan sudah berhasil tapi baca ulang gagal: GET ulang dulu sebelum mencoba lagi |

### 4.17 `GET /api/v1/practices/clinic-admins` — SUPER_ADMIN

Semua akun WordPress yang ber-capability `kiviCare_clinic_admin`, urut nama — termasuk yang
belum pernah login ke API.

```json
{ "data": [ { "wpUserId": 911, "name": "Admin Satu", "email": "a@klinik.co", "clinicIds": [4, 20] } ],
  "total": 1 }
```

`clinicIds` = klinik yang `clinic_admin_id`-nya akun ini. Role lain: 403.

### 4.18 `POST /api/v1/practices/{id}/activate` — aktifkan kembali (SUPER_ADMIN)

Tanpa body. Balas **200** `{ "data": { ...PracticeDTO, "status": 1 } }`, atau 404.

---

## 5. Endpoints — Services (penugasan dokter)

`{id}` di semua path ini adalah **`wp_users.ID` dokter** (= `wpUserId`), bukan cuid.
Segmen non-numerik ditolak 400 sebelum menyentuh database.

> ## ⛔ Semua endpoint TULIS di bagian ini dipensiunkan (17 Sep 2026)
>
> `POST` (§5.2), `DELETE` (§5.3), `bulk/delete` (§5.4), dan `bulk/status` (§5.5) sekarang
> menjawab **`410 Gone`** dan menunjuk penggantinya. Pakai `/api/v1/services` —
> lihat [`SERVICES-CRUD-GUIDE.md`](SERVICES-CRUD-GUIDE.md).
>
> **Yang dibaca tetap hidup:** §5.1 (`GET`) dan §5.6 (`export`) tidak berubah.
>
> Alasannya bukan kerapian. Keempatnya menulis ke `wp_kc_service_doctor_mapping`, tabel yang
> sama dengan `/api/v1/services`, tapi dengan aturan berbeda: tanpa pemeriksaan janji temu
> mendatang, dan `DELETE`-nya **tanpa filter klinik** — satu klik mematikan layanan itu di
> setiap klinik tempat psikolog tersebut bekerja, termasuk klinik yang adminnya tidak punya
> hak apa pun atasnya.
>
> Penghapusan fisik dijadwalkan **1 Desember 2026**. Sampai saat itu setiap panggilan
> membalas `410` dengan header `Sunset` dan `Link: rel="successor-version"`.

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

### 5.2 `POST /api/v1/professionals/{id}/services` — ⛔ DIPENSIUNKAN (410)

> Pakai `POST /api/v1/services`. Kirim nama dan `categoryId` yang sama dengan layanan yang
> sudah ada — baris katalognya dipakai ulang, jadi efeknya sama dengan "assign", ditambah
> bisa mengatur harga dan durasi sekaligus.

<details><summary>Perilaku lama (arsip)</summary>

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

</details>

### 5.3 `DELETE /api/v1/professionals/{id}/services?serviceId=...` — ⛔ DIPENSIUNKAN (410)

> Pakai `DELETE /api/v1/services/{id}`, dengan `{id}` = id baris penawaran.

<details><summary>Perilaku lama (arsip)</summary>

```bash
curl -X DELETE "https://staging2.praktiqu.com/api/v1/professionals/204/services?serviceId=12" \
  -H "Authorization: Bearer $TOKEN"
```

`serviceId` lewat **query param**, bukan body. Tanpa itu → 400.

Balas `{"ok": true}`. **Ini soft flip (`status = 0`), bukan DELETE row** — appointment
lama merujuk baris mapping ini untuk harga dan durasinya; menghapusnya akan mencabut
keduanya dari booking historis. Mapping tidak ditemukan → 404.

</details>

### 5.4 `POST /api/v1/professionals/{id}/services/bulk/delete` — ⛔ DIPENSIUNKAN (410)

> Panggil `DELETE /api/v1/services/{id}` per baris.

<details><summary>Perilaku lama (arsip)</summary>

Body `{"serviceIds": [12, 13, 14]}` → `{"updated": 3}`. Isinya **service id**, dan sama
seperti §5.3 ini soft flip.

</details>

### 5.5 `POST /api/v1/professionals/{id}/services/bulk/status` — ⛔ DIPENSIUNKAN (410)

> Pakai `PUT /api/v1/services/{id}` dengan `{ "status": 0 }` atau `{ "status": 1 }`.

<details><summary>Perilaku lama (arsip)</summary>

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

</details>

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
      "postalCode": "10220", "specialties": ["Psikologi Klinis"],
      "international": false, "paymentMethods": ["xendit"]
    }
  ]
}
```

Field internal seperti `status`, `timezone`, `logoUrl`, dan `businessHours` sengaja tidak
ikut. Sebagai gantinya ada `specialties`. `paymentMethods` adalah metode bayar klinik itu
(`["xendit"]` kecuali klinik internasional dengan kurs yang bisa dipakai); `international`
hanya untuk badge — lihat [`PAYMENT-METHODS-GUIDE.md`](PAYMENT-METHODS-GUIDE.md).

### `GET /api/v1/public/practices/{id}`

`{ "data": PublicClinic }`. Klinik nonaktif dibalas **404**, bukan 403 — bagi publik
klinik itu memang harus tidak ada.

### `GET /api/v1/public/professionals/{id}/services`

```json
{
  "data": [
    { "id": 12, "name": "Konsultasi Psikologi", "price": "350000",
      "durationMinutes": 60, "serviceType": "consultation",
      "clinicId": 4, "paymentMethods": ["xendit", "paypal", "card"],
      "usd": { "price": "21.39", "taxes": [], "fee": "1.39", "total": "22.78" } }
  ]
}
```

Beda dari §5.1, dan bedanya penting:

- **`id` di sini adalah `serviceId`**, bukan mapping id.
- Hanya service yang ditandai **publik** yang muncul (`is_public = 1`).
- `price` adalah tarif si dokter (`charges`), bukan harga katalog — itu yang dibayar
  pasien. Default `"0"` kalau kosong.
- Dokter nonaktif / tidak ada → 404.
- **Satu baris per klinik.** Service yang sama di dua klinik muncul dua kali, masing-masing
  dengan `clinicId`-nya. Booking harus dikirim dengan `clinicId` baris yang dipilih, supaya
  USD yang ditampilkan sama dengan yang ditagih.
- `paymentMethods` dan `usd` per baris: `usd` hanya terisi untuk klinik internasional dengan
  kurs yang bisa dipakai dan harga di atas Rp 0. Semua angka USD berupa string 2 desimal dan
  dihitung dengan fungsi yang sama dengan penagihan — FE tidak pernah mengonversi sendiri.

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
| 409 | Konflik penugasan service; nama/email klinik bentrok; email admin sudah terdaftar; klinik masih punya data (§4.2, §4.5) |
| 422 | Gagal validasi skema |
| 501 | Endpoint stub (§4.12) |
| 502 | Plugin WordPress gagal membuat akun admin (§4.2) |

Error dari route `/practices/*` membawa field **`code`** (slug stabil, aman untuk dicocokkan
FE): `validation_error`, `practice_not_found`, `clinic_name_conflict` (+ `reason`, `slug`),
`clinic_email_conflict`, `admin_email_taken`, `not_a_clinic_admin`, `clinic_not_empty`
(+ `counts`), `admin_provision_failed`, `status_change_forbidden`, `forbidden`.

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
| 3 | ~~`change-admin` mencampur id cuid dan integer~~ — **diperbaiki 2026-10** (§4.11) | — |
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
| Pembayaran internasional (§4.16) | [`src/app/api/v1/practices/[id]/payment-settings/route.ts`](../../src/app/api/v1/practices/%5Bid%5D/payment-settings/route.ts), [`src/services/practice/payment-settings.service.ts`](../../src/services/practice/payment-settings.service.ts) |
| Hitungan USD | [`src/services/payments/intl-pricing.ts`](../../src/services/payments/intl-pricing.ts) |
| Tabel yang dipakai | `wp_kc_clinics`, `wp_kc_clinic_schedule`, `wp_kc_services`, `wp_kc_service_doctor_mapping` |

Dokumen terkait: [`API-ACCESS-GUIDE.md`](API-ACCESS-GUIDE.md) ·
[`KIVICARE-PORT.md`](KIVICARE-PORT.md) ·
[`2026-08-02-frontend-checklist.md`](../handover/2026-08-02-frontend-checklist.md)
