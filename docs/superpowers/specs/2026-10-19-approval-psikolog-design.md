# Approval Psikolog untuk Booking Online — Desain

**Tanggal:** 2026-10-19
**Status:** Disetujui per bagian oleh user (2026-10-19). Menunggu review spec tertulis.
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu` (branch `feat/approval-psikolog`, dari `origin/main` e319e73)
- FE Laravel `raakanaka/laravel-praktiqu` (branch baru dari `main`, hanya lewat PR)
- Plugin WordPress `praktiqu-endpoint`: **1.8.2 → 1.8.3**, satu hook job baru (lihat §6). Ini koreksi
  atas presentasi Bagian 2, yang menyebut plugin tidak berubah: `Jobs::enqueue()` menolak hook
  yang tidak ada di allow-list-nya.

## 1. Masalah

Psikolog ingin bisa menerima atau menolak booking online sebelum jadwal itu jadi pasti. Hari ini
tidak ada langkah itu:

- Booking publik lahir **PENDING**, dan PENDING di sistem ini artinya **"belum dibayar"**. Webhook
  pembayaran (`applyPaidSideEffectsPublic`) langsung memindahkannya ke **BOOKED**.
- `POST /sessions/:id/approve` (PENDING → BOOKED) dan `/reject` sudah ada, dan psikolog pemilik sesi
  sudah boleh memanggilnya. Tapi di FE tombol approve berlabel **"menandai lunas"**: dipakai admin
  saat webhook pembayaran tidak sampai, bukan sebagai persetujuan psikolog.
- KiviCare hanya punya lima status (0 batal, 1 booked, 2 pending, 3 check-in, 4 check-out). Tidak
  ada status untuk "sudah bayar, menunggu psikolog".
- Email booking KiviCare (ke klien, psikolog, klinik) baru terkirim saat plugin mengklaim PENDING →
  BOOKED dengan data pembayaran (`kc_appointment_payment_completed`, plugin 1.8.1).
- Belum ada kode refund apa pun.

## 2. Keputusan user

| Pertanyaan | Keputusan |
|---|---|
| Kapan psikolog menyetujui? | **Sesudah klien bayar.** |
| Kalau ditolak, uangnya? | **Refund manual oleh admin.** Sistem menandai "perlu refund"; admin mengembalikan dana di Xendit/PayPal/WooCommerce lalu menandai "sudah direfund". |
| Kalau psikolog diam? | **Tidak ada batas waktu.** Pengingat ke psikolog, eskalasi ke admin klinik; admin boleh memutuskan atas nama psikolog. |
| Berlaku untuk siapa? | **Opt-in per psikolog.** Default mati. |
| Cara psikolog memutuskan | **Email berisi tautan → halaman detail di dashboard** (wajib login). |
| Penyimpanan status | **Pendekatan A:** sesi tetap PENDING sampai disetujui; penanda approval dan refund di tabel app baru. |
| Alasan penolakan | **Wajib, internal saja.** Email ke klien memakai teks standar tanpa alasan psikolog. |
| Info sebelum bayar | **Ya.** Satu baris di ringkasan booking untuk psikolog yang saklarnya menyala. |

Pendekatan yang ditolak:
- **B — BOOKED saat lunas + flag "belum disetujui".** Email konfirmasi KiviCare, pengingat, event
  GCal, dan check-in semuanya terjadi sebelum psikolog setuju; masing-masing harus diredam, termasuk
  di plugin (email hanya terkirim pada klaim `WHERE status=2`).
- **C — status KiviCare baru (5).** UI dan widget KiviCare tidak mengenalnya; slot berisiko tidak
  terkunci di jalur KiviCare sendiri.

## 3. Tujuan

1. Psikolog yang menyalakan saklar menerima setiap booking online yang **sudah dibayar** sebagai
   permintaan yang harus ia setujui atau tolak.
2. Selama menunggu, slot tetap terkunci dan klien **belum** menerima konfirmasi booking, pengingat,
   atau event GCal.
3. Setelah disetujui, semuanya berjalan persis seperti booking lunas hari ini.
4. Setelah ditolak, sesi batal dan dana klien tercatat **"perlu refund"** sampai admin menandainya
   selesai.
5. Tidak ada jalur otomatis (kedaluwarsa order, booking tak dibayar, hari libur baru, rekonsiliasi)
   yang bisa membatalkan atau mem-BOOKED-kan sesi yang sedang menunggu psikolog.
6. Psikolog yang saklarnya mati: **tidak ada perilaku yang berubah**.

## 4. Alur dan aturan bisnis

### 4.1 Saklar

- "Butuh persetujuan saya untuk booking online". Default **mati**.
- Diubah oleh: psikolog itu sendiri, CLINIC_ADMIN yang klinik aktifnya memetakan psikolog itu,
  SUPER_ADMIN.
- Satu saklar per psikolog, berlaku di semua kliniknya.
- Dibaca **saat pembayaran masuk**. Mematikan saklar tidak menyentuh antrean yang sudah ada:
  booking yang sudah `AWAITING` tetap harus diputuskan.

### 4.2 Yang terkena approval

- Booking publik yang dibayar online, termasuk lewat tautan personal `/{slug}`.
- Booking publik yang **ditandai lunas manual** oleh staf (jalur "tandai lunas" saat webhook tidak
  sampai), bila saklar psikolognya menyala.
- **Tidak** terkena: Janji Manual oleh staf (lahir BOOKED, staf sudah berkoordinasi dengan psikolog).

### 4.3 Alur

1. Klien booking → sesi PENDING (belum dibayar). Sama seperti sekarang.
2. Pembayaran masuk, saklar psikolog **menyala**:
   - sesi **tetap PENDING**; baris `session_approvals` dibuat dengan `state = AWAITING`;
   - job auto-cancel pembayaran dibatalkan (seperti sekarang);
   - email ke klien: "Pembayaran diterima, menunggu konfirmasi psikolog";
   - email ke psikolog: "Ada booking baru menunggu persetujuan Anda" + tombol ke
     `/dashboard/persetujuan/{id}`;
   - job pengingat pertama dijadwalkan (§4.4).
   Saklar **mati**: BOOKED seperti sekarang.
3. **Setujui** (hanya selama jam sesi belum lewat) → BOOKED dengan data pembayaran → plugin
   menembakkan `kc_appointment_payment_completed` → email booking KiviCare, pengingat 24 jam/1 jam,
   dan GCal berjalan seperti booking lunas biasa.
4. **Tolak** → alasan wajib (1–500 karakter, internal) → sesi CANCELLED → `refundStatus = NEEDED`
   → klien menerima satu email standar: psikolog tidak dapat menerima jadwal ini dan dana akan
   dikembalikan oleh klinik.
5. **Refund** → admin klinik / super admin mengembalikan dana di luar sistem → "Tandai sudah
   direfund" (+ catatan opsional) → `refundStatus = DONE`.

### 4.4 Pengingat dan eskalasi (tanpa batas waktu)

Satu job berulang per sesi, `praktiqu_approval_reminder`, dijadwalkan ulang oleh handler-nya sendiri:

Diperiksa berurutan setiap kali job jalan:

| # | Kondisi | Aksi |
|---|---|---|
| 1 | Baris bukan `AWAITING`, atau sesi bukan PENDING lagi | Rapikan bila tidak cocok (§9 butir 2 dan 4), lalu berhenti. |
| 2 | Jam sesi sudah lewat | Berhenti. Baris tetap `AWAITING` dan tampil sebagai **"Terlewat"**. |
| 3 | Email terakhir ke psikolog (`lastReminderAt`, atau `requestedAt` bila belum ada) ≥ 20 jam lalu | Email pengingat ke psikolog; `lastReminderAt = now`. |
| 4 | (`requestedAt` ≥ 24 jam lalu **atau** sesi mulai < 24 jam lagi) dan `escalatedAt` NULL | Email eskalasi ke admin klinik; `escalatedAt = now`. |
| 5 | Selalu (sampai sini sesi masih menunggu dan belum mulai) | Jadwalkan ulang di `min(now + 24 jam, mulai − 24 jam)`, dibatasi paling cepat `now + 1 jam`. |

- Job pertama dijadwalkan saat `holdForApproval` di `min(now + 24 jam, mulai − 24 jam)`, dibatasi
  paling cepat `now + 1 menit`. Sesi yang mulai < 24 jam lagi langsung tereskalasi; email pertama ke
  psikolog sudah terkirim saat hold, jadi butir 3 tidak mengirim email kedua dalam menit yang sama.
- Penerima eskalasi: admin klinik sesi itu (`wp_kc_clinics.clinic_admin_id`). Klinik tanpa admin
  (`clinic_admin_id = 0`) → tidak ada email; antrean tetap terlihat oleh super admin, dan
  kejadiannya dicatat di audit.
- Eskalasi dikirim **satu kali**. Pengingat ke psikolog tetap tiap 24 jam.

### 4.5 Sesi terlewat

Jam mulai sesi lewat dan belum diputuskan: pengingat berhenti, **Setujui dikunci** (422), yang
tersisa hanya **Tolak → refund**. Antrean admin menandainya **"Terlewat"**.

### 4.6 Pembatalan sesi yang sedang menunggu

Sesi `AWAITING` bisa dibatalkan lewat jalur lain: `/sessions/:id/cancel` (staf) atau tautan batal
klien (`/public/appointments/:token/cancel`, yang menerima PENDING). Dananya sudah masuk, jadi:
`state = CANCELLED`, `refundStatus = NEEDED`. Sesi itu masuk daftar "Perlu refund"; admin yang
menentukan apakah dana dikembalikan, lalu menandai selesai dengan catatan.

## 5. Model data

Dua tabel app, ditulis tangan di `prisma/manual/2026-10-19-approval-psikolog.sql` dan dijalankan per
environment. **Jangan** `prisma db push` / `migrate dev`: DB ini juga berisi tabel `wp_*`.
Model Prisma ditambahkan di `schema.prisma` dengan `@@map`, mengikuti `ClinicOwner`.

```sql
CREATE TABLE IF NOT EXISTS `professional_approval_settings` (
  `doctorWpUserId`    bigint unsigned NOT NULL,
  `requiresApproval`  tinyint(1)      NOT NULL DEFAULT 0,
  `updatedBy`         varchar(191)    NULL,          -- users.id (cuid)
  `updatedAt`         datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`doctorWpUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_approvals` (
  `appointmentId`   bigint unsigned NOT NULL,        -- wp_kc_appointments.id
  `doctorWpUserId`  bigint unsigned NOT NULL,        -- disalin saat hold, untuk scope antrean
  `clinicId`        bigint unsigned NOT NULL,        -- idem
  `paymentOrderId`  varchar(191)    NULL,            -- payment_orders.id; NULL = lunas ditandai manual
  `state`           varchar(16)     NOT NULL,        -- AWAITING | APPROVED | REJECTED | CANCELLED
  `requestedAt`     datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decidedAt`       datetime(3)     NULL,
  `decidedBy`       varchar(191)    NULL,            -- users.id; NULL = sistem / di luar app
  `rejectReason`    varchar(500)    NULL,
  `refundStatus`    varchar(8)      NOT NULL DEFAULT 'NONE',  -- NONE | NEEDED | DONE
  `refundedAt`      datetime(3)     NULL,
  `refundedBy`      varchar(191)    NULL,
  `refundNote`      varchar(500)    NULL,
  `lastReminderAt`  datetime(3)     NULL,
  `escalatedAt`     datetime(3)     NULL,
  PRIMARY KEY (`appointmentId`),
  KEY `session_approvals_doctor_state_idx` (`doctorWpUserId`, `state`),
  KEY `session_approvals_clinic_state_idx` (`clinicId`, `state`),
  KEY `session_approvals_refund_idx` (`refundStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- Psikolog tanpa baris di `professional_approval_settings` = saklar mati.
- Semua tanggal boleh NULL; tidak ada `0000-00-00`.
- `paymentOrderId` = `payment_orders.id`, cuid (`String` di Prisma), maka `varchar(191)`.
- Satu sesi, satu baris: PK `appointmentId` sekaligus membuat `holdForApproval` idempoten
  (`INSERT … ON DUPLICATE KEY` tidak mengubah baris yang sudah ada).

State:

```
AWAITING ──approve──▶ APPROVED                       refundStatus NONE
AWAITING ──reject───▶ REJECTED                       refundStatus NEEDED
AWAITING ──cancel───▶ CANCELLED                      refundStatus NEEDED
                      REJECTED/CANCELLED + NEEDED ──refund-done──▶ DONE
```

## 6. Plugin `praktiqu-endpoint` 1.8.3

Satu-satunya perubahan: hook job baru.

- `Jobs::register()`: `add_action('praktiqu_approval_reminder', [$this, 'handle_approval_reminder'], 10, 1)`.
- `Jobs::enqueue()`: tambahkan `praktiqu_approval_reminder` ke `$allowed`.
- `handle_approval_reminder(int $appointment_id)`: `$this->jobs_webhook->send('approval.reminder', ['appointmentId' => $appointment_id])`.
- Args selalu **objek** `{ appointmentId }` (lihat riwayat bug jobs args array vs object).

Aman dirilis lebih dulu: tanpa Next.js baru, tidak ada yang meng-enqueue hook ini.

## 7. Backend Next.js

### 7.1 Service baru `src/services/session/approval.service.ts`

| Fungsi | Isi |
|---|---|
| `requiresApproval(doctorWpUserId)` | Baca saklar; tidak ada baris = `false`. |
| `findApproval(appointmentId)` | Baris approval atau `null`. |
| `holdForApproval({ appointmentId, paymentOrderId })` | Buat baris `AWAITING` (idempoten), audit `session.approval_requested`, enqueue job pertama, kirim email klien + psikolog. Email dan job dikirim hanya bila baris **baru** dibuat. |
| `approve(actor, appointmentId)` | §7.4. |
| `reject(actor, appointmentId, reason)` | §7.4. |
| `closeOnCancel(appointmentId, actorId \| null)` | `AWAITING` → `CANCELLED`, `refundStatus = NEEDED`. Dipanggil oleh semua jalur pembatalan (§7.2). |
| `markRefunded(actor, appointmentId, note?)` | `NEEDED` → `DONE`. |
| `listQueue(actor, { state, professionalId?, page, limit })` | Antrean ber-scope (§7.3). |
| `handleReminderJob(appointmentId)` | §4.4. Didaftarkan lewat `registerJobHandler('approval.reminder', …)`. |

Pembuat isi email dipisah ke `approval-email.ts`, murni (tanpa DB/jaringan/jam), seperti
`reminder-email.ts`. Bahasa Indonesia.

### 7.2 Jalur lama yang disesuaikan

Setiap jalur yang menganggap PENDING = belum bayar:

| Jalur | File | Perubahan |
|---|---|---|
| Pembayaran lunas + rekonsiliasi | `payments/payment.service.ts` `applyPaidSideEffectsPublic` | Untuk sesi yang masih PENDING: baris `AWAITING`/`REJECTED`/`CANCELLED` → **berhenti**. Baris `APPROVED` (crash di tengah setujui) → selesaikan BOOKED dengan data pembayaran. Tidak ada baris + `requiresApproval` → batalkan job auto-cancel, `holdForApproval`, **berhenti**. Tidak ada baris + saklar mati → perilaku sekarang. |
| Order kedaluwarsa | `payment.service.ts` `cancelIfStillPending` | Lewati bila ada baris approval. Mencegah order lama yang kedaluwarsa membatalkan sesi yang dibayar lewat order kedua. |
| Booking tak dibayar | `public/unpaid-booking.ts` | Lewati bila ada baris approval. Sesi yang ditandai lunas manual tidak punya order `paid`, jadi penjaga order yang ada tidak cukup. |
| Hari libur baru | `session.service.ts` `invalidatePendingForOffDay` | Lewati sesi yang punya baris `AWAITING`; sesi itu tetap di antrean untuk diputuskan. |
| `POST /sessions/:id/approve` | `session.service.ts` `transitionSession` (target BOOKED) | Ada baris `AWAITING` → `approval.approve`. Tidak ada baris + `requiresApproval` → "tandai lunas" menjadi `holdForApproval({ paymentOrderId: null })`, sesi tetap PENDING. Tidak ada baris + saklar mati → perilaku sekarang. |
| `POST /sessions/:id/reject` | `transitionSession` (target CANCELLED via reject) | Ada baris `AWAITING` → `approval.reject`. Tidak ada baris → perilaku sekarang. |
| `POST /sessions/:id/cancel` | `session.service.ts` cancel | Setelah batal: `closeOnCancel`. |
| Batal oleh klien | `public/public-booking.service.ts` cancel by token | Setelah batal: `closeOnCancel`. |

Pembagian `/approve` dan `/reject` antara "tandai lunas" dan "keputusan psikolog" ditentukan oleh
**ada tidaknya baris `AWAITING`**, bukan oleh siapa yang memanggil. FE memakai field `approval`
(§7.5) untuk memilih label tombol.

### 7.3 Endpoint baru

Semua memakai `withAuth`/`getActor`, Problem Details, dan menghormati klinik aktif
(`X-Praktiqu-Clinic-Id`). Di luar scope = **404** (konvensi repo).

**`GET /api/v1/sessions/approvals`**
- Query: `state` = `AWAITING` (default) | `REFUND_NEEDED` | `REFUNDED` | `DECIDED`; `professionalId?`;
  `page`, `limit` (≤ 100).
- Scope: PROFESSIONAL hanya miliknya (`professionalId` diabaikan); CLINIC_ADMIN klinik aktifnya;
  SUPER_ADMIN semua (atau klinik aktif bila dikirim).
- `state`: `AWAITING` = belum diputuskan; `REFUND_NEEDED` / `REFUNDED` = `refundStatus` `NEEDED` /
  `DONE`; `DECIDED` = riwayat `APPROVED`/`REJECTED`/`CANCELLED`.
- Item: data sesi (klien, psikolog, klinik, layanan, tanggal/jam, zona waktu), nominal, gateway, dan
  nomor order WooCommerce dari `payment_orders` (bila ada), dan objek `approval` (§7.5).
- Respons menyertakan `counts: { awaiting, refundNeeded }` untuk badge menu.

**`GET /api/v1/professionals/:id/approval-setting`** dan **`PUT`** (body `{ requiresApproval: boolean }`)
- `:id` = id psikolog yang sama dengan `professionalId` di respons sesi (id user WP).
- Boleh: psikolog itu sendiri, CLINIC_ADMIN bila psikolog dipetakan ke klinik aktifnya, SUPER_ADMIN.
- PUT menulis audit `professional.approval_setting_changed` `{ from, to }`.

**`POST /api/v1/sessions/:id/refund-done`** (body `{ note?: string ≤ 500 }`)
- Boleh: CLINIC_ADMIN (klinik sesi) dan SUPER_ADMIN. Psikolog **tidak**.
- `refundStatus` bukan `NEEDED` → 409 `refund_not_needed`.
- Audit `session.refund_marked`.

### 7.4 Setujui dan tolak

Boleh: psikolog pemilik sesi, CLINIC_ADMIN klinik sesi, SUPER_ADMIN.

**Setujui**
1. Jam mulai sesi sudah lewat → 422 `session_already_started`.
2. Klaim: `UPDATE session_approvals SET state='APPROVED', decidedAt, decidedBy WHERE appointmentId=? AND state='AWAITING'`.
   0 baris → 409 `approval_already_decided` (detail menyebut state sekarang dan siapa yang memutuskan).
3. `setAppointmentStatus(id, BOOKED, payment)` dengan `gateway`/`wcOrderId`/`transactionId` dari
   `payment_orders` bila `paymentOrderId` ada. Tanpa order (lunas manual) dipanggil tanpa `payment`,
   sama seperti "tandai lunas" hari ini (email KiviCare tidak terkirim; celah lama, lihat §12).
4. Plugin gagal → kembalikan baris ke `AWAITING` (`WHERE state='APPROVED' AND decidedBy=?`) dan
   jawab 502 `upstream_failed`. Proses mati di antara langkah 2 dan 3 → rekonsiliasi pembayaran
   (§7.2 baris pertama) menyelesaikannya.
5. Audit `session.approval_decided` `{ decision: 'APPROVED', onBehalf: actor bukan psikolognya }`;
   batalkan job pengingat; `syncSessionReminders` (menjadwalkan pengingat 24 jam/1 jam).

**Tolak**
1. Alasan 1–500 karakter (skema `/reject` yang sudah ada).
2. Klaim yang sama dengan `state='REJECTED'`, `rejectReason`, `refundStatus='NEEDED'`.
3. Status CANCELLED ditulis **langsung** (`setSessionStatusDirect`), bukan lewat plugin: klien belum
   pernah menerima email booking KiviCare, jadi email pembatalan KiviCare hanya akan menjadi email
   kedua yang membingungkan; belum ada tautan telemed atau event GCal yang perlu dibersihkan.
   **Diverifikasi saat implementasi:** pembatalan lewat plugin tidak mengerjakan hal lain yang
   dibutuhkan untuk sesi PENDING (mis. status order WooCommerce). Bila ternyata ada, pakai plugin dan
   terima email kedua.
4. Audit `session.approval_decided` `{ decision: 'REJECTED', reason, onBehalf }` dan
   `session.status_changed` seperti sekarang; batalkan job pengingat; email klien.

### 7.5 Field `approval` di respons

Ditambahkan ke detail dan daftar sesi (`/sessions`, `/sessions/:id`, `/sessions/pending`),
`/public/payment-verify`, dan `/public/appointments/:token`:

```json
"approval": {
  "state": "AWAITING",
  "requestedAt": "2026-10-19T08:00:00.000Z",
  "decidedAt": null,
  "decidedByName": null,
  "refundStatus": "NONE",
  "isOverdue": false
}
```

`null` bila sesi tidak punya baris approval. Endpoint publik **tidak** menyertakan `decidedByName`
dan `rejectReason`.

Endpoint publik psikolog dan layanan (`/public/professionals/:id`, `/by-slug/:slug`,
`/:id/services`) mendapat `requiresApproval: boolean` untuk baris info sebelum bayar.

### 7.6 Email (Resend, bahasa Indonesia)

| Kapan | Ke | Isi |
|---|---|---|
| `holdForApproval` | Klien | Pembayaran diterima; psikolog akan mengonfirmasi; email berikutnya menyusul. |
| `holdForApproval` | Psikolog | Ada booking baru: klien, layanan, tanggal/jam; tombol ke `/dashboard/persetujuan/{id}`. |
| Job pengingat | Psikolog | Sama, dengan "menunggu sejak …". |
| Eskalasi | Admin klinik | Daftar singkat sesi itu + tautan ke antrean. |
| Tolak | Klien | Psikolog tidak dapat menerima jadwal ini; dana dikembalikan oleh klinik; kontak klinik. |
| Setujui | — | Tidak ada email dari kita: email booking KiviCare yang terkirim. |

Tautan dibentuk dengan `getPublicAppUrl()` (`src/lib/public-url.ts`, env `APP_PUBLIC_URL`), helper
yang sudah dipakai email reset sandi dan redirect pembayaran. Kegagalan kirim dicatat sebagai
`EMAIL_DELIVERY_FAILED` dan tidak membatalkan aksi apa pun.

## 8. FE Laravel

Branch baru dari `main` di `raakanaka/laravel-praktiqu`.

**Psikolog**
- Saklar di halaman profil/pengaturan, dengan penjelasan singkat akibatnya.
- Menu **"Persetujuan"** dengan badge `counts.awaiting`.
- Antrean: klien, layanan, tanggal/jam, nominal, "menunggu sejak". Sesi < 24 jam lagi ditandai
  mencolok; sesi lewat ditandai "Terlewat".
- `/dashboard/persetujuan/{id}`: tujuan tombol di email. Belum login → login → kembali ke halaman ini
  (intended URL). Tombol **Setujui**, dan **Tolak** dengan modal alasan wajib (1–500) dan peringatan
  bahwa klien akan menerima refund. Sesi terlewat: hanya Tolak.
- 409 → "Sudah diputuskan oleh {nama}", muat ulang data.

**Admin klinik / super admin**
- Saklar yang sama di halaman edit psikolog.
- Antrean seluruh klinik aktif, filter per psikolog, tag "Terlewat".
- Tab **"Perlu refund"**: gateway, nomor order WooCommerce, nominal, tanggal ditolak/dibatalkan;
  tombol **"Tandai sudah direfund"** + catatan opsional. Riwayat yang sudah direfund bisa dilihat.

**Label dan kalender di seluruh dashboard**
- PENDING + `approval.state = AWAITING` → **"Lunas · menunggu psikolog"** (warna sendiri). Tombol
  "tandai lunas" disembunyikan; diganti Setujui/Tolak bagi yang berhak.
- CANCELLED + `refundStatus = NEEDED` → **"Ditolak · perlu refund"** / **"Batal · perlu refund"**.
- CANCELLED + `refundStatus = DONE` → **"Ditolak · sudah direfund"** / **"Batal · sudah direfund"**.
- `apptStatusLabel` dan `SessionStatusController` membaca field `approval`, bukan menebak dari status.

**Klien**
- Ringkasan booking sebelum bayar, bila `requiresApproval`: "Jadwal ini perlu dikonfirmasi psikolog
  setelah pembayaran. Kalau tidak dapat diterima, dana Anda dikembalikan."
- Halaman kembali dari pembayaran dan halaman Janji Temu, bila `approval.state = AWAITING`:
  "Pembayaran diterima. Psikolog akan mengonfirmasi jadwal Anda, dan kami akan mengirim email begitu
  dikonfirmasi." Teks lama tetap untuk psikolog yang saklarnya mati.
- Sesi ditolak/dibatalkan dengan refund: "Jadwal ini tidak dapat diterima. Klinik akan mengembalikan
  dana Anda."

## 9. Error dan race condition

1. **Setujui dan tolak bersamaan.** Klaim bersyarat `WHERE state='AWAITING'`; yang kalah 409
   `approval_already_decided`.
2. **Plugin gagal setelah klaim setujui.** Baris dikembalikan ke `AWAITING`, 502. Proses mati di
   tengah (baris `APPROVED`, sesi masih PENDING) → diselesaikan oleh rekonsiliasi pembayaran
   berikutnya, atau oleh job pengingat yang belum sempat dibatalkan (butir 1 tabel §4.4 untuk kasus
   ini mem-BOOKED-kan, bukan sekadar berhenti).
3. **Webhook lunas datang dua kali / rekonsiliasi berulang.** PK `appointmentId` + "email dan job
   hanya untuk baris baru".
4. **Status diubah di luar app** (mis. dari dashboard KiviCare WP). Job pengingat menutup barisnya:
   sesi sudah BOOKED/CHECK_IN/CHECK_OUT → `APPROVED` (`decidedBy` NULL, audit `external: true`);
   sesi CANCELLED → `CANCELLED` + `refundStatus NEEDED`.
5. **Setujui setelah jam sesi lewat.** 422 `session_already_started`.
6. **Tandai refund dua kali.** 409 `refund_not_needed`.
7. **Email gagal.** Dicatat, aksi tetap berhasil.
8. **Endpoint publik tidak memakai 409**: FE live membaca 409 di jalur publik sebagai "pending".

## 10. Pengujian

**Unit**
- State machine approval dan pembuat email (`approval-email.ts`, tanpa mock).
- Penjadwalan pengingat/eskalasi (§4.4): tiap baris tabel, termasuk sesi < 24 jam dan sesi lewat.

**Integrasi** (DB `wordpress-praktiqu-test`; skemanya bisa tertinggal dari WP, buat tabel baru dari
file SQL manual)
- Webhook lunas, saklar menyala → PENDING + baris `AWAITING`; saklar mati → BOOKED.
- Rekonsiliasi berulang tidak mem-BOOKED-kan dan tidak mengirim email ulang.
- Order lama kedaluwarsa tidak membatalkan sesi yang dibayar lewat order kedua.
- Job booking tak dibayar tidak membatalkan sesi yang ditandai lunas manual.
- Hari libur baru tidak membatalkan sesi `AWAITING`.
- Setujui memanggil `set_status` dengan data pembayaran; tolak menulis CANCELLED langsung dan
  `refundStatus NEEDED`.
- Cancel staf dan cancel klien menutup baris sebagai `CANCELLED` + `NEEDED`.
- Scope: psikolog lain 404; CLINIC_ADMIN klinik lain 404; psikolog tidak bisa `refund-done`.
- 409 klaim ganda, 422 setelah lewat.

**Tes invarian**
Setiap pemanggil `cancelAppointment`, `setSessionStatusDirect`, dan `setAppointmentStatus` yang bisa
menyentuh sesi PENDING harus ada di daftar yang sudah memeriksa approval. Polanya mengikuti tes
invarian `LAST_INSERT_ID`: pemanggil baru yang tidak terdaftar membuat tes gagal.

**FE**
- Feature test Laravel untuk label, tombol per peran, dan tab refund.
- Smoke test browser lokal (Docker + stub backend): email → login → detail → setujui; → tolak → tab
  refund → tandai selesai.

## 11. Rilis

1. **Plugin 1.8.3** di Hostinger WP (urutan tukar file sesuai runbook yang sudah dikoreksi). Aman
   sendirian.
2. **SQL** `prisma/manual/2026-10-19-approval-psikolog.sql` di DB prod, **sebelum** BE live.
3. **BE** di-merge → auto-deploy Hostinger. Saklar default mati → tidak ada perilaku yang berubah.
4. **FE** di-merge → deploy.
5. Uji coba dengan satu psikolog uji, saklar menyala: booking → bayar → setujui; booking → bayar →
   tolak → tandai refund. Matikan saklar setelahnya.

## 12. Di luar cakupan

- Refund otomatis lewat API gateway.
- Email versi bahasa Inggris untuk klinik internasional (sama seperti pengingat sesi hari ini).
- Approval untuk Janji Manual oleh staf.
- Pelacakan refund untuk sesi BOOKED yang dibatalkan (di luar alur approval).
- Celah lama: "tandai lunas" tanpa order pembayaran tidak mengirim email booking KiviCare. Tetap
  sama setelah fitur ini; sesi yang disetujui tanpa order juga tidak mengirim email itu.

## 13. Risiko

- **Arti ganda PENDING.** Kode baru yang membatalkan atau mengonfirmasi sesi PENDING tanpa memeriksa
  approval bisa menjatuhkan sesi yang sudah lunas. Mitigasi: tes invarian §10.
- **Antrean tanpa batas waktu.** Psikolog dan admin yang sama-sama diam membiarkan sesi lunas
  tertahan sampai "Terlewat". Mitigasi: pengingat harian, eskalasi, tag "Terlewat", tab refund.
- **Action Scheduler** pernah macet (klaim bocor) dan pernah menolak semua enqueue (args array vs
  object). Pengingat ikut mati bila itu terulang; keputusan approve/reject tidak bergantung padanya.
