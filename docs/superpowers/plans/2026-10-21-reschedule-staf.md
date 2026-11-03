# Reschedule sesi oleh staf — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staf (super admin, admin klinik, resepsionis, psikolog pemilik) bisa memindah jadwal sesi BOOKED/PENDING dari dashboard; jadwal pindah di tempat, pengingat/Meet/Calendar ikut, klien & psikolog dapat email.

**Architecture:** FE Laravel → BE Next.js `POST /api/v1/sessions/{id}/reschedule` (validasi, otorisasi, pengingat, email, audit) → plugin WP `POST /praktiqu/v1/appointments/{id}/reschedule` (`Schedule_Write::move()` di bawah lock psikolog + outbox yang langsung diproses, sweep Action Scheduler untuk retry).

**Tech Stack:** PHP 8.4 (WordPress plugin, tes PHP polos + MySQL nyata), Next.js/TypeScript + vitest, Laravel 13 + Alpine.js (FE), Playwright (tutorial).

Spec: `docs/superpowers/specs/2026-10-21-reschedule-staf-design.md`.

## Global Constraints

- Copy UI dan email berbahasa Indonesia; tidak ada kata "doctor/Dokter" di teks yang dilihat pengguna — pakai "psikolog"/"profesional".
- Status mentah KiviCare: 0 CANCELLED, 1 BOOKED, 2 PENDING, 3 CHECK_OUT, 4 CHECK_IN. Yang boleh dipindah: 1 dan 2.
- Lock jadwal: `praktiqu_doc_schedule_<doctor_id>` — sama dengan `Schedule_Write::locked()`.
- Semua tulisan ke `wp_kc_appointments` lewat plugin, tidak pernah SQL langsung dari BE.
- Plugin naik ke **1.8.6**. SQL outbox wajib ada di prod sebelum plugin 1.8.6.
- FE tidak pernah menjawab 502 (Cloudflare menimpa body) — penolakan upstream = 424.
- Setiap modal FE wajib `x-trap="!!<state>"` (FokusModalTest).
- Tes DB plugin dijalankan lewat runner Docker (`php:8.4-cli` + `pdo_mysql`, `--network container:praktiqu-mysql`, env `PRAKTIQU_TEST_MYSQL_*`).

---

### Task 1: `move()` mengembalikan `outbox_id`; adapter pengingat menerima payload

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-schedule-write.php` (INSERT outbox)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-schedule-outbox.php` (`reminderSync` menerima payload)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/tests/schedule-db-shim.php` (`insert_id`)
- Test: `tests/test-schedule-write-db.php`, `tests/test-schedule-outbox-db.php`

**Interfaces:**
- Produces: `Schedule_Write::move(...)` → `array` berisi kolom baris setelah pindah **plus** `'outbox_id' => int`. `reminderSync` dipanggil `($appointmentId, array $payload)`.

- [ ] Tes: `move()` hasilnya punya `outbox_id` = id baris outbox yang tertulis; tes outbox: closure pengingat menerima payload yang sama dengan kalender.
- [ ] Jalankan → gagal (`outbox_id` tidak ada; closure dipanggil dengan 1 argumen).
- [ ] Implementasi: setelah INSERT outbox, `$outboxId = (int) $this->db->insert_id;` (wpdb mengisi `insert_id` untuk INSERT lewat `query()`); return `array_merge($row, $new, ['outbox_id' => $outboxId])`. Processor: `($this->reminderSync)($appointmentId, $payload)` dengan `$payload` hasil decode sekali.
- [ ] Shim: `public int $insert_id = 0;` diisi `(int) $this->pdo->lastInsertId()` setelah `query()` yang diawali `INSERT`.
- [ ] Jalankan semua tes DB plugin → hijau. Commit.

### Task 2: Adapter `Schedule_Sync` (Meet/Zoom/Google Calendar + pengingat KiviCare)

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-schedule-sync.php`
- Test: `Wordpress-Plugin/praktiqu-endpoint/tests/test-schedule-sync.php` (tanpa DB; shim kelas KiviCare + fungsi Action Scheduler)

**Interfaces:**
- Produces: `final class Schedule_Sync { public function calendar(int $appointmentId, array $payload): void; public function reminders(int $appointmentId, array $payload): void; }` — keduanya melempar `\RuntimeException` bila langkah yang bisa dideteksi gagal. `payload` = bentuk yang ditulis `move()`: `{from:{date,start,end}, to:{date,start,end}, timezone}`.

Perilaku `calendar()`:
1. `\App\baseClasses\KCTelemedFactory` tidak ada → lewati telemed. Ada → `KCAppointment::find($id)`; `$provider = KCTelemedFactory::get_provider_by_doctor_id($appt->doctorId)`; `null` → lewati; `$mapping = $provider->get_meeting_by_appointment($id)`; kosong → lewati.
   - `googlemeet` + `$mapping->eventId` → `update_meeting($eventId, ['appointment_id','topic' => nama layanan dipisah koma atau 'Telemed Appointment','summary' => $appt->description,'attendees' => [email klien, email psikolog],'doctor_id','start_time' => ISO-8601 dengan offset,'end_time','timezone' => wp_timezone_string()])`; `false` → `RuntimeException('meet_update_failed')`.
   - `zoom` + `$mapping->zoomId` → `update_meeting($zoomId, ['start_time' => 'Y-m-d H:i:s','duration' => menit,'doctor_id'])`; `false` → `RuntimeException('zoom_update_failed')`.
2. `\KCProApp\controllers\api\GoogleCalendarIntegration` ada **dan** `wp_kc_gcal_appointment_mapping` punya baris untuk janji ini → `GoogleCalendarIntegration::getInstance()->addAppointmentToGoogleCalendars($id, $appt->toArray() + status, KCClinic::find, KCPatient::find, KCDoctor::find, layanan+nama)`. Best effort (facade menelan error).

Perilaku `reminders()`:
- Untuk `[['kivicare_pro_appointment_reminder','kivicare-pro-reminders'],['kivicare_appointment_reminder','kivicare-reminders']]`: `$next = as_next_scheduled_action($hook, [$id], $group)`; bila int → `as_unschedule_action($hook, [$id], $group)`; `$shift = ts(to) − ts(from)` (tanggal+jam lokal di `payload.timezone`); `$at = $next + $shift`; bila `$at > time()` → `as_schedule_single_action($at, $hook, [$id], $group)`.

Tes (shim kelas di namespace aslinya, rekam panggilan):
- [ ] tanpa provider/mapping → tidak ada panggilan, tidak melempar;
- [ ] Meet: `update_meeting` dipanggil dengan eventId dan `start_time`/`end_time` jam baru (offset +07:00); `false` → melempar;
- [ ] Zoom: durasi menit benar;
- [ ] GCal: dipanggil hanya bila ada baris mapping;
- [ ] pengingat: action antre digeser sejauh selisih (mis. +1 hari +1 jam); action yang jatuh ke masa lalu tidak dijadwalkan ulang; tanpa action antre → tidak menjadwalkan apa pun.
- [ ] Jalankan → gagal (kelas belum ada). Implementasi. Hijau. Commit.

### Task 3: `Appointments::reschedule()` + route `POST /appointments/{id}/reschedule`

**Files:**
- Modify: `includes/class-praktiqu-endpoint-appointments.php` (method `reschedule`)
- Modify: `includes/class-praktiqu-endpoint-rest-controller.php` (route + `handle_reschedule_appointment`)
- Test: `tests/test-appointments-reschedule-db.php` (DB nyata)

**Interfaces:**
- Consumes: `Schedule_Write::move()` (Task 1), `Schedule_Outbox_Processor`, `Schedule_Sync` (Task 2).
- Produces: `Appointments::reschedule(int $id, array $params): array|\WP_Error`; jawaban 200 dan tabel error persis seperti spec §4.1. `Appointments` menerima `?\Closure $outbox_factory = null` di konstruktor (default membuat processor dengan `Schedule_Sync`) supaya tes bisa menyuntik adapter tiruan.

Langkah:
- [ ] Tes: sukses (baris pindah, `previous`, `sync.ok`, outbox `done`); `expected` dengan jam `09:00` (tanpa detik) tetap cocok; tiap kode error (conflict 409, stale 409, terminal 409, unchanged 400, invalid 400, unavailable 422, busy 503, db_error 500, not_found 404); adapter gagal → tetap 200, `sync.ok=false`, outbox `pending` dengan `last_error`.
- [ ] Jalankan → gagal. Implementasi:
  - validasi `start_date`/`start_time` ada; normalisasi `start_time` ke `H:i:s`; `expected` dipetakan `doctor_id, clinic_id, status, start_date→appointment_start_date, start_time→…, end_date, end_time` dan jam dinormalisasi;
  - janji tidak ada (`SELECT id … WHERE id`) → 404 `praktiqu_appointment_not_found`;
  - `move($id, $expected, $date, $time, $actor, $requestId, static fn () => true)`; tangkap `RuntimeException` → tabel error;
  - proses outbox `$result['outbox_id']` dengan processor dari factory; bungkus try/catch Throwable (gagal tidak mengubah 200).
- [ ] Route: `register_rest_route($ns, '/appointments/(?P<id>\d+)/reschedule', ['methods' => CREATABLE, 'callback' => handle_reschedule_appointment, 'permission_callback' => verify_service_token, 'args' => ['id' => absint]])`.
- [ ] Hijau (semua tes plugin). Commit.

### Task 4: Sweep outbox + rilis plugin 1.8.6

**Files:**
- Modify: `includes/class-praktiqu-endpoint-jobs.php` (hook `praktiqu_schedule_outbox_sweep`, handler, self-register)
- Modify: `praktiqu-endpoint.php` (require schedule-outbox + schedule-sync; versi 1.8.6), `readme.txt`
- Test: `tests/test-schedule-outbox-db.php` (tambah kasus sweep) atau `tests/test-schedule-sweep-db.php`

**Interfaces:**
- Produces: `Schedule_Outbox_Processor::sweep(int $limit = 20): array` → `['processed' => int, 'ok' => int]`, memilih `status='pending' AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT n`. `Jobs::handle_schedule_outbox_sweep()` memanggilnya. `Jobs::ensure_outbox_sweep()` di `init`: bila opsi `praktiqu_outbox_sweep_registered` ≠ `'1'` dan `as_has_scheduled_action` false → `as_schedule_recurring_action(time()+300, 300, 'praktiqu_schedule_outbox_sweep', [], Jobs::GROUP)` lalu set opsi.
- [ ] Tes sweep: 3 baris (pending jatuh tempo, pending belum jatuh tempo, done) → hanya yang pertama diproses.
- [ ] Gagal → implementasi → hijau. Versi + readme changelog 1.8.6. `php -l` semua. Commit.

### Task 5: BE — klien plugin `rescheduleAppointment` + email reschedule

**Files:**
- Modify: `src/repositories/wp/appointments.write.ts`
- Create: `src/services/session/reschedule-email.ts`
- Test: `tests/unit/session/reschedule-email.test.ts`

**Interfaces:**
- Produces:
  - `rescheduleAppointment(id: number, input: { startDate: string; startTime: string; expected: { doctorId: number; clinicId: number; status: number; startDate: string; startTime: string; endDate: string; endTime: string }; actor: string; requestId: string }): Promise<{ id: number; startDate: string; startTime: string; endDate: string; endTime: string; syncOk: boolean }>`
  - `buildClientRescheduledEmail(f: RescheduleMailFacts): BuiltEmail`, `buildProfessionalRescheduledEmail(f): BuiltEmail`; `RescheduleMailFacts = SessionMailFacts & { previousStartsAtUtc: Date; reason?: string }`.
- [ ] Tes email: subjek "Jadwal sesi Anda dipindah"; badan memuat tanggal/jam lama dan baru (format `formatWaktu`), layanan, psikolog, alasan bila ada dan tidak ada baris alasan bila kosong; HTML di-escape (`<b>` di alasan jadi `&lt;b&gt;`); email psikolog menyebut nama klien.
- [ ] Gagal → implementasi → hijau. Commit.

### Task 6: BE — `rescheduleSession` + route

**Files:**
- Create: `src/services/session/reschedule.service.ts`
- Modify: `src/services/session/session.service.ts` (ekspor `loadForActor`, `assertNotOffDay`, `reread`)
- Create: `src/app/api/v1/sessions/[id]/reschedule/route.ts`
- Test: `tests/unit/session/reschedule.service.test.ts`, `tests/unit/session/reschedule.route.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces: `rescheduleSession(args: { actor: Actor; sessionId: number; slotDate: string; startTime: string; reason?: string; now?: Date }): Promise<SessionWithRelations>`; melempar `SessionServiceError` dengan kode spec §5.2.
- [ ] Tes service: klien → forbidden; psikolog bukan pemilik → forbidden; CANCELLED → not_reschedulable; sudah mulai → session_already_started; jam baru lewat → slot_in_past; slot sama → same_slot; libur → unavailable; bentrok → slot_taken (dan `findConflictingAppointments` dipanggil dengan `excludeAppointmentId`); tiap error plugin dipetakan; sukses → `rescheduleAppointment` menerima `expected` dari baris + durasi lama, `syncSessionReminders` dipanggil dengan baris baca ulang, dua email terkirim, audit `session.rescheduled`; email gagal → tetap sukses.
- [ ] Tes route: body tidak valid → 422; error service → problem+json dengan `title` = kode dan status yang sama; sukses → 200 `{data}`.
- [ ] Gagal → implementasi → hijau; `vitest run` penuh + `tsc --noEmit`. Commit.

### Task 7: FE — data baris + controller + route

**Repo:** `/home/ahmad/projects/praktiqu-fe` (worktree baru dari `origin/main`).

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php` (`mapAppt`: `professionalId`, `clinicId`, `serviceId`, `startTime`)
- Create: `app/Http/Controllers/SessionScheduleController.php`
- Modify: `routes/web.php` (`POST /dashboard/sesi/{appointment}/jadwal` di grup `staff:any`)
- Test: `tests/Feature/SessionScheduleTest.php`, `tests/Feature/DashboardFieldMappingTest.php`

**Interfaces:**
- Produces: `POST /dashboard/sesi/{id}/jadwal` body `{tanggal: 'Y-m-d', jam: 'H:i', alasan?: string}` → 200 `{date, dateIso, time, startTime}` (format sama dengan `mapAppt`), atau 422 validasi / 424 penolakan BE dengan `{message}` Indonesia.
- [ ] Tes: sukses (BE menerima `{slotDate, startTime:'HH:MM:00', reason}`), pemetaan `slot_taken`/`session_changed`/`same_slot`/`slot_in_past`/`not_reschedulable`/`session_already_started`/403/404 → pesan; validasi tanggal/jam; baris mapAppt punya kolom baru.
- [ ] Gagal → implementasi → hijau (`php artisan test`). Commit.

### Task 8: FE — tombol + modal "Pindah jadwal"

**Files:**
- Modify: `resources/views/dashboard.blade.php` (state `pindah*`, fungsi, tombol, modal)
- Test: `tests/js/pindah-jadwal.test.mjs`, `tests/Feature/FokusModalTest.php` (lolos tanpa perubahan bila `x-trap` benar)

**Interfaces:**
- Consumes: Task 7 route; `/dashboard/appointments/slots?professionalId&serviceId&clinicId&date`.
- [ ] Tes JS: `bukaPindah(r)` mengisi state dari baris; `muatJamPindah()` memanggil slots dengan id dari baris; respon basi diabaikan (seq guard); `simpanPindah()` POST ke `/dashboard/sesi/{id}/jadwal` dan memperbarui `r.date/r.dateIso/r.time/r.startTime`; error ditampilkan di `pindahError`; tombol hanya untuk `statusKey` BOOKED/PENDING.
- [ ] Gagal → implementasi → hijau (semua `tests/js/*.test.mjs` + `php artisan test` + `php artisan view:cache`). Commit.

### Task 9: Uji jalan lokal + tutorial bergambar

- [ ] FE lokal (Docker, backend tiruan yang meniru `/api/v1/sessions*`, slots, dan reschedule) + sesi staf palsu, Playwright: buka dashboard → tombol "Pindah jadwal" → modal → pilih tanggal → pilih jam → isi alasan → simpan → baris berubah; plus satu screenshot pesan error "slot sudah diambil".
- [ ] Susun tutorial (HTML, screenshot + langkah berbahasa Indonesia).
- [ ] Push branch BE + FE, siapkan link PR.
