# Approval Psikolog untuk Booking Online — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Psikolog yang menyalakan saklar "Butuh persetujuan saya untuk booking online" menerima setiap booking publik yang sudah dibayar sebagai permintaan. Sesinya tetap PENDING (slot terkunci, belum ada konfirmasi ke klien) sampai psikolog atau admin menyetujui (BOOKED) atau menolak (CANCELLED + "perlu refund").

**Architecture:**
- **Data.** Dua tabel app baru: `professional_approval_settings` (saklar per psikolog) dan `session_approvals` (satu baris per sesi lunas yang menunggu atau sudah diputuskan). Status KiviCare tidak disentuh: sesi yang menunggu tetap `PENDING`, dan baris approval-lah yang membedakannya dari "belum dibayar".
- **Backend.** Modul baru `src/services/approval/` berisi store, settings, schedule, emails, service, dan reminder-handler. Jalur lama yang menganggap PENDING = belum bayar (`applyPaidSideEffectsPublic`, `cancelIfStillPending`, job booking-tak-dibayar, `invalidatePendingForOffDay`, `transitionSession`, pembatalan publik dan bulk) bertanya dulu ke baris approval. Keputusan diklaim lewat `UPDATE … WHERE state='AWAITING'` sebelum janji temu disentuh.
- **Plugin.** Satu hook job baru, `praktiqu_approval_reminder`, untuk pengingat harian dan eskalasi.
- **FE Laravel.** Halaman Blade tersendiri `/dashboard/persetujuan` (antrean, detail, refund, pengaturan), menu dengan badge, label status baru di daftar Appointments, info sebelum bayar, pesan "menunggu konfirmasi psikolog" untuk klien, dan login yang kembali ke halaman tujuan.

**Tech Stack:** Next.js 15 route handlers + Prisma (MySQL WordPress DB) + vitest; plugin WordPress PHP (tes PHP biasa); Laravel 12 + Blade + Alpine.js + PHPUnit (PHP 8.4 via Docker).

**Spec:** `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`. Baca dulu §2 (keputusan user), §4 (aturan bisnis), dan §7.2 (jalur lama yang disesuaikan).

## Penyimpangan dari spec (diputuskan saat menyusun rencana)

1. **Tidak ada halaman "edit psikolog" untuk admin di FE.** Super admin hanya punya daftar dengan saklar aktif, dan admin klinik tidak punya halaman psikolog sama sekali. Saklar admin dan super admin dipindah ke tab **Pengaturan** di `/dashboard/persetujuan`: admin melihat psikolog klinik aktifnya, super admin memilih klinik dulu. Psikolog mengubah saklarnya sendiri di tab yang sama.
2. **Endpoint tambahan `GET /api/v1/sessions/{id}/approval`** untuk halaman detail. Isinya satu item berbentuk sama dengan item antrean.
3. **Sesi di luar scope dijawab 403 `forbidden`**, mengikuti `assertCanRead` di `session.service.ts` yang dipakai semua route `sessions/*`. Spec §7.3 menyebut 404. Route `professionals/*` tetap 404/403 seperti `route-scope.ts`.
4. **Objek `approval` untuk staf** juga membawa `rejectReason`, `refundedAt`, `refundedByName`, `refundNote`, dan `payment` (gateway, nomor order WooCommerce, nominal), karena tab refund membutuhkannya. Endpoint publik tetap tanpa nama, alasan, maupun nomor order.
5. **Pertanyaan terbuka spec §7.4 langkah 3 sudah terjawab.** `set_status(0)` di plugin (`class-praktiqu-endpoint-appointments.php`) hanya melakukan UPDATE dan menembakkan `kc_appointment_cancelled`/`kc_appointment_status_update`, tanpa menyentuh order WooCommerce. Penolakan aman ditulis langsung lewat `setSessionStatusDirect`.
6. **Login kembali ke URL tujuan.** FE belum punya mekanisme ini, padahal tautan di email menuju `/dashboard/persetujuan/{id}`. Task F1 menambahkannya, terbatas pada path `dashboard/…`.
7. **Sesi gratis yang dikonfirmasi staf** (tombol "tandai lunas" tanpa order pembayaran) ikut masuk antrean bila saklar psikolognya menyala, karena jalurnya sama dengan "tandai lunas". Bila ditolak, sesi itu muncul di tab refund tanpa order, dan admin menandainya selesai dengan catatan.
8. **Antrean tanpa saringan per psikolog.** Admin dan super admin melihat kolom nama psikolog di setiap baris, dan daftar diurutkan dari yang paling lama menunggu. Endpoint backend tetap menerima `professionalId` kalau saringan ini dibutuhkan nanti.
9. **Smoke test browser lokal diganti uji coba manual (G6).** Tes Feature FE sudah menutup setiap halaman dan aksi dengan backend palsu. Alur email → login → detail diuji ujung ke ujung oleh user dengan psikolog uji.

## Global Constraints

Berlaku untuk SETIAP task.

**Database**
- **Jangan pernah** menjalankan `prisma db push` atau `prisma migrate dev/deploy/reset`. `DATABASE_URL` adalah database WordPress. Tabel baru dibuat hanya lewat `prisma/manual/2026-10-19-approval-psikolog.sql`.
- Yang boleh: `npx prisma db execute --file <sql> --url <url-db-uji>` (URL wajib mengandung "test") dan `npx prisma generate`.
- Kolom tanggal baru boleh NULL; jangan pernah menulis `0000-00-00`.

**Kontrak**
- State approval: `AWAITING` | `APPROVED` | `REJECTED` | `CANCELLED`. Status refund: `NONE` | `NEEDED` | `DONE`.
- Hook job: **`praktiqu_approval_reminder`**. Event webhook: **`approval.reminder`**. Args selalu **objek** `{ appointmentId: number }`.
- Kode error (HTTP): `approval_already_decided` (409), `session_already_started` (422), `refund_not_needed` (409), `approval_not_found` (404), `upstream_failed` (502), `status_write_failed` (500), `forbidden` (403), `not_found` (404).
- Endpoint publik **tidak pernah** menjawab 409 baru (FE live membaca 409 di jalur publik sebagai "pending").
- Route baru **tidak** masuk daftar putih mode pemilik (`OWNER_ROUTES`).
- Psikolog yang saklarnya mati: **tidak ada perilaku yang berubah**.

**Plugin**
- Versi **1.8.2 → 1.8.3**. Satu-satunya perubahan: hook `praktiqu_approval_reminder`.

**Bahasa dan commit**
- Komentar kode: file backend baru berbahasa Inggris; file yang diubah mengikuti bahasanya sendiri; FE berbahasa Indonesia.
- Teks untuk pengguna (email, FE): Bahasa Indonesia.
- Commit berbahasa Indonesia, format conventional (`feat(approval): ...`), diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit hanya file yang disebut di task (`git add <path>`). **Jangan `git add -A`.**

**Repo backend + plugin**
- Repo `Alfzzz124/nextjs-appointment-praktiqu`, branch **`feat/approval-psikolog`** (dari `origin/main` e319e73; commit spec ba9e15c sudah ada).
- Worktree **`/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-psikolog`**.
- Push: `git push origin feat/approval-psikolog:refs/heads/feat/approval-psikolog` (key SSH lewat `core.sshCommand`; kalau ditolak, lihat memori `git-push-ssh-key-setup`).

**Repo FE**
- Repo `raakanaka/laravel-praktiqu`, branch **`feat/approval-psikolog`** dari `origin/main`.
- Worktree **`/home/ahmad/projects/praktiqu-fe/approval-psikolog`**.
- `main` FE auto-deploy ke produksi: **hanya lewat branch + PR, jangan pernah push ke `main`**.
- Repo FE tidak punya git identity: setiap commit memakai `git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit ...`.
- Push: `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/approval-psikolog`.

**Menjalankan tes**
- Backend: `npx vitest run <file>` dari worktree BE. DB uji = MySQL Docker `praktiqu-mysql`; `DATABASE_URL` di `.env.test.local` wajib mengandung "test".
- Typecheck backend: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → harus `0` (baseline saat rencana ditulis: 0). Folder `tests/` ikut diperiksa, jadi kode tes harus lolos tipe.
- Plugin: tidak ada PHP di WSL. Jalankan lewat Docker dengan tar di stdin (bind mount dari path WSL kosong):
  `tar cf - Wordpress-Plugin/praktiqu-endpoint | DOCKER_CONFIG=/tmp/dockercfg docker run --rm -i php:8.4-cli sh -c 'mkdir -p /src && tar xf - -C /src && <perintah>'`
- FE: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit [--filter X]`. `vendor/` harus **salinan**, bukan symlink.
- `/tmp/dockercfg/config.json` harus berisi `{}` (credential helper Docker Desktop rusak dari WSL): `mkdir -p /tmp/dockercfg && { test -f /tmp/dockercfg/config.json || echo '{}' > /tmp/dockercfg/config.json; }`.

**Rentang id uji backend** (masing-masing selebar 10.000; semuanya di bawah sapuan `>= 9_000_000` milik `tests/billing/fixtures.ts` dan di luar sapuan `8_700_000`–`8_799_999`)

| Task | Rentang |
|---|---|
| B1 | `8_850_000` |
| B6 | `8_860_000` |
| B7 | `8_870_000` |

**Blok mock "approval mati"** — dipakai tes lama yang me-mock `@/lib/db` atau me-mock repository satu per satu, supaya modul approval tidak menyentuh Prisma. Disebut di beberapa task; teksnya selalu persis ini:

```ts
// Psychologist approval (spec 2026-10-19) is out of scope here: no session waits for a
// psychologist and no psychologist has the switch on.
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: async () => null,
  findApprovals: async () => new Map(),
  claimDecision: async () => false,
}));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: async () => false,
  professionalsRequiringApproval: async () => new Set<number>(),
}));
```

## Peta file

**Plugin** (`Wordpress-Plugin/praktiqu-endpoint/`)

| File | Status | Tanggung jawab |
|---|---|---|
| `includes/class-praktiqu-endpoint-jobs.php` | ubah | Hook `praktiqu_approval_reminder`: allow-list, `add_action`, handler → webhook `approval.reminder` |
| `tests/test-jobs-approval-reminder.php` | baru | Tes PHP biasa untuk tiga hal di atas |
| `praktiqu-endpoint.php`, `readme.txt` | ubah | Versi 1.8.3 + changelog |

**Backend** (worktree BE)

| File | Status | Tanggung jawab |
|---|---|---|
| `prisma/manual/2026-10-19-approval-psikolog.sql` | baru | DDL dua tabel |
| `prisma/schema.prisma` | ubah | Model `ProfessionalApprovalSetting`, `SessionApproval` |
| `src/services/approval/store.ts` | baru | Akses data `session_approvals` + nama user, order pembayaran, kontak wp_users |
| `src/services/approval/settings.ts` | baru | Saklar per psikolog |
| `src/services/approval/schedule.ts` | baru | Aturan waktu pengingat/eskalasi (murni) |
| `src/services/approval/emails.ts` | baru | Isi empat email (murni) |
| `src/services/approval/service.ts` | baru | Hold, setujui, tolak, tutup-saat-batal, refund, view, antrean |
| `src/services/approval/reminder-handler.ts` | baru | Handler job `approval.reminder` |
| `src/services/approval/http.ts` | baru | Pemetaan error untuk route approval |
| `src/services/session/reminder-email.ts` | ubah | Ekspor `escapeHtml`, `formatWaktu` |
| `src/services/session/reminder-schedule.ts` | ubah | `sessionStartsAtUtc` menerima `Pick<SessionRow, …>` |
| `src/services/session/session.service.ts` | ubah | `transitionSession`, `invalidatePendingForOffDay`, `bulkCancelSessions`, field `approval` |
| `src/services/payments/payment.service.ts` | ubah | Hold saat lunas, penjaga order kedaluwarsa, `approval` di status pembayaran publik |
| `src/services/public/unpaid-booking.ts` | ubah | Penjaga approval |
| `src/services/public/public-booking.service.ts` | ubah | Tutup approval saat klien batal, `approval` di view publik |
| `src/services/public/public-catalog.service.ts` | ubah | `requiresApproval` di `PublicProfessional` |
| `src/repositories/wp/sessions.repo.ts` | ubah | `listSessionsByIds` |
| `src/lib/jobs/client.ts` | ubah | `JobHook` + hook baru |
| `src/app/api/v1/webhooks/wordpress-jobs/route.ts` | ubah | Impor handler approval |
| `src/app/api/v1/sessions/[id]/reject/route.ts` | ubah | `intent: 'reject'` |
| `src/app/api/v1/sessions/bulk/delete/route.ts` | ubah | Teruskan `actor.id` |
| `src/app/api/v1/sessions/approvals/route.ts` | baru | Antrean |
| `src/app/api/v1/sessions/[id]/approval/route.ts` | baru | Satu item |
| `src/app/api/v1/sessions/[id]/refund-done/route.ts` | baru | Tandai refund |
| `src/app/api/v1/professionals/[id]/approval-setting/route.ts` | baru | GET/PUT saklar |
| `docs/api/APPROVAL-PSIKOLOG-GUIDE.md` | baru | Kontrak untuk FE |
| `docs/api/API-ACCESS-GUIDE.md` | ubah | Baris endpoint baru |
| `docs/deploy/approval-psikolog-runbook.md` | baru | Urutan rilis |
| `tests/integration/approval/approval-store.test.ts` | baru | B1 |
| `tests/unit/approval/schedule.test.ts`, `emails.test.ts` | baru | B2 |
| `tests/unit/approval/service.test.ts` | baru | B3 |
| `tests/unit/approval/reminder-handler.test.ts`, `reminder-registration.test.ts` | baru | B4 |
| `tests/unit/approval/transition.test.ts` | baru | B5 |
| `tests/payments/orchestration.test.ts`, `tests/unit/public/unpaid-booking.test.ts`, `tests/public-booking/cancel.test.ts` | ubah | B6: mock approval yang bisa dikendalikan + kasus baru |
| `tests/integration/approval/public-requires-approval.test.ts` | baru | B6 |
| `tests/integration/approval/approval-routes.test.ts` | baru | B7 |
| `tests/unit/approval/status-writers-invariant.test.ts` | baru | B8 |
| Tes lama yang perlu blok mock / ekspektasi baru | ubah | B5, B6, B9 (disebut per task) |

**FE** (worktree FE)

| File | Status | Tanggung jawab |
|---|---|---|
| `app/Http/Middleware/StaffAuth.php` | ubah | Simpan URL tujuan `dashboard/…` |
| `app/Http/Controllers/AuthController.php` | ubah | `redirect()->intended(...)` saat login dan saat sudah login |
| `app/Services/LabelStatusJanji.php` | baru | Label + warna badge status janji temu, sadar approval |
| `app/Http/Controllers/DashboardController.php` | ubah | `mapAppt` memakai approval; jumlah persetujuan untuk badge menu |
| `app/Http/Controllers/SessionStatusController.php` | ubah | Label dari respons backend; teks aksi "menyetujui" |
| `app/Http/Controllers/PersetujuanController.php` | baru | Antrean, detail, setujui, tolak, refund, pengaturan |
| `resources/views/dashboard/persetujuan.blade.php` | baru | Halaman antrean + tab |
| `resources/views/dashboard/persetujuan-detail.blade.php` | baru | Halaman detail |
| `resources/views/dashboard/persetujuan-pengaturan.blade.php` | baru | Tab Pengaturan (F4) |
| `resources/views/dashboard.blade.php` | ubah | Menu + badge, aksi status untuk AWAITING, saringan, legenda, kartu Settings |
| `public/css/app.css` | ubah | `.badge.amber`, `.nav-badge` |
| `routes/web.php` | ubah | Route persetujuan |
| `app/Services/BookingApi.php` | ubah | `requiresApproval` di roster/psy; `approval` di checkPayment dan fetchAppointment |
| `resources/views/booking.blade.php` | ubah | Info sebelum bayar; catatan sukses |
| `app/Http/Controllers/BookingController.php` | ubah | `approval` ke `booking-kembali` |
| `resources/views/booking-kembali.blade.php` | ubah | Label lunas + menunggu psikolog |
| `resources/views/pasien/hasil.blade.php` | ubah | Label janji temu sadar approval |
| `tests/Feature/LoginTujuanTest.php` | baru | F1 |
| `tests/Unit/LabelStatusJanjiTest.php` | baru | F2 |
| `tests/Feature/AppointmentsApprovalTest.php` | baru | F2 |
| `tests/Feature/SessionStatusTest.php` | ubah | F2 |
| `tests/Feature/PersetujuanTest.php` | baru | F3 |
| `tests/Feature/PersetujuanPengaturanTest.php` | baru | F4 |
| `tests/Feature/PersetujuanMenuTest.php` | baru | F5 |
| `tests/Feature/BookingPersetujuanTest.php` | baru | F6 |

---

## Bagian P — Plugin

### Task P1: Hook `praktiqu_approval_reminder` (plugin 1.8.3)

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt`
- Test: `Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-approval-reminder.php`

**Interfaces:**
- Produces: hook `praktiqu_approval_reminder` (Action Scheduler, 1 argumen posisional `int $appointment_id`) → webhook `approval.reminder` dengan data `{ "appointmentId": <int> }`. Dipakai B4.

- [ ] **Step 1: Persiapan worktree dan Docker**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-psikolog
git status --short
git log --oneline -2
mkdir -p /tmp/dockercfg && { test -f /tmp/dockercfg/config.json || echo '{}' > /tmp/dockercfg/config.json; }
docker image ls php:8.4-cli --format '{{.Repository}}:{{.Tag}}'
```

Expected:
- `git status --short` kosong.
- Commit teratas `docs(spec): approval psikolog untuk booking online yang sudah dibayar`, di bawahnya `e319e73 Merge pull request #45`.
- `php:8.4-cli` tercetak. Kalau tidak ada, berhenti dan laporkan: pull image butuh credential helper yang rusak.

- [ ] **Step 2: Tulis tes (gagal)**

`Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-approval-reminder.php`:

```php
<?php
/**
 * Jobs: hook praktiqu_approval_reminder (plugin 1.8.3, approval psikolog).
 *
 * Plain PHP — no PHPUnit, no WordPress. WordPress and Action Scheduler functions are
 * stubbed in the global namespace below; the class under test is the real file.
 *
 * What matters is the contract with Next.js:
 *   - enqueue() must accept the hook, or every reminder is dropped with a 400.
 *   - register() must wire it with ONE positional argument: Action Scheduler calls
 *     do_action_ref_array($hook, array_values($args)), so { appointmentId } arrives as
 *     the bare id.
 *   - the handler must call back with event approval.reminder and data { appointmentId },
 *     which is what src/services/approval/reminder-handler.ts reads.
 */

declare(strict_types=1);

namespace {
    define('ABSPATH', __DIR__ . '/');
    define('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST', true);

    $GLOBALS['pq_actions'] = [];
    $GLOBALS['pq_scheduled'] = [];
    $GLOBALS['pq_posts'] = [];

    function add_action(string $hook, $callback, int $priority = 10, int $accepted_args = 1): void
    {
        $GLOBALS['pq_actions'][$hook] = $accepted_args;
    }

    function as_schedule_single_action(int $timestamp, string $hook, array $args = [], string $group = '')
    {
        $GLOBALS['pq_scheduled'][] = [$timestamp, $hook, $args, $group];
        return 42;
    }

    function get_option(string $name, $default = false)
    {
        return [
            'praktiqu_endpoint_jobs_webhook_url'    => 'https://next.test/api/v1/webhooks/wordpress-jobs',
            'praktiqu_endpoint_jobs_webhook_secret' => 'rahasia',
        ][$name] ?? $default;
    }

    function wp_remote_post(string $url, array $args = [])
    {
        $GLOBALS['pq_posts'][] = ['url' => $url, 'args' => $args];
        return ['response' => ['code' => 200]];
    }

    function is_wp_error($thing): bool
    {
        return false;
    }
}

namespace PraktiQU\Endpoint {
    // Only type hints in Jobs::__construct refer to these; the real classes need WordPress.
    final class Service {}
    final class Payments {}
}

namespace {
    use PraktiQU\Endpoint\Jobs;
    use PraktiQU\Endpoint\Jobs_Webhook;
    use PraktiQU\Endpoint\Payments;
    use PraktiQU\Endpoint\Service;

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs-webhook.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs.php';

    $failures = 0;

    function check(string $label, $actual, $expected): void
    {
        global $failures;
        if ($actual === $expected) {
            echo "  ok   {$label}\n";
            return;
        }
        $failures++;
        echo "  FAIL {$label}\n";
        echo "       expected: " . var_export($expected, true) . "\n";
        echo "       actual:   " . var_export($actual, true) . "\n";
    }

    $jobs = new Jobs(new Service(), new Payments(), new Jobs_Webhook());

    echo "Jobs::register\n";
    $jobs->register();
    check('wires praktiqu_approval_reminder with one argument', $GLOBALS['pq_actions']['praktiqu_approval_reminder'] ?? null, 1);
    check('keeps the existing unpaid-cancel hook', $GLOBALS['pq_actions']['praktiqu_booking_unpaid_cancel'] ?? null, 1);

    echo "Jobs::enqueue\n";
    check('accepts praktiqu_approval_reminder', $jobs->enqueue('praktiqu_approval_reminder', 1761000000, ['appointmentId' => 7]), 42);
    check('schedules it in the praktiqu-jobs group', $GLOBALS['pq_scheduled'][0] ?? null, [1761000000, 'praktiqu_approval_reminder', ['appointmentId' => 7], 'praktiqu-jobs']);
    check('still refuses an unknown hook', $jobs->enqueue('praktiqu_tidak_dikenal', 1761000000, []), false);

    echo "Jobs::handle_approval_reminder\n";
    $jobs->handle_approval_reminder(7);
    $post = $GLOBALS['pq_posts'][0] ?? null;
    check('calls the jobs webhook once', count($GLOBALS['pq_posts']), 1);
    check('posts to the configured URL', $post['url'] ?? null, 'https://next.test/api/v1/webhooks/wordpress-jobs');
    check('body is { event, data }', json_decode((string) ($post['args']['body'] ?? ''), true), ['event' => 'approval.reminder', 'data' => ['appointmentId' => 7]]);
    check('event header names approval.reminder', $post['args']['headers']['X-PraktiQU-Webhook-Event'] ?? null, 'approval.reminder');

    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-psikolog
tar cf - Wordpress-Plugin/praktiqu-endpoint | DOCKER_CONFIG=/tmp/dockercfg docker run --rm -i php:8.4-cli sh -c 'mkdir -p /src && tar xf - -C /src && php /src/Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-approval-reminder.php'
```

Expected: `FAIL wires praktiqu_approval_reminder with one argument`, `FAIL accepts praktiqu_approval_reminder`, lalu fatal `Call to undefined method PraktiQU\Endpoint\Jobs::handle_approval_reminder()`. Exit code bukan 0.

- [ ] **Step 4: Implementasi di `includes/class-praktiqu-endpoint-jobs.php`**

(a) Di docblock kelas, setelah baris `praktiqu_booking_unpaid_cancel  — release a guest booking nobody started paying for`, tambahkan:

```php
 *   - praktiqu_approval_reminder      — remind a psychologist (and escalate to the clinic admin)
 *                                       about a paid booking waiting for their approval
```

(b) Di `register()`, setelah baris `add_action('praktiqu_booking_unpaid_cancel', ...)`:

```php
        add_action('praktiqu_approval_reminder', [$this, 'handle_approval_reminder'], 10, 1);
```

(c) Di `enqueue()`, tambahkan elemen terakhir pada `$allowed`:

```php
            'praktiqu_booking_unpaid_cancel',
            'praktiqu_approval_reminder',
        ];
```

(d) Tepat setelah method `handle_booking_unpaid_cancel()` (sebelum docblock `handle_log_purge`), tambahkan:

```php
    /**
     * Remind a psychologist about a paid booking that waits for their approval
     * (plugin 1.8.3). PraktiQU schedules it when the booking is paid and reschedules
     * it from its own handler until the booking is decided or its start passes.
     *
     * Args: [appointmentId (int)]. We only notify PraktiQU. It re-reads the booking and
     * its approval record and decides there — who to remind, whether to escalate to
     * the clinic admin, and when to run next — so this handler needs no guard.
     */
    public function handle_approval_reminder(int $appointment_id): void
    {
        $this->jobs_webhook->send('approval.reminder', [
            'appointmentId' => $appointment_id,
        ]);
    }
```

- [ ] **Step 5: Naikkan versi**

`praktiqu-endpoint.php`: ganti `Version:           1.8.2` menjadi `Version:           1.8.3`, dan `define('PRAKTIQU_ENDPOINT_VERSION', '1.8.2');` menjadi `define('PRAKTIQU_ENDPOINT_VERSION', '1.8.3');`.

`readme.txt`: ganti `Stable tag: 1.8.2` menjadi `Stable tag: 1.8.3`, lalu sisipkan tepat di bawah baris `== Changelog ==` (sebelum `= 1.8.2 =`):

```
= 1.8.3 =
* New job hook praktiqu_approval_reminder. PraktiQU schedules it when a paid
  booking waits for its psychologist's approval; when it fires the plugin calls
  back with approval.reminder and PraktiQU reminds the psychologist, escalates
  to the clinic admin once, and schedules the next run. Without the new Next.js
  nothing enqueues it, so this version is safe to deploy first.

```

- [ ] **Step 6: Jalankan tes baru, tes webhook lama, dan `php -l`**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-psikolog
tar cf - Wordpress-Plugin/praktiqu-endpoint | DOCKER_CONFIG=/tmp/dockercfg docker run --rm -i php:8.4-cli sh -c 'mkdir -p /src && tar xf - -C /src && cd /src/Wordpress-Plugin/praktiqu-endpoint && php tests/test-jobs-approval-reminder.php && php tests/test-jobs-webhook.php && php -l includes/class-praktiqu-endpoint-jobs.php && php -l praktiqu-endpoint.php'
```

Expected: dua kali `ALL PASS`, lalu dua baris `No syntax errors detected`.

- [ ] **Step 7: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-approval-reminder.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php Wordpress-Plugin/praktiqu-endpoint/readme.txt
git commit -m "$(cat <<'EOF'
feat(plugin): hook job praktiqu_approval_reminder (1.8.3)

Pengingat harian untuk booking lunas yang menunggu persetujuan psikolog.
Plugin hanya meneruskan approval.reminder ke Next.js; keputusan ada di sana.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Bagian B — Backend

### Task B1: Tabel, model Prisma, `store.ts`, `settings.ts`

**Files:**
- Create: `prisma/manual/2026-10-19-approval-psikolog.sql`
- Modify: `prisma/schema.prisma` (tambahkan dua model tepat setelah `model ClinicOwner { … }`)
- Create: `src/services/approval/store.ts`
- Create: `src/services/approval/settings.ts`
- Test: `tests/integration/approval/approval-store.test.ts`

**Interfaces:**
- Produces (dipakai B3–B7):
  - `APPROVAL_STATE`, `REFUND_STATUS`, tipe `ApprovalState`, `RefundStatus`, `ApprovalRecord`, `Decision`, `QueueFilter`, `QUEUE_FILTERS`, `QueueScope`, `PaymentSummary`
  - `findApproval(appointmentId: number): Promise<ApprovalRecord | null>`
  - `findApprovals(appointmentIds: number[]): Promise<Map<number, ApprovalRecord>>`
  - `insertAwaiting(input: NewApproval): Promise<boolean>` (false = sudah ada)
  - `claimDecision(appointmentId: number, d: Decision): Promise<boolean>`
  - `revertDecision(appointmentId: number, state: ApprovalState, decidedBy: string | null): Promise<void>`
  - `markRefundDone(appointmentId: number, by: string, note: string | null, now: Date): Promise<boolean>`
  - `touchReminder(appointmentId: number, at: Date): Promise<void>`, `markEscalated(appointmentId: number, at: Date): Promise<void>`
  - `listApprovals(filter: QueueFilter, scope: QueueScope, page: number, limit: number): Promise<{ items: ApprovalRecord[]; total: number }>`
  - `countApprovals(scope: QueueScope): Promise<{ awaiting: number; refundNeeded: number }>`
  - `userNames(ids: Array<string | null>): Promise<Map<string, string>>`
  - `paymentOrdersByIds(ids: string[]): Promise<Map<string, PaymentSummary>>`
  - `findWpUserContact(wpUserId: number): Promise<{ email: string; name: string } | null>`
  - settings: `requiresApproval(id)`, `professionalsRequiringApproval(ids): Promise<Set<number>>`, `getApprovalSetting(id): Promise<ApprovalSetting>`, `setApprovalSetting(id, value, by): Promise<{ before: boolean; after: ApprovalSetting }>`

- [ ] **Step 1: Sambungkan `node_modules` dan env tes, pastikan MySQL uji menyala**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-psikolog
test -e node_modules || ln -s /home/ahmad/projects/nextjs-appointment-praktiqu/node_modules node_modules
test -e .env.test.local || cp /home/ahmad/projects/nextjs-appointment-praktiqu/.env.test.local .env.test.local
grep -c 'DATABASE_URL=.*test' .env.test.local
docker ps --filter name=praktiqu-mysql --format '{{.Names}} {{.Status}}'
git status --short
```

Expected: angka `1`, baris `praktiqu-mysql Up …`, dan `git status --short` kosong. Kalau container tidak jalan, minta user menyalakan Docker Desktop.

- [ ] **Step 2: Tulis SQL**

`prisma/manual/2026-10-19-approval-psikolog.sql`:

```sql
-- Psychologist approval for paid online bookings (spec 2026-10-19-approval-psikolog-design.md §5).
-- Apply by hand, per environment, BEFORE the Next.js that reads these tables goes live:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-19-approval-psikolog.sql
--
-- Written out rather than generated because this database also holds KiviCare's wp_*
-- tables, and `prisma db push` would try to reconcile them against a schema that does
-- not describe them.
--
-- professional_approval_settings: one psychologist's switch. No row = off.
-- session_approvals: one paid booking that waits for (or was decided by) its
--   psychologist. KiviCare has no status for "paid, waiting for approval", so the
--   appointment stays PENDING and this row says why.
--
-- `updatedBy`, `decidedBy`, `refundedBy` are users.id (a cuid). NULL decidedBy means
-- the system or a change made outside the app (KiviCare's own dashboard).

CREATE TABLE IF NOT EXISTS `professional_approval_settings` (
  `doctorWpUserId`    bigint unsigned NOT NULL,
  `requiresApproval`  tinyint(1)      NOT NULL DEFAULT 0,
  `updatedBy`         varchar(191)    NULL,
  `updatedAt`         datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`doctorWpUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_approvals` (
  `appointmentId`   bigint unsigned NOT NULL,
  `doctorWpUserId`  bigint unsigned NOT NULL,
  `clinicId`        bigint unsigned NOT NULL,
  `paymentOrderId`  varchar(191)    NULL,
  `state`           varchar(16)     NOT NULL,
  `requestedAt`     datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decidedAt`       datetime(3)     NULL,
  `decidedBy`       varchar(191)    NULL,
  `rejectReason`    varchar(500)    NULL,
  `refundStatus`    varchar(8)      NOT NULL DEFAULT 'NONE',
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

- [ ] **Step 3: Tambahkan model Prisma**

Di `prisma/schema.prisma`, tepat setelah blok `model ClinicOwner { … }` (diakhiri `@@map("clinic_owners")` dan `}`):

```prisma

/// A psychologist's switch: paid online bookings wait for their approval.
/// Table from prisma/manual/2026-10-19-approval-psikolog.sql — never db push.
model ProfessionalApprovalSetting {
  /// wp_users.ID of the psychologist
  doctorWpUserId   BigInt   @id @db.UnsignedBigInt
  requiresApproval Boolean  @default(false)
  /// users.id (cuid) of whoever last changed it
  updatedBy        String?  @db.VarChar(191)
  updatedAt        DateTime @default(now()) @updatedAt @db.DateTime(3)

  @@map("professional_approval_settings")
}

/// One paid booking waiting for, or decided by, its psychologist.
/// Table from prisma/manual/2026-10-19-approval-psikolog.sql — never db push.
model SessionApproval {
  /// wp_kc_appointments.id
  appointmentId  BigInt    @id @db.UnsignedBigInt
  doctorWpUserId BigInt    @db.UnsignedBigInt
  clinicId       BigInt    @db.UnsignedBigInt
  /// payment_orders.id; null when staff marked the booking paid by hand
  paymentOrderId String?   @db.VarChar(191)
  /// AWAITING | APPROVED | REJECTED | CANCELLED
  state          String    @db.VarChar(16)
  requestedAt    DateTime  @default(now()) @db.DateTime(3)
  decidedAt      DateTime? @db.DateTime(3)
  /// users.id; null = the system, or a change made outside the app
  decidedBy      String?   @db.VarChar(191)
  rejectReason   String?   @db.VarChar(500)
  /// NONE | NEEDED | DONE
  refundStatus   String    @default("NONE") @db.VarChar(8)
  refundedAt     DateTime? @db.DateTime(3)
  refundedBy     String?   @db.VarChar(191)
  refundNote     String?   @db.VarChar(500)
  lastReminderAt DateTime? @db.DateTime(3)
  escalatedAt    DateTime? @db.DateTime(3)

  @@index([doctorWpUserId, state], map: "session_approvals_doctor_state_idx")
  @@index([clinicId, state], map: "session_approvals_clinic_state_idx")
  @@index([refundStatus], map: "session_approvals_refund_idx")
  @@map("session_approvals")
}
```

- [ ] **Step 4: Generate client dan pasang tabel di DB uji**

```bash
npx prisma generate
TEST_URL="$(grep '^DATABASE_URL=' .env.test.local | cut -d= -f2- | tr -d '"')"
echo "$TEST_URL" | grep -qi test && npx prisma db execute --file prisma/manual/2026-10-19-approval-psikolog.sql --url "$TEST_URL"
```

Expected: `✔ Generated Prisma Client`, lalu `Script executed successfully.` Kalau `grep -qi test` gagal, **berhenti**: URL itu bukan DB uji.

- [ ] **Step 5: Tulis tes integrasi (gagal)**

`tests/integration/approval/approval-store.test.ts`:

```ts
/**
 * session_approvals + professional_approval_settings against the real test database.
 *
 * The tables are written by hand (prisma/manual/2026-10-19-approval-psikolog.sql), so this
 * file is also the check that the SQL and the Prisma models agree: a column the model
 * names but the SQL forgot fails here, not in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  claimDecision,
  countApprovals,
  findApproval,
  findApprovals,
  findWpUserContact,
  insertAwaiting,
  listApprovals,
  markEscalated,
  markRefundDone,
  paymentOrdersByIds,
  revertDecision,
  touchReminder,
  userNames,
} from '@/services/approval/store';
import {
  getApprovalSetting,
  professionalsRequiringApproval,
  requiresApproval,
  setApprovalSetting,
} from '@/services/approval/settings';

const BASE = 8_850_000;
const END = BASE + 10_000;
const DOCTOR_A = BASE + 20;
const DOCTOR_B = BASE + 21;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const WP_ADMIN = BASE + 30;
const T0 = new Date('2026-10-20T08:00:00.000Z');
const HOUR = 3_600_000;
const USER = 'approval-store-test-admin';

const inRange = { gte: BigInt(BASE), lt: BigInt(END) };

async function wipeApprovals() {
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
}

async function wipe() {
  await wipeApprovals();
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'approval-store-test-' } } });
}

function awaiting(id: number, doctor = DOCTOR_A, clinic = CLINIC_1, at = T0) {
  return insertAwaiting({ appointmentId: id, doctorWpUserId: doctor, clinicId: clinic, paymentOrderId: null, now: at });
}

/** Keep only rows from this file: other suites may leave rows in the shared table. */
const ours = (ids: number[]) => ids.filter((id) => id >= BASE && id < END);

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.user.create({
    data: {
      id: USER,
      email: `${USER}@test.local`,
      username: USER,
      firstName: 'Rina',
      lastName: 'Admin',
      displayName: 'Rina',
      role: 'CLINIC_ADMIN',
      status: 1,
    },
  });
  await prisma.kcUser.create({
    data: {
      id: BigInt(WP_ADMIN),
      userLogin: `u${WP_ADMIN}`,
      userEmail: 'admin@approval-store.test.local',
      displayName: 'Rina Admin Klinik',
      userRegistered: new Date(),
    },
  });
});

beforeEach(async () => {
  await wipeApprovals();
});

afterAll(async () => {
  await wipe();
});

describe('insertAwaiting', () => {
  it('creates one AWAITING row and refuses a second for the same appointment', async () => {
    expect(await awaiting(BASE + 100)).toBe(true);
    expect(await awaiting(BASE + 100)).toBe(false);

    const row = await findApproval(BASE + 100);
    expect(row).toMatchObject({
      appointmentId: BASE + 100,
      doctorWpUserId: DOCTOR_A,
      clinicId: CLINIC_1,
      paymentOrderId: null,
      state: 'AWAITING',
      refundStatus: 'NONE',
      decidedAt: null,
      decidedBy: null,
    });
    expect(row!.requestedAt.toISOString()).toBe(T0.toISOString());
  });

  it('findApproval answers null for an appointment without a row', async () => {
    expect(await findApproval(BASE + 999)).toBeNull();
  });
});

describe('claimDecision / revertDecision', () => {
  it('lets exactly one decision win', async () => {
    await awaiting(BASE + 101);

    expect(await claimDecision(BASE + 101, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 })).toBe(true);
    expect(
      await claimDecision(BASE + 101, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' }),
    ).toBe(false);

    expect(await findApproval(BASE + 101)).toMatchObject({ state: 'APPROVED', refundStatus: 'NONE', decidedBy: USER });
  });

  it('a rejection keeps its reason and needs a refund', async () => {
    await awaiting(BASE + 102);
    await claimDecision(BASE + 102, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'Di luar keahlian' });

    expect(await findApproval(BASE + 102)).toMatchObject({
      state: 'REJECTED',
      rejectReason: 'Di luar keahlian',
      refundStatus: 'NEEDED',
    });
  });

  it('a cancellation needs a refund too, with no reason', async () => {
    await awaiting(BASE + 103);
    await claimDecision(BASE + 103, { state: 'CANCELLED', decidedBy: null, decidedAt: T0 });

    expect(await findApproval(BASE + 103)).toMatchObject({ state: 'CANCELLED', rejectReason: null, refundStatus: 'NEEDED', decidedBy: null });
  });

  it('revertDecision puts a failed claim back to AWAITING', async () => {
    await awaiting(BASE + 104);
    await claimDecision(BASE + 104, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });

    await revertDecision(BASE + 104, 'REJECTED', USER);

    expect(await findApproval(BASE + 104)).toMatchObject({
      state: 'AWAITING',
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      refundStatus: 'NONE',
    });
  });

  it('revertDecision leaves a decision by someone else alone', async () => {
    await awaiting(BASE + 105);
    await claimDecision(BASE + 105, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 });

    await revertDecision(BASE + 105, 'APPROVED', 'someone-else');

    expect((await findApproval(BASE + 105))!.state).toBe('APPROVED');
  });
});

describe('refund and reminder bookkeeping', () => {
  it('markRefundDone succeeds once, and only on NEEDED', async () => {
    await awaiting(BASE + 110);
    expect(await markRefundDone(BASE + 110, USER, null, T0)).toBe(false);

    await claimDecision(BASE + 110, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });
    expect(await markRefundDone(BASE + 110, USER, 'Transfer BCA', T0)).toBe(true);
    expect(await markRefundDone(BASE + 110, USER, 'lagi', T0)).toBe(false);

    expect(await findApproval(BASE + 110)).toMatchObject({ refundStatus: 'DONE', refundedBy: USER, refundNote: 'Transfer BCA' });
  });

  it('touchReminder records the time; markEscalated keeps the first time', async () => {
    await awaiting(BASE + 111);
    const later = new Date(T0.getTime() + 24 * HOUR);

    await touchReminder(BASE + 111, later);
    await markEscalated(BASE + 111, later);
    await markEscalated(BASE + 111, new Date(later.getTime() + HOUR));

    const row = await findApproval(BASE + 111);
    expect(row!.lastReminderAt!.toISOString()).toBe(later.toISOString());
    expect(row!.escalatedAt!.toISOString()).toBe(later.toISOString());
  });
});

describe('findApprovals', () => {
  it('maps only the ids that have a row', async () => {
    await awaiting(BASE + 120);

    const map = await findApprovals([BASE + 120, BASE + 121]);

    expect([...map.keys()]).toEqual([BASE + 120]);
    expect(await findApprovals([])).toEqual(new Map());
  });
});

describe('listApprovals / countApprovals', () => {
  beforeEach(async () => {
    await awaiting(BASE + 130, DOCTOR_A, CLINIC_1, T0);
    await awaiting(BASE + 131, DOCTOR_B, CLINIC_2, new Date(T0.getTime() + HOUR));
    await awaiting(BASE + 132, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 132, { state: 'REJECTED', decidedBy: USER, decidedAt: T0, rejectReason: 'x' });
    await awaiting(BASE + 133, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 133, { state: 'CANCELLED', decidedBy: null, decidedAt: T0 });
    await markRefundDone(BASE + 133, USER, null, T0);
    await awaiting(BASE + 134, DOCTOR_A, CLINIC_1);
    await claimDecision(BASE + 134, { state: 'APPROVED', decidedBy: USER, decidedAt: T0 });
  });

  const ids = async (filter: Parameters<typeof listApprovals>[0], scope: Parameters<typeof listApprovals>[1]) =>
    ours((await listApprovals(filter, scope, 1, 100)).items.map((a) => a.appointmentId));

  it('AWAITING, oldest request first', async () => {
    expect(await ids('AWAITING', {})).toEqual([BASE + 130, BASE + 131]);
  });

  it('narrows by psychologist and by clinic', async () => {
    expect(await ids('AWAITING', { doctorWpUserId: DOCTOR_A })).toEqual([BASE + 130]);
    expect(await ids('AWAITING', { clinicId: CLINIC_2 })).toEqual([BASE + 131]);
  });

  it('REFUND_NEEDED, REFUNDED and DECIDED', async () => {
    expect(await ids('REFUND_NEEDED', { clinicId: CLINIC_1 })).toEqual([BASE + 132]);
    expect(await ids('REFUNDED', { clinicId: CLINIC_1 })).toEqual([BASE + 133]);
    expect((await ids('DECIDED', { clinicId: CLINIC_1 })).sort()).toEqual([BASE + 132, BASE + 133, BASE + 134]);
  });

  it('pages', async () => {
    const page2 = await listApprovals('AWAITING', { clinicId: CLINIC_2 }, 2, 1);
    expect(page2.total).toBe(1);
    expect(page2.items).toEqual([]);
  });

  it('counts within the scope', async () => {
    expect(await countApprovals({ clinicId: CLINIC_1 })).toEqual({ awaiting: 1, refundNeeded: 1 });
    expect(await countApprovals({ doctorWpUserId: DOCTOR_B })).toEqual({ awaiting: 1, refundNeeded: 0 });
  });
});

describe('lookups', () => {
  it('userNames joins first and last name and skips null or unknown ids', async () => {
    const names = await userNames([USER, null, 'nobody-here', USER]);
    expect([...names.entries()]).toEqual([[USER, 'Rina Admin']]);
  });

  it('paymentOrdersByIds returns the fields a refund needs', async () => {
    const order = await prisma.paymentOrder.create({
      data: {
        source: 'public',
        appointmentId: String(BASE + 140),
        wcOrderId: BASE + 500,
        expectedAmount: 350000,
        status: 'paid',
        gateway: 'xendit',
        chargedAmount: 350000,
        chargedCurrency: 'IDR',
        transactionId: 'tx-1',
      },
    });

    const map = await paymentOrdersByIds([order.id]);

    expect(map.get(order.id)).toEqual({
      id: order.id,
      gateway: 'xendit',
      wcOrderId: BASE + 500,
      transactionId: 'tx-1',
      expectedAmount: 350000,
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
    });
  });

  it('findWpUserContact reads wp_users', async () => {
    expect(await findWpUserContact(WP_ADMIN)).toEqual({ email: 'admin@approval-store.test.local', name: 'Rina Admin Klinik' });
    expect(await findWpUserContact(0)).toBeNull();
  });
});

describe('settings', () => {
  it('no row means off', async () => {
    expect(await requiresApproval(DOCTOR_A)).toBe(false);
    expect(await getApprovalSetting(DOCTOR_A)).toEqual({
      professionalId: DOCTOR_A,
      requiresApproval: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('setApprovalSetting upserts and reports the previous value', async () => {
    const on = await setApprovalSetting(DOCTOR_A, true, USER);
    expect(on.before).toBe(false);
    expect(on.after).toMatchObject({ professionalId: DOCTOR_A, requiresApproval: true, updatedBy: USER });
    expect(await requiresApproval(DOCTOR_A)).toBe(true);
    expect(await professionalsRequiringApproval([DOCTOR_A, DOCTOR_B])).toEqual(new Set([DOCTOR_A]));

    const off = await setApprovalSetting(DOCTOR_A, false, USER);
    expect(off.before).toBe(true);
    expect(await requiresApproval(DOCTOR_A)).toBe(false);
    expect(await professionalsRequiringApproval([])).toEqual(new Set());
  });
});
```

- [ ] **Step 6: Jalankan, pastikan gagal**

```bash
npx vitest run tests/integration/approval/approval-store.test.ts
```

Expected: FAIL, `Failed to resolve import "@/services/approval/store"`.

- [ ] **Step 7: Tulis `src/services/approval/store.ts`**

```ts
/**
 * `session_approvals` — the app-native record of a paid booking that waits for its
 * psychologist — plus the few app-table reads the approval flow needs.
 *
 * KiviCare has five statuses and none means "paid, waiting for the psychologist", so
 * such a booking stays PENDING in wp_kc_appointments and this row says why. Every path
 * that used to read PENDING as "unpaid" now asks here first.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §5
 */
import { Prisma, type SessionApproval } from '@prisma/client';
import { prisma } from '@/lib/db';

export const APPROVAL_STATE = {
  AWAITING: 'AWAITING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalState = (typeof APPROVAL_STATE)[keyof typeof APPROVAL_STATE];

export const REFUND_STATUS = { NONE: 'NONE', NEEDED: 'NEEDED', DONE: 'DONE' } as const;
export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export type ApprovalRecord = {
  appointmentId: number;
  doctorWpUserId: number;
  clinicId: number;
  paymentOrderId: string | null;
  state: ApprovalState;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  rejectReason: string | null;
  refundStatus: RefundStatus;
  refundedAt: Date | null;
  refundedBy: string | null;
  refundNote: string | null;
  lastReminderAt: Date | null;
  escalatedAt: Date | null;
};

function toRecord(r: SessionApproval): ApprovalRecord {
  return {
    ...r,
    appointmentId: Number(r.appointmentId),
    doctorWpUserId: Number(r.doctorWpUserId),
    clinicId: Number(r.clinicId),
    state: r.state as ApprovalState,
    refundStatus: r.refundStatus as RefundStatus,
  };
}

export async function findApproval(appointmentId: number): Promise<ApprovalRecord | null> {
  const row = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(appointmentId) } });
  return row ? toRecord(row) : null;
}

export async function findApprovals(appointmentIds: number[]): Promise<Map<number, ApprovalRecord>> {
  if (appointmentIds.length === 0) return new Map();
  const rows = await prisma.sessionApproval.findMany({
    where: { appointmentId: { in: appointmentIds.map((id) => BigInt(id)) } },
  });
  return new Map(rows.map((r) => [Number(r.appointmentId), toRecord(r)]));
}

export type NewApproval = {
  appointmentId: number;
  doctorWpUserId: number;
  clinicId: number;
  paymentOrderId: string | null;
  now: Date;
};

/** Create the AWAITING row. False when it already exists: a repeated webhook or poll. */
export async function insertAwaiting(input: NewApproval): Promise<boolean> {
  try {
    await prisma.sessionApproval.create({
      data: {
        appointmentId: BigInt(input.appointmentId),
        doctorWpUserId: BigInt(input.doctorWpUserId),
        clinicId: BigInt(input.clinicId),
        paymentOrderId: input.paymentOrderId,
        state: APPROVAL_STATE.AWAITING,
        requestedAt: input.now,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

export type Decision =
  | { state: typeof APPROVAL_STATE.APPROVED; decidedBy: string | null; decidedAt: Date }
  | { state: typeof APPROVAL_STATE.REJECTED; decidedBy: string | null; decidedAt: Date; rejectReason: string }
  | { state: typeof APPROVAL_STATE.CANCELLED; decidedBy: string | null; decidedAt: Date };

/**
 * AWAITING → the decision, as one conditional UPDATE. False means the row was no longer
 * AWAITING: someone else decided first, and this caller must not touch the appointment.
 * A rejection or a cancellation leaves money to return, so it marks the refund NEEDED.
 */
export async function claimDecision(appointmentId: number, d: Decision): Promise<boolean> {
  const { count } = await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), state: APPROVAL_STATE.AWAITING },
    data: {
      state: d.state,
      decidedAt: d.decidedAt,
      decidedBy: d.decidedBy,
      rejectReason: d.state === APPROVAL_STATE.REJECTED ? d.rejectReason : null,
      refundStatus: d.state === APPROVAL_STATE.APPROVED ? REFUND_STATUS.NONE : REFUND_STATUS.NEEDED,
    },
  });
  return count === 1;
}

/** Undo a claim whose appointment write failed, so the same decision can be tried again. */
export async function revertDecision(
  appointmentId: number,
  state: ApprovalState,
  decidedBy: string | null,
): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), state, decidedBy },
    data: {
      state: APPROVAL_STATE.AWAITING,
      decidedAt: null,
      decidedBy: null,
      rejectReason: null,
      refundStatus: REFUND_STATUS.NONE,
    },
  });
}

/** NEEDED → DONE. False when the refund was not needed, or already marked. */
export async function markRefundDone(
  appointmentId: number,
  by: string,
  note: string | null,
  now: Date,
): Promise<boolean> {
  const { count } = await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), refundStatus: REFUND_STATUS.NEEDED },
    data: { refundStatus: REFUND_STATUS.DONE, refundedAt: now, refundedBy: by, refundNote: note },
  });
  return count === 1;
}

export async function touchReminder(appointmentId: number, at: Date): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId) },
    data: { lastReminderAt: at },
  });
}

/** Escalation goes out once; a second call leaves the first timestamp alone. */
export async function markEscalated(appointmentId: number, at: Date): Promise<void> {
  await prisma.sessionApproval.updateMany({
    where: { appointmentId: BigInt(appointmentId), escalatedAt: null },
    data: { escalatedAt: at },
  });
}

export type QueueFilter = 'AWAITING' | 'REFUND_NEEDED' | 'REFUNDED' | 'DECIDED';
export const QUEUE_FILTERS: readonly QueueFilter[] = ['AWAITING', 'REFUND_NEEDED', 'REFUNDED', 'DECIDED'];

/** Narrowing only: an undefined field puts no condition on that column. */
export type QueueScope = { doctorWpUserId?: number; clinicId?: number };

function scopeWhere(scope: QueueScope): Prisma.SessionApprovalWhereInput {
  return {
    ...(scope.doctorWpUserId !== undefined ? { doctorWpUserId: BigInt(scope.doctorWpUserId) } : {}),
    ...(scope.clinicId !== undefined ? { clinicId: BigInt(scope.clinicId) } : {}),
  };
}

const FILTER_WHERE: Record<QueueFilter, Prisma.SessionApprovalWhereInput> = {
  AWAITING: { state: APPROVAL_STATE.AWAITING },
  REFUND_NEEDED: { refundStatus: REFUND_STATUS.NEEDED },
  REFUNDED: { refundStatus: REFUND_STATUS.DONE },
  DECIDED: { state: { in: [APPROVAL_STATE.APPROVED, APPROVAL_STATE.REJECTED, APPROVAL_STATE.CANCELLED] } },
};

const FILTER_ORDER: Record<QueueFilter, Prisma.SessionApprovalOrderByWithRelationInput[]> = {
  AWAITING: [{ requestedAt: 'asc' }, { appointmentId: 'asc' }],
  REFUND_NEEDED: [{ decidedAt: 'asc' }, { appointmentId: 'asc' }],
  REFUNDED: [{ refundedAt: 'desc' }, { appointmentId: 'desc' }],
  DECIDED: [{ decidedAt: 'desc' }, { appointmentId: 'desc' }],
};

export async function listApprovals(
  filter: QueueFilter,
  scope: QueueScope,
  page: number,
  limit: number,
): Promise<{ items: ApprovalRecord[]; total: number }> {
  const where: Prisma.SessionApprovalWhereInput = { ...FILTER_WHERE[filter], ...scopeWhere(scope) };
  const total = await prisma.sessionApproval.count({ where });
  const rows = await prisma.sessionApproval.findMany({
    where,
    orderBy: FILTER_ORDER[filter],
    skip: (page - 1) * limit,
    take: limit,
  });
  return { items: rows.map(toRecord), total };
}

/** The two numbers the FE badges show. Sequential: the pool is small (max_user_connections=5). */
export async function countApprovals(scope: QueueScope): Promise<{ awaiting: number; refundNeeded: number }> {
  const base = scopeWhere(scope);
  const awaiting = await prisma.sessionApproval.count({ where: { ...base, ...FILTER_WHERE.AWAITING } });
  const refundNeeded = await prisma.sessionApproval.count({ where: { ...base, ...FILTER_WHERE.REFUND_NEEDED } });
  return { awaiting, refundNeeded };
}

/** users.id → display name, for "decided by" and "refunded by". Unknown ids are left out. */
export async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });
  return new Map(
    rows.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.displayName]),
  );
}

export type PaymentSummary = {
  id: string;
  gateway: string;
  wcOrderId: number;
  transactionId: string | null;
  expectedAmount: number;
  chargedAmount: number | null;
  chargedCurrency: string;
};

export async function paymentOrdersByIds(ids: string[]): Promise<Map<string, PaymentSummary>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.paymentOrder.findMany({
    where: { id: { in: wanted } },
    select: {
      id: true,
      gateway: true,
      wcOrderId: true,
      transactionId: true,
      expectedAmount: true,
      chargedAmount: true,
      chargedCurrency: true,
    },
  });
  return new Map(
    rows.map((o) => [
      o.id,
      {
        id: o.id,
        gateway: o.gateway,
        wcOrderId: o.wcOrderId,
        transactionId: o.transactionId,
        expectedAmount: o.expectedAmount,
        chargedAmount: o.chargedAmount === null ? null : Number(o.chargedAmount),
        chargedCurrency: o.chargedCurrency,
      },
    ]),
  );
}

/** wp_users email and display name, for the escalation mail to a clinic admin. */
export async function findWpUserContact(wpUserId: number): Promise<{ email: string; name: string } | null> {
  if (!Number.isSafeInteger(wpUserId) || wpUserId <= 0) return null;
  const u = await prisma.kcUser.findUnique({
    where: { id: BigInt(wpUserId) },
    select: { userEmail: true, displayName: true },
  });
  return u && u.userEmail ? { email: u.userEmail, name: u.displayName } : null;
}
```

- [ ] **Step 8: Tulis `src/services/approval/settings.ts`**

```ts
/**
 * `professional_approval_settings` — a psychologist's own switch: "paid online bookings
 * wait for my approval". No row means off, so every psychologist behaves exactly as
 * before until someone turns it on. Read when a payment lands, never cached.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §4.1
 */
import { prisma } from '@/lib/db';

export type ApprovalSetting = {
  professionalId: number;
  requiresApproval: boolean;
  updatedAt: Date | null;
  /** users.id (cuid) */
  updatedBy: string | null;
};

export async function requiresApproval(professionalId: number): Promise<boolean> {
  const row = await prisma.professionalApprovalSetting.findUnique({
    where: { doctorWpUserId: BigInt(professionalId) },
    select: { requiresApproval: true },
  });
  return row?.requiresApproval === true;
}

/** Of these psychologists, the ones whose switch is on. One query for a whole directory. */
export async function professionalsRequiringApproval(professionalIds: number[]): Promise<Set<number>> {
  if (professionalIds.length === 0) return new Set();
  const rows = await prisma.professionalApprovalSetting.findMany({
    where: { doctorWpUserId: { in: professionalIds.map((id) => BigInt(id)) }, requiresApproval: true },
    select: { doctorWpUserId: true },
  });
  return new Set(rows.map((r) => Number(r.doctorWpUserId)));
}

export async function getApprovalSetting(professionalId: number): Promise<ApprovalSetting> {
  const row = await prisma.professionalApprovalSetting.findUnique({
    where: { doctorWpUserId: BigInt(professionalId) },
  });
  return {
    professionalId,
    requiresApproval: row?.requiresApproval === true,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function setApprovalSetting(
  professionalId: number,
  value: boolean,
  by: string,
): Promise<{ before: boolean; after: ApprovalSetting }> {
  const before = await requiresApproval(professionalId);
  const id = BigInt(professionalId);
  const row = await prisma.professionalApprovalSetting.upsert({
    where: { doctorWpUserId: id },
    create: { doctorWpUserId: id, requiresApproval: value, updatedBy: by },
    update: { requiresApproval: value, updatedBy: by },
  });
  return {
    before,
    after: {
      professionalId,
      requiresApproval: row.requiresApproval,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    },
  };
}
```

- [ ] **Step 9: Jalankan tes dan typecheck**

```bash
npx vitest run tests/integration/approval/approval-store.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua tes PASS; typecheck mencetak `0`.

- [ ] **Step 10: Commit**

```bash
git add prisma/manual/2026-10-19-approval-psikolog.sql prisma/schema.prisma src/services/approval/store.ts src/services/approval/settings.ts tests/integration/approval/approval-store.test.ts
git commit -m "$(cat <<'EOF'
feat(approval): tabel approval sesi dan saklar psikolog

session_approvals mencatat booking lunas yang menunggu psikolog;
professional_approval_settings menyimpan saklar per psikolog. Keputusan
diklaim dengan UPDATE bersyarat supaya hanya satu yang menang.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Aturan waktu pengingat dan isi email (modul murni)

**Files:**
- Create: `src/services/approval/schedule.ts`
- Create: `src/services/approval/emails.ts`
- Modify: `src/services/session/reminder-email.ts` (ekspor dua helper)
- Modify: `src/services/session/reminder-schedule.ts` (tipe parameter `sessionStartsAtUtc`)
- Test: `tests/unit/approval/schedule.test.ts`, `tests/unit/approval/emails.test.ts`

**Interfaces:**
- Produces:
  - `firstReminderAt(now: Date, startsAt: Date | null): Date`
  - `planReminder(i: ReminderInput): ReminderPlan`, dengan `ReminderInput = { now; startsAt; requestedAt; lastReminderAt: Date | null; escalatedAt: Date | null }` dan `ReminderPlan = { remindProfessional: boolean; escalate: boolean; nextRunAt: Date | null }`
  - `isOverdue(startsAt: Date | null, now: Date): boolean`
  - `SessionMailFacts = { clientName; professionalName; serviceName; startsAtUtc: Date; timezone }`
  - `buildClientAwaitingEmail(f)`, `buildProfessionalRequestEmail(f & { link; waitingSince: Date | null })`, `buildAdminEscalationEmail(f & { adminName; link; requestedAt })`, `buildClientRejectedEmail(f & { clinicName; clinicEmail: string | null; clinicPhone: string | null })`, semuanya mengembalikan `BuiltEmail`.
  - `reminder-email.ts` mengekspor `escapeHtml(s)` dan `formatWaktu(startsAtUtc, timezone)`.
  - `sessionStartsAtUtc(row: Pick<SessionRow, 'slotDate' | 'startTime' | 'timezone'>)`.

- [ ] **Step 1: Ekspor helper yang dipakai ulang**

Di `src/services/session/reminder-email.ts`:
- `function formatWaktu(startsAtUtc: Date, timezone: string)` → `export function formatWaktu(startsAtUtc: Date, timezone: string)`
- `function escapeHtml(s: string): string` → `export function escapeHtml(s: string): string`

Di `src/services/session/reminder-schedule.ts`, ganti signature:

```ts
export function sessionStartsAtUtc(row: SessionRow): Date | null {
```

menjadi:

```ts
export function sessionStartsAtUtc(
  row: Pick<SessionRow, 'slotDate' | 'startTime' | 'timezone'>,
): Date | null {
```

(Isi fungsinya tidak berubah: ia memang hanya membaca tiga field itu.)

- [ ] **Step 2: Tulis tes schedule (gagal)**

`tests/unit/approval/schedule.test.ts`:

```ts
/**
 * When the approval reminder job runs and what it does (spec §4.4). Pure functions:
 * every scenario is a fixed clock, so the arithmetic is pinned exactly.
 */
import { describe, expect, it } from 'vitest';
import { firstReminderAt, isOverdue, planReminder } from '@/services/approval/schedule';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-20T03:00:00.000Z');
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

describe('firstReminderAt', () => {
  it('a session three days out: the first run is a day later', () => {
    expect(firstReminderAt(T0, at(72))).toEqual(at(24));
  });

  it('a session 30 hours out: the first run is when it gets within a day', () => {
    expect(firstReminderAt(T0, at(30))).toEqual(at(6));
  });

  it('a session within a day: runs in a minute, so the admin hears at once', () => {
    expect(firstReminderAt(T0, at(10))).toEqual(new Date(T0.getTime() + 60_000));
  });

  it('a session with no start time: a day later', () => {
    expect(firstReminderAt(T0, null)).toEqual(at(24));
  });
});

describe('planReminder', () => {
  it('72 h out, first run: reminds, escalates, runs again a day later', () => {
    expect(
      planReminder({ now: at(24), startsAt: at(72), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: true, escalate: true, nextRunAt: at(48) });
  });

  it('72 h out, second run: reminds again, does not escalate twice, then stops', () => {
    expect(
      planReminder({ now: at(48), startsAt: at(72), requestedAt: T0, lastReminderAt: at(24), escalatedAt: at(24) }),
    ).toEqual({ remindProfessional: true, escalate: false, nextRunAt: null });
  });

  it('30 h out, run at the 24 h mark: escalates (start within a day), no second reminder yet', () => {
    expect(
      planReminder({ now: at(6), startsAt: at(30), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: true, nextRunAt: null });
  });

  it('10 h out, run a minute after the request: escalates only', () => {
    const now = new Date(T0.getTime() + 60_000);
    expect(
      planReminder({ now, startsAt: at(10), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: true, nextRunAt: null });
  });

  it('started already: nothing', () => {
    expect(
      planReminder({ now: at(5), startsAt: at(5), requestedAt: T0, lastReminderAt: null, escalatedAt: null }),
    ).toEqual({ remindProfessional: false, escalate: false, nextRunAt: null });
  });

  it('a reminder 19 h ago is too recent to repeat', () => {
    const plan = planReminder({ now: at(43), startsAt: at(200), requestedAt: T0, lastReminderAt: at(24), escalatedAt: at(24) });
    expect(plan.remindProfessional).toBe(false);
    expect(plan.nextRunAt).toEqual(at(67));
  });
});

describe('isOverdue', () => {
  it('only when the start has passed', () => {
    expect(isOverdue(at(1), T0)).toBe(false);
    expect(isOverdue(T0, T0)).toBe(true);
    expect(isOverdue(null, T0)).toBe(false);
  });
});
```

- [ ] **Step 3: Tulis tes email (gagal)**

`tests/unit/approval/emails.test.ts`:

```ts
/**
 * The four approval emails (spec §7.6). Pure builders, so the copy is pinned without a
 * single mock. Names come from free-text profile fields and must be escaped in HTML.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAdminEscalationEmail,
  buildClientAwaitingEmail,
  buildClientRejectedEmail,
  buildProfessionalRequestEmail,
  type SessionMailFacts,
} from '@/services/approval/emails';

// Kamis, 22 Oktober 2026 10:00 WIB.
const FACTS: SessionMailFacts = {
  clientName: 'Ada <b>Lovelace</b>',
  professionalName: 'Dianda Psikolog',
  serviceName: 'Konseling Individu',
  startsAtUtc: new Date('2026-10-22T03:00:00.000Z'),
  timezone: 'Asia/Jakarta',
};
const LINK = 'https://appointment.praktiqu.test/dashboard/persetujuan/7';

describe('buildClientAwaitingEmail', () => {
  it('says the payment arrived and the psychologist still has to confirm', () => {
    const m = buildClientAwaitingEmail(FACTS);
    expect(m.subject).toBe('Pembayaran diterima — menunggu konfirmasi psikolog');
    expect(m.text).toContain('Layanan: Konseling Individu');
    expect(m.text).toContain('Tanggal: Kamis, 22 Oktober 2026');
    expect(m.text).toContain('Waktu: 10:00');
    expect(m.text).toContain('Psikolog Dianda Psikolog akan mengonfirmasi jadwal ini');
    expect(m.text).toContain('klinik akan mengembalikan dana Anda');
  });

  it('escapes names in the HTML part only', () => {
    const m = buildClientAwaitingEmail(FACTS);
    expect(m.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Lovelace</b>');
    expect(m.text).toContain('Ada <b>Lovelace</b>');
  });
});

describe('buildProfessionalRequestEmail', () => {
  it('first mail: new booking, with the link', () => {
    const m = buildProfessionalRequestEmail({ ...FACTS, link: LINK, waitingSince: null });
    expect(m.subject).toBe('Booking baru menunggu persetujuan Anda: Kamis, 22 Oktober 2026 pukul 10:00');
    expect(m.html).toContain(`<a href="${LINK}">Buka permintaan</a>`);
    expect(m.text).toContain(`Buka permintaan: ${LINK}`);
    expect(m.text).toContain('sudah membayar sesi berikut');
  });

  it('reminder: names the client and how long it has waited', () => {
    const m = buildProfessionalRequestEmail({
      ...FACTS,
      link: LINK,
      waitingSince: new Date('2026-10-20T02:00:00.000Z'),
    });
    expect(m.subject).toBe('Pengingat: booking Ada <b>Lovelace</b> masih menunggu persetujuan Anda');
    expect(m.text).toContain('sejak Selasa, 20 Oktober 2026 pukul 09:00');
  });
});

describe('buildAdminEscalationEmail', () => {
  it('names the psychologist, the wait and the link', () => {
    const m = buildAdminEscalationEmail({
      ...FACTS,
      adminName: 'Rina',
      link: 'https://appointment.praktiqu.test/dashboard/persetujuan/7',
      requestedAt: new Date('2026-10-20T02:00:00.000Z'),
    });
    expect(m.subject).toBe('Booking menunggu persetujuan psikolog: Dianda Psikolog, Kamis, 22 Oktober 2026');
    expect(m.text).toContain('Halo Rina,');
    expect(m.text).toContain('sejak Selasa, 20 Oktober 2026 pukul 09:00');
    expect(m.text).toContain('atas nama psikolog');
  });
});

describe('buildClientRejectedEmail', () => {
  it('apologises, promises the refund and gives the clinic contact', () => {
    const m = buildClientRejectedEmail({
      ...FACTS,
      clinicName: 'Klinik Sehat',
      clinicEmail: 'halo@klinik.test',
      clinicPhone: '0221234567',
    });
    expect(m.subject).toBe('Jadwal sesi Anda tidak dapat diterima');
    expect(m.text).toContain('psikolog Dianda Psikolog tidak dapat menerima jadwal berikut');
    expect(m.text).toContain('Pembayaran Anda akan dikembalikan oleh Klinik Sehat');
    expect(m.text).toContain('halo@klinik.test · 0221234567');
  });

  it('leaves the contact line out when the clinic has none', () => {
    const m = buildClientRejectedEmail({ ...FACTS, clinicName: 'Klinik Sehat', clinicEmail: null, clinicPhone: null });
    expect(m.text).toContain('hubungi Klinik Sehat.');
    expect(m.text).not.toContain(' · ');
  });
});
```

- [ ] **Step 4: Jalankan, pastikan gagal**

```bash
npx vitest run tests/unit/approval/schedule.test.ts tests/unit/approval/emails.test.ts
```

Expected: FAIL, `Failed to resolve import "@/services/approval/schedule"` dan `"@/services/approval/emails"`.

- [ ] **Step 5: Tulis `src/services/approval/schedule.ts`**

```ts
/**
 * When the approval reminder job runs, and what each run does (spec §4.4).
 *
 * Pure: the clock is an argument. The job runs at most once a day per booking; the
 * psychologist is mailed at most once per ~day, the clinic admin exactly once, and
 * nothing runs past the session's start.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A reminder this soon after the last mail would be noise. */
export const REMIND_AFTER_MS = 20 * HOUR;

export function isOverdue(startsAt: Date | null, now: Date): boolean {
  return startsAt !== null && startsAt.getTime() <= now.getTime();
}

/**
 * The first run, scheduled when the booking is held. A session within a day runs in a
 * minute, so the clinic admin hears about it straight away; otherwise a day later, or
 * as the session comes within a day, whichever is first.
 */
export function firstReminderAt(now: Date, startsAt: Date | null): Date {
  const n = now.getTime();
  if (startsAt && startsAt.getTime() - n <= DAY) return new Date(n + MINUTE);
  const candidates = [n + DAY];
  if (startsAt) candidates.push(startsAt.getTime() - DAY);
  return new Date(Math.max(Math.min(...candidates), n + MINUTE));
}

export type ReminderInput = {
  now: Date;
  startsAt: Date;
  requestedAt: Date;
  lastReminderAt: Date | null;
  escalatedAt: Date | null;
};

export type ReminderPlan = {
  remindProfessional: boolean;
  escalate: boolean;
  /** Null: do not schedule again (the next run would be at or after the start). */
  nextRunAt: Date | null;
};

export function planReminder(i: ReminderInput): ReminderPlan {
  const n = i.now.getTime();
  const s = i.startsAt.getTime();
  if (s <= n) return { remindProfessional: false, escalate: false, nextRunAt: null };

  const lastMail = (i.lastReminderAt ?? i.requestedAt).getTime();
  const remindProfessional = n - lastMail >= REMIND_AFTER_MS;
  const escalate = i.escalatedAt === null && (n - i.requestedAt.getTime() >= DAY || s - n <= DAY);

  const candidates = [n + DAY];
  if (s - DAY > n + HOUR) candidates.push(s - DAY);
  const next = Math.min(...candidates);

  return { remindProfessional, escalate, nextRunAt: next < s ? new Date(next) : null };
}
```

- [ ] **Step 6: Tulis `src/services/approval/emails.ts`**

```ts
/**
 * Email bodies for the psychologist-approval flow. Pure: everything arrives as
 * arguments — no database, network or clock — so every copy is testable without a mock.
 * Indonesian, like the session reminders.
 *
 * Source of truth: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §7.6
 */
import { escapeHtml, formatWaktu, type BuiltEmail } from '@/services/session/reminder-email';

export interface SessionMailFacts {
  clientName: string;
  professionalName: string;
  serviceName: string;
  /** Session start in UTC. */
  startsAtUtc: Date;
  /** Clinic zone, e.g. 'Asia/Jakarta'. */
  timezone: string;
}

function rincian(f: SessionMailFacts): { html: string; text: string } {
  const { tanggal, jam } = formatWaktu(f.startsAtUtc, f.timezone);
  const rows: Array<[string, string]> = [
    ['Layanan', f.serviceName],
    ['Tanggal', tanggal],
    ['Waktu', jam],
    ['Psikolog', f.professionalName],
    ['Klien', f.clientName],
  ];
  return {
    html: `<ul>\n${rows.map(([k, v]) => `  <li>${k}: ${escapeHtml(v)}</li>`).join('\n')}\n</ul>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

function tautan(link: string, label: string): { html: string; text: string } {
  return { html: `<p><a href="${escapeHtml(link)}">${label}</a></p>`, text: `${label}: ${link}` };
}

export function buildClientAwaitingEmail(f: SessionMailFacts): BuiltEmail {
  const r = rincian(f);
  const subject = 'Pembayaran diterima — menunggu konfirmasi psikolog';
  const html = `<p>Halo ${escapeHtml(f.clientName)},</p>
<p>Pembayaran Anda untuk sesi berikut sudah kami terima.</p>
${r.html}
<p>Psikolog ${escapeHtml(f.professionalName)} akan mengonfirmasi jadwal ini. Kami akan mengirim email lagi begitu jadwalnya dikonfirmasi.</p>
<p>Kalau psikolog tidak dapat menerima jadwal ini, klinik akan mengembalikan dana Anda.</p>`;
  const text = `Halo ${f.clientName},

Pembayaran Anda untuk sesi berikut sudah kami terima.

${r.text}

Psikolog ${f.professionalName} akan mengonfirmasi jadwal ini. Kami akan mengirim email lagi begitu jadwalnya dikonfirmasi.

Kalau psikolog tidak dapat menerima jadwal ini, klinik akan mengembalikan dana Anda.`;
  return { subject, html, text };
}

export interface ProfessionalRequestInput extends SessionMailFacts {
  link: string;
  /** Null for the first mail; when the booking was paid, for a reminder. */
  waitingSince: Date | null;
}

export function buildProfessionalRequestEmail(f: ProfessionalRequestInput): BuiltEmail {
  const r = rincian(f);
  const t = tautan(f.link, 'Buka permintaan');
  const { tanggal, jam } = formatWaktu(f.startsAtUtc, f.timezone);

  let subject: string;
  let pembukaHtml: string;
  let pembukaText: string;
  if (f.waitingSince === null) {
    subject = `Booking baru menunggu persetujuan Anda: ${tanggal} pukul ${jam}`;
    pembukaHtml = `${escapeHtml(f.clientName)} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
    pembukaText = `${f.clientName} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
  } else {
    const sejak = formatWaktu(f.waitingSince, f.timezone);
    subject = `Pengingat: booking ${f.clientName} masih menunggu persetujuan Anda`;
    pembukaHtml = `Booking dari ${escapeHtml(f.clientName)} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
    pembukaText = `Booking dari ${f.clientName} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  }

  const penutup = 'Jadwal ini tetap terkunci sampai Anda menyetujui atau menolaknya. Klien baru menerima konfirmasi setelah Anda menyetujui.';
  const html = `<p>Halo ${escapeHtml(f.professionalName)},</p>
<p>${pembukaHtml}</p>
${r.html}
${t.html}
<p>${penutup}</p>`;
  const text = `Halo ${f.professionalName},

${pembukaText}

${r.text}

${t.text}

${penutup}`;
  return { subject, html, text };
}

export interface AdminEscalationInput extends SessionMailFacts {
  adminName: string;
  link: string;
  requestedAt: Date;
}

export function buildAdminEscalationEmail(f: AdminEscalationInput): BuiltEmail {
  const r = rincian(f);
  const t = tautan(f.link, 'Buka antrean persetujuan');
  const { tanggal } = formatWaktu(f.startsAtUtc, f.timezone);
  const sejak = formatWaktu(f.requestedAt, f.timezone);

  const subject = `Booking menunggu persetujuan psikolog: ${f.professionalName}, ${tanggal}`;
  const isiText = `Booking berikut sudah dibayar klien, tetapi belum disetujui psikolog ${f.professionalName} sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  const isiHtml = `Booking berikut sudah dibayar klien, tetapi belum disetujui psikolog ${escapeHtml(f.professionalName)} sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  const penutup = 'Anda bisa menyetujui atau menolaknya atas nama psikolog.';
  const html = `<p>Halo ${escapeHtml(f.adminName)},</p>
<p>${isiHtml}</p>
${r.html}
${t.html}
<p>${penutup}</p>`;
  const text = `Halo ${f.adminName},

${isiText}

${r.text}

${t.text}

${penutup}`;
  return { subject, html, text };
}

export interface ClientRejectedInput extends SessionMailFacts {
  clinicName: string;
  clinicEmail: string | null;
  clinicPhone: string | null;
}

/** The psychologist's reason is internal (spec §2) and deliberately not an input here. */
export function buildClientRejectedEmail(f: ClientRejectedInput): BuiltEmail {
  const r = rincian(f);
  const kontak = [f.clinicEmail, f.clinicPhone].filter((v): v is string => !!v && v.trim() !== '').join(' · ');
  const hubungiText = kontak
    ? `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${f.clinicName}: ${kontak}.`
    : `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${f.clinicName}.`;
  const hubungiHtml = kontak
    ? `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${escapeHtml(f.clinicName)}: ${escapeHtml(kontak)}.`
    : `Untuk pertanyaan tentang pengembalian dana atau untuk memilih jadwal lain, hubungi ${escapeHtml(f.clinicName)}.`;

  const subject = 'Jadwal sesi Anda tidak dapat diterima';
  const html = `<p>Halo ${escapeHtml(f.clientName)},</p>
<p>Mohon maaf, psikolog ${escapeHtml(f.professionalName)} tidak dapat menerima jadwal berikut.</p>
${r.html}
<p>Pembayaran Anda akan dikembalikan oleh ${escapeHtml(f.clinicName)}.</p>
<p>${hubungiHtml}</p>`;
  const text = `Halo ${f.clientName},

Mohon maaf, psikolog ${f.professionalName} tidak dapat menerima jadwal berikut.

${r.text}

Pembayaran Anda akan dikembalikan oleh ${f.clinicName}.

${hubungiText}`;
  return { subject, html, text };
}
```

- [ ] **Step 7: Jalankan tes baru, tes pengingat lama, dan typecheck**

```bash
npx vitest run tests/unit/approval/schedule.test.ts tests/unit/approval/emails.test.ts tests/unit/session/reminder-schedule.test.ts tests/unit/session/reminder-handler.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`.

Kalau tes tanggal email gagal karena nama hari (misalnya `Rabu` alih-alih `Kamis`), periksa `startsAtUtc`. `2026-10-22T03:00Z` = Kamis 10:00 WIB, dan `2026-10-20T02:00Z` = Selasa 09:00 WIB. Jangan ubah ekspektasinya.

- [ ] **Step 8: Commit**

```bash
git add src/services/approval/schedule.ts src/services/approval/emails.ts src/services/session/reminder-email.ts src/services/session/reminder-schedule.ts tests/unit/approval/schedule.test.ts tests/unit/approval/emails.test.ts
git commit -m "$(cat <<'EOF'
feat(approval): aturan jadwal pengingat dan isi email approval

Fungsi murni: kapan job pengingat jalan, kapan eskalasi ke admin, dan
empat email (klien menunggu, psikolog, admin, klien ditolak).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task B3: `service.ts` — hold, setujui, tolak, tutup-saat-batal, refund, view

**Files:**
- Create: `src/services/approval/service.ts`
- Test: `tests/unit/approval/service.test.ts`

**Interfaces:**
- Consumes: semua ekspor `store.ts`, `settings.ts` (B1), `schedule.ts`, `emails.ts` (B2); `setAppointmentStatus`, `ConfirmedPayment` (`appointments.write.ts`); `findSessionById`, `setSessionStatusDirect`, `SESSION_STATUS`, `SessionRow` (`sessions.repo.ts`); `sessionStartsAtUtc`, `syncSessionReminders` (`reminder-schedule.ts`); `resolveKcActor` (`kc-actor.ts`); `findClinicById`; `findServiceById`; `sendEmail`; `jobs`; `getPublicAppUrl`.
- Produces (dipakai B4–B7):
  - Konstanta `APPROVAL_REMINDER_HOOK = 'praktiqu_approval_reminder'`, `APPROVAL_REMINDER_EVENT = 'approval.reminder'`; `approvalReminderArgs(appointmentId): { appointmentId }`
  - `class ApprovalError extends Error { code: string; status: number }`
  - `approvalLink(appointmentId?: number): string`
  - Tipe `ApprovalView`, `ApprovalPayment`, `PublicApprovalView`
  - `approvalViews(rows: Timed[], now?): Promise<Map<number, ApprovalView>>`
  - `withApprovals<T extends Timed>(rows: T[], now?): Promise<Array<T & { approval: ApprovalView | null }>>`
  - `publicApprovalView(row: Timed, now?): Promise<PublicApprovalView | null>`
  - `serviceNameOf(row)`, `mailFacts(row)`, `mail(to, built, template)`, `clinicAdminContact(clinicId)`
  - `holdForApproval({ row, paymentOrderId, actorId?, now? }): Promise<boolean>`
  - `completeApproval(approval: ApprovalRecord): Promise<void>`
  - `approveAwaiting({ actor, row, approval, now? }): Promise<void>`
  - `rejectAwaiting({ actor, row, reason, now? }): Promise<void>`
  - `closeOnCancel(appointmentId: number, actorId: string | null, now?): Promise<boolean>`
  - `settleExternal(appointmentId: number, status: SessionStatus, now?): Promise<void>`
  - `markRefunded({ actor, appointmentId, note, now? }): Promise<ApprovalView>`
  - `Timed = Pick<SessionRow, 'id' | 'slotDate' | 'startTime' | 'timezone'>`

- [ ] **Step 1: Tulis tes (gagal)**

`tests/unit/approval/service.test.ts`:

```ts
/**
 * services/approval/service.ts — the decisions, with every boundary mocked.
 *
 * The store is mocked function by function, so these tests pin what the service asks the
 * store to do (claim, revert, mark) and in which order relative to the appointment write.
 * The store's own SQL is pinned by tests/integration/approval/approval-store.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const store = vi.hoisted(() => ({
  findApproval: vi.fn(),
  findApprovals: vi.fn(),
  insertAwaiting: vi.fn(),
  claimDecision: vi.fn(),
  revertDecision: vi.fn(),
  markRefundDone: vi.fn(),
  userNames: vi.fn(),
  paymentOrdersByIds: vi.fn(),
  findWpUserContact: vi.fn(),
}));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  ...store,
}));

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  cancelAppointment: vi.fn(),
  createAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const sessions = vi.hoisted(() => ({ findSessionById: vi.fn(), setSessionStatusDirect: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => sessions.findSessionById(...a),
  setSessionStatusDirect: (...a: unknown[]) => sessions.setSessionStatusDirect(...a),
}));

vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: async () => ({ name: 'Konseling Individu' }),
}));

const clinics = vi.hoisted(() => ({ findClinicById: vi.fn() }));
vi.mock('@/repositories/wp/clinics.repo', () => clinics);

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn() }));
vi.mock('@/services/session/reminder-schedule', async (orig) => ({
  ...(await orig<typeof import('@/services/session/reminder-schedule')>()),
  syncSessionReminders: (...a: unknown[]) => schedule.syncSessionReminders(...a),
}));

const kc = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kc);

import {
  approvalViews,
  approveAwaiting,
  closeOnCancel,
  holdForApproval,
  markRefunded,
  publicApprovalView,
  rejectAwaiting,
  settleExternal,
  withApprovals,
} from '@/services/approval/service';

const NOW = new Date('2026-10-20T03:00:00.000Z'); // Selasa 10:00 WIB
const PSIKOLOG = { id: 'u_psi', role: 'PROFESSIONAL', practiceId: null } as const;
const ADMIN = { id: 'u_admin', role: 'CLINIC_ADMIN', practiceId: null } as const;
const ORDER = {
  id: 'po_1',
  gateway: 'xendit',
  wcOrderId: 49863,
  transactionId: 'tx_9',
  expectedAmount: 350000,
  chargedAmount: 350000,
  chargedCurrency: 'IDR',
};

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 4,
    professionalId: 34,
    clientId: 522,
    professionalName: 'Dianda Psikolog',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'dianda@klinik.test',
    slotDate: '2026-10-22', // Kamis 10:00 WIB = 2026-10-22T03:00Z
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-10-19T00:00:00Z'),
    ...over,
  };
}

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    appointmentId: 7,
    doctorWpUserId: 34,
    clinicId: 4,
    paymentOrderId: 'po_1',
    state: 'AWAITING',
    requestedAt: new Date('2026-10-20T02:00:00.000Z'),
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    refundStatus: 'NONE',
    refundedAt: null,
    refundedBy: null,
    refundNote: null,
    lastReminderAt: null,
    escalatedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_PUBLIC_URL = 'https://appointment.praktiqu.test';
  store.findApproval.mockResolvedValue(record());
  store.findApprovals.mockResolvedValue(new Map());
  store.insertAwaiting.mockResolvedValue(true);
  store.claimDecision.mockResolvedValue(true);
  store.revertDecision.mockResolvedValue(undefined);
  store.markRefundDone.mockResolvedValue(true);
  store.userNames.mockResolvedValue(new Map([['u_admin', 'Rina Admin']]));
  store.paymentOrdersByIds.mockResolvedValue(new Map([['po_1', ORDER]]));
  store.findWpUserContact.mockResolvedValue({ email: 'admin@klinik.test', name: 'Rina Admin' });
  writes.setAppointmentStatus.mockResolvedValue({ id: 7, status: 1, cancelled: false });
  sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.BOOKED }));
  sessions.setSessionStatusDirect.mockResolvedValue(true);
  clinics.findClinicById.mockResolvedValue({
    id: 4n,
    name: 'Klinik Sehat',
    email: 'halo@klinik.test',
    telephone: '0221234567',
    clinicAdminId: 24n,
  });
  email.sendEmail.mockResolvedValue({ ok: true });
  jobsClient.jobs.enqueue.mockResolvedValue(undefined);
  jobsClient.jobs.cancel.mockResolvedValue(undefined);
  schedule.syncSessionReminders.mockResolvedValue(undefined);
  kc.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 24n, clinicId: 4n });
});

describe('holdForApproval', () => {
  it('creates the record, schedules the first reminder and mails client and psychologist', async () => {
    expect(await holdForApproval({ row: row(), paymentOrderId: 'po_1', now: NOW })).toBe(true);

    expect(store.insertAwaiting).toHaveBeenCalledWith({
      appointmentId: 7,
      doctorWpUserId: 34,
      clinicId: 4,
      paymentOrderId: 'po_1',
      now: NOW,
    });
    // Session 48 h away: the first run is a day later.
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith({
      hook: 'praktiqu_approval_reminder',
      runAt: new Date('2026-10-21T03:00:00.000Z'),
      args: { appointmentId: 7 },
    });
    const sent = email.sendEmail.mock.calls.map(([m]) => (m as { to: string }).to);
    expect(sent).toEqual(['ada@contoh.test', 'dianda@klinik.test']);
    expect((email.sendEmail.mock.calls[1][0] as { html: string }).html).toContain(
      'https://appointment.praktiqu.test/dashboard/persetujuan/7',
    );
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_requested',
      expect.objectContaining({ resourceId: '7' }),
    );
  });

  it('a record that already exists: no job, no mail', async () => {
    store.insertAwaiting.mockResolvedValue(false);

    expect(await holdForApproval({ row: row(), paymentOrderId: 'po_1', now: NOW })).toBe(false);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('approveAwaiting', () => {
  it('claims, books with the payment, cancels the reminder and schedules session reminders', async () => {
    await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW });

    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'APPROVED', decidedBy: 'u_psi', decidedAt: NOW });
    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1, {
      gateway: 'xendit',
      wcOrderId: 49863,
      transactionId: 'tx_9',
    });
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(row({ status: SESSION_STATUS.BOOKED }));
    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_decided',
      expect.objectContaining({ metadata: expect.objectContaining({ decision: 'APPROVED', onBehalf: false }) }),
    );
  });

  it('a booking marked paid by hand has no order: booked without payment data', async () => {
    await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record({ paymentOrderId: null }), now: NOW });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1, undefined);
  });

  it('an admin approving is recorded as on behalf of the psychologist', async () => {
    await approveAwaiting({ actor: ADMIN as never, row: row(), approval: record(), now: NOW });

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.approval_decided',
      expect.objectContaining({ metadata: expect.objectContaining({ onBehalf: true }) }),
    );
  });

  it('refuses once the session has started, before claiming anything', async () => {
    await expect(
      approveAwaiting({ actor: PSIKOLOG as never, row: row({ slotDate: '2026-10-19' }), approval: record(), now: NOW }),
    ).rejects.toMatchObject({ code: 'session_already_started', status: 422 });

    expect(store.claimDecision).not.toHaveBeenCalled();
  });

  it('a lost race answers 409 naming who decided, and writes nothing', async () => {
    store.claimDecision.mockResolvedValue(false);
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', decidedBy: 'u_admin' }));

    const err = await approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW }).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ code: 'approval_already_decided', status: 409 });
    expect((err as Error).message).toContain('Rina Admin');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('a failed plugin write undoes the claim and answers 502', async () => {
    writes.setAppointmentStatus.mockRejectedValue(new Error('plugin down'));

    await expect(
      approveAwaiting({ actor: PSIKOLOG as never, row: row(), approval: record(), now: NOW }),
    ).rejects.toMatchObject({ code: 'upstream_failed', status: 502 });

    expect(store.revertDecision).toHaveBeenCalledWith(7, 'APPROVED', 'u_psi');
    expect(schedule.syncSessionReminders).not.toHaveBeenCalled();
  });
});

describe('rejectAwaiting', () => {
  it('claims with the reason, cancels directly (no plugin mail) and mails the client without the reason', async () => {
    await rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'Di luar keahlian saya', now: NOW });

    expect(store.claimDecision).toHaveBeenCalledWith(7, {
      state: 'REJECTED',
      decidedBy: 'u_psi',
      decidedAt: NOW,
      rejectReason: 'Di luar keahlian saya',
    });
    expect(sessions.setSessionStatusDirect).toHaveBeenCalledWith(7, 'CANCELLED');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(sent.to).toBe('ada@contoh.test');
    expect(sent.subject).toBe('Jadwal sesi Anda tidak dapat diterima');
    expect(sent.text).toContain('Klinik Sehat');
    expect(sent.text).not.toContain('Di luar keahlian');
  });

  it('a lost race answers 409 and writes nothing', async () => {
    store.claimDecision.mockResolvedValue(false);
    store.findApproval.mockResolvedValue(record({ state: 'APPROVED', decidedBy: 'u_admin' }));

    await expect(
      rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'x', now: NOW }),
    ).rejects.toMatchObject({ code: 'approval_already_decided', status: 409 });

    expect(sessions.setSessionStatusDirect).not.toHaveBeenCalled();
  });

  it('a failed status write undoes the claim', async () => {
    sessions.setSessionStatusDirect.mockRejectedValue(new Error('db down'));

    await expect(
      rejectAwaiting({ actor: PSIKOLOG as never, row: row(), reason: 'x', now: NOW }),
    ).rejects.toMatchObject({ code: 'status_write_failed', status: 500 });

    expect(store.revertDecision).toHaveBeenCalledWith(7, 'REJECTED', 'u_psi');
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('closeOnCancel', () => {
  it('closes an AWAITING record as CANCELLED and stops its reminders', async () => {
    expect(await closeOnCancel(7, 'u_admin', NOW)).toBe(true);

    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'CANCELLED', decidedBy: 'u_admin', decidedAt: NOW });
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: 7 } });
    expect(log.logging.audit).toHaveBeenCalledWith('session.approval_cancelled', expect.objectContaining({ resourceId: '7' }));
  });

  it('nothing to close: no job call', async () => {
    store.claimDecision.mockResolvedValue(false);

    expect(await closeOnCancel(7, null, NOW)).toBe(false);
    expect(jobsClient.jobs.cancel).not.toHaveBeenCalled();
  });
});

describe('settleExternal', () => {
  it('BOOKED outside the app: closes as APPROVED by nobody', async () => {
    await settleExternal(7, SESSION_STATUS.BOOKED, NOW);
    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'APPROVED', decidedBy: null, decidedAt: NOW });
  });

  it('CANCELLED outside the app: closes as CANCELLED with a refund to make', async () => {
    await settleExternal(7, SESSION_STATUS.CANCELLED, NOW);
    expect(store.claimDecision).toHaveBeenCalledWith(7, { state: 'CANCELLED', decidedBy: null, decidedAt: NOW });
  });
});

describe('markRefunded', () => {
  beforeEach(() => {
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', refundStatus: 'NEEDED' }));
  });

  it('a psychologist may not mark a refund', async () => {
    await expect(
      markRefunded({ actor: PSIKOLOG as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(store.markRefundDone).not.toHaveBeenCalled();
  });

  it("a clinic admin of another clinic may not either", async () => {
    kc.resolveKcActor.mockResolvedValue({ actor: ADMIN, wpUserId: 24n, clinicId: 9n });

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('404 without an approval record', async () => {
    store.findApproval.mockResolvedValue(null);

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'approval_not_found', status: 404 });
  });

  it('409 when there is no refund to mark', async () => {
    store.markRefundDone.mockResolvedValue(false);

    await expect(
      markRefunded({ actor: ADMIN as never, appointmentId: 7, note: null, now: NOW }),
    ).rejects.toMatchObject({ code: 'refund_not_needed', status: 409 });
  });

  it('marks it and answers the updated view', async () => {
    store.findApprovals.mockResolvedValue(
      new Map([
        [
          7,
          record({
            state: 'REJECTED',
            refundStatus: 'DONE',
            refundedBy: 'u_admin',
            refundedAt: NOW,
            refundNote: 'Transfer BCA 21/10',
          }),
        ],
      ]),
    );

    const view = await markRefunded({ actor: ADMIN as never, appointmentId: 7, note: 'Transfer BCA 21/10', now: NOW });

    expect(store.markRefundDone).toHaveBeenCalledWith(7, 'u_admin', 'Transfer BCA 21/10', NOW);
    expect(view).toMatchObject({ refundStatus: 'DONE', refundedByName: 'Rina Admin', refundNote: 'Transfer BCA 21/10' });
  });
});

describe('views', () => {
  it('approvalViews builds the staff view with names and payment', async () => {
    store.findApprovals.mockResolvedValue(
      new Map([
        [
          7,
          record({
            state: 'REJECTED',
            decidedBy: 'u_admin',
            decidedAt: NOW,
            rejectReason: 'Jadwal bentrok',
            refundStatus: 'NEEDED',
          }),
        ],
      ]),
    );

    const views = await approvalViews([row()], NOW);

    expect(views.get(7)).toEqual({
      state: 'REJECTED',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: NOW.toISOString(),
      decidedByName: 'Rina Admin',
      rejectReason: 'Jadwal bentrok',
      refundStatus: 'NEEDED',
      refundedAt: null,
      refundedByName: null,
      refundNote: null,
      isOverdue: false,
      payment: { gateway: 'xendit', wcOrderId: 49863, expectedAmount: 350000, chargedAmount: 350000, chargedCurrency: 'IDR' },
    });
  });

  it('isOverdue only for an AWAITING record whose session has started', async () => {
    store.findApprovals.mockResolvedValue(new Map([[7, record()]]));
    const past = row({ slotDate: '2026-10-19' });
    expect((await approvalViews([past], NOW)).get(7)!.isOverdue).toBe(true);

    store.findApprovals.mockResolvedValue(new Map([[7, record({ state: 'REJECTED' })]]));
    expect((await approvalViews([past], NOW)).get(7)!.isOverdue).toBe(false);
  });

  it('withApprovals sets null where there is no record', async () => {
    const [s] = await withApprovals([row()], NOW);
    expect(s.approval).toBeNull();
  });

  it('publicApprovalView carries no names, reason or order', async () => {
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED', rejectReason: 'rahasia', decidedBy: 'u_admin' }));

    const view = await publicApprovalView(row(), NOW);

    expect(Object.keys(view!).sort()).toEqual(['decidedAt', 'isOverdue', 'refundStatus', 'requestedAt', 'state']);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
npx vitest run tests/unit/approval/service.test.ts
```

Expected: FAIL, `Failed to resolve import "@/services/approval/service"`.

- [ ] **Step 3: Tulis `src/services/approval/service.ts`**

```ts
/**
 * Psychologist approval for paid online bookings.
 *
 * A psychologist who switches it on (settings.ts) gets every paid public booking as a
 * request. The booking stays PENDING — its slot stays held, and KiviCare's booking mail,
 * the session reminders and Google Calendar all wait — until it is approved (BOOKED with
 * the payment, after which everything runs as for any paid booking) or rejected
 * (CANCELLED, with money to refund by hand).
 *
 * Every decision is claimed on session_approvals with a conditional UPDATE before the
 * appointment is touched, so an approve and a reject racing each other cannot both land.
 * If the appointment write then fails, the claim is undone.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md
 */
import type { Actor } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { jobs } from '@/lib/jobs/client';
import { logging } from '@/lib/logging';
import { getPublicAppUrl } from '@/lib/public-url';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { setAppointmentStatus, type ConfirmedPayment } from '@/repositories/wp/appointments.write';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { findServiceById } from '@/repositories/wp/services.repo';
import {
  SESSION_STATUS,
  findSessionById,
  setSessionStatusDirect,
  type SessionRow,
  type SessionStatus,
} from '@/repositories/wp/sessions.repo';
import { resolveKcActor } from '@/services/billing/kc-actor';
import type { BuiltEmail } from '@/services/session/reminder-email';
import { sessionStartsAtUtc, syncSessionReminders } from '@/services/session/reminder-schedule';
import {
  buildClientAwaitingEmail,
  buildClientRejectedEmail,
  buildProfessionalRequestEmail,
  type SessionMailFacts,
} from './emails';
import { firstReminderAt, isOverdue } from './schedule';
import * as store from './store';

export const APPROVAL_REMINDER_HOOK = 'praktiqu_approval_reminder' as const;
export const APPROVAL_REMINDER_EVENT = 'approval.reminder' as const;

/**
 * Args for the hook. An OBJECT, never an array: the plugin's REST schema declares `args`
 * as `object`, and the two disagreeing once stopped every job from July to September.
 */
export function approvalReminderArgs(appointmentId: number): { appointmentId: number } {
  return { appointmentId };
}

export class ApprovalError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/** Where an email sends people: the FE page for one request, or the whole queue. */
export function approvalLink(appointmentId?: number): string {
  const tail = appointmentId !== undefined ? `/${appointmentId}` : '';
  return `${getPublicAppUrl()}/dashboard/persetujuan${tail}`;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export type Timed = Pick<SessionRow, 'id' | 'slotDate' | 'startTime' | 'timezone'>;

export interface ApprovalPayment {
  gateway: string;
  wcOrderId: number;
  expectedAmount: number;
  chargedAmount: number | null;
  chargedCurrency: string;
}

export interface ApprovalView {
  state: store.ApprovalState;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  rejectReason: string | null;
  refundStatus: store.RefundStatus;
  refundedAt: string | null;
  refundedByName: string | null;
  refundNote: string | null;
  /** AWAITING and the session has started: it can only be rejected now. */
  isOverdue: boolean;
  payment: ApprovalPayment | null;
}

/** What a client may see: no names, no internal reason, no order numbers. */
export interface PublicApprovalView {
  state: store.ApprovalState;
  requestedAt: string;
  decidedAt: string | null;
  refundStatus: store.RefundStatus;
  isOverdue: boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function overdue(a: store.ApprovalRecord, row: Timed, now: Date): boolean {
  return a.state === store.APPROVAL_STATE.AWAITING && isOverdue(sessionStartsAtUtc(row), now);
}

export async function approvalViews(rows: Timed[], now: Date = new Date()): Promise<Map<number, ApprovalView>> {
  const approvals = await store.findApprovals(rows.map((r) => r.id));
  if (approvals.size === 0) return new Map();

  const records = [...approvals.values()];
  const names = await store.userNames(records.flatMap((a) => [a.decidedBy, a.refundedBy]));
  const orders = await store.paymentOrdersByIds(
    records.flatMap((a) => (a.paymentOrderId ? [a.paymentOrderId] : [])),
  );

  const out = new Map<number, ApprovalView>();
  for (const row of rows) {
    const a = approvals.get(row.id);
    if (!a) continue;
    const order = a.paymentOrderId ? orders.get(a.paymentOrderId) : undefined;
    out.set(row.id, {
      state: a.state,
      requestedAt: a.requestedAt.toISOString(),
      decidedAt: iso(a.decidedAt),
      decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null,
      rejectReason: a.rejectReason,
      refundStatus: a.refundStatus,
      refundedAt: iso(a.refundedAt),
      refundedByName: a.refundedBy ? (names.get(a.refundedBy) ?? null) : null,
      refundNote: a.refundNote,
      isOverdue: overdue(a, row, now),
      payment: order
        ? {
            gateway: order.gateway,
            wcOrderId: order.wcOrderId,
            expectedAmount: order.expectedAmount,
            chargedAmount: order.chargedAmount,
            chargedCurrency: order.chargedCurrency,
          }
        : null,
    });
  }
  return out;
}

/** Sessions as the staff API returns them: `approval` is null for an ordinary booking. */
export async function withApprovals<T extends Timed>(
  rows: T[],
  now: Date = new Date(),
): Promise<Array<T & { approval: ApprovalView | null }>> {
  const views = await approvalViews(rows, now);
  return rows.map((r) => ({ ...r, approval: views.get(r.id) ?? null }));
}

export async function publicApprovalView(row: Timed, now: Date = new Date()): Promise<PublicApprovalView | null> {
  const a = await store.findApproval(row.id);
  if (!a) return null;
  return {
    state: a.state,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    refundStatus: a.refundStatus,
    isOverdue: overdue(a, row, now),
  };
}

/* ------------------------------------------------------------------ */
/* Mail                                                                */
/* ------------------------------------------------------------------ */

export async function serviceNameOf(row: Pick<SessionRow, 'serviceIds'>): Promise<string> {
  const first = row.serviceIds[0];
  if (first === undefined) return 'Sesi';
  return (await findServiceById(BigInt(first)))?.name ?? 'Sesi';
}

/** Null when the session has no usable start: nothing sensible to put in a mail. */
export async function mailFacts(row: SessionRow): Promise<SessionMailFacts | null> {
  const startsAtUtc = sessionStartsAtUtc(row);
  if (!startsAtUtc || Number.isNaN(startsAtUtc.getTime())) return null;
  return {
    clientName: row.clientName,
    professionalName: row.professionalName,
    serviceName: await serviceNameOf(row),
    startsAtUtc,
    timezone: row.timezone,
  };
}

/** sendEmail never throws and logs a failed delivery itself. An empty address is skipped. */
export async function mail(to: string, built: BuiltEmail, template: string): Promise<boolean> {
  if (!to) return false;
  const res = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, template });
  return res.ok;
}

/** The clinic's admin (wp_kc_clinics.clinic_admin_id), or null when it has none. */
export async function clinicAdminContact(clinicId: number): Promise<{ email: string; name: string } | null> {
  const clinic = await findClinicById(BigInt(clinicId));
  if (!clinic || clinic.clinicAdminId <= 0n) return null;
  return store.findWpUserContact(Number(clinic.clinicAdminId));
}

/* ------------------------------------------------------------------ */
/* Hold                                                                */
/* ------------------------------------------------------------------ */

export interface HoldInput {
  row: SessionRow;
  /** payment_orders.id; null when staff marked the booking paid by hand. */
  paymentOrderId: string | null;
  actorId?: string | null;
  now?: Date;
}

/**
 * Put a paid booking in its psychologist's queue. The appointment is NOT touched: it is
 * PENDING and stays PENDING. Returns false when it was already queued (a repeated webhook
 * or status poll), in which case nothing is mailed or scheduled again.
 */
export async function holdForApproval(input: HoldInput): Promise<boolean> {
  const now = input.now ?? new Date();
  const { row } = input;

  const created = await store.insertAwaiting({
    appointmentId: row.id,
    doctorWpUserId: row.professionalId,
    clinicId: row.clinicId,
    paymentOrderId: input.paymentOrderId,
    now,
  });
  if (!created) return false;

  await logging.audit('session.approval_requested', {
    userId: input.actorId ?? null,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.approval_requested',
    metadata: { professionalId: row.professionalId, clinicId: row.clinicId, paymentOrderId: input.paymentOrderId },
  });

  await jobs.enqueue({
    hook: APPROVAL_REMINDER_HOOK,
    runAt: firstReminderAt(now, sessionStartsAtUtc(row)),
    args: approvalReminderArgs(row.id),
  });

  const facts = await mailFacts(row);
  if (facts) {
    await mail(row.clientEmail, buildClientAwaitingEmail(facts), 'approval_client_awaiting');
    await mail(
      row.professionalEmail,
      buildProfessionalRequestEmail({ ...facts, link: approvalLink(row.id), waitingSince: null }),
      'approval_professional_request',
    );
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

async function paymentFor(approval: store.ApprovalRecord): Promise<ConfirmedPayment | undefined> {
  if (!approval.paymentOrderId) return undefined;
  const order = (await store.paymentOrdersByIds([approval.paymentOrderId])).get(approval.paymentOrderId);
  return order ? { gateway: order.gateway, wcOrderId: order.wcOrderId, transactionId: order.transactionId } : undefined;
}

/**
 * PENDING → BOOKED with the payment. Through the plugin, whose conditional claim fires
 * `kc_appointment_payment_completed` exactly once — KiviCare's booking mail to client,
 * psychologist and clinic. A booking marked paid by hand has no order and books without
 * it, which mails nobody (the gap spec §12 keeps).
 */
async function confirmBooked(approval: store.ApprovalRecord): Promise<void> {
  await setAppointmentStatus(approval.appointmentId, APPOINTMENT_STATUS.BOOKED, await paymentFor(approval));
}

async function afterBooked(appointmentId: number): Promise<void> {
  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  const booked = await findSessionById(appointmentId);
  if (booked) await syncSessionReminders(booked);
}

/**
 * Finish an approval that was claimed but never reached the plugin (the process died in
 * between). Safe to repeat: the plugin's claim only moves a PENDING row.
 */
export async function completeApproval(approval: store.ApprovalRecord): Promise<void> {
  await confirmBooked(approval);
  await afterBooked(approval.appointmentId);
}

async function alreadyDecided(appointmentId: number): Promise<ApprovalError> {
  const current = await store.findApproval(appointmentId);
  if (!current) {
    return new ApprovalError('approval_already_decided', 'This booking is no longer waiting for approval', 409);
  }
  const who = current.decidedBy ? (await store.userNames([current.decidedBy])).get(current.decidedBy) : undefined;
  return new ApprovalError(
    'approval_already_decided',
    `This booking was already ${current.state}${who ? ` by ${who}` : ''}`,
    409,
  );
}

async function auditDecision(
  actor: Actor,
  row: SessionRow,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
): Promise<void> {
  const onBehalf = actor.role !== 'PROFESSIONAL';
  await logging.audit('session.approval_decided', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.approval_decided',
    metadata: { decision, reason, onBehalf, professionalId: row.professionalId },
  });
  await logging.audit('session.status_changed', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.status_changed',
    metadata: {
      from: SESSION_STATUS.PENDING,
      to: decision === 'APPROVED' ? SESSION_STATUS.BOOKED : SESSION_STATUS.CANCELLED,
      reason,
    },
  });
}

export interface DecideInput {
  actor: Actor;
  row: SessionRow;
  now?: Date;
}

/** The caller (transitionSession) has already checked that the actor may decide. */
export async function approveAwaiting(input: DecideInput & { approval: store.ApprovalRecord }): Promise<void> {
  const now = input.now ?? new Date();
  const { actor, row, approval } = input;

  if (isOverdue(sessionStartsAtUtc(row), now)) {
    throw new ApprovalError('session_already_started', 'This session has already started; it can only be rejected', 422);
  }

  const claimed = await store.claimDecision(row.id, {
    state: store.APPROVAL_STATE.APPROVED,
    decidedBy: actor.id,
    decidedAt: now,
  });
  if (!claimed) throw await alreadyDecided(row.id);

  try {
    await confirmBooked(approval);
  } catch (err) {
    await store.revertDecision(row.id, store.APPROVAL_STATE.APPROVED, actor.id);
    await logging.error('approval: confirming the booking failed', err, { resource: 'session', resourceId: String(row.id) });
    throw new ApprovalError('upstream_failed', 'The booking could not be confirmed. Try again.', 502);
  }

  await afterBooked(row.id);
  await auditDecision(actor, row, 'APPROVED', null);
}

/** The caller (transitionSession) has already checked that the actor may decide. */
export async function rejectAwaiting(input: DecideInput & { reason: string }): Promise<void> {
  const now = input.now ?? new Date();
  const { actor, row, reason } = input;

  const claimed = await store.claimDecision(row.id, {
    state: store.APPROVAL_STATE.REJECTED,
    decidedBy: actor.id,
    decidedAt: now,
    rejectReason: reason,
  });
  if (!claimed) throw await alreadyDecided(row.id);

  try {
    // Directly, not through the plugin. The client never got KiviCare's booking mail, so
    // its cancellation mail would only be a confusing second message; and a PENDING
    // booking has nothing else to tear down. The plugin's set_status(0) is an UPDATE plus
    // kc_appointment_cancelled — it touches no WooCommerce order.
    await setSessionStatusDirect(row.id, SESSION_STATUS.CANCELLED);
  } catch (err) {
    await store.revertDecision(row.id, store.APPROVAL_STATE.REJECTED, actor.id);
    await logging.error('approval: cancelling the booking failed', err, { resource: 'session', resourceId: String(row.id) });
    throw new ApprovalError('status_write_failed', 'The booking could not be cancelled. Try again.', 500);
  }

  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(row.id) });
  await auditDecision(actor, row, 'REJECTED', reason);

  const facts = await mailFacts(row);
  if (facts) {
    const clinic = await findClinicById(BigInt(row.clinicId));
    await mail(
      row.clientEmail,
      buildClientRejectedEmail({
        ...facts,
        clinicName: clinic?.name ?? 'klinik',
        clinicEmail: clinic?.email ?? null,
        clinicPhone: clinic?.telephone ?? null,
      }),
      'approval_client_rejected',
    );
  }
}

/**
 * A waiting booking was cancelled some other way (staff cancel, bulk cancel, the client's
 * own link). The money is in, so it joins the refund list. False when there was no
 * AWAITING record to close.
 */
export async function closeOnCancel(appointmentId: number, actorId: string | null, now: Date = new Date()): Promise<boolean> {
  const closed = await store.claimDecision(appointmentId, {
    state: store.APPROVAL_STATE.CANCELLED,
    decidedBy: actorId,
    decidedAt: now,
  });
  if (!closed) return false;

  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  await logging.audit('session.approval_cancelled', {
    userId: actorId,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.approval_cancelled',
    metadata: { refundStatus: store.REFUND_STATUS.NEEDED },
  });
  return true;
}

/**
 * The appointment left PENDING without passing through here — someone changed it in
 * KiviCare's own dashboard. Close the record to match, so the queue stops showing it.
 */
export async function settleExternal(appointmentId: number, status: SessionStatus, now: Date = new Date()): Promise<void> {
  if (status === SESSION_STATUS.CANCELLED) {
    await closeOnCancel(appointmentId, null, now);
    return;
  }
  const closed = await store.claimDecision(appointmentId, {
    state: store.APPROVAL_STATE.APPROVED,
    decidedBy: null,
    decidedAt: now,
  });
  if (!closed) return;
  await jobs.cancel({ hook: APPROVAL_REMINDER_HOOK, args: approvalReminderArgs(appointmentId) });
  await logging.audit('session.approval_decided', {
    userId: null,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.approval_decided',
    metadata: { decision: 'APPROVED', external: true, status },
  });
}

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

export interface MarkRefundedInput {
  actor: Actor;
  appointmentId: number;
  note: string | null;
  now?: Date;
}

/** NEEDED → DONE. Clinic admins of the session's clinic and super admins only. */
export async function markRefunded(input: MarkRefundedInput): Promise<ApprovalView> {
  const now = input.now ?? new Date();
  const { actor, appointmentId } = input;

  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'CLINIC_ADMIN') {
    throw new ApprovalError('forbidden', 'Only clinic admins can mark a refund', 403);
  }
  const row = await findSessionById(appointmentId);
  if (!row) throw new ApprovalError('not_found', 'Session not found', 404);
  if (actor.role === 'CLINIC_ADMIN') {
    const kc = await resolveKcActor(actor);
    if (kc.clinicId === null || Number(kc.clinicId) !== row.clinicId) {
      throw new ApprovalError('forbidden', 'Not authorized for this clinic', 403);
    }
  }

  const approval = await store.findApproval(appointmentId);
  if (!approval) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);

  const done = await store.markRefundDone(appointmentId, actor.id, input.note, now);
  if (!done) {
    throw new ApprovalError('refund_not_needed', `The refund status is ${approval.refundStatus}`, 409);
  }

  await logging.audit('session.refund_marked', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(appointmentId),
    action: 'session.refund_marked',
    metadata: { note: input.note },
  });

  const view = (await approvalViews([row], now)).get(appointmentId);
  if (!view) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  return view;
}
```

- [ ] **Step 4: Jalankan tes dan typecheck**

```bash
npx vitest run tests/unit/approval/service.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`.

Kalau `clinicAdminId <= 0n` ditolak TypeScript (target ES lama tanpa literal BigInt), ganti dengan `clinic.clinicAdminId <= BigInt(0)`.

- [ ] **Step 5: Commit**

```bash
git add src/services/approval/service.ts tests/unit/approval/service.test.ts
git commit -m "$(cat <<'EOF'
feat(approval): layanan keputusan approval psikolog

Hold saat lunas, setujui (BOOKED dengan data pembayaran), tolak (CANCELLED
langsung + email klien), tutup saat dibatalkan, tandai refund, dan view
untuk staf maupun publik. Klaim dulu, tulis status kemudian, batalkan
klaim kalau penulisan gagal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Handler job `approval.reminder`

**Files:**
- Create: `src/services/approval/reminder-handler.ts`
- Modify: `src/lib/jobs/client.ts` (union `JobHook`)
- Modify: `src/app/api/v1/webhooks/wordpress-jobs/route.ts` (impor efek samping)
- Test: `tests/unit/approval/reminder-handler.test.ts`, `tests/unit/approval/reminder-registration.test.ts`

**Interfaces:**
- Consumes: `planReminder` (B2); `APPROVAL_REMINDER_*`, `approvalReminderArgs`, `approvalLink`, `clinicAdminContact`, `completeApproval`, `settleExternal`, `mail`, `mailFacts` (B3); `findApproval`, `touchReminder`, `markEscalated` (B1); hook plugin P1.
- Produces: `handleApprovalReminder(data: Record<string, unknown>, now?: Date): Promise<void>`, terdaftar untuk event `approval.reminder`.

- [ ] **Step 1: Tulis tes handler (gagal)**

`tests/unit/approval/reminder-handler.test.ts`:

```ts
/**
 * approval.reminder — one Action Scheduler job per waiting booking (spec §4.4).
 *
 * The clock is injected, so each scenario is exact. The service's own decisions
 * (completeApproval, settleExternal) are mocked: here we pin WHEN the handler calls them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const store = vi.hoisted(() => ({ findApproval: vi.fn(), touchReminder: vi.fn(), markEscalated: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  ...store,
}));

const decisions = vi.hoisted(() => ({
  completeApproval: vi.fn(),
  settleExternal: vi.fn(),
  clinicAdminContact: vi.fn(),
}));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  ...decisions,
}));

const sessions = vi.hoisted(() => ({ findSessionById: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => sessions.findSessionById(...a),
}));

vi.mock('@/repositories/wp/services.repo', () => ({
  findServiceById: async () => ({ name: 'Konseling Individu' }),
}));

const jobsClient = vi.hoisted(() => ({ jobs: { enqueue: vi.fn(), cancel: vi.fn() } }));
vi.mock('@/lib/jobs/client', () => jobsClient);

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', () => email);

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

import { handleApprovalReminder } from '@/services/approval/reminder-handler';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-20T03:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 4,
    professionalId: 34,
    clientId: 522,
    professionalName: 'Dianda Psikolog',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'dianda@klinik.test',
    slotDate: '2026-10-23', // 2026-10-23T03:00Z = T0 + 72 h
    startTime: '10:00:00',
    endTime: '11:00:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: T0,
    ...over,
  };
}

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    appointmentId: 7,
    doctorWpUserId: 34,
    clinicId: 4,
    paymentOrderId: 'po_1',
    state: 'AWAITING',
    requestedAt: T0,
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    refundStatus: 'NONE',
    refundedAt: null,
    refundedBy: null,
    refundNote: null,
    lastReminderAt: null,
    escalatedAt: null,
    ...over,
  };
}

const recipients = () => email.sendEmail.mock.calls.map(([m]) => (m as { to: string }).to);

beforeEach(() => {
  vi.clearAllMocks();
  store.findApproval.mockResolvedValue(record());
  store.touchReminder.mockResolvedValue(undefined);
  store.markEscalated.mockResolvedValue(undefined);
  sessions.findSessionById.mockResolvedValue(row());
  decisions.clinicAdminContact.mockResolvedValue({ email: 'admin@klinik.test', name: 'Rina' });
  decisions.completeApproval.mockResolvedValue(undefined);
  decisions.settleExternal.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
  jobsClient.jobs.enqueue.mockResolvedValue(undefined);
});

describe('handleApprovalReminder', () => {
  it('a day after the request: reminds the psychologist, escalates once, runs again', async () => {
    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(recipients()).toEqual(['dianda@klinik.test', 'admin@klinik.test']);
    expect(store.touchReminder).toHaveBeenCalledWith(7, at(24));
    expect(store.markEscalated).toHaveBeenCalledWith(7, at(24));
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith({
      hook: 'praktiqu_approval_reminder',
      runAt: at(48),
      args: { appointmentId: 7 },
    });
  });

  it('already escalated and reminded recently: mails nobody, still reschedules', async () => {
    store.findApproval.mockResolvedValue(record({ lastReminderAt: at(20), escalatedAt: at(1) }));

    await handleApprovalReminder({ appointmentId: 7 }, at(25));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a clinic with no admin: marks the escalation done anyway', async () => {
    decisions.clinicAdminContact.mockResolvedValue(null);

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(recipients()).toEqual(['dianda@klinik.test']);
    expect(store.markEscalated).toHaveBeenCalledWith(7, at(24));
    expect(log.logging.audit).toHaveBeenCalledWith(
      'approval.reminder.ran',
      expect.objectContaining({ metadata: expect.objectContaining({ escalated: 'no_admin' }) }),
    );
  });

  it('the session has started: nothing, and no next run', async () => {
    await handleApprovalReminder({ appointmentId: 7 }, at(73));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('APPROVED on a PENDING appointment: finishes the approval', async () => {
    const approved = record({ state: 'APPROVED', decidedBy: 'u_psi' });
    store.findApproval.mockResolvedValue(approved);

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(decisions.completeApproval).toHaveBeenCalledWith(approved);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it.each([SESSION_STATUS.BOOKED, SESSION_STATUS.CANCELLED])(
    'AWAITING but the appointment is %s: settles it',
    async (status) => {
      sessions.findSessionById.mockResolvedValue(row({ status }));

      await handleApprovalReminder({ appointmentId: 7 }, at(24));

      expect(decisions.settleExternal).toHaveBeenCalledWith(7, status, at(24));
      expect(email.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('already decided: skipped', async () => {
    store.findApproval.mockResolvedValue(record({ state: 'REJECTED' }));
    sessions.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));

    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(decisions.settleExternal).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a positive integer, and accepts a numeric string', async () => {
    await handleApprovalReminder({ appointmentId: 'abc' }, at(24));
    expect(store.findApproval).not.toHaveBeenCalled();
    expect(log.logging.warn).toHaveBeenCalled();

    await handleApprovalReminder({ appointmentId: '7' }, at(24));
    expect(store.findApproval).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 2: Tulis tes pendaftaran (gagal)**

`tests/unit/approval/reminder-registration.test.ts`:

```ts
/**
 * If nothing imports reminder-handler, registerJobHandler never runs and the webhook
 * approval.reminder falls into "No handler registered" — answered 200, never done, never
 * retried by WordPress. This enters through processWebhook, the path production uses,
 * so it catches the import being removed as "unused".
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'rahasia-webhook-untuk-test';
process.env.WORDPRESS_WEBHOOK_SECRET = SECRET;

const store = vi.hoisted(() => ({ findApproval: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => store.findApproval(...a),
}));

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

describe('registering approval.reminder', () => {
  it('importing the route module makes the webhook reach the handler', async () => {
    store.findApproval.mockResolvedValue(null);
    await import('@/app/api/v1/webhooks/wordpress-jobs/route');
    const { processWebhook } = await import('@/lib/jobs/webhook-handler');

    const body = JSON.stringify({ event: 'approval.reminder', data: { appointmentId: 7 } });
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    expect(await processWebhook(body, signature)).toBe(true);
    expect(store.findApproval).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
npx vitest run tests/unit/approval/reminder-handler.test.ts tests/unit/approval/reminder-registration.test.ts
```

Expected: tes handler FAIL (`Failed to resolve import "@/services/approval/reminder-handler"`); tes pendaftaran FAIL (`findApproval` tidak dipanggil).

- [ ] **Step 4: Tulis `src/services/approval/reminder-handler.ts`**

```ts
/**
 * `approval.reminder` — one Action Scheduler job per waiting booking, rescheduled by itself
 * until the booking is decided or its start passes (spec §4.4).
 *
 * Runs in the background with nobody waiting on it, so it never throws on a refusal: it
 * logs and ends. WordPress-side unscheduling is best-effort and WP-Cron runs late, so every
 * run re-reads the record and the appointment and acts only on what is true now.
 */
import { jobs } from '@/lib/jobs/client';
import { registerJobHandler } from '@/lib/jobs/webhook-handler';
import { logging } from '@/lib/logging';
import { SESSION_STATUS, findSessionById } from '@/repositories/wp/sessions.repo';
import { sessionStartsAtUtc } from '@/services/session/reminder-schedule';
import { buildAdminEscalationEmail, buildProfessionalRequestEmail } from './emails';
import { planReminder } from './schedule';
import {
  APPROVAL_REMINDER_EVENT,
  APPROVAL_REMINDER_HOOK,
  approvalLink,
  approvalReminderArgs,
  clinicAdminContact,
  completeApproval,
  mail,
  mailFacts,
  settleExternal,
} from './service';
import * as store from './store';

export async function handleApprovalReminder(data: Record<string, unknown>, now: Date = new Date()): Promise<void> {
  // Crosses a JSON boundary from WordPress, which may send "7". Coerced, then checked.
  const appointmentId = Number(data.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    await logging.warn(`${APPROVAL_REMINDER_EVENT}: invalid appointmentId`, { metadata: { data } });
    return;
  }
  const resourceId = String(appointmentId);

  const approval = await store.findApproval(appointmentId);
  const row = approval ? await findSessionById(appointmentId) : null;
  if (!approval || !row) {
    await logging.warn(`${APPROVAL_REMINDER_EVENT}: approval or session not found`, { resource: 'session', resourceId });
    return;
  }

  // The record and the appointment disagree: settle that, then stop. An APPROVED record on
  // a PENDING appointment is an approval that died before it reached the plugin.
  if (approval.state === store.APPROVAL_STATE.APPROVED && row.status === SESSION_STATUS.PENDING) {
    await completeApproval(approval);
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.completed`, { resource: 'session', resourceId });
    return;
  }
  if (approval.state === store.APPROVAL_STATE.AWAITING && row.status !== SESSION_STATUS.PENDING) {
    await settleExternal(appointmentId, row.status, now);
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.settled`, {
      resource: 'session',
      resourceId,
      metadata: { status: row.status },
    });
    return;
  }
  if (approval.state !== store.APPROVAL_STATE.AWAITING) {
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.skipped`, {
      resource: 'session',
      resourceId,
      metadata: { reason: 'decided', state: approval.state },
    });
    return;
  }

  const startsAt = sessionStartsAtUtc(row);
  if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= now.getTime()) {
    // Overdue: the queue shows it as "Terlewat" and only a rejection is left. Nagging about
    // a session that already started helps nobody.
    await logging.audit(`${APPROVAL_REMINDER_EVENT}.skipped`, {
      resource: 'session',
      resourceId,
      metadata: { reason: startsAt ? 'overdue' : 'no_schedule' },
    });
    return;
  }

  const plan = planReminder({
    now,
    startsAt,
    requestedAt: approval.requestedAt,
    lastReminderAt: approval.lastReminderAt,
    escalatedAt: approval.escalatedAt,
  });
  const facts = await mailFacts(row);
  const link = approvalLink(appointmentId);

  let reminded = false;
  if (plan.remindProfessional && facts) {
    reminded = await mail(
      row.professionalEmail,
      buildProfessionalRequestEmail({ ...facts, link, waitingSince: approval.requestedAt }),
      'approval_professional_reminder',
    );
    await store.touchReminder(appointmentId, now);
  }

  let escalated: 'sent' | 'no_admin' | null = null;
  if (plan.escalate) {
    const admin = await clinicAdminContact(row.clinicId);
    if (admin && facts) {
      await mail(
        admin.email,
        buildAdminEscalationEmail({ ...facts, adminName: admin.name, link, requestedAt: approval.requestedAt }),
        'approval_admin_escalation',
      );
    }
    // Marked either way: an escalation with nobody to receive it would otherwise be retried
    // on every run. The queue still shows the booking to the super admin.
    await store.markEscalated(appointmentId, now);
    escalated = admin ? 'sent' : 'no_admin';
  }

  if (plan.nextRunAt) {
    await jobs.enqueue({ hook: APPROVAL_REMINDER_HOOK, runAt: plan.nextRunAt, args: approvalReminderArgs(appointmentId) });
  }

  await logging.audit(`${APPROVAL_REMINDER_EVENT}.ran`, {
    resource: 'session',
    resourceId,
    metadata: { reminded, escalated, nextRunAt: plan.nextRunAt ? plan.nextRunAt.toISOString() : null },
  });
}

// Side effect on load. The jobs webhook route imports this module for exactly this; see
// the comment in src/app/api/v1/webhooks/wordpress-jobs/route.ts.
registerJobHandler(APPROVAL_REMINDER_EVENT, (data) => handleApprovalReminder(data));
```

- [ ] **Step 5: Daftarkan hook dan impor**

`src/lib/jobs/client.ts`: tambahkan anggota terakhir pada union `JobHook`:

```ts
  | 'praktiqu_booking_unpaid_cancel'
  | 'praktiqu_approval_reminder';
```

(hapus titik koma dari baris `'praktiqu_booking_unpaid_cancel'` yang lama.)

`src/app/api/v1/webhooks/wordpress-jobs/route.ts`: tepat setelah baris `import '@/services/public/unpaid-booking';` tambahkan:

```ts
// Same reason: registers the handler for approval.reminder (psychologist approval).
import '@/services/approval/reminder-handler';
```

- [ ] **Step 6: Jalankan tes baru, tes pendaftaran lama, dan typecheck**

```bash
npx vitest run tests/unit/approval/reminder-handler.test.ts tests/unit/approval/reminder-registration.test.ts tests/unit/session/reminder-registration.test.ts tests/unit/public/unpaid-booking-registration.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`.

`tests/unit/public/unpaid-booking-registration.test.ts` me-mock `@/lib/db`. Kalau sekarang gagal dengan `Cannot read properties of undefined (reading 'findUnique')` dari `sessionApproval`, tempelkan **blok mock "approval mati"** (Global Constraints) di bawah `vi.mock('@/lib/db', …)` pada file itu, lalu ulangi.

- [ ] **Step 7: Commit**

```bash
git add src/services/approval/reminder-handler.ts src/lib/jobs/client.ts src/app/api/v1/webhooks/wordpress-jobs/route.ts tests/unit/approval/reminder-handler.test.ts tests/unit/approval/reminder-registration.test.ts
git add tests/unit/public/unpaid-booking-registration.test.ts 2>/dev/null; git status --short
git commit -m "$(cat <<'EOF'
feat(approval): job pengingat dan eskalasi approval

approval.reminder mengingatkan psikolog paling sering sehari sekali,
mengeskalasi ke admin klinik satu kali, berhenti saat jam sesi lewat,
dan merapikan catatan yang tidak cocok dengan status janji temu.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git add` baris kedua hanya berpengaruh kalau file itu memang diubah di Step 6.)

---

### Task B5: `session.service.ts` — keputusan lewat `/approve`, `/reject`, `/cancel`

**Files:**
- Modify: `src/services/session/session.service.ts`
- Modify: `src/app/api/v1/sessions/[id]/reject/route.ts`
- Modify: `src/app/api/v1/sessions/bulk/delete/route.ts`
- Modify: `tests/unit/session/reminder-hooks.test.ts` (blok mock)
- Test: `tests/unit/approval/transition.test.ts`

**Interfaces:**
- Consumes: `findApproval`, `findApprovals`, `APPROVAL_STATE` (B1); `requiresApproval` (B1); `approveAwaiting`, `rejectAwaiting`, `closeOnCancel`, `holdForApproval`, `completeApproval`, `withApprovals`, `ApprovalView` (B3).
- Produces:
  - `SessionWithRelations.approval?: ApprovalView | null` (selalu terisi di `getSession`, `listSessions`, `listPendingForProfessional`, `transitionSession`).
  - `TransitionArgs.intent?: 'reject'`.
  - `bulkCancelSessions(ids: number[], actorId?: string | null): Promise<number>`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/unit/approval/transition.test.ts`:

```ts
/**
 * transitionSession with a booking that waits for its psychologist (spec §7.2).
 *
 * /approve and /reject now mean two things each. Which one is decided by the approval
 * record, never by the caller: an AWAITING record makes them a psychologist's decision,
 * no record leaves them "mark as paid" and "reject an unpaid booking" as before — except
 * that marking paid for a psychologist with the switch on queues the booking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ApprovalRecord } from '@/services/approval/store';

const repo = vi.hoisted(() => ({ findSessionById: vi.fn(), listSessions: vi.fn(), setSessionStatusDirect: vi.fn() }));
vi.mock('@/repositories/wp/sessions.repo', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/sessions.repo')>()),
  findSessionById: (...a: unknown[]) => repo.findSessionById(...a),
  listSessions: (...a: unknown[]) => repo.listSessions(...a),
  setSessionStatusDirect: (...a: unknown[]) => repo.setSessionStatusDirect(...a),
}));

const writes = vi.hoisted(() => ({
  setAppointmentStatus: vi.fn(),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/repositories/wp/appointments.write', () => writes);

const kcActor = vi.hoisted(() => ({ resolveKcActor: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kcActor);

const schedule = vi.hoisted(() => ({ syncSessionReminders: vi.fn() }));
vi.mock('@/services/session/reminder-schedule', async (orig) => ({
  ...(await orig<typeof import('@/services/session/reminder-schedule')>()),
  syncSessionReminders: (...a: unknown[]) => schedule.syncSessionReminders(...a),
}));

const log = vi.hoisted(() => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));
vi.mock('@/lib/logging', () => log);

const approvalStore = vi.hoisted(() => ({ findApproval: vi.fn(), findApprovals: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => approvalStore.findApproval(...a),
  findApprovals: (...a: unknown[]) => approvalStore.findApprovals(...a),
}));

const settings = vi.hoisted(() => ({ requiresApproval: vi.fn() }));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: (...a: unknown[]) => settings.requiresApproval(...a),
}));

const approval = vi.hoisted(() => ({
  approveAwaiting: vi.fn(),
  rejectAwaiting: vi.fn(),
  closeOnCancel: vi.fn(),
  holdForApproval: vi.fn(),
  completeApproval: vi.fn(),
}));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  ...approval,
  withApprovals: async (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ ...r, approval: null })),
}));

import {
  bulkCancelSessions,
  invalidatePendingForOffDay,
  transitionSession,
} from '@/services/session/session.service';

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: '2099-09-10',
    startTime: '09:30:00',
    endTime: '10:30:00',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.PENDING,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    appointmentId: 7,
    doctorWpUserId: 119,
    clinicId: 1,
    paymentOrderId: 'po_1',
    state: 'AWAITING',
    requestedAt: new Date('2026-09-01T00:00:00Z'),
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    refundStatus: 'NONE',
    refundedAt: null,
    refundedBy: null,
    refundNote: null,
    lastReminderAt: null,
    escalatedAt: null,
    ...over,
  };
}

const PSIKOLOG = { id: 'u_psi', role: 'PROFESSIONAL', practiceId: null };
const ADMIN = { id: 'u_admin', role: 'CLINIC_ADMIN', practiceId: null };
const RESEPSIONIS = { id: 'u_resepsionis', role: 'RECEPTIONIST', practiceId: null };

function actAs(actor: { id: string; role: string }, wpUserId: bigint) {
  kcActor.resolveKcActor.mockResolvedValue({ actor, wpUserId, clinicId: 1n });
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findSessionById.mockResolvedValue(row());
  repo.setSessionStatusDirect.mockResolvedValue(true);
  writes.setAppointmentStatus.mockResolvedValue({ id: 7, status: 1, cancelled: false });
  writes.cancelAppointment.mockResolvedValue({ id: 7, status: 0, cancelled: true });
  approvalStore.findApproval.mockResolvedValue(null);
  approvalStore.findApprovals.mockResolvedValue(new Map());
  settings.requiresApproval.mockResolvedValue(false);
  approval.approveAwaiting.mockResolvedValue(undefined);
  approval.rejectAwaiting.mockResolvedValue(undefined);
  approval.closeOnCancel.mockResolvedValue(true);
  approval.holdForApproval.mockResolvedValue(true);
  approval.completeApproval.mockResolvedValue(undefined);
  schedule.syncSessionReminders.mockResolvedValue(undefined);
  actAs(PSIKOLOG, 119n);
});

describe('an AWAITING booking', () => {
  beforeEach(() => {
    approvalStore.findApproval.mockResolvedValue(record());
  });

  it('/approve by its psychologist is an approval, not a plain status write', async () => {
    await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(approval.approveAwaiting).toHaveBeenCalledWith({ actor: PSIKOLOG, row: row(), approval: record() });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('/reject by a clinic admin is a rejection, with the reason', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({
      actor: ADMIN as never,
      sessionId: 7,
      target: SESSION_STATUS.CANCELLED,
      reason: 'Jadwal bentrok',
      intent: 'reject',
    });

    expect(approval.rejectAwaiting).toHaveBeenCalledWith({ actor: ADMIN, row: row(), reason: 'Jadwal bentrok' });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('/reject by a receptionist is refused', async () => {
    actAs(RESEPSIONIS, 21n);

    await expect(
      transitionSession({
        actor: RESEPSIONIS as never,
        sessionId: 7,
        target: SESSION_STATUS.CANCELLED,
        reason: 'x',
        intent: 'reject',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
  });

  it('/cancel cancels as before and puts the money on the refund list', async () => {
    actAs(RESEPSIONIS, 21n);

    await transitionSession({ actor: RESEPSIONIS as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 0);
    expect(approval.closeOnCancel).toHaveBeenCalledWith(7, 'u_resepsionis');
  });
});

describe('a PENDING booking without a record', () => {
  it('"mark as paid" for a psychologist with the switch on queues it instead of booking it', async () => {
    actAs(ADMIN, 24n);
    settings.requiresApproval.mockResolvedValue(true);

    await transitionSession({ actor: ADMIN as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(approval.holdForApproval).toHaveBeenCalledWith({ row: row(), paymentOrderId: null, actorId: 'u_admin' });
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('"mark as paid" with the switch off books it exactly as before', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({ actor: ADMIN as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 1);
    expect(approval.holdForApproval).not.toHaveBeenCalled();
  });

  it('/reject of an unpaid booking stays a plain cancel', async () => {
    actAs(ADMIN, 24n);

    await transitionSession({
      actor: ADMIN as never,
      sessionId: 7,
      target: SESSION_STATUS.CANCELLED,
      reason: 'x',
      intent: 'reject',
    });

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(7, 0);
    expect(approval.rejectAwaiting).not.toHaveBeenCalled();
    expect(approval.closeOnCancel).not.toHaveBeenCalled();
  });
});

it('an APPROVED record on a PENDING booking finishes the approval', async () => {
  approvalStore.findApproval.mockResolvedValue(record({ state: 'APPROVED', decidedBy: 'u_psi' }));

  await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

  expect(approval.completeApproval).toHaveBeenCalledWith(record({ state: 'APPROVED', decidedBy: 'u_psi' }));
  expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
});

it('the answer carries the approval field', async () => {
  const s = await transitionSession({ actor: PSIKOLOG as never, sessionId: 7, target: SESSION_STATUS.BOOKED });
  expect(s).toHaveProperty('approval', null);
});

describe('invalidatePendingForOffDay', () => {
  it('leaves a paid booking that waits for its psychologist alone', async () => {
    repo.listSessions.mockResolvedValue({ items: [row({ id: 7 }), row({ id: 8 })], total: 2 });
    approvalStore.findApprovals.mockResolvedValue(new Map([[7, record()]]));

    expect(await invalidatePendingForOffDay(119, '2099-09-10')).toBe(1);

    expect(repo.setSessionStatusDirect).toHaveBeenCalledTimes(1);
    expect(repo.setSessionStatusDirect).toHaveBeenCalledWith(8, SESSION_STATUS.CANCELLED);
  });
});

describe('bulkCancelSessions', () => {
  it('closes the approval record of every booking it cancelled', async () => {
    writes.cancelAppointment.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('plugin')).mockResolvedValueOnce({});

    expect(await bulkCancelSessions([7, 8, 9], 'u_admin')).toBe(2);

    expect(approval.closeOnCancel.mock.calls).toEqual([
      [7, 'u_admin'],
      [9, 'u_admin'],
    ]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
npx vitest run tests/unit/approval/transition.test.ts
```

Expected: FAIL. Misalnya `approveAwaiting` tidak dipanggil, `holdForApproval` tidak dipanggil, `invalidatePendingForOffDay` mengembalikan 2.

- [ ] **Step 3: Ubah `src/services/session/session.service.ts`**

(a) Impor. Setelah baris `import { syncSessionReminders } from './reminder-schedule';` tambahkan:

```ts
import { APPROVAL_STATE, findApproval, findApprovals } from '@/services/approval/store';
import { requiresApproval } from '@/services/approval/settings';
import {
  approveAwaiting,
  closeOnCancel,
  completeApproval,
  holdForApproval,
  rejectAwaiting,
  withApprovals,
  type ApprovalView,
} from '@/services/approval/service';
```

(b) Tipe. Di `interface SessionWithRelations`, tambahkan setelah `clientEmail: string;`:

```ts
  /**
   * The psychologist-approval record, when this booking was paid for a psychologist who
   * approves their own bookings. Null for every other booking. See services/approval.
   */
  approval?: ApprovalView | null;
```

(c) `getSession` — ganti badannya menjadi:

```ts
export async function getSession(actor: Actor, id: number): Promise<SessionWithRelations> {
  const kc = await resolveKcActor(actor);
  const [session] = await withApprovals([toSession(await loadForActor(kc, id))]);
  return session;
}
```

(d) `listSessions` — ganti `data: items.map(toSession),` menjadi:

```ts
    data: await withApprovals(items.map(toSession)),
```

(e) `listPendingForProfessional` — ganti `return items.map(toSession);` menjadi:

```ts
  // The pending queue holds both unpaid bookings and paid ones waiting for approval;
  // `approval` is what tells them apart.
  return withApprovals(items.map(toSession));
```

(f) `TransitionArgs` dan `transitionSession` — ganti seluruh `export interface TransitionArgs { … }` dan `export async function transitionSession(…) { … }` dengan:

```ts
export interface TransitionArgs {
  actor: Actor;
  sessionId: number;
  target: SessionStatus;
  reason?: string;
  /**
   * Set by POST /sessions/:id/reject. For a paid booking that waits for its psychologist
   * a rejection is a decision with its own rules (who may, the client's mail, the refund);
   * a plain cancel of the same booking is not.
   */
  intent?: 'reject';
}

async function reread(sessionId: number): Promise<SessionWithRelations> {
  const updated = await findSessionById(sessionId);
  if (!updated) throw new SessionServiceError('not_found', 'Session not found', 404);
  const [session] = await withApprovals([toSession(updated)]);
  return session;
}

export async function transitionSession(args: TransitionArgs): Promise<SessionWithRelations> {
  const { actor, sessionId, target, reason, intent } = args;
  const kc = await resolveKcActor(actor);
  const row = await loadForActor(kc, sessionId);

  const isOwningProfessional =
    actor.role === 'PROFESSIONAL' && row.professionalId === Number(kc.wpUserId);
  const isAdmin = actor.role === 'SUPER_ADMIN' || actor.role === 'CLINIC_ADMIN';

  if (target === SESSION_STATUS.BOOKED && !isAdmin && !isOwningProfessional) {
    throw new SessionServiceError('forbidden', 'Not authorized to approve', 403);
  }
  if (
    (target === SESSION_STATUS.CHECK_IN || target === SESSION_STATUS.CHECK_OUT) &&
    !isAdmin &&
    actor.role !== 'RECEPTIONIST' &&
    !isOwningProfessional
  ) {
    throw new SessionServiceError('forbidden', 'Not authorized to change attendance', 403);
  }

  if (!canTransition(row.status, target)) {
    throw new SessionServiceError(
      'invalid_transition',
      `Cannot transition session from ${row.status} to ${target}`,
      400,
    );
  }

  // A PENDING booking may be paid and waiting for its psychologist (session_approvals).
  // Approving or rejecting it is a decision with its own rules — services/approval.
  const approval = row.status === SESSION_STATUS.PENDING ? await findApproval(sessionId) : null;

  if (approval?.state === APPROVAL_STATE.AWAITING && (target === SESSION_STATUS.BOOKED || intent === 'reject')) {
    if (!isAdmin && !isOwningProfessional) {
      throw new SessionServiceError('forbidden', 'Not authorized to decide this booking', 403);
    }
    if (target === SESSION_STATUS.BOOKED) await approveAwaiting({ actor, row, approval });
    else await rejectAwaiting({ actor, row, reason: reason ?? '' });
    return reread(sessionId);
  }

  if (approval?.state === APPROVAL_STATE.APPROVED && target === SESSION_STATUS.BOOKED) {
    // An earlier approval claimed the record but never reached the plugin.
    await completeApproval(approval);
    return reread(sessionId);
  }

  if (target === SESSION_STATUS.BOOKED && approval === null && (await requiresApproval(row.professionalId))) {
    // "Mark as paid" for a psychologist who approves their own bookings: the payment is
    // now known, so the booking joins their queue instead of skipping it.
    await holdForApproval({ row, paymentOrderId: null, actorId: actor.id });
    await logging.audit('session.marked_paid', {
      userId: actor.id,
      resource: 'session',
      resourceId: String(sessionId),
      action: 'session.marked_paid',
      metadata: { heldForApproval: true },
    });
    return reread(sessionId);
  }

  // Through the plugin, so KiviCare's cancellation email and telemed teardown fire.
  await setAppointmentStatus(sessionId, toKcStatus(target));

  // The reason has no column in wp_kc_appointments, so it lives here. The audit log is
  // app-native and stays, which is why collapsing REJECTED into CANCELLED does not lose
  // the "why".
  await logging.audit('session.status_changed', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(sessionId),
    action: 'session.status_changed',
    metadata: { from: row.status, to: target, reason: reason ?? null },
  });

  const updated = await findSessionById(sessionId);
  if (!updated) throw new SessionServiceError('not_found', 'Session not found', 404);

  // Persetujuan menjadwalkan, pembatalan membersihkan. Booking tamu lahir PENDING dan
  // lewat sini saat disetujui, jadi ia tidak butuh kail sendiri.
  await syncSessionReminders(updated);

  // A paid booking that waited for its psychologist and was cancelled instead: the money
  // is in, so it joins the refund list.
  if (target === SESSION_STATUS.CANCELLED && approval?.state === APPROVAL_STATE.AWAITING) {
    await closeOnCancel(sessionId, actor.id);
  }

  const [session] = await withApprovals([toSession(updated)]);
  return session;
}
```

(g) `invalidatePendingForOffDay` — ganti blok dari `const { items } = await listSessionRows({` sampai `return items.length;` dengan:

```ts
  const { items } = await listSessionRows({
    page: 1,
    perPage: 200,
    professionalId,
    date: slotDate,
    statuses: [SESSION_STATUS.PENDING],
  });

  // A PENDING booking with an approval record is PAID and waits for its psychologist.
  // Cancelling it here would drop money silently; it stays in the queue to be decided.
  const held = await findApprovals(items.map((s) => s.id));
  const unpaid = items.filter((s) => !held.has(s.id));

  for (const s of unpaid) {
    await setSessionStatusDirect(s.id, SESSION_STATUS.CANCELLED);
    await logging.audit('session.status_changed', {
      userId: null,
      resource: 'session',
      resourceId: String(s.id),
      action: 'session.status_changed',
      metadata: {
        from: SESSION_STATUS.PENDING,
        to: SESSION_STATUS.CANCELLED,
        reason: 'Professional unavailable (off-day updated)',
        system: true,
      },
    });
  }

  return unpaid.length;
```

(h) `bulkCancelSessions` — ganti seluruh fungsinya dengan:

```ts
export async function bulkCancelSessions(ids: number[], actorId: string | null = null): Promise<number> {
  let cancelled = 0;
  for (const id of ids) {
    try {
      await cancelAppointment(id);
      cancelled += 1;
    } catch {
      // Counted, not thrown — the returned number is the caller's signal.
      continue;
    }
    // A paid booking that waited for its psychologist now has money to return. A failure
    // here is logged, not thrown: the cancellation itself already happened.
    await closeOnCancel(id, actorId).catch((err) =>
      logging.error('bulk cancel: closing the approval record failed', err, {
        resource: 'session',
        resourceId: String(id),
      }),
    );
  }
  return cancelled;
}
```

- [ ] **Step 4: Ubah dua route**

`src/app/api/v1/sessions/[id]/reject/route.ts`: di panggilan `transitionSession({ … })`, tambahkan `intent: 'reject',` setelah baris `reason,`.

`src/app/api/v1/sessions/bulk/delete/route.ts`: ganti `const count = await bulkCancelSessions(parsed.data.ids);` menjadi:

```ts
    const count = await bulkCancelSessions(parsed.data.ids, actor.id);
```

- [ ] **Step 5: Beri `tests/unit/session/reminder-hooks.test.ts` blok mock "approval mati"**

Tempelkan blok mock "approval mati" (Global Constraints) tepat setelah blok `vi.mock('@/repositories/wp/appointments.repo', …)`. File ini me-mock repository satu per satu, dan tanpa blok itu `findApproval` akan membuka koneksi ke DB.

- [ ] **Step 6: Jalankan tes baru dan tes lama yang terdampak**

```bash
npx vitest run tests/unit/approval/transition.test.ts tests/unit/session/reminder-hooks.test.ts tests/complete-in-progress/sessions.test.ts tests/unit/access-scope/bulk-sessions-clients-scope.test.ts tests/integration/session/sessions-practice-filter.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`.

Kalau `bulk-sessions-clients-scope.test.ts` gagal dengan error `sessionApproval`/`professionalApprovalSetting` dari mock `@/lib/db`, tempelkan blok mock "approval mati" di bawah `vi.mock('@/lib/db', …)` pada file itu.

Kalau ada ekspektasi `toEqual` atas objek sesi yang gagal hanya karena field `approval: null` yang baru, tambahkan `approval: null` ke objek yang diharapkan. **Jangan** melonggarkan ke `toMatchObject`.

- [ ] **Step 7: Commit**

```bash
git add src/services/session/session.service.ts "src/app/api/v1/sessions/[id]/reject/route.ts" src/app/api/v1/sessions/bulk/delete/route.ts tests/unit/approval/transition.test.ts tests/unit/session/reminder-hooks.test.ts
git status --short
```

Kalau Step 6 mengubah file tes lain, `git add` juga file itu. Lalu:

```bash
git commit -m "$(cat <<'EOF'
feat(approval): approve/reject/cancel memahami booking yang menunggu psikolog

Booking AWAITING: /approve dan /reject menjadi keputusan psikolog (hanya
psikolognya atau admin). "Tandai lunas" untuk psikolog bersaklar memasukkan
booking ke antrean. Batal dan batal massal menutup catatan ke daftar refund.
Hari libur baru tidak lagi membatalkan booking yang sudah dibayar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task B6: Jalur pembayaran dan publik

**Files:**
- Modify: `src/services/approval/service.ts` (tambah `publicApprovalFor`)
- Modify: `src/services/payments/payment.service.ts`
- Modify: `src/services/public/unpaid-booking.ts`
- Modify: `src/services/public/public-booking.service.ts`
- Modify: `src/services/public/public-catalog.service.ts`
- Modify (tes lama): `tests/payments/orchestration.test.ts`, `tests/unit/public/unpaid-booking.test.ts`, `tests/public-booking/cancel.test.ts`
- Test: `tests/integration/approval/public-requires-approval.test.ts`

**Interfaces:**
- Consumes: `findApproval`, `APPROVAL_STATE` (B1); `requiresApproval`, `professionalsRequiringApproval` (B1); `holdForApproval`, `completeApproval`, `closeOnCancel`, `publicApprovalView`, `PublicApprovalView` (B3).
- Produces:
  - `publicApprovalFor(appointmentId: number, now?: Date): Promise<PublicApprovalView | null>` di `service.ts`
  - `PaymentStatusView.approval?: PublicApprovalView | null` (diisi oleh `checkPublicPaymentStatus`)
  - `PublicAppointmentView.approval: PublicApprovalView | null`
  - `PublicProfessional.requiresApproval: boolean`

- [ ] **Step 1: Pasang mock approval yang bisa dikendalikan di tiga file tes lama**

(a) `tests/payments/orchestration.test.ts` — tepat setelah blok `vi.mock('@/lib/logging', () => logging);` tambahkan:

```ts
// Psychologist approval (spec 2026-10-19). Off by default; the describe blocks at the end
// of this file switch it on.
const approval = vi.hoisted(() => ({
  findApproval: vi.fn(),
  requiresApproval: vi.fn(),
  holdForApproval: vi.fn(),
  completeApproval: vi.fn(),
  publicApprovalFor: vi.fn(),
}));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => approval.findApproval(...a),
  findApprovals: async () => new Map(),
  claimDecision: async () => false,
}));
vi.mock('@/services/approval/settings', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/settings')>()),
  requiresApproval: (...a: unknown[]) => approval.requiresApproval(...a),
}));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  holdForApproval: (...a: unknown[]) => approval.holdForApproval(...a),
  completeApproval: (...a: unknown[]) => approval.completeApproval(...a),
  publicApprovalFor: (...a: unknown[]) => approval.publicApprovalFor(...a),
}));
```

Di `beforeEach` tingkat atas file itu, tepat setelah `vi.clearAllMocks();`, tambahkan:

```ts
  approval.findApproval.mockResolvedValue(null);
  approval.requiresApproval.mockResolvedValue(false);
  approval.holdForApproval.mockResolvedValue(true);
  approval.completeApproval.mockResolvedValue(undefined);
  approval.publicApprovalFor.mockResolvedValue(null);
```

Tambahkan `cancelIfStillPending` ke daftar impor dari `@/services/payments/payment.service` di file yang sama.

(b) `tests/unit/public/unpaid-booking.test.ts` — tepat setelah `vi.mock('@/lib/logging', () => log);` tambahkan:

```ts
const approvalStore = vi.hoisted(() => ({ findApproval: vi.fn() }));
vi.mock('@/services/approval/store', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/store')>()),
  findApproval: (...a: unknown[]) => approvalStore.findApproval(...a),
}));
```

dan di `beforeEach` tingkat atas, setelah `db.orders.length = 0;`:

```ts
  approvalStore.findApproval.mockReset().mockResolvedValue(null);
```

(c) `tests/public-booking/cancel.test.ts` — tepat setelah blok `vi.mock('@/lib/logging', …)` tambahkan:

```ts
const approval = vi.hoisted(() => ({ closeOnCancel: vi.fn(), publicApprovalView: vi.fn() }));
vi.mock('@/services/approval/service', async (orig) => ({
  ...(await orig<typeof import('@/services/approval/service')>()),
  closeOnCancel: (...a: unknown[]) => approval.closeOnCancel(...a),
  publicApprovalView: (...a: unknown[]) => approval.publicApprovalView(...a),
}));
```

Setelah baris-baris `import` di file itu, tambahkan `beforeEach` tingkat atas (impor `beforeEach` sudah ada):

```ts
beforeEach(() => {
  approval.closeOnCancel.mockReset().mockResolvedValue(false);
  approval.publicApprovalView.mockReset().mockResolvedValue(null);
});
```

Di tes `'maps a row to the public view'`, tambahkan `approval: null,` tepat setelah `usd: null,` pada objek `toEqual`.

- [ ] **Step 2: Tulis tes baru (gagal)**

(a) Di akhir `tests/payments/orchestration.test.ts`:

```ts
describe('applyPaidSideEffectsPublic — psychologist approval', () => {
  const PAID = {
    id: 'po_1',
    source: 'public',
    status: 'paid',
    appointmentId: String(APPOINTMENT),
    wcOrderId: 42,
    gateway: 'xendit',
    transactionId: 'tx-1',
  } as never;

  it('a psychologist with the switch on: queued, not booked', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
    approval.requiresApproval.mockResolvedValue(true);

    await applyPaidSideEffectsPublic(PAID);

    expect(approval.holdForApproval).toHaveBeenCalledWith({ row: appointmentRow('PENDING'), paymentOrderId: 'po_1' });
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
    expect(jobsClient.jobs.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: 42 } });
  });

  it('already queued (a repeated webhook or poll): nothing happens', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
    approval.findApproval.mockResolvedValue({ state: 'AWAITING' });
    approval.requiresApproval.mockResolvedValue(true);

    await applyPaidSideEffectsPublic(PAID);

    expect(approval.holdForApproval).not.toHaveBeenCalled();
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('an approval that died before reaching the plugin is finished', async () => {
    const approved = { state: 'APPROVED', appointmentId: APPOINTMENT };
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
    approval.findApproval.mockResolvedValue(approved);

    await applyPaidSideEffectsPublic(PAID);

    expect(approval.completeApproval).toHaveBeenCalledWith(approved);
    expect(appointments.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('switch off: booked exactly as before', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));

    await applyPaidSideEffectsPublic(PAID);

    expect(appointments.setAppointmentStatus).toHaveBeenCalledWith(APPOINTMENT, 1, {
      gateway: 'xendit',
      wcOrderId: 42,
      transactionId: 'tx-1',
    });
    expect(approval.holdForApproval).not.toHaveBeenCalled();
  });
});

describe('cancelIfStillPending — psychologist approval', () => {
  const EXPIRED = { source: 'public', appointmentId: String(APPOINTMENT), wcOrderId: 41 } as never;

  it('never releases a booking that has an approval record', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
    approval.findApproval.mockResolvedValue({ state: 'AWAITING' });

    await cancelIfStillPending(EXPIRED);

    expect(appointments.cancelAppointment).not.toHaveBeenCalled();
  });

  it('still releases an unpaid one', async () => {
    sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));

    await cancelIfStillPending(EXPIRED);

    expect(appointments.cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
  });
});

describe('checkPublicPaymentStatus — psychologist approval', () => {
  it('carries the public approval view', async () => {
    const view = {
      state: 'AWAITING',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: null,
      refundStatus: 'NONE',
      isOverdue: false,
    };
    db.paymentOrder.findFirst.mockResolvedValue({
      id: 'po_1',
      source: 'public',
      status: 'paid',
      appointmentId: String(APPOINTMENT),
      wcOrderId: 42,
      expectedAmount: 100000,
      chargedAmount: null,
      chargedCurrency: 'IDR',
      gateway: 'xendit',
      transactionId: 'tx-1',
      createdAt: new Date(),
    });
    approval.publicApprovalFor.mockResolvedValue(view);

    const result = await checkPublicPaymentStatus(APPOINTMENT);

    expect(approval.publicApprovalFor).toHaveBeenCalledWith(APPOINTMENT);
    expect(result.approval).toEqual(view);
  });
});
```

(b) Di dalam `describe('handleUnpaidBookingCancel', …)` pada `tests/unit/public/unpaid-booking.test.ts`, tambahkan:

```ts
  it('leaves a booking that waits for its psychologist alone, even with no paid order', async () => {
    approvalStore.findApproval.mockResolvedValue({ state: 'AWAITING' });

    await handleUnpaidBookingCancel({ appointmentId: APPT });

    expect(write.cancelAppointment).not.toHaveBeenCalled();
    expect(log.logging.audit).toHaveBeenCalledWith(
      'booking.unpaid_cancel.skipped',
      expect.objectContaining({ metadata: { reason: 'approval' } }),
    );
  });
```

(c) Di akhir `tests/public-booking/cancel.test.ts`:

```ts
describe('psychologist approval', () => {
  it('the public view carries the approval state', async () => {
    const view = {
      state: 'AWAITING',
      requestedAt: '2026-10-20T02:00:00.000Z',
      decidedAt: null,
      refundStatus: 'NONE',
      isOverdue: false,
    };
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    approval.publicApprovalView.mockResolvedValue(view);

    expect((await getPublicAppointmentById(APPOINTMENT))?.approval).toEqual(view);
  });

  it('a client cancelling a booking that waits for approval puts it on the refund list', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));

    await cancelPublicAppointment(APPOINTMENT);

    expect(approval.closeOnCancel).toHaveBeenCalledWith(APPOINTMENT, null);
  });
});
```

(d) Tes integrasi katalog publik, `tests/integration/approval/public-requires-approval.test.ts`:

```ts
/**
 * The public directory and personal-link lookup say whether a professional approves their
 * own bookings, so the booking page can tell the client before they pay (spec §7.5).
 * Against the test database: the switch lives in an app table, the professional in wp_*.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { getPublicProfessional, listPublicProfessionals } from '@/services/public/public-catalog.service';
import { setApprovalSetting } from '@/services/approval/settings';

const BASE = 8_860_000;
const END = BASE + 10_000;
const CLINIC = BASE + 1;
const DOCTOR = BASE + 20;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function wipe() {
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Uji', 'klinik@public-approval.test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    CLINIC,
  );
  await prisma.kcUser.create({
    data: {
      id: BigInt(DOCTOR),
      userLogin: `u${DOCTOR}`,
      userEmail: `u${DOCTOR}@public-approval.test.local`,
      displayName: 'Dianda Uji',
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(DOCTOR), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') },
      { userId: BigInt(DOCTOR), metaKey: 'first_name', metaValue: 'Dianda' },
      { userId: BigInt(DOCTOR), metaKey: 'last_name', metaValue: 'Uji' },
      { userId: BigInt(DOCTOR), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
    BASE + 900,
    DOCTOR,
    CLINIC,
  );
});

afterAll(async () => {
  await wipe();
});

describe('requiresApproval on the public professional', () => {
  it('is false until the switch is turned on, then true — single lookup and directory', async () => {
    expect((await getPublicProfessional(DOCTOR))?.requiresApproval).toBe(false);

    await setApprovalSetting(DOCTOR, true, 'public-approval-test');

    expect((await getPublicProfessional(DOCTOR))?.requiresApproval).toBe(true);
    const listed = (await listPublicProfessionals({ clinicId: CLINIC })).find((p) => p.id === DOCTOR);
    expect(listed?.requiresApproval).toBe(true);
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
npx vitest run tests/payments/orchestration.test.ts tests/unit/public/unpaid-booking.test.ts tests/public-booking/cancel.test.ts tests/integration/approval/public-requires-approval.test.ts
```

Expected: hanya tes baru yang FAIL. Misalnya `holdForApproval` tidak dipanggil, `cancelAppointment` dipanggil untuk booking yang punya catatan approval, `approval` undefined, dan `requiresApproval` undefined. Tes lama tetap PASS (kecuali `toEqual` view publik yang sudah diberi `approval: null` di Step 1, yang gagal sampai Step 4).

- [ ] **Step 4: Implementasi**

(a) `src/services/approval/service.ts` — tambahkan tepat setelah fungsi `publicApprovalView`:

```ts
/**
 * publicApprovalView by appointment id, for callers that hold no session row. Reads the
 * session only when there is a record, so a booking without approval costs one query.
 */
export async function publicApprovalFor(
  appointmentId: number,
  now: Date = new Date(),
): Promise<PublicApprovalView | null> {
  const a = await store.findApproval(appointmentId);
  if (!a) return null;
  const row = await findSessionById(appointmentId);
  return {
    state: a.state,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    refundStatus: a.refundStatus,
    isOverdue: row ? overdue(a, row, now) : false,
  };
}
```

(b) `src/services/payments/payment.service.ts`:

Impor — tepat setelah `import { syncSessionReminders } from '@/services/session/reminder-schedule';`:

```ts
import { APPROVAL_STATE, findApproval } from '@/services/approval/store';
import { requiresApproval } from '@/services/approval/settings';
import {
  completeApproval,
  holdForApproval,
  publicApprovalFor,
  type PublicApprovalView,
} from '@/services/approval/service';
```

`PaymentStatusView` — tambahkan field terakhir:

```ts
  /**
   * Public bookings only: the psychologist-approval state when the booking waits for (or
   * was decided by) its psychologist. Null otherwise; absent on staff bill payments.
   */
  approval?: PublicApprovalView | null;
```

`applyPaidSideEffectsPublic` — tepat setelah baris `if (!appt || appt.status !== SESSION_STATUS.PENDING) return;` sisipkan:

```ts
  // A psychologist who approves their own bookings (spec 2026-10-19): the booking stays
  // PENDING — slot held, no confirmation yet — and joins their queue instead of being
  // booked here. A record that already exists means a repeated webhook or poll; an
  // APPROVED one on a PENDING booking is an approval that died before the plugin.
  const approval = await findApproval(appt.id);
  if (approval) {
    if (approval.state === APPROVAL_STATE.APPROVED) await completeApproval(approval);
    return;
  }
  if (await requiresApproval(appt.professionalId)) {
    await jobs.cancel({ hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: order.wcOrderId } });
    await holdForApproval({ row: appt, paymentOrderId: order.id });
    return;
  }
```

`cancelIfStillPending` — ganti:

```ts
    if (appt && appt.status === SESSION_STATUS.PENDING) {
```

menjadi:

```ts
    // A booking with an approval record is PAID and waits for its psychologist — paid
    // through another order of the same booking, or marked paid by staff. An older order
    // expiring must not release it.
    if (appt && appt.status === SESSION_STATUS.PENDING && !(await findApproval(appt.id))) {
```

`checkPublicPaymentStatus` — ganti objek yang dikembalikan menjadi:

```ts
  return {
    status: reconciled.status as PaymentStatus,
    expectedAmount: reconciled.expectedAmount,
    ...chargedView(reconciled),
    // Paid but waiting for the psychologist: the FE says so instead of "confirmed".
    approval: await publicApprovalFor(appointmentId),
  };
```

(c) `src/services/public/unpaid-booking.ts`:

Impor — tambahkan setelah `import type { PaymentStatus } from '@/services/payments/payment.service';`:

```ts
import { findApproval } from '@/services/approval/store';
```

Di `handleUnpaidBookingCancel`, tepat setelah blok `if (row.status !== SESSION_STATUS.PENDING) { … return; }`, sisipkan:

```ts
  // A booking with an approval record is paid and waits for its psychologist. One marked
  // paid by staff has no `paid` order, so the order check below would not protect it.
  if (await findApproval(appointmentId)) {
    await logging.audit(`${UNPAID_CANCEL_EVENT}.skipped`, {
      resource: 'appointment',
      resourceId,
      metadata: { reason: 'approval' },
    });
    return;
  }
```

(d) `src/services/public/public-booking.service.ts`:

Impor — tambahkan di antara impor lain:

```ts
import { closeOnCancel, publicApprovalView, type PublicApprovalView } from '@/services/approval/service';
```

`interface PublicAppointmentView` — tambahkan field terakhir setelah `usd: PublicUsdView | null;`:

```ts
  /** The psychologist-approval state, when this booking waits for (or was decided by) its psychologist. */
  approval: PublicApprovalView | null;
```

`toView` — tambahkan `approval: await publicApprovalView(row),` tepat setelah `usd,` di objek yang dikembalikan.

`cancelPublicAppointment` — tepat setelah `await cancelAppointment(id);` sisipkan:

```ts
  // A paid booking that waited for its psychologist: the client withdrew and the money is
  // in, so it joins the refund list for the clinic to settle.
  await closeOnCancel(id, null);
```

(e) `src/services/public/public-catalog.service.ts`:

Impor — tambahkan:

```ts
import { professionalsRequiringApproval, requiresApproval } from '@/services/approval/settings';
```

`interface PublicProfessional` — tambahkan field terakhir setelah `nextAvailable: …;`:

```ts
  /**
   * Paid bookings with this professional wait for their approval (psychologist approval,
   * spec 2026-10-19). The booking page tells the client before they pay.
   */
  requiresApproval: boolean;
```

`toPublicProfessional` — tambahkan parameter keempat `requiresApproval: boolean` dan field `requiresApproval,` di objek yang dikembalikan (setelah `nextAvailable: …,`).

`listPublicProfessionals` — ganti dua baris terakhirnya:

```ts
  const today = new Date();
  return doctors.map((d) => toPublicProfessional(d, byDoctor.get(d.id.toString()) ?? [], today));
```

menjadi:

```ts
  // One query for the whole directory, like the clinic sessions above.
  const needApproval = await professionalsRequiringApproval(doctors.map((d) => Number(d.id)));

  const today = new Date();
  return doctors.map((d) =>
    toPublicProfessional(d, byDoctor.get(d.id.toString()) ?? [], today, needApproval.has(Number(d.id))),
  );
```

`getPublicProfessional` — ganti `return toPublicProfessional(doctor, sessions, new Date());` menjadi:

```ts
  return toPublicProfessional(doctor, sessions, new Date(), await requiresApproval(Number(doctor.id)));
```

- [ ] **Step 5: Jalankan tes yang disentuh dan tes lama yang terdampak**

```bash
npx vitest run tests/payments/orchestration.test.ts tests/unit/public/unpaid-booking.test.ts tests/public-booking/cancel.test.ts tests/integration/approval/public-requires-approval.test.ts
npx vitest run tests/payments tests/public-booking tests/unit/public tests/integration/booking tests/integration/public tests/unit/practice/clinic-names.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`. Untuk tes lama yang sekarang gagal, berlaku aturan berikut:
- Pesan `Cannot read properties of undefined` dari `sessionApproval` atau `professionalApprovalSetting`, di file yang me-mock `@/lib/db`: tempelkan **blok mock "approval mati"** di bawah `vi.mock('@/lib/db', …)`.
- File yang me-mock `@/repositories/wp/sessions.repo` dan gagal karena tidak ada koneksi DB: tempelkan blok yang sama di bawah mock itu.
- `toEqual` yang gagal hanya karena field baru: tambahkan `approval: null` (view janji temu publik, status pembayaran publik) atau `requiresApproval: false` (profesional publik) ke objek yang diharapkan. Jangan menggantinya dengan `toMatchObject`.

- [ ] **Step 6: Commit**

```bash
git add src/services/approval/service.ts src/services/payments/payment.service.ts src/services/public/unpaid-booking.ts src/services/public/public-booking.service.ts src/services/public/public-catalog.service.ts tests/payments/orchestration.test.ts tests/unit/public/unpaid-booking.test.ts tests/public-booking/cancel.test.ts tests/integration/approval/public-requires-approval.test.ts
git status --short
```

Kalau Step 5 mengubah file tes lain, `git add` juga file itu. Lalu:

```bash
git commit -m "$(cat <<'EOF'
feat(approval): pembayaran lunas masuk antrean psikolog

Untuk psikolog bersaklar, pembayaran yang masuk memasukkan booking ke
antrean alih-alih mem-BOOKED-kannya. Order kedaluwarsa, job booking tak
dibayar, dan pembatalan oleh klien tidak lagi bisa menjatuhkan booking
yang sudah dibayar diam-diam. Status pembayaran publik, view janji temu
publik, dan katalog psikolog membawa info approval.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: Antrean dan route baru

**Files:**
- Modify: `src/repositories/wp/sessions.repo.ts` (tambah `listSessionsByIds`)
- Modify: `src/services/approval/service.ts` (tambah antrean, satu item, view saklar)
- Create: `src/services/approval/http.ts`
- Create: `src/app/api/v1/sessions/approvals/route.ts`
- Create: `src/app/api/v1/sessions/[id]/approval/route.ts`
- Create: `src/app/api/v1/sessions/[id]/refund-done/route.ts`
- Create: `src/app/api/v1/professionals/[id]/approval-setting/route.ts`
- Test: `tests/integration/approval/approval-routes.test.ts`

**Interfaces:**
- Consumes: semua dari B1–B5; `scopeFor`, `canEdit`, `parseProfessionalId`, `invalidIdResponse` (`route-scope.ts`).
- Produces (kontrak HTTP yang dipakai FE, Bagian F):
  - `GET /api/v1/sessions/approvals?state=AWAITING|REFUND_NEEDED|REFUNDED|DECIDED&professionalId=&clinicId=&page=&limit=` → `{ data: ApprovalQueueItem[], pagination: { currentPage, totalPages, totalItems, itemsPerPage }, counts: { awaiting, refundNeeded } }`. Ini **tidak** dibuka `PraktiquApi::unwrap` karena kuncinya lebih dari satu.
  - `GET /api/v1/sessions/{id}/approval` → `{ data: ApprovalQueueItem }`
  - `POST /api/v1/sessions/{id}/refund-done` body `{ note?: string ≤ 500 }` → `{ data: ApprovalView }`
  - `GET|PUT /api/v1/professionals/{id}/approval-setting` (PUT body `{ requiresApproval: boolean }`) → `{ data: { professionalId, requiresApproval, updatedAt, updatedByName } }`
  - `ApprovalQueueItem = SessionRow & { serviceName: string; approval: ApprovalView }`

- [ ] **Step 1: Tulis tes integrasi (gagal)**

`tests/integration/approval/approval-routes.test.ts`:

```ts
/**
 * The approval routes end to end against the test database (spec §7.3, §7.4).
 *
 * The plugin is the one boundary mocked: setAppointmentStatus writes the status straight
 * into wp_kc_appointments, as the plugin's UPDATE would. Jobs and email are mocked so
 * nothing leaves the machine. The tests in this file run in order and build on each
 * other's state (vitest runs the tests of one file sequentially).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';

const writes = vi.hoisted(() => ({ setAppointmentStatus: vi.fn(), cancelAppointment: vi.fn() }));
vi.mock('@/repositories/wp/appointments.write', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/appointments.write')>()),
  setAppointmentStatus: (...a: unknown[]) => writes.setAppointmentStatus(...a),
  cancelAppointment: (...a: unknown[]) => writes.cancelAppointment(...a),
}));

const jobsClient = vi.hoisted(() => ({ enqueue: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/jobs/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/jobs/client')>()),
  jobs: { enqueue: (...a: unknown[]) => jobsClient.enqueue(...a), cancel: (...a: unknown[]) => jobsClient.cancel(...a) },
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

import { GET as queueGet } from '@/app/api/v1/sessions/approvals/route';
import { GET as itemGet } from '@/app/api/v1/sessions/[id]/approval/route';
import { POST as refundPost } from '@/app/api/v1/sessions/[id]/refund-done/route';
import { POST as approvePost } from '@/app/api/v1/sessions/[id]/approve/route';
import { POST as rejectPost } from '@/app/api/v1/sessions/[id]/reject/route';
import { GET as settingGet, PUT as settingPut } from '@/app/api/v1/professionals/[id]/approval-setting/route';

const BASE = 8_870_000;
const END = BASE + 10_000;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const DOCTOR = BASE + 20;
const OTHER_DOCTOR = BASE + 21;
const PATIENT = BASE + 30;
const ADMIN_WP = BASE + 40;
const SUPER_WP = BASE + 41;
const APPT_AWAITING = BASE + 100; // DOCTOR, CLINIC_1, paid, waiting
const APPT_OTHER = BASE + 101; // OTHER_DOCTOR, CLINIC_2, paid, waiting
const APPT_REJECTED = BASE + 102; // DOCTOR, CLINIC_1, rejected, refund needed
const APPT_PLAIN = BASE + 103; // DOCTOR, CLINIC_1, unpaid, no record
const WC_ORDER = BASE + 500;

const PSI = 'approval-routes-test-psi';
const OTHER_PSI = 'approval-routes-test-other';
const ADMIN = 'approval-routes-test-admin';
const SUPER = 'approval-routes-test-super';
const RESEPSIONIS = 'approval-routes-test-resepsionis';

const DATE = `${new Date().getUTCFullYear() + 1}-03-10`;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function req(sub: string, role: string, path: string, body?: unknown, method?: string) {
  return new NextRequest(`http://localhost/api/v1${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
}
const sessionCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const professionalCtx = (id: number) => ({ params: { id: String(id) } }) as never;
const ours = (data: Array<{ id: number }>) => data.map((d) => d.id).filter((id) => id >= BASE && id < END);

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: {
      id: BigInt(id),
      userLogin: `u${id}`,
      userEmail: `u${id}@approval-routes.test.local`,
      displayName: `${first} Uji`,
      userRegistered: new Date(),
    },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: 'Uji' },
      { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
}

async function authUser(id: string, role: string, wpUserId: number | null, first: string) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      username: id,
      firstName: first,
      lastName: 'Uji',
      displayName: first,
      role: role as never,
      wpUserId: wpUserId === null ? null : BigInt(wpUserId),
      status: 1,
    },
  });
}

async function appointment(id: number, clinic: number, doctor: number, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
    id,
    clinic,
    doctor,
    PATIENT,
    DATE,
    DATE,
    status,
  );
}

async function wipe() {
  const ids = [APPT_AWAITING, APPT_OTHER, APPT_REJECTED, APPT_PLAIN, DOCTOR, OTHER_DOCTOR].map(String);
  await prisma.logEntry.deleteMany({ where: { resourceId: { in: ids } } });
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.professionalApprovalSetting.deleteMany({ where: { doctorWpUserId: inRange } });
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'approval-routes-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  for (const [id, admin] of [[CLINIC_1, ADMIN_WP], [CLINIC_2, 0]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
      id,
      `Klinik ${id}`,
      `k${id}@approval-routes.test.local`,
      admin,
    );
  }
  await wpUser(DOCTOR, 'kiviCare_doctor', 'Dianda');
  await wpUser(OTHER_DOCTOR, 'kiviCare_doctor', 'Pamela');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  await wpUser(ADMIN_WP, 'kiviCare_clinic_admin', 'Rina');
  for (const [mapId, doctor, clinic] of [[BASE + 900, DOCTOR, CLINIC_1], [BASE + 901, OTHER_DOCTOR, CLINIC_2]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
      mapId,
      doctor,
      clinic,
    );
  }
  await authUser(PSI, 'PROFESSIONAL', DOCTOR, 'Dianda');
  await authUser(OTHER_PSI, 'PROFESSIONAL', OTHER_DOCTOR, 'Pamela');
  await authUser(ADMIN, 'CLINIC_ADMIN', ADMIN_WP, 'Rina');
  await authUser(SUPER, 'SUPER_ADMIN', SUPER_WP, 'Super');
  await authUser(RESEPSIONIS, 'RECEPTIONIST', null, 'Resepsionis');

  await appointment(APPT_AWAITING, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.PENDING);
  await appointment(APPT_OTHER, CLINIC_2, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING);
  await appointment(APPT_REJECTED, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.CANCELLED);
  await appointment(APPT_PLAIN, CLINIC_1, DOCTOR, APPOINTMENT_STATUS.PENDING);

  const order = await prisma.paymentOrder.create({
    data: {
      source: 'public',
      appointmentId: String(APPT_AWAITING),
      wcOrderId: WC_ORDER,
      expectedAmount: 350000,
      status: 'paid',
      gateway: 'xendit',
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
      transactionId: 'tx-uji',
    },
  });
  await prisma.sessionApproval.createMany({
    data: [
      { appointmentId: BigInt(APPT_AWAITING), doctorWpUserId: BigInt(DOCTOR), clinicId: BigInt(CLINIC_1), paymentOrderId: order.id, state: 'AWAITING' },
      { appointmentId: BigInt(APPT_OTHER), doctorWpUserId: BigInt(OTHER_DOCTOR), clinicId: BigInt(CLINIC_2), paymentOrderId: null, state: 'AWAITING' },
      {
        appointmentId: BigInt(APPT_REJECTED),
        doctorWpUserId: BigInt(DOCTOR),
        clinicId: BigInt(CLINIC_1),
        paymentOrderId: null,
        state: 'REJECTED',
        decidedAt: new Date(),
        decidedBy: PSI,
        rejectReason: 'Jadwal bentrok',
        refundStatus: 'NEEDED',
      },
    ],
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.setAppointmentStatus.mockImplementation(async (id: number, status: number) => {
    await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
    return { id, status, cancelled: status === 0 };
  });
  writes.cancelAppointment.mockResolvedValue({ id: 0, status: 0, cancelled: true });
  jobsClient.enqueue.mockResolvedValue(undefined);
  jobsClient.cancel.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
});

describe('GET /sessions/approvals', () => {
  it('a psychologist sees only their own queue, with counts and the payment', async () => {
    const res = await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(ours(body.data)).toEqual([APPT_AWAITING]);
    expect(body.counts).toEqual({ awaiting: 1, refundNeeded: 1 });
    expect(body.data[0]).toMatchObject({
      id: APPT_AWAITING,
      clientName: 'Klien Uji',
      professionalName: 'Dianda Uji',
      serviceName: 'Sesi',
      approval: { state: 'AWAITING', refundStatus: 'NONE', payment: { gateway: 'xendit', wcOrderId: WC_ORDER } },
    });
  });

  it('a clinic admin sees their clinic; asking for another clinic gets an empty page', async () => {
    const own = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', '/sessions/approvals'))).json();
    expect(ours(own.data)).toEqual([APPT_AWAITING]);

    const other = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', `/sessions/approvals?clinicId=${CLINIC_2}`))).json();
    expect(other.data).toEqual([]);
    expect(other.counts).toEqual({ awaiting: 0, refundNeeded: 0 });
  });

  it('a super admin narrows by clinic', async () => {
    const body = await (await queueGet(await req(SUPER, 'SUPER_ADMIN', `/sessions/approvals?clinicId=${CLINIC_2}`))).json();
    expect(ours(body.data)).toEqual([APPT_OTHER]);
  });

  it('REFUND_NEEDED carries the internal reason for staff', async () => {
    const body = await (await queueGet(await req(ADMIN, 'CLINIC_ADMIN', '/sessions/approvals?state=REFUND_NEEDED'))).json();
    expect(ours(body.data)).toEqual([APPT_REJECTED]);
    expect(body.data[0].approval).toMatchObject({ state: 'REJECTED', refundStatus: 'NEEDED', rejectReason: 'Jadwal bentrok', decidedByName: 'Dianda Uji' });
  });

  it('a receptionist is refused; an unknown state is a 422', async () => {
    expect((await queueGet(await req(RESEPSIONIS, 'RECEPTIONIST', '/sessions/approvals'))).status).toBe(403);
    expect((await queueGet(await req(PSI, 'PROFESSIONAL', '/sessions/approvals?state=NOPE'))).status).toBe(422);
  });
});

describe('GET /sessions/:id/approval', () => {
  it('the psychologist reads their own item', async () => {
    const res = await itemGet(await req(PSI, 'PROFESSIONAL', `/sessions/${APPT_AWAITING}/approval`), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ id: APPT_AWAITING, approval: { state: 'AWAITING', isOverdue: false } });
  });

  it("another psychologist gets 403; a session with no record gets 404", async () => {
    expect((await itemGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_AWAITING))).status).toBe(403);

    const res = await itemGet(await req(PSI, 'PROFESSIONAL', '/x'), sessionCtx(APPT_PLAIN));
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe('approval_not_found');
  });
});

describe('deciding', () => {
  it('another psychologist cannot approve', async () => {
    const res = await approvePost(await req(OTHER_PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(403);
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('its psychologist approves: booked with the payment, record APPROVED', async () => {
    const res = await approvePost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(writes.setAppointmentStatus).toHaveBeenCalledWith(APPT_AWAITING, 1, {
      gateway: 'xendit',
      wcOrderId: WC_ORDER,
      transactionId: 'tx-uji',
    });
    expect(body.data).toMatchObject({ status: 'BOOKED', approval: { state: 'APPROVED', decidedByName: 'Dianda Uji' } });
    expect(jobsClient.cancel).toHaveBeenCalledWith({ hook: 'praktiqu_approval_reminder', args: { appointmentId: APPT_AWAITING } });
  });

  it('approving again is refused by the transition rules', async () => {
    expect((await approvePost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_AWAITING))).status).toBe(400);
  });

  it('a super admin rejects for the psychologist: cancelled, refund needed, client mailed', async () => {
    const res = await rejectPost(
      await req(SUPER, 'SUPER_ADMIN', '/x', { reason: 'Psikolog cuti' }),
      sessionCtx(APPT_OTHER),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'CANCELLED', approval: { state: 'REJECTED', refundStatus: 'NEEDED' } });

    const rows = await prisma.$queryRawUnsafe<Array<{ status: number }>>(
      'SELECT status FROM wp_kc_appointments WHERE id = ?',
      APPT_OTHER,
    );
    expect(Number(rows[0].status)).toBe(APPOINTMENT_STATUS.CANCELLED);
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: `u${PATIENT}@approval-routes.test.local` }));
  });
});

describe('POST /sessions/:id/refund-done', () => {
  it('a psychologist cannot mark a refund', async () => {
    expect((await refundPost(await req(PSI, 'PROFESSIONAL', '/x', {}), sessionCtx(APPT_REJECTED))).status).toBe(403);
  });

  it('the clinic admin marks it, once', async () => {
    const res = await refundPost(await req(ADMIN, 'CLINIC_ADMIN', '/x', { note: 'Transfer BCA 21/10' }), sessionCtx(APPT_REJECTED));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ refundStatus: 'DONE', refundNote: 'Transfer BCA 21/10', refundedByName: 'Rina Uji' });

    const again = await refundPost(await req(ADMIN, 'CLINIC_ADMIN', '/x', {}), sessionCtx(APPT_REJECTED));
    expect(again.status).toBe(409);
  });
});

describe('GET|PUT /professionals/:id/approval-setting', () => {
  it('the psychologist reads and switches on their own', async () => {
    const before = await settingGet(await req(PSI, 'PROFESSIONAL', '/x'), professionalCtx(DOCTOR));
    expect(before.status).toBe(200);
    expect((await before.json()).data).toEqual({ professionalId: DOCTOR, requiresApproval: false, updatedAt: null, updatedByName: null });

    const res = await settingPut(await req(PSI, 'PROFESSIONAL', '/x', { requiresApproval: true }, 'PUT'), professionalCtx(DOCTOR));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ professionalId: DOCTOR, requiresApproval: true, updatedByName: 'Dianda Uji' });

    const audit = await prisma.logEntry.findFirst({
      where: { action: 'professional.approval_setting_changed', resourceId: String(DOCTOR) },
    });
    expect(audit).not.toBeNull();
  });

  it('another psychologist may not', async () => {
    expect((await settingGet(await req(OTHER_PSI, 'PROFESSIONAL', '/x'), professionalCtx(DOCTOR))).status).toBe(403);
  });

  it("the clinic admin may for their clinic's psychologist only", async () => {
    expect((await settingGet(await req(ADMIN, 'CLINIC_ADMIN', '/x'), professionalCtx(DOCTOR))).status).toBe(200);
    expect((await settingGet(await req(ADMIN, 'CLINIC_ADMIN', '/x'), professionalCtx(OTHER_DOCTOR))).status).toBe(403);
  });

  it('an unknown professional is 404; a bad body is 422', async () => {
    expect((await settingGet(await req(SUPER, 'SUPER_ADMIN', '/x'), professionalCtx(BASE + 999))).status).toBe(404);
    const bad = await settingPut(await req(SUPER, 'SUPER_ADMIN', '/x', { requiresApproval: 'ya' }, 'PUT'), professionalCtx(DOCTOR));
    expect(bad.status).toBe(422);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
npx vitest run tests/integration/approval/approval-routes.test.ts
```

Expected: FAIL, `Failed to resolve import "@/app/api/v1/sessions/approvals/route"`.

- [ ] **Step 3: `listSessionsByIds` di `src/repositories/wp/sessions.repo.ts`**

Tambahkan tepat setelah fungsi `findSessionById`:

```ts
/** The sessions with these ids, in no particular order. Ids that do not exist are absent. */
export async function listSessionsByIds(ids: number[]): Promise<SessionRow[]> {
  const wanted = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (wanted.length === 0) return [];
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `${SELECT_SQL} WHERE a.id IN (${wanted.map(() => '?').join(',')})`,
    ...wanted,
  );
  return rows.map(toSession);
}
```

- [ ] **Step 4: Antrean, satu item, dan view saklar di `src/services/approval/service.ts`**

(a) Tambahkan `listSessionsByIds` ke impor dari `@/repositories/wp/sessions.repo`, dan tambahkan impor:

```ts
import type { ApprovalSetting } from './settings';
```

(b) Tambahkan di akhir file:

```ts
/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export type ApprovalQueueItem = SessionRow & { serviceName: string; approval: ApprovalView };

export interface QueueQuery {
  filter: store.QueueFilter;
  professionalId?: number;
  clinicId?: number;
  page: number;
  limit: number;
}

export interface QueuePage {
  data: ApprovalQueueItem[];
  pagination: { currentPage: number; totalPages: number; totalItems: number; itemsPerPage: number };
  counts: { awaiting: number; refundNeeded: number };
}

/** Null: the actor may look, but at nothing (another clinic, or an admin with no clinic). */
async function queueScope(
  actor: Actor,
  q: Pick<QueueQuery, 'professionalId' | 'clinicId'>,
): Promise<store.QueueScope | null> {
  if (actor.role === 'PROFESSIONAL') {
    const kc = await resolveKcActor(actor);
    // A psychologist always sees their own queue, whatever the query asks for.
    return { doctorWpUserId: Number(kc.wpUserId) };
  }
  if (actor.role === 'CLINIC_ADMIN') {
    const kc = await resolveKcActor(actor);
    if (kc.clinicId === null) return null;
    const own = Number(kc.clinicId);
    // Asking for another clinic gets nothing rather than a 403, like GET /sessions.
    if (q.clinicId !== undefined && q.clinicId !== own) return null;
    return { clinicId: own, doctorWpUserId: q.professionalId };
  }
  if (actor.role === 'SUPER_ADMIN') {
    return { clinicId: q.clinicId, doctorWpUserId: q.professionalId };
  }
  throw new ApprovalError('forbidden', 'Not authorized to see the approval queue', 403);
}

async function toItems(records: store.ApprovalRecord[], now: Date): Promise<ApprovalQueueItem[]> {
  const rows = await listSessionsByIds(records.map((a) => a.appointmentId));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const views = await approvalViews(rows, now);
  const items: ApprovalQueueItem[] = [];
  for (const a of records) {
    const row = byId.get(a.appointmentId);
    const view = views.get(a.appointmentId);
    // A record whose appointment was deleted in KiviCare: nothing to show or decide.
    if (!row || !view) continue;
    items.push({ ...row, serviceName: await serviceNameOf(row), approval: view });
  }
  return items;
}

export async function listQueue(actor: Actor, q: QueueQuery, now: Date = new Date()): Promise<QueuePage> {
  const scope = await queueScope(actor, q);
  if (scope === null) {
    return {
      data: [],
      pagination: { currentPage: q.page, totalPages: 1, totalItems: 0, itemsPerPage: q.limit },
      counts: { awaiting: 0, refundNeeded: 0 },
    };
  }
  const { items, total } = await store.listApprovals(q.filter, scope, q.page, q.limit);
  const counts = await store.countApprovals(scope);
  return {
    data: await toItems(items, now),
    pagination: {
      currentPage: q.page,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      totalItems: total,
      itemsPerPage: q.limit,
    },
    counts,
  };
}

/** One item, same shape as the queue's, for the FE detail page. */
export async function getApprovalItem(
  actor: Actor,
  appointmentId: number,
  now: Date = new Date(),
): Promise<ApprovalQueueItem> {
  const row = await findSessionById(appointmentId);
  if (!row) throw new ApprovalError('not_found', 'Session not found', 404);

  if (actor.role !== 'SUPER_ADMIN') {
    const kc = await resolveKcActor(actor);
    const allowed =
      (actor.role === 'PROFESSIONAL' && row.professionalId === Number(kc.wpUserId)) ||
      (actor.role === 'CLINIC_ADMIN' && kc.clinicId !== null && Number(kc.clinicId) === row.clinicId);
    if (!allowed) throw new ApprovalError('forbidden', 'Not authorized', 403);
  }

  const record = await store.findApproval(appointmentId);
  if (!record) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  const [item] = await toItems([record], now);
  if (!item) throw new ApprovalError('approval_not_found', 'This session has no approval record', 404);
  return item;
}

export interface ApprovalSettingView {
  professionalId: number;
  requiresApproval: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export async function approvalSettingView(setting: ApprovalSetting): Promise<ApprovalSettingView> {
  const names = await store.userNames([setting.updatedBy]);
  return {
    professionalId: setting.professionalId,
    requiresApproval: setting.requiresApproval,
    updatedAt: iso(setting.updatedAt),
    updatedByName: setting.updatedBy ? (names.get(setting.updatedBy) ?? null) : null,
  };
}
```

- [ ] **Step 5: `src/services/approval/http.ts`**

```ts
/**
 * Error → HTTP answer for the approval routes, in the shapes the sessions/* routes use:
 * AuthError as the auth problem, zod as 422, anything carrying code + status (ApprovalError,
 * SessionServiceError, KcError) as its own problem, everything else 500.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError } from '@/lib/auth';
import { unauthorized } from '@/lib/problem-details';

export function approvalErrorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json(unauthorized('unauthorized', err.message), {
      status: err.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { type: '/errors/validation-error', title: 'Validation Error', status: 422, detail: err.message, errors: err.errors },
      { status: 422 },
    );
  }
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
    const e = err as { code: string; status: number; message: string };
    return NextResponse.json(
      { type: `/errors/${e.code}`, title: e.code, status: e.status, detail: e.message },
      { status: e.status },
    );
  }
  console.error(tag, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

- [ ] **Step 6: Empat route**

`src/app/api/v1/sessions/approvals/route.ts`:

```ts
/**
 * GET /api/v1/sessions/approvals — the psychologist-approval queue.
 *
 * Auth: PROFESSIONAL (own only), CLINIC_ADMIN (active clinic), SUPER_ADMIN (all, or ?clinicId=).
 * Answers { data, pagination, counts } — more than one key, so the Laravel FE's unwrap
 * leaves it whole and the badge counts survive.
 *
 * Spec: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md §7.3
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { listQueue } from '@/services/approval/service';
import { QUEUE_FILTERS, type QueueFilter } from '@/services/approval/store';

const querySchema = z.object({
  state: z
    .string()
    .default('AWAITING')
    .refine((s): s is QueueFilter => (QUEUE_FILTERS as readonly string[]).includes(s), 'Unknown state'),
  professionalId: z.coerce.number().int().positive().optional(),
  clinicId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const actor = await sessionActorFromRequest(req);
    const q = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const page = await listQueue(actor, {
      filter: q.state as QueueFilter,
      professionalId: q.professionalId,
      clinicId: q.clinicId,
      page: q.page,
      limit: q.limit,
    });
    return NextResponse.json(page, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[GET /sessions/approvals]');
  }
}
```

`src/app/api/v1/sessions/[id]/approval/route.ts`:

```ts
/**
 * GET /api/v1/sessions/:id/approval — one approval item, the queue's shape.
 *
 * Auth: the session's PROFESSIONAL, a CLINIC_ADMIN of its clinic, SUPER_ADMIN.
 * 404 approval_not_found for a session that never waited for approval.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { getApprovalItem } from '@/services/approval/service';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid session id', status: 400 },
        { status: 400 },
      );
    }
    const actor = await sessionActorFromRequest(req);
    return NextResponse.json({ data: await getApprovalItem(actor, id) }, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[GET /sessions/:id/approval]');
  }
}
```

`src/app/api/v1/sessions/[id]/refund-done/route.ts`:

```ts
/**
 * POST /api/v1/sessions/:id/refund-done — the clinic returned the money by hand.
 *
 * Auth: CLINIC_ADMIN of the session's clinic, SUPER_ADMIN. Body { note?: string ≤ 500 }.
 * 409 refund_not_needed when there is no refund outstanding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sessionActorFromRequest } from '@/lib/auth/session-actor';
import { approvalErrorResponse } from '@/services/approval/http';
import { markRefunded } from '@/services/approval/service';

const bodySchema = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { type: '/errors/validation-error', title: 'Invalid session id', status: 400 },
        { status: 400 },
      );
    }
    const actor = await sessionActorFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { note } = bodySchema.parse(body ?? {});
    const view = await markRefunded({ actor, appointmentId: id, note: note ? note : null });
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return approvalErrorResponse(err, '[POST /sessions/:id/refund-done]');
  }
}
```

`src/app/api/v1/professionals/[id]/approval-setting/route.ts`:

```ts
/**
 * GET /api/v1/professionals/:id/approval-setting — a psychologist's approval switch.
 * PUT — change it. Body { requiresApproval: boolean }.
 *
 * Reading needs the same right as changing (route-scope canEdit): the psychologist
 * themself, a CLINIC_ADMIN whose active clinic maps them, SUPER_ADMIN. `id` is the
 * wp_users.ID, the same `professionalId` the session responses carry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, type Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { forbidden, notFound } from '@/lib/problem-details';
import { getApprovalSetting, setApprovalSetting } from '@/services/approval/settings';
import { approvalSettingView } from '@/services/approval/service';
import { canEdit, invalidIdResponse, parseProfessionalId, scopeFor } from '@/services/professional/route-scope';

type RouteParams = { params: { id: string } };

const bodySchema = z.object({ requiresApproval: z.boolean() }).strict();

async function guard(actor: Actor, rawId: string): Promise<{ id: number } | { response: NextResponse }> {
  const id = parseProfessionalId(rawId);
  if (id === null) return { response: invalidIdResponse() };
  const scope = await scopeFor(actor, id);
  if (!scope) {
    return { response: NextResponse.json(notFound('professional_not_found', 'Professional not found'), { status: 404 }) };
  }
  if (!canEdit(scope, actor.role)) {
    return {
      response: NextResponse.json(forbidden('forbidden', "Cannot see or change this professional's approval setting"), {
        status: 403,
      }),
    };
  }
  return { id };
}

export const GET = withAuth(async (_req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const g = await guard(actor, ctx.params.id);
  if ('response' in g) return g.response;

  return NextResponse.json({ data: await approvalSettingView(await getApprovalSetting(g.id)) });
});

export const PUT = withAuth(async (req: NextRequest, ctx: RouteParams) => {
  const { actor } = ctx as { actor: Actor; params: RouteParams['params'] };
  const g = await guard(actor, ctx.params.id);
  if ('response' in g) return g.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        detail: parsed.error.issues[0]?.message ?? 'Body must be { requiresApproval: boolean }',
      },
      { status: 422 },
    );
  }

  const { before, after } = await setApprovalSetting(g.id, parsed.data.requiresApproval, actor.id);
  await logging.audit('professional.approval_setting_changed', {
    userId: actor.id,
    resource: 'professional',
    resourceId: String(g.id),
    action: 'professional.approval_setting_changed',
    metadata: { from: before, to: after.requiresApproval },
  });

  return NextResponse.json({ data: await approvalSettingView(after) });
});
```

- [ ] **Step 7: Jalankan tes dan typecheck**

```bash
npx vitest run tests/integration/approval/approval-routes.test.ts tests/unit/approval tests/integration/approval
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS; typecheck `0`.

Kalau typecheck menolak `withAuth(async (_req: NextRequest, ctx: RouteParams) => …)`, salin persis bentuk yang dipakai `src/app/api/v1/professionals/[id]/route.ts`: rute itu lolos typecheck dengan pola yang sama.

Kalau tes `'its psychologist approves'` mendapati `body.data.status` masih `PENDING`, pastikan `writes.setAppointmentStatus.mockImplementation` di `beforeEach` memang menulis ke DB. `vi.clearAllMocks()` tidak menghapus implementasi, tapi `mockReset` menghapusnya.

- [ ] **Step 8: Commit**

```bash
git add src/repositories/wp/sessions.repo.ts src/services/approval/service.ts src/services/approval/http.ts src/app/api/v1/sessions/approvals/route.ts "src/app/api/v1/sessions/[id]/approval/route.ts" "src/app/api/v1/sessions/[id]/refund-done/route.ts" "src/app/api/v1/professionals/[id]/approval-setting/route.ts" tests/integration/approval/approval-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(approval): route antrean, detail, refund, dan saklar approval

GET /sessions/approvals (dengan counts untuk badge), GET /sessions/:id/approval,
POST /sessions/:id/refund-done, GET|PUT /professionals/:id/approval-setting.
Scope per peran: psikolog miliknya, admin klinik aktifnya, super semua.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B8: Tes invarian penulis status janji temu

**Files:**
- Test: `tests/unit/approval/status-writers-invariant.test.ts`

**Interfaces:**
- Consumes: hasil B3–B7 (jumlah pemanggilan per file sesudah semua perubahan).
- Produces: penjaga yang gagal begitu ada kode baru yang menulis status janji temu tanpa terdaftar.

- [ ] **Step 1: Tulis tes**

`tests/unit/approval/status-writers-invariant.test.ts`:

```ts
/**
 * Every code path that cancels or confirms a booking has to know about psychologist approval.
 *
 * PENDING used to mean "unpaid", and several paths cancel unpaid bookings on their own
 * (payment expiry, the unpaid-booking release, a new off-day). Since approval, a PENDING
 * booking may be PAID and waiting for its psychologist, and a path that cancels it without
 * asking drops the client's money silently.
 *
 * This pins where an appointment's status is written, how many times per file, and which
 * of those files must consult the approval record. A new caller — or a new call in a
 * known file — fails here until someone decides, and writes down, whether it needs the
 * approval check. Same idea as tests/unit/db/last-insert-id-pinning.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Comments may quote the calls they warn about; prose must not count as a write. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const WRITES =
  /\b(?:cancelAppointment|setSessionStatusDirect|setAppointmentStatus|bulkCancelSessions)\s*\(|kcAppointment\.update(?:Many)?\s*\(|UPDATE\s+wp_kc_appointments/g;

const APPROVAL_AWARE = /from '@\/services\/approval\/|from '\.\/store'/;

type Known = { writes: number; approvalAware: boolean; why: string };

const KNOWN: Record<string, Known> = {
  'src/services/session/session.service.ts': {
    writes: 4,
    approvalAware: true,
    why: 'transitionSession, off-day invalidation, bulk cancel (call + definition)',
  },
  'src/services/payments/payment.service.ts': {
    writes: 3,
    approvalAware: true,
    why: 'paid confirmation, expiry release, bill check-out',
  },
  'src/services/public/unpaid-booking.ts': { writes: 1, approvalAware: true, why: 'release of an unpaid guest booking' },
  'src/services/public/public-booking.service.ts': { writes: 1, approvalAware: true, why: "the client's own cancel link" },
  'src/services/approval/service.ts': { writes: 2, approvalAware: true, why: 'the approval decisions themselves' },
  'src/services/billing/bill.service.ts': {
    writes: 2,
    approvalAware: false,
    why: 'settling a bill checks out the encounter of a held session; never a PENDING public booking',
  },
  'src/app/api/v1/sessions/bulk/delete/route.ts': {
    writes: 1,
    approvalAware: false,
    why: 'calls bulkCancelSessions, which closes approval records itself',
  },
  'src/repositories/wp/sessions.repo.ts': { writes: 2, approvalAware: false, why: 'defines setSessionStatusDirect (raw UPDATE)' },
  'src/repositories/wp/appointments.write.ts': {
    writes: 3,
    approvalAware: false,
    why: 'defines setAppointmentStatus and cancelAppointment',
  },
};

function scan(): Map<string, { writes: number; aware: boolean }> {
  const found = new Map<string, { writes: number; aware: boolean }>();
  for (const file of walk(join(ROOT, 'src'))) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const writes = (source.match(WRITES) ?? []).length;
    if (writes === 0) continue;
    found.set(relative(ROOT, file).split(sep).join('/'), { writes, aware: APPROVAL_AWARE.test(source) });
  }
  return found;
}

describe('appointment status writers', () => {
  const found = scan();

  it('are exactly the known files', () => {
    expect([...found.keys()].sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it.each(Object.entries(KNOWN))('%s has the known number of writes', (file, known) => {
    expect(found.get(file)?.writes).toBe(known.writes);
  });

  it.each(Object.entries(KNOWN).filter(([, k]) => k.approvalAware))('%s consults the approval record', (file) => {
    expect(found.get(file)?.aware).toBe(true);
  });
});
```

- [ ] **Step 2: Jalankan**

```bash
npx vitest run tests/unit/approval/status-writers-invariant.test.ts
```

Expected: PASS.

Kalau `'are exactly the known files'` atau penghitungan gagal, **jangan** langsung menyesuaikan angka. Buka file yang disebut dan bandingkan dengan task sebelumnya:
- Penulisan yang memang direncanakan dengan jumlah berbeda (misalnya definisi dan pemanggilan di file yang sama): perbaiki `KNOWN`, lalu catat alasannya di `why`.
- Penulisan yang tidak direncanakan: itu temuan. Laporkan ke controller.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/approval/status-writers-invariant.test.ts
git commit -m "$(cat <<'EOF'
test(approval): invarian penulis status janji temu

Memaku file dan jumlah pemanggilan yang menulis status janji temu, serta
mana yang wajib memeriksa catatan approval. Pemanggil baru gagal di sini
sampai diputuskan perlu tidaknya pemeriksaan itu.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B9: Suite penuh, dokumentasi kontrak, runbook rilis

**Files:**
- Create: `docs/api/APPROVAL-PSIKOLOG-GUIDE.md`
- Modify: `docs/api/API-ACCESS-GUIDE.md`
- Create: `docs/deploy/approval-psikolog-runbook.md`
- Modify: tes lama mana pun yang gagal di Step 1 (aturan perbaikan sama dengan B6 Step 5)

- [ ] **Step 1: Suite penuh dan typecheck**

```bash
npx vitest run 2>&1 | tail -25
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
npm run lint 2>&1 | tail -15
```

Expected: `Test Files … passed`, tanpa yang gagal; typecheck `0`; lint tanpa error baru di file yang disentuh fitur ini.

Untuk setiap tes lama yang gagal, terapkan aturan B6 Step 5:
- Blok mock "approval mati" untuk file yang me-mock `@/lib/db` atau `@/repositories/wp/sessions.repo`.
- `approval: null` atau `requiresApproval: false` untuk `toEqual` yang hanya kalah oleh field baru.

Kandidat yang paling mungkin:
- `tests/payments/displayed-equals-charged.test.ts`
- `tests/payments/state-machine.test.ts`
- `tests/payments/session-routes.test.ts`
- `tests/public-booking/create.test.ts`
- `tests/public-booking/service-name-category.test.ts`
- `tests/public-booking/unpaid-release.test.ts`
- `tests/public-booking/transient-failure.test.ts`
- `tests/unit/access-scope/bulk-sessions-clients-scope.test.ts`

Kegagalan yang **bukan** karena dua sebab di atas adalah temuan. Laporkan ke controller dan jangan ditambal.

- [ ] **Step 2: Dokumentasi kontrak untuk FE**

`docs/api/APPROVAL-PSIKOLOG-GUIDE.md`:

````markdown
# Approval Psikolog — Kontrak API untuk FE

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`.

Booking publik yang sudah dibayar untuk psikolog yang menyalakan saklar **tetap `PENDING`**
sampai psikolog (atau admin atas namanya) memutuskan. Yang membedakannya dari "belum
dibayar" adalah objek `approval`.

## Objek `approval` (staf)

Ada di `GET /sessions`, `GET /sessions/{id}`, `GET /sessions/pending`, respons
`/approve`, `/reject`, `/cancel`, dan setiap item antrean. `null` untuk booking biasa.

```json
{
  "state": "AWAITING",
  "requestedAt": "2026-10-20T02:00:00.000Z",
  "decidedAt": null,
  "decidedByName": null,
  "rejectReason": null,
  "refundStatus": "NONE",
  "refundedAt": null,
  "refundedByName": null,
  "refundNote": null,
  "isOverdue": false,
  "payment": { "gateway": "xendit", "wcOrderId": 49863, "expectedAmount": 350000, "chargedAmount": 350000, "chargedCurrency": "IDR" }
}
```

- `state`: `AWAITING` | `APPROVED` | `REJECTED` | `CANCELLED`
- `refundStatus`: `NONE` | `NEEDED` | `DONE`
- `isOverdue`: `AWAITING` dan jam sesi sudah lewat. Yang tersisa hanya tolak.
- `payment`: `null` untuk booking yang ditandai lunas manual.

## Objek `approval` (publik)

Ada di `POST /public/payment-verify` dan `GET /public/appointments/{token}`. Hanya
`state`, `requestedAt`, `decidedAt`, `refundStatus`, `isOverdue`.

## Arti status + approval

| `status` | `approval.state` | `refundStatus` | Label FE |
|---|---|---|---|
| `PENDING` | — | — | Belum dibayar |
| `PENDING` | `AWAITING` | `NONE` | Lunas · menunggu psikolog |
| `BOOKED` | `APPROVED` | `NONE` | Terjadwal · lunas |
| `CANCELLED` | `REJECTED` | `NEEDED` / `DONE` | Ditolak · perlu refund / sudah direfund |
| `CANCELLED` | `CANCELLED` | `NEEDED` / `DONE` | Batal · perlu refund / sudah direfund |

## Aksi yang sudah ada, arti barunya

| Endpoint | Sesi `PENDING` tanpa approval | Sesi `PENDING` + `AWAITING` |
|---|---|---|
| `POST /sessions/{id}/approve` | Tandai lunas. Kalau saklar psikolog menyala → masuk antrean (tetap `PENDING`, `approval.state = AWAITING`), selain itu `BOOKED`. | Setujui → `BOOKED`. Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. 422 `session_already_started` kalau jam sesi lewat. |
| `POST /sessions/{id}/reject` `{reason}` | Batal seperti sebelumnya. | Tolak → `CANCELLED`, `refundStatus = NEEDED`, email standar ke klien (tanpa alasan). Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. |
| `POST /sessions/{id}/cancel` | Batal. | Batal → `approval.state = CANCELLED`, `refundStatus = NEEDED`. |

Keputusan yang kalah balapan: **409 `approval_already_decided`**.

## Endpoint baru

### `GET /api/v1/sessions/approvals`

Query: `state` = `AWAITING` (default) | `REFUND_NEEDED` | `REFUNDED` | `DECIDED`;
`professionalId`, `clinicId`, `page` (≥1), `limit` (1–100, default 20).

Peran: psikolog (miliknya saja, `professionalId` diabaikan), `CLINIC_ADMIN` (klinik aktif;
klinik lain → halaman kosong), `SUPER_ADMIN` (semua, atau `clinicId`). Resepsionis → 403.

```json
{
  "data": [ { "id": 3358, "clinicId": 16, "professionalId": 142, "professionalName": "…", "clientName": "…",
              "slotDate": "2026-10-22", "startTime": "10:00:00", "endTime": "11:00:00", "timezone": "Asia/Jakarta",
              "status": "PENDING", "serviceIds": [12], "serviceName": "Konseling Individu", "approval": { … } } ],
  "pagination": { "currentPage": 1, "totalPages": 1, "totalItems": 1, "itemsPerPage": 20 },
  "counts": { "awaiting": 1, "refundNeeded": 0 }
}
```

Kuncinya lebih dari satu, jadi `PraktiquApi::unwrap()` di FE **tidak** membukanya. Baca `$res['data']` dan `$res['counts']`.

### `GET /api/v1/sessions/{id}/approval`

Satu item, bentuknya sama dengan item antrean, dibungkus `{ data }`. 404 `approval_not_found` kalau sesi itu tidak pernah menunggu approval; 403 di luar scope.

### `POST /api/v1/sessions/{id}/refund-done`

Body `{ "note": "Transfer BCA 21/10" }` (opsional, ≤ 500). Hanya `CLINIC_ADMIN` klinik sesi itu dan `SUPER_ADMIN`. Respons `{ data: approval }`. 409 `refund_not_needed` kalau tidak ada refund yang tertunda.

### `GET|PUT /api/v1/professionals/{id}/approval-setting`

`id` = `professionalId` (wp_users.ID). PUT body `{ "requiresApproval": true }`. Peran: psikolog itu sendiri, `CLINIC_ADMIN` yang klinik aktifnya memetakan psikolog itu, `SUPER_ADMIN`. 404 kalau psikolog tidak ada; 403 kalau bukan haknya; 422 untuk body yang salah.

```json
{ "data": { "professionalId": 142, "requiresApproval": true, "updatedAt": "2026-10-20T03:00:00.000Z", "updatedByName": "Rina Admin" } }
```

### Katalog publik

`GET /public/professionals`, `/public/professionals/{id}`, `/public/professionals/by-slug/{slug}`: setiap psikolog membawa `requiresApproval: boolean`.
````

`docs/api/API-ACCESS-GUIDE.md`: di tabel endpoint sesi, tambahkan baris berikut di posisi urut abjad:

```markdown
| `GET` | `/api/v1/sessions/approvals` | — |
| `GET` | `/api/v1/sessions/{id}/approval` | — |
| `POST` | `/api/v1/sessions/{id}/refund-done` | — |
```

Di tabel endpoint profesional, tambahkan juga baris ini, sesuai urutan yang dipakai tabel itu:

```markdown
| `GET` | `/api/v1/professionals/{id}/approval-setting` | — |
| `PUT` | `/api/v1/professionals/{id}/approval-setting` | — |
```

- [ ] **Step 3: Runbook rilis**

`docs/deploy/approval-psikolog-runbook.md`:

````markdown
# Runbook — Approval Psikolog

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`. Semua langkah yang
menyentuh produksi butuh persetujuan user di saat itu.

## Urutan

Urutan wajib: **plugin → SQL → backend → FE**. Setiap langkah aman sendirian, karena saklar
default mati.

1. **Plugin 1.8.3** di Hostinger WP (`ssh praktiqu-hostinger`; matikan Cloudflare WARP dulu).
   - Cocokkan dulu isi server dengan git 1.8.2. Buat backup `~/plugin-backups/praktiqu-endpoint-1.8.2-<UTC>.tgz`.
   - Hanya dua file plugin yang berubah, ditambah readme: `includes/class-praktiqu-endpoint-jobs.php` dan `praktiqu-endpoint.php`.
   - Tukar **`includes/class-praktiqu-endpoint-jobs.php` dulu**, baru `praktiqu-endpoint.php`, lalu `readme.txt`. Tidak ada kelas baru yang di-require.
   - Verifikasi: versi 1.8.3 aktif dan tidak ada baris baru di `error_log`.
2. **SQL** `prisma/manual/2026-10-19-approval-psikolog.sql` di DB produksi:
   ```bash
   mysql -u <user> -p <database> < prisma/manual/2026-10-19-approval-psikolog.sql
   ```
   Verifikasi `SHOW TABLES LIKE '%approval%';` → `professional_approval_settings`, `session_approvals`.
3. **Backend**: user me-merge PR → Hostinger auto-deploy. Verifikasi dengan `GET /api/v1/sessions/approvals` (token psikolog) → 200 dengan `counts`.
4. **FE**: user me-merge PR → deploy GitHub Actions.

## Uji coba (user, dengan satu psikolog uji)

1. Nyalakan saklar psikolog uji di Persetujuan → Pengaturan.
2. Booking publik psikolog itu dan bayar. Klien menerima "menunggu konfirmasi psikolog"; psikolog menerima "Booking baru…"; halaman kembali dari pembayaran menyebut "menunggu konfirmasi psikolog".
3. Psikolog membuka tautan email → login → detail → **Setujui**. Klien menerima email booking KiviCare; status "Terjadwal · lunas".
4. Booking kedua → bayar → **Tolak** (dengan alasan). Klien menerima email "tidak dapat diterima"; sesi muncul di tab **Perlu refund**.
5. Admin mengembalikan dana di Xendit/WooCommerce → **Tandai sudah direfund**.
6. Matikan saklar psikolog uji.

## Rollback

- FE dan backend: revert merge, lalu auto-deploy. Tabel baru boleh dibiarkan; backend lama tidak membacanya.
- **Sesi yang sedang `AWAITING` saat rollback backend akan tertinggal `PENDING`.** Sebelum rollback, putuskan dulu semuanya: `SELECT appointmentId FROM session_approvals WHERE state='AWAITING';`. Kalau tidak, job auto-cancel lama bisa melepasnya.
- Plugin: kembalikan backup 1.8.2. Tanpa Next.js baru, tidak ada yang meng-enqueue hook baru.
````

- [ ] **Step 4: Commit**

```bash
git add docs/api/APPROVAL-PSIKOLOG-GUIDE.md docs/api/API-ACCESS-GUIDE.md docs/deploy/approval-psikolog-runbook.md
git status --short
```

Kalau Step 1 mengubah file tes, `git add` juga file itu. Lalu:

```bash
git commit -m "$(cat <<'EOF'
docs(approval): kontrak API untuk FE dan runbook rilis

Panduan kontrak approval psikolog untuk FE Laravel, baris endpoint baru
di API-ACCESS-GUIDE, dan runbook urutan plugin, SQL, backend, FE.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push (hanya setelah user setuju)**

Tanyakan dulu ke user. Setelah disetujui:

```bash
git push origin feat/approval-psikolog:refs/heads/feat/approval-psikolog
```

Expected: branch baru tercipta di `Alfzzz124/nextjs-appointment-praktiqu`. PR dibuka user dari compare link `https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/approval-psikolog` (tidak ada `gh` yang bisa dipakai).

---
## Bagian F — FE Laravel

Semua task F bergantung pada kontrak di `docs/api/APPROVAL-PSIKOLOG-GUIDE.md` (B9). Tes FE memalsukan backend dengan `Http::fake`, jadi bisa dikerjakan sebelum backend live. Urutan F1 → F7 tetap wajib: F5 memakai `PersetujuanController::boleh()` dari F3.

### Task F0: Worktree FE siap dan tes dasar hijau

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Worktree dan vendor**

```bash
cd /home/ahmad/projects/praktiqu-fe
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git -C main fetch -q origin
git -C main worktree list | grep approval-psikolog || git -C main worktree add -b feat/approval-psikolog ../approval-psikolog origin/main
cd approval-psikolog
git log --oneline -1
test -d vendor && ! test -L vendor || { rm -f vendor; cp -a ../main/vendor vendor; }
test -e .env || cp ../main/.env .env
mkdir -p /tmp/dockercfg && { test -f /tmp/dockercfg/config.json || echo '{}' > /tmp/dockercfg/config.json; }
git status --short
```

Expected:
- Commit teratas = `origin/main` FE (saat rencana ditulis: `cd7f75f Merge pull request #49`, atau yang lebih baru).
- `git status --short` kosong (`/vendor` dan `.env` ada di `.gitignore`).

- [ ] **Step 2: Suite penuh, baseline**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit 2>&1 | tail -3
```

Expected: `OK (N tests, …)`. Catat N. Kalau gagal di sini, berhenti dan laporkan.

---

### Task F1: Login kembali ke halaman tujuan

**Files:**
- Modify: `app/Http/Middleware/StaffAuth.php`
- Modify: `app/Http/Controllers/AuthController.php` (`showLogin`, akhir `login`)
- Test: `tests/Feature/LoginTujuanTest.php`

**Interfaces:**
- Produces: session `url.intended` berisi URL penuh halaman GET `dashboard/*` yang dibuka tanpa sesi. Setelah login, atau saat membuka halaman login padahal sudah login, pengguna dibawa ke URL itu. Tautan email `/dashboard/persetujuan/{id}` (F3) bergantung padanya.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/LoginTujuanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Tautan di email approval psikolog menuju /dashboard/persetujuan/{id}. Staf
// yang belum login harus kembali ke halaman itu setelah login, bukan ke
// beranda role-nya. Hanya halaman GET di bawah /dashboard yang diingat: aksi
// AJAX tidak punya halaman untuk dituju, dan path lain tidak boleh dijadikan
// tujuan pengalihan.
class LoginTujuanTest extends TestCase
{
    // Halaman dashboard yang sudah ada dan dijaga staff:any.
    private const HALAMAN = '/dashboard/klinik/4/pemilik';

    private function fakeLogin(string $role): void
    {
        Http::fake(fn () => Http::response([
            'token' => 'tok_123',
            'refreshToken' => 'ref_123',
            'user' => ['id' => 7, 'email' => 'a@b.co', 'name' => 'A', 'role' => $role],
        ]));
    }

    public function test_halaman_dashboard_diingat_saat_dialihkan_ke_login(): void
    {
        $this->get(self::HALAMAN)
            ->assertRedirect('/staff/login')
            ->assertSessionHas('url.intended', 'http://localhost'.self::HALAMAN);
    }

    public function test_aksi_json_tidak_diingat(): void
    {
        $this->getJson(self::HALAMAN)->assertStatus(401)->assertSessionMissing('url.intended');
    }

    public function test_halaman_di_luar_dashboard_tidak_diingat(): void
    {
        $this->get('/psikolog')->assertRedirect()->assertSessionMissing('url.intended');
    }

    public function test_login_kembali_ke_halaman_yang_diingat(): void
    {
        $this->fakeLogin('PROFESSIONAL');

        $this->withSession(['url.intended' => 'http://localhost/dashboard/persetujuan/88'])
            ->post('/staff/login', ['email' => 'a@b.co', 'password' => 'secret'])
            ->assertRedirect('http://localhost/dashboard/persetujuan/88');
    }

    public function test_tanpa_tujuan_login_tetap_ke_beranda_role(): void
    {
        $this->fakeLogin('PROFESSIONAL');

        $this->post('/staff/login', ['email' => 'a@b.co', 'password' => 'secret'])
            ->assertRedirect('/psikolog');
    }

    public function test_sudah_login_lalu_membuka_halaman_login_dibawa_ke_tujuan(): void
    {
        $this->withSession([
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION,
                'role' => 'psikolog',
                'name' => 'Dianda',
                'professionalId' => 120,
            ],
            'url.intended' => 'http://localhost/dashboard/persetujuan/88',
        ])->get('/staff/login')->assertRedirect('http://localhost/dashboard/persetujuan/88');
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
cd /home/ahmad/projects/praktiqu-fe/approval-psikolog
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter LoginTujuanTest
```

Expected: tiga tes FAIL: yang pertama (session tidak berisi `url.intended`), dan dua tes yang mengharapkan pengalihan ke `/dashboard/persetujuan/88`. Tiga lainnya PASS.

- [ ] **Step 3: `app/Http/Middleware/StaffAuth.php`**

Di dalam `if (! $profile) { … }`, tepat setelah blok `if (Session::has(PraktiquApi::TOKEN_KEY)) { … }` dan sebelum komentar `// Aksi AJAX (write) butuh 401 JSON …`, sisipkan:

```php
            // Tautan di email (mis. /dashboard/persetujuan/{id}) harus kembali
            // ke halaman itu setelah login, bukan ke beranda role. Hanya GET
            // halaman di bawah /dashboard: aksi AJAX tidak punya halaman untuk
            // dituju, dan path lain tidak boleh dijadikan tujuan pengalihan.
            // fullUrl() dari request ini sendiri, jadi host-nya selalu milik kita.
            if ($request->isMethod('GET') && ! $request->expectsJson() && $request->is('dashboard/*')) {
                Session::put('url.intended', $request->fullUrl());
            }
```

- [ ] **Step 4: `app/Http/Controllers/AuthController.php`**

Di `showLogin`, ganti:

```php
            return redirect(self::ROLE_DEST[$profile['role']]);
```

menjadi:

```php
            return redirect()->intended(self::ROLE_DEST[$profile['role']]);
```

Di akhir `login()`, ganti `return redirect($dest);` (tepat setelah `Session::put(PraktiquApi::PROFILE_KEY, $profile);`) menjadi:

```php
        // Kembali ke halaman yang tadi dibuka tanpa sesi (StaffAuth), kalau ada.
        return redirect()->intended($dest);
```

- [ ] **Step 5: Jalankan tes baru dan tes login lama**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'LoginTujuanTest|StaffLoginRoleTest|StaffAccessTest|LoginPesanGalatTest|KlinikAktifLoginTest|KelolaPembayaranLoginTest'
```

Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Middleware/StaffAuth.php app/Http/Controllers/AuthController.php tests/Feature/LoginTujuanTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(login): kembali ke halaman dashboard yang tadi dibuka

Tautan email approval psikolog menuju /dashboard/persetujuan/{id}. Staf
yang belum login sekarang kembali ke halaman itu setelah login. Hanya
halaman GET di bawah /dashboard yang diingat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F2: Label status sadar approval di daftar Appointments

**Files:**
- Create: `app/Services/LabelStatusJanji.php`
- Modify: `app/Http/Controllers/DashboardController.php` (`mapAppt`, `apptStatusLabel`)
- Modify: `app/Http/Controllers/SessionStatusController.php`
- Modify: `resources/views/dashboard.blade.php` (aksi status, saringan, legenda)
- Modify: `public/css/app.css` (`.badge.amber`)
- Test: `tests/Unit/LabelStatusJanjiTest.php`, `tests/Feature/AppointmentsApprovalTest.php`
- Modify (tes): `tests/Feature/SessionStatusTest.php`

**Interfaces:**
- Consumes: field `approval` di `/sessions` dan respons `/approve`, `/reject`, `/cancel` (B5).
- Produces:
  - `LabelStatusJanji::label(string $status, ?array $approval = null): string`
  - `LabelStatusJanji::badge(string $status, ?array $approval = null): string` — `amber` | `salmon` | `red` | `green` | `blue`
  - `LabelStatusJanji::ringkas(mixed $approval): ?array{state:string,refundStatus:string,isOverdue:bool}`
  - Baris `mapAppt` membawa kunci `approval` (hasil `ringkas`).
  - `POST /dashboard/sesi/{id}/status` menjawab `{status, label, badge, approval}`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Unit/LabelStatusJanjiTest.php`:

```php
<?php

namespace Tests\Unit;

use App\Services\LabelStatusJanji;
use PHPUnit\Framework\TestCase;

// Label + warna status janji temu dari satu tempat. Sejak approval psikolog,
// status saja tidak cukup: PENDING bisa "belum dibayar" atau "lunas, menunggu
// psikolog", dan CANCELLED bisa membawa dana yang harus dikembalikan.
class LabelStatusJanjiTest extends TestCase
{
    private const MENUNGGU = ['state' => 'AWAITING', 'refundStatus' => 'NONE'];

    public function test_status_biasa_tidak_berubah(): void
    {
        $this->assertSame('Belum dibayar', LabelStatusJanji::label('PENDING'));
        $this->assertSame('Terjadwal · lunas', LabelStatusJanji::label('BOOKED'));
        $this->assertSame('Batal', LabelStatusJanji::label('CANCELLED'));
        $this->assertSame('—', LabelStatusJanji::label(''));
        $this->assertSame('salmon', LabelStatusJanji::badge('PENDING'));
        $this->assertSame('red', LabelStatusJanji::badge('CANCELLED'));
        $this->assertSame('green', LabelStatusJanji::badge('CHECK_OUT'));
        $this->assertSame('blue', LabelStatusJanji::badge('CHECK_IN'));
    }

    public function test_pending_yang_menunggu_psikolog(): void
    {
        $this->assertSame('Lunas · menunggu psikolog', LabelStatusJanji::label('PENDING', self::MENUNGGU));
        $this->assertSame('amber', LabelStatusJanji::badge('PENDING', self::MENUNGGU));
    }

    public function test_batal_dengan_refund(): void
    {
        $this->assertSame('Ditolak · perlu refund', LabelStatusJanji::label('CANCELLED', ['state' => 'REJECTED', 'refundStatus' => 'NEEDED']));
        $this->assertSame('Ditolak · sudah direfund', LabelStatusJanji::label('CANCELLED', ['state' => 'REJECTED', 'refundStatus' => 'DONE']));
        $this->assertSame('Batal · perlu refund', LabelStatusJanji::label('CANCELLED', ['state' => 'CANCELLED', 'refundStatus' => 'NEEDED']));
        $this->assertSame('red', LabelStatusJanji::badge('CANCELLED', ['state' => 'REJECTED', 'refundStatus' => 'NEEDED']));
    }

    public function test_disetujui_terbaca_seperti_booking_lunas(): void
    {
        $this->assertSame('Terjadwal · lunas', LabelStatusJanji::label('BOOKED', ['state' => 'APPROVED', 'refundStatus' => 'NONE']));
    }

    public function test_ringkas(): void
    {
        $this->assertNull(LabelStatusJanji::ringkas(null));
        $this->assertNull(LabelStatusJanji::ringkas(['refundStatus' => 'NONE']));
        $this->assertSame(
            ['state' => 'AWAITING', 'refundStatus' => 'NONE', 'isOverdue' => true],
            LabelStatusJanji::ringkas(['state' => 'awaiting', 'isOverdue' => true, 'decidedByName' => 'X']),
        );
    }
}
```

`tests/Feature/AppointmentsApprovalTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Daftar Appointments untuk booking yang sudah dibayar dan menunggu psikolog:
// label dan warnanya sendiri, aksi Setujui/Tolak menggantikan "tandai lunas",
// dan saringan "Belum dibayar" tidak lagi ikut menghitungnya.
class AppointmentsApprovalTest extends TestCase
{
    private function staf(): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION,
                'role' => 'admin', 'name' => 'Rina Admin', 'userId' => 9, 'practiceId' => 42,
            ],
        ];
    }

    public function test_baris_membawa_label_warna_dan_approval(): void
    {
        Http::fake(fn (Request $r) => preg_match('#/api/v1/sessions(\?|$)#', $r->url())
            ? Http::response(['data' => [[
                'id' => 88, 'clinicId' => 42, 'status' => 'PENDING', 'clientName' => 'Ada', 'professionalName' => 'Dianda',
                'slotDate' => '2026-10-22', 'startTime' => '10:00:00', 'endTime' => '11:00:00', 'serviceIds' => [],
                'approval' => ['state' => 'AWAITING', 'refundStatus' => 'NONE', 'isOverdue' => false],
            ]], 'pagination' => ['currentPage' => 1, 'totalPages' => 1, 'totalItems' => 1]])
            : Http::response(['data' => []]));

        $res = $this->withSession($this->staf())->getJson('/dashboard/daftar/sessions');

        $res->assertOk()
            ->assertJsonPath('rows.0.status', 'Lunas · menunggu psikolog')
            ->assertJsonPath('rows.0.badge', 'amber')
            ->assertJsonPath('rows.0.approval.state', 'AWAITING');
    }

    public function test_halaman_menawarkan_setujui_dan_saringan_menunggu(): void
    {
        Http::fake(fn () => Http::response(['data' => []]));

        $res = $this->withSession($this->staf())->get('/klinik');

        $res->assertOk();
        $res->assertSee('{ k: "approve", t: "Setujui jadwal", a: "konfirmasi"', false);
        $res->assertSee('<option value="awaiting">Menunggu psikolog</option>', false);
        $res->assertSee('case "awaiting":', false);
        $res->assertSee('Lunas · menunggu psikolog</span>', false);
        $res->assertSee('r.badge = j.badge || "blue";', false);
    }
}
```

Di `tests/Feature/SessionStatusTest.php`, tambahkan method berikut di akhir kelas:

```php
    // Approval psikolog: label dan warna diambil dari jawaban backend, karena
    // "tandai lunas" untuk psikolog bersaklar tetap PENDING (masuk antrean).
    public function test_menyetujui_booking_yang_menunggu_memakai_status_dari_backend(): void
    {
        Http::fake([
            '*/api/v1/sessions/88/approve' => Http::response(['data' => [
                'id' => 88, 'status' => 'BOOKED', 'approval' => ['state' => 'APPROVED', 'refundStatus' => 'NONE'],
            ]]),
            '*/api/v1/sessions/88' => Http::response(['data' => [
                'id' => 88, 'status' => 'PENDING', 'approval' => ['state' => 'AWAITING', 'refundStatus' => 'NONE'],
            ]]),
        ]);

        $res = $this->withSession($this->staf('psikolog'))->postJson('/dashboard/sesi/88/status', ['aksi' => 'approve']);

        $res->assertOk()->assertJson([
            'status' => 'BOOKED',
            'label' => 'Terjadwal · lunas',
            'badge' => 'blue',
            'approval' => ['state' => 'APPROVED'],
        ]);
    }

    public function test_tandai_lunas_untuk_psikolog_bersaklar_tetap_menunggu(): void
    {
        Http::fake([
            '*/api/v1/sessions/88/approve' => Http::response(['data' => [
                'id' => 88, 'status' => 'PENDING', 'approval' => ['state' => 'AWAITING', 'refundStatus' => 'NONE'],
            ]]),
            '*/api/v1/sessions/88' => Http::response(['data' => ['id' => 88, 'status' => 'PENDING', 'approval' => null]]),
        ]);

        $res = $this->withSession($this->staf())->postJson('/dashboard/sesi/88/status', ['aksi' => 'approve']);

        $res->assertOk()->assertJson(['status' => 'PENDING', 'label' => 'Lunas · menunggu psikolog', 'badge' => 'amber']);
    }

    public function test_menolak_booking_yang_menunggu_masuk_perlu_refund(): void
    {
        Http::fake([
            '*/api/v1/sessions/88/reject' => Http::response(['data' => [
                'id' => 88, 'status' => 'CANCELLED', 'approval' => ['state' => 'REJECTED', 'refundStatus' => 'NEEDED'],
            ]]),
            '*/api/v1/sessions/88' => Http::response(['data' => [
                'id' => 88, 'status' => 'PENDING', 'approval' => ['state' => 'AWAITING', 'refundStatus' => 'NONE'],
            ]]),
        ]);

        $res = $this->withSession($this->staf())->postJson('/dashboard/sesi/88/status', ['aksi' => 'reject', 'alasan' => 'Jadwal bentrok']);

        $res->assertOk()->assertJson(['status' => 'CANCELLED', 'label' => 'Ditolak · perlu refund', 'badge' => 'red']);
    }

    public function test_keputusan_yang_kalah_balapan_dijelaskan(): void
    {
        Http::fake([
            '*/api/v1/sessions/88/approve' => Http::response([
                'type' => '/errors/approval_already_decided', 'title' => 'approval_already_decided', 'status' => 409, 'detail' => 'x',
            ], 409),
            '*/api/v1/sessions/88' => Http::response(['data' => [
                'id' => 88, 'status' => 'PENDING', 'approval' => ['state' => 'AWAITING', 'refundStatus' => 'NONE'],
            ]]),
        ]);

        $res = $this->withSession($this->staf('psikolog'))->postJson('/dashboard/sesi/88/status', ['aksi' => 'approve']);

        $res->assertStatus(424)->assertJson(['message' => 'Permintaan ini sudah diputuskan. Muat ulang halaman untuk melihat keputusannya.']);
    }
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'LabelStatusJanjiTest|AppointmentsApprovalTest|SessionStatusTest'
```

Expected: `LabelStatusJanjiTest` error (kelas tidak ada); `AppointmentsApprovalTest` dan empat tes baru `SessionStatusTest` FAIL; tes `SessionStatusTest` lama PASS.

- [ ] **Step 3: `app/Services/LabelStatusJanji.php`**

```php
<?php

namespace App\Services;

/**
 * Label dan warna badge status janji temu — satu-satunya tempat keduanya
 * ditentukan. Sebelumnya DashboardController::apptStatusLabel dan
 * SessionStatusController::label adalah dua salinan yang dijaga "sama persis"
 * dengan tangan.
 *
 * Sejak approval psikolog (spec backend
 * docs/superpowers/specs/2026-10-19-approval-psikolog-design.md), status saja
 * tidak cukup: PENDING bisa berarti "belum dibayar" ATAU "sudah dibayar,
 * menunggu psikolog", dan CANCELLED bisa membawa dana yang harus dikembalikan.
 * Pembedanya objek `approval` dari backend — null untuk booking biasa.
 */
final class LabelStatusJanji
{
    /** @param  array<string, mixed>|null  $approval */
    public static function label(string $status, ?array $approval = null): string
    {
        $s = strtoupper(trim($status));
        $state = strtoupper((string) ($approval['state'] ?? ''));
        $refund = strtoupper((string) ($approval['refundStatus'] ?? 'NONE'));

        if ($s === 'PENDING' && $state === 'AWAITING') {
            return 'Lunas · menunggu psikolog';
        }
        if (in_array($s, ['CANCELLED', 'CANCELED'], true) && in_array($refund, ['NEEDED', 'DONE'], true)) {
            return ($state === 'REJECTED' ? 'Ditolak' : 'Batal').($refund === 'DONE' ? ' · sudah direfund' : ' · perlu refund');
        }

        return match ($s) {
            'PENDING' => 'Belum dibayar',
            'BOOKED' => 'Terjadwal · lunas',
            'CHECK_IN' => 'Klien datang',
            'CHECK_OUT' => 'Sesi selesai',
            'COMPLETED' => 'Selesai & tercatat',
            'REJECTED' => 'Ditolak psikolog',
            'CANCELLED', 'CANCELED' => 'Batal',
            '' => '—',
            default => $status,
        };
    }

    /**
     * Kelas warna `.badge` (public/css/app.css). Amber khusus booking yang
     * sudah dibayar dan menunggu psikolog: salmon berarti "belum dibayar", dan
     * menyamakan keduanya membuat admin menagih klien yang sudah membayar.
     *
     * @param  array<string, mixed>|null  $approval
     */
    public static function badge(string $status, ?array $approval = null): string
    {
        if (strtoupper(trim($status)) === 'PENDING' && strtoupper((string) ($approval['state'] ?? '')) === 'AWAITING') {
            return 'amber';
        }
        $s = strtolower($status);

        return match (true) {
            str_contains($s, 'cancel'), str_contains($s, 'batal'), str_contains($s, 'reject') => 'red',
            str_contains($s, 'pending') => 'salmon',
            str_contains($s, 'check_out'), str_contains($s, 'checkout'), str_contains($s, 'completed') => 'green',
            default => 'blue',
        };
    }

    /**
     * Objek approval backend diringkas menjadi yang dipakai layar. null kalau
     * backend tidak mengirimnya (booking biasa, atau backend lama).
     *
     * @return array{state: string, refundStatus: string, isOverdue: bool}|null
     */
    public static function ringkas(mixed $approval): ?array
    {
        if (! is_array($approval) || ! isset($approval['state'])) {
            return null;
        }

        return [
            'state' => strtoupper((string) $approval['state']),
            'refundStatus' => strtoupper((string) ($approval['refundStatus'] ?? 'NONE')),
            'isOverdue' => ! empty($approval['isOverdue']),
        ];
    }
}
```

- [ ] **Step 4: `app/Http/Controllers/DashboardController.php`**

(a) Tambahkan `use App\Services\LabelStatusJanji;` di antara impor `use App\Services\…` yang lain.

(b) Di `mapAppt`, ganti:

```php
        $status = strtolower((string) ($r['status'] ?? ''));

        return [
```

menjadi:

```php
        // Objek approval backend (approval psikolog). null untuk booking biasa.
        $approval = LabelStatusJanji::ringkas($r['approval'] ?? null);

        return [
```

(c) Ganti `'status' => self::apptStatusLabel((string) ($r['status'] ?? '')),` menjadi:

```php
            'status' => LabelStatusJanji::label((string) ($r['status'] ?? ''), $approval),
```

(d) Ganti seluruh entri `'badge' => match (true) { … },` beserta blok komentar tepat di atasnya (mulai baris `// CANCELLED dulu jatuh ke default 'green' — janji temu yang batal`) dengan:

```php
            // Warna dari satu tempat dengan labelnya (LabelStatusJanji). Riwayat
            // aturannya — CANCELLED pernah hijau, CHECK_IN dan CHECK_OUT pernah
            // sama-sama biru — ada di komentar kelas itu dan di git.
            'badge' => LabelStatusJanji::badge((string) ($r['status'] ?? ''), $approval),
            // Dibaca aksiStatus() dan saringan di dashboard.blade.php: booking
            // yang menunggu psikolog mendapat Setujui/Tolak, bukan "tandai lunas".
            'approval' => $approval,
```

(e) Ganti badan `apptStatusLabel` (docblock-nya biarkan) menjadi:

```php
    private static function apptStatusLabel(string $status): string
    {
        return LabelStatusJanji::label($status);
    }
```

- [ ] **Step 5: `app/Http/Controllers/SessionStatusController.php`**

(a) Tambahkan `use App\Services\LabelStatusJanji;` di bawah `use App\Services\ApiException;`.

(b) Di `update()`, ganti blok dari komentar `// Status sekarang dibaca dari backend, …` sampai penutup `if ($sekarang !== '' && …) { … }` dengan:

```php
        // Status sekarang dibaca dari backend, bukan dari yang dikirim layar:
        // dua staf bisa membuka daftar yang sama, dan yang menekan belakangan
        // akan bekerja dari gambaran yang sudah basi.
        $janji = $this->janjiTemu($appointment);
        $sekarang = strtoupper((string) ($janji['status'] ?? ''));
        $approvalSekarang = LabelStatusJanji::ringkas($janji['approval'] ?? null);
        // Sudah dibayar dan menunggu psikolog (approval psikolog): "approve" di
        // sini berarti menyetujui jadwal, bukan menandai lunas.
        $menunggu = ($approvalSekarang['state'] ?? null) === 'AWAITING';
        if ($sekarang !== '' && ! in_array($sekarang, $dariYangSah, true)) {
            return response()->json([
                'message' => 'Status sesi ini sekarang '.LabelStatusJanji::label($sekarang, $approvalSekarang).', dan dari situ '
                    .self::labelAksi($data['aksi'], $menunggu).' tidak bisa dilakukan. '
                    .'Muat ulang halaman untuk melihat keadaan terbarunya.',
            ], self::UPSTREAM_REJECTED);
        }
```

(c) Ganti blok `try { $this->api->post(…); } catch (ApiException $e) { … }` dan `return response()->json(['status' => $hasil, 'label' => self::label($hasil)]);` dengan:

```php
        try {
            $baru = $this->api->post("api/v1/sessions/{$appointment}/{$jalur}", $badan);
        } catch (ApiException $e) {
            // Problem+json backend menaruh kodenya di `title`.
            $kode = is_array($e->body) ? ($e->body['title'] ?? null) : null;

            return response()->json([
                'message' => match (true) {
                    $kode === 'approval_already_decided' => 'Permintaan ini sudah diputuskan. Muat ulang halaman untuk melihat keputusannya.',
                    $kode === 'session_already_started' => 'Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.',
                    in_array($e->status, [401, 403], true) => 'Peran Anda tidak berwenang melakukan '.self::labelAksi($data['aksi'], $menunggu).' di sesi ini.',
                    $e->status === 404 => 'Janji temu ini tidak ditemukan atau bukan milik Anda.',
                    in_array($e->status, [409, 422], true) => 'Sistem menolak perpindahan status ini. Muat ulang halaman lalu coba lagi.',
                    default => $e->getMessage() ?: 'Status gagal diubah.',
                },
            ], self::UPSTREAM_REJECTED);
        }

        // Status hasil dibaca dari jawaban backend, bukan dari tabel AKSI:
        // "tandai lunas" untuk psikolog yang menyalakan approval tetap PENDING
        // (masuk antrean psikolog), dan label "Terjadwal · lunas" di sana akan
        // bohong. Jawaban tanpa status (backend lama) jatuh ke tabel AKSI.
        $status = strtoupper((string) (is_array($baru) && isset($baru['status']) ? $baru['status'] : $hasil));
        $approval = is_array($baru) ? LabelStatusJanji::ringkas($baru['approval'] ?? null) : null;

        return response()->json([
            'status' => $status,
            'label' => LabelStatusJanji::label($status, $approval),
            'badge' => LabelStatusJanji::badge($status, $approval),
            'approval' => $approval,
        ]);
```

(d) Hapus method `label()` beserta docblock-nya (`/** Sama persis dengan DashboardController::apptStatusLabel. */ private static function label(string $status): string { … }`). Penggantinya `LabelStatusJanji::label`.

(e) Ganti `labelAksi` menjadi:

```php
    private static function labelAksi(string $aksi, bool $menunggu = false): string
    {
        if ($aksi === 'approve' && $menunggu) {
            return 'menyetujui jadwal';
        }

        return [
            'approve' => 'menandai lunas',
            'reject' => 'menolak',
            'cancel' => 'membatalkan',
            'check_in' => 'check-in',
            'check_out' => 'check-out',
        ][$aksi] ?? $aksi;
    }
```

- [ ] **Step 6: `resources/views/dashboard.blade.php`**

(a) `aksiStatus(r)` — tepat setelah baris `const batal = { k: "cancel", … };` sisipkan:

```js
      // Sudah dibayar, menunggu psikolog (approval psikolog). "Tandai lunas"
      // tidak masuk akal di sini — uangnya sudah masuk — dan menolak atau
      // membatalkan berarti dananya harus dikembalikan klinik.
      if (s === "PENDING" && r.approval && r.approval.state === "AWAITING") return [
        { k: "approve", t: "Setujui jadwal", a: "konfirmasi", n: r.approval.isOverdue ? "Jam sesinya sudah lewat — sistem akan menolak persetujuan. Tolak untuk mengembalikan dana." : "Klien sudah membayar. Setelah disetujui, klien menerima konfirmasi dan pengingat." },
        { k: "reject", t: "Tolak", a: "wajib", n: "Sesi dibatalkan dan masuk daftar Perlu refund. Alasannya hanya untuk catatan internal — klien menerima pesan standar." },
        { ...batal, n: "Dana klien sudah masuk — sesi ini akan masuk daftar Perlu refund." },
      ];
```

(b) `teksKonfirmasi(r)` — tepat setelah baris `const siapa = …;` sisipkan:

```js
      if (this.statusTanya === "approve" && r.approval && r.approval.state === "AWAITING") {
        return `Setujui jadwal ${siapa}? Klien menerima email konfirmasi dan pengingat sesi.`;
      }
```

(c) `ubahStatus` — ganti empat baris berikut:

```js
        r.statusKey = j.status; r.status = j.label;
        // Hanya lima status yang bisa datang dari sini — REJECTED dan COMPLETED
        // sudah tidak ada di backend, keduanya melebur ke CANCELLED/CHECK_OUT.
        r.badge = ({ CANCELLED: "red", PENDING: "salmon", CHECK_OUT: "green" })[j.status] || "blue";
```

dengan:

```js
        r.statusKey = j.status; r.status = j.label; r.approval = j.approval || null;
        // Warnanya dari server (LabelStatusJanji), satu sumber dengan labelnya:
        // PENDING bisa salmon (belum dibayar) atau amber (lunas, menunggu psikolog).
        r.badge = j.badge || "blue";
```

(d) `apptPass(r)` — ganti baris `case "unpaid": return String(r.statusKey || "").toUpperCase() === "PENDING";` dengan:

```js
        case "unpaid": return String(r.statusKey || "").toUpperCase() === "PENDING" && !(r.approval && r.approval.state === "AWAITING");
        // Sudah dibayar, menunggu persetujuan psikolog.
        case "awaiting": return !!(r.approval && r.approval.state === "AWAITING");
```

(e) Saringan status — tepat setelah `<option value="unpaid">Belum dibayar</option>` tambahkan:

```blade
            <option value="awaiting">Menunggu psikolog</option>
```

(f) Legenda "Arti status" — tepat setelah baris `<div><span class="badge salmon">Belum dibayar</span> …</div>` tambahkan:

```blade
              <div><span class="badge amber">Lunas · menunggu psikolog</span> Klien sudah membayar; psikolog belum menyetujui. Jadwalnya terkunci dan klien belum menerima konfirmasi.</div>
```

dan tepat setelah baris `<div><span class="badge red">Ditolak psikolog</span> / <span class="badge red">Batal</span> …</div>` tambahkan:

```blade
              <div><span class="badge red">Ditolak · perlu refund</span> / <span class="badge red">Batal · perlu refund</span> Klien sudah membayar tapi sesinya tidak jadi. Kembalikan dananya, lalu tandai di halaman Persetujuan.</div>
```

- [ ] **Step 7: `public/css/app.css`**

Tepat setelah baris `.badge.red { background: #FCE9E7; color: #E0594E; }` tambahkan:

```css
/* Lunas, menunggu psikolog (approval psikolog). Sengaja bukan salmon: salmon
   berarti "belum dibayar", dan keduanya tidak boleh terbaca sama. */
.badge.amber { background: #FFF4E0; color: #A86A00; }
```

- [ ] **Step 8: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'LabelStatusJanjiTest|AppointmentsApprovalTest|SessionStatusTest|Dashboard'
```

Expected: semua PASS.

- [ ] **Step 9: Commit**

```bash
git add app/Services/LabelStatusJanji.php app/Http/Controllers/DashboardController.php app/Http/Controllers/SessionStatusController.php resources/views/dashboard.blade.php public/css/app.css tests/Unit/LabelStatusJanjiTest.php tests/Feature/AppointmentsApprovalTest.php tests/Feature/SessionStatusTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(appointments): label dan aksi untuk booking yang menunggu psikolog

LabelStatusJanji menyatukan label dan warna status. Booking lunas yang
menunggu psikolog berlabel "Lunas · menunggu psikolog" (amber), mendapat
Setujui/Tolak alih-alih "tandai lunas", dan punya saringan sendiri.
Hasil aksi status diambil dari jawaban backend.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F3: Halaman Persetujuan — antrean, detail, setujui, tolak, refund

**Files:**
- Create: `app/Http/Controllers/PersetujuanController.php`
- Create: `resources/views/dashboard/persetujuan.blade.php`
- Create: `resources/views/dashboard/persetujuan-detail.blade.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/PersetujuanTest.php`

**Interfaces:**
- Consumes: `GET api/v1/sessions/approvals`, `GET api/v1/sessions/{id}/approval`, `POST api/v1/sessions/{id}/approve|reject|refund-done` (B7, B5); `LabelStatusJanji` (F2).
- Produces:
  - `PersetujuanController::boleh(): bool` — psikolog, super admin, atau admin klinik asli (`canManageClinicPayment`). Dipakai F5.
  - Helper tampilan publik statis: `jadwal(array $s): string`, `mendesak(array $s): bool`, `nominal(?array $p): ?string`, `sejak(?string $iso): string`.
  - Route bernama: `persetujuan` (GET `/dashboard/persetujuan`), `persetujuan.detail`, `persetujuan.setujui`, `persetujuan.tolak`, `persetujuan.refund`.
  - Flash: `persetujuanPesan`, `persetujuanGagal`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/PersetujuanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Halaman Persetujuan (approval psikolog). Psikolog: antreannya sendiri.
// Admin klinik asli dan super admin: antrean klinik + tab Perlu refund.
// Resepsionis dan tamu tidak masuk — 404 sebelum satu request pun ke backend.
class PersetujuanTest extends TestCase
{
    private const ITEM = [
        'id' => 88,
        'clinicId' => 4,
        'professionalId' => 120,
        'professionalName' => 'Dianda Psikolog',
        'clientName' => 'Ada Lovelace',
        'slotDate' => '2026-10-22',
        'startTime' => '10:00:00',
        'endTime' => '11:00:00',
        'timezone' => 'Asia/Jakarta',
        'status' => 'PENDING',
        'serviceIds' => [3],
        'serviceName' => 'Konseling Individu',
        'approval' => [
            'state' => 'AWAITING',
            'requestedAt' => '2026-10-20T02:00:00.000Z',
            'decidedAt' => null,
            'decidedByName' => null,
            'rejectReason' => null,
            'refundStatus' => 'NONE',
            'refundedAt' => null,
            'refundedByName' => null,
            'refundNote' => null,
            'isOverdue' => false,
            'payment' => ['gateway' => 'xendit', 'wcOrderId' => 49863, 'expectedAmount' => 350000, 'chargedAmount' => 350000, 'chargedCurrency' => 'IDR'],
        ],
    ];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf', 'userId' => 9],
                $extra,
            ),
        ];
    }

    private function psikolog(): array
    {
        return $this->sesi('psikolog', ['name' => 'Dianda Psikolog', 'professionalId' => 120]);
    }

    private function admin(): array
    {
        return $this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]);
    }

    private function fakeAntrean(array $item = [self::ITEM], array $counts = ['awaiting' => 1, 'refundNeeded' => 2]): void
    {
        Http::fake([
            '*/api/v1/sessions/approvals*' => Http::response([
                'data' => $item,
                'pagination' => ['currentPage' => 1, 'totalPages' => 1, 'totalItems' => count($item), 'itemsPerPage' => 20],
                'counts' => $counts,
            ]),
        ]);
    }

    public function test_resepsionis_dan_tamu_tidak_masuk(): void
    {
        Http::fake();

        $this->withSession($this->sesi('admin', ['practiceId' => 4]))->get('/dashboard/persetujuan')->assertNotFound();
        $this->get('/dashboard/persetujuan')->assertRedirect('/staff/login');
        Http::assertNothingSent();
    }

    public function test_psikolog_melihat_antreannya_tanpa_tab_refund(): void
    {
        $this->fakeAntrean();

        $res = $this->withSession($this->psikolog())->get('/dashboard/persetujuan');

        $res->assertOk()
            ->assertSee('Ada Lovelace')
            ->assertSee('Konseling Individu')
            ->assertSee('Rp350.000')
            ->assertSee('/dashboard/persetujuan/88', false)
            ->assertDontSee('Perlu refund');
        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'state=AWAITING'));
    }

    public function test_admin_melihat_tab_refund_dengan_jumlahnya(): void
    {
        $this->fakeAntrean();

        $this->withSession($this->admin())->get('/dashboard/persetujuan')
            ->assertOk()->assertSee('Perlu refund')->assertSee('Dianda Psikolog');
    }

    public function test_tab_refund_meminta_state_yang_benar(): void
    {
        $this->fakeAntrean([]);

        $this->withSession($this->admin())->get('/dashboard/persetujuan?tab=refund')->assertOk();
        $this->withSession($this->admin())->get('/dashboard/persetujuan?tab=refund&selesai=1')->assertOk();

        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'state=REFUND_NEEDED'));
        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'state=REFUNDED'));
    }

    public function test_antrean_gagal_dimuat_dijelaskan(): void
    {
        // 404, bukan 5xx: PraktiquApi mengulang GET yang dijawab 5xx, dan tes jadi lambat.
        Http::fake(['*/api/v1/sessions/approvals*' => Http::response(['message' => 'down'], 404)]);

        $this->withSession($this->psikolog())->get('/dashboard/persetujuan')
            ->assertOk()->assertSee('Daftar persetujuan tidak bisa dimuat.');
    }

    public function test_detail_menawarkan_setujui_dan_tolak(): void
    {
        Http::fake(['*/api/v1/sessions/88/approval' => Http::response(['data' => self::ITEM])]);

        $this->withSession($this->psikolog())->get('/dashboard/persetujuan/88')
            ->assertOk()
            ->assertSee('Setujui jadwal')
            ->assertSee('name="alasan"', false)
            ->assertSee('Lunas · menunggu psikolog')
            ->assertDontSee('Tandai sudah direfund');
    }

    public function test_detail_yang_terlewat_mengunci_setujui(): void
    {
        $item = self::ITEM;
        $item['approval']['isOverdue'] = true;
        Http::fake(['*/api/v1/sessions/88/approval' => Http::response(['data' => $item])]);

        $this->withSession($this->psikolog())->get('/dashboard/persetujuan/88')
            ->assertOk()
            ->assertSee('Jam sesi sudah lewat')
            ->assertSee('disabled', false);
    }

    public function test_detail_404_untuk_sesi_tanpa_approval_atau_di_luar_scope(): void
    {
        Http::fake([
            '*/api/v1/sessions/88/approval' => Http::response(['title' => 'approval_not_found', 'status' => 404], 404),
            '*/api/v1/sessions/89/approval' => Http::response(['title' => 'forbidden', 'status' => 403], 403),
        ]);

        $this->withSession($this->psikolog())->get('/dashboard/persetujuan/88')->assertNotFound();
        $this->withSession($this->psikolog())->get('/dashboard/persetujuan/89')->assertNotFound();
    }

    public function test_setujui_memanggil_approve_lalu_kembali_ke_detail(): void
    {
        Http::fake(['*/api/v1/sessions/88/approve' => Http::response(['data' => self::ITEM])]);

        $this->withSession($this->psikolog())->post('/dashboard/persetujuan/88/setujui')
            ->assertRedirect('/dashboard/persetujuan/88')
            ->assertSessionHas('persetujuanPesan');
        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/sessions/88/approve'));
    }

    public function test_setujui_yang_kalah_balapan_dijelaskan(): void
    {
        Http::fake(['*/api/v1/sessions/88/approve' => Http::response(['title' => 'approval_already_decided', 'status' => 409], 409)]);

        $this->withSession($this->psikolog())->post('/dashboard/persetujuan/88/setujui')
            ->assertSessionHas('persetujuanGagal', 'Permintaan ini sudah diputuskan. Muat ulang halaman untuk melihat keputusannya.');
    }

    public function test_tolak_wajib_alasan(): void
    {
        Http::fake();

        $this->withSession($this->psikolog())->post('/dashboard/persetujuan/88/tolak', ['alasan' => ''])
            ->assertSessionHasErrors('alasan');
        Http::assertNothingSent();
    }

    public function test_tolak_mengirim_alasan(): void
    {
        Http::fake(['*/api/v1/sessions/88/reject' => Http::response(['data' => self::ITEM])]);

        $this->withSession($this->psikolog())->post('/dashboard/persetujuan/88/tolak', ['alasan' => '  Di luar keahlian saya  '])
            ->assertRedirect('/dashboard/persetujuan/88')
            ->assertSessionHas('persetujuanPesan');
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/reject') && json_decode($r->body(), true) === ['reason' => 'Di luar keahlian saya']);
    }

    public function test_psikolog_tidak_bisa_menandai_refund(): void
    {
        Http::fake();

        $this->withSession($this->psikolog())->post('/dashboard/persetujuan/88/refund')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_admin_menandai_refund_dengan_catatan(): void
    {
        Http::fake(['*/api/v1/sessions/88/refund-done' => Http::response(['data' => self::ITEM['approval']])]);

        $this->withSession($this->admin())->post('/dashboard/persetujuan/88/refund', ['catatan' => 'Transfer BCA 21/10'])
            ->assertRedirect('/dashboard/persetujuan/88')
            ->assertSessionHas('persetujuanPesan', 'Refund ditandai selesai.');
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/refund-done') && json_decode($r->body(), true) === ['note' => 'Transfer BCA 21/10']);
    }

    public function test_detail_refund_untuk_admin(): void
    {
        $item = self::ITEM;
        $item['status'] = 'CANCELLED';
        $item['approval'] = array_merge($item['approval'], [
            'state' => 'REJECTED', 'refundStatus' => 'NEEDED', 'rejectReason' => 'Jadwal bentrok', 'decidedByName' => 'Dianda Psikolog',
        ]);
        Http::fake(['*/api/v1/sessions/88/approval' => Http::response(['data' => $item])]);

        $this->withSession($this->admin())->get('/dashboard/persetujuan/88')
            ->assertOk()
            ->assertSee('Ditolak · perlu refund')
            ->assertSee('Jadwal bentrok')
            ->assertSee('#49863')
            ->assertSee('Tandai sudah direfund')
            ->assertDontSee('Setujui jadwal');
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter PersetujuanTest
```

Expected: FAIL. Route belum ada (404 di semua halaman; `test_resepsionis_dan_tamu_tidak_masuk` gagal karena GET tanpa sesi tidak dialihkan ke login).

- [ ] **Step 3: `app/Http/Controllers/PersetujuanController.php`**

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\LabelStatusJanji;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\View\View;

/**
 * Approval psikolog: booking online yang sudah dibayar menunggu persetujuan
 * psikolognya. Spec backend: docs/superpowers/specs/2026-10-19-approval-psikolog-design.md;
 * kontrak: docs/api/APPROVAL-PSIKOLOG-GUIDE.md (keduanya di repo backend).
 *
 * Halaman tersendiri, bukan tampilan di SPA dashboard: tautan di email menuju
 * /dashboard/persetujuan/{id}, dan SPA tidak punya URL per tampilan.
 *
 * Yang berhak: psikolog (antreannya sendiri), admin klinik ASLI
 * (canManageClinicPayment — resepsionis juga 'admin' di FE ini, dan backend
 * menolak mereka), dan super admin. Selain itu 404 sebelum satu request pun
 * ke backend; backend menegakkan aturan yang sama.
 */
class PersetujuanController extends Controller
{
    /** Tab yang ada di halaman ini. 'pengaturan' ditambahkan Task F4. */
    private const TAB = ['menunggu', 'refund', 'riwayat'];

    public function __construct(private readonly PraktiquApi $api) {}

    public static function boleh(): bool
    {
        $p = AuthController::validProfile() ?? [];

        return match ($p['role'] ?? null) {
            'psikolog', 'super' => true,
            'admin' => ! empty($p['canManageClinicPayment']),
            default => false,
        };
    }

    private static function peran(): string
    {
        return (string) (AuthController::validProfile()['role'] ?? '');
    }

    public function index(Request $request): View
    {
        abort_unless(self::boleh(), 404);
        $peran = self::peran();

        $tab = in_array($request->query('tab'), self::TAB, true) ? (string) $request->query('tab') : 'menunggu';
        // Refund dikerjakan admin klinik, bukan psikolog.
        if ($tab === 'refund' && $peran === 'psikolog') {
            $tab = 'menunggu';
        }
        $selesai = $request->boolean('selesai');
        $halaman = max(1, (int) $request->query('halaman', 1));

        $state = match ($tab) {
            'refund' => $selesai ? 'REFUNDED' : 'REFUND_NEEDED',
            'riwayat' => 'DECIDED',
            default => 'AWAITING',
        };

        $data = [
            'peran' => $peran,
            'tab' => $tab,
            'selesai' => $selesai,
            'kembali' => AuthController::ROLE_DEST[$peran] ?? '/',
            'item' => [],
            'pagination' => null,
            'counts' => ['awaiting' => 0, 'refundNeeded' => 0],
            'gagal' => false,
        ];

        try {
            $res = $this->api->get('api/v1/sessions/approvals', ['state' => $state, 'page' => $halaman, 'limit' => 20]);
            $data['item'] = is_array($res['data'] ?? null) ? $res['data'] : [];
            $data['pagination'] = is_array($res['pagination'] ?? null) ? $res['pagination'] : null;
            $data['counts'] = [
                'awaiting' => (int) ($res['counts']['awaiting'] ?? 0),
                'refundNeeded' => (int) ($res['counts']['refundNeeded'] ?? 0),
            ];
        } catch (ApiException $e) {
            logger()->warning('[persetujuan] antrean gagal dimuat: '.$e->getMessage(), ['status' => $e->status]);
            $data['gagal'] = true;
        }

        return view('dashboard.persetujuan', $data);
    }

    public function detail(string $id): View
    {
        abort_unless(self::boleh(), 404);

        try {
            $item = $this->api->get("api/v1/sessions/{$id}/approval");
        } catch (ApiException $e) {
            abort(in_array($e->status, [401, 403, 404], true) ? 404 : 503, 'Permintaan ini tidak ditemukan atau bukan milik Anda.');
        }
        abort_unless(is_array($item) && is_array($item['approval'] ?? null), 404);

        return view('dashboard.persetujuan-detail', [
            'peran' => self::peran(),
            'item' => $item,
            'label' => LabelStatusJanji::label((string) ($item['status'] ?? ''), $item['approval']),
            'kembali' => route('persetujuan', [], false),
        ]);
    }

    public function setujui(string $id): RedirectResponse
    {
        abort_unless(self::boleh(), 404);
        $kembali = redirect()->route('persetujuan.detail', ['id' => $id]);

        try {
            $this->api->post("api/v1/sessions/{$id}/approve", null);
        } catch (ApiException $e) {
            return $kembali->with('persetujuanGagal', self::pesanGagal($e, 'menyetujui'));
        }

        return $kembali->with('persetujuanPesan', 'Jadwal disetujui. Klien menerima email konfirmasi dan pengingat sesi.');
    }

    public function tolak(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::boleh(), 404);
        $data = $request->validate(['alasan' => 'required|string|max:500'], [
            'alasan.required' => 'Tulis alasan penolakannya. Alasan ini hanya untuk catatan internal — klien menerima pesan standar.',
            'alasan.max' => 'Alasan paling panjang 500 karakter.',
        ]);
        $kembali = redirect()->route('persetujuan.detail', ['id' => $id]);

        try {
            $this->api->post("api/v1/sessions/{$id}/reject", ['reason' => trim($data['alasan'])]);
        } catch (ApiException $e) {
            return $kembali->with('persetujuanGagal', self::pesanGagal($e, 'menolak'));
        }

        return $kembali->with('persetujuanPesan', 'Permintaan ditolak. Klien sudah diberi tahu, dan sesi ini masuk daftar Perlu refund.');
    }

    public function refund(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::boleh() && self::peran() !== 'psikolog', 404);
        $data = $request->validate(['catatan' => 'nullable|string|max:500'], [
            'catatan.max' => 'Catatan paling panjang 500 karakter.',
        ]);
        $catatan = trim((string) ($data['catatan'] ?? ''));
        $kembali = redirect()->route('persetujuan.detail', ['id' => $id]);

        try {
            // Selalu objek: backend memakai skema objek ketat, dan post() tanpa
            // badan mengirim `[]` (larik JSON) yang ditolaknya.
            $this->api->post("api/v1/sessions/{$id}/refund-done", ['note' => $catatan === '' ? null : $catatan]);
        } catch (ApiException $e) {
            return $kembali->with('persetujuanGagal', self::pesanGagal($e, 'menandai refund'));
        }

        return $kembali->with('persetujuanPesan', 'Refund ditandai selesai.');
    }

    private static function pesanGagal(ApiException $e, string $aksi): string
    {
        // Problem+json backend menaruh kodenya di `title`.
        $kode = is_array($e->body) ? ($e->body['title'] ?? null) : null;

        return match (true) {
            // 400 dari /approve = perpindahan status tidak sah: sesinya sudah
            // bukan PENDING, artinya sudah diputuskan di tempat lain.
            $kode === 'approval_already_decided', $e->status === 400 => 'Permintaan ini sudah diputuskan. Muat ulang halaman untuk melihat keputusannya.',
            $kode === 'session_already_started' => 'Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.',
            $kode === 'refund_not_needed' => 'Refund ini sudah ditandai sebelumnya.',
            in_array($e->status, [401, 403], true) => "Anda tidak berwenang {$aksi} permintaan ini.",
            $e->status === 404 => 'Permintaan ini tidak ditemukan atau bukan milik Anda.',
            $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah perubahan tersimpan. Muat ulang halaman untuk melihat keadaan terbarunya.',
            default => $e->getMessage() ?: 'Permintaan gagal diproses.',
        };
    }

    /** "Kamis, 22 Okt 2026 · 10:00" — tanggal dan jam lokal klinik, apa adanya dari backend. */
    public static function jadwal(array $s): string
    {
        $tgl = (string) ($s['slotDate'] ?? '');
        if ($tgl === '') {
            return '—';
        }
        $jam = substr((string) ($s['startTime'] ?? ''), 0, 5);

        return Carbon::parse($tgl)->locale('id')->translatedFormat('l, j M Y').($jam !== '' ? ' · '.$jam : '');
    }

    /** Sesi yang menunggu dan dimulai kurang dari 24 jam lagi: ditandai mencolok. */
    public static function mendesak(array $s): bool
    {
        $tgl = (string) ($s['slotDate'] ?? '');
        $jam = (string) ($s['startTime'] ?? '');
        if ($tgl === '' || $jam === '' || ($s['approval']['state'] ?? null) !== 'AWAITING') {
            return false;
        }
        $mulai = Carbon::parse("{$tgl} {$jam}", (string) ($s['timezone'] ?? 'Asia/Jakarta'));

        return $mulai->isFuture() && $mulai->lessThan(now()->addDay());
    }

    /** Yang dibayar klien: USD dua desimal, rupiah tanpa desimal. null tanpa order. */
    public static function nominal(?array $p): ?string
    {
        if (! $p) {
            return null;
        }
        $jumlah = $p['chargedAmount'] ?? $p['expectedAmount'] ?? null;
        if ($jumlah === null) {
            return null;
        }

        return strtoupper((string) ($p['chargedCurrency'] ?? 'IDR')) === 'USD'
            ? '$'.number_format((float) $jumlah, 2)
            : 'Rp'.number_format((float) $jumlah, 0, ',', '.');
    }

    /** "2 hari yang lalu" — sudah berapa lama permintaan ini menunggu. */
    public static function sejak(?string $iso): string
    {
        return $iso ? Carbon::parse($iso)->locale('id')->diffForHumans() : '—';
    }
}
```

- [ ] **Step 4: Route**

Di `routes/web.php`, tepat setelah baris route `Route::post('/dashboard/sesi/{appointment}/status', [SessionStatusController::class, 'update'])->whereNumber('appointment');` (di dalam grup `staff:any` + `klinik.halaman`), tambahkan:

```php
    // Approval psikolog — halaman tersendiri (PersetujuanController). Di atas
    // catch-all /dashboard/{resource}/… di akhir grup ini, supaya tidak
    // tertangkap olehnya. Peran dicek di controller (404 untuk yang tak berhak).
    Route::get('/dashboard/persetujuan', [\App\Http\Controllers\PersetujuanController::class, 'index'])->name('persetujuan');
    Route::get('/dashboard/persetujuan/{id}', [\App\Http\Controllers\PersetujuanController::class, 'detail'])->whereNumber('id')->name('persetujuan.detail');
    Route::post('/dashboard/persetujuan/{id}/setujui', [\App\Http\Controllers\PersetujuanController::class, 'setujui'])->whereNumber('id')->name('persetujuan.setujui');
    Route::post('/dashboard/persetujuan/{id}/tolak', [\App\Http\Controllers\PersetujuanController::class, 'tolak'])->whereNumber('id')->name('persetujuan.tolak');
    Route::post('/dashboard/persetujuan/{id}/refund', [\App\Http\Controllers\PersetujuanController::class, 'refund'])->whereNumber('id')->name('persetujuan.refund');
```

- [ ] **Step 5: `resources/views/dashboard/persetujuan.blade.php`**

```blade
@extends('layouts.base')

{{-- Approval psikolog — lihat PersetujuanController. Halaman tersendiri,
     mengikuti dashboard/klinik-pemilik.blade.php: tautan di email harus bisa
     membuka halaman ini langsung, dan SPA dashboard tidak punya URL per tampilan. --}}

@php
  // Nama kelas sebagai variabel, bukan `use`: blok @php dikompilasi di tengah
  // berkas view, dan impor di sana tidak aman.
  $P = \App\Http\Controllers\PersetujuanController::class;
  $L = \App\Services\LabelStatusJanji::class;

  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';

  $tabs = ['menunggu' => 'Menunggu', 'refund' => 'Perlu refund', 'riwayat' => 'Riwayat'];
  if ($peran === 'psikolog') {
      unset($tabs['refund']);
  }
  $angka = ['menunggu' => $counts['awaiting'], 'refund' => $counts['refundNeeded']];
  $kosong = match ($tab) {
      'refund' => $selesai ? 'Belum ada refund yang ditandai selesai.' : 'Tidak ada refund yang perlu diproses.',
      'riwayat' => 'Belum ada permintaan yang diputuskan.',
      default => 'Tidak ada booking yang menunggu persetujuan.',
  };
@endphp

@section('title', 'Persetujuan Booking — PraktiQu')

@section('content')
<div style="max-width:960px;margin:0 auto;padding:28px 20px 64px">

  <a href="{{ $kembali }}" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke dashboard</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 6px">Persetujuan Booking</h1>
  <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 22px">
    @if ($peran === 'psikolog')
      Booking online yang sudah dibayar dan menunggu persetujuan Anda. Jadwalnya terkunci, dan klien baru
      menerima konfirmasi setelah Anda menyetujui.
    @else
      Booking online yang sudah dibayar dan menunggu persetujuan psikolog. Anda bisa memutuskan atas nama
      psikolog, dan menandai refund setelah dana klien dikembalikan.
    @endif
  </p>

  @if (session('persetujuanPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">
      {{ session('persetujuanPesan') }}
    </div>
  @endif
  @if (session('persetujuanGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">
      {{ session('persetujuanGagal') }}
    </div>
  @endif

  <nav aria-label="Tab persetujuan" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1.5px solid {{ $garis }};margin-bottom:20px">
    @foreach ($tabs as $kunci => $judul)
      <a href="{{ route('persetujuan', ['tab' => $kunci], false) }}" @if ($tab === $kunci) aria-current="page" @endif
         style="padding:10px 14px;font-size:14px;font-weight:700;text-decoration:none;margin-bottom:-1.5px;border-bottom:2.5px solid {{ $tab === $kunci ? $aksen : 'transparent' }};color:{{ $tab === $kunci ? $aksen : $redup }}">
        {{ $judul }}
        @if (! empty($angka[$kunci]))
          <span style="margin-left:6px;font-size:12px;padding:2px 8px;border-radius:99px;background:{{ $kunci === 'refund' ? '#FCE9E7' : '#FFF4E0' }};color:{{ $kunci === 'refund' ? '#E0594E' : '#A86A00' }}">{{ $angka[$kunci] }}</span>
        @endif
      </a>
    @endforeach
  </nav>

  @if ($tab === 'refund')
    <div style="margin:-6px 0 16px;font-size:13px">
      @if ($selesai)
        <a href="{{ route('persetujuan', ['tab' => 'refund'], false) }}" style="color:{{ $aksen }}">← Kembali ke yang perlu refund</a>
      @else
        <a href="{{ route('persetujuan', ['tab' => 'refund', 'selesai' => 1], false) }}" style="color:{{ $aksen }}">Lihat yang sudah direfund</a>
      @endif
    </div>
  @endif

  @if ($gagal)
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px">
      <div style="font-size:14px;font-weight:700;color:#9B2C2C">Daftar persetujuan tidak bisa dimuat.</div>
      <div style="font-size:13px;color:#7A3B3B;margin-top:4px;line-height:1.6">Tidak ada yang diubah. Muat ulang halaman untuk mencoba lagi.</div>
    </div>
  @elseif (count($item) === 0)
    <div style="font-size:14px;color:{{ $redup }};line-height:1.6">{{ $kosong }}</div>
  @else
    <div style="border:1.5px solid {{ $garis }};border-radius:16px;overflow:hidden">
      @foreach ($item as $i => $s)
        @php
          $a = is_array($s['approval'] ?? null) ? $s['approval'] : [];
          $terlewat = ! empty($a['isOverdue']);
          $mendesak = $P::mendesak($s);
        @endphp
        <a href="{{ route('persetujuan.detail', ['id' => $s['id']], false) }}"
           style="display:flex;gap:16px;align-items:center;padding:16px 18px;text-decoration:none;color:inherit;{{ $i > 0 ? 'border-top:1px solid #F0F1F6;' : '' }}{{ $mendesak ? 'background:#FFF9EE;' : '' }}">
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:700;color:{{ $teks }}">{{ $s['clientName'] ?? '—' }}</div>
            <div style="font-size:13px;color:{{ $redup }};margin-top:3px;line-height:1.5">
              {{ $s['serviceName'] ?? 'Sesi' }} · {{ $P::jadwal($s) }}
              @if ($peran !== 'psikolog') · {{ $s['professionalName'] ?? '—' }} @endif
            </div>
          </div>
          <div style="text-align:right;flex:none">
            <div style="font-size:14px;font-weight:700;color:{{ $teks }}">{{ $P::nominal($a['payment'] ?? null) ?? '—' }}</div>
            <div style="font-size:12px;margin-top:3px;color:{{ $terlewat || $mendesak ? '#B3261E' : $redup }}">
              @if ($tab === 'menunggu')
                {{ $terlewat ? 'Terlewat' : ($mendesak ? 'Kurang dari 24 jam lagi' : 'Menunggu sejak '.$P::sejak($a['requestedAt'] ?? null)) }}
              @else
                {{ $L::label((string) ($s['status'] ?? ''), $a) }}
              @endif
            </div>
          </div>
        </a>
      @endforeach
    </div>

    @if (($pagination['totalPages'] ?? 1) > 1)
      @php $hal = (int) ($pagination['currentPage'] ?? 1); @endphp
      <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13.5px">
        @if ($hal > 1)
          <a href="{{ route('persetujuan', ['tab' => $tab, 'selesai' => $selesai ? 1 : null, 'halaman' => $hal - 1], false) }}" style="color:{{ $aksen }}">← Sebelumnya</a>
        @else <span></span> @endif
        <span style="color:{{ $redup }}">Halaman {{ $hal }} dari {{ $pagination['totalPages'] }}</span>
        @if ($hal < (int) $pagination['totalPages'])
          <a href="{{ route('persetujuan', ['tab' => $tab, 'selesai' => $selesai ? 1 : null, 'halaman' => $hal + 1], false) }}" style="color:{{ $aksen }}">Berikutnya →</a>
        @else <span></span> @endif
      </div>
    @endif
  @endif
</div>
@endsection
```

- [ ] **Step 6: `resources/views/dashboard/persetujuan-detail.blade.php`**

```blade
@extends('layouts.base')

{{-- Satu permintaan approval psikolog — lihat PersetujuanController::detail.
     Tujuan tautan di email psikolog dan admin klinik. --}}

@php
  $P = \App\Http\Controllers\PersetujuanController::class;

  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';

  $a = $item['approval'];
  $menunggu = ($a['state'] ?? null) === 'AWAITING';
  $terlewat = ! empty($a['isOverdue']);
  $staf = $peran !== 'psikolog';
  $bayar = $a['payment'] ?? null;
  $baris = array_filter([
      'Layanan' => $item['serviceName'] ?? 'Sesi',
      'Jadwal' => $P::jadwal($item),
      'Psikolog' => $item['professionalName'] ?? '—',
      'Dibayar' => $P::nominal($bayar)
          ? $P::nominal($bayar).($staf ? ' · '.strtoupper((string) ($bayar['gateway'] ?? '')).' · order #'.($bayar['wcOrderId'] ?? '—') : '')
          : 'Ditandai lunas manual oleh staf',
      'Diminta' => $P::sejak($a['requestedAt'] ?? null),
      'Diputuskan oleh' => ($a['decidedByName'] ?? null) ?: (($a['decidedAt'] ?? null) ? 'Sistem' : null),
      'Alasan penolakan' => $staf ? ($a['rejectReason'] ?? null) : null,
      'Direfund oleh' => $a['refundedByName'] ?? null,
      'Catatan refund' => $a['refundNote'] ?? null,
  ], fn ($v) => $v !== null && $v !== '');
@endphp

@section('title', 'Permintaan Booking — PraktiQu')

@section('content')
<div style="max-width:720px;margin:0 auto;padding:28px 20px 64px">

  <a href="{{ $kembali }}" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke daftar persetujuan</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 8px">{{ $item['clientName'] ?? 'Klien' }}</h1>
  <span style="display:inline-block;font-size:12.5px;font-weight:700;padding:5px 12px;border-radius:8px;margin-bottom:20px;background:{{ $menunggu ? '#FFF4E0' : '#F2F3F7' }};color:{{ $menunggu ? '#A86A00' : '#5A5F7A' }}">{{ $label }}</span>

  @if (session('persetujuanPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">
      {{ session('persetujuanPesan') }}
    </div>
  @endif
  @if (session('persetujuanGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">
      {{ session('persetujuanGagal') }}
    </div>
  @endif

  <dl style="border:1.5px solid {{ $garis }};border-radius:16px;padding:18px 20px;margin:0 0 20px;display:grid;grid-template-columns:150px 1fr;gap:10px 16px;font-size:14px">
    @foreach ($baris as $judul => $isi)
      <dt style="color:{{ $redup }}">{{ $judul }}</dt>
      <dd style="margin:0;color:{{ $teks }};font-weight:600">{{ $isi }}</dd>
    @endforeach
  </dl>

  @if ($menunggu)
    @if ($terlewat)
      <div style="font-size:13.5px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:12px;padding:12px 14px;line-height:1.6;margin-bottom:14px">
        Jam sesi sudah lewat — permintaan ini hanya bisa ditolak. Dana klien akan masuk daftar Perlu refund.
      </div>
    @endif

    <form method="POST" action="{{ route('persetujuan.setujui', ['id' => $item['id']]) }}" style="margin-bottom:14px">
      @csrf
      <button type="submit" @disabled($terlewat)
              style="border:none;background:{{ $terlewat ? '#B9C2DB' : $aksen }};color:#fff;border-radius:11px;padding:12px 22px;font-size:14px;font-weight:700;cursor:{{ $terlewat ? 'not-allowed' : 'pointer' }}">
        Setujui jadwal
      </button>
      <div style="font-size:12.5px;color:{{ $redup }};margin-top:6px">Klien menerima email konfirmasi dan pengingat sesi.</div>
    </form>

    <form method="POST" action="{{ route('persetujuan.tolak', ['id' => $item['id']]) }}"
          style="border:1.5px solid {{ $garis }};border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:10px">
      @csrf
      <label for="alasan" style="font-size:14px;font-weight:700;color:{{ $teks }}">Alasan penolakan (wajib, hanya untuk catatan internal)</label>
      <textarea id="alasan" name="alasan" maxlength="500" required rows="3"
                style="border:1.5px solid {{ $garis }};border-radius:10px;padding:10px 12px;font:inherit;font-size:14px">{{ old('alasan') }}</textarea>
      @error('alasan')
        <div style="font-size:13px;color:#9B2C2C">{{ $message }}</div>
      @enderror
      <div style="font-size:12.5px;color:{{ $redup }};line-height:1.55">
        Klien menerima pesan standar bahwa jadwal ini tidak dapat diterima dan dananya akan dikembalikan oleh klinik.
        Sesi ini lalu masuk daftar Perlu refund.
      </div>
      <div>
        <button type="submit" style="border:none;background:#F2756A;color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">Tolak permintaan</button>
      </div>
    </form>
  @endif

  @if ($staf && ($a['refundStatus'] ?? null) === 'NEEDED')
    <form method="POST" action="{{ route('persetujuan.refund', ['id' => $item['id']]) }}"
          style="border:1.5px solid #F0C9C9;background:#FDF8F8;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:10px;margin-top:16px">
      @csrf
      <div style="font-size:14px;font-weight:700;color:{{ $teks }}">Perlu refund</div>
      <div style="font-size:13px;color:{{ $redup }};line-height:1.6">
        Kembalikan dana klien lewat dashboard Xendit, PayPal, atau WooCommerce
        @if ($bayar) (order #{{ $bayar['wcOrderId'] ?? '—' }}) @endif,
        lalu tandai di sini.
      </div>
      <label for="catatan" style="font-size:13px;color:{{ $teks }}">Catatan (opsional)</label>
      <textarea id="catatan" name="catatan" maxlength="500" rows="2"
                style="border:1.5px solid {{ $garis }};border-radius:10px;padding:10px 12px;font:inherit;font-size:14px">{{ old('catatan') }}</textarea>
      @error('catatan')
        <div style="font-size:13px;color:#9B2C2C">{{ $message }}</div>
      @enderror
      <div>
        <button type="submit" style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">Tandai sudah direfund</button>
      </div>
    </form>
  @endif
</div>
@endsection
```

- [ ] **Step 7: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter PersetujuanTest
```

Expected: semua PASS.

Kalau `test_resepsionis_dan_tamu_tidak_masuk` gagal karena `/dashboard/persetujuan` tanpa sesi tidak dialihkan ke `/staff/login`, periksa bahwa route ditambahkan **di dalam** grup `staff:any`.

Kalau `assertSee('Rp350.000')` gagal karena format angka, periksa `$P::nominal`: pemisah ribuan titik, tanpa desimal.

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/PersetujuanController.php resources/views/dashboard/persetujuan.blade.php resources/views/dashboard/persetujuan-detail.blade.php routes/web.php tests/Feature/PersetujuanTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(persetujuan): halaman antrean dan detail approval psikolog

/dashboard/persetujuan menampilkan booking lunas yang menunggu psikolog,
yang perlu refund, dan riwayatnya. Halaman detail (tujuan tautan email)
untuk Setujui, Tolak dengan alasan internal, dan Tandai sudah direfund.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F4: Tab Pengaturan — saklar per psikolog

**Files:**
- Modify: `app/Http/Controllers/PersetujuanController.php`
- Create: `resources/views/dashboard/persetujuan-pengaturan.blade.php`
- Modify: `resources/views/dashboard/persetujuan.blade.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/PersetujuanPengaturanTest.php`

**Interfaces:**
- Consumes: `GET|PUT api/v1/professionals/{id}/approval-setting` (B7); `requiresApproval` di `GET api/v1/public/professionals?clinicId=` (B6); `GET api/v1/practices` (super admin); `DashboardController::asArray()`.
- Produces: route `persetujuan.pengaturan` (POST `/dashboard/persetujuan/pengaturan/{professionalId}`, field `aktif` = `1`/`0`, opsional `klinik`); tab `?tab=pengaturan` (super admin: `&klinik={id}`).

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/PersetujuanPengaturanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Saklar "butuh persetujuan saya untuk booking online". Psikolog: saklarnya
// sendiri. Admin klinik: psikolog klinik aktifnya. Super admin: pilih klinik.
class PersetujuanPengaturanTest extends TestCase
{
    private const URL = '/dashboard/persetujuan?tab=pengaturan';

    private const ANTREAN = ['data' => [], 'pagination' => ['currentPage' => 1, 'totalPages' => 1], 'counts' => ['awaiting' => 0, 'refundNeeded' => 0]];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Dianda Psikolog', 'userId' => 9],
                $extra,
            ),
        ];
    }

    public function test_psikolog_melihat_saklarnya_sendiri(): void
    {
        Http::fake([
            '*/api/v1/sessions/approvals*' => Http::response(self::ANTREAN),
            '*/api/v1/professionals/120/approval-setting' => Http::response(['data' => [
                'professionalId' => 120, 'requiresApproval' => true, 'updatedAt' => null, 'updatedByName' => null,
            ]]),
        ]);

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))->get(self::URL)
            ->assertOk()
            ->assertSee('Dianda Psikolog')
            ->assertSee('Menyala')
            ->assertSee('/dashboard/persetujuan/pengaturan/120', false);
    }

    public function test_psikolog_menyimpan_saklarnya(): void
    {
        Http::fake(['*/api/v1/professionals/120/approval-setting' => Http::response(['data' => ['professionalId' => 120, 'requiresApproval' => true]])]);

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))
            ->post('/dashboard/persetujuan/pengaturan/120', ['aktif' => '1'])
            ->assertRedirect('/dashboard/persetujuan?tab=pengaturan')
            ->assertSessionHas('persetujuanPesan');
        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && json_decode($r->body(), true) === ['requiresApproval' => true]);
    }

    public function test_psikolog_tidak_bisa_mengubah_saklar_psikolog_lain(): void
    {
        Http::fake();

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))
            ->post('/dashboard/persetujuan/pengaturan/121', ['aktif' => '1'])
            ->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_admin_melihat_psikolog_kliniknya(): void
    {
        Http::fake([
            '*/api/v1/sessions/approvals*' => Http::response(self::ANTREAN),
            '*/api/v1/public/professionals*' => Http::response(['items' => [
                ['id' => 120, 'fullName' => 'Dianda Psikolog', 'requiresApproval' => true],
                ['id' => 121, 'fullName' => 'Pamela Dewi', 'requiresApproval' => false],
            ]]),
        ]);

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))->get(self::URL);

        $res->assertOk()->assertSee('Dianda Psikolog')->assertSee('Pamela Dewi')->assertSee('Menyala')->assertSee('Mati');
        Http::assertSent(fn (Request $r) => str_contains($r->url(), '/public/professionals') && str_contains($r->url(), 'clinicId=4'));
    }

    public function test_admin_menyimpan_dan_kembali_ke_tab(): void
    {
        Http::fake(['*/api/v1/professionals/121/approval-setting' => Http::response(['data' => ['professionalId' => 121, 'requiresApproval' => false]])]);

        $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))
            ->post('/dashboard/persetujuan/pengaturan/121', ['aktif' => '0'])
            ->assertRedirect('/dashboard/persetujuan?tab=pengaturan')
            ->assertSessionHas('persetujuanPesan');
        Http::assertSent(fn (Request $r) => json_decode($r->body(), true) === ['requiresApproval' => false]);
    }

    public function test_super_admin_memilih_klinik_dulu(): void
    {
        Http::fake([
            '*/api/v1/sessions/approvals*' => Http::response(self::ANTREAN),
            '*/api/v1/practices*' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat'], ['id' => 5, 'name' => 'Klinik Ceria']]]),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 120, 'fullName' => 'Dianda Psikolog', 'requiresApproval' => false]]]),
        ]);

        $tanpa = $this->withSession($this->sesi('super'))->get(self::URL);
        $tanpa->assertOk()->assertSee('Klinik Sehat')->assertSee('Pilih klinik');
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), '/public/professionals'));

        $this->withSession($this->sesi('super'))->get(self::URL.'&klinik=4')
            ->assertOk()->assertSee('Dianda Psikolog');
    }

    public function test_gagal_simpan_dijelaskan(): void
    {
        Http::fake(['*/api/v1/professionals/121/approval-setting' => Http::response(['title' => 'forbidden', 'status' => 403], 403)]);

        $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))
            ->post('/dashboard/persetujuan/pengaturan/121', ['aktif' => '1'])
            ->assertSessionHas('persetujuanGagal', 'Psikolog ini tidak ada di klinik Anda.');
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter PersetujuanPengaturanTest
```

Expected: FAIL. Tab `pengaturan` belum dikenal dan route POST belum ada.

- [ ] **Step 3: Controller**

Di `app/Http/Controllers/PersetujuanController.php`:

(a) Ganti konstanta `TAB` dan docblock-nya menjadi:

```php
    /** Tab yang ada di halaman ini. */
    private const TAB = ['menunggu', 'refund', 'riwayat', 'pengaturan'];
```

(b) Di `index()`, tambahkan `'pengaturan' => null,` ke larik `$data`, lalu tepat sebelum `try {` sisipkan:

```php
        if ($tab === 'pengaturan') {
            $data['pengaturan'] = $this->pengaturan($request, $peran);
        }
```

Tab Pengaturan tetap memanggil antrean di bawahnya, karena angka di tab Menunggu dan Perlu refund ikut ditampilkan. Larik `item` diabaikan oleh view untuk tab ini.

(c) Tambahkan dua method setelah `refund()`:

```php
    /**
     * Isi tab Pengaturan. Psikolog: saklarnya sendiri. Admin klinik: psikolog
     * klinik aktifnya. Super admin: psikolog klinik yang dipilih (?klinik=).
     * 'baris' null berarti gagal dimuat — tabelnya tidak ditampilkan, supaya
     * daftar kosong tidak terbaca "tidak ada psikolog".
     *
     * @return array{mode: string, klinikId: ?string, daftarKlinik: ?array, baris: ?array}
     */
    private function pengaturan(Request $request, string $peran): array
    {
        $profil = AuthController::validProfile() ?? [];

        if ($peran === 'psikolog') {
            $id = (string) ($profil['professionalId'] ?? '');
            $baris = null;
            if ($id !== '') {
                try {
                    $s = $this->api->get("api/v1/professionals/{$id}/approval-setting");
                    $baris = [['id' => $id, 'nama' => (string) ($profil['name'] ?? 'Anda'), 'aktif' => ! empty($s['requiresApproval'])]];
                } catch (ApiException $e) {
                    logger()->warning('[persetujuan] saklar psikolog gagal dimuat: '.$e->getMessage(), ['status' => $e->status]);
                }
            }

            return ['mode' => 'diri', 'klinikId' => null, 'daftarKlinik' => null, 'baris' => $baris];
        }

        $daftarKlinik = null;
        if ($peran === 'super') {
            $minta = (string) $request->query('klinik', '');
            $klinikId = preg_match('/^[1-9][0-9]{0,18}$/', $minta) ? $minta : null;
            try {
                $daftarKlinik = array_values(array_map(
                    fn ($k) => ['id' => (string) ($k['id'] ?? ''), 'nama' => (string) ($k['name'] ?? 'Klinik #'.($k['id'] ?? ''))],
                    DashboardController::asArray($this->api->get('api/v1/practices', ['limit' => 100])),
                ));
            } catch (ApiException $e) {
                logger()->warning('[persetujuan] daftar klinik gagal dimuat: '.$e->getMessage(), ['status' => $e->status]);
                $daftarKlinik = [];
            }
        } else {
            $klinikId = (string) ($profil['practiceId'] ?? '') ?: null;
        }

        // Super admin yang belum memilih klinik: belum ada yang perlu dimuat.
        $baris = $klinikId === null ? [] : null;
        if ($klinikId !== null) {
            try {
                $baris = array_values(array_map(
                    fn ($p) => ['id' => (string) ($p['id'] ?? ''), 'nama' => (string) ($p['fullName'] ?? '—'), 'aktif' => ! empty($p['requiresApproval'])],
                    DashboardController::asArray($this->api->get('api/v1/public/professionals', ['clinicId' => $klinikId])),
                ));
            } catch (ApiException $e) {
                logger()->warning("[persetujuan] roster klinik {$klinikId} gagal dimuat: ".$e->getMessage(), ['status' => $e->status]);
            }
        }

        return ['mode' => 'klinik', 'klinikId' => $klinikId, 'daftarKlinik' => $daftarKlinik, 'baris' => $baris];
    }

    public function simpanPengaturan(Request $request, string $professionalId): RedirectResponse
    {
        abort_unless(self::boleh(), 404);
        // Psikolog hanya untuk dirinya sendiri; admin dan super dibatasi backend
        // (canEdit di route-scope: klinik aktif yang memetakan psikolog itu).
        if (self::peran() === 'psikolog') {
            abort_unless((string) (AuthController::validProfile()['professionalId'] ?? '') === $professionalId, 404);
        }

        $aktif = $request->boolean('aktif');
        $klinik = (string) $request->input('klinik', '');
        $kembali = redirect()->route('persetujuan', array_filter([
            'tab' => 'pengaturan',
            'klinik' => preg_match('/^[1-9][0-9]{0,18}$/', $klinik) ? $klinik : null,
        ]));

        try {
            $this->api->call('PUT', "api/v1/professionals/{$professionalId}/approval-setting", [], ['requiresApproval' => $aktif]);
        } catch (ApiException $e) {
            return $kembali->with('persetujuanGagal', match (true) {
                in_array($e->status, [403, 404], true) => 'Psikolog ini tidak ada di klinik Anda.',
                $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah perubahan tersimpan. Muat ulang halaman untuk melihat pengaturan saat ini.',
                default => 'Pengaturan belum tersimpan.',
            });
        }

        return $kembali->with('persetujuanPesan', $aktif
            ? 'Disimpan. Mulai sekarang, booking online yang dibayar menunggu persetujuan psikolog ini.'
            : 'Disimpan. Booking online yang dibayar kembali langsung terjadwal. Permintaan yang sudah masuk tetap perlu diputuskan.');
    }
```

- [ ] **Step 4: Route**

Di `routes/web.php`, tepat setelah baris route `persetujuan.refund` (F3), tambahkan:

```php
    Route::post('/dashboard/persetujuan/pengaturan/{professionalId}', [\App\Http\Controllers\PersetujuanController::class, 'simpanPengaturan'])->whereNumber('professionalId')->name('persetujuan.pengaturan');
```

- [ ] **Step 5: Views**

`resources/views/dashboard/persetujuan-pengaturan.blade.php`:

```blade
{{-- Tab Pengaturan di halaman Persetujuan — lihat PersetujuanController::pengaturan.
     Disertakan oleh dashboard/persetujuan.blade.php; memakai variabel warnanya. --}}
@php $p = $pengaturan; @endphp

<p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 16px">
  Kalau menyala, booking online yang sudah dibayar menunggu persetujuan psikolognya sebelum jadwalnya pasti.
  Mematikannya tidak memengaruhi permintaan yang sudah masuk — itu tetap perlu diputuskan.
</p>

@if ($p['mode'] === 'klinik' && $p['daftarKlinik'] !== null)
  <form method="GET" action="{{ route('persetujuan', [], false) }}" style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
    <input type="hidden" name="tab" value="pengaturan">
    <label for="klinik" style="font-size:13.5px;color:{{ $teks }}">Klinik</label>
    <select id="klinik" name="klinik" onchange="this.form.submit()"
            style="border:1.5px solid {{ $garis }};border-radius:10px;padding:8px 10px;font-size:14px">
      <option value="">Pilih klinik</option>
      @foreach ($p['daftarKlinik'] as $k)
        <option value="{{ $k['id'] }}" @selected($k['id'] === $p['klinikId'])>{{ $k['nama'] }}</option>
      @endforeach
    </select>
    <noscript><button type="submit">Tampilkan</button></noscript>
  </form>
@endif

@if ($p['baris'] === null)
  <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px">
    <div style="font-size:14px;font-weight:700;color:#9B2C2C">Pengaturan tidak bisa dimuat.</div>
    <div style="font-size:13px;color:#7A3B3B;margin-top:4px;line-height:1.6">Tidak ada yang diubah. Muat ulang halaman untuk mencoba lagi.</div>
  </div>
@elseif ($p['mode'] === 'klinik' && $p['klinikId'] === null)
  <div style="font-size:14px;color:{{ $redup }}">Pilih klinik untuk melihat psikolognya.</div>
@elseif (count($p['baris']) === 0)
  <div style="font-size:14px;color:{{ $redup }}">Belum ada psikolog aktif di klinik ini.</div>
@else
  <div style="border:1.5px solid {{ $garis }};border-radius:16px;overflow:hidden">
    @foreach ($p['baris'] as $i => $b)
      <form method="POST" action="{{ route('persetujuan.pengaturan', ['professionalId' => $b['id']]) }}"
            style="display:flex;gap:14px;align-items:center;padding:14px 18px;margin:0;{{ $i > 0 ? 'border-top:1px solid #F0F1F6;' : '' }}">
        @csrf
        <input type="hidden" name="aktif" value="{{ $b['aktif'] ? '0' : '1' }}">
        @if ($p['klinikId'])
          <input type="hidden" name="klinik" value="{{ $p['klinikId'] }}">
        @endif
        <div style="flex:1;font-size:14.5px;font-weight:600;color:{{ $teks }}">{{ $b['nama'] }}</div>
        <span style="font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:8px;background:{{ $b['aktif'] ? '#E6F4EE' : '#F2F3F7' }};color:{{ $b['aktif'] ? '#1F8A5B' : '#5A5F7A' }}">{{ $b['aktif'] ? 'Menyala' : 'Mati' }}</span>
        <button type="submit" style="border:1.5px solid {{ $garis }};background:#fff;color:{{ $teks }};border-radius:10px;padding:8px 14px;font-size:13.5px;font-weight:700;cursor:pointer">
          {{ $b['aktif'] ? 'Matikan' : 'Nyalakan' }}
        </button>
      </form>
    @endforeach
  </div>
@endif
```

Di `resources/views/dashboard/persetujuan.blade.php`:

(a) Di `@php` atas, ganti baris `$tabs = [...]` menjadi:

```php
  $tabs = ['menunggu' => 'Menunggu', 'refund' => 'Perlu refund', 'riwayat' => 'Riwayat', 'pengaturan' => 'Pengaturan'];
```

(b) Bungkus seluruh blok daftar, dari `@if ($tab === 'refund')` (tautan "Lihat yang sudah direfund") sampai penutup `@endif` blok `@if ($gagal) … @endif`, dengan:

```blade
  @if ($tab === 'pengaturan')
    @include('dashboard.persetujuan-pengaturan')
  @else
    … blok daftar yang sudah ada, tidak diubah …
  @endif
```

- [ ] **Step 6: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'PersetujuanPengaturanTest|PersetujuanTest'
```

Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/PersetujuanController.php resources/views/dashboard/persetujuan-pengaturan.blade.php resources/views/dashboard/persetujuan.blade.php routes/web.php tests/Feature/PersetujuanPengaturanTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(persetujuan): tab pengaturan saklar approval per psikolog

Psikolog menyalakan atau mematikan saklarnya sendiri; admin klinik
mengatur psikolog klinik aktifnya; super admin memilih klinik dulu.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F5: Menu "Persetujuan" dengan badge, dan kartu di Settings

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php` (`index`, `render`, helper baru)
- Modify: `resources/views/dashboard.blade.php` (sidebar, kartu Settings)
- Modify: `public/css/app.css` (`.nav-badge`)
- Test: `tests/Feature/PersetujuanMenuTest.php`

**Interfaces:**
- Consumes: `PersetujuanController::boleh()` (F3); `counts` dari `GET api/v1/sessions/approvals` (B7).
- Produces: variabel view `$bolehPersetujuan` (bool) dan `$jumlahPersetujuan` (int) di `dashboard.blade.php`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/PersetujuanMenuTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Menu Persetujuan di sidebar dashboard: halaman tersendiri, dengan angka
// yang menunggu (ditambah refund tertunda untuk admin dan super admin).
// Resepsionis tidak melihatnya, dan antrean tidak ditanyakan untuknya.
class PersetujuanMenuTest extends TestCase
{
    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf', 'userId' => 9, 'practiceId' => 42],
                $extra,
            ),
        ];
    }

    private function fakeDashboard(int $menunggu, int $refund): void
    {
        Http::fake(fn (Request $r) => str_contains($r->url(), '/api/v1/sessions/approvals')
            ? Http::response(['data' => [], 'pagination' => ['currentPage' => 1], 'counts' => ['awaiting' => $menunggu, 'refundNeeded' => $refund]])
            : Http::response(['data' => []]));
    }

    public function test_psikolog_melihat_menu_dengan_jumlah_yang_menunggu(): void
    {
        $this->fakeDashboard(3, 9);

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))->get('/psikolog')
            ->assertOk()
            ->assertSee('href="/dashboard/persetujuan"', false)
            ->assertSee('<span class="nav-text nav-badge">3</span>', false);
    }

    public function test_admin_klinik_menghitung_refund_juga(): void
    {
        $this->fakeDashboard(3, 2);

        $this->withSession($this->sesi('admin', ['canManageClinicPayment' => true]))->get('/klinik')
            ->assertOk()
            ->assertSee('<span class="nav-text nav-badge">5</span>', false);
    }

    public function test_tanpa_yang_menunggu_tidak_ada_angka(): void
    {
        $this->fakeDashboard(0, 0);

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))->get('/psikolog')
            ->assertOk()
            ->assertSee('href="/dashboard/persetujuan"', false)
            ->assertDontSee('nav-badge', false);
    }

    public function test_resepsionis_tidak_melihat_menu_dan_antrean_tidak_ditanyakan(): void
    {
        $this->fakeDashboard(3, 2);

        $this->withSession($this->sesi('admin'))->get('/klinik')
            ->assertOk()
            ->assertDontSee('href="/dashboard/persetujuan"', false);
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), '/sessions/approvals'));
    }

    public function test_kartu_settings_menuju_pengaturan_persetujuan(): void
    {
        $this->fakeDashboard(0, 0);

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))->get('/psikolog')
            ->assertSee('/dashboard/persetujuan?tab=pengaturan', false)
            ->assertSee('Persetujuan booking online');
    }

    public function test_antrean_gagal_tidak_menjatuhkan_dashboard(): void
    {
        Http::fake(fn (Request $r) => str_contains($r->url(), '/api/v1/sessions/approvals')
            ? Http::response(['message' => 'down'], 404)
            : Http::response(['data' => []]));

        $this->withSession($this->sesi('psikolog', ['professionalId' => 120]))->get('/psikolog')
            ->assertOk()
            ->assertSee('href="/dashboard/persetujuan"', false)
            ->assertDontSee('nav-badge', false);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter PersetujuanMenuTest
```

Expected: FAIL, karena tautan menu belum ada.

- [ ] **Step 3: `app/Http/Controllers/DashboardController.php`**

(a) `index()` — tepat sebelum baris `$results = $this->api->allSettled($tasks);` sisipkan:

```php
        // Badge menu Persetujuan (approval psikolog): cukup angkanya, jadi satu
        // baris saja yang diminta. Hanya untuk yang boleh membuka halamannya —
        // resepsionis tidak, dan backend akan menolaknya (403) juga.
        if (PersetujuanController::boleh()) {
            $tasks['persetujuan'] = fn () => $this->api->get('api/v1/sessions/approvals', ['limit' => 1]);
        }
```

(b) Di larik data yang dikirim ke `$this->render(…)` di akhir `index()`, tepat setelah `'apptRentang' => self::rentangSesi(),` tambahkan:

```php
                'persetujuan' => self::jumlahPersetujuan($val('persetujuan'), $role),
```

(c) Tambahkan helper statis baru di dekat `mapAppt`:

```php
    /**
     * Angka di badge menu Persetujuan: yang menunggu psikolog, ditambah refund
     * yang belum diproses untuk admin dan super admin (psikolog tidak mengurus
     * refund). 0 kalau antrean gagal dimuat — badge kosong, dashboard tetap jalan.
     */
    private static function jumlahPersetujuan(mixed $res, string $role): int
    {
        $counts = is_array($res) && is_array($res['counts'] ?? null) ? $res['counts'] : [];
        $n = (int) ($counts['awaiting'] ?? 0);
        if ($role !== 'psikolog') {
            $n += (int) ($counts['refundNeeded'] ?? 0);
        }

        return $n;
    }
```

(d) `render()` — di larik `view('dashboard', [ … ])`, tepat setelah entri `'pemilikKlinikUrl' => …,` tambahkan:

```php
            // Menu Persetujuan (approval psikolog) dan angka badge-nya.
            'bolehPersetujuan' => PersetujuanController::boleh(),
            'jumlahPersetujuan' => (int) ($data['persetujuan'] ?? 0),
```

`PersetujuanController` ada di namespace yang sama (`App\Http\Controllers`), jadi tidak perlu `use`.

- [ ] **Step 4: `resources/views/dashboard.blade.php`**

(a) Sidebar — di dalam `@foreach ($SECTION_META as $sIdx => [$title, $items])`, tepat setelah `@endforeach` milik `@foreach ($items as $id)` (masih di dalam `<div>` seksi itu), sisipkan:

```blade
            @if ($sIdx === 0 && ! empty($bolehPersetujuan))
              {{-- Halaman tersendiri (PersetujuanController), bukan tampilan SPA:
                   tautan di email harus bisa membukanya langsung. Badge hilang
                   bersama .nav-text saat sidebar dikuncupkan. --}}
              <a class="nav-item" href="/dashboard/persetujuan" title="Persetujuan"
                 aria-label="Persetujuan{{ $jumlahPersetujuan > 0 ? ' — '.$jumlahPersetujuan.' perlu ditindaklanjuti' : '' }}">
                <x-icon name="badge-check" :size="19"/>
                <span class="nav-text" style="flex:1">Persetujuan</span>
                @if ($jumlahPersetujuan > 0)
                  <span class="nav-text nav-badge">{{ $jumlahPersetujuan }}</span>
                @endif
              </a>
            @endif
```

(b) Kartu Settings — tepat setelah `@endif` yang menutup kartu Google Calendar psikolog (kartu yang berisi `href="/dashboard/pengaturan/kalender"`), tambahkan:

```blade
          {{-- Approval psikolog: saklar "butuh persetujuan saya" (psikolog), atau
               saklar per psikolog klinik ini (admin klinik asli, super admin). --}}
          @if (! empty($bolehPersetujuan))
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:15px;font-weight:700;color:#1E2236;margin-bottom:4px">Persetujuan booking online</div>
            <div style="font-size:13px;color:#8A90A6;margin-bottom:18px;line-height:1.6">
              @if (($role ?? null) === 'psikolog')
                Kalau dinyalakan, booking online yang sudah dibayar menunggu persetujuan Anda sebelum jadwalnya pasti.
              @else
                Atur psikolog mana yang menyetujui sendiri booking online yang sudah dibayar.
              @endif
            </div>
            <a class="btn-white" href="/dashboard/persetujuan?tab=pengaturan" style="text-decoration:none;display:inline-flex;align-items:center">Atur Persetujuan</a>
          </div>
          @endif
```

- [ ] **Step 5: `public/css/app.css`**

Tepat setelah baris `.badge.amber { … }` (F2) tambahkan:

```css
/* Angka di menu Persetujuan. Ikut kelas .nav-text, jadi hilang bersama label
   saat sidebar dikuncupkan (mini). */
.nav-badge { flex: none; min-width: 20px; padding: 1px 7px; border-radius: 99px; background: #F2756A; color: #fff; font-size: 11.5px; font-weight: 700; text-align: center; line-height: 18px; }
```

- [ ] **Step 6: Jalankan tes menu dan tes dashboard lama**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'PersetujuanMenuTest|Dashboard|Sidebar|StaffAccessTest|SessionStatusTest|ModePemilik'
```

Expected: semua PASS.

Tes dashboard lama yang memalsukan backend dengan daftar URL eksplisit (bukan closure) bisa gagal dengan "stray request" ke `/sessions/approvals` kalau profilnya psikolog, super, atau admin asli. Tambahkan `'*/api/v1/sessions/approvals*' => Http::response(['data' => [], 'counts' => ['awaiting' => 0, 'refundNeeded' => 0]])` ke `Http::fake([...])` tes itu, lalu catat nama filenya untuk commit.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/DashboardController.php resources/views/dashboard.blade.php public/css/app.css tests/Feature/PersetujuanMenuTest.php
git status --short
```

Kalau Step 6 mengubah file tes lain, `git add` juga file itu. Lalu:

```bash
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(persetujuan): menu dengan badge dan kartu pengaturan

Menu Persetujuan di sidebar menampilkan jumlah yang menunggu psikolog
(ditambah refund tertunda untuk admin). Kartu di Settings menuju tab
pengaturan saklar. Resepsionis tidak melihat keduanya.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F6: Booking publik — info sebelum bayar dan pesan untuk klien

**Files:**
- Modify: `app/Services/BookingApi.php` (roster, `psy`, `checkPayment`, `fetchAppointment`)
- Modify: `resources/views/booking.blade.php`
- Modify: `app/Http/Controllers/BookingController.php` (`paymentLanding`)
- Modify: `resources/views/booking-kembali.blade.php`
- Modify: `resources/views/pasien/hasil.blade.php`
- Test: `tests/Feature/BookingPersetujuanTest.php`

**Interfaces:**
- Consumes: `requiresApproval` di katalog publik (B6); `approval` di `POST api/v1/public/payment-verify` dan `GET api/v1/public/appointments/{token}` (B6).
- Produces:
  - `tenant.roster[].requiresApproval`, `tenant.psy.requiresApproval` (bool).
  - `checkPayment()` dan `/booking/verify` membawa `approval: {state, refundStatus}` bila ada.
  - `fetchAppointment()` membawa `approval: {state, refundStatus}|null`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/BookingPersetujuanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Services\BookingApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Approval psikolog di sisi klien: info sebelum bayar untuk psikolog yang
// menyetujui sendiri booking-nya, dan pesan "menunggu konfirmasi psikolog"
// alih-alih "konfirmasi dikirim" setelah bayar.
class BookingPersetujuanTest extends TestCase
{
    private const APPROVAL = ['state' => 'AWAITING', 'requestedAt' => '2026-10-20T02:00:00.000Z', 'decidedAt' => null, 'refundStatus' => 'NONE', 'isOverdue' => false];

    public function test_roster_dan_psy_membawa_requires_approval(): void
    {
        Http::fake([
            '*/api/v1/public/professionals/*/services' => Http::response(['data' => []], 200),
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat', 'address' => 'Jl. Uji']]], 200),
            '*/api/v1/public/professionals*' => Http::response(['items' => [
                ['id' => 565, 'fullName' => 'Dianda Psikolog', 'specialties' => ['Psikolog'], 'requiresApproval' => true],
            ]], 200),
        ]);

        $t = app(BookingApi::class)->resolveTenant('4');

        $this->assertTrue($t['psy']['requiresApproval']);
        $this->assertTrue($t['roster'][0]['requiresApproval']);
    }

    public function test_check_payment_meneruskan_approval(): void
    {
        Http::fake(['*/api/v1/public/payment-verify' => Http::response(['data' => [
            'status' => 'PAID', 'expectedAmount' => 350000, 'approval' => self::APPROVAL,
        ]])]);

        $hasil = app(BookingApi::class)->checkPayment('tok');

        $this->assertSame('paid', $hasil['status']);
        $this->assertSame(['state' => 'AWAITING', 'refundStatus' => 'NONE'], $hasil['approval']);
    }

    public function test_check_payment_tanpa_approval_tidak_berubah(): void
    {
        Http::fake(['*/api/v1/public/payment-verify' => Http::response(['data' => ['status' => 'PAID', 'expectedAmount' => 350000, 'approval' => null]])]);

        $this->assertArrayNotHasKey('approval', app(BookingApi::class)->checkPayment('tok'));
    }

    public function test_fetch_appointment_meneruskan_approval(): void
    {
        Http::fake(['*/api/v1/public/appointments/*' => Http::response(['data' => [
            'status' => 'PENDING', 'date' => '2026-10-22', 'startTime' => '10:00', 'service' => 'Konseling', 'professionalName' => 'Dianda',
            'approval' => self::APPROVAL,
        ]])]);

        $janji = app(BookingApi::class)->fetchAppointment('tok');

        $this->assertSame(['state' => 'AWAITING', 'refundStatus' => 'NONE'], $janji['approval']);
    }

    public function test_halaman_kembali_menyebut_menunggu_psikolog(): void
    {
        $this->view('booking-kembali', ['pulih' => null, 'status' => 'paid', 'approval' => 'AWAITING'])
            ->assertSee('Psikolog akan mengonfirmasi jadwal Anda');

        $this->view('booking-kembali', ['pulih' => null, 'status' => 'paid', 'approval' => null])
            ->assertSee('Konfirmasi dan tautan sesi dikirim ke email Anda');
    }

    public function test_halaman_booking_dan_hasil_memuat_teks_approval(): void
    {
        $booking = file_get_contents(resource_path('views/booking.blade.php'));
        $this->assertStringContainsString('x-show="psy.requiresApproval"', $booking);
        $this->assertStringContainsString('requiresApproval: !!p.requiresApproval', $booking);
        $this->assertStringContainsString('get menungguPsikolog()', $booking);
        $this->assertStringContainsString('Jadwal ini perlu dikonfirmasi psikolog setelah pembayaran.', $booking);

        $hasil = file_get_contents(resource_path('views/pasien/hasil.blade.php'));
        $this->assertStringContainsString('Menunggu konfirmasi psikolog', $hasil);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter BookingPersetujuanTest
```

Expected: FAIL. `requiresApproval` belum ada di tenant, `approval` belum diteruskan, dan teks belum ada di view.

- [ ] **Step 3: `app/Services/BookingApi.php`**

(a) Roster — di `array_map(fn ($p) => [ … ], $roster)` pada `resolveTenant`, tambahkan setelah `'focus' => self::specialtiesOf($p),`:

```php
                // Approval psikolog: booking yang dibayar menunggu persetujuannya.
                // Ringkasan booking memberi tahu klien sebelum ia membayar.
                'requiresApproval' => ! empty($p['requiresApproval']),
```

(b) `psy` — di larik `'psy' => [ … ]`, tambahkan setelah `'focus' => $specialties,`:

```php
                'requiresApproval' => $professional ? ! empty($professional['requiresApproval']) : false,
```

(c) `fetchAppointment` — di larik yang dikembalikan, tambahkan setelah `'client' => …,`:

```php
            // Approval psikolog: PENDING bisa berarti "menunggu konfirmasi
            // psikolog" (sudah dibayar), bukan "belum dibayar".
            'approval' => is_array($a['approval'] ?? null) ? [
                'state' => strtoupper((string) ($a['approval']['state'] ?? '')),
                'refundStatus' => strtoupper((string) ($a['approval']['refundStatus'] ?? 'NONE')),
            ] : null,
```

(d) `checkPayment` — tepat sebelum `return $result;`, sisipkan:

```php
            // Approval psikolog: sudah lunas, tapi jadwalnya baru pasti setelah
            // psikolog menyetujui. Hanya diteruskan kalau backend mengirimnya.
            if (is_array($view['approval'] ?? null)) {
                $result['approval'] = [
                    'state' => strtoupper((string) ($view['approval']['state'] ?? '')),
                    'refundStatus' => strtoupper((string) ($view['approval']['refundStatus'] ?? 'NONE')),
                ];
            }
```

- [ ] **Step 4: `resources/views/booking.blade.php`**

(a) `choosePsy(p)` — ganti:

```js
        this.psy = { ...this.psy, apiId: p.apiId, name: p.name, init: p.init, spec: p.spec, focus: p.focus || [] };
```

menjadi:

```js
        this.psy = { ...this.psy, apiId: p.apiId, name: p.name, init: p.init, spec: p.spec, focus: p.focus || [], requiresApproval: !!p.requiresApproval };
```

(b) `lepasPsikolog()` — ganti:

```js
      this.psy = { ...this.psy, apiId: null, name: tenant.psy.name, init: tenant.psy.init, spec: tenant.psy.spec, focus: tenant.psy.focus || [] };
```

menjadi:

```js
      this.psy = { ...this.psy, apiId: null, name: tenant.psy.name, init: tenant.psy.init, spec: tenant.psy.spec, focus: tenant.psy.focus || [], requiresApproval: !!tenant.psy.requiresApproval };
```

(c) Ringkasan langkah 4 — tepat setelah baris:

```blade
              <div style="font-size:11.5px;color:#8A90A6;line-height:1.5">Jumlah akhir dikonfirmasi di halaman pembayaran.</div>
```

tambahkan:

```blade
              {{-- Approval psikolog: dibayar dulu, dikonfirmasi psikolog
                   kemudian. Klien harus tahu SEBELUM membayar. --}}
              <div x-show="psy.requiresApproval" style="font-size:12px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:10px;padding:9px 11px;line-height:1.5">Jadwal ini perlu dikonfirmasi psikolog setelah pembayaran. Kalau tidak dapat diterima, dana Anda dikembalikan.</div>
```

(d) Layar sukses — ganti seluruh getter `suksesNote` dengan:

```js
    // Approval psikolog: pembayaran sudah diterima, tapi jadwalnya baru pasti
    // setelah psikolog menyetujui. Dibaca dari /booking/verify (checkPayment).
    get menungguPsikolog() { return !!(this.payStatus && this.payStatus.approval && this.payStatus.approval.state === "AWAITING"); },
    get ditolakPsikolog() { return !!(this.payStatus && this.payStatus.approval && ["REJECTED", "CANCELLED"].includes(this.payStatus.approval.state)); },
    get suksesNote() {
      if (this.dilepas) return "Janji temu ini tidak jadi karena pembayarannya tidak diterima.";
      if (this.ditolakPsikolog) return "Psikolog tidak dapat menerima jadwal ini. Klinik akan mengembalikan dana Anda — rinciannya kami kirim ke email Anda.";
      if (this.menungguPsikolog) return "Pembayaran diterima. Psikolog akan mengonfirmasi jadwal Anda, dan kami akan mengirim email begitu dikonfirmasi.";
      const terkonfirmasi = (this.payStatus && ["paid", "booked", "check_in", "check_out"].includes(this.payStatus.status));
      if (terkonfirmasi) return "Konfirmasi & link sesi dikirim ke email Anda. Sampai bertemu di sesi nanti — jaga diri ya.";
      if (this.gratis) return "Konfirmasi & link sesi dikirim ke email Anda setelah jadwalnya dikonfirmasi.";
      return "Konfirmasi & link sesi dikirim ke email Anda setelah pembayaran diterima.";
    },
```

- [ ] **Step 5: `app/Http/Controllers/BookingController.php` dan `booking-kembali.blade.php`**

Di `paymentLanding`, ganti:

```php
        return response()->view('booking-kembali', [
            'pulih' => session()->pull(self::KUNCI_PULIH),
            'status' => ($status ?? $this->booking->checkPayment($token))['status'] ?? null,
        ]);
```

menjadi:

```php
        $bayar = $status ?? $this->booking->checkPayment($token);

        return response()->view('booking-kembali', [
            'pulih' => session()->pull(self::KUNCI_PULIH),
            'status' => $bayar['status'] ?? null,
            // Approval psikolog: lunas tapi menunggu konfirmasi psikolog.
            'approval' => $bayar['approval']['state'] ?? null,
        ]);
```

Di `resources/views/booking-kembali.blade.php`, ganti blok `@php $label = match ($status) { … }; @endphp` menjadi:

```blade
@php
    $approval = $approval ?? null;
    $label = match (true) {
        // Approval psikolog: uangnya sudah masuk, jadwalnya menunggu psikolog.
        $status === 'paid' && $approval === 'AWAITING' => ['Pembayaran lunas', 'Terima kasih, pembayaran Anda sudah kami terima. Psikolog akan mengonfirmasi jadwal Anda, dan kami akan mengirim email begitu dikonfirmasi.'],
        $status === 'paid' && in_array($approval, ['REJECTED', 'CANCELLED'], true) => ['Jadwal tidak dapat diterima', 'Psikolog tidak dapat menerima jadwal ini. Klinik akan mengembalikan dana Anda.'],
        default => match ($status) {
            'paid' => ['Pembayaran lunas', 'Terima kasih, pembayaran Anda sudah kami terima. Konfirmasi dan tautan sesi dikirim ke email Anda.'],
            'pending' => ['Menunggu pembayaran', 'Pembayaran belum kami terima. Kalau Anda baru saja membayar, muat ulang halaman ini dalam satu-dua menit.'],
            'failed', 'expired', 'cancelled' => ['Pembayaran tidak selesai', 'Pembayaran tidak diterima dan jadwalnya sudah dilepas. Silakan pesan ulang dari halaman klinik.'],
            default => ['Status belum diketahui', 'Kami belum bisa memastikan status pembayaran Anda. Muat ulang halaman ini sebentar lagi.'],
        },
    };
@endphp
```

- [ ] **Step 6: `resources/views/pasien/hasil.blade.php`**

Ganti blok `[$bgJ, $fgJ, $labelJ] = match (strtoupper((string) $janji['status'])) { … };` menjadi:

```php
                  $statusJ = strtoupper((string) $janji['status']);
                  $persetujuan = $janji['approval'] ?? null;
                  [$bgJ, $fgJ, $labelJ] = match (true) {
                      // Approval psikolog: sudah dibayar, menunggu psikolognya.
                      $statusJ === 'PENDING' && ($persetujuan['state'] ?? null) === 'AWAITING' => ['#FFF4E5', '#8A5A12', 'Menunggu konfirmasi psikolog'],
                      $statusJ === 'CANCELLED' && ($persetujuan['state'] ?? null) === 'REJECTED' => ['#FCE9E7', '#B3261E', 'Tidak dapat diterima · dana dikembalikan klinik'],
                      default => match ($statusJ) {
                          'BOOKED' => ['#ECEFFB', $accent, 'Terjadwal'],
                          'PENDING' => ['#FFF4E5', '#8A5A12', 'Menunggu konfirmasi'],
                          'CHECK_IN' => ['#ECEFFB', $accent, 'Sedang berlangsung'],
                          'CHECK_OUT', 'COMPLETED' => ['#E7F6EC', '#1B6B3A', 'Selesai'],
                          'CANCELLED', 'REJECTED' => ['#FCE9E7', '#B3261E', 'Dibatalkan'],
                          default => ['#ECEFFB', $accent, \App\Services\BookingApi::humanizeType($janji['status'])],
                      },
                  };
```

- [ ] **Step 7: Jalankan tes baru dan tes booking lama**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli php vendor/bin/phpunit --filter 'BookingPersetujuanTest|Booking|HasilPasien|CekHasil|PatientRegister'
```

Expected: semua PASS.

Tes lama yang membandingkan seluruh larik tenant atau hasil `checkPayment`/`fetchAppointment` dengan `assertSame`/`assertEquals` akan gagal hanya karena kunci baru (`requiresApproval`, `approval`). Untuk kasus itu, tambahkan kuncinya ke larik yang diharapkan: `'requiresApproval' => false` dan `'approval' => null`. Kegagalan lain adalah temuan; laporkan.

- [ ] **Step 8: Commit**

```bash
git add app/Services/BookingApi.php resources/views/booking.blade.php app/Http/Controllers/BookingController.php resources/views/booking-kembali.blade.php resources/views/pasien/hasil.blade.php tests/Feature/BookingPersetujuanTest.php
git status --short
```

Kalau Step 7 mengubah file tes lain, `git add` juga file itu. Lalu:

```bash
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(booking): klien tahu soal persetujuan psikolog sebelum dan sesudah bayar

Ringkasan booking memberi tahu bila jadwal perlu dikonfirmasi psikolog.
Layar sukses, halaman kembali dari pembayaran, dan halaman hasil pasien
menyebut "menunggu konfirmasi psikolog" alih-alih "konfirmasi dikirim".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task F7: Suite FE penuh, lint Blade, push

**Files:** tidak ada perubahan kode (kecuali perbaikan dari Step 1).

- [ ] **Step 1: Suite penuh dan kompilasi Blade**

```bash
cd /home/ahmad/projects/praktiqu-fe/approval-psikolog
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/approval-psikolog php:8.4-cli sh -c 'php vendor/bin/phpunit 2>&1 | tail -5; php artisan view:cache && php artisan view:clear'
for f in tests/js/*.test.mjs; do node "$f" || echo "GAGAL: $f"; done
```

Expected:
- `OK (M tests, …)` dengan M > N dari F0.
- `Blade templates cached successfully`, lalu `Compiled views cleared`.
- Tidak ada baris `GAGAL:`.

Kegagalan di luar file yang disentuh fitur ini adalah temuan; laporkan, jangan ditambal.

- [ ] **Step 2: Push (hanya setelah user setuju)**

Tanyakan dulu ke user. Setelah disetujui:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/approval-psikolog
```

PR ke `main` dibuka user dari `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/approval-psikolog`.

---

## Bagian G — Rilis

Mengikuti `docs/deploy/approval-psikolog-runbook.md` (B9). **Setiap langkah butuh persetujuan user di saat itu.** Semua langkah ini menyentuh produksi, dan persetujuan atas rencana ini tidak mencakupnya.

- [ ] **G1:** User me-review dan membuka dua PR (backend dan FE) dari compare link di B9 Step 5 dan F7 Step 2.
- [ ] **G2:** Deploy plugin 1.8.3 ke Hostinger WP sesuai runbook §1. Cocokkan dulu isi server dengan git 1.8.2, buat backup, tukar file `jobs` dulu baru file utama, lalu verifikasi versi dan `error_log`.
- [ ] **G3:** Jalankan SQL di DB produksi sesuai runbook §2, lalu verifikasi dua tabel baru ada.
- [ ] **G4:** User me-merge PR backend → auto-deploy Hostinger. Verifikasi `GET /api/v1/sessions/approvals` dengan token psikolog → 200 dengan `counts`.
- [ ] **G5:** User me-merge PR FE → deploy GitHub Actions. Verifikasi `/dashboard/persetujuan` tanpa sesi → 302 ke login.
- [ ] **G6:** Uji coba oleh user dengan satu psikolog uji, sesuai bagian "Uji coba" di runbook. Matikan saklar setelahnya.
