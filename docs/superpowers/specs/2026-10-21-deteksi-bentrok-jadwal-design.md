# Deteksi bentrok jadwal setelah penulisan

Status: **disetujui user 2026-10-21 (brainstorming): pendekatan A — BE + cron server per jam.**
Konteks: lead menyetujui lock advisory per psikolog (`GET_LOCK('praktiqu_doc_schedule_<doctor_id>')`)
untuk semua penulis jadwal milik PraktiQU, dan memutuskan penulis bawaan KiviCare yang tidak punya
hook pra-simpan **tidak** di-patch (plugin pihak ketiga), melainkan dibatasi secara operasional dan
ditangkap belakangan oleh deteksi bentrok. Spec ini adalah deteksi itu.

## 1. Masalah

Penulis jadwal kita sendiri sudah memeriksa bentrok di bawah lock: `Appointments::create()` (plugin
1.8.5) dan `POST /appointments/{id}/reschedule` (1.8.6, branch `feat/reschedule-staf`). Tiga jalur
lain menulis `wp_kc_appointments` tanpa lewat lock itu:

- admin WP KiviCare (tambah/ubah janji temu dari dashboard KiviCare),
- reschedule masuk dari Google Calendar milik KiviCare Pro,
- impor CSV KiviCare.

Jalur-jalur itu bisa menghasilkan dua janji temu AKTIF milik psikolog yang sama yang tumpang tindih.
Saat ini tidak ada yang tahu sampai psikolognya kedatangan dua klien sekaligus.

## 2. Keputusan produk

| Pertanyaan | Jawaban |
|---|---|
| Siapa yang diberi tahu | Psikolog yang bersangkutan **dan** admin klinik (`wp_kc_clinics.clinic_admin_id`) dari tiap klinik yang terlibat |
| Lewat apa | **Email saja.** Tabel catatan menyimpan setiap temuan, jadi daftar di dashboard bisa ditambahkan belakangan tanpa merombak |
| Seberapa sering | **Tiap jam** |
| Sejauh apa ke depan | **Semua yang akan datang**, tanpa batas atas — admin KiviCare dan impor CSV bisa menulis melewati jendela 60 hari pemesanan publik |

Bukan tujuan:

- Membatalkan atau memindahkan apa pun secara otomatis. Deteksi hanya memberi tahu; manusia yang
  memutuskan mana yang digeser (sama seperti pemindaian bentrok Google, `conflict-scan.service.ts`).
- Menebak jalur mana yang menyebabkan bentrok. Pemindaian tidak bisa tahu, dan ia juga menangkap bug
  di penulis kita sendiri.
- Mendengarkan hook pasca-simpan KiviCare untuk deteksi instan. Cakupannya bolong (impor CSV dan sinkron
  masuk Google belum tentu memicunya), dan lead memilih deteksi setelah kejadian.
- Halaman dashboard di FE Laravel.

## 3. Pendekatan

**Dipilih: A — backend saja, dipicu cron server tiap jam.** Tidak ada perubahan PHP dan tidak ada
rilis plugin.

```
cron hPanel (0 * * * *)  →  ~/schedule-conflict-scan.sh   (curl -K -, rahasia lewat stdin, 1 baris log per run)
   →  POST /api/v1/internal/schedule-conflicts/scan       (x-cron-secret; gagal tertutup bila CRON_SECRET kosong)
   →  scanScheduleConflicts(now)
        1. findOverlappingAppointmentPairs(fromDate)       — SQL mentah read-only, lapisan repo
        2. buang pasangan yang tumpang tindihnya sudah lewat
        3. rekonsiliasi dengan schedule_conflict_notices   — tabel dedupe
        4. email tiap penerima tentang pasangan yang belum pernah dikabarkan kepadanya
```

Ditolak:

- **B — action berulang Action Scheduler → webhook jobs → handler BE.** Butuh plugin 1.8.7, yang
  bertabrakan dengan kenaikan versi 1.8.6 yang masih belum di-merge di `feat/reschedule-staf`. Action
  Scheduler di instalasi ini pernah macet berminggu-minggu tanpa ada yang sadar, dan webhook-nya
  fire-and-forget, jadi run yang hilang tidak meninggalkan jejak. Repo ini sudah memilih cron server
  untuk pekerjaan sejenis (`docs/deploy/2026-09-14-conflict-scan-cron.md`), dan cron pemindaian Google
  di Hostinger terbukti jalan tiap hari (HTTP 200, dicek 2026-10-21).
- **C — deteksi + email seluruhnya di PHP.** Menduplikasi pencarian penerima, isi email, dan dedupe di
  PHP, dengan tes yang lebih lemah. Tidak ada keuntungannya.

## 4. Deteksi

### 4.1 Kueri

Fungsi baru `findOverlappingAppointmentPairs(fromDate: string)` di
`src/repositories/wp/appointments.repo.ts`. Self-join dengan predikat yang **persis sama** dengan
`Schedule_Write::assertFree` di plugin:

```sql
SELECT a.id AS low_id, b.id AS high_id, a.doctor_id,
       DATE_FORMAT(a.appointment_start_date, '%Y-%m-%d') AS date,
       TIME_FORMAT(a.appointment_start_time, '%H:%i:%s') AS low_start,
       TIME_FORMAT(a.appointment_end_time,   '%H:%i:%s') AS low_end,
       TIME_FORMAT(b.appointment_start_time, '%H:%i:%s') AS high_start,
       TIME_FORMAT(b.appointment_end_time,   '%H:%i:%s') AS high_end,
       a.clinic_id AS low_clinic_id, b.clinic_id AS high_clinic_id,
       a.status AS low_status, b.status AS high_status,
       a.appointment_timezone AS low_timezone
  FROM wp_kc_appointments a
  JOIN wp_kc_appointments b
    ON b.doctor_id = a.doctor_id
   AND b.appointment_start_date = a.appointment_start_date
   AND b.id > a.id
   AND b.appointment_start_time < a.appointment_end_time
   AND b.appointment_end_time   > a.appointment_start_time
 WHERE a.doctor_id > 0
   AND a.status IN (1,2,4) AND b.status IN (1,2,4)      -- ACTIVE_STATUSES, dibind dari konstanta
   AND a.appointment_start_date >= ?                    -- 'YYYY-MM-DD', dibind sebagai string
 ORDER BY a.appointment_start_date, a.appointment_start_time, a.id, b.id
```

- `a.id < b.id`: setiap pasangan muncul sekali. Tiga janji temu yang saling tumpang tindih menjadi tiga
  pasangan.
- Setengah-terbuka: janji temu yang berakhir tepat saat yang lain mulai tidak dihitung bentrok.
- Status diambil dari `ACTIVE_STATUSES` (BOOKED 1, PENDING 2, CHECK_IN 4). CANCELLED 0 dan CHECK_OUT 3
  tidak pernah ikut.
- **Tidak ada parameter jam yang dibind sama sekali** — jebakan TIME (Date dibind ke kolom TIME
  dibandingkan sebagai datetime hari ini) tidak punya celah masuk. Satu-satunya parameter, tanggal,
  dibind sebagai string `'YYYY-MM-DD'` dan divalidasi `assertDate`.
- Kolom tanggal/jam dikembalikan sebagai string lewat `DATE_FORMAT`/`TIME_FORMAT`, bukan lewat
  round-trip Date Prisma, dan kolom zero-date apa pun (`created_at` tabel mapping KiviCare) tidak
  dipilih.
- `fromDate` = `localDate(now)` dikurangi 1 hari. Batas bawah sengaja longgar supaya klinik di zona waktu
  lain tidak kehilangan janji temu "hari ini"-nya; penyaringan tepatnya di §4.2.

### 4.2 "Yang akan datang"

Diputuskan di TypeScript, bukan SQL. Sebuah pasangan dipertahankan selama **akhir tumpang tindihnya**
— jam selesai yang lebih awal dari keduanya — dalam `appointment_timezone` milik janji temu `a`, masih
setelah `now` (`buildUtcDateTime(date, timeToMinutes(min(low_end, high_end)), timezone)`). Bentrok yang
sedang berlangsung tetap dilaporkan; yang sudah selesai dibuang. Zona waktu kosong jatuh ke
`Asia/Jakarta`. Zona yang tidak valid menghasilkan `Invalid Date` (date-fns-tz menelan galatnya), dan
pasangan itu dianggap "masih akan datang" — lebih baik satu email lebih daripada bentrok yang terlewat.

### 4.3 Batasan yang diwarisi dengan sengaja

Sama seperti `assertFree`, tumpang tindih dibandingkan pada jam dinding lokal di tanggal mulai. Janji
temu yang melewati tengah malam, atau dua janji temu satu psikolog dengan zona waktu berbeda, tidak
ditangani khusus. Kalau suatu hari `assertFree` diubah, kueri ini harus ikut.

## 5. Dedupe

### 5.1 Tabel `schedule_conflict_notices`

Tabel aplikasi, ditulis tangan di `prisma/manual/2026-10-21-schedule-conflict-notices.sql` plus model
Prisma `ScheduleConflictNotice`. **Tidak pernah `db push`** (database yang sama memuat tabel `wp_*`).

| Kolom | Tipe | Arti |
|---|---|---|
| `id` | varchar(191) PK | cuid |
| `appointmentLowId` | int | id janji temu yang lebih kecil |
| `appointmentHighId` | int | id janji temu yang lebih besar |
| `recipient` | varchar(191) | alamat email penerima, huruf kecil |
| `fingerprint` | varchar(64) | `date\|lowStart-lowEnd\|highStart-highEnd` |
| `notifiedAt` | datetime(3) | kapan email ke penerima ini terkirim |

`UNIQUE (appointmentLowId, appointmentHighId, recipient)`, `INDEX (notifiedAt)`. InnoDB, utf8mb4.

### 5.2 Aturan tiap run

1. **Penerima diberi tahu** tentang sebuah pasangan bila belum ada baris untuk (pasangan, penerima),
   atau `fingerprint`-nya berbeda — salah satu janji temu digeser tapi masih tumpang tindih. Perubahan
   status saja (PENDING → BOOKED) tidak mengubah fingerprint dan tidak memicu email ulang.
2. **Baris ditulis setelah email ke penerima ITU berhasil**, per penerima (upsert). Pengiriman yang gagal
   diulang jam berikutnya, dan penerima lain yang sudah menerimanya tidak dikirimi dua kali.
3. **Baris untuk pasangan yang sudah tidak bentrok dihapus** — dibatalkan, digeser menjauh, atau sudah
   lewat. Bentrok yang sama yang muncul lagi nanti dilaporkan lagi. Penghapusan hanya terjadi setelah
   kueri deteksi berhasil; kueri yang gagal tidak menyentuh tabel.
4. Penerima yang berganti (admin klinik baru) menerima pasangan yang masih aktif sebagai pasangan baru.
   Itu disengaja.

## 6. Penerima dan email

### 6.1 Penerima per pasangan

- **Psikolog**: `professionalEmail` dari `listSessionsByIds` (`wp_users.user_email` milik `doctor_id`).
- **Admin klinik**: `clinicAdminContact(clinicId)` (sudah ada, dipakai alur approval) untuk tiap klinik
  berbeda dari dua janji temu itu — satu klinik, atau dua bila psikolognya praktik di keduanya.
- Diduplikasi berdasarkan email huruf kecil: psikolog pemilik klinik yang juga admin menerima satu email.
- Klinik tanpa admin, atau alamat kosong: `logging.warn` dan penerima itu dilewati; penerima lain tetap
  dikirimi.

### 6.2 Isi

Satu email per penerima per run, memuat semua pasangan baru miliknya. Bahasa Indonesia, seperti email
lain di aplikasi ini. Fungsi pembangunnya murni (tanpa DB, jaringan, jam) di
`src/services/schedule/conflict-email.ts`, memakai `escapeHtml` dari `reminder-email.ts`.

- Subjek: `Jadwal bentrok: N pasang janji temu tumpang tindih` (N = 1 → `1 pasang janji temu`).
- Per pasangan: tanggal (format panjang Indonesia) dan nama psikolog, lalu dua baris —
  `#3401 · 09:00–10:00 · Klien A · Nama Layanan · Nama Klinik · Terjadwal` dan yang sama untuk `#3405`.
  Label status: 1 Terjadwal, 2 Menunggu, 4 Check-in. Nama layanan dari `serviceNameOf` (jatuh ke
  `Sesi`), nama klinik dari `findClinicById` (jatuh ke `Klinik #<id>`).
- Penutup: *"Tidak ada yang kami ubah otomatis — kedua janji temu tetap berlaku dan klien tidak diberi
  tahu. Pindahkan atau batalkan salah satunya."*
- Template log: `schedule_conflict`.

## 7. Route

`POST /api/v1/internal/schedule-conflicts/scan`, `dynamic = 'force-dynamic'`.

- Pemeriksaan `x-cron-secret` saat ini disalin di dalam route pemindaian Google. Dipindah ke
  `src/lib/cron-secret.ts` (`checkCronSecret(req)` → `null` bila lolos, atau `NextResponse` 503/401) dan
  dipakai kedua route. Tes route Google yang sudah ada menjaga refaktor ini.
- `CRON_SECRET` kosong → 503 `cron_not_configured` (gagal tertutup). Salah → 401 `invalid_cron_secret`.
- Sukses → 200 `{ data: { pairs, recipients, notified, failed } }` dan satu
  `logging.system('[schedule-conflict-scan] selesai', INFO, { action: 'schedule.conflict-scan', ... })`.
- Kueri deteksi gagal → 500; tabel tidak disentuh; log cron mencatat 500.

## 8. Penanganan galat

- Tiap penerima dibungkus try/catch sendiri. Satu email gagal atau satu alamat buruk tidak menghentikan
  sisanya; dihitung di `failed` dan dicatat `logging.warn`.
- Pemindaian yang sunyi (`pairs: 0`) dan pemindaian yang mati terlihat berbeda di log cron: yang
  pertama 200 dengan ringkasan, yang kedua bukan 200 atau tidak ada baris sama sekali.
- Dua run yang bertumpuk: kunci unik + upsert menjaga tabel tetap konsisten; terburuk satu email ganda.
  Diterima — satu run makan milidetik dan jaraknya satu jam.

## 9. Pengujian

Unit (tanpa DB):

- penyaring "tumpang tindih belum lewat": lintas zona waktu, tepat di tepi (akhir == now dibuang),
  zona tidak valid;
- fingerprint; pengelompokan pasangan per penerima (duplikasi email, pemilik yang juga psikolog, alamat
  hilang);
- pembangun email (subjek tunggal/jamak, escaping HTML, label status);
- route: 503 tanpa `CRON_SECRET`, 401 rahasia salah, 200 dengan ringkasan; route Google tetap lulus
  setelah refaktor.

Integrasi, melawan database test Docker (`praktiqu-mysql`), baris `wp_kc_appointments` di rentang id tetap
milik suite ini (pola yang sama dengan `approval-reconcile.test.ts`; `idBlock()` belum ada di main).
Kueri melihat SELURUH database test, jadi setiap asersi disaring ke id milik suite ini:

- kueri: tumpang tindih ditemukan; back-to-back tidak; CANCELLED dan CHECK_OUT diabaikan; psikolog berbeda
  dan tanggal berbeda tidak dipasangkan; tanggal lampau tidak ikut; tiga janji temu saling tumpang tindih
  → tiga pasangan;
- rekonsiliasi (email di-mock): run kedua tidak mengirim apa pun; fingerprint berubah → dikirim lagi;
  pasangan yang selesai → barisnya terhapus; email gagal → tidak dicatat dan dikirim di run berikutnya;
  penerima yang berhasil tidak dikirimi ulang saat penerima lain gagal.

Lalu `vitest run` penuh dan `tsc --noEmit`.

## 10. Rilis

Urutan: **SQL → BE → cron.** Tidak ada perubahan plugin.

1. Terapkan `prisma/manual/2026-10-21-schedule-conflict-notices.sql` di Hostinger.
2. Merge PR. Build Hostinger menjalankan `prisma generate && next build`, jadi model baru ikut otomatis.
3. Buat `~/schedule-conflict-scan.sh` (salinan skrip pemindaian Google, mengarah ke route baru, membaca
   `CRON_SECRET` dari `hbuilds/config/.env` saat jalan) dan tambahkan `0 * * * *` di hPanel.

Dokumen `docs/deploy/2026-10-21-schedule-conflict-scan-cron.md` memuat ketiga langkah, isi skripnya, dan
cara memeriksa bahwa ia benar-benar berjalan.

Run pertama akan melaporkan setiap bentrok yang SUDAH ada. Itu disengaja — bentroknya nyata. Sebelum
langkah 3, kueri deteksi bisa dijalankan read-only di produksi untuk melihat apa yang akan dikirim run
pertama, **hanya dengan izin user**.
