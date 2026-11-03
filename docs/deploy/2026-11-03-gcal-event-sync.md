# Menyalakan arah tulis Google Calendar

Langkah-langkah ini **berurutan**, dan seluruhnya bisa diselesaikan dalam satu
hari: scope yang dipakai (`calendar.app.created`) non-sensitive, jadi tidak ada
verifikasi Google yang perlu ditunggu.

Rancangannya: `docs/superpowers/specs/2026-11-03-google-calendar-dua-arah-design.md`

## SELESAI dan berjalan di produksi, 2026-11-03

Seluruh langkah di bawah sudah dikerjakan. Yang tersisa hanya uji coba dengan
satu akun psikolog sungguhan.

- [x] Empat scope dicentang di Data Access, semuanya non-sensitive
- [x] Kedua berkas SQL dijalankan di `u580667380_nnmkapn` dan diverifikasi
- [x] BE di-merge, build naik, rute `event-sync` terdaftar
- [x] FE di-merge (PR #68)
- [x] Cron per jam terpasang, **terbukti menembak sendiri** pukul 08:00:08 UTC
      dengan HTTP 200
- [x] `PRAKTIQU_KALENDER_TULIS` diatur di env FE
- [ ] Uji dengan satu akun psikolog sungguhan

### Bukti bahwa rangkaiannya utuh

```
[2026-11-03T08:00:08+00:00] HTTP 200 {"data":{"enqueuedMissing":0,
  "flippedToAbsent":0,"examined":0,"created":0,"updated":0,"deleted":0,
  "alreadyCurrent":0,"failed":0,"skippedNoWriteScope":0}}
```

Angka nolnya wajar: `google_calendar_connections` masih kosong, jadi memang
tidak ada yang perlu dikerjakan. Yang membuktikan sesuatu justru **200**-nya —
penyapu mengueri `google_calendar_event_sync` sebagai langkah pertamanya, jadi
kalau tabelnya tidak ada atau klien Prisma di produksi tidak mengenalnya, ia
akan menjawab 500. SQL tangan dan klien hasil build memang sepakat.

### Cron tidak terlihat di daftar hPanel yang biasa

Daftar Cron Job yang muncul untuk `api-appointment.praktiqu.com` hanya memuat
`wp-cron.php`, dan `crontab -l` di shell **kosong sama sekali**. Keduanya bukan
tanda cron-nya hilang: `google-conflict-scan` juga tidak muncul di situ padahal
lognya membuktikan ia berjalan tiap hari pukul 00:00. Cron untuk
`endpoint.praktiqu.com` dikelola di panel situs yang berbeda.

Jangan menilai dari daftar itu. Yang membuktikan adalah lognya:

```bash
ssh praktiqu-hostinger 'tail -5 ~/gcal-event-sync.log'
```

### Jangan percaya information_schema.table_rows

Angka baris dari `information_schema.tables` untuk InnoDB adalah **perkiraan**,
dan di sini ia menjawab 0 untuk tabel yang berisi. Sempat membuat catatan ini
menyatakan "belum ada satu psikolog pun yang menghubungkan kalendernya" —
padahal `COUNT(*)` menunjukkan ada satu sambungan sejak 15 September. Pakai
`COUNT(*)` kalau angkanya dipakai untuk menyimpulkan sesuatu.

### Keadaan sebenarnya per 2026-11-03

- `google_calendar_connections`: **1 baris**, dari 15 September, izinnya
  **hanya baca** (`calendar.freebusy`, `userinfo.email`, `openid`) — sambungan
  uji dari masa arah baca dibangun, bukan sambungan dengan izin tulis
- `appCalendarId` masih NULL: kalender "PraktiQu" belum pernah dibuat
- `google_calendar_event_sync`: **0 baris**

Jadi arah tulisnya terpasang dan penjadwalnya terbukti jalan, tapi **belum ada
satu janji pun yang benar-benar mendarat di Google Calendar siapa pun**. Uji
dengan akun psikolog sungguhan masih menjadi bukti yang belum ada.

---

## 1. Tambahkan scope di Google Cloud Console

Pada proyek OAuth PraktiQu → **Data Access** → Add or remove scopes. Daftarnya 23
baris, jadi naikkan "Rows per page" ke 50 supaya semuanya terlihat sekaligus.

Centang **empat** ini, dan hanya empat:

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.app.created
```

Dua yang pertama untuk mengenali akunnya, yang ketiga arah baca yang sudah live,
yang keempat arah tulis. Kode ini tidak pernah memanggil `calendarList`,
`settings`, maupun kalender publik — jangan centang yang tidak dipakai, meski
tidak bergembok.

**Perhatikan kolom gembok.** Di Console inilah satu-satunya tempat klasifikasi
scope terlihat; tidak ada halaman dokumentasi yang mencetaknya.
`calendar.app.created` **tidak bergembok**, sementara `calendar.events` dan
seluruh scope kalender yang luas bergembok.

## 2. Pastikan keempatnya non-sensitive

Setelah Update, halaman Data Access memisahkan scope ke beberapa tabel. Keempat
scope di atas harus mendarat di **"Your non-sensitive scopes"**.

Kalau benar begitu: **tidak ada verifikasi, tidak ada video demo, tidak ada
antrean review.** Lanjut ke langkah 3.

Kalau salah satunya ternyata masuk "sensitive", berhenti dan kabari — itu
mengubah rencananya, bukan sekadar menambah langkah.

### Kenapa `calendar.app.created` dan bukan `calendar.events`

`calendar.events` memberi kita baca-tulis atas **seluruh** kalender asli
psikolog. `calendar.app.created` hanya memberi akses ke kalender yang aplikasi
ini buat sendiri — kalender pribadi mereka di luar jangkauan secara struktural,
bukan sekadar tidak kita sentuh. Untuk aplikasi kesehatan itu perbedaan yang
nyata, dan kebetulan juga yang lebih murah.

Efek sampingnya bagus: acara buatan kita tinggal di kalender terpisah, sementara
`freebusy` membaca kalender utama. Acara kita **tidak mungkin** terbaca balik
sebagai jam sibuk.

Satu harga yang harus dibayar, dan sudah masuk panduan: **kalender sekunder yang
baru tidak otomatis muncul di aplikasi Google Calendar di HP.** Psikolog perlu
mencentang kalender "PraktiQu" sekali di pengaturan aplikasinya.

## 3. Jalankan SQL-nya

Dua berkas, urutannya bebas:

```bash
mysql -u <user> -p <database> < prisma/manual/2026-11-03-google-calendar-event-sync.sql
```

```bash
mysql -u <user> -p <database> < prisma/manual/2026-11-03-google-calendar-app-calendar-id.sql
```

Jangan `prisma migrate dev` dan jangan `prisma db push`. `DATABASE_URL` di proyek
ini menunjuk ke basis data WordPress yang hidup, dan perintah migrasi Prisma akan
menawarkan diri menghapus tabel `wp_*` yang tidak dikenalnya.

Memastikan tabelnya ada:

```bash
mysql -u <user> -p -e "SHOW CREATE TABLE google_calendar_event_sync\G" <database>
```

## 4. Deploy

Lewat merge ke `main` seperti biasa (Hostinger membangun otomatis). **Periksa
build-nya setelah merge** — merge pernah terlewat tanpa dibangun.

## 5. Pasang cron

Satu entri, sejam sekali atau lebih sering kalau ingin terasa lebih cepat. Pola
yang sama persis dengan `google-conflict-scan.sh` yang sudah berjalan — rahasianya
lewat stdin, bukan argumen, karena `ps` bisa dibaca pengguna lain di hosting
bersama.

Skripnya **sudah ada di server**: `~/gcal-event-sync.sh`, mode 700, dibuat
mengikuti `~/google-conflict-scan.sh` di sebelahnya. Ia membaca `CRON_SECRET`
saat jalan dari `.env` yang ditulis hPanel, jadi rahasianya tidak tersalin ke
dalam skrip dan ikut berganti kalau env diubah. Rahasianya dioper lewat stdin
(`curl -K -`), bukan argumen, karena di shared hosting `ps` terbaca pengguna lain.

Yang tersisa cuma menjadwalkannya. Cron di kotak ini diatur lewat **hPanel →
Cron Jobs**, bukan `crontab -e` — crontab pengguna kosong, dan entri yang ada
semuanya dari hPanel.

- Perintah: `/home/u580667380/gcal-event-sync.sh`
- Jadwal: sejam sekali (`0 * * * *`)

Lognya di `~/gcal-event-sync.log`, satu baris per putaran, kode HTTP di depan.

Endpoint-nya **gagal tertutup**: tanpa `CRON_SECRET` ia menjawab 503, bukan
mengerjakan apa pun. Memastikan ia hidup dan terkunci:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://endpoint.praktiqu.com/api/v1/internal/google-calendar/event-sync
```

Harus `401`. Kalau `503`, `CRON_SECRET` belum terpasang di env produksi.

## 6. Nyalakan untuk satu psikolog dulu

Arah tulis hanya aktif untuk sambungan yang benar-benar memberi scope tulis, jadi
psikolog yang sudah terhubung sebelumnya **tidak** akan tiba-tiba mengirim
undangan. Mereka harus menyetujui ulang lewat tombol baru di halaman pengaturan.

Uji dengan satu akun lebih dulu, dan periksa tiga hal:

1. Kalender bernama **PraktiQu** muncul di daftar kalendernya, dan acaranya ada
   di sana pada jam yang benar menurut WIB (di HP, kalendernya perlu dicentang
   sekali dulu)
2. Klien menerima undangan
3. Membatalkan janji di PraktiQu menghapus acaranya

Melihat hasil satu putaran:

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  https://endpoint.praktiqu.com/api/v1/internal/google-calendar/event-sync
```

Jawabannya memuat `created`, `updated`, `deleted`, `alreadyCurrent`, `failed` dan
`skippedNoWriteScope`. Sebelum ada yang menyetujui scope tulis, yang wajar adalah
`skippedNoWriteScope` naik dan sisanya nol.

## Catatan

Arah tulis yang gagal tidak pernah menggagalkan pemesanan dan tidak pernah
memengaruhi arah baca. Keduanya berbagi sambungan, bukan nasib.

---

## Temuan terbuka, 2026-11-03

### 1. Jam acara pertama tidak cocok dengan data — BELUM DIPASTIKAN

Janji 3373 tersimpan `16:30:00 → 17:20:00` dengan `appointment_timezone`
`Asia/Jakarta` (layanan Konseling online, 50 menit). Tangkapan layar acaranya
di Google Calendar menunjukkan **17:00 – 17:30**.

Itu bukan pergeseran zona waktu: awalnya geser +30 menit, akhirnya +10, dan
durasinya berubah dari 50 jadi 30 menit. Tidak ada zona yang menghasilkan pola
itu.

Belum dipastikan apakah yang salah tampilan di perangkat atau isi acaranya
sendiri. Kalau yang tersimpan memang 17:00–17:30, tiga klien pertama menerima
undangan dengan jam yang keliru.

Cara memastikan tanpa menebak: buka acara itu di Google Calendar versi browser
dan bandingkan, atau baca acaranya lewat API — itu kalender PraktiQu buatan
kita sendiri, jadi membacanya tidak melanggar janji apa pun soal kalender
pribadi psikolog.

Psikolog yang bersangkutan belum berkomentar, jadi ini dicatat dulu, bukan
diperbaiki buta-buta.

### 2. Sesi online tidak punya tautan pertemuan sejak 4 Agustus 2026

Addon `kivicare-google-meet` masih aktif dan secara historis membuat 537
tautan Meet. Tapi baris terakhirnya tertanggal **3 Agustus 2026**
(janji 3226, dokter 34). Setelah itu berhenti sama sekali.

Akibatnya setiap janji "Konseling online" sejak 4 Agustus tidak punya tautan
Meet — termasuk 3373 yang baru saja tersinkron dan kliennya sudah menerima
undangan kalender tanpa tautan pertemuan apa pun:

```
id    tgl         status  ada_meet
3378  2026-11-06  2       0
3377  2026-11-06  2       0
3373  2026-11-04  1       0
3368  2026-10-31  2       0
3366  2026-10-29  2       0
3365  2026-10-29  2       0
```

Ini celah layanan yang sudah berjalan tiga bulan tanpa ketahuan, bukan
permintaan fitur.

Datanya sendiri sudah siap untuk membedakan mana yang online:
`wp_kc_service_doctor_mapping.telemed_service` berisi `yes`/`no`, dan backend
sudah mengenalnya lewat `telemedService`. Yang belum: loader kalender tidak
membacanya, dan tidak ada kode `conferenceData` sama sekali di sisi kita.
