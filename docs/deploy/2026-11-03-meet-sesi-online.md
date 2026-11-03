# Tautan Meet otomatis untuk sesi online

Menambal celah yang sudah berjalan tiga bulan: addon `kivicare-google-meet`
berhenti membuat tautan pada **3 Agustus 2026**, dan sejak itu setiap janji
"Konseling online" tidak punya tautan pertemuan sama sekali.

Rancangannya menumpang fitur arah tulis yang sudah live — lihat
`2026-11-03-gcal-event-sync.md`.

## Yang berubah

Acara untuk layanan ber-`telemed_service = 'yes'` meminta Google membuatkan
tautan Meet, dan tautan itu disimpan bersama tautan acaranya.

Bendera telemed menempel pada **pemetaan layanan–dokter**, bukan pada layanannya:
layanan yang sama bisa tatap muka untuk satu psikolog dan online untuk yang lain.

## Langkah

### 1. Jalankan SQL-nya

```bash
mysql -u <user> -p <database> < prisma/manual/2026-11-03-google-calendar-event-links.sql
```

Dua kolom pada `google_calendar_event_sync`: `htmlLink` dan `hangoutLink`.

### 2. Merge BE lalu FE, periksa build-nya

### 3. Amati satu putaran

```bash
ssh praktiqu-hostinger 'tail -3 ~/gcal-event-sync.log'
```

Lalu periksa hasilnya pada janji yang layanannya online:

```sql
SELECT appointmentId, hangoutLink IS NOT NULL ada_meet, lastError
FROM google_calendar_event_sync;
```

## Yang sudah diuji, dan yang belum

**Sudah diuji langsung ke Google** (3 Nov 2026, acara percobaan tanpa peserta di
kalender PraktiQu, lalu dihapus):

```
status HTTP:       200
status conference: success
hangoutLink:       https://meet.google.com/nbv-jgmv-udy
htmlLink:          ada
```

**Belum terbukti:** apakah izin sempit `calendar.app.created` cukup untuk
membuat Meet. Uji di atas memakai sambungan yang kebetulan memegang izin
`calendar` yang luas, dan Google **menolak** permintaan token yang dipersempit
(`invalid_scope`) — jadi izin tidak bisa dipersempit saat refresh, dan satu-satunya
cara mengetahuinya adalah lewat sambungan yang memang hanya diberi izin sempit.

Karena itu kegagalan Meet **tidak menggagalkan apa pun**: acaranya tetap dibuat,
`hangoutLink` tetap NULL, dan sebabnya dicatat di `lastError`. Jadi rilis ini
tidak perlu menunggu jawaban itu.

Kalau ternyata izin sempit tidak cukup, pilihannya: menerima sesi online tanpa
Meet otomatis, atau meminta izin lebih luas — dan yang kedua membatalkan jaminan
"kalender pribadi tidak tersentuh" yang jadi alasan memilih izin sempit.

## Dua jebakan yang sudah ditangani

**`conferenceDataVersion=1` wajib.** Tanpa parameter itu Google menerima
permintaannya, membuat acaranya, dan **membuang** blok konferensinya tanpa pesan
galat apa pun. Gejalanya "Meet tidak jalan" tanpa ada yang bisa dilacak.

**`requestId` tetap per janji, bukan acak.** Google memakainya sebagai kunci
idempotensi. Kalau berubah tiap sinkron, setiap pembaruan meminta Meet baru dan
tautan yang sudah dipegang klien berhenti jadi tautan yang benar. Pembaruan acara
juga mengirim `conferenceDataVersion=1`, karena PUT mengganti seluruh isi acara —
tanpa itu, sesi online yang dijadwal ulang kembali tanpa tautannya.

## Izin yang lebih luas dari yang diminta

Halaman pengaturan sekarang memperingatkan sambungan yang memegang izin
`calendar` luas. Google membawa izin lama ikut serta lewat
`include_granted_scopes`, jadi "Putuskan sambungan" saja tidak membersihkannya —
izinnya tersimpan di sisi Google. Yang membersihkan: mencabut akses PraktiQu di
**Akun Google → Keamanan → Aplikasi pihak ketiga**, lalu menyambung lagi.

Sambungan seperti itu tetap dilayani, bukan ditolak: menolaknya akan membuat
acara yang sudah kita buat terlantar tanpa ada yang bisa memperbarui atau
menghapusnya. Yang berubah hanya satu — ia tidak lagi lewat diam-diam.
