# Approval: konfirmasi "claim-first" di plugin (1.8.4)

Status: **draf, menunggu persetujuan user.** Plugin belum diubah.
Induk: `2026-10-19-approval-psikolog-design.md`. Temuan: review akhir I3 ("live race").

## 1. Masalah

`Appointments::set_status()` (plugin, `class-praktiqu-endpoint-appointments.php` ~171-177) mengklaim
`PENDING → BOOKED` dengan UPDATE bersyarat bila ada `payment`. Kalau klaim itu meleset, kode
**jatuh ke UPDATE tanpa syarat** dan menulis `BOOKED` di atas status apa pun.

Urutan yang merusak:

1. Psikolog menekan Setujui. Backend mengklaim catatan `AWAITING → APPROVED`.
2. Pembatalan mendarat di janji temu (`CANCELLED`). Jalurnya bisa dashboard KiviCare, atau
   jalur app mana pun yang membaca catatan sebelum langkah 1: `/cancel` staf, tautan batal klien,
   atau batal massal.
   `closeOnCancel` gagal karena catatannya sudah `APPROVED`, jadi tidak ada flag refund.
3. Panggilan plugin dari langkah 1 tiba. Klaimnya meleset, lalu UPDATE tanpa syarat menulis
   `BOOKED`.

Hasilnya: klien sudah menerima email pembatalan KiviCare dari langkah 2, tetapi janji temunya
`BOOKED` dan catatannya `APPROVED`. Tidak ada email booking (`payment_completed` tidak menyala)
dan tidak ada refund yang tercatat.

Urutan kebalikannya, yaitu plugin `BOOKED` dulu lalu pembatalan, adalah "batal setelah disetujui".
Itu sudah didokumentasikan sebagai di luar cakupan (refund `NONE`), dan tidak diubah di sini.

## 2. Keputusan yang diminta

**A (disarankan): opt-in lewat parameter baru `expect_status`.** Hanya jalur approval yang
mengirimnya. Pemanggil lain, termasuk konfirmasi pembayaran booking biasa, berperilaku persis
seperti sekarang. Kompatibel dua arah dengan backend lama/baru.

**B: setiap panggilan ber-`payment` menjadi claim-only.** Ini menutup race yang sama juga untuk
booking biasa. Tetapi perilaku hari ini berubah: pembayaran yang tiba **setelah** booking dilepas
atau dibatalkan tidak lagi menghidupkan booking itu diam-diam menjadi `BOOKED` (yang bisa
bertabrakan dengan booking lain di slot yang sama). Sebagai gantinya, backend menerima 409.
Pembayaran telat seperti itu belum punya jalur refund, jadi B butuh keputusan tambahan, dan
sebaiknya jadi spec tersendiri.

Sisa dokumen ini mengikuti **A**.

## 3. Kontrak plugin 1.8.4

`POST /praktiqu/v1/appointments/{id}/status` menerima argumen opsional baru:

```
expect_status: integer, enum [0,1,2,3,4]   // status yang harus dimiliki baris saat ditulis
```

Tanpa `expect_status`, perilakunya tidak berubah (termasuk fallback UPDATE tanpa syarat).

Dengan `expect_status`:

1. `UPDATE … SET status = %d WHERE id = %d AND status = %d (expect_status)`.
2. **Terklaim (1 baris):** lanjut seperti sekarang. Hook pembatalan/status menyala, dan
   `kc_appointment_payment_completed` hanya menyala bila ada `payment` dan move-nya
   `PENDING → BOOKED`. Jawaban 200 berisi `claimed: true`.
3. **Tidak terklaim:** baca ulang status.
   - Status sekarang sudah sama dengan `status` yang diminta → **200** dengan
     `claimed: false, payment_confirmed: false`, **tanpa hook apa pun**. Kasus ini terjadi saat
     approve diulang setelah jawaban sebelumnya hilang.
   - Status lain → **WP_Error 409** `praktiqu_status_conflict`, `data: { status: 409, current_status }`.
     Baris tidak disentuh, dan tidak ada hook yang menyala.
4. Kalau `$wpdb->query` mengembalikan `false`, jawabannya tetap 500 `praktiqu_status_update_failed`.

`readme.txt` dan header versi naik ke 1.8.4. Yang berubah hanya
`class-praktiqu-endpoint-appointments.php` dan `class-praktiqu-endpoint-rest-controller.php`
(deklarasi argumen).

## 4. Backend

- `setAppointmentStatus(id, status, payment?, opts?: { expectStatus?: number })` mengirim
  `expect_status`. Jumlah pemanggil di `status-writers-invariant` tidak berubah.
- Konflik dikenali dari `WpEndpointError` dengan `code === 'praktiqu_status_conflict'`.
- `confirmBooked` (dipakai `approveAwaiting` dan `completeApproval`) selalu mengirim
  `expectStatus: PENDING`, dengan atau tanpa order. Booking yang ditandai lunas manual ikut
  terlindungi.
- Jawaban konflik:
  - **Sekarang `CANCELLED`:** catatan dipindah **atomik** `APPROVED → CANCELLED` dengan
    `refundStatus = NEEDED`. Fungsi store baru `cancelApproved` memakai satu UPDATE bersyarat
    `WHERE state = 'APPROVED'`. Job pengingat dibatalkan, lalu audit
    `session.approval_cancelled` ditulis dengan `{ refundStatus: NEEDED, raced: true }`.
    `approveAwaiting` menjawab **409 `booking_cancelled`** ("Booking ini dibatalkan saat sedang
    disetujui; dana masuk daftar refund"). `completeApproval` (job pengingat / payment-verify /
    `/approve` ulang) melakukan hal yang sama tanpa melempar.
  - **Sekarang `BOOKED`:** diperlakukan sebagai sudah terkonfirmasi, seperti jalur "jawaban hilang"
    yang sudah ada.
  - **Sekarang `CHECK_IN` / `CHECK_OUT`** (misalnya tagihan dilunasi): `APPROVED` dibiarkan,
    pengingat sesi tidak dijadwalkan, dan kejadiannya dicatat `logging.warn`.
- Jalur "plugin gagal, baca ulang" yang sudah ada tetap berlaku untuk error selain 409.

## 5. Urutan rilis dan kompatibilitas

Urutan wajib: plugin 1.8.4 → backend. Kombinasi lain tetap aman:

| Plugin | Backend | Akibat |
|---|---|---|
| 1.8.3 | baru | `expect_status` diabaikan, jadi perilakunya sama dengan hari ini (race belum tertutup, tidak ada yang rusak) |
| 1.8.4 | lama | Backend lama tidak mengirim `expect_status`, jadi perilakunya sama dengan hari ini |

Tidak ada SQL. FE tidak perlu berubah, kecuali menampilkan detail error 409 `booking_cancelled`
apa adanya. Penanganan 409 generik yang sudah ada sudah cukup.

## 6. Tes

**Plugin**: `tests/test-appointments-set-status.php`, dijalankan di `php:8.4-cli` dengan tar lewat
stdin.

- `expect_status = 2` + `payment`, baris `PENDING`: menjadi `BOOKED`, `payment_completed` menyala
  sekali, `claimed: true`.
- `expect_status = 2` + `payment`, baris `CANCELLED`: 409 `praktiqu_status_conflict` dengan
  `current_status = 0`. Baris tetap `CANCELLED`, nol hook.
- `expect_status = 2`, baris sudah `BOOKED`: 200, `claimed: false`, nol hook.
- `expect_status = 2` tanpa `payment`, baris `PENDING`: menjadi `BOOKED`, tanpa `payment_completed`.
- Tanpa `expect_status`: semua tes yang sudah ada tetap lulus (regresi).

**Backend**:

- unit `approveAwaiting` / `completeApproval` untuk konflik `CANCELLED`, `BOOKED` dan `CHECK_OUT`;
- integrasi store untuk `cancelApproved` (hanya dari `APPROVED`);
- integrasi rute: plugin di-mock menjawab 409, lalu catatan menjadi `CANCELLED` + `NEEDED` dan
  sesi muncul di "Perlu refund".

## 7. Di luar cakupan

- "Batal setelah disetujui" (refund `NONE`). Tetap seperti dokumen induk.
- Crash di antara klaim `APPROVED` dan panggilan plugin, lalu pembatalan dari dashboard KiviCare
  (`APPROVED` + `CANCELLED`). Kasus ini tidak bisa dibedakan dari "batal setelah disetujui" tanpa
  kolom baru.
- Opsi B (§2).

## 8. Opsional, menumpang rilis plugin yang sama

Penolakan setengah jadi yang dirapikan lewat **pembacaan** (antrean/detail) tidak mengirim email
penolakan ke klien. Email hanya terkirim bila job pengingat yang merapikannya. Setelah crash,
pembacaan hampir selalu menang, karena psikolog memuat ulang halamannya.

Kalau ingin ditutup juga: tambahkan hook ke-7 `praktiqu_approval_rejection_notice` di 1.8.4.
Pembacaan yang memenangkan penulisan bersyarat `PENDING → CANCELLED` meng-enqueue hook itu dengan
`runAt = now`, lalu handler-nya (konteks sistem) mengirim email dan audit. Hasilnya tetap tepat
sekali, karena hanya pemenang penulisan yang meng-enqueue. **Perlu keputusan user: ikut atau
tidak.**
