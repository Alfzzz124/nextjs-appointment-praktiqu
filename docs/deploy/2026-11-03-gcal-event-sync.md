# Menyalakan arah tulis Google Calendar

Langkah-langkah ini **berurutan**, dan seluruhnya bisa diselesaikan dalam satu
hari: scope yang dipakai (`calendar.app.created`) non-sensitive, jadi tidak ada
verifikasi Google yang perlu ditunggu.

Rancangannya: `docs/superpowers/specs/2026-11-03-google-calendar-dua-arah-design.md`

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

```bash
#!/bin/bash
# /home/praktiqu/gcal-event-sync.sh — chmod 700
printf 'url = "https://endpoint.praktiqu.com/api/v1/internal/google-calendar/event-sync"\nheader = "x-cron-secret: %s"\nrequest = "POST"\nsilent\n' "$CRON_SECRET" \
  | curl -K - -o /dev/null -w '%{http_code}\n'
```

```
0 * * * * /home/praktiqu/gcal-event-sync.sh >> /home/praktiqu/logs/gcal-event-sync.log 2>&1
```

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
