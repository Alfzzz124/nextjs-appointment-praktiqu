# Panduan Endpoint Services (CRUD katalog layanan)

Cara memakai `/api/v1/services` dan `/api/v1/service-categories` — endpoint untuk
**menambah, mengubah, dan menghapus layanan** dari dashboard admin.

Dokumen ini melengkapi [`PRACTICES-AND-SERVICES-GUIDE.md`](PRACTICES-AND-SERVICES-GUIDE.md) §5,
yang membahas endpoint lain: `/api/v1/professionals/{id}/services`, soal **menugaskan**
layanan yang sudah ada ke seorang psikolog. Dua kelompok endpoint, dua pekerjaan berbeda:

| Mau apa | Pakai yang mana |
| --- | --- |
| Bikin layanan baru, ubah harganya, pensiunkan | **Panduan ini** |
| Tugaskan layanan yang sudah ada ke psikolog lain | `/professionals/{id}/services` (panduan itu) |

Terakhir diverifikasi terhadap staging2: 30 Agustus 2026.

---

## 1. Satu hal yang paling sering bikin salah

**`{id}` di `/api/v1/services/{id}` itu id baris *penawaran*, bukan id layanan.**

KiviCare menyimpan layanan di dua tabel:

- `wp_kc_services` — **katalog**, global. Tidak punya `clinic_id`. Dua klinik yang sama-sama
  menawarkan "Konseling Individu" berbagi satu baris di sini.
- `wp_kc_service_doctor_mapping` — layanan itu **sebagaimana ditawarkan satu psikolog di satu
  klinik**. Di sinilah harga, durasi, online/offline, dan status tinggal.

API ini memperlakukan baris kedua sebagai resource-nya, persis seperti KiviCare sendiri. Jadi:

```jsonc
{
  "id": 429,        // <- ini yang dipakai di /services/{id}. Baris mapping.
  "serviceId": 501, // <- id katalog. JANGAN dipakai sebagai {id}.
  "doctorId": 120,
  "clinicId": 32
}
```

Akibatnya yang perlu dipahami:

- Satu layanan yang ditawarkan 3 psikolog = **3 baris**, masing-masing punya `{id}` sendiri.
  Mengubah harga di satu baris tidak mengubah dua lainnya.
- **Harga yang berlaku adalah `price` di respons ini** (kolom `charges` di mapping), bukan
  harga daftar di katalog.

---

## 2. Autentikasi

Sama seperti endpoint `/api/v1` lainnya — Bearer JWT staf:

```bash
curl -s https://staging2.praktiqu.com/api/v1/services \
  -H "Authorization: Bearer $TOKEN"
```

Tanpa token → `401`.

---

## 3. Hak akses

Matriks baca mengikuti KiviCare sendiri (`DoctorServiceController::getServices`):

| Peran | Yang terlihat | Boleh tulis |
| --- | --- | --- |
| `SUPER_ADMIN` | semua klinik | ✅ |
| `CLINIC_ADMIN` | kliniknya sendiri | ✅ (kliniknya sendiri) |
| `RECEPTIONIST` | kliniknya sendiri | ❌ |
| `PROFESSIONAL` | **baris miliknya sendiri**, lintas klinik | ❌ |
| `CLIENT` | tidak ada | ❌ |

Tiga hal yang perlu diketahui frontend:

1. **`clinicId` di query dipaksa.** Kalau `CLINIC_ADMIN` mengirim `?clinicId=99`, dia tetap
   dapat kliniknya sendiri. Bukan error — cukup abaikan saja parameternya untuk peran itu.
2. **Baris klinik lain dijawab `404`, bukan `403`.** Disengaja: supaya keberadaan data klinik
   lain tidak bocor lewat beda status code.
3. **Admin tanpa pemetaan klinik dapat daftar kosong**, bukan `500`. Tapi kalau dia mencoba
   `POST`, jawabannya `403` — dia tidak punya klinik untuk menaruh layanannya.

---

## 4. `GET /api/v1/service-categories`

Daftar kategori. `categoryId` saat membuat layanan menunjuk salah satu dari sini, dan
`value`-nya yang jadi `wp_kc_services.type`.

Semua peran yang login boleh baca. Tidak ada dimensi klinik.

```bash
curl -s https://staging2.praktiqu.com/api/v1/service-categories \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "categories": [
    { "id": 29, "label": "Konseling", "value": "konseling" },
    { "id": 39, "label": "Asesmen", "value": "asesmen" }
  ]
}
```

> Panggil ini untuk mengisi dropdown kategori di form. Di staging ada 43 kategori aktif.

---

## 5. `GET /api/v1/services` — daftar

```bash
curl -s "https://staging2.praktiqu.com/api/v1/services?clinicId=32&perPage=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameter:**

| Parameter | Default | Catatan |
| --- | --- | --- |
| `page` | `1` | |
| `perPage` | `20` | maksimal **100**; lebih dari itu → `422`, bukan dipotong diam-diam |
| `search` | — | cocokkan nama layanan (`LIKE`) |
| `clinicId` | — | diabaikan untuk `CLINIC_ADMIN`/`RECEPTIONIST` (lihat §3) |
| `professionalId` | — | diabaikan untuk `PROFESSIONAL` |
| `includeInactive` | — | **harus persis `true` atau `false`**. Nilai lain → `422` |

> `includeInactive` sengaja tidak pakai coercion boolean biasa: `Boolean('false')` itu `true`
> di JavaScript, dan itu jebakan yang menghasilkan bug diam. Kirim string literalnya.

**Respons:**

```json
{
  "services": [
    {
      "id": 429,
      "serviceId": 501,
      "doctorId": 120,
      "clinicId": 32,
      "name": "Konseling Individu",
      "category": { "id": 29, "label": "Konseling", "value": "konseling" },
      "price": 350000,
      "durationMinutes": 60,
      "telemedService": "no",
      "isPublic": true,
      "isActive": true
    }
  ],
  "total": 250,
  "page": 1,
  "perPage": 20
}
```

Catatan soal field:

- `price` bisa `null`. Itu artinya **belum diisi**, bukan gratis. Layanan gratis tersimpan
  sebagai `0`. Nilai yang tidak bisa dibaca sebagai angka (ada baris lama berisi `"Rp 250.000"`)
  juga dikembalikan `null` daripada dipaksa jadi angka yang salah.
- `name` memakai alias per-psikolog kalau ada, selain itu nama katalog.
- **Tidak ada `createdAt`.** Sengaja — lihat §10.

---

## 6. `POST /api/v1/services` — buat layanan

Hanya `SUPER_ADMIN` dan `CLINIC_ADMIN`.

Satu request menghasilkan **1 baris katalog + 1 baris mapping per psikolog**.

```bash
curl -s https://staging2.praktiqu.com/api/v1/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Konseling Individu",
    "categoryId": 29,
    "price": 350000,
    "duration": 60,
    "doctorIds": [120, 121],
    "clinicId": 32,
    "telemedService": "no",
    "status": 1,
    "isPublic": 1
  }'
```

**Body:**

| Field | Wajib | Aturan |
| --- | --- | --- |
| `name` | ✅ | 1–255 karakter, di-trim |
| `categoryId` | ✅ | harus kategori aktif dari §4 |
| `price` | ✅ | angka ≥ 0 |
| `duration` | ✅ | bilangan bulat **1–1440** menit |
| `doctorIds` | ✅ | array, minimal 1. Duplikat dibuang otomatis |
| `clinicId` | tergantung | diabaikan untuk `CLINIC_ADMIN`; **wajib** untuk `SUPER_ADMIN` |
| `telemedService` | — | `"yes"` \| `"no"`, default `"no"` |
| `status` | — | `0` \| `1`, default `1` |
| `isPublic` | — | `0` \| `1`, default `1` — `0` menyembunyikan dari halaman booking publik |

**Respons `201`:**

```json
{
  "serviceId": 501,
  "name": "Konseling Individu",
  "category": { "id": 29, "label": "Konseling", "value": "konseling" },
  "mappings": [
    { "id": 429, "doctorId": 120 },
    { "id": 430, "doctorId": 121 }
  ]
}
```

Pakai `mappings[].id` kalau selanjutnya mau `PUT`/`DELETE`.

**Yang bisa ditolak:**

| Status | `code` | Kapan |
| --- | --- | --- |
| `400` | `doctors_not_in_clinic` | ada `doctorId` yang tidak terpetakan ke `clinicId` itu |
| `409` | `service_already_offered` | psikolog itu sudah punya layanan bernama sama di klinik itu |
| `422` | `validation_failed` | body tidak lolos tabel di atas; detail per-field ada di `fields` |
| `422` | `clinic_required` | `SUPER_ADMIN` tidak menyebut `clinicId` |
| `403` | — | peran tidak boleh tulis, atau admin tanpa klinik |

Dua hal yang terjadi di balik layar:

- **Katalog dipakai ulang.** Kalau sudah ada baris katalog dengan nama **dan** kategori yang
  sama, `serviceId`-nya dipakai lagi, tidak bikin duplikat. Ini perilaku KiviCare sendiri.
- **Semuanya satu transaksi.** Kalau insert psikolog ke-3 dari 5 gagal, tidak ada satu pun yang
  tertinggal. Request yang ditolak tidak meninggalkan apa-apa.

> ⚠️ `409` di sini **lebih ketat dari KiviCare**. KiviCare akan menyisipkan baris mapping
> kedua yang identik (tabelnya tidak punya unique constraint), dan layanan itu lalu muncul dua
> kali di halaman booking. API ini menolaknya.

---

## 7. `GET /api/v1/services/{id}` — satu layanan

```bash
curl -s https://staging2.praktiqu.com/api/v1/services/429 \
  -H "Authorization: Bearer $TOKEN"
```

Mengembalikan objek yang sama persis dengan satu elemen di `services[]` (§5).

- Baris yang sudah dinonaktifkan (`isActive: false`) **tetap bisa diambil di sini.** Disengaja,
  supaya admin bisa melihat apa yang baru saja dia pensiunkan.
- `{id}` bukan angka → `400`. Tidak ada / di luar cakupan → `404`.

---

## 8. `PUT /api/v1/services/{id}` — ubah

Hanya `SUPER_ADMIN` dan `CLINIC_ADMIN`. Kirim **field yang mau diubah saja**; body kosong → `422`.

```bash
curl -s -X PUT https://staging2.praktiqu.com/api/v1/services/429 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "price": 400000, "duration": 90 }'
```

Field yang boleh: `name`, `categoryId`, `price`, `duration`, `telemedService`, `status`, `isPublic`
— aturannya sama dengan §6.

**`doctorIds` dan `clinicId` tidak bisa diubah di sini.** Memindahkan layanan ke psikolog lain
berarti hapus lalu buat baru. Ini menjaga `PUT` tetap satu baris, satu maksud.

Respons `200` berisi baris yang sudah diperbarui (bentuknya sama dengan §7).

### Dua perilaku yang penting dipahami

**Ubah harga hanya menyentuh baris ini.** Harga daftar di katalog tidak ikut berubah, jadi
klinik lain yang berbagi baris katalog yang sama tidak terpengaruh.

> Ini **penyimpangan sadar dari KiviCare**, yang ikut menulis ulang `wp_kc_services.price` saat
> update. Karena katalog itu global, perilaku KiviCare berarti satu klinik menaikkan harga akan
> mengubah harga daftar yang dilihat klinik lain.

**Ganti nama tidak pernah me-rename baris katalog.** Yang terjadi: API mencari baris katalog
yang sudah bernama baru (dengan kategori yang sama), memakainya kalau ada, membuatnya kalau
belum ada — lalu mengarahkan `serviceId` mapping ini ke sana. Baris katalog lama ditinggalkan
utuh, karena klinik lain mungkin masih memakainya.

Jadi setelah ganti nama, **`serviceId` di respons akan berubah** sementara `id` tetap. Itu benar,
bukan bug.

| Status | `code` | Kapan |
| --- | --- | --- |
| `409` | `service_name_taken` | psikolog itu sudah punya layanan lain bernama sama di klinik itu |
| `422` | `validation_failed` | body tidak valid, atau kosong |
| `404` | `service_not_found` | tidak ada, atau di luar cakupan |

---

## 9. `DELETE /api/v1/services/{id}` — pensiunkan

Hanya `SUPER_ADMIN` dan `CLINIC_ADMIN`.

```bash
curl -s -X DELETE https://staging2.praktiqu.com/api/v1/services/429 \
  -H "Authorization: Bearer $TOKEN"
```

**Ini soft-delete** — `status` jadi `0`, barisnya tidak pernah benar-benar dihapus. Layanan
hilang dari daftar default, dan muncul lagi dengan `?includeInactive=true`.

Respons `200`:

```json
{ "ok": true }
```

Memanggilnya lagi pada baris yang sudah nonaktif tetap `200` dan tidak menulis apa pun —
idempoten.

### Gerbang janji temu

Kalau masih ada janji temu **yang belum lewat dan belum dibatalkan** memakai layanan + psikolog
itu, permintaan ditolak:

```json
{
  "type": "https://staging2.praktiqu.com/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "code": "service_has_upcoming_appointments",
  "detail": "1 upcoming appointment(s) still use this service. Cancel or reschedule them first.",
  "count": 1
}
```

`count` itu jumlah janji temunya — tampilkan apa adanya ke admin ("3 janji temu", bukan
"beberapa"). Saat `409`, **tidak ada apa pun yang tertulis**; layanannya tetap aktif.

Janji temu yang sudah selesai (`CHECK_OUT`) tidak menghalangi. Yang dihitung hanya status yang
benar-benar memakai slot: `BOOKED`, `PENDING`, `CHECK_IN`.

> ⚠️ KiviCare sendiri menghapus keras tanpa cek apa pun. API ini sengaja tidak.

---

## 10. Yang perlu diwaspadai

### ⚠️ Gerbang janji temu bisa dilewati lewat endpoint lama

`DELETE /api/v1/professionals/{id}/services?serviceId=...`, `.../bulk/delete`, dan
`.../bulk/status` menonaktifkan **baris yang sama** tanpa cek janji temu sama sekali.

Artinya admin yang ditolak `409` di sini bisa tetap mempensiunkan layanannya lewat jalur itu,
dan meninggalkan booking yang menyebut layanan yang sudah tidak ditawarkan psikolognya.

**Status per 17 September 2026: masih terbuka.** Selama jalur lama masih dipakai frontend,
jaminan di §9 hanya berlaku kalau dashboard memakai endpoint ini secara eksklusif.

### Tidak ada field "jumlah klien"

Tidak ada kolomnya di mana pun — tidak di katalog, tidak di mapping, tidak di
`wp_kc_appointments`. Kolom `multiple` yang namanya mirip artinya lain: "boleh memilih beberapa
layanan sekaligus saat booking", bukan berapa orang dalam satu sesi.

API ini **tidak menerima maupun mengembalikan** `maxClients`. Jangan taruh input-nya di form —
server akan membuangnya diam-diam. Sesi kelompok butuh lebih dari satu kolom (penahanan slot,
daftar peserta, tagihan per orang) dan akan dikerjakan terpisah.

### Tidak ada `createdAt`

Sengaja dibuang. `wp_kc_service_doctor_mapping.created_at` dideklarasikan `NOT NULL` tapi
KiviCare mengisinya dengan zero-date MySQL — **273 dari 277 baris** di staging berisi
`0000-00-00 00:00:00`, dan Prisma menolak men-decode itu. Men-select kolomnya membuat seluruh
endpoint `500`.

Kalau suatu saat field ini dibutuhkan, perbaiki datanya dulu. Ada test yang mengunci
penghapusannya supaya tidak "dibantu" dikembalikan.

### Katalog itu global

Diulang karena penting: `wp_kc_services` dipakai bersama semua klinik. Itulah sebabnya ganti
nama me-*repoint* dan ubah harga tidak menyentuh katalog. Jangan menulis langsung ke tabel itu
dengan asumsi ia milik satu klinik.

---

## 11. Alur khas

**Tambah layanan baru dari form dashboard**

```
GET  /api/v1/service-categories      -> isi dropdown kategori
GET  /api/v1/professionals?...       -> isi pemilih psikolog
POST /api/v1/services                -> simpan; ambil mappings[].id dari respons
```

**Ubah harga satu penawaran**

```
PUT  /api/v1/services/{mappingId}    { "price": 400000 }
```

**Pensiunkan layanan**

```
DELETE /api/v1/services/{mappingId}
  -> 200            selesai
  -> 409 + count    tampilkan jumlahnya, minta admin batalkan/pindahkan dulu
```

**Tampilkan termasuk yang sudah nonaktif**

```
GET /api/v1/services?clinicId=32&includeInactive=true
```

---

## 12. Referensi error

Semua error memakai bentuk RFC 7807 (`type`, `title`, `status`, `code`, `detail`).

| Status | `code` | Arti |
| --- | --- | --- |
| `400` | `doctors_not_in_clinic` | psikolog yang dipilih tidak bekerja di klinik itu |
| `400` | *tidak ada `code`* | `{id}` di path bukan bilangan bulat positif — bedakan lewat `title: "Invalid service id"` |
| `400` | `invalid_json` | body bukan JSON yang sah |
| `401` | — | token tidak ada atau tidak sah |
| `403` | — | peran tidak boleh menulis, atau aktor tidak punya klinik |
| `404` | `service_not_found` | tidak ada, **atau** milik klinik lain |
| `409` | `service_already_offered` | duplikat saat `POST` |
| `409` | `service_name_taken` | duplikat saat ganti nama |
| `409` | `service_has_upcoming_appointments` | ada `count` janji temu mendatang |
| `422` | `validation_failed` | body tidak valid; cek `fields` |
| `422` | `invalid_query` | query string tidak valid |
| `422` | `clinic_required` | `SUPER_ADMIN` tidak menyebut `clinicId` |

Untuk `422`, `fields` berisi pesan per field:

```json
{
  "status": 422,
  "code": "validation_failed",
  "fields": {
    "duration": ["Duration must be between 1 and 1440 minutes"],
    "name": ["Service name is required"]
  }
}
```

---

## 13. Sumber kebenaran

Spesifikasi OpenAPI di [`openapi.yaml`](openapi.yaml) **di-generate dari skema zod yang
memvalidasi request-nya saat runtime** (`npm run openapi`), jadi ia tidak bisa mengambang dari
kode. Kalau panduan ini dan spesifikasi itu berbeda, percayai spesifikasinya dan perbaiki
panduan ini.

Desain dan alasan di balik keputusannya:
[`docs/superpowers/specs/2026-08-30-services-crud-design.md`](../superpowers/specs/2026-08-30-services-crud-design.md).
