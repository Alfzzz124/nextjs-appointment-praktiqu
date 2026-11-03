# Sinkronisasi dua arah Google Calendar

**Tanggal:** 2026-11-03
**Status:** desain disetujui, implementasi berjalan
**Melengkapi:** `2026-08-28-google-calendar-sync-design.md` (arah baca, sudah live)

## Ringkasan

Arah baca sudah berjalan sejak September: jam sibuk di Google Calendar psikolog
berhenti ditawarkan sebagai slot. Dokumen ini menambahkan arah sebaliknya —
janji PraktiQu yang sudah pasti ditulis sebagai acara di Google Calendar psikolog,
dengan klien sebagai peserta.

## Apa yang sebenarnya dilakukan KiviCare

Diperiksa langsung di `Wordpress-Plugin/kivicare-pro/app/controllers/api/GoogleCalendarIntegration.php`
(1.577 baris), karena fitur ini diminta dengan rujukan "dulu di KiviCare bisa".

Tiga temuan yang membentuk desain ini:

1. **Arah bacanya tidak pernah jalan.** `filterExternalBusySlotsForRange` membuka
   dengan `get_user_meta($doctorId, 'kc_google_calendar_sync_events', false)`.
   Argumen ketiga `false` berarti `$single = false`, jadi WordPress mengembalikan
   **array**. Array tidak pernah `=== ''` maupun `=== 'yes'`, sehingga blok di
   dalamnya tidak pernah dieksekusi. Jam sibuk Google tidak pernah memblokir slot
   di KiviCare — yang berjalan hanya arah tulis.

2. **Pembacaannya memakai `events.list`, bukan `freebusy`.** Komentarnya terang:
   "Using list API instead of freebusy to get event titles (summary)". Judul acara
   masuk ke `$busySlots[]['name']`. Kita sengaja tidak menempuh jalan itu.

3. **Email klien dijadikan `attendees`.** Google mengirim undangan dari akun
   psikolog, bukan dari PraktiQu.

Scope yang KiviCare minta: `https://www.googleapis.com/auth/calendar` — baca-tulis
penuh.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
| --- | --- | --- |
| Isi acara | Nama layanan + nama klien, klien sebagai peserta | Diputuskan pemilik produk; sama dengan perilaku KiviCare yang sudah dikenal psikolog |
| Kapan ditulis | Hanya janji yang sudah pasti | Tidak ada undangan untuk janji yang akhirnya ditolak |
| Kalender tujuan | Kalender utama (`calendar.events`) | Muncul di HP tanpa langkah tambahan; pilihan pemilik produk, dengan `calendar.app.created` sebagai cadangan |
| Pengiriman | Catat dulu, kirim lewat penyapu berkala | Google lambat tidak boleh memperlambat pemesanan; penyapu yang merekonsiliasi menyembuhkan diri setelah pemadaman |

### Risiko yang diterima

`calendar.events` adalah scope **sensitive**. Verifikasi ulang mewajibkan
justifikasi tertulis yang menjawab *"kenapa scope yang lebih sempit tidak cukup?"*,
plus video demo, dan Google menyebut prosesnya bisa memakan beberapa minggu.
Jawaban kita untuk pertanyaan itu — kalender sekunder merepotkan di aplikasi HP —
lemah, sehingga pengajuan berpeluang didorong ke `calendar.app.created`.

Risiko ini dibahas dan diterima pemilik produk, dengan rencana cadangan pindah ke
`calendar.app.created` bila ditolak. Desain di bawah membuat perpindahan itu
menyentuh dua hal saja: string scope, dan id kalender tujuan.

Tidak ada scope Calendar yang masuk kategori *restricted*, jadi CASA security
assessment tidak berlaku.

## Lingkup

**Masuk:** menulis, mengubah dan menghapus acara untuk janji berstatus pasti;
persetujuan bertahap untuk scope tulis; halaman pengaturan yang menampilkan
keadaan arah tulis; penyapu berkala dan rekonsiliasi.

**Tidak masuk:** membaca perubahan yang psikolog lakukan di Google kembali ke
PraktiQu (misalnya memindahkan acara di Google tidak memindahkan janji di
PraktiQu — jam itu hanya akan terbaca sebagai sibuk lewat arah baca yang sudah
ada); menulis ke kalender klien selain lewat undangan; backfill janji lama.

## Scope dan persetujuan bertahap

Scope tulis diminta dalam permintaan persetujuan **terpisah**, bukan digabung ke
permintaan yang sekarang:

```
baca  (sudah terverifikasi) : openid, email, calendar.freebusy
tulis (menunggu verifikasi) : https://www.googleapis.com/auth/calendar.events
```

`include_granted_scopes=true` sudah terpasang di `buildConsentUrl`, jadi izin yang
sudah diberikan ikut terbawa. Memisahkannya penting: selama scope tulis belum
terverifikasi, pengguna yang memintanya akan melihat layar "Google hasn't verified
this app". Kalau digabung, layar itu juga menghantui psikolog yang hanya ingin
arah baca — fitur yang sudah terverifikasi dan berjalan.

Karena itu `scopeGranted` pada `GoogleCalendarConnection` menjadi sumber kebenaran:
arah tulis hanya aktif untuk sambungan yang benar-benar memberi scope tulis.

## Model data

Satu tabel baru. `appointmentId` sebagai PRIMARY KEY, mengikuti pola kunci
idempotensi yang sudah dipakai booking — satu janji tidak bisa punya dua baris
niat yang saling bertabrakan.

```
google_calendar_event_sync
  appointment_id    BIGINT UNSIGNED  PK     -- wp_kc_appointments.id
  professional_id   BIGINT UNSIGNED         -- wp_users.ID, untuk mencari sambungan
  desired_state     VARCHAR(16)             -- 'present' | 'absent'
  desired_hash      CHAR(64)                -- sidik jari isi acara yang diinginkan
  synced_hash       CHAR(64)  NULL          -- sidik jari yang benar-benar ada di Google
  google_event_id   VARCHAR(255) NULL       -- id acara setelah berhasil dibuat
  calendar_id       VARCHAR(255)            -- 'primary' hari ini; id kalender kita nanti
  attempts          INT                     -- percobaan sejak terakhir berhasil
  next_attempt_at   DATETIME NULL           -- jeda mundur setelah gagal
  last_error        TEXT NULL
  updated_at        DATETIME
```

Sinkron berarti `desired_hash === synced_hash`. Penghapusan yang sudah selesai
adalah `desired_state='absent'` dengan `synced_hash` yang cocok — barisnya tetap
disimpan supaya rekonsiliasi tidak membuat ulang acara yang sengaja dihapus.

## Alur

### Mencatat niat

Saat janji berubah, kita hanya menulis baris di atas. Tidak ada panggilan ke Google
di jalur permintaan.

| Perubahan status | `desired_state` |
| --- | --- |
| → BOOKED (1), CHECK_IN (4), CHECK_OUT (3) | `present` |
| → CANCELLED (0) | `absent` |
| → PENDING (2) | `absent` |
| Jam atau layanan berubah | `present`, `desired_hash` baru |

CHECK_OUT tetap `present`: kunjungan yang sudah selesai adalah catatan yang wajar
ada di kalender. PENDING `absent` adalah konsekuensi langsung dari keputusan
"hanya yang sudah pasti" — janji yang kembali ke PENDING menarik undangannya.

### Mengirim

Penyapu berkala, lewat `/api/v1/internal/google-calendar/event-sync` dengan
`x-cron-secret`, pola yang sama persis dengan `conflict-scan` yang sudah berjalan.

Untuk tiap baris yang `desired_hash !== synced_hash` dan `next_attempt_at` sudah
lewat:

- `present` tanpa `google_event_id` → buat acara, simpan id
- `present` dengan `google_event_id` → perbarui acara
- `absent` dengan `google_event_id` → hapus acara
- `absent` tanpa `google_event_id` → tidak ada pekerjaan, tandai sinkron

### Merekonsiliasi

Pada putaran yang sama, bandingkan janji berstatus `present` dalam rentang
sekarang s.d. +60 hari milik psikolog yang terhubung dengan baris yang ada. Janji
yang seharusnya punya acara tapi tidak punya baris akan mendapat barisnya.

Lapis ini ada karena rekaman proyek ini menunjukkan kenapa: penjadwalan Action
Scheduler di WordPress pernah mati diam-diam dua kali — sekali karena skema
argumen, sekali karena klaim yang bocor — dan tidak ada yang menyadarinya selama
berbulan-bulan. Antrean yang sekadar fire-and-forget kehilangan pekerjaan tanpa
jejak; rekonsiliasi memperbaiki dirinya sendiri setelah pemadaman apa pun.

## Isi acara

```
summary      : "<Nama layanan> — <Nama klien>"
description  : nama klinik, nama layanan, dan nomor janji
start / end  : waktu lokal klinik dengan timeZone "Asia/Jakarta"
attendees    : email klien (bila ada dan masuk akal), email psikolog
extendedProperties.private.praktiqu_appointment_id : "<id>"
```

### `praktiqu_appointment_id` bukan hiasan

Ini satu-satunya pembeda antara acara milik kita dan acara pribadi psikolog. Dengan
`calendar.events` kita memegang izin atas seluruh kalender asli mereka, jadi
disiplinnya mutlak: **tidak pernah mengubah atau menghapus acara yang tidak
membawa penanda ini**, dan `google_event_id` yang tersimpan diverifikasi
penandanya sebelum disentuh. Acara yang penandanya tidak cocok diperlakukan
sebagai milik orang lain, dan barisnya ditandai galat, bukan dipaksakan.

### Email klien yang tidak masuk akal

Sebagian akun klien memakai alamat `@example.com` dari pengujian lama. Alamat
seperti itu dilewati sebagai peserta — acaranya tetap dibuat, undangannya tidak
dikirim ke alamat yang pasti memantul.

### Zona waktu

`Asia/Jakarta`, bukan `process.env.TZ`. Alasannya sama dengan di front end: zona
aplikasi adalah UTC, dan itu benar untuk menyimpan serta salah untuk dikirim ke
Google. Dikeraskan karena seluruh pengguna aplikasi ini berada di Indonesia; kalau
nanti ada praktik di WITA atau WIT, zonanya harus dibawa dari data praktik, bukan
ditebak.

## Penanganan kegagalan

| Kejadian | Tindakan |
| --- | --- |
| Token ditolak (`invalid_grant`, 401, 403) | Tandai sambungan `revoked`, hentikan percobaan sampai disambungkan ulang |
| Scope tulis tidak diberikan | Arah tulis tidak aktif; arah baca tetap jalan |
| 404 saat memperbarui atau menghapus | Psikolog menghapusnya sendiri. Untuk `absent` itu hasil yang diinginkan; untuk `present` buat ulang |
| 429 atau 5xx | Jeda mundur eksponensial, maksimum beberapa jam |
| Penanda tidak cocok | Tandai galat, jangan sentuh acaranya |

Arah tulis gagal **tidak pernah** menggagalkan pemesanan, dan tidak pernah
memengaruhi arah baca. Keduanya berbagi sambungan, bukan nasib.

## Pengujian

- Pembangun isi acara adalah fungsi murni, diuji tanpa jaringan: judul, peserta,
  alamat `@example.com` yang dilewati, zona waktu, penanda.
- Mesin keadaan sinkron diuji sebagai tabel transisi: tiap status janji ke
  `desired_state` yang benar.
- Klien Google diuji dengan `fetch` tiruan: 404, 401, 429, dan jawaban sehat.
- Satu uji yang memastikan acara tanpa penanda `praktiqu_appointment_id` tidak
  pernah disentuh — ini penjaga yang paling penting di seluruh fitur.

## Yang harus dikerjakan manusia

1. Tambahkan `calendar.events` di Data Access pada Google Cloud Console, dan
   **periksa labelnya di sana** — itu yang mengikat, bukan dokumentasi.
2. Ajukan verifikasi: justifikasi per scope dan video demo.
3. Jalankan `prisma/manual/2026-11-03-google-calendar-event-sync.sql` di basis data.
4. Tambahkan entri cron untuk `/api/v1/internal/google-calendar/event-sync`.
5. Deploy.

Langkah 1 dan 2 adalah jalur kritis. Kodenya bisa menunggu; verifikasinya tidak.
