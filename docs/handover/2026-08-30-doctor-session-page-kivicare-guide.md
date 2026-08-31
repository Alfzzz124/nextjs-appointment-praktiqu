# Halaman "Doctor Session" — panduan desain ulang mengikuti KiviCare

**Untuk:** tim front-end (Laravel)
**Dari:** tim back-end (Next.js API)
**Tanggal:** 2026-08-30 (diperbarui 2026-08-31: seluruh endpoint sudah siap)
**API base:** `https://staging2.praktiqu.com/api/v1`

Dokumen ini menjelaskan **cara KiviCare membangun halaman pengaturan jadwal dokter**, dan
bagaimana memindahkan pola itu ke Praktiqu. Endpoint-nya sudah dibuat lebih dulu, jadi
Bagian 6 adalah kontrak yang sudah jalan, bukan rencana. Semua detail di bawah bukan tebakan: diambil
langsung dari source plugin KiviCare 4.x (`DoctorSessionForm`, `DaySessionCard`, `BreakRow`,
`useTimeValidation`, `DoctorSessionList`) dan dari model penyimpanannya
(`KCClinicSession::createDoctorSession`).

Isi:

- **Bagian 1** — model mental KiviCare (wajib dibaca, ini yang bikin UX-nya enak)
- **Bagian 2** — anatomi halaman form, elemen per elemen
- **Bagian 3** — aturan validasi persis KiviCare
- **Bagian 4** — halaman list
- **Bagian 5** — masalah UI sekarang, field per field
- **Bagian 6** — pemetaan ke API kita + contoh payload
- **Bagian 7** — status back-end (semua endpoint sudah siap dipakai)
- **Bagian 8** — checklist penerimaan

---

## Bagian 1 — Model mental KiviCare

Tiga hal yang membedakan KiviCare dari UI kita sekarang. Kalau tiga ini tidak diadopsi,
sisanya cuma kosmetik.

### 1.1 Satu jadwal = satu pasangan (Dokter × Klinik), bukan satu baris per hari

Di KiviCare, user **tidak pernah** menambah "sesi" satu-satu. Sekali buka form, ia mengatur
**seluruh minggu** untuk satu dokter di satu klinik, lalu Save sekali. Tombol "Add Session"
artinya "atur jadwal mingguan dokter ini", bukan "tambah satu baris jadwal".

Konsekuensi yang harus ikut:

- Di halaman list, **satu baris = satu dokter di satu klinik**, dengan kolom Days berisi
  badge `Mon Tue Wed …`. Bukan satu baris per hari.
- Edit = buka lagi form mingguan yang sama, sudah terisi.
- Delete = hapus seluruh jadwal dokter itu (dialognya memang berbunyi *"You're about to
  delete all sessions for this doctor"*).

### 1.2 Tiap hari punya jam sendiri

Tidak ada satu field "Jam Praktik" yang berlaku untuk semua hari. Ada **7 kartu hari**,
masing-masing punya `Session Start` dan `Session End` sendiri. Senin boleh 09:00–15:00 dan
Sabtu 08:00–11:00. Ini kebutuhan nyata psikolog, dan UI sekarang tidak bisa
mengekspresikannya.

### 1.3 Istirahat (break) = pemecah sesi, bukan kolom baru

Ini bagian paling penting dan paling sering salah dipahami.

User memasukkan **1 sesi utama + N istirahat** per hari. Yang disimpan ke database bukan
"break", melainkan **potongan-potongan jam kerja di antara istirahat**:

```
Input user (Senin):  Sesi 09:00–17:00, Istirahat 12:00–13:00
Yang tersimpan:      baris 1 → mon 09:00–12:00
                     baris 2 → mon 13:00–17:00
```

Jadi "istirahat" adalah **lubang di antara dua baris**. Saat membaca kembali untuk form
edit, KiviCare merekonstruksinya: sesi utama = start baris pertama sampai end baris
terakhir; setiap gap antar baris = satu istirahat. Algoritmanya ada di Bagian 6.4.

Kabar baiknya: mesin slot kita sudah mendukung banyak window per hari, jadi model ini jalan
end-to-end tanpa perubahan back-end.

---

## Bagian 2 — Anatomi halaman form

Judul halaman: **"Add Doctor Session"** / **"Edit Doctor Sessions"** (`<h5>`, di atas form).

```
┌─────────────────────────────────────────────────────────────────────┐
│  Add Doctor Session                                                 │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  [ Select Clinic ▾ ]* [ Select Doctor ▾ ]* [ Time Slot ▾ ]*   │  │  ← 1 card, 3 kolom
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ☐ Select All Days                                                  │
│                                                                     │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐  │
│  │ ☑ Monday        + Add Break  │ │ ☐ Tuesday      Not scheduled │  │  ← grid 2 kolom
│  │ Session Start   Session End  │ │                              │  │    (1 kolom di mobile)
│  │ [09:00     ]    [17:00    ]  │ │                              │  │
│  │ ┌──────────────────────────┐ │ │                              │  │
│  │ │ Session Duration: 8h 0m  │ │ │                              │  │
│  │ │ Time: 09:00 - 17:00      │ │ │                              │  │
│  │ └──────────────────────────┘ │ │                              │  │
│  │ ┌──────────────────────────┐ │ │                              │  │
│  │ │ Break 1        [Remove]  │ │ │                              │  │
│  │ │ Break Start   Break End  │ │ │                              │  │
│  │ │ [12:00    ]   [13:00  ]  │ │ │                              │  │
│  │ │ Break Duration: 60m      │ │ │                              │  │
│  │ └──────────────────────────┘ │ │                              │  │
│  └──────────────────────────────┘ └──────────────────────────────┘  │
│                            … 7 kartu, Monday → Sunday …             │
│                                                                     │
│                                        [ Cancel ]  [ Save Session ] │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Card header — 3 field

| Field | Tipe | Catatan |
|---|---|---|
| **Select Clinic** * | dropdown, searchable, paginated | Disembunyikan untuk role receptionist & clinic admin (kliniknya sudah pasti). Mengganti klinik **mereset pilihan dokter**. |
| **Select Doctor** * | dropdown, searchable, paginated | **Disabled sampai klinik dipilih**; placeholder berubah jadi `"Select Clinic first"`. Disembunyikan kalau yang login adalah dokter itu sendiri (otomatis dirinya). |
| **Time Slot Duration** * | durasi dalam menit | Berlaku untuk **seluruh minggu**, satu nilai. Wajib, dan nilai kosong (`00:00`) ditolak. |

Catatan penting soal Time Slot: KiviCare memakai *time picker* jam:menit untuk mengisi
durasi — user harus paham bahwa "00:30" berarti 30 menit. **Ini satu-satunya bagian
KiviCare yang jangan ditiru.** Pakai dropdown menit saja: `5, 10, 15, 20, 30, 45, 60, 90,
120` (daftar ini bisa diambil dari `GET /api/v1/professional-sessions/module`, default `30`).

Saat **menambah** jadwal, dropdown dokter di KiviCare hanya menampilkan dokter yang **belum
punya jadwal di klinik itu** (`exclude_with_sessions`) — karena menyimpan berarti menimpa
seluruh jadwal dokter tersebut. Silakan ikuti pola yang sama supaya user tidak menimpa
jadwal tanpa sadar; kalau dokternya sudah punya jadwal, arahkan ke tombol Edit.

### 2.2 Select All Days

Checkbox tunggal di atas grid. Dicentang → **semua 7 hari aktif dan terisi default
09:00–18:00**. Dilepas → semua hari nonaktif dan jamnya dikosongkan. Checkbox ini juga
otomatis tercentang kalau user mencentang 7 hari satu per satu.

### 2.3 Kartu hari (7 buah)

Layout: grid `2 kolom` di layar ≥ lg, `1 kolom` di mobile. Urutan Monday → Sunday.

Isi kartu saat **nonaktif**: checkbox + nama hari di kiri, teks abu **"Not scheduled"** di
kanan. Tidak ada field apa pun. Kartu tetap ditampilkan (jangan disembunyikan) supaya user
melihat seluruh minggu sekaligus.

Isi kartu saat **aktif**:

1. Baris atas: checkbox + nama hari, dan di kanan tombol link **"Add Break"**.
   Tombol ini **disabled selama Session Start / Session End belum terisi** — istirahat tidak
   punya arti tanpa jam sesi.
2. **Session Start** dan **Session End** bersebelahan (turun jadi bertumpuk di mobile).
3. **Kotak ringkasan biru muda** begitu kedua jam terisi:
   `Session Duration: 8h 0m` / `Time: 09:00 - 17:00`. Ini feedback kecil yang bikin form
   terasa "hidup" — jangan dihilangkan.
4. **Kotak merah muda** berisi pesan error jam sesi, kalau ada.
5. Daftar **Break 1..N**, masing-masing kotak ber-border: judul `Break 1` + tombol
   **Remove** (ikon tong sampah), lalu **Break Start** / **Break End**, lalu ringkasan
   `Break Duration: 60m (12:00 - 13:00)`.
6. Kalau jam sesi sudah terisi tapi belum ada istirahat, tampil teks abu di tengah:
   *"No breaks scheduled. Click \"Add Break\" to add a break time."*

### 2.4 Time picker

KiviCare memakai flatpickr *inline*, format 24 jam, **kelipatan 5 menit**, default 09:00.
Untuk kita, `<input type="time" step="300">` atau dropdown 15/30 menit sudah cukup —
yang penting **24 jam, kelipatan menit yang rapi, dan tidak mengizinkan ketik bebas**.
Simpan dan kirim selalu sebagai `HH:mm`.

### 2.5 Footer

Rata kanan: **Cancel** (kembali ke list, tanpa konfirmasi) dan **Save Session** /
**Update Sessions** (submit).

### 2.6 Perilaku saat submit

- Validasi gagal → **scroll otomatis ke field error pertama** (`behavior: smooth`,
  `block: center`), bukan cuma menampilkan pesan di atas.
- Error level form (misal tidak ada hari aktif) → **toast merah**.
- Sukses → toast hijau `"Doctor session created successfully"` lalu **redirect ke list**.
- Saat memuat data edit → **skeleton**, bukan spinner kosong.

---

## Bagian 3 — Aturan validasi (persis KiviCare)

Semua pesan ini diambil apa adanya dari `useTimeValidation`. Silakan diterjemahkan, tapi
**aturannya jangan diubah** — back-end dan mesin slot mengasumsikan hal yang sama.

### Level form

| Aturan | Pesan |
|---|---|
| Minimal 1 hari aktif | `Please select at least one day` |
| Hari aktif wajib punya jam | `Please set session times for {Hari}` |
| Klinik wajib | `Clinic selection is required` |
| Dokter wajib | `Doctor selection is required` |
| Durasi slot wajib & ≠ 0 | `Time slot is required` |

### Jam sesi

| Aturan | Pesan |
|---|---|
| Start wajib | `Start time is required` |
| End wajib | `End time is required` |
| End > Start | `End time must be after start time` |
| **Durasi sesi minimal 30 menit** | `Session must be at least 30 minutes long` |

### Istirahat

| Aturan | Pesan |
|---|---|
| Break start wajib | `Break start time is required` |
| Break end wajib | `Break end time is required` |
| Jam sesi harus diisi lebih dulu | `Please set main session times first` |
| Break start harus diisi lebih dulu | `Please set break start time first` |
| Break berada **di dalam** jam sesi | `Break must be within session hours` |
| Break end > break start | `Break end time must be after break start time` |
| Break selesai sebelum sesi selesai | `Break must end before session ends` |
| **Durasi istirahat minimal 15 menit** | `Break must be at least 15 minutes long` |
| Antar istirahat tidak boleh tumpang tindih | `Break times cannot overlap with other breaks` |

Validasi berjalan `mode: onChange` — user melihat error sambil mengetik, bukan hanya saat
menekan Save.

---

## Bagian 4 — Halaman list

**Judul:** `Doctor Sessions` (atau `"{Nama Dokter}'s Sessions"` kalau difilter per dokter).
**Tombol kanan atas:** `+ Add Session`.

**Kolom tabel:**

| Kolom | Isi |
|---|---|
| Doctors | avatar + nama + email (sortable) |
| Clinics | avatar + nama klinik + email (sortable; disembunyikan untuk receptionist/clinic admin) |
| Days | badge per hari: `Mon` `Tue` `Wed` … (tidak sortable) |
| Time Slot | `30 min`, atau `1h 30min` kalau ≥ 60 menit |
| Action | ikon pensil (Edit) + ikon tong sampah (Delete), sesuai hak akses |

**Toolbar:** filter klinik (searchable), filter dokter (searchable), kotak pencarian
`Search Anything`, dan tombol export CSV / Excel / PDF.

**Seleksi baris + bulk delete.** Dialog konfirmasi hapus (satu baris):

> **Delete Sessions?**
> You're about to delete all sessions for this doctor.
> This will remove all scheduled days and cannot be undone.
> `[Keep sessions]` `[Delete permanently]`

Perhatikan tone tombolnya: `Delete permanently` / `Keep sessions`, bukan `Ya` / `Batal`.
Ini yang bikin UX-nya terasa aman. Setelah sukses → dialog sukses `Sessions Deleted`.

---

## Bagian 5 — Yang perlu diubah dari UI sekarang

Modal "Tambah Sesi" yang ada di `dashboard.blade.php` sekarang:

| Field sekarang | Masalah | Ganti jadi |
|---|---|---|
| `Nama Psikolog` (teks bebas) | Tidak bisa dikirim ke API — API butuh `doctorId` | Dropdown dokter (`GET /professionals`), simpan id |
| `Klinik` (teks bebas) | Sama, API butuh `clinicId` | Dropdown klinik (`GET /practices`), simpan id |
| `Mode` (Online/Offline) | **Tidak ada kolomnya di database**, nilainya hilang saat disimpan | Hapus dari form ini (lihat catatan di bawah) |
| `Hari Praktik` (7 toggle) | Satu set jam untuk semua hari | 7 kartu hari, jam masing-masing |
| `Jam Praktik` `"09:00 - 17:00"` (teks bebas) | Tidak bisa di-parse, tidak bisa menampung istirahat | `Session Start` + `Session End` per hari + daftar istirahat |
| `Kapasitas Slot` = `20` | Bukan konsep yang ada di sistem; kapasitas bukan angka yang di-set | `Time Slot Duration` (menit). Jumlah slot dihitung otomatis dari jam kerja ÷ durasi |

Soal **Mode (Online/Offline)**: kalau ini memang kebutuhan produk, bilang ke kami — perlu
kolom/meta baru dan keputusan apakah mode melekat pada dokter, pada layanan, atau per
sesi. Sekarang nilainya hanya hidup di front-end dan hilang begitu di-reload.

Tab **Non-Reguler** dan **Jadwal Libur** tetap dipertahankan — keduanya beda konsep
(tanggal spesifik, bukan pola mingguan) dan punya endpoint sendiri
(`/api/v1/clinic-schedules`, `/api/v1/professionals/{id}/off-days`). Yang dirombak hanya
tab **Reguler**.

---

## Bagian 6 — Pemetaan ke API kita

Semua endpoint pakai `Authorization: Bearer <JWT>`. Envelope-nya seragam:
`{ "status": true, "message": "...", "data": { ... } }`. Kalau validasi gagal, HTTP-nya
`400` dan `message` **sudah berupa kalimat yang bisa langsung ditampilkan ke user**.

Tiga endpoint di bawah dibuat khusus untuk halaman ini, jadi bentuk payload-nya sama
dengan bentuk form. Tidak perlu hitung-hitungan interval di front-end.

### 6.1 Endpoint

| Kegunaan | Endpoint |
|---|---|
| Opsi hari + daftar durasi slot | `GET /professional-sessions/module` |
| **List (satu baris per psikolog+klinik)** | `GET /professional-sessions/grouped` |
| **Muat form edit** | `GET /professional-sessions/week?doctorId=&clinicId=` |
| **Simpan seluruh minggu** | `PUT /professional-sessions/week` |
| **Hapus seluruh jadwal** | `DELETE /professional-sessions/week?doctorId=&clinicId=` |
| Hapus banyak jadwal (bulk) | `POST /professional-sessions/bulk/delete` |
| Export | `GET /professional-sessions/export` |
| Dropdown psikolog | `GET /professionals` (Super Admin & Clinic Admin) |
| Dropdown klinik | `GET /practices` |

`clinicId` **hanya wajib untuk Super Admin**. Untuk clinic admin, resepsionis, dan
psikolog, klinik diambil dari akun yang login — tidak usah dikirim.

Endpoint lama per-baris (`POST /professional-sessions`, `PUT|DELETE /professional-sessions/{id}`)
masih ada dan sekarang sudah menolak jam yang tumpang tindih, tapi **halaman ini tidak
perlu memakainya**.

> **Catatan nama.** Resource ini dulu bernama `/doctor-sessions`. Path lama tetap jalan
> sebagai alias supaya integrasi yang sekarang tidak rusak, tapi ditandai *deprecated* di
> OpenAPI — pakai `/professional-sessions` untuk semua pemanggilan baru. Nama field belum
> ikut berubah: payload tetap memakai `doctorId` / `doctor_id`, mengikuti nama kolom di
> database.

### 6.2 Simpan seluruh minggu

`PUT /api/v1/professional-sessions/week`

```json
{
  "doctorId": 42,
  "timeSlot": 30,
  "days": [
    {
      "day": "mon",
      "enabled": true,
      "mainSession": { "start": "09:00", "end": "17:00" },
      "breaks": [{ "start": "12:00", "end": "13:00" }]
    },
    { "day": "tue", "enabled": false, "mainSession": null, "breaks": [] }
  ]
}
```

- `day` — `mon tue wed thu fri sat sun` (huruf kecil).
- Jam boleh `HH:mm` atau `HH:mm:ss`.
- `timeSlot` — menit, 1–240.
- **Hari yang tidak dikirim ikut terhapus.** Kirim state form apa adanya; ini pengganti
  seluruh jadwal, bukan tambahan.
- Server memecah sendiri sesi jadi window berdasarkan istirahat, dan seluruhnya dalam satu
  transaksi — tidak ada lagi delete-lalu-post satu per satu.

Balasannya:

```json
{ "status": true, "message": "Doctor session saved successfully",
  "data": { "doctor_id": 42, "clinic_id": 1, "time_slot": 30, "windows": 3 } }
```

`windows` = jumlah baris yang tersimpan (Senin dengan satu istirahat = 2 baris).

Semua aturan di Bagian 3 divalidasi ulang di server dengan kalimat yang sama, jadi
validasi front-end murni untuk kenyamanan — bukan satu-satunya penjaga:

```json
{ "status": false, "message": "mon: Break must be at least 15 minutes long", "data": null }
```

### 6.3 Muat form edit

`GET /api/v1/professional-sessions/week?doctorId=42`

```json
{
  "doctor_id": 42, "clinic_id": 1,
  "doctor_name": "Sari Wulandari, M.Psi", "clinic_name": "Praktiqu Jakarta",
  "time_slot": 30,
  "days": [
    { "day": "mon", "enabled": true,
      "mainSession": { "start": "09:00", "end": "17:00" },
      "breaks": [{ "start": "12:00", "end": "13:00" }] },
    { "day": "tue", "enabled": false, "mainSession": null, "breaks": [] }
  ]
}
```

- **Selalu tujuh hari**, urut Senin → Minggu. Bisa langsung di-map ke tujuh kartu.
- Istirahat sudah direkonstruksi dari data; tidak perlu hitung gap sendiri.
- Psikolog yang belum punya jadwal **bukan error** — balasannya tujuh hari nonaktif,
  jadi form "tambah" dan form "edit" bisa memakai satu pemanggilan yang sama.
- Baris warisan `00:00:00–00:00:00` sudah disaring di server.

### 6.4 List

`GET /api/v1/professional-sessions/grouped?page=1&perPage=10&search=&clinicId=&doctorId=&orderBy=doctor_name&order=asc`

```json
{
  "sessions": [
    { "id": 12, "doctor_id": 42, "clinic_id": 1,
      "doctor_name": "Sari Wulandari, M.Psi", "doctor_email": "sari@praktiqu.com",
      "clinic_name": "Praktiqu Jakarta", "clinic_email": "jakarta@praktiqu.com",
      "days": ["mon", "thu"], "time_slot": 30, "window_count": 3 }
  ],
  "pagination": { "page": 1, "perPage": 10, "total": 1 }
}
```

- Satu entri = satu baris tabel. `days` sudah urut sesuai urutan minggu.
- `orderBy` yang didukung: `doctor_name`, `clinic_name`, `time_slot`.
- `search` mencocokkan nama psikolog atau nama klinik.
- Link Ubah cukup pakai `doctor_id` + `clinic_id`, tidak perlu `id`.
- Avatar: belum ada URL foto di respons ini — pakai inisial nama dulu, seperti UI sekarang.

### 6.5 Hapus

Satu jadwal:

```
DELETE /api/v1/professional-sessions/week?doctorId=42
→ { "status": true, "message": "3 doctor sessions deleted.", "data": { "removed": 3 } }
```

Beberapa jadwal sekaligus (checkbox di tabel):

```json
POST /api/v1/professional-sessions/bulk/delete
{ "groups": [ { "doctorId": 42, "clinicId": 1 }, { "doctorId": 43, "clinicId": 1 } ] }
```

---

## Bagian 7 — Status back-end

Semua yang dibutuhkan halaman ini **sudah ada di `main` dan sudah live di
`staging2.praktiqu.com`** per 31 Agustus 2026 — sudah diuji langsung di sana terhadap data
asli (45 jadwal terbaca, istirahat terekonstruksi benar pada jadwal yang dibuat KiviCare):

- `GET /professional-sessions/grouped`, `GET|PUT|DELETE /professional-sessions/week` — baru.
- Resource-nya dipindah dari `/doctor-sessions` ke `/professional-sessions`; path lama
  tetap hidup sebagai alias yang deprecated.
- `POST /professional-sessions/bulk/delete` sekarang menerima `groups`, selain `ids` yang lama.
- `POST /professional-sessions` dan `PUT /professional-sessions/{id}` sekarang menolak jam yang
  tumpang tindih (`409`) dan jam selesai yang tidak setelah jam mulai (`400`).
- Aturan Bagian 3 divalidasi di server, dengan kalimat pesan yang sama.
- `PUT /professionals/{id}/availability` — endpoint yang dulu selalu 422 karena skema
  request dan service-nya beda bentuk — sudah diperbaiki. Halaman ini tidak memakainya,
  tapi kalau kamu terlanjur memakainya di tempat lain, bentuknya sekarang
  `{ schedule: [{ day, startTime, endTime, slotDurationMinutes }] }`.

Spesifikasi mesinnya ada di `docs/api/openapi.yaml` (tag `doctor-sessions`), sudah termasuk
skema `DoctorSessionWeek`, `DoctorSessionWeekSave`, dan `DoctorSessionGroup`.

Kalau ada yang terasa kurang saat implementasi, bilang — jangan diakali dari sisi
front-end.

### Dua keanehan data yang mungkin kamu temui

Keduanya sudah kami ketahui dan sedang diputuskan penanganannya — kalau ketemu, tidak perlu
dilaporkan sebagai bug:

1. **Satu baris tanpa nama di list.** Ada jadwal lama dengan `doctor_id = 0` (user yang
   tidak ada) berisi 35 baris di clinic 4. Belum difilter, jadi masih muncul sebagai satu
   baris kosong. Tampilkan apa adanya dulu; kami yang akan membereskan di sisi data atau
   query.
2. **Satu jadwal menolak disimpan tanpa diubah.** `doctor 249` di clinic 25 hari Sabtu
   memakai celah 5 menit antar sesi sebagai buffer, dan aturan "istirahat minimal 15 menit"
   menolaknya. Kemungkinan besar minimum itu akan kami turunkan ke 5 menit — kalau berubah,
   angka di Bagian 3 ikut kami perbarui dan kami kabari.

---

## Bagian 8 — Checklist penerimaan

Halaman dianggap selesai kalau semua ini benar:

- [ ] Satu form mengatur **seluruh minggu** untuk satu dokter di satu klinik
- [ ] 7 kartu hari selalu tampil; yang nonaktif menunjukkan "Not scheduled"
- [ ] Tiap hari punya jam mulai & selesai sendiri
- [ ] Istirahat bisa ditambah lebih dari satu per hari, bisa dihapus satuan
- [ ] Tombol "Add Break" disabled sampai jam sesi terisi
- [ ] Ringkasan durasi sesi & durasi istirahat tampil begitu jam terisi
- [ ] "Select All Days" mengaktifkan semua hari dengan default 09:00–18:00
- [ ] Dropdown dokter disabled sampai klinik dipilih
- [ ] Durasi slot dalam **menit**, satu nilai untuk seluruh minggu, tidak boleh 0
- [ ] Seluruh aturan validasi Bagian 3 jalan, `onChange`, bukan hanya saat submit
- [ ] Submit gagal → scroll otomatis ke error pertama
- [ ] List menampilkan **satu baris per dokter+klinik** dengan badge hari
- [ ] Hapus memakai dialog konfirmasi bernada eksplisit + bulk delete
- [ ] Edit memuat kembali jam & istirahat dengan benar (rekonstruksi dari gap)
- [ ] Simpan memakai satu `PUT /professional-sessions/week`, bukan banyak request
- [ ] Pesan error dari server (`message`) ditampilkan apa adanya ke user

---

## Lampiran — padanan label

| KiviCare (EN) | Usulan (ID) |
|---|---|
| Add Doctor Session / Edit Doctor Sessions | Atur Jadwal Praktik / Ubah Jadwal Praktik |
| Select Clinic / Select Doctor | Pilih Klinik / Pilih Psikolog |
| Select Clinic first | Pilih klinik dulu |
| Time Slot Duration | Durasi per Sesi (menit) |
| Select All Days | Pilih Semua Hari |
| Session Start / Session End | Jam Mulai / Jam Selesai |
| Not scheduled | Tidak praktik |
| Add Break / Remove | Tambah Istirahat / Hapus |
| Break Start / Break End | Istirahat Mulai / Istirahat Selesai |
| Session Duration / Break Duration | Durasi praktik / Durasi istirahat |
| No breaks scheduled. Click "Add Break"… | Belum ada istirahat. Klik "Tambah Istirahat"… |
| Save Session / Update Sessions / Cancel | Simpan / Simpan Perubahan / Batal |
| Delete permanently / Keep sessions | Hapus permanen / Batalkan |
