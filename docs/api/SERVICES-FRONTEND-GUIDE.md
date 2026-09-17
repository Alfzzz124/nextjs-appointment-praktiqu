# Implementasi Services CRUD di Frontend

Panduan untuk yang mengerjakan dashboard (Laravel `terpadu.praktiqu.com`). Referensi
endpoint lengkapnya di [`SERVICES-CRUD-GUIDE.md`](SERVICES-CRUD-GUIDE.md); dokumen ini soal
**apa yang perlu diubah di FE**, berbasis kode yang ada sekarang.

Diverifikasi 17 September 2026 terhadap `raakanaka/laravel-praktiqu` @ `f6386be` dan API di
staging2.

> ## ✅ Sudah dikerjakan
>
> Seluruh isi panduan ini sudah diimplementasikan di branch
> **`fix/services-field-names-and-duration-step`** pada `raakanaka/laravel-praktiqu`
> (commit `f67a0bb`), termasuk bug input durasi. 434/434 test FE lolos.
>
> Dokumen ini dipertahankan sebagai penjelasan **kenapa** tiap perubahan dibuat — berguna
> saat me-review PR-nya, dan saat ada yang bertanya-tanya kenapa kategori tidak boleh
> diketik bebas.

---

## 0. Yang paling mendesak: form Tambah Layanan saat ini selalu gagal

`ServiceController::payload()` mengirim nama field **REST KiviCare**, bukan nama field
`/api/v1/services`. Komentarnya sendiri menjelaskan kenapa — waktu itu bentuk endpointnya
memang belum bisa dibaca dari mana pun, jadi ditebak dari `DoctorServiceController`. Tebakan
yang masuk akal, tapi meleset.

Dibuktikan ke staging dengan payload persis seperti yang dikirim FE sekarang:

```bash
POST /api/v1/services
{"name":"...","category":"konseling","price":100000,"duration":60,
 "status":1,"telemed_service":"no","doctors":[120],"clinics":[32]}
```

```json
{
  "status": 422,
  "code": "validation_failed",
  "fields": { "categoryId": ["Required"], "doctorIds": ["Required"] }
}
```

Jadi tombol Simpan tidak pernah berhasil. Perbaikannya mekanis:

| Dikirim sekarang | Harus jadi | Catatan |
| --- | --- | --- |
| `category: "konseling"` | `categoryId: 29` | **integer**, bukan teks — lihat §1 |
| `doctors: [120]` | `doctorIds: [120]` | isinya sama, namanya saja |
| `clinics: [32]` | `clinicId: 32` | angka tunggal, bukan array |
| `telemed_service: "no"` | `telemedService: "no"` | camelCase |
| — | `isPublic: 1` | opsional, default `1` |

`name`, `price`, `duration`, `status` sudah benar.

> Field yang tidak dikenal **dibuang diam-diam**, tidak ditolak. Jadi `telemed_service` yang
> salah nama tidak memicu error — layanannya cuma jadi offline padahal admin memilih online.
> Itu jenis kegagalan yang paling lama tidak ketahuan.

---

## 1. `category` harus jadi dropdown, bukan teks bebas

Sekarang ([`dashboard.blade.php:3075`](#)):

```html
<input x-model="svcForm.category" placeholder="mis. konseling, asesmen, psikoterapi" required>
```

API menuntut `categoryId` — id baris di `wp_kc_static_data`, bukan kata bebas. FE belum
pernah memanggil endpoint daftarnya.

**Yang perlu ditambahkan:**

```
GET /api/v1/service-categories
→ { "categories": [ { "id": 29, "label": "Konseling", "value": "konseling" }, ... ] }
```

Isi `<select>` dari situ, simpan `id`-nya. Di staging ada **43 kategori aktif**, jadi
pertimbangkan combobox yang bisa diketik-cari daripada `<select>` polos.

Kenapa tidak boleh teks bebas: kategori ikut menentukan identitas baris katalog. Dua layanan
bernama sama tapi beda kategori adalah dua baris berbeda, dan aturan anti-duplikat memakai
pasangan nama+kategori. Teks bebas berarti "Konseling", "konseling", dan "Konselling" jadi
tiga kategori berbeda dalam sebulan.

**Saat mengisi form edit**, `GET /api/v1/services/{id}` sudah mengembalikan objeknya utuh,
jadi tinggal dipasang:

```json
"category": { "id": 29, "label": "Konseling", "value": "konseling" }
```

Pakai `category.id` sebagai nilai terpilih. Baris lama yang snapshot kategorinya rusak
mengembalikan `category: null` — tampilkan sebagai "belum dikategorikan", jangan crash.

---

## 2. `{id}` yang dipakai untuk edit dan hapus

Respons daftar punya **dua** id. Yang dipakai di URL adalah `id`, bukan `serviceId`:

```json
{ "id": 429, "serviceId": 501, "doctorId": 120, "clinicId": 32 }
```

- `id` → baris penawaran. Ini yang masuk ke `PUT /services/{id}` dan `DELETE /services/{id}`.
- `serviceId` → baris katalog, dipakai bersama klinik lain. **Jangan** dipakai di URL.

Satu layanan yang ditawarkan 3 psikolog muncul sebagai **3 baris** dengan 3 `id` berbeda.
Kalau daftar di UI mau digabung per nama, simpan tetap `id` masing-masing baris — tombol
Edit/Hapus bekerja per baris, bukan per nama.

> Setelah **ganti nama**, `serviceId` di respons akan berubah sementara `id` tetap. Itu benar:
> mapping-nya dipindahkan ke baris katalog lain supaya klinik lain yang memakai nama lama
> tidak ikut berubah. Jangan diperlakukan sebagai anomali.

---

## 3. Edit: kirim yang berubah saja

`PUT` menerima subset dari `name`, `categoryId`, `price`, `duration`, `telemedService`,
`status`, `isPublic`. Body kosong → `422`.

`ServiceController::update()` sekarang mengirim payload penuh hasil `validasi()`, yang
mewajibkan semua field. Itu tetap jalan — tapi ada dua hal:

- **`doctorIds` dan `clinicId` tidak bisa diubah lewat `PUT`** dan akan dibuang. Memindahkan
  layanan ke psikolog lain = hapus lalu buat baru. Kalau form edit menampilkan pemilih
  psikolog, perubahannya tidak akan tersimpan — lebih baik dinonaktifkan di mode edit,
  dengan keterangan.
- Mengirim field yang tidak berubah tidak berbahaya, tapi mengirim **hanya yang berubah**
  membuat log audit lebih berguna, dan `PUT` dengan patch kosong sengaja tidak menulis apa pun
  maupun mencatat audit.

---

## 4. Hapus: tampilkan `count` apa adanya

`teruskan()` sudah meneruskan pesan backend apa adanya — itu keputusan yang tepat, pertahankan.
Satu tambahan: badan `409` membawa `count`.

```json
{
  "status": 409,
  "code": "service_has_upcoming_appointments",
  "detail": "3 upcoming appointment(s) still use this service. Cancel or reschedule them first.",
  "count": 3
}
```

Fallback yang ada sekarang berbunyi *"masih dipakai janji temu yang sudah tercatat … Nonaktifkan
saja."* — dua hal yang perlu dikoreksi:

1. Yang memblokir adalah janji temu **yang belum jalan**, bukan riwayat. Janji temu lama tidak
   pernah menghalangi; nama layanannya aman karena riwayat menunjuk baris katalog, dan katalog
   tidak pernah dihapus.
2. Saran "nonaktifkan saja" **tidak menghindari masalahnya** — `DELETE` di API ini memang sudah
   nonaktifkan (soft delete), dan itulah yang sedang ditolak. Yang perlu dilakukan admin adalah
   membatalkan atau memindahkan janji temunya dulu.

Usulan pesan: *"Masih ada {count} janji temu mendatang yang memakai layanan ini. Batalkan atau
pindahkan dulu, baru layanan ini bisa dipensiunkan."*

Dan karena `DELETE` itu soft, layanan yang berhasil dihapus **masih bisa ditampilkan** dengan
`?includeInactive=true` — berguna kalau mau ada tombol "tampilkan yang nonaktif".

---

## 5. `price: null` bukan gratis

`price` bisa `null`, artinya **belum diisi**. Gratis tersimpan sebagai `0`. Baris lama yang
isinya tidak terbaca sebagai angka (ada yang berisi `"Rp 250.000"`) juga dikembalikan `null`
daripada dipaksa jadi angka yang salah.

Jadi jangan render `null` sebagai `Rp 0`. Bedakan: `null` → "—" atau "belum diatur",
`0` → "Gratis".

---

## 6. Yang sudah benar — jangan diubah

Tiga keputusan di `ServiceController` yang sengaja dibuat dan sebaiknya dipertahankan:

- **`doctors` wajib.** Alasannya tepat: layanan tanpa psikolog tidak akan muncul di halaman
  booking mana pun. Backend memang juga menolaknya (`doctorIds` minimal 1), tapi alasan di
  komentar itu yang benar.
- **Tidak ada kotak "jumlah klien".** Benar. Tidak ada kolomnya di mana pun, dan `multiple` /
  `allow_multi` artinya lain ("boleh pilih beberapa layanan sekaligus saat booking"). Backend
  akan membuangnya diam-diam.
- **Meneruskan penolakan backend apa adanya.** `422` dari API selalu menyebut field yang salah
  di `fields`; menerjemahkannya jadi "gagal menyimpan" akan menghapus satu-satunya petunjuk
  yang berguna.

Satu penyempurnaan untuk yang terakhir: `fields` berbentuk `{ "duration": ["..."], ... }`, jadi
bisa dipasang langsung ke pesan error per-input, bukan hanya satu banner.

---

## 7. Endpoint lama yang dipensiunkan — tidak ada yang perlu diubah

Empat endpoint tulis di bawah `/professionals/{id}/services` sekarang menjawab **`410 Gone`**:
`POST`, `DELETE`, `bulk/delete`, dan `bulk/status`. Penghapusan fisiknya 1 Desember 2026.

**FE tidak memanggil satu pun dari keempatnya** — sudah diperiksa, sisa satu-satunya adalah
komentar di `ProbeServices.php`. Jadi tidak ada yang perlu dikerjakan.

Yang **dibaca** tetap hidup dan tidak berubah:

- `GET /api/v1/professionals/{id}/services`
- `GET /api/v1/professionals/{id}/services/export`
- `GET /api/v1/public/professionals/{id}/services` (dipakai halaman booking)

Kalau suatu saat ada yang memanggil endpoint tulis lama, jawabannya membawa penunjuk:

```json
{ "code": "endpoint_retired", "replacement": "DELETE /api/v1/services/{id}", "sunset": "2026-12-01T00:00:00.000Z" }
```

plus header `Deprecation`, `Sunset`, dan `Link: rel="successor-version"`.

---

## 8. Hak akses di sisi FE

`penulis()` sudah membatasi ke `super` dan `admin` — cocok dengan backend. Dua hal lagi:

- **Admin klinik terkunci ke kliniknya.** `clinicId` yang dikirim admin klinik **diabaikan**
  backend, bukan ditolak. Jadi tidak perlu takut salah kirim — tapi juga jangan tampilkan
  pemilih klinik untuk peran itu, karena pilihannya tidak berpengaruh.
- **Super admin wajib memilih klinik.** Tanpa `clinicId` jawabannya `422 clinic_required`.
  `klinik()` sudah menangani ini dengan pesan sendiri sebelum memanggil API — bagus,
  pertahankan.
- **Psikolog dan resepsionis boleh membaca**, tidak menulis. Kalau halaman daftar layanan mau
  dibuka untuk mereka, `GET` sudah otomatis terbatas: psikolog hanya melihat barisnya sendiri,
  resepsionis se-klinik.

---

## 9. Checklist

- [ ] `payload()`: `category` → `categoryId` (int), `doctors` → `doctorIds`,
      `clinics: [x]` → `clinicId: x`, `telemed_service` → `telemedService`
- [ ] `validasi()`: `category` jadi `['required','integer']`
- [ ] Panggil `GET /api/v1/service-categories`, ganti input teks jadi dropdown
- [ ] Isi form edit dari `category.id`; tangani `category: null`
- [ ] Pastikan tombol Edit/Hapus memakai `id`, bukan `serviceId`
- [ ] Nonaktifkan pemilih psikolog di mode edit (atau jelaskan bahwa perubahannya diabaikan)
- [ ] Pesan `409` memakai `count`, dan berhenti menyarankan "nonaktifkan saja"
- [ ] `price: null` dirender berbeda dari `0`
- [ ] Petakan `fields` ke pesan error per-input
- [ ] Uji dengan akun `super` **dan** `admin` — jalur `clinicId`-nya berbeda

---

## 10. Cara menguji tanpa merusak data

Buat layanannya dengan `isPublic: 0` — ia tidak akan muncul di halaman booking publik, tapi
semua jalur lain tetap terlatih. Sesudahnya hapus barisnya sungguhan lewat database, karena
`DELETE` hanya menonaktifkan.

Di staging, psikolog **wp 120 "Dinni Khaerani - Trial M.Psi., Psikolog"** (klinik 32) adalah
akun trial yang sudah dipakai untuk menguji keenam endpoint ini pada 30 Agustus, lalu
dibersihkan sampai bersih. Dia pilihan yang aman.
