# Opsi Durasi Layanan — Frontend (Laravel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wherever the backend marks a service as a duration option of another, show it as one service with selectable durations. That covers patient booking (including personal links), the manual-booking modal and the dashboard service list. The service edit form gains an "Opsi durasi lain" section that sends `durationOptions` to the backend.

**Architecture:** The backend keeps its lists flat, with `durationOf` on option rows. The FE groups them for display only, so every lookup by id keeps working unchanged: slots, submit, `ManualAppointmentController::jamCustom`, reports. Grouping for booking and manual booking happens once in `BookingApi::mapServices`. The dashboard list uses the parent's `durationOptions` and hides option rows.

**Tech Stack:** Laravel 13 (PHP 8.4), Blade + Alpine 3.14, PHPUnit with `Http::fake`, node-run JS tests against the real `dashApp()` script.

**Prerequisite:** the backend plan `docs/superpowers/plans/2026-11-06-opsi-durasi-layanan-be.md` is implemented. Its contract:
- `GET /api/v1/public/professionals/{id}/services` rows carry `durationOf: number | null`, the parent's public id;
- `GET /api/v1/services` rows carry `durationOf` and `durationOptions: [{ id, serviceId, name, durationMinutes, price, isActive }]`;
- `PUT /api/v1/services/{id}` accepts `durationOptions: [{ id?, duration, price }]`;
- errors: 422 `duration_option_limit` / `duration_option_duplicate` / `duration_option_not_found` / `edit_via_parent`; 409 `duration_option_has_appointments` with `count`, and 409 `service_name_taken`.

**Spec:** `docs/superpowers/specs/2026-11-05-opsi-durasi-layanan-design.md` (in the backend repo).

## Global Constraints

- Repo: `raakanaka/laravel-praktiqu`. Worktree: `/home/ahmad/projects/praktiqu-fe/opsi-durasi`, branch `feat/opsi-durasi-layanan` (from `origin/main` d542a6c). Never edit `/home/ahmad/projects/nextjs-appointment-praktiqu/Front-End Laravel` (read-only vendored copy).
- The FE repo has no committer identity. Commit with `git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit ...`, ending messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- PHP runs only in Docker. From the worktree:
  - `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter <Name>`;
  - full suite without `--filter`;
  - Blade compile check: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest php artisan view:cache`.
  If Docker says the credential helper is broken, prefix with `DOCKER_CONFIG=/tmp/dockercfg` (a dir whose `config.json` is `{}`).
- JS tests: `node tests/js/<file>.test.mjs`. They print `OK`/`FAIL` lines and exit 1 on failure. CI runs none of them, so run them all before pushing: `for f in tests/js/*.test.mjs; do node "$f" || echo "FAILED $f"; done`.
- Copy is Indonesian; use the term "psikolog/profesional", never "doctor", in anything user-visible.
- Alpine trap: a string `:style` binding wipes the element's static `style`. Use `:class` for state, static `style`/CSS for looks.
- At most 4 extra durations (5 lengths in all).

## File Structure

| File | Responsibility |
| --- | --- |
| `app/Services/BookingApi.php` | `mapService` reads `durationOf` → `opsiDari`/`opsiDariId`/`menit`; `gabungDurasi()` gives each parent a `durasi` list |
| `resources/views/booking.blade.php` | Hide option rows from the card grid; card picks within its durations; duration chips under the card |
| `public/css/app.css` | `.svc-pilihan`, `.svc-durasi`, `.svc-durasi-chip` |
| `app/Http/Controllers/ManualAppointmentController.php` | `services()` passes `opsiDari` + `durasi` through |
| `resources/views/dashboard.blade.php` | Manual modal: service select (parents) + duration select; service list chips; edit form "Opsi durasi lain" |
| `app/Http/Controllers/DashboardController.php` | `mapLayanan` reads `durationOf`/`durationOptions`; `sapuLayanan` drops option rows |
| `app/Http/Controllers/ServiceController.php` | Validate + forward `durasiOpsi` → `durationOptions`; Indonesian messages per error code |

---

### Task 0: Worktree ready

- [ ] **Step 1: Verify the worktree and vendor**

```bash
cd /home/ahmad/projects/praktiqu-fe/opsi-durasi
git status -sb            # expect: ## feat/opsi-durasi-layanan...origin/main
[ -d vendor ] || cp -a ../main/vendor ./vendor
docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter BookingHalamanTest
```

Expected: the branch line as shown, then PHPUnit `OK`. `vendor/` is gitignored, so `git status` stays clean.

---

### Task 1: Group duration options in `BookingApi`

**Files:**
- Modify: `app/Services/BookingApi.php` (`mapServices`, `mapService`, new `gabungDurasi`)
- Test: `tests/Feature/BookingOpsiDurasiTest.php` (new)

**Interfaces:**
- Produces fields on every mapped service:
  - `menit: int`;
  - `opsiDari: ?string` — the parent's `key` (`<id>@<clinic>`, or `<id>` without a clinic);
  - `opsiDariId: ?string` — the parent's public id;
  - `durasi: array` — on a parent with options: `[{key, apiId, menit, dur, price, usd}]`, the parent included, sorted by `menit`; otherwise `[]`.
- An option whose parent is not in the list gets `opsiDari = null` and `opsiDariId = null`, so it shows as an ordinary service.
- `public static function gabungDurasi(array $layanan): array`.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/BookingOpsiDurasiTest.php

namespace Tests\Feature;

use App\Services\BookingApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Opsi durasi: backend mengirim daftar DATAR, baris opsi membawa `durationOf`
// = id publik induknya. Daftar tetap datar di sini juga — slot, submit, dan
// janji manual mencari layanan berdasarkan id — hanya induk yang membawa
// `durasi` untuk ditampilkan sebagai satu kartu.
class BookingOpsiDurasiTest extends TestCase
{
    private function layanan(array $baris): array
    {
        Http::fake(['*/api/v1/public/professionals/34/services*' => Http::response(['data' => $baris])]);

        return app(BookingApi::class)->fetchServices('34', '4');
    }

    public function test_induk_membawa_semua_durasinya_dan_opsi_tetap_di_daftar(): void
    {
        $s = $this->layanan([
            ['id' => 101, 'name' => 'Konseling Individu', 'price' => '425000', 'durationMinutes' => 60, 'clinicId' => 4, 'durationOf' => null],
            ['id' => 201, 'name' => 'Konseling Individu (90 menit)', 'price' => '600000', 'durationMinutes' => 90, 'clinicId' => 4, 'durationOf' => 101],
            ['id' => 300, 'name' => 'Tes Psikologi', 'price' => '300000', 'durationMinutes' => 120, 'clinicId' => 4],
        ]);

        $this->assertCount(3, $s);
        $this->assertSame(['101@4', '201@4'], array_column($s[0]['durasi'], 'key'));
        $this->assertSame([60, 90], array_column($s[0]['durasi'], 'menit'));
        $this->assertSame([425000.0, 600000.0], array_column($s[0]['durasi'], 'price'));
        $this->assertNull($s[0]['opsiDari']);
        $this->assertSame('101@4', $s[1]['opsiDari']);
        $this->assertSame('101', $s[1]['opsiDariId']);
        $this->assertSame([], $s[1]['durasi']);
        $this->assertSame([], $s[2]['durasi']);
    }

    public function test_opsi_yang_induknya_tidak_ada_tampil_sebagai_layanan_biasa(): void
    {
        $s = $this->layanan([
            ['id' => 201, 'name' => 'Konseling Individu (90 menit)', 'price' => '600000', 'durationMinutes' => 90, 'clinicId' => 4, 'durationOf' => 999],
        ]);

        $this->assertNull($s[0]['opsiDari']);
        $this->assertNull($s[0]['opsiDariId']);
    }

    public function test_tanpa_durationOf_backend_lama_tidak_berubah(): void
    {
        $s = $this->layanan([
            ['id' => 101, 'name' => 'Konseling Individu', 'price' => '425000', 'durationMinutes' => 60, 'clinicId' => 4],
        ]);

        $this->assertNull($s[0]['opsiDari']);
        $this->assertSame([], $s[0]['durasi']);
        $this->assertSame(60, $s[0]['menit']);
    }

    public function test_pengelompokan_per_klinik_di_tautan_pribadi(): void
    {
        // Id katalog sama di dua klinik; opsi klinik 7 tidak boleh nempel ke induk klinik 4.
        Http::fake(['*/api/v1/public/professionals/34/services*' => Http::response(['data' => [
            ['id' => 101, 'name' => 'Konseling', 'price' => '425000', 'durationMinutes' => 60, 'clinicId' => 4],
            ['id' => 101, 'name' => 'Konseling', 'price' => '500000', 'durationMinutes' => 60, 'clinicId' => 7],
            ['id' => 201, 'name' => 'Konseling (90 menit)', 'price' => '700000', 'durationMinutes' => 90, 'clinicId' => 7, 'durationOf' => 101],
        ]])]);

        $s = app(BookingApi::class)->fetchServices('34');

        $this->assertSame([], $s[0]['durasi']);
        $this->assertSame(['101@7', '201@7'], array_column($s[1]['durasi'], 'key'));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter BookingOpsiDurasiTest`
Expected: FAIL — undefined index `durasi`.

- [ ] **Step 3: Implement**

In `app/Services/BookingApi.php`:

1. In `mapServices`, replace `return array_values($out);` with:

```php
        return self::gabungDurasi(array_values($out));
```

2. In `mapService`, before `return [`, add:

```php
        // Opsi durasi: backend menandai baris yang merupakan durasi lain dari
        // layanan induk dengan `durationOf` = id publik induknya (di klinik yang
        // sama). Kunci induk dibentuk persis seperti `key`, supaya di tautan
        // pribadi opsi klinik A tidak tertempel ke induk klinik B.
        $induk = $s['durationOf'] ?? null;
        $induk = is_numeric($induk) && (int) $induk > 0 ? (string) (int) $induk : null;
```

   And inside the returned array, after `'dur' => ...,`, add:

```php
            'menit' => (int) ($s['durationMinutes'] ?? 60),
            // Lihat gabungDurasi(). Baris opsi TETAP ada di daftar: slot, submit,
            // dan janji manual mencarinya berdasarkan id.
            'opsiDari' => $induk === null ? null : $induk.($klinik !== null ? '@'.$klinik : ''),
            'opsiDariId' => $induk,
            'durasi' => [],
```

3. Add this method below `mapServices`:

```php
    // Satu layanan, beberapa durasi (2026-11-06). Induk mendapat `durasi`:
    // semua pilihannya — dirinya sendiri dan opsinya — terurut dari durasi
    // terpendek, untuk chip di kartu booking dan dropdown janji manual. Opsi
    // tetap berdiri di daftar sebagai baris biasa; yang menyembunyikannya
    // adalah tampilan (`opsiDari` terisi).
    //
    // Opsi yang induknya tidak ada di daftar ini — tersaring, atau data yang
    // janggal — dilepas penandanya dan tampil sebagai layanan biasa, bukan
    // lenyap: layanan yang bisa dipesan tidak boleh hilang dari layar.
    public static function gabungDurasi(array $layanan): array
    {
        $kunciInduk = [];
        foreach ($layanan as $s) {
            if (($s['opsiDari'] ?? null) === null) {
                $kunciInduk[$s['key']] = true;
            }
        }

        $anak = [];
        foreach ($layanan as $i => $s) {
            $dari = $s['opsiDari'] ?? null;
            if ($dari === null) {
                continue;
            }
            if (! isset($kunciInduk[$dari])) {
                $layanan[$i]['opsiDari'] = null;
                $layanan[$i]['opsiDariId'] = null;

                continue;
            }
            $anak[$dari][] = $s;
        }

        foreach ($layanan as $i => $s) {
            if (($s['opsiDari'] ?? null) !== null || empty($anak[$s['key']])) {
                continue;
            }
            $pilihan = array_merge([$s], $anak[$s['key']]);
            usort($pilihan, fn (array $a, array $b) => $a['menit'] <=> $b['menit']);
            $layanan[$i]['durasi'] = array_map(fn (array $p) => [
                'key' => $p['key'],
                'apiId' => $p['apiId'],
                'menit' => $p['menit'],
                'dur' => $p['dur'],
                'price' => $p['price'],
                'usd' => $p['usd'],
            ], $pilihan);
        }

        return $layanan;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter 'BookingOpsiDurasiTest|BookingTenantMappingTest|BookingTautanPribadiTest|BookingHalamanTest'`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add app/Services/BookingApi.php tests/Feature/BookingOpsiDurasiTest.php
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(booking): kelompokkan opsi durasi ke layanan induknya

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Booking page — one card, durations as chips

**Files:**
- Modify: `resources/views/booking.blade.php` (`serviceGroups`, three new methods, card markup around lines 1245-1287)
- Modify: `public/css/app.css` (append chip styles)
- Test: `tests/Feature/BookingHalamanTest.php` (append one test)

**Interfaces:**
- Consumes: `durasi`, `opsiDari`, `key` from Task 1, inside `tenant.services`.
- Produces Alpine methods:
  - `pilihanDi(x)` — the row selected within card `x`, or `x`;
  - `kartuDipilih(x): boolean`;
  - `pilihKartu(x)` — selects `x.key` unless the selection is already inside this card.

- [ ] **Step 1: Write the failing test**

Append to `tests/Feature/BookingHalamanTest.php`:

```php
    public function test_opsi_durasi_tampil_sebagai_satu_kartu_dengan_pilihan_durasi(): void
    {
        Http::fake([
            '*/api/v1/public/config' => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60], 200),
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => [
                ['id' => 101, 'name' => 'Konseling Individu', 'price' => 425000, 'durationMinutes' => 60, 'clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null, 'durationOf' => null],
                ['id' => 201, 'name' => 'Konseling Individu (90 menit)', 'price' => 600000, 'durationMinutes' => 90, 'clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null, 'durationOf' => 101],
            ]], 200),
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat']]], 200),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);

        $html = $this->get('/klinik-sehat')->assertOk()->getContent();

        // Data: induk membawa kedua durasinya, opsi tetap di daftar dengan penandanya.
        $this->assertStringContainsString('"opsiDari":"101@4"', $html);
        $this->assertStringContainsString('"durasi":[{"key":"101@4"', $html);
        // Tampilan: baris opsi tidak jadi kartu sendiri, dan durasi dipilih lewat grup radio.
        $this->assertStringContainsString('if (x.opsiDari) continue;', $html);
        $this->assertStringContainsString('x-for="d in x.durasi"', $html);
        $this->assertStringContainsString('role="radiogroup" :aria-label="\'Durasi \' + x.name"', $html);
        $this->assertStringContainsString('@click="pilihKartu(x)"', $html);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter test_opsi_durasi_tampil_sebagai_satu_kartu`
Expected: FAIL on `if (x.opsiDari) continue;`. The data assertions already pass after Task 1.

- [ ] **Step 3: Implement the script part**

In `resources/views/booking.blade.php`:

1. In `get serviceGroups()`, change the loop's first line from `for (const x of this.services) {` to:

```js
      for (const x of this.services) {
        // Opsi durasi tidak jadi kartu sendiri: ia pilihan di kartu induknya
        // (lihat BookingApi::gabungDurasi). Ia tetap ada di `services`, karena
        // `svc` dan submit mencari baris terpilih berdasarkan key.
        if (x.opsiDari) continue;
```

2. Directly after the `selectService(id) { ... },` method, add:

```js
    // Kartu dengan opsi durasi. Pilihan di kartu ini bisa induknya atau salah
    // satu opsinya; harga & durasi di kartu mengikuti yang terpilih.
    pilihanDi(x) {
      if (!x.durasi || !x.durasi.length) return x;
      return this.services.find((s) => s.key === this.serviceId && (s.key === x.key || s.opsiDari === x.key)) || x;
    },
    kartuDipilih(x) { return this.serviceId === x.key || (!!this.svc && this.svc.opsiDari === x.key); },
    // Klik kartu yang pilihannya sudah di kartu ini (mis. opsi 90 menit) tidak
    // boleh mengembalikannya diam-diam ke durasi utama.
    pilihKartu(x) { if (!this.kartuDipilih(x)) this.selectService(x.key); },
```

- [ ] **Step 4: Implement the markup**

Replace the whole `<template x-for="x in g.items" :key="x.key"> ... </template>` block inside the service grid with:

```html
              <template x-for="x in g.items" :key="x.key">
                {{-- Pembungkus: grup radio durasi berada DI LUAR kartu (role=radio),
                     karena kontrol interaktif di dalam kontrol interaktif tidak
                     terbaca dengan benar oleh pembaca layar. --}}
                <div class="svc-pilihan">
                <div class="svc-card" :class="{ sel: kartuDipilih(x) }" @click="pilihKartu(x)"
                     role="radio" tabindex="0" :aria-checked="kartuDipilih(x) ? 'true' : 'false'"
                     @keydown.enter.prevent="pilihKartu(x)" @keydown.space.prevent="pilihKartu(x)">
                  <div style="flex:1;min-width:0">
                    {{-- min-width:0 + overflow-wrap: nama panjang tanpa spasi
                         (slug dari backend lama) dibungkus di dalam kartu,
                         bukan mendorong kartu melebar dan terpotong. --}}
                    <div style="font-size:16px;font-weight:700;color:#1E2236;overflow-wrap:anywhere" x-text="x.name"></div>
                    {{-- Tautan pribadi (/{nama}) tidak punya klinik, dan layanan
                         SETIAP kliniknya tampil: dua baris yang identik hanya
                         bisa dibedakan lewat nama kliniknya. Di halaman klinik
                         semua barisnya klinik yang sama dan halaman sudah
                         menyebut namanya, jadi markup ini tidak dirender. --}}
                    @if (empty($tenant['apiId']))
                      <div x-show="x.clinicName" style="font-size:12.5px;color:#8A90A6;margin-top:2px" x-text="x.clinicName"></div>
                    @endif
                    <div x-show="x.desc" style="font-size:13px;color:#6B7090;margin-top:5px;line-height:1.5" x-text="x.desc"></div>
                    {{-- Harga ikut di kartu, bukan cuma di ringkasan langkah 5.
                         Satu psikolog kerap punya beberapa layanan yang nama,
                         deskripsi, dan durasinya identik dan HANYA berbeda harga
                         (psikolog 34: konseling 60 menit seharga 425rb, 450rb,
                         475rb, 550rb, 750rb). Tanpa harga, kartu-kartu itu tampak
                         sebagai pilihan yang persis sama dan pasien baru tahu
                         tagihannya empat langkah kemudian. Dengan opsi durasi,
                         angkanya mengikuti durasi yang terpilih di kartu ini. --}}
                    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:10px">
                      <div style="font-size:15px;font-weight:800;color:#425FAD" x-text="pilihanDi(x).usd ? '$' + pilihanDi(x).usd.price : (pilihanDi(x).price > 0 ? fmt(pilihanDi(x).price) : 'Gratis')"></div>
                      <div style="font-size:12.5px;color:#8A90A6;font-weight:600" x-text="pilihanDi(x).dur"></div>
                    </div>
                    {{-- Klinik internasional: dolar dari backend jadi angka utama,
                         Rupiah kecil di bawahnya. --}}
                    <div x-show="pilihanDi(x).usd" style="font-size:12px;color:#8A90A6;margin-top:3px" x-text="fmt(pilihanDi(x).price)"></div>
                  </div>
                  <div class="radio"><div class="radio-dot" x-show="kartuDipilih(x)"></div></div>
                </div>
                {{-- Pilihan durasi. Mengganti durasi = mengganti layanan:
                     selectService() mengosongkan tanggal & jam, dan jadwal
                     dipindai ulang karena slotnya bergantung pada durasi. --}}
                <div x-show="x.durasi && x.durasi.length > 1" class="svc-durasi" role="radiogroup" :aria-label="'Durasi ' + x.name">
                  <template x-for="d in x.durasi" :key="d.key">
                    <button type="button" class="svc-durasi-chip" role="radio" :class="{ sel: serviceId === d.key }"
                            :aria-checked="serviceId === d.key ? 'true' : 'false'" @click="selectService(d.key)"
                            x-text="d.dur + ' · ' + (d.usd ? '$' + d.usd.price : (d.price > 0 ? fmt(d.price) : 'Gratis'))"></button>
                  </template>
                </div>
                </div>
              </template>
```

- [ ] **Step 5: Add the styles**

Append to `public/css/app.css`:

```css
/* Opsi durasi layanan (2026-11-06): kartu + grup chip durasi di bawahnya. */
.svc-pilihan { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.svc-pilihan > .svc-card { flex: 1; }
.svc-durasi { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 2px; }
.svc-durasi-chip { font: inherit; font-size: 12.5px; font-weight: 700; color: #425FAD; background: #fff; border: 1.5px solid #DDE1EC; border-radius: 99px; padding: 6px 12px; cursor: pointer; transition: all .15s; }
.svc-durasi-chip.sel { background: #425FAD; border-color: #425FAD; color: #fff; }
.svc-durasi-chip:focus-visible { outline: 2px solid #425FAD; outline-offset: 2px; }
```

- [ ] **Step 6: Run the tests and the Blade compile**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter 'BookingHalamanTest|BookingKlinikInternasionalTest|BookingTampilanUsdTest|BookingTautanPribadiTest'`
Expected: OK. If an older test asserts the literal `:class="{ sel: x.key === serviceId }"` or `@click="selectService(x.key)"`, update its expected string to `kartuDipilih(x)` / `pilihKartu(x)` respectively. Keep what it checks (the card is a keyboard-reachable radio) intact.

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest php artisan view:cache`
Expected: `Blade templates cached successfully.`

- [ ] **Step 7: Commit**

```bash
git add resources/views/booking.blade.php public/css/app.css tests/Feature/BookingHalamanTest.php
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(booking): satu kartu layanan dengan pilihan durasi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manual-booking modal — service select + duration select

**Files:**
- Modify: `app/Http/Controllers/ManualAppointmentController.php` (`services()`)
- Modify: `resources/views/dashboard.blade.php` (state at line ~486, `openManual` reset at ~874, `loadManualServices` at ~901, select markup at ~5651)
- Test: `tests/Feature/ManualAppointmentTest.php` (append), `tests/js/opsi-durasi.test.mjs` (new)

**Interfaces:**
- Consumes: `opsiDariId`, `durasi` (Task 1).
- Produces:
  - the JSON from `/dashboard/appointments/manual-services` adds `opsiDari: ?string` (parent id) and `durasi: [{id, duration, price}]` to each service;
  - Alpine state `manualLayanan` (the parent id chosen in the first select);
  - getters `manualLayananInduk`, `manualPilihanDurasi`;
  - method `pilihLayananManual()`.
- `manualForm.serviceId` keeps meaning "the id actually booked", so `manualDurasi`, slots and submit stay untouched.

- [ ] **Step 1: Write the failing PHP test**

Append to `tests/Feature/ManualAppointmentTest.php`:

```php
    public function test_layanan_manual_membawa_opsi_durasi(): void
    {
        Http::fake(['*/api/v1/public/professionals/34/services*' => Http::response(['data' => [
            ['id' => 101, 'name' => 'Konseling Individu', 'price' => '425000', 'durationMinutes' => 60, 'clinicId' => 4],
            ['id' => 201, 'name' => 'Konseling Individu (90 menit)', 'price' => '600000', 'durationMinutes' => 90, 'clinicId' => 4, 'durationOf' => 101],
        ]])]);

        $res = $this->withSession($this->staf('admin', ['practiceId' => '4']))
            ->getJson('/dashboard/appointments/manual-services?professionalId=34')
            ->assertOk();

        $res->assertJsonPath('services.0.opsiDari', null);
        $res->assertJsonPath('services.0.durasi', [
            ['id' => '101', 'duration' => 60, 'price' => 425000],
            ['id' => '201', 'duration' => 90, 'price' => 600000],
        ]);
        // Opsi tetap di daftar: jamCustom() & store() mencari durasinya berdasarkan id.
        $res->assertJsonPath('services.1.id', '201');
        $res->assertJsonPath('services.1.opsiDari', '101');
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter test_layanan_manual_membawa_opsi_durasi`
Expected: FAIL — `services.0.durasi` missing.

- [ ] **Step 3: Implement the controller**

In `ManualAppointmentController::services()`, replace the array built inside the loop with:

```php
            $services[$s['name'].'|'.$s['dur'].'|'.$s['price']] ??= [
                'id' => $s['id'],
                'name' => $s['name'],
                'price' => $s['price'],
                'duration' => (int) $s['dur'],
                // Opsi durasi (lihat BookingApi::gabungDurasi): dropdown pertama
                // hanya menampilkan induk; durasinya dipilih di dropdown kedua.
                'opsiDari' => $s['opsiDariId'] ?? null,
                'durasi' => array_map(fn (array $d) => [
                    'id' => $d['apiId'],
                    'duration' => $d['menit'],
                    'price' => $d['price'],
                ], $s['durasi'] ?? []),
            ];
```

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 4: Write the failing JS test**

```js
// tests/js/opsi-durasi.test.mjs
// Opsi durasi di dashboard, pada dashApp() yang SEBENARNYA (skrip diambil dari
// dashboard.blade.php) dengan fetch palsu:
//  - modal janji manual: dropdown layanan hanya induk; durasi dipilih di
//    dropdown kedua, dan manualForm.serviceId = id yang benar-benar dipesan;
//  - form Ubah layanan: opsi termuat dari baris, tambah/hapus dibatasi 4, dan
//    dikirim sebagai durasiOpsi hanya saat mengubah (bukan saat menambah).

import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { skripDashApp } from './_skrip-dashboard.mjs';

globalThis.window = globalThis;
const payloadHalaman = { role: 'admin', profile: { practiceId: 4 }, patients: [], totals: {}, sessions: [], clinics: [], doctors: [] };
globalThis.document = {
  getElementById: (id) => (id === 'dash-payload' ? { textContent: JSON.stringify(payloadHalaman) } : null),
  querySelector: () => ({ content: 'csrf' }),
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};
globalThis.localStorage = { getItem: () => null, setItem() {} };

let jawaban = {};
let permintaan = [];
globalThis.fetch = (url, init = {}) => {
  permintaan.push({ url: String(url), init });
  const kunci = Object.keys(jawaban).find((k) => String(url).startsWith(k));
  const json = kunci ? jawaban[kunci] : { times: [], live: true };
  return Promise.resolve({ ok: true, status: 200, json: async () => json });
};
const tenang = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

runInThisContext(readFileSync(new URL('../../public/js/jadwal-mingguan.js', import.meta.url), 'utf8'));
runInThisContext(skripDashApp);

let gagal = 0;
const cek = (nama, ok, info = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${ok ? '' : '  ' + info}`);
  if (!ok) gagal++;
};

const app = window.dashApp();
app.showToast = () => {};
app.loadServices = () => {};

// ── Modal janji manual ──
jawaban['/dashboard/appointments/manual-services'] = { ok: true, services: [
  { id: '101', name: 'Konseling Individu', price: 425000, duration: 60, opsiDari: null,
    durasi: [{ id: '101', duration: 60, price: 425000 }, { id: '201', duration: 90, price: 600000 }] },
  { id: '201', name: 'Konseling Individu (90 menit)', price: 600000, duration: 90, opsiDari: '101', durasi: [] },
  { id: '300', name: 'Tes Psikologi', price: 300000, duration: 120, opsiDari: null, durasi: [] },
] };
app.manualForm = { clientId: '', clientName: '', clientEmail: '', clientMobile: '', serviceId: '', professionalId: '34', clinicId: 4, date: '', startTime: '', notes: '' };
await app.loadManualServices();
await tenang();

cek('dropdown layanan hanya berisi induk', app.manualLayananInduk.map((s) => s.id).join() === '101,300', app.manualLayananInduk.map((s) => s.id).join());

app.manualLayanan = '101';
app.pilihLayananManual();
cek('memilih induk memesan durasi utamanya', app.manualForm.serviceId === '101', app.manualForm.serviceId);
cek('dropdown durasi muncul dengan dua pilihan', app.manualPilihanDurasi.map((d) => d.id).join() === '101,201', JSON.stringify(app.manualPilihanDurasi));

app.manualForm.serviceId = '201';
cek('durasi yang dipakai menghitung jam = 90 menit', app.manualDurasi === 90, String(app.manualDurasi));

app.manualLayanan = '300';
app.pilihLayananManual();
cek('layanan tanpa opsi: tanpa dropdown durasi', app.manualPilihanDurasi.length === 0);
cek('layanan tanpa opsi langsung terpilih', app.manualForm.serviceId === '300', app.manualForm.serviceId);

await app.loadManualServices();
cek('memuat ulang layanan mengosongkan pilihan induk', app.manualLayanan === '', app.manualLayanan);

// ── Form Ubah layanan ──
const baris = { id: 501, name: 'Konseling Individu', rawCategoryId: 29, rawDuration: 60, rawPrice: 425000, mode: 'offline', active: true,
  doctor: 'Dianda', clinic: 'Klinik Sehat', durasiDidukung: true,
  durasiOpsi: [{ id: 601, rawDuration: 90, rawPrice: 600000, duration: '90 mnt', price: 'Rp600.000' }] };
app.bukaLayanan(baris);
cek('opsi termuat ke form', JSON.stringify(app.svcForm.durasiOpsi) === JSON.stringify([{ id: 601, duration: 90, price: 600000 }]), JSON.stringify(app.svcForm.durasiOpsi));

for (let i = 0; i < 6; i++) app.tambahDurasi();
cek('tambah berhenti di 4 opsi', app.svcForm.durasiOpsi.length === 4, String(app.svcForm.durasiOpsi.length));
app.hapusDurasi(3); app.hapusDurasi(2); app.hapusDurasi(1);
app.svcForm.durasiOpsi.push({ id: null, duration: 120, price: 800000 });

jawaban['/dashboard/layanan'] = { message: 'Layanan diperbarui.' };
permintaan = [];
await app.simpanLayanan();
const kirim = permintaan.find((p) => p.url === '/dashboard/layanan/501');
const badan = kirim ? JSON.parse(kirim.init.body) : {};
cek('PUT mengirim durasiOpsi lengkap', JSON.stringify(badan.durasiOpsi) === JSON.stringify([{ id: 601, duration: 90, price: 600000 }, { id: null, duration: 120, price: 800000 }]), JSON.stringify(badan.durasiOpsi));
cek('flag internal tidak ikut terkirim', !('durasiDidukung' in badan));

app.bukaLayanan({ ...baris, durasiDidukung: false });
permintaan = [];
await app.simpanLayanan();
const tanpa = JSON.parse(permintaan.find((p) => p.url === '/dashboard/layanan/501').init.body);
cek('backend tanpa dukungan opsi: durasiOpsi tidak dikirim', !('durasiOpsi' in tanpa));

app.bukaLayanan(null);
app.svcForm.doctors = [34];
permintaan = [];
await app.simpanLayanan();
const baru = JSON.parse(permintaan.find((p) => p.url === '/dashboard/layanan').init.body);
cek('layanan baru tidak mengirim durasiOpsi', !('durasiOpsi' in baru));

if (gagal) { console.log(`\n${gagal} gagal`); process.exit(1); }
console.log('\nsemua lolos');
```

Run: `node tests/js/opsi-durasi.test.mjs`
Expected: FAIL (`manualLayananInduk` undefined). The form part fails too until Task 5; that is expected.

- [ ] **Step 5: Implement the modal script**

In `resources/views/dashboard.blade.php`:

1. On the line declaring `manualClients: [], manualServices: [], ...` (~486), add `manualLayanan: "",` right after `manualServices: [],`.

2. In the method that rebuilds `this.manualForm = { ... }` (~874), add `this.manualLayanan = "";` on the next line.

3. In `loadManualServices()`, change its first line to:

```js
      this.manualServices = []; this.manualServicesError = ""; this.manualForm.serviceId = ""; this.manualLayanan = "";
```

4. Directly after `get manualDurasi() { ... },`, add:

```js
    // Opsi durasi: dropdown layanan berisi induk saja; durasinya dipilih di
    // dropdown kedua. `manualForm.serviceId` tetap id yang benar-benar dipesan,
    // jadi manualDurasi, slot, dan submit tidak perlu tahu soal opsi.
    get manualLayananInduk() { return this.manualServices.filter((s) => !s.opsiDari); },
    get manualPilihanDurasi() {
      const s = this.manualServices.find((x) => String(x.id) === String(this.manualLayanan));
      return s && Array.isArray(s.durasi) && s.durasi.length > 1 ? s.durasi : [];
    },
    pilihLayananManual() {
      this.manualForm.serviceId = this.manualLayanan;
      this.loadManualSlots();
    },
```

- [ ] **Step 6: Implement the modal markup**

Replace the service `<select class="inp inp-blue" x-model="manualForm.serviceId" ...> ... </select>` (~5651) with:

```html
            <select class="inp inp-blue" x-model="manualLayanan" @change="pilihLayananManual()" :disabled="!manualForm.professionalId">
              <option value="" x-text="manualForm.professionalId ? '— Pilih layanan —' : '— Pilih psikolog dulu —'"></option>
              <template x-for="s in manualLayananInduk" :key="s.id">
                <option :value="s.id" x-text="s.name + (s.durasi && s.durasi.length > 1 ? ' · ' + s.durasi.map((d) => d.duration).join('/') + ' menit' : ' · Rp' + s.price)"></option>
              </template>
            </select>
            {{-- Durasi lain dari layanan yang sama, dengan harga masing-masing. --}}
            <div x-show="manualPilihanDurasi.length" style="grid-column:1/-1">
              <select class="inp inp-blue" x-model="manualForm.serviceId" @change="loadManualSlots()" aria-label="Durasi layanan">
                <template x-for="d in manualPilihanDurasi" :key="d.id">
                  <option :value="d.id" x-text="d.duration + ' menit · Rp' + d.price"></option>
                </template>
              </select>
            </div>
```

- [ ] **Step 7: Run the tests**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter ManualAppointmentTest`
Expected: OK.

Run: `node tests/js/opsi-durasi.test.mjs; node tests/js/janji-manual-jam.test.mjs`
Expected: all the modal checks in `opsi-durasi` print `OK`; the form checks still `FAIL` (Task 5). `janji-manual-jam` prints `semua lolos`.

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/ManualAppointmentController.php resources/views/dashboard.blade.php tests/Feature/ManualAppointmentTest.php tests/js/opsi-durasi.test.mjs
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(janji-manual): pilih durasi layanan di dropdown kedua

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dashboard service list — options under their parent

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php` (`mapLayanan`, `sapuLayanan`)
- Modify: `resources/views/dashboard.blade.php` (service card, ~line 3729)
- Test: `tests/Feature/ServiceCrudTest.php` (append)

**Interfaces:**
- Consumes: `durationOf`, `durationOptions` from `/api/v1/services`.
- Produces on each mapped row:
  - `durasiDari: ?int`;
  - `durasiOpsi: [{id, rawDuration, rawPrice, duration, price}]`;
  - `durasiDidukung: bool` — true when the backend sent `durationOptions`; Task 5 reads it.
- `sapuLayanan` returns only rows with `durasiDari === null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/Feature/ServiceCrudTest.php`:

```php
    public function test_daftar_layanan_menyembunyikan_baris_opsi_di_bawah_induknya(): void
    {
        Http::fake([
            '*/api/v1/services*' => Http::response(['data' => [
                ['id' => 501, 'doctorId' => 34, 'clinicId' => 4, 'name' => 'Konseling Individu', 'price' => 425000,
                    'durationMinutes' => 60, 'isActive' => true, 'durationOf' => null,
                    'durationOptions' => [['id' => 601, 'serviceId' => 201, 'name' => 'Konseling Individu (90 menit)',
                        'durationMinutes' => 90, 'price' => 600000, 'isActive' => true]]],
                ['id' => 601, 'doctorId' => 34, 'clinicId' => 4, 'name' => 'Konseling Individu (90 menit)', 'price' => 600000,
                    'durationMinutes' => 90, 'isActive' => true, 'durationOf' => 501, 'durationOptions' => []],
                // Opsi yang sudah dihapus juga membawa durationOf — tetap tersembunyi.
                ['id' => 602, 'doctorId' => 34, 'clinicId' => 4, 'name' => 'Konseling Individu (120 menit)', 'price' => 800000,
                    'durationMinutes' => 120, 'isActive' => false, 'durationOf' => 501, 'durationOptions' => []],
            ], 'total' => 3]),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]]),
            '*/api/v1/service-categories' => Http::response(['categories' => []]),
        ]);

        $res = $this->withSession($this->staf())->getJson('/dashboard/services?clinicId=4')->assertOk();

        $res->assertJsonCount(1, 'services');
        $res->assertJsonPath('services.0.id', 501);
        $res->assertJsonPath('services.0.durasiDidukung', true);
        $res->assertJsonPath('services.0.durasiOpsi', [
            ['id' => 601, 'rawDuration' => 90, 'rawPrice' => 600000, 'duration' => '90 mnt', 'price' => 'Rp600.000'],
        ]);
    }

    public function test_backend_lama_tanpa_durationOptions_tetap_tampil_tanpa_opsi(): void
    {
        Http::fake([
            '*/api/v1/services*' => Http::response(['data' => [
                ['id' => 501, 'doctorId' => 34, 'clinicId' => 4, 'name' => 'Konseling Individu', 'price' => 425000, 'durationMinutes' => 60, 'isActive' => true],
            ], 'total' => 1]),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]]),
            '*/api/v1/service-categories' => Http::response(['categories' => []]),
        ]);

        $res = $this->withSession($this->staf())->getJson('/dashboard/services?clinicId=4')->assertOk();

        $res->assertJsonPath('services.0.durasiDidukung', false);
        $res->assertJsonPath('services.0.durasiOpsi', []);
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter 'test_daftar_layanan_menyembunyikan|test_backend_lama_tanpa_durationOptions'`
Expected: FAIL — 3 services instead of 1, and `durasiDidukung` is missing.

- [ ] **Step 3: Implement the controller**

In `app/Http/Controllers/DashboardController.php`:

1. In `sapuLayanan`, replace `return $baru === [] ? null : $petakan($baru);` with:

```php
            // Baris opsi durasi (hidup maupun yang sudah dihapus) tidak tampil
            // sebagai kartu sendiri: opsi hidup sudah dibawa induknya lewat
            // `durationOptions` (lihat mapLayanan). Ia tetap ada di daftar
            // backend karena laporan mencari nama layanan berdasarkan id.
            return $baru === [] ? null : array_values(array_filter(
                $petakan($baru),
                fn (array $b) => ($b['durasiDari'] ?? null) === null,
            ));
```

2. In `mapLayanan`, after `'color' => self::color(),`, add:

```php
            // Opsi durasi (2026-11-06). `durationOf` terisi = baris ini durasi
            // lain dari layanan induk; `durationOptions` = opsi hidup milik
            // induk ini. Backend lama tidak mengirim keduanya: daftar tampil
            // seperti dulu, dan form Ubah tidak menawarkan opsi durasi.
            'durasiDari' => is_numeric($r['durationOf'] ?? null) ? (int) $r['durationOf'] : null,
            'durasiDidukung' => array_key_exists('durationOptions', $r),
            'durasiOpsi' => array_values(array_map(fn (array $o) => [
                'id' => (int) $o['id'],
                'rawDuration' => (int) ($o['durationMinutes'] ?? 0),
                'rawPrice' => (int) self::angka($o['price'] ?? null),
                'duration' => ((int) ($o['durationMinutes'] ?? 0)).' mnt',
                'price' => ($o['price'] ?? null) === null ? '—' : self::rp(self::angka($o['price'])),
            ], array_filter(
                is_array($r['durationOptions'] ?? null) ? $r['durationOptions'] : [],
                fn ($o) => is_array($o) && is_numeric($o['id'] ?? null),
            ))),
```

- [ ] **Step 4: Show the options on the card**

In `resources/views/dashboard.blade.php`, directly after the `<div style="display:flex;align-items:center;justify-content:space-between">` block that shows `r.duration` and `r.price` (~3728-3731), add:

```html
                {{-- Durasi lain dari layanan ini, masing-masing dengan harganya. --}}
                <div x-show="r.durasiOpsi && r.durasiOpsi.length" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:-6px">
                  <template x-for="o in (r.durasiOpsi || [])" :key="o.id">
                    <span class="svc-tag" x-text="o.duration + ' · ' + o.price"></span>
                  </template>
                </div>
```

- [ ] **Step 5: Run the tests**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter 'ServiceCrudTest|DashboardServicesTest|DashboardFieldMappingTest'`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/DashboardController.php resources/views/dashboard.blade.php tests/Feature/ServiceCrudTest.php
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): opsi durasi tampil di bawah layanan induknya

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Edit form — "Opsi durasi lain", forwarded as `durationOptions`

**Files:**
- Modify: `resources/views/dashboard.blade.php` (`svcForm` default ~377, `bukaLayanan` ~1400, `simpanLayanan` ~1437, two new methods, form markup after the Mode/Status grid ~3976)
- Modify: `app/Http/Controllers/ServiceController.php` (`validasi`, `payload`, `teruskan`)
- Test: `tests/Feature/ServiceCrudTest.php` (append); `tests/js/opsi-durasi.test.mjs` (from Task 3, now passes fully)

**Interfaces:**
- Consumes: `durasiOpsi`, `durasiDidukung` (Task 4).
- Produces:
  - `svcForm.durasiOpsi: [{id|null, duration, price}]` and `svcForm.durasiDidukung: bool`;
  - methods `tambahDurasi()` (max 4) and `hapusDurasi(i)`;
  - `PUT /dashboard/layanan/{id}` accepts `durasiOpsi` and forwards it as `durationOptions`. When `durasiOpsi` is absent, `durationOptions` is not sent.

- [ ] **Step 1: Write the failing PHP tests**

Append to `tests/Feature/ServiceCrudTest.php`:

```php
    public function test_ubah_layanan_meneruskan_opsi_durasi(): void
    {
        Http::fake(['*/api/v1/services/501' => Http::response(['id' => 501])]);

        $isi = $this->isi(['durasiOpsi' => [['id' => 601, 'duration' => 90, 'price' => 600000], ['id' => null, 'duration' => 120, 'price' => 800000]]]);
        unset($isi['doctors'], $isi['clinicId']);

        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)->assertOk();

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT'
            && $this->badan($r)['durationOptions'] === [['id' => 601, 'duration' => 90, 'price' => 600000], ['duration' => 120, 'price' => 800000]]);
    }

    public function test_ubah_layanan_tanpa_durasiOpsi_tidak_menyentuh_opsi(): void
    {
        Http::fake(['*/api/v1/services/501' => Http::response(['id' => 501])]);

        $isi = $this->isi();
        unset($isi['doctors'], $isi['clinicId']);

        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)->assertOk();

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && ! array_key_exists('durationOptions', $this->badan($r)));
    }

    public function test_daftar_kosong_menghapus_semua_opsi(): void
    {
        Http::fake(['*/api/v1/services/501' => Http::response(['id' => 501])]);

        $isi = $this->isi(['durasiOpsi' => []]);
        unset($isi['doctors'], $isi['clinicId']);

        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)->assertOk();

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && $this->badan($r)['durationOptions'] === []);
    }

    public function test_lebih_dari_empat_opsi_ditolak_sebelum_ke_backend(): void
    {
        Http::fake();

        $isi = $this->isi(['durasiOpsi' => array_map(fn ($d) => ['duration' => $d, 'price' => 1], [30, 45, 90, 120, 150])]);
        unset($isi['doctors'], $isi['clinicId']);

        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)
            ->assertStatus(422)->assertJsonValidationErrors('durasiOpsi');
        Http::assertNothingSent();
    }

    public function test_penolakan_opsi_durasi_dijelaskan_dalam_bahasa_indonesia(): void
    {
        $isi = $this->isi(['durasiOpsi' => []]);
        unset($isi['doctors'], $isi['clinicId']);

        Http::fake(['*/api/v1/services/501' => Http::response(
            ['type' => 'about:blank', 'title' => 'Conflict', 'status' => 409, 'code' => 'duration_option_has_appointments', 'detail' => '2 upcoming', 'count' => 2], 409,
        )]);
        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)
            ->assertStatus(Controller::UPSTREAM_REJECTED)
            ->assertJsonPath('message', 'Ada 2 janji temu mendatang yang memakai durasi yang mau dihapus atau diubah. Batalkan atau pindahkan dulu janji temunya.');

        Http::fake(['*/api/v1/services/501' => Http::response(
            ['type' => 'about:blank', 'title' => 'Validation Error', 'status' => 422, 'code' => 'duration_option_duplicate', 'detail' => 'dup'], 422,
        )]);
        $this->withSession($this->staf())->putJson('/dashboard/layanan/501', $isi)
            ->assertJsonPath('message', 'Setiap durasi hanya boleh dipakai sekali, termasuk durasi utama layanan ini.');
    }
```

If `Controller` is not already imported in this file, add `use App\Http\Controllers\Controller;`. It is imported in the current file header.

- [ ] **Step 2: Run them to verify they fail**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter 'test_ubah_layanan_meneruskan|test_ubah_layanan_tanpa_durasiOpsi|test_daftar_kosong_menghapus|test_lebih_dari_empat|test_penolakan_opsi_durasi'`
Expected: FAIL — `durationOptions` is never sent.

- [ ] **Step 3: Implement `ServiceController`**

1. In `validasi()`, replace the line `$aturanBaru = ! $baru ? [] : [...] + (...);` so that the update branch carries the option rules:

```php
        $aturanBaru = ! $baru ? [
            // Opsi durasi hanya lewat Ubah: layanan harus ada dulu sebelum punya
            // durasi lain. Batas 4 sama dengan backend; dicek di sini supaya
            // ditolak tanpa satu panggilan pun.
            'durasiOpsi' => ['sometimes', 'array', 'max:4'],
            'durasiOpsi.*.id' => ['nullable', 'integer', 'min:1'],
            'durasiOpsi.*.duration' => ['required', 'integer', 'min:1', 'max:1440'],
            'durasiOpsi.*.price' => ['required', 'integer', 'min:0'],
        ] : ['clinicId' => ['nullable', 'string', 'max:40']] + ($psikolog ? [] : [
            'doctors' => ['required', 'array', 'min:1'],
            'doctors.*' => ['required', 'integer'],
        ]);
```

   And add to the messages array:

```php
            'durasiOpsi.max' => 'Satu layanan paling banyak punya 4 durasi tambahan.',
            'durasiOpsi.*.duration.required' => 'Isi durasi (menit) untuk setiap opsi.',
            'durasiOpsi.*.duration.min' => 'Durasi opsi minimal 1 menit.',
            'durasiOpsi.*.duration.max' => 'Durasi opsi maksimal 1440 menit (24 jam).',
            'durasiOpsi.*.price.required' => 'Isi harga untuk setiap opsi durasi. Isi 0 kalau gratis.',
```

2. In `payload()`, add this entry to the array passed to `array_filter`, after `'clinicId' => ...,`:

```php
            // Daftar LENGKAP: tanpa id = opsi baru, ber-id = diubah, yang tidak
            // disebut dihapus. Tidak dikirim sama sekali = opsi tidak disentuh.
            'durationOptions' => array_key_exists('durasiOpsi', $data)
                ? array_map(fn (array $o) => array_filter([
                    'id' => isset($o['id']) ? (int) $o['id'] : null,
                    'duration' => (int) $o['duration'],
                    'price' => (int) $o['price'],
                ], fn ($v) => $v !== null), array_values($data['durasiOpsi']))
                : null,
```

3. Add this constant inside the class, next to `PESAN_PILIH_KLINIK`:

```php
    /** Penolakan opsi durasi dari backend, per `code`. */
    private const PESAN_OPSI_DURASI = [
        'duration_option_limit' => 'Satu layanan paling banyak punya 4 durasi tambahan.',
        'duration_option_duplicate' => 'Setiap durasi hanya boleh dipakai sekali, termasuk durasi utama layanan ini.',
        'duration_option_not_found' => 'Salah satu opsi durasi sudah tidak ada. Muat ulang halaman lalu coba lagi.',
        'edit_via_parent' => 'Ini opsi durasi dari layanan lain. Ubah lewat layanan utamanya.',
        'service_name_taken' => 'Psikolog ini sudah punya layanan lain dengan nama yang sama di klinik ini, '
            .'termasuk nama opsi durasi seperti "… (90 menit)". Ganti nama layanan atau durasinya.',
    ];
```

4. In `teruskan()`, right after the `clinic_required` block, add:

```php
            $kode = is_array($e->body) ? ($e->body['code'] ?? null) : null;
            if (is_string($kode) && isset(self::PESAN_OPSI_DURASI[$kode])) {
                return response()->json(['message' => self::PESAN_OPSI_DURASI[$kode]], self::UPSTREAM_REJECTED);
            }
            if ($kode === 'duration_option_has_appointments') {
                $n = (int) ($e->body['count'] ?? 0);

                return response()->json([
                    'message' => "Ada {$n} janji temu mendatang yang memakai durasi yang mau dihapus atau diubah. "
                        .'Batalkan atau pindahkan dulu janji temunya.',
                ], self::UPSTREAM_REJECTED);
            }
```

- [ ] **Step 4: Implement the form script**

In `resources/views/dashboard.blade.php`:

1. In the initial `svcForm: { ... }` (~377), add `durasiOpsi: [], durasiDidukung: false,` before the closing `}`.

2. In `bukaLayanan(r)`, in the edit branch (`r ? { ... }`), add these properties after `clinicName: ...`:

```js
            durasiDidukung: !!r.durasiDidukung,
            durasiOpsi: (r.durasiOpsi || []).map((o) => ({ id: o.id, duration: o.rawDuration, price: o.rawPrice })),
```

   In the create branch (`: { id: null, ... }`), add `durasiOpsi: [], durasiDidukung: false,`.

3. In `simpanLayanan()`, change the line `delete badan.doctorName; delete badan.clinicName;` to:

```js
        delete badan.doctorName; delete badan.clinicName; delete badan.durasiDidukung;
```

   And change `if (ubah) { delete badan.doctors; delete badan.clinicId; }` to:

```js
        // durasiOpsi = daftar LENGKAP opsi. Hanya dikirim saat mengubah, dan
        // hanya kalau backend memang mengirim daftarnya: mengirim [] ke backend
        // yang belum mengenal opsi tidak berarti apa-apa, tapi ke backend yang
        // mengenalnya berarti "hapus semua".
        if (ubah) { delete badan.doctors; delete badan.clinicId; if (!this.svcForm.durasiDidukung) delete badan.durasiOpsi; }
        else delete badan.durasiOpsi;
```

4. After `togglePsikolog(id) { ... },`, add:

```js
    tambahDurasi() { if (this.svcForm.durasiOpsi.length < 4) this.svcForm.durasiOpsi.push({ id: null, duration: "", price: "" }); },
    hapusDurasi(i) { this.svcForm.durasiOpsi.splice(i, 1); },
```

- [ ] **Step 5: Implement the form markup**

In the service form, directly after the grid holding the Mode and Status selects (the `</div>` that closes `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">` containing `svcForm.mode`), insert:

```html
            {{-- Opsi durasi lain (2026-11-06): durasi tambahan dengan harga
                 sendiri. Hanya saat mengubah — layanannya harus ada dulu — dan
                 hanya kalau backend sudah mengenal opsi durasi. --}}
            <div x-show="svcForm.id && svcForm.durasiDidukung">
              <label class="lbl" style="margin-bottom:7px">Opsi durasi lain</label>
              <template x-for="(o, i) in svcForm.durasiOpsi" :key="i">
                <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-bottom:8px;align-items:center">
                  <input class="inp inp-blue" type="number" min="1" max="1440" step="1" x-model.number="o.duration" placeholder="Durasi (menit)" required aria-label="Durasi opsi (menit)">
                  <input class="inp inp-blue" type="number" min="0" step="1000" x-model.number="o.price" placeholder="Harga (Rp)" required aria-label="Harga opsi (Rp)">
                  <button type="button" class="btn-ghost" @click="hapusDurasi(i)" aria-label="Hapus opsi durasi">Hapus</button>
                </div>
              </template>
              <button type="button" class="btn-ghost" x-show="svcForm.durasiOpsi.length < 4" @click="tambahDurasi()">+ Tambah durasi</button>
              <div style="font-size:11.5px;color:#9499AE;margin-top:6px;line-height:1.5">
                Pasien melihat satu layanan dan memilih durasinya. Kategori, mode, status, dan tampil publik mengikuti layanan ini.
                Nama opsi dibuat otomatis, misalnya <i>Konseling Individu (90 menit)</i>.
              </div>
            </div>
```

   `btn-ghost` must be an existing button class in this view. Run `/bin/grep -n 'class="btn-ghost' resources/views/dashboard.blade.php | head -3`. If it does not exist, use the class of the form's existing "Batal" button instead.

- [ ] **Step 6: Run the tests**

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit --filter ServiceCrudTest`
Expected: OK.

Run: `node tests/js/opsi-durasi.test.mjs`
Expected: `semua lolos`.

Run: `docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest php artisan view:cache`
Expected: cached successfully.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/ServiceController.php resources/views/dashboard.blade.php tests/Feature/ServiceCrudTest.php
git -c user.name="Claude Code" -c user.email=noreply@anthropic.com commit -m "$(cat <<'EOF'
feat(layanan): atur opsi durasi lain di form Ubah layanan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification, browser smoke test, push

- [ ] **Step 1: Full suites**

```bash
docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest ./vendor/bin/phpunit
for f in tests/js/*.test.mjs; do node "$f" > /tmp/out.txt 2>&1 || { echo "FAILED $f"; tail -5 /tmp/out.txt; }; done
docker run --rm -v "$PWD":/app -w /app praktiqu-php84-pdo:latest php artisan view:cache
```

Expected: PHPUnit OK (≈1190 tests), no `FAILED` line, Blade cached.

- [ ] **Step 2: Browser smoke test**

Follow the existing recipe in memory note `fe-local-browser-smoke-test`: Docker network, a stub backend, a forged super session, and Playwright. Do not use `--network host`, and do not `pkill -f` your own shell. Make the stub backend answer:
- `/api/v1/public/professionals/34/services` with the parent (id 101, 60′, Rp425.000) and an option (id 201, 90′, Rp600.000, `durationOf: 101`);
- `/api/v1/services` with the same pair, carrying `durationOf`/`durationOptions` as in Task 4's test.

Check:
1. Booking page: one card. Chips `60 menit · Rp425.000` and `90 menit · Rp600.000`. Clicking 90 makes the card price Rp600.000, and the slot request carries `serviceId=201`. Clicking the card body afterwards keeps 90 selected.
2. Manual modal: the service dropdown shows "Konseling Individu · 60/90 menit". A second dropdown appears. Picking 90 sends `serviceId=201` to the slots request.
3. Service list: one card with the tag `90 mnt · Rp600.000`. Ubah shows "Opsi durasi lain" with one row. "+ Tambah durasi" disappears after 4 rows. Saving sends `durasiOpsi`.

Take one screenshot per check. Show them to the user with SendUserFile.

- [ ] **Step 3: Push**

```bash
git push -u origin feat/opsi-durasi-layanan
```

PR link for the user: `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/opsi-durasi-layanan`. Release order: **merge the BE PR first, wait for the Hostinger build, then the FE PR.** The FE alone is harmless, since every new field defaults to "no options", but without the BE nothing new shows.
