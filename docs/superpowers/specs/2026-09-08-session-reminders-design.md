# Pengingat sesi T−24 jam dan T−1 jam — desain

**Tanggal:** 8 September 2026
**Status:** disetujui, siap direncanakan
**Cakupan:** backend Next.js **dan** plugin `praktiqu-endpoint`. Tidak ada perubahan skema database.

> **Amandemen 8 September 2026 (saat eksekusi).** Versi pertama spec ini menetapkan "tidak ada
> perubahan plugin WordPress" dan menyatakan di §2 bahwa handler WordPress-nya sudah mengirim
> webhook. **Keduanya salah.** Handler itu memanggil method yang tidak pernah ada, jadi jalur
> callback job belum pernah hidup — dan constraint itu ternyata kehati-hatian aku sendiri soal
> risiko deploy, bukan batasan nyata: plugin itu milik proyek ini, sudah terpasang di server,
> dan memang dibuat sebagai jalan keluar untuk fitur yang butuh arsitektur WordPress. Lihat §3b.

---

## 1. Masalah

Spec `specs/012-notifications` US2 menjanjikan email pengingat 24 jam dan 1 jam sebelum sesi, dengan alasan yang masih berlaku: mengurangi no-show adalah nilai bisnis utama fitur notifikasi. Berkas `tasks.md`-nya tercentang 100%, tapi fiturnya tidak ada — model `AppointmentReminder` berdiri di skema tanpa satu pun referensi di `src/`, dan tidak ada yang menjadwalkan apa pun.

Yang lebih penting: **jalur callback job belum pernah hidup sama sekali.** `registerJobHandler` didefinisikan di [`src/lib/jobs/webhook-handler.ts:61`](../../../src/lib/jobs/webhook-handler.ts) dan tidak pernah dipanggil. Map handler-nya kosong, jadi setiap callback yang masuk kena cabang "No handler registered" di baris 88 — dicatat sebagai warning, lalu dibalas 200. WordPress dikabari berhasil dan tidak pernah retry.

Dari empat hook yang dideklarasikan di [`src/lib/jobs/client.ts:23-27`](../../../src/lib/jobs/client.ts), hanya `praktiqu_payment_auto_cancel` yang benar-benar dipakai — dan itu jalan **bukan** lewat jalur callback ini, melainkan karena handler WP-nya mengerjakan sendiri (`cancel_order()`) lalu melapor lewat jalur webhook *payments*. Tiga hook lainnya nol pemakaian.

Perbaikan skema `args` pada 1 September 2026 (commit `7f422f8`) membuat job bisa dijadwalkan lagi setelah gagal diam-diam sejak Juli. Belum ada satu pun fitur yang memakainya. Pengingat sesi jadi pelanggan pertamanya, dan sekaligus yang memaksa jalur callback itu hidup.

## 2. Apa yang sudah ada

Lebih banyak dari yang diduga. Yang sudah siap:

| Bagian | Status | Lokasi |
| --- | --- | --- |
| Handler WordPress | **sudah ada dan terdaftar**, komentarnya menyebut "T-24h or T-1h reminder trigger" | `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php:51` |
| Handler itu kirim webhook `session.reminder` | **TIDAK — lihat §3b** | memanggil `Service::send_webhook()` yang tidak pernah ada |
| Nama hook di type union | sudah dideklarasikan | `src/lib/jobs/client.ts:25` |
| `jobs.enqueue` dengan `runAt` | sudah, terbukti jalan | pola di `src/services/payments/payment.service.ts:340` |
| `jobs.cancel` per (hook, args) | sudah, terbukti jalan | pola di `src/services/payments/payment.service.ts:364` dan `:432` |
| Penerima webhook + verifikasi HMAC | sudah | `src/app/api/v1/webhooks/wordpress-jobs/route.ts` |
| Pengiriman email | sudah, dan tidak pernah melempar | `src/lib/email.ts` |
| Jejak audit yang persisten | sudah — `logging.audit()` menulis ke `LogEntry` | `src/lib/logging.ts:100`, tulisnya di `:140` |

Yang belum: sisi Next.js yang menjadwalkan, yang membatalkan, dan yang mendaftarkan handler.

## 3. Pendekatan

**Dipilih: WordPress Action Scheduler menjadwalkan, webhook balik, Next.js yang mengirim email.**

Ini yang plumbing-nya memang dibangun untuk itu, dan nol perubahan skema database.

Versi pertama spec ini menambahkan "nol perubahan plugin WordPress" sebagai keunggulan, dengan alasan plugin `praktiqu-endpoint` pernah hilang dari WP selama 7 minggu dan membuat semua login membalas 503. Risiko deploy itu nyata dan tetap perlu runbook, **tapi menjadikannya constraint adalah kesalahan** — separuh WordPress dari kontrak ini memang belum ada, jadi tidak ada cara menghindarinya. Plugin itu milik proyek ini dan sudah terpasang; ia justru alat yang disiapkan untuk kasus seperti ini.

**Ditolak — Next.js menjadwalkan sendiri (cron eksternal + tabel due-reminders).** Butuh tabel baru, dan di repo ini `DATABASE_URL` menunjuk database WordPress yang sama, jadi perubahan skema harus lewat SQL berlingkup dan bukan `db push` (lihat `docs/architecture/shadow-tables-audit.md`). Plus butuh cron cPanel baru dan endpoint baru, dan menduplikasi apa yang Action Scheduler sudah lakukan. Juga bertentangan dengan keputusan C8 yang menetapkan Action Scheduler sebagai job runner.

**Ditolak — WordPress mengirim emailnya sendiri.** Memindahkan logika notifikasi ke PHP dan memecahnya ke dua kodebase. Juga mempersulit rencana rewrite backend: logika yang tinggal di plugin WordPress tidak ikut terbawa.

## 3b. Separuh WordPress yang belum ada

Ditemukan saat mengerjakan Task 4, dengan membaca sumber plugin. Tiga hal patah, dan ketiganya berdiri sendiri.

**1. `Service::send_webhook()` tidak pernah ada.** `Jobs::handle_session_send_reminder` (`class-praktiqu-endpoint-jobs.php:124`) dan `handle_session_auto_complete` (`:111`) sama-sama memanggilnya, tapi `$this->service` bertipe `Service`, yang sepuluh methodnya semua soal autentikasi dan user. Grep di seluruh `Wordpress-Plugin/` menemukan `send_webhook` hanya di dua tempat pemanggilan itu. Jadi job pengingat menyala, PHP fatal "Call to undefined method", Action Scheduler menangkapnya dan menandai action gagal. Tidak ada webhook yang pernah terkirim. Terverifikasi juga di plugin **yang terpasang di server** (v1.6.5, identik dengan repo), jadi ini bug hidup di produksi.

**2. Bentuk payload tidak cocok.** Pengirim bertanda tangan yang benar-benar bekerja adalah `Hooks::dispatch_webhook` (`class-praktiqu-endpoint-hooks.php:140`) — HMAC-SHA256 atas body JSON di header `X-PraktiQU-Webhook-Signature`, sudah benar. Tapi payload-nya **datar**: `{event, wpUserId, issuedAt, source, ...extra}`. `processWebhook` di Next.js membaca `payload.event` lalu memanggil `handler(payload.data)` — ia butuh objek `data` bersarang yang tidak pernah dihasilkan `dispatch_webhook`. Menyambungkan `Jobs` ke situ apa adanya akan menyerahkan `undefined` ke handler.

**3. Tidak ada tujuan untuk jobs.** Plugin mendaftarkan dua opsi URL (`class-praktiqu-endpoint-settings.php:43,53`): `praktiqu_endpoint_webhook_url` untuk event user dan `praktiqu_endpoint_payment_webhook_url` untuk pembayaran. Tidak ada URL jobs. Rahasianya pun tinggal di opsi `praktiqu_endpoint_webhook_secret`, sedangkan penerima jobs di Next.js memverifikasi dari env `WORDPRESS_WEBHOOK_SECRET` — dua tempat penyimpanan berbeda.

### Yang akan dibangun

Pengirim webhook khusus jobs, dengan **opsi URL dan rahasia sendiri** — `praktiqu_endpoint_jobs_webhook_url` dan `praktiqu_endpoint_jobs_webhook_secret` — mengikuti pola dua-opsi yang sudah ada. Diputuskan 8 September: memakai ulang opsi event-user berarti dua bentuk payload berbagi satu tujuan dan satu rahasia, jadi merotasi rahasia user akan mematikan callback job tanpa suara.

Bentuk payload wajib `{ event, data }`, karena itu yang dibaca `processWebhook`. Penandatanganan menyalin `dispatch_webhook` yang sudah terbukti: HMAC-SHA256 hex atas body JSON, di header `X-PraktiQU-Webhook-Signature`. `Jobs` disambungkan ke pengirim baru itu, bukan ke `Service`. Itu sekaligus menghidupkan `praktiqu_session_auto_complete`, yang patah dengan cara yang sama dan hanya tidak terlihat karena tidak ada yang menjadwalkannya.

### Kontrak args tetap utuh, walau ada kunci ketiga

`jobs.enqueue` selalu menempelkan `webhookToken` ke args (`src/lib/jobs/client.ts:16`), dan komentar plugin mencatat payload terukur `{"wcOrderId":49736,"webhookToken":null}`. Itu aman: `add_action(..., 10, 2)` membatasi callback ke dua argumen, jadi nilai ketiga dibuang WordPress selama `sessionId` dan `channel` ada di depan. Yang dipaku test kita adalah urutan kunci di helper — bagian yang memang kita kendalikan.

### Verifikasi

Plugin bisa diuji tanpa WordPress dan tanpa server: `tests/test-money.php` sudah menetapkan polanya — plain PHP, tanpa PHPUnit, dijalankan di container `php:8.3-cli`. Terbukti jalan: lint 16 berkas bersih dan harness-nya ALL PASS. PHP 8.3 juga ada di server untuk lint pasca-deploy.

## 4. Titik pemicu — dua, bukan tiga

Pengingat dijadwalkan saat sesi **menjadi BOOKED**. Sesi PENDING tidak dapat pengingat, supaya tidak ada pasien yang diingatkan soal sesi yang ternyata ditolak.

Ada tiga pintu masuk booking, dan ketiganya jatuh ke dua titik hook:

| Pintu masuk | Status awal | Dijadwalkan di |
| --- | --- | --- |
| `createSession` oleh staf | **BOOKED** langsung — `session.service.ts:319`: `args.forceBooked \|\| isStaff ? BOOKED : PENDING` | `createSession` |
| `createSession` oleh klien | PENDING | `transitionSession` saat disetujui |
| `createPublicAppointment` (tamu) | PENDING, sengaja — `public-booking.service.ts:308` menjelaskan KiviCare menahan email "booked" sampai dikonfirmasi, dan booking tamu memang yang paling perlu di-review dulu | `transitionSession` saat disetujui |

Jadi:

- **`createSession`** — jadwalkan bila status hasilnya `BOOKED`.
- **`transitionSession`** ([`session.service.ts:438`](../../../src/services/session/session.service.ts)) — jadwalkan bila `target === BOOKED`; batalkan bila `target` adalah `CANCELLED`. Tidak ada status `REJECTED` — `SESSION_STATUS` hanya punya lima nilai dan penolakan dipetakan ke `CANCELLED` (lihat komentar di `session.service.ts:472` dan `sessions/[id]/reject/route.ts:53`).

Booking tamu tidak butuh hook sendiri; ia lewat jalur kedua saat disetujui.

## 5. Alur ujung-ke-ujung

```
sesi menjadi BOOKED
  └─ scheduleSessionReminders(sessionId, startsAtUtc)
       ├─ jobs.cancel dulu — membuat penjadwalan idempoten tanpa tabel
       ├─ enqueue { sessionId, channel: 'email_24h' } @ startsAt − 24 jam
       └─ enqueue { sessionId, channel: 'email_1h'  } @ startsAt −  1 jam
            (runAt yang sudah lewat dilewati, tidak dijadwalkan)

WP-Cron menyala
  └─ handle_session_send_reminder($sessionId, $channel)
       └─ send_webhook('session.reminder', { sessionId, channel })

POST /api/v1/webhooks/wordpress-jobs   (HMAC diverifikasi lebih dulu)
  └─ handler 'session.reminder'  ← handler pertama yang pernah didaftarkan
       ├─ muat sesi dari wp_kc_appointments
       ├─ guard: masih BOOKED? jam mulainya belum lewat?
       ├─ kirim email Bahasa Indonesia ke klien DAN profesional
       └─ logging.audit('session.reminder.sent', …)
```

Penerima: **klien dan profesional, keduanya di T−24 jam dan T−1 jam** — empat email per sesi. Ini melebihi spec 012 US2 yang menyebut klien saja; diputuskan sadar pada 8 September 2026.

**Guard jam mulai, tanpa masa tenggang.** Kalau `startsAt <= now` saat webhook tiba, tidak ada email dikirim sama sekali. Pengingat untuk sesi yang sudah berjalan bukan pengingat, dan WP-Cron memang bisa telat sejauh itu.

**Penerima tanpa email dilewati, bukan bikin gagal.** Kalau klien tidak punya alamat email, profesional tetap dapat pengingatnya, dan sebaliknya. Yang dilewati dicatat di `logging.audit`. Ini berbeda dari `sendReminderNow` untuk follow-up, yang melempar `KcError(400)` saat pasien tak punya email — perilaku itu benar untuk aksi manual yang penggunanya menunggu jawaban, dan salah untuk job latar yang tidak punya siapa pun untuk dikabari.

## 6. Kontrak `args` itu posisional, bukan berdasarkan nama

Ini bagian paling rapuh dari desain dan pantas dijelaskan panjang, karena kelas bug yang sama membuat **seluruh** penjadwalan job gagal diam-diam dari Juli sampai 1 September.

Action Scheduler mengeksekusi action dengan:

```php
do_action_ref_array( $hook, array_values( $this->get_args() ) );
```

(`Wordpress-Plugin/kivicare-clinic-management-system/vendor/woocommerce/action-scheduler/classes/actions/ActionScheduler_Action.php:86`)

`array_values()` **membuang kuncinya**. Jadi objek JSON yang kita kirim diteruskan ke handler secara **posisional menurut urutan kunci**, dan nama kuncinya tidak pernah dibaca. Handler-nya:

```php
handle_session_send_reminder(int $session_id, string $channel = 'email')
```

terdaftar dengan `add_action(..., 10, 2)`.

Konsekuensinya:

- `{ sessionId }` → `handle_session_send_reminder(5)`, `$channel` memakai default `'email'`.
- `{ sessionId, channel }` → `handle_session_send_reminder(5, 'email_24h')`.
- `{ channel, sessionId }` → **tertukar**, dan tidak ada yang mengeluh sampai produksi.

Yang jadi kontrak adalah urutan penulisan kunci di objek literal-nya. `JSON.stringify` mempertahankan urutan insert untuk kunci string, jadi ini deterministik — tapi tak terlihat dari kode pemanggil. Karena itu: satu komentar eksplisit di titik enqueue, dan satu test yang memakukan urutannya.

**Offset dititipkan di slot kedua.** `channel` sebenarnya berarti transport, jadi menaruh `'email_24h'` di situ adalah overload. Alternatifnya dua hook terpisah — dan itu berarti deploy plugin WordPress. Menghitung offset dari jam mulai sesi juga sudah dipertimbangkan dan ditolak: WP-Cron menyala telat, jadi pengingat T−24 jam bisa tiba pada T−20 jam dan tidak bisa dibedakan dari yang T−1 jam secara andal.

## 7. Idempotensi, tanpa tabel baru

**Model `AppointmentReminder` sengaja tidak dipakai.** Ia ada di skema (`prisma/schema.prisma:688`) tapi foreign key-nya menunjuk `Appointment` — tabel shadow yang sudah mati (tidak ada `prisma.appointment*` di `src/`) dan masuk daftar `DROP TABLE` di Fase 4 audit shadow-table. Menulis ke sana berarti menulis ke tabel yang antre dihapus.

Gantinya:

- **Idempotensi penjadwalan** dari cancel-lalu-enqueue. `as_unschedule_all_actions($hook, $argsMatcher, $group)` membuang semua action yang cocok, jadi menyetujui sesi dua kali tidak menghasilkan pengingat kembar.
- **Catatan "terkirim"** dari `logging.audit()`, yang sudah persisten ke tabel `LogEntry` — tabel app-native yang masuk daftar keeper, dengan retensi 90 hari lewat hook `praktiqu_log_purge`.

**Handler wajib idempoten dan wajib memeriksa status saat itu.** Pembatalan job adalah *best-effort* — komentar plugin-nya sendiri mengakui itu di `class-praktiqu-endpoint-jobs.php:90-96`. Jadi pengingat untuk sesi yang sudah dibatalkan bisa tetap menyala, dan yang menahannya adalah guard di handler, bukan pembatalan job. Guard-nya: sesi masih ada, statusnya masih `BOOKED`, dan jam mulainya belum lewat.

## 8. Isi email

Hardcoded dalam **Bahasa Indonesia**, mengikuti pola empat pengirim yang sudah ada. Dipanggil dengan `template: 'session_reminder'` supaya penyambungan ke fitur template email (018) nanti punya penanda.

Catatan yang perlu diakui: empat pengirim yang ada semuanya berbahasa Inggris, padahal spec 012 menetapkan locale tunggal Bahasa Indonesia. Pengingat ini menulis dalam Bahasa Indonesia — jadi ia **tidak** konsisten dengan pengirim yang ada, dan itu disengaja. Menyeragamkan yang lain di luar cakupan.

Penyambungan ke `services/email-templates/templates.service.ts` sengaja **tidak** dilakukan di sini. Service itu saat ini tidak dipanggil satu pun pengirim, jadi menyambungkannya adalah perubahan lintas-fitur yang mencakup keempat pengirim lain plus perilaku fallback saat template klinik kosong atau rusak. Membebankannya ke satu fitur baru akan menghasilkan setengah pekerjaan di dua tempat.

## 9. Berkas

Tiga modul baru dan dua berkas yang diubah. Masing-masing punya satu tujuan dan bisa diuji sendiri.

| Berkas | Tugas | Bergantung pada |
| --- | --- | --- |
| `src/repositories/wp/sessions.repo.ts` (ubah) | Tambah `professionalEmail` ke `SessionRow`. Ditemukan saat perencanaan: `SELECT_SQL` sudah men-join `wp_users du` tapi tidak pernah mengambil `du.user_email`, jadi email profesional tidak tersedia sama sekali. Penambahan kolom bersifat aditif |
| `src/services/session/reminder-schedule.ts` (baru) | Hitung dua `runAt`, lewati yang sudah lewat, enqueue dan cancel | `@/lib/jobs` saja |
| `src/services/session/reminder-email.ts` (baru) | Murni: sesi + penerima + offset → `{subject, html, text}` | tidak ada |
| `src/services/session/reminder-handler.ts` (baru) | Terima `{sessionId, channel}`, guard, susun, kirim, catat audit — **dan panggil `registerJobHandler('session.reminder', …)` di lingkup modul** | repo sesi, `reminder-email`, `@/lib/email`, `@/lib/logging` |
| `src/app/api/v1/webhooks/wordpress-jobs/route.ts` (ubah) | Impor `reminder-handler` demi efek samping pendaftaran itu | `reminder-handler` |
| `src/services/session/session.service.ts` (ubah) | Dua kail: setelah create bila BOOKED, dan di transisi | `reminder-schedule` |

Soal pendaftaran: route handler Next.js adalah modul per-request, jadi `registerJobHandler` yang dipanggil di modul yang tidak pernah diimpor route itu tidak akan pernah jalan. Karena itu pemanggilannya berada di lingkup modul `reminder-handler.ts`, dan route webhook mengimpornya — impor itu **satu-satunya** yang membuat handler terdaftar, jadi ia tidak boleh dihapus sebagai "impor yang tidak terpakai". Perlu komentar di route-nya yang mengatakan itu.

## 10. Pengujian

Semua tanpa database — mengikuti pola `tests/services/service-catalog.write.test.ts`, yang jalan dalam 8 ms dengan mock.

- **`reminder-schedule`** — dua job dijadwalkan dengan `runAt` yang benar; cancel dipanggil lebih dulu; job yang `runAt`-nya sudah lewat tidak dijadwalkan; sesi kurang dari 1 jam lagi tidak menjadwalkan apa pun.
- **Urutan `args`** — test yang memakukan bahwa objek yang di-enqueue menghasilkan `['<sessionId>', '<channel>']` saat di-`Object.values`, karena urutan itulah kontraknya. Ini test yang menjaga bug Juli tidak kembali.
- **`reminder-email`** — murni, tanpa mock: subjek dan isi untuk klien dan untuk profesional, di T−24 jam dan T−1 jam.
- **`reminder-handler`** — mengirim ke dua penerima; menolak sesi yang tidak ada; menolak sesi yang sudah `CANCELLED`; menolak sesi yang jam mulainya sudah lewat; klien tanpa email tetap menyisakan email untuk profesional (dan sebaliknya); `sendEmail` yang gagal tidak melempar.
- **Kail di service** — sesi yang dibuat staf (BOOKED) menjadwalkan; sesi klien (PENDING) tidak; transisi ke BOOKED menjadwalkan; transisi ke CANCELLED membatalkan.

## 11. Keterbatasan yang diterima

Bukan lupa — diputuskan tidak diperbaiki di sini.

- **Kegagalan kirim sementara menghilangkan pengingat itu.** `processWebhook` menelan error handler dan tetap membalas 200 supaya WordPress tidak retry. Tercatat lewat `audit.emailDeliveryFailed`, tapi tidak dicoba lagi. Mengubah kontrak webhook adalah pekerjaan tersendiri.
- **WP-Cron menyala telat.** Pengingat "1 jam sebelum" bisa tiba 20 menit sebelum, atau setelah sesi dimulai — dalam kasus terakhir guard handler menahannya dan tidak ada email terkirim. Ketepatan waktu dibatasi Action Scheduler, bukan oleh kode ini.
- **Tanpa `RESEND_API_KEY`, email hanya dicatat ke log** dan `sendEmail` tetap membalas `{ok:true}`. Itu perilaku sengaja dari `lib/email.ts` (jaminan tanpa enumerasi user) dan berlaku di sini juga.

## 12. Di luar cakupan

- **Reschedule (US2 skenario 4).** Tidak ada jalur ubah-tanggal di service — `transitionSession` hanya menangani transisi status. Pola cancel-lalu-enqueue akan membuatnya jalan otomatis kalau jalur itu nanti ada.
- **Email sesi dipesan / disetujui / ditolak (US1).** Fitur terpisah, meski akan memakai jalur callback yang dihidupkan di sini.
- **Kanal SMS dan push.** Di luar lingkup MVP per spec 012; `sendReminderNow` untuk follow-up sudah membalas 501 untuk keduanya.
- **Antrean `email_messages` dan worker penguras** yang diminta spec 012. Action Scheduler sudah jadi antreannya.
- **Menyambungkan fitur template email.** Lihat §8.
- **Menyeragamkan bahasa empat pengirim email yang ada.** Lihat §8.
- **Menghapus model `AppointmentReminder`.** Milik Fase 4 audit shadow-table, bukan pekerjaan ini.
- **Membetulkan `Hooks::dispatch_webhook` atau event user-nya.** Payload datarnya adalah kontrak
  terpisah dan tidak disentuh. Perlu dicatat: tidak ada route di Next.js yang menerimanya
  (`src/app/api/v1/webhooks/` hanya berisi `wordpress-jobs`), jadi event user tampaknya juga
  tidak punya penerima — temuan tersendiri, di luar cakupan di sini.
