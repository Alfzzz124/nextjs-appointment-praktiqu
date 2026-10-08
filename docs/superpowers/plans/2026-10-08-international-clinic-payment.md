# International Clinic Payment Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each KiviCare clinic an International flag that unlocks PayPal and card (USD). Each clinic has its own rate, percentage markup and fixed rupiah fee, edited from the Laravel FE. International clinics show USD prices from the first render.

**Architecture:**

- **Storage.** One `wp_options` row per clinic holds the settings, as a JSON string. The `praktiqu-endpoint` plugin writes it; Next.js reads it.
- **Conversion.** Next.js is the only place that converts rupiah to USD, in the pure module `intl-pricing.ts`. The catalogue display and the charge use the same function. The plugin builds the WooCommerce order from the finished USD lines, re-checks the clinic flag, and verifies the WooCommerce total before calling PayPal.
- **FE.** The Laravel FE gets a settings page and renders USD prices. It only shows backend-supplied amounts and methods and never converts.

**Tech Stack:**

- WordPress plugin: PHP 8.4, WooCommerce, PPCP. Tests are plain PHP scripts run in Docker.
- Next.js 14 App Router: TypeScript, Prisma (`Prisma.Decimal`), zod, vitest.
- Laravel FE: PHP 8.4, Blade, PHPUnit run in Docker.

**Spec:** `docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md` (commit 773316f). Read it before any task.

## Global Constraints

- **Database:** never run `prisma db push`, `prisma migrate dev` or any DDL. `DATABASE_URL` is the WordPress database. This feature adds no table, no column and no Prisma model.
- **Option name:** `praktiqu_endpoint_clinic_{clinicId}_payment`, autoload `no`.
- **Option value:** a JSON string with snake_case keys `international`, `fx_rate`, `markup_percent`, `fixed_fee_idr`, `updated_at`, `updated_by`. Never a PHP array.
- **Ranges:**
  - rate 1,000–100,000 rupiah per 1 USD, ≤ 2 decimals. This range applies to the clinic rate and to the global fallback, on write and on read.
  - markup 0–100, ≤ 2 decimals.
  - fixed fee: integer 0–10,000,000.
- **Rounding:** `cents = ceil(idr × (100 + markup) / rate)` per item or tax line. Fee line: `ceil(feeIdr × 100 / rate)`, no markup, named exactly `International service fee`. Multiply first, then one division, then ceil, all with `Prisma.Decimal`.
- **Gate order** (for paypal/card on new orders only):
  1. settings read error → 503 `payment_settings_unavailable`
  2. not international, or a free order → 403 `payment_method_not_allowed`
  3. no usable rate → 503 `paypal_rate_missing`
- **Never 409** for `payment_method_not_allowed`. The live FE reads a 409 on `/public/payments` as "payment pending".
- **Xendit is unchanged** for every clinic: rupiah, no markup, no fee.
- **Plugin version:** 1.6.8 → 1.7.0.
- **Laravel FE:** work on branch `feat/klinik-internasional` and open a PR. Never push to `main`, which auto-deploys terpadu.praktiqu.com.
- **Rollout:** deploy the plugin first, then Next.js, then the FE. Do not deploy anything from this plan; deployment follows `docs/deploy/international-clinic-runbook.md` (Task B9) with the user present.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never revert, stash or delete a file you did not create.** If `git status --short` shows anything the task did not expect, stop and report BLOCKED. Never use `git add -A` or `git add .`: the `node_modules` symlink from B0 must not be committed.

## Execution notes

- **Model:** implementer and reviewer subagents run on **Sonnet 5.5**, at the user's request (2026-10-07).
- **Order:** A0–A4 (plugin) → B0–B9 (Next.js) → C0–C4 (FE). Inside each part, tasks are sequential. Part C depends only on the JSON contract, so it may start once B8 is merged into the branch.
- **Two repositories:** Parts A and B run in `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional`. Part C runs in `/home/ahmad/projects/praktiqu-fe/klinik-internasional`, created in Task C0.
- **Clean start:** the spec revision and this plan are committed before Task A0, and the temporary `.plan-wip/` folder is removed. `git status --short` is then empty, which is what A0 and B0 expect.
- **Possible overlap:** a separate branch, `fix/payment-verify-clinic-scope`, touches `src/app/api/v1/sessions/payment-verify/route.ts` and `ensureSessionPayment`. If it lands on `main` first, rebase before B4/B5.

## Task index

**Part A — WordPress plugin `praktiqu-endpoint`**
- Task A0: Setup plugin tests — Docker empty config and a green baseline
- Task A1: ClinicPaymentSettings — per-clinic option (validate / encode / decode + WP get / save / clinic_exists)
- Task A2: REST GET/PUT `/clinics/{id}/payment-settings`, global-default rate range and labels, uninstall cleanup
- Task A3: ChargeValidator — the USD `charge` object, in integer cents
- Task A4: `create_order` charge path, `/payments/order` args, version 1.7.0

**Part B1 — Next.js: pricing and payment flow**
- Task B0: Setup worktree Next.js — symlink node_modules dan baseline hijau
- Task B1: Modul harga USD murni — `intl-pricing.ts`
- Task B2: Baca pengaturan klinik dari `wp_options` — repo, `clinic-payment.service`, `public-usd.service`
- Task B3: Klien plugin — `charge` USD, `WpEndpointError.code`, `putClinicPaymentSettings`, `toCharge`
- Task B4: Error berkode untuk kedua route bayar — `badGateway`, `payment-errors.ts`, wiring route, OpenAPI
- Task B5: Gerbang klinik internasional + backstop di `initiatePublicPayment` dan `ensureSessionPayment`

**Part B2 — Next.js: settings API, additive fields, docs**
- Task B6: Layanan pengaturan pembayaran klinik — `payment-settings.service.ts`
- Task B7: Route `GET`/`PUT /api/v1/practices/{id}/payment-settings`
- Task B8: Field tambahan — `international`, `paymentMethods`, `usd`, `clinicId` di practices, katalog publik dan booking publik
- Task B9: Dokumentasi — OpenAPI Next.js, rute plugin di OpenAPI root, dua panduan FE, runbook deploy

**Part C — Laravel FE (`raakanaka/laravel-praktiqu`)**
- Task C0: Setup worktree FE — branch `feat/klinik-internasional`, vendor, `.env` sementara, baseline hijau
- Task C1: `canManageClinicPayment` di profil sesi — dihitung dari role mentah saat login
- Task C2: Halaman pengaturan pembayaran internasional klinik — controller, view, route, pintu masuk dashboard
- Task C3: Booking ke klinik yang harganya ditampilkan — layanan per klinik, `clinicId` ke slots & submit, `paymentMethods`/`usd`, kode galat bayar
- Task C4: Tampilan USD di halaman booking — harga utama USD, metode per baris, ringkasan USD, pil dari jawaban submit

---

## Part A — WordPress plugin `praktiqu-endpoint`

### Task A0: Setup plugin tests — Docker empty config and a green baseline

**Files:**
- Create: `/tmp/dockercfg/config.json` (an empty Docker client config, outside the repository; never committed)
- Modify: no tracked file.

**Interfaces:** Consumes: nothing. / Produces: `/tmp/dockercfg/config.json` containing `{}`, which every later `docker run` in Tasks A1–A4 passes as `DOCKER_CONFIG=/tmp/dockercfg`, and a confirmed-green baseline of the four existing plugin tests. Never touch a database or a remote server in this task.

- [ ] **Step 1: Create the empty Docker config**

The Docker credential helper on this machine is broken, so every `docker run` uses an empty config dir.

```bash
mkdir -p /tmp/dockercfg && [ -f /tmp/dockercfg/config.json ] || echo '{}' > /tmp/dockercfg/config.json
cat /tmp/dockercfg/config.json
DOCKER_CONFIG=/tmp/dockercfg docker run --rm php:8.4-cli php -r 'echo PHP_VERSION, PHP_EOL;'
```

Expected: `{}` (or an existing config the file already held), then a version starting with `8.4.`. If the image is missing, `docker run` pulls it first (a few hundred MB).

- [ ] **Step 2: Confirm the existing plugin tests pass (baseline)**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && for t in tests/test-*.php; do printf '%s: ' "$t"; DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php "$t" | tail -1; done
```

Expected: four lines, each ending in `ALL PASS` (`test-jobs-secret-sanitizer.php`, `test-jobs-webhook.php`, `test-money.php`, `test-service-authenticate.php`). If any fails, stop and report — the baseline is broken.

- [ ] **Step 3: Confirm the branch and a clean tree**

```bash
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional branch --show-current
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short -- Wordpress-Plugin
```

Expected: `feat/klinik-internasional`, then nothing under `Wordpress-Plugin/`.

- [ ] **Step 4: Nothing to commit**

This task changes no tracked file.

---

### Task A1: ClinicPaymentSettings — per-clinic option (validate / encode / decode + WP get / save / clinic_exists)

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-payment-settings.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (line 31, the `require_once` list)

All paths are relative to the BE worktree `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional`. Plugin tests are plain PHP scripts (no PHPUnit, no WordPress) run in Docker; WordPress functions the class touches are shimmed inside the test file, the same way `tests/test-service-authenticate.php` already does it. Never touch a database or a remote server in this task.

**Interfaces:**
- Consumes: Task A0 (`/tmp/dockercfg/config.json`, green baseline). At runtime: WordPress `get_option()`, `update_option()`, `wp_json_encode()` (optional), global `$wpdb`.
- Produces (namespace `PraktiQU\Endpoint`, `declare(strict_types=1)`), `final class ClinicPaymentSettings`:
  - `const OPTION_PREFIX = 'praktiqu_endpoint_clinic_'; const OPTION_SUFFIX = '_payment';`
  - `const RATE_MIN = 1000.0; const RATE_MAX = 100000.0; const MARKUP_MAX = 100.0; const FEE_MAX = 10000000;`
  - `const GLOBAL_RATE_OPTION = 'praktiqu_endpoint_paypal_idr_rate';`
  - `public static function option_name(int $clinic_id): string;` → `'praktiqu_endpoint_clinic_4_payment'`
  - `public static function is_usable_rate(mixed $v): bool;` → numeric && RATE_MIN <= v <= RATE_MAX, where "numeric" is an int/float, or a string that after `trim()` is plain decimal text `/^\d+(\.\d+)?$/D` — exactly the text Next.js `parseOptionNumber` (`intl-pricing.ts`) accepts, so `"1.8e4"` / `"18000."` are unusable on both sides (PHP `is_numeric()` would accept them)
  - `public static function validate(array $input, mixed $global_rate): array;` → `['ok'=>true,'data'=>['international'=>bool,'fx_rate'=>?float,'markup_percent'=>?float,'fixed_fee_idr'=>?int,'updated_by'=>?int]]` or `['ok'=>false,'code'=>'invalid_settings'|'fx_rate_required','message'=>string,'field'=>?string]`
  - `public static function encode(array $data, string $updated_at): string;` (JSON object string, keys in order international, fx_rate, markup_percent, fixed_fee_idr, updated_at, updated_by)
  - `public static function decode(mixed $raw): ?array;` (null unless `$raw` is a string holding a JSON object; a PHP array => null)
  - `public static function get(int $clinic_id): ?array;`
  - `public static function save(int $clinic_id, array $data): bool;` (`update_option(name, encode(data, gmdate('c')), false)`; an identical re-save is true)
  - `public static function clinic_exists(int $clinic_id): bool;` (`$wpdb->get_var` on `{$wpdb->prefix}kc_clinics`)

Every `docker run` below passes `DOCKER_CONFIG=/tmp/dockercfg` (created in Task A0; if it is missing, run `mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json` first).

- [ ] **Step 1: Write the failing test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings.php` with exactly this content:

```php
<?php
/**
 * Assertions for ClinicPaymentSettings. Plain PHP — no PHPUnit, no WordPress — so it runs
 * in a bare `php:8.4-cli` container, same as tests/test-money.php.
 *
 * validate(), encode() and decode() are pure and are called directly. get(), save() and
 * clinic_exists() are WordPress-backed, so this harness shims exactly what they touch:
 *   - get_option()/update_option() over a plain array, with update_option()'s real
 *     contract (returns false, writing nothing, when the value is unchanged);
 *   - a fake $wpdb with prepare()/get_var() over a list of clinic ids;
 *   - gmdate() inside the plugin's namespace, so save()'s timestamp is frozen and an
 *     identical re-save is deterministic. An unqualified gmdate() call in namespace
 *     PraktiQU\Endpoint resolves to this function before the global one.
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint {
    function gmdate(string $format, ?int $timestamp = null): string
    {
        return $GLOBALS['__praktiqu_frozen_now'] ?? \gmdate($format, $timestamp ?? time());
    }
}

namespace {
    use PraktiQU\Endpoint\ClinicPaymentSettings as S;

    define('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST', true);

    $GLOBALS['__praktiqu_test_options']  = [];
    $GLOBALS['__praktiqu_test_autoload'] = [];
    $GLOBALS['__praktiqu_update_broken'] = false;

    function get_option(string $name, $default = false)
    {
        return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            ? $GLOBALS['__praktiqu_test_options'][$name]
            : $default;
    }

    function update_option(string $name, $value, $autoload = null): bool
    {
        if ($GLOBALS['__praktiqu_update_broken']) {
            return false; // a database failure: nothing written
        }
        if (array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            && $GLOBALS['__praktiqu_test_options'][$name] === $value) {
            return false; // WordPress: unchanged value, nothing written
        }
        $GLOBALS['__praktiqu_test_options'][$name]  = $value;
        $GLOBALS['__praktiqu_test_autoload'][$name] = $autoload;
        return true;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';
        /** @var list<int> */
        public array $clinic_ids = [4, 7];
        /** @var list<string> */
        public array $queries = [];

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query)
        {
            $this->queries[] = $query;
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) === 1) {
                return in_array((int) $m[1], $this->clinic_ids, true) ? $m[1] : null;
            }
            return null;
        }
    }

    $wpdb = new FakeWpdb();

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';

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

    /** A complete, valid PUT body; each case overrides one key. */
    function body(array $override = []): array
    {
        return array_merge([
            'international'  => true,
            'fx_rate'        => 16500,
            'markup_percent' => 10,
            'fixed_fee_idr'  => 25000,
            'updated_by'     => 123,
        ], $override);
    }

    /** [code, field] of a failed validate(), or 'ok'. */
    function outcome(array $result)
    {
        return $result['ok'] ? 'ok' : [$result['code'], $result['field']];
    }

    echo "ClinicPaymentSettings::option_name\n";
    check('clinic 4', S::option_name(4), 'praktiqu_endpoint_clinic_4_payment');

    echo "\nClinicPaymentSettings::is_usable_rate\n";
    check('16500 int', S::is_usable_rate(16500), true);
    check('"18000" (how the global option is stored)', S::is_usable_rate('18000'), true);
    check('lower bound 1000', S::is_usable_rate(1000), true);
    check('upper bound 100000', S::is_usable_rate(100000.0), true);
    check('16.5 ("16.500" read as 16.5)', S::is_usable_rate(16.5), false);
    check('500000', S::is_usable_rate(500000), false);
    check('0.00006 (inverted)', S::is_usable_rate(0.00006), false);
    check('empty string (option unset)', S::is_usable_rate(''), false);
    check('null', S::is_usable_rate(null), false);
    check('true', S::is_usable_rate(true), false);
    // The string rule is Next.js parseOptionNumber's: plain digits, optional decimal part.
    // is_numeric() would accept the next two, which Next.js reads as "not set".
    check('"1.8e4" (exponent notation)', S::is_usable_rate('1.8e4'), false);
    check('"18000." (trailing dot)', S::is_usable_rate('18000.'), false);
    check('" 18000 " (trimmed, as Next.js trims)', S::is_usable_rate(' 18000 '), true);

    echo "\nClinicPaymentSettings::validate accepts\n";
    $ok = S::validate(body(), '');
    check('the §1 example, no global rate needed', outcome($ok), 'ok');
    check('normalised data', $ok['data'], [
        'international'  => true,
        'fx_rate'        => 16500.0,
        'markup_percent' => 10.0,
        'fixed_fee_idr'  => 25000,
        'updated_by'     => 123,
    ]);
    check('2-decimal rate and markup', outcome(S::validate(body(['fx_rate' => 16500.25, 'markup_percent' => 1.1]), '')), 'ok');
    check('all-null fields, not international', outcome(S::validate(body([
        'international' => false, 'fx_rate' => null, 'markup_percent' => null, 'fixed_fee_idr' => null, 'updated_by' => null,
    ]), '')), 'ok');
    check('international with a null rate falls back to a usable global rate', outcome(S::validate(body(['fx_rate' => null]), '18000')), 'ok');
    check('fee 0 and markup 0', outcome(S::validate(body(['fixed_fee_idr' => 0, 'markup_percent' => 0]), '')), 'ok');
    check('not international: a null rate is not required', outcome(S::validate(body(['international' => false, 'fx_rate' => null]), '')), 'ok');

    echo "\nClinicPaymentSettings::validate rejects\n";
    $missing = body();
    unset($missing['updated_by']);
    check('a missing key', outcome(S::validate($missing, '')), ['invalid_settings', 'updated_by']);
    check('international as a string', outcome(S::validate(body(['international' => 'true']), '')), ['invalid_settings', 'international']);
    check('international as 1', outcome(S::validate(body(['international' => 1]), '')), ['invalid_settings', 'international']);
    check('fx_rate below 1000', outcome(S::validate(body(['fx_rate' => 999.99]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate 16.5', outcome(S::validate(body(['fx_rate' => 16.5]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate above 100000', outcome(S::validate(body(['fx_rate' => 100000.01]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate with 3 decimals', outcome(S::validate(body(['fx_rate' => 16500.255]), '')), ['invalid_settings', 'fx_rate']);
    check('fx_rate as a numeric string', outcome(S::validate(body(['fx_rate' => '16500']), '')), ['invalid_settings', 'fx_rate']);
    check('markup -1', outcome(S::validate(body(['markup_percent' => -1]), '')), ['invalid_settings', 'markup_percent']);
    check('markup 100.5', outcome(S::validate(body(['markup_percent' => 100.5]), '')), ['invalid_settings', 'markup_percent']);
    check('markup with 3 decimals', outcome(S::validate(body(['markup_percent' => 1.125]), '')), ['invalid_settings', 'markup_percent']);
    check('fee as a float', outcome(S::validate(body(['fixed_fee_idr' => 25000.5]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('fee negative', outcome(S::validate(body(['fixed_fee_idr' => -1]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('fee above 10,000,000', outcome(S::validate(body(['fixed_fee_idr' => 10000001]), '')), ['invalid_settings', 'fixed_fee_idr']);
    check('updated_by 0', outcome(S::validate(body(['updated_by' => 0]), '')), ['invalid_settings', 'updated_by']);
    check('updated_by as a string', outcome(S::validate(body(['updated_by' => '123']), '')), ['invalid_settings', 'updated_by']);
    check('international, no clinic rate, no global rate', outcome(S::validate(body(['fx_rate' => null]), '')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate out of range', outcome(S::validate(body(['fx_rate' => null]), '500000')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate 16.5', outcome(S::validate(body(['fx_rate' => null]), '16.5')), ['fx_rate_required', 'fx_rate']);
    check('international, no clinic rate, global rate "1.8e4" (Next.js reads it as unset)', outcome(S::validate(body(['fx_rate' => null]), '1.8e4')), ['fx_rate_required', 'fx_rate']);
    check('a field error wins over fx_rate_required', outcome(S::validate(body(['fx_rate' => null, 'markup_percent' => 150]), '')), ['invalid_settings', 'markup_percent']);

    echo "\nClinicPaymentSettings::encode\n";
    $json = S::encode($ok['data'], '2026-10-06T08:00:00+00:00');
    // This exact string is the shared fixture for the Next.js KcOption integration test.
    check('exact stored string', $json, '{"international":true,"fx_rate":16500,"markup_percent":10,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}');
    check('a JSON object, not serialized PHP', $json[0], '{');
    check('nulls stay JSON null', S::encode(['international' => false, 'fx_rate' => null, 'markup_percent' => null, 'fixed_fee_idr' => null, 'updated_by' => null], 'T'),
        '{"international":false,"fx_rate":null,"markup_percent":null,"fixed_fee_idr":null,"updated_at":"T","updated_by":null}');
    check('a 2-decimal rate keeps its decimals', S::encode(['international' => true, 'fx_rate' => 16500.25, 'markup_percent' => 1.1, 'fixed_fee_idr' => 0, 'updated_by' => null], 'T'),
        '{"international":true,"fx_rate":16500.25,"markup_percent":1.1,"fixed_fee_idr":0,"updated_at":"T","updated_by":null}');

    echo "\nClinicPaymentSettings::decode\n";
    check('round trip', S::decode($json), [
        'international' => true, 'fx_rate' => 16500, 'markup_percent' => 10, 'fixed_fee_idr' => 25000,
        'updated_at' => '2026-10-06T08:00:00+00:00', 'updated_by' => 123,
    ]);
    check('empty string (option absent)', S::decode(''), null);
    check('false (get_option miss)', S::decode(false), null);
    check('a PHP array (get_option of a serialized value)', S::decode(['international' => true]), null);
    check('serialized text', S::decode('a:1:{s:13:"international";b:1;}'), null);
    check('malformed JSON', S::decode('{"international":'), null);
    check('a JSON list is not an object', S::decode('[true]'), null);
    check('a JSON scalar', S::decode('true'), null);
    check('surrounding whitespace is tolerated', S::decode("  {\"international\":false}\n"), ['international' => false]);

    echo "\nClinicPaymentSettings::save / get (shimmed options)\n";
    $GLOBALS['__praktiqu_frozen_now'] = '2026-10-06T08:00:00+00:00';
    check('get on an absent option is null', S::get(4), null);
    check('first save succeeds', S::save(4, $ok['data']), true);
    $stored = $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] ?? null;
    check('stores the encoded string under the clinic key', $stored, $json);
    check('stored value is a string json_decode accepts', is_array(json_decode((string) $stored, true)), true);
    check('autoload is off', $GLOBALS['__praktiqu_test_autoload']['praktiqu_endpoint_clinic_4_payment'] ?? 'unset', false);
    check('get decodes it', S::get(4)['fx_rate'] ?? null, 16500);
    check('identical re-save (update_option returns false) still succeeds', S::save(4, $ok['data']), true);
    $GLOBALS['__praktiqu_update_broken'] = true;
    $GLOBALS['__praktiqu_frozen_now'] = '2026-10-06T08:00:01+00:00';
    check('a failed write of a different value is a failure', S::save(4, $ok['data']), false);
    $GLOBALS['__praktiqu_update_broken'] = false;
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_7_payment'] = ['international' => true];
    check('get treats a serialized (array) value as absent', S::get(7), null);

    echo "\nClinicPaymentSettings::clinic_exists (fake \$wpdb)\n";
    check('existing clinic', S::clinic_exists(4), true);
    check('query reads the prefixed kc_clinics table', end($wpdb->queries), 'SELECT id FROM wp_kc_clinics WHERE id = 4 LIMIT 1');
    check('unknown clinic', S::clinic_exists(99), false);
    $before = count($wpdb->queries);
    check('id 0 is never a clinic', S::clinic_exists(0), false);
    check('id 0 runs no query', count($wpdb->queries), $before);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-clinic-payment-settings.php
```

Expected: FAIL with `Fatal error: Uncaught Error: Failed opening required '/app/tests/../includes/class-praktiqu-endpoint-clinic-payment-settings.php'` — the class file does not exist yet.

- [ ] **Step 3: Write the class**

Create `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-payment-settings.php` with exactly this content:

```php
<?php
/**
 * ClinicPaymentSettings — one clinic's international payment settings
 * (2026-10-06 international clinic payment design, §1 and §4).
 *
 * Stored as ONE wp_options row per clinic, `praktiqu_endpoint_clinic_{id}_payment`,
 * autoload off. The value is a JSON **string**, never a PHP array: WordPress would
 * maybe_serialize() an array into `a:6:{…}`, which Next.js (it reads the row through
 * the KcOption model and JSON.parse) cannot parse, and every clinic would silently
 * stop being international.
 *
 * validate(), encode() and decode() are pure, so tests/test-clinic-payment-settings.php
 * runs them in a bare PHP container — the same pattern, and the same reason, as Money.
 * get(), save() and clinic_exists() are the thin WordPress-backed wrappers.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// The test harness defines PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST so this file
// can be required outside WordPress. Everything else still exits without ABSPATH.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST') || exit;

final class ClinicPaymentSettings
{
    public const OPTION_PREFIX = 'praktiqu_endpoint_clinic_';
    public const OPTION_SUFFIX = '_payment';

    /** A usable rate is rupiah per 1 USD within this range, for the clinic and the global value alike. */
    public const RATE_MIN   = 1000.0;
    public const RATE_MAX   = 100000.0;
    public const MARKUP_MAX = 100.0;
    public const FEE_MAX    = 10000000;

    public const GLOBAL_RATE_OPTION = 'praktiqu_endpoint_paypal_idr_rate';

    public static function option_name(int $clinic_id): string
    {
        return self::OPTION_PREFIX . $clinic_id . self::OPTION_SUFFIX;
    }

    /**
     * A rate is usable when it is numeric and within RATE_MIN..RATE_MAX. The range rejects
     * an inverted or mistyped entry, such as 0.00006, or "16.500" read as 16.5.
     *
     * "Numeric" is an int/float, or a string that is plain decimal text after trim() — the
     * exact text Next.js accepts for the global option (parseOptionNumber in
     * intl-pricing.ts). is_numeric() is not used: it also passes "1.8e4" or "18000.", which
     * Next.js reads as "not set", and the two sides would then disagree on whether a usable
     * global rate exists (spec §1: one definition of a usable rate).
     */
    public static function is_usable_rate(mixed $v): bool
    {
        if (is_string($v)) {
            $text = trim($v);
            if (preg_match('/^\d+(\.\d+)?$/D', $text) !== 1) {
                return false;
            }
            $rate = (float) $text;
        } elseif (is_int($v) || is_float($v)) {
            $rate = (float) $v;
        } else {
            return false;
        }
        return $rate >= self::RATE_MIN && $rate <= self::RATE_MAX;
    }

    /**
     * Validate a PUT body (storage keys) against the §1 rules.
     *
     * Every key is required: a PUT replaces the clinic's whole object, so a missing key
     * is a client bug, not "leave unchanged". `fx_rate` / `markup_percent` must be JSON
     * numbers (never numeric strings), `fixed_fee_idr` and `updated_by` JSON integers.
     *
     * @param array<string, mixed> $input
     * @param mixed                $global_rate The raw global rate option ('' when unset).
     *
     * @return array{ok: true, data: array{international: bool, fx_rate: ?float, markup_percent: ?float, fixed_fee_idr: ?int, updated_by: ?int}}
     *        |array{ok: false, code: string, message: string, field: ?string}
     */
    public static function validate(array $input, mixed $global_rate): array
    {
        foreach (['international', 'fx_rate', 'markup_percent', 'fixed_fee_idr', 'updated_by'] as $key) {
            if (!array_key_exists($key, $input)) {
                return self::invalid($key, sprintf('%s is required', $key));
            }
        }

        $international = $input['international'];
        if (!is_bool($international)) {
            return self::invalid('international', 'international must be a boolean');
        }

        $fx_rate = $input['fx_rate'];
        if ($fx_rate !== null) {
            if (!self::is_number($fx_rate) || $fx_rate < self::RATE_MIN || $fx_rate > self::RATE_MAX || !self::has_at_most_2_decimals($fx_rate)) {
                return self::invalid('fx_rate', 'fx_rate must be null or a number from 1000 to 100000 with at most 2 decimals');
            }
            $fx_rate = (float) $fx_rate;
        }

        $markup = $input['markup_percent'];
        if ($markup !== null) {
            if (!self::is_number($markup) || $markup < 0 || $markup > self::MARKUP_MAX || !self::has_at_most_2_decimals($markup)) {
                return self::invalid('markup_percent', 'markup_percent must be null or a number from 0 to 100 with at most 2 decimals');
            }
            $markup = (float) $markup;
        }

        $fee = $input['fixed_fee_idr'];
        if ($fee !== null && (!is_int($fee) || $fee < 0 || $fee > self::FEE_MAX)) {
            return self::invalid('fixed_fee_idr', 'fixed_fee_idr must be null or an integer from 0 to 10000000');
        }

        $updated_by = $input['updated_by'];
        if ($updated_by !== null && (!is_int($updated_by) || $updated_by <= 0)) {
            return self::invalid('updated_by', 'updated_by must be null or a positive integer');
        }

        // Cross-field: an international clinic needs a usable rate, its own or the global one.
        // A non-null clinic fx_rate is already in range here, so it is usable by construction.
        if ($international && $fx_rate === null && !self::is_usable_rate($global_rate)) {
            return [
                'ok'      => false,
                'code'    => 'fx_rate_required',
                'message' => 'An international clinic needs an FX rate: set fx_rate, or set a global rate from 1000 to 100000',
                'field'   => 'fx_rate',
            ];
        }

        return [
            'ok'   => true,
            'data' => [
                'international'  => $international,
                'fx_rate'        => $fx_rate,
                'markup_percent' => $markup,
                'fixed_fee_idr'  => $fee,
                'updated_by'     => $updated_by,
            ],
        ];
    }

    /**
     * The stored JSON string, keys in the §1 order, with updated_at stamped in.
     *
     * @param array<string, mixed> $data validate()'s `data`.
     */
    public static function encode(array $data, string $updated_at): string
    {
        $payload = [
            'international'  => (bool) ($data['international'] ?? false),
            'fx_rate'        => $data['fx_rate'] ?? null,
            'markup_percent' => $data['markup_percent'] ?? null,
            'fixed_fee_idr'  => $data['fixed_fee_idr'] ?? null,
            'updated_at'     => $updated_at,
            'updated_by'     => $data['updated_by'] ?? null,
        ];
        $json = function_exists('wp_json_encode') ? wp_json_encode($payload) : json_encode($payload);
        if (!is_string($json)) {
            // Unreachable for validate()d data (no INF/NAN, ASCII timestamp). Throwing beats
            // storing something Next.js would read as "not international" without a trace.
            throw new \RuntimeException('Clinic payment settings could not be JSON-encoded');
        }
        return $json;
    }

    /**
     * Decode a stored option value. Anything other than a string holding a JSON object is
     * malformed and yields null — including a PHP array, which is what get_option() returns
     * for a serialized `a:…` value.
     *
     * @return array<string, mixed>|null
     */
    public static function decode(mixed $raw): ?array
    {
        if (!is_string($raw)) {
            return null;
        }
        $trimmed = trim($raw);
        if ($trimmed === '' || $trimmed[0] !== '{') {
            return null;
        }
        $decoded = json_decode($trimmed, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @return array<string, mixed>|null The decoded option, or null when absent or malformed.
     */
    public static function get(int $clinic_id): ?array
    {
        return self::decode(get_option(self::option_name($clinic_id), ''));
    }

    /**
     * Write the clinic's whole object, autoload off.
     *
     * update_option() returns false both on a database failure and when the new value
     * equals the stored one. The second case (an identical re-save in the same second)
     * is a success, so a false return is re-checked against what is stored now.
     *
     * @param array<string, mixed> $data validate()'s `data`.
     */
    public static function save(int $clinic_id, array $data): bool
    {
        $name = self::option_name($clinic_id);
        $json = self::encode($data, gmdate('c'));
        if (update_option($name, $json, false)) {
            return true;
        }
        return get_option($name, '') === $json;
    }

    public static function clinic_exists(int $clinic_id): bool
    {
        if ($clinic_id <= 0) {
            return false;
        }
        global $wpdb;
        $found = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}kc_clinics WHERE id = %d LIMIT 1",
            $clinic_id
        ));
        return $found !== null;
    }

    private static function is_number(mixed $v): bool
    {
        return (is_int($v) || is_float($v)) && is_finite((float) $v);
    }

    /** Checked on the scaled value with a tolerance, never with fmod or an is-integer test. */
    private static function has_at_most_2_decimals(int|float $v): bool
    {
        $scaled = $v * 100;
        return abs(round($scaled) - $scaled) < 1e-6;
    }

    /** @return array{ok: false, code: string, message: string, field: ?string} */
    private static function invalid(string $field, string $message): array
    {
        return ['ok' => false, 'code' => 'invalid_settings', 'message' => $message, 'field' => $field];
    }
}
```

- [ ] **Step 4: Load the class in the plugin bootstrap**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` replace:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-money.php';
```

with:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-money.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-clinic-payment-settings.php';
```

- [ ] **Step 5: Run the test, lint, and re-run the baseline**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l includes/class-praktiqu-endpoint-clinic-payment-settings.php && php -l praktiqu-endpoint.php && php tests/test-clinic-payment-settings.php | tail -3'
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && for t in tests/test-*.php; do printf '%s: ' "$t"; DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php "$t" | tail -1; done
```

Expected: `No syntax errors detected` twice, then the test ends with `ALL PASS` (69 `ok` lines, no `FAIL`); the loop prints `ALL PASS` for all five test files.

The test pins the exact stored string `{"international":true,"fx_rate":16500,"markup_percent":10,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}`. That string is the shared fixture for the Next.js `KcOption` integration test (spec §7; Task B2 Step 13, `tests/integration/payments/clinic-payment-option.test.ts`, constant `PLUGIN_FIXTURE`) — if you change `encode()`, change that fixture too.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-payment-settings.php Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php && git commit -F - <<'EOF'
feat(plugin): simpan pengaturan pembayaran klinik sebagai JSON per klinik

ClinicPaymentSettings menyimpan satu opsi wp_options per klinik
(praktiqu_endpoint_clinic_{id}_payment, autoload off) sebagai STRING JSON,
bukan array PHP, supaya Next.js bisa JSON.parse lewat KcOption. validate(),
encode() dan decode() murni dan diuji di container PHP kosong; get(), save()
dan clinic_exists() diuji dengan shim WordPress. is_usable_rate() menerima
teks yang sama dengan parseOptionNumber di Next.js (bukan is_numeric), jadi
"1.8e4" dianggap tidak terpakai di kedua sisi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with 3 files changed.

---

### Task A2: REST GET/PUT `/clinics/{id}/payment-settings`, global-default rate range and labels, uninstall cleanup

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` (lines 345-354, the `/payments/order/{id}` route at the end of `register_routes()`; lines 678-689, `handle_get_payment_order()` at the end of the class)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php` (lines 163-190 `sanitize_fx_rate()`; line 216 markup error text; lines 374, 386, 402, 414 labels/descriptions; lines 487-489 endpoint list)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/uninstall.php` (lines 5 and 26-27)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt` (line 29, the Endpoints list)
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings-rest.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-fx-rate-sanitizer.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-uninstall.php`

All paths are relative to `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional`. Requires Task A1 (the class `ClinicPaymentSettings` must exist). Never touch a database or a remote server.

**Interfaces:**
- Consumes (Task A1): `ClinicPaymentSettings::clinic_exists(int): bool`, `::validate(array, mixed): array`, `::save(int, array): bool`, `::get(int): ?array`, `::is_usable_rate(mixed): bool`, `::GLOBAL_RATE_OPTION`.
- Produces:
  - `GET /praktiqu/v1/clinics/(?P<id>\d+)/payment-settings` → handler `REST_Controller::handle_get_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response` → 200 `{ "clinicId": 4, "settings": {…decoded option…} | null }`. Service token (`Plugin::verify_service_token`). No existence check (diagnostics).
  - `PUT /praktiqu/v1/clinics/(?P<id>\d+)/payment-settings` → handler `REST_Controller::handle_put_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response|\WP_Error`. Body (JSON, storage keys) `{ international, fx_rate, markup_percent, fixed_fee_idr, updated_by }` → 200 same shape as GET. Errors: 404 `clinic_not_found`; 400 `invalid_settings`; 422 `fx_rate_required`; 500 `save_failed` (error data also carries `field` for the two validation codes).
  - `Settings::sanitize_fx_rate(string $value): string` rejects anything `ClinicPaymentSettings::is_usable_rate()` rejects — outside 1000–100000, or not plain decimal text such as `1.8e4` / `18000.` — (keeps the stored value, raises settings error `praktiqu_invalid_fx_rate`), so wp-admin can never save a global rate that Next.js would read as unset. wp-admin labels say "Global default".
  - `uninstall.php` deletes every option matching `LIKE 'praktiqu\_endpoint\_clinic\_%\_payment'` (names read with `$wpdb`, removed with `delete_option()`).

- [ ] **Step 1: Write the failing REST handler test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings-rest.php` with exactly this content:

```php
<?php
/**
 * Assertions for REST_Controller::handle_get_clinic_payment_settings() and
 * ::handle_put_clinic_payment_settings(). Plain PHP — no PHPUnit, no real WordPress — runs in
 * a bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * The harness loads the real classes unmodified, like test-service-authenticate.php:
 *   - ABSPATH is defined so the files' `defined('ABSPATH') || exit;` guards pass;
 *   - WP_Error, WP_REST_Request, WP_REST_Response, get_option()/update_option() and $wpdb are
 *     shimmed over plain arrays, with update_option()'s real "unchanged value -> false" rule;
 *   - the controller is built with ReflectionClass::newInstanceWithoutConstructor(): the two
 *     handlers under test use none of its ten injected services;
 *   - gmdate() is frozen inside the plugin namespace, so updated_at is deterministic.
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint {
    function gmdate(string $format, ?int $timestamp = null): string
    {
        return '2026-10-06T08:00:00+00:00';
    }
}

namespace {
    use PraktiQU\Endpoint\REST_Controller;

    define('ABSPATH', __DIR__ . '/');

    final class WP_Error
    {
        public function __construct(public string $code = '', public string $message = '', public mixed $data = null)
        {
        }

        public function get_error_code(): string
        {
            return $this->code;
        }

        public function get_error_data(): mixed
        {
            return $this->data;
        }
    }

    final class WP_REST_Response
    {
        public function __construct(public mixed $data = null, public int $status = 200)
        {
        }

        public function get_data(): mixed
        {
            return $this->data;
        }

        public function get_status(): int
        {
            return $this->status;
        }
    }

    final class WP_REST_Request
    {
        /** @param array<string, mixed> $url_params */
        public function __construct(private array $url_params, private mixed $json = null)
        {
        }

        public function get_param(string $key): mixed
        {
            return $this->url_params[$key] ?? null;
        }

        public function get_json_params(): mixed
        {
            return $this->json;
        }
    }

    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }

    $GLOBALS['__praktiqu_test_options']  = [];
    $GLOBALS['__praktiqu_update_broken'] = false;

    function get_option(string $name, $default = false)
    {
        return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            ? $GLOBALS['__praktiqu_test_options'][$name]
            : $default;
    }

    function update_option(string $name, $value, $autoload = null): bool
    {
        if ($GLOBALS['__praktiqu_update_broken']) {
            return false;
        }
        if (array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
            && $GLOBALS['__praktiqu_test_options'][$name] === $value) {
            return false;
        }
        $GLOBALS['__praktiqu_test_options'][$name] = $value;
        return true;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_var(string $query)
        {
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) === 1) {
                return in_array((int) $m[1], [4, 5, 7], true) ? $m[1] : null;
            }
            return null;
        }
    }

    $wpdb = new FakeWpdb();

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-rest-controller.php';

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

    /** @var REST_Controller $controller */
    $controller = (new ReflectionClass(REST_Controller::class))->newInstanceWithoutConstructor();

    /** [status, code-or-body] of a handler result. */
    function put(int $clinic_id, mixed $json): array
    {
        global $controller;
        $result = $controller->handle_put_clinic_payment_settings(new WP_REST_Request(['id' => $clinic_id], $json));
        if ($result instanceof WP_Error) {
            return [$result->get_error_data()['status'] ?? null, $result->get_error_code(), $result->get_error_data()['field'] ?? null];
        }
        return [$result->get_status(), $result->get_data()];
    }

    function get(int $clinic_id): array
    {
        global $controller;
        $result = $controller->handle_get_clinic_payment_settings(new WP_REST_Request(['id' => $clinic_id]));
        return [$result->get_status(), $result->get_data()];
    }

    $body = [
        'international'  => true,
        'fx_rate'        => 18000,
        'markup_percent' => 10,
        'fixed_fee_idr'  => 25000,
        'updated_by'     => 123,
    ];
    $saved = [
        'international'  => true,
        'fx_rate'        => 18000,
        'markup_percent' => 10,
        'fixed_fee_idr'  => 25000,
        'updated_at'     => '2026-10-06T08:00:00+00:00',
        'updated_by'     => 123,
    ];

    echo "PUT /clinics/{id}/payment-settings\n";
    check('unknown clinic -> 404 clinic_not_found', put(99, $body), [404, 'clinic_not_found', null]);
    check('unknown clinic writes no option', array_key_exists('praktiqu_endpoint_clinic_99_payment', $GLOBALS['__praktiqu_test_options']), false);

    check('valid body -> 200 with the decoded option', put(4, $body), [200, ['clinicId' => 4, 'settings' => $saved]]);
    $raw = $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] ?? null;
    check('stored value is a JSON string beginning with {', is_string($raw) && $raw[0] === '{', true);
    check('stored value json_decodes to the saved object', json_decode((string) $raw, true), $saved);
    check('identical re-save -> 200', put(4, $body), [200, ['clinicId' => 4, 'settings' => $saved]]);

    check('markup 150 -> 400 invalid_settings on markup_percent', put(4, array_merge($body, ['markup_percent' => 150])), [400, 'invalid_settings', 'markup_percent']);
    check('a rejected PUT leaves the stored value alone', $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'], $raw);
    check('no JSON body -> 400 invalid_settings', put(4, null), [400, 'invalid_settings', 'international']);
    check('updated_by "123" -> 400 invalid_settings', put(4, array_merge($body, ['updated_by' => '123'])), [400, 'invalid_settings', 'updated_by']);

    check('international, no rate anywhere -> 422 fx_rate_required', put(5, array_merge($body, ['fx_rate' => null])), [422, 'fx_rate_required', 'fx_rate']);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate'] = '500000';
    check('global rate out of range -> 422 fx_rate_required', put(5, array_merge($body, ['fx_rate' => null])), [422, 'fx_rate_required', 'fx_rate']);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate'] = '18000';
    check('usable global rate -> 200 with fx_rate null', put(5, array_merge($body, ['fx_rate' => null])),
        [200, ['clinicId' => 5, 'settings' => array_merge($saved, ['fx_rate' => null])]]);

    $GLOBALS['__praktiqu_update_broken'] = true;
    check('a failed write -> 500 save_failed', put(7, $body), [500, 'save_failed', null]);
    $GLOBALS['__praktiqu_update_broken'] = false;

    echo "\nGET /clinics/{id}/payment-settings\n";
    check('saved clinic', get(4), [200, ['clinicId' => 4, 'settings' => $saved]]);
    check('no option -> settings null', get(7), [200, ['clinicId' => 7, 'settings' => null]]);
    $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_8_payment'] = ['international' => true];
    check('a serialized (array) value -> settings null', get(8), [200, ['clinicId' => 8, 'settings' => null]]);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-clinic-payment-settings-rest.php
```

Expected: FAIL with `Fatal error: Uncaught Error: Call to undefined method PraktiQU\Endpoint\REST_Controller::handle_put_clinic_payment_settings()` — the handlers do not exist yet.

- [ ] **Step 3: Register the two routes**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` replace (end of `register_routes()`):

```php
        // GET /praktiqu/v1/payments/order/{id} — verify-fallback order status
        register_rest_route($ns, '/payments/order/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
    }
```

with:

```php
        // GET /praktiqu/v1/payments/order/{id} — verify-fallback order status
        register_rest_route($ns, '/payments/order/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // GET /praktiqu/v1/clinics/{id}/payment-settings — diagnostics only; Next.js reads
        // the option itself through KcOption (2026-10-06 international clinic design §4)
        register_rest_route($ns, '/clinics/(?P<id>\d+)/payment-settings', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_get_clinic_payment_settings'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);

        // PUT /praktiqu/v1/clinics/{id}/payment-settings — replace one clinic's whole object.
        // Only `id` is declared: the body keys are checked by ClinicPaymentSettings::validate()
        // so every failure is our own invalid_settings / fx_rate_required, never WP's generic
        // rest_invalid_param.
        register_rest_route($ns, '/clinics/(?P<id>\d+)/payment-settings', [
            'methods'             => 'PUT',
            'callback'            => [$this, 'handle_put_clinic_payment_settings'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
    }
```

- [ ] **Step 4: Add the two handlers**

In the same file replace (end of the class):

```php
    /**
     * GET /praktiqu/v1/payments/order/{id}
     */
    public function handle_get_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->get_order_status((int) $request->get_param('id'));
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }
}
```

with:

```php
    /**
     * GET /praktiqu/v1/payments/order/{id}
     */
    public function handle_get_payment_order(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->payments->get_order_status((int) $request->get_param('id'));
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 200);
    }

    /**
     * GET /praktiqu/v1/clinics/{id}/payment-settings
     *
     * Diagnostics only. No clinic-existence check, so an option left behind by a deleted
     * clinic is still visible here. `settings` is null when the option is absent or malformed.
     */
    public function handle_get_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response
    {
        $clinic_id = (int) $request->get_param('id');
        return new \WP_REST_Response([
            'clinicId' => $clinic_id,
            'settings' => ClinicPaymentSettings::get($clinic_id),
        ], 200);
    }

    /**
     * PUT /praktiqu/v1/clinics/{id}/payment-settings
     *
     * Body (storage keys): { international, fx_rate, markup_percent, fixed_fee_idr, updated_by }.
     * updated_by is stored exactly as received: get_current_user_id() is always 0 on a
     * service-token request, so the plugin never stamps the editor itself.
     */
    public function handle_put_clinic_payment_settings(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $clinic_id = (int) $request->get_param('id');
        if (!ClinicPaymentSettings::clinic_exists($clinic_id)) {
            return new \WP_Error(
                'clinic_not_found',
                sprintf('Clinic %d does not exist', $clinic_id),
                ['status' => 404]
            );
        }

        $checked = ClinicPaymentSettings::validate(
            (array) $request->get_json_params(),
            get_option(ClinicPaymentSettings::GLOBAL_RATE_OPTION, '')
        );
        if (!$checked['ok']) {
            return new \WP_Error(
                $checked['code'],
                $checked['message'],
                [
                    'status' => $checked['code'] === 'fx_rate_required' ? 422 : 400,
                    'field'  => $checked['field'],
                ]
            );
        }

        if (!ClinicPaymentSettings::save($clinic_id, $checked['data'])) {
            return new \WP_Error(
                'save_failed',
                sprintf('Payment settings for clinic %d could not be saved', $clinic_id),
                ['status' => 500]
            );
        }

        return new \WP_REST_Response([
            'clinicId' => $clinic_id,
            'settings' => ClinicPaymentSettings::get($clinic_id),
        ], 200);
    }
}
```

- [ ] **Step 5: Run the REST test and lint**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l includes/class-praktiqu-endpoint-rest-controller.php && php tests/test-clinic-payment-settings-rest.php'
```

Expected: `No syntax errors detected`, then 17 `ok` lines and `ALL PASS`.

- [ ] **Step 6: Write the failing FX-rate sanitizer test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-fx-rate-sanitizer.php` with exactly this content:

```php
<?php
/**
 * Assertions for Settings::sanitize_fx_rate(). Plain PHP — no PHPUnit, no real WordPress —
 * runs in a bare `php:8.4-cli` container, same as tests/test-jobs-secret-sanitizer.php,
 * whose harness this mirrors: ABSPATH is defined so the real class loads unmodified, and the
 * WordPress functions sanitize_fx_rate() touches (get_option, update_option,
 * add_settings_error, __) are shimmed over plain arrays. register()/render_page() are never
 * called.
 */

declare(strict_types=1);

define('ABSPATH', '/tmp/praktiqu-endpoint-test/');

$GLOBALS['__praktiqu_test_options'] = [];
$GLOBALS['__praktiqu_settings_errors'] = [];

function get_option(string $name, $default = false)
{
    return $GLOBALS['__praktiqu_test_options'][$name] ?? $default;
}

function update_option(string $name, $value, $autoload = null): bool
{
    $GLOBALS['__praktiqu_test_options'][$name] = $value;
    return true;
}

function add_settings_error(string $setting, string $code, string $message, string $type = 'error'): void
{
    $GLOBALS['__praktiqu_settings_errors'][] = $code;
}

function __(string $text, string $domain = 'default'): string
{
    return $text;
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-settings.php';

use PraktiQU\Endpoint\Settings;

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

/** [returned value, settings errors raised] for one submission over a stored '18000'. */
function submit(string $value): array
{
    $GLOBALS['__praktiqu_test_options']   = ['praktiqu_endpoint_paypal_idr_rate' => '18000'];
    $GLOBALS['__praktiqu_settings_errors'] = [];
    $returned = (new Settings())->sanitize_fx_rate($value);
    return [$returned, $GLOBALS['__praktiqu_settings_errors']];
}

echo "Settings::sanitize_fx_rate accepts 1,000 to 100,000\n";
check('16500', submit('16500'), ['16500', []]);
check('lower bound 1000', submit('1000'), ['1000', []]);
check('upper bound 100000', submit('100000'), ['100000', []]);
check('a 2-decimal rate', submit('16500.50'), ['16500.50', []]);
check('surrounding spaces are trimmed', submit(' 17000 '), ['17000', []]);

echo "\nSettings::sanitize_fx_rate rejects anything else and keeps the stored rate\n";
check('16.5 ("16.500" read as 16.5)', submit('16.5'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('999.99', submit('999.99'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('100000.01', submit('100000.01'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('500000', submit('500000'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('0.00006 (inverted)', submit('0.00006'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('0', submit('0'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('blank', submit(''), ['18000', ['praktiqu_invalid_fx_rate']]);
check('not a number', submit('abc'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('1.8e4 (is_numeric, but Next.js reads it as unset)', submit('1.8e4'), ['18000', ['praktiqu_invalid_fx_rate']]);
check('18000. (trailing dot)', submit('18000.'), ['18000', ['praktiqu_invalid_fx_rate']]);

echo "\nSettings::sanitize_fx_rate stamps a real change only\n";
submit('16500');
check('a changed rate stamps _updated', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), true);
submit('18000');
check('re-submitting the stored rate does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), false);
submit('16.5');
check('a rejected rate does not stamp', isset($GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_paypal_idr_rate_updated']), false);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
```

- [ ] **Step 7: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-fx-rate-sanitizer.php
```

Expected: FAIL, last line `8 FAILURE(S)` — `16.5`, `999.99`, `100000.01`, `500000`, `0.00006`, `1.8e4` and `18000.` are still accepted (the current rule is only `is_numeric()` and "> 0"), and the rejected-rate case therefore stamps `_updated`.

- [ ] **Step 8: Tighten `sanitize_fx_rate()` to 1,000–100,000**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php` replace:

```php
    /**
     * Keep the FX rate a positive number, and stamp when it last changed so a
     * stale rate is visible on the settings screen rather than silent.
     *
     * A rejected value keeps the stored one: a blank or malformed submission
     * must not zero the rate, because Payments::create_order() treats a
     * non-positive rate as a hard failure and would refuse every PayPal order.
     * A rejection also registers a settings-API error so the admin sees *why*
     * the value on screen didn't change, instead of a plain "Settings saved"
     * that reads as success.
     */
    public function sanitize_fx_rate(string $value): string
    {
        $current = (string) get_option('praktiqu_endpoint_paypal_idr_rate', '');
        $trimmed = trim($value);
        if ($trimmed === '' || !is_numeric($trimmed) || (float) $trimmed <= 0) {
            add_settings_error(
                'praktiqu_endpoint_paypal_idr_rate',
                'praktiqu_invalid_fx_rate',
                __('PayPal FX Rate was not updated: it must be a number greater than 0. The previous value was kept.', 'praktiqu-endpoint')
            );
            return $current;
        }
```

with:

```php
    /**
     * Keep the global default FX rate a usable rate — 1,000 to 100,000 rupiah
     * per 1 USD, the same range ClinicPaymentSettings applies to a clinic's own
     * rate — and stamp when it last changed so a stale rate is visible on the
     * settings screen rather than silent.
     *
     * The range rejects an inverted or mistyped entry, such as 0.00006, or
     * "16.500" read as 16.5. It also protects the legacy no-`charge` path of
     * Payments::create_order() while it still exists (1.7.0 transition).
     * is_usable_rate() also refuses text Next.js would read as "not set"
     * ("1.8e4", "18000."), so wp-admin never shows a saved rate that the
     * payment gate treats as missing.
     *
     * A rejected value keeps the stored one: a blank or malformed submission
     * must not zero the rate, because Payments::create_order() treats a
     * non-positive rate as a hard failure and would refuse every PayPal order.
     * A rejection also registers a settings-API error so the admin sees *why*
     * the value on screen didn't change, instead of a plain "Settings saved"
     * that reads as success.
     */
    public function sanitize_fx_rate(string $value): string
    {
        $current = (string) get_option('praktiqu_endpoint_paypal_idr_rate', '');
        $trimmed = trim($value);
        if (!ClinicPaymentSettings::is_usable_rate($trimmed)) {
            add_settings_error(
                'praktiqu_endpoint_paypal_idr_rate',
                'praktiqu_invalid_fx_rate',
                __('Global default PayPal FX Rate was not updated: it must be a number from 1000 to 100000 (rupiah per 1 USD), written with digits only, such as 16500 or 16500.50. The previous value was kept.', 'praktiqu-endpoint')
            );
            return $current;
        }
```

- [ ] **Step 9: Relabel the wp-admin fields as global defaults**

Five small replacements in the same file, each anchored on a unique string.

(a) Replace:

```php
                __('Foreign Patient Markup was not updated: it must be a number between 0 and 100. The previous value was kept.', 'praktiqu-endpoint')
```

with:

```php
                __('Global default Foreign Patient Markup was not updated: it must be a number between 0 and 100. The previous value was kept.', 'praktiqu-endpoint')
```

(b) Replace:

```php
                            <label for="praktiqu_endpoint_paypal_idr_rate"><?php esc_html_e('PayPal FX Rate (IDR per 1 USD)', 'praktiqu-endpoint'); ?></label>
```

with:

```php
                            <label for="praktiqu_endpoint_paypal_idr_rate"><?php esc_html_e('Global default PayPal FX Rate (IDR per 1 USD)', 'praktiqu-endpoint'); ?></label>
```

(c) Replace:

```php
                                <?php esc_html_e('PayPal does not support IDR, so PayPal and card orders are charged in USD. This should be the honest market rate — keep it tracking the real exchange rate, not adjusted to change what a patient pays. To charge foreign patients more (or less), use the Foreign Patient Markup field below instead.', 'praktiqu-endpoint'); ?>
```

with:

```php
                                <?php esc_html_e('PayPal does not support IDR, so PayPal and card orders are charged in USD. Only an International clinic accepts them. Each International clinic can set its own rate from the PraktiQU dashboard; this global default is used for a clinic that leaves its rate empty. It must be from 1000 to 100000. This should be the honest market rate — keep it tracking the real exchange rate, not adjusted to change what a patient pays. To charge foreign patients more (or less), use the markup field below instead.', 'praktiqu-endpoint'); ?>
```

(d) Replace:

```php
                            <label for="praktiqu_endpoint_paypal_markup_percent"><?php esc_html_e('Foreign Patient Markup (%)', 'praktiqu-endpoint'); ?></label>
```

with:

```php
                            <label for="praktiqu_endpoint_paypal_markup_percent"><?php esc_html_e('Global default Foreign Patient Markup (%)', 'praktiqu-endpoint'); ?></label>
```

(e) Replace:

```php
                                <?php esc_html_e('Extra percentage added on top of the converted amount, for foreign patients. The FX rate above should stay the honest market rate; put the business markup here. At rate 18000 and markup 10%, a Rp 200.000 service is charged $12.23.', 'praktiqu-endpoint'); ?>
```

with:

```php
                                <?php esc_html_e('Extra percentage added on top of the converted amount, for foreign patients. Used for an International clinic that leaves its own markup empty. The FX rate above should stay the honest market rate; put the business markup here. At rate 18000 and markup 10%, a Rp 200.000 service is charged $12.23.', 'praktiqu-endpoint'); ?>
```

(f) In the "REST Endpoints" list at the bottom of `render_page()` replace:

```php
                <li><code>GET  /payments/order/{id}</code> — read WooCommerce order status</li>
            </ul>
```

with:

```php
                <li><code>GET  /payments/order/{id}</code> — read WooCommerce order status</li>
                <li><code>GET|PUT /clinics/{id}/payment-settings</code> — one clinic's international payment settings</li>
            </ul>
```

- [ ] **Step 10: Run the sanitizer test and the existing settings test**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l includes/class-praktiqu-endpoint-settings.php && php tests/test-fx-rate-sanitizer.php | tail -1 && php tests/test-jobs-secret-sanitizer.php | tail -1'
```

Expected: `No syntax errors detected`, `ALL PASS`, `ALL PASS`.

- [ ] **Step 11: Write the failing uninstall test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-uninstall.php` with exactly this content:

```php
<?php
/**
 * Assertions for uninstall.php. Plain PHP — no PHPUnit, no real WordPress — runs in a bare
 * `php:8.4-cli` container, same as the other files in this directory.
 *
 * uninstall.php runs top to bottom when required, so the harness defines
 * WP_UNINSTALL_PLUGIN, shims delete_option()/delete_transient(), and gives it a fake $wpdb
 * whose get_col() evaluates the LIKE pattern the way MySQL does (`%` = any run, `_` = any one
 * character, a backslash escapes either). That is what proves the underscores are escaped:
 * an unescaped pattern would also match `praktiqu-endpoint-clinic-4-payment`.
 */

declare(strict_types=1);

define('WP_UNINSTALL_PLUGIN', 'praktiqu-endpoint/praktiqu-endpoint.php');

$GLOBALS['__deleted_options']    = [];
$GLOBALS['__deleted_transients'] = [];

function delete_option(string $name): bool
{
    $GLOBALS['__deleted_options'][] = $name;
    return true;
}

function delete_transient(string $name): bool
{
    $GLOBALS['__deleted_transients'][] = $name;
    return true;
}

final class FakeWpdb
{
    public string $options = 'wp_options';
    /** @var list<string> */
    public array $option_names = [
        'praktiqu_endpoint_clinic_4_payment',
        'praktiqu_endpoint_clinic_12_payment',
        'praktiqu_endpoint_clinic_4_payment_backup',
        'praktiqu-endpoint-clinic-4-payment',
        'praktiqu_endpoint_paypal_idr_rate',
        'kivicare_clinic_notifications_enabled_4',
    ];

    public function esc_like(string $text): string
    {
        return addcslashes($text, '_%\\');
    }

    public function prepare(string $query, ...$args): string
    {
        // A callback, not a replacement string: preg_replace() would eat the backslashes.
        return preg_replace_callback('/%s/', static function () use (&$args): string {
            return "'" . addslashes((string) array_shift($args)) . "'";
        }, $query);
    }

    /** @return list<string> */
    public function get_col(string $query): array
    {
        if (preg_match("/^SELECT option_name FROM wp_options WHERE option_name LIKE '(.*)'$/", $query, $m) !== 1) {
            return [];
        }
        $like  = stripslashes($m[1]); // undo prepare()'s addslashes
        $regex = '';
        for ($i = 0, $n = strlen($like); $i < $n; $i++) {
            $c = $like[$i];
            if ($c === '\\' && $i + 1 < $n) {
                $regex .= preg_quote($like[++$i], '/');
            } elseif ($c === '%') {
                $regex .= '.*';
            } elseif ($c === '_') {
                $regex .= '.';
            } else {
                $regex .= preg_quote($c, '/');
            }
        }
        return array_values(array_filter($this->option_names, static fn (string $name): bool => preg_match('/^' . $regex . '$/s', $name) === 1));
    }
}

$wpdb = new FakeWpdb();

require __DIR__ . '/../uninstall.php';

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

$deleted = $GLOBALS['__deleted_options'];

echo "uninstall.php\n";
check('deletes clinic 4 payment settings', in_array('praktiqu_endpoint_clinic_4_payment', $deleted, true), true);
check('deletes clinic 12 payment settings', in_array('praktiqu_endpoint_clinic_12_payment', $deleted, true), true);
check('keeps a name that only starts like one', in_array('praktiqu_endpoint_clinic_4_payment_backup', $deleted, true), false);
check('underscores are escaped (a dashed name is kept)', in_array('praktiqu-endpoint-clinic-4-payment', $deleted, true), false);
check('keeps KiviCare\'s own per-clinic option', in_array('kivicare_clinic_notifications_enabled_4', $deleted, true), false);
check('still deletes the global rate option', in_array('praktiqu_endpoint_paypal_idr_rate', $deleted, true), true);
check('still deletes the activation notice transient', $GLOBALS['__deleted_transients'], ['praktiqu_endpoint_activation_notice']);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
```

- [ ] **Step 12: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-uninstall.php
```

Expected: FAIL, last line `2 FAILURE(S)` — `deletes clinic 4 payment settings` and `deletes clinic 12 payment settings` (uninstall.php does not know about per-clinic options yet).

- [ ] **Step 13: Add the per-clinic cleanup to `uninstall.php`**

In `Wordpress-Plugin/praktiqu-endpoint/uninstall.php` replace:

```php
 * Removes all plugin options. The service token (PRAKTIQU_SERVICE_TOKEN
```

with:

```php
 * Removes all plugin options, including every per-clinic
 * `praktiqu_endpoint_clinic_{id}_payment` row. The service token (PRAKTIQU_SERVICE_TOKEN
```

and replace:

```php
delete_option('praktiqu_endpoint_paypal_markup_percent_updated');
delete_transient('praktiqu_endpoint_activation_notice');
```

with:

```php
delete_option('praktiqu_endpoint_paypal_markup_percent_updated');
delete_transient('praktiqu_endpoint_activation_notice');

// One praktiqu_endpoint_clinic_{id}_payment row per clinic (ClinicPaymentSettings). The
// names are collected with $wpdb and removed through delete_option() so an object cache
// drops them too. esc_like() escapes the underscores, which LIKE would otherwise treat as
// single-character wildcards.
global $wpdb;
$praktiqu_clinic_payment_options = $wpdb->get_col($wpdb->prepare(
    "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s",
    $wpdb->esc_like('praktiqu_endpoint_clinic_') . '%' . $wpdb->esc_like('_payment')
));
foreach ((array) $praktiqu_clinic_payment_options as $praktiqu_option_name) {
    delete_option((string) $praktiqu_option_name);
}
```

- [ ] **Step 14: Document the route in `readme.txt`**

In `Wordpress-Plugin/praktiqu-endpoint/readme.txt` replace:

```text
* `GET  /payments/order/{id}` — read WooCommerce order status
```

with:

```text
* `GET  /payments/order/{id}` — read WooCommerce order status
* `GET|PUT /clinics/{id}/payment-settings` — one clinic's international payment settings
```

- [ ] **Step 15: Lint everything and run every plugin test**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l uninstall.php && php -l includes/class-praktiqu-endpoint-rest-controller.php && php -l includes/class-praktiqu-endpoint-settings.php'
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && for t in tests/test-*.php; do printf '%s: ' "$t"; DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php "$t" | tail -1; done
```

Expected: three `No syntax errors detected`, then `ALL PASS` for all eight test files.

What the shim tests cannot prove (real WordPress routing, the real `update_option()` / `$wpdb`, the admin screen) is a manual check during rollout, spec §8 step 1. It is listed in Task A4, Step 9 — do not run it now (it needs the user's go-ahead and touches the live WordPress).

- [ ] **Step 16: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php Wordpress-Plugin/praktiqu-endpoint/uninstall.php Wordpress-Plugin/praktiqu-endpoint/readme.txt Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings-rest.php Wordpress-Plugin/praktiqu-endpoint/tests/test-fx-rate-sanitizer.php Wordpress-Plugin/praktiqu-endpoint/tests/test-uninstall.php && git commit -F - <<'EOF'
feat(plugin): rute GET/PUT pengaturan pembayaran klinik, kurs global 1.000-100.000

PUT /praktiqu/v1/clinics/{id}/payment-settings memvalidasi ulang body
(snake_case) dengan ClinicPaymentSettings: 404 clinic_not_found, 400
invalid_settings, 422 fx_rate_required, 500 save_failed. GET hanya untuk
diagnostik. sanitize_fx_rate kini menolak kurs di luar 1.000-100.000 atau
yang bukan angka desimal biasa (mis. 1.8e4, sama dengan aturan Next.js),
dan label wp-admin menyebut kurs/markup sebagai default global.
uninstall.php ikut menghapus semua opsi per klinik.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with 7 files changed.

---

### Task A3: ChargeValidator — the USD `charge` object, in integer cents

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-charge-validator.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-charge-validator.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (the `require_once` list; after Task A1 the clinic-payment-settings line is line 32)

All paths are relative to `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional`. Requires Task A1. Pure code only — no WordPress, no database.

**Interfaces:**
- Consumes (Task A1): `ClinicPaymentSettings::is_usable_rate(mixed $v): bool`, `ClinicPaymentSettings::MARKUP_MAX`, `ClinicPaymentSettings::FEE_MAX`.
- Produces (namespace `PraktiQU\Endpoint`), `final class ChargeValidator` (pure):
  - `public static function to_cents(mixed $amount): ?int;` — only strings matching `/^\d+\.\d{2}$/` (checked with the `D` modifier); else null
  - `public static function cents_to_string(int $cents): string;` — `1362 -> "13.62"`
  - `public static function validate(array $charge, array $items, array $taxes): array;` — `$items`/`$taxes` are the RUPIAH arrays from the create_order input. Ok: `['ok'=>true,'items'=>list<array{name:string,cents:int}>,'taxes'=>list<array{name:string,cents:int}>,'fee'=>?array{name:string,cents:int},'total_cents'=>int,'snapshot'=>array]`. Fail: `['ok'=>false,'message'=>string]` (Task A4 maps it to `WP_Error('invalid_charge', msg, 400)`).
  - Rules: currency === 'USD'; item cents >= 0; tax cents > 0; fee optional (absent or null) and > 0 when present; total > 0; count(items) === count(rupiah items); count(taxes) === count of rupiah taxes with amount > 0; sum of line cents === total cents; snapshot.clinicId positive int. Additionally (the snapshot feeds order meta and the effective fxRate): snapshot.fxRate a usable rate, snapshot.markupPercent numeric 0..100, snapshot.fixedFeeIdr numeric 0..10,000,000, snapshot.source.{fxRate,markupPercent,fixedFeeIdr} each one of `clinic|global|default`.

- [ ] **Step 1: Write the failing test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-charge-validator.php` with exactly this content:

```php
<?php
/**
 * Assertions for ChargeValidator. Plain PHP — no PHPUnit, no WordPress — so it runs in a
 * bare `php:8.4-cli` container, same as tests/test-money.php.
 *
 * The wire format under test is exactly what Next.js serialises (spec §4): every money
 * amount is a "12.23"-style string, snapshot.clinicId is a JSON integer, the other snapshot
 * numbers are decimal strings, and `fee` is left out when there is no fee.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_CLINIC_PAYMENT_SETTINGS_TEST', true);
define('PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-charge-validator.php';

use PraktiQU\Endpoint\ChargeValidator as V;

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

/** The §2 worked example: rate 18,000, markup 10%, fee Rp 25,000, service Rp 200,000. */
function worked_charge(array $override = []): array
{
    return array_merge([
        'currency' => 'USD',
        'items'    => [['name' => 'Konsultasi', 'amount' => '12.23']],
        'taxes'    => [],
        'fee'      => ['name' => 'International service fee', 'amount' => '1.39'],
        'total'    => '13.62',
        'snapshot' => [
            'clinicId'      => 4,
            'fxRate'        => '18000',
            'markupPercent' => '10',
            'fixedFeeIdr'   => '25000',
            'source'        => ['fxRate' => 'clinic', 'markupPercent' => 'global', 'fixedFeeIdr' => 'clinic'],
        ],
    ], $override);
}

$rupiah_items = [['name' => 'Konsultasi', 'price' => 200000]];

/** The message of a failed validate(), or 'ok'. */
function verdict(array $result): string
{
    return $result['ok'] ? 'ok' : $result['message'];
}

echo "ChargeValidator::to_cents\n";
check('"12.23"', V::to_cents('12.23'), 1223);
check('"0.00"', V::to_cents('0.00'), 0);
check('"0.05"', V::to_cents('0.05'), 5);
check('"1000.10"', V::to_cents('1000.10'), 100010);
check('a JSON number 12.23 is rejected', V::to_cents(12.23), null);
check('an int is rejected', V::to_cents(12), null);
check('"12.3" (one decimal)', V::to_cents('12.3'), null);
check('"12.230" (three decimals)', V::to_cents('12.230'), null);
check('"12" (no decimals)', V::to_cents('12'), null);
check('"-1.00"', V::to_cents('-1.00'), null);
check('"1e3"', V::to_cents('1e3'), null);
check('" 12.23" (leading space)', V::to_cents(' 12.23'), null);
check('"12.23\n" (trailing newline)', V::to_cents("12.23\n"), null);
check('null', V::to_cents(null), null);
check('16 integer digits would overflow', V::to_cents('1234567890123456.00'), null);

echo "\nChargeValidator::cents_to_string\n";
check('1362', V::cents_to_string(1362), '13.62');
check('0', V::cents_to_string(0), '0.00');
check('5', V::cents_to_string(5), '0.05');
check('100', V::cents_to_string(100), '1.00');
check('round trip 4889', V::cents_to_string((int) V::to_cents('48.89')), '48.89');

echo "\nChargeValidator::validate accepts\n";
$ok = V::validate(worked_charge(), $rupiah_items, []);
check('the worked example 12.23 + 1.39 = 13.62', verdict($ok), 'ok');
check('item line in cents', $ok['items'] ?? null, [['name' => 'Konsultasi', 'cents' => 1223]]);
check('no tax lines', $ok['taxes'] ?? null, []);
check('fee line in cents', $ok['fee'] ?? null, ['name' => 'International service fee', 'cents' => 139]);
check('total cents', $ok['total_cents'] ?? null, 1362);
check('snapshot passed through untouched', $ok['snapshot'] ?? null, worked_charge()['snapshot']);

$no_fee = worked_charge(['fee' => null, 'total' => '12.23']);
check('a null fee counts as absent', verdict(V::validate($no_fee, $rupiah_items, [])), 'ok');
$absent_fee = worked_charge(['total' => '12.23']);
unset($absent_fee['fee']);
$absent = V::validate($absent_fee, $rupiah_items, []);
check('an absent fee', verdict($absent), 'ok');
check('an absent fee yields fee null', array_key_exists('fee', $absent) ? $absent['fee'] : 'missing', null);

$two_items = worked_charge([
    'items' => [['name' => 'Konsultasi', 'amount' => '12.23'], ['name' => 'Gratis', 'amount' => '0.00']],
]);
check('a 0.00 item next to a paid item keeps the 1:1 count',
    verdict(V::validate($two_items, [['name' => 'Konsultasi', 'price' => 200000], ['name' => 'Gratis', 'price' => 0]], [])), 'ok');

$with_tax = worked_charge([
    'taxes' => [['name' => 'PPN', 'amount' => '1.23']],
    'total' => '14.85',
]);
check('one paid tax; a Rp 0 tax is skipped in the count',
    verdict(V::validate($with_tax, $rupiah_items, [['name' => 'PPN', 'amount' => 20000], ['name' => 'Nol', 'amount' => 0]])), 'ok');
check('markup 1.1 as a decimal string', verdict(V::validate(worked_charge(['snapshot' => array_merge(worked_charge()['snapshot'], ['markupPercent' => '1.1'])]), $rupiah_items, [])), 'ok');

echo "\nChargeValidator::validate rejects\n";
check('currency IDR', verdict(V::validate(worked_charge(['currency' => 'IDR']), $rupiah_items, [])), 'charge.currency must be "USD"');
check('a float-looking item amount', verdict(V::validate(worked_charge(['items' => [['name' => 'Konsultasi', 'amount' => 12.23]]]), $rupiah_items, [])),
    'charge.items[0].amount must be a string like "12.23"');
check('a float-looking total', verdict(V::validate(worked_charge(['total' => 13.62]), $rupiah_items, [])), 'charge.total must be a string like "13.62"');
check('a mismatched sum', verdict(V::validate(worked_charge(['total' => '13.63']), $rupiah_items, [])), 'charge lines sum to 13.62 but charge.total is 13.63');
check('more charge items than rupiah items',
    verdict(V::validate(worked_charge(['items' => [['name' => 'A', 'amount' => '6.00'], ['name' => 'B', 'amount' => '6.23']]]), $rupiah_items, [])),
    'charge.items has 2 entries but items has 1');
check('a charge tax with no paid rupiah tax',
    verdict(V::validate($with_tax, $rupiah_items, [['name' => 'Nol', 'amount' => 0]])), 'charge.taxes has 1 entries but 0 rupiah taxes are above 0');
check('a paid rupiah tax with no charge tax',
    verdict(V::validate(worked_charge(), $rupiah_items, [['name' => 'PPN', 'amount' => 20000]])), 'charge.taxes has 0 entries but 1 rupiah taxes are above 0');
check('a 0.00 tax line',
    verdict(V::validate(worked_charge(['taxes' => [['name' => 'PPN', 'amount' => '0.00']]]), $rupiah_items, [['name' => 'PPN', 'amount' => 1]])),
    'charge.taxes[0].amount must be greater than 0');
check('a 0.00 fee', verdict(V::validate(worked_charge(['fee' => ['name' => 'International service fee', 'amount' => '0.00'], 'total' => '12.23']), $rupiah_items, [])),
    'charge.fee.amount must be greater than 0');
check('a zero total', verdict(V::validate(worked_charge(['items' => [['name' => 'Konsultasi', 'amount' => '0.00']], 'fee' => null, 'total' => '0.00']), $rupiah_items, [])),
    'charge.total must be greater than 0');
check('items not a list', verdict(V::validate(worked_charge(['items' => ['a' => ['name' => 'X', 'amount' => '12.23']]]), $rupiah_items, [])), 'charge.items must be an array');
check('taxes missing', verdict(V::validate(array_diff_key(worked_charge(), ['taxes' => true]), $rupiah_items, [])), 'charge.taxes must be an array');
check('a line without a name', verdict(V::validate(worked_charge(['items' => [['amount' => '12.23']]]), $rupiah_items, [])), 'charge.items[0].name must be a string');
check('a line that is not an object', verdict(V::validate(worked_charge(['items' => ['12.23']]), $rupiah_items, [])), 'charge.items[0] must be an object');

$snap = worked_charge()['snapshot'];
check('snapshot missing', verdict(V::validate(array_diff_key(worked_charge(), ['snapshot' => true]), $rupiah_items, [])), 'charge.snapshot must be an object');
check('clinicId as a string', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['clinicId' => '4'])]), $rupiah_items, [])),
    'charge.snapshot.clinicId must be a positive integer');
check('clinicId 0', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['clinicId' => 0])]), $rupiah_items, [])),
    'charge.snapshot.clinicId must be a positive integer');
check('fxRate 16.5', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['fxRate' => '16.5'])]), $rupiah_items, [])),
    'charge.snapshot.fxRate must be a number from 1000 to 100000');
check('markupPercent 150', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['markupPercent' => '150'])]), $rupiah_items, [])),
    'charge.snapshot.markupPercent must be a number from 0 to 100');
check('fixedFeeIdr missing', verdict(V::validate(worked_charge(['snapshot' => array_diff_key($snap, ['fixedFeeIdr' => true])]), $rupiah_items, [])),
    'charge.snapshot.fixedFeeIdr must be a number from 0 to 10000000');
check('an unknown source', verdict(V::validate(worked_charge(['snapshot' => array_merge($snap, ['source' => ['fxRate' => 'clinic', 'markupPercent' => 'guess', 'fixedFeeIdr' => 'clinic']])]), $rupiah_items, [])),
    'charge.snapshot.source.markupPercent must be one of clinic, global, default');

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-charge-validator.php
```

Expected: FAIL with `Fatal error: Uncaught Error: Failed opening required '/app/tests/../includes/class-praktiqu-endpoint-charge-validator.php'`.

- [ ] **Step 3: Write the class**

Create `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-charge-validator.php` with exactly this content:

```php
<?php
/**
 * ChargeValidator — checks the USD `charge` object Next.js sends to create_order
 * (2026-10-06 international clinic payment design, §4 step 1).
 *
 * Next.js computes every USD amount (one TypeScript function produces both the displayed
 * and the charged figures); the plugin only builds the WooCommerce order from the finished
 * lines. So this class never converts currency. It checks the shape, turns every amount
 * into integer cents FROM THE STRING (never through `(float) × 100`), and requires the
 * lines to sum to the total exactly. Floats are never summed or compared.
 *
 * Pure — no WordPress, no WooCommerce — so tests/test-charge-validator.php runs it in a
 * bare PHP container. It uses ClinicPaymentSettings' pure range constants for the snapshot.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// The test harness defines PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST so this file can be
// required outside WordPress. Everything else still exits without ABSPATH.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_CHARGE_VALIDATOR_TEST') || exit;

final class ChargeValidator
{
    private const SOURCES = ['clinic', 'global', 'default'];

    /**
     * "12.23" -> 1223. Only a string of digits, a dot and exactly two digits is accepted
     * (the `D` modifier stops `$` from matching before a trailing newline). A JSON number,
     * "12.3", "12.230", "1e3" and "-1.00" are all rejected with null.
     */
    public static function to_cents(mixed $amount): ?int
    {
        if (!is_string($amount) || preg_match('/^\d+\.\d{2}$/D', $amount) !== 1) {
            return null;
        }
        [$whole, $fraction] = explode('.', $amount);
        if (strlen($whole) > 15) {
            return null; // would overflow an int once scaled; no real charge is that large
        }
        return ((int) $whole) * 100 + (int) $fraction;
    }

    /** 1362 -> "13.62", 5 -> "0.05". */
    public static function cents_to_string(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $abs  = abs($cents);
        return sprintf('%s%d.%02d', $sign, intdiv($abs, 100), $abs % 100);
    }

    /**
     * @param array<string, mixed> $charge The decoded `charge` object.
     * @param array<int, mixed>    $items  The RUPIAH `items` of the same create_order input.
     * @param array<int, mixed>    $taxes  The RUPIAH `taxes` of the same create_order input.
     *
     * @return array{ok: true, items: list<array{name: string, cents: int}>, taxes: list<array{name: string, cents: int}>,
     *               fee: ?array{name: string, cents: int}, total_cents: int, snapshot: array<string, mixed>}
     *        |array{ok: false, message: string}
     */
    public static function validate(array $charge, array $items, array $taxes): array
    {
        if (($charge['currency'] ?? null) !== 'USD') {
            return self::fail('charge.currency must be "USD"');
        }

        $charge_items = $charge['items'] ?? null;
        if (!is_array($charge_items) || !array_is_list($charge_items)) {
            return self::fail('charge.items must be an array');
        }
        if (count($charge_items) !== count($items)) {
            return self::fail(sprintf('charge.items has %d entries but items has %d', count($charge_items), count($items)));
        }

        $charge_taxes = $charge['taxes'] ?? null;
        if (!is_array($charge_taxes) || !array_is_list($charge_taxes)) {
            return self::fail('charge.taxes must be an array');
        }
        // The same `<= 0` skip create_order() applies to rupiah taxes.
        $paid_taxes = 0;
        foreach ($taxes as $tax) {
            if (is_array($tax) && (float) ($tax['amount'] ?? 0) > 0) {
                $paid_taxes++;
            }
        }
        if (count($charge_taxes) !== $paid_taxes) {
            return self::fail(sprintf('charge.taxes has %d entries but %d rupiah taxes are above 0', count($charge_taxes), $paid_taxes));
        }

        $sum       = 0;
        $out_items = [];
        foreach ($charge_items as $i => $line) {
            $parsed = self::parse_line($line, sprintf('charge.items[%d]', $i));
            if (is_string($parsed)) {
                return self::fail($parsed);
            }
            // Item amounts may be 0.00 (a Rp 0 line next to a paid one keeps its 1:1 slot).
            $out_items[] = $parsed;
            $sum += $parsed['cents'];
        }

        $out_taxes = [];
        foreach ($charge_taxes as $i => $line) {
            $parsed = self::parse_line($line, sprintf('charge.taxes[%d]', $i));
            if (is_string($parsed)) {
                return self::fail($parsed);
            }
            if ($parsed['cents'] <= 0) {
                return self::fail(sprintf('charge.taxes[%d].amount must be greater than 0', $i));
            }
            $out_taxes[] = $parsed;
            $sum += $parsed['cents'];
        }

        $fee = null;
        if (($charge['fee'] ?? null) !== null) {
            $fee = self::parse_line($charge['fee'], 'charge.fee');
            if (is_string($fee)) {
                return self::fail($fee);
            }
            if ($fee['cents'] <= 0) {
                return self::fail('charge.fee.amount must be greater than 0');
            }
            $sum += $fee['cents'];
        }

        $total_cents = self::to_cents($charge['total'] ?? null);
        if ($total_cents === null) {
            return self::fail('charge.total must be a string like "13.62"');
        }
        if ($total_cents <= 0) {
            return self::fail('charge.total must be greater than 0');
        }
        if ($sum !== $total_cents) {
            return self::fail(sprintf(
                'charge lines sum to %s but charge.total is %s',
                self::cents_to_string($sum),
                self::cents_to_string($total_cents)
            ));
        }

        $snapshot = $charge['snapshot'] ?? null;
        $problem  = self::snapshot_problem($snapshot);
        if ($problem !== null) {
            return self::fail($problem);
        }

        return [
            'ok'          => true,
            'items'       => $out_items,
            'taxes'       => $out_taxes,
            'fee'         => $fee,
            'total_cents' => $total_cents,
            'snapshot'    => $snapshot,
        ];
    }

    /** @return array{name: string, cents: int}|string The line, or the problem. */
    private static function parse_line(mixed $line, string $label): array|string
    {
        if (!is_array($line)) {
            return sprintf('%s must be an object', $label);
        }
        if (!is_string($line['name'] ?? null)) {
            return sprintf('%s.name must be a string', $label);
        }
        $cents = self::to_cents($line['amount'] ?? null);
        if ($cents === null) {
            return sprintf('%s.amount must be a string like "12.23"', $label);
        }
        return ['name' => $line['name'], 'cents' => $cents];
    }

    /**
     * The snapshot is written to order meta and used for the effective fxRate, so its numbers
     * are range-checked too. clinicId is a JSON integer; the rest are decimal strings.
     */
    private static function snapshot_problem(mixed $snapshot): ?string
    {
        if (!is_array($snapshot)) {
            return 'charge.snapshot must be an object';
        }
        $clinic_id = $snapshot['clinicId'] ?? null;
        if (!is_int($clinic_id) || $clinic_id <= 0) {
            return 'charge.snapshot.clinicId must be a positive integer';
        }
        if (!ClinicPaymentSettings::is_usable_rate($snapshot['fxRate'] ?? null)) {
            return 'charge.snapshot.fxRate must be a number from 1000 to 100000';
        }
        $markup = $snapshot['markupPercent'] ?? null;
        if (!is_numeric($markup) || (float) $markup < 0 || (float) $markup > ClinicPaymentSettings::MARKUP_MAX) {
            return 'charge.snapshot.markupPercent must be a number from 0 to 100';
        }
        $fee = $snapshot['fixedFeeIdr'] ?? null;
        if (!is_numeric($fee) || (float) $fee < 0 || (float) $fee > ClinicPaymentSettings::FEE_MAX) {
            return 'charge.snapshot.fixedFeeIdr must be a number from 0 to 10000000';
        }
        $source = $snapshot['source'] ?? null;
        if (!is_array($source)) {
            return 'charge.snapshot.source must be an object';
        }
        foreach (['fxRate', 'markupPercent', 'fixedFeeIdr'] as $key) {
            if (!in_array($source[$key] ?? null, self::SOURCES, true)) {
                return sprintf('charge.snapshot.source.%s must be one of clinic, global, default', $key);
            }
        }
        return null;
    }

    /** @return array{ok: false, message: string} */
    private static function fail(string $message): array
    {
        return ['ok' => false, 'message' => $message];
    }
}
```

- [ ] **Step 4: Load the class in the plugin bootstrap**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` replace:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-clinic-payment-settings.php';
```

with:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-charge-validator.php';
```

- [ ] **Step 5: Run the test and lint**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l includes/class-praktiqu-endpoint-charge-validator.php && php -l praktiqu-endpoint.php && php tests/test-charge-validator.php | tail -1'
```

Expected: `No syntax errors detected` twice, then `ALL PASS` (53 `ok` lines in the full output).

- [ ] **Step 6: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-charge-validator.php Wordpress-Plugin/praktiqu-endpoint/tests/test-charge-validator.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php && git commit -F - <<'EOF'
feat(plugin): validator charge USD dari Next.js dalam sen bulat

ChargeValidator memeriksa bentuk objek charge (USD, jumlah baris sama
dengan rupiah, pajak <= 0 dilewati, fee opsional) dan mengubah tiap nominal
menjadi sen dari STRING-nya, bukan lewat float. Total harus sama persis
dengan jumlah baris. Murni, diuji di container PHP kosong.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with 3 files changed.

---

### Task A4: `create_order` charge path, `/payments/order` args, version 1.7.0

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` (lines 31-40 docblock; after line 54 the method check; line 71 `if ($is_foreign) {`; lines 133-165 the line loops; lines 190-192 the fx meta; lines 229-235 right after `calculate_totals()`; line 351 before the `resolve_gateway()` docblock)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` (lines 338-343, the `/payments/order` route)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (lines 6 and 19, version)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt` (line 7 Stable tag; the `== Changelog ==` heading)
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-payments-create-order.php`

All paths are relative to `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional`. Requires Tasks A1, A2 and A3. Never touch a database, WooCommerce or a remote server; the WooCommerce-dependent parts are covered by in-memory fakes in the test plus the manual rollout check in Step 9.

**Interfaces:**
- Consumes: `ChargeValidator::validate(array, array, array): array`, `ChargeValidator::cents_to_string(int): string` (Task A3); `ClinicPaymentSettings::get(int): ?array` (Task A1).
- Produces (what the Next.js part relies on):
  - `POST /praktiqu/v1/payments/order` route gains `'args' => ['charge' => ['type' => 'object', 'required' => false]]` only.
  - `Payments::create_order(array $input): array|\WP_Error` with `charge`: 400 `invalid_charge` (also when method is `xendit`, and for any ChargeValidator failure), 409 `clinic_not_international` (clinic option missing, undecodable, or `international !== true`), 502 `charge_mismatch` (WooCommerce total in cents ≠ `charge.total` cents, checked right after `calculate_totals()` and before `resolve_gateway()`; the order is set to `cancelled` first; the gateway is never called). `invalid_charge` and `clinic_not_international` create no WooCommerce order.
  - New order meta: `praktiqu_clinic_id`, `praktiqu_fixed_fee_idr`, `praktiqu_fx_source` (JSON of `snapshot.source`). Existing `praktiqu_fx_rate` / `praktiqu_markup_percent` come from the snapshot.
  - Response shape unchanged: `orderId`, `checkoutUrl`, `chargedAmount`, `chargedCurrency`, `fxRate` where `fxRate` = snapshot fxRate / (1 + markupPercent/100).
  - Without `charge` (or with `charge: null` reaching the handler) the legacy global-rate path runs unchanged.
  - Plugin version `1.7.0` (header, `PRAKTIQU_ENDPOINT_VERSION`, readme Stable tag); `/health` reports it.

- [ ] **Step 1: Write the failing test**

Create `Wordpress-Plugin/praktiqu-endpoint/tests/test-payments-create-order.php` with exactly this content:

```php
<?php
/**
 * Assertions for Payments::create_order()'s `charge` path (2026-10-06 international clinic
 * design §4) and a regression check of the legacy global-rate path. Plain PHP — no PHPUnit,
 * no real WordPress or WooCommerce — runs in a bare `php:8.4-cli` container.
 *
 * The harness loads the real classes unmodified, like test-service-authenticate.php. It
 * shims only what create_order() touches, as small in-memory fakes:
 *   - WC_Order / WC_Product_Simple / WC_Order_Item_Fee / WC_Payment_Gateway / WC();
 *     FakeOrder::calculate_totals() sums the lines and adds $GLOBALS['__wc_extra_tax'],
 *     which stands in for WooCommerce applying its own tax rates;
 *   - the gateway counts process_payment() calls, so a test can prove PayPal was never
 *     contacted;
 *   - get_option() over a plain array, wp_json_encode() as json_encode().
 * It proves the plugin's own control flow (validation order, which order gets cancelled,
 * which meta is written, what is returned). It does NOT prove WooCommerce's real totals
 * maths — that stays a manual check against a WooCommerce install.
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class WooCommerce
{
}

final class WP_Error
{
    public function __construct(public string $code = '', public string $message = '', public mixed $data = null)
    {
    }

    public function get_error_code(): string
    {
        return $this->code;
    }

    public function get_error_message(): string
    {
        return $this->message;
    }

    public function get_error_data(): mixed
    {
        return $this->data;
    }
}

function is_wp_error($thing): bool
{
    return $thing instanceof WP_Error;
}

$GLOBALS['__praktiqu_test_options'] = [];
$GLOBALS['__wc_orders']             = [];
$GLOBALS['__wc_products']           = [];
$GLOBALS['__wc_extra_tax']          = 0.0;
$GLOBALS['__filters']               = [];

function get_option(string $name, $default = false)
{
    return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
        ? $GLOBALS['__praktiqu_test_options'][$name]
        : $default;
}

function wp_json_encode($data)
{
    return json_encode($data);
}

function esc_url_raw(string $url): string
{
    return $url;
}

function add_filter(string $hook, $callback, int $priority = 10, int $args = 1): bool
{
    $GLOBALS['__filters'][$hook] = ($GLOBALS['__filters'][$hook] ?? 0) + 1;
    return true;
}

function remove_filter(string $hook, $callback, int $priority = 10): bool
{
    $GLOBALS['__filters'][$hook] = ($GLOBALS['__filters'][$hook] ?? 0) - 1;
    return true;
}

function get_woocommerce_currency(): string
{
    return 'IDR';
}

function wc_clear_notices(): void
{
}

class WC_Order
{
    public string $currency = 'IDR';
    public string $status = 'pending';
    /** @var list<string> */
    public array $notes = [];
    /** @var list<array{0: string, 1: string}> [name, price] */
    public array $product_lines = [];
    /** @var list<array{0: string, 1: string}> [name, total] */
    public array $fee_lines = [];
    /** @var array<string, mixed> */
    public array $meta = [];
    public float $total = 0.0;
    public mixed $payment_method = null;

    public function __construct(public int $id)
    {
    }

    public function get_id(): int
    {
        return $this->id;
    }

    public function set_currency(string $currency): void
    {
        $this->currency = $currency;
    }

    public function get_currency(): string
    {
        return $this->currency;
    }

    public function add_product($product, int $qty): void
    {
        $this->product_lines[] = [$product->name, $product->price];
    }

    public function add_item($item): void
    {
        $this->fee_lines[] = [$item->name, $item->total];
    }

    public function set_billing_email(string $email): void
    {
    }

    public function update_meta_data(string $key, $value): void
    {
        $this->meta[$key] = $value;
    }

    public function get_meta(string $key)
    {
        return $this->meta[$key] ?? '';
    }

    public function calculate_totals(): void
    {
        $total = $GLOBALS['__wc_extra_tax'];
        foreach ($this->product_lines as [, $price]) {
            $total += (float) $price;
        }
        foreach ($this->fee_lines as [, $line_total]) {
            $total += (float) $line_total;
        }
        $this->total = round($total, 2);
    }

    public function save(): int
    {
        return $this->id;
    }

    public function get_total(): float
    {
        return $this->total;
    }

    public function update_status(string $status, string $note = ''): void
    {
        $this->status  = $status;
        $this->notes[] = $note;
    }

    public function payment_complete(): void
    {
        $this->status = 'processing';
    }

    public function set_payment_method($gateway): void
    {
        $this->payment_method = $gateway;
    }

    public function get_checkout_order_received_url(): string
    {
        return 'https://wp.test/order-received/' . $this->id;
    }
}

function wc_create_order(): WC_Order
{
    $order = new WC_Order(1000 + count($GLOBALS['__wc_orders']));
    $GLOBALS['__wc_orders'][] = $order;
    return $order;
}

class WC_Product_Simple
{
    public string $name = '';
    public string $price = '';

    public function set_name(string $name): void
    {
        $this->name = $name;
    }

    public function set_price(string $price): void
    {
        $this->price = $price;
    }

    public function set_status(string $s): void
    {
    }

    public function set_regular_price(string $p): void
    {
    }

    public function set_virtual(bool $v): void
    {
    }

    public function set_sold_individually(bool $v): void
    {
    }

    public function set_catalog_visibility(string $v): void
    {
    }

    public function set_manage_stock(bool $v): void
    {
    }

    public function set_stock_status(string $v): void
    {
    }

    public function save(): int
    {
        $id = 500 + count($GLOBALS['__wc_products']);
        $GLOBALS['__wc_products'][$id] = $this;
        return $id;
    }
}

function wc_get_product(int $id): WC_Product_Simple
{
    return $GLOBALS['__wc_products'][$id];
}

class WC_Order_Item_Fee
{
    public string $name = '';
    public string $total = '';

    public function set_name(string $name): void
    {
        $this->name = $name;
    }

    public function set_amount(string $amount): void
    {
    }

    public function set_total(string $total): void
    {
        $this->total = $total;
    }
}

class WC_Payment_Gateway
{
    public string $enabled = 'yes';
    public string $id = 'ppcp-gateway';
    public int $calls = 0;

    public function process_payment(int $order_id): array
    {
        $this->calls++;
        return ['result' => 'success', 'redirect' => 'https://paypal.test/checkout/' . $order_id];
    }
}

$GLOBALS['__gateway'] = new WC_Payment_Gateway();

final class FakeGateways
{
    public function payment_gateways(): array
    {
        return [$GLOBALS['__gateway']];
    }
}

final class FakeWC
{
    public function payment_gateways(): FakeGateways
    {
        return new FakeGateways();
    }
}

function WC(): FakeWC
{
    return new FakeWC();
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-money.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-charge-validator.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-payments.php';

use PraktiQU\Endpoint\Payments;

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

/**
 * Reset the fakes, then run create_order(). $clinic_option is clinic 4's raw stored value;
 * null = absent. $global_rate is the raw global rate option ('' = unset).
 */
function run(array $input, mixed $clinic_option, float $extra_tax = 0.0, string $global_rate = '18000')
{
    $GLOBALS['__wc_orders']    = [];
    $GLOBALS['__wc_products']  = [];
    $GLOBALS['__wc_extra_tax'] = $extra_tax;
    $GLOBALS['__filters']      = [];
    $GLOBALS['__gateway']->calls = 0;
    $GLOBALS['__praktiqu_test_options'] = [
        'praktiqu_endpoint_paypal_idr_rate'       => $global_rate,
        'praktiqu_endpoint_paypal_markup_percent' => '10',
    ];
    if ($clinic_option !== null) {
        $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] = $clinic_option;
    }
    return (new Payments())->create_order($input);
}

/** [status, code] of a WP_Error, or 'ok'. */
function error_of($result)
{
    return $result instanceof WP_Error ? [$result->get_error_data()['status'] ?? null, $result->get_error_code()] : 'ok';
}

function last_order(): ?WC_Order
{
    $orders = $GLOBALS['__wc_orders'];
    return $orders === [] ? null : $orders[count($orders) - 1];
}

/** The §2 worked example as Next.js sends it (plus a tax line). */
function input(array $override = []): array
{
    return array_merge([
        'source'        => 'public',
        'appointmentId' => '77',
        'customerEmail' => 'pasien@klinik.test',
        'method'        => 'paypal',
        'items'         => [['name' => 'Konsultasi', 'price' => 200000]],
        'taxes'         => [['name' => 'PPN', 'amount' => 20000]],
        'returnUrl'     => 'https://fe.test/kembali',
        'cancelUrl'     => 'https://fe.test/batal',
        'charge'        => [
            'currency' => 'USD',
            'items'    => [['name' => 'Konsultasi', 'amount' => '12.23']],
            'taxes'    => [['name' => 'PPN', 'amount' => '1.23']],
            'fee'      => ['name' => 'International service fee', 'amount' => '1.39'],
            'total'    => '14.85',
            'snapshot' => [
                'clinicId'      => 4,
                'fxRate'        => '18000',
                'markupPercent' => '10',
                'fixedFeeIdr'   => '25000',
                'source'        => ['fxRate' => 'clinic', 'markupPercent' => 'global', 'fixedFeeIdr' => 'clinic'],
            ],
        ],
    ], $override);
}

$international = '{"international":true,"fx_rate":18000,"markup_percent":null,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}';

echo "create_order rejects a bad charge before any WooCommerce order exists\n";
check('charge with xendit -> 400 invalid_charge', error_of(run(input(['method' => 'xendit']), $international)), [400, 'invalid_charge']);
check('... and no order was created', last_order(), null);
$bad_sum = input();
$bad_sum['charge']['total'] = '14.86';
$result = run($bad_sum, $international);
check('mismatched line sum -> 400 invalid_charge', error_of($result), [400, 'invalid_charge']);
check('... with the validator message', $result instanceof WP_Error ? $result->get_error_message() : null, 'charge lines sum to 14.85 but charge.total is 14.86');
check('... and no order was created', last_order(), null);
check('charge as a string -> 400 invalid_charge', error_of(run(input(['charge' => 'USD 14.85']), $international)), [400, 'invalid_charge']);

echo "\ncreate_order defence in depth: the clinic option must say international\n";
check('option missing -> 409 clinic_not_international', error_of(run(input(), null)), [409, 'clinic_not_international']);
check('... and no order was created', last_order(), null);
check('international false -> 409', error_of(run(input(), '{"international":false,"fx_rate":18000,"markup_percent":null,"fixed_fee_idr":null,"updated_at":"x","updated_by":null}')), [409, 'clinic_not_international']);
check('a serialized (array) option -> 409', error_of(run(input(), ['international' => true])), [409, 'clinic_not_international']);
check('malformed JSON -> 409', error_of(run(input(), '{"international":tru')), [409, 'clinic_not_international']);

echo "\ncreate_order builds the order from the charge lines\n";
$result = run(input(), $international);
$order  = last_order();
check('returns the order', is_array($result) ? $result['orderId'] : error_of($result), 1000);
check('checkoutUrl is the gateway redirect', $result['checkoutUrl'] ?? null, 'https://paypal.test/checkout/1000');
check('chargedAmount is the order total', $result['chargedAmount'] ?? null, 14.85);
check('chargedCurrency is USD', $result['chargedCurrency'] ?? null, 'USD');
check('fxRate is the effective snapshot rate', $result['fxRate'] ?? null, 18000.0 / (1 + 10.0 / 100));
check('order currency USD', $order?->currency, 'USD');
check('item line from cents', $order?->product_lines, [['Konsultasi', '12.23']]);
check('tax line and fee line from cents', $order?->fee_lines, [['PPN', '1.23'], ['International service fee', '1.39']]);
check('meta praktiqu_clinic_id', $order?->meta['praktiqu_clinic_id'] ?? null, '4');
check('meta praktiqu_fixed_fee_idr', $order?->meta['praktiqu_fixed_fee_idr'] ?? null, '25000');
check('meta praktiqu_fx_source', $order?->meta['praktiqu_fx_source'] ?? null, '{"fxRate":"clinic","markupPercent":"global","fixedFeeIdr":"clinic"}');
check('meta praktiqu_fx_rate from the snapshot', $order?->meta['praktiqu_fx_rate'] ?? null, '18000');
check('meta praktiqu_markup_percent from the snapshot', $order?->meta['praktiqu_markup_percent'] ?? null, '10');
check('meta praktiqu_charge_currency', $order?->meta['praktiqu_charge_currency'] ?? null, 'USD');
check('meta praktiqu_expected_idr still from the rupiah lines', $order?->meta['praktiqu_expected_idr'] ?? null, '220000');
check('meta praktiqu_method', $order?->meta['praktiqu_method'] ?? null, 'paypal');
check('the gateway was called once', $GLOBALS['__gateway']->calls, 1);
check('the 2-decimal filter was removed again', $GLOBALS['__filters']['wc_get_price_decimals'] ?? null, 0);

$no_global = run(input(), $international, 0.0, '');
check('the charge path does not need the global rate', is_array($no_global) ? 'ok' : error_of($no_global), 'ok');

echo "\ncreate_order cancels on a total mismatch, before any gateway call\n";
$result = run(input(), $international, 0.50);
$order  = last_order();
check('WooCommerce added 0.50 of its own tax -> 502 charge_mismatch', error_of($result), [502, 'charge_mismatch']);
check('the order is cancelled', $order?->status, 'cancelled');
check('with a PraktiQU note', $order?->notes, ['PraktiQU: charge_mismatch, WooCommerce total 15.35 USD but charge.total 14.85 USD']);
check('PayPal is never contacted', $GLOBALS['__gateway']->calls, 0);

echo "\ncreate_order without charge keeps the legacy global-rate path\n";
$legacy = input();
unset($legacy['charge']);
$result = run($legacy, null);
$order  = last_order();
check('legacy paypal order succeeds without a clinic option', is_array($result) ? 'ok' : error_of($result), 'ok');
check('legacy item converted with Money (rate 18000, markup 10)', $order?->product_lines, [['Konsultasi', '12.23']]);
check('legacy tax converted with Money', $order?->fee_lines, [['PPN', '1.23']]);
check('legacy writes no clinic meta', array_key_exists('praktiqu_clinic_id', $order?->meta ?? []), false);
check('a null charge reaching create_order() counts as absent', is_array(run(input(['charge' => null]), null)) ? 'ok' : 'error', 'ok');
$xendit = input(['method' => 'xendit']);
unset($xendit['charge']);
$GLOBALS['__gateway']->id = 'xendit_invoice';
$result = run($xendit, null);
check('xendit without charge still works in IDR', [is_array($result) ? $result['chargedCurrency'] : error_of($result), last_order()?->product_lines], ['IDR', [['Konsultasi', '200000']]]);
$GLOBALS['__gateway']->id = 'ppcp-gateway';

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-payments-create-order.php
```

Expected: FAIL, last line `21 FAILURE(S)`. The current `create_order()` ignores `charge`. A xendit order with a charge succeeds instead of failing with `invalid_charge`. There is no `clinic_not_international` check. The lines are converted from rupiah instead of being taken from the charge, and the clinic meta is missing. A WooCommerce total mismatch still calls the gateway. With the global rate unset (`run(..., '')`), the paypal order fails with 503 instead of succeeding from the charge alone. The legacy-path checks at the end already pass.

- [ ] **Step 3: Document the new input in the `create_order()` docblock**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php` replace:

```php
    /**
     * Create a WooCommerce order for an appointment (public) or bill (session).
     *
     * @param array $input {
     *   source: 'public'|'session', appointmentId?: string, billId?: string,
     *   encounterId?: string, customerEmail: string,
     *   items: array<{name:string,price:number}>, taxes: array<{name:string,amount:number}>,
     *   returnUrl: string, cancelUrl: string
     * }
     */
```

with:

```php
    /**
     * Create a WooCommerce order for an appointment (public) or bill (session).
     *
     * @param array $input {
     *   source: 'public'|'session', appointmentId?: string, billId?: string,
     *   encounterId?: string, customerEmail: string, method?: 'xendit'|'paypal'|'card',
     *   items: array<{name:string,price:number}>, taxes: array<{name:string,amount:number}>,
     *   charge?: array{currency:'USD', items: array<{name:string,amount:string}>,
     *            taxes: array<{name:string,amount:string}>, fee?: array{name:string,amount:string},
     *            total: string, snapshot: array{clinicId:int, fxRate:string, markupPercent:string,
     *            fixedFeeIdr:string, source: array<string,string>}},
     *   returnUrl: string, cancelUrl: string
     * }
     *
     * `charge` (paypal/card only, 2026-10-06 international clinic design §4) carries the USD
     * lines Next.js already computed; the order is built from them as given. Without it,
     * paypal/card fall back to the legacy global-rate conversion, kept only for the deploy
     * transition and removed in the next plugin release.
     */
```

- [ ] **Step 4: Validate `charge` and check the clinic before any order exists**

In the same file replace:

```php
        // PayPal has no IDR (verified against the PPCP plugin's own supported list),
        // so paypal/card orders are priced in USD from a rate the clinic maintains
        // in wp-admin. Xendit orders stay in the store currency, untouched.
```

with:

```php
        // A validated `charge`, or null for xendit and for the legacy paypal/card path.
        // Everything here runs before wc_create_order(), so a rejected charge, like an
        // unknown method, creates no WooCommerce order at all. A null `charge` that reaches
        // this method counts as absent. Over REST it never does: the route declares
        // `charge` as type 'object', so WordPress answers `"charge": null` with its own 400
        // rest_invalid_param first. Next.js never sends null (it omits `charge`).
        $charge = null;
        if (($input['charge'] ?? null) !== null) {
            if ($method === 'xendit') {
                return new \WP_Error('invalid_charge', 'charge is only accepted for paypal or card', ['status' => 400]);
            }
            if (!is_array($input['charge'])) {
                return new \WP_Error('invalid_charge', 'charge must be an object', ['status' => 400]);
            }
            $checked = ChargeValidator::validate(
                $input['charge'],
                (array) ($input['items'] ?? []),
                (array) ($input['taxes'] ?? [])
            );
            if (!$checked['ok']) {
                return new \WP_Error('invalid_charge', $checked['message'], ['status' => 400]);
            }

            // Defence in depth against a Next.js bug, not against a compromised caller:
            // whoever holds the service token is trusted with the amounts. A missing or
            // undecodable option counts as not international.
            $clinic_id = (int) $checked['snapshot']['clinicId'];
            $settings  = ClinicPaymentSettings::get($clinic_id);
            if ($settings === null || ($settings['international'] ?? null) !== true) {
                return new \WP_Error(
                    'clinic_not_international',
                    sprintf('Clinic %d is not an international clinic', $clinic_id),
                    ['status' => 409]
                );
            }
            $charge = $checked;
        }

        // PayPal has no IDR (verified against the PPCP plugin's own supported list),
        // so paypal/card orders are priced in USD from a rate the clinic maintains
        // in wp-admin. Xendit orders stay in the store currency, untouched.
```

Then replace:

```php
        $is_foreign = ($method === 'paypal' || $method === 'card');
        $rate       = 0.0;
        $markup     = 0.0;
        if ($is_foreign) {
            $rate = (float) get_option('praktiqu_endpoint_paypal_idr_rate', '0');
```

with:

```php
        $is_foreign = ($method === 'paypal' || $method === 'card');
        $rate       = 0.0;
        $markup     = 0.0;
        if ($charge !== null) {
            // Only recorded (meta + the effective fxRate below); the amounts themselves
            // come finished in the charge lines. ChargeValidator range-checked both, so the
            // markup is within [0, 100] and the fxRate denominator is >= 1.
            $rate   = (float) $charge['snapshot']['fxRate'];
            $markup = (float) $charge['snapshot']['markupPercent'];
        } elseif ($is_foreign) {
            $rate = (float) get_option('praktiqu_endpoint_paypal_idr_rate', '0');
```

- [ ] **Step 5: Build the lines from the charge (cents), keep the legacy loops, add the meta and the total check**

In the same file replace the two line loops:

```php
        foreach ((array) ($input['items'] ?? []) as $item) {
            $price = (float) ($item['price'] ?? 0);
            if ($is_foreign) {
                $price = Money::idr_to_foreign($price, $rate, $markup);
            }
            $product = new \WC_Product_Simple();
            $product->set_name((string) ($item['name'] ?? 'Service'));
            $product->set_status('publish');
            $product->set_price((string) $price);
            $product->set_regular_price((string) $price);
            $product->set_virtual(true);
            $product->set_sold_individually(true);
            $product->set_catalog_visibility('hidden');
            $product->set_manage_stock(false);
            $product->set_stock_status('instock');
            $product_id = $product->save();
            $order->add_product(wc_get_product($product_id), 1);
        }

        foreach ((array) ($input['taxes'] ?? []) as $tax) {
            $amount = (float) ($tax['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            if ($is_foreign) {
                $amount = Money::idr_to_foreign($amount, $rate, $markup);
            }
            $fee = new \WC_Order_Item_Fee();
            $fee->set_name((string) ($tax['name'] ?? 'Tax'));
            $fee->set_amount((string) $amount);
            $fee->set_total((string) $amount);
            $order->add_item($fee);
        }
```

with:

```php
        if ($charge !== null) {
            // The USD lines exactly as Next.js computed them, from integer cents.
            foreach ($charge['items'] as $line) {
                $this->add_product_line($order, $line['name'], ChargeValidator::cents_to_string($line['cents']));
            }
            foreach ($charge['taxes'] as $line) {
                $this->add_fee_line($order, $line['name'], ChargeValidator::cents_to_string($line['cents']));
            }
            if ($charge['fee'] !== null) {
                // The fixed fee: its own line, already converted without the markup.
                $this->add_fee_line($order, $charge['fee']['name'], ChargeValidator::cents_to_string($charge['fee']['cents']));
            }
        } else {
            foreach ((array) ($input['items'] ?? []) as $item) {
                $price = (float) ($item['price'] ?? 0);
                if ($is_foreign) {
                    $price = Money::idr_to_foreign($price, $rate, $markup);
                }
                $this->add_product_line($order, (string) ($item['name'] ?? 'Service'), (string) $price);
            }

            foreach ((array) ($input['taxes'] ?? []) as $tax) {
                $amount = (float) ($tax['amount'] ?? 0);
                if ($amount <= 0) {
                    continue;
                }
                if ($is_foreign) {
                    $amount = Money::idr_to_foreign($amount, $rate, $markup);
                }
                $this->add_fee_line($order, (string) ($tax['name'] ?? 'Tax'), (string) $amount);
            }
        }
```

Then replace:

```php
            $order->update_meta_data('praktiqu_fx_rate', (string) $rate);
            $order->update_meta_data('praktiqu_markup_percent', (string) $markup);
        }
```

with:

```php
            $order->update_meta_data('praktiqu_fx_rate', (string) $rate);
            $order->update_meta_data('praktiqu_markup_percent', (string) $markup);
        }
        if ($charge !== null) {
            // The values this charge was priced with, so a later settings change can never
            // rewrite history. praktiqu_fx_source records where each came from.
            $order->update_meta_data('praktiqu_clinic_id', (string) $charge['snapshot']['clinicId']);
            $order->update_meta_data('praktiqu_fixed_fee_idr', (string) $charge['snapshot']['fixedFeeIdr']);
            $order->update_meta_data('praktiqu_fx_source', (string) wp_json_encode($charge['snapshot']['source']));
        }
```

Then replace (directly after the pinned `calculate_totals()`, before the existing `amount_collapsed` guard):

```php
        } finally {
            if ($is_foreign) {
                remove_filter('wc_get_price_decimals', $decimals_filter);
            }
        }

        // Guard against a rounding failure being mistaken for a free service:
```

with:

```php
        } finally {
            if ($is_foreign) {
                remove_filter('wc_get_price_decimals', $decimals_filter);
            }
        }

        // The charge's total check, before any gateway call (spec §4 step 4). It only checks
        // that WooCommerce kept the amounts it was given — e.g. it did not add its own tax
        // rates — it does not recompute the conversion. On a mismatch PayPal is never
        // contacted. The cancel fires payment.expired, which Next.js answers with 404
        // "Unknown order" because it writes no payment_orders row for a failed start.
        if ($charge !== null) {
            $order_cents = (int) round((float) $order->get_total() * 100);
            if ($order_cents !== $charge['total_cents']) {
                $order->update_status(
                    'cancelled',
                    sprintf(
                        'PraktiQU: charge_mismatch, WooCommerce total %s USD but charge.total %s USD',
                        ChargeValidator::cents_to_string($order_cents),
                        ChargeValidator::cents_to_string($charge['total_cents'])
                    )
                );
                return new \WP_Error(
                    'charge_mismatch',
                    sprintf(
                        'WooCommerce order total %s USD differs from charge.total %s USD',
                        ChargeValidator::cents_to_string($order_cents),
                        ChargeValidator::cents_to_string($charge['total_cents'])
                    ),
                    ['status' => 502]
                );
            }
        }

        // Guard against a rounding failure being mistaken for a free service:
```

Then add the two private helpers the loops now call — replace:

```php
    /**
     * The enabled WooCommerce gateway that serves a payment method.
```

with:

```php
    /**
     * One order line as a hidden virtual product (KiviCare `create_wc_direct_order` pattern).
     */
    private function add_product_line(\WC_Order $order, string $name, string $price): void
    {
        $product = new \WC_Product_Simple();
        $product->set_name($name);
        $product->set_status('publish');
        $product->set_price($price);
        $product->set_regular_price($price);
        $product->set_virtual(true);
        $product->set_sold_individually(true);
        $product->set_catalog_visibility('hidden');
        $product->set_manage_stock(false);
        $product->set_stock_status('instock');
        $product_id = $product->save();
        $order->add_product(wc_get_product($product_id), 1);
    }

    /**
     * One tax (or the international fixed fee) as a WC_Order_Item_Fee.
     */
    private function add_fee_line(\WC_Order $order, string $name, string $amount): void
    {
        $fee = new \WC_Order_Item_Fee();
        $fee->set_name($name);
        $fee->set_amount($amount);
        $fee->set_total($amount);
        $order->add_item($fee);
    }

    /**
     * The enabled WooCommerce gateway that serves a payment method.
```

- [ ] **Step 6: Run the test and lint**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'php -l includes/class-praktiqu-endpoint-payments.php && php tests/test-payments-create-order.php | tail -1'
```

Expected: `No syntax errors detected`, then `ALL PASS` (40 `ok` lines in the full output).

- [ ] **Step 7: Declare `charge` on the `/payments/order` route**

In `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` replace:

```php
        // POST /praktiqu/v1/payments/order — create a WC order (2026-07-14 payment feature)
        register_rest_route($ns, '/payments/order', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
        ]);
```

with:

```php
        // POST /praktiqu/v1/payments/order — create a WC order (2026-07-14 payment feature)
        register_rest_route($ns, '/payments/order', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_payment_order'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                // Only `charge` is declared (2026-10-06 international clinic design §4), as
                // 'object' -- the jobs-route incident above was 'array' vs 'object' -- and
                // with no nested `properties`: every nested check is done by
                // ChargeValidator in create_order() and fails as our own 400 invalid_charge,
                // never WP's generic rest_invalid_param. The legacy keys (items, taxes,
                // method, ...) stay undeclared so their loose handling does not change.
                'charge' => ['type' => 'object', 'required' => false],
            ],
        ]);
```

Note — over HTTP a body with `"charge": null` never reaches the handler. `WP_REST_Request::sanitize_params()` runs `rest_parse_request_arg()` on every declared key without skipping nulls, and `rest_is_object(null)` is false, so WordPress answers 400 `rest_invalid_param` (Next.js maps it to 502 `payment_start_failed`). This is the behaviour spec §4 now asks for (spec revised 2026-10-08): treating a null `charge` as absent would route a PayPal order down the legacy global-rate path and skip the clinic gate. Keep the schema exactly `['type' => 'object', 'required' => false]`; do NOT widen it to `['object','null']`. Only a null that reaches `create_order()` directly (the unit test) counts as absent. A null `fee` inside `charge` is unaffected (no nested `properties` are declared) and ChargeValidator treats it as absent.

- [ ] **Step 8: Bump the version to 1.7.0 and write the changelog**

In `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` replace:

```php
 * Version:           1.6.8
```

with:

```php
 * Version:           1.7.0
```

and replace:

```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.6.8');
```

with:

```php
define('PRAKTIQU_ENDPOINT_VERSION', '1.7.0');
```

In `Wordpress-Plugin/praktiqu-endpoint/readme.txt` replace:

```text
Stable tag: 1.6.8
```

with:

```text
Stable tag: 1.7.0
```

and replace:

```text
== Changelog ==

= 1.6.8 =
```

with:

```text
== Changelog ==

= 1.7.0 =
* International clinics. New GET|PUT /clinics/{id}/payment-settings stores one
  clinic's flag, FX rate, markup and fixed fee as a JSON string in the
  praktiqu_endpoint_clinic_{id}_payment option (autoload off). PUT answers 404
  clinic_not_found, 400 invalid_settings, 422 fx_rate_required or 500
  save_failed.
* POST /payments/order accepts an optional `charge` object for paypal/card:
  the USD lines PraktiQU already computed. The order is built from them as
  given, after checking the shape (400 invalid_charge) and that the clinic is
  international (409 clinic_not_international). If the WooCommerce total
  differs from charge.total the order is cancelled before PayPal is contacted
  (502 charge_mismatch). New order meta: praktiqu_clinic_id,
  praktiqu_fixed_fee_idr, praktiqu_fx_source. Without `charge` the old global
  rate path still runs; it is kept only for the deploy transition.
* The wp-admin FX rate and markup are now the global defaults, and the rate
  must be from 1,000 to 100,000 rupiah per 1 USD, written with digits only.
* Uninstall also removes every per-clinic payment option.
* Requires WooCommerce -> Settings -> General -> "Enable tax rates and
  calculations" OFF. With it on, WooCommerce adds its own tax to every
  charged order, the total no longer matches charge.total, and each such
  order is cancelled with charge_mismatch.

= 1.6.8 =
```

- [ ] **Step 9: Lint every changed file, run every plugin test, and record the manual rollout check**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && for f in praktiqu-endpoint.php uninstall.php includes/class-praktiqu-endpoint-clinic-payment-settings.php includes/class-praktiqu-endpoint-charge-validator.php includes/class-praktiqu-endpoint-payments.php includes/class-praktiqu-endpoint-rest-controller.php includes/class-praktiqu-endpoint-settings.php; do DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php -l "$f"; done
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint && for t in tests/test-*.php; do printf '%s: ' "$t"; DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php "$t" | tail -1; done
grep -n "1.7.0" /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/Wordpress-Plugin/praktiqu-endpoint/readme.txt
```

Expected: seven `No syntax errors detected`; `ALL PASS` for all ten test files (`test-charge-validator`, `test-clinic-payment-settings-rest`, `test-clinic-payment-settings`, `test-fx-rate-sanitizer`, `test-jobs-secret-sanitizer`, `test-jobs-webhook`, `test-money`, `test-payments-create-order`, `test-service-authenticate`, `test-uninstall`); grep shows `1.7.0` on praktiqu-endpoint.php lines 6 and 19 and readme.txt lines 7 and the `= 1.7.0 =` heading.

Do NOT run the following now. It is the manual check for rollout (spec §8 step 1, after the plugin is deployed to Hostinger with the md5 / tar backup / `php -l` / `cp` + `mv` method). It touches the live WordPress and needs the user's explicit go-ahead first. Deployment follows `docs/deploy/international-clinic-runbook.md` (written in Task B9). The table maps each plugin check to the runbook section that holds it — Task B9's runbook already contains all seven, so nothing has to be added there. Also paste this list into the plugin PR description.

| # | Check | Runbook section |
|---|---|---|
| 1 | Read-only, before deploying: wp-admin → WooCommerce → Settings → General, **"Enable tax rates and calculations" must be OFF**. If it is on, WooCommerce adds its own tax in `calculate_totals()`, and every charged order is cancelled with `charge_mismatch`. That fails closed, but it makes PayPal unusable. | §1 Pre-deploy checks, item 3 ("WooCommerce tax calculation is OFF") |
| 2 | `GET /wp-json/praktiqu/v1/health` with the service token → `"version":"1.7.0"`. | §2.1 step 6 (version + active) |
| 3 | `GET /wp-json/praktiqu/v1/clinics/{a real clinic id}/payment-settings` → `{"clinicId":…,"settings":null}`. | §2.1 step 7 (settings route smoke test) |
| 4 | `PUT …/clinics/999999/payment-settings` with any body → 404 `clinic_not_found`, and afterwards `SELECT COUNT(*) FROM wp_options WHERE option_name = 'praktiqu_endpoint_clinic_999999_payment';` → `0` (ask before the query). | §2.1 step 8 (server-side `curl -X PUT` with the token read on the server, then the count query) |
| 5 | On the sandbox test clinic only (spec §8 step 4, PPCP switched to sandbox): save `international` on, rate 18000, markup 10, fee 25000 → 200. The `option_value` of `praktiqu_endpoint_clinic_{id}_payment` starts with `{` (not `a:`), autoload off. (An identical re-save returning success is proven by the Task A1 unit test "identical re-save (update_option returns false) still succeeds"; the runbook does not repeat it live.) | §3 step 2 (flag one test clinic + the `option_value` query) |
| 6 | wp-admin → Settings → PraktiQU Endpoint: the rate label reads "Global default PayPal FX Rate (IDR per 1 USD)". **Saving `16.5` shows the "was not updated" notice and keeps the old value** (re-enter the old value afterwards only if it changed). | §2.1 step 9 (labels, then the `16.5` rejection) |
| 7 | In the sandbox end-to-end booking, the WooCommerce order has meta `praktiqu_clinic_id`, `praktiqu_fixed_fee_idr` and `praktiqu_fx_source`, currency USD, the service line, and an "International service fee" fee line. Their amounts equal the USD figures the booking page showed. | §3 step 5 (sandbox end to end: the WooCommerce order check) |

Check 1 is also written into the 1.7.0 changelog in `readme.txt` (Step 8), so it ships with the plugin even if the runbook is edited later.

- [ ] **Step 10: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-payments.php Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php Wordpress-Plugin/praktiqu-endpoint/readme.txt Wordpress-Plugin/praktiqu-endpoint/tests/test-payments-create-order.php && git commit -F - <<'EOF'
feat(payments): create_order membangun order USD dari charge Next.js, versi 1.7.0

Dengan charge (paypal/card), plugin memvalidasi bentuknya (400
invalid_charge, juga untuk xendit), memastikan opsi klinik international
(409 clinic_not_international), lalu membangun baris order dari sen apa
adanya. Total WooCommerce dicek tepat setelah calculate_totals dan sebelum
gateway; kalau beda, order dibatalkan dan 502 charge_mismatch, PayPal tidak
pernah dihubungi. Meta baru: praktiqu_clinic_id, praktiqu_fixed_fee_idr,
praktiqu_fx_source. Jalur global lama tetap jalan tanpa charge, hanya untuk
masa transisi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Expected: one commit with 5 files changed.

---

## Part B1 — Next.js: pricing and payment flow

### Task B0: Setup worktree Next.js — symlink node_modules dan baseline hijau

**Files:**
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/node_modules` (symlink to the main checkout's `node_modules`; never committed)
- Modify: no tracked file. Appends `/node_modules` to the shared git exclude file (`$(git rev-parse --git-common-dir)/info/exclude`), which is local git config.

**Interfaces:** Consumes: nothing. / Produces: a worktree where `npx vitest run` and `npx tsc` work. The Prisma client in the main checkout's `node_modules` matches this branch (this feature changes no Prisma schema). NEVER run `prisma db push`, `prisma migrate` or `prisma generate`: `DATABASE_URL` is the live WordPress database.

- [ ] **Step 1: Symlink node_modules**

```bash
ln -s /home/ahmad/projects/nextjs-appointment-praktiqu/node_modules /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/node_modules
ls /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/node_modules/.bin/vitest /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/node_modules/.bin/tsc
```

Expected: both paths print. If `ln` says "File exists", the symlink is already there — continue.

- [ ] **Step 2: Keep the symlink out of git**

`.gitignore` has `node_modules/` (trailing slash), which matches directories only; git sees a symlink as a file, so without this step `git status` lists `node_modules` as untracked.

```bash
EXCL="$(git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional rev-parse --path-format=absolute --git-common-dir)/info/exclude"
grep -qxF '/node_modules' "$EXCL" || echo '/node_modules' >> "$EXCL"
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional branch --show-current
```

Expected: `git status --short` prints nothing (or only files another task of this plan already left uncommitted — there should be none at this point); the branch is `feat/klinik-internasional`.

- [ ] **Step 3: Baseline payment tests**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments
```

Expected: `Test Files  7 passed (7)` and `Tests  97 passed (97)`. stderr noise such as `prisma:error ... Environment variable not found: DATABASE_URL` and `[jobs] enqueue failed: Error: ECONNREFUSED` is expected (the worktree has no `.env.test.local`; these suites mock Prisma or swallow logging writes). Only the summary lines matter. Do not copy `.env.test.local` into the worktree — no test in Tasks B1–B5 needs a database, except the one KcOption integration test of Task B2 (Step 14), which is run with the Docker test database's `DATABASE_URL` passed on its command line and skips itself without it.

- [ ] **Step 4: Baseline typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: no diagnostics, then `tsc exit=0` (about 15 s).

- [ ] **Step 5: Nothing to commit**

This task changes no tracked file; `git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short` prints nothing.

### Task B1: Modul harga USD murni — `intl-pricing.ts`

**Files:**
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts`
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/intl-pricing.test.ts` (new)

**Interfaces:** Consumes: `PaymentMethod` (type, `@/lib/wp-endpoint`), `PaymentLineItem` / `PaymentTaxLine` (types, `@/services/payments/payment.service`), `Prisma.Decimal` (`@prisma/client`). / Produces (exact contract names): `RATE_MIN`, `RATE_MAX`, `MARKUP_MAX`, `FEE_MAX`, `INTL_FEE_LINE_NAME`, `ALL_METHODS`, `XENDIT_ONLY`, `ValueSource`, `StoredClinicPayment`, `ParsedOption`, `isUsableRate(v: unknown): v is number`, `parseStoredOption(raw: string | null | undefined): ParsedOption`, `GlobalDefaults`, `parseGlobalDefaults(rateRaw: string | null, markupRaw: string | null): GlobalDefaults`, `ClinicPaymentSettings`, `resolveSettings(clinicId: number, parsed: ParsedOption, globals: GlobalDefaults): ClinicPaymentSettings`, `notInternational(clinicId: number): ClinicPaymentSettings`, `UsdLine`, `ChargeSnapshot`, `UsdQuote`, `buildUsdQuote(items, taxes, settings): UsdQuote | null`, `UsdGate`, `gateUsdPayment(items, taxes, settings): UsdGate`, `PublicUsdView`, `toUsdView(quote: UsdQuote | null): PublicUsdView | null`, `amountToCents(n: number): number`. `toCharge` is added in Task B3, together with the `WcCharge` type it returns.

Rules implemented here (spec §1–§2; later tasks rely on them):
- Pure module: no Prisma client call, no fetch, no logging. Money is `Prisma.Decimal`. Item/tax cents = `ceil(idr × (100 + markup) / rate)` (every multiplication first, ONE division, then ceil); fee cents = `ceil(fee × 100 / rate)` (no markup); every USD string is `Decimal.toFixed(2)`. `effectiveFxRate` = `rate × 100 / (100 + markup)` as a Decimal string (`'16363.636363636363636'` for 18,000 at 10%). `expectedIdr` = items + taxes above zero, without the fee.
- `parseStoredOption`: `null` / `undefined` / blank → `absent`; text starting with `a:` → `invalid` / `serialized`; unparseable JSON or a non-object → `invalid` / `malformed_json`; `international` not a boolean, `markup_percent` outside 0–100 or with more than 2 decimals, `fixed_fee_idr` not an integer in 0–10,000,000, `updated_by` not a positive integer, `updated_at` not a string, or `fx_rate` not a number → `invalid` / `invalid_field`. Missing nullable keys read as `null`. An out-of-range `fx_rate` is NOT an invalid field: spec §7 says such a clinic rate "counts as missing", so `resolveSettings` falls back to the global rate.
- `resolveSettings`: an `invalid` option → `notInternational` plus one problem starting `clinic_payment_option_<reason>` (rule 4 — never the globals). An `absent` option resolves like a stored `{ international: false }` with null fields: rate/markup/fee are still resolved (the settings page previews with the global rate) but `methods` is `['xendit']` and `buildUsdQuote` returns null because the flag is false. A global markup outside 0–100 that would be used makes `rate` null (rule 3); the markup then reads 0 / `default`. Range problems are reported only when the stored flag is true.

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/intl-pricing.test.ts` with exactly this content:

```ts
/**
 * International clinic pricing — the pure module (spec §1–§2, tests per §7).
 *
 * No mocks: intl-pricing does no I/O. The golden vectors come from the 2026-09-02
 * PayPal sandbox run and must be reproduced exactly.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_METHODS,
  INTL_FEE_LINE_NAME,
  XENDIT_ONLY,
  amountToCents,
  buildUsdQuote,
  gateUsdPayment,
  isUsableRate,
  notInternational,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  toUsdView,
  type GlobalDefaults,
} from '@/services/payments/intl-pricing';

const NO_GLOBALS: GlobalDefaults = { fxRate: null, markupPercent: null };

function option(fields: Record<string, unknown>): string {
  return JSON.stringify({
    international: true,
    fx_rate: null,
    markup_percent: null,
    fixed_fee_idr: null,
    updated_at: '2026-10-06T08:00:00+00:00',
    updated_by: 123,
    ...fields,
  });
}

/** Settings for a flagged clinic with its own rate/markup/fee. */
function intl(rate: number | null, markup: number | null, fee: number | null = null, clinicId = 4) {
  return resolveSettings(
    clinicId,
    parseStoredOption(option({ fx_rate: rate, markup_percent: markup, fixed_fee_idr: fee })),
    NO_GLOBALS,
  );
}

describe('buildUsdQuote — golden vectors', () => {
  it.each([
    [800_000, 18_000, 10, '48.89'],
    [900_000, 18_000, 10, '55.00'],
    [200_000, 18_000, 10, '12.23'],
    [200_000, 18_000, 0, '11.12'],
    // A divide-first implementation gives 6.01 here.
    [90_000, 16_500, 10, '6.00'],
  ])('Rp %i at %i with %i%% markup is $%s', (idr, rate, markup, usd) => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: idr }], [], intl(rate, markup));
    expect(quote).not.toBeNull();
    expect(quote!.lines).toEqual([{ kind: 'item', name: 'Konsultasi', idr, usd }]);
    expect(quote!.totalUsd).toBe(usd);
  });
});

describe('buildUsdQuote — worked example (rate 18,000, markup 10%, fee Rp 25,000)', () => {
  it('produces 12.23 + 1.39 = 13.62 with the snapshot and effective rate', () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [], intl(18_000, 10, 25_000));

    expect(quote).toEqual({
      lines: [
        { kind: 'item', name: 'Konsultasi', idr: 200_000, usd: '12.23' },
        { kind: 'fee', name: INTL_FEE_LINE_NAME, idr: 25_000, usd: '1.39' },
      ],
      totalUsd: '13.62',
      totalCents: 1362,
      expectedIdr: 200_000,
      effectiveFxRate: '16363.636363636363636',
      snapshot: {
        clinicId: 4,
        fxRate: '18000',
        markupPercent: '10',
        fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
  });
});

describe('buildUsdQuote — lines', () => {
  it('does not apply the markup to the fixed fee', () => {
    // 18,000 / 18,000 = exactly 100 cents; with the 50% markup it would be 150.
    const quote = buildUsdQuote([{ name: 'Svc', price: 180_000 }], [], intl(18_000, 50, 18_000));
    expect(quote!.lines[1]).toEqual({ kind: 'fee', name: INTL_FEE_LINE_NAME, idr: 18_000, usd: '1.00' });
  });

  it('adds no fee line when the fee is 0', () => {
    const quote = buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10, 0));
    expect(quote!.lines.map((l) => l.kind)).toEqual(['item']);
    expect(quote!.totalUsd).toBe('12.23');
  });

  it('keeps a 0.00 line for a Rp 0 item next to a paid item, so counts match', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }, { name: 'Gratis', price: 0 }],
      [],
      intl(18_000, 10),
    );
    expect(quote!.lines).toEqual([
      { kind: 'item', name: 'Svc', idr: 200_000, usd: '12.23' },
      { kind: 'item', name: 'Gratis', idr: 0, usd: '0.00' },
    ]);
  });

  it('skips a tax of 0 or less and converts a positive tax with the markup', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }],
      [{ name: 'Zero', amount: 0 }, { name: 'Negative', amount: -500 }, { name: 'PPN', amount: 22_000 }],
      intl(18_000, 10),
    );
    // ceil(22000 × 110 / 18000) = ceil(134.4…) = 135
    expect(quote!.lines).toEqual([
      { kind: 'item', name: 'Svc', idr: 200_000, usd: '12.23' },
      { kind: 'tax', name: 'PPN', idr: 22_000, usd: '1.35' },
    ]);
    expect(quote!.totalUsd).toBe('13.58');
    expect(quote!.totalCents).toBe(1358);
    expect(quote!.expectedIdr).toBe(222_000);
  });

  it('returns null for a free order even when the clinic has a fee', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 0 }], [], intl(18_000, 10, 25_000))).toBeNull();
  });

  it('returns null for a clinic that is not international', () => {
    const settings = resolveSettings(4, parseStoredOption(option({ international: false, fx_rate: 18_000 })), NO_GLOBALS);
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], settings)).toBeNull();
  });

  it('returns null when no rate is usable', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(null, 10))).toBeNull();
  });

  it('gives the market rate itself as the effective rate when there is no markup', () => {
    expect(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 0))!.effectiveFxRate).toBe('18000');
  });
});

describe('resolveSettings — value sources', () => {
  it('uses the clinic values and marks them clinic', () => {
    const s = intl(16_500, 12.5, 25_000);
    expect(s.international).toBe(true);
    expect(s.methods).toEqual(ALL_METHODS);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.markupPercent.toString()).toBe('12.5');
    expect(s.fixedFeeIdr.toString()).toBe('25000');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(s.problems).toEqual([]);
  });

  it('falls back to the global rate and markup, and to a 0 fee', () => {
    const s = resolveSettings(4, parseStoredOption(option({})), { fxRate: 18_000, markupPercent: 10 });
    expect(s.rate!.toString()).toBe('18000');
    expect(s.markupPercent.toString()).toBe('10');
    expect(s.fixedFeeIdr.toString()).toBe('0');
    expect(s.source).toEqual({ fxRate: 'global', markupPercent: 'global', fixedFeeIdr: 'default' });
  });

  it('defaults the markup to 0 when neither the clinic nor the global has one', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), NO_GLOBALS);
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.source.markupPercent).toBe('default');
  });

  it('resolves the values even when the flag is off, but offers Xendit only', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false })), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.rate!.toString()).toBe('18000');
    expect(s.source.fxRate).toBe('global');
  });

  it('treats a missing option as not international (rule 1) and logs nothing', () => {
    const s = resolveSettings(4, parseStoredOption(null), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems).toEqual([]);
  });
});

describe('resolveSettings — rate validation on read', () => {
  it.each([16.5, 500_000])('a clinic rate of %s counts as missing and falls back to the global', (bad) => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: bad })), { fxRate: 16_500, markupPercent: null });
    expect(s.rate!.toString()).toBe('16500');
    expect(s.source.fxRate).toBe('global');
    expect(s.problems.join(' ')).toContain(`fx_rate ${bad}`);
  });

  it.each([16.5, 500_000])('a global rate of %s counts as missing: international stays true, no rate (rule 3)', (bad) => {
    const s = resolveSettings(4, parseStoredOption(option({})), { fxRate: bad, markupPercent: null });
    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.source.fxRate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.problems.join(' ')).toContain(`global fx rate ${bad}`);
  });

  it('a global markup of 150 that would be used voids the rate (rule 3)', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), { fxRate: null, markupPercent: 150 });
    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.problems.join(' ')).toContain('global markup 150');

    // More than 2 decimals is treated exactly like out of range.
    const d = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000 })), { fxRate: null, markupPercent: 10.125 });
    expect(d.rate).toBeNull();
    expect(d.methods).toEqual(XENDIT_ONLY);
    expect(d.problems.join(' ')).toContain('global markup 10.125');
  });

  it('a global markup of 150 is harmless when the clinic has its own markup', () => {
    const s = resolveSettings(4, parseStoredOption(option({ fx_rate: 18_000, markup_percent: 10 })), { fxRate: null, markupPercent: 150 });
    expect(s.rate!.toString()).toBe('18000');
    expect(s.problems).toEqual([]);
  });

  it('reports no range problems for a clinic that is not flagged', () => {
    const s = resolveSettings(4, parseStoredOption(option({ international: false })), { fxRate: 500_000, markupPercent: 150 });
    expect(s.problems).toEqual([]);
  });
});

describe('parseStoredOption — fail closed', () => {
  it('reads null, undefined and an empty string as absent', () => {
    expect(parseStoredOption(null)).toEqual({ status: 'absent' });
    expect(parseStoredOption(undefined)).toEqual({ status: 'absent' });
    expect(parseStoredOption('  ')).toEqual({ status: 'absent' });
  });

  it('maps snake_case storage to camelCase', () => {
    expect(parseStoredOption(option({ fx_rate: 16_500, markup_percent: 10, fixed_fee_idr: 25_000 }))).toEqual({
      status: 'ok',
      value: {
        international: true,
        fxRate: 16_500,
        markupPercent: 10,
        fixedFeeIdr: 25_000,
        updatedAt: '2026-10-06T08:00:00+00:00',
        updatedBy: 123,
      },
    });
  });

  it('treats missing nullable keys as null', () => {
    expect(parseStoredOption('{"international":true}')).toEqual({
      status: 'ok',
      value: { international: true, fxRate: null, markupPercent: null, fixedFeeIdr: null, updatedAt: null, updatedBy: null },
    });
  });

  it('flags malformed JSON', () => {
    expect(parseStoredOption('{"international":tru')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
  });

  it('flags JSON that is not an object', () => {
    expect(parseStoredOption('[1,2]')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
    expect(parseStoredOption('null')).toMatchObject({ status: 'invalid', reason: 'malformed_json' });
  });

  it('flags a PHP-serialized value', () => {
    const serialized = 'a:6:{s:13:"international";b:1;s:7:"fx_rate";i:16500;s:14:"markup_percent";i:10;s:13:"fixed_fee_idr";i:0;s:10:"updated_at";s:0:"";s:10:"updated_by";N;}';
    expect(parseStoredOption(serialized)).toMatchObject({ status: 'invalid', reason: 'serialized' });
  });

  it.each([
    ['international is not a boolean', { international: 'yes' }],
    ['international is missing', { international: undefined }],
    ['fx_rate is a string', { fx_rate: '16500' }],
    ['markup above 100', { markup_percent: 150 }],
    ['markup below 0', { markup_percent: -1 }],
    ['markup with 3 decimals', { markup_percent: 10.125 }],
    ['fee is not an integer', { fixed_fee_idr: 1.5 }],
    ['fee below 0', { fixed_fee_idr: -1 }],
    ['fee above 10,000,000', { fixed_fee_idr: 10_000_001 }],
    ['updated_by is 0', { updated_by: 0 }],
    ['updated_at is a number', { updated_at: 5 }],
  ])('flags an invalid field: %s', (_label, fields) => {
    expect(parseStoredOption(option(fields))).toMatchObject({ status: 'invalid', reason: 'invalid_field' });
  });

  it('accepts a markup with 2 decimals despite float noise', () => {
    expect(parseStoredOption(option({ markup_percent: 10.15 }))).toMatchObject({ status: 'ok' });
  });
});

describe('resolveSettings — an unusable option (rule 4)', () => {
  it.each([
    ['malformed_json', '{nope'],
    ['serialized', 'a:1:{s:13:"international";b:1;}'],
    ['invalid_field', option({ markup_percent: 150 })],
  ])('%s resolves to not international with a logged problem, never the globals', (reason, raw) => {
    const s = resolveSettings(4, parseStoredOption(raw), { fxRate: 18_000, markupPercent: 10 });
    expect(s.international).toBe(false);
    expect(s.methods).toEqual(XENDIT_ONLY);
    expect(s.rate).toBeNull();
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toContain(`clinic_payment_option_${reason}`);
  });
});

describe('notInternational', () => {
  it('is Xendit only, no rate, zero markup and fee', () => {
    const s = notInternational(7);
    expect(s).toMatchObject({
      clinicId: 7,
      international: false,
      methods: XENDIT_ONLY,
      rate: null,
      source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' },
      problems: [],
    });
    expect(s.markupPercent.toString()).toBe('0');
    expect(s.fixedFeeIdr.toString()).toBe('0');
  });
});

describe('parseGlobalDefaults', () => {
  it('parses numeric option strings', () => {
    expect(parseGlobalDefaults('16500', '10')).toEqual({ fxRate: 16_500, markupPercent: 10 });
    expect(parseGlobalDefaults(' 16500.50 ', '0')).toEqual({ fxRate: 16_500.5, markupPercent: 0 });
  });

  it('reads empty, missing and non-numeric values as null', () => {
    expect(parseGlobalDefaults('', null)).toEqual({ fxRate: null, markupPercent: null });
    expect(parseGlobalDefaults('abc', '10%')).toEqual({ fxRate: null, markupPercent: null });
  });

  it('keeps an out-of-range number so resolveSettings can report it', () => {
    expect(parseGlobalDefaults('500000', '150')).toEqual({ fxRate: 500_000, markupPercent: 150 });
  });
});

describe('isUsableRate', () => {
  it.each([
    [1000, true],
    [100_000, true],
    [16_500.25, true],
    [16_500.123, false],
    [100_000.01, false],
    [16.5, false],
    [Number.NaN, false],
    ['16500', false],
    [null, false],
  ])('%s -> %s', (v, expected) => {
    expect(isUsableRate(v)).toBe(expected);
  });
});

describe('gateUsdPayment', () => {
  const paid = [{ name: 'Svc', price: 200_000 }];
  const free = [{ name: 'Svc', price: 0 }];

  it('refuses a clinic that is not international, before looking at the rate', () => {
    expect(gateUsdPayment(paid, [], notInternational(4))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('refuses a free order, even when the rate is missing', () => {
    expect(gateUsdPayment(free, [], intl(null, 10))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('reports a missing rate for a flagged clinic (503, not 403)', () => {
    expect(gateUsdPayment(paid, [], intl(null, 10))).toEqual({ ok: false, reason: 'rate_missing' });
  });

  it('passes with the quote', () => {
    const gate = gateUsdPayment(paid, [], intl(18_000, 10, 25_000));
    expect(gate.ok).toBe(true);
    expect(gate.ok && gate.quote.totalUsd).toBe('13.62');
  });
});

describe('toUsdView', () => {
  it('is null for a null quote', () => {
    expect(toUsdView(null)).toBeNull();
  });

  it('sums the item lines into price and lists taxes, fee and total', () => {
    const quote = buildUsdQuote(
      [{ name: 'Svc', price: 200_000 }, { name: 'Extra', price: 90_000 }],
      [{ name: 'PPN', amount: 22_000 }],
      intl(18_000, 10, 25_000),
    );
    // 12.23 + ceil(90000 × 110 / 18000 = 550) 5.50 = 17.73; tax 1.35; fee 1.39
    expect(toUsdView(quote)).toEqual({
      price: '17.73',
      taxes: [{ name: 'PPN', amount: '1.35' }],
      fee: '1.39',
      total: '20.47',
    });
  });

  it('reports fee as null when there is no fee line', () => {
    const quote = buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10));
    expect(toUsdView(quote)).toEqual({ price: '12.23', taxes: [], fee: null, total: '12.23' });
  });
});

describe('amountToCents', () => {
  it('rounds float noise to whole cents', () => {
    expect(amountToCents(13.62)).toBe(1362);
    expect(amountToCents(0.29)).toBe(29);
    expect(amountToCents(55)).toBe(5500);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/intl-pricing.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/services/payments/intl-pricing' imported from …` (the module does not exist yet); `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the implementation**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` with exactly this content:

```ts
/**
 * International clinic pricing — pure.
 *
 * One function turns rupiah lines into the USD lines that are both displayed on the
 * booking page and sent to WooCommerce as `charge`, so the two figures cannot drift.
 * Nothing here touches the database or the network: the option strings are read by
 * `repositories/wp/clinic-payment-settings.repo.ts` and handed in.
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §1–§2.
 *
 * Money is `Prisma.Decimal`, never a float. The order of operations is fixed: every
 * multiplication first, then exactly ONE division, then `ceil`. Dividing first (the
 * plugin's old `(idr / rate) × (1 + markup/100) × 100`) can push an exact amount up a
 * cent — Rp 90,000 at 16,500 with 10% gives 601 cents instead of 600.
 */
import { Prisma } from '@prisma/client';
import type { PaymentMethod } from '@/lib/wp-endpoint';
import type { PaymentLineItem, PaymentTaxLine } from '@/services/payments/payment.service';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const RATE_MIN = 1000;
export const RATE_MAX = 100_000;
export const MARKUP_MAX = 100;
export const FEE_MAX = 10_000_000;
export const INTL_FEE_LINE_NAME = 'International service fee';
export const ALL_METHODS: PaymentMethod[] = ['xendit', 'paypal', 'card'];
export const XENDIT_ONLY: PaymentMethod[] = ['xendit'];
export type ValueSource = 'clinic' | 'global' | 'default';

export interface StoredClinicPayment {
  international: boolean;
  fxRate: number | null;
  markupPercent: number | null;
  fixedFeeIdr: number | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

export type ParsedOption =
  | { status: 'absent' }
  | { status: 'ok'; value: StoredClinicPayment }
  | { status: 'invalid'; reason: 'malformed_json' | 'serialized' | 'invalid_field'; detail: string };

/**
 * A usable rate is a finite number from 1,000 to 100,000 (rupiah per 1 USD) with at most
 * 2 decimals. The decimal limit is what keeps the single Decimal division exact (spec §2);
 * a many-decimal rate counts as missing, exactly like an out-of-range one.
 */
export function isUsableRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= RATE_MIN && v <= RATE_MAX && hasAtMostTwoDecimals(v);
}

/** At most two decimals, tolerant of binary float noise (10.15 * 100 = 1014.9999…). */
function hasAtMostTwoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function invalidField(detail: string): ParsedOption {
  return { status: 'invalid', reason: 'invalid_field', detail };
}

/**
 * Decode the per-clinic option (`praktiqu_endpoint_clinic_{id}_payment`).
 *
 * The plugin stores a JSON string with snake_case keys. Anything else fails closed:
 * a PHP-serialized value (`a:6:{…}`, what WordPress writes when handed an array),
 * unparseable JSON, a non-object, or a field that breaks the §1 rules. `fx_rate` is
 * only type-checked here — an out-of-range clinic rate "counts as missing" and falls
 * back to the global rate in `resolveSettings` (spec §7), it does not void the option.
 */
export function parseStoredOption(raw: string | null | undefined): ParsedOption {
  if (raw === null || raw === undefined || raw.trim() === '') return { status: 'absent' };
  const text = raw.trim();
  if (text.startsWith('a:')) {
    return { status: 'invalid', reason: 'serialized', detail: 'value is PHP-serialized, not JSON' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'malformed_json', detail: 'value is not valid JSON' };
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { status: 'invalid', reason: 'malformed_json', detail: 'value is not a JSON object' };
  }
  const o = decoded as Record<string, unknown>;

  if (typeof o.international !== 'boolean') return invalidField('international must be a boolean');

  const fxRate = o.fx_rate ?? null;
  if (fxRate !== null && (typeof fxRate !== 'number' || !Number.isFinite(fxRate))) {
    return invalidField('fx_rate must be a number or null');
  }

  const markup = o.markup_percent ?? null;
  if (markup !== null) {
    if (typeof markup !== 'number' || !Number.isFinite(markup) || markup < 0 || markup > MARKUP_MAX) {
      return invalidField('markup_percent must be a number from 0 to 100 or null');
    }
    if (!hasAtMostTwoDecimals(markup)) return invalidField('markup_percent has more than 2 decimals');
  }

  const fee = o.fixed_fee_idr ?? null;
  if (fee !== null && (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0 || fee > FEE_MAX)) {
    return invalidField('fixed_fee_idr must be an integer from 0 to 10000000 or null');
  }

  const updatedAt = o.updated_at ?? null;
  if (updatedAt !== null && typeof updatedAt !== 'string') return invalidField('updated_at must be a string or null');

  const updatedBy = o.updated_by ?? null;
  if (updatedBy !== null && (typeof updatedBy !== 'number' || !Number.isInteger(updatedBy) || updatedBy <= 0)) {
    return invalidField('updated_by must be a positive integer or null');
  }

  return {
    status: 'ok',
    value: {
      international: o.international,
      fxRate: fxRate as number | null,
      markupPercent: markup as number | null,
      fixedFeeIdr: fee as number | null,
      updatedAt: updatedAt as string | null,
      updatedBy: updatedBy as number | null,
    },
  };
}

export interface GlobalDefaults {
  fxRate: number | null;
  markupPercent: number | null;
}

/** WordPress stores option values as text. Empty or non-numeric means "not set". */
function parseOptionNumber(raw: string | null): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The two global options, parsed. Range is NOT checked here — `resolveSettings` does. */
export function parseGlobalDefaults(rateRaw: string | null, markupRaw: string | null): GlobalDefaults {
  return { fxRate: parseOptionNumber(rateRaw), markupPercent: parseOptionNumber(markupRaw) };
}

export interface ClinicPaymentSettings {
  clinicId: number;
  /** The stored flag (false for an absent or invalid option). */
  international: boolean;
  /** ALL_METHODS only when international && rate !== null, else XENDIT_ONLY. */
  methods: PaymentMethod[];
  /** Usable rate (clinic, else global) or null. */
  rate: Prisma.Decimal | null;
  /** Clinic, else valid global, else 0. */
  markupPercent: Prisma.Decimal;
  /** Clinic, else 0. */
  fixedFeeIdr: Prisma.Decimal;
  source: { fxRate: ValueSource | null; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
  /** Human-readable reasons to log. */
  problems: string[];
}

function dec(n: number): Decimal {
  return new Decimal(String(n));
}

/** Rule 1/5 fallback: rupiah and Xendit only. */
export function notInternational(clinicId: number): ClinicPaymentSettings {
  return {
    clinicId,
    international: false,
    methods: [...XENDIT_ONLY],
    rate: null,
    markupPercent: new Decimal(0),
    fixedFeeIdr: new Decimal(0),
    source: { fxRate: null, markupPercent: 'default', fixedFeeIdr: 'default' },
    problems: [],
  };
}

/**
 * Spec §1 rules 1–4.
 *
 * The rate, markup and fee are resolved whatever the flag, so the settings page can
 * preview them before a clinic is flagged; `methods` and `buildUsdQuote` still honour
 * the flag. An unusable option (rule 4) never falls back to the global values.
 * Range problems are only reported for a flagged clinic — for any other clinic they
 * change nothing and would only add a log row per page view.
 */
export function resolveSettings(clinicId: number, parsed: ParsedOption, globals: GlobalDefaults): ClinicPaymentSettings {
  if (parsed.status === 'invalid') {
    return {
      ...notInternational(clinicId),
      problems: [`clinic_payment_option_${parsed.reason}: clinic ${clinicId}: ${parsed.detail}`],
    };
  }

  const stored: StoredClinicPayment =
    parsed.status === 'ok'
      ? parsed.value
      : { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null, updatedAt: null, updatedBy: null };
  const international = stored.international;
  const problems: string[] = [];
  const report = (msg: string) => {
    if (international) problems.push(msg);
  };

  // Markup: clinic, else a valid global, else 0. An out-of-range global that would be
  // used voids the rate (rule 3) rather than being clamped.
  let markupPercent = new Decimal(0);
  let markupSource: ValueSource = 'default';
  let markupBroken = false;
  if (stored.markupPercent !== null) {
    markupPercent = dec(stored.markupPercent);
    markupSource = 'clinic';
  } else if (globals.markupPercent !== null) {
    if (globals.markupPercent >= 0 && globals.markupPercent <= MARKUP_MAX && hasAtMostTwoDecimals(globals.markupPercent)) {
      markupPercent = dec(globals.markupPercent);
      markupSource = 'global';
    } else {
      markupBroken = true;
      report(`global markup ${globals.markupPercent} is outside 0–100 or has more than 2 decimals; clinic ${clinicId} has no usable rate`);
    }
  }

  // Rate: the clinic's if usable, else the global if usable.
  let rate: Decimal | null = null;
  let rateSource: ValueSource | null = null;
  if (isUsableRate(stored.fxRate)) {
    rate = dec(stored.fxRate);
    rateSource = 'clinic';
  } else {
    if (stored.fxRate !== null) report(`clinic ${clinicId} fx_rate ${stored.fxRate} is outside 1000–100000 or has more than 2 decimals; ignored`);
    if (isUsableRate(globals.fxRate)) {
      rate = dec(globals.fxRate);
      rateSource = 'global';
    } else if (globals.fxRate !== null) {
      report(`global fx rate ${globals.fxRate} is outside 1000–100000 or has more than 2 decimals; ignored`);
    }
  }
  if (markupBroken) {
    rate = null;
    rateSource = null;
  }

  const fixedFeeIdr = stored.fixedFeeIdr !== null ? dec(stored.fixedFeeIdr) : new Decimal(0);
  const feeSource: ValueSource = stored.fixedFeeIdr !== null ? 'clinic' : 'default';

  return {
    clinicId,
    international,
    methods: international && rate !== null ? [...ALL_METHODS] : [...XENDIT_ONLY],
    rate,
    markupPercent,
    fixedFeeIdr,
    source: { fxRate: rateSource, markupPercent: markupSource, fixedFeeIdr: feeSource },
    problems,
  };
}

export interface UsdLine {
  kind: 'item' | 'tax' | 'fee';
  name: string;
  idr: number;
  /** 2-decimal string. */
  usd: string;
}

export interface ChargeSnapshot {
  clinicId: number;
  fxRate: string;
  markupPercent: string;
  fixedFeeIdr: string;
  source: { fxRate: ValueSource; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
}

export interface UsdQuote {
  lines: UsdLine[];
  totalUsd: string;
  totalCents: number;
  /** Items plus taxes (> 0), excluding the fee — what the clinic is owed. */
  expectedIdr: number;
  /** rate / (1 + markup/100); same meaning as payment_orders.fxRate. Ignores the fee. */
  effectiveFxRate: string;
  snapshot: ChargeSnapshot;
}

function centsToUsd(cents: Decimal): string {
  return cents.div(100).toFixed(2);
}

/** Items plus taxes above zero — the amount that decides whether an order is free. */
function paidTotalIdr(items: PaymentLineItem[], taxes: PaymentTaxLine[]): number {
  const itemTotal = items.reduce((sum, i) => sum + i.price, 0);
  const taxTotal = taxes.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  return itemTotal + taxTotal;
}

/**
 * The USD lines for an order, or null when the clinic is not international, has no
 * usable rate, or the order is free (a free order is never charged in USD and never
 * gets the fee on its own).
 *
 * Every rupiah item becomes exactly one line, even at 0.00, so the lines stay 1:1 with
 * the rupiah `items` the plugin also receives. Taxes ≤ 0 are skipped, as the plugin
 * skips them. The fee line carries no markup and is omitted when the fee is 0.
 */
export function buildUsdQuote(
  items: PaymentLineItem[],
  taxes: PaymentTaxLine[],
  settings: ClinicPaymentSettings,
): UsdQuote | null {
  const rate = settings.rate;
  const rateSource = settings.source.fxRate;
  if (!settings.international || rate === null || rateSource === null) return null;

  const expectedIdr = paidTotalIdr(items, taxes);
  if (expectedIdr <= 0) return null;

  const factor = new Decimal(100).plus(settings.markupPercent);
  const withMarkup = (idr: number): Decimal => dec(idr).mul(factor).div(rate).ceil();

  const lines: UsdLine[] = [];
  let totalCents = new Decimal(0);
  const push = (kind: UsdLine['kind'], name: string, idr: number, cents: Decimal) => {
    lines.push({ kind, name, idr, usd: centsToUsd(cents) });
    totalCents = totalCents.plus(cents);
  };

  for (const item of items) push('item', item.name, item.price, withMarkup(item.price));
  for (const tax of taxes) {
    if (tax.amount <= 0) continue;
    push('tax', tax.name, tax.amount, withMarkup(tax.amount));
  }
  if (settings.fixedFeeIdr.gt(0)) {
    push('fee', INTL_FEE_LINE_NAME, settings.fixedFeeIdr.toNumber(), settings.fixedFeeIdr.mul(100).div(rate).ceil());
  }

  return {
    lines,
    totalUsd: centsToUsd(totalCents),
    totalCents: totalCents.toNumber(),
    expectedIdr,
    effectiveFxRate: rate.mul(100).div(factor).toString(),
    snapshot: {
      clinicId: settings.clinicId,
      fxRate: rate.toString(),
      markupPercent: settings.markupPercent.toString(),
      fixedFeeIdr: settings.fixedFeeIdr.toString(),
      source: { fxRate: rateSource, markupPercent: settings.source.markupPercent, fixedFeeIdr: settings.source.fixedFeeIdr },
    },
  };
}

export type UsdGate = { ok: true; quote: UsdQuote } | { ok: false; reason: 'not_allowed' | 'rate_missing' };

/**
 * The payment gate for `paypal` / `card` (spec §2). It checks the flag, the amount and
 * the rate — never `methods`, which is `['xendit']` under rule 3 and would turn every
 * 503 into a 403.
 */
export function gateUsdPayment(items: PaymentLineItem[], taxes: PaymentTaxLine[], settings: ClinicPaymentSettings): UsdGate {
  if (!settings.international) return { ok: false, reason: 'not_allowed' };
  if (paidTotalIdr(items, taxes) <= 0) return { ok: false, reason: 'not_allowed' };
  if (settings.rate === null) return { ok: false, reason: 'rate_missing' };
  const quote = buildUsdQuote(items, taxes, settings);
  if (quote === null) return { ok: false, reason: 'rate_missing' };
  return { ok: true, quote };
}

export interface PublicUsdView {
  price: string;
  taxes: { name: string; amount: string }[];
  fee: string | null;
  total: string;
}

/** The `usd` block of the public API. `price` is the sum of the item lines. */
export function toUsdView(quote: UsdQuote | null): PublicUsdView | null {
  if (quote === null) return null;
  const price = quote.lines
    .filter((l) => l.kind === 'item')
    .reduce((sum, l) => sum.plus(l.usd), new Decimal(0));
  const fee = quote.lines.find((l) => l.kind === 'fee');
  return {
    price: price.toFixed(2),
    taxes: quote.lines.filter((l) => l.kind === 'tax').map((l) => ({ name: l.name, amount: l.usd })),
    fee: fee ? fee.usd : null,
    total: quote.totalUsd,
  };
}

/** Integer cents of a plugin-reported amount, for the backstop comparison. */
export function amountToCents(n: number): number {
  return Math.round(n * 100);
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/intl-pricing.test.ts
```

Expected: `Tests  68 passed (68)`.

- [ ] **Step 5: Typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `tsc exit=0`, no diagnostics.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/services/payments/intl-pricing.ts tests/payments/intl-pricing.test.ts && git commit -F - <<'EOF'
feat(payments): modul harga USD klinik internasional (intl-pricing)

Satu fungsi murni mengubah baris rupiah menjadi baris USD untuk tampilan
dan untuk charge: kalikan dulu, satu kali bagi, lalu ceil (Rp 90.000 @16.500
10% = 6.00, bukan 6.01). Opsi per klinik dibaca fail-closed: serialized,
JSON rusak, atau field tidak valid = bukan klinik internasional.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds and `git status --short` prints nothing. Never use `git add -A` / `git add .` (the `node_modules` symlink from Task B0 is not a directory to git).

### Task B2: Baca pengaturan klinik dari `wp_options` — repo, `clinic-payment.service`, `public-usd.service`

**Files:**
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/repositories/wp/clinic-payment-settings.repo.ts`
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/clinic-payment.service.ts`
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/public-usd.service.ts`
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/clinic-payment-settings.repo.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/clinic-payment.service.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/integration/payments/clinic-payment-option.test.ts` (new — spec §7 "Integration against the Docker test database": the plugin's exact stored string read back through `KcOption` and `resolveClinicPayment`)

**Interfaces:** Consumes: `prisma.kcOption` (`@/lib/db`; model `KcOption` maps `wp_options` with fields `optionName`, `optionValue`), `logging.warn` / `logging.error` (`@/lib/logging`), Task B1's exports, `computePublicAmount` (`@/services/payments/payment.service`). / Produces (exact contract names): repo — `GLOBAL_RATE_OPTION`, `GLOBAL_MARKUP_OPTION`, `clinicPaymentOptionName(clinicId: number): string`, `class PaymentSettingsUnavailableError extends Error` (constructor `(message: string, cause?: unknown)`; `cause` is a public property because this project's TS `lib` is ES2020, without `Error.cause`), `RawPaymentOptions`, `readRawPaymentOptions(clinicIds: number[]): Promise<RawPaymentOptions>`; service — re-export of `PaymentSettingsUnavailableError`, `resolveClinicPayment(clinicId: number)`, `resolveClinicPaymentMany(clinicIds: number[])`, `resolveClinicPaymentForDisplay(clinicId: number)`, `resolveClinicPaymentManyForDisplay(clinicIds: number[])`, `readGlobalDefaults()`; public-usd — `RowPayment`, `rowPaymentFor(args, settings): Promise<RowPayment>`.

Behaviour fixed here: one `findMany` per call (the clinic options plus both globals); any Prisma error becomes `PaymentSettingsUnavailableError`; a clinic id that is not a positive integer resolves to `notInternational(id)` with no query; `resolveClinicPaymentMany` returns an entry for every requested id and logs each clinic's `problems` via `logging.warn('Clinic payment settings problem', { resource: 'clinic', resourceId: String(id), metadata: { problems } })`; the `ForDisplay` variants catch any error, log it with `logging.error`, and return `notInternational` for every id. `public-usd.service.ts` is its own module because `payment.service` imports `clinic-payment.service` and `intl-pricing` from Task B5 on — putting `rowPaymentFor` in either would close an import cycle.

- [ ] **Step 1: Write the failing repo test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/clinic-payment-settings.repo.test.ts` with exactly this content:

```ts
/**
 * Raw reads of the per-clinic payment option and the two global options.
 *
 * Mocked Prisma: what matters is the single query's shape and that any database error
 * becomes PaymentSettingsUnavailableError (the payment gate's retryable 503).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ kcOption: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

import {
  GLOBAL_MARKUP_OPTION,
  GLOBAL_RATE_OPTION,
  PaymentSettingsUnavailableError,
  clinicPaymentOptionName,
  readRawPaymentOptions,
} from '@/repositories/wp/clinic-payment-settings.repo';

beforeEach(() => {
  db.kcOption.findMany.mockReset();
});

describe('clinicPaymentOptionName', () => {
  it('is praktiqu_endpoint_clinic_{id}_payment', () => {
    expect(clinicPaymentOptionName(4)).toBe('praktiqu_endpoint_clinic_4_payment');
  });
});

describe('readRawPaymentOptions', () => {
  it('reads every clinic option and both globals in ONE query', async () => {
    db.kcOption.findMany.mockResolvedValue([]);

    await readRawPaymentOptions([4, 9]);

    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(db.kcOption.findMany).toHaveBeenCalledWith({
      where: {
        optionName: {
          in: [
            'praktiqu_endpoint_clinic_4_payment',
            'praktiqu_endpoint_clinic_9_payment',
            'praktiqu_endpoint_paypal_idr_rate',
            'praktiqu_endpoint_paypal_markup_percent',
          ],
        },
      },
      select: { optionName: true, optionValue: true },
    });
  });

  it('returns the raw strings keyed by clinic id, plus the globals', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: 'praktiqu_endpoint_clinic_9_payment', optionValue: '{"international":true}' },
      { optionName: GLOBAL_RATE_OPTION, optionValue: '16500' },
      { optionName: GLOBAL_MARKUP_OPTION, optionValue: '10' },
    ]);

    const raw = await readRawPaymentOptions([4, 9]);

    expect([...raw.byClinic.entries()]).toEqual([[9, '{"international":true}']]);
    expect(raw.globalRate).toBe('16500');
    expect(raw.globalMarkup).toBe('10');
  });

  it('still reads the globals when no clinic is asked for', async () => {
    db.kcOption.findMany.mockResolvedValue([{ optionName: GLOBAL_RATE_OPTION, optionValue: '18000' }]);

    const raw = await readRawPaymentOptions([]);

    expect(db.kcOption.findMany.mock.calls[0][0].where.optionName.in).toEqual([GLOBAL_RATE_OPTION, GLOBAL_MARKUP_OPTION]);
    expect(raw.byClinic.size).toBe(0);
    expect(raw.globalRate).toBe('18000');
    expect(raw.globalMarkup).toBeNull();
  });

  it('turns a database error into PaymentSettingsUnavailableError, keeping the cause', async () => {
    const dbDown = new Error('Too many connections');
    db.kcOption.findMany.mockRejectedValue(dbDown);

    const err = await readRawPaymentOptions([4]).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsUnavailableError);
    expect(err.cause).toBe(dbDown);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/clinic-payment-settings.repo.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/repositories/wp/clinic-payment-settings.repo' imported from …`; `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the repo**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/repositories/wp/clinic-payment-settings.repo.ts` with exactly this content:

```ts
/**
 * Per-clinic payment settings, straight from `wp_options`.
 *
 * One option per clinic, `praktiqu_endpoint_clinic_{id}_payment`, holding a JSON
 * string the praktiqu-endpoint plugin writes (spec §1). The two global options live in
 * the same table. Reads only — writes go through the plugin's
 * `PUT /praktiqu/v1/clinics/{id}/payment-settings` so WordPress's object cache stays
 * consistent.
 *
 * Returns the raw strings; decoding and validation are the pure job of
 * `services/payments/intl-pricing.ts`.
 */
import { prisma } from '@/lib/db';

export const GLOBAL_RATE_OPTION = 'praktiqu_endpoint_paypal_idr_rate';
export const GLOBAL_MARKUP_OPTION = 'praktiqu_endpoint_paypal_markup_percent';

export function clinicPaymentOptionName(clinicId: number): string {
  return `praktiqu_endpoint_clinic_${clinicId}_payment`;
}

/**
 * The settings could not be read at all (a database error). Display paths treat the
 * clinic as not international; the payment gate answers a retryable 503 — a temporary
 * outage must never look like a permanent "not allowed".
 */
export class PaymentSettingsUnavailableError extends Error {
  // `cause` by hand: this project's `lib` (ES2020) predates the standard Error.cause.
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'PaymentSettingsUnavailableError';
  }
}

export interface RawPaymentOptions {
  byClinic: Map<number, string>;
  globalRate: string | null;
  globalMarkup: string | null;
}

/** One query for every requested clinic plus both global options. */
export async function readRawPaymentOptions(clinicIds: number[]): Promise<RawPaymentOptions> {
  const nameToClinic = new Map<string, number>();
  for (const id of clinicIds) nameToClinic.set(clinicPaymentOptionName(id), id);

  let rows: Array<{ optionName: string; optionValue: string }>;
  try {
    rows = await prisma.kcOption.findMany({
      where: { optionName: { in: [...nameToClinic.keys(), GLOBAL_RATE_OPTION, GLOBAL_MARKUP_OPTION] } },
      select: { optionName: true, optionValue: true },
    });
  } catch (err) {
    throw new PaymentSettingsUnavailableError('Could not read clinic payment settings from wp_options', err);
  }

  const result: RawPaymentOptions = { byClinic: new Map(), globalRate: null, globalMarkup: null };
  for (const row of rows) {
    if (row.optionName === GLOBAL_RATE_OPTION) result.globalRate = row.optionValue;
    else if (row.optionName === GLOBAL_MARKUP_OPTION) result.globalMarkup = row.optionValue;
    else {
      const clinicId = nameToClinic.get(row.optionName);
      if (clinicId !== undefined) result.byClinic.set(clinicId, row.optionValue);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/clinic-payment-settings.repo.test.ts
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Write the failing service test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/clinic-payment.service.test.ts` with exactly this content:

```ts
/**
 * resolveClinicPayment and friends — spec §1 rules 1–5 through the real repo and the
 * real pure module, with only Prisma and the logger mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ kcOption: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

import {
  PaymentSettingsUnavailableError,
  readGlobalDefaults,
  resolveClinicPayment,
  resolveClinicPaymentForDisplay,
  resolveClinicPaymentMany,
  resolveClinicPaymentManyForDisplay,
} from '@/services/payments/clinic-payment.service';

function clinicRow(clinicId: number, value: string) {
  return { optionName: `praktiqu_endpoint_clinic_${clinicId}_payment`, optionValue: value };
}

const FLAGGED = JSON.stringify({
  international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000,
  updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.kcOption.findMany.mockReset();
});

describe('resolveClinicPayment', () => {
  it('resolves a flagged clinic from its option', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    const s = await resolveClinicPayment(4);

    expect(s.clinicId).toBe(4);
    expect(s.international).toBe(true);
    expect(s.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(logging.logging.warn).not.toHaveBeenCalled();
  });

  it('treats a missing option as not international, without logging', async () => {
    db.kcOption.findMany.mockResolvedValue([]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"international":tru', 'clinic_payment_option_malformed_json'],
    ['a PHP-serialized value', 'a:1:{s:13:"international";b:1;}', 'clinic_payment_option_serialized'],
    ['an invalid stored field', JSON.stringify({ international: true, markup_percent: 150 }), 'clinic_payment_option_invalid_field'],
  ])('fails closed on %s and logs it', async (_label, value, problem) => {
    db.kcOption.findMany.mockResolvedValue([
      clinicRow(4, value),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '18000' },
    ]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(false);
    expect(s.rate).toBeNull();
    expect(logging.logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: '4',
        metadata: { problems: [expect.stringContaining(problem)] },
      }),
    );
  });

  it('keeps a flagged clinic international when the global rate is out of range (rule 3) and logs it', async () => {
    db.kcOption.findMany.mockResolvedValue([
      clinicRow(4, JSON.stringify({ international: true, fx_rate: null })),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '500000' },
    ]);

    const s = await resolveClinicPayment(4);

    expect(s.international).toBe(true);
    expect(s.rate).toBeNull();
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.warn).toHaveBeenCalledTimes(1);
  });

  it('throws PaymentSettingsUnavailableError on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    await expect(resolveClinicPayment(4)).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });

  it.each([0, -1])('answers not international for clinic id %i without a query', async (id) => {
    const s = await resolveClinicPayment(id);

    expect(s.international).toBe(false);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveClinicPaymentMany', () => {
  it('resolves several clinics with one query and an entry for every id', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    const map = await resolveClinicPaymentMany([4, 9, 0]);

    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(map.get(4)!.international).toBe(true);
    expect(map.get(9)!.international).toBe(false);
    expect(map.get(0)!.international).toBe(false);
  });
});

describe('display variants (rule 5)', () => {
  it('resolveClinicPaymentForDisplay returns not international and logs on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const s = await resolveClinicPaymentForDisplay(4);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.logging.error).toHaveBeenCalledWith(
      expect.stringContaining('unavailable'),
      expect.any(PaymentSettingsUnavailableError),
      expect.objectContaining({ metadata: { clinicIds: [4] } }),
    );
  });

  it('resolveClinicPaymentManyForDisplay returns not international for every id on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const map = await resolveClinicPaymentManyForDisplay([4, 9]);

    expect([...map.keys()]).toEqual([4, 9]);
    expect(map.get(4)!.international).toBe(false);
    expect(map.get(9)!.international).toBe(false);
  });

  it('resolveClinicPaymentForDisplay resolves normally when the read works', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicRow(4, FLAGGED)]);

    expect((await resolveClinicPaymentForDisplay(4)).international).toBe(true);
  });
});

describe('readGlobalDefaults', () => {
  it('parses both global options', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '16500' },
      { optionName: 'praktiqu_endpoint_paypal_markup_percent', optionValue: '10' },
    ]);

    expect(await readGlobalDefaults()).toEqual({ fxRate: 16500, markupPercent: 10 });
  });

  it('throws PaymentSettingsUnavailableError on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('down'));

    await expect(readGlobalDefaults()).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });
});
```

- [ ] **Step 6: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/clinic-payment.service.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/services/payments/clinic-payment.service' imported from …`; `Test Files  1 failed (1)`.

- [ ] **Step 7: Write the service**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/clinic-payment.service.ts` with exactly this content:

```ts
/**
 * Resolve a clinic's international payment settings (spec §1, rules 1–5).
 *
 * The payment variants throw `PaymentSettingsUnavailableError` on a database error so
 * the gate can answer a retryable 503. The display variants never throw: a failed read
 * shows rupiah and Xendit only (rule 5) and is logged.
 */
import { logging } from '@/lib/logging';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  notInternational,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  type ClinicPaymentSettings,
  type GlobalDefaults,
} from '@/services/payments/intl-pricing';

export { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';

function isRealClinicId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

/** Throws PaymentSettingsUnavailableError. Every requested id gets an entry. */
export async function resolveClinicPaymentMany(clinicIds: number[]): Promise<Map<number, ClinicPaymentSettings>> {
  const result = new Map<number, ClinicPaymentSettings>();
  const ids = [...new Set(clinicIds)];
  for (const id of ids) if (!isRealClinicId(id)) result.set(id, notInternational(id));

  const real = ids.filter(isRealClinicId);
  if (real.length === 0) return result;

  const raw = await readRawPaymentOptions(real);
  const globals = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  for (const id of real) {
    const settings = resolveSettings(id, parseStoredOption(raw.byClinic.get(id)), globals);
    if (settings.problems.length > 0) {
      await logging.warn('Clinic payment settings problem', {
        resource: 'clinic',
        resourceId: String(id),
        metadata: { problems: settings.problems },
      });
    }
    result.set(id, settings);
  }
  return result;
}

/** Throws PaymentSettingsUnavailableError. A clinic id of 0 or below is not international. */
export async function resolveClinicPayment(clinicId: number): Promise<ClinicPaymentSettings> {
  if (!isRealClinicId(clinicId)) return notInternational(clinicId);
  const many = await resolveClinicPaymentMany([clinicId]);
  return many.get(clinicId) ?? notInternational(clinicId);
}

/** Never throws: a failed read is logged and every clinic reads as not international. */
export async function resolveClinicPaymentManyForDisplay(clinicIds: number[]): Promise<Map<number, ClinicPaymentSettings>> {
  try {
    return await resolveClinicPaymentMany(clinicIds);
  } catch (err) {
    await logging.error('Clinic payment settings unavailable — showing rupiah and Xendit only', err, {
      metadata: { clinicIds },
    });
    return new Map(clinicIds.map((id) => [id, notInternational(id)]));
  }
}

/** Never throws: see resolveClinicPaymentManyForDisplay. */
export async function resolveClinicPaymentForDisplay(clinicId: number): Promise<ClinicPaymentSettings> {
  const many = await resolveClinicPaymentManyForDisplay([clinicId]);
  return many.get(clinicId) ?? notInternational(clinicId);
}

/** The two global options, for the settings page placeholders. Throws PaymentSettingsUnavailableError. */
export async function readGlobalDefaults(): Promise<GlobalDefaults> {
  const raw = await readRawPaymentOptions([]);
  return parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
}
```

- [ ] **Step 8: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/clinic-payment.service.test.ts
```

Expected: `Tests  15 passed (15)`.

- [ ] **Step 9: Write the failing public-usd test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` with exactly this content:

```ts
/**
 * rowPaymentFor — the `paymentMethods` + `usd` fields of a public row.
 *
 * calculateTax is mocked (as in payment-service.test.ts) so computePublicAmount stays a
 * fast unit; the settings are built with the real pure module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));

import { rowPaymentFor } from '@/services/payments/public-usd.service';
import { notInternational, parseStoredOption, resolveSettings } from '@/services/payments/intl-pricing';
import { calculateTax } from '@/services/billing/bill.service';

const calculateTaxMock = vi.mocked(calculateTax);

function flagged(fields: Record<string, unknown>) {
  return resolveSettings(
    4,
    parseStoredOption(JSON.stringify({ international: true, fx_rate: null, markup_percent: null, fixed_fee_idr: null, ...fields })),
    { fxRate: null, markupPercent: null },
  );
}

const ROW = { clinicId: 4, doctorId: 29, serviceId: 7, name: 'Konsultasi', price: '200000' };

beforeEach(() => {
  vi.clearAllMocks();
  calculateTaxMock.mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
});

describe('rowPaymentFor', () => {
  it('offers Xendit only, with no USD and no tax query, for a clinic that is not international', async () => {
    const result = await rowPaymentFor(ROW, notInternational(4));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
    expect(calculateTaxMock).not.toHaveBeenCalled();
  });

  it('offers Xendit only, with no tax query, for a flagged clinic with no usable rate', async () => {
    const result = await rowPaymentFor(ROW, flagged({ markup_percent: 10 }));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
    expect(calculateTaxMock).not.toHaveBeenCalled();
  });

  it('quotes the worked example for a flagged clinic with a rate', async () => {
    const result = await rowPaymentFor(ROW, flagged({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 }));

    expect(result).toEqual({
      paymentMethods: ['xendit', 'paypal', 'card'],
      usd: { price: '12.23', taxes: [], fee: '1.39', total: '13.62' },
    });
    expect(calculateTaxMock).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: 4,
      doctor_id: 29,
      serviceItems: [expect.objectContaining({ serviceId: 7, service_name: 'Konsultasi', price: 200000 })],
    }));
  });

  it('includes the clinic and doctor taxes in USD', async () => {
    calculateTaxMock.mockResolvedValue({
      total_tax: 22000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'PPN', tax_type: 'percentage', tax_value: 11, tax_amount: 22000, service_id: 7, service_name: 'Konsultasi' }],
    });

    const result = await rowPaymentFor(ROW, flagged({ fx_rate: 18000, markup_percent: 10 }));

    expect(result.usd).toEqual({ price: '12.23', taxes: [{ name: 'PPN', amount: '1.35' }], fee: null, total: '13.58' });
  });

  it('falls back to Xendit only for a free row', async () => {
    const result = await rowPaymentFor({ ...ROW, price: 0 }, flagged({ fx_rate: 18000, fixed_fee_idr: 25000 }));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
  });
});
```

- [ ] **Step 10: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-usd.service.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/services/payments/public-usd.service' imported from …`; `Test Files  1 failed (1)`.

- [ ] **Step 11: Write public-usd.service**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/public-usd.service.ts` with exactly this content:

```ts
/**
 * The `paymentMethods` + `usd` fields of one public catalogue/booking row.
 *
 * Kept apart from intl-pricing (pure) and clinic-payment.service because it needs
 * `computePublicAmount`, and payment.service imports both of those — putting this
 * there would close an import cycle.
 *
 * The quote comes from the same `computePublicAmount` + `buildUsdQuote` used to charge,
 * so for the same settings the displayed and charged USD figures match.
 */
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { computePublicAmount } from '@/services/payments/payment.service';
import {
  XENDIT_ONLY,
  buildUsdQuote,
  toUsdView,
  type ClinicPaymentSettings,
  type PublicUsdView,
} from '@/services/payments/intl-pricing';

export interface RowPayment {
  paymentMethods: PaymentMethod[];
  usd: PublicUsdView | null;
}

export async function rowPaymentFor(
  args: { clinicId: number; doctorId: number; serviceId: number; name: string; price: number | string },
  settings: ClinicPaymentSettings,
): Promise<RowPayment> {
  // No tax query for the common case: a clinic that cannot take PayPal shows rupiah.
  if (!settings.methods.includes('paypal')) return { paymentMethods: [...XENDIT_ONLY], usd: null };

  const { items, taxes } = await computePublicAmount({
    name: args.name,
    price: args.price,
    serviceId: args.serviceId,
    clinicId: args.clinicId,
    doctorId: args.doctorId,
  });
  const quote = buildUsdQuote(items, taxes, settings);
  if (quote === null) return { paymentMethods: [...XENDIT_ONLY], usd: null };
  return { paymentMethods: [...settings.methods], usd: toUsdView(quote) };
}
```

- [ ] **Step 12: Run all three — expect PASS — and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/clinic-payment-settings.repo.test.ts tests/payments/clinic-payment.service.test.ts tests/payments/public-usd.service.test.ts && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  3 passed (3)`, `Tests  25 passed (25)`, then `tsc exit=0`.

- [ ] **Step 13: Write the KcOption integration test (spec §7)**

The mocked suites above prove the logic; this one proves the two sides agree on the storage format. Its fixture is byte-for-byte the string the plugin's `ClinicPaymentSettings::encode()` writes, pinned by plugin Task A1 (`tests/test-clinic-payment-settings.php`, check `exact stored string`). It passes as soon as it can run — it verifies compatibility, not new code. It writes and deletes two `wp_options` rows (`praktiqu_endpoint_clinic_7960001_payment`, `praktiqu_endpoint_clinic_7960002_payment`) in the Docker **test** database only, and skips itself when `DATABASE_URL` is not a test database.

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/integration/payments/clinic-payment-option.test.ts` with exactly this content:

```ts
/**
 * The plugin's stored option, read back through KcOption (spec §7: "Integration against
 * the Docker test database").
 *
 * PLUGIN_FIXTURE is byte-for-byte what ClinicPaymentSettings::encode() writes — pinned in
 * Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-payment-settings.php ("exact stored
 * string"). If that string changes, change it here too: this test exists so a storage-format
 * change on one side cannot silently turn every clinic into a not-international one on the
 * other.
 *
 * Needs the Docker test database (`wordpress-praktiqu-test`). Skipped when DATABASE_URL is
 * not a test database; assertTestDb() refuses to write anywhere else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import { assertTestDb } from '../../billing/fixtures';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import { resolveClinicPayment } from '@/services/payments/clinic-payment.service';
import { buildUsdQuote } from '@/services/payments/intl-pricing';

/** ClinicPaymentSettings::encode() output for the §1 example (plugin Task A1). */
const PLUGIN_FIXTURE =
  '{"international":true,"fx_rate":16500,"markup_percent":10,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}';
/** What WordPress would store had the plugin passed update_option() an array. */
const SERIALIZED =
  'a:6:{s:13:"international";b:1;s:7:"fx_rate";i:16500;s:14:"markup_percent";i:10;s:13:"fixed_fee_idr";i:25000;s:10:"updated_at";s:25:"2026-10-06T08:00:00+00:00";s:10:"updated_by";i:123;}';

/** Test-owned clinic ids. Only the options are needed — no wp_kc_clinics row. */
const CLINIC = 7_960_001;
const SERIALIZED_CLINIC = 7_960_002;
const NAMES = [CLINIC, SERIALIZED_CLINIC].map((id) => `praktiqu_endpoint_clinic_${id}_payment`);

const onTestDb = /test/i.test(process.env.DATABASE_URL ?? '');

async function wipe() {
  await prisma.kcOption.deleteMany({ where: { optionName: { in: NAMES } } });
}

describe.skipIf(!onTestDb)('clinic payment option through KcOption (Docker test database)', () => {
  beforeAll(async () => {
    assertTestDb();
    await wipe();
    await prisma.kcOption.createMany({
      data: [
        { optionName: NAMES[0], optionValue: PLUGIN_FIXTURE },
        { optionName: NAMES[1], optionValue: SERIALIZED },
      ],
    });
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('reads back exactly the string the plugin wrote', async () => {
    const raw = await readRawPaymentOptions([CLINIC]);

    expect(raw.byClinic.get(CLINIC)).toBe(PLUGIN_FIXTURE);
  });

  it('resolves the plugin fixture as an international clinic with its own values', async () => {
    const s = await resolveClinicPayment(CLINIC);

    expect(s.international).toBe(true);
    expect(s.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(s.rate!.toString()).toBe('16500');
    expect(s.markupPercent.toString()).toBe('10');
    expect(s.fixedFeeIdr.toString()).toBe('25000');
    expect(s.source).toEqual({ fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' });
    expect(s.problems).toEqual([]);
  });

  it('quotes from it: Rp 200,000 at 16,500 with 10% and a Rp 25,000 fee', async () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [], await resolveClinicPayment(CLINIC));

    // ceil(200000 × 110 / 16500) = ceil(1333.3…) = 1334; ceil(25000 × 100 / 16500) = ceil(151.5…) = 152
    expect(quote!.lines.map((l) => l.usd)).toEqual(['13.34', '1.52']);
    expect(quote!.totalUsd).toBe('14.86');
  });

  it('fails closed on a PHP-serialized value and logs it (rule 4)', async () => {
    const s = await resolveClinicPayment(SERIALIZED_CLINIC);

    expect(s.international).toBe(false);
    expect(s.methods).toEqual(['xendit']);
    expect(logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: String(SERIALIZED_CLINIC),
        metadata: { problems: [expect.stringContaining('clinic_payment_option_serialized')] },
      }),
    );
  });
});
```

- [ ] **Step 14: Run it — skipped without a test database, PASS against the Docker test database**

First without any database (what every other command in this plan does):

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/integration/payments/clinic-payment-option.test.ts
```

Expected: `Test Files  1 skipped (1)`, `Tests  4 skipped (4)` — no database is touched.

Then against the Docker test database. The worktree has no `.env.test.local` and must not get one; the URL is read from the main checkout's copy and passed for this one command only. If `praktiqu-mysql` is not listed as `Up`, ask the user to start Docker Desktop — do not start, create or provision any container or table yourself. If the run fails with "table … wp_options doesn't exist", stop and report it (never `prisma db push`).

```bash
docker ps --filter name=praktiqu-mysql --format '{{.Names}} {{.Status}}'
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && TEST_DB_URL="$(/usr/bin/grep '^DATABASE_URL=' /home/ahmad/projects/nextjs-appointment-praktiqu/.env.test.local | cut -d= -f2- | tr -d "\"'")" && case "$TEST_DB_URL" in *test*) DATABASE_URL="$TEST_DB_URL" npx vitest run tests/integration/payments/clinic-payment-option.test.ts ;; *) echo "REFUSING: .env.test.local DATABASE_URL is not a test database" ;; esac
```

Expected: `praktiqu-mysql Up …`, then `Test Files  1 passed (1)`, `Tests  4 passed (4)`. The two rows are deleted again in `afterAll`. Never run this with the worktree's or the app's own `DATABASE_URL`: that is the live WordPress database.

- [ ] **Step 15: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/repositories/wp/clinic-payment-settings.repo.ts src/services/payments/clinic-payment.service.ts src/services/payments/public-usd.service.ts tests/payments/clinic-payment-settings.repo.test.ts tests/payments/clinic-payment.service.test.ts tests/payments/public-usd.service.test.ts tests/integration/payments/clinic-payment-option.test.ts && git commit -F - <<'EOF'
feat(payments): baca pengaturan pembayaran klinik dari wp_options

Satu query KcOption untuk opsi per klinik dan dua opsi global. Error DB
menjadi PaymentSettingsUnavailableError (503 yang bisa dicoba ulang di
gerbang bayar); varian tampilan tidak pernah throw dan jatuh ke Xendit.
rowPaymentFor memberi paymentMethods + usd per baris katalog. Tes
integrasi membaca string persis hasil encode() plugin lewat KcOption di
database tes Docker, supaya format penyimpanan kedua sisi tetap cocok.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds and `git status --short` prints nothing. Never use `git add -A` / `git add .` (the `node_modules` symlink from Task B0 is not a directory to git).

### Task B3: Klien plugin — `charge` USD, `WpEndpointError.code`, `putClinicPaymentSettings`, `toCharge`

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (imports, lines 7–8; `CreateWcOrderInput`, lines 23–36; `WpEndpointError`, lines 64–69; `wpRequestJson` error branch, lines 152–161; `createWcOrder` error branch, lines 176–179; new section above the `media` banner, line 222)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` (import line; insert `toCharge` above `amountToCents`)
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/wp-endpoint.test.ts` (append a describe block), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/intl-pricing.test.ts` (add the `toCharge` import and a describe block)

**Interfaces:** Consumes: `ChargeSnapshot`, `UsdQuote` (Task B1). / Produces (exact contract names): `WpEndpointError` constructor `(message: string, status: number, code?: string)` (`WpConfigError` keeps `super(message, 500)`); `interface WcCharge { currency: 'USD'; items: { name: string; amount: string }[]; taxes: { name: string; amount: string }[]; fee?: { name: string; amount: string }; total: string; snapshot: ChargeSnapshot }`; `CreateWcOrderInput.charge?: WcCharge`; `createWcOrder` and `wpRequestJson` set `WpEndpointError.code` from the WordPress error body `{ code, message, data.status }`; `interface ClinicPaymentSettingsWire { international: boolean; fx_rate: number | null; markup_percent: number | null; fixed_fee_idr: number | null; updated_by: number | null }`; `putClinicPaymentSettings(clinicId: number, body: ClinicPaymentSettingsWire): Promise<void>` (PUT `/clinics/${clinicId}/payment-settings` through `wpRequestJson`); `toCharge(quote: UsdQuote): WcCharge` in intl-pricing (leaves `fee` out — never `null` — when there is no fee line). `createWcOrder` already sends its whole input with `JSON.stringify`, so `charge` needs no serialisation code; leaving it out for Xendit is the caller's job (Task B5 spreads it in only when present).

- [ ] **Step 1: Add the failing toCharge tests**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/intl-pricing.test.ts` (edit 1 of 2), replace this exact text:

```ts
  resolveSettings,
  toUsdView,
```

with:

```ts
  resolveSettings,
  toCharge,
  toUsdView,
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/intl-pricing.test.ts` (edit 2 of 2), replace this exact text:

```ts
describe('amountToCents', () => {
  it('rounds float noise to whole cents', () => {
    expect(amountToCents(13.62)).toBe(1362);
    expect(amountToCents(0.29)).toBe(29);
    expect(amountToCents(55)).toBe(5500);
  });
});
```

with:

```ts
describe('amountToCents', () => {
  it('rounds float noise to whole cents', () => {
    expect(amountToCents(13.62)).toBe(1362);
    expect(amountToCents(0.29)).toBe(29);
    expect(amountToCents(55)).toBe(5500);
  });
});

describe('toCharge', () => {
  it('turns the worked example into the plugin wire format', () => {
    const quote = buildUsdQuote([{ name: 'Konsultasi', price: 200_000 }], [{ name: 'PPN', amount: 22_000 }], intl(18_000, 10, 25_000))!;
    expect(toCharge(quote)).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [{ name: 'PPN', amount: '1.35' }],
      fee: { name: INTL_FEE_LINE_NAME, amount: '1.39' },
      total: '14.97',
      snapshot: quote.snapshot,
    });
  });

  it('leaves fee out entirely (not null) when there is no fee line', () => {
    const charge = toCharge(buildUsdQuote([{ name: 'Svc', price: 200_000 }], [], intl(18_000, 10))!);
    expect(charge).not.toHaveProperty('fee');
    expect(charge.total).toBe('12.23');
  });
});
```

- [ ] **Step 2: Add the failing wp-endpoint tests**

Append a new describe block after the last test of the file. The anchor is the end of the existing `getWcOrderStatus defaults the currency to IDR when absent` test plus the closing of the file-level describe.

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/wp-endpoint.test.ts`, replace this exact text:

```ts
    expect(status.currency).toBe('IDR');
  });
});
```

with:

```ts
    expect(status.currency).toBe('IDR');
  });
});

describe('wp-endpoint — international charge and WordPress error codes', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WORDPRESS_URL: 'http://wp.test', WORDPRESS_SERVICE_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  async function quoteCharge(fee: number | null) {
    const { buildUsdQuote, parseStoredOption, resolveSettings, toCharge } = await import('@/services/payments/intl-pricing');
    const settings = resolveSettings(
      4,
      parseStoredOption(JSON.stringify({ international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: fee })),
      { fxRate: null, markupPercent: null },
    );
    return toCharge(buildUsdQuote([{ name: 'Konsultasi', price: 200000 }], [], settings)!);
  }

  it('serialises charge with string amounts, the fee line and the snapshot', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ orderId: 42, checkoutUrl: 'https://paypal.com/x', chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64 }),
    });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Konsultasi', price: 200000 }], taxes: [],
      returnUrl: 'https://app/success', cancelUrl: 'https://app/cancel',
      method: 'paypal', charge: await quoteCharge(25000),
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.items).toEqual([{ name: 'Konsultasi', price: 200000 }]);
    expect(body.charge).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [],
      fee: { name: 'International service fee', amount: '1.39' },
      total: '13.62',
      snapshot: {
        clinicId: 4, fxRate: '18000', markupPercent: '10', fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
  });

  it('leaves fee out of the serialised charge when there is none', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 42, checkoutUrl: 'u' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Konsultasi', price: 200000 }], taxes: [],
      returnUrl: 'x', cancelUrl: 'y', method: 'paypal', charge: await quoteCharge(null),
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.charge).not.toHaveProperty('fee');
    expect(body.charge.total).toBe('12.23');
  });

  it('sends no charge key for a plain xendit order', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ orderId: 7, checkoutUrl: 'u' }) });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [{ name: 'Svc', price: 100000 }], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    });
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).not.toHaveProperty('charge');
  });

  it('createWcOrder parses the WordPress error body into WpEndpointError.code', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      text: async () => JSON.stringify({ code: 'charge_mismatch', message: 'Order total 13.61 != 13.62', data: { status: 502 } }),
    });
    const { createWcOrder, WpEndpointError } = await import('@/lib/wp-endpoint');
    const err = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('charge_mismatch');
  });

  it('createWcOrder leaves code undefined when the error body is not JSON', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => '<html>fatal</html>' });
    const { createWcOrder } = await import('@/lib/wp-endpoint');
    const err = await createWcOrder({
      source: 'public', customerName: 'A', customerEmail: 'a@x.com',
      items: [], taxes: [], returnUrl: 'x', cancelUrl: 'y',
    }).catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
  });

  it('wpRequestJson parses the WordPress error body into code and keeps the message', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable Entity',
      text: async () => JSON.stringify({ code: 'fx_rate_required', message: 'A usable rate is required', data: { status: 422 } }),
    });
    const { wpRequestJson } = await import('@/lib/wp-endpoint');
    const err: any = await wpRequestJson('/clinics/4/payment-settings', { method: 'PUT', body: {} }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.code).toBe('fx_rate_required');
    expect(err.message).toBe('/clinics/4/payment-settings failed 422: A usable rate is required');
  });

  it('putClinicPaymentSettings PUTs the snake_case body to the plugin route', async () => {
    (fetch as any).mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ clinicId: 4, settings: { international: true } }),
    });
    const { putClinicPaymentSettings } = await import('@/lib/wp-endpoint');
    await putClinicPaymentSettings(4, {
      international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('http://wp.test/wp-json/praktiqu/v1/clinics/4/payment-settings');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['X-PraktiQU-Service-Token']).toBe('tok');
    expect(JSON.parse(opts.body)).toEqual({
      international: true, fx_rate: 16500, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
  });

  it('putClinicPaymentSettings surfaces the plugin code on failure', async () => {
    (fetch as any).mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      text: async () => JSON.stringify({ code: 'clinic_not_found', message: 'No such clinic', data: { status: 404 } }),
    });
    const { putClinicPaymentSettings } = await import('@/lib/wp-endpoint');
    await expect(putClinicPaymentSettings(999, {
      international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null, updated_by: null,
    })).rejects.toMatchObject({ status: 404, code: 'clinic_not_found' });
  });
});
```

- [ ] **Step 3: Run them — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/intl-pricing.test.ts tests/payments/wp-endpoint.test.ts
```

Expected: FAIL with `Tests  8 failed | 79 passed (87)` — the two `toCharge` tests and the two charge-serialisation tests fail with `TypeError: toCharge is not a function`; the two `code` tests fail on `expected undefined to be 'charge_mismatch'` / `'fx_rate_required'`; the two `putClinicPaymentSettings` tests fail with `putClinicPaymentSettings is not a function`. The pre-existing tests still pass.

- [ ] **Step 4: Implement the wp-endpoint changes**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 1 of 6), replace this exact text:

```ts
import type { AllowedMime } from '@/services/uploads/validate-upload';
import { toNum } from '@/lib/kc-num';
```

with:

```ts
import type { AllowedMime } from '@/services/uploads/validate-upload';
import type { ChargeSnapshot } from '@/services/payments/intl-pricing';
import { toNum } from '@/lib/kc-num';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 2 of 6), replace this exact text:

```ts
  /** Omitted means 'xendit' — the plugin applies the same default. */
  method?: PaymentMethod;
}
```

with:

```ts
  /** Omitted means 'xendit' — the plugin applies the same default. */
  method?: PaymentMethod;
  /** The finished USD lines for paypal/card (spec §4). Omitted for xendit — never null. */
  charge?: WcCharge;
}

/**
 * The USD charge the plugin builds the WooCommerce order from. Every amount is a
 * 2-decimal string (`^\d+\.\d{2}$`): the plugin converts it to cents from the string,
 * never through a float.
 */
export interface WcCharge {
  currency: 'USD';
  items: { name: string; amount: string }[];
  taxes: { name: string; amount: string }[];
  /** Omitted when there is no fixed fee — never null. */
  fee?: { name: string; amount: string };
  total: string;
  snapshot: ChargeSnapshot;
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 3 of 6), replace this exact text:

```ts
export class WpEndpointError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'WpEndpointError';
  }
}
```

with:

```ts
export class WpEndpointError extends Error {
  /** `code` is WordPress's own error code (`charge_mismatch`, `gateway_missing`, …) when the body had one. */
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'WpEndpointError';
  }
}

/**
 * WordPress reports errors as `{ code, message, data: { status } }`. Returns what it
 * can; a PHP fatal or an HTML error page yields nothing.
 */
function parseWpErrorBody(raw: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(raw);
    return {
      code: typeof parsed?.code === 'string' ? parsed.code : undefined,
      message: typeof parsed?.message === 'string' ? parsed.message : undefined,
    };
  } catch {
    return {};
  }
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 4 of 6), replace this exact text:

```ts
  if (!res.ok) {
    let message = raw || res.statusText;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.message === 'string') message = parsed.message;
    } catch {
      // Not JSON — a PHP fatal or an HTML error page. Keep the raw text.
    }
    throw new WpEndpointError(`${path} failed ${res.status}: ${message}`, res.status);
  }
```

with:

```ts
  if (!res.ok) {
    // A body that is not JSON (a PHP fatal, an HTML error page) keeps its raw text.
    const { code, message } = parseWpErrorBody(raw);
    throw new WpEndpointError(`${path} failed ${res.status}: ${message ?? (raw || res.statusText)}`, res.status, code);
  }
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 5 of 6), replace this exact text:

```ts
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order create failed ${res.status}: ${text}`, res.status);
  }
```

with:

```ts
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new WpEndpointError(`WC order create failed ${res.status}: ${text}`, res.status, parseWpErrorBody(text).code);
  }
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/wp-endpoint.ts` (edit 6 of 6), replace this exact text:

```ts
/* ---------------------------------------------------------------- media --- */
```

with:

```ts
/* ------------------------------------------------ clinic payment settings --- */

/** The plugin's PUT body — the option's storage keys (spec §1). `updated_at` is stamped by the plugin. */
export interface ClinicPaymentSettingsWire {
  international: boolean;
  fx_rate: number | null;
  markup_percent: number | null;
  fixed_fee_idr: number | null;
  updated_by: number | null;
}

/**
 * Write one clinic's payment option through the plugin, so WordPress's object cache
 * stays consistent. Errors arrive as WpEndpointError with the plugin's `code`
 * (`clinic_not_found`, `invalid_settings`, `fx_rate_required`, `save_failed`).
 */
export async function putClinicPaymentSettings(clinicId: number, body: ClinicPaymentSettingsWire): Promise<void> {
  await wpRequestJson<unknown>(`/clinics/${clinicId}/payment-settings`, { method: 'PUT', body });
}

/* ---------------------------------------------------------------- media --- */
```

- [ ] **Step 5: Add toCharge to intl-pricing**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` (edit 1 of 2), replace this exact text:

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
```

with:

```ts
import type { PaymentMethod, WcCharge } from '@/lib/wp-endpoint';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` (edit 2 of 2), replace this exact text:

```ts
/** Integer cents of a plugin-reported amount, for the backstop comparison. */
```

with:

```ts
/** The `charge` sent to the plugin. `fee` is left out, never null, when there is no fee line. */
export function toCharge(quote: UsdQuote): WcCharge {
  const fee = quote.lines.find((l) => l.kind === 'fee');
  return {
    currency: 'USD',
    items: quote.lines.filter((l) => l.kind === 'item').map((l) => ({ name: l.name, amount: l.usd })),
    taxes: quote.lines.filter((l) => l.kind === 'tax').map((l) => ({ name: l.name, amount: l.usd })),
    ...(fee ? { fee: { name: fee.name, amount: fee.usd } } : {}),
    total: quote.totalUsd,
    snapshot: quote.snapshot,
  };
}

/** Integer cents of a plugin-reported amount, for the backstop comparison. */
```

- [ ] **Step 6: Run them — expect PASS — and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/intl-pricing.test.ts tests/payments/wp-endpoint.test.ts tests/lib/wp-endpoint-unreachable.test.ts tests/lib/wp-endpoint-fetch-media.test.ts && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  4 passed (4)`, `Tests  102 passed (102)` (intl-pricing 70, wp-endpoint 17, wp-endpoint-unreachable 6, wp-endpoint-fetch-media 9), then `tsc exit=0`.

- [ ] **Step 7: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/lib/wp-endpoint.ts src/services/payments/intl-pricing.ts tests/payments/wp-endpoint.test.ts tests/payments/intl-pricing.test.ts && git commit -F - <<'EOF'
feat(payments): kirim charge USD ke plugin dan baca kode error WordPress

CreateWcOrderInput mendapat charge (baris USD jadi, string 2 desimal, fee
dihilangkan bila nol). WpEndpointError membawa code dari body error
WordPress di createWcOrder dan wpRequestJson, supaya route bisa memetakan
per kode. putClinicPaymentSettings untuk PUT pengaturan klinik ke plugin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds and `git status --short` prints nothing. Never use `git add -A` / `git add .` (the `node_modules` symlink from Task B0 is not a directory to git).

### Task B4: Error berkode untuk kedua route bayar — `badGateway`, `payment-errors.ts`, wiring route, OpenAPI

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/problem-details.ts` (insert `badGateway` above `serviceUnavailable`, line 159)
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment-errors.ts`
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/public/payments/route.ts` (one import after line 11; one branch after line 54)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/sessions/payment-verify/route.ts` (one import after line 7; catch block, lines 39–42). A separate session changes this file's imports (between lines 4 and 5) and the `ensureSessionPayment(...)` call (line 35) on branch `fix/payment-verify-clinic-scope`: touch ONLY the two places shown, and do not reorder or reformat other lines, so a later rebase merges without conflicts.
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (responses of `/api/v1/public/payments` and `/api/v1/sessions/payment-verify`; the `Problem` schema gains `code`)
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-errors.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-routes.test.ts`, `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/session-routes.test.ts`

**Interfaces:** Consumes: `WpEndpointError.code` (Task B3), `PaymentSettingsUnavailableError` (Task B2), `forbidden` / `serviceUnavailable` / `validationError` / `badRequest` / `notFound` / `conflict` / `problem` (`@/lib/problem-details`), `logging.error`. / Produces (exact contract names): `badGateway(code: string, detail?: string, instance?: string): ProblemDetails` (502, title `Bad Gateway`, type `problemUri('bad-gateway')`); `PaymentMethodNotAllowedError`, `PaypalRateMissingError`, `ChargeMismatchError`, `DiscountNotSupportedError` (each `extends Error {}`); `paymentErrorProblem(err: unknown): ProblemDetails | null`. One extra helper, not in the contract and used only by `sessions/payment-verify`: `statusProblem(status: number, detail: string): ProblemDetails` — 400 `bad_request`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 422 `invalid_input`, any status ≥ 500 `internal_error`, any other status kept with code `request_failed`.

Mapping (spec §3): 403 `payment_method_not_allowed`; 503 `paypal_rate_missing` (no Retry-After); 503 `payment_settings_unavailable`; 502 `charge_mismatch`; 422 `discount_not_supported`. Plugin codes: `clinic_not_international` → 403 `payment_method_not_allowed`; `charge_mismatch` → 502 `charge_mismatch`; `paypal_rate_missing` → 503 `paypal_rate_missing`; `gateway_missing` → 503 `payment_method_unavailable`; `woocommerce_missing` or status 0 → 503 `payment_unavailable`; `invalid_charge` → 502 `payment_gateway_rejected`; any other `WpEndpointError` → 502 `payment_start_failed`. The WordPress message goes to `logging.error('WordPress payment call failed', err, { metadata: { status, code, message } })` (fire-and-forget — `logging` never rejects) and never into the response. Both routes keep their `NextResponse.json(p, { status: p.status })` style, so no `Retry-After` header is ever set.

- [ ] **Step 1: Write the failing payment-errors test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-errors.test.ts` with exactly this content:

```ts
/**
 * paymentErrorProblem — the problem+json table of spec §3 ("New errors" and "Mapping
 * plugin errors"). The WordPress message is logged, never returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
  paymentErrorProblem,
  statusProblem,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError, WpConfigError } from '@/lib/wp-endpoint';
import { badGateway } from '@/lib/problem-details';

beforeEach(() => vi.clearAllMocks());

describe('badGateway', () => {
  it('builds a coded 502 problem', () => {
    const p = badGateway('charge_mismatch', 'detail here');
    expect(p).toMatchObject({ status: 502, title: 'Bad Gateway', code: 'charge_mismatch', detail: 'detail here' });
    expect(p.type).toMatch(/\/bad-gateway$/);
  });
});

describe('paymentErrorProblem — our own errors', () => {
  it.each([
    ['PaymentMethodNotAllowedError', 403, 'payment_method_not_allowed', new PaymentMethodNotAllowedError('x')],
    ['PaypalRateMissingError', 503, 'paypal_rate_missing', new PaypalRateMissingError('x')],
    ['PaymentSettingsUnavailableError', 503, 'payment_settings_unavailable', new PaymentSettingsUnavailableError('x')],
    ['ChargeMismatchError', 502, 'charge_mismatch', new ChargeMismatchError('x')],
    ['DiscountNotSupportedError', 422, 'discount_not_supported', new DiscountNotSupportedError('x')],
  ])('%s -> %i %s', (_name, status, code, err) => {
    expect(paymentErrorProblem(err)).toMatchObject({ status, code });
  });

  it('returns null for an error it does not own', () => {
    expect(paymentErrorProblem(new Error('boom'))).toBeNull();
    expect(paymentErrorProblem('not an error')).toBeNull();
  });
});

describe('paymentErrorProblem — plugin errors, by code', () => {
  it.each([
    ['clinic_not_international', 409, 403, 'payment_method_not_allowed'],
    ['charge_mismatch', 502, 502, 'charge_mismatch'],
    ['paypal_rate_missing', 503, 503, 'paypal_rate_missing'],
    ['gateway_missing', 503, 503, 'payment_method_unavailable'],
    ['woocommerce_missing', 503, 503, 'payment_unavailable'],
    ['invalid_charge', 400, 502, 'payment_gateway_rejected'],
    ['payment_start_failed', 502, 502, 'payment_start_failed'],
    ['order_create_failed', 500, 502, 'payment_start_failed'],
    ['amount_collapsed', 500, 502, 'payment_start_failed'],
  ])('%s (WP %i) -> %i %s', (code, wpStatus, status, expected) => {
    const p = paymentErrorProblem(new WpEndpointError(`WC order create failed ${wpStatus}: secret wp detail`, wpStatus, code));
    expect(p).toMatchObject({ status, code: expected });
  });

  it('maps an unreachable WordPress (status 0) to 503 payment_unavailable', () => {
    expect(paymentErrorProblem(new WpEndpointError('/payments/order unreachable: ECONNREFUSED', 0))).toMatchObject({
      status: 503, code: 'payment_unavailable',
    });
  });

  it('maps a missing service token to 502 payment_start_failed', () => {
    expect(paymentErrorProblem(new WpConfigError('WORDPRESS_SERVICE_TOKEN not set'))).toMatchObject({
      status: 502, code: 'payment_start_failed',
    });
  });

  it('logs the WordPress message and never returns it', () => {
    const err = new WpEndpointError('WC order create failed 500: secret wp detail', 500, 'order_create_failed');

    const p = paymentErrorProblem(err);

    expect(JSON.stringify(p)).not.toContain('secret wp detail');
    expect(logging.logging.error).toHaveBeenCalledWith(
      'WordPress payment call failed',
      err,
      { metadata: { status: 500, code: 'order_create_failed', message: 'WC order create failed 500: secret wp detail' } },
    );
  });
});

describe('statusProblem', () => {
  it.each([
    [400, 'bad_request'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid_input'],
    [500, 'internal_error'],
    [401, 'request_failed'],
  ])('%i -> %s, keeping the status and detail', (status, code) => {
    expect(statusProblem(status, 'Bill not found')).toMatchObject({ status, code, detail: 'Bill not found' });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-errors.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/services/payments/payment-errors' imported from …`; `Test Files  1 failed (1)`.

- [ ] **Step 3: Add badGateway to problem-details**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/lib/problem-details.ts`, replace this exact text:

```ts
/** 503 — service unavailable. */
```

with:

```ts
/** 502 — an upstream (WordPress / WooCommerce) answered, but not usefully. */
export function badGateway(code: string, detail?: string, instance?: string): ProblemDetails {
  return problem({
    type: problemUri('bad-gateway'),
    title: 'Bad Gateway',
    status: 502,
    code,
    detail,
    instance,
  });
}

/** 503 — service unavailable. */
```

- [ ] **Step 4: Write payment-errors.ts**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment-errors.ts` with exactly this content:

```ts
/**
 * Payment-route errors and their problem+json mapping (spec §3, "New errors" and
 * "Mapping plugin errors").
 *
 * Both payment routes — `POST /public/payments` and `POST /sessions/payment-verify` —
 * answer these with a coded problem, so the FE branches on `code`, never on status.
 * The WordPress message is logged and never returned to the client.
 */
import { WpEndpointError } from '@/lib/wp-endpoint';
import { logging } from '@/lib/logging';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  notFound,
  problem,
  serviceUnavailable,
  validationError,
  type ProblemDetails,
} from '@/lib/problem-details';

/** paypal/card on a clinic that is not international, or on a free order. 403. */
export class PaymentMethodNotAllowedError extends Error {}
/** The clinic is international but has no usable rate (rule 3). 503, no Retry-After. */
export class PaypalRateMissingError extends Error {}
/** The order total differs from the quote (plugin check or our backstop). 502. */
export class ChargeMismatchError extends Error {}
/** Staff route: paypal/card on a bill with a discount. 422. */
export class DiscountNotSupportedError extends Error {}

function wpErrorProblem(err: WpEndpointError): ProblemDetails {
  // Fire-and-forget: logging.write swallows its own failures and never rejects.
  void logging.error('WordPress payment call failed', err, {
    metadata: { status: err.status, code: err.code ?? null, message: err.message },
  });

  switch (err.code) {
    case 'clinic_not_international':
      return forbidden('payment_method_not_allowed', 'This payment method is not available for this clinic');
    case 'charge_mismatch':
      return badGateway('charge_mismatch', 'The payment amount could not be confirmed. Please try again.');
    case 'paypal_rate_missing':
      return serviceUnavailable('paypal_rate_missing', 'PayPal is temporarily unavailable for this clinic');
    case 'gateway_missing':
      return serviceUnavailable('payment_method_unavailable', 'This payment method is temporarily unavailable');
    case 'woocommerce_missing':
      return serviceUnavailable('payment_unavailable', 'Payments are temporarily unavailable. Please try again.');
    case 'invalid_charge':
      return badGateway('payment_gateway_rejected', 'The payment could not be started. Please try again.');
  }
  if (err.status === 0) {
    return serviceUnavailable('payment_unavailable', 'Payments are temporarily unavailable. Please try again.');
  }
  return badGateway('payment_start_failed', 'The payment could not be started. Please try again.');
}

/**
 * Coded problem for a payment error, or null for anything else (the caller keeps its
 * existing handling). WpEndpointError is mapped by `code`, never by passing its status
 * through.
 */
export function paymentErrorProblem(err: unknown): ProblemDetails | null {
  if (err instanceof PaymentMethodNotAllowedError) {
    return forbidden('payment_method_not_allowed', 'This payment method is not available for this clinic');
  }
  if (err instanceof PaypalRateMissingError) {
    return serviceUnavailable('paypal_rate_missing', 'PayPal is temporarily unavailable for this clinic');
  }
  if (err instanceof PaymentSettingsUnavailableError) {
    // Fire-and-forget, like wpErrorProblem: the 503 says "try again", the log says why.
    void logging.error('Clinic payment settings could not be read during payment', err, {
      metadata: { cause: err.cause instanceof Error ? err.cause.message : String(err.cause ?? '') },
    });
    return serviceUnavailable('payment_settings_unavailable', 'Payment settings could not be read. Please try again.');
  }
  if (err instanceof ChargeMismatchError) {
    return badGateway('charge_mismatch', 'The payment amount could not be confirmed. Please try again.');
  }
  if (err instanceof DiscountNotSupportedError) {
    return validationError('discount_not_supported', 'PayPal and card cannot be used on a discounted bill');
  }
  if (err instanceof WpEndpointError) return wpErrorProblem(err);
  return null;
}

/**
 * A coded problem for a plain HTTP status — KcError's `httpStatus`, or 500 for an
 * error nothing recognised. Lets `sessions/payment-verify` answer every error with a
 * `code`, not only the payment ones.
 */
export function statusProblem(status: number, detail: string): ProblemDetails {
  switch (status) {
    case 400:
      return badRequest('bad_request', detail);
    case 403:
      return forbidden('forbidden', detail);
    case 404:
      return notFound('not_found', detail);
    case 409:
      return conflict('conflict', detail);
    case 422:
      return validationError('invalid_input', detail);
    default:
      return problem({
        type: 'about:blank',
        title: detail,
        status,
        code: status >= 500 ? 'internal_error' : 'request_failed',
        detail,
      });
  }
}
```

- [ ] **Step 5: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-errors.test.ts
```

Expected: `Tests  26 passed (26)`.

- [ ] **Step 6: Add the failing public-route tests**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-routes.test.ts` (edit 1 of 3), replace this exact text:

```ts
// Tokens carry wp_kc_appointments.id now; a non-numeric payload fails closed.
```

with:

```ts
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
// Tokens carry wp_kc_appointments.id now; a non-numeric payload fails closed.
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-routes.test.ts` (edit 2 of 3), replace this exact text:

```ts
import * as svc from '@/services/payments/payment.service';
```

with:

```ts
import * as svc from '@/services/payments/payment.service';
import {
  ChargeMismatchError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-routes.test.ts` (edit 3 of 3), replace this exact text:

```ts
  it('400 on an unknown method, without calling the service', async () => {
    const res = await initiate(req({ token: 'good', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.initiatePublicPayment).not.toHaveBeenCalled();
  });
});
```

with:

```ts
  it('400 on an unknown method, without calling the service', async () => {
    const res = await initiate(req({ token: 'good', method: 'gopay' }));
    expect(res.status).toBe(400);
    expect(svc.initiatePublicPayment).not.toHaveBeenCalled();
  });
});

describe('POST /public/payments — international payment errors', () => {
  it.each([
    ['a clinic that is not international', 403, 'payment_method_not_allowed', () => new PaymentMethodNotAllowedError('no')],
    ['an international clinic with no usable rate', 503, 'paypal_rate_missing', () => new PaypalRateMissingError('no rate')],
    ['a settings read error', 503, 'payment_settings_unavailable', () => new PaymentSettingsUnavailableError('db down')],
    ['the backstop', 502, 'charge_mismatch', () => new ChargeMismatchError('13.61 != 13.62')],
  ])('answers %s with %i %s', async (_label, status, code, makeErr) => {
    (svc.initiatePublicPayment as any).mockRejectedValue(makeErr());
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ status, code });
    // The 503 configuration states carry no Retry-After.
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it.each([
    ['clinic_not_international', 409, 403, 'payment_method_not_allowed'],
    ['charge_mismatch', 502, 502, 'charge_mismatch'],
    ['paypal_rate_missing', 503, 503, 'paypal_rate_missing'],
    ['gateway_missing', 503, 503, 'payment_method_unavailable'],
    ['woocommerce_missing', 503, 503, 'payment_unavailable'],
    ['invalid_charge', 400, 502, 'payment_gateway_rejected'],
    ['order_create_failed', 500, 502, 'payment_start_failed'],
  ])('maps plugin code %s (WP %i) to %i %s, without the WordPress message', async (wpCode, wpStatus, status, code) => {
    (svc.initiatePublicPayment as any).mockRejectedValue(
      new WpEndpointError(`WC order create failed ${wpStatus}: secret wp detail`, wpStatus, wpCode),
    );
    const res = await initiate(req({ token: 'good', method: 'paypal' }));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject({ status, code });
    expect(JSON.stringify(body)).not.toContain('secret wp detail');
  });

  it('maps an unreachable WordPress to 503 payment_unavailable', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new WpEndpointError('/payments/order unreachable', 0));
    const res = await initiate(req({ token: 'good', method: 'card' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('payment_unavailable');
  });

  it('still answers 500 for an error nobody recognises', async () => {
    (svc.initiatePublicPayment as any).mockRejectedValue(new Error('boom'));
    const res = await initiate(req({ token: 'good' }));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 7: Add the failing session-route tests**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/session-routes.test.ts` (edit 1 of 3), replace this exact text:

```ts
vi.mock('@/lib/kc-response', () => ({
```

with:

```ts
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/kc-response', () => ({
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/session-routes.test.ts` (edit 2 of 3), replace this exact text:

```ts
import { requireRoles } from '@/lib/auth/route-guards';
```

with:

```ts
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError } from '@/lib/wp-endpoint';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/session-routes.test.ts` (edit 3 of 3), **append** the block below at the very END of the file, after the closing `});` of the last describe (`'POST /sessions/payment-webhook — null transactionId'`). Do not put it before `function webhookReq`: the parallel branch `fix/payment-verify-clinic-scope` inserts its own describe there, and two inserts at the same spot conflict on rebase.

```ts

describe('POST /sessions/payment-verify — coded errors', () => {
  const staff = { actor: { id: 'u1', role: 'RECEPTIONIST', practiceId: 'p1' } };

  it.each([
    ['a clinic that is not international', 403, 'payment_method_not_allowed', () => new PaymentMethodNotAllowedError('no')],
    ['an international clinic with no usable rate', 503, 'paypal_rate_missing', () => new PaypalRateMissingError('no rate')],
    ['a settings read error', 503, 'payment_settings_unavailable', () => new PaymentSettingsUnavailableError('db down')],
    ['the backstop', 502, 'charge_mismatch', () => new ChargeMismatchError('8.33 != 8.34')],
    ['a discounted bill', 422, 'discount_not_supported', () => new DiscountNotSupportedError('discount')],
  ])('answers %s with %i %s', async (_label, status, code, makeErr) => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockRejectedValue(makeErr());
    const res = await paymentVerify(req({ billId: '9', method: 'paypal' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ status, code });
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it.each([
    ['clinic_not_international', 409, 403, 'payment_method_not_allowed'],
    ['charge_mismatch', 502, 502, 'charge_mismatch'],
    ['paypal_rate_missing', 503, 503, 'paypal_rate_missing'],
    ['gateway_missing', 503, 503, 'payment_method_unavailable'],
    ['woocommerce_missing', 503, 503, 'payment_unavailable'],
    ['invalid_charge', 400, 502, 'payment_gateway_rejected'],
    ['order_create_failed', 500, 502, 'payment_start_failed'],
  ])('maps plugin code %s (WP %i) to %i %s, without the WordPress message', async (wpCode, wpStatus, status, code) => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockRejectedValue(
      new WpEndpointError(`WC order create failed ${wpStatus}: secret wp detail`, wpStatus, wpCode),
    );
    const res = await paymentVerify(req({ billId: '9', method: 'paypal' }));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject({ status, code });
    expect(JSON.stringify(body)).not.toContain('secret wp detail');
  });

  it('maps an unreachable WordPress to 503 payment_unavailable', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockRejectedValue(new WpEndpointError('/payments/order unreachable', 0));
    const res = await paymentVerify(req({ billId: '9', method: 'card' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('payment_unavailable');
  });

  it('answers a KcError with a coded problem', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockRejectedValue(new KcError('Bill not found', 404));
    const res = await paymentVerify(req({ billId: '9' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: 404, code: 'not_found', detail: 'Bill not found' });
  });

  it('answers an unrecognised error with a coded 500', async () => {
    (requireRoles as any).mockResolvedValue(staff);
    (svc.ensureSessionPayment as any).mockRejectedValue(new Error('boom'));
    const res = await paymentVerify(req({ billId: '9' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: 500, code: 'internal_error' });
  });
});
```

Rebase note (only if `fix/payment-verify-clinic-scope` has landed on this branch's base before or while you work): that branch mocks `@/lib/wp-endpoint` with a factory returning only `createWcOrder` and `getWcOrderStatus`. With that mock, `new WpEndpointError(...)` and `instanceof WpEndpointError` throw `No "WpEndpointError" export is defined on the "@/lib/wp-endpoint" mock`. Make its mock partial: `vi.mock('@/lib/wp-endpoint', async (orig) => ({ ...(await orig<typeof import('@/lib/wp-endpoint')>()), ...wpEndpoint }))`. If that branch's describes set a `db.user.findUnique` implementation in a `beforeEach` (e.g. `linkReceptionist`), add the same `beforeEach` to the 'coded errors' describe so it does not depend on test order.

- [ ] **Step 8: Run them — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-routes.test.ts tests/payments/session-routes.test.ts
```

Expected: FAIL with `Tests  27 failed | 34 passed (61)` — the new `international payment errors` / `coded errors` cases get 500 instead of 403/422/502/503 (`expected 500 to be 403`, …) and the KcError / unrecognised-error cases get bodies without `code`. The 33 pre-existing route tests still pass (plus the new public `still answers 500` case).

- [ ] **Step 9: Wire the public route**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/public/payments/route.ts` (edit 1 of 2), replace this exact text:

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
```

with:

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { paymentErrorProblem } from '@/services/payments/payment-errors';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/public/payments/route.ts` (edit 2 of 2), replace this exact text:

```ts
      const p = conflict('payment_already_initiated', 'Payment already initiated — check status instead');
      return NextResponse.json(p, { status: p.status });
    }
```

with:

```ts
      const p = conflict('payment_already_initiated', 'Payment already initiated — check status instead');
      return NextResponse.json(p, { status: p.status });
    }
    const paymentProblem = paymentErrorProblem(err);
    if (paymentProblem) return NextResponse.json(paymentProblem, { status: paymentProblem.status });
```

- [ ] **Step 10: Wire the session route**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/sessions/payment-verify/route.ts` (edit 1 of 2), replace this exact text:

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
```

with:

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { paymentErrorProblem, statusProblem } from '@/services/payments/payment-errors';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/sessions/payment-verify/route.ts` (edit 2 of 2), replace this exact text:

```ts
      return NextResponse.json({ type: 'about:blank', title: err.message, status: err.httpStatus }, { status: err.httpStatus });
    }
    console.error('[sessions/payment-verify] unexpected error:', err);
    return NextResponse.json({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, { status: 500 });
```

with:

```ts
      const p = statusProblem(err.httpStatus, err.message);
      return NextResponse.json(p, { status: p.status });
    }
    const paymentProblem = paymentErrorProblem(err);
    if (paymentProblem) return NextResponse.json(paymentProblem, { status: paymentProblem.status });
    console.error('[sessions/payment-verify] unexpected error:', err);
    const fallback = statusProblem(500, 'Internal Server Error');
    return NextResponse.json(fallback, { status: fallback.status });
```

- [ ] **Step 11: Run them — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-routes.test.ts tests/payments/session-routes.test.ts tests/payments/payment-errors.test.ts
```

Expected: `Test Files  3 passed (3)`, `Tests  87 passed (87)` (public-routes 24, session-routes 37, payment-errors 26). stderr shows `[public/payments] unexpected error: Error: boom` and `[sessions/payment-verify] unexpected error: Error: boom` — expected, from the 500 cases.

- [ ] **Step 12: Document the new error responses in OpenAPI**

Only these two routes and the shared `Problem` schema. The rest of the docs in spec §3 (new route, new fields, guides) belong to the API-docs task — do not touch them here.

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (edit 1 of 3), replace this exact text:

```yaml
                $ref: '#/components/schemas/Problem'
      security: []
  /api/v1/public/practices:
```

with:

```yaml
                $ref: '#/components/schemas/Problem'
        '403':
          description: >-
            `payment_method_not_allowed` — `paypal` or `card` on a clinic that is not
            international, or on a free order. Offer the row's `paymentMethods` instead.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '500':
          description: Unexpected error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '502':
          description: >-
            `charge_mismatch` (the order total differed from the quote; no order is kept, retry),
            `payment_gateway_rejected`, or `payment_start_failed`. The WordPress message is never returned.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '503':
          description: >-
            `paypal_rate_missing` or `payment_method_unavailable` (configuration — pay with Xendit; no
            Retry-After), `payment_settings_unavailable` (settings read failed — retry), or
            `payment_unavailable` (WordPress/WooCommerce unreachable — retry).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
      security: []
  /api/v1/public/practices:
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (edit 2 of 3), replace this exact text:

```yaml
        '400':
          description: Missing billId, or an underlying KcError (e.g. bill not found)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
      security:
        - bearerAuth: []
  /api/v1/sessions/payment-webhook:
```

with:

```yaml
        '400':
          description: Missing billId (`invalid_input`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          description: >-
            Role not allowed, or `payment_method_not_allowed` — `paypal` or `card` on a clinic that
            is not international, or on a free bill.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '404':
          description: Bill not found (`not_found`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '422':
          description: >-
            `discount_not_supported` — `paypal` or `card` on a bill with a discount. Use Xendit.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '500':
          description: Unexpected error (`internal_error`)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '502':
          description: >-
            `charge_mismatch` (the order total differed from the quote; no order is kept, retry),
            `payment_gateway_rejected`, or `payment_start_failed`. The WordPress message is never returned.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        '503':
          description: >-
            `paypal_rate_missing` or `payment_method_unavailable` (configuration — no Retry-After),
            `payment_settings_unavailable` (settings read failed — retry), or `payment_unavailable`
            (WordPress/WooCommerce unreachable — retry).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
      security:
        - bearerAuth: []
  /api/v1/sessions/payment-webhook:
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (edit 3 of 3), replace this exact text:

```yaml
        status:
          type: integer
        detail:
          type: string
    ValidationProblem:
```

with:

```yaml
        status:
          type: integer
        code:
          type: string
          description: App-specific error code. Clients branch on this, never on status alone.
        detail:
          type: string
    ValidationProblem:
```

- [ ] **Step 13: Validate the YAML, run the payment suite, typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && node -e "const y=require('js-yaml');const d=y.load(require('fs').readFileSync('docs/api/openapi.yaml','utf8'));console.log(Object.keys(d.paths['/api/v1/public/payments'].post.responses).join(','));console.log(Object.keys(d.paths['/api/v1/sessions/payment-verify'].post.responses).join(','))" && npx vitest run tests/payments && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `201,400,403,404,409,500,502,503`, then `200,400,401,403,404,422,500,502,503` (JavaScript lists numeric keys in ascending order); `Test Files  12 passed (12)`, `Tests  254 passed (254)`; `tsc exit=0`.

- [ ] **Step 14: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/lib/problem-details.ts src/services/payments/payment-errors.ts src/app/api/v1/public/payments/route.ts src/app/api/v1/sessions/payment-verify/route.ts docs/api/openapi.yaml tests/payments/payment-errors.test.ts tests/payments/public-routes.test.ts tests/payments/session-routes.test.ts && git commit -F - <<'EOF'
feat(payments): error pembayaran berkode problem+json di kedua route

badGateway (502) di problem-details; payment-errors.ts memetakan error
gerbang internasional dan kode plugin (WpEndpointError.code) ke
problem+json berkode. Pesan WordPress hanya dicatat, tidak dikirim ke
klien. sessions/payment-verify kini juga memberi code untuk KcError dan 500.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds and `git status --short` prints nothing. Never use `git add -A` / `git add .` (the `node_modules` symlink from Task B0 is not a directory to git).

### Task B5: Gerbang klinik internasional + backstop di `initiatePublicPayment` dan `ensureSessionPayment`

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (imports at lines 234 and 243; new private helpers above `initiatePublicPayment`, line 284; `initiatePublicPayment`, lines 316–340; `ensureSessionPayment`, lines 554–583)
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (Prisma mock, imports, `clinicOption` fixture, `beforeEach`, the two existing paypal tests, two new describe blocks at the end)

A separate session (branch `fix/payment-verify-clinic-scope`) moves `const bill = await getBill(...)` to the top of `ensureSessionPayment` and adds a doc comment plus a `scope` parameter at `export async function ensureSessionPayment(`. To keep that rebase clean: the new helpers go above `initiatePublicPayment` (NOT above `ensureSessionPayment`), the session-side insertion is anchored on the `computeSessionAmountFromBill(bill)` line (both branches keep it), and the `getBill` line and the function signature stay untouched.

**Interfaces:** Consumes: `resolveClinicPayment` (Task B2); `gateUsdPayment`, `toCharge`, `amountToCents`, `notInternational`, `ClinicPaymentSettings`, `UsdQuote` (Tasks B1/B3); `CreateWcOrderResult`, `WcCharge` (`@/lib/wp-endpoint`); the four error classes (Task B4); `jobs.enqueue` (`@/lib/jobs/client`). / Produces: behaviour only — the exported signatures `initiatePublicPayment(appointmentId, method)` and `ensureSessionPayment(billId, method)` do not change.

Behaviour (contract "payment.service.ts behaviour (B5)"):
- `initiatePublicPayment`: existing checks (status, pending order) → `listServicesForDoctor` + `computePublicAmount` (unchanged) → if `method !== 'xendit'`: `resolveClinicPayment(appt.clinicId)` (may throw `PaymentSettingsUnavailableError`) → `gateUsdPayment(items, taxes, settings)`: `not_allowed` → `PaymentMethodNotAllowedError`, `rate_missing` → `PaypalRateMissingError` → `createWcOrder({ …, method, charge: toCharge(quote) })` → backstop: when `amountToCents(wcOrder.chargedAmount ?? -1) !== quote.totalCents`, enqueue `{ hook: 'praktiqu_payment_auto_cancel', runAt: new Date(), args: { wcOrderId } }`, write NO `payment_orders` row and throw `ChargeMismatchError` (a failing enqueue is logged and still ends in `ChargeMismatchError`) → `payment_orders` gets `expectedAmount = quote.expectedIdr` and `fxRate = Number(quote.effectiveFxRate)` → the normal delayed auto-cancel. Xendit: no settings read, no `charge` key, unchanged.
- `ensureSessionPayment`: existing-order reuse unchanged → `getBill` → if `method !== 'xendit'`: `bill.discount > 0` → `DiscountNotSupportedError` before any settings read → `bill.clinic?.id ? resolveClinicPayment(bill.clinic.id) : notInternational(0)` → the same gate, charge and backstop. `expectedAmount` stays `bill.total_amount`; `fxRate = Number(quote.effectiveFxRate)` for USD orders.
- `orchestration.test.ts`'s Prisma mock gains `kcOption.findMany`, so the real repo → service → pure-module chain runs; `beforeEach` defaults it to `[]` (no clinic is international). The two existing paypal tests now flag clinic 3 with `fx_rate: 18000, markup_percent: 0`: Rp 100,000 → `5.56` (the old mock used an arbitrary `11.12`), Rp 150,000 → `8.34` (unchanged — it already matched).

- [ ] **Step 1: Write the failing orchestration tests**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 1 of 8), replace this exact text:

```ts
    kcUser: { findUnique: vi.fn() },
  };
```

with:

```ts
    kcUser: { findUnique: vi.fn() },
    // wp_options — the per-clinic international payment option and the global rate/markup.
    kcOption: { findMany: vi.fn() },
  };
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 2 of 8), replace this exact text:

```ts
import { calculateTax, getBill } from '@/services/billing/bill.service';
```

with:

```ts
import { calculateTax, getBill } from '@/services/billing/bill.service';
import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 3 of 8), replace this exact text:

```ts
function appointmentRow(status: string) {
```

with:

```ts
/** The wp_options row that flags CLINIC as international (spec §1 storage format). */
function clinicOption(fields: Record<string, unknown>) {
  return {
    optionName: `praktiqu_endpoint_clinic_${CLINIC}_payment`,
    optionValue: JSON.stringify({
      international: true, fx_rate: null, markup_percent: null, fixed_fee_idr: null,
      updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123,
      ...fields,
    }),
  };
}

function appointmentRow(status: string) {
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 4 of 8), replace this exact text:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
```

with:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  // No option rows: every clinic is not international unless a test says otherwise.
  db.kcOption.findMany.mockResolvedValue([]);
  sessions.findSessionById.mockResolvedValue(appointmentRow('PENDING'));
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 5 of 8), replace this exact text:

```ts
    // foreign-charge figures survive onto the payment_orders row — only the
    // null-fallback case above was covered for public bookings.
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 42, checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: 11.12, chargedCurrency: 'USD', fxRate: 18000,
    });
```

with:

```ts
    // foreign-charge figures survive onto the payment_orders row — only the
    // null-fallback case above was covered for public bookings.
    // PayPal now needs an international clinic: Rp 100,000 at 18,000 with no markup
    // is ceil(555.5…) = 556 cents.
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 0 })]);
    db.paymentOrder.findFirst.mockResolvedValue(null);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 42, checkoutUrl: 'https://wp/checkout/42',
      chargedAmount: 5.56, chargedCurrency: 'USD', fxRate: 18000,
    });
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 6 of 8), replace this exact text:

```ts
        gateway: 'paypal',
        chargedCurrency: 'USD',
        chargedAmount: 11.12,
        fxRate: 18000,
```

with:

```ts
        gateway: 'paypal',
        chargedCurrency: 'USD',
        chargedAmount: 5.56,
        fxRate: 18000,
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 7 of 8), replace this exact text:

```ts
  it('forwards method to createWcOrder and persists gateway/chargedCurrency/chargedAmount/fxRate for a paypal order', async () => {
    db.paymentOrder.findFirst.mockResolvedValue(null); // no existing order for this bill
```

with:

```ts
  it('forwards method to createWcOrder and persists gateway/chargedCurrency/chargedAmount/fxRate for a paypal order', async () => {
    // Rp 150,000 at 18,000 with no markup is ceil(833.3…) = 834 cents.
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 0 })]);
    db.paymentOrder.findFirst.mockResolvedValue(null); // no existing order for this bill
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/orchestration.test.ts` (edit 8 of 8), replace this exact text:

```ts
        chargedAmount: 8.34,
        fxRate: 18000,
      }),
    }));
    expect(result.chargedCurrency).toBe('USD');
  });
});
```

with:

```ts
        chargedAmount: 8.34,
        fxRate: 18000,
      }),
    }));
    expect(result.chargedCurrency).toBe('USD');
  });
});

describe('initiatePublicPayment — international gate (paypal/card)', () => {
  function servicePrice(charges: string) {
    services.listServicesForDoctor.mockResolvedValue([
      {
        mappingId: 11n, serviceId: BigInt(SERVICE), doctorId: BigInt(DOCTOR), clinicId: BigInt(CLINIC),
        name: 'Konsultasi', type: 'KONSELING', charges, durationMinutes: 60,
        isPublic: true, isActive: true, telemedService: null, nameAlias: null,
      },
    ]);
  }

  beforeEach(() => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    db.paymentOrder.create.mockResolvedValue({ id: 'po_usd' });
    servicePrice('200000');
  });

  it('refuses paypal on a clinic that is not international, before any WooCommerce order', async () => {
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('refuses card on a free order even at an international clinic', async () => {
    servicePrice('0');
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, fixed_fee_idr: 25000 })]);
    await expect(initiatePublicPayment(APPOINTMENT, 'card')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('answers paypal_rate_missing (not "not allowed") for an international clinic with no usable rate', async () => {
    db.kcOption.findMany.mockResolvedValue([
      clinicOption({ fx_rate: null }),
      { optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: '500000' },
    ]);
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaypalRateMissingError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('answers payment_settings_unavailable when the settings read fails', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentSettingsUnavailableError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('keeps the existing pending-order check first', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(PaymentAlreadyInitiatedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });

  it('sends the worked example as charge and records the quote on payment_orders', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 77, checkoutUrl: 'https://paypal.com/checkout/77',
      chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64,
    });

    const result = await initiatePublicPayment(APPOINTMENT, 'paypal');

    const sent = wpEndpoint.createWcOrder.mock.calls[0][0];
    // The rupiah lines still go along: the plugin derives praktiqu_expected_idr from them.
    expect(sent.items).toEqual([{ name: 'Konsultasi', price: 200000 }]);
    expect(sent.charge).toEqual({
      currency: 'USD',
      items: [{ name: 'Konsultasi', amount: '12.23' }],
      taxes: [],
      fee: { name: 'International service fee', amount: '1.39' },
      total: '13.62',
      snapshot: {
        clinicId: CLINIC, fxRate: '18000', markupPercent: '10', fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
    });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gateway: 'paypal',
        wcOrderId: 77,
        expectedAmount: 200000,
        chargedAmount: 13.62,
        chargedCurrency: 'USD',
        fxRate: Number('16363.636363636363636'),
      }),
    }));
    // The normal delayed auto-cancel, not the immediate backstop one.
    const enqueued = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(enqueued.args).toEqual({ wcOrderId: 77 });
    expect(enqueued.runAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(result).toEqual({ checkoutUrl: 'https://paypal.com/checkout/77', chargedAmount: 13.62, chargedCurrency: 'USD' });
  });

  it.each([
    ['an older plugin that converted on its own', 13.61],
    ['an older plugin that reports no charge', null],
  ])('backstop: %s — immediate auto-cancel, no payment_orders row, ChargeMismatchError', async (_label, charged) => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({
      orderId: 78, checkoutUrl: 'https://paypal.com/checkout/78',
      chargedAmount: charged, chargedCurrency: 'USD', fxRate: 16363.64,
    });
    const before = Date.now();

    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(ChargeMismatchError);

    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = jobsClient.jobs.enqueue.mock.calls[0][0];
    expect(enqueued.hook).toBe('praktiqu_payment_auto_cancel');
    expect(enqueued.args).toEqual({ wcOrderId: 78 });
    expect(enqueued.runAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(enqueued.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(logging.logging.error).toHaveBeenCalledWith(
      'Charged amount differs from the USD quote — WooCommerce order cancelled',
      undefined,
      expect.objectContaining({ metadata: expect.objectContaining({ wcOrderId: 78, quotedTotalUsd: '13.62' }) }),
    );
  });

  it('still throws ChargeMismatchError when the cancel cannot be enqueued', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 79, checkoutUrl: 'u', chargedAmount: 1, chargedCurrency: 'USD', fxRate: 1 });
    jobsClient.jobs.enqueue.mockRejectedValueOnce(new Error('jobs down'));

    await expect(initiatePublicPayment(APPOINTMENT, 'paypal')).rejects.toThrow(ChargeMismatchError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('lets a plugin error through and writes no payment_orders row', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000 })]);
    const pluginError = Object.assign(new Error('WC order create failed 502'), { status: 502, code: 'charge_mismatch' });
    wpEndpoint.createWcOrder.mockRejectedValue(pluginError);

    await expect(initiatePublicPayment(APPOINTMENT, 'card')).rejects.toBe(pluginError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('leaves xendit alone at an international clinic: no settings read, no charge', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 80, checkoutUrl: 'u', chargedAmount: 200000, chargedCurrency: 'IDR', fxRate: null });

    await initiatePublicPayment(APPOINTMENT, 'xendit');

    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder.mock.calls[0][0]).not.toHaveProperty('charge');
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expectedAmount: 200000, fxRate: null }),
    }));
  });
});

describe('ensureSessionPayment — international gate (paypal/card)', () => {
  const BILL_ID = '77';

  function bill(overrides: Record<string, unknown> = {}) {
    return {
      id: 77, invoiceId: 77, date: new Date('2026-07-01T00:00:00Z'), status: 'unpaid',
      clinic: { id: CLINIC }, doctor: { id: DOCTOR }, patient: { id: 461 },
      patientEncounter: { id: 91, appointmentId: APPOINTMENT },
      serviceItems: [{ id: 1, serviceId: SERVICE, service_name: 'Konsultasi', quantity: 1, price: 200000, total: 200000 }],
      service_total: 200000, discount: 0,
      totalTax: 0, taxItems: [], total_amount: 200000, actual_amount: 200000,
      ...overrides,
    };
  }

  beforeEach(() => {
    db.paymentOrder.findFirst.mockResolvedValue(null);
    db.paymentOrder.create.mockResolvedValue({ id: 'po_session_usd' });
    db.kcUser.findUnique.mockResolvedValue({ displayName: 'Jane Doe', userEmail: 'jane@x.com' });
    vi.mocked(getBill).mockResolvedValue(bill() as never);
  });

  it('refuses paypal on a discounted bill before reading settings or creating an order', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ discount: 20000, total_amount: 180000 }) as never);
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000 })]);

    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(DiscountNotSupportedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('still lets xendit pay a discounted bill', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ discount: 20000, total_amount: 180000 }) as never);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 90, checkoutUrl: 'u', chargedAmount: 180000, chargedCurrency: 'IDR', fxRate: null });

    await ensureSessionPayment(BILL_ID, 'xendit');

    expect(wpEndpoint.createWcOrder.mock.calls[0][0]).not.toHaveProperty('charge');
  });

  it('refuses paypal on a clinic that is not international', async () => {
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });

  it('treats a bill with clinic id 0 as not international, without a settings query', async () => {
    vi.mocked(getBill).mockResolvedValue(bill({ clinic: { id: 0 } }) as never);

    await expect(ensureSessionPayment(BILL_ID, 'card')).rejects.toThrow(PaymentMethodNotAllowedError);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
  });

  it('answers paypal_rate_missing for an international clinic with no usable rate', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: null })]);
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaypalRateMissingError);
  });

  it('answers payment_settings_unavailable when the settings read fails', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));
    await expect(ensureSessionPayment(BILL_ID, 'paypal')).rejects.toThrow(PaymentSettingsUnavailableError);
  });

  it('sends charge and keeps expectedAmount = bill.total_amount', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 91, checkoutUrl: 'https://paypal.com/91', chargedAmount: 13.62, chargedCurrency: 'USD', fxRate: 16363.64 });

    const result = await ensureSessionPayment(BILL_ID, 'paypal');

    expect(wpEndpoint.createWcOrder.mock.calls[0][0].charge).toMatchObject({ total: '13.62', fee: { amount: '1.39' } });
    expect(db.paymentOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'session', expectedAmount: 200000, chargedAmount: 13.62, chargedCurrency: 'USD',
        fxRate: Number('16363.636363636363636'),
      }),
    }));
    expect(result).toMatchObject({ checkoutUrl: 'https://paypal.com/91', status: 'pending', expectedAmount: 200000 });
  });

  it('backstop: a different charged amount cancels at once and writes no row', async () => {
    db.kcOption.findMany.mockResolvedValue([clinicOption({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 })]);
    wpEndpoint.createWcOrder.mockResolvedValue({ orderId: 92, checkoutUrl: 'u', chargedAmount: 12.23, chargedCurrency: 'USD', fxRate: 16363.64 });

    await expect(ensureSessionPayment(BILL_ID, 'card')).rejects.toThrow(ChargeMismatchError);
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(jobsClient.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'praktiqu_payment_auto_cancel', args: { wcOrderId: 92 },
    }));
  });

  it('reuses an existing pending order without running the gate', async () => {
    db.paymentOrder.findFirst.mockResolvedValue({
      wcOrderId: 50, status: 'pending', expectedAmount: 200000, createdAt: new Date(),
      source: 'session', billId: BILL_ID, chargedAmount: 13.62, chargedCurrency: 'USD',
    });

    const result = await ensureSessionPayment(BILL_ID, 'paypal');

    expect(result).toMatchObject({ checkoutUrl: null, status: 'pending' });
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(wpEndpoint.createWcOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/orchestration.test.ts
```

Expected: FAIL with `Tests  15 failed | 33 passed (48)` — 15 of the 20 new cases fail, e.g. `refuses paypal on a clinic that is not international` (`promise resolved … instead of rejecting`), the worked-example test (`sent.charge` is `undefined`), both backstop cases, `refuses paypal on a discounted bill …`. Already passing: the 28 pre-existing tests (including the two edited paypal tests) and five new ones that pin unchanged behaviour (`keeps the existing pending-order check first`, `lets a plugin error through …`, `leaves xendit alone …`, `still lets xendit pay a discounted bill`, `reuses an existing pending order …`).

- [ ] **Step 3: Implement the gate, the charge and the backstop**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 1 of 8), replace this exact text:

```ts
import { createWcOrder, getWcOrderStatus, type PaymentMethod } from '@/lib/wp-endpoint';
```

with:

```ts
import {
  createWcOrder,
  getWcOrderStatus,
  type CreateWcOrderResult,
  type PaymentMethod,
  type WcCharge,
} from '@/lib/wp-endpoint';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 2 of 8), replace this exact text:

```ts
import { syncSessionReminders } from '@/services/session/reminder-schedule';
```

with:

```ts
import { syncSessionReminders } from '@/services/session/reminder-schedule';
import { resolveClinicPayment } from '@/services/payments/clinic-payment.service';
import {
  amountToCents,
  gateUsdPayment,
  notInternational,
  toCharge,
  type ClinicPaymentSettings,
  type UsdQuote,
} from '@/services/payments/intl-pricing';
import {
  ChargeMismatchError,
  DiscountNotSupportedError,
  PaymentMethodNotAllowedError,
  PaypalRateMissingError,
} from '@/services/payments/payment-errors';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 3 of 8), replace this exact text:

```ts
export async function initiatePublicPayment(
  appointmentId: number,
```

with:

```ts
/** A USD order's quote and the `charge` built from it. */
interface UsdCharge {
  quote: UsdQuote;
  charge: WcCharge;
}

/**
 * The payment gate for paypal/card (spec §2), run before any WooCommerce order exists.
 * The settings read itself may throw PaymentSettingsUnavailableError (503, retryable).
 */
function gateUsdCharge(items: PaymentLineItem[], taxes: PaymentTaxLine[], settings: ClinicPaymentSettings): UsdCharge {
  const gate = gateUsdPayment(items, taxes, settings);
  if (gate.ok === false) {
    if (gate.reason === 'rate_missing') {
      throw new PaypalRateMissingError(`Clinic ${settings.clinicId} is international but has no usable FX rate`);
    }
    throw new PaymentMethodNotAllowedError(`Clinic ${settings.clinicId} does not take USD payment for this order`);
  }
  return { quote: gate.quote, charge: toCharge(gate.quote) };
}

/**
 * Backstop for version skew: an older plugin ignores `charge` and converts on its own.
 * If what WooCommerce will charge differs from the quote, cancel that order now (the
 * existing auto-cancel job — there is no direct cancel route) and write NO
 * payment_orders row: a row would let the resulting payment.expired cancel the
 * appointment, and a retry would then hit payment_already_initiated.
 */
async function assertChargedAsQuoted(wcOrder: CreateWcOrderResult, quote: UsdQuote): Promise<void> {
  if (amountToCents(wcOrder.chargedAmount ?? -1) === quote.totalCents) return;
  // Recorded before anything else: this is a mis-priced order being thrown away, and
  // nobody would otherwise know it happened (the route maps the error to a plain 502).
  await logging.error('Charged amount differs from the USD quote — WooCommerce order cancelled', undefined, {
    metadata: {
      wcOrderId: wcOrder.orderId,
      chargedAmount: wcOrder.chargedAmount,
      chargedCurrency: wcOrder.chargedCurrency,
      quotedTotalUsd: quote.totalUsd,
    },
  });
  // Defensive only: jobs.enqueue (src/lib/jobs/client.ts) swallows its own failures
  // today, so this catch is not expected to run. It stays so a future client that does
  // reject still ends in ChargeMismatchError rather than a bare 500.
  try {
    await jobs.enqueue({
      hook: 'praktiqu_payment_auto_cancel',
      runAt: new Date(),
      args: { wcOrderId: wcOrder.orderId },
    });
  } catch (err) {
    await logging.error('Could not enqueue the cancel for a mis-charged WooCommerce order', err, {
      metadata: { wcOrderId: wcOrder.orderId },
    });
  }
  throw new ChargeMismatchError(
    `WooCommerce order ${wcOrder.orderId} charges ${wcOrder.chargedAmount} ${wcOrder.chargedCurrency}, quoted ${quote.totalUsd} USD`,
  );
}

/**
 * The staff-bill gate. Discounts are not supported in USD: the WooCommerce lines are the
 * bill's gross service and tax lines while expectedAmount is the net total, so a USD
 * quote of a discounted bill would overcharge without any error. A clinic id of 0 or
 * null is not international.
 */
async function gateSessionUsdCharge(bill: BillDetail, items: PaymentLineItem[], taxes: PaymentTaxLine[]): Promise<UsdCharge> {
  if (bill.discount > 0) throw new DiscountNotSupportedError(`Bill ${bill.id} has a discount; pay it with Xendit`);
  const settings = bill.clinic?.id ? await resolveClinicPayment(bill.clinic.id) : notInternational(0);
  return gateUsdCharge(items, taxes, settings);
}

export async function initiatePublicPayment(
  appointmentId: number,
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 4 of 8), replace this exact text:

```ts
    clinicId: appt.clinicId,
    doctorId: appt.professionalId,
  });

  const token = signAppointmentToken(appointmentId);
```

with:

```ts
    clinicId: appt.clinicId,
    doctorId: appt.professionalId,
  });

  const usd: UsdCharge | null =
    method === 'xendit' ? null : gateUsdCharge(items, taxes, await resolveClinicPayment(appt.clinicId));

  const token = signAppointmentToken(appointmentId);
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 5 of 8), replace this exact text:

```ts
    cancelUrl: `${getPublicAppUrl()}/book/payment/cancel?appt=${token}`,
    method,
  });

  await createPaymentOrder({
    source: 'public',
    appointmentId: orderKey,
    wcOrderId: wcOrder.orderId,
    expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: wcOrder.fxRate,
  });
```

with:

```ts
    cancelUrl: `${getPublicAppUrl()}/book/payment/cancel?appt=${token}`,
    method,
    ...(usd ? { charge: usd.charge } : {}),
  });
  if (usd) await assertChargedAsQuoted(wcOrder, usd.quote);

  await createPaymentOrder({
    source: 'public',
    appointmentId: orderKey,
    wcOrderId: wcOrder.orderId,
    expectedAmount: usd ? usd.quote.expectedIdr : expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: usd ? Number(usd.quote.effectiveFxRate) : wcOrder.fxRate,
  });
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 6 of 8), replace this exact text:

```ts
  const { expectedAmount, items, taxes } = computeSessionAmountFromBill(bill);
```

with:

```ts
  const { expectedAmount, items, taxes } = computeSessionAmountFromBill(bill);
  const usd: UsdCharge | null = method === 'xendit' ? null : await gateSessionUsdCharge(bill, items, taxes);
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 7 of 8), replace this exact text:

```ts
    cancelUrl: `${getPublicAppUrl()}/staff/bills/${billId}/payment-cancel`,
    method,
  });
```

with:

```ts
    cancelUrl: `${getPublicAppUrl()}/staff/bills/${billId}/payment-cancel`,
    method,
    ...(usd ? { charge: usd.charge } : {}),
  });
  if (usd) await assertChargedAsQuoted(wcOrder, usd.quote);
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/payment.service.ts` (edit 8 of 8), replace this exact text:

```ts
    expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: wcOrder.fxRate,
  });
```

with:

```ts
    expectedAmount,
    gateway: method,
    chargedAmount: wcOrder.chargedAmount,
    chargedCurrency: wcOrder.chargedCurrency,
    fxRate: usd ? Number(usd.quote.effectiveFxRate) : wcOrder.fxRate,
  });
```

- [ ] **Step 4: Run them — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/orchestration.test.ts
```

Expected: `Tests  48 passed (48)`.

- [ ] **Step 5: Full payment suite, neighbours, typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments tests/public-booking/create.test.ts tests/public-booking/transient-failure.test.ts tests/lib/wp-endpoint-unreachable.test.ts && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  15 passed (15)`, `Tests  320 passed (320)` — `tests/payments` is 12 files / 274 tests (orchestration 48, intl-pricing 70, session-routes 37, wp-endpoint 17, state-machine 12, public-routes 24, clinic-payment.service 15, payment-service 11, payment-errors 26, public-usd.service 5, jobs-client 4, clinic-payment-settings.repo 5) plus the three neighbour files; then `tsc exit=0`. (`tests/public-booking/retry-through-service.test.ts` needs `DATABASE_URL` and fails in a worktree without `.env.test.local` both before and after this change — leave it out.)

- [ ] **Step 6: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/services/payments/payment.service.ts tests/payments/orchestration.test.ts && git commit -F - <<'EOF'
feat(payments): gerbang klinik internasional dan backstop charge di alur bayar

PayPal/kartu hanya untuk klinik internasional dengan kurs yang bisa dipakai,
dicek sebelum order WooCommerce dibuat (403 / 503 / 503 settings). Charge
USD dikirim ke plugin; bila chargedAmount yang kembali beda dari quote
(plugin lama), order langsung dibatalkan lewat job auto-cancel dan tidak
ada baris payment_orders. Bill berdiskon ditolak untuk USD (422).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds and `git status --short` prints nothing. Never use `git add -A` / `git add .` (the `node_modules` symlink from Task B0 is not a directory to git).

---

## Part B2 — Next.js: settings API, additive fields, docs

### Task B6: Layanan pengaturan pembayaran klinik — `payment-settings.service.ts`

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` (lines 51–52: export the private `hasAtMostTwoDecimals`, no behaviour change)
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/payment-settings.service.ts`
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-settings.service.test.ts` (new)

**Interfaces:** Consumes: `readRawPaymentOptions(clinicIds)` and `PaymentSettingsUnavailableError` (Task B2, `@/repositories/wp/clinic-payment-settings.repo`); `parseStoredOption`, `parseGlobalDefaults`, `resolveSettings`, `buildUsdQuote`, `toUsdView`, `isUsableRate`, `RATE_MIN`, `RATE_MAX`, `MARKUP_MAX`, `FEE_MAX`, `GlobalDefaults`, `ParsedOption`, `PublicUsdView`, `ValueSource` (Task B1, `@/services/payments/intl-pricing`); `putClinicPaymentSettings(clinicId, body: ClinicPaymentSettingsWire)` and `WpEndpointError` with its `code` (Task B3, `@/lib/wp-endpoint`); `prisma.user` (`User.wpUserId BigInt? @unique`, `User.displayName String`), `prisma.kcUser` (`wp_users`: `id BigInt`, `displayName` ↔ `display_name`); `logging.audit` / `logging.warn` (`@/lib/logging`); `Actor` (`@/lib/auth`: `{ id, role, practiceId }`). / Produces (exact contract names): `paymentSettingsInputSchema: z.ZodType<PaymentSettingsInput>`, `interface PaymentSettingsInput { international: boolean; fxRate: number | null; markupPercent: number | null; fixedFeeIdr: number | null }`, `interface PaymentSettingsView` (fields `clinicId`, `stored`, `effective`, `globalDefaults`, `example`, `updatedAt`, `updatedBy` exactly as the contract), `class PaymentSettingsValidationError extends Error { constructor(public fields: Record<string, string[]>) }`, `class FxRateRequiredError extends Error {}`, `getPaymentSettingsView(clinicId: number): Promise<PaymentSettingsView>`, `updatePaymentSettings(clinicId: number, input: unknown, actor: Actor): Promise<PaymentSettingsView>`. Also `hasAtMostTwoDecimals(n: number): boolean` is now exported from `intl-pricing.ts`.

Behaviour fixed here (spec §1 "Validation" and "Write and read paths", §3 GET/PUT):
- **Schema** — `.strict()`, all four keys required (a PUT replaces the whole object; `null` = use the global value / no fee). `fxRate` null or 1,000–100,000 with ≤ 2 decimals; `markupPercent` null or 0–100 with ≤ 2 decimals; `fixedFeeIdr` null or an integer 0–10,000,000. `PaymentSettingsValidationError.fields` is keyed by field name; an issue with no path (unknown key, body not an object) goes under `body`.
- **View** — ONE `readRawPaymentOptions([clinicId])` (the clinic option plus both globals). `stored` is the clinic's own values, `{ international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null }` when the option is absent or unusable. `effective` comes from `resolveSettings` (rate/markup/fee resolved with sources whatever the flag; Decimals as strings via `toString()`). `example` = `toUsdView(buildUsdQuote([{ name: 'Example', price: 200000 }], [], { ...settings, international: true }))` plus `idr: 200000`, only when `settings.rate !== null` (forced international so the admin previews before flagging). `updatedBy` name: `users.displayName` by `wpUserId`, else `wp_users.display_name`, else `WordPress user #<id>` — also when either lookup throws (logged with `logging.warn('Clinic payment settings editor name unavailable', …)`, never rethrown: this view is the answer to a PUT that has already saved). `settings.problems` are logged with `logging.warn('Clinic payment settings problem', …)` as Task B2 does. A DB error propagates as `PaymentSettingsUnavailableError`.
- **Save** — order: zod (→ `PaymentSettingsValidationError`, before any read) → one options read → `international && !isUsableRate(fxRate) && !isUsableRate(global rate)` → `FxRateRequiredError` (no plugin call) → actor's `User.wpUserId` via `prisma.user.findUnique({ where: { id: actor.id }, select: { wpUserId: true } })` (NOT `resolveKcActor`; `null` when unlinked) → `putClinicPaymentSettings(clinicId, { international, fx_rate, markup_percent, fixed_fee_idr, updated_by })` (plugin `WpEndpointError` code `fx_rate_required` → `FxRateRequiredError`; any other error propagates, no audit) → `logging.audit('clinic.payment_settings.updated', { userId: actor.id, resource: 'clinic', resourceId: String(clinicId), metadata: { wpUserId, before, after } })` (`before` = stored values read before the write, `after` = the validated input) → `getPaymentSettingsView(clinicId)` (a RE-READ, never the input echoed).

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-settings.service.test.ts` with exactly this content:

```ts
/**
 * The per-clinic payment settings view and save path (spec §1 "Write and read paths",
 * §3 "GET / PUT /api/v1/practices/{id}/payment-settings").
 *
 * Prisma, the logger and the plugin call are mocked; the repo and the pure pricing
 * module are real, so the view is built exactly as the payment gate would see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  kcOption: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  kcUser: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const logging = vi.hoisted(() => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/lib/logging', () => logging);

vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  putClinicPaymentSettings: vi.fn(),
}));

import {
  FxRateRequiredError,
  PaymentSettingsValidationError,
  getPaymentSettingsView,
  paymentSettingsInputSchema,
  updatePaymentSettings,
} from '@/services/practice/payment-settings.service';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { WpEndpointError, putClinicPaymentSettings } from '@/lib/wp-endpoint';
import type { Actor } from '@/lib/auth';

const CLINIC = 4;
const OPTION_NAME = 'praktiqu_endpoint_clinic_4_payment';
const SUPER: Actor = { id: 'ckadmin0000000000super', role: 'SUPER_ADMIN', practiceId: null };
const VALID = { international: true, fxRate: 18000, markupPercent: 10, fixedFeeIdr: 25000 };
const NOTHING_STORED = { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };

/** The option as the plugin stores it: a JSON string with snake_case keys. */
function optionRow(fields: Record<string, unknown> = {}) {
  return {
    optionName: OPTION_NAME,
    optionValue: JSON.stringify({
      international: true,
      fx_rate: 18000,
      markup_percent: 10,
      fixed_fee_idr: 25000,
      updated_at: '2026-10-06T08:00:00+00:00',
      updated_by: 123,
      ...fields,
    }),
  };
}
const globalRate = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: v });
const globalMarkup = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_markup_percent', optionValue: v });

beforeEach(() => {
  vi.clearAllMocks();
  db.kcOption.findMany.mockReset().mockResolvedValue([]);
  // users.id -> wp_users.ID for the actor; wp_users.ID -> users.displayName for the editor.
  db.user.findUnique.mockReset().mockImplementation(async (args: any) => {
    if (args.where.id === SUPER.id) return { wpUserId: 123n };
    if (args.where.wpUserId === 123n) return { displayName: 'Dewi Admin' };
    return null;
  });
  db.kcUser.findUnique.mockReset().mockResolvedValue(null);
  vi.mocked(putClinicPaymentSettings).mockReset().mockResolvedValue(undefined);
});

describe('paymentSettingsInputSchema', () => {
  it.each([
    ['the worked example', VALID],
    ['all nulls on a clinic that is not international', NOTHING_STORED],
    ['the lower edges', { international: true, fxRate: 1000, markupPercent: 0, fixedFeeIdr: 0 }],
    ['the upper edges', { international: true, fxRate: 100_000, markupPercent: 100, fixedFeeIdr: 10_000_000 }],
    ['2 decimals despite float noise', { international: true, fxRate: 16500.25, markupPercent: 10.15, fixedFeeIdr: null }],
  ])('accepts %s', (_label, body) => {
    expect(paymentSettingsInputSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['fxRate', '"16.500" read as 16.5', { fxRate: 16.5 }],
    ['fxRate', 'an inverted rate', { fxRate: 0.00006 }],
    ['fxRate', 'a rate above 100,000', { fxRate: 100_000.01 }],
    ['fxRate', 'a rate with 3 decimals', { fxRate: 16500.125 }],
    ['fxRate', 'a rate sent as a string', { fxRate: '16500' }],
    ['markupPercent', 'a negative markup', { markupPercent: -1 }],
    ['markupPercent', 'a markup above 100', { markupPercent: 100.5 }],
    ['markupPercent', 'a markup with 3 decimals', { markupPercent: 10.125 }],
    ['fixedFeeIdr', 'a fractional fee', { fixedFeeIdr: 1.5 }],
    ['fixedFeeIdr', 'a negative fee', { fixedFeeIdr: -1 }],
    ['fixedFeeIdr', 'a fee above 10,000,000', { fixedFeeIdr: 10_000_001 }],
    ['international', 'a non-boolean flag', { international: 'yes' }],
    ['international', 'a missing flag', { international: undefined }],
  ])('rejects %s: %s', (field, _label, patch) => {
    const result = paymentSettingsInputSchema.safeParse({ ...VALID, ...patch });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].path).toEqual([field]);
  });

  it('rejects an unknown key (strict) and a missing one (a PUT replaces the whole object)', () => {
    expect(paymentSettingsInputSchema.safeParse({ ...VALID, currency: 'USD' }).success).toBe(false);
    const { fixedFeeIdr: _omitted, ...missing } = VALID;
    expect(paymentSettingsInputSchema.safeParse(missing).success).toBe(false);
  });
});

describe('getPaymentSettingsView', () => {
  it('shows a flagged clinic with the worked example and the editor name from users', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow(), globalRate('16500'), globalMarkup('5')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view).toEqual({
      clinicId: 4,
      stored: VALID,
      effective: {
        international: true,
        methods: ['xendit', 'paypal', 'card'],
        fxRate: '18000',
        markupPercent: '10',
        fixedFeeIdr: '25000',
        source: { fxRate: 'clinic', markupPercent: 'clinic', fixedFeeIdr: 'clinic' },
      },
      globalDefaults: { fxRate: 16500, markupPercent: 5 },
      example: { price: '12.23', taxes: [], fee: '1.39', total: '13.62', idr: 200000 },
      updatedAt: '2026-10-06T08:00:00+00:00',
      updatedBy: { wpUserId: 123, name: 'Dewi Admin' },
    });
    expect(db.kcOption.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { wpUserId: 123n }, select: { displayName: true } });
  });

  it('answers the empty stored values for a clinic with no option, and previews with the global rate', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000'), globalMarkup('10')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.stored).toEqual(NOTHING_STORED);
    expect(view.effective).toEqual({
      international: false,
      methods: ['xendit'],
      fxRate: '18000',
      markupPercent: '10',
      fixedFeeIdr: '0',
      source: { fxRate: 'global', markupPercent: 'global', fixedFeeIdr: 'default' },
    });
    // Forced international for the preview: the admin sees the price before flagging.
    expect(view.example).toEqual({ price: '12.23', taxes: [], fee: null, total: '12.23', idr: 200000 });
    expect(view.updatedAt).toBeNull();
    expect(view.updatedBy).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('has no example when no rate is usable', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('500000')]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.effective.fxRate).toBeNull();
    expect(view.effective.source.fxRate).toBeNull();
    expect(view.example).toBeNull();
    expect(view.globalDefaults).toEqual({ fxRate: 500000, markupPercent: null });
  });

  it('names the editor from wp_users when there is no users row, else by WordPress id', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow({ updated_by: 77 })]);
    db.kcUser.findUnique.mockResolvedValueOnce({ displayName: 'wp-editor' }).mockResolvedValueOnce(null);

    expect((await getPaymentSettingsView(CLINIC)).updatedBy).toEqual({ wpUserId: 77, name: 'wp-editor' });
    expect(db.kcUser.findUnique).toHaveBeenCalledWith({ where: { id: 77n }, select: { displayName: true } });
    expect((await getPaymentSettingsView(CLINIC)).updatedBy).toEqual({ wpUserId: 77, name: 'WordPress user #77' });
  });

  it('reads an unusable option as not international, with no preview, and logs it', async () => {
    db.kcOption.findMany.mockResolvedValue([
      { optionName: OPTION_NAME, optionValue: 'a:1:{s:13:"international";b:1;}' },
      globalRate('18000'),
    ]);

    const view = await getPaymentSettingsView(CLINIC);

    expect(view.stored).toEqual(NOTHING_STORED);
    expect(view.effective.international).toBe(false);
    expect(view.effective.fxRate).toBeNull();
    expect(view.example).toBeNull();
    expect(logging.logging.warn).toHaveBeenCalledWith(
      'Clinic payment settings problem',
      expect.objectContaining({
        resource: 'clinic',
        resourceId: '4',
        metadata: { problems: [expect.stringContaining('clinic_payment_option_serialized')] },
      }),
    );
  });

  it('lets PaymentSettingsUnavailableError through on a database error', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    await expect(getPaymentSettingsView(CLINIC)).rejects.toBeInstanceOf(PaymentSettingsUnavailableError);
  });
});

describe('updatePaymentSettings', () => {
  it('rejects invalid input with per-field messages, before any read or write', async () => {
    const err = await updatePaymentSettings(CLINIC, { ...VALID, fxRate: 16.5, currency: 'USD' }, SUPER).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsValidationError);
    expect(Object.keys(err.fields).sort()).toEqual(['body', 'fxRate']);
    expect(err.fields.fxRate).toEqual(['fxRate must be from 1000 to 100000 (rupiah per 1 USD)']);
    expect(err.fields.body[0]).toContain('currency');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('reports a body that is not an object under body', async () => {
    const err = await updatePaymentSettings(CLINIC, null, SUPER).catch((e) => e);

    expect(err).toBeInstanceOf(PaymentSettingsValidationError);
    expect(Object.keys(err.fields)).toEqual(['body']);
  });

  it.each([
    ['no clinic rate and no global rate', []],
    ['no clinic rate and an out-of-range global rate', [globalRate('500000')]],
  ])('refuses international with %s (fx_rate_required), without calling the plugin', async (_label, rows) => {
    db.kcOption.findMany.mockResolvedValue(rows);

    await expect(updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER)).rejects.toBeInstanceOf(FxRateRequiredError);
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('accepts international with no clinic rate when the global rate is usable', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);

    await updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, expect.objectContaining({ international: true, fx_rate: null }));
  });

  it('does not require a rate for a clinic that is not international', async () => {
    await updatePaymentSettings(CLINIC, NOTHING_STORED, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, {
      international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null, updated_by: 123,
    });
  });

  it('forwards the snake_case body with updated_by from users.wpUserId, audits before/after, and re-reads', async () => {
    db.kcOption.findMany
      .mockResolvedValueOnce([optionRow({ international: false, fx_rate: null, markup_percent: null, fixed_fee_idr: null })])
      .mockResolvedValueOnce([optionRow()]);

    const view = await updatePaymentSettings(CLINIC, VALID, SUPER);

    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: SUPER.id }, select: { wpUserId: true } });
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, {
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    expect(logging.logging.audit).toHaveBeenCalledWith('clinic.payment_settings.updated', {
      userId: SUPER.id,
      resource: 'clinic',
      resourceId: '4',
      metadata: { wpUserId: 123, before: NOTHING_STORED, after: VALID },
    });
    // The answer is the option read back, not the input echoed.
    expect(db.kcOption.findMany).toHaveBeenCalledTimes(2);
    expect(view.stored).toEqual(VALID);
    expect(view.updatedBy).toEqual({ wpUserId: 123, name: 'Dewi Admin' });
  });

  it.each([
    ['a users row with no WordPress link', { wpUserId: null }],
    ['no users row at all', null],
  ])('sends updated_by null for %s', async (_label, row) => {
    db.user.findUnique.mockImplementation(async (args: any) => (args.where.id ? row : null));

    await updatePaymentSettings(CLINIC, NOTHING_STORED, SUPER);

    expect(putClinicPaymentSettings).toHaveBeenCalledWith(4, expect.objectContaining({ updated_by: null }));
    expect(logging.logging.audit).toHaveBeenCalledWith(
      'clinic.payment_settings.updated',
      expect.objectContaining({ userId: SUPER.id, metadata: expect.objectContaining({ wpUserId: null }) }),
    );
  });

  it("turns the plugin's own fx_rate_required into FxRateRequiredError, without an audit row", async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 422: A usable rate is required', 422, 'fx_rate_required'),
    );

    await expect(updatePaymentSettings(CLINIC, { ...VALID, fxRate: null }, SUPER)).rejects.toBeInstanceOf(FxRateRequiredError);
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('lets any other plugin error through, without an audit row', async () => {
    const saveFailed = new WpEndpointError('/clinics/4/payment-settings failed 500: could not be saved', 500, 'save_failed');
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(saveFailed);

    await expect(updatePaymentSettings(CLINIC, VALID, SUPER)).rejects.toBe(saveFailed);
    expect(logging.logging.audit).not.toHaveBeenCalled();
  });

  it('answers a save that went through even when the editor name cannot be read', async () => {
    db.kcOption.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([optionRow()]);
    db.user.findUnique.mockImplementation(async (args: any) => {
      if (args.where.id === SUPER.id) return { wpUserId: 123n };
      throw new Error('Too many connections');
    });

    const view = await updatePaymentSettings(CLINIC, VALID, SUPER);

    expect(logging.logging.audit).toHaveBeenCalledTimes(1);
    expect(view.stored).toEqual(VALID);
    expect(view.updatedBy).toEqual({ wpUserId: 123, name: 'WordPress user #123' });
    expect(logging.logging.warn).toHaveBeenCalledWith('Clinic payment settings editor name unavailable', {
      metadata: { wpUserId: 123, error: 'Too many connections' },
    });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-settings.service.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/services/practice/payment-settings.service' imported from …/tests/payments/payment-settings.service.test.ts`; `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Export the two-decimal helper from intl-pricing**

The write path must apply exactly the read path's ≤ 2-decimal rule (spec §1: the same rules on write and on read), so reuse the helper instead of copying it. In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/intl-pricing.ts` (around line 51), replace

```ts
/** At most two decimals, tolerant of binary float noise (10.15 * 100 = 1014.9999…). */
function hasAtMostTwoDecimals(n: number): boolean {
```

with

```ts
/**
 * At most two decimals, tolerant of binary float noise (10.15 * 100 = 1014.9999…).
 * Exported for the settings write path, which applies the same rule to its input.
 */
export function hasAtMostTwoDecimals(n: number): boolean {
```

- [ ] **Step 4: Write the service**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/payment-settings.service.ts` with exactly this content:

```ts
/**
 * A clinic's international payment settings — the admin view and the save path.
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §1
 * ("Write and read paths") and §3 (`GET` / `PUT /api/v1/practices/{id}/payment-settings`).
 *
 * Reads come straight from `wp_options` (one KcOption query: the clinic's option plus
 * both global defaults). Writes go through the plugin, so WordPress's object cache stays
 * consistent. The PUT answer is then built by RE-READING the option, so a storage-format
 * mismatch (a PHP-serialized value, say) shows on the first save instead of weeks later
 * as a clinic that silently stopped being international.
 */
import { z } from 'zod';
import type { Actor } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logging } from '@/lib/logging';
import { WpEndpointError, putClinicPaymentSettings, type PaymentMethod } from '@/lib/wp-endpoint';
import { readRawPaymentOptions } from '@/repositories/wp/clinic-payment-settings.repo';
import {
  FEE_MAX,
  MARKUP_MAX,
  RATE_MAX,
  RATE_MIN,
  buildUsdQuote,
  hasAtMostTwoDecimals,
  isUsableRate,
  parseGlobalDefaults,
  parseStoredOption,
  resolveSettings,
  toUsdView,
  type GlobalDefaults,
  type ParsedOption,
  type PublicUsdView,
  type ValueSource,
} from '@/services/payments/intl-pricing';

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface PaymentSettingsInput {
  international: boolean;
  fxRate: number | null;
  markupPercent: number | null;
  fixedFeeIdr: number | null;
}

const TWO_DECIMALS = 'must have at most 2 decimals';
const RATE_RANGE = `fxRate must be from ${RATE_MIN} to ${RATE_MAX} (rupiah per 1 USD)`;
const MARKUP_RANGE = `markupPercent must be from 0 to ${MARKUP_MAX}`;
const FEE_RANGE = `fixedFeeIdr must be a whole rupiah amount from 0 to ${FEE_MAX}`;

/**
 * Spec §1 "Validation". Every key is required (null means "use the global value" for
 * the rate and markup, and "no fee" for the fee): a PUT replaces the clinic's whole
 * object. The 1,000–100,000 range rejects an inverted or mistyped rate such as 0.00006,
 * or "16.500" read as 16.5. The cross-field rule (international needs a usable rate)
 * needs the global option, so `updatePaymentSettings` checks it after parsing.
 *
 * The cast is for the compiler only: with `strict: false` (tsconfig) zod infers every
 * key as optional, although the schema itself requires all four.
 */
export const paymentSettingsInputSchema = z
  .object({
    international: z.boolean(),
    fxRate: z
      .number()
      .min(RATE_MIN, RATE_RANGE)
      .max(RATE_MAX, RATE_RANGE)
      .refine(hasAtMostTwoDecimals, `fxRate ${TWO_DECIMALS}`)
      .nullable(),
    markupPercent: z
      .number()
      .min(0, MARKUP_RANGE)
      .max(MARKUP_MAX, MARKUP_RANGE)
      .refine(hasAtMostTwoDecimals, `markupPercent ${TWO_DECIMALS}`)
      .nullable(),
    fixedFeeIdr: z.number().int(FEE_RANGE).min(0, FEE_RANGE).max(FEE_MAX, FEE_RANGE).nullable(),
  })
  .strict() as z.ZodType<PaymentSettingsInput>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** The body failed the schema. `fields` is keyed by field name (`body` for the object itself). */
export class PaymentSettingsValidationError extends Error {
  constructor(public fields: Record<string, string[]>) {
    super('Invalid payment settings');
    this.name = 'PaymentSettingsValidationError';
  }
}

/** International without a usable rate from the clinic or the global option. 422. */
export class FxRateRequiredError extends Error {}

const FX_RATE_REQUIRED =
  'An international clinic needs a usable FX rate: enter one, or set the global rate in WordPress first';

function issuesToFields(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    // An unknown key (.strict()) or a body that is not an object has no path.
    const key = issue.path.length > 0 ? issue.path.join('.') : 'body';
    if (!fields[key]) fields[key] = [];
    fields[key].push(issue.message);
  }
  return fields;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export interface PaymentSettingsView {
  clinicId: number;
  /** The clinic's own values; with no (usable) option, international false and every field null. */
  stored: { international: boolean; fxRate: number | null; markupPercent: number | null; fixedFeeIdr: number | null };
  /** Resolved with their sources whatever the flag — the rate may be null. */
  effective: {
    international: boolean;
    methods: PaymentMethod[];
    fxRate: string | null;
    markupPercent: string;
    fixedFeeIdr: string;
    source: { fxRate: ValueSource | null; markupPercent: ValueSource; fixedFeeIdr: ValueSource };
  };
  /** The global rate and markup, for form placeholders. */
  globalDefaults: GlobalDefaults;
  /** Rp 200,000 in USD with the effective values, whenever a usable rate exists. */
  example: (PublicUsdView & { idr: number }) | null;
  updatedAt: string | null;
  updatedBy: { wpUserId: number; name: string } | null;
}

const EXAMPLE_IDR = 200_000;

function storedOf(parsed: ParsedOption): PaymentSettingsView['stored'] {
  if (parsed.status !== 'ok') return { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };
  const { international, fxRate, markupPercent, fixedFeeIdr } = parsed.value;
  return { international, fxRate, markupPercent, fixedFeeIdr };
}

/**
 * `users.displayName`, else `wp_users.display_name`, else the bare WordPress id.
 *
 * Never throws: the name is a label, and this view is also the answer to a PUT that has
 * already saved and been audited — a failed lookup must not turn that save into an error.
 */
async function editorName(wpUserId: number): Promise<string> {
  try {
    const user = await prisma.user.findUnique({ where: { wpUserId: BigInt(wpUserId) }, select: { displayName: true } });
    if (user?.displayName?.trim()) return user.displayName.trim();
    const wpUser = await prisma.kcUser.findUnique({ where: { id: BigInt(wpUserId) }, select: { displayName: true } });
    if (wpUser?.displayName?.trim()) return wpUser.displayName.trim();
  } catch (err) {
    await logging.warn('Clinic payment settings editor name unavailable', {
      metadata: { wpUserId, error: err instanceof Error ? err.message : String(err) },
    });
  }
  return `WordPress user #${wpUserId}`;
}

/** Throws PaymentSettingsUnavailableError when wp_options cannot be read. */
export async function getPaymentSettingsView(clinicId: number): Promise<PaymentSettingsView> {
  const raw = await readRawPaymentOptions([clinicId]);
  const parsed = parseStoredOption(raw.byClinic.get(clinicId));
  const globalDefaults = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  const settings = resolveSettings(clinicId, parsed, globalDefaults);
  if (settings.problems.length > 0) {
    await logging.warn('Clinic payment settings problem', {
      resource: 'clinic',
      resourceId: String(clinicId),
      metadata: { problems: settings.problems },
    });
  }

  // Forced international so an admin can preview the price before flagging the clinic.
  const preview =
    settings.rate === null
      ? null
      : toUsdView(buildUsdQuote([{ name: 'Example', price: EXAMPLE_IDR }], [], { ...settings, international: true }));

  const stored = parsed.status === 'ok' ? parsed.value : null;
  return {
    clinicId,
    stored: storedOf(parsed),
    effective: {
      international: settings.international,
      methods: settings.methods,
      fxRate: settings.rate === null ? null : settings.rate.toString(),
      markupPercent: settings.markupPercent.toString(),
      fixedFeeIdr: settings.fixedFeeIdr.toString(),
      source: settings.source,
    },
    globalDefaults,
    example: preview === null ? null : { ...preview, idr: EXAMPLE_IDR },
    updatedAt: stored?.updatedAt ?? null,
    updatedBy:
      stored?.updatedBy == null ? null : { wpUserId: stored.updatedBy, name: await editorName(stored.updatedBy) },
  };
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate, write through the plugin, audit, and answer with the option read back.
 *
 * Throws PaymentSettingsValidationError, FxRateRequiredError (ours or the plugin's own
 * re-check), PaymentSettingsUnavailableError, or the plugin's WpEndpointError. The
 * caller has already checked scope and that the clinic exists.
 */
export async function updatePaymentSettings(
  clinicId: number,
  input: unknown,
  actor: Actor,
): Promise<PaymentSettingsView> {
  const parsed = paymentSettingsInputSchema.safeParse(input);
  if (!parsed.success) throw new PaymentSettingsValidationError(issuesToFields(parsed.error));
  const next = parsed.data;

  // One read: the option as it stands (for the audit trail) and the global rate (for
  // the cross-field rule). The plugin re-checks the rule against its own read.
  const raw = await readRawPaymentOptions([clinicId]);
  const globals = parseGlobalDefaults(raw.globalRate, raw.globalMarkup);
  if (next.international && !isUsableRate(next.fxRate) && !isUsableRate(globals.fxRate)) {
    throw new FxRateRequiredError(FX_RATE_REQUIRED);
  }

  // users.id -> wp_users.ID. Not resolveKcActor: it skips SUPER_ADMIN and 403s an
  // account with no WordPress link, and neither may block a save (spec §1).
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { wpUserId: true } });
  const wpUserId = user?.wpUserId ? Number(user.wpUserId) : null;

  try {
    await putClinicPaymentSettings(clinicId, {
      international: next.international,
      fx_rate: next.fxRate,
      markup_percent: next.markupPercent,
      fixed_fee_idr: next.fixedFeeIdr,
      updated_by: wpUserId,
    });
  } catch (err) {
    if (err instanceof WpEndpointError && err.code === 'fx_rate_required') throw new FxRateRequiredError(FX_RATE_REQUIRED);
    throw err;
  }

  // userId is the caller's users.id (a cuid): log_entries.userId is a foreign key to
  // users.id, and logging swallows insert errors, so a wp_users.ID here would drop the row.
  await logging.audit('clinic.payment_settings.updated', {
    userId: actor.id,
    resource: 'clinic',
    resourceId: String(clinicId),
    metadata: { wpUserId, before: storedOf(parseStoredOption(raw.byClinic.get(clinicId))), after: next },
  });

  return getPaymentSettingsView(clinicId);
}
```

The `as z.ZodType<PaymentSettingsInput>` cast is required: `tsconfig.json` has `"strict": false`, so zod infers every key as optional although the schema requires all four.

- [ ] **Step 5: Run it with the pricing tests — expect PASS — and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-settings.service.test.ts tests/payments/intl-pricing.test.ts && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  2 passed (2)`, `Tests  107 passed (107)` (37 new + 70 from Task B1/B3), then `tsc exit=0`. stderr noise such as `prisma:error … DATABASE_URL` is expected; only the summary lines matter.

- [ ] **Step 6: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/services/payments/intl-pricing.ts src/services/practice/payment-settings.service.ts tests/payments/payment-settings.service.test.ts && git commit -F - <<'EOF'
feat(practices): layanan pengaturan pembayaran internasional per klinik

getPaymentSettingsView membaca opsi klinik + default global dalam satu
query KcOption, lengkap dengan nilai efektif, sumbernya, dan contoh
konversi Rp 200.000. updatePaymentSettings memvalidasi (zod strict,
maks 2 desimal), menolak internasional tanpa kurs yang bisa dipakai
(fx_rate_required), meneruskan updated_by dari User.wpUserId ke plugin,
mencatat audit before/after, lalu membaca ulang opsinya.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds, and `git status --short` lists no file this task touched (an untracked planning folder such as `.plan-wip/` may show; leave it alone). Never use `git add -A` / `git add .`: the `node_modules` symlink from Task B0 must stay out of git.

### Task B7: Route `GET`/`PUT /api/v1/practices/{id}/payment-settings`

**Files:**
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/practices/[id]/payment-settings/route.ts`
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-settings-route.test.ts` (new)

**Interfaces:** Consumes: `requireRoles` (`@/lib/auth/route-guards`); `assertPracticeInScope`, `PracticeNotFoundError` (`@/services/practice/service`); `findClinicById(id: bigint): Promise<WpClinic | null>` (`@/repositories/wp/clinics.repo`); `getPaymentSettingsView`, `updatePaymentSettings`, `PaymentSettingsValidationError`, `FxRateRequiredError` (Task B6); `PaymentSettingsUnavailableError` (Task B2); `WpEndpointError` (Task B3); `notFound`, `forbidden`, `badRequest`, `validationError`, `serviceUnavailable`, `badGateway` (Task B4), `problem`, `problemHeaders` (`@/lib/problem-details`); `KcError` (`@/lib/kc-response`). Test helper: `bearerToken({ userId, role })` from `tests/helpers/auth.ts` (a real HS256 JWT the real `getActor` accepts). / Produces: `GET(req, { params: { id } })` and `PUT(req, { params: { id } })` route handlers. Success body `{ "data": PaymentSettingsView }` (200), like the other `/practices/:id` routes.

Status codes fixed here (spec §3 "Access", §7 route tests). Every error is problem+json with a `code`:

| Case | Status | `code` |
|---|---|---|
| no / bad bearer | 401 | `unauthorized` (from `requireRoles`) |
| PROFESSIONAL, RECEPTIONIST, CLIENT | 403 | `forbidden` (from `requireRoles`) |
| CLINIC_ADMIN with no WordPress link (`resolveKcActor` throws `KcError`) | 403 | `forbidden` |
| CLINIC_ADMIN on another clinic; non-integer id; SUPER_ADMIN on an id with no `wp_kc_clinics` row (checked BEFORE any options read or plugin call); plugin `clinic_not_found` | 404 | `practice_not_found` |
| PUT body is not JSON | 400 | `invalid_json` |
| schema failure | 422 | `invalid_input`, with `fields` (`validationError('invalid_input', …, fields)`) |
| no usable rate (ours or the plugin's re-check) | 422 | `fx_rate_required`, with `fields: { fxRate: [message] }` |
| plugin `invalid_settings` (its own `validate()` refused what our schema passed — a retry would fail the same way) | 422 | `invalid_input`, with `fields: { body: ['WordPress rejected the settings'] }` (WordPress message logged with `logging.error`, never returned) |
| `wp_options` read failed | 503 | `payment_settings_unavailable` (logged). On PUT this can also come from the re-read AFTER a save that went through: the FE should GET again before retrying. |
| any other plugin error | 502 | `payment_settings_save_failed` (WordPress message logged with `logging.error`, never returned) |
| anything else | 500 | `internal_error` (logged), via `problem({ type: '/errors/internal', title: 'Internal Server Error', status: 500, code: 'internal_error' })` — the neighbouring `settings` route's body plus a `code` |

The test drives the real guard, scope check, service, repo and logger. It mocks only Prisma (so the audit row is asserted as the `log_entries` insert itself: level `AUDIT`, action `clinic.payment_settings.updated`, `userId` = the caller's cuid, `metadata.before/after`), `findClinicById`, `resolveKcActor` (the clinic admin runs clinic 4), and `putClinicPaymentSettings`.

- [ ] **Step 1: Write the failing route test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/payment-settings-route.test.ts` with exactly this content:

```ts
/**
 * GET / PUT /api/v1/practices/{id}/payment-settings (spec §3 "Access", §7 route tests).
 *
 * Real JWTs through the real role guard and scope check, the real service, repo and
 * logger. Mocked: Prisma (so the audit row is the `log_entries` insert itself), the
 * clinic lookup, the clinic-admin → clinic resolution, and the plugin PUT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  kcOption: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  kcUser: { findUnique: vi.fn() },
  logEntry: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/services/billing/kc-actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing/kc-actor')>()),
  resolveKcActor: vi.fn(),
}));
vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
}));
vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  putClinicPaymentSettings: vi.fn(),
}));

import { GET, PUT } from '@/app/api/v1/practices/[id]/payment-settings/route';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { WpEndpointError, putClinicPaymentSettings } from '@/lib/wp-endpoint';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';
import { bearerToken } from '../helpers/auth';

const SUPER_ID = 'cksuperadmin00000000000001';
const ADMIN_ID = 'ckclinicadmin0000000000001';
const OWN_CLINIC = 4;
const OTHER_CLINIC = 9;
const VALID = { international: true, fxRate: 18000, markupPercent: 10, fixedFeeIdr: 25000 };
const NOTHING_STORED = { international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null };

function optionRow(fields: Record<string, unknown> = {}) {
  return {
    optionName: `praktiqu_endpoint_clinic_${OWN_CLINIC}_payment`,
    optionValue: JSON.stringify({
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000,
      updated_at: '2026-10-06T08:00:00+00:00', updated_by: 123, ...fields,
    }),
  };
}
const globalRate = (v: string) => ({ optionName: 'praktiqu_endpoint_paypal_idr_rate', optionValue: v });

async function call(
  method: 'GET' | 'PUT',
  role: Actor['role'] | null,
  opts: { id?: string; body?: unknown; userId?: string } = {},
): Promise<Response> {
  const id = opts.id ?? String(OWN_CLINIC);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) {
    const userId = opts.userId ?? (role === 'SUPER_ADMIN' ? SUPER_ID : ADMIN_ID);
    headers.authorization = `Bearer ${await bearerToken({ userId, role })}`;
  }
  const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const req = new NextRequest(`http://x/api/v1/practices/${id}/payment-settings`, { method, headers, body });
  return (method === 'GET' ? GET : PUT)(req, { params: { id } }) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findClinicById).mockImplementation(async (id: bigint) =>
    id === BigInt(OWN_CLINIC) || id === BigInt(OTHER_CLINIC) ? ({ id } as never) : null,
  );
  // The clinic admin runs clinic 4.
  vi.mocked(resolveKcActor).mockImplementation(async (actor: Actor) => ({ actor, wpUserId: 55n, clinicId: BigInt(OWN_CLINIC) }));
  db.kcOption.findMany.mockReset().mockResolvedValue([]);
  db.user.findUnique.mockReset().mockImplementation(async (args: any) => {
    if (args.where.id === SUPER_ID) return { wpUserId: 123n };
    if (args.where.id === ADMIN_ID) return { wpUserId: 55n };
    if (args.where.wpUserId === 123n) return { displayName: 'Super Admin' };
    if (args.where.wpUserId === 55n) return { displayName: 'Admin Klinik' };
    return null;
  });
  db.kcUser.findUnique.mockReset().mockResolvedValue(null);
  db.logEntry.create.mockReset().mockResolvedValue({});
  vi.mocked(putClinicPaymentSettings).mockReset().mockResolvedValue(undefined);
});

describe('payment-settings — role matrix', () => {
  it.each(['SUPER_ADMIN', 'CLINIC_ADMIN'] as const)('%s may read its clinic', async (role) => {
    expect((await call('GET', role)).status).toBe(200);
  });

  it.each(['PROFESSIONAL', 'RECEPTIONIST', 'CLIENT'] as const)('%s gets 403 on GET and PUT', async (role) => {
    const get = await call('GET', role);
    const put = await call('PUT', role, { body: VALID });

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect((await put.json()).code).toBe('forbidden');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('401 without a bearer token', async () => {
    expect((await call('GET', null)).status).toBe(401);
  });

  it('403 for a clinic admin whose account has no WordPress link', async () => {
    vi.mocked(resolveKcActor).mockRejectedValue(new KcError('User is not linked to a WordPress account', 403));

    const res = await call('PUT', 'CLINIC_ADMIN', { body: VALID });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });
});

describe('payment-settings — scope and existence', () => {
  it.each(['GET', 'PUT'] as const)('%s: a clinic admin gets 404 for another clinic, with no read or write', async (method) => {
    const res = await call(method, 'CLINIC_ADMIN', { id: String(OTHER_CLINIC), body: method === 'PUT' ? VALID : undefined });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT'] as const)('%s: a super admin gets 404 for a clinic that does not exist, and no plugin call', async (method) => {
    const res = await call(method, 'SUPER_ADMIN', { id: '404404', body: method === 'PUT' ? VALID : undefined });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
    expect(findClinicById).toHaveBeenCalledWith(404404n);
    expect(db.kcOption.findMany).not.toHaveBeenCalled();
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('404 for a non-numeric id', async () => {
    const res = await call('GET', 'SUPER_ADMIN', { id: 'abc' });

    expect(res.status).toBe(404);
    expect(findClinicById).not.toHaveBeenCalled();
  });
});

describe('GET payment-settings', () => {
  it('answers the view under data', async () => {
    db.kcOption.findMany.mockResolvedValue([optionRow(), globalRate('16500')]);

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.clinicId).toBe(OWN_CLINIC);
    expect(data.stored).toEqual(VALID);
    expect(data.effective.methods).toEqual(['xendit', 'paypal', 'card']);
    expect(data.globalDefaults).toEqual({ fxRate: 16500, markupPercent: null });
    expect(data.example).toEqual({ price: '12.23', taxes: [], fee: '1.39', total: '13.62', idr: 200000 });
    expect(data.updatedBy).toEqual({ wpUserId: 123, name: 'Super Admin' });
  });

  it('503 payment_settings_unavailable when wp_options cannot be read', async () => {
    db.kcOption.findMany.mockRejectedValue(new Error('Too many connections'));

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('payment_settings_unavailable');
  });

  it('500 internal_error as problem+json, logged, for anything unexpected', async () => {
    vi.mocked(findClinicById).mockRejectedValue(new Error('Lost connection to MySQL server'));

    const res = await call('GET', 'SUPER_ADMIN');

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toEqual({
      type: '/errors/internal', title: 'Internal Server Error', status: 500, code: 'internal_error',
    });
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
  });
});

describe('PUT payment-settings', () => {
  it('400 invalid_json for a body that is not JSON', async () => {
    const res = await call('PUT', 'SUPER_ADMIN', { body: '{nope' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
  });

  it('422 invalid_input with per-field messages, and no plugin call', async () => {
    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: 16.5, currency: 'USD' } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ status: 422, code: 'invalid_input' });
    expect(body.fields.fxRate).toEqual(['fxRate must be from 1000 to 100000 (rupiah per 1 USD)']);
    expect(body.fields.body[0]).toContain('currency');
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it('422 fx_rate_required when the global rate is out of range, in the same field shape', async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('500000')]);

    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: null } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('fx_rate_required');
    expect(Object.keys(body.fields)).toEqual(['fxRate']);
    expect(putClinicPaymentSettings).not.toHaveBeenCalled();
  });

  it("422 fx_rate_required when the plugin's own re-check refuses", async () => {
    db.kcOption.findMany.mockResolvedValue([globalRate('18000')]);
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 422: A usable rate is required', 422, 'fx_rate_required'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: { ...VALID, fxRate: null } });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('fx_rate_required');
  });

  it('saves, writes the AUDIT log_entries row with the caller cuid, and answers the option read back', async () => {
    db.kcOption.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([optionRow()]);

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, {
      international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000, updated_by: 123,
    });
    expect(db.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        level: 'AUDIT',
        action: 'clinic.payment_settings.updated',
        userId: SUPER_ID,
        resource: 'clinic',
        resourceId: '4',
        metadata: { wpUserId: 123, before: NOTHING_STORED, after: VALID },
      }),
    });
    expect((await res.json()).data.stored).toEqual(VALID);
  });

  it("a clinic admin saves its own clinic, and updated_by is that admin's WordPress id", async () => {
    const res = await call('PUT', 'CLINIC_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, expect.objectContaining({ updated_by: 55 }));
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: ADMIN_ID }) });
  });

  it('forwards updated_by null when the account has no WordPress link', async () => {
    db.user.findUnique.mockImplementation(async (args: any) => (args.where.id === SUPER_ID ? { wpUserId: null } : null));

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(200);
    expect(putClinicPaymentSettings).toHaveBeenCalledWith(OWN_CLINIC, expect.objectContaining({ updated_by: null }));
    expect(db.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: SUPER_ID, metadata: expect.objectContaining({ wpUserId: null }) }),
    });
  });

  it('404 when the plugin no longer finds the clinic', async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 404: Clinic 4 does not exist', 404, 'clinic_not_found'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('practice_not_found');
  });

  it("422 invalid_input when WordPress's own validation refuses, logged but never echoed", async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 400: secret wp detail', 400, 'invalid_settings'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      status: 422,
      code: 'invalid_input',
      fields: { body: ['WordPress rejected the settings'] },
    });
    expect(text).not.toContain('secret wp detail');
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
    expect(db.logEntry.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'AUDIT' }) });
  });

  it('502 payment_settings_save_failed for any other plugin error, logged but never echoed', async () => {
    vi.mocked(putClinicPaymentSettings).mockRejectedValue(
      new WpEndpointError('/clinics/4/payment-settings failed 500: secret wp detail', 500, 'save_failed'),
    );

    const res = await call('PUT', 'SUPER_ADMIN', { body: VALID });

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe('payment_settings_save_failed');
    expect(text).not.toContain('secret wp detail');
    expect(db.logEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'ERROR' }) });
    expect(db.logEntry.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ level: 'AUDIT' }) });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-settings-route.test.ts
```

Expected: FAIL — `Error: Cannot find module '@/app/api/v1/practices/[id]/payment-settings/route' imported from …/tests/payments/payment-settings-route.test.ts`; `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Write the route**

Create the directory, then the file:

```bash
mkdir -p '/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/practices/[id]/payment-settings'
```

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/app/api/v1/practices/[id]/payment-settings/route.ts` with exactly this content:

```ts
/**
 * GET /api/v1/practices/:id/payment-settings — the clinic's international payment settings
 * PUT /api/v1/practices/:id/payment-settings — replace them (written through the plugin)
 *
 * Spec: docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md §3.
 *
 * A separate route on purpose, not part of PATCH /practices/:id/settings: that one writes
 * `extra` and records `actorId: null`, while money settings need a clear audit trail.
 *
 * Access: SUPER_ADMIN for any clinic, CLINIC_ADMIN for their own (another clinic is 404).
 * `assertPracticeInScope` does not check that the clinic exists for a SUPER_ADMIN, so both
 * verbs load it with `findClinicById` first: a PUT for an unknown id never reaches the
 * plugin and never creates an option.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import { logging } from '@/lib/logging';
import {
  badGateway,
  badRequest,
  forbidden,
  notFound,
  problem,
  problemHeaders,
  serviceUnavailable,
  validationError,
  type ProblemDetails,
} from '@/lib/problem-details';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { findClinicById } from '@/repositories/wp/clinics.repo';
import { PaymentSettingsUnavailableError } from '@/repositories/wp/clinic-payment-settings.repo';
import { PracticeNotFoundError, assertPracticeInScope } from '@/services/practice/service';
import {
  FxRateRequiredError,
  PaymentSettingsValidationError,
  getPaymentSettingsView,
  updatePaymentSettings,
} from '@/services/practice/payment-settings.service';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

function problemResponse(p: ProblemDetails): NextResponse {
  return NextResponse.json(p, { status: p.status, headers: problemHeaders(p) });
}

/** Scope first (it rejects a non-integer id), then existence. Throws PracticeNotFoundError. */
async function loadClinicInScope(actor: Parameters<typeof assertPracticeInScope>[0], clinicId: number): Promise<void> {
  await assertPracticeInScope(actor, clinicId);
  if (!(await findClinicById(BigInt(clinicId)))) throw new PracticeNotFoundError(clinicId);
}

async function handleError(err: unknown, clinicId: string, method: 'GET' | 'PUT'): Promise<NextResponse> {
  if (err instanceof PracticeNotFoundError) {
    return problemResponse(notFound('practice_not_found', `Practice ${clinicId} not found.`));
  }
  if (err instanceof KcError) {
    // resolveKcActor: a clinic admin whose account has no WordPress link.
    return problemResponse(forbidden('forbidden', err.message));
  }
  if (err instanceof PaymentSettingsValidationError) {
    return problemResponse(validationError('invalid_input', 'Invalid payment settings', undefined, err.fields));
  }
  if (err instanceof FxRateRequiredError) {
    return problemResponse(validationError('fx_rate_required', err.message, undefined, { fxRate: [err.message] }));
  }
  if (err instanceof PaymentSettingsUnavailableError) {
    await logging.error('Clinic payment settings read failed', err, {
      path: `/api/v1/practices/${clinicId}/payment-settings`,
      method,
    });
    return problemResponse(
      serviceUnavailable('payment_settings_unavailable', 'Payment settings are temporarily unavailable. Please try again.'),
    );
  }
  if (err instanceof WpEndpointError) {
    if (err.code === 'clinic_not_found') {
      return problemResponse(notFound('practice_not_found', `Practice ${clinicId} not found.`));
    }
    if (err.code === 'invalid_settings') {
      // The plugin's own validate() refused what our schema passed. Retrying would fail
      // the same way, so this is a 422 like our own schema failure, not a retryable 502.
      // The WordPress message (it names the field) is logged, never returned.
      await logging.error('Clinic payment settings refused by WordPress', err, {
        path: `/api/v1/practices/${clinicId}/payment-settings`,
        method,
        metadata: { status: err.status, code: err.code },
      });
      return problemResponse(
        validationError('invalid_input', 'Invalid payment settings', undefined, {
          body: ['WordPress rejected the settings'],
        }),
      );
    }
    // The WordPress message is logged, never returned.
    await logging.error('Clinic payment settings save failed', err, {
      path: `/api/v1/practices/${clinicId}/payment-settings`,
      method,
      metadata: { status: err.status, code: err.code ?? null },
    });
    return problemResponse(badGateway('payment_settings_save_failed', 'The settings could not be saved. Please try again.'));
  }
  await logging.error('Clinic payment settings request failed', err, {
    path: `/api/v1/practices/${clinicId}/payment-settings`,
    method,
  });
  // The neighbouring settings route's body, plus a `code` so the FE can always branch on one.
  return problemResponse(
    problem({ type: '/errors/internal', title: 'Internal Server Error', status: 500, code: 'internal_error' }),
  );
}

/** GET /api/v1/practices/:id/payment-settings */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const clinicId = Number(params.id);
  try {
    await loadClinicInScope(gate.actor, clinicId);
    const view = await getPaymentSettingsView(clinicId);
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return handleError(err, params.id, 'GET');
  }
}

/** PUT /api/v1/practices/:id/payment-settings */
export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problemResponse(badRequest('invalid_json', 'The request body must be JSON.'));
  }

  const clinicId = Number(params.id);
  try {
    await loadClinicInScope(gate.actor, clinicId);
    const view = await updatePaymentSettings(clinicId, body, gate.actor);
    return NextResponse.json({ data: view }, { status: 200 });
  } catch (err) {
    return handleError(err, params.id, 'PUT');
  }
}
```

- [ ] **Step 4: Run the route and service tests — expect PASS — and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/payment-settings-route.test.ts tests/payments/payment-settings.service.test.ts && npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  2 passed (2)`, `Tests  62 passed (62)` (25 route + 37 service), then `tsc exit=0`.

- [ ] **Step 5: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add 'src/app/api/v1/practices/[id]/payment-settings/route.ts' tests/payments/payment-settings-route.test.ts && git commit -F - <<'EOF'
feat(practices): route GET/PUT /practices/{id}/payment-settings

SUPER_ADMIN untuk klinik mana pun, CLINIC_ADMIN hanya kliniknya sendiri
(klinik lain 404). Klinik yang tidak ada ditolak 404 lewat findClinicById
sebelum plugin dipanggil, jadi PUT tidak pernah membuat opsi yatim. Semua
error problem+json berkode: invalid_input / fx_rate_required (422, termasuk
invalid_settings dari plugin), payment_settings_unavailable (503),
payment_settings_save_failed (502), internal_error (500).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds, and `git status --short` lists no file this task touched (an untracked planning folder such as `.plan-wip/` may show; leave it alone). Never use `git add -A` / `git add .`: the `node_modules` symlink from Task B0 must stay out of git.

### Task B8: Field tambahan — `international`, `paymentMethods`, `usd`, `clinicId` di practices, katalog publik dan booking publik

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/public-usd.service.ts` (import block, line 11; append `rowPaymentForDisplay` at the end)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/types/practice.ts` (`PracticeDTO`, around line 152)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (imports, line 17; `toPracticeDTO`, line 105; new `toPracticeDTOs` above `toHHmm`; `listPractices` / `getPractice` / `exportPractices` return lines)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (imports after line 36; `PublicClinic` + `toPublicClinic` + `listPublicPractices` + `getPublicPractice`, lines 38–78; `PublicService` + `getPublicProfessionalServices`, lines 255–293)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (imports, lines 20 and 37; `CreatedAppointment`, line 174; the return of `createPublicAppointment`, around line 405; `PublicAppointmentView` and `toView`, lines 423–468)
- Test: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` (modify), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/practice-international.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-catalog-payment.test.ts` (new), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/create.test.ts` (modify), `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (modify)

**Interfaces:** Consumes: `resolveClinicPaymentForDisplay(clinicId)`, `resolveClinicPaymentManyForDisplay(clinicIds)` (Task B2, never throw); `rowPaymentFor(args, settings)` and `RowPayment` (Task B2); `notInternational`, `XENDIT_ONLY`, `ClinicPaymentSettings`, `PublicUsdView` (Task B1); `PaymentMethod` (`@/lib/wp-endpoint`). / Produces (exact contract fields): `PracticeDTO.international: boolean` (in `listPractices`, `getPractice`, `updatePractice` — and therefore also `exportPractices`, which builds the same DTO); `PublicClinic.international: boolean`, `PublicClinic.paymentMethods: PaymentMethod[]` (`listPublicPractices`, `getPublicPractice`); `PublicService.clinicId: number`, `PublicService.paymentMethods: PaymentMethod[]`, `PublicService.usd: PublicUsdView | null` (`getPublicProfessionalServices`); `CreatedAppointment.paymentMethods` / `.usd` and `PublicAppointmentView.paymentMethods` / `.usd` (same types). Plus one additive export in `public-usd.service.ts`: `rowPaymentForDisplay(args, settings): Promise<RowPayment>` — `rowPaymentFor` that never throws (a failed tax read is logged with `logging.error` and answers `{ paymentMethods: ['xendit'], usd: null }`).

Rules fixed here (spec §1 rule 5, §3 "Fields added to existing endpoints", §6):
- **Every new field is display-only and fails closed.** All reads use the `ForDisplay` variants and `rowPaymentForDisplay`, and the one extra read in `toView` (the doctor↔service mapping, `listServicesForDoctor`) is caught and logged the same way, so a settings, mapping or tax read failure shows rupiah and Xendit only and never turns an endpoint into a 500 — including a cancel that has already gone through the plugin. This matters most in `createPublicAppointment`: the fields are computed AFTER the appointment is written, and a throw there would make the route's `withRetry` book a second time.
- **One settings read per list** (`resolveClinicPaymentManyForDisplay` with every clinic id of the page), never one per row. The service rows are quoted sequentially (one tax query per row of an international clinic only): the MySQL user is capped at a handful of connections.
- **The USD shown is the USD charged.** Each row/booking is quoted with the same arguments `initiatePublicPayment` uses: `name` = `nameAlias ?? name` of the doctor↔service mapping, `price` = the mapping's `charges ?? '0'`, `serviceId`, `clinicId` = the mapping's / booking's clinic, `doctorId` = the professional id.
- `toView` (used by `GET /public/appointments/{token}`, the cancel answer, the idempotent replay of `POST /public/appointments`, and the rating prompt) runs no mapping or tax query for a clinic whose `methods` exclude `paypal`. A booked service that is no longer mapped answers Xendit only (the charge would be Rp 0, which the gate refuses).
- `price` (rupiah) and every existing field stay exactly as they are; the routes already pass the service results through unchanged, so no route file changes.

- [ ] **Step 1: Write the failing `rowPaymentForDisplay` tests**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` (around line 1), replace

```ts
/**
 * rowPaymentFor — the `paymentMethods` + `usd` fields of a public row.
```

with

```ts
/**
 * rowPaymentFor / rowPaymentForDisplay — the `paymentMethods` + `usd` fields of a public row.
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` (around line 9), replace

```ts
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));

import { rowPaymentFor } from '@/services/payments/public-usd.service';
```

with

```ts
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { rowPaymentFor, rowPaymentForDisplay } from '@/services/payments/public-usd.service';
import { logging } from '@/lib/logging';
```

Append to the end of `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-usd.service.test.ts` (after the last line, separated by one blank line):

```ts
describe('rowPaymentForDisplay', () => {
  it('answers what rowPaymentFor answers', async () => {
    const result = await rowPaymentForDisplay(ROW, flagged({ fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 }));

    expect(result).toEqual({
      paymentMethods: ['xendit', 'paypal', 'card'],
      usd: { price: '12.23', taxes: [], fee: '1.39', total: '13.62' },
    });
  });

  it('shows rupiah and Xendit only, and logs, when the tax read fails', async () => {
    const dbDown = new Error('Too many connections');
    calculateTaxMock.mockRejectedValue(dbDown);

    const result = await rowPaymentForDisplay(ROW, flagged({ fx_rate: 18000 }));

    expect(result).toEqual({ paymentMethods: ['xendit'], usd: null });
    expect(logging.error).toHaveBeenCalledWith('USD price unavailable — showing rupiah and Xendit only', dbDown, {
      resource: 'clinic',
      resourceId: '4',
      metadata: { doctorId: 29, serviceId: 7 },
    });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-usd.service.test.ts
```

Expected: `TypeError: rowPaymentForDisplay is not a function` for the two new tests; `Tests  2 failed | 5 passed (7)`.

- [ ] **Step 3: Add `rowPaymentForDisplay`**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/public-usd.service.ts` (around line 11), replace

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { computePublicAmount } from '@/services/payments/payment.service';
```

with

```ts
import type { PaymentMethod } from '@/lib/wp-endpoint';
import { logging } from '@/lib/logging';
import { computePublicAmount } from '@/services/payments/payment.service';
```

Append to the end of `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/payments/public-usd.service.ts` (after the last line, separated by one blank line):

```ts
/**
 * Display variant: never throws. A failed tax read is logged and the row shows rupiah
 * and Xendit only — the same fail-closed answer as a failed settings read (spec §1
 * rule 5). Used where the row is shown, never where it is charged: a booking that is
 * already written must not answer an error because its USD preview could not be built.
 */
export async function rowPaymentForDisplay(
  args: { clinicId: number; doctorId: number; serviceId: number; name: string; price: number | string },
  settings: ClinicPaymentSettings,
): Promise<RowPayment> {
  try {
    return await rowPaymentFor(args, settings);
  } catch (err) {
    await logging.error('USD price unavailable — showing rupiah and Xendit only', err, {
      resource: 'clinic',
      resourceId: String(args.clinicId),
      metadata: { doctorId: args.doctorId, serviceId: args.serviceId },
    });
    return { paymentMethods: [...XENDIT_ONLY], usd: null };
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-usd.service.test.ts
```

Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Write the failing `PracticeDTO.international` test**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/practice-international.test.ts` with exactly this content:

```ts
/**
 * `PracticeDTO.international` on GET /practices, GET /practices/{id} and the PATCH
 * answer (spec §3 "Fields added to existing endpoints").
 *
 * The clinic rows and the settings read are mocked: the flag must come from ONE settings
 * read per page, and a clinic the read has no entry for reads false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
  updateClinic: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { findClinicById, listClinics, updateClinic, type WpClinic } from '@/repositories/wp/clinics.repo';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import { exportPractices, getPractice, listPractices, updatePractice } from '@/services/practice/service';

function clinic(id: number): WpClinic {
  return {
    id: BigInt(id),
    name: `Klinik ${id}`,
    email: null,
    telephone: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    specialties: [],
    isActive: true,
    clinicAdminId: 1n,
    countryCode: null,
    countryCallingCode: null,
    extra: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Only `international` matters to the DTO; the rest is the not-international shape. */
function flagged(id: number): ClinicPaymentSettings {
  return { ...notInternational(id), international: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(
    async (ids: number[]) => new Map(ids.map((id) => [id, id === 4 ? flagged(id) : notInternational(id)])),
  );
});

describe('PracticeDTO.international', () => {
  it('lists each clinic with its flag, from one settings read for the page', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4), clinic(9)], total: 2 } as never);

    const { data } = await listPractices();

    expect(data.map((p) => [p.id, p.international])).toEqual([[4, true], [9, false]]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([4, 9]);
  });

  it('reads false for a clinic the settings read has no entry for', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4)], total: 1 } as never);
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(new Map());

    expect((await listPractices()).data[0].international).toBe(false);
  });

  it('shows the flag on GET /practices/{id}', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(4));

    const dto = await getPractice(4);

    expect(dto.international).toBe(true);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([4]);
  });

  it('keeps the flag in the PATCH answer', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(4));
    vi.mocked(updateClinic).mockResolvedValue(true);

    const dto = await updatePractice(4, { name: 'Klinik Baru' });

    expect(dto.international).toBe(true);
  });

  it('carries the flag into the JSON export too', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(4), clinic(9)], total: 2 } as never);

    const rows = await exportPractices();

    expect(rows.map((p) => p.international)).toEqual([true, false]);
  });
});
```

- [ ] **Step 6: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/practice-international.test.ts
```

Expected: `Tests  5 failed (5)`, e.g. `AssertionError: expected [ [ 4, undefined ], [ 9, undefined ] ] to deeply equal [ [ 4, true ], [ 9, false ] ]`.

- [ ] **Step 7: Add `international` to `PracticeDTO`**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/types/practice.ts` (around line 151), replace

```ts
  status: PracticeStatusValue;
  businessHours: BusinessHours[];
  createdAt: string;
```

with

```ts
  status: PracticeStatusValue;
  businessHours: BusinessHours[];
  /**
   * The clinic's stored International flag (read only; edited through
   * `/practices/{id}/payment-settings`). It drives the admin badge and is false when the
   * settings cannot be read. Clients decide the USD display and the payment methods from
   * the public `usd` / `paymentMethods` fields, never from this.
   */
  international: boolean;
  createdAt: string;
```

Then in the practice service:

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 15), replace

```ts
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { resolveKcActor } from '@/services/billing/kc-actor';
```

with

```ts
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { resolveClinicPaymentManyForDisplay } from '@/services/payments/clinic-payment.service';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 105), replace

```ts
function toPracticeDTO(c: WpClinic): PracticeDTO {
```

with

```ts
function toPracticeDTO(c: WpClinic, international: boolean): PracticeDTO {
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 124), replace

```ts
    businessHours: readBusinessHours(extra),
    createdAt: c.createdAt.toISOString(),
```

with

```ts
    businessHours: readBusinessHours(extra),
    international,
    createdAt: c.createdAt.toISOString(),
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 132), replace

```ts
/** `HH:MM:SS` → `HH:mm`, the shape this DTO has always used. */
```

with

```ts
/**
 * DTOs for a page of clinics, with one settings read for the whole page. Never throws:
 * a failed read is logged and every clinic reads `international: false`.
 */
async function toPracticeDTOs(clinics: WpClinic[]): Promise<PracticeDTO[]> {
  const payment = await resolveClinicPaymentManyForDisplay(clinics.map((c) => Number(c.id)));
  return clinics.map((c) => toPracticeDTO(c, payment.get(Number(c.id))?.international ?? false));
}

/** `HH:MM:SS` → `HH:mm`, the shape this DTO has always used. */
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 184), replace

```ts
  return { data: items.map(toPracticeDTO), total };
```

with

```ts
  return { data: await toPracticeDTOs(items), total };
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 189), replace

```ts
  if (!clinic) throw new PracticeNotFoundError(id);
  return toPracticeDTO(clinic);
}
```

with

```ts
  if (!clinic) throw new PracticeNotFoundError(id);
  const [dto] = await toPracticeDTOs([clinic]);
  return dto;
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/practice/service.ts` (around line 255), replace

```ts
    out.push(...items.map(toPracticeDTO));
```

with

```ts
    out.push(...(await toPracticeDTOs(items)));
```

- [ ] **Step 8: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/practice-international.test.ts
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 9: Write the failing public-catalogue test**

The quote is real here (only the settings read and `calculateTax` are mocked), so the test pins the figures the charge uses — the spec's worked example (Rp 200,000, rate 18,000, markup 10 %, fee Rp 25,000 → 12.23 + 1.39 = 13.62).

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/payments/public-catalog-payment.test.ts` with exactly this content:

```ts
/**
 * The public catalogue's payment fields (spec §3 "Fields added to existing endpoints",
 * §7 "Catalogue"): `international` + `paymentMethods` on clinics, and `clinicId` +
 * `paymentMethods` + `usd` on a professional's services.
 *
 * The repositories, the settings read and calculateTax are mocked. The quote itself is
 * real (public-usd.service + intl-pricing), so these are the figures the charge uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/clinics.repo')>()),
  findClinicById: vi.fn(),
  listClinics: vi.fn(),
}));
vi.mock('@/repositories/wp/doctors.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/doctors.repo')>()),
  findDoctorById: vi.fn(),
}));
vi.mock('@/repositories/wp/services.repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/repositories/wp/services.repo')>()),
  listServicesForDoctor: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
  resolveClinicPaymentManyForDisplay: vi.fn(),
}));
vi.mock('@/services/billing/bill.service', () => ({
  calculateTax: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));

import { findClinicById, listClinics, type WpClinic } from '@/repositories/wp/clinics.repo';
import { findDoctorById } from '@/repositories/wp/doctors.repo';
import { listServicesForDoctor, type WpDoctorService } from '@/repositories/wp/services.repo';
import {
  resolveClinicPaymentForDisplay,
  resolveClinicPaymentManyForDisplay,
} from '@/services/payments/clinic-payment.service';
import { calculateTax } from '@/services/billing/bill.service';
import { notInternational, parseStoredOption, resolveSettings, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import {
  getPublicPractice,
  getPublicProfessionalServices,
  listPublicPractices,
} from '@/services/public/public-catalog.service';

const DOCTOR = 29;
const INTL = 4; // flagged: rate 18,000, markup 10 %, fee Rp 25,000 — the spec's worked example
const LOCAL = 9; // not international

function settingsFor(clinicId: number, fields: Record<string, unknown>): ClinicPaymentSettings {
  return resolveSettings(
    clinicId,
    parseStoredOption(JSON.stringify({ fx_rate: null, markup_percent: null, fixed_fee_idr: null, ...fields })),
    { fxRate: null, markupPercent: null },
  );
}
const WORKED_EXAMPLE = { international: true, fx_rate: 18000, markup_percent: 10, fixed_fee_idr: 25000 };

function settingsMap(ids: number[], intl: ClinicPaymentSettings = settingsFor(INTL, WORKED_EXAMPLE)) {
  return new Map(ids.map((id) => [id, id === INTL ? intl : notInternational(id)]));
}

function clinic(id: number, isActive = true): WpClinic {
  return {
    id: BigInt(id),
    name: `Klinik ${id}`,
    email: null,
    telephone: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    specialties: [],
    isActive,
    clinicAdminId: 1n,
    countryCode: null,
    countryCallingCode: null,
    extra: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function mapping(serviceId: number, clinicId: number, charges: string): WpDoctorService {
  return {
    mappingId: BigInt(serviceId * 100 + clinicId),
    serviceId: BigInt(serviceId),
    doctorId: BigInt(DOCTOR),
    clinicId: BigInt(clinicId),
    name: 'Konsultasi',
    type: 'KONSELING',
    charges,
    durationMinutes: 60,
    isPublic: true,
    isActive: true,
    telemedService: null,
    nameAlias: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveClinicPaymentManyForDisplay).mockImplementation(async (ids: number[]) => settingsMap(ids));
  vi.mocked(resolveClinicPaymentForDisplay).mockImplementation(async (id: number) => settingsMap([id]).get(id)!);
  vi.mocked(calculateTax).mockResolvedValue({ total_tax: 0, calculated_taxes: [] });
  vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'ACTIVE' } as never);
});

describe('public clinics', () => {
  it('lists each clinic with its flag and methods, from one settings read', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(LOCAL), clinic(INTL)], total: 2 } as never);

    const list = await listPublicPractices();

    expect(list.map((c) => [c.id, c.international, c.paymentMethods])).toEqual([
      [INTL, true, ['xendit', 'paypal', 'card']],
      [LOCAL, false, ['xendit']],
    ]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledWith([LOCAL, INTL]);
  });

  it('keeps the flag but offers Xendit only when a flagged clinic has no usable rate', async () => {
    vi.mocked(listClinics).mockResolvedValue({ items: [clinic(INTL)], total: 1 } as never);
    vi.mocked(resolveClinicPaymentManyForDisplay).mockResolvedValue(
      settingsMap([INTL], settingsFor(INTL, { international: true })),
    );

    const [only] = await listPublicPractices();

    expect(only.international).toBe(true);
    expect(only.paymentMethods).toEqual(['xendit']);
  });

  it('shows one clinic with its methods', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(INTL));

    const one = await getPublicPractice(INTL);

    expect(one).toMatchObject({ id: INTL, international: true, paymentMethods: ['xendit', 'paypal', 'card'] });
    expect(resolveClinicPaymentForDisplay).toHaveBeenCalledWith(INTL);
  });

  it('reads no settings for an inactive clinic', async () => {
    vi.mocked(findClinicById).mockResolvedValue(clinic(INTL, false));

    expect(await getPublicPractice(INTL)).toBeNull();
    expect(resolveClinicPaymentForDisplay).not.toHaveBeenCalled();
  });
});

describe("a professional's services", () => {
  it('quotes USD only for the international clinic, a usable rate and a non-free row', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      mapping(7, INTL, '200000'),
      mapping(7, LOCAL, '200000'),
      mapping(8, INTL, '0'),
    ]);

    const rows = await getPublicProfessionalServices(DOCTOR);

    expect(rows).toEqual([
      {
        id: 7, name: 'Konsultasi', price: '200000', durationMinutes: 60, serviceType: 'KONSELING',
        clinicId: INTL,
        paymentMethods: ['xendit', 'paypal', 'card'],
        usd: { price: '12.23', taxes: [], fee: '1.39', total: '13.62' },
      },
      {
        id: 7, name: 'Konsultasi', price: '200000', durationMinutes: 60, serviceType: 'KONSELING',
        clinicId: LOCAL,
        paymentMethods: ['xendit'],
        usd: null,
      },
      {
        id: 8, name: 'Konsultasi', price: '0', durationMinutes: 60, serviceType: 'KONSELING',
        clinicId: INTL,
        paymentMethods: ['xendit'],
        usd: null,
      },
    ]);
    expect(resolveClinicPaymentManyForDisplay).toHaveBeenCalledTimes(1);
    // The local clinic's row runs no tax query.
    expect(calculateTax).toHaveBeenCalledTimes(2);
    expect(calculateTax).not.toHaveBeenCalledWith(expect.objectContaining({ clinic_id: LOCAL }));
  });

  it('gives every USD amount as a 2-decimal string, taxes included', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping(7, INTL, '200000')]);
    vi.mocked(calculateTax).mockResolvedValue({
      total_tax: 22000,
      calculated_taxes: [{ tax_id: 1, tax_name: 'PPN', tax_type: 'percentage', tax_value: 11, tax_amount: 22000, service_id: 7, service_name: 'Konsultasi' }],
    } as never);

    const [row] = await getPublicProfessionalServices(DOCTOR);

    expect(row.usd).toEqual({ price: '12.23', taxes: [{ name: 'PPN', amount: '1.35' }], fee: '1.39', total: '14.97' });
    for (const amount of [row.usd!.price, row.usd!.fee!, row.usd!.total, ...row.usd!.taxes.map((t) => t.amount)]) {
      expect(amount).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('shows a row in rupiah and Xendit only, not a 500, when its tax read fails', async () => {
    vi.mocked(listServicesForDoctor).mockResolvedValue([mapping(7, INTL, '200000')]);
    vi.mocked(calculateTax).mockRejectedValue(new Error('Too many connections'));

    const [row] = await getPublicProfessionalServices(DOCTOR);

    expect(row).toMatchObject({ clinicId: INTL, paymentMethods: ['xendit'], usd: null });
  });

  it('reads no settings for a professional who is not active', async () => {
    vi.mocked(findDoctorById).mockResolvedValue({ id: BigInt(DOCTOR), status: 'INACTIVE' } as never);

    expect(await getPublicProfessionalServices(DOCTOR)).toBeNull();
    expect(resolveClinicPaymentManyForDisplay).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run it — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-catalog-payment.test.ts
```

Expected: `Tests  6 failed | 2 passed (8)` (only the two "reads no settings" cases pass), e.g. `AssertionError: expected undefined to be true`.

- [ ] **Step 11: Add the fields to the public catalogue**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 32), replace

```ts
import {
  MIN_BOOKING_NOTICE_MINUTES,
  isTooSoon,
  localDate,
} from '@/services/booking/booking-policy';
```

with

```ts
import {
  MIN_BOOKING_NOTICE_MINUTES,
  isTooSoon,
  localDate,
} from '@/services/booking/booking-policy';
import type { PaymentMethod } from '@/lib/wp-endpoint';
import {
  resolveClinicPaymentForDisplay,
  resolveClinicPaymentManyForDisplay,
} from '@/services/payments/clinic-payment.service';
import { rowPaymentForDisplay } from '@/services/payments/public-usd.service';
import {
  notInternational,
  type ClinicPaymentSettings,
  type PublicUsdView,
} from '@/services/payments/intl-pricing';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 47), replace

```ts
  postalCode: string | null;
  specialties: string[];
}

function toPublicClinic(c: WpClinic): PublicClinic {
```

with

```ts
  postalCode: string | null;
  specialties: string[];
  /** The stored International flag — the admin badge only. False when the read fails. */
  international: boolean;
  /** What a booking at this clinic may be paid with: `['xendit']` unless it takes USD. */
  paymentMethods: PaymentMethod[];
}

function toPublicClinic(c: WpClinic, payment: ClinicPaymentSettings): PublicClinic {
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 61), replace

```ts
    postalCode: c.postalCode,
    specialties: c.specialties,
  };
}

/** Active clinics only — an inactive one must not appear on a public booking page. */
export async function listPublicPractices(): Promise<PublicClinic[]> {
  const { items } = await listClinics({ page: 1, perPage: 100 });
  return items.map(toPublicClinic).sort((a, b) => a.name.localeCompare(b.name));
}
```

with

```ts
    postalCode: c.postalCode,
    specialties: c.specialties,
    international: payment.international,
    paymentMethods: [...payment.methods],
  };
}

/** Active clinics only — an inactive one must not appear on a public booking page. */
export async function listPublicPractices(): Promise<PublicClinic[]> {
  const { items } = await listClinics({ page: 1, perPage: 100 });
  // One settings read for the whole list; never throws (a failed read is Xendit only).
  const payment = await resolveClinicPaymentManyForDisplay(items.map((c) => Number(c.id)));
  return items
    .map((c) => toPublicClinic(c, payment.get(Number(c.id)) ?? notInternational(Number(c.id))))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 76), replace

```ts
  if (!clinic || !clinic.isActive) return null;
  return toPublicClinic(clinic);
}
```

with

```ts
  if (!clinic || !clinic.isActive) return null;
  return toPublicClinic(clinic, await resolveClinicPaymentForDisplay(id));
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 255), replace

```ts
export interface PublicService {
  id: number;
  name: string;
  price: string;
  durationMinutes: number | null;
  serviceType: string | null;
}
```

with

```ts
export interface PublicService {
  id: number;
  name: string;
  /** Rupiah, unchanged — the current FE keeps working. */
  price: string;
  durationMinutes: number | null;
  serviceType: string | null;
  /**
   * The clinic this row is offered at. A service id repeats across a professional's
   * clinics, so the booking must be submitted with this id for the charge to match the
   * USD shown here (spec §5).
   */
  clinicId: number;
  paymentMethods: PaymentMethod[];
  /** USD figures, only for an international clinic with a usable rate and a non-free row. */
  usd: PublicUsdView | null;
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-catalog.service.ts` (around line 285), replace

```ts
  return rows.map((s) => ({
    id: Number(s.serviceId),
    name: s.nameAlias ?? s.name,
    // The doctor's charge, not the catalogue list price — that is what a patient pays.
    price: s.charges ?? '0',
    durationMinutes: s.durationMinutes,
    serviceType: s.type,
  }));
}
```

with

```ts
  // One settings read for every clinic in the list. The USD quote per row is built by
  // the same computePublicAmount + buildUsdQuote that charges, so shown and charged match.
  const payment = await resolveClinicPaymentManyForDisplay(rows.map((s) => Number(s.clinicId)));

  // Sequential on purpose: a row of an international clinic runs a tax query, and the
  // MySQL user is capped at a handful of connections.
  const services: PublicService[] = [];
  for (const s of rows) {
    const clinicId = Number(s.clinicId);
    const name = s.nameAlias ?? s.name;
    // The doctor's charge, not the catalogue list price — that is what a patient pays.
    const price = s.charges ?? '0';
    const { paymentMethods, usd } = await rowPaymentForDisplay(
      { clinicId, doctorId: professionalId, serviceId: Number(s.serviceId), name, price },
      payment.get(clinicId) ?? notInternational(clinicId),
    );
    services.push({
      id: Number(s.serviceId),
      name,
      price,
      durationMinutes: s.durationMinutes,
      serviceType: s.type,
      clinicId,
      paymentMethods,
      usd,
    });
  }
  return services;
}
```

- [ ] **Step 12: Run it — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments/public-catalog-payment.test.ts
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 13: Write the failing public-booking tests**

`cancel.test.ts` pins the whole view with `toEqual`, so it gains the two fields there too.

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/create.test.ts` (around line 38), replace

```ts
vi.mock('@/repositories/wp/appointments.write', () => ({
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
```

with

```ts
vi.mock('@/repositories/wp/appointments.write', () => ({
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
}));
vi.mock('@/services/payments/public-usd.service', () => ({
  rowPaymentForDisplay: vi.fn(),
}));
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/create.test.ts` (around line 51), replace

```ts
import { createAppointment } from '@/repositories/wp/appointments.write';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
```

with

```ts
import { createAppointment } from '@/repositories/wp/appointments.write';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { resolveClinicPaymentForDisplay } from '@/services/payments/clinic-payment.service';
import { rowPaymentForDisplay } from '@/services/payments/public-usd.service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/create.test.ts` (around line 183), replace

```ts
beforeEach(() => {
  vi.clearAllMocks();
  primeHappyPath();
});
```

with

```ts
beforeEach(() => {
  vi.clearAllMocks();
  primeHappyPath();
  vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(notInternational(CLINIC));
  vi.mocked(rowPaymentForDisplay).mockResolvedValue({ paymentMethods: ['xendit'], usd: null });
});
```

Append to the end of `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/create.test.ts` (after the last line, separated by one blank line):

```ts
describe('createPublicAppointment — payment fields', () => {
  it('answers Xendit only and no USD for a clinic that is not international', async () => {
    const result = await createPublicAppointment({ ...INPUT, holdKey: makeHold() });

    expect(result.paymentMethods).toEqual(['xendit']);
    expect(result.usd).toBeNull();
  });

  it("prices the booked row like the charge: the booked clinic, the service and the doctor's own price", async () => {
    const settings: ClinicPaymentSettings = {
      ...notInternational(CLINIC),
      international: true,
      methods: ['xendit', 'paypal', 'card'],
    };
    const usd = { price: '21.39', taxes: [], fee: null, total: '21.39' };
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(settings);
    vi.mocked(rowPaymentForDisplay).mockResolvedValue({ paymentMethods: ['xendit', 'paypal', 'card'], usd });

    const result = await createPublicAppointment({ ...INPUT, holdKey: makeHold() });

    expect(resolveClinicPaymentForDisplay).toHaveBeenCalledWith(CLINIC);
    expect(rowPaymentForDisplay).toHaveBeenCalledWith(
      { clinicId: CLINIC, doctorId: DOCTOR, serviceId: SERVICE, name: 'Konseling Individu', price: '350000' },
      settings,
    );
    expect(result.paymentMethods).toEqual(['xendit', 'paypal', 'card']);
    expect(result.usd).toEqual(usd);
  });

  it('computes them only after the appointment is written', async () => {
    vi.mocked(createAppointment).mockRejectedValue(new WpEndpointError('/appointments failed 500: down', 500));

    await expect(createPublicAppointment({ ...INPUT, holdKey: makeHold() })).rejects.toBeInstanceOf(UpstreamWriteError);
    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
  });
});
```

Then in the cancel suite:

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (around line 18), replace

```ts
vi.mock('@/repositories/wp/appointments.write', () => ({
  cancelAppointment: vi.fn(),
  createAppointment: vi.fn(),
}));
```

with

```ts
vi.mock('@/repositories/wp/appointments.write', () => ({
  cancelAppointment: vi.fn(),
  createAppointment: vi.fn(),
}));
vi.mock('@/services/payments/clinic-payment.service', () => ({
  resolveClinicPaymentForDisplay: vi.fn(),
}));
vi.mock('@/services/payments/public-usd.service', () => ({
  rowPaymentForDisplay: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logging: {
    audit: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    system: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
  },
}));
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (around line 24), replace

```ts
import { findServiceById } from '@/repositories/wp/services.repo';
import { cancelAppointment } from '@/repositories/wp/appointments.write';
```

with

```ts
import { findServiceById, listServicesForDoctor } from '@/repositories/wp/services.repo';
import { cancelAppointment } from '@/repositories/wp/appointments.write';
import { resolveClinicPaymentForDisplay } from '@/services/payments/clinic-payment.service';
import { rowPaymentForDisplay } from '@/services/payments/public-usd.service';
import { notInternational, type ClinicPaymentSettings } from '@/services/payments/intl-pricing';
import { logging } from '@/lib/logging';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (around line 55), replace

```ts
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findServiceById).mockResolvedValue({ id: 7n, name: 'Consultation' } as never);
});
```

with

```ts
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findServiceById).mockResolvedValue({ id: 7n, name: 'Consultation' } as never);
  vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(notInternational(3));
});
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (around line 77), replace

```ts
      clientName: 'Jane Doe',
      clinicId: 3,
    });
  });
```

with

```ts
      clientName: 'Jane Doe',
      clinicId: 3,
      paymentMethods: ['xendit'],
      usd: null,
    });
  });
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/tests/public-booking/cancel.test.ts` (around line 100), replace

```ts
describe('cancelPublicAppointment', () => {
```

with

```ts
describe('public appointment view — payment fields', () => {
  const INTL: ClinicPaymentSettings = { ...notInternational(3), international: true, methods: ['xendit', 'paypal', 'card'] };

  it('runs no mapping or tax query for a clinic that cannot take PayPal', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(resolveClinicPaymentForDisplay).toHaveBeenCalledWith(3);
    expect(listServicesForDoctor).not.toHaveBeenCalled();
    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(view).toMatchObject({ paymentMethods: ['xendit'], usd: null });
  });

  it("prices an international booking from the doctor's own charge at the booked clinic", async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    vi.mocked(listServicesForDoctor).mockResolvedValue([
      { serviceId: 8n, name: 'Other', nameAlias: null, charges: '1' },
      { serviceId: 7n, name: 'Consultation', nameAlias: 'Konseling', charges: '350000' },
    ] as never);
    const usd = { price: '21.39', taxes: [], fee: null, total: '21.39' };
    vi.mocked(rowPaymentForDisplay).mockResolvedValue({ paymentMethods: ['xendit', 'paypal', 'card'], usd });

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(listServicesForDoctor).toHaveBeenCalledWith({ doctorId: 29n, clinicId: 3n });
    expect(rowPaymentForDisplay).toHaveBeenCalledWith(
      { clinicId: 3, doctorId: 29, serviceId: 7, name: 'Konseling', price: '350000' },
      INTL,
    );
    expect(view).toMatchObject({ paymentMethods: ['xendit', 'paypal', 'card'], usd });
  });

  it('offers Xendit only when the booked service is no longer mapped', async () => {
    vi.mocked(findSessionById).mockResolvedValue(row(SESSION_STATUS.PENDING));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    vi.mocked(listServicesForDoctor).mockResolvedValue([]);

    const view = await getPublicAppointmentById(APPOINTMENT);

    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(view).toMatchObject({ paymentMethods: ['xendit'], usd: null });
  });

  it('answers a cancel that went through with Xendit only, and logs, when the mapping read fails', async () => {
    vi.mocked(findSessionById)
      .mockResolvedValueOnce(row(SESSION_STATUS.PENDING))
      .mockResolvedValueOnce(row(SESSION_STATUS.CANCELLED));
    vi.mocked(resolveClinicPaymentForDisplay).mockResolvedValue(INTL);
    const dbDown = new Error('Too many connections');
    vi.mocked(listServicesForDoctor).mockRejectedValue(dbDown);

    const view = await cancelPublicAppointment(APPOINTMENT);

    expect(cancelAppointment).toHaveBeenCalledWith(APPOINTMENT);
    expect(view).toMatchObject({ status: 'CANCELLED', paymentMethods: ['xendit'], usd: null });
    expect(rowPaymentForDisplay).not.toHaveBeenCalled();
    expect(logging.error).toHaveBeenCalledWith('USD price unavailable — showing rupiah and Xendit only', dbDown, {
      resource: 'clinic',
      resourceId: '3',
      metadata: { doctorId: 29, serviceId: 7 },
    });
  });
});

describe('cancelPublicAppointment', () => {
```

- [ ] **Step 14: Run them — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/public-booking/create.test.ts tests/public-booking/cancel.test.ts
```

Expected: `Tests  7 failed | 37 passed (44)`: the two new create cases (`expected undefined to deeply equal [ 'xendit' ]`), "maps a row to the public view", and the four new view cases (three lookups and the cancel whose mapping read fails). ("computes them only after the appointment is written" already passes.)

- [ ] **Step 15: Add the fields to the public booking**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 19), replace

```ts
import { z } from 'zod';
import { WpConfigError, WpEndpointError } from '@/lib/wp-endpoint';
```

with

```ts
import { z } from 'zod';
import { logging } from '@/lib/logging';
import { WpConfigError, WpEndpointError, type PaymentMethod } from '@/lib/wp-endpoint';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 32), replace

```ts
import {
  SESSION_STATUS,
  type SessionStatus,
  findSessionById,
  fromKcStatus,
} from '@/repositories/wp/sessions.repo';
```

with

```ts
import {
  SESSION_STATUS,
  type SessionStatus,
  findSessionById,
  fromKcStatus,
} from '@/repositories/wp/sessions.repo';
import { resolveClinicPaymentForDisplay } from '@/services/payments/clinic-payment.service';
import { rowPaymentForDisplay, type RowPayment } from '@/services/payments/public-usd.service';
import { XENDIT_ONLY, type PublicUsdView } from '@/services/payments/intl-pricing';
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 174), replace

```ts
  clinicId: number;
  token: string;
}
```

with

```ts
  clinicId: number;
  /**
   * How this booking may be paid, and its USD figures (spec §3). Authoritative for the
   * success screen: computed from the booked clinic, service and the doctor's own price —
   * the numbers `initiatePublicPayment` charges. `usd` is null unless the clinic is
   * international with a usable rate and the booking is not free.
   */
  paymentMethods: PaymentMethod[];
  usd: PublicUsdView | null;
  token: string;
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 403), replace

```ts
  const professionalName =
    [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim() || doctor.displayName;

  return {
```

with

```ts
  const professionalName =
    [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim() || doctor.displayName;

  // Never throws: the appointment is already written, so a failed read shows rupiah and
  // Xendit only. A throw here would also make the route's withRetry book a second time.
  const { paymentMethods, usd } = await rowPaymentForDisplay(
    {
      clinicId,
      doctorId: input.professionalId,
      serviceId: input.serviceId,
      name: service.nameAlias ?? service.name,
      price: service.charges ?? '0',
    },
    await resolveClinicPaymentForDisplay(clinicId),
  );

  return {
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 413), replace

```ts
    clientName: input.clientName,
    clinicId,
    token: signAppointmentToken(created.id),
  };
```

with

```ts
    clientName: input.clientName,
    clinicId,
    paymentMethods,
    usd,
    token: signAppointmentToken(created.id),
  };
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 431), replace

```ts
  /** See CreatedAppointment.clinicId. */
  clinicId: number;
}
```

with

```ts
  /** See CreatedAppointment.clinicId. */
  clinicId: number;
  /** See CreatedAppointment.paymentMethods. */
  paymentMethods: PaymentMethod[];
  usd: PublicUsdView | null;
}
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 455), replace

```ts
async function toView(id: number): Promise<PublicAppointmentView | null> {
  const row = await findSessionById(id);
  if (!row) return null;
```

with

```ts
/**
 * `paymentMethods` + `usd` for an existing booking, priced exactly as
 * `initiatePublicPayment` prices it: the doctor's own charge for the booked service at
 * the booked clinic. A clinic that cannot take PayPal costs no mapping or tax query.
 */
async function bookingPayment(booking: {
  clinicId: number;
  professionalId: number;
  serviceIds: number[];
}): Promise<RowPayment> {
  const settings = await resolveClinicPaymentForDisplay(booking.clinicId);
  const serviceId = booking.serviceIds[0];
  if (!settings.methods.includes('paypal') || serviceId === undefined) {
    return { paymentMethods: [...XENDIT_ONLY], usd: null };
  }

  let offered: Awaited<ReturnType<typeof listServicesForDoctor>>;
  try {
    offered = await listServicesForDoctor({
      doctorId: BigInt(booking.professionalId),
      clinicId: BigInt(booking.clinicId),
    });
  } catch (err) {
    // Display only, like rowPaymentForDisplay: a cancel has already gone through the
    // plugin by the time toView runs, so a failed read must not answer it with a 500.
    await logging.error('USD price unavailable — showing rupiah and Xendit only', err, {
      resource: 'clinic',
      resourceId: String(booking.clinicId),
      metadata: { doctorId: booking.professionalId, serviceId },
    });
    return { paymentMethods: [...XENDIT_ONLY], usd: null };
  }
  const mapping = offered.find((s) => Number(s.serviceId) === serviceId);
  if (!mapping) return { paymentMethods: [...XENDIT_ONLY], usd: null };

  return rowPaymentForDisplay(
    {
      clinicId: booking.clinicId,
      doctorId: booking.professionalId,
      serviceId,
      name: mapping.nameAlias ?? mapping.name,
      price: mapping.charges ?? '0',
    },
    settings,
  );
}

async function toView(id: number): Promise<PublicAppointmentView | null> {
  const row = await findSessionById(id);
  if (!row) return null;
  const { paymentMethods, usd } = await bookingPayment(row);
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/src/services/public/public-booking.service.ts` (around line 466), replace

```ts
    clientName: row.clientName,
    clinicId: row.clinicId,
  };
}
```

with

```ts
    clientName: row.clientName,
    clinicId: row.clinicId,
    paymentMethods,
    usd,
  };
}
```

- [ ] **Step 16: Run them — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/public-booking/create.test.ts tests/public-booking/cancel.test.ts
```

Expected: `Test Files  2 passed (2)`, `Tests  44 passed (44)`.

- [ ] **Step 17: Regression run and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments tests/public-booking tests/unit/public tests/integration/public tests/complete-in-progress/practices.test.ts tests/billing/practice-scope.test.ts tests/billing/practice-holidays-handle-error.test.ts tests/integration/practice 2>&1 | /usr/bin/grep -E '^ +(✓|❯) tests|Test Files|^ +Tests '; npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `tsc exit=0`, and `Test Files  10 failed | 29 passed (39)`, `Tests  59 failed | 502 passed | 23 skipped (584)`. The 10 failing/skipped files are exactly the ones that need a test database, which this worktree does not have (`prisma:error … Environment variable not found: DATABASE_URL`) — they fail the same way before this task: `tests/unit/public/public-slots.test.ts`, `tests/unit/public/public-slots-range.test.ts`, `tests/public-booking/retry-through-service.test.ts`, `tests/integration/public/google-calendar-connection.test.ts`, `tests/integration/public/google-busy-cache.test.ts`, `tests/integration/public/booking-idempotency.test.ts`, `tests/integration/practice/practice-wp.test.ts`, `tests/integration/practice/practice-list-scope.test.ts`, `tests/complete-in-progress/practices.test.ts`, `tests/billing/practice-scope.test.ts`. Every `tests/payments/*` and every other listed file must show ✓. Do not create `.env.test.local` and never point a test at `DATABASE_URL` (it is the live WordPress database).

- [ ] **Step 18: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add src/services/payments/public-usd.service.ts src/types/practice.ts src/services/practice/service.ts src/services/public/public-catalog.service.ts src/services/public/public-booking.service.ts tests/payments/public-usd.service.test.ts tests/payments/practice-international.test.ts tests/payments/public-catalog-payment.test.ts tests/public-booking/create.test.ts tests/public-booking/cancel.test.ts && git commit -F - <<'EOF'
feat(api): field international, paymentMethods dan usd di practices, katalog dan booking publik

PracticeDTO.international dan PublicClinic.international/paymentMethods
dari satu kali baca pengaturan per halaman. Baris layanan publik membawa
clinicId, paymentMethods dan usd yang dihitung dengan computePublicAmount
+ buildUsdQuote yang sama dengan penagihan. Respons submit booking dan
GET /public/appointments/{token} ikut membawa paymentMethods dan usd.
Semua field hanya tampilan: gagal baca = rupiah + Xendit saja, tidak
pernah 500, dan tidak pernah membuat withRetry memesan dua kali.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds, and `git status --short` lists no file this task touched (an untracked planning folder such as `.plan-wip/` may show; leave it alone). Never use `git add -A` / `git add .`: the `node_modules` symlink from Task B0 must stay out of git.

### Task B9: Dokumentasi — OpenAPI Next.js, rute plugin di OpenAPI root, dua panduan FE, runbook deploy

**Files:**
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (the Next.js `/api/v1` contract: `practices` tag count; `GET /api/v1/practices`; `GET`/`PATCH /api/v1/practices/{id}`; new path above `/api/v1/practices/{id}/resend-credentials`; `POST /api/v1/public/appointments` + `GET /api/v1/public/appointments/{token}`; `GET /api/v1/public/practices` + `/{id}`; `GET /api/v1/public/professionals/{id}/services`; new component schemas above `UploadValidationProblem`). The payment routes' new error responses were already added in Task B4 — do not touch them again.
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/openapi.yaml` (the KiviCare/plugin spec: ONLY the new plugin route `/praktiqu/v1/clinics/{id}/payment-settings`, above `/praktiqu/v1/health`, and its two schemas)
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PAYMENT-METHODS-GUIDE.md`
- Modify: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md`
- Create: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/deploy/international-clinic-runbook.md` (spec §8: pre-deploy read-only checks, deploy order, sandbox E2E with the UNILATERAL webhook replay, enabling clinics, removing the legacy path, rollback)

**Interfaces:** Consumes: the shapes produced by Tasks B6–B8 (`PaymentSettingsInput`, `PaymentSettingsView`, `PublicUsdView`, `PracticeDTO.international`, `PublicClinic`, `PublicService`, `CreatedAppointment`, `PublicAppointmentView`), the error codes of Task B7's route, the plugin route of Task A2 (`GET`/`PUT /praktiqu/v1/clinics/{id}/payment-settings`: 200 `{ clinicId, settings }`, errors `clinic_not_found` 404, `invalid_settings` 400, `fx_rate_required` 422, `save_failed` 500). / Produces: documentation only; no code, no test file. The FE tasks (C1–C4) read the JSON shapes from these docs.

The "test" for documentation is a check that fails before the edits and passes after: it loads both YAML files with `js-yaml`, requires the new path, schemas and plugin route, resolves every `$ref`, and runs `oas-validator` (already in `node_modules`) over the paths this task touches.

- [ ] **Step 1: Run the docs check — expect FAIL**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && /usr/bin/grep -q '^## International clinics only' docs/api/PAYMENT-METHODS-GUIDE.md && /usr/bin/grep -q '^## Errors' docs/api/PAYMENT-METHODS-GUIDE.md && /usr/bin/grep -q '^### 4.16 ' docs/api/PRACTICES-AND-SERVICES-GUIDE.md && /usr/bin/grep -q 'UNILATERAL' docs/deploy/international-clinic-runbook.md && echo GUIDES OK || echo GUIDES MISSING; node -e "
const y=require('js-yaml'),fs=require('fs'),v=require('oas-validator');
const d=y.load(fs.readFileSync('docs/api/openapi.yaml','utf8'));
const r=y.load(fs.readFileSync('openapi.yaml','utf8'));
const must=(ok,what)=>{if(!ok){console.error('MISSING: '+what);process.exitCode=1}};
const ps=d.paths['/api/v1/practices/{id}/payment-settings'];
must(ps&&ps.get&&ps.put,'GET/PUT /api/v1/practices/{id}/payment-settings');
for(const s of ['PaymentMethod','PublicUsdView','PaymentSettingsInput','PaymentSettingsView','FieldsProblem','Practice','PublicClinic','PublicService','PublicAppointmentView','CreatedAppointment'])must(d.components.schemas[s],'schema '+s);
must(d.components.schemas.Practice&&d.components.schemas.Practice.properties.international,'Practice.international');
must(d.components.schemas.PublicService&&d.components.schemas.PublicService.properties.usd,'PublicService.usd');
must(r.paths['/praktiqu/v1/clinics/{id}/payment-settings'],'plugin route in the root openapi.yaml');
const refs=[];(function w(o){if(o&&typeof o==='object')for(const[k,x]of Object.entries(o)){if(k==='\$ref')refs.push(x);else w(x)}})(d);
for(const ref of refs){let c=d;for(const p of ref.slice(2).split('/'))c=c&&c[p];must(c,'unresolved '+ref)}
const keep=['/api/v1/practices','/api/v1/practices/{id}','/api/v1/practices/{id}/payment-settings','/api/v1/public/appointments','/api/v1/public/appointments/{token}','/api/v1/public/practices','/api/v1/public/practices/{id}','/api/v1/public/professionals/{id}/services'].filter(k=>d.paths[k]);
v.validate({...d,paths:Object.fromEntries(keep.map(k=>[k,d.paths[k]]))},{lint:false,resolve:false,laxurls:true})
 .then(()=>console.log(process.exitCode?'CHECK FAILED':'CHECK OK'))
 .catch(e=>{console.error('INVALID OpenAPI: '+e.message);console.log('CHECK FAILED');process.exitCode=1});
"
```

Expected: `GUIDES MISSING`, then one `MISSING: …` line per new path/schema (`GET/PUT /api/v1/practices/{id}/payment-settings`, `schema PaymentMethod` … `schema CreatedAppointment`, `Practice.international`, `PublicService.usd`, `plugin route in the root openapi.yaml`) and `CHECK FAILED`.

- [ ] **Step 2: Update the Next.js OpenAPI (`docs/api/openapi.yaml`)**

Apply these eight replacements in order. Indentation is significant (YAML): copy the blocks exactly.

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 72), replace

```yaml
  - name: practices
    description: Practices endpoints (17 operations)
```

with

```yaml
  - name: practices
    description: Practices endpoints (19 operations)
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 6851), replace

```yaml
      operationId: get_api_v1_practices
      description: |-
        **Response envelope:** standard / RFC-7807 problem+json

        _May return 501 (stub / not wired)._
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: string
        - name: page
          in: query
          required: false
          schema:
            type: string
        - name: status
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
```

with

```yaml
      operationId: get_api_v1_practices
      description: |-
        **Response envelope:** standard / RFC-7807 problem+json

        _May return 501 (stub / not wired)._
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: string
        - name: page
          in: query
          required: false
          schema:
            type: string
        - name: status
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Practice'
                  total:
                    type: integer
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 6944), replace

```yaml
    get:
      tags:
        - practices
      summary: Get practices by id
      operationId: get_api_v1_practices_id
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
        '404':
          $ref: '#/components/responses/NotFound'
      security: []
    patch:
      tags:
        - practices
      summary: Update practices by id
      operationId: patch_api_v1_practices_id
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
```

with

```yaml
    get:
      tags:
        - practices
      summary: Get practices by id
      operationId: get_api_v1_practices_id
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PracticeResult'
        '404':
          $ref: '#/components/responses/NotFound'
      security: []
    patch:
      tags:
        - practices
      summary: Update practices by id
      operationId: patch_api_v1_practices_id
      description: >-
        **Response envelope:** standard / RFC-7807 problem+json


        `international` is read only here: it is changed through
        `PUT /api/v1/practices/{id}/payment-settings`.
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PracticeResult'
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 7089), replace

```yaml
  /api/v1/practices/{id}/resend-credentials:
```

with

```yaml
  /api/v1/practices/{id}/payment-settings:
    parameters:
      - name: id
        in: path
        required: true
        description: KiviCare clinic id (`wp_kc_clinics.id`).
        schema:
          type: integer
    get:
      tags:
        - practices
      summary: Get a clinic's international payment settings
      operationId: get_api_v1_practices_id_payment_settings
      description: >-
        `SUPER_ADMIN` for any clinic; `CLINIC_ADMIN` for their own clinic only (any other clinic is a 404);
        every other role is a 403. An id with no `wp_kc_clinics` row is a 404.


        `stored` is the clinic's own values (`international: false` and every other field null when nothing
        is stored). `effective` is what a payment would use, with where each value came from, whatever the
        flag. `example` converts Rp 200,000 with the effective values whenever a usable rate exists, even
        before the clinic is flagged, so the form can preview the price; otherwise it is null.


        **Response envelope:** `{ data: PaymentSettingsView }` / RFC-7807 problem+json.
      responses:
        '200':
          description: The clinic's settings
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentSettingsResult'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          description: '`practice_not_found` — no such clinic, or another clinic than a CLINIC_ADMIN''s own'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '503':
          description: '`payment_settings_unavailable` — the settings could not be read; retry'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
    put:
      tags:
        - practices
      summary: Replace a clinic's international payment settings
      operationId: put_api_v1_practices_id_payment_settings
      description: >-
        Same access rules as GET. Replaces the clinic's whole settings object: every key is required, and
        `null` means "use the global value" for `fxRate` / `markupPercent` and "no fee" for `fixedFeeIdr`.
        `international: true` needs a usable rate (1,000–100,000 rupiah per 1 USD) from the clinic or from
        the global WordPress option. The save goes through the praktiqu-endpoint plugin
        (`PUT /praktiqu/v1/clinics/{id}/payment-settings`) with `updated_by` set from the caller's WordPress
        link, is audited as `clinic.payment_settings.updated`, and is answered by re-reading the stored
        option.


        **Response envelope:** `{ data: PaymentSettingsView }` / RFC-7807 problem+json.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PaymentSettingsInput'
            example:
              international: true
              fxRate: 18000
              markupPercent: 10
              fixedFeeIdr: 25000
      responses:
        '200':
          description: Saved; the settings as read back from storage
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentSettingsResult'
        '400':
          description: '`invalid_json` — the body is not JSON'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          description: '`practice_not_found` — no such clinic, or another clinic than a CLINIC_ADMIN''s own'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '422':
          description: >-
            `invalid_input` — the body failed validation; `fields` maps each field (or `body`, for an unknown
            key or a body that is not an object) to its messages. Also when WordPress's own validation
            refuses the settings: then `fields.body` is `["WordPress rejected the settings"]` and retrying
            the same body fails the same way. `fx_rate_required` — `international: true` with no usable rate
            from the clinic or the global option; `fields.fxRate` says so.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/FieldsProblem'
        '500':
          description: '`internal_error` — an unexpected failure; logged'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '502':
          description: '`payment_settings_save_failed` — WordPress failed the save; nothing was audited'
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
        '503':
          description: >-
            `payment_settings_unavailable` — the settings could not be read. On PUT this can also come from the
            read-back AFTER a save that went through, so GET the settings again before retrying.
          content:
            application/problem+json:
              schema:
                $ref: '#/components/schemas/Problem'
  /api/v1/practices/{id}/resend-credentials:
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 8693), replace

```yaml
                clinicId:
                  type: integer
                  minimum: 1
                  description: Optional. Which of the professional's clinics to book into.
      responses:
        '201':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
        '422':
          $ref: '#/components/responses/ValidationError'
      security: []
  /api/v1/public/appointments/{token}:
    parameters:
      - name: token
        in: path
        required: true
        schema:
          type: string
    get:
      tags:
        - public
      summary: '{Token} (GET) — public'
      operationId: get_api_v1_public_appointments_token
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
```

with

```yaml
                clinicId:
                  type: integer
                  minimum: 1
                  description: >-
                    Optional. Which of the professional's clinics to book into. Send the selected service
                    row's `clinicId`: the USD shown for that row is only what is charged when the booking
                    lands in that clinic.
      responses:
        '201':
          description: >-
            Booked. `paymentMethods` and `usd` are authoritative for the success screen: offer only those
            methods. A replay with the same `Idempotency-Key` answers 200 with the same shape.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/CreatedAppointment'
        '422':
          $ref: '#/components/responses/ValidationError'
      security: []
  /api/v1/public/appointments/{token}:
    parameters:
      - name: token
        in: path
        required: true
        schema:
          type: string
    get:
      tags:
        - public
      summary: '{Token} (GET) — public'
      operationId: get_api_v1_public_appointments_token
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/PublicAppointmentView'
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 8999), replace

```yaml
      operationId: get_api_v1_public_practices
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
      security: []
  /api/v1/public/practices/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: KiviCare clinic id (`wp_kc_clinics.id`).
        schema:
          type: integer
    get:
      tags:
        - public
      summary: Get practices by id
      operationId: get_api_v1_public_practices_id
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
```

with

```yaml
      operationId: get_api_v1_public_practices
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/PublicClinic'
      security: []
  /api/v1/public/practices/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: KiviCare clinic id (`wp_kc_clinics.id`).
        schema:
          type: integer
    get:
      tags:
        - public
      summary: Get practices by id
      operationId: get_api_v1_public_practices_id
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/PublicClinic'
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 9145), replace

```yaml
      operationId: get_api_v1_public_professionals_id_services
      description: '**Response envelope:** standard / RFC-7807 problem+json'
      parameters:
        - name: clinicId
          in: query
          required: false
          description: Only the services this professional offers at this clinic.
          schema:
            type: integer
            minimum: 1
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StandardResponse'
```

with

```yaml
      operationId: get_api_v1_public_professionals_id_services
      description: >-
        **Response envelope:** standard / RFC-7807 problem+json


        One row per doctor↔service mapping, so a service the professional offers at two clinics appears
        twice, once per `clinicId`. Each row's `usd` comes from the same computation that charges, so it is
        what PayPal and card charge — provided the booking is submitted with that row's `clinicId`.
      parameters:
        - name: clinicId
          in: query
          required: false
          description: Only the services this professional offers at this clinic.
          schema:
            type: integer
            minimum: 1
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/PublicService'
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/openapi.yaml` (around line 12961), replace

```yaml
    UploadValidationProblem:
```

with

```yaml
    PaymentMethod:
      type: string
      enum:
        - xendit
        - paypal
        - card
    PublicUsdView:
      type: object
      description: >-
        USD figures of one row or booking, from the same function that builds the charge. Every amount is a
        2-decimal string. Show these as they are; never convert rupiah in the client.
      properties:
        price:
          type: string
          pattern: '^\d+\.\d{2}$'
          example: '12.23'
          description: The service line, markup included.
        taxes:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              amount:
                type: string
                pattern: '^\d+\.\d{2}$'
            required:
              - name
              - amount
        fee:
          type: string
          nullable: true
          pattern: '^\d+\.\d{2}$'
          example: '1.39'
          description: The "International service fee" line (no markup); null when the clinic has no fixed fee.
        total:
          type: string
          pattern: '^\d+\.\d{2}$'
          example: '13.62'
      required:
        - price
        - taxes
        - fee
        - total
    PaymentSettingsInput:
      type: object
      additionalProperties: false
      description: >-
        A clinic's international payment settings. Every key is required (a PUT replaces the whole object).
      properties:
        international:
          type: boolean
          description: Accept PayPal and card, charged in USD.
        fxRate:
          type: number
          nullable: true
          minimum: 1000
          maximum: 100000
          multipleOf: 0.01
          description: Rupiah per 1 USD. null = use the global rate.
        markupPercent:
          type: number
          nullable: true
          minimum: 0
          maximum: 100
          multipleOf: 0.01
          description: Added to every item and tax line. null = use the global markup (else 0).
        fixedFeeIdr:
          type: integer
          nullable: true
          minimum: 0
          maximum: 10000000
          description: >-
            One "International service fee" line per USD order, in rupiah converted at the rate, without the
            markup. null or 0 = no fee.
      required:
        - international
        - fxRate
        - markupPercent
        - fixedFeeIdr
    PaymentSettingsView:
      type: object
      properties:
        clinicId:
          type: integer
        stored:
          $ref: '#/components/schemas/PaymentSettingsInput'
        effective:
          type: object
          description: What a payment would use now, resolved whatever the flag. Decimals are strings.
          properties:
            international:
              type: boolean
            methods:
              type: array
              items:
                $ref: '#/components/schemas/PaymentMethod'
            fxRate:
              type: string
              nullable: true
              description: null when neither the clinic nor the global option has a usable rate.
            markupPercent:
              type: string
            fixedFeeIdr:
              type: string
            source:
              type: object
              properties:
                fxRate:
                  type: string
                  nullable: true
                  enum:
                    - clinic
                    - global
                    - default
                    - null
                markupPercent:
                  type: string
                  enum:
                    - clinic
                    - global
                    - default
                fixedFeeIdr:
                  type: string
                  enum:
                    - clinic
                    - global
                    - default
        globalDefaults:
          type: object
          description: The global WordPress rate and markup, for form placeholders.
          properties:
            fxRate:
              type: number
              nullable: true
            markupPercent:
              type: number
              nullable: true
        example:
          type: object
          nullable: true
          description: Rp 200,000 converted with the effective values; null when no usable rate exists.
          allOf:
            - $ref: '#/components/schemas/PublicUsdView'
            - type: object
              properties:
                idr:
                  type: integer
                  example: 200000
        updatedAt:
          type: string
          nullable: true
          format: date-time
        updatedBy:
          type: object
          nullable: true
          properties:
            wpUserId:
              type: integer
            name:
              type: string
      required:
        - clinicId
        - stored
        - effective
        - globalDefaults
        - example
        - updatedAt
        - updatedBy
    PaymentSettingsResult:
      type: object
      properties:
        data:
          $ref: '#/components/schemas/PaymentSettingsView'
      required:
        - data
    FieldsProblem:
      allOf:
        - $ref: '#/components/schemas/Problem'
        - type: object
          properties:
            fields:
              type: object
              additionalProperties:
                type: array
                items:
                  type: string
              description: Messages per field; `body` holds an issue that has no field.
    Practice:
      type: object
      description: A practice is a KiviCare clinic (`wp_kc_clinics`).
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
          nullable: true
        telephoneNo:
          type: string
          nullable: true
        address:
          type: string
          nullable: true
        city:
          type: string
          nullable: true
        state:
          type: string
          nullable: true
        country:
          type: string
          nullable: true
        postalCode:
          type: string
          nullable: true
        countryCode:
          type: string
          nullable: true
        countryCallingCode:
          type: string
          nullable: true
        timezone:
          type: string
          nullable: true
        logoUrl:
          type: string
          nullable: true
        status:
          type: integer
          enum:
            - 0
            - 1
        businessHours:
          type: array
          items:
            type: object
        international:
          type: boolean
          description: >-
            The stored International flag, read only (see `/api/v1/practices/{id}/payment-settings`). For the
            admin badge; false when the settings cannot be read.
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    PracticeResult:
      type: object
      properties:
        data:
          $ref: '#/components/schemas/Practice'
    PublicClinic:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
          nullable: true
        telephoneNo:
          type: string
          nullable: true
        address:
          type: string
          nullable: true
        city:
          type: string
          nullable: true
        state:
          type: string
          nullable: true
        country:
          type: string
          nullable: true
        postalCode:
          type: string
          nullable: true
        specialties:
          type: array
          items:
            type: string
        international:
          type: boolean
          description: The stored flag — for a badge only. Decide methods and USD display from `paymentMethods` / `usd`.
        paymentMethods:
          type: array
          items:
            $ref: '#/components/schemas/PaymentMethod'
          description: '`[xendit]` unless the clinic is international with a usable rate.'
    PublicService:
      type: object
      properties:
        id:
          type: integer
          description: The KiviCare service id (repeats across a professional's clinics).
        name:
          type: string
        price:
          type: string
          description: Rupiah — the doctor's charge for this service at this clinic.
        durationMinutes:
          type: integer
          nullable: true
        serviceType:
          type: string
          nullable: true
        clinicId:
          type: integer
          description: The clinic this row is offered at. Submit the booking with it.
        paymentMethods:
          type: array
          items:
            $ref: '#/components/schemas/PaymentMethod'
        usd:
          type: object
          nullable: true
          description: >-
            Set only when the clinic is international, a usable rate exists and the row's rupiah total is
            above 0. Show USD as the main figure then, with `price` in rupiah underneath.
          allOf:
            - $ref: '#/components/schemas/PublicUsdView'
    PublicAppointmentView:
      type: object
      properties:
        id:
          type: integer
        status:
          type: string
        date:
          type: string
        startTime:
          type: string
        service:
          type: string
        professionalName:
          type: string
        clientName:
          type: string
        clinicId:
          type: integer
        paymentMethods:
          type: array
          items:
            $ref: '#/components/schemas/PaymentMethod'
          description: The methods this booking may be paid with. Authoritative — offer only these.
        usd:
          type: object
          nullable: true
          description: The booking's USD figures, priced like the charge; null unless USD is offered.
          allOf:
            - $ref: '#/components/schemas/PublicUsdView'
    CreatedAppointment:
      allOf:
        - $ref: '#/components/schemas/PublicAppointmentView'
        - type: object
          properties:
            token:
              type: string
              description: Signed appointment token for `/public/payments` and `/public/appointments/{token}`.
    UploadValidationProblem:
```

- [ ] **Step 3: Add the plugin route to the root `openapi.yaml`**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/openapi.yaml` (around line 12407), replace

```yaml
  /praktiqu/v1/health:
```

with

```yaml
  /praktiqu/v1/clinics/{id}/payment-settings:
    get:
      tags:
      - praktiqu
      summary: GET /praktiqu/v1/clinics/{id}/payment-settings
      operationId: get_praktiqu_v1_clinics_id_payment_settings
      description: >-
        Diagnostics only — Next.js reads the option straight from `wp_options`. Answers the decoded
        `praktiqu_endpoint_clinic_{id}_payment` option (snake_case storage keys), or `settings: null` when it is
        missing or not a JSON object.
      responses:
        '200':
          description: The stored settings
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ClinicPaymentSettingsResponse'
        '401':
          $ref: '#/components/responses/Error'
        '403':
          $ref: '#/components/responses/Error'
      security:
      - serviceToken: []
      parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    put:
      tags:
      - praktiqu
      summary: PUT /praktiqu/v1/clinics/{id}/payment-settings
      operationId: put_praktiqu_v1_clinics_id_payment_settings
      description: >-
        Called by Next.js (`PUT /api/v1/practices/{id}/payment-settings`), never by a browser. Re-validates every
        field (rate 1,000–100,000 with at most 2 decimals, markup 0–100 with at most 2 decimals, fee an integer
        0–10,000,000, `updated_by` a positive integer or null) and requires a usable rate — the clinic's or the
        global `praktiqu_endpoint_paypal_idr_rate` — when `international` is true. Stores the whole object as a
        JSON string (`update_option(..., wp_json_encode($data), false)`, autoload off), stamps `updated_at`
        itself, and treats an identical re-save as success.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              description: Every key is required. Other keys are ignored.
              properties:
                international:
                  type: boolean
                fx_rate:
                  type: number
                  nullable: true
                markup_percent:
                  type: number
                  nullable: true
                fixed_fee_idr:
                  type: integer
                  nullable: true
                updated_by:
                  type: integer
                  nullable: true
                  description: '`wp_users.ID` of the editor, as sent by Next.js; null when the editor has no WordPress link.'
              required:
              - international
              - fx_rate
              - markup_percent
              - fixed_fee_idr
              - updated_by
            example:
              international: true
              fx_rate: 18000
              markup_percent: 10
              fixed_fee_idr: 25000
              updated_by: 123
      responses:
        '200':
          description: Saved; same shape as GET
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ClinicPaymentSettingsResponse'
        '400':
          description: '`invalid_settings` — a field failed validation'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WpRestError'
        '401':
          $ref: '#/components/responses/Error'
        '403':
          $ref: '#/components/responses/Error'
        '404':
          description: '`clinic_not_found` — no `wp_kc_clinics` row with that id'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WpRestError'
        '422':
          description: '`fx_rate_required` — `international` is true and neither the clinic nor the global option has a usable rate'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WpRestError'
        '500':
          description: '`save_failed` — `update_option` failed and the stored value differs'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WpRestError'
      security:
      - serviceToken: []
      parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
  /praktiqu/v1/health:
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/openapi.yaml` (around line 12661), replace

```yaml
  schemas:
    Envelope:
```

with

```yaml
  schemas:
    ClinicPaymentSettingsResponse:
      type: object
      properties:
        clinicId:
          type: integer
          example: 4
        settings:
          type: object
          nullable: true
          description: The stored option, decoded. null when there is none.
          properties:
            international:
              type: boolean
            fx_rate:
              type: number
              nullable: true
            markup_percent:
              type: number
              nullable: true
            fixed_fee_idr:
              type: integer
              nullable: true
            updated_at:
              type: string
              format: date-time
            updated_by:
              type: integer
              nullable: true
      required:
      - clinicId
      - settings
    WpRestError:
      type: object
      description: A WordPress REST error (`WP_Error`).
      properties:
        code:
          type: string
        message:
          type: string
        data:
          type: object
          properties:
            status:
              type: integer
    Envelope:
```

- [ ] **Step 4: Update `PAYMENT-METHODS-GUIDE.md`**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PAYMENT-METHODS-GUIDE.md` (around line 3), replace

```markdown
**Backend:** plugin 1.5.0 + app from 2026-09-01.
**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`
```

with

```markdown
**Backend:** plugin 1.5.0 + app from 2026-09-01. Per-clinic gate: plugin 1.7.0 + app from 2026-10.
**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`,
`docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md`
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PAYMENT-METHODS-GUIDE.md` (around line 24), replace

```markdown
are unavailable, not merely unbuilt — do not design UI that assumes them.
```

with

````markdown
are unavailable, not merely unbuilt — do not design UI that assumes them.

## International clinics only (plugin 1.7.0)

`paypal` and `card` are accepted **only for a clinic flagged International**. Every other
clinic takes `xendit` only. The backend enforces this; the FE only hides the buttons.

Each international clinic has its own rate (rupiah per 1 USD), percentage markup and fixed
rupiah fee, edited through `GET`/`PUT /api/v1/practices/{id}/payment-settings` (see
[`PRACTICES-AND-SERVICES-GUIDE.md`](PRACTICES-AND-SERVICES-GUIDE.md) §4.16). Xendit is
unchanged for every clinic: rupiah, no markup, no fee.

**Where the FE reads what to offer.** Never decide from a clinic's `international` flag
(it is for an admin badge) — use these fields:

| Response | Fields | Use them for |
| --- | --- | --- |
| `GET /public/professionals/{id}/services`, each row | `clinicId`, `paymentMethods`, `usd` | the price shown and the method picker |
| `POST /public/appointments` (201, and the 200 idempotent replay) | `paymentMethods`, `usd` | the success screen's pay buttons — authoritative |
| `GET /public/appointments/{token}` | `paymentMethods`, `usd` | the same, after a reload |
| `GET /public/practices`, `GET /public/practices/{id}` | `paymentMethods` | the clinic page |

A missing `paymentMethods` (an older backend) means `["xendit"]`. If the method the patient
picked earlier is not in the booking's `paymentMethods`, reset it before calling pay.

`usd` is `null` or:

```json
{ "price": "12.23", "taxes": [{ "name": "PPN", "amount": "1.35" }], "fee": "1.39", "total": "14.97" }
```

- Every amount is a 2-decimal string. `fee` is the "International service fee" line, `null`
  when the clinic has no fixed fee.
- `usd` is set only when the clinic is international, a usable rate exists and the row costs
  more than Rp 0.
- When it is set, show the USD figure as the main price with the rupiah `price` small
  underneath. For PayPal or card the summary shows these lines; for Xendit it shows rupiah.
- **Never convert currency in the FE.** Every USD figure comes from the backend, computed by
  the same function that builds the charge. If the rate changes between display and payment,
  the patient pays at the new rate; the final amount is always the one on PayPal's own page.

**Book into the row's clinic.** A service id repeats across a professional's clinics. Send the
selected row's `clinicId` in `POST /public/appointments` and to `/public/booking/slots`;
otherwise the booking can land in another clinic and be charged differently from what was shown.

Worked example (rate 18,000, markup 10 %, fee Rp 25,000, service Rp 200,000): the service is
`ceil(200000 × 110 / 18000)` = 1,223 cents → `12.23`, the fee `ceil(25000 × 100 / 18000)` =
139 cents → `1.39`, total `13.62`.
````

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PAYMENT-METHODS-GUIDE.md` (around line 66), replace

```markdown
## Displaying the amount — please read
```

with

```markdown
## Errors

Both payment routes answer coded `problem+json` (`{ type, title, status, code, detail }`).
Branch on `code`, never on the status alone:

| Status | `code` | Meaning | Show the patient |
| --- | --- | --- | --- |
| 403 | `payment_method_not_allowed` | `paypal`/`card` on a clinic that is not international, or on a free booking | "Metode ini tidak tersedia untuk klinik ini", then the valid methods |
| 503 | `paypal_rate_missing` | International clinic with no usable rate | "PayPal sementara tidak tersedia, silakan pakai Xendit" |
| 503 | `payment_method_unavailable` | The PayPal gateway is not available in WooCommerce | same as above |
| 503 | `payment_settings_unavailable` | The clinic settings could not be read — retryable | a retry message |
| 503 | `payment_unavailable` | WordPress/WooCommerce unreachable — retryable | a retry message |
| 502 | `charge_mismatch` | The order total differed from the quote; no order was kept | a retry message |
| 502 | `payment_start_failed`, `payment_gateway_rejected` | Any other failure while starting the payment | a retry message |
| 422 | `discount_not_supported` | Staff route only: `paypal`/`card` on a bill with a discount | pay that bill with Xendit |

None of these is a 409, so the existing 409 branches (`payment_already_initiated`,
`appointment_not_pending`) are unaffected. The 503 configuration codes
(`paypal_rate_missing`, `payment_method_unavailable`) carry no `Retry-After`.

## Displaying the amount — please read
```

- [ ] **Step 5: Update `PRACTICES-AND-SERVICES-GUIDE.md`**

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 72), replace

```markdown
| `/practices/{id}/holidays` | ✅ | ✅ | ❌ | ❌ |
```

with

```markdown
| `/practices/{id}/holidays` | ✅ | ✅ | ❌ | ❌ |
| `GET/PUT /practices/{id}/payment-settings` | ✅ | 🔸 kliniknya sendiri | ❌ | ❌ |
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 125), replace

```markdown
      ],
      "createdAt": "2026-01-10T03:00:00.000Z",
```

with

```markdown
      ],
      "international": false,
      "createdAt": "2026-01-10T03:00:00.000Z",
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 145), replace

```markdown
- `updatedAt` selalu sama dengan `createdAt`. `wp_kc_clinics` tidak punya kolom
  `updated_at`, dan ini sengaja tidak dikarang.
```

with

```markdown
- `updatedAt` selalu sama dengan `createdAt`. `wp_kc_clinics` tidak punya kolom
  `updated_at`, dan ini sengaja tidak dikarang.
- `international` (read only) adalah flag Klinik Internasional yang tersimpan — untuk
  badge admin saja. Diubah lewat §4.16, bukan lewat PATCH. Nilainya `false` kalau
  pengaturannya gagal dibaca. Field ini juga ada di §4.3, jawaban §4.4, dan §4.15.
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 340), replace

```markdown
hasilnya — dan di sini filternya benar-benar bekerja dua arah, beda dengan §4.1.

---
```

with

````markdown
hasilnya — dan di sini filternya benar-benar bekerja dua arah, beda dengan §4.1.

### 4.16 `GET` / `PUT /api/v1/practices/{id}/payment-settings` — pembayaran internasional

Pengaturan **Klinik Internasional**: klinik yang ditandai menerima PayPal & kartu (USD),
dengan kurs, markup persen, dan fee flat rupiah miliknya sendiri. Klinik lain hanya Xendit.

- **Akses:** SUPER_ADMIN untuk klinik mana pun; CLINIC_ADMIN hanya kliniknya sendiri
  (klinik lain → **404**, bukan 403); role lain → **403**. Id yang tidak ada di
  `wp_kc_clinics` → 404, dan PUT-nya tidak pernah sampai ke plugin.
- **Disimpan** di `wp_options` `praktiqu_endpoint_clinic_{id}_payment` (string JSON), ditulis
  lewat plugin `PUT /praktiqu/v1/clinics/{id}/payment-settings`. Setiap simpan dicatat di
  `log_entries` (AUDIT, action `clinic.payment_settings.updated`, berisi `before`/`after`).
- Sengaja **terpisah** dari §4.6: pengaturan uang butuh jejak audit yang jelas.

`PUT` — semua key **wajib** (PUT mengganti seluruh objek); `null` artinya "pakai nilai
global" untuk kurs/markup dan "tanpa fee" untuk fee:

```bash
curl -X PUT https://endpoint.praktiqu.com/api/v1/practices/4/payment-settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"international":true,"fxRate":18000,"markupPercent":10,"fixedFeeIdr":25000}'
```

| Field | Aturan |
|---|---|
| `international` | boolean |
| `fxRate` | `null`, atau 1.000–100.000 **rupiah per 1 USD**, maks 2 desimal |
| `markupPercent` | `null`, atau 0–100, maks 2 desimal |
| `fixedFeeIdr` | `null`, atau bilangan bulat 0–10.000.000 |
| silang | `international: true` butuh kurs yang bisa dipakai — dari klinik atau dari opsi global WordPress |

`GET` dan jawaban `PUT` (PUT membaca ulang opsi yang tersimpan, bukan menggemakan input):

```json
{
  "data": {
    "clinicId": 4,
    "stored": { "international": true, "fxRate": 18000, "markupPercent": 10, "fixedFeeIdr": 25000 },
    "effective": {
      "international": true,
      "methods": ["xendit", "paypal", "card"],
      "fxRate": "18000", "markupPercent": "10", "fixedFeeIdr": "25000",
      "source": { "fxRate": "clinic", "markupPercent": "clinic", "fixedFeeIdr": "clinic" }
    },
    "globalDefaults": { "fxRate": 16500, "markupPercent": 5 },
    "example": { "price": "12.23", "taxes": [], "fee": "1.39", "total": "13.62", "idr": 200000 },
    "updatedAt": "2026-10-06T08:00:00+00:00",
    "updatedBy": { "wpUserId": 123, "name": "Dewi Admin" }
  }
}
```

- `stored` = nilai milik klinik; tanpa pengaturan: `international: false`, sisanya `null`.
- `effective` = yang akan dipakai pembayaran, beserta sumbernya (`clinic` / `global` /
  `default`), apa pun flag-nya. `fxRate` bisa `null` kalau tidak ada kurs yang bisa dipakai.
- `globalDefaults` = kurs & markup global, untuk placeholder form.
- `example` = Rp 200.000 dalam USD dengan nilai efektif; dihitung selama ada kurs, bahkan
  sebelum klinik ditandai, supaya admin bisa melihat pratinjau. `null` kalau tidak ada kurs.
- `updatedBy` = `null`, atau nama dari `users.displayName` (cadangan `wp_users.display_name`).

Error (`problem+json` dengan `code`):

| Status | `code` | Kapan |
|---|---|---|
| 400 | `invalid_json` | Body bukan JSON |
| 404 | `practice_not_found` | Klinik tidak ada / di luar scope CLINIC_ADMIN |
| 422 | `invalid_input` | Gagal validasi; `fields` berisi pesan per field (`body` untuk key tak dikenal). Juga saat validasi WordPress sendiri menolak: `fields.body` = `["WordPress rejected the settings"]`, mengulang body yang sama akan gagal lagi |
| 422 | `fx_rate_required` | `international: true` tanpa kurs yang bisa dipakai; `fields.fxRate` |
| 500 | `internal_error` | Kegagalan tak terduga; tercatat di log |
| 502 | `payment_settings_save_failed` | WordPress gagal menyimpan; tidak ada audit |
| 503 | `payment_settings_unavailable` | Pengaturan gagal dibaca. Pada PUT bisa juga berarti simpan sudah berhasil tapi baca ulang gagal: GET ulang dulu sebelum mencoba lagi |

---
````

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 499), replace

````markdown
```json
{
  "data": [
    {
      "id": 1, "name": "PraktiQU Jakarta", "email": "halo@praktiqu.com",
      "telephoneNo": "+62211234567", "address": "Jl. Sudirman No. 1",
      "city": "Jakarta", "state": "DKI Jakarta", "country": "Indonesia",
      "postalCode": "10220", "specialties": ["Psikologi Klinis"]
    }
  ]
}
```

Field internal seperti `status`, `timezone`, `logoUrl`, dan `businessHours` sengaja tidak
ikut. Sebagai gantinya ada `specialties`.
````

with

````markdown
```json
{
  "data": [
    {
      "id": 1, "name": "PraktiQU Jakarta", "email": "halo@praktiqu.com",
      "telephoneNo": "+62211234567", "address": "Jl. Sudirman No. 1",
      "city": "Jakarta", "state": "DKI Jakarta", "country": "Indonesia",
      "postalCode": "10220", "specialties": ["Psikologi Klinis"],
      "international": false, "paymentMethods": ["xendit"]
    }
  ]
}
```

Field internal seperti `status`, `timezone`, `logoUrl`, dan `businessHours` sengaja tidak
ikut. Sebagai gantinya ada `specialties`. `paymentMethods` adalah metode bayar klinik itu
(`["xendit"]` kecuali klinik internasional dengan kurs yang bisa dipakai); `international`
hanya untuk badge — lihat [`PAYMENT-METHODS-GUIDE.md`](PAYMENT-METHODS-GUIDE.md).
````

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 522), replace

````markdown
```json
{
  "data": [
    { "id": 12, "name": "Konsultasi Psikologi", "price": "350000",
      "durationMinutes": 60, "serviceType": "consultation" }
  ]
}
```
````

with

````markdown
```json
{
  "data": [
    { "id": 12, "name": "Konsultasi Psikologi", "price": "350000",
      "durationMinutes": 60, "serviceType": "consultation",
      "clinicId": 4, "paymentMethods": ["xendit", "paypal", "card"],
      "usd": { "price": "21.39", "taxes": [], "fee": "1.39", "total": "22.78" } }
  ]
}
```
````

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 537), replace

```markdown
- Dokter nonaktif / tidak ada → 404.
```

with

```markdown
- Dokter nonaktif / tidak ada → 404.
- **Satu baris per klinik.** Service yang sama di dua klinik muncul dua kali, masing-masing
  dengan `clinicId`-nya. Booking harus dikirim dengan `clinicId` baris yang dipilih, supaya
  USD yang ditampilkan sama dengan yang ditagih.
- `paymentMethods` dan `usd` per baris: `usd` hanya terisi untuk klinik internasional dengan
  kurs yang bisa dipakai dan harga di atas Rp 0. Semua angka USD berupa string 2 desimal dan
  dihitung dengan fungsi yang sama dengan penagihan — FE tidak pernah mengonversi sendiri.
```

In `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (around line 633), replace

```markdown
| Katalog publik | [`src/services/public/public-catalog.service.ts`](../../src/services/public/public-catalog.service.ts) |
```

with

```markdown
| Katalog publik | [`src/services/public/public-catalog.service.ts`](../../src/services/public/public-catalog.service.ts) |
| Pembayaran internasional (§4.16) | [`src/app/api/v1/practices/[id]/payment-settings/route.ts`](../../src/app/api/v1/practices/%5Bid%5D/payment-settings/route.ts), [`src/services/practice/payment-settings.service.ts`](../../src/services/practice/payment-settings.service.ts) |
| Hitungan USD | [`src/services/payments/intl-pricing.ts`](../../src/services/payments/intl-pricing.ts) |
```

- [ ] **Step 6: Write the deploy runbook**

Create `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional/docs/deploy/international-clinic-runbook.md` with exactly this content:

````markdown
# International Clinic Payment — Deployment Runbook

**Spec:** `docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md` (§8 Rollout)
**Ships:** plugin `praktiqu-endpoint` 1.7.0 → Next.js API → Laravel FE PR `feat/klinik-internasional`
**FE contract:** `docs/api/PAYMENT-METHODS-GUIDE.md`, `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` §4.16

## Before you start

- **Run every step with the user present.** Ask before every database query, including the
  read-only ones below. Never run `prisma db push` / `prisma migrate`: `DATABASE_URL` is the
  WordPress database. This release adds no table, no column and no Prisma change.
- **The International flag is now the safety switch.** Until now PayPal was kept shut by
  leaving the global rate empty. That no longer protects a flagged clinic: a clinic with its
  own rate takes real money the moment it is flagged, if PPCP is live.
- Never paste the service token, `PAYMENT_WEBHOOK_SECRET` or any password into this file, a
  commit or a chat. The commands below read them on the server at run time.

| Component | Where |
| --- | --- |
| WordPress + `praktiqu-endpoint` + WooCommerce/PPCP | Hostinger: `ssh praktiqu-hostinger` (use `-o ConnectTimeout=40`), `~/domains/api-appointment.praktiqu.com/public_html`, plugin in `wp-content/plugins/praktiqu-endpoint/`, table prefix `wp_`. `php` is on PATH; `wp-cli` is not used. |
| Next.js API | Hostinger Node.js app `endpoint.praktiqu.com` (hPanel Git build): `~/domains/endpoint.praktiqu.com/hbuilds/current`, log `hbuilds/current/nodejs/console.log`, env `hbuilds/config/.env` |
| Laravel FE | `terpadu.praktiqu.com`, auto-deployed from `main` of `raakanaka/laravel-praktiqu` |

The Hostinger clock is UTC. Curl from outside hits a JS bot-check WAF, so run the HTTP checks
from the server itself.

## 1. Pre-deploy checks (read-only)

Ask the user before each query.

1. **Which WordPress does the app call?** The app's `WORDPRESS_URL` must be
   `https://api-appointment.praktiqu.com` (Hostinger). The plugin goes to that install; a
   plugin deployed to the WordPress the app does not call changes nothing.
2. **PPCP mode.** wp-admin → WooCommerce → Settings → Payments → PayPal → connection tab: write
   down **Live** or **Sandbox**. If it is Live, no clinic may be flagged until §3 step 1 has
   switched PPCP to sandbox (real clinics are flagged only in §4, after it is back on Live).
3. **WooCommerce tax calculation is OFF.** wp-admin → WooCommerce → Settings → General:
   **"Enable tax rates and calculations" must be unchecked.** If it is on, WooCommerce adds its
   own tax in `calculate_totals()`, the order total no longer equals `charge.total`, and plugin
   1.7.0 cancels every USD order with 502 `charge_mismatch`. That fails closed, but it makes
   PayPal and card unusable. If it is on, stop and decide with the user before deploying.
4. **Global rate and markup:**

   ```sql
   SELECT option_name, option_value FROM wp_options
   WHERE option_name IN ('praktiqu_endpoint_paypal_idr_rate', 'praktiqu_endpoint_paypal_markup_percent');
   ```

   The rate must be empty or within 1,000–100,000 (rupiah per 1 USD); the markup within 0–100.
   Next.js treats an out-of-range global value as missing (a flagged clinic without its own
   rate then answers 503 `paypal_rate_missing`), and the 1.7.0 sanitizer refuses to save one.
5. **PayPal rows in flight:**

   ```sql
   SELECT gateway, chargedCurrency, status, COUNT(*) AS n, MAX(createdAt) AS newest
   FROM payment_orders
   WHERE chargedCurrency <> 'IDR'
   GROUP BY gateway, chargedCurrency, status;
   ```

   Any `pending` USD row must be settled or reconciled by hand (open its WooCommerce order:
   was it captured at PayPal?) before deploying.
6. **No clinic options yet:**

   ```sql
   SELECT option_name FROM wp_options WHERE option_name LIKE 'praktiqu\_endpoint\_clinic\_%\_payment';
   ```

   Expect 0 rows.
7. Write down the current plugin version (1.6.8) and the current Next.js build id
   (`readlink ~/domains/endpoint.praktiqu.com/hbuilds/current`) for a rollback.

## 2. Deploy — plugin, then Next.js, then the FE

The order matters. The new Next.js needs the plugin's settings route and its `charge`
support: a 1.6.8 plugin ignores `charge` and charges the global rate, which the Next.js
backstop then catches as 502 `charge_mismatch` (and cancels the order). The reverse — new
plugin, old Next.js — is safe: 1.7.0 keeps the legacy global path for exactly this window.

### 2.1 Plugin 1.7.0 (Hostinger WordPress)

The established method: md5 comparison, tar backup, `php -l`, then `cp` + `mv`.

```bash
PLUGINS='~/domains/api-appointment.praktiqu.com/public_html/wp-content/plugins'
# 1. Every server file must match SOME version in git history (no hand edits get lost).
ssh -o ConnectTimeout=40 praktiqu-hostinger "cd $PLUGINS/praktiqu-endpoint && find . -type f -exec md5sum {} + | sort -k2"
#    Locally, for each file: git log --format=%H -- Wordpress-Plugin/praktiqu-endpoint/<file>
#    and git show <sha>:Wordpress-Plugin/praktiqu-endpoint/<file> | md5sum. Stop if a server
#    file matches no version.
# 2. Backup.
ssh -o ConnectTimeout=40 praktiqu-hostinger "mkdir -p ~/plugin-backups && tar -czf ~/plugin-backups/praktiqu-endpoint-1.6.8-\$(date -u +%Y%m%dT%H%M%SZ).tgz -C $PLUGINS praktiqu-endpoint"
# 3. Upload the merged 1.7.0 tree to a temp dir. <merged-commit> = the commit being deployed.
rm -rf /tmp/pq-1.7.0 && mkdir -p /tmp/pq-1.7.0
git -C /home/ahmad/projects/nextjs-appointment-praktiqu archive <merged-commit> Wordpress-Plugin/praktiqu-endpoint | tar -x -C /tmp/pq-1.7.0
ssh -o ConnectTimeout=40 praktiqu-hostinger 'rm -rf ~/plugin-upload-1.7.0'
scp -o ConnectTimeout=40 -r /tmp/pq-1.7.0/Wordpress-Plugin/praktiqu-endpoint praktiqu-hostinger:~/plugin-upload-1.7.0
# 4. Lint every PHP file there — expect no output.
ssh -o ConnectTimeout=40 praktiqu-hostinger "cd ~/plugin-upload-1.7.0 && find . -name '*.php' -print0 | xargs -0 -n1 php -l | grep -v '^No syntax errors'"
```

5. Swap the files in, one at a time, each as `cp <upload>/<f> <plugin>/<f>.new && mv
   <plugin>/<f>.new <plugin>/<f>`. Copy the two **new** classes first
   (`includes/class-praktiqu-endpoint-clinic-payment-settings.php`,
   `includes/class-praktiqu-endpoint-charge-validator.php`), then the changed includes
   (`class-praktiqu-endpoint-rest-controller.php`, `class-praktiqu-endpoint-settings.php`,
   `class-praktiqu-endpoint-payments.php`), then `uninstall.php` and `readme.txt`, and
   `praktiqu-endpoint.php` **last** — it is the file that requires the new classes. Upload
   `tests/` only if the server copy already has it.
6. Verify the version and that the plugin is still active (it is a normal plugin on Hostinger
   and can drop out of `active_plugins`):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger "cd ~/domains/api-appointment.praktiqu.com/public_html && php -r 'define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_ENDPOINT_VERSION, PHP_EOL; var_dump(in_array(\"praktiqu-endpoint/praktiqu-endpoint.php\", (array) get_option(\"active_plugins\"), true));'"
   ```

   → `1.7.0` and `bool(true)`.
7. Settings route smoke test (pick a real clinic id; the token never leaves the server):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && TOKEN=$(php -r "define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_SERVICE_TOKEN;") && curl -s -H "X-PraktiQU-Service-Token: $TOKEN" https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/clinics/4/payment-settings'
   ```

   → `{"clinicId":4,"settings":null}`.
8. An unknown clinic is refused and nothing is written (same server-side token read):

   ```bash
   ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && TOKEN=$(php -r "define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_SERVICE_TOKEN;") && curl -s -X PUT -H "X-PraktiQU-Service-Token: $TOKEN" -H "Content-Type: application/json" --data "{\"international\":false,\"fx_rate\":null,\"markup_percent\":null,\"fixed_fee_idr\":null,\"updated_by\":null}" https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/clinics/999999/payment-settings'
   ```

   → `{"code":"clinic_not_found",…,"data":{"status":404,…}}`. Then (ask first):
   `SELECT COUNT(*) FROM wp_options WHERE option_name = 'praktiqu_endpoint_clinic_999999_payment';`
   → `0`.
9. wp-admin → Settings → PraktiQU Endpoint: the two fields now read **Global default PayPal FX
   Rate (IDR per 1 USD)** and **Global default Foreign Patient Markup**, with the values from
   check 1.4 unchanged. Then type `16.5` into the rate field and save: the page must show the
   "Global default PayPal FX Rate was not updated" notice, and the field must still hold the
   check-1.4 rate (the form also re-saves the markup — leave it as it was). Only if the rate did
   change, re-enter the check-1.4 value and save again.

### 2.2 Next.js (`endpoint.praktiqu.com`)

Deploy the merged branch the way `endpoint.praktiqu.com` is normally built (hPanel Git build).
There is no env change, no Prisma change and no SQL. Confirm the build id changed and that
`console.log` shows no new errors.

**From this moment PayPal and card are closed for every clinic**, because none is flagged yet.
On the old FE a patient who picks PayPal gets the generic "Gagal membuka halaman pembayaran"
plus the existing "Bayar dengan Xendit (IDR)" fallback, so they can still pay. Keep the gap
before 2.3 short.

Smoke checks, from the server:

- [ ] `GET /api/v1/public/practices` → every clinic has `"international": false` and
  `"paymentMethods": ["xendit"]`.
- [ ] `GET /api/v1/public/professionals/{id}/services` → every row has `clinicId`,
  `"paymentMethods": ["xendit"]` and `"usd": null`.
- [ ] `GET /api/v1/practices/{id}/payment-settings` with a SUPER_ADMIN bearer → 200,
  `stored.international: false`, `globalDefaults` equal to check 1.4.
- [ ] One Xendit booking pays exactly as before (rupiah, no markup, no fee).

### 2.3 Laravel FE

Rafiq merges PR `feat/klinik-internasional` in `raakanaka/laravel-praktiqu`; `main`
auto-deploys to `terpadu.praktiqu.com`. Never push to `main` directly.

- [ ] SUPER_ADMIN sees a "Pengaturan pembayaran" link on each clinic card.
- [ ] A CLINIC_ADMIN sees the menu entry under Pengaturan **after logging in again** (older
  sessions read `canManageClinicPayment` as false; nobody is forced out).
- [ ] A receptionist sees neither.

## 3. Sandbox end to end

1. **Switch PPCP to sandbox**: WooCommerce → Settings → Payments → PayPal, paste the sandbox
   app's client id and secret, save (the webhook re-registers). Have a sandbox **personal**
   buyer account and a sandbox card ready.
2. **Flag one test clinic** — not one taking real bookings — on
   `/dashboard/klinik/{id}/pembayaran-internasional`: Klinik Internasional on, Kurs 18000,
   Markup 10, Fee flat 25000. The page's example must read **$12.23 + $1.39 = $13.62** and
   "Terakhir diubah oleh <your name> pada …".
   - Audit row (ask first):
     `SELECT occurredAt, userId, action, metadata FROM log_entries WHERE action = 'clinic.payment_settings.updated' ORDER BY occurredAt DESC LIMIT 1;`
     → `userId` is your `users.id` (a cuid), `metadata` holds `wpUserId`, `before`, `after`.
   - Storage (ask first):
     `SELECT option_value, autoload FROM wp_options WHERE option_name = 'praktiqu_endpoint_clinic_<id>_payment';`
     → the value starts with `{` (JSON, never `a:`), autoload is off (`no`/`off`).
3. **Book** a Rp 200,000 service of a psychologist at that clinic through the clinic's booking
   page: the service card shows **$12.23** (the service line, `usd.price`) with "Rp 200.000"
   underneath; step 5 offers Xendit, PayPal and Kartu, and with PayPal chosen the summary reads
   $12.23 + International service fee $1.39 = **$13.62**. The success screen offers the same
   three methods.
4. **Pay with PayPal** in a **fresh incognito window** (a PayPal session cookie overrides the
   landing page): `sandbox.paypal.com`, total **$13.62**. Pay with the sandbox buyer.
5. **Check what was recorded.**
   - WooCommerce order: currency USD, total 13.62, a fee line "International service fee"
     (1.39), custom fields `praktiqu_clinic_id` = the clinic id, `praktiqu_fixed_fee_idr` =
     25000, `praktiqu_fx_rate` = 18000, `praktiqu_markup_percent` = 10, and
     `praktiqu_fx_source` = `{"fxRate":"clinic","markupPercent":"clinic","fixedFeeIdr":"clinic"}`.
   - `payment_orders` (ask first):
     `SELECT wcOrderId, gateway, expectedAmount, chargedAmount, chargedCurrency, fxRate, status FROM payment_orders ORDER BY createdAt DESC LIMIT 1;`
     → `expectedAmount` 200000 (the fee is not the clinic's), `chargedAmount` 13.62, `USD`,
     `fxRate` ≈ 16363.64 (rate ÷ 1.10), `status` `pending`.
6. **Replay the final webhook (UNILATERAL).** In sandbox the capture stays *pending* with reason
   `UNILATERAL`: PPCP carries the live merchant e-mail into sandbox, PayPal holds the money
   unclaimed, WooCommerce puts the order *on-hold*, and nothing books the appointment. That is
   expected — replay `payment.completed` by hand, on the server:

   ```bash
   cd ~/domains/endpoint.praktiqu.com/hbuilds/config
   SECRET=$(grep '^PAYMENT_WEBHOOK_SECRET=' .env | cut -d= -f2- | tr -d '"')
   BODY='{"event":"payment.completed","wcOrderId":<WC order id>,"amountPaid":13.62,"currency":"USD","transactionId":"<PayPal capture id from the order notes>"}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
   curl -s -X POST https://endpoint.praktiqu.com/api/v1/sessions/payment-webhook \
     -H 'Content-Type: application/json' -H "X-PraktiQU-Webhook-Signature: $SIG" --data "$BODY"
   ```

   `transactionId` must be a JSON **string**. Expected: 200, the `payment_orders` row `paid`,
   the appointment **BOOKED**, the delayed auto-cancel job cancelled. If the running process's
   environment differs from `.env`, use the value the process actually has.
7. **Card:** book again, choose Kartu → the PayPal page opens on the **card form**; pay with
   the sandbox card; replay the webhook as in 6.
8. **Negative checks.**
   - [ ] A clinic that is not international: no PayPal/Kartu buttons, and
     `POST /api/v1/public/payments {"token":"…","method":"paypal"}` → **403**
     `payment_method_not_allowed`, with no WooCommerce order created.
   - [ ] Xendit at the international clinic → **Rp 200.000**: no markup, no fee.
   - [ ] (Optional) staff `POST /api/v1/sessions/payment-verify {"billId":"…","method":"paypal"}`
     on a bill with a discount → **422** `discount_not_supported`.
9. Switch the test clinic's International off again, unless it is meant to take USD.

## 4. Back to live, then enable clinics

1. **Switch PPCP back to Live** (live client id and secret, save, webhook re-registers) and
   confirm the connection tab says Live. Do not leave the box in sandbox.
2. **Enable real clinics one at a time**, with the clinic owner: set Kurs / Markup / Fee flat,
   check the example, open that clinic's booking page and check the USD price, then watch the
   first live USD payment through to BOOKED. Live capture → webhook → BOOKED has never run
   against real PayPal, and neither has a booking with a tax line (`wp_kc_taxes` is empty), so
   the first of each is the real test.
3. **Kill switch:** turning International off for a clinic hides PayPal and card at once.
   Next.js does not cache the settings, and the FE forgets its `pq_public_practices` cache on
   every save.

## 5. Next plugin release: remove the legacy path

`create_order` for `paypal`/`card` **without** a `charge` (the global rate path) exists only for
the deploy window between 2.1 and 2.2. Before removing it in the next plugin release, confirm
nothing still uses it: every USD WooCommerce order created after the Next.js deploy carries a
`praktiqu_fx_source` custom field. Then remove the branch, bump the version, and deploy with
the method in 2.1.

## Rollback

- **Settle first.** Run check 1.5 again; any `pending` USD row must be settled or reconciled
  before rolling anything back.
- **Roll back in the reverse order: Next.js first, then the plugin.** New Next.js against a
  1.6.8 plugin would fail every USD payment as 502 `charge_mismatch` and every settings save
  as 502 `payment_settings_save_failed`.
- **Next.js:** redeploy the build id written down in 1.7. The old app never sends `charge`, so
  plugin 1.7.0's legacy path takes PayPal again with the **global** rate and markup — and with
  no per-clinic gate, every clinic can be paid by PayPal or card again. Decide with the user
  whether to blank the global rate to keep PayPal shut.
- **Plugin:** move `praktiqu-endpoint` aside, extract the tar backup from 2.1 into
  `wp-content/plugins/`, and re-run the check in 2.1 step 6 (expect `1.6.8`, `bool(true)`).
- The `praktiqu_endpoint_clinic_{id}_payment` options can stay: nothing older reads them, and
  `uninstall.php` removes them only when the plugin is deleted.
````

- [ ] **Step 7: Run the docs check — expect PASS**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && /usr/bin/grep -q '^## International clinics only' docs/api/PAYMENT-METHODS-GUIDE.md && /usr/bin/grep -q '^## Errors' docs/api/PAYMENT-METHODS-GUIDE.md && /usr/bin/grep -q '^### 4.16 ' docs/api/PRACTICES-AND-SERVICES-GUIDE.md && /usr/bin/grep -q 'UNILATERAL' docs/deploy/international-clinic-runbook.md && echo GUIDES OK || echo GUIDES MISSING; node -e "
const y=require('js-yaml'),fs=require('fs'),v=require('oas-validator');
const d=y.load(fs.readFileSync('docs/api/openapi.yaml','utf8'));
const r=y.load(fs.readFileSync('openapi.yaml','utf8'));
const must=(ok,what)=>{if(!ok){console.error('MISSING: '+what);process.exitCode=1}};
const ps=d.paths['/api/v1/practices/{id}/payment-settings'];
must(ps&&ps.get&&ps.put,'GET/PUT /api/v1/practices/{id}/payment-settings');
for(const s of ['PaymentMethod','PublicUsdView','PaymentSettingsInput','PaymentSettingsView','FieldsProblem','Practice','PublicClinic','PublicService','PublicAppointmentView','CreatedAppointment'])must(d.components.schemas[s],'schema '+s);
must(d.components.schemas.Practice&&d.components.schemas.Practice.properties.international,'Practice.international');
must(d.components.schemas.PublicService&&d.components.schemas.PublicService.properties.usd,'PublicService.usd');
must(r.paths['/praktiqu/v1/clinics/{id}/payment-settings'],'plugin route in the root openapi.yaml');
const refs=[];(function w(o){if(o&&typeof o==='object')for(const[k,x]of Object.entries(o)){if(k==='\$ref')refs.push(x);else w(x)}})(d);
for(const ref of refs){let c=d;for(const p of ref.slice(2).split('/'))c=c&&c[p];must(c,'unresolved '+ref)}
const keep=['/api/v1/practices','/api/v1/practices/{id}','/api/v1/practices/{id}/payment-settings','/api/v1/public/appointments','/api/v1/public/appointments/{token}','/api/v1/public/practices','/api/v1/public/practices/{id}','/api/v1/public/professionals/{id}/services'].filter(k=>d.paths[k]);
v.validate({...d,paths:Object.fromEntries(keep.map(k=>[k,d.paths[k]]))},{lint:false,resolve:false,laxurls:true})
 .then(()=>console.log(process.exitCode?'CHECK FAILED':'CHECK OK'))
 .catch(e=>{console.error('INVALID OpenAPI: '+e.message);console.log('CHECK FAILED');process.exitCode=1});
"
```

Expected: `GUIDES OK` and `CHECK OK`. (The whole-file `oas-validator` run and `npm run openapi:check` already fail before this task on generated `/api/v1/services` and KiviCare paths; the check therefore validates only the paths this task touches, plus every component schema and every `$ref`.)

- [ ] **Step 8: Full Next.js suite for this feature, and typecheck**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && npx vitest run tests/payments tests/public-booking/create.test.ts tests/public-booking/cancel.test.ts 2>&1 | /usr/bin/grep -E 'Test Files|^ +Tests '; npx tsc --noEmit -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `Test Files  18 passed (18)`, `Tests  395 passed (395)`, `tsc exit=0` — nothing in this task changes code; this confirms Tasks B1–B9 together are green before the branch moves on to the FE part.

- [ ] **Step 9: Commit**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional && git add docs/api/openapi.yaml openapi.yaml docs/api/PAYMENT-METHODS-GUIDE.md docs/api/PRACTICES-AND-SERVICES-GUIDE.md docs/deploy/international-clinic-runbook.md && git commit -F - <<'EOF'
docs(api): kontrak pembayaran klinik internasional dan runbook deploy

OpenAPI Next.js: route GET/PUT /practices/{id}/payment-settings, field
international/paymentMethods/usd/clinicId di practices, katalog publik
dan booking publik, plus skema komponennya. OpenAPI root hanya mendapat
rute plugin /praktiqu/v1/clinics/{id}/payment-settings. Panduan metode
bayar dan practices diperbarui untuk FE. Runbook deploy mengikuti spec
§8: cek read-only, urutan plugin -> Next.js -> FE, E2E sandbox dengan
replay webhook UNILATERAL, mengaktifkan klinik, dan rollback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/klinik-internasional status --short
```

Expected: the commit succeeds, and `git status --short` lists no file this task touched (an untracked planning folder such as `.plan-wip/` may show; leave it alone). Never use `git add -A` / `git add .`: the `node_modules` symlink from Task B0 must stay out of git.

---

## Part C — Laravel FE (`raakanaka/laravel-praktiqu`)

### Task C0: Setup worktree FE — branch `feat/klinik-internasional`, vendor, `.env` sementara, baseline hijau

**Files:**
- Create: `/home/ahmad/projects/praktiqu-fe/klinik-internasional` (git worktree of `raakanaka/laravel-praktiqu`, branch `feat/klinik-internasional` from `origin/main`)
- Create (untracked, gitignored): `/home/ahmad/projects/praktiqu-fe/klinik-internasional/vendor` (hard-linked copy of the main checkout's `vendor`), `/home/ahmad/projects/praktiqu-fe/klinik-internasional/.env` (a throwaway file holding only a freshly generated `APP_KEY` — the tests need one, `phpunit.xml` does not set it, and everything else comes from `phpunit.xml` and `Http::fake`; the main checkout's real `.env` holds production secrets and is deliberately NOT copied)
- Modify: no tracked file.

**Interfaces:** Consumes: nothing. / Produces: a worktree where `php vendor/bin/phpunit` runs green in Docker. Every later C-task runs in `/home/ahmad/projects/praktiqu-fe/klinik-internasional`. NEVER push to `main` of this repo: it auto-deploys terpadu.praktiqu.com. Read-only reference copy: `/home/ahmad/projects/praktiqu-fe/main` (do not edit it, do not run Docker in it).

- [ ] **Step 1: Create the worktree from a fresh `origin/main`**

```bash
git -C /home/ahmad/projects/praktiqu-fe/main fetch origin
git -C /home/ahmad/projects/praktiqu-fe/main worktree add -b feat/klinik-internasional /home/ahmad/projects/praktiqu-fe/klinik-internasional origin/main
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional branch --show-current
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional log -1 --format='%h %s'
```

Expected: `feat/klinik-internasional`, then the head of `origin/main` (`e5afd8b Merge pull request #34 from raakanaka/fix/sisa-audit-fe` at the time of writing; a newer commit is fine). If `worktree add` says the branch already exists, stop and ask — do not reuse or reset it.

- [ ] **Step 2: Reuse `vendor` and write a throwaway `.env`**

Do NOT copy the main checkout's `.env`: it holds real secrets (API keys, the forwarder secret) that a test worktree has no business carrying. The tests only need an `APP_KEY` (`phpunit.xml` sets the rest: sqlite in memory, array cache and session, `Http::fake` everywhere), so write a file with a fresh random one:

```bash
cp -al /home/ahmad/projects/praktiqu-fe/main/vendor /home/ahmad/projects/praktiqu-fe/klinik-internasional/vendor
printf 'APP_KEY=base64:%s\n' "$(head -c 32 /dev/urandom | base64)" > /home/ahmad/projects/praktiqu-fe/klinik-internasional/.env
ls /home/ahmad/projects/praktiqu-fe/klinik-internasional/vendor/bin/phpunit
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional status --short
```

Expected: the phpunit path prints, and `git status --short` prints nothing (`vendor/` and `.env` are gitignored). If `cp -al` fails (cross-device link), install instead:

```bash
mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app composer:2 install --no-interaction --no-scripts --ignore-platform-req=ext-*
```

- [ ] **Step 3: Baseline test run**

The Docker credential helper on this machine is broken, so every `docker run` uses an empty config.

```bash
mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit
```

Expected (about 100 s): last line `OK (650 tests, 2200 assertions)`. If `origin/main` moved since e5afd8b the counts may differ, but the run must be fully green (`OK`). A red baseline is not this plan's problem to fix: stop and report it. (The container runs as root, so it leaves root-owned files in `storage/` and `.phpunit.result.cache`; all of them are gitignored.)

- [ ] **Step 4: Nothing to commit**

This task changes no tracked file; `git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional status --short` prints nothing.

Note for every later C-task: this repository has no git identity configured (neither repo nor global `user.name`), so a plain `git commit` fails with "Author identity unknown". Every commit command in Part C therefore passes `-c user.name="Claude Code" -c user.email="noreply@anthropic.com"` — the identity the repo's earlier Claude commits carry. Do not run `git config` to set it permanently.

### Task C1: `canManageClinicPayment` di profil sesi — dihitung dari role mentah saat login

**Files:**
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/AuthController.php` (new private helper after `roleOf()`, lines 96–109; `login()`: one line before the `/auth/me` `try` at line 504, one block after its `catch` at line 521)
- Test: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/KelolaPembayaranLoginTest.php` (new)

**Interfaces:** Consumes: the raw backend user from `/api/v1/auth/login` (`$user`) and `/api/v1/auth/me` (`$meUser`), each with `role` (string) or `roles` (list). / Produces: session profile key `canManageClinicPayment` (bool) under `PraktiquApi::PROFILE_KEY` — `true` only when the raw role is `SUPER_ADMIN` or `CLINIC_ADMIN`. A profile without the key (sessions created before this change) is read as `false` by Task C2. `AuthController::PROFILE_VERSION` stays `5`: bumping it would make `validProfile()` reject every live session.

Why it is computed **after** the `/auth/me` block: that block rebuilds `$profile` from scratch, so a key set before it is lost. The raw role is read the same way `roleOf()` reads it (`role`, else `roles[0]`), from `$meUser` when `/auth/me` answered with a role `roleOf()` recognises, otherwise from the login `$user` — the same source the profile's own `role` comes from.

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/KelolaPembayaranLoginTest.php` with exactly this content:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Siapa yang boleh mengubah pengaturan pembayaran klinik internasional (kurs,
// markup, fee flat). roleOf() melipat CLINIC_ADMIN dan RECEPTIONIST jadi satu
// role 'admin', jadi pembedanya dihitung saat login dari role MENTAH backend
// dan disimpan di profil sebagai canManageClinicPayment.
class KelolaPembayaranLoginTest extends TestCase
{
    private static function jawabanLogin(string $role): array
    {
        return [
            'token' => 'tok_123',
            'refreshToken' => 'ref_123',
            'user' => ['id' => 'wpu_115', 'email' => 'staf@klinik.co', 'displayName' => 'Staf',
                'role' => $role, 'wpUserId' => 115, 'clinicId' => 42],
        ];
    }

    private function masuk(): array
    {
        $this->post('/staff/login', ['email' => 'staf@klinik.co', 'password' => 'secret']);

        return Session::get(PraktiquApi::PROFILE_KEY);
    }

    public static function peran(): array
    {
        return [
            'super admin' => ['SUPER_ADMIN', true],
            'admin klinik' => ['CLINIC_ADMIN', true],
            'resepsionis' => ['RECEPTIONIST', false],
        ];
    }

    // Jalur normal: /auth/me menjawab, dan profil dibangun ulang darinya.
    #[DataProvider('peran')]
    public function test_flag_dihitung_dari_role_mentah_saat_auth_me_menjawab(string $role, bool $boleh): void
    {
        Http::fake(fn () => Http::response(self::jawabanLogin($role)));

        $profile = $this->masuk();

        $this->assertSame($boleh, $profile['canManageClinicPayment']);
    }

    // /auth/me gagal: profil tetap dari jawaban /auth/login, dan flag-nya juga.
    // Retry-After 0: PraktiquApi mengulang GET yang dijawab 503, dan header ini
    // membuat jedanya nol supaya tesnya tidak menunggu.
    #[DataProvider('peran')]
    public function test_flag_tetap_terisi_saat_auth_me_gagal(string $role, bool $boleh): void
    {
        Http::fake(function ($req) use ($role) {
            if (str_contains($req->url(), 'auth/me')) {
                return Http::response(['title' => 'Service Unavailable'], 503, ['Retry-After' => '0']);
            }

            return Http::response(self::jawabanLogin($role));
        });

        $profile = $this->masuk();

        $this->assertSame($boleh, $profile['canManageClinicPayment']);
        $this->assertSame(42, $profile['practiceId']);
    }

    // /auth/me yang menjawab tanpa role yang dikenali tidak boleh menghapus
    // hak yang sudah terbaca dari /auth/login.
    public function test_auth_me_tanpa_role_memakai_role_dari_login(): void
    {
        Http::fake(function ($req) {
            if (str_contains($req->url(), 'auth/me')) {
                return Http::response(['user' => ['id' => 'wpu_115', 'email' => 'staf@klinik.co']]);
            }

            return Http::response(self::jawabanLogin('CLINIC_ADMIN'));
        });

        $this->assertTrue($this->masuk()['canManageClinicPayment']);
    }

    // Kalau keduanya menjawab, /auth/me yang menang — sama seperti role-nya.
    public function test_role_dari_auth_me_didahulukan(): void
    {
        Http::fake(function ($req) {
            if (str_contains($req->url(), 'auth/me')) {
                return Http::response(self::jawabanLogin('CLINIC_ADMIN'));
            }

            return Http::response(self::jawabanLogin('RECEPTIONIST'));
        });

        $this->assertTrue($this->masuk()['canManageClinicPayment']);
    }

    // `roles[0]` dipakai kalau `role` kosong — urutan yang sama dengan roleOf().
    public function test_roles_array_dibaca_kalau_role_kosong(): void
    {
        Http::fake(fn () => Http::response([
            'token' => 'tok_123',
            'user' => ['id' => 'wpu_115', 'email' => 'staf@klinik.co', 'roles' => ['CLINIC_ADMIN'], 'clinicId' => 42],
        ]));

        $this->assertTrue($this->masuk()['canManageClinicPayment']);
    }

    // Versi profil TIDAK naik: menaikkannya memaksa seluruh staf login ulang.
    // Profil lama tanpa kunci ini dibaca false, jadi menu barunya cukup muncul
    // setelah login berikutnya.
    public function test_versi_profil_tidak_dinaikkan(): void
    {
        Http::fake(fn () => Http::response(self::jawabanLogin('CLINIC_ADMIN')));

        $profile = $this->masuk();

        $this->assertSame(5, AuthController::PROFILE_VERSION);
        $this->assertSame(5, $profile['v']);
    }
}
```

- [ ] **Step 2: Run it — expected FAIL**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KelolaPembayaranLoginTest
```

Expected: `ERRORS!` with `Tests: 10, Assertions: 2, Errors: 9` — nine times `ErrorException: Undefined array key "canManageClinicPayment"` (the profile has no such key yet). `test_versi_profil_tidak_dinaikkan` already passes: it is the guard against a version bump.

- [ ] **Step 3: Add the helper after `roleOf()`**

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/AuthController.php` replace

```php
            default => null,
        };
    }

    // Bentuk respons /auth/login dan /auth/me tidak seragam antar modul
```

with

```php
            default => null,
        };
    }

    // Boleh mengubah pengaturan pembayaran klinik (klinik internasional: kurs,
    // markup, fee flat)? Hanya SUPER_ADMIN dan CLINIC_ADMIN. roleOf() melipat
    // CLINIC_ADMIN dan RECEPTIONIST jadi satu 'admin', jadi pembedanya dibaca
    // dari role MENTAH — `role`, kalau kosong `roles[0]`, urutan yang sama
    // dengan roleOf() — sebelum dilipat.
    //
    // PROFILE_VERSION sengaja TIDAK dinaikkan: validProfile() akan menolak
    // setiap sesi lama dan semua staf terpaksa login ulang. Profil lama tanpa
    // kunci ini dibaca false, jadi menu barunya muncul setelah login berikutnya.
    private static function kelolaPembayaranKlinik(array $u): bool
    {
        $raw = $u['role'] ?? ($u['roles'][0] ?? '');

        return is_string($raw) && in_array(strtoupper(trim($raw)), ['SUPER_ADMIN', 'CLINIC_ADMIN'], true);
    }

    // Bentuk respons /auth/login dan /auth/me tidak seragam antar modul
```

- [ ] **Step 4: Keep `$meUser` defined when `/auth/me` throws**

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/AuthController.php` replace

```php
        // Lengkapi profil dari /auth/me kalau bisa (data login sering minim).
        try {
```

with

```php
        // Lengkapi profil dari /auth/me kalau bisa (data login sering minim).
        $meUser = null;
        try {
```

- [ ] **Step 5: Compute the flag once, after the `/auth/me` block**

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/AuthController.php` replace

```php
            logger()->warning('[auth] /auth/me gagal setelah login: '.$e->getMessage());
        }

        // Upaya terakhir mengisi id scoping. Hanya dijalankan kalau memang
```

with

```php
            logger()->warning('[auth] /auth/me gagal setelah login: '.$e->getMessage());
        }

        // Dihitung SETELAH blok /auth/me, karena blok itu membangun ulang
        // $profile dari nol. Sumbernya user yang sama dengan role profil:
        // /auth/me kalau ia menjawab dengan role yang dikenali, selain itu
        // jawaban /auth/login.
        $profile['canManageClinicPayment'] = self::kelolaPembayaranKlinik(
            is_array($meUser) && $this->roleOf($meUser) !== null ? $meUser : $user
        );

        // Upaya terakhir mengisi id scoping. Hanya dijalankan kalau memang
```

- [ ] **Step 6: Run the new test and the existing login tests — expected PASS**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KelolaPembayaranLoginTest|StaffLoginRoleTest|StaffScopeLookupTest|LoginThrottleTest|LoginPesanGalatTest'
```

Expected: `OK` with no failures (the new test alone is `OK (10 tests, 14 assertions)`).

- [ ] **Step 7: Commit**

```bash
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional add app/Http/Controllers/AuthController.php tests/Feature/KelolaPembayaranLoginTest.php
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(auth): canManageClinicPayment di profil sesi dari role mentah

Admin klinik dan resepsionis sama-sama 'admin' di FE, jadi hak mengubah
pengaturan pembayaran klinik internasional dibaca dari role mentah backend
(role, lalu roles[0]) setelah blok /auth/me. PROFILE_VERSION tidak naik;
profil lama tanpa kunci ini dibaca false.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task C2: Halaman pengaturan pembayaran internasional klinik — controller, view, route, pintu masuk dashboard

**Files:**
- Create: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/KlinikPembayaranController.php`
- Create: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard/klinik-pembayaran.blade.php`
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/routes/web.php` (import at line 9; two routes after line 101, inside the `staff:any` group)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/DashboardController.php` (`mapClinic()` lines 911–925; `render()` line 1594)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard.blade.php` (clinic card lines 4439 and 4454–4455; Settings view lines 4236–4238)
- Test: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/PengaturanPembayaranKlinikTest.php` (new, modelled on `PengaturanKalenderTest`)

**Interfaces:** Consumes: profile key `canManageClinicPayment` (Task C1; missing ⇒ false), `practiceId`, `role`; backend `GET api/v1/practices/{id}/payment-settings` → `{ "data": PaymentSettingsView }` (`clinicId`, `stored{international,fxRate,markupPercent,fixedFeeIdr}`, `effective{international,methods,fxRate,markupPercent,fixedFeeIdr,source}`, `globalDefaults{fxRate,markupPercent}`, `example` = `{price,taxes[{name,amount}],fee,total,idr}` or `null`, `updatedAt`, `updatedBy` = `{wpUserId,name}` or `null`); backend `PUT api/v1/practices/{id}/payment-settings` with camelCase body `{ international: bool, fxRate: number|null, markupPercent: number|null, fixedFeeIdr: int|null }` → 200 same shape; errors problem+json with `code`: 403 `forbidden`, 404 `practice_not_found`, 422 `invalid_input` / `fx_rate_required` with `fields: { <field>: string[] }` (`body` for an unknown key), 503 `payment_settings_unavailable`, 502 `payment_settings_save_failed`; `GET api/v1/practices/{id}` → `{ data: { name } }` (title only); `PracticeDTO.international: boolean` in `GET api/v1/practices`; `ResourceController::rincianValidasi(mixed $body): string`. / Produces (contract names): routes `GET /dashboard/klinik/{id}/pembayaran-internasional` named `klinik.pembayaran` and `PUT|POST /dashboard/klinik/{id}/pembayaran-internasional` named `klinik.pembayaran.simpan`; `App\Http\Controllers\KlinikPembayaranController::index(string $id): View` and `::simpan(Request $request, string $id): RedirectResponse`; view `resources/views/dashboard/klinik-pembayaran.blade.php`; `DashboardController::mapClinic()` row key `international` (bool); Blade variable `$pembayaranKlinikUrl` (`?string`) passed to `dashboard.blade.php`; flash keys `pembayaranPesan` / `pembayaranGagal`.

Access (spec §5): super admin → any clinic; `admin` → only when `canManageClinicPayment` is truthy AND `{id}` equals `profile.practiceId`, else 404; receptionist (an `admin` without the flag), psikolog, and old profiles without the flag → 404, with **no** backend request. A backend 403/404 also becomes a 404 page. After a successful save the controller calls `Cache::forget('pq_public_practices')` (the only catalogue cache: `BookingApi::practicesTercache`; services and slots are not cached). Backend validation errors land per field through `withErrors()` (form field names = backend field names), plus a summary built with `ResourceController::rincianValidasi`. The page never computes a conversion: the example, placeholders and active methods are the backend's.

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/PengaturanPembayaranKlinikTest.php` with exactly this content:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Halaman pengaturan pembayaran internasional satu klinik.
 *
 * Yang paling dijaga di sini adalah AKSESNYA: kurs, markup, dan fee flat
 * menentukan berapa dolar yang ditagih ke pasien. Super admin boleh semua
 * klinik; admin klinik hanya kliniknya sendiri; resepsionis — yang di FE ini
 * berbagi role 'admin' dengan admin klinik — tidak sama sekali. Backend
 * menegakkan aturan yang sama; ini lapis kedua.
 */
class PengaturanPembayaranKlinikTest extends TestCase
{
    /** Bentuk PaymentSettingsView backend (GET /practices/{id}/payment-settings). */
    private const VIEW = [
        'clinicId' => 4,
        'stored' => ['international' => true, 'fxRate' => 18000, 'markupPercent' => 10, 'fixedFeeIdr' => 25000],
        'effective' => [
            'international' => true,
            'methods' => ['xendit', 'paypal', 'card'],
            'fxRate' => '18000', 'markupPercent' => '10', 'fixedFeeIdr' => '25000',
            'source' => ['fxRate' => 'clinic', 'markupPercent' => 'clinic', 'fixedFeeIdr' => 'clinic'],
        ],
        'globalDefaults' => ['fxRate' => 16500, 'markupPercent' => 5],
        'example' => ['idr' => 200000, 'price' => '12.23', 'taxes' => [], 'fee' => '1.39', 'total' => '13.62'],
        'updatedAt' => '2026-10-06T08:00:00.000Z',
        'updatedBy' => ['wpUserId' => 123, 'name' => 'Admin Satu'],
    ];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge([
                'v' => AuthController::PROFILE_VERSION,
                'role' => $role,
                'name' => 'Staf Uji',
                'userId' => 9,
            ], $extra),
        ];
    }

    private function super(): array
    {
        return $this->sesi('super', ['canManageClinicPayment' => true]);
    }

    private function adminKlinik(int $practiceId = 4): array
    {
        return $this->sesi('admin', ['practiceId' => $practiceId, 'canManageClinicPayment' => true]);
    }

    private function resepsionis(): array
    {
        return $this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => false]);
    }

    private function fakeView(array $override = []): void
    {
        Http::fake([
            '*/api/v1/practices/4/payment-settings' => Http::response(['data' => array_replace(self::VIEW, $override)], 200),
            '*/api/v1/practices/4' => Http::response(['data' => ['id' => 4, 'name' => 'Klinik Sehat']], 200),
        ]);
    }

    private const URL = '/dashboard/klinik/4/pembayaran-internasional';

    // ── Akses ───────────────────────────────────────────────────────────

    public function test_super_admin_bisa_membuka_klinik_mana_pun(): void
    {
        $this->fakeView();

        $res = $this->withSession($this->super())->get(self::URL);

        $res->assertOk();
        $res->assertSee('Pembayaran Internasional');
        $res->assertSee('Klinik Sehat');
        $res->assertSee('Klinik Internasional');
        $res->assertSee('terima PayPal & Kartu, dibayar dalam USD');
        $res->assertSee('Kurs (Rp per 1 USD)');
        $res->assertSee('href="/admin"', false);
    }

    public function test_admin_klinik_bisa_membuka_kliniknya_sendiri(): void
    {
        $this->fakeView();

        $res = $this->withSession($this->adminKlinik())->get(self::URL);

        $res->assertOk();
        $res->assertSee('href="/klinik"', false);
    }

    public function test_admin_klinik_mendapat_404_untuk_klinik_lain(): void
    {
        Http::fake();

        $this->withSession($this->adminKlinik(7))->get(self::URL)->assertNotFound();

        // Ditolak sebelum menyentuh backend sama sekali.
        Http::assertNothingSent();
    }

    public function test_resepsionis_tidak_bisa_membukanya(): void
    {
        Http::fake();

        $this->withSession($this->resepsionis())->get(self::URL)->assertNotFound();
        $this->withSession($this->resepsionis())->put(self::URL, ['international' => '1'])->assertNotFound();

        Http::assertNothingSent();
    }

    // Profil dari sebelum fitur ini tidak punya kuncinya, dan dibaca false.
    public function test_profil_lama_tanpa_flag_dibaca_tidak_berwenang(): void
    {
        Http::fake();

        $this->withSession($this->sesi('admin', ['practiceId' => 4]))->get(self::URL)->assertNotFound();
    }

    public function test_psikolog_tidak_bisa_membukanya(): void
    {
        Http::fake();

        $this->withSession($this->sesi('psikolog', ['practiceId' => 4, 'professionalId' => 34]))
            ->get(self::URL)->assertNotFound();
    }

    public function test_sesi_habis_dipulangkan_ke_portal_staf(): void
    {
        $this->get(self::URL)->assertRedirect('/staff/login');
    }

    public function test_klinik_yang_tidak_ada_dijawab_404(): void
    {
        Http::fake([
            '*/api/v1/practices/999/payment-settings' => Http::response(['code' => 'practice_not_found', 'status' => 404], 404),
        ]);

        $this->withSession($this->super())->get('/dashboard/klinik/999/pembayaran-internasional')->assertNotFound();
    }

    // ── Isi halaman ─────────────────────────────────────────────────────

    public function test_placeholder_menyebut_nilai_global(): void
    {
        $this->fakeView();

        $res = $this->withSession($this->super())->get(self::URL);

        $res->assertSee('kosong = kurs global Rp 16.500');
        $res->assertSee('kosong = global 5%');
        $res->assertSee('value="18000"', false);
    }

    public function test_contoh_konversi_dari_backend_ditampilkan(): void
    {
        $this->fakeView();

        $res = $this->withSession($this->super())->get(self::URL);

        $res->assertSee('Contoh konversi');
        $res->assertSee('$12.23');
        $res->assertSee('International service fee');
        $res->assertSee('$1.39');
        $res->assertSee('$13.62');
    }

    public function test_contoh_disembunyikan_kalau_null(): void
    {
        $this->fakeView(['example' => null]);

        $res = $this->withSession($this->super())->get(self::URL);

        $res->assertOk();
        $res->assertDontSee('Contoh konversi');
    }

    public function test_jejak_perubahan_dalam_wib(): void
    {
        $this->fakeView();

        $this->withSession($this->super())->get(self::URL)
            ->assertSee('Terakhir diubah oleh Admin Satu pada 6 Oktober 2026, 15:00 WIB');
    }

    public function test_jejak_tanpa_editor_menghilangkan_oleh(): void
    {
        $this->fakeView(['updatedBy' => null]);

        $this->withSession($this->super())->get(self::URL)
            ->assertSee('Terakhir diubah pada 6 Oktober 2026, 15:00 WIB')
            ->assertDontSee('Terakhir diubah oleh');
    }

    public function test_internasional_tanpa_kurs_berlaku_diperingatkan(): void
    {
        $this->fakeView([
            'stored' => ['international' => true, 'fxRate' => null, 'markupPercent' => null, 'fixedFeeIdr' => null],
            'effective' => array_replace(self::VIEW['effective'], ['methods' => ['xendit'], 'fxRate' => null]),
            'example' => null,
        ]);

        $this->withSession($this->super())->get(self::URL)
            ->assertSee('PayPal dan Kartu belum ditawarkan ke pasien');
    }

    // Formnya tidak boleh tampil kosong saat pengaturan gagal dimuat: PUT
    // mengganti SELURUH objek, jadi menyimpan form kosong menghapus pengaturan
    // klinik yang sebenarnya ada.
    public function test_gagal_memuat_tidak_menampilkan_form_kosong(): void
    {
        Http::fake([
            '*/api/v1/practices/4/payment-settings' => Http::response(['title' => 'boom'], 500, ['Retry-After' => '0']),
            '*/api/v1/practices/4' => Http::response(['data' => ['id' => 4, 'name' => 'Klinik Sehat']], 200),
        ]);

        $res = $this->withSession($this->super())->get(self::URL);

        $res->assertOk();
        $res->assertSee('Pengaturan pembayaran tidak bisa dimuat.');
        $res->assertDontSee('name="fxRate"', false);
    }

    // ── Simpan ──────────────────────────────────────────────────────────

    public function test_simpan_meneruskan_isian_ke_backend_dalam_camelcase(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response(['data' => self::VIEW], 200)]);

        $res = $this->withSession($this->super())->put(self::URL, [
            'international' => '1', 'fxRate' => '18000', 'markupPercent' => '10.5', 'fixedFeeIdr' => '25000',
        ]);

        $res->assertRedirect(self::URL);
        $res->assertSessionHas('pembayaranPesan');
        Http::assertSent(fn (Request $r) => $r->method() === 'PUT'
            && str_ends_with($r->url(), '/api/v1/practices/4/payment-settings')
            && $r->data() === ['international' => true, 'fxRate' => 18000, 'markupPercent' => 10.5, 'fixedFeeIdr' => 25000]);
    }

    public function test_isian_kosong_dikirim_sebagai_null(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response(['data' => self::VIEW], 200)]);

        $this->withSession($this->adminKlinik())->post(self::URL, ['fxRate' => '', 'markupPercent' => '', 'fixedFeeIdr' => ''])
            ->assertRedirect(self::URL);

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT'
            && $r->data() === ['international' => false, 'fxRate' => null, 'markupPercent' => null, 'fixedFeeIdr' => null]);
    }

    // Daftar klinik publik di-cache 5 menit (BookingApi::practicesTercache).
    // Tanpa ini halaman booking menunggu cache itu habis sebelum perubahan
    // terlihat.
    public function test_simpan_membuang_cache_daftar_klinik_publik(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response(['data' => self::VIEW], 200)]);
        cache()->put('pq_public_practices', [['id' => '4', 'name' => 'Klinik Sehat']], now()->addMinutes(5));

        $this->withSession($this->super())->put(self::URL, ['international' => '1', 'fxRate' => '18000']);

        $this->assertNull(cache()->get('pq_public_practices'));
    }

    public function test_penolakan_validasi_backend_ditampilkan_per_kolom(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response([
            'type' => '/errors/validation-error', 'title' => 'Validation Error', 'status' => 422,
            'code' => 'invalid_input', 'detail' => 'Payment settings are invalid',
            'fields' => ['fxRate' => ['Number must be greater than or equal to 1000']],
        ], 422)]);
        cache()->put('pq_public_practices', [['id' => '4']], now()->addMinutes(5));

        $res = $this->withSession($this->super())->put(self::URL, ['international' => '1', 'fxRate' => '16.5']);

        $res->assertRedirect(self::URL);
        $res->assertSessionHasErrors(['fxRate' => 'Number must be greater than or equal to 1000']);
        $this->assertStringContainsString('fxRate: Number must be greater than or equal to 1000', session('pembayaranGagal'));
        // Gagal = tidak ada yang berubah, jadi cache-nya tidak perlu dibuang.
        $this->assertNotNull(cache()->get('pq_public_practices'));
    }

    public function test_kurs_wajib_untuk_klinik_internasional(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response([
            'status' => 422, 'code' => 'fx_rate_required', 'detail' => 'An international clinic needs a usable rate',
            'fields' => ['fxRate' => ['A usable rate is required']],
        ], 422)]);

        $res = $this->withSession($this->super())->put(self::URL, ['international' => '1']);

        $res->assertSessionHasErrors('fxRate');
        $this->assertStringContainsString('butuh kurs', session('pembayaranGagal'));
    }

    // Kontrak backend: 503 payment_settings_unavailable pada PUT bisa datang dari
    // pembacaan ulang SETELAH pengaturannya tersimpan, jadi halaman tidak boleh
    // mengaku "tidak ada yang berubah". (Retry-After 0: PraktiquApi mengulang PUT
    // yang dijawab 503, dan header ini membuat jedanya nol.)
    public function test_503_pada_simpan_tidak_mengaku_tidak_ada_yang_berubah(): void
    {
        Http::fake(['*/api/v1/practices/4/payment-settings' => Http::response([
            'status' => 503, 'code' => 'payment_settings_unavailable',
        ], 503, ['Retry-After' => '0'])]);

        $res = $this->withSession($this->super())->put(self::URL, ['international' => '1', 'fxRate' => '18000']);

        $res->assertRedirect(self::URL);
        $this->assertStringContainsString('Muat ulang halaman', session('pembayaranGagal'));
        $this->assertStringNotContainsString('tidak ada yang berubah', session('pembayaranGagal'));
    }

    public function test_isian_bukan_angka_ditolak_sebelum_ke_backend(): void
    {
        Http::fake();

        $this->withSession($this->super())->from(self::URL)->put(self::URL, ['fxRate' => 'enam belas ribu'])
            ->assertSessionHasErrors('fxRate');

        Http::assertNothingSent();
    }

    // ── Pintu masuk di dashboard ────────────────────────────────────────

    public function test_kartu_klinik_super_admin_membawa_lencana_dan_tautan(): void
    {
        Http::fake(function ($req) {
            if (str_contains($req->url(), 'api/v1/practices')) {
                return Http::response(['items' => [['id' => 4, 'name' => 'Klinik Sehat', 'international' => true]]]);
            }

            return Http::response(['data' => []]);
        });

        $res = $this->withSession($this->super())->get('/admin');

        $this->assertTrue($res->viewData('payload')['clinics'][0]['international']);
        $res->assertSee("'/dashboard/klinik/' + r.id + '/pembayaran-internasional'", false);
        $res->assertSee('Pengaturan pembayaran');
    }

    public function test_klinik_tanpa_flag_tidak_internasional(): void
    {
        Http::fake(function ($req) {
            if (str_contains($req->url(), 'api/v1/practices')) {
                return Http::response(['items' => [['id' => 4, 'name' => 'Klinik Sehat']]]);
            }

            return Http::response(['data' => []]);
        });

        $res = $this->withSession($this->super())->get('/admin');

        $this->assertFalse($res->viewData('payload')['clinics'][0]['international']);
    }

    public function test_menu_pengaturan_admin_klinik_menuju_kliniknya_sendiri(): void
    {
        Http::fake(fn () => Http::response(['data' => []]));

        $this->withSession($this->adminKlinik())->get('/klinik')
            ->assertOk()
            ->assertSee('href="/dashboard/klinik/4/pembayaran-internasional"', false);
    }

    public function test_menu_pengaturan_tidak_tampil_untuk_resepsionis(): void
    {
        Http::fake(fn () => Http::response(['data' => []]));

        $this->withSession($this->resepsionis())->get('/klinik')
            ->assertOk()
            ->assertDontSee('pembayaran-internasional', false);
    }
}
```

- [ ] **Step 2: Run it — expected FAIL**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter PengaturanPembayaranKlinikTest
```

Expected: `Tests: 26, Assertions: 29, Errors: 2, Failures: 18`. The two errors are the dashboard tests (`Undefined array key "international"`); the 18 failures are every page/save/menu test (the route does not exist, so they get 404 or a missing string). Six tests already pass for the wrong reason: five expect a 404 and there is no route yet, and `test_menu_pengaturan_tidak_tampil_untuk_resepsionis` only expects the new menu to be absent. Once Step 5 registers the route, the five 404s come from the controller's access check, and `test_super_admin_bisa_membuka_klinik_mana_pun` / `test_admin_klinik_bisa_membuka_kliniknya_sendiri` (which need the route) prove the check lets the right roles through.

- [ ] **Step 3: Create the controller**

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/KlinikPembayaranController.php` with exactly this content:

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\View\View;

/**
 * Pengaturan pembayaran internasional satu klinik: flag International, kurs,
 * markup, dan fee flat.
 *
 * Halaman tersendiri, mengikuti GoogleCalendarController dan
 * dashboard/kalender.blade.php — bukan tab di dashboard.blade.php. Halaman ini
 * tidak menghitung kurs apa pun: aturan validasi, nilai global, dan contoh
 * konversinya milik backend (GET/PUT /api/v1/practices/{id}/payment-settings).
 *
 * Akses: super admin untuk klinik mana pun; admin klinik hanya untuk kliniknya
 * sendiri, dan hanya kalau profilnya membawa canManageClinicPayment (role
 * mentah CLINIC_ADMIN — resepsionis berbagi role 'admin' di FE ini, lihat
 * AuthController::kelolaPembayaranKlinik). Selain itu 404, sebelum satu
 * request pun ke backend. Backend menegakkan aturan yang sama; ini lapis kedua.
 */
class KlinikPembayaranController extends Controller
{
    /**
     * Kolom angka di form. Namanya sengaja SAMA dengan field backend, supaya
     * galat per kolom dari backend (`fields`) jatuh langsung ke kolomnya.
     */
    private const KOLOM_ANGKA = ['fxRate', 'markupPercent', 'fixedFeeIdr'];

    public function __construct(private readonly PraktiquApi $api) {}

    private function bolehMengatur(string $id): bool
    {
        $p = AuthController::validProfile() ?? [];

        return match ($p['role'] ?? null) {
            'super' => true,
            'admin' => ! empty($p['canManageClinicPayment'])
                && (string) ($p['practiceId'] ?? '') === $id,
            default => false,
        };
    }

    public function index(string $id): View
    {
        abort_unless($this->bolehMengatur($id), 404);

        $pengaturan = null;
        try {
            $res = $this->api->get("api/v1/practices/{$id}/payment-settings");
            // PraktiquApi::unwrap() sudah membuka {data: …}; dua-duanya
            // ditangani supaya perubahan bentuk di salah satu sisi tidak
            // diam-diam menampilkan form kosong.
            $pengaturan = is_array($res) ? ($res['data'] ?? $res) : null;
        } catch (ApiException $e) {
            // Klinik yang tidak ada, atau di luar cakupan akun ini.
            abort_if(in_array($e->status, [403, 404], true), 404);
            logger()->warning("[klinik-pembayaran] pengaturan klinik {$id} gagal dimuat: ".$e->getMessage());
        }

        return view('dashboard.klinik-pembayaran', [
            'id' => $id,
            'nama' => $this->namaKlinik($id),
            // null = gagal dimuat. Form TIDAK ditampilkan dalam keadaan itu:
            // PUT mengganti seluruh objek, jadi menyimpan form kosong akan
            // menghapus pengaturan klinik yang sebenarnya ada.
            'pengaturan' => is_array($pengaturan) ? $pengaturan : null,
            'kembali' => (AuthController::validProfile()['role'] ?? null) === 'super' ? '/admin' : '/klinik',
        ]);
    }

    /**
     * Nama klinik untuk judul halaman. Super admin bisa membuka klinik mana
     * pun, jadi halaman harus menyebut klinik mana yang sedang diubah.
     */
    private function namaKlinik(string $id): string
    {
        try {
            $p = $this->api->get("api/v1/practices/{$id}");
            $nama = is_array($p) ? trim((string) (($p['data'] ?? $p)['name'] ?? '')) : '';
        } catch (ApiException) {
            $nama = '';
        }

        return $nama !== '' ? $nama : 'Klinik #'.$id;
    }

    public function simpan(Request $request, string $id): RedirectResponse
    {
        abort_unless($this->bolehMengatur($id), 404);

        // Hanya bentuknya yang diperiksa di sini. Rentang dan aturan silang
        // (klinik internasional butuh kurs) milik backend, dan galatnya
        // dikembalikan per kolom di bawah.
        $request->validate(
            array_fill_keys(self::KOLOM_ANGKA, ['nullable', 'numeric']),
            array_fill_keys(
                array_map(fn ($k) => $k.'.numeric', self::KOLOM_ANGKA),
                'Isi dengan angka saja, tanpa titik ribuan — mis. 16500.'
            )
        );

        $badan = ['international' => $request->boolean('international')];
        foreach (self::KOLOM_ANGKA as $k) {
            $badan[$k] = self::angka($request->input($k));
        }

        try {
            $this->api->call('PUT', "api/v1/practices/{$id}/payment-settings", [], $badan);
        } catch (ApiException $e) {
            abort_if(in_array($e->status, [403, 404], true), 404);

            return redirect()->route('klinik.pembayaran', ['id' => $id])
                ->withInput()
                ->withErrors(self::galatPerKolom($e->body))
                ->with('pembayaranGagal', self::pesanGagal($e));
        }

        // Daftar klinik publik di-cache 5 menit (BookingApi::practicesTercache).
        // Dibuang supaya halaman booking tidak menunggu cache itu habis.
        Cache::forget('pq_public_practices');

        return redirect()->route('klinik.pembayaran', ['id' => $id])
            ->with('pembayaranPesan', 'Pengaturan pembayaran tersimpan.');
    }

    /**
     * Isian form → angka JSON. Kosong = null (pakai nilai global, atau tanpa
     * fee). Bilangan bulat dikirim sebagai integer: fixedFeeIdr wajib integer
     * di backend.
     */
    private static function angka(mixed $v): int|float|null
    {
        $v = trim((string) $v);
        if ($v === '') {
            return null;
        }
        $n = (float) $v;

        return floor($n) === $n && abs($n) < 1e15 ? (int) $n : $n;
    }

    /** `fields` dari problem+json backend → galat Laravel per kolom form. */
    private static function galatPerKolom(mixed $body): array
    {
        $fields = is_array($body) && is_array($body['fields'] ?? null) ? $body['fields'] : [];
        $out = [];
        foreach ($fields as $kolom => $pesan) {
            $out[(string) $kolom] = is_array($pesan) ? implode(' ', array_map('strval', $pesan)) : (string) $pesan;
        }

        return $out;
    }

    private static function pesanGagal(ApiException $e): string
    {
        // `code` adalah slug stabil problem+json backend; `title`/`detail`
        // berbahasa Inggris dan bisa berubah kapan saja.
        $code = is_array($e->body) ? ($e->body['code'] ?? '') : '';

        return match (true) {
            $code === 'fx_rate_required' => 'Klinik internasional butuh kurs: isi Kurs, atau minta tim PraktiQu mengisi kurs global lebih dulu.',
            $e->status === 422 => 'Pengaturan belum tersimpan — periksa isian yang ditandai.'.ResourceController::rincianValidasi($e->body),
            // Sengaja TIDAK berkata "tidak ada yang berubah": 503
            // payment_settings_unavailable pada PUT bisa datang dari pembacaan
            // ulang SETELAH pengaturannya tersimpan, dan koneksi yang putus
            // setelah request berangkat pun tidak membuktikan apa-apa. PUT
            // mengganti seluruh objek, jadi menyimpan lagi aman.
            $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah pengaturan tersimpan. Muat ulang halaman untuk melihat nilai terbaru, lalu simpan lagi bila perlu.',
            default => 'Pengaturan belum tersimpan.'.ResourceController::rincianValidasi($e->body),
        };
    }
}
```

- [ ] **Step 4: Create the view**

The checkbox has a hidden `international=0` twin so `old('international')` is only null when the form was never submitted; `$request->boolean('international')` reads `'0'` as false.

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard/klinik-pembayaran.blade.php` with exactly this content:

```blade
@extends('layouts.base')

{{-- Pengaturan pembayaran internasional satu klinik — lihat
     KlinikPembayaranController.

     Halaman tersendiri, bukan bagian dashboard.blade.php, sama seperti
     dashboard/kalender.blade.php.

     Halaman ini TIDAK menghitung kurs. Placeholder nilai global, metode yang
     berlaku, dan contoh konversi semuanya jawaban backend: satu fungsi di sana
     menghasilkan angka yang ditampilkan ke pasien sekaligus yang ditagih, dan
     salinan rumusnya di sini hanya akan menjadi angka ketiga yang bisa
     berbeda. --}}

@php
  $aksen  = '#425FAD';
  $teks   = '#1E2236';
  $redup  = '#6B7090';
  $garis  = '#DDE1EC';
  $p          = $pengaturan ?? [];
  $tersimpan  = $p['stored'] ?? [];
  $efektif    = $p['effective'] ?? [];
  $global     = $p['globalDefaults'] ?? [];
  $contoh     = $p['example'] ?? null;

  // Angka gaya Indonesia tanpa ekor ",00": 16500 → "16.500", 16500.5 → "16.500,5".
  $angka = fn ($n) => rtrim(rtrim(number_format((float) $n, 2, ',', '.'), '0'), ',');

  // Isian yang baru saja ditolak menang atas nilai tersimpan (withInput),
  // supaya yang diketik tidak hilang.
  $nilai = fn (string $k) => old($k, isset($tersimpan[$k]) ? (string) $tersimpan[$k] : '');
  // Kotak centang punya pasangan input tersembunyi bernilai 0, jadi old()
  // hanya null kalau form ini memang belum pernah dikirim.
  $internasional = old('international') !== null
      ? old('international') === '1'
      : (bool) ($tersimpan['international'] ?? false);

  $phKurs   = isset($global['fxRate']) ? 'kosong = kurs global Rp '.$angka($global['fxRate']) : 'kosong = belum ada kurs global';
  $phMarkup = isset($global['markupPercent']) ? 'kosong = global '.$angka($global['markupPercent']).'%' : 'kosong = 0%';

  $namaMetode = ['xendit' => 'Xendit (IDR)', 'paypal' => 'PayPal (USD)', 'card' => 'Kartu (USD)'];
  $metode = $efektif['methods'] ?? ['xendit'];

  // WIB, seperti dashboard/kalender.blade.php: backend mengirim updatedAt
  // sebagai instan UTC, dan zona aplikasi ini UTC. Bahasa bulan Indonesia
  // eksplisit, karena APP_LOCALE aplikasi ini 'en'.
  $tanggal = function (?string $iso) {
      if (! $iso) return null;
      try { return \Carbon\Carbon::parse($iso)->timezone('Asia/Jakarta')->locale('id')->translatedFormat('j F Y, H:i').' WIB'; }
      catch (\Throwable) { return null; }
  };
  $diubah = $tanggal($p['updatedAt'] ?? null);
  $oleh   = $p['updatedBy']['name'] ?? null;

  $kolom = 'width:100%;box-sizing:border-box;border:1.5px solid '.$garis.';border-radius:11px;padding:10px 12px;font-size:14px;color:'.$teks;
  $label = 'display:block;font-size:13px;font-weight:600;color:'.$teks.';margin-bottom:6px';
  $galat = 'font-size:12.5px;color:#9B2C2C;margin-top:5px;line-height:1.5';
@endphp

@section('title', 'Pembayaran Internasional — '.$nama.' — PraktiQu')

@section('content')
<div style="max-width:720px;margin:0 auto;padding:28px 20px 64px">

  <a href="{{ $kembali }}" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke dashboard</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 6px">
    Pembayaran Internasional
  </h1>
  <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 24px">
    {{ $nama }} — kurs, markup, dan fee flat untuk pasien yang membayar dengan
    PayPal atau Kartu. Xendit (Rupiah) tidak terpengaruh.
  </p>

  @if (session('pembayaranPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:20px;font-size:14px;font-weight:700;color:#1B6B4A">
      {{ session('pembayaranPesan') }}
    </div>
  @endif
  @if (session('pembayaranGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#9B2C2C;line-height:1.6">
      {{ session('pembayaranGagal') }}
    </div>
  @endif

  @if ($pengaturan === null)
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px">
      <div style="font-size:14px;font-weight:700;color:#9B2C2C">Pengaturan pembayaran tidak bisa dimuat.</div>
      <div style="font-size:13px;color:#7A3B3B;margin-top:4px;line-height:1.6">
        Tidak ada yang diubah. Muat ulang halaman untuk mencoba lagi.
      </div>
    </div>
  @else
    @if (($tersimpan['international'] ?? false) && ! in_array('paypal', $metode, true))
      <div style="border:1.5px solid #F3E2BE;background:#FFF6E5;border-radius:14px;padding:14px 16px;margin-bottom:20px;font-size:13.5px;color:#7A5A00;line-height:1.6">
        Klinik ini ditandai internasional, tetapi belum ada kurs yang berlaku — PayPal dan Kartu belum ditawarkan ke pasien sampai kurs diisi.
      </div>
    @endif

    <form method="POST" action="{{ route('klinik.pembayaran.simpan', ['id' => $id]) }}"
          style="border:1.5px solid {{ $garis }};border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:18px">
      @csrf
      @method('PUT')

      <label style="display:flex;gap:12px;align-items:flex-start;cursor:pointer">
        <input type="hidden" name="international" value="0">
        <input type="checkbox" name="international" value="1" @checked($internasional)
               style="accent-color:{{ $aksen }};width:18px;height:18px;margin-top:2px">
        <span>
          <span style="display:block;font-size:15px;font-weight:700;color:{{ $teks }}">Klinik Internasional</span>
          <span style="display:block;font-size:13px;color:{{ $redup }};margin-top:2px">terima PayPal &amp; Kartu, dibayar dalam USD</span>
        </span>
      </label>
      @error('international') <div style="{{ $galat }}">{{ $message }}</div> @enderror

      <div>
        <label for="pb-kurs" style="{{ $label }}">Kurs (Rp per 1 USD)</label>
        <input id="pb-kurs" name="fxRate" inputmode="decimal" autocomplete="off" value="{{ $nilai('fxRate') }}" placeholder="{{ $phKurs }}" style="{{ $kolom }}">
        @error('fxRate') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </div>

      <div>
        <label for="pb-markup" style="{{ $label }}">Markup %</label>
        <input id="pb-markup" name="markupPercent" inputmode="decimal" autocomplete="off" value="{{ $nilai('markupPercent') }}" placeholder="{{ $phMarkup }}" style="{{ $kolom }}">
        @error('markupPercent') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </div>

      <div>
        <label for="pb-fee" style="{{ $label }}">Fee flat (Rp)</label>
        <input id="pb-fee" name="fixedFeeIdr" inputmode="numeric" autocomplete="off" value="{{ $nilai('fixedFeeIdr') }}" placeholder="kosong = tanpa fee" style="{{ $kolom }}">
        <div style="font-size:12px;color:{{ $redup }};margin-top:5px;line-height:1.5">Satu baris "International service fee" per pesanan, tanpa markup.</div>
        @error('fixedFeeIdr') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </div>

      <div>
        <button type="submit"
                style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">
          Simpan Pengaturan
        </button>
      </div>
    </form>

    <div style="font-size:13px;color:{{ $redup }};margin-top:14px;line-height:1.6">
      Metode yang ditawarkan ke pasien sekarang:
      <b style="color:{{ $teks }}">{{ implode(', ', array_map(fn ($m) => $namaMetode[$m] ?? $m, $metode)) }}</b>
    </div>

    {{-- Contoh dari backend, dengan nilai yang berlaku sekarang. null = belum
         ada kurs yang bisa dipakai, jadi memang tidak ada yang bisa dicontohkan. --}}
    @if ($contoh)
      <div style="border:1.5px solid {{ $garis }};border-radius:16px;padding:18px 20px;margin-top:20px">
        <div style="font-size:14px;font-weight:700;color:{{ $teks }};margin-bottom:10px">Contoh konversi</div>
        <dl style="margin:0;display:grid;grid-template-columns:1fr auto;gap:8px 18px;font-size:13.5px">
          <dt style="color:{{ $redup }}">Layanan Rp {{ $angka($contoh['idr'] ?? 0) }}</dt>
          <dd style="margin:0;color:{{ $teks }};text-align:right">${{ $contoh['price'] ?? '—' }}</dd>
          @foreach ($contoh['taxes'] ?? [] as $pajak)
            <dt style="color:{{ $redup }}">{{ $pajak['name'] ?? 'Pajak' }}</dt>
            <dd style="margin:0;color:{{ $teks }};text-align:right">${{ $pajak['amount'] ?? '—' }}</dd>
          @endforeach
          @if (! empty($contoh['fee']))
            <dt style="color:{{ $redup }}">International service fee</dt>
            <dd style="margin:0;color:{{ $teks }};text-align:right">${{ $contoh['fee'] }}</dd>
          @endif
          <dt style="color:{{ $teks }};font-weight:700">Total</dt>
          <dd style="margin:0;color:{{ $teks }};font-weight:800;text-align:right">${{ $contoh['total'] ?? '—' }}</dd>
        </dl>
        <div style="font-size:12px;color:{{ $redup }};margin-top:10px;line-height:1.5">
          Dihitung sistem dengan nilai yang berlaku sekarang. Jumlah akhir yang dibayar pasien selalu yang tertera di halaman PayPal.
        </div>
      </div>
    @endif

    @if ($diubah)
      <div style="font-size:12.5px;color:{{ $redup }};margin-top:16px">
        Terakhir diubah{{ $oleh ? ' oleh '.$oleh : '' }} pada {{ $diubah }}
      </div>
    @endif
  @endif
</div>
@endsection
```

- [ ] **Step 5: Register the routes (inside the `staff:any` group, before the `/{tenant}` catch-all)**

Import (line 9):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/routes/web.php` replace

```php
use App\Http\Controllers\HomeController;
```

with

```php
use App\Http\Controllers\HomeController;
use App\Http\Controllers\KlinikPembayaranController;
```

Routes (after the `DELETE /dashboard/layanan/{id}` line, line 101, still inside `Route::middleware('staff:any')->group(...)`). `staff:any` sends an expired session to `/staff/login`; the role/clinic check is in the controller. The `/{tenant}` regex is NOT changed: these paths have four segments and can never match the single-segment catch-all.

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/routes/web.php` replace

```php
    Route::delete('/dashboard/layanan/{id}', [ServiceController::class, 'destroy'])->whereNumber('id');
```

with

```php
    Route::delete('/dashboard/layanan/{id}', [ServiceController::class, 'destroy'])->whereNumber('id');
    // Pembayaran internasional satu klinik: flag International, kurs, markup,
    // fee flat. Super admin untuk klinik mana pun, admin klinik hanya kliniknya
    // sendiri — diperiksa KlinikPembayaranController, karena role 'admin' di FE
    // ini juga dipakai resepsionis. Empat segmen: tidak bersinggungan dengan
    // /{tenant} di bawah, dan pola slug cadangannya tidak perlu diubah.
    Route::get('/dashboard/klinik/{id}/pembayaran-internasional', [KlinikPembayaranController::class, 'index'])
        ->whereNumber('id')->name('klinik.pembayaran');
    Route::match(['put', 'post'], '/dashboard/klinik/{id}/pembayaran-internasional', [KlinikPembayaranController::class, 'simpan'])
        ->whereNumber('id')->name('klinik.pembayaran.simpan');
```

- [ ] **Step 6: `DashboardController` — `international` per clinic, and the clinic admin's menu URL**

`mapClinic()` (lines 911–925; `PracticeDTO.international` is a boolean, missing on an older backend):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/DashboardController.php` replace

```php
            'id' => $r['id'] ?? null,
            'slug' => BookingApi::slugify($r['name'] ?? '') ?: (string) ($r['id'] ?? ''),
        ];
```

with

```php
            'id' => $r['id'] ?? null,
            'slug' => BookingApi::slugify($r['name'] ?? '') ?: (string) ($r['id'] ?? ''),
            // Lencana "International" di kartu klinik super admin. Hanya
            // penanda — metode dan harga USD pasien tetap ditentukan backend.
            'international' => ($r['international'] ?? null) === true,
        ];
```

`render()` (line 1594; `$profile` is already read from the session a few lines above):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/DashboardController.php` replace

```php
        return view('dashboard', [
            'role' => $role,
            'payload' => array_merge([
```

with

```php
        return view('dashboard', [
            'role' => $role,
            // Pintu ke pengaturan pembayaran internasional kliniknya sendiri:
            // hanya admin klinik yang role mentahnya CLINIC_ADMIN
            // (canManageClinicPayment, lihat AuthController). Super admin masuk
            // dari kartu klinik; resepsionis tidak sama sekali.
            'pembayaranKlinikUrl' => $role === 'admin' && ! empty($profile['canManageClinicPayment']) && ! empty($profile['practiceId'])
                ? route('klinik.pembayaran', ['id' => $profile['practiceId']], false)
                : null,
            'payload' => array_merge([
```

- [ ] **Step 7: Entry points in `dashboard.blade.php`**

The file is ~5,000 lines; every anchor below is unique. Clinic card badge (line 4439, in the `CLINICS` section):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard.blade.php` replace

```blade
                  <span class="badge" :class="r.active ? 'green' : 'red'" style="margin-top:7px" x-text="r.active ? 'Aktif' : 'Nonaktif'"></span>
```

with

```blade
                  <span class="badge" :class="r.active ? 'green' : 'red'" style="margin-top:7px" x-text="r.active ? 'Aktif' : 'Nonaktif'"></span>
                  <span x-show="r.international" class="badge blue" style="margin-top:7px" title="Menerima PayPal &amp; Kartu, dibayar dalam USD">International</span>
```

Clinic card link, super admin only (end of the `clinic-link` block, lines 4454–4455). It is gated in Blade, not only by `x-show`, because the clinic grid template is in the HTML for every role:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard.blade.php` replace

```blade
                  <a class="clinic-act" :href="'/' + r.slug" target="_blank" rel="noreferrer" title="Buka halaman booking di tab baru" aria-label="Buka halaman booking di tab baru"><x-icon name="external" :size="15" :sw="1.9"/></a>
                </div>
```

with

```blade
                  <a class="clinic-act" :href="'/' + r.slug" target="_blank" rel="noreferrer" title="Buka halaman booking di tab baru" aria-label="Buka halaman booking di tab baru"><x-icon name="external" :size="15" :sw="1.9"/></a>
                </div>
                {{-- Super admin saja (lihat KlinikPembayaranController). --}}
                @if (($role ?? null) === 'super')
                <a x-show="r.id != null" :href="'/dashboard/klinik/' + r.id + '/pembayaran-internasional'"
                   style="display:inline-flex;align-items:center;margin-top:10px;font-size:12.5px;font-weight:600;color:#425FAD;text-decoration:none">Pengaturan pembayaran ›</a>
                @endif
```

Clinic admin menu card in the Settings ("Pengaturan") view, right after the psikolog-only Google Calendar card (lines 4236–4238):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/dashboard.blade.php` replace

```blade
            <a class="btn-white" href="/dashboard/pengaturan/kalender" style="text-decoration:none;display:inline-flex;align-items:center">Atur Sinkronisasi</a>
          </div>
          @endif
```

with

```blade
            <a class="btn-white" href="/dashboard/pengaturan/kalender" style="text-decoration:none;display:inline-flex;align-items:center">Atur Sinkronisasi</a>
          </div>
          @endif

          {{-- Admin klinik yang berhak saja — DashboardController::render()
               mengisi $pembayaranKlinikUrl hanya untuknya. Halamannya berdiri
               sendiri: KlinikPembayaranController. --}}
          @if (! empty($pembayaranKlinikUrl))
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:15px;font-weight:700;color:#1E2236;margin-bottom:4px">Pembayaran Internasional</div>
            <div style="font-size:13px;color:#8A90A6;margin-bottom:18px;line-height:1.6">Terima PayPal &amp; Kartu dalam USD: atur kurs, markup, dan fee flat klinik Anda.</div>
            <a class="btn-white" href="{{ $pembayaranKlinikUrl }}" style="text-decoration:none;display:inline-flex;align-items:center">Pengaturan Pembayaran</a>
          </div>
          @endif
```

- [ ] **Step 8: Run the new test and the neighbouring dashboard tests — expected PASS**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'PengaturanPembayaranKlinikTest|PengaturanKalenderTest|DashboardFieldMappingTest|DeadFeatureAuditTest|StaffAccessTest|DashboardKartuTest|SidebarBillingUiTest'
```

Expected: `OK` (`PengaturanPembayaranKlinikTest` alone: `OK (26 tests, 68 assertions)`).

- [ ] **Step 9: Full suite**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit
```

Expected: `OK (686 tests, 2282 assertions)` on top of e5afd8b + Task C1 (baseline count + 36 if `main` moved).

- [ ] **Step 10: Commit**

```bash
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional add app/Http/Controllers/KlinikPembayaranController.php resources/views/dashboard/klinik-pembayaran.blade.php routes/web.php app/Http/Controllers/DashboardController.php resources/views/dashboard.blade.php tests/Feature/PengaturanPembayaranKlinikTest.php
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): halaman pengaturan pembayaran internasional per klinik

Kurs, markup, dan fee flat klinik internasional diubah dari FE lewat
GET/PUT /api/v1/practices/{id}/payment-settings. Super admin untuk klinik
mana pun (lencana + tautan di kartu klinik), admin klinik hanya kliniknya
sendiri (kartu di Settings), resepsionis 404. Galat backend per kolom,
cache daftar klinik publik dibuang setelah simpan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task C3: Booking ke klinik yang harganya ditampilkan — layanan per klinik, `clinicId` ke slots & submit, `paymentMethods`/`usd`, kode galat bayar

**Files:**
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` (helpers above `asArray()` line 95; `mapServices()` line 195; `mapService()` lines 201–213; `resolveTenant()` lines 368–369; `submitBooking()` lines 627–632)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` (`friendly()` after line 92; `services()` lines 292–295; `submit()` lines 589–591 and 603–608)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/ManualAppointmentController.php` (`services()` lines 186–191 — the staff dropdown keeps merging the same service across clinics, which `mapServices()` no longer does)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` (script: `svc` line 311, `loadSlots()` lines 521–529, `choosePsy()` line 555, `next()` lines 601–604 and 615; markup: service cards lines 1159–1162 and 1178)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingTautanPribadiTest.php` (line 48), `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingKonteksRegisterTest.php` (line 24) — their services fakes pin the URL without a query string
- Test: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingKlinikInternasionalTest.php` (new)

**Interfaces:** Consumes (backend, contract): `GET /api/v1/public/professionals/{id}/services[?clinicId=]` rows gain `clinicId: number`, `paymentMethods: ('xendit'|'paypal'|'card')[]`, `usd: { price: string, taxes: {name, amount}[], fee: string|null, total: string } | null`; `POST /api/v1/public/appointments` accepts `clinicId` and its answer (`{ data: CreatedAppointment }`) gains `paymentMethods`, `usd`; `POST /api/v1/public/payments` errors (problem+json `code`): 403 `payment_method_not_allowed`, 503 `paypal_rate_missing` / `payment_method_unavailable` / `payment_settings_unavailable` / `payment_unavailable`, 502 `charge_mismatch` / `payment_start_failed`. / Produces: service rows (`BookingApi::mapService`) keep the backend names `clinicId` (`?string`), `paymentMethods` (`list<string>`, never empty — `['xendit']` when missing), `usd` (`?array`), plus FE-private `key` (`"{id}@{clinicId}"`, or `"{id}"` without a clinic); `BookingApi::METODE_BAYAR`, `BookingApi::metodeBayar(mixed): array`, `BookingApi::usdOf(mixed): ?array`; `submitBooking()` result and the `/booking/submit` JSON gain `paymentMethods` and `usd`; `GET /booking/services` accepts `clinicId` (digits only); `/booking/submit` forwards `clinicId` to `/public/appointments`; Alpine `serviceId` now holds the row `key`; `GET /dashboard/appointments/manual-services` still answers one row per (name, duration, price) — the staff dropdown has no clinic column. Unchanged on purpose: `BookingApi::startPayment()`'s 409 branches (`payment_already_initiated` → pending, `appointment_not_pending` → `bukanMenungguBayar`) — none of the new codes is a 409.

Why: a service row's `id` is the KiviCare service id, and it repeats across a psychologist's clinics. The backend books into the **first** mapping when no `clinicId` is sent, which may be another clinic than the row whose price (and, now, USD price and methods) the patient saw. Spec §5 "Booking page".

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingKlinikInternasionalTest.php` with exactly this content:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Http\Controllers\Controller;
use App\Services\PraktiquApi;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Sleep;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Klinik internasional di halaman booking: data yang mengalir antara halaman,
// FE ini, dan backend. Tampilannya dijaga BookingTampilanUsdTest.
//
// Id layanan adalah id KiviCare, dan id itu SAMA di setiap klinik seorang
// psikolog. Psikolog 34 di sini praktik di klinik 4 (biasa: Rupiah, Xendit
// saja) dan klinik 33 (internasional: USD, PayPal & Kartu) dengan layanan 488
// yang sama. Harga yang ditampilkan dan yang ditagih hanya cocok kalau booking
// jatuh ke klinik BARIS yang dipilih pasien — backend tanpa clinicId memesan
// ke mapping pertama.
class BookingKlinikInternasionalTest extends TestCase
{
    use RefreshDatabase;

    private const USD = ['price' => '12.23', 'taxes' => [], 'fee' => '1.39', 'total' => '13.62'];

    /** Backend sebelum fitur ini: baris layanan tanpa clinicId/paymentMethods/usd. */
    private bool $backendLama = false;

    /** Jawaban POST /public/payments: [badan, status]. */
    private array $bayar = [[], 404];

    /** Satu baris /public/professionals/34/services, bentuk backend baru. */
    private static function baris(int $klinik): array
    {
        $dasar = ['id' => 488, 'name' => 'Konseling', 'price' => '200000', 'durationMinutes' => 60, 'serviceType' => 'konseling'];

        return $dasar + ($klinik === 33
            ? ['clinicId' => 33, 'paymentMethods' => ['xendit', 'paypal', 'card'], 'usd' => self::USD]
            : ['clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        Sleep::fake();
        Mail::fake();

        // Satu callback, dicocokkan per PATH: pola URL Http::fake ikut
        // mencocokkan query string, sedangkan yang diuji di sini justru
        // ada-tidaknya ?clinicId=.
        Http::fake(function (Request $r) {
            $path = (string) parse_url($r->url(), PHP_URL_PATH);
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);

            return match (true) {
                str_ends_with($path, '/public/config') => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60]),
                str_ends_with($path, '/public/practices') => Http::response(['data' => [
                    ['id' => 4, 'name' => 'Klinik Sehat'],
                    ['id' => 33, 'name' => 'Klinik Internasional'],
                ]]),
                str_ends_with($path, '/public/professionals/34/services') => Http::response(['data' => match (true) {
                    $this->backendLama => [['id' => 488, 'name' => 'Konseling', 'price' => '200000', 'durationMinutes' => 60]],
                    isset($q['clinicId']) => [self::baris((int) $q['clinicId'])],
                    default => [self::baris(4), self::baris(33)],
                }]),
                str_ends_with($path, '/public/professionals/by-slug/dianda-azani') => Http::response(['data' => ['id' => 34, 'fullName' => 'Dianda Azani']]),
                str_ends_with($path, '/public/professionals') => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]]),
                str_ends_with($path, '/public/booking/hold') => Http::response(['holdKey' => 'hold-1'], 201),
                str_ends_with($path, '/public/appointments') => Http::response(['data' => [
                    'id' => 5150, 'token' => 'tok-5150', 'status' => 'PENDING', 'clinicId' => 33,
                    'paymentMethods' => ['xendit', 'paypal', 'card'], 'usd' => self::USD,
                ]], 201),
                str_ends_with($path, '/public/payments') => Http::response(...$this->bayar),
                default => Http::response([], 404),
            };
        });
    }

    private static function layananDiminta(string $query): \Closure
    {
        return fn (Request $r) => str_ends_with((string) parse_url($r->url(), PHP_URL_PATH), '/public/professionals/34/services')
            && (string) parse_url($r->url(), PHP_URL_QUERY) === $query;
    }

    // ── Daftar layanan ──────────────────────────────────────────────────

    public function test_halaman_klinik_hanya_memuat_layanan_klinik_itu(): void
    {
        $layanan = $this->get('/klinik-internasional')->assertOk()->viewData('tenant')['services'];

        $this->assertCount(1, $layanan);
        $this->assertSame('33', $layanan[0]['clinicId']);
        $this->assertSame('488@33', $layanan[0]['key']);
        $this->assertSame('488', $layanan[0]['apiId']);
        $this->assertSame(['xendit', 'paypal', 'card'], $layanan[0]['paymentMethods']);
        $this->assertSame(self::USD, $layanan[0]['usd']);
        Http::assertSent(self::layananDiminta('clinicId=33'));
    }

    public function test_pemilih_psikolog_meminta_layanan_dengan_klinik_halaman(): void
    {
        $this->getJson('/booking/services?professionalId=34&clinicId=33')
            ->assertOk()
            ->assertJsonCount(1, 'services')
            ->assertJsonPath('services.0.clinicId', '33')
            ->assertJsonPath('services.0.key', '488@33')
            ->assertJsonPath('services.0.usd.total', '13.62');

        Http::assertSent(self::layananDiminta('clinicId=33'));
    }

    public function test_klinik_yang_bukan_angka_ditolak_sebelum_ke_backend(): void
    {
        $this->getJson('/booking/services?professionalId=34&clinicId=4%20OR%201')->assertStatus(422);

        Http::assertNothingSent();
    }

    // Tautan pribadi tidak punya klinik: layanan SETIAP kliniknya tampil, dan
    // baris yang identik di dua klinik tetap dua pilihan — kliniknya yang
    // menentukan jadwal, metode bayar, dan harga USD.
    public function test_tautan_pribadi_memisahkan_baris_yang_sama_di_dua_klinik(): void
    {
        $layanan = $this->get('/dianda-azani')->assertOk()->viewData('tenant')['services'];

        $this->assertSame(['488@4', '488@33'], array_column($layanan, 'key'));
        $this->assertSame(['488', '488'], array_column($layanan, 'apiId'));
        $this->assertSame([['xendit'], ['xendit', 'paypal', 'card']], array_column($layanan, 'paymentMethods'));
        $this->assertNull($layanan[0]['usd']);
        $this->assertSame(self::USD, $layanan[1]['usd']);
        Http::assertSent(self::layananDiminta(''));
    }

    public function test_backend_lama_tanpa_kolom_baru_jatuh_ke_xendit_dan_rupiah(): void
    {
        $this->backendLama = true;

        $s = $this->getJson('/booking/services?professionalId=34')->assertOk()->json('services.0');

        $this->assertSame('488', $s['key']);
        $this->assertNull($s['clinicId']);
        $this->assertSame(['xendit'], $s['paymentMethods']);
        $this->assertNull($s['usd']);
    }

    // Dropdown layanan di form janji manual staf tidak punya kolom klinik. Super
    // admin memuatnya tanpa klinik, jadi layanan yang sama di dua klinik harus
    // tetap SATU pilihan: kunci gabung mapServices() kini memuat klinik, dan
    // tanpa penggabungan ulang di controller itu baris kembar dengan teks
    // sama (dan :key ganda di dashboard.blade.php).
    public function test_dropdown_janji_manual_staf_tidak_menggandakan_layanan_antar_klinik(): void
    {
        $staf = [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION, 'role' => 'super', 'name' => 'Staf Uji', 'userId' => 9,
            ],
        ];

        $this->withSession($staf)
            ->getJson('/dashboard/appointments/manual-services?professionalId=34')
            ->assertOk()
            ->assertJsonCount(1, 'services')
            ->assertJsonPath('services.0.id', '488')
            ->assertJsonPath('services.0.price', 200000);
    }

    // ── Halaman ─────────────────────────────────────────────────────────

    public function test_halaman_memilih_baris_lewat_key_dan_mengirim_kliniknya(): void
    {
        $html = $this->get('/klinik-internasional')->assertOk()->getContent();

        $this->assertStringContainsString('this.services.find((x) => x.key === this.serviceId)', $html);
        $this->assertStringContainsString('<template x-for="x in services" :key="x.key">', $html);
        $this->assertStringContainsString('const klinik = row.clinicId || tenant.apiId;', $html);
        $this->assertStringContainsString('&serviceId=${encodeURIComponent(row.apiId)}', $html);
        $this->assertStringContainsString('/booking/services?professionalId=${encodeURIComponent(p.apiId)}${clinicQ}', $html);
        $this->assertStringContainsString('clinicId: this.svc.clinicId ? String(this.svc.clinicId)', $html);
    }

    // ── Submit ──────────────────────────────────────────────────────────

    private function pesan(array $tambahan = [])
    {
        return $this->postJson('/booking/submit', array_merge([
            'professionalId' => '34',
            'serviceId' => '488',
            'date' => now('Asia/Jakarta')->addDays(30)->format('Y-m-d'),
            'startTime' => '14:00',
            'price' => 200000,
            'clientName' => 'Sari Wulandari',
            'clientEmail' => 'sari@example.com',
            'clientMobile' => '081234567890',
        ], $tambahan));
    }

    public function test_submit_meneruskan_klinik_baris_yang_dipilih(): void
    {
        $this->pesan(['clinicId' => '33', 'tenant' => 'dianda-azani'])->assertOk();

        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/public/appointments')
            && ($r->data()['clinicId'] ?? null) === '33');
    }

    public function test_submit_tanpa_klinik_tidak_mengarang_klinik(): void
    {
        $this->pesan()->assertOk();

        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/public/appointments')
            && ! array_key_exists('clinicId', $r->data()));
    }

    public function test_jawaban_submit_membawa_metode_dan_harga_usd(): void
    {
        $this->pesan(['clinicId' => '33'])
            ->assertOk()
            ->assertJsonPath('clinicId', '33')
            ->assertJsonPath('paymentMethods', ['xendit', 'paypal', 'card'])
            ->assertJsonPath('usd', self::USD);
    }

    // ── Bayar ───────────────────────────────────────────────────────────

    // 403, bukan 409: BookingApi::startPayment membaca setiap 409 selain
    // appointment_not_pending sebagai "order sudah menunggu" dan menyembunyikan
    // semua tombol bayar.
    public function test_metode_yang_tidak_diizinkan_dijawab_galat_bukan_pending(): void
    {
        $this->bayar = [['type' => 'https://praktiqu.example.com/problems/forbidden', 'title' => 'Forbidden',
            'status' => 403, 'code' => 'payment_method_not_allowed', 'detail' => 'PayPal is not available for this clinic'], 403];

        $res = $this->postJson('/booking/pay', ['token' => 'tok-5150', 'method' => 'paypal']);

        $res->assertStatus(Controller::UPSTREAM_REJECTED);
        $res->assertJsonMissingPath('pending');
        $this->assertSame('Metode ini tidak tersedia untuk klinik ini. Silakan pilih metode pembayaran lain.', $res->json('message'));
        $this->assertSame('403/payment_method_not_allowed', $res->json('ref'));
    }

    public static function paypalTutup(): array
    {
        return [
            'kurs belum ada' => ['paypal_rate_missing'],
            'gateway mati' => ['payment_method_unavailable'],
        ];
    }

    #[DataProvider('paypalTutup')]
    public function test_paypal_yang_tutup_menyarankan_xendit(string $code): void
    {
        $this->bayar = [['title' => 'Service Unavailable', 'status' => 503, 'code' => $code], 503];

        $res = $this->postJson('/booking/pay', ['token' => 'tok-5150', 'method' => 'paypal']);

        $res->assertStatus(Controller::UPSTREAM_REJECTED);
        $this->assertSame('PayPal sementara tidak tersedia, silakan pakai Xendit.', $res->json('message'));
    }

    public static function gangguanSesaat(): array
    {
        return [
            'pengaturan tak terbaca' => ['payment_settings_unavailable', 503],
            'woocommerce mati' => ['payment_unavailable', 503],
            'total tidak cocok' => ['charge_mismatch', 502],
            'plugin gagal' => ['payment_start_failed', 502],
        ];
    }

    #[DataProvider('gangguanSesaat')]
    public function test_gangguan_sesaat_mengajak_mencoba_lagi(string $code, int $status): void
    {
        $this->bayar = [['status' => $status, 'code' => $code], $status];

        $res = $this->postJson('/booking/pay', ['token' => 'tok-5150', 'method' => 'card']);

        $res->assertStatus(Controller::UPSTREAM_REJECTED);
        $this->assertSame('Halaman pembayaran belum bisa dibuka karena gangguan sesaat, dan belum ada yang ditagih. Coba lagi sebentar lagi.', $res->json('message'));
    }
}
```

- [ ] **Step 2: Run it — expected FAIL**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter BookingKlinikInternasionalTest
```

Expected: `Tests: 17, Assertions: 37, Errors: 2, Failures: 13` — `Undefined array key "clinicId"` / `"key"` (rows have no such keys), the services request carries no `clinicId`, the submit body has no `clinicId`, the pay messages are the old generic ones. Two tests already pass because they guard behaviour that must NOT change: `test_submit_tanpa_klinik_tidak_mengarang_klinik` (the "no clinic" case) and `test_dropdown_janji_manual_staf_tidak_menggandakan_layanan_antar_klinik` (it only turns red once Step 3 makes `mapServices()` clinic-aware, until Step 4 re-merges the staff dropdown).

- [ ] **Step 3: `BookingApi` — map the new fields, ask per clinic, pass them back from submit**

Two public helpers, above `asArray()` (line 95). `metodeBayar()` and `usdOf()` are reused by `submitBooking()` below:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` replace

```php
    private static function asArray(mixed $v): array
    {
```

with

```php
    /** Metode pembayaran yang dikenal halaman booking, urutan tampilnya. */
    public const METODE_BAYAR = ['xendit', 'paypal', 'card'];

    /**
     * `paymentMethods` dari backend → daftar yang dikenal halaman booking.
     *
     * Kosong, hilang (backend lama), atau berisi nilai asing → hanya Xendit:
     * gagal-tertutup, sama seperti backend yang menolak PayPal/Kartu untuk
     * klinik yang bukan internasional.
     */
    public static function metodeBayar(mixed $v): array
    {
        $m = is_array($v) ? array_values(array_intersect(self::METODE_BAYAR, array_map('strval', $v))) : [];

        return $m ?: ['xendit'];
    }

    /**
     * `usd` dari backend — `{price, taxes[{name, amount}], fee, total}`, semua
     * string 2 desimal — atau null. Bentuk yang tidak utuh dibaca null, jadi
     * halaman tetap menampilkan Rupiah. FE ini tidak pernah mengonversi kurs
     * sendiri: angka dolar yang tampil adalah angka yang ditagih.
     */
    public static function usdOf(mixed $u): ?array
    {
        if (! is_array($u) || ! isset($u['price'], $u['total'])) {
            return null;
        }

        return [
            'price' => (string) $u['price'],
            'taxes' => array_values(array_map(
                fn ($t) => ['name' => (string) ($t['name'] ?? ''), 'amount' => (string) ($t['amount'] ?? '')],
                array_filter((array) ($u['taxes'] ?? []), 'is_array')
            )),
            'fee' => isset($u['fee']) ? (string) $u['fee'] : null,
            'total' => (string) $u['total'],
        ];
    }

    private static function asArray(mixed $v): array
    {
```

`mapServices()` merge key (line 195) gains the clinic:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` replace

```php
            // Kunci dari field yang tampak di layar, bukan dari id mapping.
            $out[$m['name'].'|'.$m['dur'].'|'.$m['price']] ??= $m;
```

with

```php
            // Kunci dari field yang tampak di layar, bukan dari id mapping —
            // ditambah kliniknya. Di tautan pribadi psikolog (/{nama}) daftar
            // ini memuat layanan dari SETIAP kliniknya, dan dua baris yang
            // sama persis di dua klinik tetap dua pilihan: kliniknya yang
            // menentukan jadwal, metode bayar, dan harga USD.
            $out[$m['name'].'|'.$m['dur'].'|'.$m['price'].'|'.($m['clinicId'] ?? '')] ??= $m;
```

`mapService()` (lines 201–213) carries the new backend fields through. `id`/`apiId` stay the KiviCare service id (the staff manual-appointment form relies on `id`); the new `key` is what the booking page selects by:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` replace

```php
        $typeLabel = self::humanizeType($s['serviceType'] ?? null);

        return [
            'id' => (string) $s['id'],
            'apiId' => (string) $s['id'],
            'name' => self::humanizeName($s['name'] ?? ''),
            'desc' => $s['description'] ?? ($typeLabel ? 'Layanan '.strtolower($typeLabel) : ''),
            'dur' => ($s['durationMinutes'] ?? 60).' menit',
            'price' => (float) ($s['price'] ?? 0),
        ];
```

with

```php
        $typeLabel = self::humanizeType($s['serviceType'] ?? null);
        $klinik = $s['clinicId'] ?? null;
        $klinik = is_numeric($klinik) && (int) $klinik > 0 ? (string) (int) $klinik : null;

        return [
            'id' => (string) $s['id'],
            'apiId' => (string) $s['id'],
            // Kunci pilihan di halaman booking. `id` adalah id layanan KiviCare,
            // dan id itu SAMA di setiap klinik psikolog — di tautan pribadi satu
            // id bisa muncul untuk dua klinik, jadi `id` saja tidak lagi
            // menunjuk satu baris. Backend lama tanpa clinicId: sama dengan id.
            'key' => (string) $s['id'].($klinik !== null ? '@'.$klinik : ''),
            'name' => self::humanizeName($s['name'] ?? ''),
            'desc' => $s['description'] ?? ($typeLabel ? 'Layanan '.strtolower($typeLabel) : ''),
            'dur' => ($s['durationMinutes'] ?? 60).' menit',
            'price' => (float) ($s['price'] ?? 0),
            // Klinik pemilik baris ini. Ikut ke /booking/slots dan
            // /booking/submit, supaya janji temunya jatuh ke klinik yang
            // harganya ditampilkan — tanpa itu backend memakai mapping pertama.
            'clinicId' => $klinik,
            'paymentMethods' => self::metodeBayar($s['paymentMethods'] ?? null),
            'usd' => self::usdOf($s['usd'] ?? null),
        ];
```

`resolveTenant()` (lines 368–369): a clinic page asks only for that clinic's rows:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` replace

```php
                $raw = $this->api->get('api/v1/public/professionals/'.rawurlencode($professional['id']).'/services');
                $services = $this->mapServices($raw);
```

with

```php
                // Halaman klinik: hanya layanan psikolog DI klinik ini. Tanpa
                // clinicId backend mengirim layanan dari setiap kliniknya, dan
                // pasien bisa memilih harga (dan metode bayar) klinik lain.
                // Tautan pribadi tidak punya klinik — null dibuang
                // PraktiquApi::call(), jadi semua kliniknya ikut.
                $raw = $this->api->get(
                    'api/v1/public/professionals/'.rawurlencode($professional['id']).'/services',
                    ['clinicId' => $practice['id'] ?? null]
                );
                $services = $this->mapServices($raw);
```

`submitBooking()` return value (lines 627–632) — `BookingController::submit` returns `$res + [register, free]`, so both keys reach the page:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Services/BookingApi.php` replace

```php
        return [
            'code' => (string) $code,
            'token' => $token,
            'reference' => $id !== null ? (string) $id : null,
            'clinicId' => is_numeric($klinik) && (int) $klinik > 0 ? (string) (int) $klinik : null,
        ];
```

with

```php
        return [
            'code' => (string) $code,
            'token' => $token,
            'reference' => $id !== null ? (string) $id : null,
            'clinicId' => is_numeric($klinik) && (int) $klinik > 0 ? (string) (int) $klinik : null,
            // Metode & harga USD untuk janji temu YANG BARU DIBUAT — sumber
            // pil metode di layar sukses, menang atas daftar layanan yang
            // dirender sebelumnya (pengaturan klinik bisa berubah di antaranya).
            'paymentMethods' => self::metodeBayar($res['paymentMethods'] ?? $a['paymentMethods'] ?? null),
            'usd' => self::usdOf($res['usd'] ?? $a['usd'] ?? null),
        ];
```

- [ ] **Step 4: `BookingController` — error codes, clinic-scoped services, `clinicId` in `$slot`; `ManualAppointmentController` — staff dropdown stays merged**

`friendly()` (after the `upstream_write_rejected` branch, lines 90–92) — the new codes, matched on `code`, before the status-based `match`:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` replace

```php
        if ($code === 'upstream_write_rejected') {
            return 'Sistem klinik menolak pemesanan ini, dan tidak ada yang tersimpan. Mengulang jam yang sama kemungkinan gagal lagi — hubungi klinik dan sebutkan kode di bawah.';
        }
```

with

```php
        if ($code === 'upstream_write_rejected') {
            return 'Sistem klinik menolak pemesanan ini, dan tidak ada yang tersimpan. Mengulang jam yang sama kemungkinan gagal lagi — hubungi klinik dan sebutkan kode di bawah.';
        }

        // Pembayaran PayPal/Kartu (USD) — kode dari /public/payments. Tidak
        // satu pun 409, jadi tidak pernah menyentuh cabang 409 di
        // BookingApi::startPayment(). Dicocokkan lewat `code`, bukan status:
        // 403 dan 503 juga dipakai untuk hal lain.
        if ($code === 'payment_method_not_allowed') {
            return 'Metode ini tidak tersedia untuk klinik ini. Silakan pilih metode pembayaran lain.';
        }
        if (in_array($code, ['paypal_rate_missing', 'payment_method_unavailable'], true)) {
            return 'PayPal sementara tidak tersedia, silakan pakai Xendit.';
        }
        if (in_array($code, ['payment_settings_unavailable', 'payment_unavailable', 'charge_mismatch', 'payment_start_failed'], true)) {
            return 'Halaman pembayaran belum bisa dibuka karena gangguan sesaat, dan belum ada yang ditagih. Coba lagi sebentar lagi.';
        }
```

`services()` (lines 292–295) takes the page's clinic:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` replace

```php
        $data = $request->validate(['professionalId' => 'required|string']);

        try {
            $layanan = $this->booking->fetchServices($data['professionalId']);
```

with

```php
        $data = $request->validate([
            'professionalId' => 'required|string',
            // Klinik halaman ini. Layanan menempel ke psikolog, bukan klinik,
            // jadi tanpa ini psikolog yang praktik di dua klinik menampilkan
            // layanan (dan harga) kedua kliniknya di halaman satu klinik.
            'clinicId' => ['nullable', 'regex:/^[1-9][0-9]{0,9}$/'],
        ]);

        try {
            $layanan = $this->booking->fetchServices($data['professionalId'], $data['clinicId'] ?? null);
```

`submit()` validation comment for `clinicId` (lines 589–591) — the field is now forwarded:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` replace

```php
            // Hanya untuk pemeriksaan jadwal di mungkinTerlanjurMasuk() — BUKAN
            // clinic_id register, yang ditentukan server (konteksRegister()).
            'clinicId' => 'nullable|string|max:40',
```

with

```php
            // Klinik baris layanan yang dipilih — diteruskan ke backend (lihat
            // $slot di bawah) dan dipakai pemeriksaan jadwal di
            // mungkinTerlanjurMasuk(). BUKAN clinic_id register, yang
            // ditentukan server (konteksRegister()).
            'clinicId' => 'nullable|string|max:40',
```

`submit()` `$slot` (lines 603–608) — the chosen row's clinic goes to `/public/appointments` (the hold schema strips unknown keys, and `kunciIdempotensi()` does not read it):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` replace

```php
            'date' => $data['date'],
            'startTime' => $data['startTime'],
        ];
        $client = array_filter([
```

with

```php
            'date' => $data['date'],
            'startTime' => $data['startTime'],
        ];
        // Klinik baris yang dipilih pasien. Id layanan sama di setiap klinik
        // psikolog, dan tanpa clinicId backend memesan ke mapping PERTAMA —
        // bisa klinik lain, dengan harga dan metode bayar lain dari yang
        // ditampilkan. Backend hanya mempersempit ke klinik psikolog itu
        // sendiri; hold mengabaikan kunci ini.
        if (! empty($data['clinicId'])) {
            $slot['clinicId'] = $data['clinicId'];
        }
        $client = array_filter([
```

`ManualAppointmentController::services()` (lines 186–191) — the staff form's service dropdown. Super admin loads it without a clinic, so `fetchServices()` returns the psychologist's rows from every clinic; `mapServices()` now keeps the same service in two clinics as two rows (the booking page needs that), and the dropdown, which has no clinic column, would list it twice (with a duplicate `:key="s.id"` in `dashboard.blade.php`). The old merge key (name, duration, price) is applied again here, so the dropdown behaves exactly as before:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/ManualAppointmentController.php` replace

```php
        $services = array_map(fn ($s) => [
            'id' => $s['id'],
            'name' => $s['name'],
            'price' => $s['price'],
            'duration' => (int) $s['dur'],
        ], $raw);
```

with

```php
        // Dropdown ini tidak menampilkan klinik, jadi layanan yang sama di dua
        // klinik psikolog (super admin memuat tanpa klinik) harus tetap SATU
        // pilihan. mapServices() memisahkannya per klinik untuk halaman booking;
        // di sini dipakai lagi kunci lamanya — nama, durasi, harga.
        $services = [];
        foreach ($raw as $s) {
            $services[$s['name'].'|'.$s['dur'].'|'.$s['price']] ??= [
                'id' => $s['id'],
                'name' => $s['name'],
                'price' => $s['price'],
                'duration' => (int) $s['dur'],
            ];
        }
        $services = array_values($services);
```

- [ ] **Step 5: `booking.blade.php` — select rows by `key`, send the row's clinic**

The file is ~1,600 lines; each anchor below is unique.

`svc` getter (line 311):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
    get svc() { return this.services.find((x) => x.id === this.serviceId) || null; },
```

with

```js
    // `key`, bukan `id`: id layanan KiviCare sama di setiap klinik psikolog,
    // jadi di tautan pribadi satu id bisa menunjuk dua baris (dua klinik).
    // Lihat BookingApi::mapService().
    get svc() { return this.services.find((x) => x.key === this.serviceId) || null; },
```

`loadSlots()` (lines 521–529) — the row's KiviCare id and the row's clinic go to `/booking/slots`:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
      const svc = this.serviceId;
      const key = this.slotKey(iso);
      if (this.slotCache[key] || !this.psy.apiId || !svc) return;
      try {
        // clinicId ikut dikirim: psikolog bisa praktik di beberapa klinik dengan
        // jadwal berbeda, dan halaman ini terikat pada SATU klinik. Tanpa itu
        // backend memakai klinik default psikolognya — jadwal klinik lain.
        const clinicQ = tenant.apiId ? `&clinicId=${encodeURIComponent(tenant.apiId)}` : "";
        const res = await fetch(`/booking/slots?professionalId=${encodeURIComponent(this.psy.apiId)}&serviceId=${encodeURIComponent(svc)}&date=${iso}${clinicQ}`, { headers: { "Accept": "application/json" } });
```

with

```js
      const svc = this.serviceId;
      const row = this.svc;
      const key = this.slotKey(iso);
      if (this.slotCache[key] || !this.psy.apiId || !svc || !row) return;
      try {
        // clinicId ikut dikirim: psikolog bisa praktik di beberapa klinik dengan
        // jadwal berbeda. Klinik BARIS yang dipilih lebih dulu — di tautan
        // pribadi hanya baris itu yang tahu kliniknya — lalu klinik halaman.
        // Tanpa itu backend memakai klinik default psikolognya.
        const klinik = row.clinicId || tenant.apiId;
        const clinicQ = klinik ? `&clinicId=${encodeURIComponent(klinik)}` : "";
        const res = await fetch(`/booking/slots?professionalId=${encodeURIComponent(this.psy.apiId)}&serviceId=${encodeURIComponent(row.apiId)}&date=${iso}${clinicQ}`, { headers: { "Accept": "application/json" } });
```

`choosePsy()` (line 555) — the psychologist picker on a multi-psychologist clinic page asks for that clinic's rows:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
        const res = await fetch(`/booking/services?professionalId=${encodeURIComponent(p.apiId)}`, { headers: { "Accept": "application/json" } });
```

with

```js
        // Hanya layanan psikolog DI klinik halaman ini — lihat
        // BookingController::services().
        const clinicQ = tenant.apiId ? `&clinicId=${encodeURIComponent(tenant.apiId)}` : "";
        const res = await fetch(`/booking/services?professionalId=${encodeURIComponent(p.apiId)}${clinicQ}`, { headers: { "Accept": "application/json" } });
```

The comment above the submit body in `next()` (lines 601–604):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
          // clinicId ikut hanya untuk pemeriksaan jadwal saat submit gagal
          // (mungkinTerlanjurMasuk). Klinik dan nama layanan di catatan
          // register TIDAK diambil dari sini: server menentukannya dari halaman
          // yang ia render sendiri — lihat BookingController::konteksRegister().
```

with

```js
          // clinicId = klinik BARIS layanan yang dipilih (di tautan pribadi
          // hanya baris itu yang tahu kliniknya). Server meneruskannya ke
          // backend supaya janji temunya jatuh ke klinik yang harganya
          // ditampilkan. Klinik dan nama layanan di catatan register TIDAK
          // diambil dari sini: server menentukannya dari halaman yang ia
          // render sendiri — lihat BookingController::konteksRegister().
```

The submit body's `clinicId` (line 615):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
            clinicId: tenant.apiId ? String(tenant.apiId) : null,
```

with

```js
            clinicId: this.svc.clinicId ? String(this.svc.clinicId) : (tenant.apiId ? String(tenant.apiId) : null),
```

Service cards (lines 1159–1162) select by `key`:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
              <template x-for="x in services" :key="x.id">
                <div class="svc-card" :class="{ sel: x.id === serviceId }" @click="selectService(x.id)"
                     role="radio" tabindex="0" :aria-checked="x.id === serviceId ? 'true' : 'false'"
                     @keydown.enter.prevent="selectService(x.id)" @keydown.space.prevent="selectService(x.id)">
```

with

```blade
              <template x-for="x in services" :key="x.key">
                <div class="svc-card" :class="{ sel: x.key === serviceId }" @click="selectService(x.key)"
                     role="radio" tabindex="0" :aria-checked="x.key === serviceId ? 'true' : 'false'"
                     @keydown.enter.prevent="selectService(x.key)" @keydown.space.prevent="selectService(x.key)">
```

and the radio dot (line 1178):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                  <div class="radio"><div class="radio-dot" x-show="x.id === serviceId"></div></div>
```

with

```blade
                  <div class="radio"><div class="radio-dot" x-show="x.key === serviceId"></div></div>
```

- [ ] **Step 6: Run the new test — expected PASS**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter BookingKlinikInternasionalTest
```

Expected: `OK (17 tests, 63 assertions)`.

- [ ] **Step 7: Two existing fakes pinned the services URL without a query string**

Clinic pages now call `.../professionals/34/services?clinicId=4`, and `Http::fake` URL patterns match the query string too, so these two fakes stop matching (`BookingTautanPribadiTest::test_id_klinik_tetap_didahulukan_atas_id_psikolog` → `StrayRequestException`; `BookingKonteksRegisterTest::test_clinic_and_service_come_from_the_page_the_server_rendered` → `service_name` null). Only the pattern changes; no assertion changes.

`BookingTautanPribadiTest::fake()` (line 48):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingTautanPribadiTest.php` replace

```php
            '*/api/v1/public/professionals/*/services' => Http::response(['data' => [
                ['id' => 488, 'name' => 'Konseling', 'price' => 350000, 'durationMinutes' => 60],
            ]], 200),
```

with

```php
            // `*` di ujung: halaman klinik kini meminta layanan dengan
            // ?clinicId=, dan pola Http::fake ikut mencocokkan query string.
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => [
                ['id' => 488, 'name' => 'Konseling', 'price' => 350000, 'durationMinutes' => 60],
            ]], 200),
```

`BookingKonteksRegisterTest::fake()` (lines 23–24; the second services fake at line 93 serves a personal link and stays as it is):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingKonteksRegisterTest.php` replace

```php
            '*/api/v1/public/config' => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60], 200),
            '*/api/v1/public/professionals/34/services' => Http::response(['data' => [
```

with

```php
            '*/api/v1/public/config' => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60], 200),
            // `*` di ujung: halaman klinik kini meminta layanan dengan
            // ?clinicId=, dan pola Http::fake ikut mencocokkan query string.
            '*/api/v1/public/professionals/34/services*' => Http::response(['data' => [
```

- [ ] **Step 8: Full suite — expected PASS**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit
```

Expected: `OK (703 tests, 2345 assertions)` on top of Tasks C1–C2 (baseline + 53 tests if `main` moved). `BookingHalamanTest` still passes even though its own services fake no longer matches; Task C4 rewrites that fake.

- [ ] **Step 9: Commit**

```bash
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional add app/Services/BookingApi.php app/Http/Controllers/BookingController.php app/Http/Controllers/ManualAppointmentController.php resources/views/booking.blade.php tests/Feature/BookingKlinikInternasionalTest.php tests/Feature/BookingTautanPribadiTest.php tests/Feature/BookingKonteksRegisterTest.php
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "fix(booking): janji temu jatuh ke klinik yang harganya ditampilkan

Halaman klinik meminta layanan dengan clinicId klinik itu, tautan pribadi
memisahkan baris yang sama di dua klinik, dan clinicId baris terpilih
ikut ke /booking/slots dan /public/appointments. Baris layanan dan jawaban
submit membawa paymentMethods (bawaan ['xendit']) dan usd dari backend.
friendly() mengenali kode galat bayar USD; cabang 409 startPayment tetap.
Dropdown layanan di form janji manual staf tetap menggabungkan layanan
yang sama antar klinik.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task C4: Tampilan USD di halaman booking — harga utama USD, metode per baris, ringkasan USD, pil dari jawaban submit

**Files:**
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` (Alpine script: state, getters, `selectService()`, `next()`, `reset()`, `simpanSnap()`, `bayar`, `pay()`; markup: service card price, step-5 method picker and summary card, success-screen pills — line numbers below are for the file as Task C3 left it)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` (`pay()` error answer)
- Modify: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/DeadFeatureAuditTest.php`, `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingHalamanTest.php` (they assumed PayPal always shows / a services URL without query)
- Test: `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingTampilanUsdTest.php` (new)

**Interfaces:** Consumes (Task C3): service rows `{ key, apiId, price, clinicId, paymentMethods, usd }` in `tenant.services` / `/booking/services`; `/booking/submit` JSON `paymentMethods`, `usd`; `usd` = `{ price, taxes: [{name, amount}], fee: string|null, total }` (2-decimal strings). / Produces: Alpine state `metodeBayar` (`string[]|null`), `usdBayar` (`object|null`); getters `metodeTersedia` (submit answer, else selected row, else `["xendit"]`), `usdAktif`, `pakaiUsd` (`payMethod !== "xendit"` and a USD view exists); `/booking/pay` error JSON gains `code` (only when the backend sent one).

Display rules (spec §5 "Display"): the page never converts currency — every dollar figure is a backend string printed after a `$`. Service list: `usd` set → `$<usd.price>` big, `Rp …` small under it; else Rupiah as today. Step 5: only `metodeTersedia` options; summary in USD lines (service, taxes, "International service fee", total) for PayPal/Card, Rupiah for Xendit. Success screen: pills = `metodeTersedia`, which after submit is the submit answer; if the method picked in step 5 is not in it, the page switches to the first allowed one, shows "Metode ini tidak tersedia untuk klinik ini…", and does **not** auto-redirect (the patient presses Bayar). A pay error with code `payment_method_not_allowed` narrows the pills to Xendit; the existing `payGagalMetode` path keeps offering "Bayar dengan Xendit (IDR)". Error texts per code come from `BookingController::friendly()` (Task C3).

- [ ] **Step 1: Write the failing test**

Create `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingTampilanUsdTest.php` with exactly this content:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Tampilan klinik internasional di halaman booking. Halaman ini tidak pernah
// mengonversi kurs: setiap angka dolar datang dari backend (`usd` per baris
// layanan dan di jawaban submit), dan metode yang ditawarkan adalah
// `paymentMethods` — bawaan ['xendit'] kalau tidak ada.
//
// Perilaku Alpine-nya tidak bisa dijalankan dari PHPUnit, jadi yang dijaga di
// sini dua hal: data dari backend benar-benar sampai ke halaman, dan ekspresi
// yang memakainya ada di markup.
class BookingTampilanUsdTest extends TestCase
{
    private const USD = ['price' => '12.23', 'taxes' => [['name' => 'PPN', 'amount' => '1.35']], 'fee' => '1.39', 'total' => '14.97'];

    private static function baris(array $tambahan = []): array
    {
        return array_merge([
            'id' => 488, 'name' => 'Konseling', 'price' => '200000', 'durationMinutes' => 60,
            'clinicId' => 33, 'paymentMethods' => ['xendit', 'paypal', 'card'], 'usd' => self::USD,
        ], $tambahan);
    }

    private function halaman(array $baris): string
    {
        Http::fake([
            '*/api/v1/public/config' => Http::response(['minBookingNoticeMinutes' => 60, 'maxAdvanceDays' => 60], 200),
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => [$baris]], 200),
            '*/api/v1/public/practices' => Http::response(['data' => [['id' => 33, 'name' => 'Klinik Internasional']]], 200),
            '*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 34, 'fullName' => 'Dianda Azani']]], 200),
        ]);

        return $this->get('/klinik-internasional')->assertOk()->getContent();
    }

    // ── Data dari backend ───────────────────────────────────────────────

    public function test_harga_usd_dari_backend_sampai_ke_halaman_apa_adanya(): void
    {
        $html = $this->halaman(self::baris());

        $this->assertStringContainsString(
            '"clinicId":"33","paymentMethods":["xendit","paypal","card"],"usd":{"price":"12.23","taxes":[{"name":"PPN","amount":"1.35"}],"fee":"1.39","total":"14.97"}',
            $html
        );
    }

    public function test_klinik_biasa_hanya_xendit_dan_rupiah(): void
    {
        $html = $this->halaman(self::baris(['clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null]));

        $this->assertStringContainsString('"paymentMethods":["xendit"],"usd":null', $html);
    }

    public function test_tanpa_payment_methods_jatuh_ke_xendit(): void
    {
        $html = $this->halaman(['id' => 488, 'name' => 'Konseling', 'price' => '200000', 'durationMinutes' => 60]);

        $this->assertStringContainsString('"paymentMethods":["xendit"],"usd":null', $html);
        $this->assertStringContainsString('return Array.isArray(m) && m.length ? m : ["xendit"];', $html);
    }

    // ── Markup ──────────────────────────────────────────────────────────

    public function test_kartu_layanan_menampilkan_usd_sebagai_angka_utama(): void
    {
        $html = $this->halaman(self::baris());

        $this->assertStringContainsString("x-text=\"x.usd ? '$' + x.usd.price : (x.price > 0 ? fmt(x.price) : 'Gratis')\"", $html);
        $this->assertStringContainsString('<div x-show="x.usd" style="font-size:12px;color:#8A90A6;margin-top:3px" x-text="fmt(x.price)"></div>', $html);
    }

    public function test_pemilih_metode_hanya_menampilkan_metode_baris(): void
    {
        $html = $this->halaman(self::baris());

        foreach (['xendit', 'paypal', 'card'] as $m) {
            $this->assertStringContainsString("<div x-show=\"metodeTersedia.includes('{$m}')\">", $html);
        }
    }

    public function test_ringkasan_paypal_memakai_baris_usd(): void
    {
        $html = $this->halaman(self::baris());

        $this->assertStringContainsString('get pakaiUsd() { return this.payMethod !== "xendit" && !!this.usdAktif; },', $html);
        $this->assertStringContainsString('<template x-for="(t, i) in usdAktif.taxes" :key="i">', $html);
        $this->assertStringContainsString('<span>International service fee</span>', $html);
        $this->assertStringContainsString("x-text=\"pakaiUsd ? '$' + usdAktif.total : (total > 0 ? fmt(total) : 'Gratis')\"", $html);
    }

    public function test_layar_sukses_memakai_metode_dari_jawaban_submit(): void
    {
        $html = $this->halaman(self::baris());

        $this->assertStringContainsString('this.metodeBayar = Array.isArray(res.paymentMethods) && res.paymentMethods.length ? res.paymentMethods : ["xendit"];', $html);
        $this->assertStringContainsString('.filter((x) => metodeTersedia.includes(x.v))', $html);
        // Metode yang tidak sah lagi diganti, dan pasien memilih sendiri —
        // tidak dilempar diam-diam ke gateway lain.
        $this->assertStringContainsString('} else if (!metodeBerubah) {', $html);
    }

    // ── /booking/pay ────────────────────────────────────────────────────

    public function test_galat_bayar_membawa_kode_untuk_layar(): void
    {
        Http::fake(['*/public/payments' => Http::response(['status' => 403, 'code' => 'payment_method_not_allowed'], 403)]);

        $this->postJson('/booking/pay', ['token' => 'tok-5150', 'method' => 'paypal'])
            ->assertStatus(Controller::UPSTREAM_REJECTED)
            ->assertJsonPath('code', 'payment_method_not_allowed');
    }

    public function test_galat_bayar_tanpa_kode_tidak_mengarang_kode(): void
    {
        Http::fake(['*/public/payments' => Http::response('<html>bad gateway</html>', 502)]);

        $this->postJson('/booking/pay', ['token' => 'tok-5150'])
            ->assertStatus(Controller::UPSTREAM_REJECTED)
            ->assertJsonMissingPath('code');
    }
}
```

- [ ] **Step 2: Update the two existing tests that assumed PayPal always shows**

`DeadFeatureAuditTest::test_the_payment_step_no_longer_demands_a_method_it_discards` (lines 90–92) — PayPal no longer always shows:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/DeadFeatureAuditTest.php` replace

```php
        $res->assertSee('Xendit', false);
        $res->assertSee('PayPal', false);
        $res->assertSee('method: this.payMethod', false);
```

with

```php
        $res->assertSee('Xendit', false);
        $res->assertSee('method: this.payMethod', false);
        // PayPal dan Kartu tidak lagi SELALU ditawarkan: hanya kalau baris
        // layanan (atau jawaban submit) menyebutnya — klinik internasional.
        $res->assertSee("x-show=\"metodeTersedia.includes('paypal')\"", false);
        $res->assertSee("x-show=\"metodeTersedia.includes('card')\"", false);
```

`BookingHalamanTest::halaman()` services fake (lines 17–19) — since Task C3 it no longer matched `?clinicId=4`:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingHalamanTest.php` replace

```php
            '*/api/v1/public/professionals/*/services' => Http::response(['data' => [
                ['id' => 488, 'name' => 'Konsultasi', 'price' => 500000, 'durationMinutes' => 60],
            ]], 200),
```

with

```php
            // `*` di ujung: halaman klinik meminta layanan dengan ?clinicId=,
            // dan pola Http::fake ikut mencocokkan query string. Barisnya
            // berbentuk backend sekarang: klinik biasa, Xendit saja.
            '*/api/v1/public/professionals/*/services*' => Http::response(['data' => [
                ['id' => 488, 'name' => 'Konsultasi', 'price' => 500000, 'durationMinutes' => 60,
                    'clinicId' => 4, 'paymentMethods' => ['xendit'], 'usd' => null],
            ]], 200),
```

`BookingHalamanTest::test_a_failed_payment_can_be_retried_with_another_method` (lines 80–82), plus one new test after it:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/tests/Feature/BookingHalamanTest.php` replace

```php
        $this->assertStringContainsString('Bayar dengan Xendit (IDR)', $html);
        $this->assertStringContainsString('x-show="canPay" role="radiogroup" aria-label="Metode pembayaran"', $html);
    }
```

with

```php
        $this->assertStringContainsString('Bayar dengan Xendit (IDR)', $html);
        $this->assertStringContainsString('x-show="canPay" role="radiogroup" aria-label="Metode pembayaran"', $html);
        // Pil di layar sukses hanya metode dari jawaban submit — PayPal dan
        // Kartu tidak lagi selalu ditawarkan.
        $this->assertStringContainsString('.filter((x) => metodeTersedia.includes(x.v))', $html);
    }

    public function test_a_regular_clinic_offers_xendit_only_in_rupiah(): void
    {
        $html = $this->halaman();

        $this->assertStringContainsString('"paymentMethods":["xendit"],"usd":null', $html);
    }
```

- [ ] **Step 3: Run them — expected FAIL**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'BookingTampilanUsdTest|BookingHalamanTest|DeadFeatureAuditTest'
```

Expected: `Tests: 52, Assertions: 145, Failures: 8` — six `BookingTampilanUsdTest` markup/code tests, `BookingHalamanTest::test_a_failed_payment_can_be_retried_with_another_method` and `DeadFeatureAuditTest::test_the_payment_step_no_longer_demands_a_method_it_discards` (the gated markup does not exist yet). The data tests (`test_harga_usd_dari_backend_sampai_ke_halaman_apa_adanya`, `test_klinik_biasa_hanya_xendit_dan_rupiah`, `test_galat_bayar_tanpa_kode_tidak_mengarang_kode`, `test_a_regular_clinic_offers_xendit_only_in_rupiah`) already pass on Task C3's data flow.

- [ ] **Step 4: `booking.blade.php` — Alpine script**

The file is ~1,650 lines; each anchor below is unique.

State, after `payMethod` (line 228):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
    payMethod: 'xendit',
```

with

```js
    payMethod: 'xendit',
    // Metode & harga USD janji temu yang SUDAH dibuat — dari jawaban
    // /booking/submit, yang menang atas baris layanan (pengaturan klinik bisa
    // berubah di antaranya). null = belum submit; lihat metodeTersedia.
    metodeBayar: null, usdBayar: null,
```

Getters, right after `get total()` (line 324):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
    get total() { return Math.max(0, this.price + ADMIN); },
```

with

```js
    get total() { return Math.max(0, this.price + ADMIN); },
    // Metode yang boleh dipilih: jawaban submit kalau sudah ada, kalau belum
    // milik baris layanan yang dipilih. Tanpa keduanya (backend lama, layar
    // sukses yang dipulihkan tanpa snapshot) hanya Xendit — backend menolak
    // PayPal/Kartu untuk klinik yang bukan internasional.
    get metodeTersedia() {
      const m = this.metodeBayar || (this.svc && this.svc.paymentMethods);
      return Array.isArray(m) && m.length ? m : ["xendit"];
    },
    // Harga USD dari backend (string 2 desimal) — halaman ini TIDAK PERNAH
    // mengonversi kurs sendiri. null = tampil Rupiah.
    get usdAktif() { return (this.metodeBayar ? this.usdBayar : (this.svc && this.svc.usd)) || null; },
    // Ringkasan mengikuti metode: PayPal/Kartu ditagih dalam USD, Xendit Rupiah.
    get pakaiUsd() { return this.payMethod !== "xendit" && !!this.usdAktif; },
```

`selectService()` (lines 463–465) — a row without PayPal must not keep PayPal selected:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
      this.serviceId = id;
      this.dateIso = null; this.time = null; this.slotError = null;
      this.svcUnavailable = null;
```

with

```js
      this.serviceId = id;
      this.dateIso = null; this.time = null; this.slotError = null;
      this.svcUnavailable = null;
      // Metode yang tadi dipilih belum tentu ditawarkan baris ini.
      if (!this.metodeTersedia.includes(this.payMethod)) this.payMethod = this.metodeTersedia[0];
```

`next()`, right after the submit answer is read (lines 632–633):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
          this.code = res.code; this.register = res.register || null; this.reference = res.reference || null; this.step = STEPS;
          this.gratis = !!res.free;
```

with

```js
          this.code = res.code; this.register = res.register || null; this.reference = res.reference || null; this.step = STEPS;
          this.gratis = !!res.free;
          // Jawaban submit yang berwenang atas metode & harga USD janji temu
          // ini (BookingApi::submitBooking). Metode pilihan langkah 5 yang
          // tidak ada di sana diganti yang sah — dan TIDAK langsung dibayar:
          // pasien memilih sendiri di layar sukses, bukan dilempar diam-diam
          // ke gateway lain.
          this.metodeBayar = Array.isArray(res.paymentMethods) && res.paymentMethods.length ? res.paymentMethods : ["xendit"];
          this.usdBayar = res.usd || null;
          const metodeBerubah = !this.metodeBayar.includes(this.payMethod);
          if (metodeBerubah) {
            this.payMethod = this.metodeBayar[0];
            this.payError = "Metode ini tidak tersedia untuk klinik ini. Silakan pilih metode pembayaran lain.";
          }
```

and the hand-off to checkout a few lines below (lines 664–670) — no automatic redirect when the chosen method was replaced:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
            if (!this.gratis) {
              this.menujuCheckout = true;
              await this.pay();
              this.menujuCheckout = false;
            } else {
              this.konfirmasiGratis();
            }
```

with

```js
            if (this.gratis) {
              this.konfirmasiGratis();
            } else if (!metodeBerubah) {
              this.menujuCheckout = true;
              await this.pay();
              this.menujuCheckout = false;
            }
```

`reset()` (line 728):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
      this.register = null; this.regCopied = false;
```

with

```js
      this.register = null; this.regCopied = false;
      this.metodeBayar = null; this.usdBayar = null;
```

`simpanSnap()` (line 762) — the success screen restored after checkout keeps its pills and USD lines:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
          code: this.code, register: this.register, gratis: this.gratis, serviceId: this.serviceId,
```

with

```js
          code: this.code, register: this.register, gratis: this.gratis, serviceId: this.serviceId,
          metodeBayar: this.metodeBayar, usdBayar: this.usdBayar,
```

`bayar` getter (line 874) — before any order exists, the estimate is in the chosen method's currency:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
      return dariServer ? { fmt: this.fmt(dariServer), pasti: true } : { fmt: this.fmt(this.total), pasti: false };
```

with

```js
      if (dariServer) return { fmt: this.fmt(dariServer), pasti: true };
      // Belum ada order: perkiraan dalam mata uang metode yang dipilih.
      return this.pakaiUsd ? { fmt: "$" + this.usdAktif.total, pasti: false } : { fmt: this.fmt(this.total), pasti: false };
```

`pay()` catch block (lines 960–961):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```js
        this.payGagalMetode = this.payMethod !== "xendit" ? this.payMethod : null;
      } finally { this.paying = false; }
```

with

```js
        this.payGagalMetode = this.payMethod !== "xendit" ? this.payMethod : null;
        // Backend: klinik ini tidak (lagi) menerima PayPal/Kartu. Pil yang
        // tersisa hanya yang memang bisa dipakai.
        if (e.body && e.body.code === "payment_method_not_allowed") {
          this.metodeBayar = ["xendit"]; this.usdBayar = null; this.payMethod = "xendit";
        }
      } finally { this.paying = false; }
```

- [ ] **Step 5: `booking.blade.php` — markup**

Service card price (lines 1185–1187) — USD main figure, rupiah small underneath:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                      <div style="font-size:15px;font-weight:800;color:#425FAD" x-text="x.price > 0 ? fmt(x.price) : 'Gratis'"></div>
                      <div style="font-size:12.5px;color:#8A90A6;font-weight:600" x-text="x.dur"></div>
                    </div>
```

with

```blade
                      <div style="font-size:15px;font-weight:800;color:#425FAD" x-text="x.usd ? '$' + x.usd.price : (x.price > 0 ? fmt(x.price) : 'Gratis')"></div>
                      <div style="font-size:12.5px;color:#8A90A6;font-weight:600" x-text="x.dur"></div>
                    </div>
                    {{-- Klinik internasional: dolar dari backend jadi angka utama,
                         Rupiah kecil di bawahnya. --}}
                    <div x-show="x.usd" style="font-size:12px;color:#8A90A6;margin-top:3px" x-text="fmt(x.price)"></div>
```

Step-5 method picker, Xendit option (lines 1388–1399). Each option gets a wrapper `<div x-show>` — not `x-show` on the `<label>`, whose string `:style` binding rewrites the whole `style` attribute whenever `payMethod` changes and would wipe the `display:none` that `x-show` sets. The inner lines only gain two spaces of indentation:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                  {{-- Opsi 1: Xendit --}}
                  <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                         :style="payMethod==='xendit' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                    <input type="radio" name="payMethod" value="xendit" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                    <div style="flex:1;font-size:13px;color:#1E2236">
                      <div style="display:flex;align-items:center;justify-content:space-between">
                        <span style="font-weight:700;color:#1E2A52">Xendit</span>
                        <span style="font-size:11px;font-weight:700;background:#EBF3FF;color:#425FAD;padding:2px 8px;border-radius:99px">IDR</span>
                      </div>
                      <div style="color:#6B7090;font-size:12px;margin-top:2px">Virtual Account (BCA, Mandiri, BNI, BRI), QRIS, E-Wallet</div>
                    </div>
                  </label>
```

with

```blade
                  {{-- Opsi 1: Xendit. Setiap opsi hanya tampil kalau baris layanan
                       yang dipilih menawarkannya (metodeTersedia). x-show sengaja
                       di pembungkus, bukan di <label>: :style berbentuk string di
                       label menulis ulang SELURUH atribut style setiap kali
                       payMethod berubah, dan display:none dari x-show ikut hilang. --}}
                  <div x-show="metodeTersedia.includes('xendit')">
                    <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                           :style="payMethod==='xendit' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                      <input type="radio" name="payMethod" value="xendit" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                      <div style="flex:1;font-size:13px;color:#1E2236">
                        <div style="display:flex;align-items:center;justify-content:space-between">
                          <span style="font-weight:700;color:#1E2A52">Xendit</span>
                          <span style="font-size:11px;font-weight:700;background:#EBF3FF;color:#425FAD;padding:2px 8px;border-radius:99px">IDR</span>
                        </div>
                        <div style="color:#6B7090;font-size:12px;margin-top:2px">Virtual Account (BCA, Mandiri, BNI, BRI), QRIS, E-Wallet</div>
                      </div>
                    </label>
                  </div>
```

PayPal option with the divider above it (lines 1401–1414):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                  <div style="height:1px;background:#F0F2F8;margin:0 16px"></div>

                  {{-- Opsi 2: PayPal --}}
                  <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                         :style="payMethod==='paypal' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                    <input type="radio" name="payMethod" value="paypal" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                    <div style="flex:1;font-size:13px;color:#1E2236">
                      <div style="display:flex;align-items:center;justify-content:space-between">
                        <span style="font-weight:700;color:#1E2A52">PayPal</span>
                        <span style="font-size:11px;font-weight:700;background:#F1F5F9;color:#64748B;padding:2px 8px;border-radius:99px">USD</span>
                      </div>
                      <div style="color:#6B7090;font-size:12px;margin-top:2px">Bayar langsung dengan saldo atau akun PayPal Anda</div>
                    </div>
                  </label>
```

with

```blade
                  <div x-show="metodeTersedia.includes('paypal')">
                    <div style="height:1px;background:#F0F2F8;margin:0 16px"></div>

                    {{-- Opsi 2: PayPal --}}
                    <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                           :style="payMethod==='paypal' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                      <input type="radio" name="payMethod" value="paypal" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                      <div style="flex:1;font-size:13px;color:#1E2236">
                        <div style="display:flex;align-items:center;justify-content:space-between">
                          <span style="font-weight:700;color:#1E2A52">PayPal</span>
                          <span style="font-size:11px;font-weight:700;background:#F1F5F9;color:#64748B;padding:2px 8px;border-radius:99px">USD</span>
                        </div>
                        <div style="color:#6B7090;font-size:12px;margin-top:2px">Bayar langsung dengan saldo atau akun PayPal Anda</div>
                      </div>
                    </label>
                  </div>
```

Card option with the divider above it (lines 1416–1429):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                  <div style="height:1px;background:#F0F2F8;margin:0 16px"></div>

                  {{-- Opsi 3: Credit Card --}}
                  <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                         :style="payMethod==='card' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                    <input type="radio" name="payMethod" value="card" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                    <div style="flex:1;font-size:13px;color:#1E2236">
                      <div style="display:flex;align-items:center;justify-content:space-between">
                        <span style="font-weight:700;color:#1E2A52">Debit / Credit Card</span>
                        <span style="font-size:11px;font-weight:700;background:#F1F5F9;color:#64748B;padding:2px 8px;border-radius:99px">USD</span>
                      </div>
                      <div style="color:#6B7090;font-size:12px;margin-top:2px">Visa, Mastercard via PayPal Gateway (tanpa akun PayPal)</div>
                    </div>
                  </label>
```

with

```blade
                  <div x-show="metodeTersedia.includes('card')">
                    <div style="height:1px;background:#F0F2F8;margin:0 16px"></div>

                    {{-- Opsi 3: Credit Card --}}
                    <label style="display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;transition:all .15s"
                           :style="payMethod==='card' ? 'background:#F2F5FF;border-left:4px solid #425FAD' : 'background:#fff;border-left:4px solid transparent'">
                      <input type="radio" name="payMethod" value="card" x-model="payMethod" style="accent-color:#425FAD;width:16px;height:16px">
                      <div style="flex:1;font-size:13px;color:#1E2236">
                        <div style="display:flex;align-items:center;justify-content:space-between">
                          <span style="font-weight:700;color:#1E2A52">Debit / Credit Card</span>
                          <span style="font-size:11px;font-weight:700;background:#F1F5F9;color:#64748B;padding:2px 8px;border-radius:99px">USD</span>
                        </div>
                        <div style="color:#6B7090;font-size:12px;margin-top:2px">Visa, Mastercard via PayPal Gateway (tanpa akun PayPal)</div>
                      </div>
                    </label>
                  </div>
```

Step-5 summary card ("RINGKASAN PEMBAYARAN") — service line (line 1459):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                <span style="flex:none;font-weight:600" x-text="fmt(price)"></span>
```

with

```blade
                <span style="flex:none;font-weight:600" x-text="pakaiUsd ? '$' + usdAktif.price : fmt(price)"></span>
```

admin-fee line, Rupiah only, followed by the USD tax and fee lines (lines 1462–1465). The blank lines around this block in the file carry trailing spaces; the anchor deliberately starts and ends on non-blank lines:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
              <div x-show="ADMIN > 0" style="display:flex;justify-content:space-between;font-size:13.5px;color:#D3DCFF">
                <span>Biaya admin</span>
                <span x-text="fmt(ADMIN)"></span>
              </div>
```

with

```blade
              <div x-show="ADMIN > 0 && !pakaiUsd" style="display:flex;justify-content:space-between;font-size:13.5px;color:#D3DCFF">
                <span>Biaya admin</span>
                <span x-text="fmt(ADMIN)"></span>
              </div>

              {{-- PayPal/Kartu: baris USD persis seperti yang dikirim backend —
                   pajak, lalu fee flat klinik (tanpa markup). --}}
              <template x-if="pakaiUsd">
                <div style="display:flex;flex-direction:column;gap:14px">
                  <template x-for="(t, i) in usdAktif.taxes" :key="i">
                    <div style="display:flex;justify-content:space-between;gap:12px;font-size:13.5px;color:#D3DCFF">
                      <span x-text="t.name"></span>
                      <span x-text="'$' + t.amount"></span>
                    </div>
                  </template>
                  <div x-show="usdAktif.fee" style="display:flex;justify-content:space-between;gap:12px;font-size:13.5px;color:#D3DCFF">
                    <span>International service fee</span>
                    <span x-text="'$' + usdAktif.fee"></span>
                  </div>
                </div>
              </template>
```

total (line 1471):

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                <span style="font-size:23px;font-weight:800;color:#fff" x-text="total > 0 ? fmt(total) : 'Gratis'"></span>
```

with

```blade
                <span style="font-size:23px;font-weight:800;color:#fff" x-text="pakaiUsd ? '$' + usdAktif.total : (total > 0 ? fmt(total) : 'Gratis')"></span>
```

Success-screen pills (line 1584) — only the methods of the submit answer:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/resources/views/booking.blade.php` replace

```blade
                  <template x-for="m in [{ v: 'xendit', l: 'Xendit · IDR' }, { v: 'paypal', l: 'PayPal · USD' }, { v: 'card', l: 'Kartu · USD' }]" :key="m.v">
```

with

```blade
                  <template x-for="m in [{ v: 'xendit', l: 'Xendit · IDR' }, { v: 'paypal', l: 'PayPal · USD' }, { v: 'card', l: 'Kartu · USD' }].filter((x) => metodeTersedia.includes(x.v))" :key="m.v">
```

- [ ] **Step 6: `BookingController::pay()` — pass the backend code to the page**

`pay()` error answer (lines 1017–1020) also carries the backend `code`, so the page can tell `payment_method_not_allowed` apart:

In `/home/ahmad/projects/praktiqu-fe/klinik-internasional/app/Http/Controllers/BookingController.php` replace

```php
            return response()->json([
                'message' => $this->friendly($e, 'Gagal membuka halaman pembayaran.', soalToken: true),
                'ref' => $this->ref($e),
            ], self::UPSTREAM_REJECTED);
```

with

```php
            return response()->json(array_filter([
                'message' => $this->friendly($e, 'Gagal membuka halaman pembayaran.', soalToken: true),
                'ref' => $this->ref($e),
                // Kode problem+json backend, untuk layar: payment_method_not_allowed
                // menyisakan Xendit saja di pilihan metode.
                'code' => is_array($e->body) ? ($e->body['code'] ?? null) : null,
            ], fn ($v) => $v !== null), self::UPSTREAM_REJECTED);
```

- [ ] **Step 7: Run the tests — expected PASS**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'BookingTampilanUsdTest|BookingHalamanTest|DeadFeatureAuditTest|BookingKlinikInternasionalTest|BookingBayarUlangTest'
```

Expected: `OK (73 tests, 229 assertions)` (`BookingTampilanUsdTest` alone: `OK (9 tests, 27 assertions)`).

- [ ] **Step 8: Full suite**

```bash
cd /home/ahmad/projects/praktiqu-fe/klinik-internasional && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit
```

Expected: `OK (713 tests, 2376 assertions)` on top of Tasks C1–C3 (baseline + 63 tests if `main` moved).

- [ ] **Step 9: Manual check in a browser (no backend changes needed)**

Optional but recommended before the PR: the Alpine behaviour is only string-tested above. Run `php artisan serve` against a backend that already serves the new fields (Next.js from Part B), open an international clinic's page and confirm: the card shows `$12.23` with `Rp 200.000` under it; step 5 lists Xendit, PayPal and Kartu; choosing PayPal turns the summary into USD lines ending in the backend's total; a regular clinic shows Xendit only. If no such backend is reachable, skip this step and say so in the PR description.

- [ ] **Step 10: Commit**

```bash
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional add resources/views/booking.blade.php app/Http/Controllers/BookingController.php tests/Feature/BookingTampilanUsdTest.php tests/Feature/BookingHalamanTest.php tests/Feature/DeadFeatureAuditTest.php
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(booking): harga USD dan metode bayar per klinik di halaman booking

Klinik internasional menampilkan USD dari backend sebagai angka utama
(Rupiah kecil di bawahnya), pemilih metode hanya menawarkan paymentMethods
baris yang dipilih (bawaan Xendit), ringkasan PayPal/Kartu memakai baris
USD termasuk International service fee, dan pil di layar sukses mengikuti
jawaban submit. FE tidak pernah mengonversi kurs sendiri.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Push the branch and open the PR (never to `main`) — CONTROLLER ONLY, after the user's explicit OK**

**Implementer subagents: do NOT run this step.** Stop after Step 10 and report DONE. Pushing publishes code to Rafiq's repository, so the controller runs this step itself, and only after the user has said yes in the conversation.

`main` of this repo auto-deploys terpadu.praktiqu.com. Push only `feat/klinik-internasional`, then give the user the compare link; do not merge. The FE must ship only after the backend (plugin, then Next.js) is deployed — spec §8.

```bash
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional push -u origin feat/klinik-internasional
git -C /home/ahmad/projects/praktiqu-fe/klinik-internasional remote get-url origin
```

The repository's `core.sshCommand` already selects `~/.ssh/id_ed25519_praktiqu_fe` (the `websitepraktiqu` account), so no key setup is needed. Expected: the push succeeds; if it is refused, stop and report — do not try another remote or key, and never `git push origin main` or merge the PR (`gh` is not installed; the PR is opened from the compare link). PR: `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/klinik-internasional?expand=1`, body listing Tasks C1–C4, the deploy order (plugin → Next.js → FE), and ending with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
