# FE Redirect Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super admin create redirect rules from the Laravel FE dashboard. The rules redirect URLs on `appointment.praktiqu.com` that would otherwise 404, such as the old WordPress links `/appointment-<name>`.

**Architecture:**
- Rules live in a new `redirect_rules` table in the FE's own database.
- A pure `RedirectMatcher` matches a path against the rules: exact rules first, then a single `*` wildcard.
- `RedirectResolver` is called only from the 404 exception renderer in `bootstrap/app.php`, so a rule can never shadow a live page.
- A super-only JSON controller and an Alpine page in `dashboard.blade.php` manage the rules.
- A data migration pre-fills 20 legacy WordPress links.

**Tech Stack:** Laravel 13.8 on PHP 8.4, PHPUnit with in-memory SQLite, Blade with Alpine.js.

**Spec:** `docs/superpowers/specs/2026-10-13-fe-redirect-rules-design.md` (in this backend repo).

## Global Constraints

- **Repo:** all code changes are in the Laravel FE `raakanaka/laravel-praktiqu`, never in this Next.js repo.
  - Work in the worktree `/home/ahmad/projects/praktiqu-fe/redirect` on branch `feat/aturan-redirect`.
  - Never use the scratchpad; it is wiped between sessions.
- **Never push to `main`.** It auto-deploys `appointment.praktiqu.com`.
- **Running PHP:** there is no local `php`. Run everything through Docker from the worktree:
  `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli <cmd>`.
  Use PHP 8.4, not 8.3; `composer.lock` requires `>= 8.4.1`.
- **Commits:**
  - Identity: `git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit …`. The FE clone has no user config.
  - End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Messages are in Indonesian, conventional style, e.g. `feat(redirect): …`.
- **Language:**
  - User-facing text and code comments: Indonesian, matching the rest of the FE.
  - PHP identifiers: follow the file you are in. Indonesian method names (`periksa`, `cek`) are normal in this codebase.
- **Status codes:** only 301 or 302; default 302.
- **When rules apply:** only GET or HEAD requests that 404 and are not `expectsJson()`.
- **Wildcard:** at most one `*` in a source. It matches one or more characters, `/` included.
- **Destination:** an internal path starting with exactly one `/`, or an absolute `http`/`https` URL with a host. Backslash, whitespace and control characters are always rejected.
- **Legacy rows:** use note `Link WordPress lama`, code 302, inserted with `insertOrIgnore`.
- **No count assertions:** tests must not assert `RedirectRule::count()`. Task 5 inserts 20 rows into every test database.
- **Test paths:** tests use paths that cannot collide with the legacy rows: `/link-lama-uji`, `/lama/...`, `/appointment-uji-*`.

---

## File Structure

| File | Responsibility |
|---|---|
| `database/migrations/2026_10_13_100000_create_redirect_rules_table.php` | The table |
| `app/Models/RedirectRule.php` | Model, active rules in matcher shape, dashboard row shape |
| `app/Services/RedirectMatcher.php` | Pure matching and normalization. No DB, no request |
| `app/Services/RedirectResolver.php` | 404 hook, hit counter, route classification, "Uji URL" |
| `app/Services/RedirectRuleValidator.php` | Save-time checks: format, uniqueness, system page, loops and chains |
| `app/Http/Controllers/RedirectRuleController.php` | Super-only JSON CRUD and test endpoint |
| `bootstrap/app.php` | Register the 404 render callback |
| `routes/web.php` | Five routes in the `staff:any` group |
| `resources/views/dashboard.blade.php` | Menu item, Redirect page, add/edit modal, Alpine state |
| `database/migrations/2026_10_13_100001_seed_legacy_wp_redirects.php` | 20 legacy WordPress links |
| `tests/Unit/RedirectMatcherTest.php` | Matcher unit tests |
| `tests/Feature/RedirectPengalihanTest.php` | 404 hook behaviour |
| `tests/Feature/RedirectRuleControllerTest.php` | Endpoints, access control, validation, Uji URL |
| `tests/Feature/RedirectMenuTest.php` | Dashboard menu and state keys |
| `tests/Feature/RedirectLinkLamaTest.php` | Legacy data migration |

---

### Task 1: Worktree, table, model and the pure matcher

**Files:**
- Create: `database/migrations/2026_10_13_100000_create_redirect_rules_table.php`
- Create: `app/Models/RedirectRule.php`
- Create: `app/Services/RedirectMatcher.php`
- Test: `tests/Unit/RedirectMatcherTest.php`

**Interfaces:**
- Produces:
  - `RedirectMatcher::normalize(string $path): string`
  - `RedirectMatcher::match(string $path, string $query, array $rules): ?array`. Each rule is `array{id:int, source:string, destination:string, status_code:int}`. The result is `array{id:int, status:int, location:string}` or `null`.
  - `RedirectRule::aktifUntukMatcher(): array` returns active rules in matcher shape.
  - `RedirectRule::toRow(): array` returns the keys `id`, `source`, `destination`, `status`, `active`, `note`, `hits`, `lastHit`, `updatedBy`.

- [ ] **Step 1: Create the worktree, then copy `vendor` and `.env`**

```bash
cd /home/ahmad/projects/praktiqu-fe/main
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git fetch origin
git worktree add -b feat/aturan-redirect ../redirect origin/main
cd ../redirect
cp -a ../main/vendor ./vendor
cp ../klinik-internasional/.env ./.env
DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter LogViewerTest
```

Expected: `OK (7 tests, …)`. `vendor` and `.env` are gitignored and must not show up in `git status`.

- [ ] **Step 2: Write the failing unit test**

Create `tests/Unit/RedirectMatcherTest.php`:

```php
<?php

namespace Tests\Unit;

use App\Services\RedirectMatcher;
use PHPUnit\Framework\TestCase;

/**
 * Pencocokan aturan redirect — murni, tanpa database dan tanpa request.
 *
 * Satu-satunya pola yang dikenal adalah satu `*`. Regex buatan pengguna
 * sengaja tidak ada: aturannya diketik admin, dan satu regex yang salah bisa
 * menangkap seluruh situs.
 */
class RedirectMatcherTest extends TestCase
{
    private function aturan(int $id, string $source, string $destination, int $status = 302): array
    {
        return [
            'id' => $id,
            'source' => RedirectMatcher::normalize($source),
            'destination' => $destination,
            'status_code' => $status,
        ];
    }

    private function cocok(string $path, array $rules, string $query = ''): ?array
    {
        return (new RedirectMatcher)->match($path, $query, $rules);
    }

    public function test_normalize_huruf_kecil_tanpa_garis_miring_di_ujung(): void
    {
        $this->assertSame('/abc', RedirectMatcher::normalize('/ABC/'));
        $this->assertSame('/', RedirectMatcher::normalize('/'));
        $this->assertSame('/', RedirectMatcher::normalize(''));
        $this->assertSame('/a b', RedirectMatcher::normalize('/a%20b'));
        $this->assertSame('/x', RedirectMatcher::normalize('//x'));
        $this->assertSame('/tanpa-awalan', RedirectMatcher::normalize('tanpa-awalan'));
    }

    public function test_aturan_persis_cocok(): void
    {
        $hasil = $this->cocok('/appointment-azanidianda-com', [
            $this->aturan(1, '/appointment-azanidianda-com', '/azanidianda-com'),
        ]);

        $this->assertSame(['id' => 1, 'status' => 302, 'location' => '/azanidianda-com'], $hasil);
    }

    public function test_huruf_besar_dan_garis_miring_di_ujung_tetap_cocok(): void
    {
        $hasil = $this->cocok('/Appointment-AzaniDianda-Com/', [
            $this->aturan(1, '/appointment-azanidianda-com', '/azanidianda-com', 301),
        ]);

        $this->assertSame(['id' => 1, 'status' => 301, 'location' => '/azanidianda-com'], $hasil);
    }

    public function test_tidak_ada_yang_cocok(): void
    {
        $this->assertNull($this->cocok('/lain', [$this->aturan(1, '/appointment-a', '/a')]));
        $this->assertNull($this->cocok('/apa-saja', []));
    }

    public function test_wildcard_menyalin_bagian_yang_tertangkap(): void
    {
        $hasil = $this->cocok('/appointment-debi-amelia', [$this->aturan(1, '/appointment-*', '/*')]);

        $this->assertSame('/debi-amelia', $hasil['location']);
    }

    public function test_wildcard_butuh_minimal_satu_karakter(): void
    {
        $this->assertNull($this->cocok('/appointment-', [$this->aturan(1, '/appointment-*', '/*')]));
    }

    public function test_wildcard_ikut_menangkap_garis_miring(): void
    {
        $hasil = $this->cocok('/lama/a/b', [$this->aturan(1, '/lama/*', '/baru/*')]);

        $this->assertSame('/baru/a/b', $hasil['location']);
    }

    public function test_tangkapan_di_encode_ulang_sebelum_masuk_location(): void
    {
        // Path di-decode untuk dicocokkan; yang masuk header Location harus
        // ter-encode lagi — spasi atau baris baru mentah merusak header.
        $hasil = $this->cocok('/lama/a%20b', [$this->aturan(1, '/lama/*', '/baru/*')]);

        $this->assertSame('/baru/a%20b', $hasil['location']);
    }

    public function test_aturan_persis_menang_atas_wildcard(): void
    {
        $hasil = $this->cocok('/appointment-debi-amelia', [
            $this->aturan(1, '/appointment-*', '/*'),
            $this->aturan(2, '/appointment-debi-amelia', '/debi-amelia-rachmawati'),
        ]);

        $this->assertSame(2, $hasil['id']);
        $this->assertSame('/debi-amelia-rachmawati', $hasil['location']);
    }

    public function test_wildcard_yang_bagian_tetapnya_lebih_panjang_menang(): void
    {
        $hasil = $this->cocok('/appointment-x', [
            $this->aturan(1, '/a*', '/umum'),
            $this->aturan(2, '/appointment-*', '/khusus/*'),
        ]);

        $this->assertSame(2, $hasil['id']);
    }

    public function test_seri_dimenangkan_id_terkecil(): void
    {
        $hasil = $this->cocok('/a-b', [
            $this->aturan(7, '/*-b', '/tujuh'),
            $this->aturan(3, '/a-*', '/tiga'),
        ]);

        $this->assertSame(3, $hasil['id']);
    }

    public function test_query_string_pengunjung_ikut_dibawa(): void
    {
        $this->assertSame('/x?utm_source=ig',
            $this->cocok('/a', [$this->aturan(1, '/a', '/x')], 'utm_source=ig')['location']);
        $this->assertSame('/x?a=1&utm_source=ig',
            $this->cocok('/a', [$this->aturan(1, '/a', '/x?a=1')], 'utm_source=ig')['location']);
        $this->assertSame('/x?utm_source=ig#atas',
            $this->cocok('/a', [$this->aturan(1, '/a', '/x#atas')], 'utm_source=ig')['location']);
        $this->assertSame('/x',
            $this->cocok('/a', [$this->aturan(1, '/a', '/x')], '')['location']);
    }

    public function test_tujuan_eksternal_dipakai_apa_adanya(): void
    {
        $hasil = $this->cocok('/ke-situs-utama', [$this->aturan(1, '/ke-situs-utama', 'https://praktiqu.com/psikolog')]);

        $this->assertSame('https://praktiqu.com/psikolog', $hasil['location']);
    }

    public function test_karakter_regex_di_sumber_dibaca_harfiah(): void
    {
        // Titik bukan "karakter apa saja", dan tanda kurung bukan grup.
        $this->assertNull($this->cocok('/abc', [$this->aturan(1, '/a.c', '/x')]));
        $this->assertNotNull($this->cocok('/a.c', [$this->aturan(1, '/a.c', '/x')]));
        $this->assertNotNull($this->cocok('/a(b)-z', [$this->aturan(1, '/a(b)-*', '/x')]));
    }
}
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Unit/RedirectMatcherTest.php`

Expected: errors with `Class "App\Services\RedirectMatcher" not found`.

- [ ] **Step 4: Write the matcher**

Create `app/Services/RedirectMatcher.php`:

```php
<?php

namespace App\Services;

/**
 * Mencocokkan path dengan aturan redirect.
 *
 * Murni: tidak membaca database dan tidak membaca request. Masukannya path,
 * query string, dan daftar aturan berbentuk
 * ['id' => int, 'source' => string, 'destination' => string, 'status_code' => int],
 * dengan `source` yang sudah dinormalisasi (lihat normalize()).
 *
 * Satu-satunya pola yang dikenal adalah satu `*`, yang menangkap SATU ATAU
 * LEBIH karakter (termasuk `/`) dan disalin ke `*` di tujuan. Tidak ada regex
 * buatan pengguna: aturannya diketik admin, dan satu regex yang salah bisa
 * menangkap seluruh situs atau dipakai memperlambat server.
 *
 * Urutan: aturan persis dulu, lalu wildcard yang bagian tetapnya paling
 * panjang, lalu id terkecil.
 */
class RedirectMatcher
{
    /** Ter-decode, huruf kecil, berawalan `/`, tanpa `/` di ujung (kecuali `/` sendiri). */
    public static function normalize(string $path): string
    {
        $p = '/'.ltrim(mb_strtolower(rawurldecode(trim($path))), '/');

        return $p === '/' ? '/' : rtrim($p, '/');
    }

    /**
     * @param  array<int, array{id:int, source:string, destination:string, status_code:int}>  $rules
     * @return array{id:int, status:int, location:string}|null
     */
    public function match(string $path, string $query, array $rules): ?array
    {
        $path = self::normalize($path);

        foreach (self::urutkan($rules) as $rule) {
            $tangkapan = self::cocok($rule['source'], $path);
            if ($tangkapan === null) {
                continue;
            }

            // Tangkapan berasal dari path yang sudah di-decode; di-encode lagi
            // per segmen supaya spasi atau baris baru tidak masuk mentah ke
            // header Location.
            $tujuan = str_contains($rule['source'], '*')
                ? str_replace('*', implode('/', array_map('rawurlencode', explode('/', $tangkapan))), $rule['destination'])
                : $rule['destination'];

            return [
                'id' => (int) $rule['id'],
                'status' => (int) $rule['status_code'],
                'location' => self::tempelQuery($tujuan, $query),
            ];
        }

        return null;
    }

    /** '' untuk aturan persis yang cocok, teks tangkapan untuk wildcard, null kalau tidak cocok. */
    private static function cocok(string $source, string $path): ?string
    {
        if (! str_contains($source, '*')) {
            return $source === $path ? '' : null;
        }

        $pola = '#\A'.str_replace('\*', '(.+)', preg_quote($source, '#')).'\z#u';

        return preg_match($pola, $path, $m) === 1 ? $m[1] : null;
    }

    private static function urutkan(array $rules): array
    {
        usort($rules, function (array $a, array $b): int {
            $wa = str_contains($a['source'], '*');
            $wb = str_contains($b['source'], '*');
            if ($wa !== $wb) {
                return $wa <=> $wb;
            }
            if ($wa) {
                $panjang = strlen($b['source']) <=> strlen($a['source']);
                if ($panjang !== 0) {
                    return $panjang;
                }
            }

            return (int) $a['id'] <=> (int) $b['id'];
        });

        return $rules;
    }

    /** Query pengunjung ikut dibawa — mis. ?utm_source=ig — dan diletakkan sebelum #fragmen. */
    private static function tempelQuery(string $tujuan, string $query): string
    {
        if ($query === '') {
            return $tujuan;
        }

        $fragmen = '';
        $pos = strpos($tujuan, '#');
        if ($pos !== false) {
            $fragmen = substr($tujuan, $pos);
            $tujuan = substr($tujuan, 0, $pos);
        }

        return $tujuan.(str_contains($tujuan, '?') ? '&' : '?').$query.$fragmen;
    }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Unit/RedirectMatcherTest.php`

Expected: `OK (14 tests, …)`.

- [ ] **Step 6: Add the table migration and the model**

Create `database/migrations/2026_10_13_100000_create_redirect_rules_table.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Aturan redirect yang diatur Super Admin dari dashboard (Settings → Redirect).
//
// Domain ini dulu situs WordPress, dan setiap psikolog punya halaman booking
// /appointment-<nama> yang sudah tersebar di WhatsApp dan bio Instagram. Sejak
// domainnya pindah ke aplikasi ini semuanya 404. Aturan di sini HANYA dicek
// saat sebuah alamat 404 — lihat RedirectResolver — jadi tidak ada aturan yang
// bisa menimpa halaman yang masih hidup.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('redirect_rules', function (Blueprint $table) {
            $table->id();
            // Disimpan sudah dinormalisasi (huruf kecil, tanpa garis miring di
            // ujung), jadi keunikan berlaku untuk /A dan /a sekaligus.
            $table->string('source', 255)->unique();
            $table->string('destination', 2048);
            $table->unsignedSmallInteger('status_code')->default(302);
            $table->boolean('active')->default(true);
            $table->string('note', 255)->nullable();
            // Ditulis setiap kali aturannya dipakai: menunjukkan tautan lama
            // mana yang masih diklik orang, dan mana yang aman dihapus.
            $table->unsignedInteger('hits')->default(0);
            $table->timestamp('last_hit_at')->nullable();
            $table->string('updated_by', 255)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('redirect_rules');
    }
};
```

Create `app/Models/RedirectRule.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RedirectRule extends Model
{
    protected $fillable = ['source', 'destination', 'status_code', 'active', 'note', 'updated_by'];

    protected function casts(): array
    {
        return [
            'status_code' => 'integer',
            'active' => 'boolean',
            'hits' => 'integer',
            'last_hit_at' => 'datetime',
        ];
    }

    /**
     * Aturan aktif dalam bentuk yang dibaca RedirectMatcher.
     *
     * @return array<int, array{id:int, source:string, destination:string, status_code:int}>
     */
    public static function aktifUntukMatcher(): array
    {
        return self::query()->where('active', true)
            ->get(['id', 'source', 'destination', 'status_code'])
            ->map(fn (self $r) => [
                'id' => (int) $r->id,
                'source' => $r->source,
                'destination' => $r->destination,
                'status_code' => (int) $r->status_code,
            ])->all();
    }

    /** Satu baris tabel di halaman Redirect. */
    public function toRow(): array
    {
        return [
            'id' => $this->id,
            'source' => $this->source,
            'destination' => $this->destination,
            'status' => (int) ($this->status_code ?? 302),
            'active' => (bool) ($this->active ?? true),
            'note' => $this->note ?? '',
            'hits' => (int) ($this->hits ?? 0),
            'lastHit' => $this->last_hit_at?->timezone('Asia/Jakarta')->format('j M Y H:i'),
            'updatedBy' => $this->updated_by ?? '',
        ];
    }
}
```

- [ ] **Step 7: Confirm the migration runs on the test database**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'RedirectMatcherTest|CustomSessionTest'`

Expected: OK. `CustomSessionTest` uses `RefreshDatabase`, which runs every migration, so a broken migration fails here.

- [ ] **Step 8: Commit**

```bash
git add database/migrations/2026_10_13_100000_create_redirect_rules_table.php app/Models/RedirectRule.php app/Services/RedirectMatcher.php tests/Unit/RedirectMatcherTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(redirect): tabel aturan redirect dan pencocok path

Tabel redirect_rules di DB lokal FE dan RedirectMatcher yang murni:
aturan persis lebih dulu, lalu satu wildcard * (minimal satu karakter,
termasuk /). Query string pengunjung ikut dibawa, tangkapan di-encode
ulang sebelum masuk header Location.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The 404 hook

**Files:**
- Create: `app/Services/RedirectResolver.php`
- Modify: `bootstrap/app.php` (inside `withExceptions`, after the existing 419 `render` callback)
- Test: `tests/Feature/RedirectPengalihanTest.php`

**Interfaces:**
- Consumes: `RedirectMatcher::match()` and `RedirectMatcher::normalize()` (Task 1), `RedirectRule::aktifUntukMatcher()` (Task 1).
- Produces:
  - `RedirectResolver::redirectFor(Request $request): ?RedirectResponse`
  - `RedirectResolver::jenisRute(string $path): string` (static). Returns `'sistem'`, `'tenant'` or `'tidak-ada'`.
  - `RedirectResolver::cek(string $url, BookingApi $booking): array`. Returns `array{hasil:string, ruleId:?int, location:?string, status:?int}`, where `hasil` is `'halaman hidup'`, `'dialihkan'`, `'404'` or `'tidak bisa dicek'`.

- [ ] **Step 1: Write the failing feature test**

Create `tests/Feature/RedirectPengalihanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Models\RedirectRule;
use App\Services\RedirectMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Aturan redirect dipakai HANYA saat sebuah alamat 404.
 *
 * Tautan booking WordPress lama (/appointment-<nama>) jatuh ke catch-all
 * /{tenant}, yang menjawab abort(404) untuk slug tak dikenal — di situlah
 * aturannya menangkap. Halaman yang hidup tidak pernah ditimpa.
 */
class RedirectPengalihanTest extends TestCase
{
    use RefreshDatabase;

    private function aturan(string $source, string $destination, array $lain = []): RedirectRule
    {
        return RedirectRule::create(['source' => RedirectMatcher::normalize($source), 'destination' => $destination] + $lain);
    }

    /** Backend yang tidak mengenal slug apa pun selain "klinik-sehat". */
    private function backendTanpaSlugIni(): void
    {
        Http::fake([
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat']]], 200),
            '*/api/v1/public/professionals/by-slug/*' => Http::response(['status' => 404, 'code' => 'professional_not_found'], 404),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);
    }

    /** Backend tempat /klinik-sehat adalah halaman booking yang hidup. */
    private function backendKlinikSehatHidup(): void
    {
        Http::fake([
            '*/api/v1/public/config' => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60], 200),
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => [
                ['id' => 488, 'name' => 'Konsultasi', 'price' => 500000, 'durationMinutes' => 60,
                    'clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null],
            ]], 200),
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat']]], 200),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);
    }

    public function test_slug_tak_dikenal_dengan_aturan_dialihkan_dan_hitnya_tercatat(): void
    {
        $this->backendTanpaSlugIni();
        $rule = $this->aturan('/link-lama-uji', '/klinik-sehat');
        $diubah = $rule->fresh()->updated_at;

        $this->travel(5)->minutes();
        $this->get('/link-lama-uji')->assertStatus(302)->assertRedirect('/klinik-sehat');

        $rule->refresh();
        $this->assertSame(1, $rule->hits);
        $this->assertNotNull($rule->last_hit_at);
        // Hit bukan suntingan: "terakhir diubah" tidak boleh ikut bergeser.
        $this->assertEquals($diubah, $rule->updated_at);
    }

    public function test_kode_301_dipakai_kalau_aturannya_301(): void
    {
        $this->backendTanpaSlugIni();
        $this->aturan('/link-lama-uji', '/klinik-sehat', ['status_code' => 301]);

        $this->get('/link-lama-uji')->assertStatus(301)->assertRedirect('/klinik-sehat');
    }

    public function test_path_banyak_segmen_tanpa_route_juga_dialihkan(): void
    {
        // Dua segmen tidak menyentuh /{tenant}, jadi tidak ada panggilan backend.
        $this->aturan('/lama/halaman/*', '/klinik-sehat');

        $this->get('/lama/halaman/apa-saja')->assertRedirect('/klinik-sehat');
    }

    public function test_wildcard_dan_query_string_dibawa(): void
    {
        $this->backendTanpaSlugIni();
        $this->aturan('/appointment-uji-*', '/*');

        $this->get('/appointment-uji-klinik-sehat?utm_source=ig')
            ->assertRedirect('/klinik-sehat?utm_source=ig');
    }

    public function test_tujuan_eksternal(): void
    {
        $this->backendTanpaSlugIni();
        $this->aturan('/ke-situs-utama', 'https://praktiqu.com/psikolog');

        $this->get('/ke-situs-utama')->assertRedirect('https://praktiqu.com/psikolog');
    }

    public function test_halaman_booking_yang_hidup_tidak_pernah_ditimpa(): void
    {
        $this->backendKlinikSehatHidup();
        $rule = $this->aturan('/klinik-sehat', '/tempat-lain');

        $this->get('/klinik-sehat')->assertOk();
        $this->assertSame(0, $rule->fresh()->hits);
    }

    public function test_halaman_sistem_tidak_ditimpa_walau_aturannya_ada(): void
    {
        // Disisipkan langsung, melewati validasi controller yang menolaknya.
        $this->aturan('/staff/login', '/tempat-lain');

        $this->get('/staff/login')->assertOk();
    }

    public function test_post_dan_ajax_tetap_404(): void
    {
        $this->aturan('/lama/form', '/klinik-sehat');

        $this->post('/lama/form')->assertNotFound();
        $this->getJson('/lama/form')->assertNotFound();
    }

    public function test_aturan_nonaktif_diabaikan(): void
    {
        $this->aturan('/lama/nonaktif', '/klinik-sehat', ['active' => false]);

        $this->get('/lama/nonaktif')->assertNotFound();
    }

    public function test_tanpa_aturan_tetap_404_biasa(): void
    {
        $this->get('/lama/tidak-ada-aturannya')->assertNotFound();
    }

    public function test_tabel_aturan_rusak_tetap_404_bukan_500(): void
    {
        Schema::drop('redirect_rules');

        $this->get('/lama/apa-saja')->assertNotFound();
    }

    public function test_hit_yang_gagal_dicatat_tidak_membatalkan_redirect(): void
    {
        $this->aturan('/lama/hit', '/klinik-sehat');
        // Kolom hits dibuat tidak bisa ditulis: increment gagal, redirect tetap.
        DB::statement('CREATE TRIGGER tolak_hit BEFORE UPDATE ON redirect_rules BEGIN SELECT RAISE(ABORT, \'ditolak\'); END');

        $this->get('/lama/hit')->assertRedirect('/klinik-sehat');
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectPengalihanTest.php`

Expected:
- the redirect tests FAIL with `Expected response status code [302] but received 404` and similar;
- the 404, live-page and system-page tests already pass.

- [ ] **Step 3: Write the resolver**

Create `app/Services/RedirectResolver.php`:

```php
<?php

namespace App\Services;

use App\Models\RedirectRule;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Tempat aturan redirect dipakai — dipanggil dari penanganan 404 di
 * bootstrap/app.php, tidak dari tempat lain.
 *
 * Hanya alamat yang memang 404 yang sampai ke sini, jadi tidak ada aturan yang
 * bisa menimpa halaman hidup: /staff/login, dashboard, atau halaman booking
 * yang sedang dipakai pasien. Request normal tidak menyentuh tabel aturan.
 */
class RedirectResolver
{
    public function __construct(private readonly RedirectMatcher $matcher) {}

    public function redirectFor(Request $request): ?RedirectResponse
    {
        // POST, dan fetch() dari dashboard atau halaman booking, tetap menerima
        // 404 biasa: pemanggilnya kode, bukan orang, dan redirect hanya
        // menyembunyikan galatnya.
        if (! in_array($request->getMethod(), ['GET', 'HEAD'], true) || $request->expectsJson()) {
            return null;
        }

        try {
            $hasil = $this->matcher->match(
                $request->getPathInfo(),
                (string) $request->server('QUERY_STRING', ''),
                RedirectRule::aktifUntukMatcher(),
            );
        } catch (\Throwable $e) {
            // Tabel yang rusak tidak boleh mengubah 404 menjadi 500.
            logger()->warning('[redirect] aturan tidak bisa dibaca: '.$e->getMessage());

            return null;
        }
        if (! $hasil) {
            return null;
        }

        $this->catatHit($hasil['id']);

        return str_starts_with($hasil['location'], '/')
            ? redirect()->to($hasil['location'], $hasil['status'])
            : redirect()->away($hasil['location'], $hasil['status']);
    }

    /**
     * Apa yang dijawab aplikasi untuk path ini SEBELUM aturan redirect:
     * 'sistem' (route biasa, termasuk yang hanya menerima POST), 'tenant'
     * (hanya catch-all /{tenant} yang cocok — hidup atau 404 tergantung
     * backend), atau 'tidak-ada'.
     */
    public static function jenisRute(string $path): string
    {
        try {
            $route = app('router')->getRoutes()->match(Request::create($path, 'GET'));
        } catch (MethodNotAllowedHttpException) {
            return 'sistem';
        } catch (NotFoundHttpException) {
            return 'tidak-ada';
        }

        return $route->uri() === '{tenant}' ? 'tenant' : 'sistem';
    }

    /**
     * Yang benar-benar didapat pengunjung di alamat ini — untuk kotak "Uji URL".
     *
     * Bukan sekadar hasil pencocokan: aturan untuk halaman yang masih hidup
     * tidak pernah dipakai, dan admin harus melihat itu, bukan "dialihkan".
     *
     * @return array{hasil:string, ruleId:?int, location:?string, status:?int}
     */
    public function cek(string $url, BookingApi $booking): array
    {
        $kosong = ['ruleId' => null, 'location' => null, 'status' => null];
        $bagian = parse_url($url);
        $path = RedirectMatcher::normalize((string) (($bagian === false ? null : ($bagian['path'] ?? null)) ?? '/'));
        $query = (string) ($bagian === false ? '' : ($bagian['query'] ?? ''));

        $jenis = self::jenisRute($path);
        if ($jenis === 'sistem') {
            return ['hasil' => 'halaman hidup'] + $kosong;
        }
        if ($jenis === 'tenant') {
            try {
                if ($booking->resolveTenant(ltrim($path, '/'))) {
                    return ['hasil' => 'halaman hidup'] + $kosong;
                }
            } catch (ApiException) {
                return ['hasil' => 'tidak bisa dicek'] + $kosong;
            }
        }

        $hasil = $this->matcher->match($path, $query, RedirectRule::aktifUntukMatcher());

        return $hasil
            ? ['hasil' => 'dialihkan', 'ruleId' => $hasil['id'], 'location' => $hasil['location'], 'status' => $hasil['status']]
            : ['hasil' => '404'] + $kosong;
    }

    private function catatHit(int $id): void
    {
        // Query builder, bukan Eloquent: increment() lewat model ikut menulis
        // updated_at, dan "terakhir diubah" berubah makna jadi "terakhir diklik".
        try {
            DB::table('redirect_rules')->where('id', $id)->increment('hits', 1, ['last_hit_at' => now()]);
        } catch (\Throwable $e) {
            logger()->warning('[redirect] hit tidak tercatat: '.$e->getMessage(), ['id' => $id]);
        }
    }
}
```

- [ ] **Step 4: Register the 404 callback**

In `bootstrap/app.php`, inside `->withExceptions(function (Exceptions $exceptions): void {`, add this block directly **after** the closing `});` of the existing 419 `$exceptions->render(...)` callback:

```php

        // Aturan redirect Super Admin (Settings → Redirect). Dicek HANYA di
        // sini, saat alamatnya memang 404 — termasuk abort(404) dari /{tenant}
        // untuk slug tak dikenal, yang menangkap tautan WordPress lama seperti
        // /appointment-<nama>. null = tidak ada aturan, 404 seperti biasa.
        $exceptions->render(function (\Symfony\Component\HttpKernel\Exception\NotFoundHttpException $e, Request $request) {
            return app(\App\Services\RedirectResolver::class)->redirectFor($request);
        });
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectPengalihanTest.php`

Expected: `OK (12 tests, …)`.

If `test_hit_yang_gagal_dicatat_tidak_membatalkan_redirect` fails because the trigger syntax is rejected, replace the trigger with `Schema::table('redirect_rules', fn ($t) => $t->dropColumn('hits'));`. That makes the increment fail the same way.

- [ ] **Step 6: Commit**

```bash
git add app/Services/RedirectResolver.php bootstrap/app.php tests/Feature/RedirectPengalihanTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(redirect): alamat yang 404 dialihkan menurut aturan

Dipanggil dari penanganan NotFoundHttpException, jadi hanya alamat yang
memang 404 — termasuk slug tak dikenal di /{tenant} — yang bisa
dialihkan; halaman hidup tidak pernah ditimpa. GET/HEAD non-AJAX saja.
Tabel yang rusak tetap 404, bukan 500; hit dicatat tanpa menyentuh
updated_at.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validation, super-only endpoints and "Uji URL"

**Files:**
- Create: `app/Services/RedirectRuleValidator.php`
- Create: `app/Http/Controllers/RedirectRuleController.php`
- Modify: `routes/web.php`
  - add `use App\Http\Controllers\RedirectRuleController;` between the `PwaController` and `ReportController` imports;
  - add five routes inside the `Route::middleware('staff:any')->group(...)` block, right after the two `/dashboard/fitur` routes.
- Test: `tests/Feature/RedirectRuleControllerTest.php`

**Interfaces:**
- Consumes:
  - `RedirectMatcher` (Task 1)
  - `RedirectRule::toRow()` and `RedirectRule::aktifUntukMatcher()` (Task 1)
  - `RedirectResolver::jenisRute()` and `RedirectResolver::cek()` (Task 2)
  - `AuthController::validProfile()`, which returns the session profile with `role` and `email`
- Produces:
  - `RedirectRuleValidator::periksa(array $input, ?int $abaikanId, array $hostSendiri): array<string,string>`. `$input` holds raw `source`, `destination` and `status_code`.
  - These endpoints:

| Method | Path | Success body |
|---|---|---|
| GET | `/dashboard/redirect` | `{rules: Row[]}` |
| POST | `/dashboard/redirect` | `201 {ok: true, rule: Row}` |
| PUT | `/dashboard/redirect/{id}` | `{ok: true, rule: Row}` |
| DELETE | `/dashboard/redirect/{id}` | `{ok: true}` |
| GET | `/dashboard/redirect/uji?path=` | the `cek()` array |

  Errors on every endpoint:
  - validation: `422 {message: <first error>, errors: {field: message}}`;
  - wrong role: `403 {message}`;
  - no session: `401` (from `StaffAuth`).

- [ ] **Step 1: Write the failing feature test**

Create `tests/Feature/RedirectRuleControllerTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Models\RedirectRule;
use App\Services\PraktiquApi;
use App\Services\RedirectMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Settings → Redirect: super admin saja, dan setiap aturan diperiksa sebelum
 * disimpan — tujuan berbahaya, sumber yang tidak akan pernah dipakai, dan
 * redirect yang berputar ditolak dengan pesan yang bisa dimengerti.
 */
class RedirectRuleControllerTest extends TestCase
{
    use RefreshDatabase;

    private function sesi(string $role = 'super'): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Super',
                'userId' => 9, 'email' => 'super@praktiqu.test',
            ],
        ];
    }

    private function simpan(array $isi): TestResponse
    {
        return $this->withSession($this->sesi())
            ->postJson('/dashboard/redirect', $isi + ['status_code' => 302]);
    }

    private function aturan(string $source, string $destination): RedirectRule
    {
        return RedirectRule::create(['source' => RedirectMatcher::normalize($source), 'destination' => $destination]);
    }

    public function test_hanya_super_admin(): void
    {
        $rule = $this->aturan('/link-lama-uji', '/klinik-sehat');

        foreach (['admin', 'psikolog'] as $peran) {
            $s = $this->sesi($peran);
            $this->withSession($s)->getJson('/dashboard/redirect')->assertStatus(403);
            $this->withSession($s)->postJson('/dashboard/redirect', ['source' => '/a', 'destination' => '/b'])->assertStatus(403);
            $this->withSession($s)->putJson("/dashboard/redirect/{$rule->id}", ['source' => '/a', 'destination' => '/b'])->assertStatus(403);
            $this->withSession($s)->deleteJson("/dashboard/redirect/{$rule->id}")->assertStatus(403);
            $this->withSession($s)->getJson('/dashboard/redirect/uji?path=/a')->assertStatus(403);
        }
        $this->assertNotNull($rule->fresh(), 'Peran lain tidak boleh berhasil menghapus.');

        $this->flushSession();
        $this->getJson('/dashboard/redirect')->assertStatus(401);
    }

    public function test_super_bisa_tambah_ubah_nonaktifkan_dan_hapus(): void
    {
        $res = $this->simpan(['source' => '/Link-Lama-Uji/', 'destination' => '/klinik-sehat', 'note' => 'uji'])
            ->assertStatus(201)->assertJsonPath('ok', true);

        $id = $res->json('rule.id');
        $res->assertJsonPath('rule.source', '/link-lama-uji')
            ->assertJsonPath('rule.status', 302)
            ->assertJsonPath('rule.active', true)
            ->assertJsonPath('rule.note', 'uji')
            ->assertJsonPath('rule.updatedBy', 'super@praktiqu.test');

        $this->withSession($this->sesi())->putJson("/dashboard/redirect/{$id}", [
            'source' => '/link-lama-uji', 'destination' => '/klinik-lain', 'status_code' => 301, 'active' => false, 'note' => '',
        ])->assertOk()
            ->assertJsonPath('rule.destination', '/klinik-lain')
            ->assertJsonPath('rule.status', 301)
            ->assertJsonPath('rule.active', false)
            ->assertJsonPath('rule.note', '');

        $daftar = $this->withSession($this->sesi())->getJson('/dashboard/redirect')->assertOk()->json('rules');
        $this->assertContains('/link-lama-uji', array_column($daftar, 'source'));

        $this->withSession($this->sesi())->deleteJson("/dashboard/redirect/{$id}")->assertOk();
        $this->assertNull(RedirectRule::find($id));
    }

    public function test_ubah_aturan_yang_sudah_dihapus_404(): void
    {
        $this->withSession($this->sesi())->putJson('/dashboard/redirect/999999', [
            'source' => '/a-uji', 'destination' => '/b',
        ])->assertNotFound();
    }

    public function test_tujuan_berbahaya_atau_tidak_sah_ditolak(): void
    {
        foreach (['', 'javascript:alert(1)', '//evil.com', '/\\evil.com', 'ftp://x.com/a', 'https://', 'tanpa-garis-miring', '/ada spasi'] as $i => $tujuan) {
            $this->simpan(['source' => "/lama/tujuan-{$i}", 'destination' => $tujuan])
                ->assertStatus(422)->assertJsonStructure(['message', 'errors' => ['destination']]);
        }
    }

    public function test_sumber_tidak_sah_ditolak(): void
    {
        foreach (['', 'appointment-x', '/a/*/b/*', '/a?b=1', '/a#b', 'https://appointment.praktiqu.com/a', '//a', '/a b'] as $sumber) {
            $this->simpan(['source' => $sumber, 'destination' => '/klinik-sehat'])
                ->assertStatus(422)->assertJsonStructure(['errors' => ['source']]);
        }
    }

    public function test_bintang_di_tujuan_butuh_bintang_di_sumber(): void
    {
        $this->simpan(['source' => '/lama/a', 'destination' => '/*'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['destination']]);
    }

    public function test_kode_selain_301_dan_302_ditolak(): void
    {
        $this->simpan(['source' => '/lama/a', 'destination' => '/b', 'status_code' => 307])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['status_code']]);
    }

    public function test_halaman_sistem_ditolak_sebagai_sumber(): void
    {
        foreach (['/staff/login', '/Staff/Login/', '/logout', '/'] as $sumber) {
            $res = $this->simpan(['source' => $sumber, 'destination' => '/klinik-sehat'])->assertStatus(422);
            $this->assertStringContainsString('halaman sistem', $res->json('errors.source'));
        }
    }

    public function test_sumber_ganda_ditolak_walau_beda_huruf_tapi_aturannya_sendiri_boleh_disimpan_ulang(): void
    {
        $rule = $this->aturan('/link-lama-uji', '/klinik-sehat');

        $this->simpan(['source' => '/LINK-LAMA-UJI', 'destination' => '/x'])
            ->assertStatus(422)->assertJsonPath('errors.source', 'Sudah ada aturan untuk sumber ini.');

        $this->withSession($this->sesi())->putJson("/dashboard/redirect/{$rule->id}", [
            'source' => '/link-lama-uji', 'destination' => '/klinik-baru',
        ])->assertOk();
    }

    public function test_redirect_yang_berputar_ditolak(): void
    {
        // Ke dirinya sendiri.
        $this->simpan(['source' => '/lama/a', 'destination' => '/lama/a'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['destination']]);
        $this->simpan(['source' => '/putar-*', 'destination' => '/putar-*'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['destination']]);

        // A → B, lalu B → A.
        $this->simpan(['source' => '/lama/b', 'destination' => '/lama/c'])->assertStatus(201);
        $res = $this->simpan(['source' => '/lama/c', 'destination' => '/lama/b'])->assertStatus(422);
        $this->assertStringContainsString('berputar', $res->json('errors.destination'));

        // URL lengkap ke situs ini sendiri dihitung internal.
        $this->simpan(['source' => '/lama/d', 'destination' => '/lama/e'])->assertStatus(201);
        $this->simpan(['source' => '/lama/e', 'destination' => 'http://localhost/lama/d'])->assertStatus(422);
    }

    public function test_rantai_lebih_dari_lima_lompatan_ditolak(): void
    {
        foreach ([1, 2, 3, 4, 5] as $n) {
            $this->simpan(['source' => "/lama/h{$n}", 'destination' => '/lama/h'.($n + 1)])->assertStatus(201);
        }

        $res = $this->simpan(['source' => '/lama/h0', 'destination' => '/lama/h1'])->assertStatus(422);
        $this->assertStringContainsString('terlalu panjang', $res->json('errors.destination'));
    }

    public function test_uji_url_halaman_sistem_dan_404(): void
    {
        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path='.urlencode('/staff/login'))
            ->assertOk()->assertJsonPath('hasil', 'halaman hidup');

        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path='.urlencode('/lama/tanpa-aturan'))
            ->assertOk()->assertJsonPath('hasil', '404');

        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path=')->assertStatus(422);
    }

    public function test_uji_url_aturan_yang_dipakai(): void
    {
        $rule = $this->aturan('/lama/uji/*', '/klinik-sehat');

        $this->withSession($this->sesi())
            ->getJson('/dashboard/redirect/uji?path='.urlencode('https://appointment.praktiqu.com/lama/uji/x?utm_source=ig'))
            ->assertOk()
            ->assertJsonPath('hasil', 'dialihkan')
            ->assertJsonPath('ruleId', $rule->id)
            ->assertJsonPath('location', '/klinik-sehat?utm_source=ig')
            ->assertJsonPath('status', 302);
    }

    public function test_uji_url_halaman_booking_hidup(): void
    {
        Http::fake([
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => []], 200),
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat']]], 200),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);
        $this->aturan('/klinik-sehat', '/tempat-lain');

        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path=/klinik-sehat')
            ->assertOk()->assertJsonPath('hasil', 'halaman hidup');
    }

    public function test_uji_url_slug_tak_dikenal_dengan_aturan(): void
    {
        Http::fake([
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Sehat']]], 200),
            '*/api/v1/public/professionals/by-slug/*' => Http::response(['status' => 404], 404),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);
        $this->aturan('/link-lama-uji', '/klinik-sehat');

        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path=/link-lama-uji')
            ->assertOk()->assertJsonPath('hasil', 'dialihkan')->assertJsonPath('location', '/klinik-sehat');
    }

    public function test_uji_url_saat_backend_bermasalah(): void
    {
        Http::fake([
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'Klinik Lain']]], 200),
            '*/api/v1/public/professionals*' => Http::response(null, 503),
        ]);

        $this->withSession($this->sesi())->getJson('/dashboard/redirect/uji?path=/link-lama-uji')
            ->assertOk()->assertJsonPath('hasil', 'tidak bisa dicek');
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectRuleControllerTest.php`

Expected: most tests FAIL with 404 or 405, because the routes do not exist yet.

- [ ] **Step 3: Write the validator**

Create `app/Services/RedirectRuleValidator.php`:

```php
<?php

namespace App\Services;

use App\Models\RedirectRule;

/**
 * Pemeriksaan satu aturan redirect sebelum disimpan.
 *
 * Mengembalikan pesan per field, berbahasa Indonesia untuk modal dashboard;
 * array kosong berarti sah. Pemeriksaan rantai sengaja konservatif: ia tidak
 * tahu halaman mana yang hidup, jadi menganggap setiap aturan bisa terpakai.
 */
class RedirectRuleValidator
{
    /** Batas lompatan saat menelusuri rantai A → B → C … */
    public const MAKS_LOMPATAN = 5;

    public function __construct(private readonly RedirectMatcher $matcher) {}

    /**
     * @param  array{source:string, destination:string, status_code:int}  $input  sumber BELUM dinormalisasi
     * @param  array<int, string|null>  $hostSendiri  host yang berarti "situs ini"; URL lengkap ke sana dihitung internal
     * @return array<string, string>
     */
    public function periksa(array $input, ?int $abaikanId, array $hostSendiri): array
    {
        $galat = [];
        $mentah = $input['source'];

        if ($e = self::galatSumber($mentah)) {
            $galat['source'] = $e;
        } else {
            $src = RedirectMatcher::normalize($mentah);
            if (RedirectRule::where('source', $src)->when($abaikanId, fn ($q) => $q->whereKeyNot($abaikanId))->exists()) {
                $galat['source'] = 'Sudah ada aturan untuk sumber ini.';
            } elseif (! str_contains($src, '*') && RedirectResolver::jenisRute($src) === 'sistem') {
                $galat['source'] = "{$src} adalah halaman sistem; aturan ini tidak akan pernah dipakai.";
            }
        }

        if ($e = self::galatTujuan($input['destination'], $mentah)) {
            $galat['destination'] = $e;
        }

        if (! in_array((int) $input['status_code'], [301, 302], true)) {
            $galat['status_code'] = 'Jenis redirect harus 301 atau 302.';
        }

        if (! $galat && ($e = $this->galatRantai($input, $abaikanId, $hostSendiri))) {
            $galat['destination'] = $e;
        }

        return $galat;
    }

    private static function galatSumber(string $s): ?string
    {
        if ($s === '') {
            return 'Sumber wajib diisi.';
        }
        if (mb_strlen($s) > 255) {
            return 'Sumber terlalu panjang (maksimal 255 karakter).';
        }
        if (! str_starts_with($s, '/')) {
            return 'Sumber harus diawali "/", contoh: /appointment-nama-psikolog.';
        }
        if (str_starts_with($s, '//')) {
            return 'Sumber cukup path-nya saja, tanpa nama domain.';
        }
        if (preg_match('/[?#\s\\\\]|[\x00-\x1F\x7F]/', $s)) {
            return 'Sumber tidak boleh berisi spasi, "?", "#", atau "\\".';
        }
        if (substr_count($s, '*') > 1) {
            return 'Sumber hanya boleh memuat satu tanda *.';
        }

        return null;
    }

    private static function galatTujuan(string $d, string $sumber): ?string
    {
        if ($d === '') {
            return 'Tujuan wajib diisi.';
        }
        if (strlen($d) > 2048) {
            return 'Tujuan terlalu panjang (maksimal 2048 karakter).';
        }
        // Garis miring terbalik ikut ditolak: peramban membaca /\evil.com
        // sebagai //evil.com — redirect keluar yang menyamar sebagai internal.
        if (preg_match('/[\s\\\\]|[\x00-\x1F\x7F]/', $d)) {
            return 'Tujuan tidak boleh berisi spasi atau "\\".';
        }
        if (str_contains($d, '*') && ! str_contains($sumber, '*')) {
            return 'Tanda * di tujuan hanya bisa dipakai kalau sumbernya juga memakai *.';
        }
        if (str_starts_with($d, '/')) {
            return str_starts_with($d, '//') ? 'Tujuan internal diawali satu "/", bukan "//".' : null;
        }

        $skema = strtolower((string) parse_url($d, PHP_URL_SCHEME));
        $host = (string) parse_url($d, PHP_URL_HOST);
        if (! in_array($skema, ['http', 'https'], true) || $host === '') {
            return 'Tujuan harus berupa path (diawali "/") atau URL lengkap yang diawali http:// atau https://.';
        }

        return null;
    }

    private function galatRantai(array $input, ?int $abaikanId, array $hostSendiri): ?string
    {
        $calon = [
            'id' => $abaikanId ?? 0,
            'source' => RedirectMatcher::normalize($input['source']),
            'destination' => $input['destination'],
            'status_code' => (int) $input['status_code'],
        ];
        $aturan = array_values(array_filter(
            RedirectRule::aktifUntukMatcher(),
            fn (array $r) => $r['id'] !== $abaikanId,
        ));
        $aturan[] = $calon;

        $host = array_map('strtolower', array_filter($hostSendiri));
        // Path contoh yang dikenai aturan ini; untuk wildcard `*` diisi teks
        // yang tidak mungkin bentrok dengan slug sungguhan.
        $path = str_replace('*', 'contoh-rantai', $calon['source']);
        $dikunjungi = [$path => true];

        for ($i = 0; $i <= self::MAKS_LOMPATAN; $i++) {
            $hasil = $this->matcher->match($path, '', $aturan);
            if (! $hasil) {
                return null;
            }
            $berikut = self::pathInternal($hasil['location'], $host);
            if ($berikut === null) {
                return null;
            }
            if (isset($dikunjungi[$berikut])) {
                return "Redirect ini berputar: {$berikut} akan kembali ke dirinya sendiri.";
            }
            $dikunjungi[$berikut] = true;
            $path = $berikut;
        }

        return 'Rantai redirect terlalu panjang (lebih dari '.self::MAKS_LOMPATAN.' lompatan).';
    }

    /** Path tujuan kalau ia mendarat di situs ini; null kalau keluar ke situs lain. */
    private static function pathInternal(string $location, array $hostSendiri): ?string
    {
        if (str_starts_with($location, '/')) {
            return RedirectMatcher::normalize((string) parse_url($location, PHP_URL_PATH));
        }

        $host = strtolower((string) parse_url($location, PHP_URL_HOST));

        return $host !== '' && in_array($host, $hostSendiri, true)
            ? RedirectMatcher::normalize((string) (parse_url($location, PHP_URL_PATH) ?? '/'))
            : null;
    }
}
```

- [ ] **Step 4: Write the controller**

Create `app/Http/Controllers/RedirectRuleController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\RedirectRule;
use App\Services\BookingApi;
use App\Services\RedirectMatcher;
use App\Services\RedirectResolver;
use App\Services\RedirectRuleValidator;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Settings → Redirect. Super admin saja.
 *
 * Aturannya mengalihkan alamat yang kalau tidak dialihkan akan 404 — terutama
 * tautan booking WordPress lama (/appointment-<nama>) yang masih beredar.
 * Ditegakkan di sini, bukan cuma dengan menyembunyikan menunya: aturan yang
 * salah mengirim pasien ke tempat yang salah.
 */
class RedirectRuleController extends Controller
{
    public function __construct(private readonly RedirectRuleValidator $validator) {}

    /** GET /dashboard/redirect */
    public function index(): JsonResponse
    {
        if ($tolak = $this->tolakSelainSuper()) {
            return $tolak;
        }

        return response()->json([
            'rules' => RedirectRule::orderBy('source')->get()->map(fn (RedirectRule $r) => $r->toRow())->all(),
        ]);
    }

    /** POST /dashboard/redirect */
    public function store(Request $request): JsonResponse
    {
        if ($tolak = $this->tolakSelainSuper()) {
            return $tolak;
        }

        $rule = RedirectRule::create($this->sah($request, null));

        return response()->json(['ok' => true, 'rule' => $rule->fresh()->toRow()], 201);
    }

    /** PUT /dashboard/redirect/{id} — juga dipakai sakelar aktif di tabel. */
    public function update(Request $request, int $id): JsonResponse
    {
        if ($tolak = $this->tolakSelainSuper()) {
            return $tolak;
        }

        $rule = RedirectRule::find($id);
        if (! $rule) {
            return response()->json(['message' => 'Aturan tidak ditemukan. Mungkin sudah dihapus.'], 404);
        }
        $rule->update($this->sah($request, $rule->id));

        return response()->json(['ok' => true, 'rule' => $rule->fresh()->toRow()]);
    }

    /** DELETE /dashboard/redirect/{id} */
    public function destroy(int $id): JsonResponse
    {
        if ($tolak = $this->tolakSelainSuper()) {
            return $tolak;
        }

        RedirectRule::whereKey($id)->delete();

        return response()->json(['ok' => true]);
    }

    /** GET /dashboard/redirect/uji?path= — yang benar-benar didapat pengunjung. */
    public function uji(Request $request, RedirectResolver $resolver, BookingApi $booking): JsonResponse
    {
        if ($tolak = $this->tolakSelainSuper()) {
            return $tolak;
        }

        $path = trim((string) $request->query('path', ''));
        if ($path === '') {
            return response()->json(['message' => 'Isi alamat yang mau diuji, contoh: /appointment-nama-psikolog.'], 422);
        }

        return response()->json($resolver->cek($path, $booking));
    }

    /** Isian yang sudah diperiksa, siap disimpan. Galat → 422 dengan pesan per field. */
    private function sah(Request $request, ?int $abaikanId): array
    {
        $input = [
            'source' => trim((string) $request->input('source', '')),
            'destination' => trim((string) $request->input('destination', '')),
            'status_code' => (int) $request->input('status_code', 302),
        ];
        $catatan = trim((string) $request->input('note', ''));

        $galat = $this->validator->periksa($input, $abaikanId, [
            $request->getHost(),
            parse_url((string) config('app.url'), PHP_URL_HOST),
        ]);
        if (mb_strlen($catatan) > 255) {
            $galat['note'] = 'Catatan maksimal 255 karakter.';
        }
        // Bukan ValidationException: pesannya akan berakhiran "(and 1 more
        // error)" dalam bahasa Inggris, dan modal menampilkannya apa adanya.
        if ($galat) {
            throw new HttpResponseException(response()->json(['message' => reset($galat), 'errors' => $galat], 422));
        }

        return [
            'source' => RedirectMatcher::normalize($input['source']),
            'destination' => $input['destination'],
            'status_code' => $input['status_code'],
            'active' => $request->boolean('active', true),
            'note' => $catatan !== '' ? $catatan : null,
            'updated_by' => AuthController::validProfile()['email'] ?? null,
        ];
    }

    private function tolakSelainSuper(): ?JsonResponse
    {
        if ((AuthController::validProfile()['role'] ?? null) === 'super') {
            return null;
        }

        return response()->json(['message' => 'Pengaturan redirect hanya bisa dibuka Super Admin.'], 403);
    }
}
```

- [ ] **Step 5: Add the routes**

In `routes/web.php`, add `use App\Http\Controllers\RedirectRuleController;` between `use App\Http\Controllers\PwaController;` and `use App\Http\Controllers\ReportController;`.

Inside the `Route::middleware('staff:any')->group(function () {` block, find this line:

```php
    Route::post('/dashboard/fitur', [FeatureRequestController::class, 'store'])->middleware('throttle:10,60');
```

Insert this directly after it:

```php
    // Settings → Redirect, super admin saja — diperiksa controller-nya, seperti
    // Log Sistem. Aturannya hanya dipakai saat sebuah alamat 404, lihat
    // RedirectResolver. Harus di atas catch-all DELETE /dashboard/{resource}/{id}
    // di bawah, yang jumlah segmennya sama.
    Route::get('/dashboard/redirect', [RedirectRuleController::class, 'index']);
    Route::post('/dashboard/redirect', [RedirectRuleController::class, 'store']);
    Route::get('/dashboard/redirect/uji', [RedirectRuleController::class, 'uji']);
    Route::put('/dashboard/redirect/{id}', [RedirectRuleController::class, 'update'])->whereNumber('id');
    Route::delete('/dashboard/redirect/{id}', [RedirectRuleController::class, 'destroy'])->whereNumber('id');
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectRuleControllerTest.php tests/Feature/RedirectPengalihanTest.php`

Expected: `OK (28 tests, …)`.

- [ ] **Step 7: Commit**

```bash
git add app/Services/RedirectRuleValidator.php app/Http/Controllers/RedirectRuleController.php routes/web.php tests/Feature/RedirectRuleControllerTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(redirect): endpoint super admin untuk mengelola aturan redirect

CRUD /dashboard/redirect plus /dashboard/redirect/uji, super saja
(403 untuk peran lain). Tujuan javascript:, //host, /\host ditolak;
sumber yang merupakan halaman sistem ditolak karena tidak akan pernah
dipakai; redirect berputar dan rantai >5 lompatan ditolak. Uji URL
melaporkan apa yang benar-benar didapat pengunjung, termasuk "halaman
hidup" untuk slug booking yang masih aktif.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dashboard page "Redirect"

**Files:**
- Modify: `resources/views/dashboard.blade.php` (nine anchored edits, below)
- Test: `tests/Feature/RedirectMenuTest.php`

**Interfaces:**
- Consumes the Task 3 endpoints and their JSON shapes. A row has the keys `id`, `source`, `destination`, `status`, `active`, `note`, `hits`, `lastHit`, `updatedBy`. A save returns `{ok, rule}`; an error returns `{message, errors}`.
- Consumes the existing Alpine helpers `apiWrite(method, url, body)` and `showToast(msg)`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/RedirectMenuTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Menu Redirect hanya untuk super, dan state halamannya tidak bertabrakan. */
class RedirectMenuTest extends TestCase
{
    private function sesi(string $role, array $lain = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Uji', 'userId' => 9,
            ] + $lain,
        ];
    }

    public function test_menunya_hanya_muncul_untuk_super(): void
    {
        Http::fake(fn () => Http::response(['data' => []]));

        $super = $this->withSession($this->sesi('super'))->get('/admin');
        $super->assertSee("go('redirects')", false);
        $super->assertSee("view === 'redirects'", false);

        // Yang diperiksa TAUTAN menunya: kerangka halaman dirender untuk semua
        // peran lalu disembunyikan x-show; penjaga sebenarnya 403 di controller.
        $admin = $this->withSession($this->sesi('admin', ['practiceId' => 42]))->get('/klinik');
        $admin->assertDontSee("go('redirects')", false);
    }

    public function test_daftar_menu_js_memuat_redirect_untuk_super_saja(): void
    {
        $src = file_get_contents(resource_path('views/dashboard.blade.php'));

        $this->assertMatchesRegularExpression('/const REAL = \[[^\]]*"redirects"\]/', $src);
        $this->assertStringContainsString('{ title: "Settings", items: ["settings", "redirects"] }', $src);
        $this->assertStringContainsString('redirects: "Redirect"', $src);
        $this->assertDoesNotMatchRegularExpression('/admin: \[[^\]]*"redirects"/', $src);
        $this->assertDoesNotMatchRegularExpression('/psikolog: \[[^\]]*"redirects"/', $src);
    }

    /**
     * Dua kunci bernama sama di literal dashApp() diam-diam jadi SATU properti
     * (lihat sysLogData). Semua state halaman ini berawalan `rd` dan harus
     * dideklarasikan tepat sekali.
     */
    public function test_state_halaman_redirect_dideklarasikan_sekali(): void
    {
        $src = file_get_contents(resource_path('views/dashboard.blade.php'));

        foreach (['rdRules', 'rdLoaded', 'rdBusy', 'rdError', 'rdForm', 'rdFormErrors', 'rdSaving', 'rdUjiPath', 'rdUji', 'rdUjiBusy'] as $k) {
            $this->assertSame(1, preg_match_all('/\b'.$k.':/', $src), "{$k} harus dideklarasikan tepat sekali");
        }
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectMenuTest.php`

Expected: all three tests FAIL, because there is no `redirects` anywhere yet.

- [ ] **Step 3: JS nav constants, three edits**

In `resources/views/dashboard.blade.php`:

(a) Replace

```js
    logs: "Log Sistem",
  };
```

with

```js
    logs: "Log Sistem", redirects: "Redirect",
  };
```

(b) Replace `    { title: "Settings", items: ["settings"] },` with `    { title: "Settings", items: ["settings", "redirects"] },`

(c) In the line starting `  const REAL = [`, replace the ending `"features", "logs"];` with `"features", "logs", "redirects"];`

- [ ] **Step 4: Load the page when navigating to it**

Replace

```js
      if (id === "logs" && !this.logLoaded) this.loadLog();
```

with

```js
      if (id === "logs" && !this.logLoaded) this.loadLog();
      if (id === "redirects" && !this.rdLoaded) this.loadRedirects();
```

- [ ] **Step 5: Alpine state and methods**

Insert this block directly **before** the line `    // ── Paginasi daftar ──────────────────────────────────────────────────`:

```js
    // ── Redirect (super saja) ────────────────────────────────────────────
    // Aturan pengalihan untuk alamat yang kalau tidak dialihkan akan 404 —
    // terutama tautan booking WordPress lama (/appointment-<nama>). Semua
    // kunci berawalan `rd`: dua kunci bernama sama di literal ini diam-diam
    // jadi SATU properti (lihat sysLogData di atas).
    rdRules: [], rdLoaded: false, rdBusy: false, rdError: "",
    rdForm: null, rdFormErrors: {}, rdSaving: false,
    rdUjiPath: "", rdUji: null, rdUjiBusy: false,
    async loadRedirects() {
      this.rdBusy = true; this.rdError = "";
      try {
        const res = await fetch("/dashboard/redirect", { headers: { "Accept": "application/json" } });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error((j && j.message) || "Aturan redirect gagal dimuat.");
        this.rdRules = j.rules || [];
        this.rdLoaded = true;
      } catch (e) {
        this.rdError = e.message;
      } finally { this.rdBusy = false; }
    },
    bukaRedirect(r) {
      this.rdFormErrors = {};
      this.rdForm = r
        ? { id: r.id, source: r.source, destination: r.destination, status_code: r.status, active: r.active, note: r.note }
        : { id: null, source: "", destination: "", status_code: 302, active: true, note: "" };
    },
    async simpanRedirect() {
      const f = this.rdForm;
      this.rdSaving = true; this.rdFormErrors = {};
      const res = await this.apiWrite(f.id ? "PUT" : "POST", f.id ? `/dashboard/redirect/${f.id}` : "/dashboard/redirect", {
        source: f.source, destination: f.destination, status_code: Number(f.status_code), active: !!f.active, note: f.note,
      });
      this.rdSaving = false;
      if (!res || res.ok !== true) {
        this.rdFormErrors = (res && res.errors) || { umum: (res && res.message) || "Aturan gagal disimpan." };
        return;
      }
      this.rdRules = f.id ? this.rdRules.map((x) => (x.id === f.id ? res.rule : x)) : [res.rule, ...this.rdRules];
      this.rdForm = null;
      this.showToast("Aturan redirect disimpan.");
    },
    async toggleRedirect(r, ev) {
      const res = await this.apiWrite("PUT", `/dashboard/redirect/${r.id}`, {
        source: r.source, destination: r.destination, status_code: r.status, active: !r.active, note: r.note,
      });
      if (!res || res.ok !== true) {
        // Kotak centang sudah berubah di layar; kembalikan supaya tidak berbohong.
        if (ev && ev.target) ev.target.checked = r.active;
        this.showToast((res && res.message) || "Status aturan gagal diubah.");
        return;
      }
      this.rdRules = this.rdRules.map((x) => (x.id === r.id ? res.rule : x));
    },
    async hapusRedirect(r) {
      if (!confirm(`Hapus aturan ${r.source} → ${r.destination}?`)) return;
      const res = await this.apiWrite("DELETE", `/dashboard/redirect/${r.id}`);
      if (!res || res.ok !== true) { this.showToast((res && res.message) || "Aturan gagal dihapus."); return; }
      this.rdRules = this.rdRules.filter((x) => x.id !== r.id);
      this.showToast("Aturan redirect dihapus.");
    },
    async ujiRedirect() {
      const p = this.rdUjiPath.trim();
      if (!p) return;
      this.rdUjiBusy = true;
      try {
        const res = await fetch(`/dashboard/redirect/uji?${new URLSearchParams({ path: p })}`, { headers: { "Accept": "application/json" } });
        const j = await res.json().catch(() => null);
        this.rdUji = res.ok ? j : { hasil: "galat", pesan: (j && j.message) || "Gagal menguji alamat." };
      } catch {
        this.rdUji = { hasil: "galat", pesan: "Tidak dapat menghubungi server." };
      } finally { this.rdUjiBusy = false; }
    },
    rdUjiTeks(u) {
      if (!u) return "";
      if (u.hasil === "halaman hidup") return "Halaman ini hidup — aturan redirect tidak dipakai di sini.";
      if (u.hasil === "dialihkan") return `Dialihkan oleh aturan #${u.ruleId} ke ${u.location} (kode ${u.status}).`;
      if (u.hasil === "404") return "Halaman tidak ada dan tidak ada aturan yang cocok — pengunjung melihat 404.";
      if (u.hasil === "tidak bisa dicek") return "Tidak bisa dicek sekarang: server booking sedang bermasalah. Coba lagi sebentar.";
      return u.pesan || "";
    },

```

- [ ] **Step 6: PHP nav metadata, two edits**

(a) Replace `          'logs' => ['Log Sistem', 'doc'],` with

```php
          'logs' => ['Log Sistem', 'doc'], 'redirects' => ['Redirect', 'external'],
```

(b) Replace `['Settings', ['settings']], ['Support', ['features', 'logs']],` with `['Settings', ['settings', 'redirects']], ['Support', ['features', 'logs']],`

`$ALLOWED_NAV['super']` is `array_keys($NAV_META)`, so super gets the item automatically. The `admin` and `psikolog` lists are explicit and stay unchanged.

- [ ] **Step 7: The page markup**

Insert directly **before** the line that begins `      {{-- ═══ SETTINGS ═══ ═══`:

```blade
      {{-- ═══ REDIRECT (super saja) ═══
           Aturan pengalihan untuk alamat yang kalau tidak dialihkan akan 404.
           Dicek HANYA saat halaman memang tidak ada, jadi aturan di sini tidak
           bisa menimpa halaman hidup — lihat RedirectResolver. --}}
      <div x-show="view === 'redirects'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Settings <span>›</span> <b>Redirect</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px">
          <div>
            <div class="page-title">Redirect</div>
            <div style="font-size:13px;color:#8A90A6;margin-top:4px">Alihkan alamat yang sudah tidak ada (mis. tautan WordPress lama) ke halaman barunya</div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn-white" @click="loadRedirects()" :disabled="rdBusy" x-text="rdBusy ? 'Memuat…' : 'Muat ulang'"></button>
            <button class="btn-blue" @click="bukaRedirect(null)">+ Tambah Aturan</button>
          </div>
        </div>

        <div class="card" style="padding:16px 18px;margin-bottom:18px">
          <div style="font-size:13px;font-weight:700;color:#1E2236;margin-bottom:8px">Uji URL</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div class="search-box" style="flex:1;min-width:240px">
              <x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/>
              <input x-model="rdUjiPath" @keydown.enter="ujiRedirect()" placeholder="/appointment-nama-psikolog" aria-label="Alamat yang diuji">
            </div>
            <button class="btn-white" @click="ujiRedirect()" :disabled="rdUjiBusy" x-text="rdUjiBusy ? 'Menguji…' : 'Uji'"></button>
          </div>
          <div x-show="rdUji" style="font-size:12.5px;color:#42496B;margin-top:10px;line-height:1.55" x-text="rdUjiTeks(rdUji)"></div>
        </div>

        <div x-show="rdError" style="padding:14px 16px;margin-bottom:18px;border:1px solid #F5CFCB;background:#FCE9E7;border-radius:12px;font-size:13px;color:#B3261E" x-text="rdError"></div>

        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:960px">
              <thead><tr><th>Sumber</th><th>Tujuan</th><th style="text-align:center">Kode</th><th style="text-align:center">Aktif</th><th style="text-align:right">Dipakai</th><th>Catatan</th><th></th></tr></thead>
              <tbody>
                <tr x-show="rdLoaded && rdRules.length === 0"><td colspan="7" class="empty">Belum ada aturan redirect.</td></tr>
                <template x-for="r in rdRules" :key="r.id">
                  <tr :style="r.active ? '' : 'opacity:.55'">
                    <td style="font-family:ui-monospace,monospace;font-size:12.5px" x-text="r.source"></td>
                    <td style="font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all" x-text="r.destination"></td>
                    <td style="text-align:center" x-text="r.status"></td>
                    <td style="text-align:center"><input type="checkbox" :checked="r.active" @change="toggleRedirect(r, $event)" :aria-label="`Aktifkan aturan ${r.source}`"></td>
                    <td style="text-align:right"><div x-text="r.hits"></div><div style="font-size:11.5px;color:#9499AE" x-text="r.lastHit || '—'"></div></td>
                    <td style="font-size:12.5px;color:#6B7186" x-text="r.note || '—'"></td>
                    <td style="text-align:right;white-space:nowrap">
                      <button class="btn-white" @click="bukaRedirect(r)">Ubah</button>
                      <button class="btn-white" @click="hapusRedirect(r)">Hapus</button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

```

- [ ] **Step 8: The add/edit modal**

Insert directly **before** the line `  {{-- ═══ LOG WAKTU SESI ═══`. Modals live outside `.anim-up` on purpose: a transformed ancestor would trap the `position:fixed` overlay.

```blade
  {{-- ═══ ATURAN REDIRECT (super saja) ═══ --}}
  <template x-if="rdForm">
    <div class="modal-overlay" @click="rdForm = null" @keydown.escape.window="rdForm = null">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Aturan Redirect" x-trap="!!rdForm" @click.stop style="max-width:560px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:22px 24px;border-bottom:1px solid #ECEEF3">
          <div style="font-size:18px;font-weight:800;color:#1E2236" x-text="rdForm.id ? 'Ubah Aturan Redirect' : 'Tambah Aturan Redirect'"></div>
          <button type="button" aria-label="Tutup" @click="rdForm = null" style="border:none;width:32px;height:32px;flex:none;border-radius:9px;background:#F4F5F9;color:#6B7186;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px">×</button>
        </div>
        <form @submit.prevent="simpanRedirect()" style="padding:18px 24px 24px">
          <div x-show="rdFormErrors.umum" style="margin-bottom:12px;background:#FCE9E7;color:#D7453B;font-size:12.5px;font-weight:600;padding:10px 14px;border-radius:11px" x-text="rdFormErrors.umum"></div>

          <label class="lbl">Sumber</label>
          <input class="inp inp-blue" x-model="rdForm.source" placeholder="/appointment-nama-psikolog" required>
          <div style="font-size:11.5px;color:#8A90A6;margin-top:4px">Alamat di domain ini, diawali "/". Boleh satu * sebagai pola, mis. /appointment-*</div>
          <div x-show="rdFormErrors.source" style="font-size:12px;color:#D7453B;margin-top:4px" x-text="rdFormErrors.source"></div>

          <label class="lbl" style="margin-top:14px">Tujuan</label>
          <input class="inp inp-blue" x-model="rdForm.destination" placeholder="/nama-psikolog atau https://…" required>
          <div style="font-size:11.5px;color:#8A90A6;margin-top:4px">Alamat di domain ini atau URL lengkap. Kalau sumbernya memakai *, tulis * di sini untuk menyalin bagian yang tertangkap.</div>
          <div x-show="rdFormErrors.destination" style="font-size:12px;color:#D7453B;margin-top:4px" x-text="rdFormErrors.destination"></div>

          <label class="lbl" style="margin-top:14px">Jenis</label>
          <select class="inp-sm inp-blue" x-model.number="rdForm.status_code">
            <option value="302">302 — sementara (disarankan)</option>
            <option value="301">301 — permanen, disimpan browser</option>
          </select>
          <div x-show="rdFormErrors.status_code" style="font-size:12px;color:#D7453B;margin-top:4px" x-text="rdFormErrors.status_code"></div>

          <label class="lbl" style="margin-top:14px">Catatan</label>
          <input class="inp inp-blue" x-model="rdForm.note" placeholder="opsional">
          <div x-show="rdFormErrors.note" style="font-size:12px;color:#D7453B;margin-top:4px" x-text="rdFormErrors.note"></div>

          <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#42496B">
            <input type="checkbox" x-model="rdForm.active"> Aktif
          </label>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
            <button type="button" class="btn-white" @click="rdForm = null">Batal</button>
            <button type="submit" class="btn-blue" :disabled="rdSaving" x-text="rdSaving ? 'Menyimpan…' : 'Simpan'"></button>
          </div>
        </form>
      </div>
    </div>
  </template>

```

- [ ] **Step 9: Run the menu test and the existing dashboard tests**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'RedirectMenuTest|LogViewerTest|DeadFeatureAuditTest|DashboardKartuTest|FokusModalTest'`

Expected: OK.

- [ ] **Step 10: Lint the compiled Blade, as the deploy workflow does**

Run:

```bash
DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php artisan view:cache >/dev/null && fail=0; for f in storage/framework/views/*.php; do php -l "$f" >/dev/null || { php -l "$f"; fail=1; }; done; php artisan view:clear >/dev/null; exit $fail'
```

Expected: exit code 0 and no output.

- [ ] **Step 11: Commit**

```bash
git add resources/views/dashboard.blade.php tests/Feature/RedirectMenuTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(redirect): halaman Settings → Redirect di dashboard super admin

Tabel aturan (sumber, tujuan, kode, aktif, jumlah dipakai, catatan),
modal tambah/ubah dengan pilihan 302/301, sakelar aktif, hapus, dan
kotak Uji URL. Menu hanya untuk super; state berawalan rd supaya tidak
bertabrakan dengan kunci lain di dashApp().

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Legacy WordPress links, as a data migration

**Files:**
- Create: `database/migrations/2026_10_13_100001_seed_legacy_wp_redirects.php`
- Test: `tests/Feature/RedirectLinkLamaTest.php`

**Interfaces:**
- Consumes: the `redirect_rules` table (Task 1) and the 404 hook (Task 2).

**How the mapping was built (2026-10-13):**
- Each old WP page `appointment-*` on `api-appointment.praktiqu.com` carries `data-doctor-id` and `data-clinic-id` in its KiviCare widget. Three pages had the malformed attribute `data-clinic-id="40doctor_id=565"`; their doctor id comes from that string.
- Each doctor id was matched to `fullName` in `https://endpoint.praktiqu.com/api/v1/public/professionals` and turned into an FE slug with `BookingApi::slugify`.
- Every destination below answered **200** on `https://appointment.praktiqu.com` that day.
- `appointment-azanidianda-com` goes to the clinic page `/azanidianda-com`, because its slug names the clinic; this is the user's own example. Every other page goes to the psychologist's personal link.

**Left out on purpose, pending the user's decision:**
- `/appointment`, `/appointment-2`, `/appointment-4` — generic pages.
- `/appointment-nama-professional` — a template page; its doctor 87 is "mutiara pertiwi".
- `/appointment-oktober-sehat-mental` — a campaign page; clinic 32 is not public.
- `/appointment-ais-naris-m-psi-psikolog` — doctor 61 is now named "Trial - Ais".

The admin can add any of these from the dashboard.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/RedirectLinkLamaTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Models\RedirectRule;
use App\Services\RedirectMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Tautan booking WordPress lama terisi otomatis lewat migration. */
class RedirectLinkLamaTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = '2026_10_13_100001_seed_legacy_wp_redirects.php';

    public function test_dua_puluh_tautan_lama_terisi_dan_bentuknya_sah(): void
    {
        $lama = RedirectRule::where('note', 'Link WordPress lama')->get();

        $this->assertCount(20, $lama);
        foreach ($lama as $r) {
            $this->assertSame(RedirectMatcher::normalize($r->source), $r->source);
            $this->assertStringStartsWith('/appointment-', $r->source);
            $this->assertMatchesRegularExpression('#\A/[a-z0-9-]+\z#', $r->destination);
            $this->assertSame(302, $r->status_code);
            $this->assertTrue($r->active);
        }

        $this->assertSame('/azanidianda-com', RedirectRule::where('source', '/appointment-azanidianda-com')->value('destination'));
    }

    public function test_tautan_lama_dialihkan_ujung_ke_ujung(): void
    {
        Http::fake([
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 4, 'name' => 'AzaniDianda.com']]], 200),
            '*/api/v1/public/professionals/by-slug/*' => Http::response(['status' => 404], 404),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 33, 'fullName' => 'Debi Amelia Rachmawati']]], 200),
        ]);

        $this->get('/appointment-debi-amelia')->assertStatus(302)->assertRedirect('/debi-amelia-rachmawati');
    }

    public function test_aturan_buatan_admin_tidak_ditimpa_saat_migration_dijalankan_ulang(): void
    {
        RedirectRule::where('source', '/appointment-azanidianda-com')->update(['destination' => '/pilihan-admin']);

        // Lewat Migrator::resolvePath, bukan `require` ulang: berkas migration
        // anonim yang di-require dua kali bisa berakhir "Cannot declare class".
        // resolvePath memakai salinan yang sudah dimuat saat migrate tadi.
        $migrator = app('migrator');
        $migration = (fn (string $p) => $this->resolvePath($p))
            ->call($migrator, database_path('migrations/'.self::MIGRATION));
        $migration->up();

        $this->assertSame('/pilihan-admin', RedirectRule::where('source', '/appointment-azanidianda-com')->value('destination'));
        $this->assertCount(20, RedirectRule::where('note', 'Link WordPress lama')->get());
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectLinkLamaTest.php`

Expected:
- `test_dua_puluh_…` FAILS with `Failed asserting that actual size 0 matches expected size 20`;
- the end-to-end test FAILS with 404.

- [ ] **Step 3: Write the data migration**

Create `database/migrations/2026_10_13_100001_seed_legacy_wp_redirects.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Tautan booking WordPress lama → halaman booking barunya.
//
// Domain ini dulu situs WordPress, dan setiap psikolog punya halaman KiviCare
// /appointment-<nama> yang sudah tersebar di WhatsApp, bio Instagram, dan
// kartu nama. Sejak domainnya pindah ke aplikasi ini semuanya 404.
//
// Pemetaannya dari id, bukan tebakan nama: setiap halaman lama menyimpan
// data-doctor-id dan data-clinic-id di widget KiviCare-nya, dan id itu
// dicocokkan dengan /api/v1/public/professionals pada 13 Okt 2026. Setiap
// tujuan sudah dibuka hari itu dan menjawab 200. Halaman yang slug-nya nama
// klinik (azanidianda-com) ke halaman klinik; selebihnya ke tautan pribadi
// psikolognya.
//
// Lewat migration, bukan seeder: deploy hanya menjalankan `migrate --force`.
// insertOrIgnore — aturan yang sudah dibuat admin untuk sumber yang sama tidak
// pernah ditimpa. Setelah ini semuanya bisa diubah dari dashboard.
//
// BELUM dimasukkan, menunggu keputusan pemilik produk: /appointment,
// /appointment-2, /appointment-4 (halaman umum), /appointment-nama-professional
// (halaman templat), /appointment-oktober-sehat-mental (kampanye, kliniknya
// tidak publik), /appointment-ais-naris-m-psi-psikolog (akunnya kini bernama
// "Trial - Ais"). Bisa ditambahkan dari dashboard.
return new class extends Migration
{
    private const CATATAN = 'Link WordPress lama';

    private const PETA = [
        '/appointment-azanidianda-com' => '/azanidianda-com',
        '/appointment-debi-amelia' => '/debi-amelia-rachmawati',
        '/appointment-siti-maulany-s-psi' => '/siti-maulany-s-psi',
        '/appointment-hira-yuki-molira-m-psi-psikolog' => '/hira-yuki-molira',
        '/appointment-pamela-anggia-dewi-m-psi-psikolog' => '/pamela-anggia-dewi-m-psi-psikolog',
        '/appointment-indriyani-virginia-m-psi-psikolog' => '/indriyani-virginia-m-psi-psikolog',
        '/appointment-sulistyorini-s-psi-m-mhr' => '/sulistyorini-s-psi-m-m-hr',
        '/appointment-joseline-bernadine' => '/joseline-bernadine',
        '/appointment-dimas-danang' => '/dimas-danang-waskita-putera-s-psi-m-psi-psikolog',
        '/appointment-psikolog-berlian-linangkung' => '/berlian-linangkung-m-psi-psikolog',
        '/appointment-psikolog-roellya' => '/roellya-a-m-psi-psikolog-lcpc-cht',
        '/appointment-psikolog-agitya-yanifa' => '/agitya-y-putri-m-psi-psikolog',
        '/appointment-fridya-mayasari' => '/fridya-mayasari',
        '/appointment-psikolog-luluk-alfiya' => '/luluk-alfiya-m-psi-psikolog',
        '/appointment-psikolog-catur-wahyuti' => '/catur-wahyuti-s-psi-m-psi-psikolog',
        '/appointment-psikolog-fauzia-wati' => '/fauzia-wati-s-psi-m-psi-psikolog',
        '/appointment-psikolog-eko-yanita' => '/eko-yanita-h-m-psi-psikolog',
        '/appointment-psikolog-andi-zainuddin' => '/andi-zainuddin-japeri-m-psi-psikolog',
        '/appointment-psikolog-surayya-sakinah' => '/surayya-sakinah-s-psi-m-psi-psikolog',
        '/appointment-terapis-karinka-ngabito' => '/karinka-ngabito-m-psi',
    ];

    public function up(): void
    {
        $sekarang = now();

        DB::table('redirect_rules')->insertOrIgnore(array_map(
            fn (string $dari, string $ke) => [
                'source' => $dari,
                'destination' => $ke,
                'status_code' => 302,
                'active' => true,
                'note' => self::CATATAN,
                'hits' => 0,
                'created_at' => $sekarang,
                'updated_at' => $sekarang,
            ],
            array_keys(self::PETA),
            self::PETA,
        ));
    }

    public function down(): void
    {
        DB::table('redirect_rules')
            ->whereIn('source', array_keys(self::PETA))
            ->where('note', self::CATATAN)
            ->delete();
    }
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit tests/Feature/RedirectLinkLamaTest.php`

Expected: `OK (3 tests, …)`.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/2026_10_13_100001_seed_legacy_wp_redirects.php tests/Feature/RedirectLinkLamaTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "$(cat <<'EOF'
feat(redirect): 20 tautan booking WordPress lama dialihkan otomatis

/appointment-<nama> dari situs WordPress lama dipetakan lewat
data-doctor-id di widget KiviCare tiap halaman ke tautan pribadi
psikolognya (azanidianda-com ke halaman klinik). Semua tujuan menjawab
200 pada 13 Okt 2026. insertOrIgnore: aturan buatan admin tidak ditimpa.
Enam halaman umum/templat sengaja belum dimasukkan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full suite, push, PR link

**Files:** none new.

- [ ] **Step 1: Run the whole FE test suite**

Run: `DOCKER_CONFIG=/home/ahmad/projects/praktiqu-fe/.dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`

Expected: OK, all tests passing.

If an existing test now fails, read it before changing anything. The likely cause is a test that requests a path inside the legacy map and expects 404. Fix it by choosing a different path in that test, never by removing a legacy row.

- [ ] **Step 2: Push the branch**

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/aturan-redirect
```

Expected: `* [new branch] feat/aturan-redirect -> feat/aturan-redirect`.

- [ ] **Step 3: Hand the user the PR link and the pending decisions**

There is no `gh` CLI on this machine, so give the user the prefilled compare link instead of opening a PR:
`https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/aturan-redirect?expand=1`

Put this PR body in the message, ending with the attribution line:

```markdown
## Ringkasan
Super Admin bisa membuat aturan redirect dari dashboard (Settings → Redirect). Aturannya hanya
dipakai saat sebuah alamat 404, jadi halaman yang hidup tidak pernah tertimpa. Tautan booking
WordPress lama `/appointment-<nama>` — 404 sejak domain ini pindah ke Laravel — 20 di antaranya
sudah terisi otomatis.

- Pencocokan: path persis + satu wildcard `*` (`/appointment-*` → `/*`), tanpa regex buatan pengguna
- Tujuan: path internal atau URL http(s); `javascript:`, `//host`, `/\host` ditolak
- Kode 302 (bawaan) atau 301 per aturan; query string pengunjung ikut dibawa
- Ditolak saat simpan: halaman sistem sebagai sumber, redirect berputar, rantai > 5 lompatan
- Jumlah dipakai + terakhir dipakai per aturan; kotak "Uji URL" melaporkan apa yang benar-benar didapat pengunjung
- Tabel rusak → tetap 404, bukan 500

## Setelah merge
`migrate --force` di workflow deploy membuat tabel `redirect_rules` dan mengisi 20 tautan lama.

## Tes
`php vendor/bin/phpunit` hijau; Blade terkompilasi lolos `php -l`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Also give the user:
- **The six unmapped legacy pages** listed in Task 5, so they can decide where each goes.
- **A note that the dashboard page has not been clicked through in a real browser.** Logging into the dashboard needs a live backend session. After deploy, they should open Settings → Redirect as super admin and try `/appointment-debi-amelia` in "Uji URL".
