# Menyalakan arah tulis Google Calendar

Langkah-langkah ini **berurutan**. Langkah 1 dan 2 adalah jalur kritisnya:
kodenya bisa menunggu, verifikasi Google tidak.

Rancangannya: `docs/superpowers/specs/2026-11-03-google-calendar-dua-arah-design.md`

---

## 1. Tambahkan scope di Google Cloud Console

Pada proyek OAuth PraktiQu → **Data Access** → Add or remove scopes, tambahkan:

```
https://www.googleapis.com/auth/calendar.events
```

**Baca label yang Console tampilkan untuk scope itu di halaman yang sama.** Itu
yang mengikat, bukan dokumentasi dan bukan panduan pihak ketiga. Waktu kita
memeriksa `calendar.freebusy`, labelnya ternyata Non-sensitive — tidak ada
halaman dokumen yang mencetaknya.

Yang diharapkan: **Sensitive** (bukan Restricted, jadi tidak ada CASA security
assessment).

## 2. Ajukan verifikasi

Perlu disiapkan:

- Justifikasi tertulis per scope, termasuk jawaban atas *"kenapa scope yang lebih
  sempit tidak cukup?"*
- Video demo yang memperlihatkan alur izinnya dari layar PraktiQu

Google menyebut prosesnya bisa memakan beberapa minggu.

**Kalau ditolak** dan Google mendorong ke `calendar.app.created`: perpindahannya
menyentuh dua tempat saja.

1. `GOOGLE_WRITE_SCOPES` di `src/lib/google/oauth-client.ts`
2. Kolom `calendar_id` pada `google_calendar_event_sync` diisi id kalender yang
   kita buat, bukan `'primary'` (kolomnya sudah ada justru untuk ini)

Ditambah satu panggilan `calendars.insert` sekali per psikolog saat menyambung.
Sisa kodenya tidak berubah.

Perlu diingat kalau jalur itu ditempuh: kalender sekunder yang baru **tidak
otomatis muncul di aplikasi Google Calendar di HP** — psikolog harus
mengaktifkannya sekali di pengaturan aplikasi, dan itu perlu masuk ke panduan
visual di `docs/panduan/google-calendar/`.

## 3. Jalankan SQL-nya

```bash
mysql -u <user> -p <database> < prisma/manual/2026-11-03-google-calendar-event-sync.sql
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

1. Acara muncul di Google Calendar psikolog pada jam yang benar menurut WIB
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
