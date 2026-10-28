# Janji Manual Outside the Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff book a Janji Manual at a time outside the professional's schedule in one step. The server creates the Sesi Dadakan for that time, then books.

**Architecture:**
- The Sesi Dadakan permission and overlap rules move out of `CustomSessionController` into `App\Services\SesiDadakan`.
- `ManualAppointmentController::store` gets a `luarJadwal` path that uses the service:
  - it checks everything before anything is written;
  - it creates the `custom_sessions` row right before `submitBooking`;
  - it deletes the row if booking fails.
- The Alpine modal gets a "+ Jam lain (di luar jadwal)" input, plus a confirmation tick for every role except psikolog.

**Tech Stack:** Laravel 12 / PHP 8.4 (PHPUnit, Http fakes, SQLite `RefreshDatabase`), Alpine.js inside `resources/views/dashboard.blade.php`, node test scripts in `tests/js/`.

**Spec:** `docs/superpowers/specs/2026-10-28-janji-manual-luar-jadwal-design.md`. The spec lives in this backend repo; the code goes in the FE repo.

## Global Constraints

- **Repo:** `raakanaka/laravel-praktiqu` (FE). Work in a new worktree `/home/ahmad/projects/praktiqu-fe/luar-jadwal` on branch `feat/janji-luar-jadwal`, cut from `origin/main`. No change to the Next.js backend or WordPress.
- **Roles.** The FE has three roles: `super`, `admin`, `psikolog`.
  - `admin` includes receptionists and psikolog in owner mode (`pemilik`).
  - Receptionists ARE allowed (user decision 2026-10-28).
- **Confirmation tick.** Every role except `psikolog` must send `konfirmasiPsikolog: true`.
- **Created row values:**

  | Column | Value |
  |---|---|
  | `kind` | `dadakan` |
  | `duration` | the service duration |
  | `note` | `Otomatis dari Janji Manual` |

- **The Sesi Dadakan is never removed** when the appointment is later cancelled.
- **Status codes:**
  - Upstream failures answer `Controller::UPSTREAM_REJECTED` (424).
  - Validation-style rejections answer 422.
  - Scope rejections answer 403.
- **UI copy (Indonesian, exact):**
  - "+ Jam lain (di luar jadwal)"
  - "Jam ini di luar jadwal praktik. Sesi Dadakan akan dibuat otomatis."
  - "Sudah dikonfirmasi dengan psikolog"
  - "Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog."
  - "Jam sudah lewat. Pilih jam lain."
  - "Sesi melewati tengah malam. Pilih jam lebih awal."
  - "Jam mulai harus berformat JJ:MM dengan kelipatan 5 menit."
  - "Durasi layanan gagal dimuat. Coba lagi."
  - "Layanan ini tidak dibuka psikolog tersebut."
  - "Bentrok dengan Sesi Dadakan lain pada jam yang sama."
  - success suffix " Sesi Dadakan HH:MM–HH:MM dibuat otomatis." (en dash)
- **Style.** Indonesian comments and test names, matching the surrounding code. Inline fully-qualified `\App\...` class names where the file already does that.
- **Alpine.** Never add a string `:style` to an element that also has a static `style`; Alpine 3.14 wipes the static one. Use `x-show`, or object `:style`.
- **PHP commands.** Run all PHP through Docker; there is no local `php`:

  ```bash
  DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter <Name>
  ```

  Below, this is written as `PHPUNIT --filter <Name>`.

---

### Task 1: Extract the Sesi Dadakan rules into `App\Services\SesiDadakan`

**Files:**
- Create: `app/Services/SesiDadakan.php`
- Modify: `app/Http/Controllers/CustomSessionController.php`. Change the imports and `store()` (lines 40-124 on `origin/main` 8497e3e) and `destroy()` (line 141). Delete the private `periksaModePemilik()` and `rosterKlinik()` (lines 146-191).
- Test: `tests/Feature/CustomSessionTest.php`. Add one test.

**Interfaces:**
- Produces, for Task 2:
  - `App\Services\SesiDadakan`, resolved from the container. Its constructor is `__construct(PraktiquApi $api)`.
  - `periksaPembuat(array $profile, int $doctorId, ?int $clinicId): array{tolak: ?JsonResponse, clinicId: ?int}`
  - `periksaModePemilik(array $profile): ?JsonResponse`
  - `bentrok(int $doctorId, string $date, int $mulai, int $selesai): ?CustomSession`. Arguments are minutes from midnight, half-open.
  - `penampung(int $doctorId, ?int $clinicId, string $date, int $mulai, int $selesai): ?CustomSession`

- [ ] **Step 1: Create the worktree and install vendor**

```bash
cd /home/ahmad/projects/praktiqu-fe/main && git fetch origin && git worktree add ../luar-jadwal -b feat/janji-luar-jadwal origin/main
cd /home/ahmad/projects/praktiqu-fe/luar-jadwal && DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app -e COMPOSER_ALLOW_SUPERUSER=1 composer:2 install --no-scripts
```

Expected: worktree created; composer ends with "Generating optimized autoload files". `vendor/` must be a real directory, not a symlink to another worktree.

- [ ] **Step 2: Baseline. The suites touched by this plan pass before any change**

```bash
cd /home/ahmad/projects/praktiqu-fe/luar-jadwal
PHPUNIT --filter 'CustomSessionTest|ManualAppointmentTest'
node tests/js/janji-manual-jam.test.mjs
```

Expected:
- PHPUnit: `OK`.
- node: ends with `semua lolos`.

If either fails on untouched `origin/main`, stop and report it. Do not build on a red baseline.

- [ ] **Step 3: Add a characterization test for the overlap rule**

Nothing covers the overlap check that is about to move. Append this to `tests/Feature/CustomSessionTest.php`, before the closing `}` of the class:

```php
    // Aturan bentrok dipindah ke App\Services\SesiDadakan (dipakai juga oleh
    // Janji Manual di luar jadwal); tes ini mengunci perilakunya sebelum dan
    // sesudah pemindahan. Setengah terbuka: 11:00 boleh menempel 10:00–11:00.
    public function test_sesi_yang_tumpang_tindih_ditolak(): void
    {
        Http::fake();
        $psikolog = $this->staf('psikolog', ['professionalId' => '34', 'practiceId' => '4']);

        $this->withSession($psikolog)
            ->postJson('/dashboard/custom-sessions', $this->isi(['startTime' => '10:00', 'duration' => 60]))
            ->assertCreated();
        $this->withSession($psikolog)
            ->postJson('/dashboard/custom-sessions', $this->isi(['startTime' => '10:30', 'duration' => 60]))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Bentrok dengan sesi custom/dadakan lain pada jam yang sama.');
        $this->withSession($psikolog)
            ->postJson('/dashboard/custom-sessions', $this->isi(['startTime' => '11:00', 'duration' => 30]))
            ->assertCreated();

        $this->assertSame(2, CustomSession::count());
    }
```

- [ ] **Step 4: Run it against the old code**

Run: `PHPUNIT --filter test_sesi_yang_tumpang_tindih_ditolak`

Expected: PASS. This pins existing behaviour. If it fails, the overlap query never matched before either (for example a `date` cast mismatch). Stop and report it as a pre-existing bug instead of refactoring around it.

- [ ] **Step 5: Create `app/Services/SesiDadakan.php`**

```php
<?php

namespace App\Services;

use App\Http\Controllers\Controller;
use App\Http\Controllers\DashboardController;
use App\Models\CustomSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

// Tabel custom_sessions hanya ada di FE ini — backend tidak bisa menjaganya,
// jadi scoping per peran WAJIB ditegakkan di sini, gagal-tertutup seperti
// DashboardController::scopedQuery(). Satu sumber aturan untuk menu Sesi
// Dadakan (CustomSessionController) dan Janji Manual yang memesan di luar
// jadwal (ManualAppointmentController), supaya keduanya tidak bisa berbeda.
class SesiDadakan
{
    public function __construct(private readonly PraktiquApi $api) {}

    /**
     * Boleh $profile membuat sesi untuk psikolog $doctorId? `tolak` terisi bila
     * tidak. Bila boleh, `clinicId` adalah klinik yang dicatat di barisnya:
     * psikolog dan admin dari profil, super dari form (boleh null).
     *
     * @return array{tolak: ?JsonResponse, clinicId: ?int}
     */
    public function periksaPembuat(array $profile, int $doctorId, ?int $clinicId): array
    {
        $role = $profile['role'] ?? null;
        $tolak = fn (string $pesan, int $status = 403) => [
            'tolak' => response()->json(['ok' => false, 'message' => $pesan], $status),
            'clinicId' => null,
        ];

        if ($role === 'psikolog') {
            if ($doctorId !== (int) ($profile['professionalId'] ?? 0)) {
                return $tolak('Psikolog hanya bisa membuat sesi untuk dirinya sendiri.');
            }

            return ['tolak' => null, 'clinicId' => ! empty($profile['practiceId']) ? (int) $profile['practiceId'] : $clinicId];
        }

        if ($role === 'admin') {
            // Klinik admin dipaksa dari profil, bukan dari form; psikolognya
            // harus terdaftar di klinik itu. Tanpa ini admin klinik A bisa
            // menanam slot untuk psikolog klinik B, dan slot itu ikut
            // ditawarkan di Add Appointment Manual.
            if (empty($profile['practiceId'])) {
                return $tolak('Akun Anda belum terhubung ke klinik.');
            }
            $klinik = (int) $profile['practiceId'];
            if ($ditolak = $this->periksaModePemilik($profile)) {
                return ['tolak' => $ditolak, 'clinicId' => null];
            }
            $roster = $this->rosterKlinik($klinik);
            if ($roster === null) {
                return $tolak('Daftar psikolog klinik gagal diperiksa. Coba lagi.', Controller::UPSTREAM_REJECTED);
            }
            if (! in_array($doctorId, $roster, true)) {
                return $tolak('Psikolog ini tidak terdaftar di klinik Anda.');
            }

            return ['tolak' => null, 'clinicId' => $klinik];
        }

        if ($role === 'super') {
            return ['tolak' => null, 'clinicId' => $clinicId];
        }

        return $tolak('Tidak berwenang.');
    }

    /**
     * Psikolog dalam mode pemilik tampil sebagai admin klinik, tapi tabel ini
     * hanya lokal dan tidak ada panggilan backend yang menjaganya — status
     * pemilik yang sudah dicabut tetap lolos dari sesi. Satu panggilan murah ke
     * rute yang memvalidasi header pemilik (/services) memastikan mode itu masih
     * sah sebelum menulis. Penolakan backend melempar ModePemilikBerakhirException
     * (dirender 409 oleh bootstrap/app.php) dan SENGAJA dibiarkan lewat.
     * Null = boleh lanjut (bukan mode pemilik, atau backend mengiyakan).
     */
    public function periksaModePemilik(array $profile): ?JsonResponse
    {
        if (empty($profile['pemilik'])) {
            return null;
        }
        try {
            $this->api->get('api/v1/services', ['clinicId' => (int) $profile['practiceId'], 'page' => 1, 'perPage' => 1]);
        } catch (ModePemilikBerakhirException $e) {
            throw $e;
        } catch (ApiException $e) {
            logger()->warning('[custom-session] pemeriksaan mode pemilik gagal: '.$e->getMessage());

            return response()->json(['ok' => false, 'message' => 'Akses pemilik klinik gagal diperiksa. Coba lagi.'], Controller::UPSTREAM_REJECTED);
        }

        return null;
    }

    /** Sesi psikolog ini pada tanggal itu yang tumpang tindih dengan [mulai, selesai), dalam menit. */
    public function bentrok(int $doctorId, string $date, int $mulai, int $selesai): ?CustomSession
    {
        return $this->sesiHari($doctorId, $date)->first(function (CustomSession $s) use ($mulai, $selesai) {
            [$a, $b] = self::rentang($s);

            return max($a, $mulai) < min($b, $selesai);
        });
    }

    /**
     * Sesi yang sudah menampung [mulai, selesai) seluruhnya. Kliniknya harus
     * null atau $clinicId — saringan yang sama dengan jamCustom() di Janji
     * Manual, supaya sesi klinik lain psikolog yang sama tidak dipakai ulang.
     */
    public function penampung(int $doctorId, ?int $clinicId, string $date, int $mulai, int $selesai): ?CustomSession
    {
        return $this->sesiHari($doctorId, $date)->first(function (CustomSession $s) use ($clinicId, $mulai, $selesai) {
            if ($s->clinic_id !== null && $clinicId !== null && (int) $s->clinic_id !== $clinicId) {
                return false;
            }
            [$a, $b] = self::rentang($s);

            return $a <= $mulai && $b >= $selesai;
        });
    }

    private function sesiHari(int $doctorId, string $date): Collection
    {
        return CustomSession::where('doctor_id', $doctorId)->where('date', $date)->get();
    }

    /** @return array{0: int, 1: int} menit mulai dan selesai sesi */
    private static function rentang(CustomSession $s): array
    {
        [$h, $m] = array_map('intval', explode(':', $s->start_time));
        $a = $h * 60 + $m;

        return [$a, $a + (int) $s->duration];
    }

    /** Id psikolog di roster klinik, atau null kalau roster gagal dimuat. */
    private function rosterKlinik(int $clinicId): ?array
    {
        try {
            $raw = $this->api->get('api/v1/public/professionals', ['clinicId' => $clinicId]);
        } catch (ApiException $e) {
            logger()->warning("[custom-session] roster klinik {$clinicId} gagal: ".$e->getMessage());

            return null;
        }

        return array_values(array_filter(array_map(
            fn ($p) => is_array($p) && isset($p['id']) ? (int) $p['id'] : null,
            DashboardController::asArray($raw),
        )));
    }
}
```

- [ ] **Step 6: Make `CustomSessionController` use the service**

6a. Replace the imports block, lines 5-11:

```php
use App\Models\CustomSession;
use App\Services\SesiDadakan;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
```

6b. Add a constructor as the first member of the class, right after `class CustomSessionController extends Controller {`:

```php
    public function __construct(private readonly SesiDadakan $sesiDadakan) {}

```

6c. In `store()`, replace everything from `if ($role === 'psikolog') {` through the line `if ($bentrok) return response()->json(['ok' => false, 'message' => 'Bentrok dengan sesi custom/dadakan lain pada jam yang sama.'], 422);` with:

```php
        $periksa = $this->sesiDadakan->periksaPembuat(
            $profile,
            (int) $data['doctorId'],
            isset($data['clinicId']) ? (int) $data['clinicId'] : null,
        );
        if ($periksa['tolak']) {
            return $periksa['tolak'];
        }
        $data['clinicId'] = $periksa['clinicId'];
        // Bentrok di hari sama untuk dokter yang sama: slot tumpang tindih ditolak ringan
        if ($this->sesiDadakan->bentrok((int) $data['doctorId'], $data['date'], $h * 60 + $m, $end)) {
            return response()->json(['ok' => false, 'message' => 'Bentrok dengan sesi custom/dadakan lain pada jam yang sama.'], 422);
        }
```

`$h`, `$m` and `$end` are already computed just above, from the midnight check. Keep that block and everything from `$row = CustomSession::create([` onward unchanged.

6d. In `destroy()`, change `if ($ditolak = $this->periksaModePemilik($profile)) {` to:

```php
        if ($ditolak = $this->sesiDadakan->periksaModePemilik($profile)) {
```

6e. Delete the private methods `periksaModePemilik()` and `rosterKlinik()`, with their docblocks, at the bottom of the class.

- [ ] **Step 7: Run the Sesi Dadakan suite**

Run: `PHPUNIT --filter CustomSessionTest`

Expected: `OK`, every test including the new one. In particular:
- `test_pemilik_membuat_sesi_dicek_backend_dulu` still sees the `X-Praktiqu-Clinic-Id` header, because the injected `PraktiquApi` is the same container binding `app(PraktiquApi::class)` returned.
- `test_roster_gagal_berarti_tidak_disimpan` still gets 424.

- [ ] **Step 8: Commit**

```bash
git add app/Services/SesiDadakan.php app/Http/Controllers/CustomSessionController.php tests/Feature/CustomSessionTest.php
git commit -m "refactor(sesi-dadakan): aturan pembuat & bentrok jadi service bersama

Janji Manual di luar jadwal akan membuat Sesi Dadakan sendiri; aturannya
harus satu sumber dengan menu Sesi Dadakan. Perilaku menu tidak berubah;
tes bentrok baru mengunci aturan yang sebelumnya tanpa tes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server path `luarJadwal` in `ManualAppointmentController::store`

**Files:**
- Modify: `app/Http/Controllers/ManualAppointmentController.php`. Change the imports, the constructor (line 22) and `store()` (lines 318-405 on `origin/main`), and add the private `rencanaLuarJadwal()`.
- Test: `tests/Feature/ManualAppointmentTest.php`. Add helpers and 11 tests.

**Interfaces:**
- Consumes: from Task 1, `SesiDadakan::periksaPembuat`, `::bentrok` and `::penampung`, with the signatures above.
- Produces, for Task 3, the HTTP contract `POST /dashboard/appointments/manual`:
  - Optional `luarJadwal: bool` and `konfirmasiPsikolog: bool`.
  - `startTime` is the typed `HH:MM`.
  - 201 `message` ends with ` Sesi Dadakan HH:MM–HH:MM dibuat otomatis.` when a row was created.
  - Rejections use `{message}` with the statuses in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Append this to `tests/Feature/ManualAppointmentTest.php`, before the closing `}` of the class. The existing helpers `staf()`, `pesanan()`, `fakeBookingBerhasil()`, `assertTidakAdaBooking()` and `rosterKlinik4()` are reused.

```php
    // ── Janji di luar jadwal: Sesi Dadakan dibuat otomatis ──────────────
    // Backend tidak memeriksa jam praktik; batasnya hanya daftar jam di
    // modal. Jalur ini membuat Sesi Dadakan seukuran layanan lalu memesan,
    // dan menghapus sesinya lagi bila janji temunya tidak jadi.

    /** Layanan 12 milik psikolog $pro — sumber durasi janji di luar jadwal. */
    private function layanan(string $pro, int $menit = 60): array
    {
        return ["*/api/v1/public/professionals/{$pro}/services*" => Http::response(['data' => [
            ['id' => 12, 'name' => 'Konseling', 'price' => '0', 'durationMinutes' => $menit],
        ]])];
    }

    private function luarJadwal(string $pro, array $extra = []): array
    {
        return array_merge($this->pesanan($pro), ['luarJadwal' => true, 'startTime' => '21:15'], $extra);
    }

    private function psikolog35(): array
    {
        return $this->staf('psikolog', ['practiceId' => '4', 'professionalId' => '35']);
    }

    public function test_psikolog_di_luar_jadwal_membuat_sesi_dadakan_lalu_memesan(): void
    {
        $this->fakeBookingBerhasil($this->layanan('35', 60));

        $res = $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertCreated();

        $sesi = \App\Models\CustomSession::sole();
        $this->assertSame([35, 4, '21:15', 60, 'dadakan', 'Otomatis dari Janji Manual'],
            [(int) $sesi->doctor_id, (int) $sesi->clinic_id, substr($sesi->start_time, 0, 5), $sesi->duration, $sesi->kind, $sesi->note]);
        $this->assertStringEndsWith(' Sesi Dadakan 21:15–22:15 dibuat otomatis.', $res->json('message'));
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/public/appointments'));
    }

    public function test_tanpa_luar_jadwal_tidak_membuat_sesi_dan_tidak_membaca_layanan(): void
    {
        $this->fakeBookingBerhasil();

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->pesanan('35'))
            ->assertCreated();

        $this->assertSame(0, \App\Models\CustomSession::count());
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), '/services'));
    }

    public function test_psikolog_di_luar_jadwal_untuk_psikolog_lain_ditolak(): void
    {
        $this->fakeBookingBerhasil($this->layanan('34'));

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('34'))
            ->assertForbidden();

        $this->assertSame(0, \App\Models\CustomSession::count());
        $this->assertTidakAdaBooking();
    }

    public function test_admin_di_luar_jadwal_wajib_centang_konfirmasi(): void
    {
        $this->fakeBookingBerhasil($this->rosterKlinik4() + $this->layanan('34'));
        $admin = $this->staf('admin', ['practiceId' => '4']);

        $this->withSession($admin)
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('34'))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog.');
        $this->assertSame(0, \App\Models\CustomSession::count());
        $this->assertTidakAdaBooking();

        $this->withSession($admin)
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('34', ['konfirmasiPsikolog' => true]))
            ->assertCreated();
        $this->assertSame(4, (int) \App\Models\CustomSession::sole()->clinic_id);
    }

    public function test_booking_gagal_menghapus_sesi_dadakan_yang_baru_dibuat(): void
    {
        Http::fake($this->layanan('35') + [
            '*/api/v1/public/booking/hold' => Http::response(['holdKey' => 'h1']),
            '*/api/v1/public/appointments' => Http::response(['status' => 409, 'code' => 'slot_conflict', 'detail' => 'Slot no longer available'], 409),
        ]);

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertStatus(409);

        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/public/appointments'));
        $this->assertSame(0, \App\Models\CustomSession::count());
    }

    public function test_sesi_dadakan_yang_sudah_menampung_dipakai_ulang(): void
    {
        $this->fakeBookingBerhasil($this->layanan('35', 60));
        \App\Models\CustomSession::create(['clinic_id' => 4, 'doctor_id' => 35, 'date' => now()->addDays(3)->format('Y-m-d'), 'start_time' => '21:00', 'duration' => 120, 'kind' => 'custom']);

        $res = $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertCreated();

        $this->assertSame(1, \App\Models\CustomSession::count());
        $this->assertStringNotContainsString('dibuat otomatis', $res->json('message'));
    }

    public function test_tumpang_tindih_sebagian_dengan_sesi_dadakan_ditolak(): void
    {
        $this->fakeBookingBerhasil($this->layanan('35', 60));
        \App\Models\CustomSession::create(['clinic_id' => 4, 'doctor_id' => 35, 'date' => now()->addDays(3)->format('Y-m-d'), 'start_time' => '21:45', 'duration' => 50, 'kind' => 'custom']);

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Bentrok dengan Sesi Dadakan lain pada jam yang sama.');

        $this->assertSame(1, \App\Models\CustomSession::count());
        $this->assertTidakAdaBooking();
    }

    public function test_jam_luar_jadwal_yang_tidak_sah_ditolak_tanpa_menulis(): void
    {
        $this->fakeBookingBerhasil($this->layanan('35', 60));
        $kasus = [
            'Jam mulai harus berformat JJ:MM dengan kelipatan 5 menit.' => ['startTime' => '21:13'],
            'Sesi melewati tengah malam. Pilih jam lebih awal.' => ['startTime' => '23:30'],
            'Jam sudah lewat. Pilih jam lain.' => ['date' => now('Asia/Jakarta')->format('Y-m-d'), 'startTime' => '00:00'],
        ];

        foreach ($kasus as $pesan => $ubah) {
            $this->withSession($this->psikolog35())
                ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35', $ubah))
                ->assertStatus(422)
                ->assertJsonPath('message', $pesan);
        }

        $this->assertSame(0, \App\Models\CustomSession::count());
        $this->assertTidakAdaBooking();
    }

    public function test_layanan_yang_tidak_dibuka_psikolog_ditolak(): void
    {
        $this->fakeBookingBerhasil(['*/api/v1/public/professionals/35/services*' => Http::response(['data' => []])]);

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Layanan ini tidak dibuka psikolog tersebut.');

        $this->assertSame(0, \App\Models\CustomSession::count());
    }

    public function test_daftar_layanan_gagal_dimuat_tidak_menulis(): void
    {
        $this->fakeBookingBerhasil(['*/api/v1/public/professionals/35/services*' => Http::response(['title' => 'boom'], 500)]);

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $this->luarJadwal('35'))
            ->assertStatus(424)
            ->assertJsonPath('message', 'Durasi layanan gagal dimuat. Coba lagi.');

        $this->assertSame(0, \App\Models\CustomSession::count());
        $this->assertTidakAdaBooking();
    }

    public function test_klien_tanpa_nomor_hp_tidak_meninggalkan_sesi(): void
    {
        // Barisnya baru ditulis setelah klien terbaca: penolakan klien tidak
        // boleh meninggalkan Sesi Dadakan tanpa janji temu.
        $this->fakeBookingBerhasil($this->layanan('35') + [
            '*/api/v1/clients/502' => Http::response(['data' => ['id' => 502, 'fullName' => 'Sari', 'email' => 'sari@x.test', 'mobileNumber' => null]]),
        ]);
        $body = $this->luarJadwal('35', ['clientId' => 502]);
        unset($body['clientName'], $body['clientEmail'], $body['clientMobile']);

        $this->withSession($this->psikolog35())
            ->postJson('/dashboard/appointments/manual', $body)
            ->assertStatus(422)->assertJsonPath('needMobile', true);

        $this->assertSame(0, \App\Models\CustomSession::count());
    }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PHPUNIT --filter ManualAppointmentTest`

Expected: FAIL. These tests now return 201 without creating a row, because `luarJadwal` is ignored today:
- `test_psikolog_di_luar_jadwal_membuat_sesi_dadakan_lalu_memesan`
- `test_admin_di_luar_jadwal_wajib_centang_konfirmasi`
- `test_tumpang_tindih_sebagian_dengan_sesi_dadakan_ditolak`
- `test_jam_luar_jadwal_yang_tidak_sah_ditolak_tanpa_menulis`
- `test_layanan_yang_tidak_dibuka_psikolog_ditolak`
- `test_daftar_layanan_gagal_dimuat_tidak_menulis`

All the pre-existing tests still pass.

- [ ] **Step 3: Inject the service**

In `app/Http/Controllers/ManualAppointmentController.php`:
- Add `use App\Services\SesiDadakan;` after `use App\Services\PraktiquApi;`.
- Replace line 22 with:

```php
    public function __construct(
        private readonly PraktiquApi $api,
        private readonly SesiDadakan $sesiDadakan,
    ) {}
```

- [ ] **Step 4: Accept the two new fields**

In `store()`'s `$r->validate([...])` rules array, add these after the `'notes' => [...]` line:

```php
            // Jam di luar jadwal: Sesi Dadakan dibuat otomatis (rencanaLuarJadwal).
            'luarJadwal' => ['nullable', 'boolean'],
            'konfirmasiPsikolog' => ['nullable', 'boolean'],
```

- [ ] **Step 5: Check before reading the client**

Directly after the line `$data['clinicId'] = $this->klinikPesanan($profile, $data['clinicId'] ?? null);`, insert:

```php

        // Di luar jadwal: semua pemeriksaannya sebelum klien dibaca, supaya
        // penolakan tidak didahului request atas nama klien. Barisnya baru
        // ditulis tepat sebelum memesan, jadi galat klien tidak meninggalkannya.
        $rencana = null;
        if (! empty($data['luarJadwal'])) {
            $rencana = $this->rencanaLuarJadwal($profile, $data);
            if ($rencana instanceof JsonResponse) return $rencana;
        }
```

- [ ] **Step 6: Create the row before booking and delete it if booking fails**

Replace these lines:

```php
        try {
            $res = (new \App\Services\BookingApi($this->api))->submitBooking($slot, $client);
        } catch (ApiException $e) {
```

with:

```php
        $dibuat = $rencana && $rencana['buat'] ? \App\Models\CustomSession::create($rencana['buat']) : null;
        try {
            $res = (new \App\Services\BookingApi($this->api))->submitBooking($slot, $client);
        } catch (\Throwable $e) {
            // Janji temunya tidak jadi, jadi Sesi Dadakan yang dibuat untuknya
            // ikut dibatalkan — tanpa ini menu Sesi Dadakan menyimpan jam yatim.
            $dibuat?->delete();
            if (! $e instanceof ApiException) {
                throw $e;
            }
```

The rest of that catch body (the `$code = ...` mapping) stays as it is.

- [ ] **Step 7: Say so in the success message**

Directly after the statement that builds `$message` (it ends with `.' Setelah klien membayar, pakai "Tandai lunas & terjadwal" di daftar Appointments.';`), insert:

```php
        if ($dibuat) {
            $message .= " Sesi Dadakan {$rencana['rentang']} dibuat otomatis.";
        }
```

- [ ] **Step 8: Add `rencanaLuarJadwal()`**

Add this private method right after `store()`:

```php
    /**
     * Pemeriksaan janji temu di luar jadwal praktik, sebelum apa pun ditulis.
     *
     * Backend tidak memeriksa jam praktik sama sekali — batasnya hanya daftar
     * jam di modal ini. Jadi jam di luar jadwal dicatat sebagai Sesi Dadakan
     * seukuran layanan, dengan aturan yang sama dengan menu Sesi Dadakan
     * (SesiDadakan::periksaPembuat). Penolakan dikembalikan sebagai
     * JsonResponse; kalau boleh: atribut baris yang harus dibuat (null = sudah
     * ada sesi yang menampung) dan rentang jamnya untuk pesan sukses.
     *
     * @return JsonResponse|array{buat: ?array, rentang: string}
     */
    private function rencanaLuarJadwal(array $profile, array $data): JsonResponse|array
    {
        $doctorId = (int) $data['professionalId'];
        $periksa = $this->sesiDadakan->periksaPembuat($profile, $doctorId, $data['clinicId'] !== null ? (int) $data['clinicId'] : null);
        if ($periksa['tolak']) {
            return $periksa['tolak'];
        }

        // Psikolog yang memesan untuk dirinya sendiri tahu jamnya; peran lain
        // (admin, resepsionis, pemilik klinik, super) harus memastikannya dulu.
        if ($profile['role'] !== 'psikolog' && empty($data['konfirmasiPsikolog'])) {
            return response()->json(['message' => 'Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog.'], 422);
        }

        if (! preg_match('/^(\d{2}):(\d{2})$/', $data['startTime'], $jm) || (int) $jm[1] > 23 || (int) $jm[2] > 59 || (int) $jm[2] % 5 !== 0) {
            return response()->json(['message' => 'Jam mulai harus berformat JJ:MM dengan kelipatan 5 menit.'], 422);
        }
        $mulai = (int) $jm[1] * 60 + (int) $jm[2];
        if (\Illuminate\Support\Carbon::createFromFormat('Y-m-d H:i', $data['date'].' '.$data['startTime'], 'Asia/Jakarta')->lte(now('Asia/Jakarta'))) {
            return response()->json(['message' => 'Jam sudah lewat. Pilih jam lain.'], 422);
        }

        // Sumber durasi yang sama dengan jamCustom(). mapServices memberi
        // durasi 60 bila backend tidak menyebutnya, jadi layanan yang ada di
        // daftar selalu punya durasi; yang tidak ada memang tidak dibuka.
        try {
            $layanan = collect((new \App\Services\BookingApi($this->api))->fetchServices((string) $doctorId, $data['clinicId']))
                ->firstWhere('id', (string) $data['serviceId']);
        } catch (ApiException $e) {
            return response()->json(['message' => 'Durasi layanan gagal dimuat. Coba lagi.'], self::UPSTREAM_REJECTED);
        }
        $durasi = $layanan ? (int) $layanan['dur'] : 0;
        if ($durasi <= 0) {
            return response()->json(['message' => 'Layanan ini tidak dibuka psikolog tersebut.'], 422);
        }
        $selesai = $mulai + $durasi;
        if ($selesai > 24 * 60) {
            return response()->json(['message' => 'Sesi melewati tengah malam. Pilih jam lebih awal.'], 422);
        }
        $rentang = $data['startTime'].'–'.sprintf('%02d:%02d', intdiv($selesai, 60), $selesai % 60);

        if ($this->sesiDadakan->penampung($doctorId, $periksa['clinicId'], $data['date'], $mulai, $selesai)) {
            return ['buat' => null, 'rentang' => $rentang];
        }
        if ($this->sesiDadakan->bentrok($doctorId, $data['date'], $mulai, $selesai)) {
            return response()->json(['message' => 'Bentrok dengan Sesi Dadakan lain pada jam yang sama.'], 422);
        }

        return ['buat' => [
            'clinic_id' => $periksa['clinicId'],
            'doctor_id' => $doctorId,
            'date' => $data['date'],
            'start_time' => $data['startTime'],
            'duration' => $durasi,
            'kind' => 'dadakan',
            'note' => 'Otomatis dari Janji Manual',
            'created_by_role' => $profile['role'],
            'created_by_id' => $profile['userId'] ?? $profile['professionalId'] ?? null,
        ], 'rentang' => $rentang];
    }
```

- [ ] **Step 9: Run the tests**

Run: `PHPUNIT --filter 'ManualAppointmentTest|CustomSessionTest'`

Expected: `OK`.

If `test_psikolog_di_luar_jadwal_membuat_sesi_dadakan_lalu_memesan` fails on `start_time`, check what SQLite returns: the test already compares `substr(..., 0, 5)`. Do not change the stored format, because `jamCustom()` reads it the same way.

- [ ] **Step 10: Commit**

```bash
git add app/Http/Controllers/ManualAppointmentController.php tests/Feature/ManualAppointmentTest.php
git commit -m "feat(janji-manual): pesan di luar jadwal membuat Sesi Dadakan otomatis

luarJadwal di store(): aturan Sesi Dadakan diperiksa sebelum klien
dibaca, sesi seukuran layanan ditulis tepat sebelum memesan dan dihapus
lagi bila booking gagal. Selain psikolog wajib konfirmasiPsikolog.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Janji Manual modal — "+ Jam lain (di luar jadwal)"

**Files:**
- Modify: `resources/views/dashboard.blade.php`:
  - Alpine state around line 489.
  - `resetManualJam()` around line 942.
  - Modal open around line 871.
  - New getters and methods after `pakaiJamTerdekat()`.
  - `submitManualAppointment()` around line 1040.
  - Markup in "3 · Tanggal & Jam" around lines 5612-5633.
  - The Pesan button around line 5641.
- Test: `tests/js/janji-manual-jam.test.mjs`.

**Interfaces:**
- Consumes: from Task 2, the HTTP contract (`luarJadwal`, `konfirmasiPsikolog`, `startTime`).
- Produces: Alpine members:
  - state `manualLuarJadwal`, `manualJamLain`, `manualKonfirmasi`;
  - getters `manualBolehJamLain`, `manualPerluKonfirmasi`, `manualRentangLain`;
  - methods `mulaiJamLain()`, `batalJamLain()`, `pilihJamLain(t)`, `pilihSlotManual(t)`, `salahJamLain()`.

- [ ] **Step 1: Write the failing JS tests**

1a. The fake `fetch` must keep the request body. In `tests/js/janji-manual-jam.test.mjs`, change:

```js
globalThis.fetch = (url) => new Promise((lepas) => {
```

to:

```js
globalThis.fetch = (url, init = {}) => new Promise((lepas) => {
```

and change:

```js
  const p = { url: String(url), tanggal: u.searchParams.get('date'), pro: u.searchParams.get('professionalId'), jawab };
```

to:

```js
  const p = { url: String(url), init, tanggal: u.searchParams.get('date'), pro: u.searchParams.get('professionalId'), jawab };
```

1b. Insert this block right before the line `if (gagal) { console.log(`:

```js
// 11. Jam di luar jadwal: server membuat Sesi Dadakan otomatis.
app.muatHalaman = () => {};
const kirimManual = () => permintaan.filter((p) => p.url === '/dashboard/appointments/manual');
siapkan();
jadwal[hariKe(1)] = { times: ['09:00'], live: true };
await app.loadManualSlots(); await tenang();
cek('jam lain ditawarkan saat daftar jam ada', app.manualBolehJamLain === true);
app.mulaiJamLain();
cek('mode jam lain aktif dan slot terpilih dikosongkan', app.manualLuarJadwal === true && app.manualForm.startTime === '');
app.pilihJamLain('09:00');
cek('jam yang sama dengan slot → slot itu yang dipilih', app.manualLuarJadwal === false && app.manualForm.startTime === '09:00');
app.mulaiJamLain(); app.pilihJamLain('21:15');
cek('pratinjau rentang memakai durasi layanan', app.manualRentangLain === '21:15–22:45 · 90 menit (sesuai layanan)', app.manualRentangLain);
cek('admin wajib centang konfirmasi', app.manualPerluKonfirmasi === true);
permintaan = [];
await app.submitManualAppointment();
cek('tanpa centang → tidak dikirim', kirimManual().length === 0 && app.manualError === 'Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog.', app.manualError);
app.manualKonfirmasi = true;
await app.submitManualAppointment(); await tenang();
const badanManual = kirimManual()[0] && JSON.parse(kirimManual()[0].init.body);
cek('dikirim sebagai luarJadwal dengan jam yang diketik', !!badanManual && badanManual.luarJadwal === true && badanManual.konfirmasiPsikolog === true && badanManual.startTime === '21:15', JSON.stringify(badanManual));

// 12. Tanggal tanpa jam juga boleh, tapi jangan melewati tengah malam.
siapkan();
jadwal[hariKe(1)] = { times: [], live: true };
await app.loadManualSlots(); await tenang();
cek('jam lain juga ditawarkan saat tanggalnya kosong', app.manualBolehJamLain === true);
app.mulaiJamLain(); app.pilihJamLain('23:00'); app.manualKonfirmasi = true; permintaan = [];
await app.submitManualAppointment();
cek('melewati tengah malam → tidak dikirim', kirimManual().length === 0 && app.manualError === 'Sesi melewati tengah malam. Pilih jam lebih awal.', app.manualError);

// 13. Ganti psikolog/layanan/tanggal mengakhiri mode jam lain.
app.resetManualJam();
cek('reset jam mengakhiri mode jam lain', app.manualLuarJadwal === false && app.manualJamLain === '' && app.manualKonfirmasi === false);

// 14. Psikolog yang memesan untuk dirinya sendiri tidak perlu centang.
app.role = 'psikolog'; app.mulaiJamLain();
cek('psikolog tidak perlu centang', app.manualPerluKonfirmasi === false);
app.role = 'admin'; app.batalJamLain();

// 15. Tanggal lampau tidak menawarkan jam lain.
siapkan({ date: hariKe(-1) });
await app.loadManualSlots();
cek('tanggal lampau tidak menawarkan jam lain', app.manualBolehJamLain === false);

// 16. Tampilan.
cek('tautan jam lain terikat ke manualBolehJamLain', /x-show="manualBolehJamLain && !manualLuarJadwal"[^>]*>\+ Jam lain \(di luar jadwal\)</.test(blade));
cek('tombol slot memakai pilihSlotManual', /@click="pilihSlotManual\(t\)"/.test(blade));
cek('tombol Pesan dikunci tanpa centang', /:disabled="manualBusy \|\| \(manualPerluKonfirmasi && !manualKonfirmasi\)"/.test(blade));

```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/js/janji-manual-jam.test.mjs`

Expected: tests 1-10 `OK`. The run then stops with `TypeError: app.mulaiJamLain is not a function`, or shows `FAIL jam lain ditawarkan…`. Exit code is non-zero.

- [ ] **Step 3: Add the state**

In `dashboard.blade.php`, directly after the line `    manualSlots: [], manualSlotsError: "",`, insert:

```js
    // Jam di luar jadwal (lihat mulaiJamLain): jam yang diketik staf dan
    // centang konfirmasinya. Server membuat Sesi Dadakan untuknya.
    manualLuarJadwal: false, manualJamLain: "", manualKonfirmasi: false,
```

- [ ] **Step 4: Reset it with the rest of the time state**

In `resetManualJam()`, change:

```js
      this.manualJamTerdekat = null; this.manualMencariJam = false;
    },
```

to:

```js
      this.manualJamTerdekat = null; this.manualMencariJam = false;
      this.batalJamLain();
    },
```

In the modal-open function, directly after the line that starts `      this.manualForm = { clientId: "", clientName: "", clientEmail: "", clientMobile: "", serviceId: "", professionalId: myProId,`, insert:

```js
      this.batalJamLain();
```

- [ ] **Step 5: Add the getters and methods**

Directly after the `pakaiJamTerdekat() { … },` method (it ends with `this.loadManualSlots();` then `    },`), insert:

```js
    // Jam di luar jadwal: staf mengetik jam sendiri, dan server membuat Sesi
    // Dadakan seukuran layanan sebelum memesan (ManualAppointmentController::
    // rencanaLuarJadwal). Ditawarkan hanya setelah daftar jam terjawab — ada
    // atau kosong; saat memuat, galat, lampau, atau layanan tidak dilayani,
    // jam lain tidak masuk akal. Tanpa saringan peran: semua peran FE boleh,
    // dan cakupannya ditegakkan server.
    get manualBolehJamLain() {
      return !!(this.manualForm.professionalId && this.manualForm.serviceId && this.manualForm.date)
        && ["ada", "kosong"].includes(this.manualSlotsStatus);
    },
    // Psikolog yang memesan untuk dirinya sendiri tahu jamnya; peran lain
    // (admin, resepsionis, pemilik klinik, super) harus memastikannya dulu.
    get manualPerluKonfirmasi() {
      return this.manualLuarJadwal && !(this.peranUi === "psikolog" || this.peranUi === "doctor");
    },
    get manualRentangLain() {
      const d = this.manualDurasi;
      const m = /^(\d{2}):(\d{2})$/.exec(this.manualJamLain || "");
      if (!m || d <= 0) return "";
      const akhir = Number(m[1]) * 60 + Number(m[2]) + d;
      if (akhir > 24 * 60) return "";
      const jj = (n) => String(n).padStart(2, "0");
      return `${this.manualJamLain}–${jj(Math.floor(akhir / 60))}:${jj(akhir % 60)} · ${d} menit (sesuai layanan)`;
    },
    mulaiJamLain() {
      this.manualLuarJadwal = true; this.manualForm.startTime = "";
      this.manualJamLain = ""; this.manualKonfirmasi = false;
    },
    batalJamLain() { this.manualLuarJadwal = false; this.manualJamLain = ""; this.manualKonfirmasi = false; },
    // Jam yang sudah ada di daftar dipesan sebagai slot biasa: jam praktik
    // tidak perlu Sesi Dadakan.
    pilihJamLain(t) {
      if (this.manualSlots.includes(t)) { this.pilihSlotManual(t); return; }
      this.manualJamLain = t;
    },
    pilihSlotManual(t) { this.batalJamLain(); this.manualForm.startTime = t; },
    // Pemeriksaan cepat di browser; server (rencanaLuarJadwal) tetap penentunya.
    salahJamLain() {
      const m = /^(\d{2}):(\d{2})$/.exec(this.manualJamLain || "");
      if (!m) return "Isi jam mulai di luar jadwal.";
      if (this.manualPerluKonfirmasi && !this.manualKonfirmasi) return "Centang konfirmasi bahwa jam ini sudah disepakati dengan psikolog.";
      const d = new Date();
      const kini = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      if (this.manualForm.date === todayIso() && this.manualJamLain <= kini) return "Jam sudah lewat. Pilih jam lain.";
      if (Number(m[1]) * 60 + Number(m[2]) + this.manualDurasi > 24 * 60) return "Sesi melewati tengah malam. Pilih jam lebih awal.";
      return "";
    },
```

- [ ] **Step 6: Send the typed time from `submitManualAppointment()`**

Replace:

```js
      if (!this.manualForm.startTime) { this.manualError = this.manualPesanJam; return; }
```

with:

```js
      if (this.manualLuarJadwal) {
        const salah = this.salahJamLain();
        if (salah) { this.manualError = salah; return; }
      } else if (!this.manualForm.startTime) { this.manualError = this.manualPesanJam; return; }
```

In the `const body = { … }` line, change `startTime: this.manualForm.startTime,` to:

```js
startTime: this.manualLuarJadwal ? this.manualJamLain : this.manualForm.startTime,
```

Directly after the line `        if (this.manualForm.clinicId) body.clinicId = this.manualForm.clinicId;`, insert:

```js
        if (this.manualLuarJadwal) { body.luarJadwal = true; body.konfirmasiPsikolog = !!this.manualKonfirmasi; }
```

- [ ] **Step 7: Markup**

7a. In the slot button, change `@click="manualForm.startTime=t"` to `@click="pilihSlotManual(t)"`. Leave its `:style` object as it is.

7b. Directly before the line `          <div x-show="manualForm.startTime" style="font-size:12px;color:#3858D6;font-weight:700;margin-top:8px">Jam dipilih:`, insert:

```html
          {{-- Jam di luar jadwal: server membuat Sesi Dadakan seukuran layanan
               lalu memesan (ManualAppointmentController::rencanaLuarJadwal).
               Cakupan peran ditegakkan server; tautan ini untuk semua peran. --}}
          <button type="button" x-show="manualBolehJamLain && !manualLuarJadwal" @click="mulaiJamLain()" style="margin-top:8px;padding:0;border:0;background:none;color:#3858D6;font-size:12.5px;font-weight:700;cursor:pointer">+ Jam lain (di luar jadwal)</button>
          <div x-show="manualLuarJadwal" style="margin-top:8px;background:#fff;border:1px solid #C7D2FE;border-radius:10px;padding:10px 12px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <input class="inp inp-blue" type="time" step="300" :value="manualJamLain" @change="pilihJamLain($event.target.value)" style="max-width:120px" aria-label="Jam mulai di luar jadwal">
              <span x-show="manualRentangLain" style="font-size:12.5px;color:#334155;font-weight:700" x-text="manualRentangLain"></span>
              <button type="button" @click="batalJamLain()" style="margin-left:auto;padding:0;border:0;background:none;color:#64748B;font-size:12px;font-weight:700;cursor:pointer">Batal</button>
            </div>
            <div style="font-size:12px;color:#9A6B00;margin-top:6px">Jam ini di luar jadwal praktik. Sesi Dadakan akan dibuat otomatis.</div>
            <label x-show="manualPerluKonfirmasi" style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12.5px;color:#334155;font-weight:600;cursor:pointer">
              <input type="checkbox" x-model="manualKonfirmasi"> Sudah dikonfirmasi dengan psikolog
            </label>
          </div>
```

7c. On the Pesan button, change `:disabled="manualBusy"` (the one on the `btn-primary` button with `@click="submitManualAppointment()"`) to:

```html
:disabled="manualBusy || (manualPerluKonfirmasi && !manualKonfirmasi)"
```

- [ ] **Step 8: Run the JS tests**

Run: `node tests/js/janji-manual-jam.test.mjs`

Expected: every line `OK`, ending with `semua lolos`.

- [ ] **Step 9: Run the whole JS loop and a Blade compile**

CI runs neither of these.

```bash
for f in tests/js/*.test.mjs; do node "$f" > /dev/null || echo "GAGAL $f"; done
DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php artisan view:cache
```

Expected:
- the loop prints no `GAGAL` line;
- `view:cache` prints `Blade templates cached successfully`.

Then clear the cache again, so it is not committed:

```bash
DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php artisan view:clear
```

- [ ] **Step 10: Commit**

```bash
git add resources/views/dashboard.blade.php tests/js/janji-manual-jam.test.mjs
git commit -m "feat(janji-manual): pilihan jam di luar jadwal di modal

Tautan '+ Jam lain (di luar jadwal)' setelah daftar jam terjawab; jam yang
sama dengan slot memilih slot itu, selain psikolog wajib centang
konfirmasi, dan pratinjau rentang memakai durasi layanan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Full verification, browser smoke test, push

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-janji-manual-luar-jadwal-design.md` in the backend repo, only if verification shows the spec is wrong somewhere.

- [ ] **Step 1: Full PHP suite**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`

Expected: `OK`. Any failure outside the two touched suites must be checked against the Task 1 Step 2 baseline before it is blamed on this branch. Run the same file on `../main` to compare.

- [ ] **Step 2: Browser smoke test**

Follow the recipe in the memory note `fe-local-browser-smoke-test` (Docker network, `php artisan serve` in `php:8.4-cli`, forged session, Playwright from the mcr image with the backend repo's `playwright-core`). Two differences:

- **The session is `role: admin` with `practiceId: 4`.**
- **The stub backend** answers:
  - `GET /api/v1/public/professionals?clinicId=4` → `{"data":[{"id":34,"fullName":"Dr. A"}]}`
  - `GET /api/v1/public/professionals/34/services…` → `{"data":[{"id":12,"name":"Konseling","price":"0","durationMinutes":60}]}`
  - `GET /api/v1/public/professionals/34/slots…` → `{"data":[]}`
  - `GET /api/v1/clients…` → `{"data":[]}`
  - `POST /api/v1/public/booking/hold` → `{"holdKey":"h1"}`
  - `POST /api/v1/public/appointments` → status 201, `{"id":902,"token":"tok-902"}`
  - anything else → `{"data":[],"items":[],"total":0}`

Drive these steps:
1. Open the dashboard, then Janji Manual.
2. Fill in a new client (name, email, phone).
3. Choose Dr. A and Konseling, and a date tomorrow.
4. Expect the "Tidak ada jam kosong" box and, under it, "+ Jam lain (di luar jadwal)".
5. Click it, type `21:15`, and expect the preview "21:15–22:15 · 60 menit (sesuai layanan)". Expect the Pesan button to be disabled.
6. Tick "Sudah dikonfirmasi dengan psikolog" and click Pesan Sesi.
7. Expect the green message to end with "Sesi Dadakan 21:15–22:15 dibuat otomatis."
8. Close the modal and open the Sesi Dadakan list. Expect a row for 21:15 with 60 menit.
9. Reopen Janji Manual with the same choices. Expect `21:15` among the slot buttons.

Take one screenshot at step 5 and one at step 7, and keep them in the scratchpad.

- [ ] **Step 3: Push and hand over the compare link**

```bash
cd /home/ahmad/projects/praktiqu-fe/luar-jadwal && git push -u origin feat/janji-luar-jadwal
```

Expected: the push succeeds through the repo's `core.sshCommand` key. Give the user `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/janji-luar-jadwal`; the user opens the PR. Note in the hand-over:
- No backend or plugin change is needed. The FE deploys from `main` through `.github/workflows/deploy.yml` ("Deploy to Production"), so check that the run passed after the merge.
- Product trial: an admin books an out-of-schedule time for a test psikolog.
