# CRUD Klinik — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super admin bisa menambah, mengedit, menonaktifkan/mengaktifkan, dan menghapus permanen (hanya bila kosong) klinik dari dashboard FE; admin klinik bisa mengedit profil kliniknya sendiri tetapi tidak bisa mengubah statusnya.

**Architecture:** Baris klinik (`wp_kc_clinics`) ditulis backend Next.js dengan SQL langsung, sama seperti `PATCH` yang sudah ada. Akun admin klinik baru dibuat lewat endpoint baru plugin WordPress `praktiqu-endpoint` (`POST /praktiqu/v1/clinic-admins`) yang memakai `wp_insert_user`, mengisi `clinic_admin_id`, dan mengirim email selamat datang. FE Laravel mendapat satu controller baru (`KlinikController`) dengan halaman form tersendiri, mengikuti pola `KlinikAdminController`.

**Tech Stack:** Next.js 15 route handlers + Prisma (MySQL WordPress DB) + zod + vitest; plugin WordPress PHP 8 (tes PHP polos di container `php:8.4-cli`); Laravel + Blade + Alpine.js + PHPUnit (PHP 8.4 via Docker).

**Spec:** `docs/superpowers/specs/2026-10-15-crud-klinik-design.md`. Baca bagian "Konteks yang perlu diketahui pelaksana" sebelum mulai.

## Global Constraints

Berlaku untuk SETIAP task:

- **Jangan pernah** menjalankan `prisma db push` atau `prisma migrate dev/deploy/reset`. `DATABASE_URL` adalah database WordPress. Fitur ini **tidak menambah tabel atau kolom**. `npx prisma generate` tidak perlu.
- **Jangan pernah** membuat akun WordPress dengan `INSERT INTO wp_users`. Akun dibuat lewat plugin (`wp_insert_user`).
- **Jangan** menyentuh tabel shadow `clinics` (tanpa prefix `wp_`). Klinik = `wp_kc_clinics` (model Prisma `KcClinic`).
- Status klinik: **`1` aktif, `0` nonaktif**.
- `LAST_INSERT_ID` hanya lewat helper **`lastInsertId(tx)`** dari `src/lib/last-insert-id.ts` di dalam `prisma.$transaction(async (tx) => …)`. Tes `tests/unit/db/last-insert-id-pinning.test.ts` gagal kalau tidak.
- Tabel produksi adalah **MyISAM** (tidak mendukung transaksi). Penghapusan beruntun harus menghapus baris klinik **paling akhir**.
- Kode error backend (field `code` di body problem+json) — dipakai FE untuk memilih pesan:

  | `code` | HTTP | Kapan |
  |---|---|---|
  | `validation_error` | 422 | zod gagal; body membawa `issues: [{path, message}]` |
  | `clinic_name_conflict` | 409 | nama tidak bisa dipakai; body membawa `reason`, `slug`, opsional `conflictId`, `conflictName` |
  | `clinic_email_conflict` | 409 | email klinik dipakai klinik lain; body membawa `conflictId` |
  | `admin_email_taken` | 409 | email admin baru sudah terdaftar di WordPress |
  | `not_a_clinic_admin` | 422 | mode `existing` dengan akun yang bukan clinic admin |
  | `clinic_not_empty` | 409 | hapus permanen klinik yang punya data; body membawa `counts` (hanya kunci > 0) |
  | `admin_provision_failed` | 502 | plugin gagal membuat akun admin (klinik sudah dihapus lagi) |
  | `status_change_forbidden` | 403 | admin klinik mengirim `status` di `PATCH` |
  | `practice_not_found` | 404 | klinik tidak ada / di luar scope |
- Nilai `reason` untuk `clinic_name_conflict`: **`empty_slug`, `numeric_slug`, `reserved_slug`, `clinic_slug_taken`, `professional_slug_taken`**.
- Slug klinik = `slugifyName(name)` dari `src/lib/public/professional-slug.ts` (padanan persis `BookingApi::slugify()` di FE).
- Kata route FE yang tidak boleh jadi slug: `admin, klinik, psikolog, login, logout, booking, staff, doctor, pasien, cek-hasil, up, forgot-password, reset-password, lupa-sandi, atur-ulang-sandi`.
- Kunci `counts` / tabel yang dihitung untuk hapus permanen (semua kolom `clinic_id`): `appointments`→`wp_kc_appointments`, `bills`→`wp_kc_bills`, `encounters`→`wp_kc_patient_encounters`, `doctors`→`wp_kc_doctor_clinic_mappings`, `patients`→`wp_kc_patient_clinic_mappings`, `receptionists`→`wp_kc_receptionist_clinic_mappings`, `sessions`→`wp_kc_clinic_sessions`, `services`→`wp_kc_service_doctor_mapping`, `followups`→`wp_kc_followups`, `followupChains`→`wp_kc_followup_chains`, `taxes`→`wp_kc_taxes`, `notifications`→`wp_kc_custom_notifications`.
- Audit: `logging.audit(action, { userId: <users.id cuid pemanggil>, resource: 'clinic', resourceId: String(id), metadata })`. `userId` **bukan** id WordPress (foreign key ke `users.id`; id WordPress membuat barisnya hilang diam-diam). Aksi: `practice.create`, `practice.update`, `practice.activate`, `practice.deactivate`, `practice.delete`.
- Bahasa: komentar kode mengikuti file yang diubah (backend & plugin: Inggris, FE: Indonesia). Pesan untuk pengguna: Bahasa Indonesia. Pesan commit: Bahasa Indonesia, format conventional (`feat(practice): ...`), diakhiri baris `Co-Authored-By` yang dipakai tim.
- Commit hanya file yang disebut di task (`git add <path>`), **jangan `git add -A`**.
- **Backend + plugin**: repo `Alfzzz124/nextjs-appointment-praktiqu`, branch **`feat/crud-klinik`** (sudah ada, dari `origin/main` 0b16fc7, berisi spec dan rencana ini). Worktree di mesin pemilik: `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/crud-klinik`. Di mesin lain: `git fetch origin && git switch feat/crud-klinik`. Push: `git push origin feat/crud-klinik:refs/heads/feat/crud-klinik`.
- **FE**: repo `raakanaka/laravel-praktiqu`, branch **`feat/crud-klinik`** dari `origin/main` (1df6bbf). Worktree di mesin pemilik: `/home/ahmad/projects/praktiqu-fe/crud-klinik`. `main` FE auto-deploy ke produksi: **hanya lewat branch + PR, jangan pernah push ke `main`**. Repo FE tidak punya git identity: setiap commit FE memakai `git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit ...` (atau identitas pelaksana sendiri).
- Tes backend: `npx vitest run <file>` dari root repo backend. DB uji = MySQL di Docker (`praktiqu-mysql`, database `wordpress-praktiqu-test`); `DATABASE_URL` di `.env.test.local` **wajib mengandung "test"** (fixture menolak jalan kalau tidak). **Kalau mesinmu tidak punya DB uji**, tes integrasi tidak bisa dijalankan: tulis tesnya persis, jalankan tes unit + `npx tsc --noEmit`, dan cantumkan di PR bahwa tes integrasi belum dijalankan supaya reviewer menjalankannya.
- Tes PHP plugin: dari `Wordpress-Plugin/praktiqu-endpoint`, `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/<file>.php`. Siapkan sekali: `mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json`.
- Tes FE: dari worktree FE, `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit [--filter NamaTes]`. Worktree baru belum punya `vendor/`: jalankan sekali `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app -e COMPOSER_ALLOW_SUPERUSER=1 composer:2 install --no-scripts`, lalu `cp .env.example .env && DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php artisan key:generate` bila `.env` belum ada.
- Rentang id uji backend (supaya file tes tidak saling menghapus data), masing-masing selebar 10.000: B1 `8_770_000`, B4 `8_740_000`, B5 `8_750_000`, B6 `8_760_000`. Klinik yang dibuat lewat `POST` memakai auto-increment, jadi tes membersihkannya lewat **awalan nama** (`Klinik Uji CRUD 8740`).

## Peta file

**Plugin** (`Wordpress-Plugin/praktiqu-endpoint`, di repo backend)

| File | Status | Tanggung jawab |
|---|---|---|
| `includes/class-praktiqu-endpoint-clinic-admins.php` | baru | `ClinicAdmins::create()` — buat akun admin klinik untuk klinik tanpa admin |
| `includes/class-praktiqu-endpoint-rest-controller.php` | ubah | Daftarkan `POST /clinic-admins` + handler |
| `includes/class-praktiqu-endpoint-plugin.php` | ubah | Buat `ClinicAdmins` dan teruskan ke controller |
| `praktiqu-endpoint.php` | ubah | `require_once` file baru, versi 1.8.0 |
| `readme.txt` | ubah | Stable tag + changelog 1.8.0 |
| `tests/test-clinic-admins.php` | baru | Tes PHP polos |

**Backend** (root repo backend)

| File | Status | Tanggung jawab |
|---|---|---|
| `src/types/practice.ts` | ubah | `clinicAdminChoiceSchema`, `practiceCreateSchema` |
| `src/repositories/wp/clinics.repo.ts` | ubah | `insertClinic`, `setClinicAdmin`, `listClinicNames`, `findClinicIdByEmail`, `countClinicReferences`, `deleteClinicRow` |
| `src/repositories/wp/clinic-admins.repo.ts` | ubah | `wpUserEmailExists` |
| `src/repositories/wp/clinic-admins.write.ts` | baru | `createClinicAdminViaPlugin` |
| `src/services/public/public-catalog.service.ts` | ubah | `listActiveProfessionalSlugs` |
| `src/services/practice/clinic-names.ts` | baru | Aturan slug/email klinik + error-nya |
| `src/services/practice/service.ts` | ubah | `createPractice`, `setPracticeStatus`, `deletePracticePermanently`, cek nama/email di `updatePractice`, error baru |
| `src/lib/practice-problems.ts` | baru | Error service → respons problem+json |
| `src/app/api/v1/practices/route.ts` | ubah | `POST` sungguhan |
| `src/app/api/v1/practices/[id]/route.ts` | ubah | `PATCH` tolak `status` dari admin klinik; `DELETE` super saja + `?permanent=true` |
| `src/app/api/v1/practices/[id]/activate/route.ts` | baru | Aktifkan kembali |
| `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` | ubah | Kontrak |
| `tests/integration/practice/clinics-repo-write.test.ts` | baru | Tes B1 |
| `tests/unit/practice/clinic-names.test.ts` | baru | Tes B2 |
| `tests/unit/practice/clinic-admins-write.test.ts` | baru | Tes B3 |
| `tests/integration/practice/practice-create.test.ts` | baru | Tes B4 |
| `tests/integration/practice/practice-status.test.ts` | baru | Tes B5 |
| `tests/integration/practice/practice-delete-permanent.test.ts` | baru | Tes B6 |

**FE** (root repo FE)

| File | Status | Tanggung jawab |
|---|---|---|
| `app/Http/Controllers/KlinikController.php` | baru | baru/simpan/edit/ubah/status/hapus |
| `app/Http/Controllers/KlinikAdminController.php` | ubah | `kandidat()` jadi `public` supaya dipakai ulang |
| `resources/views/dashboard/klinik-form.blade.php` | baru | Form tambah/edit + zona berbahaya |
| `routes/web.php` | ubah | Enam route baru |
| `app/Http/Controllers/DashboardController.php` | ubah | `$editKlinikUrl` untuk admin klinik |
| `resources/views/dashboard.blade.php` | ubah | Tombol Add Clinic, filter status, tautan Edit, flash, buka tab Clinics |
| `app/Http/Controllers/ResourceController.php` | ubah | Komentar `'clinics'` diperbarui |
| `tests/Feature/KlinikTambahTest.php` | baru | Tes F1 |
| `tests/Feature/KlinikUbahTest.php` | baru | Tes F2 |
| `tests/Feature/KlinikStatusHapusTest.php` | baru | Tes F3 |
| `tests/Feature/KlinikTabTest.php` | baru | Tes F4 |

## Urutan dan ketergantungan

```
P1 (plugin) ─────────────────────────────┐
B1 → B2 → B3 → B4 → B5 → B6 → B7 ────────┼─→ R1 → R2 → R3 → R4 (rilis)
F1 → F2 → F3 → F4 → F5 ──────────────────┘
```

P1, rangkaian B, dan rangkaian F bisa dikerjakan paralel oleh orang berbeda: FE dites dengan `Http::fake`, backend dites dengan plugin di-mock. Mereka hanya perlu bertemu di kontrak di atas.

---

## Grup P — Plugin `praktiqu-endpoint` 1.8.0

### Task P1: Endpoint `POST /praktiqu/v1/clinic-admins`

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-admins.php`
- Create: `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-admins.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php` (properti, constructor, `register_routes()`, handler baru)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php` (properti + constructor)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (versi + `require_once`)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/readme.txt`

**Interfaces:**
- Consumes: tidak ada (berdiri sendiri).
- Produces: `POST /wp-json/praktiqu/v1/clinic-admins` (auth `Plugin::verify_service_token`, sama seperti semua route plugin).
  - Body: `{ "name": string, "email": string, "clinic_id": int }`
  - 201: `{ "id": int, "email": string, "username": string, "clinic_id": int, "email_sent": bool }` — **tanpa** kata sandi.
  - Error (`WP_Error`, status di `data.status`): 400 `praktiqu_invalid_email` / `praktiqu_invalid_name` / `praktiqu_missing_clinic`; 404 `praktiqu_clinic_not_found`; 409 `praktiqu_clinic_has_admin` / `praktiqu_email_taken`.

Latar: rujukan perilaku KiviCare ada di `Wordpress-Plugin/kivicare-pro/app/controllers/api/KCProClinicController.php::createClinic()` dan `sendClinicAdminRegistrationEmail()`. Pola kelas mengikuti `includes/class-praktiqu-endpoint-receptionists.php`. Endpoint ini **hanya** membuat akun untuk klinik yang belum punya admin (`clinic_admin_id = 0`), supaya tidak bisa dipakai merebut klinik orang lain.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-admins.php`:

```php
<?php
/**
 * Assertions for ClinicAdmins::create(). Plain PHP — no PHPUnit, no real WordPress — runs in a
 * bare `php:8.4-cli` container, same as the other files in this directory.
 *
 * WordPress functions, WP_Error, WP_User and $wpdb are shimmed over plain arrays. The KiviCare
 * email sender class does not exist here, so create() takes its wp_new_user_notification()
 * fallback.
 */

declare(strict_types=1);

namespace {
    use PraktiQU\Endpoint\ClinicAdmins;

    define('ABSPATH', __DIR__ . '/');
    define('ARRAY_A', 'ARRAY_A');

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

        public function get_error_message(): string
        {
            return $this->message;
        }
    }

    final class WP_REST_Request
    {
    }

    final class WP_User
    {
        public function __construct(public int $ID)
        {
        }

        public function set_role(string $role): void
        {
            $GLOBALS['roles'][$this->ID] = $role;
        }
    }

    function is_wp_error($thing): bool
    {
        return $thing instanceof WP_Error;
    }

    function sanitize_email(string $email): string
    {
        return trim($email);
    }

    function is_email(string $email): bool
    {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    function sanitize_text_field(string $text): string
    {
        return trim(strip_tags($text));
    }

    function sanitize_user(string $username, bool $strict = false): string
    {
        return (string) preg_replace('/[^a-z0-9._-]/i', '', $username);
    }

    function email_exists(string $email)
    {
        return in_array(strtolower($email), $GLOBALS['taken_emails'], true) ? 1 : false;
    }

    function username_exists(string $username)
    {
        return in_array($username, $GLOBALS['taken_usernames'], true) ? 1 : false;
    }

    function wp_generate_password(int $length = 12, bool $special = true): string
    {
        return 'Rahasia#1234';
    }

    function wp_insert_user(array $data)
    {
        $GLOBALS['inserted'][] = $data;
        return 900 + count($GLOBALS['inserted']);
    }

    function wp_delete_user(int $id): bool
    {
        $GLOBALS['deleted'][] = $id;
        return true;
    }

    function wp_new_user_notification(int $user_id, $deprecated = null, string $notify = ''): void
    {
        $GLOBALS['notified'][] = [$user_id, $notify];
    }

    function do_action(string $hook, ...$args): void
    {
        $GLOBALS['actions'][] = $hook;
    }

    final class FakeWpdb
    {
        public string $prefix = 'wp_';
        public bool $lose_race = false;

        /** @var array<int, array<string, mixed>> */
        public array $clinics = [];

        public function prepare(string $query, ...$args): string
        {
            return vsprintf($query, $args);
        }

        public function get_row(string $query, $output = null)
        {
            if (preg_match('/FROM wp_kc_clinics WHERE id = (\d+)/', $query, $m) !== 1) {
                return null;
            }
            return $this->clinics[(int) $m[1]] ?? null;
        }

        public function query(string $query)
        {
            if (preg_match('/UPDATE wp_kc_clinics SET clinic_admin_id = (\d+) WHERE id = (\d+) AND clinic_admin_id = 0/', $query, $m) !== 1) {
                return false;
            }
            $id = (int) $m[2];
            if ($this->lose_race || !isset($this->clinics[$id]) || (int) $this->clinics[$id]['clinic_admin_id'] !== 0) {
                return 0;
            }
            $this->clinics[$id]['clinic_admin_id'] = (int) $m[1];
            return 1;
        }
    }

    function reset_world(): void
    {
        global $wpdb;
        $wpdb = new FakeWpdb();
        $wpdb->clinics = [
            57 => ['id' => 57, 'name' => 'Klinik Baru', 'email' => 'kb@klinik.id', 'telephone_no' => '0221', 'address' => 'Jl. A', 'city' => 'Bandung', 'state' => '', 'country' => 'Indonesia', 'postal_code' => '40111', 'clinic_admin_id' => 0],
            58 => ['id' => 58, 'name' => 'Klinik Berpemilik', 'email' => null, 'telephone_no' => null, 'address' => null, 'city' => null, 'state' => null, 'country' => null, 'postal_code' => null, 'clinic_admin_id' => 512],
        ];
        $GLOBALS['taken_emails'] = ['lama@klinik.id'];
        $GLOBALS['taken_usernames'] = [];
        $GLOBALS['inserted'] = [];
        $GLOBALS['deleted'] = [];
        $GLOBALS['notified'] = [];
        $GLOBALS['actions'] = [];
        $GLOBALS['roles'] = [];
    }

    require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-admins.php';

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

    /** [status, code] of an error, or [201, body] of a success. */
    function create(array $params): array
    {
        $result = (new ClinicAdmins())->create($params, new WP_REST_Request());
        if ($result instanceof WP_Error) {
            return [$result->get_error_data()['status'] ?? null, $result->get_error_code()];
        }
        return [201, $result];
    }

    $ok = ['name' => 'Dewi Lestari', 'email' => 'dewi@contoh.id', 'clinic_id' => 57];

    echo "POST /clinic-admins — refusals\n";
    reset_world();
    check('bad email', create(['email' => 'bukan-email'] + $ok), [400, 'praktiqu_invalid_email']);
    check('empty name', create(['name' => '  <b></b> '] + $ok), [400, 'praktiqu_invalid_name']);
    check('missing clinic', create(['clinic_id' => 0] + $ok), [400, 'praktiqu_missing_clinic']);
    check('unknown clinic', create(['clinic_id' => 99] + $ok), [404, 'praktiqu_clinic_not_found']);
    check('clinic already has an admin', create(['clinic_id' => 58] + $ok), [409, 'praktiqu_clinic_has_admin']);
    check('email already registered', create(['email' => 'LAMA@klinik.id'] + $ok), [409, 'praktiqu_email_taken']);
    check('nothing was inserted by any refusal', $GLOBALS['inserted'], []);

    echo "\nPOST /clinic-admins — success\n";
    reset_world();
    [$status, $body] = create($ok);
    check('201', $status, 201);
    check('body', $body, ['id' => 901, 'email' => 'dewi@contoh.id', 'username' => 'dewi', 'clinic_id' => 57, 'email_sent' => true]);
    check('user fields', array_intersect_key($GLOBALS['inserted'][0], array_flip(['user_login', 'user_email', 'first_name', 'last_name', 'display_name', 'role'])), [
        'user_login' => 'dewi', 'user_email' => 'dewi@contoh.id', 'first_name' => 'Dewi', 'last_name' => 'Lestari', 'display_name' => 'Dewi Lestari', 'role' => 'kiviCare_clinic_admin',
    ]);
    check('real password handed to wp_insert_user', $GLOBALS['inserted'][0]['user_pass'], 'Rahasia#1234');
    check('role set', $GLOBALS['roles'][901] ?? null, 'kiviCare_clinic_admin');
    check('clinic now owned by the new user', $wpdb->clinics[57]['clinic_admin_id'], 901);
    check('fallback notification sent', $GLOBALS['notified'], [[901, 'user']]);
    check('KiviCare SMS hook fired, clinic-save hook not', $GLOBALS['actions'], ['kivicare_clinic_admin_registered']);

    echo "\nPOST /clinic-admins — edge cases\n";
    reset_world();
    $GLOBALS['taken_usernames'] = ['dewi'];
    check('username taken → suffix', create($ok)[1]['username'] ?? null, 'dewi1');

    reset_world();
    check('single-word name → last name "-"', [create(['name' => 'Dewi'] + $ok)[0], $GLOBALS['inserted'][0]['last_name'] ?? null], [201, '-']);

    reset_world();
    $wpdb->lose_race = true;
    check('lost the race for the clinic', create($ok), [409, 'praktiqu_clinic_has_admin']);
    check('the user it created is deleted again', $GLOBALS['deleted'], [901]);
    check('no notification for the deleted user', $GLOBALS['notified'], []);

    echo "\n";
    if ($failures > 0) {
        echo "{$failures} FAILURE(S)\n";
        exit(1);
    }
    echo "ALL PASS\n";
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run (dari `Wordpress-Plugin/praktiqu-endpoint`):
```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-clinic-admins.php
```
Expected: FAIL — `PHP Warning: require_once(.../class-praktiqu-endpoint-clinic-admins.php): Failed to open stream` lalu fatal error.

- [ ] **Step 3: Tulis kelas `ClinicAdmins`**

Buat `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-admins.php`:

```php
<?php
/**
 * Clinic admin accounts for clinics created by the Next.js app.
 *
 * The app writes the wp_kc_clinics row itself; the account is made here because an account
 * must come from wp_insert_user — a raw INSERT into wp_users stores an unusable password hash
 * (see class-praktiqu-endpoint-receptionists.php for that incident).
 *
 * Mirrors KiviCare Pro's own flow (KCProClinicController::createClinic): create the user with
 * the kiviCare_clinic_admin role, point the clinic's clinic_admin_id at it, send the
 * clinic_admin_registration email, fire kivicare_clinic_admin_registered. It deliberately does
 * NOT fire kcpro_clinic_save: that listener mails the site admin a "new user" notice.
 *
 * Only a clinic WITHOUT an admin (clinic_admin_id = 0) is accepted, so this endpoint cannot be
 * used to take over somebody else's clinic.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class ClinicAdmins
{
    private const ROLE = 'kiviCare_clinic_admin';

    /**
     * @param array<string,mixed> $params
     * @return array<string,mixed>|\WP_Error
     */
    public function create(array $params, \WP_REST_Request $request): array|\WP_Error
    {
        global $wpdb;

        $email = sanitize_email((string) ($params['email'] ?? ''));
        if ($email === '' || !is_email($email)) {
            return new \WP_Error('praktiqu_invalid_email', 'A valid email is required.', ['status' => 400]);
        }

        $name = trim(sanitize_text_field((string) ($params['name'] ?? '')));
        if ($name === '') {
            return new \WP_Error('praktiqu_invalid_name', 'name is required.', ['status' => 400]);
        }

        $clinic_id = (int) ($params['clinic_id'] ?? 0);
        if ($clinic_id <= 0) {
            return new \WP_Error('praktiqu_missing_clinic', 'clinic_id is required.', ['status' => 400]);
        }

        $table  = $wpdb->prefix . 'kc_clinics';
        $clinic = $wpdb->get_row($wpdb->prepare(
            "SELECT id, name, email, telephone_no, address, city, state, country, postal_code, clinic_admin_id FROM {$table} WHERE id = %d",
            $clinic_id
        ), ARRAY_A);
        if (!is_array($clinic)) {
            return new \WP_Error('praktiqu_clinic_not_found', 'That clinic does not exist.', ['status' => 404]);
        }
        if ((int) $clinic['clinic_admin_id'] !== 0) {
            return new \WP_Error('praktiqu_clinic_has_admin', 'That clinic already has an admin.', ['status' => 409]);
        }

        if (email_exists($email)) {
            return new \WP_Error('praktiqu_email_taken', 'That email is already registered.', ['status' => 409]);
        }

        $first    = explode(' ', $name)[0];
        $last     = trim(substr($name, strlen($first))) ?: '-';
        $username = $this->unique_username($email);
        // A real, hashed password — the welcome email delivers it.
        $password = wp_generate_password(12, true);

        $user_id = wp_insert_user([
            'user_login'   => $username,
            'user_email'   => $email,
            'user_pass'    => $password,
            'first_name'   => $first,
            'last_name'    => $last,
            'display_name' => $name,
            'role'         => self::ROLE,
        ]);
        if (is_wp_error($user_id)) {
            return $user_id;
        }
        $user_id = (int) $user_id;
        (new \WP_User($user_id))->set_role(self::ROLE);

        // Conditional claim: if another request gave the clinic an admin between the read
        // above and now, this matches no row and the user just created is removed again.
        $claimed = $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET clinic_admin_id = %d WHERE id = %d AND clinic_admin_id = 0",
            $user_id,
            $clinic_id
        ));
        if ($claimed !== 1) {
            if (!function_exists('wp_delete_user')) {
                require_once ABSPATH . 'wp-admin/includes/user.php';
            }
            wp_delete_user($user_id);
            return new \WP_Error('praktiqu_clinic_has_admin', 'That clinic already has an admin.', ['status' => 409]);
        }

        $email_sent = $this->send_welcome($user_id, $email, $username, $password, $first, $last, $name, $clinic);

        do_action('kivicare_clinic_admin_registered', [
            'id'            => $clinic_id,
            'user_id'       => $user_id,
            'username'      => $username,
            'password'      => $password,
            'user_email'    => $email,
            'first_name'    => $first,
            'last_name'     => $last,
            'mobile_number' => '',
            'clinic_name'   => (string) ($clinic['name'] ?? ''),
        ]);

        // No password in the response: the app does not need it, and responses get logged.
        return [
            'id'         => $user_id,
            'email'      => $email,
            'username'   => $username,
            'clinic_id'  => $clinic_id,
            'email_sent' => $email_sent,
        ];
    }

    /**
     * KiviCare's clinic_admin_registration template when KiviCare's sender is loaded (it
     * carries the username and password); otherwise WordPress's own new-user email, which
     * carries a set-password link instead. A failed send never fails the request.
     *
     * @param array<string,mixed> $clinic
     */
    private function send_welcome(int $user_id, string $email, string $username, string $password, string $first, string $last, string $name, array $clinic): bool
    {
        $prefix = defined('KIVI_CARE_PREFIX') ? KIVI_CARE_PREFIX : 'kiviCare_';

        if (class_exists('App\emails\KCEmailSender')) {
            try {
                $sender = \App\emails\KCEmailSender::get_instance();
                if ($sender !== null) {
                    $address = implode(', ', array_filter(array_map(
                        static fn ($k) => trim((string) ($clinic[$k] ?? '')),
                        ['address', 'city', 'state', 'country', 'postal_code']
                    )));
                    $sent = $sender->sendEmailByTemplate($prefix . 'clinic_admin_registration', $email, [
                        'user_name'             => $username,
                        'user_email'            => $email,
                        'user_password'         => $password,
                        'user_role'             => 'Clinic Administrator',
                        'user_contact'          => '',
                        'clinic_name'           => (string) ($clinic['name'] ?? ''),
                        'clinic_email'          => (string) ($clinic['email'] ?? ''),
                        'clinic_contact_number' => (string) ($clinic['telephone_no'] ?? ''),
                        'clinic_address'        => $address,
                        'first_name'            => $first,
                        'last_name'             => $last,
                        'display_name'          => $name,
                    ]);
                    if ($sent) {
                        return true;
                    }
                    error_log('[praktiqu-endpoint] clinic admin welcome template failed for user ' . $user_id . '; falling back to the WordPress email');
                }
            } catch (\Throwable $e) {
                error_log('[praktiqu-endpoint] clinic admin welcome email failed: ' . $e->getMessage());
            }
        }

        try {
            wp_new_user_notification($user_id, null, 'user');
            return true;
        } catch (\Throwable $e) {
            error_log('[praktiqu-endpoint] wp_new_user_notification failed: ' . $e->getMessage());
            return false;
        }
    }

    private function unique_username(string $email): string
    {
        $base = sanitize_user((string) strstr($email, '@', true), true) ?: 'clinicadmin';
        $candidate = $base;
        $suffix = 1;
        while (username_exists($candidate)) {
            $candidate = $base . $suffix;
            $suffix++;
        }
        return $candidate;
    }
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run:
```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php tests/test-clinic-admins.php
```
Expected: baris terakhir `ALL PASS`, tidak ada baris `FAIL`.

- [ ] **Step 5: Daftarkan route dan sambungkan ke plugin**

Di `praktiqu-endpoint.php`:
- Ganti header `* Version:           1.7.0` menjadi `* Version:           1.8.0`.
- Ganti `define('PRAKTIQU_ENDPOINT_VERSION', '1.7.0');` menjadi `define('PRAKTIQU_ENDPOINT_VERSION', '1.8.0');`.
- Tepat di bawah `require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-receptionists.php';` tambahkan:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-clinic-admins.php';
```

Di `includes/class-praktiqu-endpoint-plugin.php`:
- Tambahkan properti di bawah `public Receptionists $receptionists;`:

```php
    public ClinicAdmins $clinic_admins;
```
- Di constructor, di bawah `$this->receptionists = new Receptionists();` tambahkan:

```php
        $this->clinic_admins = new ClinicAdmins();
```
- Ganti baris pembuatan `REST_Controller` menjadi (argumen baru di **akhir**):

```php
        $this->rest     = new REST_Controller($this->service, $this->jobs, $this->payments, $this->media, $this->patients, $this->appointments, $this->receptionists, $this->doctors, $this->encounters, $this->clinical_records, $this->clinic_admins);
```

Di `includes/class-praktiqu-endpoint-rest-controller.php`:
- Tambahkan properti di bawah `private ClinicalRecords $clinical_records;`:

```php
    private ClinicAdmins $clinic_admins;
```
- Ganti signature constructor dan tambahkan assignment-nya:

```php
    public function __construct(Service $service, Jobs $jobs, Payments $payments, Media $media, Patients $patients, Appointments $appointments, Receptionists $receptionists, Doctors $doctors, Encounters $encounters, ClinicalRecords $clinical_records, ClinicAdmins $clinic_admins)
    {
        $this->service = $service;
        $this->jobs = $jobs;
        $this->payments = $payments;
        $this->media = $media;
        $this->patients = $patients;
        $this->appointments = $appointments;
        $this->receptionists = $receptionists;
        $this->doctors = $doctors;
        $this->encounters = $encounters;
        $this->clinical_records = $clinical_records;
        $this->clinic_admins = $clinic_admins;
    }
```
- Di `register_routes()`, tepat **setelah** blok `register_rest_route($ns, '/receptionists', [...]);`, tambahkan:

```php
        // POST /praktiqu/v1/clinic-admins — create the admin account of a clinic that has none
        //
        // The Next.js app writes the wp_kc_clinics row itself; the account has to come from
        // wp_insert_user (see ClinicAdmins). Refuses a clinic that already has an admin.
        register_rest_route($ns, '/clinic-admins', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_create_clinic_admin'],
            'permission_callback' => [Plugin::class, 'verify_service_token'],
            'args'                => [
                'email'     => ['required' => true, 'type' => 'string', 'format' => 'email'],
                'name'      => ['required' => true, 'type' => 'string'],
                'clinic_id' => ['required' => true, 'type' => 'integer', 'sanitize_callback' => 'absint'],
            ],
        ]);
```
- Tepat setelah method `handle_create_receptionist()`, tambahkan:

```php
    /**
     * POST /praktiqu/v1/clinic-admins
     */
    public function handle_create_clinic_admin(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $result = $this->clinic_admins->create((array) $request->get_json_params(), $request);
        if (is_wp_error($result)) {
            return $result;
        }
        return new \WP_REST_Response($result, 201);
    }
```

Di `readme.txt`:
- Ganti `Stable tag: 1.7.0` menjadi `Stable tag: 1.8.0`.
- Tepat di atas baris `= 1.7.0 =` tambahkan:

```
= 1.8.0 =
* New POST /clinic-admins creates the admin account of a clinic the Next.js app
  just created: wp_insert_user with the kiviCare_clinic_admin role, a conditional
  claim of wp_kc_clinics.clinic_admin_id (only while it is 0), KiviCare's
  clinic_admin_registration email (WordPress's new-user email as fallback) and the
  kivicare_clinic_admin_registered action. Answers 400 praktiqu_invalid_email /
  praktiqu_invalid_name / praktiqu_missing_clinic, 404 praktiqu_clinic_not_found,
  409 praktiqu_clinic_has_admin / praktiqu_email_taken. The password is never
  returned.

```

- [ ] **Step 6: Lint semua file yang berubah dan jalankan seluruh tes plugin**

Run (dari `Wordpress-Plugin/praktiqu-endpoint`):
```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'for f in praktiqu-endpoint.php includes/class-praktiqu-endpoint-clinic-admins.php includes/class-praktiqu-endpoint-rest-controller.php includes/class-praktiqu-endpoint-plugin.php; do php -l "$f" || exit 1; done; for t in tests/test-*.php; do printf "%s: " "$t"; php "$t" | tail -1; done'
```
Expected: empat baris `No syntax errors detected in ...`, lalu setiap file tes berakhir `ALL PASS`.

- [ ] **Step 7: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-clinic-admins.php \
  Wordpress-Plugin/praktiqu-endpoint/tests/test-clinic-admins.php \
  Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-rest-controller.php \
  Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php \
  Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php \
  Wordpress-Plugin/praktiqu-endpoint/readme.txt
git commit -m "feat(plugin): POST /clinic-admins membuat akun admin untuk klinik baru (1.8.0)"
```

---

## Grup B — Backend

### Task B1: Lapisan data klinik (tulis, cek bentrok, hitung referensi)

**Files:**
- Modify: `src/repositories/wp/clinics.repo.ts` (tambah import dan bagian baru di akhir file)
- Modify: `src/repositories/wp/clinic-admins.repo.ts` (tambah `wpUserEmailExists`)
- Modify: `src/services/practice/service.ts` (`changePracticeAdmin` memakai `setClinicAdmin`)
- Test: `tests/integration/practice/clinics-repo-write.test.ts`

**Interfaces:**
- Consumes: `lastInsertId(tx)` (`src/lib/last-insert-id.ts`), `OFF_DAY_MODULE` (`src/repositories/wp/off-days.repo.ts`), `clinicPaymentOptionName(id)` (`src/repositories/wp/clinic-payment-settings.repo.ts`).
- Produces (dipakai B2, B4, B5, B6):
  - `type InsertClinicInput = { name: string; email: string | null; telephone: string | null; address: string | null; city: string | null; state: string | null; country: string | null; postalCode: string | null; countryCode: string | null; countryCallingCode: string | null; status: 0 | 1; clinicAdminId: bigint }`
  - `insertClinic(input: InsertClinicInput): Promise<bigint>`
  - `setClinicAdmin(id: bigint, adminId: bigint): Promise<void>`
  - `listClinicNames(): Promise<Array<{ id: number; name: string | null }>>` (termasuk klinik nonaktif)
  - `findClinicIdByEmail(email: string, exceptId?: number): Promise<number | null>`
  - `CLINIC_REFERENCE_TABLES`, `type ClinicReferenceKey`, `type ClinicReferenceCounts = Record<ClinicReferenceKey, number>`
  - `countClinicReferences(id: bigint): Promise<ClinicReferenceCounts>`
  - `deleteClinicRow(id: bigint): Promise<void>`
  - `wpUserEmailExists(email: string): Promise<boolean>` (di `clinic-admins.repo.ts`)

- [ ] **Step 1: Tulis tes integrasi yang gagal**

Buat `tests/integration/practice/clinics-repo-write.test.ts`:

```ts
/**
 * Clinic writes for CRUD klinik, against the test database: insertClinic, setClinicAdmin,
 * listClinicNames, findClinicIdByEmail, countClinicReferences, deleteClinicRow, plus
 * wpUserEmailExists.
 *
 * insertClinic takes an AUTO_INCREMENT id, so those rows are found and removed by the name
 * prefix PREFIX rather than by the id range. The tests of one file run in order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import {
  CLINIC_REFERENCE_TABLES,
  countClinicReferences,
  deleteClinicRow,
  findClinicIdByEmail,
  insertClinic,
  listClinicNames,
  setClinicAdmin,
} from '@/repositories/wp/clinics.repo';
import { wpUserEmailExists } from '@/repositories/wp/clinic-admins.repo';
import { clinicPaymentOptionName } from '@/repositories/wp/clinic-payment-settings.repo';

const BASE = 8_770_000;
const END = BASE + 10_000;
const FIXED = BASE + 1; // inserted with an explicit id, for the reference counts
const WP_USER = BASE + 500;
const DOCTOR = BASE + 600;
const PREFIX = 'Klinik Uji Repo 8770';
const DOMAIN = 'crud-repo.test.local';

async function wipe() {
  const named = await prisma.kcClinic.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  for (const id of [...named.map((c) => c.id), BigInt(FIXED)]) {
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM wp_options WHERE option_name = ?`, clinicPaymentOptionName(Number(id)));
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = ?`, DOCTOR);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE (id >= ? AND id < ?) OR name LIKE ?`, BASE, END, `${PREFIX}%`);
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
});

afterAll(async () => {
  await wipe();
});

describe('insertClinic and friends', () => {
  let id: bigint;

  it('inserts a row KiviCare can read and returns its id', async () => {
    id = await insertClinic({
      name: `${PREFIX} A`,
      email: `a@${DOMAIN}`,
      telephone: '0221234567',
      address: 'Jl. Uji 1',
      city: 'Bandung',
      state: 'Jawa Barat',
      country: 'Indonesia',
      postalCode: '40111',
      countryCode: 'ID',
      countryCallingCode: '+62',
      status: 1,
      clinicAdminId: 0n,
    });
    expect(id > 0n).toBe(true);

    const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM wp_kc_clinics WHERE id = ?`, id);
    expect(row).toMatchObject({
      name: `${PREFIX} A`,
      email: `a@${DOMAIN}`,
      telephone_no: '0221234567',
      address: 'Jl. Uji 1',
      city: 'Bandung',
      state: 'Jawa Barat',
      country: 'Indonesia',
      postal_code: '40111',
      country_code: 'ID',
      country_calling_code: '+62',
      status: 1,
      specialties: '[]',
      profile_image: null,
      extra: null,
    });
    expect(Number(row.clinic_admin_id)).toBe(0);
    expect(Number(row.clinic_logo)).toBe(0);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('setClinicAdmin points the clinic at an admin', async () => {
    await setClinicAdmin(id, BigInt(WP_USER));
    const row = await prisma.kcClinic.findUnique({ where: { id }, select: { clinicAdminId: true } });
    expect(Number(row!.clinicAdminId)).toBe(WP_USER);
  });

  it('listClinicNames includes inactive clinics', async () => {
    await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinics SET status = 0 WHERE id = ?`, id);
    expect(await listClinicNames()).toContainEqual({ id: Number(id), name: `${PREFIX} A` });
  });

  it('findClinicIdByEmail ignores case and spaces, and can skip one clinic', async () => {
    expect(await findClinicIdByEmail(`  A@${DOMAIN.toUpperCase()} `)).toBe(Number(id));
    expect(await findClinicIdByEmail(`a@${DOMAIN}`, Number(id))).toBeNull();
    expect(await findClinicIdByEmail(`tidak-ada@${DOMAIN}`)).toBeNull();
  });
});

describe('countClinicReferences and deleteClinicRow', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, 1, 0, 0, NOW())`,
      FIXED,
      `${PREFIX} Tetap`,
    );
  });

  it('answers every key, all zero, for a new clinic', async () => {
    const counts = await countClinicReferences(BigInt(FIXED));
    expect(Object.keys(counts).sort()).toEqual(Object.keys(CLINIC_REFERENCE_TABLES).sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('counts a psychologist mapping', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, owner, created_at) VALUES (?, ?, 0, NOW())`,
      DOCTOR,
      FIXED,
    );
    expect((await countClinicReferences(BigInt(FIXED))).doctors).toBe(1);
  });

  it('deleteClinicRow removes the clinic, its holidays and its payment option', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinic_schedule (start_date, end_date, module_type, module_id, description, status, created_at)
       VALUES ('2026-12-25', '2026-12-25', 'clinic', ?, 'Natal', 1, NOW())`,
      FIXED,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, '{}', 'no')`,
      clinicPaymentOptionName(FIXED),
    );

    await deleteClinicRow(BigInt(FIXED));

    expect(await prisma.kcClinic.count({ where: { id: BigInt(FIXED) } })).toBe(0);
    const [holidays] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`,
      FIXED,
    );
    expect(Number(holidays.n)).toBe(0);
    expect(await prisma.kcOption.count({ where: { optionName: clinicPaymentOptionName(FIXED) } })).toBe(0);
  });
});

describe('wpUserEmailExists', () => {
  it('matches a WordPress email in any case', async () => {
    await prisma.kcUser.create({
      data: { id: BigInt(WP_USER), userLogin: `u${WP_USER}`, userEmail: `u${WP_USER}@${DOMAIN}`, displayName: 'U', userRegistered: new Date() },
    });
    expect(await wpUserEmailExists(`U${WP_USER}@${DOMAIN.toUpperCase()}`)).toBe(true);
    expect(await wpUserEmailExists(`tidak-ada@${DOMAIN}`)).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/integration/practice/clinics-repo-write.test.ts`
Expected: FAIL — error impor, misalnya `SyntaxError: The requested module ... does not provide an export named 'CLINIC_REFERENCE_TABLES'` atau `insertClinic is not a function`.

- [ ] **Step 3: Tambahkan fungsi repository**

Di `src/repositories/wp/clinics.repo.ts`, ganti baris import di atas:

```ts
import { prisma } from '@/lib/db';
import { labelOf, paginate } from './wp-user';
```

menjadi:

```ts
import { prisma } from '@/lib/db';
import { lastInsertId } from '@/lib/last-insert-id';
import { clinicPaymentOptionName } from './clinic-payment-settings.repo';
import { OFF_DAY_MODULE } from './off-days.repo';
import { labelOf, paginate } from './wp-user';
```

Lalu tambahkan di **akhir** file:

```ts
/* ------------------------------------------------------------------ */
/* Create / delete (CRUD klinik)                                       */
/* ------------------------------------------------------------------ */

export type InsertClinicInput = {
  name: string;
  email: string | null;
  telephone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  countryCode: string | null;
  countryCallingCode: string | null;
  status: 0 | 1;
  /** 0 = no admin yet; one can be given later through change-admin. */
  clinicAdminId: bigint;
};

/**
 * Insert a clinic and return its id. Columns KiviCare's own create fills but the app does
 * not manage get KiviCare's empty values: specialties '[]', clinic_logo 0, profile_image NULL.
 */
export async function insertClinic(input: InsertClinicInput): Promise<bigint> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics
         (name, email, telephone_no, specialties, address, city, state, country, postal_code,
          status, clinic_admin_id, clinic_logo, profile_image, extra, country_code, country_calling_code, created_at)
       VALUES (?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NOW(3))`,
      input.name,
      input.email,
      input.telephone,
      input.address,
      input.city,
      input.state,
      input.country,
      input.postalCode,
      input.status,
      input.clinicAdminId,
      input.countryCode,
      input.countryCallingCode,
    );
    return lastInsertId(tx);
  });
}

export async function setClinicAdmin(id: bigint, adminId: bigint): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`, adminId, id);
}

/** Every clinic's id and name, inactive ones included — the input for the booking-link check. */
export async function listClinicNames(): Promise<Array<{ id: number; name: string | null }>> {
  const rows = await prisma.kcClinic.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/** The lowest-id clinic using this email (case and surrounding spaces ignored), or null. */
export async function findClinicIdByEmail(email: string, exceptId?: number): Promise<number | null> {
  const except = exceptId === undefined ? '' : 'AND id <> ?';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    `SELECT id FROM wp_kc_clinics WHERE LOWER(TRIM(email)) = LOWER(?) ${except} ORDER BY id LIMIT 1`,
    email.trim(),
    ...(exceptId === undefined ? [] : [exceptId]),
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Tables whose rows belong to a clinic through a `clinic_id` column. A clinic with any of
 * these may only be deactivated, never deleted. Taken from information_schema of the test DB
 * on 2026-10-15 — re-run that query (see the spec) when KiviCare adds tables.
 */
export const CLINIC_REFERENCE_TABLES = {
  appointments: 'wp_kc_appointments',
  bills: 'wp_kc_bills',
  encounters: 'wp_kc_patient_encounters',
  doctors: 'wp_kc_doctor_clinic_mappings',
  patients: 'wp_kc_patient_clinic_mappings',
  receptionists: 'wp_kc_receptionist_clinic_mappings',
  sessions: 'wp_kc_clinic_sessions',
  services: 'wp_kc_service_doctor_mapping',
  followups: 'wp_kc_followups',
  followupChains: 'wp_kc_followup_chains',
  taxes: 'wp_kc_taxes',
  notifications: 'wp_kc_custom_notifications',
} as const;

export type ClinicReferenceKey = keyof typeof CLINIC_REFERENCE_TABLES;
export type ClinicReferenceCounts = Record<ClinicReferenceKey, number>;

/** Rows per table that point at this clinic, in one round trip. */
export async function countClinicReferences(id: bigint): Promise<ClinicReferenceCounts> {
  const keys = Object.keys(CLINIC_REFERENCE_TABLES) as ClinicReferenceKey[];
  // Table names come from the constant above, never from input, so interpolating them is safe.
  const selects = keys.map((k) => `(SELECT COUNT(*) FROM ${CLINIC_REFERENCE_TABLES[k]} WHERE clinic_id = ?) AS \`${k}\``);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint | number>>>(
    `SELECT ${selects.join(', ')}`,
    ...keys.map(() => id),
  );
  const row = rows[0] ?? {};
  return Object.fromEntries(keys.map((k) => [k, Number(row[k] ?? 0)])) as ClinicReferenceCounts;
}

/**
 * Delete a clinic and what only means something with it: its holidays and its international
 * payment option. The caller checks countClinicReferences first; the admin account stays.
 *
 * No transaction: production tables are MyISAM, which ignores them. The clinic row goes LAST,
 * so a failure part-way leaves a clinic that can simply be deleted again.
 */
export async function deleteClinicRow(id: bigint): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM wp_kc_clinic_schedule WHERE module_type = ? AND module_id = ?`,
    OFF_DAY_MODULE.CLINIC,
    id,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM wp_options WHERE option_name = ?`, clinicPaymentOptionName(Number(id)));
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id = ?`, id);
}
```

Di `src/repositories/wp/clinic-admins.repo.ts`, tambahkan di **akhir** file:

```ts
/** Whether any WordPress account already uses this email (case ignored). */
export async function wpUserEmailExists(email: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM wp_users WHERE LOWER(user_email) = LOWER(?)`,
    email.trim(),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
```

- [ ] **Step 4: `changePracticeAdmin` memakai `setClinicAdmin`**

Di `src/services/practice/service.ts`, tambahkan `setClinicAdmin` ke import dari `@/repositories/wp/clinics.repo` (daftar import itu sudah berisi `findClinicById`, `listClinicMembers`, dst.). Lalu di dalam `changePracticeAdmin`, ganti blok ini:

```ts
    // clinic_admin_id is outside UpdateClinicInput, which covers the contact fields, so
    // it is set explicitly rather than widening that type for one caller.
    const { prisma } = await import('@/lib/db');
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`,
      newAdminId,
      practiceId,
    );
```

menjadi:

```ts
    // clinic_admin_id is outside UpdateClinicInput, which covers the contact fields.
    await setClinicAdmin(BigInt(practiceId), BigInt(newAdminId));
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice/clinics-repo-write.test.ts tests/integration/practice/change-admin.test.ts tests/unit/db/last-insert-id-pinning.test.ts`
Expected: PASS untuk ketiga file. Kalau `change-admin.test.ts` gagal, perubahan Step 4 salah.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/wp/clinics.repo.ts src/repositories/wp/clinic-admins.repo.ts \
  src/services/practice/service.ts tests/integration/practice/clinics-repo-write.test.ts
git commit -m "feat(practice): repository tulis/hapus klinik dan hitung data milik klinik"
```

---

### Task B2: Aturan nama dan email klinik

**Files:**
- Modify: `src/services/public/public-catalog.service.ts` (tambah `listActiveProfessionalSlugs`)
- Create: `src/services/practice/clinic-names.ts`
- Test: `tests/unit/practice/clinic-names.test.ts`

**Interfaces:**
- Consumes: `listClinicNames`, `findClinicIdByEmail` (B1); `slugifyName` (`src/lib/public/professional-slug.ts`); `listDoctorNames`, `PROFESSIONAL_STATUS` (sudah diimpor `public-catalog.service.ts`).
- Produces (dipakai B4, B5):
  - `listActiveProfessionalSlugs(): Promise<Set<string>>` (di `public-catalog.service.ts`)
  - `RESERVED_SLUGS: readonly string[]`
  - `type ClinicNameProblemReason = 'empty_slug' | 'numeric_slug' | 'reserved_slug' | 'clinic_slug_taken' | 'professional_slug_taken'`
  - `interface ClinicNameProblem { reason: ClinicNameProblemReason; slug: string; conflictId?: number; conflictName?: string }`
  - `findClinicNameProblem(name: string, ctx: { clinics: Array<{ id: number; name: string | null }>; professionalSlugs: ReadonlySet<string>; exceptId?: number }): ClinicNameProblem | null`
  - `class ClinicNameConflictError extends Error { readonly problem: ClinicNameProblem }`
  - `class ClinicEmailConflictError extends Error { readonly email: string; readonly conflictId: number }`
  - `assertClinicNameAvailable(name: string, opts?: { exceptId?: number }): Promise<void>`
  - `assertClinicEmailAvailable(email: string | null | undefined, opts?: { exceptId?: number }): Promise<void>`

Latar: link booking publik klinik adalah `/{slugifyName(nama)}`. FE mencari klinik dulu (id persis, lalu slug nama), baru link pribadi psikolog. Jadi nama klinik baru tidak boleh menghasilkan slug kosong, slug angka saja (tertukar dengan id klinik), kata route FE, slug klinik lain (aktif maupun nonaktif), atau slug psikolog aktif.

- [ ] **Step 1: Tulis tes unit yang gagal**

Buat `tests/unit/practice/clinic-names.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/repositories/wp/clinics.repo', () => ({ listClinicNames: vi.fn(), findClinicIdByEmail: vi.fn() }));
vi.mock('@/services/public/public-catalog.service', () => ({ listActiveProfessionalSlugs: vi.fn() }));

import { findClinicIdByEmail, listClinicNames } from '@/repositories/wp/clinics.repo';
import { listActiveProfessionalSlugs } from '@/services/public/public-catalog.service';
import {
  ClinicEmailConflictError,
  ClinicNameConflictError,
  RESERVED_SLUGS,
  assertClinicEmailAvailable,
  assertClinicNameAvailable,
  findClinicNameProblem,
} from '@/services/practice/clinic-names';

const clinics = [
  { id: 4, name: 'Klinik Sehat Bandung' },
  { id: 5, name: null },
  { id: 9, name: 'Ruang Tenang' },
];
const ctx = { clinics, professionalSlugs: new Set(['dewi-lestari']) };

describe('findClinicNameProblem', () => {
  it('accepts a fresh name', () => {
    expect(findClinicNameProblem('Klinik Baru Cimahi', ctx)).toBeNull();
  });

  it.each([
    ['', 'empty_slug', ''],
    ['!!! ???', 'empty_slug', ''],
    ['Ψυχή', 'empty_slug', ''],
    ['12345', 'numeric_slug', '12345'],
    ['  007 ', 'numeric_slug', '007'],
    ['Login', 'reserved_slug', 'login'],
    ['Cek Hasil', 'reserved_slug', 'cek-hasil'],
    ['Dewi Lestari', 'professional_slug_taken', 'dewi-lestari'],
  ])('%j → %s', (name, reason, slug) => {
    expect(findClinicNameProblem(name, ctx)).toEqual({ reason, slug });
  });

  it('names the clinic whose link it would take, by the FE slug rule', () => {
    expect(findClinicNameProblem('KLINIK sehat — Bandung!', ctx)).toEqual({
      reason: 'clinic_slug_taken',
      slug: 'klinik-sehat-bandung',
      conflictId: 4,
      conflictName: 'Klinik Sehat Bandung',
    });
  });

  it('ignores the clinic being renamed', () => {
    expect(findClinicNameProblem('Klinik Sehat  Bandung', { ...ctx, exceptId: 4 })).toBeNull();
  });

  it('holds every word the FE routes use', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      ['admin', 'atur-ulang-sandi', 'booking', 'cek-hasil', 'doctor', 'forgot-password', 'klinik', 'login', 'logout', 'lupa-sandi', 'pasien', 'psikolog', 'reset-password', 'staff', 'up'].sort(),
    );
  });
});

describe('assertClinicNameAvailable', () => {
  beforeEach(() => {
    vi.mocked(listClinicNames).mockResolvedValue(clinics);
    vi.mocked(listActiveProfessionalSlugs).mockResolvedValue(new Set(['dewi-lestari']));
  });

  it('resolves for a free name', async () => {
    await expect(assertClinicNameAvailable('Klinik Baru')).resolves.toBeUndefined();
  });

  it('throws ClinicNameConflictError carrying the problem', async () => {
    const err = await assertClinicNameAvailable('Ruang Tenang').catch((e) => e);
    expect(err).toBeInstanceOf(ClinicNameConflictError);
    expect(err.problem).toEqual({ reason: 'clinic_slug_taken', slug: 'ruang-tenang', conflictId: 9, conflictName: 'Ruang Tenang' });
  });

  it('passes exceptId through', async () => {
    await expect(assertClinicNameAvailable('Ruang Tenang', { exceptId: 9 })).resolves.toBeUndefined();
  });
});

describe('assertClinicEmailAvailable', () => {
  beforeEach(() => {
    vi.mocked(findClinicIdByEmail).mockReset();
  });

  it('skips an empty email without a query', async () => {
    await assertClinicEmailAvailable(null);
    await assertClinicEmailAvailable(undefined);
    await assertClinicEmailAvailable('   ');
    expect(findClinicIdByEmail).not.toHaveBeenCalled();
  });

  it('resolves when no other clinic has it', async () => {
    vi.mocked(findClinicIdByEmail).mockResolvedValue(null);
    await expect(assertClinicEmailAvailable('baru@klinik.id')).resolves.toBeUndefined();
  });

  it('throws ClinicEmailConflictError naming the clinic that has it', async () => {
    vi.mocked(findClinicIdByEmail).mockResolvedValue(4);
    const err = await assertClinicEmailAvailable(' a@b.co ', { exceptId: 7 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClinicEmailConflictError);
    expect(err.conflictId).toBe(4);
    expect(findClinicIdByEmail).toHaveBeenCalledWith('a@b.co', 7);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/unit/practice/clinic-names.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/practice/clinic-names"`.

- [ ] **Step 3: Tambahkan `listActiveProfessionalSlugs`**

Di `src/services/public/public-catalog.service.ts`, tepat **setelah** fungsi `findPublicProfessionalBySlug`, tambahkan:

```ts
/**
 * Every personal-link slug an active professional holds — the same rule
 * findPublicProfessionalBySlug matches on. A clinic must not take one of these: the FE
 * resolves /{slug} to a clinic first, so the professional's link would stop working.
 */
export async function listActiveProfessionalSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const d of await listDoctorNames()) {
    if (d.status !== PROFESSIONAL_STATUS.ACTIVE) continue;
    const slug = slugifyName(publicFullName(d));
    if (slug !== '') slugs.add(slug);
  }
  return slugs;
}
```

- [ ] **Step 4: Tulis `clinic-names.ts`**

Buat `src/services/practice/clinic-names.ts`:

```ts
/**
 * Which names and emails a clinic may have.
 *
 * A clinic's public booking link is `/{slugifyName(name)}` — the FE builds it with
 * BookingApi::slugify(), which slugifyName mirrors byte for byte. The FE resolves `/{slug}`
 * to a clinic by exact id first, then by slug, and only then to a professional's personal
 * link. So a name is refused when its slug would be empty, all digits (read as another
 * clinic's id), a word the FE routes use, another clinic's slug (inactive ones too — they
 * can be reactivated), or an active professional's slug.
 *
 * Spec: docs/superpowers/specs/2026-10-15-crud-klinik-design.md §2c.
 */
import { slugifyName } from '@/lib/public/professional-slug';
import { findClinicIdByEmail, listClinicNames } from '@/repositories/wp/clinics.repo';
import { listActiveProfessionalSlugs } from '@/services/public/public-catalog.service';

/** The FE's `{tenant}` route excludes these (routes/web.php). */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'klinik',
  'psikolog',
  'login',
  'logout',
  'booking',
  'staff',
  'doctor',
  'pasien',
  'cek-hasil',
  'up',
  'forgot-password',
  'reset-password',
  'lupa-sandi',
  'atur-ulang-sandi',
];

export type ClinicNameProblemReason =
  | 'empty_slug'
  | 'numeric_slug'
  | 'reserved_slug'
  | 'clinic_slug_taken'
  | 'professional_slug_taken';

export interface ClinicNameProblem {
  reason: ClinicNameProblemReason;
  slug: string;
  conflictId?: number;
  conflictName?: string;
}

export class ClinicNameConflictError extends Error {
  constructor(public readonly problem: ClinicNameProblem) {
    super(`Clinic name refused: ${problem.reason} (${problem.slug})`);
    this.name = 'ClinicNameConflictError';
  }
}

export class ClinicEmailConflictError extends Error {
  constructor(
    public readonly email: string,
    public readonly conflictId: number,
  ) {
    super(`Clinic ${conflictId} already uses ${email}`);
    this.name = 'ClinicEmailConflictError';
  }
}

/** Pure: the first rule this name breaks, or null. `exceptId` is the clinic being renamed. */
export function findClinicNameProblem(
  name: string,
  ctx: {
    clinics: Array<{ id: number; name: string | null }>;
    professionalSlugs: ReadonlySet<string>;
    exceptId?: number;
  },
): ClinicNameProblem | null {
  const slug = slugifyName(name);
  if (slug === '') return { reason: 'empty_slug', slug };
  if (/^[0-9]+$/.test(slug)) return { reason: 'numeric_slug', slug };
  if (RESERVED_SLUGS.includes(slug)) return { reason: 'reserved_slug', slug };

  const clash = ctx.clinics.find((c) => c.id !== ctx.exceptId && slugifyName(c.name ?? '') === slug);
  if (clash) {
    return { reason: 'clinic_slug_taken', slug, conflictId: clash.id, conflictName: clash.name ?? '' };
  }

  if (ctx.professionalSlugs.has(slug)) return { reason: 'professional_slug_taken', slug };
  return null;
}

export async function assertClinicNameAvailable(name: string, opts: { exceptId?: number } = {}): Promise<void> {
  const [clinics, professionalSlugs] = await Promise.all([listClinicNames(), listActiveProfessionalSlugs()]);
  const problem = findClinicNameProblem(name, { clinics, professionalSlugs, exceptId: opts.exceptId });
  if (problem) throw new ClinicNameConflictError(problem);
}

/** KiviCare refuses a second clinic with the same email; so do we. An empty email is fine. */
export async function assertClinicEmailAvailable(
  email: string | null | undefined,
  opts: { exceptId?: number } = {},
): Promise<void> {
  const wanted = email?.trim() ?? '';
  if (wanted === '') return;
  const conflictId = await findClinicIdByEmail(wanted, opts.exceptId);
  if (conflictId !== null) throw new ClinicEmailConflictError(wanted, conflictId);
}
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/unit/practice/clinic-names.test.ts && npx tsc --noEmit`
Expected: tes PASS, `tsc` tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/services/public/public-catalog.service.ts src/services/practice/clinic-names.ts tests/unit/practice/clinic-names.test.ts
git commit -m "feat(practice): aturan nama dan email klinik supaya link booking tidak bentrok"
```

---

### Task B3: Klien plugin `createClinicAdminViaPlugin`

**Files:**
- Create: `src/repositories/wp/clinic-admins.write.ts`
- Test: `tests/unit/practice/clinic-admins-write.test.ts`

**Interfaces:**
- Consumes: `wpRequestJson`, `WpEndpointError` (`src/lib/wp-endpoint.ts`); endpoint plugin dari P1 (`POST /clinic-admins`).
- Produces (dipakai B4):
  - `type CreateClinicAdminInput = { name: string; email: string; clinicId: number }`
  - `type CreatedClinicAdmin = { id: number; email: string; clinicId: number; emailSent: boolean }`
  - `createClinicAdminViaPlugin(input: CreateClinicAdminInput): Promise<CreatedClinicAdmin>` — melempar `WpEndpointError` apa adanya dari plugin (status + `code` WordPress), atau `WpEndpointError` status 502 kalau balasan tidak punya id.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/unit/practice/clinic-admins-write.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/wp-endpoint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wp-endpoint')>()),
  wpRequestJson: vi.fn(),
}));

import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';
import { createClinicAdminViaPlugin } from '@/repositories/wp/clinic-admins.write';

const input = { name: 'Dewi Lestari', email: 'dewi@contoh.id', clinicId: 57 };

describe('createClinicAdminViaPlugin', () => {
  beforeEach(() => {
    vi.mocked(wpRequestJson).mockReset();
  });

  it('posts name, email and clinic_id and maps the reply', async () => {
    vi.mocked(wpRequestJson).mockResolvedValue({ id: 912, email: 'dewi@contoh.id', username: 'dewi', clinic_id: 57, email_sent: true });

    await expect(createClinicAdminViaPlugin(input)).resolves.toEqual({ id: 912, email: 'dewi@contoh.id', clinicId: 57, emailSent: true });
    expect(wpRequestJson).toHaveBeenCalledWith('/clinic-admins', {
      method: 'POST',
      body: { name: 'Dewi Lestari', email: 'dewi@contoh.id', clinic_id: 57 },
    });
  });

  it('reads anything but email_sent=true as false', async () => {
    vi.mocked(wpRequestJson).mockResolvedValue({ id: 912, email: 'dewi@contoh.id', username: 'dewi', clinic_id: 57 });
    expect((await createClinicAdminViaPlugin(input)).emailSent).toBe(false);
  });

  it.each([null, {}, { id: 0 }, { id: '912' }, { id: Number.NaN }])('502s a reply without a usable id: %j', async (reply) => {
    vi.mocked(wpRequestJson).mockResolvedValue(reply);
    const err = await createClinicAdminViaPlugin(input).catch((e) => e);
    expect(err).toBeInstanceOf(WpEndpointError);
    expect(err.status).toBe(502);
  });

  it('lets a plugin error through unchanged', async () => {
    const taken = new WpEndpointError('/clinic-admins failed 409: That email is already registered.', 409, 'praktiqu_email_taken');
    vi.mocked(wpRequestJson).mockRejectedValue(taken);
    await expect(createClinicAdminViaPlugin(input)).rejects.toBe(taken);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/unit/practice/clinic-admins-write.test.ts`
Expected: FAIL — `Failed to resolve import "@/repositories/wp/clinic-admins.write"`.

- [ ] **Step 3: Tulis klien**

Buat `src/repositories/wp/clinic-admins.write.ts`:

```ts
/**
 * Clinic admin accounts — created by the praktiqu-endpoint plugin, never by direct SQL.
 *
 * A raw INSERT into wp_users stores an unusable password hash (the receptionist incident,
 * see receptionists.write.ts). The plugin uses wp_insert_user, claims the clinic's
 * clinic_admin_id (only while it is 0) and sends the welcome email. Plugin 1.8.0+.
 */
import { WpEndpointError, wpRequestJson } from '@/lib/wp-endpoint';

export type CreateClinicAdminInput = {
  name: string;
  email: string;
  /** A clinic that has no admin yet (clinic_admin_id = 0); the plugin refuses any other. */
  clinicId: number;
};

export type CreatedClinicAdmin = {
  id: number;
  email: string;
  clinicId: number;
  /** False when WordPress could not send the welcome email; the admin then uses "Lupa sandi". */
  emailSent: boolean;
};

type PluginResponse = {
  id: number;
  email: string;
  username: string;
  clinic_id: number;
  email_sent: boolean;
};

export async function createClinicAdminViaPlugin(input: CreateClinicAdminInput): Promise<CreatedClinicAdmin> {
  const res = await wpRequestJson<PluginResponse | null>('/clinic-admins', {
    method: 'POST',
    body: { name: input.name, email: input.email, clinic_id: input.clinicId },
  });

  if (typeof res?.id !== 'number' || !Number.isFinite(res.id) || res.id <= 0) {
    throw new WpEndpointError('Clinic admin create returned no id', 502);
  }

  return { id: res.id, email: res.email, clinicId: res.clinic_id, emailSent: res.email_sent === true };
}
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/unit/practice/clinic-admins-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/wp/clinic-admins.write.ts tests/unit/practice/clinic-admins-write.test.ts
git commit -m "feat(practice): klien plugin untuk membuat akun admin klinik"
```

---

### Task B4: Tambah klinik — `createPractice` dan `POST /api/v1/practices`

**Files:**
- Modify: `src/types/practice.ts` (skema baru, ditaruh tepat di atas bagian `// Response shapes`)
- Modify: `src/services/practice/service.ts` (import, error baru, `createPractice`)
- Create: `src/lib/practice-problems.ts`
- Modify: `src/app/api/v1/practices/route.ts` (ganti stub `POST`)
- Test: `tests/integration/practice/practice-create.test.ts`

**Interfaces:**
- Consumes: B1 (`insertClinic`, `deleteClinicRow`, `wpUserEmailExists`, `ClinicReferenceCounts`), B2 (`assertClinicNameAvailable`, `assertClinicEmailAvailable`, `ClinicNameConflictError`, `ClinicEmailConflictError`), B3 (`createClinicAdminViaPlugin`), yang sudah ada: `isClinicAdminUser`, `NotAClinicAdminError`, `PracticeNotFoundError`, `PracticeValidationError`, `getPractice`, `requireRoles`, `KcError`, `WpEndpointError`.
- Produces:
  - `clinicAdminChoiceSchema`, `type ClinicAdminChoice`, `practiceCreateSchema`, `type PracticeCreateInput` (di `src/types/practice.ts`)
  - di `service.ts`: `class AdminEmailTakenError { readonly email: string }`, `class ClinicAdminProvisionError { readonly status: number }`, `class ClinicNotEmptyError { readonly id: number; readonly counts: Partial<ClinicReferenceCounts> }`, `interface CreatePracticeResult { practice: PracticeDTO; admin: { mode: 'existing' | 'new' | 'none'; wpUserId: number | null; emailSent: boolean | null } }`, `createPractice(input: unknown, ctx: { actorId: string }): Promise<CreatePracticeResult>`
  - `practiceProblem(err: unknown): NextResponse | null` (di `src/lib/practice-problems.ts`) — dipakai B5 dan B6 di semua route `/practices/*` yang disentuh.
  - `POST /api/v1/practices` (SUPER_ADMIN) → 201 `{ "data": PracticeDTO, "admin": { "mode", "wpUserId", "emailSent" } }`. **Jangan** menambah field `message` di respons ini: `PraktiquApi::unwrap()` di FE membuang semua selain `data` kalau ada `message`, dan `admin` akan hilang.

- [ ] **Step 1: Tulis tes integrasi yang gagal**

Buat `tests/integration/practice/practice-create.test.ts`:

```ts
/**
 * POST /api/v1/practices — a super admin creates a clinic, owned by an existing clinic admin,
 * by a new admin account (made by the praktiqu-endpoint plugin, mocked here) or by nobody yet.
 *
 * Clinics created through the route take an AUTO_INCREMENT id, so they are found and removed
 * by the name prefix NAME rather than by the id range.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

vi.mock('@/repositories/wp/clinic-admins.write', () => ({ createClinicAdminViaPlugin: vi.fn() }));

import { prisma } from '@/lib/db';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { createClinicAdminViaPlugin } from '@/repositories/wp/clinic-admins.write';
import { assertTestDb } from '../../billing/fixtures';
import { POST } from '@/app/api/v1/practices/route';

const BASE = 8_740_000;
const END = BASE + 10_000;
const EXISTING_CLINIC = BASE + 1;
const ADMIN_WP = BASE + 500; // a real clinic admin account
const PATIENT_WP = BASE + 501;
const DOCTOR_WP = BASE + 502; // active professional "Psikolog Uji Bentrok 8740"
const NEW_ADMIN_WP = BASE + 503; // the id the mocked plugin hands out
const NAME = 'Klinik Uji CRUD 8740';
const DOMAIN = 'crud-create.test.local';

const SUPER = 'crud-create-test-super';
const ADMIN_AUTH = 'crud-create-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function create(sub: string, role: string, body: unknown) {
  const req = new NextRequest('http://localhost/api/v1/practices', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return POST(req);
}
const superCreate = (body: unknown) => create(SUPER, 'SUPER_ADMIN', body);

const clinicRow = (name: string) =>
  prisma.kcClinic.findFirst({ where: { name }, select: { id: true, clinicAdminId: true, status: true } });
const clinicCount = () => prisma.kcClinic.count();

const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
async function wpUser(id: number, capabilities: string, meta: Record<string, string> = {}) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@${DOMAIN}`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities } });
  for (const [metaKey, metaValue] of Object.entries(meta)) {
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey, metaValue } });
  }
}

async function wipe() {
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE (id >= ? AND id < ?) OR name LIKE ?`, BASE, END, `${NAME}%`);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-create-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_WP, caps('kiviCare_clinic_admin'));
  await wpUser(PATIENT_WP, caps('kiviCare_patient'));
  await wpUser(DOCTOR_WP, caps('kiviCare_doctor'), { first_name: 'Psikolog', last_name: 'Uji Bentrok 8740' });
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, ?, 1, ?, 0, NOW())`,
    EXISTING_CLINIC,
    `${NAME} Lama`,
    `lama@${DOMAIN}`,
    ADMIN_WP,
  );
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN_AUTH, 'CLINIC_ADMIN', ADMIN_WP]] as const) {
    await prisma.user.create({
      data: {
        id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'Test',
        role, wpUserId: wp === null ? null : BigInt(wp), status: 1,
      },
    });
  }
});

afterAll(async () => {
  await wipe();
});

beforeEach(() => {
  vi.mocked(createClinicAdminViaPlugin).mockReset();
});

describe('refusals', () => {
  it('403s a clinic admin and creates nothing', async () => {
    const before = await clinicCount();
    expect((await create(ADMIN_AUTH, 'CLINIC_ADMIN', { name: `${NAME} Ditolak` })).status).toBe(403);
    expect(await clinicCount()).toBe(before);
  });

  it('400s a body that is not JSON', async () => {
    expect((await superCreate('bukan json')).status).toBe(400);
  });

  it.each([
    {},
    { name: '   ' },
    { name: `${NAME} X`, email: 'bukan-email' },
    { name: `${NAME} X`, admin: { mode: 'new', name: 'Tanpa Email' } },
    { name: `${NAME} X`, admin: { mode: 'existing', wpUserId: 'abc' } },
    { name: `${NAME} X`, timezone: 'Asia/Jakarta' },
  ])('422s %j', async (body) => {
    const res = await superCreate(body);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('validation_error');
  });

  it.each([
    [`${NAME} Lama`, 'clinic_slug_taken'],
    ['klinik UJI crud 8740 — lama!', 'clinic_slug_taken'],
    ['Psikolog Uji Bentrok 8740', 'professional_slug_taken'],
    ['Login', 'reserved_slug'],
    ['8740', 'numeric_slug'],
    ['!!!', 'empty_slug'],
  ])('409s the name %j as %s and creates nothing', async (name, reason) => {
    const before = await clinicCount();
    const res = await superCreate({ name });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_name_conflict', reason });
    expect(await clinicCount()).toBe(before);
  });

  it('names the clinic that holds the link', async () => {
    const res = await superCreate({ name: `${NAME} Lama` });
    expect(await res.json()).toMatchObject({ slug: 'klinik-uji-crud-8740-lama', conflictId: EXISTING_CLINIC, conflictName: `${NAME} Lama` });
  });

  it('409s a clinic email another clinic has, in any case', async () => {
    const res = await superCreate({ name: `${NAME} Email`, email: `LAMA@${DOMAIN}` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_email_conflict', conflictId: EXISTING_CLINIC });
    expect(await clinicRow(`${NAME} Email`)).toBeNull();
  });

  it('422s mode existing with an account that is not a clinic admin', async () => {
    const res = await superCreate({ name: `${NAME} Pasien`, admin: { mode: 'existing', wpUserId: PATIENT_WP } });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
    expect(await clinicRow(`${NAME} Pasien`)).toBeNull();
  });

  it('409s mode new with an email WordPress already has, before calling the plugin', async () => {
    const res = await superCreate({ name: `${NAME} Admin Ganda`, admin: { mode: 'new', name: 'Admin Ganda', email: `U${ADMIN_WP}@${DOMAIN}` } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('admin_email_taken');
    expect(createClinicAdminViaPlugin).not.toHaveBeenCalled();
    expect(await clinicRow(`${NAME} Admin Ganda`)).toBeNull();
  });
});

describe('creates', () => {
  it('mode none (the default): active, no admin, audited', async () => {
    const res = await superCreate({ name: `${NAME} Tanpa Admin`, email: `tanpa@${DOMAIN}`, telephoneNo: '0221234567', city: 'Bandung', address: '  ' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({
      name: `${NAME} Tanpa Admin`,
      email: `tanpa@${DOMAIN}`,
      telephoneNo: '0221234567',
      city: 'Bandung',
      address: null,
      status: 1,
    });
    expect(body.admin).toEqual({ mode: 'none', wpUserId: null, emailSent: null });

    const row = await clinicRow(`${NAME} Tanpa Admin`);
    expect(Number(row!.id)).toBe(body.data.id);
    expect(Number(row!.clinicAdminId)).toBe(0);

    const audit = await prisma.logEntry.findFirst({ where: { action: 'practice.create', resourceId: String(body.data.id) } });
    expect(audit).toMatchObject({ userId: SUPER, resource: 'clinic' });
    expect(audit!.metadata).toMatchObject({ adminMode: 'none', adminId: null });
  });

  it('can create an inactive clinic', async () => {
    const res = await superCreate({ name: `${NAME} Nonaktif`, status: 0 });
    expect(res.status).toBe(201);
    expect((await res.json()).data.status).toBe(0);
  });

  it('mode existing: the clinic belongs to that admin', async () => {
    const res = await superCreate({ name: `${NAME} Admin Lama`, admin: { mode: 'existing', wpUserId: ADMIN_WP } });
    expect(res.status).toBe(201);
    expect((await res.json()).admin).toEqual({ mode: 'existing', wpUserId: ADMIN_WP, emailSent: null });
    expect(Number((await clinicRow(`${NAME} Admin Lama`))!.clinicAdminId)).toBe(ADMIN_WP);
  });

  it('mode new: the plugin makes the account for the new clinic', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockImplementation(async ({ email, clinicId }) => {
      // What the real plugin does: claim the clinic for the account it created.
      await prisma.$executeRawUnsafe(`UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`, NEW_ADMIN_WP, clinicId);
      return { id: NEW_ADMIN_WP, email, clinicId, emailSent: true };
    });

    const res = await superCreate({ name: `${NAME} Admin Baru`, admin: { mode: 'new', name: ' Dewi Lestari ', email: `dewi@${DOMAIN}` } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.admin).toEqual({ mode: 'new', wpUserId: NEW_ADMIN_WP, emailSent: true });
    expect(createClinicAdminViaPlugin).toHaveBeenCalledWith({ name: 'Dewi Lestari', email: `dewi@${DOMAIN}`, clinicId: body.data.id });
    expect(Number((await clinicRow(`${NAME} Admin Baru`))!.clinicAdminId)).toBe(NEW_ADMIN_WP);
  });

  it('mode new: passes emailSent=false through', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockImplementation(async ({ email, clinicId }) => ({ id: NEW_ADMIN_WP, email, clinicId, emailSent: false }));
    const res = await superCreate({ name: `${NAME} Email Gagal`, admin: { mode: 'new', name: 'Dewi', email: `dewi2@${DOMAIN}` } });
    expect(res.status).toBe(201);
    expect((await res.json()).admin.emailSent).toBe(false);
  });
});

describe('a failed admin account leaves no clinic behind', () => {
  it('502 admin_provision_failed when the plugin fails', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(new WpEndpointError('/clinic-admins failed 500: boom', 500));
    const res = await superCreate({ name: `${NAME} Gagal`, admin: { mode: 'new', name: 'Dewi', email: `gagal@${DOMAIN}` } });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('admin_provision_failed');
    expect(await clinicRow(`${NAME} Gagal`)).toBeNull();
  });

  it('502 when WordPress never answered', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(new WpEndpointError('/clinic-admins: fetch failed', 0));
    const res = await superCreate({ name: `${NAME} Putus`, admin: { mode: 'new', name: 'Dewi', email: `putus@${DOMAIN}` } });
    expect(res.status).toBe(502);
    expect(await clinicRow(`${NAME} Putus`)).toBeNull();
  });

  it('409 admin_email_taken when WordPress got the email first', async () => {
    vi.mocked(createClinicAdminViaPlugin).mockRejectedValue(
      new WpEndpointError('/clinic-admins failed 409: That email is already registered.', 409, 'praktiqu_email_taken'),
    );
    const res = await superCreate({ name: `${NAME} Balapan`, admin: { mode: 'new', name: 'Dewi', email: `balapan@${DOMAIN}` } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('admin_email_taken');
    expect(await clinicRow(`${NAME} Balapan`)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/integration/practice/practice-create.test.ts`
Expected: FAIL — tes `creates` dan `refusals` mendapat 501 dari stub lama (mis. `expected 501 to be 201`).

- [ ] **Step 3: Tambahkan skema pembuatan**

Di `src/types/practice.ts`, tepat **di atas** blok komentar `// Response shapes`, tambahkan:

```ts
// ============================================================
// Practice creation
// ============================================================

/** Who becomes the new clinic's admin (wp_kc_clinics.clinic_admin_id). */
export const clinicAdminChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), wpUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ mode: z.literal('new'), name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(100) }).strict(),
  z.object({ mode: z.literal('none') }).strict(),
]);
export type ClinicAdminChoice = z.infer<typeof clinicAdminChoiceSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * POST /practices. The contact fields follow practiceUpdateSchema, but `name` is required
 * and the extra-blob fields (timezone, logoUrl, businessHours) are not accepted here — set
 * them afterwards with PATCH.
 */
export const practiceCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(191).nullable().optional(),
    telephoneNo: z.string().trim().min(3).max(40).nullable().optional(),
    address: optionalText(255),
    city: optionalText(80),
    state: optionalText(80),
    country: optionalText(80),
    postalCode: optionalText(20),
    countryCode: z.string().length(2, 'countryCode must be ISO 3166-1 alpha-2').nullable().optional(),
    countryCallingCode: z
      .string()
      .regex(/^\+\d{1,4}$/, 'countryCallingCode must be E.164 like "+1"')
      .nullable()
      .optional(),
    status: z
      .union([z.literal(PracticeStatus.ACTIVE), z.literal(PracticeStatus.INACTIVE)])
      .default(PracticeStatus.ACTIVE),
    admin: clinicAdminChoiceSchema.default({ mode: 'none' }),
  })
  .strict();
export type PracticeCreateInput = z.infer<typeof practiceCreateSchema>;
```

- [ ] **Step 4: Tambahkan error dan `createPractice` di service**

Di `src/services/practice/service.ts`, ubah import:

```ts
import { countOwnedClinics, isClinicAdminUser } from '@/repositories/wp/clinic-admins.repo';
```

menjadi:

```ts
import { countOwnedClinics, isClinicAdminUser, wpUserEmailExists } from '@/repositories/wp/clinic-admins.repo';
import { createClinicAdminViaPlugin } from '@/repositories/wp/clinic-admins.write';
import { WpEndpointError } from '@/lib/wp-endpoint';
import { assertClinicEmailAvailable, assertClinicNameAvailable } from './clinic-names';
```

Tambahkan `deleteClinicRow`, `insertClinic`, dan `type ClinicReferenceCounts` ke import dari `@/repositories/wp/clinics.repo`, dan `practiceCreateSchema` serta `type ClinicAdminChoice` ke import dari `@/types/practice`. Hasil akhirnya:

```ts
import {
  deleteClinicRow,
  findClinicById,
  insertClinic,
  listClinicMembers,
  listClinics as listClinicRows,
  setClinicAdmin,
  setClinicStatus,
  updateClinic,
  type ClinicReferenceCounts,
  type WpClinic,
} from '@/repositories/wp/clinics.repo';
```

```ts
import {
  HolidayDTO,
  PracticeDTO,
  holidayInputSchema,
  practiceCreateSchema,
  practiceUpdateSchema,
  type ClinicAdminChoice,
} from '@/types/practice';
```

Di bagian `/* Errors */`, tepat setelah kelas `PracticeValidationError`, tambahkan:

```ts
/** `admin.mode = 'new'` with an email some WordPress account already uses. */
export class AdminEmailTakenError extends Error {
  constructor(public readonly email: string) {
    super(`A WordPress account already uses ${email}`);
    this.name = 'AdminEmailTakenError';
  }
}

/** The plugin could not create the admin account; the clinic was removed again. */
export class ClinicAdminProvisionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ClinicAdminProvisionError';
  }
}

/** A permanent delete of a clinic that still has data; `counts` holds only non-zero keys. */
export class ClinicNotEmptyError extends Error {
  constructor(
    public readonly id: number,
    public readonly counts: Partial<ClinicReferenceCounts>,
  ) {
    super(`Practice ${id} still has data`);
    this.name = 'ClinicNotEmptyError';
  }
}
```

Lalu, tepat **setelah** fungsi `getPractice`, tambahkan:

```ts
export interface CreatePracticeResult {
  practice: PracticeDTO;
  admin: { mode: ClinicAdminChoice['mode']; wpUserId: number | null; emailSent: boolean | null };
}

/** '' and whitespace-only become NULL, the way KiviCare leaves an unfilled column. */
const orNull = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v);

/**
 * Create a clinic (SUPER_ADMIN). Every check that can refuse runs BEFORE anything is
 * written. With `admin.mode = 'new'` the clinic row is written first — the plugin needs its
 * id to claim it — and removed again if the account cannot be made, so a failed request
 * never leaves a half-made clinic behind.
 */
export async function createPractice(input: unknown, ctx: { actorId: string }): Promise<CreatePracticeResult> {
  const parsed = practiceCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new PracticeValidationError(
      'Invalid practice input',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const data = parsed.data;
  const admin = data.admin;

  await assertClinicNameAvailable(data.name);
  await assertClinicEmailAvailable(data.email);
  if (admin.mode === 'existing' && !(await isClinicAdminUser(BigInt(admin.wpUserId)))) {
    throw new NotAClinicAdminError(admin.wpUserId);
  }
  if (admin.mode === 'new' && (await wpUserEmailExists(admin.email))) {
    throw new AdminEmailTakenError(admin.email);
  }

  const id = await insertClinic({
    name: data.name,
    email: orNull(data.email),
    telephone: orNull(data.telephoneNo),
    address: orNull(data.address),
    city: orNull(data.city),
    state: orNull(data.state),
    country: orNull(data.country),
    postalCode: orNull(data.postalCode),
    countryCode: orNull(data.countryCode),
    countryCallingCode: orNull(data.countryCallingCode),
    status: data.status === 1 ? 1 : 0,
    clinicAdminId: admin.mode === 'existing' ? BigInt(admin.wpUserId) : 0n,
  });

  let adminId: number | null = admin.mode === 'existing' ? admin.wpUserId : null;
  let emailSent: boolean | null = null;
  if (admin.mode === 'new') {
    try {
      const created = await createClinicAdminViaPlugin({ name: admin.name, email: admin.email, clinicId: Number(id) });
      adminId = created.id;
      emailSent = created.emailSent;
    } catch (err) {
      await removeHalfMadeClinic(id);
      if (err instanceof WpEndpointError) {
        if (err.status === 409 && err.code === 'praktiqu_email_taken') throw new AdminEmailTakenError(admin.email);
        throw new ClinicAdminProvisionError(err.message, err.status);
      }
      throw err;
    }
  }

  await logging.audit('practice.create', {
    userId: ctx.actorId,
    resource: 'clinic',
    resourceId: String(id),
    metadata: { adminMode: admin.mode, adminId },
  });

  return { practice: await getPractice(Number(id)), admin: { mode: admin.mode, wpUserId: adminId, emailSent } };
}

/** The clinic was written moments ago and has no data, so deleting it outright is safe. */
async function removeHalfMadeClinic(id: bigint): Promise<void> {
  try {
    await deleteClinicRow(id);
  } catch (cleanupErr) {
    // Left behind with clinic_admin_id = 0: findable by id in this log line and removable
    // with DELETE /practices/:id?permanent=true.
    await logging.error('createPractice: could not remove a clinic whose admin account failed', cleanupErr, {
      resource: 'clinic',
      resourceId: String(id),
    });
  }
}
```

- [ ] **Step 5: Tulis pemeta error → respons**

Buat `src/lib/practice-problems.ts`:

```ts
/**
 * Practice-service errors → problem+json responses, shared by every /practices route that
 * creates, edits, (de)activates or deletes a clinic. `code` is the stable slug the Laravel
 * FE matches on; `title`/`detail` are English and may change.
 *
 * Returns null for anything it does not know, so the route can log it and answer 500.
 */
import { NextResponse } from 'next/server';
import { KcError } from '@/lib/kc-response';
import { ClinicEmailConflictError, ClinicNameConflictError } from '@/services/practice/clinic-names';
import {
  AdminEmailTakenError,
  ClinicAdminProvisionError,
  ClinicNotEmptyError,
  NotAClinicAdminError,
  PracticeNotFoundError,
  PracticeValidationError,
} from '@/services/practice/service';

function problem(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json({ status, ...body }, { status });
}

export function practiceProblem(err: unknown): NextResponse | null {
  if (err instanceof PracticeNotFoundError) {
    return problem(404, {
      type: '/errors/resource-not-found',
      title: 'Practice not found',
      code: 'practice_not_found',
      detail: `Practice ${err.id} does not exist.`,
    });
  }
  if (err instanceof PracticeValidationError) {
    return problem(422, {
      type: '/errors/validation-error',
      title: 'Validation Error',
      code: 'validation_error',
      detail: err.message,
      issues: err.issues,
    });
  }
  if (err instanceof ClinicNameConflictError) {
    return problem(409, {
      type: '/errors/clinic-name-conflict',
      title: 'Clinic name not available',
      code: 'clinic_name_conflict',
      detail: err.message,
      ...err.problem,
    });
  }
  if (err instanceof ClinicEmailConflictError) {
    return problem(409, {
      type: '/errors/clinic-email-conflict',
      title: 'Clinic email already used',
      code: 'clinic_email_conflict',
      detail: err.message,
      conflictId: err.conflictId,
    });
  }
  if (err instanceof AdminEmailTakenError) {
    return problem(409, {
      type: '/errors/admin-email-taken',
      title: 'Admin email already registered',
      code: 'admin_email_taken',
      detail: err.message,
    });
  }
  if (err instanceof NotAClinicAdminError) {
    return problem(422, {
      type: '/errors/validation-error',
      title: 'Not a clinic admin',
      code: 'not_a_clinic_admin',
      detail: err.message,
    });
  }
  if (err instanceof ClinicNotEmptyError) {
    return problem(409, {
      type: '/errors/clinic-not-empty',
      title: 'Clinic still has data',
      code: 'clinic_not_empty',
      detail: err.message,
      counts: err.counts,
    });
  }
  if (err instanceof ClinicAdminProvisionError) {
    return problem(502, {
      type: '/errors/upstream',
      title: 'Admin account could not be created',
      code: 'admin_provision_failed',
      detail: err.message,
    });
  }
  if (err instanceof KcError) {
    return problem(err.httpStatus, { type: '/errors/forbidden', title: 'Forbidden', code: 'forbidden', detail: err.message });
  }
  return null;
}
```

- [ ] **Step 6: Ganti stub `POST`**

Ganti seluruh isi `src/app/api/v1/practices/route.ts` dengan:

```ts
/**
 * GET  /api/v1/practices — list practices (paginated; a CLINIC_ADMIN sees their own)
 * POST /api/v1/practices — create a practice (SUPER_ADMIN)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { practiceProblem } from '@/lib/practice-problems';
import { createPractice, listPractices } from '@/services/practice/service';
import { logging } from '@/lib/logging';

/** GET /api/v1/practices — paginated list */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  const { searchParams } = req.nextUrl;
  const page = Number(searchParams.get('page') ?? 1);
  const limit = Number(searchParams.get('limit') ?? 20);
  const status = searchParams.get('status') ? Number(searchParams.get('status')) : undefined;

  try {
    // The repository filters on active/inactive rather than an arbitrary status
    // integer, since wp_kc_clinics only has the two.
    const result = await listPractices({ page, limit, includeInactive: status !== 1 }, gate.actor);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    await logging.error('listPractices failed', err, { path: '/api/v1/practices' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/practices — create a clinic, optionally with its admin.
 *
 * Body: practiceCreateSchema (src/types/practice.ts). 201 `{ data: PracticeDTO, admin }`.
 * No `message` key: the Laravel FE's unwrap() would then keep only `data` and drop `admin`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400, code: 'invalid_json' },
      { status: 400 },
    );
  }

  try {
    const result = await createPractice(body, { actorId: gate.actor.id });
    return NextResponse.json({ data: result.practice, admin: result.admin }, { status: 201 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('createPractice failed', err, { path: '/api/v1/practices', method: 'POST' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice/practice-create.test.ts tests/integration/practice/practice-list-scope.test.ts && npx tsc --noEmit`
Expected: kedua file PASS, `tsc` tanpa error.

Kalau ada tes lama yang mengharapkan 501 dari `POST /practices`, cari dengan `grep -rn "501" tests | grep -i practice`, lalu ubah harapannya ke perilaku baru (403 untuk CLINIC_ADMIN, 422 untuk body kosong dari super admin) dan sertakan file itu di commit.

- [ ] **Step 8: Commit**

```bash
git add src/types/practice.ts src/services/practice/service.ts src/lib/practice-problems.ts \
  src/app/api/v1/practices/route.ts tests/integration/practice/practice-create.test.ts
git commit -m "feat(practice): POST /practices membuat klinik dengan admin lama, admin baru, atau tanpa admin"
```

---

### Task B5: Status klinik khusus super admin, cek nama/email saat edit, endpoint aktifkan

**Files:**
- Modify: `src/services/practice/service.ts` (`updatePractice`, `setPracticeStatus` baru)
- Modify: `src/app/api/v1/practices/[id]/route.ts` (ganti seluruh isi)
- Create: `src/app/api/v1/practices/[id]/activate/route.ts`
- Modify: `tests/billing/practice-routes-scope.integration.test.ts` (satu tes lama: CLINIC_ADMIN `DELETE` kini 403, bukan 404)
- Test: `tests/integration/practice/practice-status.test.ts`

**Interfaces:**
- Consumes: B2 (`assertClinicNameAvailable`, `assertClinicEmailAvailable`), B4 (`practiceProblem`), `forbidden()` dari `src/lib/problem-details.ts`, `setClinicStatus` (sudah ada).
- Produces:
  - `setPracticeStatus(id: number, status: 0 | 1, ctx: { actorId: string }): Promise<PracticeDTO>`
  - `PATCH /api/v1/practices/:id`: CLINIC_ADMIN yang mengirim key `status` → 403 `code: "status_change_forbidden"`. Nama/email yang berubah dicek seperti saat tambah (409).
  - `DELETE /api/v1/practices/:id` → **SUPER_ADMIN saja**, 204, status 0, audit `practice.deactivate`.
  - `POST /api/v1/practices/:id/activate` → SUPER_ADMIN, 200 `{ "data": PracticeDTO }`, audit `practice.activate`.

- [ ] **Step 1: Tulis tes integrasi yang gagal**

Buat `tests/integration/practice/practice-status.test.ts`:

```ts
/**
 * Who may change what on an existing clinic: a CLINIC_ADMIN edits their own clinic's profile
 * but never its status; a SUPER_ADMIN deactivates (DELETE) and reactivates (POST /activate).
 * A renamed clinic obeys the same name/email rules as a new one.
 *
 * The tests of one file run in order and build on each other's state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { DELETE, PATCH } from '@/app/api/v1/practices/[id]/route';
import { POST as ACTIVATE } from '@/app/api/v1/practices/[id]/activate/route';

const BASE = 8_750_000;
const END = BASE + 10_000;
const OWN = BASE + 1; // the clinic admin's clinic
const OTHER = BASE + 2;
const MISSING = BASE + 9;
const ADMIN_WP = BASE + 500;
const OTHER_ADMIN_WP = BASE + 501;
const NAME = 'Klinik Uji Status 8750';
const DOMAIN = 'crud-status.test.local';

const SUPER = 'crud-status-test-super';
const ADMIN_AUTH = 'crud-status-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function call(method: 'PATCH' | 'DELETE', sub: string, role: string, id: number | string, body?: unknown) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return (method === 'PATCH' ? PATCH : DELETE)(req, { params: { id: String(id) } });
}
async function activate(sub: string, role: string, id: number | string) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}/activate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await token(sub, role)}` },
  });
  return ACTIVATE(req, { params: { id: String(id) } });
}

const statusOf = async (id: number) =>
  (await prisma.kcClinic.findUnique({ where: { id: BigInt(id) }, select: { status: true } }))!.status;
const lastAudit = (action: string) =>
  prisma.logEntry.findFirst({ where: { action, resourceId: String(OWN) }, orderBy: { occurredAt: 'desc' } });

const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
async function wpUser(id: number) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@${DOMAIN}`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_clinic_admin') } });
}
async function clinic(id: number, name: string, email: string, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, ?, 1, ?, 0, NOW())`,
    id, name, email, adminId,
  );
}

async function wipe() {
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-status-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_WP);
  await wpUser(OTHER_ADMIN_WP);
  await clinic(OWN, `${NAME} Milik`, `milik@${DOMAIN}`, ADMIN_WP);
  await clinic(OTHER, `${NAME} Lain`, `lain@${DOMAIN}`, OTHER_ADMIN_WP);
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN_AUTH, 'CLINIC_ADMIN', ADMIN_WP]] as const) {
    await prisma.user.create({
      data: {
        id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'Test',
        role, wpUserId: wp === null ? null : BigInt(wp), status: 1,
      },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('clinic admin', () => {
  it.each([{ status: 0 }, { status: 1 }, { name: `${NAME} Milik X`, status: 1 }])(
    'may not send status (%j): 403 status_change_forbidden, nothing changes',
    async (body) => {
      const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, body);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('status_change_forbidden');
      expect(await statusOf(OWN)).toBe(1);
      expect((await prisma.kcClinic.findUnique({ where: { id: BigInt(OWN) } }))!.name).toBe(`${NAME} Milik`);
    },
  );

  it('edits the profile of their own clinic, audited under their own id', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} Milik Baru`, city: 'Cimahi' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ name: `${NAME} Milik Baru`, city: 'Cimahi' });
    expect(await lastAudit('practice.update')).toMatchObject({ userId: ADMIN_AUTH });
  });

  it('cannot take another clinic\'s booking link', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} LAIN` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_name_conflict', reason: 'clinic_slug_taken', conflictId: OTHER });
  });

  it('cannot take another clinic\'s email', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { email: `LAIN@${DOMAIN}` });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'clinic_email_conflict', conflictId: OTHER });
  });

  it('may keep its own name and email (no self-conflict)', async () => {
    const res = await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OWN, { name: `${NAME} Milik Baru`, email: `MILIK@${DOMAIN}` });
    expect(res.status).toBe(200);
  });

  it('gets 404 for another clinic', async () => {
    expect((await call('PATCH', ADMIN_AUTH, 'CLINIC_ADMIN', OTHER, { city: 'Garut' })).status).toBe(404);
  });

  it('may not deactivate or activate', async () => {
    expect((await call('DELETE', ADMIN_AUTH, 'CLINIC_ADMIN', OWN)).status).toBe(403);
    expect((await activate(ADMIN_AUTH, 'CLINIC_ADMIN', OWN)).status).toBe(403);
    expect(await statusOf(OWN)).toBe(1);
  });
});

describe('super admin', () => {
  it('may still PATCH status', async () => {
    expect((await call('PATCH', SUPER, 'SUPER_ADMIN', OTHER, { status: 0 })).status).toBe(200);
    expect(await statusOf(OTHER)).toBe(0);
    expect((await call('PATCH', SUPER, 'SUPER_ADMIN', OTHER, { status: 1 })).status).toBe(200);
  });

  it('deactivates with DELETE (204), audited', async () => {
    const res = await call('DELETE', SUPER, 'SUPER_ADMIN', OWN);
    expect(res.status).toBe(204);
    expect(await statusOf(OWN)).toBe(0);
    expect(await lastAudit('practice.deactivate')).toMatchObject({ userId: SUPER, resource: 'clinic' });
  });

  it('reactivates with POST /activate, audited', async () => {
    const res = await activate(SUPER, 'SUPER_ADMIN', OWN);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe(1);
    expect(await statusOf(OWN)).toBe(1);
    expect(await lastAudit('practice.activate')).toMatchObject({ userId: SUPER, resource: 'clinic' });
  });

  it('404s a clinic that does not exist, or a non-numeric id', async () => {
    expect((await call('DELETE', SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
    expect((await activate(SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
    expect((await activate(SUPER, 'SUPER_ADMIN', 'abc')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/integration/practice/practice-status.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/practices/[id]/activate/route"`.

- [ ] **Step 3: Perbarui `updatePractice` dan tambahkan `setPracticeStatus`**

Di `src/services/practice/service.ts`, di dalam `updatePractice`, tepat **setelah** baris

```ts
  const existing = await findClinicById(BigInt(id));
  if (!existing) throw new PracticeNotFoundError(id);
```

tambahkan:

```ts
  // A rename moves the public booking link, so it obeys the same rules as a new clinic.
  if (data.name !== undefined && data.name !== existing.name) {
    await assertClinicNameAvailable(data.name, { exceptId: id });
  }
  const sameEmail = (data.email ?? '').trim().toLowerCase() === (existing.email ?? '').trim().toLowerCase();
  if (data.email && !sameEmail) {
    await assertClinicEmailAvailable(data.email, { exceptId: id });
  }
```

(Audit `practice.update` yang sudah ada **tetap** memakai `resource: 'practice'` dan `options.actorId`; jangan diubah — route di Step 4 kini mengirim `actorId` yang benar.)

Lalu tambahkan fungsi baru tepat **setelah** `updatePractice`:

```ts
/** Activate or deactivate one clinic (SUPER_ADMIN). Deactivating keeps every row it owns. */
export async function setPracticeStatus(id: number, status: 0 | 1, ctx: { actorId: string }): Promise<PracticeDTO> {
  const existing = await findClinicById(BigInt(id));
  if (!existing) throw new PracticeNotFoundError(id);

  await setClinicStatus([BigInt(id)], status);
  await logging.audit(status === 1 ? 'practice.activate' : 'practice.deactivate', {
    userId: ctx.actorId,
    resource: 'clinic',
    resourceId: String(id),
  });
  return getPractice(id);
}
```

- [ ] **Step 4: Ganti route `/practices/:id`**

Ganti seluruh isi `src/app/api/v1/practices/[id]/route.ts` dengan:

```ts
/**
 * GET    /api/v1/practices/:id — get a practice (SUPER_ADMIN; CLINIC_ADMIN for their own)
 * PATCH  /api/v1/practices/:id — update its profile; a CLINIC_ADMIN may not send `status`
 * DELETE /api/v1/practices/:id — SUPER_ADMIN: deactivate (status 0), not a delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { forbidden } from '@/lib/problem-details';
import { practiceProblem } from '@/lib/practice-problems';
import {
  assertPracticeInScope,
  getPractice,
  setPracticeStatus,
  updatePractice,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

type Params = { params: { id: string } };

const internalError = () =>
  NextResponse.json({ type: '/errors/internal', title: 'Internal Server Error', status: 500 }, { status: 500 });

/** GET /api/v1/practices/:id */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    return NextResponse.json({ data: await getPractice(Number(params.id)) }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('getPractice failed', err, { path: `/api/v1/practices/${params.id}` });
    return internalError();
  }
}

/** PATCH /api/v1/practices/:id */
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in gate) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400, code: 'invalid_json' },
      { status: 400 },
    );
  }

  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    // Switching a clinic on or off is the super admin's call; a clinic admin could otherwise
    // lock themselves (and their patients' bookings) out.
    if (gate.actor.role !== 'SUPER_ADMIN' && body !== null && typeof body === 'object' && 'status' in body) {
      return NextResponse.json(
        forbidden('status_change_forbidden', 'Only a super admin can change a clinic status.'),
        { status: 403 },
      );
    }
    const dto = await updatePractice(Number(params.id), body, { actorId: gate.actor.id });
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('updatePractice failed', err, { path: `/api/v1/practices/${params.id}`, method: 'PATCH' });
    return internalError();
  }
}

/** DELETE /api/v1/practices/:id — soft deactivate (status = 0) */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    await setPracticeStatus(Number(params.id), 0, { actorId: gate.actor.id });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('deactivatePractice failed', err, { path: `/api/v1/practices/${params.id}`, method: 'DELETE' });
    return internalError();
  }
}
```

- [ ] **Step 5: Tambahkan route aktifkan**

Buat `src/app/api/v1/practices/[id]/activate/route.ts`:

```ts
/**
 * POST /api/v1/practices/:id/activate — SUPER_ADMIN: switch a deactivated clinic back on.
 *
 * Its own action rather than PATCH {status: 1}, so the FE has one clear button and PATCH
 * need not tell roles apart for a single field.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { practiceProblem } from '@/lib/practice-problems';
import { assertPracticeInScope, setPracticeStatus } from '@/services/practice/service';
import { logging } from '@/lib/logging';

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    // Also turns a non-numeric :id into a 404 before BigInt() can throw.
    await assertPracticeInScope(gate.actor, Number(params.id));
    const dto = await setPracticeStatus(Number(params.id), 1, { actorId: gate.actor.id });
    return NextResponse.json({ data: dto }, { status: 200 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error('activatePractice failed', err, { path: `/api/v1/practices/${params.id}/activate` });
    return NextResponse.json({ type: '/errors/internal', title: 'Internal Server Error', status: 500 }, { status: 500 });
  }
}
```

- [ ] **Step 6: Perbarui tes scope lama**

`DELETE /practices/:id` kini ditolak untuk CLINIC_ADMIN di pemeriksaan role, sebelum pemeriksaan scope. Di `tests/billing/practice-routes-scope.integration.test.ts`, ganti tes

```ts
  it('clinic A cannot DELETE (deactivate) clinic B\'s practice', async () => {
    const res = await practiceDelete(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(404);
  });
```

dengan:

```ts
  it('clinic A cannot DELETE (deactivate) any practice — super admin only', async () => {
    const res = await practiceDelete(reqWith(jwtA, `http://localhost/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } });
    expect(res.status).toBe(403);
  });
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice tests/billing/practice-routes-scope.integration.test.ts && npx tsc --noEmit`
Expected: semua PASS (termasuk `practice-wp.test.ts`, `practice-list-scope.test.ts`, `practice-active-clinic.test.ts` yang sudah ada), `tsc` tanpa error.

Kalau tes lama lain gagal karena mengharapkan CLINIC_ADMIN boleh `DELETE`/mengubah `status`, ubah harapan tes itu ke perilaku baru dan sertakan file itu di commit. Jangan melonggarkan aturan di kode.

- [ ] **Step 8: Commit**

```bash
git add src/services/practice/service.ts 'src/app/api/v1/practices/[id]/route.ts' \
  'src/app/api/v1/practices/[id]/activate/route.ts' tests/integration/practice/practice-status.test.ts \
  tests/billing/practice-routes-scope.integration.test.ts
git commit -m "feat(practice): status klinik khusus super admin, endpoint aktifkan, cek nama saat edit"
```

---

### Task B6: Hapus permanen klinik kosong

**Files:**
- Modify: `src/services/practice/service.ts` (`deletePracticePermanently` baru)
- Modify: `src/app/api/v1/practices/[id]/route.ts` (fungsi `DELETE` saja)
- Test: `tests/integration/practice/practice-delete-permanent.test.ts`

**Interfaces:**
- Consumes: B1 (`countClinicReferences`, `deleteClinicRow`), B4 (`ClinicNotEmptyError`, `practiceProblem`), B5 (`setPracticeStatus`, `DELETE` route).
- Produces:
  - `deletePracticePermanently(id: number, ctx: { actorId: string }): Promise<void>`
  - `DELETE /api/v1/practices/:id?permanent=true` (SUPER_ADMIN) → 204, atau 409 `{ code: "clinic_not_empty", counts: { doctors: 3, appointments: 12 } }` (hanya kunci > 0), atau 404.

- [ ] **Step 1: Tulis tes integrasi yang gagal**

Buat `tests/integration/practice/practice-delete-permanent.test.ts`:

```ts
/**
 * DELETE /api/v1/practices/:id?permanent=true — only a clinic with no data at all can be
 * deleted; anything else answers 409 with what it still has, and stays.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { clinicPaymentOptionName } from '@/repositories/wp/clinic-payment-settings.repo';
import { DELETE } from '@/app/api/v1/practices/[id]/route';

const BASE = 8_760_000;
const END = BASE + 10_000;
const EMPTY = BASE + 1;
const BUSY = BASE + 2;
const MISSING = BASE + 9;
const DOCTOR = BASE + 600;
const SUPER = 'crud-delete-test-super';
const ADMIN_AUTH = 'crud-delete-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function remove(sub: string, role: string, id: number, query = '?permanent=true') {
  const req = new NextRequest(`http://localhost/api/v1/practices/${id}${query}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${await token(sub, role)}` },
  });
  return DELETE(req, { params: { id: String(id) } });
}

const exists = async (id: number) => (await prisma.kcClinic.count({ where: { id: BigInt(id) } })) === 1;

async function wipe() {
  for (const id of [EMPTY, BUSY]) {
    await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM wp_options WHERE option_name = ?`, clinicPaymentOptionName(id));
  }
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = ?`, DOCTOR);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.logEntry.deleteMany({ where: { userId: { in: [SUPER, ADMIN_AUTH] } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'crud-delete-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [EMPTY, BUSY]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, status, clinic_admin_id, clinic_logo, created_at) VALUES (?, ?, 1, 0, 0, NOW())`,
      id,
      `Klinik Uji Hapus 8760 ${id}`,
    );
  }
  // EMPTY has a holiday and a payment option — neither counts as "data", both go with it.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinic_schedule (start_date, end_date, module_type, module_id, description, status, created_at)
     VALUES ('2026-12-25', '2026-12-25', 'clinic', ?, 'Natal', 1, NOW())`,
    EMPTY,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_options (option_name, option_value, autoload) VALUES (?, '{}', 'no')`,
    clinicPaymentOptionName(EMPTY),
  );
  // BUSY has a psychologist.
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, owner, created_at) VALUES (?, ?, 0, NOW())`,
    DOCTOR,
    BUSY,
  );
  for (const [id, role] of [[SUPER, 'SUPER_ADMIN'], [ADMIN_AUTH, 'CLINIC_ADMIN']] as const) {
    await prisma.user.create({
      data: {
        id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'Test',
        role, wpUserId: role === 'CLINIC_ADMIN' ? BigInt(BASE + 500) : null, status: 1,
      },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('DELETE ?permanent=true', () => {
  it('403s a clinic admin', async () => {
    expect((await remove(ADMIN_AUTH, 'CLINIC_ADMIN', EMPTY)).status).toBe(403);
    expect(await exists(EMPTY)).toBe(true);
  });

  it('409s a clinic that still has data, listing only what it has', async () => {
    const res = await remove(SUPER, 'SUPER_ADMIN', BUSY);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('clinic_not_empty');
    expect(body.counts).toEqual({ doctors: 1 });
    expect(await exists(BUSY)).toBe(true);
  });

  it('deletes an empty clinic with its holidays and payment option, audited', async () => {
    const res = await remove(SUPER, 'SUPER_ADMIN', EMPTY);
    expect(res.status).toBe(204);
    expect(await exists(EMPTY)).toBe(false);
    const [holidays] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM wp_kc_clinic_schedule WHERE module_type = 'clinic' AND module_id = ?`,
      EMPTY,
    );
    expect(Number(holidays.n)).toBe(0);
    expect(await prisma.kcOption.count({ where: { optionName: clinicPaymentOptionName(EMPTY) } })).toBe(0);

    const audit = await prisma.logEntry.findFirst({ where: { action: 'practice.delete', resourceId: String(EMPTY) } });
    expect(audit).toMatchObject({ userId: SUPER, resource: 'clinic' });
    expect(audit!.metadata).toMatchObject({ name: `Klinik Uji Hapus 8760 ${EMPTY}`, clinicAdminId: 0 });
  });

  it('404s a clinic that does not exist', async () => {
    expect((await remove(SUPER, 'SUPER_ADMIN', MISSING)).status).toBe(404);
  });

  it('without ?permanent=true still only deactivates', async () => {
    expect((await remove(SUPER, 'SUPER_ADMIN', BUSY, '')).status).toBe(204);
    expect(await exists(BUSY)).toBe(true);
    expect((await prisma.kcClinic.findUnique({ where: { id: BigInt(BUSY) } }))!.status).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `npx vitest run tests/integration/practice/practice-delete-permanent.test.ts`
Expected: FAIL — `409s a clinic that still has data` mendapat 204 (DELETE masih hanya menonaktifkan) dan `deletes an empty clinic` menemukan barisnya masih ada.

- [ ] **Step 3: Tambahkan `deletePracticePermanently`**

Di `src/services/practice/service.ts`, tambahkan `countClinicReferences` ke import dari `@/repositories/wp/clinics.repo`. Lalu tepat **setelah** `setPracticeStatus`, tambahkan:

```ts
/**
 * Delete a clinic for good (SUPER_ADMIN) — only one with no data at all, e.g. one created
 * by mistake. Anything with appointments, bills, psychologists, patients, … can only be
 * deactivated: deleting it would orphan those rows. The admin account is kept.
 */
export async function deletePracticePermanently(id: number, ctx: { actorId: string }): Promise<void> {
  const clinic = await findClinicById(BigInt(id));
  if (!clinic) throw new PracticeNotFoundError(id);

  const counts = await countClinicReferences(BigInt(id));
  const nonZero = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) as Partial<ClinicReferenceCounts>;
  if (Object.keys(nonZero).length > 0) throw new ClinicNotEmptyError(id, nonZero);

  await deleteClinicRow(BigInt(id));
  await logging.audit('practice.delete', {
    userId: ctx.actorId,
    resource: 'clinic',
    resourceId: String(id),
    metadata: { name: clinic.name, clinicAdminId: Number(clinic.clinicAdminId) },
  });
}
```

- [ ] **Step 4: `DELETE` membaca `?permanent=true`**

Di `src/app/api/v1/practices/[id]/route.ts`:
- Tambahkan `deletePracticePermanently` ke import dari `@/services/practice/service`.
- Ganti komentar baris ketiga di header file menjadi:

```ts
 * DELETE /api/v1/practices/:id — SUPER_ADMIN: deactivate (status 0); with ?permanent=true,
 *                                 delete a clinic that has no data at all
```

- Ganti seluruh fungsi `DELETE` dengan:

```ts
/**
 * DELETE /api/v1/practices/:id — deactivate (status = 0).
 * DELETE /api/v1/practices/:id?permanent=true — delete, only when the clinic has no data
 * (409 clinic_not_empty with the counts otherwise).
 */
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  const permanent = req.nextUrl.searchParams.get('permanent') === 'true';
  try {
    await assertPracticeInScope(gate.actor, Number(params.id));
    if (permanent) {
      await deletePracticePermanently(Number(params.id), { actorId: gate.actor.id });
    } else {
      await setPracticeStatus(Number(params.id), 0, { actorId: gate.actor.id });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const mapped = practiceProblem(err);
    if (mapped) return mapped;
    await logging.error(permanent ? 'deletePractice failed' : 'deactivatePractice failed', err, {
      path: `/api/v1/practices/${params.id}`,
      method: 'DELETE',
    });
    return internalError();
  }
}
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice && npx tsc --noEmit`
Expected: semua PASS, `tsc` tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/services/practice/service.ts 'src/app/api/v1/practices/[id]/route.ts' \
  tests/integration/practice/practice-delete-permanent.test.ts
git commit -m "feat(practice): hapus permanen klinik yang belum punya data"
```

---

### Task B7: Dokumentasi kontrak, verifikasi penuh, push

**Files:**
- Modify: `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (§3, §4.2, §4.4, §4.5, §4.18 baru, §7)

**Interfaces:**
- Consumes: semua task B.
- Produces: branch `feat/crud-klinik` di remote, siap PR.

- [ ] **Step 1: Perbarui tabel hak akses (§3)**

Di tabel "Ringkasan hak akses", ganti dua baris pertama:

```markdown
| `GET/POST /practices` | ✅ | ✅ | ❌ | ❌ |
| `GET/PATCH/DELETE /practices/{id}` | ✅ | ✅ | ❌ | ❌ |
```

menjadi:

```markdown
| `GET /practices` | ✅ | 🔸 kliniknya sendiri | ❌ | ❌ |
| `POST /practices` | ✅ | ❌ | ❌ | ❌ |
| `GET/PATCH /practices/{id}` | ✅ | 🔸 kliniknya sendiri, `PATCH` tanpa `status` | ❌ | ❌ |
| `DELETE /practices/{id}`, `POST /practices/{id}/activate` | ✅ | ❌ | ❌ | ❌ |
```

- [ ] **Step 2: Ganti §4.2**

Ganti seluruh bagian dari judul `### 4.2 \`POST /api/v1/practices\` — ❌ belum ada` sampai sebelum `### 4.3` dengan:

````markdown
### 4.2 `POST /api/v1/practices` — tambah klinik (SUPER_ADMIN)

```bash
curl -X POST https://endpoint.praktiqu.com/api/v1/practices \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Klinik Sehat Cimahi",
    "email": "cimahi@kliniksehat.id",
    "telephoneNo": "0226651234",
    "address": "Jl. Amir Machmud 12",
    "city": "Cimahi",
    "country": "Indonesia",
    "admin": { "mode": "new", "name": "Dewi Lestari", "email": "dewi@kliniksehat.id" }
  }'
```

Field klinik sama dengan §4.4, tetapi `name` **wajib** dan `timezone`/`logoUrl`/`businessHours`
tidak diterima (isi lewat `PATCH`). `status` bawaan `1`. Skema `.strict()`.

`admin` (bawaan `{ "mode": "none" }`):

| `mode` | Field lain | Hasil |
|---|---|---|
| `none` | — | `clinic_admin_id = 0`; atur nanti lewat §4.11 |
| `existing` | `wpUserId` (id WordPress akun clinic admin, dari §4.17) | klinik milik akun itu |
| `new` | `name`, `email` | plugin `praktiqu-endpoint` ≥ 1.8.0 membuat akun `kiviCare_clinic_admin` dan mengirim email selamat datang |

Nama klinik menentukan link booking publik `/{slug}`, jadi nama ditolak (409
`clinic_name_conflict`) bila slug-nya kosong (`empty_slug`), hanya angka (`numeric_slug`), kata
route FE (`reserved_slug`), sama dengan klinik lain termasuk yang nonaktif
(`clinic_slug_taken`, dengan `conflictId`/`conflictName`), atau sama dengan link pribadi
psikolog aktif (`professional_slug_taken`).

Respons **201** (tanpa `message`):

```json
{
  "data": { "id": 57, "name": "Klinik Sehat Cimahi", "status": 1, "...": "PracticeDTO" },
  "admin": { "mode": "new", "wpUserId": 912, "emailSent": true }
}
```

`emailSent: false` berarti akun jadi tetapi email gagal terkirim — admin memakai "Lupa sandi".

Error: 422 `validation_error`, 409 `clinic_name_conflict` / `clinic_email_conflict` /
`admin_email_taken`, 422 `not_a_clinic_admin`, 502 `admin_provision_failed` (akun gagal dibuat;
klinik **sudah dihapus lagi**, aman untuk dicoba ulang). Semua pengecekan berjalan sebelum
apa pun ditulis.
````

- [ ] **Step 3: Tambahkan catatan di §4.4 dan ganti §4.5**

Di §4.4, tepat setelah kalimat "Semua field opsional (semantik PATCH). ... bukan diabaikan diam-diam.", tambahkan:

```markdown
CLINIC_ADMIN hanya untuk kliniknya sendiri dan **tidak boleh mengirim key `status`** sama
sekali (403 `status_change_forbidden`, walaupun nilainya sama). Nama dan email yang berubah
dicek seperti saat tambah (409 `clinic_name_conflict` / `clinic_email_conflict`). Ingat:
**mengganti nama mengganti link booking publik**, link lama menjadi 404.
```

Ganti seluruh §4.5 (judul sampai sebelum `### 4.6`) dengan:

```markdown
### 4.5 `DELETE /api/v1/practices/{id}` — nonaktifkan / hapus permanen (SUPER_ADMIN)

Tanpa query: **nonaktifkan** (`status = 0`), semua data tetap. Balas **204**. Aktifkan lagi
dengan §4.18.

`?permanent=true`: **hapus baris klinik**, hanya bila klinik belum punya data sama sekali
(appointment, tagihan, encounter, mapping psikolog/pasien/resepsionis, sesi, layanan,
follow-up, pajak, notifikasi). Hari libur dan pengaturan pembayaran internasional klinik itu
ikut terhapus; akun admin tidak. Balas **204**, atau **409**:

```json
{ "type": "/errors/clinic-not-empty", "status": 409, "code": "clinic_not_empty",
  "counts": { "appointments": 12, "doctors": 3 } }
```

`counts` hanya memuat kunci yang > 0.
```

Tepat sebelum `## 5. Endpoints — Services`, tambahkan:

```markdown
### 4.18 `POST /api/v1/practices/{id}/activate` — aktifkan kembali (SUPER_ADMIN)

Tanpa body. Balas **200** `{ "data": { ...PracticeDTO, "status": 1 } }`, atau 404.
```

- [ ] **Step 4: Perbarui §7 dan §3 catatan lama**

Di tabel status §7, ganti baris

```markdown
| 409 | Konflik penugasan service |
```
dan
```markdown
| 501 | Endpoint stub (§4.2, §4.12) |
```

menjadi:

```markdown
| 409 | Konflik penugasan service; nama/email klinik bentrok; email admin sudah terdaftar; klinik masih punya data (§4.2, §4.5) |
| 501 | Endpoint stub (§4.12) |
| 502 | Plugin WordPress gagal membuat akun admin (§4.2) |
```

Tepat setelah tabel itu, tambahkan:

```markdown
Error dari route `/practices/*` membawa field **`code`** (slug stabil, aman untuk dicocokkan
FE): `validation_error`, `practice_not_found`, `clinic_name_conflict` (+ `reason`, `slug`),
`clinic_email_conflict`, `admin_email_taken`, `not_a_clinic_admin`, `clinic_not_empty`
(+ `counts`), `admin_provision_failed`, `status_change_forbidden`, `forbidden`.
```

Hapus paragraf peringatan di akhir §3 yang dimulai dengan "⚠️ Endpoint `/practices/*` **tidak** membatasi CLINIC_ADMIN" (sudah tidak benar sejak `assertPracticeInScope`).

- [ ] **Step 5: Verifikasi penuh**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: `tsc` tanpa error; vitest melaporkan semua file PASS (jumlah tes = jumlah sebelum fitur + tes baru). Kalau ada tes lama yang gagal, baca pesannya: tes yang mengharapkan perilaku lama `/practices` (501 untuk POST, CLINIC_ADMIN boleh DELETE/ubah status) harus diperbarui ke perilaku baru; selain itu berhenti dan laporkan.

- [ ] **Step 6: Commit dan push**

```bash
git add docs/api/PRACTICES-AND-SERVICES-GUIDE.md
git commit -m "docs(api): kontrak tambah, nonaktifkan, aktifkan, dan hapus permanen klinik"
git push origin feat/crud-klinik:refs/heads/feat/crud-klinik
```

Buka PR `feat/crud-klinik` → `main` di `Alfzzz124/nextjs-appointment-praktiqu` dengan ringkasan: plugin 1.8.0, endpoint baru, aturan akses, dan **urutan rilis plugin → backend → FE**. Jangan merge sebelum R1 selesai.

---

## Grup F — FE Laravel (`raakanaka/laravel-praktiqu`)

Semua path di grup ini relatif ke root repo FE. Siapkan worktree sekali:

```bash
cd /home/ahmad/projects/praktiqu-fe/main && git fetch origin
git worktree add -b feat/crud-klinik ../crud-klinik origin/main   # lewati kalau sudah ada
cd ../crud-klinik
```

Lalu `composer install` dan `.env` seperti di Global Constraints. Pastikan seluruh tes hijau **sebelum** mulai: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`.

Pola yang diikuti: `app/Http/Controllers/KlinikAdminController.php` (controller), `resources/views/dashboard/klinik-admin.blade.php` (view), `tests/Feature/AdminKlinikSuperTest.php` (tes). Baca ketiganya dulu.

Catatan FE yang perlu diketahui:
- Role FE `admin` dipakai admin klinik **dan** resepsionis. Admin klinik dikenali dari `canManageClinicPayment` di profil sesi (role mentah `CLINIC_ADMIN`, lihat `AuthController::kelolaPembayaranKlinik`).
- Menu role `admin` **tidak punya tab Clinics** (`ROLE_ALLOWED` di `dashboard.blade.php`), jadi pintu edit admin klinik adalah kartu di tab Settings, seperti kartu "Pembayaran Internasional".
- `PraktiquApi` punya `get()`, `post()`, dan `call($method, $path, $query, $body)` untuk `PATCH`/`DELETE`. Error backend menjadi `ApiException` (`status`, `body`).
- `PraktiquApi::unwrap()` membuka `{data}` saja bila body hanya berisi `data`, atau berisi `status`/`message`. `POST /practices` membalas `{data, admin}`, jadi diterima utuh.
- Cache booking publik: `pq_public_practices` (daftar klinik, 5 menit) dan `pq_tenant_miss:{slug}` (slug yang tadi tidak dikenal).

### Task F1: Halaman tambah klinik

**Files:**
- Create: `app/Http/Controllers/KlinikController.php`
- Create: `resources/views/dashboard/klinik-form.blade.php`
- Modify: `app/Http/Controllers/KlinikAdminController.php` (`kandidat()` menjadi `public`)
- Modify: `routes/web.php` (dua route)
- Test: `tests/Feature/KlinikTambahTest.php`

**Interfaces:**
- Consumes: backend `GET api/v1/practices/clinic-admins`, `POST api/v1/practices` (kontrak di Global Constraints + spec §2e).
- Produces:
  - `GET /dashboard/klinik/baru` (route `klinik.baru`), `POST /dashboard/klinik` (route `klinik.simpan`) — super admin saja.
  - Flash sesi: `klinikPesan` (hijau), `klinikPeringatan` (kuning), `klinikGagal` (merah). F4 menampilkannya di dashboard.
  - View `dashboard.klinik-form` dengan variabel: `mode` (`'baru'|'edit'`), `id` (`?string`), `klinik` (array PracticeDTO, `[]` untuk baru), `kandidat` (`?array`), `super` (`bool`), `domain` (`string`), `kembaliUrl` (`string`). F2 dan F3 memakai view yang sama.
  - Helper privat di `KlinikController` yang dipakai F2/F3: `profil()`, `superAdmin()`, `domain()`, `isianKlinik(array)`, `buangCache(string ...$nama)`, `galat(ApiException)`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikTambahTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Super admin menambah klinik (KlinikController::baru/simpan). Selain super
// admin: 404 sebelum satu request pun ke backend.
class KlinikTambahTest extends TestCase
{
    private const URL = '/dashboard/klinik/baru';

    private const KANDIDAT = [
        ['wpUserId' => 512, 'name' => 'Admin Lama', 'email' => 'lama@klinik.co', 'clinicIds' => [4, 20]],
    ];

    private const ISIAN = [
        'name' => 'Klinik Sehat Cimahi',
        'email' => 'cimahi@kliniksehat.id',
        'telephoneNo' => '0226651234',
        'address' => 'Jl. Amir Machmud 12',
        'city' => 'Cimahi',
        'state' => '',
        'country' => 'Indonesia',
        'postalCode' => '',
        'admin_mode' => 'none',
    ];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'],
                $extra,
            ),
        ];
    }

    private function fakeSimpan(array $body, int $status = 201): void
    {
        Http::fake(['*/api/v1/practices' => Http::response($body, $status)]);
    }

    private static function berhasil(array $admin = ['mode' => 'none', 'wpUserId' => null, 'emailSent' => null]): array
    {
        return ['data' => ['id' => 57, 'name' => 'Klinik Sehat Cimahi', 'status' => 1], 'admin' => $admin];
    }

    private function simpan(array $ubah = [])
    {
        return $this->withSession($this->sesi('super'))->post('/dashboard/klinik', array_merge(self::ISIAN, $ubah));
    }

    // ── Akses & tampilan ────────────────────────────────────────────────

    public function test_super_admin_melihat_form_tambah(): void
    {
        Http::fake(['*/api/v1/practices/clinic-admins' => Http::response(['data' => self::KANDIDAT, 'total' => 1])]);

        $res = $this->withSession($this->sesi('super'))->get(self::URL);

        $res->assertOk();
        $res->assertSee('Tambah Klinik');
        $res->assertSee('name="name"', false);
        $res->assertSee('name="admin_mode"', false);
        $res->assertSee('Admin Lama — lama@klinik.co — memegang 2 klinik');
        $res->assertSee('Kata sandi dikirim ke email ini.');
        $res->assertSee('Link booking:');
        $res->assertDontSee('Zona berbahaya');
    }

    #[DataProvider('bukanSuper')]
    public function test_selain_super_404_tanpa_menyentuh_backend(string $role, array $extra): void
    {
        Http::fake();

        $this->withSession($this->sesi($role, $extra))->get(self::URL)->assertNotFound();
        $this->withSession($this->sesi($role, $extra))->post('/dashboard/klinik', self::ISIAN)->assertNotFound();

        Http::assertNothingSent();
    }

    public static function bukanSuper(): array
    {
        return [
            'admin klinik' => ['admin', ['practiceId' => 4, 'canManageClinicPayment' => true]],
            'resepsionis' => ['admin', ['practiceId' => 4]],
            'psikolog' => ['psikolog', ['professionalId' => 7]],
        ];
    }

    public function test_daftar_admin_gagal_dimuat_pilihan_admin_lama_disembunyikan(): void
    {
        // Retry-After 0: GET yang 500 diulang PraktiquApi; tanpa header ini tesnya menunggu backoff.
        Http::fake(['*/api/v1/practices/clinic-admins' => Http::response(['title' => 'x'], 500, ['Retry-After' => '0'])]);

        $res = $this->withSession($this->sesi('super'))->get(self::URL);

        $res->assertOk();
        $res->assertSee('Daftar admin klinik tidak bisa dimuat');
        $res->assertDontSee('name="admin_wp_user_id"', false);
        $res->assertSee('name="admin_email"', false);
    }

    // ── Simpan ──────────────────────────────────────────────────────────

    public function test_tanpa_admin_mengirim_isian_dan_membuang_cache_publik(): void
    {
        Cache::put('pq_public_practices', ['lama'], 300);
        Cache::put('pq_tenant_miss:klinik-sehat-cimahi', true, 300);
        $this->fakeSimpan(self::berhasil());

        $res = $this->simpan();

        $res->assertRedirect('/admin');
        $res->assertSessionHas('klinikPesan', 'Klinik "Klinik Sehat Cimahi" ditambahkan.');
        $res->assertSessionMissing('klinikPeringatan');
        $this->assertFalse(Cache::has('pq_public_practices'));
        $this->assertFalse(Cache::has('pq_tenant_miss:klinik-sehat-cimahi'));
        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && str_ends_with($r->url(), '/api/v1/practices')
            && $r['name'] === 'Klinik Sehat Cimahi'
            && $r['telephoneNo'] === '0226651234'
            && $r['state'] === null
            && $r['postalCode'] === null
            && $r['admin'] === ['mode' => 'none']);
    }

    public function test_admin_yang_sudah_ada(): void
    {
        $this->fakeSimpan(self::berhasil(['mode' => 'existing', 'wpUserId' => 512, 'emailSent' => null]));

        $this->simpan(['admin_mode' => 'existing', 'admin_wp_user_id' => '512'])->assertRedirect('/admin');

        Http::assertSent(fn (Request $r) => $r['admin'] === ['mode' => 'existing', 'wpUserId' => 512]);
    }

    public function test_admin_baru_dan_email_gagal_terkirim_diberi_peringatan(): void
    {
        $this->fakeSimpan(self::berhasil(['mode' => 'new', 'wpUserId' => 912, 'emailSent' => false]));

        $res = $this->simpan(['admin_mode' => 'new', 'admin_name' => ' Dewi Lestari ', 'admin_email' => 'dewi@kliniksehat.id']);

        $res->assertRedirect('/admin');
        $res->assertSessionHas('klinikPeringatan', 'Klinik dibuat, tetapi email kata sandi gagal dikirim. Minta admin memakai Lupa sandi.');
        Http::assertSent(fn (Request $r) => $r['admin'] === ['mode' => 'new', 'name' => 'Dewi Lestari', 'email' => 'dewi@kliniksehat.id']);
    }

    #[DataProvider('isianTidakSah')]
    public function test_isian_tidak_sah_tidak_dikirim(array $ubah, string $kolom): void
    {
        Http::fake();

        $this->simpan($ubah)->assertSessionHasErrors([$kolom]);

        Http::assertNothingSent();
    }

    public static function isianTidakSah(): array
    {
        return [
            'nama kosong' => [['name' => ''], 'name'],
            'email klinik' => [['email' => 'bukan-email'], 'email'],
            'mode admin asing' => [['admin_mode' => 'semua'], 'admin_mode'],
            'admin lama tanpa pilihan' => [['admin_mode' => 'existing'], 'admin_wp_user_id'],
            'admin baru tanpa email' => [['admin_mode' => 'new', 'admin_name' => 'Dewi'], 'admin_email'],
        ];
    }

    #[DataProvider('tolakanBackend')]
    public function test_tolakan_backend_jatuh_ke_kolomnya(array $body, int $status, string $kolom, string $pesan): void
    {
        $this->fakeSimpan($body, $status);

        $res = $this->simpan();

        $res->assertRedirect(self::URL);
        $res->assertSessionHasErrors([$kolom => $pesan]);
        $this->assertSame('Klinik Sehat Cimahi', session()->getOldInput('name'));
    }

    public static function tolakanBackend(): array
    {
        return [
            'link dipakai klinik lain' => [
                ['code' => 'clinic_name_conflict', 'reason' => 'clinic_slug_taken', 'slug' => 'klinik-sehat-cimahi', 'conflictId' => 4, 'conflictName' => 'Klinik Sehat Cimahi'],
                409, 'name', 'Link /klinik-sehat-cimahi sudah dipakai klinik "Klinik Sehat Cimahi". Bedakan namanya.',
            ],
            'link dipakai psikolog' => [
                ['code' => 'clinic_name_conflict', 'reason' => 'professional_slug_taken', 'slug' => 'dewi-lestari'],
                409, 'name', 'Link /dewi-lestari sudah dipakai halaman pribadi seorang psikolog. Bedakan namanya.',
            ],
            'kata sistem' => [
                ['code' => 'clinic_name_conflict', 'reason' => 'reserved_slug', 'slug' => 'login'],
                409, 'name', 'Nama ini dipakai sistem untuk alamat halaman. Pilih nama lain.',
            ],
            'email klinik' => [
                ['code' => 'clinic_email_conflict', 'conflictId' => 4],
                409, 'email', 'Email ini sudah dipakai klinik lain.',
            ],
            'email admin' => [
                ['code' => 'admin_email_taken'],
                409, 'admin_email', 'Email ini sudah terdaftar. Pilih "Pilih admin yang sudah ada" kalau orangnya sama.',
            ],
            'bukan admin klinik' => [
                ['code' => 'not_a_clinic_admin'],
                422, 'admin_wp_user_id', 'Akun itu bukan admin klinik. Pilih akun lain.',
            ],
            'validasi per kolom' => [
                ['code' => 'validation_error', 'issues' => [['path' => 'admin.email', 'message' => 'Invalid email']]],
                422, 'admin_email', 'Isian tidak sah: Invalid email',
            ],
            'plugin gagal' => [
                ['code' => 'admin_provision_failed'],
                502, 'umum', 'Akun admin gagal dibuat, jadi klinik juga tidak disimpan. Coba lagi beberapa saat lagi.',
            ],
            'server bermasalah' => [
                ['title' => 'Internal Server Error'],
                500, 'umum', 'Server sedang bermasalah, jadi belum jelas apakah perubahan tersimpan. Muat ulang daftar klinik sebelum mencoba lagi.',
            ],
        ];
    }
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikTambahTest`
Expected: FAIL — route `/dashboard/klinik/baru` belum ada (404 di tes super admin, `assertOk` gagal).

- [ ] **Step 3: Jadikan `kandidat()` publik**

Di `app/Http/Controllers/KlinikAdminController.php`, ubah

```php
    /** @return list<array{wpUserId:int, name:string, email:string, clinicIds:list<int>}>|null */
    private function kandidat(): ?array
```

menjadi:

```php
    /**
     * Juga dipakai form tambah klinik (KlinikController::baru).
     *
     * @return list<array{wpUserId:int, name:string, email:string, clinicIds:list<int>}>|null
     */
    public function kandidat(): ?array
```

- [ ] **Step 4: Tulis controller**

Buat `app/Http/Controllers/KlinikController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\BookingApi;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\View\View;

/**
 * Tambah, ubah, nonaktifkan/aktifkan, dan hapus permanen klinik.
 *
 * Backend: POST /api/v1/practices (tambah), PATCH /api/v1/practices/{id}
 * (ubah), DELETE /api/v1/practices/{id} (nonaktifkan; ?permanent=true untuk
 * hapus), POST /api/v1/practices/{id}/activate. Spec di repo backend:
 * docs/superpowers/specs/2026-10-15-crud-klinik-design.md §3.
 *
 * Akses: super admin untuk semuanya. Admin klinik (role mentah CLINIC_ADMIN,
 * ditandai canManageClinicPayment — resepsionis berbagi role 'admin' di FE
 * ini) hanya boleh MENGUBAH profil klinik aktifnya sendiri. Selain itu 404,
 * sebelum satu request pun ke backend. Backend menegakkan aturan yang sama;
 * ini lapis kedua.
 *
 * Nama klinik menentukan link booking publik (/{slug}), jadi setiap simpan
 * membuang cache daftar klinik publik dan cache "slug tidak dikenal" untuk
 * slug yang terlibat: klinik baru langsung bisa dibuka, link lama langsung
 * berhenti.
 */
class KlinikController extends Controller
{
    /** Nama kolom form = nama field backend, supaya `issues[].path` jatuh ke kolomnya. */
    private const KOLOM = ['name', 'email', 'telephoneNo', 'address', 'city', 'state', 'country', 'postalCode'];

    /** Path `issues` backend untuk bagian admin → nama kolom form. */
    private const KOLOM_ADMIN = [
        'admin' => 'admin_mode',
        'admin.mode' => 'admin_mode',
        'admin.wpUserId' => 'admin_wp_user_id',
        'admin.name' => 'admin_name',
        'admin.email' => 'admin_email',
    ];

    private const ATURAN_KLINIK = [
        'name' => ['required', 'string', 'max:120'],
        'email' => ['nullable', 'email', 'max:191'],
        'telephoneNo' => ['nullable', 'string', 'min:3', 'max:40'],
        'address' => ['nullable', 'string', 'max:255'],
        'city' => ['nullable', 'string', 'max:80'],
        'state' => ['nullable', 'string', 'max:80'],
        'country' => ['nullable', 'string', 'max:80'],
        'postalCode' => ['nullable', 'string', 'max:20'],
    ];

    private const PESAN_VALIDASI = [
        'name.required' => 'Nama klinik wajib diisi.',
        'name.max' => 'Nama klinik paling panjang 120 karakter.',
        'email.email' => 'Format email tidak sah.',
        'telephoneNo.min' => 'Nomor telepon terlalu pendek.',
        'admin_mode.in' => 'Pilih salah satu cara mengatur admin.',
        'admin_wp_user_id.required_if' => 'Pilih admin klinik.',
        'admin_wp_user_id.regex' => 'Pilihan admin tidak dikenali.',
        'admin_name.required_if' => 'Nama admin wajib diisi.',
        'admin_email.required_if' => 'Email admin wajib diisi.',
        'admin_email.email' => 'Format email admin tidak sah.',
    ];

    public function __construct(private readonly PraktiquApi $api) {}

    // ── Tambah ──────────────────────────────────────────────────────────

    public function baru(): View
    {
        abort_unless(self::superAdmin(), 404);

        return view('dashboard.klinik-form', [
            'mode' => 'baru',
            'id' => null,
            'klinik' => [],
            // null = gagal dimuat: pilihan "admin yang sudah ada" disembunyikan.
            'kandidat' => app(KlinikAdminController::class)->kandidat(),
            'super' => true,
            'domain' => self::domain(),
            'kembaliUrl' => '/admin',
        ]);
    }

    public function simpan(Request $request): RedirectResponse
    {
        abort_unless(self::superAdmin(), 404);

        $data = $request->validate(self::ATURAN_KLINIK + [
            'admin_mode' => ['required', 'in:none,existing,new'],
            'admin_wp_user_id' => ['nullable', 'required_if:admin_mode,existing', 'regex:/^[1-9][0-9]{0,14}$/'],
            'admin_name' => ['nullable', 'required_if:admin_mode,new', 'string', 'max:120'],
            'admin_email' => ['nullable', 'required_if:admin_mode,new', 'email', 'max:100'],
        ], self::PESAN_VALIDASI);

        $body = self::isianKlinik($data) + ['admin' => match ($data['admin_mode']) {
            'existing' => ['mode' => 'existing', 'wpUserId' => (int) $data['admin_wp_user_id']],
            'new' => ['mode' => 'new', 'name' => trim((string) $data['admin_name']), 'email' => trim((string) $data['admin_email'])],
            default => ['mode' => 'none'],
        }];

        try {
            $res = $this->api->post('api/v1/practices', $body);
        } catch (ApiException $e) {
            return redirect()->route('klinik.baru')->withInput()->withErrors(self::galat($e));
        }

        $klinik = is_array($res) && is_array($res['data'] ?? null) ? $res['data'] : [];
        $admin = is_array($res) && is_array($res['admin'] ?? null) ? $res['admin'] : [];
        $nama = (string) ($klinik['name'] ?? $body['name']);
        self::buangCache($nama);

        $kembali = redirect('/admin')->with('klinikPesan', "Klinik \"{$nama}\" ditambahkan.");
        if (($admin['mode'] ?? null) === 'new' && ($admin['emailSent'] ?? null) === false) {
            $kembali = $kembali->with('klinikPeringatan', 'Klinik dibuat, tetapi email kata sandi gagal dikirim. Minta admin memakai Lupa sandi.');
        }

        return $kembali;
    }

    // ── Bantuan ─────────────────────────────────────────────────────────

    private static function profil(): array
    {
        return AuthController::validProfile() ?? [];
    }

    private static function superAdmin(): bool
    {
        return (self::profil()['role'] ?? null) === 'super';
    }

    /** Domain booking publik untuk pratinjau link, tanpa skema. */
    private static function domain(): string
    {
        return (string) preg_replace('#^https?://#', '', rtrim((string) config('app.url'), '/'));
    }

    /** Kolom klinik dari isian yang sudah divalidasi; kosong → null (backend menyimpan NULL). */
    private static function isianKlinik(array $data): array
    {
        $out = [];
        foreach (self::KOLOM as $k) {
            if (! array_key_exists($k, $data)) {
                continue;
            }
            $v = trim((string) ($data[$k] ?? ''));
            $out[$k] = $v === '' ? null : $v;
        }

        return $out;
    }

    /** Daftar klinik publik dan "slug tidak dikenal" untuk setiap nama yang terlibat. */
    private static function buangCache(string ...$nama): void
    {
        Cache::forget('pq_public_practices');
        foreach ($nama as $n) {
            $slug = BookingApi::slugify($n);
            if ($slug !== '') {
                Cache::forget('pq_tenant_miss:'.$slug);
            }
        }
    }

    /**
     * problem+json backend → galat Laravel per kolom (`umum` untuk yang tidak
     * berkolom). `code` adalah slug stabil backend; `title`/`detail` berbahasa
     * Inggris dan bisa berubah.
     */
    private static function galat(ApiException $e): array
    {
        $b = is_array($e->body) ? $e->body : [];
        $code = (string) ($b['code'] ?? '');

        return match (true) {
            $code === 'clinic_name_conflict' => ['name' => self::pesanNama($b)],
            $code === 'clinic_email_conflict' => ['email' => 'Email ini sudah dipakai klinik lain.'],
            $code === 'admin_email_taken' => ['admin_email' => 'Email ini sudah terdaftar. Pilih "Pilih admin yang sudah ada" kalau orangnya sama.'],
            $code === 'not_a_clinic_admin' => ['admin_wp_user_id' => 'Akun itu bukan admin klinik. Pilih akun lain.'],
            $code === 'validation_error' => self::galatIssues($b['issues'] ?? []),
            $code === 'admin_provision_failed' => ['umum' => 'Akun admin gagal dibuat, jadi klinik juga tidak disimpan. Coba lagi beberapa saat lagi.'],
            $code === 'status_change_forbidden' => ['umum' => 'Status klinik hanya bisa diubah super admin.'],
            $e->status === 0 || $e->status >= 500 => ['umum' => 'Server sedang bermasalah, jadi belum jelas apakah perubahan tersimpan. Muat ulang daftar klinik sebelum mencoba lagi.'],
            default => ['umum' => 'Klinik belum tersimpan.'.ResourceController::rincianValidasi($e->body)],
        };
    }

    private static function pesanNama(array $b): string
    {
        $slug = (string) ($b['slug'] ?? '');

        return match ($b['reason'] ?? '') {
            'empty_slug' => 'Nama klinik harus memuat huruf atau angka latin.',
            'numeric_slug' => 'Nama klinik tidak boleh hanya angka.',
            'reserved_slug' => 'Nama ini dipakai sistem untuk alamat halaman. Pilih nama lain.',
            'clinic_slug_taken' => 'Link /'.$slug.' sudah dipakai klinik "'.($b['conflictName'] ?? '').'". Bedakan namanya.',
            'professional_slug_taken' => 'Link /'.$slug.' sudah dipakai halaman pribadi seorang psikolog. Bedakan namanya.',
            default => 'Nama klinik tidak bisa dipakai.',
        };
    }

    private static function galatIssues(mixed $issues): array
    {
        $out = [];
        foreach (is_array($issues) ? $issues : [] as $i) {
            if (! is_array($i)) {
                continue;
            }
            $path = (string) ($i['path'] ?? '');
            $kolom = in_array($path, self::KOLOM, true) ? $path : (self::KOLOM_ADMIN[$path] ?? 'umum');
            $out[$kolom] = 'Isian tidak sah: '.(string) ($i['message'] ?? '');
        }

        return $out !== [] ? $out : ['umum' => 'Isian tidak sah.'];
    }
}
```

- [ ] **Step 5: Tulis view**

Buat `resources/views/dashboard/klinik-form.blade.php`:

```blade
@extends('layouts.base')

{{-- Tambah / ubah klinik — lihat KlinikController. Satu view untuk kedua
     mode ($mode 'baru' | 'edit'); gaya mengikuti dashboard/klinik-admin.blade.php. --}}

@php
  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';
  $label = 'display:block;font-size:13px;font-weight:600;color:'.$teks.';margin-bottom:6px';
  $kolom = 'width:100%;box-sizing:border-box;border:1.5px solid '.$garis.';border-radius:11px;padding:10px 12px;font-size:14px;color:'.$teks.';background:#fff';
  $galat = 'font-size:12.5px;color:#9B2C2C;margin-top:5px;line-height:1.5';
  $edit = $mode === 'edit';
  $nilai = fn (string $k) => (string) old($k, $klinik[$k] ?? '');
  $namaSekarang = (string) ($klinik['name'] ?? '');
  $slugLama = $edit ? \App\Services\BookingApi::slugify($namaSekarang) : '';
  $aktif = $edit && (int) ($klinik['status'] ?? 0) === 1;
  $judul = $edit ? 'Ubah Klinik' : 'Tambah Klinik';
  $modeAdmin = (string) old('admin_mode', 'none');
  $kolomLain = [
    ['email', 'Email klinik', 'email'],
    ['telephoneNo', 'Telepon', 'tel'],
    ['address', 'Alamat', 'text'],
    ['city', 'Kota', 'text'],
    ['state', 'Provinsi', 'text'],
    ['country', 'Negara', 'text'],
    ['postalCode', 'Kode pos', 'text'],
  ];
@endphp

@section('title', $judul.' — PraktiQu')

@section('content')
<div style="max-width:720px;margin:0 auto;padding:28px 20px 64px"
     x-data="{
       nama: @js($nilai('name')),
       slugLama: @js($slugLama),
       modeAdmin: @js($modeAdmin),
       ketik: '',
       slug(n) { return (n || '').replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''); },
     }">

  <a href="{{ $kembaliUrl }}" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke dashboard</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 6px">{{ $judul }}</h1>
  <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 24px">
    @if ($edit)
      {{ $namaSekarang }} — {{ $aktif ? 'aktif' : 'nonaktif' }}.
    @else
      Klinik baru langsung muncul di daftar klinik dan punya link booking sendiri.
    @endif
  </p>

  @if (session('klinikPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">{{ session('klinikPesan') }}</div>
  @endif
  @if (session('klinikPeringatan'))
    <div style="border:1.5px solid #F3E2BE;background:#FFF6E5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:13.5px;color:#7A5A00;line-height:1.6">{{ session('klinikPeringatan') }}</div>
  @endif
  @if (session('klinikGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">{{ session('klinikGagal') }}</div>
  @endif
  @error('umum')
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">{{ $message }}</div>
  @enderror

  <form method="POST" action="{{ $edit ? route('klinik.ubah', ['id' => $id]) : route('klinik.simpan') }}"
        style="border:1.5px solid {{ $garis }};border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:16px">
    @csrf

    <div>
      <label for="kf-name" style="{{ $label }}">Nama klinik *</label>
      <input id="kf-name" name="name" x-model="nama" value="{{ $nilai('name') }}" required maxlength="120" style="{{ $kolom }}">
      <div style="font-size:12.5px;color:{{ $redup }};margin-top:5px">Link booking: <b>{{ $domain }}/<span x-text="slug(nama) || '…'">{{ \App\Services\BookingApi::slugify($nilai('name')) }}</span></b></div>
      @error('name') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      @if ($edit)
        <div x-show="slugLama !== '' && slug(nama) !== slugLama" style="display:none;font-size:13px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:12px;padding:10px 12px;line-height:1.55;margin-top:8px">
          Link booking akan berubah dari <b>/<span x-text="slugLama"></span></b> ke <b>/<span x-text="slug(nama)"></span></b>. Link lama tidak berlaku lagi, termasuk yang sudah dibagikan ke pasien.
        </div>
      @endif
    </div>

    @foreach ($kolomLain as [$k, $teksLabel, $tipe])
      <div>
        <label for="kf-{{ $k }}" style="{{ $label }}">{{ $teksLabel }}</label>
        <input id="kf-{{ $k }}" name="{{ $k }}" type="{{ $tipe }}" value="{{ $nilai($k) }}" style="{{ $kolom }}">
        @error($k) <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </div>
    @endforeach

    @unless ($edit)
      <fieldset style="border:1.5px solid {{ $garis }};border-radius:14px;padding:16px;margin:0">
        <legend style="font-size:13px;font-weight:700;color:{{ $teks }};padding:0 6px">Admin klinik</legend>

        @if ($kandidat === null)
          <div style="font-size:13px;color:#9B2C2C;margin-bottom:10px">Daftar admin klinik tidak bisa dimuat, jadi pilihan "admin yang sudah ada" disembunyikan. Muat ulang halaman untuk mencoba lagi.</div>
        @else
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;color:{{ $teks }};margin-bottom:8px">
            <input type="radio" name="admin_mode" value="existing" x-model="modeAdmin"> Pilih admin yang sudah ada
          </label>
          <div x-show="modeAdmin === 'existing'" style="margin:0 0 12px 26px">
            @if (count($kandidat) === 0)
              <div style="font-size:13px;color:{{ $redup }}">Belum ada akun admin klinik.</div>
            @else
              <select name="admin_wp_user_id" style="{{ $kolom }}">
                <option value="">— Pilih admin klinik —</option>
                @foreach ($kandidat as $k)
                  <option value="{{ $k['wpUserId'] }}" @selected((string) old('admin_wp_user_id') === (string) $k['wpUserId'])>{{ $k['name'] }} — {{ $k['email'] }} — memegang {{ count($k['clinicIds']) }} klinik</option>
                @endforeach
              </select>
            @endif
            @error('admin_wp_user_id') <div style="{{ $galat }}">{{ $message }}</div> @enderror
          </div>
        @endif

        <label style="display:flex;gap:8px;align-items:center;font-size:14px;color:{{ $teks }};margin-bottom:8px">
          <input type="radio" name="admin_mode" value="new" x-model="modeAdmin"> Buat akun admin baru
        </label>
        <div x-show="modeAdmin === 'new'" style="margin:0 0 12px 26px;display:flex;flex-direction:column;gap:10px">
          <div>
            <label for="kf-admin-name" style="{{ $label }}">Nama admin</label>
            <input id="kf-admin-name" name="admin_name" value="{{ old('admin_name') }}" style="{{ $kolom }}">
            @error('admin_name') <div style="{{ $galat }}">{{ $message }}</div> @enderror
          </div>
          <div>
            <label for="kf-admin-email" style="{{ $label }}">Email admin</label>
            <input id="kf-admin-email" name="admin_email" type="email" value="{{ old('admin_email') }}" style="{{ $kolom }}">
            <div style="font-size:12.5px;color:{{ $redup }};margin-top:5px">Kata sandi dikirim ke email ini.</div>
            @error('admin_email') <div style="{{ $galat }}">{{ $message }}</div> @enderror
          </div>
        </div>

        <label style="display:flex;gap:8px;align-items:center;font-size:14px;color:{{ $teks }}">
          <input type="radio" name="admin_mode" value="none" x-model="modeAdmin"> Atur nanti
        </label>
        <div x-show="modeAdmin === 'none'" style="font-size:12.5px;color:{{ $redup }};margin:6px 0 0 26px">Bisa diatur lewat "Admin klinik ›" setelah klinik dibuat.</div>
        @error('admin_mode') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </fieldset>
    @endunless

    <div>
      <button type="submit" style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">
        {{ $edit ? 'Simpan Perubahan' : 'Tambah Klinik' }}
      </button>
    </div>
  </form>

  @if ($edit && $super)
    <div style="border:1.5px solid #F0C9C9;border-radius:16px;padding:22px;margin-top:28px;display:flex;flex-direction:column;gap:18px">
      <div style="font-size:15px;font-weight:800;color:#9B2C2C">Zona berbahaya</div>

      <form method="POST" action="{{ route('klinik.status', ['id' => $id]) }}"
            onsubmit="return confirm(@js($aktif ? 'Klinik tidak akan muncul di booking publik. Data tetap tersimpan dan bisa diaktifkan lagi. Lanjutkan?' : 'Aktifkan kembali klinik ini?'))">
        @csrf
        <input type="hidden" name="aksi" value="{{ $aktif ? 'nonaktifkan' : 'aktifkan' }}">
        <div style="font-size:13.5px;color:{{ $redup }};line-height:1.6;margin-bottom:10px">
          {{ $aktif ? 'Klinik nonaktif tidak muncul di booking publik dan pilihan klinik. Data tetap tersimpan.' : 'Klinik ini sedang nonaktif.' }}
        </div>
        <button type="submit" style="border:1.5px solid {{ $aktif ? '#D7453B' : $aksen }};background:#fff;color:{{ $aktif ? '#D7453B' : $aksen }};border-radius:11px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer">
          {{ $aktif ? 'Nonaktifkan klinik' : 'Aktifkan kembali' }}
        </button>
      </form>

      <form method="POST" action="{{ route('klinik.hapus', ['id' => $id]) }}">
        @csrf
        <div style="font-size:13.5px;color:{{ $redup }};line-height:1.6;margin-bottom:10px">
          Hapus permanen hanya untuk klinik yang belum punya data sama sekali (tanpa appointment, tagihan, psikolog, pasien, dan lainnya).
        </div>
        <label for="kf-konfirmasi" style="{{ $label }}">Ketik <b>{{ $namaSekarang }}</b> untuk menghapus permanen</label>
        <input id="kf-konfirmasi" name="konfirmasi_nama" x-model="ketik" autocomplete="off" style="{{ $kolom }}">
        @error('konfirmasi_nama') <div style="{{ $galat }}">{{ $message }}</div> @enderror
        <button type="submit" :disabled="ketik !== @js($namaSekarang)"
                style="margin-top:10px;border:none;background:#D7453B;color:#fff;border-radius:11px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer">
          Hapus Permanen
        </button>
      </form>
    </div>
  @endif
</div>
@endsection
```

- [ ] **Step 6: Tambahkan route**

Di `routes/web.php`, di dalam grup `Route::middleware(['staff:any', 'klinik.halaman'])->group(...)`, tepat **setelah** dua route `klinik.admin` / `klinik.admin.simpan`, tambahkan:

```php
    // Tambah klinik — super admin saja, diperiksa KlinikController (404
    // untuk role lain). Ubah, status, dan hapus menyusul di bawah.
    Route::get('/dashboard/klinik/baru', [\App\Http\Controllers\KlinikController::class, 'baru'])
        ->name('klinik.baru');
    Route::post('/dashboard/klinik', [\App\Http\Controllers\KlinikController::class, 'simpan'])
        ->name('klinik.simpan');
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikTambahTest|AdminKlinikSuperTest'`
Expected: PASS untuk kedua kelas tes.

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/KlinikController.php resources/views/dashboard/klinik-form.blade.php \
  app/Http/Controllers/KlinikAdminController.php routes/web.php tests/Feature/KlinikTambahTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): halaman tambah klinik untuk super admin"
```

---

### Task F2: Halaman ubah klinik

**Files:**
- Modify: `app/Http/Controllers/KlinikController.php` (method `edit`, `ubah`, `bolehUbah`, `klinik`)
- Modify: `routes/web.php` (dua route)
- Test: `tests/Feature/KlinikUbahTest.php`

**Interfaces:**
- Consumes: F1 (view `dashboard.klinik-form`, helper `isianKlinik`, `buangCache`, `galat`, `domain`, `superAdmin`, `profil`, konstanta `ATURAN_KLINIK`, `PESAN_VALIDASI`); backend `GET`/`PATCH api/v1/practices/{id}`.
- Produces:
  - `GET /dashboard/klinik/{id}/edit` (route `klinik.edit`), `POST /dashboard/klinik/{id}` (route `klinik.ubah`) — super admin; admin klinik untuk klinik aktifnya sendiri.
  - Route `klinik.status` (`POST /dashboard/klinik/{id}/status`) dan `klinik.hapus` (`POST /dashboard/klinik/{id}/hapus`) **didaftarkan di task ini** karena form edit merender tombolnya; method controller-nya dibuat di F3.
  - `private function klinik(string $id): array` — PracticeDTO dari backend; 404 bila tidak ada/di luar scope, 503 bila backend gagal. Dipakai F3.
  - `private static function bolehUbah(string $id): bool`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikUbahTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Mengubah profil klinik: super admin untuk klinik mana pun, admin klinik
// hanya untuk klinik aktifnya sendiri. Hanya kolom yang berubah yang dikirim,
// dan `status` tidak pernah ikut dari form ini.
class KlinikUbahTest extends TestCase
{
    private const URL = '/dashboard/klinik/4/edit';

    private const KLINIK = [
        'id' => 4, 'name' => 'Klinik Sehat', 'email' => 'sehat@klinik.id', 'telephoneNo' => '0221234',
        'address' => null, 'city' => 'Bandung', 'state' => null, 'country' => 'Indonesia', 'postalCode' => null, 'status' => 1,
    ];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'],
                $extra,
            ),
        ];
    }

    private function adminKlinik(): array
    {
        return $this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]);
    }

    /** GET mengembalikan KLINIK (+ $ubah); PATCH mengembalikan $patch dengan $status. */
    private function fakeKlinik(array $ubah = [], array $patch = ['data' => self::KLINIK], int $status = 200): void
    {
        Http::fake(fn (Request $r) => $r->method() === 'GET'
            ? Http::response(['data' => array_merge(self::KLINIK, $ubah)])
            : Http::response($patch, $status));
    }

    private static function isian(array $ubah = []): array
    {
        return array_merge([
            'name' => 'Klinik Sehat', 'email' => 'sehat@klinik.id', 'telephoneNo' => '0221234',
            'address' => '', 'city' => 'Bandung', 'state' => '', 'country' => 'Indonesia', 'postalCode' => '',
        ], $ubah);
    }

    // ── Akses ───────────────────────────────────────────────────────────

    public function test_super_admin_melihat_form_terisi_dan_zona_berbahaya(): void
    {
        $this->fakeKlinik();

        $res = $this->withSession($this->sesi('super'))->get(self::URL);

        $res->assertOk();
        $res->assertSee('Ubah Klinik');
        $res->assertSee('value="sehat@klinik.id"', false);
        $res->assertSee('Zona berbahaya');
        $res->assertSee('Nonaktifkan klinik');
        $res->assertDontSee('name="admin_mode"', false);
        $res->assertSee('href="/admin"', false);
    }

    public function test_admin_klinik_mengubah_kliniknya_tanpa_zona_berbahaya(): void
    {
        $this->fakeKlinik();

        $res = $this->withSession($this->adminKlinik())->get(self::URL);

        $res->assertOk();
        $res->assertSee('Ubah Klinik');
        $res->assertDontSee('Zona berbahaya');
        $res->assertSee('href="/klinik"', false);
    }

    #[DataProvider('tanpaHak')]
    public function test_tanpa_hak_404_tanpa_menyentuh_backend(string $role, array $extra): void
    {
        Http::fake();

        $this->withSession($this->sesi($role, $extra))->get(self::URL)->assertNotFound();
        $this->withSession($this->sesi($role, $extra))->post('/dashboard/klinik/4', self::isian())->assertNotFound();

        Http::assertNothingSent();
    }

    public static function tanpaHak(): array
    {
        return [
            'admin klinik lain' => ['admin', ['practiceId' => 5, 'canManageClinicPayment' => true]],
            'resepsionis' => ['admin', ['practiceId' => 4]],
            'psikolog' => ['psikolog', ['professionalId' => 7]],
        ];
    }

    public function test_klinik_yang_tidak_ada_404(): void
    {
        Http::fake(['*' => Http::response(['code' => 'practice_not_found'], 404)]);

        $this->withSession($this->sesi('super'))->get(self::URL)->assertNotFound();
    }

    // ── Simpan ──────────────────────────────────────────────────────────

    public function test_hanya_kolom_yang_berubah_yang_dikirim(): void
    {
        $this->fakeKlinik();

        $res = $this->withSession($this->sesi('super'))->post('/dashboard/klinik/4', self::isian(['city' => 'Cimahi', 'address' => 'Jl. Baru 1']));

        $res->assertRedirect(self::URL);
        $res->assertSessionHas('klinikPesan', 'Perubahan klinik tersimpan.');
        Http::assertSent(fn (Request $r) => $r->method() === 'PATCH'
            && str_ends_with($r->url(), '/api/v1/practices/4')
            && $r->data() === ['address' => 'Jl. Baru 1', 'city' => 'Cimahi']);
    }

    public function test_tidak_ada_yang_berubah_tidak_mengirim_patch(): void
    {
        $this->fakeKlinik();

        $this->withSession($this->sesi('super'))->post('/dashboard/klinik/4', self::isian())
            ->assertSessionHas('klinikPesan', 'Tidak ada yang berubah.');

        Http::assertNotSent(fn (Request $r) => $r->method() === 'PATCH');
    }

    public function test_admin_klinik_tidak_pernah_mengirim_status(): void
    {
        $this->fakeKlinik();

        $this->withSession($this->adminKlinik())->post('/dashboard/klinik/4', self::isian(['city' => 'Garut', 'status' => '0']))
            ->assertRedirect(self::URL);

        Http::assertSent(fn (Request $r) => $r->method() === 'PATCH' && $r->data() === ['city' => 'Garut']);
    }

    public function test_ganti_nama_membuang_cache_slug_lama_dan_baru(): void
    {
        Cache::put('pq_public_practices', ['lama'], 300);
        Cache::put('pq_tenant_miss:klinik-sehat-raya', true, 300);
        $this->fakeKlinik();

        $this->withSession($this->sesi('super'))->post('/dashboard/klinik/4', self::isian(['name' => 'Klinik Sehat Raya']));

        $this->assertFalse(Cache::has('pq_public_practices'));
        $this->assertFalse(Cache::has('pq_tenant_miss:klinik-sehat-raya'));
    }

    public function test_form_edit_memuat_peringatan_link_berubah(): void
    {
        $this->fakeKlinik();

        $this->withSession($this->sesi('super'))->get(self::URL)
            ->assertSee('Link booking akan berubah dari')
            // @js() menulis string dengan kutip tunggal.
            ->assertSee("slugLama: 'klinik-sehat'", false);
    }

    public function test_nama_bentrok_jatuh_ke_kolom_nama(): void
    {
        $this->fakeKlinik([], ['code' => 'clinic_name_conflict', 'reason' => 'clinic_slug_taken', 'slug' => 'klinik-lain', 'conflictName' => 'Klinik Lain'], 409);

        $this->withSession($this->sesi('super'))->post('/dashboard/klinik/4', self::isian(['name' => 'Klinik Lain']))
            ->assertRedirect(self::URL)
            ->assertSessionHasErrors(['name' => 'Link /klinik-lain sudah dipakai klinik "Klinik Lain". Bedakan namanya.']);
    }
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikUbahTest`
Expected: FAIL — route `/dashboard/klinik/4/edit` belum ada.

- [ ] **Step 3: Tambahkan method di controller**

Di `app/Http/Controllers/KlinikController.php`, tepat **sebelum** baris `// ── Bantuan ───`, tambahkan:

```php
    // ── Ubah ────────────────────────────────────────────────────────────

    public function edit(string $id): View
    {
        abort_unless(self::bolehUbah($id), 404);

        return view('dashboard.klinik-form', [
            'mode' => 'edit',
            'id' => $id,
            'klinik' => $this->klinik($id),
            'kandidat' => null,
            'super' => self::superAdmin(),
            'domain' => self::domain(),
            'kembaliUrl' => self::superAdmin() ? '/admin' : '/klinik',
        ]);
    }

    public function ubah(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::bolehUbah($id), 404);

        $data = $request->validate(self::ATURAN_KLINIK, self::PESAN_VALIDASI);
        $lama = $this->klinik($id);

        // Hanya yang berubah: PATCH backend mengecek nama/email hanya bila
        // dikirim, dan `status` tidak pernah ikut dari form ini.
        $body = [];
        foreach (self::isianKlinik($data) as $k => $v) {
            $sebelum = $lama[$k] ?? null;
            $sebelum = is_string($sebelum) && trim($sebelum) === '' ? null : $sebelum;
            if ($v !== $sebelum) {
                $body[$k] = $v;
            }
        }

        $kembali = redirect()->route('klinik.edit', ['id' => $id]);
        if ($body === []) {
            return $kembali->with('klinikPesan', 'Tidak ada yang berubah.');
        }

        try {
            $this->api->call('PATCH', "api/v1/practices/{$id}", [], $body);
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);

            return $kembali->withInput()->withErrors(self::galat($e));
        }

        self::buangCache((string) ($lama['name'] ?? ''), (string) ($body['name'] ?? ''));

        return $kembali->with('klinikPesan', 'Perubahan klinik tersimpan.');
    }
```

Lalu di bagian `// ── Bantuan ───`, tepat setelah `superAdmin()`, tambahkan:

```php
    /** Super admin: klinik mana pun. Admin klinik (CLINIC_ADMIN): klinik aktifnya sendiri. */
    private static function bolehUbah(string $id): bool
    {
        $p = self::profil();

        return match ($p['role'] ?? null) {
            'super' => true,
            'admin' => ! empty($p['canManageClinicPayment']) && (string) ($p['practiceId'] ?? '') === $id,
            default => false,
        };
    }

    /** PracticeDTO dari backend. Tidak ada / di luar scope → 404; backend gagal → 503. */
    private function klinik(string $id): array
    {
        try {
            $p = $this->api->get("api/v1/practices/{$id}");
        } catch (ApiException $e) {
            abort_if(in_array($e->status, [403, 404], true), 404);
            abort(503, 'Data klinik tidak bisa dimuat. Muat ulang halaman.');
        }
        $k = is_array($p) ? ($p['data'] ?? $p) : [];
        abort_unless(is_array($k) && isset($k['id']), 404);

        return $k;
    }
```

- [ ] **Step 4: Tambahkan route**

Di `routes/web.php`, tepat setelah route `klinik.simpan` dari F1, tambahkan:

```php
    // Ubah profil klinik — super admin, atau admin klinik untuk klinik
    // aktifnya sendiri (diperiksa KlinikController).
    Route::get('/dashboard/klinik/{id}/edit', [\App\Http\Controllers\KlinikController::class, 'edit'])
        ->whereNumber('id')->name('klinik.edit');
    Route::post('/dashboard/klinik/{id}', [\App\Http\Controllers\KlinikController::class, 'ubah'])
        ->whereNumber('id')->name('klinik.ubah');
    // Nonaktifkan/aktifkan dan hapus permanen — super admin saja. Method-nya
    // di F3; route-nya sudah di sini karena form edit merender tombolnya.
    Route::post('/dashboard/klinik/{id}/status', [\App\Http\Controllers\KlinikController::class, 'status'])
        ->whereNumber('id')->name('klinik.status');
    Route::post('/dashboard/klinik/{id}/hapus', [\App\Http\Controllers\KlinikController::class, 'hapus'])
        ->whereNumber('id')->name('klinik.hapus');
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikUbahTest|KlinikTambahTest'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/KlinikController.php routes/web.php tests/Feature/KlinikUbahTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): halaman ubah profil klinik untuk super admin dan admin klinik"
```

---

### Task F3: Nonaktifkan/aktifkan dan hapus permanen

**Files:**
- Modify: `app/Http/Controllers/KlinikController.php` (method `status`, `hapus`, `pesanTidakKosong`, konstanta `LABEL_DATA`)
- Test: `tests/Feature/KlinikStatusHapusTest.php`

**Interfaces:**
- Consumes: F1 (`buangCache`, `galat`, `superAdmin`), F2 (`klinik()`, route `klinik.status` / `klinik.hapus` / `klinik.edit`); backend `DELETE api/v1/practices/{id}` (± `?permanent=true`), `POST api/v1/practices/{id}/activate`.
- Produces: `KlinikController::status(Request, string $id)` (field form `aksi` = `nonaktifkan` | `aktifkan`) dan `KlinikController::hapus(Request, string $id)` (field form `konfirmasi_nama`). Super admin saja.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikStatusHapusTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Zona berbahaya di halaman ubah klinik — super admin saja: nonaktifkan,
// aktifkan kembali, dan hapus permanen (hanya klinik tanpa data; backend
// menolak yang lain dengan daftar hitungannya).
class KlinikStatusHapusTest extends TestCase
{
    private const EDIT = '/dashboard/klinik/4/edit';

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'],
                $extra,
            ),
        ];
    }

    /** GET → klinik 4 (status $status); selain GET → $jawab dengan $kode. */
    private function fake(int $status = 1, array|null $jawab = null, int $kode = 204): void
    {
        Http::fake(fn (Request $r) => $r->method() === 'GET'
            ? Http::response(['data' => ['id' => 4, 'name' => 'Klinik Sehat', 'status' => $status]])
            : Http::response($jawab, $kode));
    }

    private function super()
    {
        return $this->withSession($this->sesi('super'));
    }

    // ── Status ──────────────────────────────────────────────────────────

    public function test_nonaktifkan_memanggil_delete_tanpa_permanent(): void
    {
        Cache::put('pq_public_practices', ['lama'], 300);
        $this->fake();

        $res = $this->super()->post('/dashboard/klinik/4/status', ['aksi' => 'nonaktifkan']);

        $res->assertRedirect(self::EDIT);
        $res->assertSessionHas('klinikPesan', 'Klinik dinonaktifkan. Klinik tidak lagi muncul di booking publik.');
        $this->assertFalse(Cache::has('pq_public_practices'));
        Http::assertSent(fn (Request $r) => $r->method() === 'DELETE'
            && str_ends_with($r->url(), '/api/v1/practices/4'));
    }

    public function test_aktifkan_memanggil_activate(): void
    {
        $this->fake(0, ['data' => ['id' => 4, 'name' => 'Klinik Sehat', 'status' => 1]], 200);

        $this->super()->post('/dashboard/klinik/4/status', ['aksi' => 'aktifkan'])
            ->assertRedirect(self::EDIT)
            ->assertSessionHas('klinikPesan', 'Klinik aktif kembali.');

        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && str_ends_with($r->url(), '/api/v1/practices/4/activate'));
    }

    public function test_halaman_klinik_nonaktif_menawarkan_aktifkan_kembali(): void
    {
        $this->fake(0);

        $this->super()->get(self::EDIT)
            ->assertSee('Aktifkan kembali')
            ->assertDontSee('Nonaktifkan klinik');
    }

    public function test_aksi_asing_ditolak_tanpa_request(): void
    {
        Http::fake();

        $this->super()->post('/dashboard/klinik/4/status', ['aksi' => 'hapus'])->assertSessionHasErrors(['aksi']);

        Http::assertNothingSent();
    }

    public function test_admin_klinik_tidak_boleh_mengubah_status_atau_menghapus(): void
    {
        Http::fake();
        $admin = $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]));

        $admin->post('/dashboard/klinik/4/status', ['aksi' => 'nonaktifkan'])->assertNotFound();
        $admin->post('/dashboard/klinik/4/hapus', ['konfirmasi_nama' => 'Klinik Sehat'])->assertNotFound();

        Http::assertNothingSent();
    }

    // ── Hapus permanen ──────────────────────────────────────────────────

    public function test_konfirmasi_nama_salah_tidak_menghapus(): void
    {
        $this->fake();

        $this->super()->post('/dashboard/klinik/4/hapus', ['konfirmasi_nama' => 'klinik sehat'])
            ->assertRedirect(self::EDIT)
            ->assertSessionHasErrors(['konfirmasi_nama' => 'Ketik nama klinik persis seperti tertulis untuk menghapus.']);

        Http::assertNotSent(fn (Request $r) => $r->method() === 'DELETE');
    }

    public function test_hapus_permanen_klinik_kosong(): void
    {
        Cache::put('pq_tenant_miss:klinik-sehat', true, 300);
        Cache::put('pq_public_practices', ['lama'], 300);
        $this->fake();

        $res = $this->super()->post('/dashboard/klinik/4/hapus', ['konfirmasi_nama' => 'Klinik Sehat']);

        $res->assertRedirect('/admin');
        $res->assertSessionHas('klinikPesan', 'Klinik "Klinik Sehat" dihapus permanen.');
        $this->assertFalse(Cache::has('pq_public_practices'));
        Http::assertSent(fn (Request $r) => $r->method() === 'DELETE'
            && str_contains($r->url(), '/api/v1/practices/4?')
            && str_contains($r->url(), 'permanent=true'));
    }

    public function test_klinik_yang_punya_data_dijelaskan_hitungannya(): void
    {
        $this->fake(1, ['code' => 'clinic_not_empty', 'counts' => ['doctors' => 3, 'appointments' => 12]], 409);

        $this->super()->post('/dashboard/klinik/4/hapus', ['konfirmasi_nama' => 'Klinik Sehat'])
            ->assertRedirect(self::EDIT)
            ->assertSessionHas('klinikGagal', 'Tidak bisa dihapus: 12 appointment, 3 psikolog. Nonaktifkan saja.');
    }

    public function test_halaman_edit_menampilkan_tombol_hapus_terkunci(): void
    {
        $this->fake();

        $this->super()->get(self::EDIT)
            ->assertSee('Hapus Permanen')
            ->assertSee('name="konfirmasi_nama"', false)
            ->assertSee(":disabled=\"ketik !== 'Klinik Sehat'\"", false);
    }
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikStatusHapusTest`
Expected: FAIL — `Method App\Http\Controllers\KlinikController::status does not exist` (dan `hapus`).

- [ ] **Step 3: Tambahkan method di controller**

Di `app/Http/Controllers/KlinikController.php`, tepat setelah konstanta `PESAN_VALIDASI`, tambahkan:

```php
    /** Kunci `counts` dari 409 clinic_not_empty → kata dalam kalimat, urut tampil. */
    private const LABEL_DATA = [
        'appointments' => 'appointment',
        'bills' => 'tagihan',
        'encounters' => 'encounter',
        'doctors' => 'psikolog',
        'patients' => 'pasien',
        'receptionists' => 'resepsionis',
        'sessions' => 'sesi jadwal',
        'services' => 'layanan',
        'followups' => 'follow-up',
        'followupChains' => 'rangkaian follow-up',
        'taxes' => 'pajak',
        'notifications' => 'notifikasi',
    ];
```

Tepat **sebelum** baris `// ── Bantuan ───`, tambahkan:

```php
    // ── Status & hapus (super admin) ────────────────────────────────────

    public function status(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::superAdmin(), 404);

        $aksi = $request->validate(
            ['aksi' => ['required', 'in:nonaktifkan,aktifkan']],
            ['aksi.required' => 'Aksi tidak dikenali.', 'aksi.in' => 'Aksi tidak dikenali.'],
        )['aksi'];
        $lama = $this->klinik($id);
        $kembali = redirect()->route('klinik.edit', ['id' => $id]);

        try {
            if ($aksi === 'nonaktifkan') {
                $this->api->call('DELETE', "api/v1/practices/{$id}");
            } else {
                $this->api->post("api/v1/practices/{$id}/activate");
            }
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);

            return $kembali->with('klinikGagal', self::galat($e)['umum'] ?? 'Status klinik belum berubah.');
        }

        self::buangCache((string) ($lama['name'] ?? ''));

        return $kembali->with('klinikPesan', $aksi === 'nonaktifkan'
            ? 'Klinik dinonaktifkan. Klinik tidak lagi muncul di booking publik.'
            : 'Klinik aktif kembali.');
    }

    public function hapus(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::superAdmin(), 404);

        $lama = $this->klinik($id);
        $nama = (string) ($lama['name'] ?? '');
        $kembali = redirect()->route('klinik.edit', ['id' => $id]);

        // Dicek di server juga: tombol yang terkunci di browser bukan pengaman.
        if ($nama === '' || trim((string) $request->input('konfirmasi_nama', '')) !== $nama) {
            return $kembali->withErrors(['konfirmasi_nama' => 'Ketik nama klinik persis seperti tertulis untuk menghapus.']);
        }

        try {
            $this->api->call('DELETE', "api/v1/practices/{$id}", ['permanent' => 'true']);
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);
            $b = is_array($e->body) ? $e->body : [];

            return $kembali->with('klinikGagal', ($b['code'] ?? '') === 'clinic_not_empty'
                ? self::pesanTidakKosong($b['counts'] ?? [])
                : (self::galat($e)['umum'] ?? 'Klinik belum dihapus.'));
        }

        self::buangCache($nama);

        return redirect('/admin')->with('klinikPesan', "Klinik \"{$nama}\" dihapus permanen.");
    }
```

Di bagian `// ── Bantuan ───`, tambahkan di akhir kelas (sebelum `}` penutup):

```php
    private static function pesanTidakKosong(mixed $counts): string
    {
        $bagian = [];
        foreach (self::LABEL_DATA as $kunci => $kata) {
            $n = is_array($counts) ? (int) ($counts[$kunci] ?? 0) : 0;
            if ($n > 0) {
                $bagian[] = "{$n} {$kata}";
            }
        }

        return 'Tidak bisa dihapus: '.($bagian !== [] ? implode(', ', $bagian) : 'klinik masih punya data').'. Nonaktifkan saja.';
    }
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikStatusHapusTest|KlinikUbahTest|KlinikTambahTest'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/KlinikController.php tests/Feature/KlinikStatusHapusTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): nonaktifkan, aktifkan kembali, dan hapus permanen klinik kosong"
```

---

### Task F4: Pintu masuk di dashboard

**Files:**
- Modify: `resources/views/dashboard.blade.php` (state Alpine, getter, tab Clinics, kartu Settings)
- Modify: `app/Http/Controllers/DashboardController.php` (`$editKlinikUrl`)
- Modify: `app/Http/Controllers/ResourceController.php` (komentar `'clinics'`)
- Modify: `tests/Feature/StaffAccessTest.php` (tes lama yang memeriksa tulisan "Klinik baru dibuat lewat WordPress/KiviCare")
- Test: `tests/Feature/KlinikTabTest.php`

**Interfaces:**
- Consumes: route `klinik.baru`, `klinik.edit` (F1, F2); flash `klinikPesan` / `klinikPeringatan` (F1, F3).
- Produces: tombol **Add Clinic** dan tautan **Edit ›** di tab Clinics (super admin), filter status Semua/Aktif/Nonaktif, flash di atas grid, dashboard terbuka di tab Clinics setelah redirect dengan flash, kartu **Profil Klinik** di tab Settings untuk admin klinik.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikTabTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Pintu masuk CRUD klinik di dashboard: tombol Add Clinic dan tautan Edit
// di tab Clinics (super admin), kartu Profil Klinik di Settings (admin
// klinik), dan dashboard yang terbuka di tab Clinics setelah simpan/hapus.
class KlinikTabTest extends TestCase
{
    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(
                ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'],
                $extra,
            ),
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['data' => []])]);
    }

    public function test_super_admin_punya_tombol_tambah_filter_dan_tautan_edit(): void
    {
        $res = $this->withSession($this->sesi('super'))->get('/admin');

        $res->assertOk();
        $res->assertSee('href="/dashboard/klinik/baru"', false);
        $res->assertSee('Add Clinic');
        $res->assertSee(":href=\"'/dashboard/klinik/' + r.id + '/edit'\"", false);
        $res->assertSee('x-model="clinicFilter"', false);
        $res->assertSee('x-for="(r, i) in fClinicsTab"', false);
        $res->assertDontSee('Klinik baru dibuat lewat WordPress/KiviCare');
    }

    public function test_flash_membuka_tab_clinics_dan_tampil(): void
    {
        $res = $this->withSession($this->sesi('super') + ['klinikPesan' => 'Klinik "Klinik Sehat" ditambahkan.'])->get('/admin');

        $res->assertSee('view: "clinics"', false);
        $res->assertSee('Klinik &quot;Klinik Sehat&quot; ditambahkan.', false);
    }

    public function test_tanpa_flash_dashboard_terbuka_di_beranda(): void
    {
        $this->withSession($this->sesi('super'))->get('/admin')->assertSee('view: "dashboard"', false);
    }

    public function test_admin_klinik_mendapat_kartu_profil_klinik(): void
    {
        $res = $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))->get('/klinik');

        $res->assertOk();
        $res->assertSee('Profil Klinik');
        $res->assertSee('href="/dashboard/klinik/4/edit"', false);
        $res->assertDontSee('href="/dashboard/klinik/baru"', false);
    }

    public function test_resepsionis_tidak_mendapat_kartu_profil_klinik(): void
    {
        $this->withSession($this->sesi('admin', ['practiceId' => 4]))->get('/klinik')
            ->assertOk()
            ->assertDontSee('href="/dashboard/klinik/4/edit"', false);
    }
}
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikTabTest`
Expected: FAIL — `href="/dashboard/klinik/baru"` tidak ditemukan, dan tulisan "Klinik baru dibuat lewat WordPress/KiviCare" masih ada.

- [ ] **Step 3: `$editKlinikUrl` di DashboardController**

Di `app/Http/Controllers/DashboardController.php`, di dalam `render()`, tepat **setelah** entri `'pembayaranKlinikUrl' => ...` (yang berakhir `: null,`), tambahkan:

```php
            // Pintu ke halaman ubah profil kliniknya sendiri: hanya admin
            // klinik yang role mentahnya CLINIC_ADMIN (sama seperti
            // pembayaranKlinikUrl). Menu admin tidak punya tab Clinics, jadi
            // pintunya kartu di Settings. Super admin masuk dari kartu klinik.
            'editKlinikUrl' => $role === 'admin' && ! empty($profile['canManageClinicPayment']) && ! empty($profile['practiceId'])
                ? route('klinik.edit', ['id' => $profile['practiceId']], false)
                : null,
```

- [ ] **Step 4: Ubah `dashboard.blade.php`**

(a) State awal. Ganti baris

```js
    view: "dashboard",
```

menjadi:

```js
    // Kembali dari tambah/hapus klinik (flash klinikPesan/klinikPeringatan,
    // lihat KlinikController): buka langsung tab Clinics, tempat pesannya tampil.
    view: @json(session()->has('klinikPesan') || session()->has('klinikPeringatan') ? 'clinics' : 'dashboard'),
    clinicFilter: "semua",
```

(b) Getter. Tepat **setelah** baris

```js
    get fClinics() { return this.clinics.filter((r) => this.match(r, ["name", "address", "phone"])); },
```

tambahkan:

```js
    // Tab Clinics saja: fClinics + filter status. fClinics tetap dipakai
    // pemilih klinik di tab Services, yang tidak punya filter ini.
    get fClinicsTab() {
      return this.fClinics.filter((r) => this.clinicFilter === "semua" || (this.clinicFilter === "aktif" ? r.active : !r.active));
    },
```

(c) Header tab Clinics. Ganti blok

```blade
          {{-- "Add Clinic" dicabut: backend tidak membuat klinik (POST /practices
               selalu 501). Petunjuknya dikatakan, bukan tombol yang pasti gagal. --}}
          <div style="font-size:12.5px;color:#8A90A6;max-width:320px;line-height:1.45">Klinik baru dibuat lewat WordPress/KiviCare, lalu muncul di sini.</div>
        </div>
```

menjadi:

```blade
          {{-- Tambah klinik: halaman tersendiri, KlinikController (super admin saja). --}}
          @if (($role ?? null) === 'super')
          <a class="btn-red" href="{{ route('klinik.baru', [], false) }}" style="text-decoration:none"><x-icon name="plus" :size="16" :sw="2.2"/>Add Clinic</a>
          @endif
        </div>
        @if (session('klinikPesan'))
        <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:12px 16px;margin-bottom:16px;font-size:13.5px;font-weight:700;color:#1B6B4A">{{ session('klinikPesan') }}</div>
        @endif
        @if (session('klinikPeringatan'))
        <div style="border:1.5px solid #F3E2BE;background:#FFF6E5;border-radius:14px;padding:12px 16px;margin-bottom:16px;font-size:13.5px;color:#7A5A00;line-height:1.6">{{ session('klinikPeringatan') }}</div>
        @endif
```

(d) Filter status. Di blok pencarian tab Clinics, ganti

```blade
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari klinik"></div>
        </div>
        <div x-show="fClinics.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:40px">Belum ada klinik.</div>
        <div class="clinic-grid">
          <template x-for="(r, i) in fClinics" :key="i">
```

menjadi:

```blade
          <select x-model="clinicFilter" aria-label="Filter status klinik" style="border:1.5px solid #DDE1EC;border-radius:11px;padding:9px 12px;font-size:13.5px;color:#1E2236;background:#fff">
            <option value="semua">Semua</option>
            <option value="aktif">Aktif</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari klinik"></div>
        </div>
        <div x-show="fClinicsTab.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:40px">Belum ada klinik.</div>
        <div class="clinic-grid">
          <template x-for="(r, i) in fClinicsTab" :key="i">
```

(Blok pencarian yang sama persis juga ada di tab Services — **jangan** ubah yang itu. Yang diubah adalah yang langsung diikuti `Belum ada klinik.` dan `<div class="clinic-grid">`.)

(e) Tautan Edit. Di kartu klinik, di dalam `@if (($role ?? null) === 'super')`, tepat **setelah** tautan `Admin klinik ›`, tambahkan:

```blade
                <a x-show="r.id != null" :href="'/dashboard/klinik/' + r.id + '/edit'"
                   style="display:inline-flex;align-items:center;margin-top:10px;margin-left:14px;font-size:12.5px;font-weight:600;color:#425FAD;text-decoration:none">Edit ›</a>
```

(f) Kartu Settings admin klinik. Tepat **sebelum** komentar `{{-- Admin klinik yang berhak saja — DashboardController::render()` (kartu Pembayaran Internasional), tambahkan:

```blade
          {{-- Profil klinik sendiri — admin klinik yang berhak saja
               (DashboardController::render() mengisi $editKlinikUrl hanya
               untuknya). Halamannya: KlinikController::edit. --}}
          @if (! empty($editKlinikUrl))
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:15px;font-weight:700;color:#1E2236;margin-bottom:4px">Profil Klinik</div>
            <div style="font-size:13px;color:#8A90A6;margin-bottom:18px;line-height:1.6">Ubah nama, alamat, telepon, dan email klinik Anda.</div>
            <a class="btn-white" href="{{ $editKlinikUrl }}" style="text-decoration:none;display:inline-flex;align-items:center">Ubah Profil Klinik</a>
          </div>
          @endif

```

- [ ] **Step 5: Perbarui komentar di ResourceController**

Di `app/Http/Controllers/ResourceController.php`, ganti paragraf komentar

```php
        // 'clinics' juga dicabut. POST /api/v1/practices selalu membalas 501
        // ("Practice creation is delegated to the WordPress provisioning
        // flow"), jadi Tambah Klinik tidak pernah bisa berhasil — dan sebelum
        // gagal, foto pemiliknya sudah terunggah permanen ke backend. Klinik
        // baru dibuat di WordPress/KiviCare; kembalikan setelah backend
        // benar-benar punya POST /practices.
```

menjadi:

```php
        // 'clinics' sengaja tidak ada di sini. Tambah, ubah, nonaktifkan, dan
        // hapus klinik punya halaman sendiri (KlinikController), karena form
        // tambah memuat pilihan admin bertingkat yang tidak cocok dengan
        // modal generik ini.
```

- [ ] **Step 6: Perbarui tes lama di StaffAccessTest**

Di `tests/Feature/StaffAccessTest.php`, ganti komentar dan tes `test_clinic_creation_is_not_offered_because_the_backend_cannot_do_it` dengan:

```php
    // Tambah klinik lewat halaman sendiri (KlinikController), bukan modal
    // generik: route modal lama /dashboard/clinics/create tetap tidak ada,
    // dan tidak ada yang sampai ke backend lewat jalur itu.
    public function test_clinic_creation_goes_through_its_own_page_not_the_generic_modal(): void
    {
        Http::fake(fn () => Http::response(['id' => 1]));

        $this->withSession($this->staffSession('super'))
            ->postJson('/dashboard/clinics/create', ['name' => 'Klinik Baru'])
            ->assertNotFound();
        Http::assertNothingSent();

        $this->withSession($this->staffSession('super'))->get('/admin')
            ->assertDontSee("openModal('clinic')", false)
            ->assertSee('href="/dashboard/klinik/baru"', false);
    }
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikTabTest|StaffAccessTest|AdminKlinikSuperTest|PengaturanPembayaranKlinikTest|Dashboard'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add resources/views/dashboard.blade.php app/Http/Controllers/DashboardController.php \
  app/Http/Controllers/ResourceController.php tests/Feature/StaffAccessTest.php tests/Feature/KlinikTabTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): tombol tambah, filter status, tautan edit, dan kartu profil klinik di dashboard"
```

---

### Task F5: Verifikasi penuh FE dan PR

**Files:** tidak ada file baru.

- [ ] **Step 1: Seluruh tes FE**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`
Expected: `OK (...)` tanpa failure.

- [ ] **Step 2: Lint PHP**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli sh -c 'for f in app/Http/Controllers/KlinikController.php app/Http/Controllers/KlinikAdminController.php app/Http/Controllers/DashboardController.php routes/web.php; do php -l "$f" || exit 1; done'`
Expected: empat baris `No syntax errors detected`.

- [ ] **Step 3: Uji di browser lokal (opsional tapi disarankan)**

Jalankan FE lokal dengan backend stub (lihat catatan "FE local browser smoke test" milik tim) dan klik: tab Clinics → Add Clinic → isi → simpan; ganti mode admin dan pastikan kolomnya muncul/hilang; buka Edit, ubah nama, pastikan peringatan link berubah muncul; tombol Hapus Permanen terkunci sampai nama diketik persis.

- [ ] **Step 4: Push dan buka PR**

```bash
git push origin feat/crud-klinik:refs/heads/feat/crud-klinik
```

Buka PR `feat/crud-klinik` → `main` di `raakanaka/laravel-praktiqu`. Di deskripsi: tautan ke PR backend, daftar halaman baru, dan **"Jangan merge sebelum PR backend live (R2)"** — tanpa backend baru, Add Clinic membalas 501 dan pesan galatnya generik.

---

## Grup R — Rilis (pemilik repo / orang yang punya akses server)

### Task R1: Plugin 1.8.0 ke WordPress produksi

- [ ] **Step 1: Cek tabel yang dihitung hapus permanen ada di produksi**

Di phpMyAdmin / klien MySQL database WordPress produksi (`api-appointment.praktiqu.com`, Hostinger), jalankan:

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN ('wp_kc_appointments','wp_kc_bills','wp_kc_patient_encounters','wp_kc_doctor_clinic_mappings',
                      'wp_kc_patient_clinic_mappings','wp_kc_receptionist_clinic_mappings','wp_kc_clinic_sessions',
                      'wp_kc_service_doctor_mapping','wp_kc_followups','wp_kc_followup_chains','wp_kc_taxes',
                      'wp_kc_custom_notifications');
```

Expected: **12 baris**. Kalau ada yang hilang, hapus kuncinya dari `CLINIC_REFERENCE_TABLES` (B1) sebelum backend dirilis — query hitungan akan error 500 bila tabelnya tidak ada.

- [ ] **Step 2: Unggah plugin**

Cadangkan folder `wp-content/plugins/praktiqu-endpoint` di server, lalu ganti isinya dengan `Wordpress-Plugin/praktiqu-endpoint` dari branch `feat/crud-klinik` (cara yang sama dengan rilis 1.7.0). Jangan mengganti nama folder: memori tim mencatat login mati 7 minggu karena folder plugin ini pernah di-rename.

- [ ] **Step 3: Verifikasi**

- wp-admin → Plugins: "PraktiQU Endpoint" versi **1.8.0**, aktif.
- Endpoint terdaftar dan terlindungi:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api-appointment.praktiqu.com/wp-json/praktiqu/v1/clinic-admins
  ```
  Expected: `401` atau `403` (bukan `404`). Kalau WAF memblokir curl, buka URL itu di browser yang sedang login wp-admin: harus muncul JSON error, bukan halaman 404.
- Login staf di `appointment.praktiqu.com` masih berjalan (plugin yang sama melayani autentikasi).

### Task R2: Backend

- [ ] Merge PR backend `feat/crud-klinik` → `main`. Hostinger auto-deploy dari `main`.
- [ ] Setelah restart, periksa log aplikasi (`console.log` di server) tidak ada error baru.
- [ ] Cek cepat dengan token super admin: `POST /api/v1/practices` dengan body `{}` → **422** (bukan 501).

### Task R3: FE

- [ ] Merge PR FE `feat/crud-klinik` → `main` (GitHub Actions men-deploy ke `appointment.praktiqu.com`, ±1 menit).
- [ ] `/dashboard/klinik/baru` tanpa login → redirect ke login; dengan login super admin → form tampil.

### Task R4: Uji coba di produksi (user)

- [ ] Tambah klinik uji mode **Atur nanti**, nama mis. "Klinik Uji Coba CRUD". Pastikan muncul di tab Clinics dan link booking `/klinik-uji-coba-crud` terbuka.
- [ ] Ubah namanya; pastikan peringatan link berubah muncul dan link baru terbuka, link lama 404.
- [ ] Nonaktifkan → klinik tidak muncul di booking publik; Aktifkan kembali → muncul lagi.
- [ ] Hapus permanen klinik uji itu.
- [ ] Tambah klinik uji kedua mode **Buat akun admin baru** dengan email milikmu sendiri; pastikan email selamat datang masuk dan bisa login sebagai admin klinik; pastikan admin itu melihat kartu **Profil Klinik** di Settings dan bisa mengubah alamat, tetapi tidak melihat zona berbahaya.
- [ ] Bersihkan: hapus permanen klinik uji kedua (super admin), lalu hapus akun admin uji di wp-admin → Users.
