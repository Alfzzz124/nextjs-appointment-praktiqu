# Reschedule sesi oleh staf — desain

Tanggal: 2026-10-21. Status: disetujui (lead), siap direncanakan.

Melanjutkan fondasi reschedule (PR #64: `Schedule_Write::move()`, outbox, lock jadwal per
psikolog, `create()` di bawah lock yang sama). Menggantikan definisi lama di
`specs/005-session-mgmt/spec.md` ("reschedule = batalkan + booking baru"): sesi
**dipindah di tempat**, jadi id janji, pembayaran, tagihan, approval, dan token klien tetap.

## 1. Keputusan produk

| Pertanyaan | Keputusan |
|---|---|
| Siapa yang memindah | Staf, langsung pindah. Klien tidak perlu menyetujui dan tidak bisa memindah sendiri. |
| Peran | Super admin; admin klinik dan resepsionis untuk sesi dalam cakupan kliniknya; psikolog hanya untuk sesinya sendiri. Klien ditolak. |
| Pemberitahuan | Email ke klien **dan** psikolog: jadwal lama → baru, plus alasan bila diisi. |
| Writer KiviCare tanpa hook (admin WP, Google inbound, CSV) | Tidak ditambal; dibatasi operasional. Deteksi bentrok pasca-tulis menyusul, bukan di sini. |

Di luar lingkup: pindah ke psikolog/klinik/layanan lain, klien memindah sendiri, deteksi
bentrok pasca-tulis, membuat link Meet (route `regenerate-video-conference` masih stub).

## 2. Kondisi produksi yang membentuk desain (dicek read-only 2026-10-21)

- Pengingat yang benar-benar jalan adalah pengingat kita (`praktiqu_session_send_reminder`,
  dijadwalkan BE). Setelan pengingat KiviCare `on` (24 jam), tapi job Pro
  (`kivicare_pro_appointment_reminder`) tidak pernah terjadwal dan job core terakhir jalan
  2026-09-30.
- Google Meet: 36 psikolog terhubung, 55 layanan telemed, tapi 0 dari 14 janji 30 hari terakhir
  punya event Meet dan 0 janji mendatang punya event Google Calendar (Pro). Booking lewat
  sistem kita tidak membuat event itu.
- Semua tabel `wp_kc_*` InnoDB; jam server DB UTC.

Jadi sinkron Meet/Calendar dan pengingat KiviCare harus **benar bila ada**, dan menjadi no-op
untuk janji yang tidak punya.

## 3. Alur

```
FE "Pindah jadwal"  →  Laravel POST /dashboard/sesi/{id}/jadwal
  →  BE POST /api/v1/sessions/{id}/reschedule { slotDate, startTime, reason? }
       1. otorisasi + cakupan (loadForActor), status, belum mulai
       2. slot baru: bukan masa lalu, bukan hari libur, tidak bentrok (kecuali dirinya), bukan slot yang sama
       3. plugin POST /appointments/{id}/reschedule { start_date, start_time, expected, actor, request_id }
            Schedule_Write::move()  — lock psikolog, CAS, cek bentrok, UPDATE, baris outbox (1 transaksi)
            proses baris outbox itu langsung (Meet / Google Calendar / pengingat KiviCare)
       4. baca ulang sesi → syncSessionReminders(row)
       5. email klien + psikolog (gagal = dicatat, tidak membatalkan)
       6. audit session.rescheduled
```

## 4. Plugin (praktiqu-endpoint 1.8.6)

### 4.1 Route `POST /praktiqu/v1/appointments/{id}/reschedule`

Body:

```json
{
  "start_date": "2026-10-28", "start_time": "10:00:00",
  "expected": { "doctor_id": 34, "clinic_id": 3, "status": 1,
                "start_date": "2026-10-27", "start_time": "09:00:00",
                "end_date": "2026-10-27", "end_time": "10:00:00" },
  "actor": "wp:24", "request_id": "<uuid>"
}
```

- `expected` dinormalisasi ke kunci kolom (`appointment_start_date`, …) dan jam `H:i:s` sebelum
  CAS, supaya `09:00` vs `09:00:00` tidak terbaca stale.
- `bounds` = selalu benar. Validitas slot (jam praktik, durasi) adalah wewenang BE, sama seperti
  `create()`. Plugin menjamin hal yang hanya bisa dijamin di bawah lock: tidak bentrok, data tidak
  berubah sejak dibaca, belum lewat, tidak lewat tengah malam.
- Durasi tetap durasi lama (sudah begitu di `move()`).
- `kc_appointment_updated` **tidak** dipanggil: listener Pro (`saveCustomFormData`,
  `handleCustomFieldsUpdate`) membaca isi form dari request dan bisa mengosongkan custom field
  bila dipanggil tanpa form.

Jawaban 200:

```json
{ "id": 812, "start_date": "2026-10-28", "start_time": "10:00:00",
  "end_date": "2026-10-28", "end_time": "11:00:00",
  "previous": { "start_date": "2026-10-27", "start_time": "09:00:00", "end_time": "10:00:00" },
  "sync": { "outbox_id": 5, "ok": true } }
```

Kesalahan (semua tanpa menulis apa pun):

| `move()` | HTTP | Kode |
|---|---|---|
| `schedule_conflict` | 409 | `praktiqu_schedule_conflict` |
| `schedule_stale` | 409 | `praktiqu_schedule_stale` |
| `schedule_terminal` | 409 | `praktiqu_schedule_terminal` |
| `schedule_unchanged` | 400 | `praktiqu_schedule_unchanged` |
| `schedule_invalid` | 400 | `praktiqu_schedule_invalid` |
| `schedule_unavailable` | 422 | `praktiqu_schedule_unavailable` |
| `schedule_busy` | 503 | `praktiqu_schedule_busy` |
| `schedule_db_error`, `schedule_requires_innodb`, `schedule_outbox_failed`, `schedule_transaction_failed` | 500 | `praktiqu_schedule_db_error` |
| janji tidak ada | 404 | `praktiqu_appointment_not_found` |

### 4.2 Pemrosesan outbox

- Setelah `move()` commit, route langsung memproses baris outbox-nya. Hasilnya dilaporkan di
  `sync`, tapi kegagalannya tidak mengubah jawaban 200: jadwal sudah pindah.
- `move()` mengembalikan `outbox_id` (id baris yang ditulisnya).
- Sweep berulang `praktiqu_schedule_outbox_sweep` tiap 5 menit (Action Scheduler, didaftarkan
  sekali bila belum terjadwal) memproses ≤ 20 baris `pending` yang jatuh tempo, urut
  `next_attempt_at`.
- `Schedule_Outbox_Processor` meneruskan `payload` ke kedua adapter (sekarang hanya kalender
  yang menerimanya).

### 4.3 Adapter (kelas baru `Schedule_Sync`)

Kalender, `calendar(int $appointmentId, array $payload)`; lempar exception bila gagal:
- Google Meet: ada mapping `KCGMAppointmentGoogleMeetMapping` dengan `eventId` dan provider
  telemed psikolog `googlemeet` → `update_meeting(eventId, …)` dengan jam baru, meniru
  `AppointmentsController::updateAppointment` KiviCare. `false` → lempar.
- Zoom: ada mapping → `update_meeting(zoomId, { start_time, duration, doctor_id })`.
- Google Calendar Pro: ada baris di `wp_kc_gcal_appointment_mapping` dan Pro aktif →
  `GoogleCalendarIntegration::addAppointmentToGoogleCalendars(...)`, seperti
  `syncAppointmentToGoogleCalendars` KiviCare (memperbarui event yang ada). Facade ini menelan
  error-nya sendiri, jadi langkah ini *best effort*; terdokumentasi.
- Tidak ada mapping → no-op.

Pengingat KiviCare, `reminders(int $appointmentId, array $payload)`:
- Untuk `kivicare_pro_appointment_reminder`/`kivicare-pro-reminders` dan
  `kivicare_appointment_reminder`/`kivicare-reminders`: bila ada action yang antre untuk
  `[$appointmentId]`, batalkan lalu jadwalkan ulang di `waktu_lama + (mulai_baru − mulai_lama)`
  bila masih di depan. Tanpa menghitung ulang setelan KiviCare.

Keduanya idempoten: memproses ulang baris yang sama memberi hasil yang sama.

## 5. BE

### 5.1 Route `POST /api/v1/sessions/{id}/reschedule`

- Zod: `slotDate` `YYYY-MM-DD`, `startTime` `HH:MM` atau `HH:MM:SS`, `reason` ≤ 500 (opsional).
- Bentuk error sama dengan route aksi sesi lain: problem+json dengan kode di `title`.
- 200 `{ data: Session }` (sesi hasil baca ulang).

### 5.2 Service `rescheduleSession` (`src/services/session/reschedule.service.ts`)

1. `resolveKcActor` + `loadForActor` (cakupan klinik sudah ditangani di sana).
2. Peran: SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST, atau PROFESSIONAL pemilik sesi → selain itu
   `forbidden` 403.
3. Status BOOKED/PENDING, selain itu `not_reschedulable` 409. PENDING yang sedang menunggu
   approval psikolog boleh dipindah; approval berlanjut di id yang sama. Sesi yang sudah mulai
   (jam mulai lama ≤ sekarang): `session_already_started` 409.
4. Slot baru:
   - masa lalu → `slot_in_past` 422;
   - sama dengan slot lama → `same_slot` 400;
   - hari libur → aturan `assertNotOffDay` yang sama dengan `createSession`;
   - bentrok → `findConflictingAppointments({ excludeAppointmentId })` → `slot_taken` 409.
   Durasi = durasi lama.
5. Plugin `rescheduleAppointment()` (di `appointments.write.ts`) dengan `expected` dari baris yang
   dibaca di langkah 1. Pemetaan error plugin:

| Plugin | BE |
|---|---|
| `praktiqu_schedule_conflict` | `slot_taken` 409 |
| `praktiqu_schedule_stale` | `session_changed` 409 ("muat ulang") |
| `praktiqu_schedule_terminal` | `not_reschedulable` 409 |
| `praktiqu_schedule_unchanged` | `same_slot` 400 |
| `praktiqu_schedule_unavailable` | `slot_in_past` 422 |
| `praktiqu_schedule_busy` | `schedule_busy` 503 |
| lainnya | dilempar apa adanya |

6. Baca ulang → `syncSessionReminders(row)`.
7. Email (`reschedule-email.ts`, builder murni seperti `approval/emails.ts`):
   - klien: "Jadwal sesi Anda dipindah": lama → baru, layanan, psikolog, alasan;
   - psikolog: salinannya.
   Dikirim lewat `sendEmail`; alamat kosong dilewati; gagal → `logging.error`, tidak dilempar.
8. Audit `session.rescheduled` dengan `{ from, to, reason, syncOk }`.

## 6. FE (Laravel)

- `DashboardController::mapAppt()` menambah `professionalId`, `clinicId`, `serviceId`
  (`serviceIds[0]`) dan `startTime` mentah.
- Baris "All Appointments": tombol **Pindah jadwal** di samping "Log Waktu", untuk `statusKey`
  BOOKED/PENDING. Peran tidak disaring di FE (pola `aksiStatus`); BE yang menolak.
- Modal (pola Log Waktu, wajib `x-trap`): jadwal sekarang, input tanggal, daftar jam dari
  `/dashboard/appointments/slots` (professionalId, serviceId, clinicId dari baris), alasan
  opsional, tombol simpan. State `pindah*` sendiri; fungsi pencari jam janji manual dibuat
  menerima parameter supaya bisa dipakai bersama.
- Route `POST /dashboard/sesi/{appointment}/jadwal` → `SessionScheduleController@update` →
  BE. Error dibaca dari `code ?? title`, dipetakan ke pesan Indonesia; status 424 untuk
  penolakan upstream (bukan 502).
- Sukses: baris diperbarui di tempat (`date`, `dateIso`, `time`, `startTime`).

## 7. Pengujian

- Plugin (DB nyata, `schedule-db-shim.php`): route sukses + setiap pemetaan error; `outbox_id`;
  sweep memproses yang jatuh tempo saja; adapter pengingat menggeser action sejauh selisih;
  adapter kalender no-op tanpa mapping, memanggil provider dengan jam baru bila ada mapping,
  melempar bila provider gagal.
- BE (vitest): service (peran, status, sudah mulai, masa lalu, slot sama, bentrok, pemetaan error
  plugin, pengingat dijadwal ulang dari baris baca ulang, email terkirim/gagal tidak menggagalkan),
  route (validasi, bentuk error).
- FE: feature test controller (sukses, pemetaan error, body yang dikirim ke BE), tes JS modal,
  `FokusModalTest`.
- Tutorial: FE lokal + backend tiruan, Playwright mengambil screenshot tiap langkah.

## 8. Rilis

1. SQL `prisma/manual/2026-10-19-schedule-sync-outbox.sql` di prod (wajib sebelum plugin:
   `move()` menolak tanpa tabel outbox InnoDB).
2. Plugin 1.8.6.
3. BE (merge → auto-deploy Hostinger; cek build-nya benar-benar jalan).
4. FE (push ke `main` FE = deploy produksi).

BE tanpa plugin 1.8.6 menjawab route reschedule dengan 404 dari plugin; FE tanpa BE tidak
menampilkan apa-apa yang bisa berhasil. Urutan di atas menghindari keduanya.
