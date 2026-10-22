# Psikolog Menambah Layanannya Sendiri — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap psikolog bisa menambah layanannya sendiri dari dashboard. Ia tidak perlu
menjadi admin klinik atau pemilik klinik.

**Architecture:** Endpoint yang sudah ada, `POST /api/v1/services`, diperluas untuk
`PROFESSIONAL`:
- `doctorIds` dikunci ke dirinya sendiri;
- kliniknya harus klinik aktif tempat ia praktik, dari `listPracticeClinics` yang baru;
- daftar klinik yang sama dikirim sebagai `practiceClinics` di login dan `/auth/me`.

FE Laravel menyimpan `practiceClinics` di sesi dan membuka tombol Add Service untuk psikolog.
Isian `doctorIds` diambil dari sesi, bukan dari form.

**Tech Stack:** Backend Next.js 14 + Prisma (MySQL, tabel `wp_kc_*` KiviCare) + Vitest. FE
Laravel 11 + Blade + Alpine.js + PHPUnit.

**Spec:** `docs/superpowers/specs/2026-10-19-psikolog-tambah-layanan-design.md`

## Global Constraints

- **Hapus.** Hapus/pensiunkan layanan tetap **khusus Super Admin & Admin Klinik**: `canWrite`
  tidak berubah dan DELETE tetap memakainya.
- **Langsung berlaku.** Layanan buatan psikolog langsung berlaku. Tidak ada alur persetujuan
  dan status tidak dipaksa.
- **Pesan tolak backend.** Penolakan untuk psikolog berupa 403 dan tidak dibuang diam-diam.
  Pesan persisnya:
  - `Psychologists can only add services for themselves`
  - `Professional is not assigned to an active clinic`
  - `Not a clinic this professional practises at`
- **`clinic_required`.** Psikolog dengan > 1 klinik aktif yang tidak mengirim `clinicId` →
  **422** `clinic_required`.
- **Klinik nonaktif.** Klinik `status != 1` tidak dihitung sebagai klinik praktik.
- **Nama field.** `clinics` di `/auth/me` tetap khusus CLINIC_ADMIN. Field baru namanya
  `practiceClinics`.
- **Kegagalan memuat `practiceClinics`.** Tidak boleh menjatuhkan login atau `/auth/me`:
  kegagalan dicatat di log, lalu `[]`.
- **Mode pemilik.** Tidak berubah: `OWNER_ROUTES` tidak disentuh.
- **Bahasa.** Komentar kode BE berbahasa Inggris dan komentar FE berbahasa Indonesia,
  mengikuti file sekitarnya. Pesan commit berbahasa Indonesia, diakhiri
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Urutan rilis.** BE di-merge dulu, baru FE.

## Peta file

**Backend** (worktree `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-tambah-layanan`, branch `feat/psikolog-tambah-layanan`):

| File | Tanggung jawab |
|---|---|
| `src/services/billing/kc-actor.ts` (ubah) | `PracticeClinic`, `listPracticeClinics()`: klinik aktif tempat psikolog praktik |
| `src/services/auth/service.ts` (ubah) | `scopeClinics()` PROFESSIONAL ikut mengirim `practiceClinics`; `LoginResult.user.practiceClinics` |
| `src/services/service-catalog/own-create.ts` (baru) | `resolveOwnCreateTarget()`: keputusan klinik/tolak untuk create milik psikolog |
| `src/services/service-catalog/scope.ts` (ubah) | `canCreate()`; komentar kepala |
| `src/app/api/v1/services/route.ts` (ubah) | POST memakai `canCreate` + jalur PROFESSIONAL |
| `docs/api/SERVICES-CRUD-GUIDE.md`, `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (ubah) | kontrak |
| `tests/integration/services/practice-clinics.test.ts` (baru) | `listPracticeClinics` di test DB |
| `tests/integration/auth/auth-me-owned-clinics.test.ts` (ubah) | `practiceClinics` di `/auth/me` |
| `tests/unit/auth/scope-clinics-owned-failure.test.ts` (ubah) | kegagalan `practiceClinics` → `[]` |
| `tests/services/service-catalog.own-create.test.ts` (baru) | unit `resolveOwnCreateTarget` |
| `tests/services/service-catalog.scope.test.ts` (ubah) | `canCreate` |
| `tests/integration/services/collection-route.test.ts` (ubah) | POST untuk PROFESSIONAL |

**FE** (worktree `/home/ahmad/projects/praktiqu-fe/psikolog-tambah-layanan`, branch `feat/psikolog-tambah-layanan`):

| File | Tanggung jawab |
|---|---|
| `app/Http/Controllers/AuthController.php` (ubah) | parse + simpan `practiceClinics`; `klinikPraktikSesi()` |
| `app/Http/Controllers/ServiceController.php` (ubah) | `store` untuk psikolog |
| `app/Http/Controllers/DashboardController.php` (ubah) | payload `klinikPraktik` |
| `resources/views/dashboard.blade.php` (ubah) | tombol Add Service + form untuk psikolog |
| `tests/Feature/KlinikPraktikProfilTest.php` (baru) | sesi `practiceClinics` |
| `tests/Feature/ServiceCrudTest.php` (ubah) | `store` psikolog |
| `tests/Feature/ModePemilikDashboardTest.php`, `tests/Feature/DeadFeatureAuditTest.php` (ubah) | gerbang tombol + payload |

---

### Task 0: Siapkan kedua worktree

**Files:** tidak ada yang di-commit.

- [ ] **Step 1: Env test dan dependensi BE**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-tambah-layanan
cp /home/ahmad/projects/nextjs-appointment-praktiqu/.env.test.local .
ln -s /home/ahmad/projects/nextjs-appointment-praktiqu/node_modules node_modules
npx prisma generate >/dev/null && npx vitest run tests/services/service-catalog.scope.test.ts
```
Expected: `Test Files 1 passed`. `.env.test.local` dan `node_modules` sudah di-`.gitignore`;
cek dengan `git status --short`, yang harus kosong.

- [ ] **Step 2: Dependensi FE**

```bash
cd /home/ahmad/projects/praktiqu-fe/psikolog-tambah-layanan
mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app -e COMPOSER_ALLOW_SUPERUSER=1 composer:2 install --no-scripts -q
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter ServiceCrudTest
```
Expected: `OK`. Tidak ada `php` lokal, jadi semua perintah PHPUnit di rencana ini memakai
baris `docker run` yang sama. Selanjutnya baris itu disingkat **`PHPUNIT`**:
`DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`.

---

### Task 1: `listPracticeClinics` — klinik aktif tempat psikolog praktik

**Files:**
- Modify: `src/services/billing/kc-actor.ts` (tambah di bawah `listAdminClinics`)
- Test: `tests/integration/services/practice-clinics.test.ts` (baru, test DB)

**Interfaces:**
- Produces: `export interface PracticeClinic { id: number; name: string }` dan
  `export async function listPracticeClinics(wpUserId: bigint): Promise<PracticeClinic[]>`.
  Dipakai Task 2 dan Task 3.

- [ ] **Step 1: Tulis test yang gagal**

`tests/integration/services/practice-clinics.test.ts`:

```ts
/**
 * listPracticeClinics: the active clinics a psychologist is mapped to — the one source for
 * where they may add a service and for the FE's clinic picker. Runs on the test DB because
 * a mock cannot see the real wp_kc_* schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { listPracticeClinics } from '@/services/billing/kc-actor';
import { assertTestDb } from '../../billing/fixtures';

const BASE = 8_790_000;
const END = BASE + 10_000;
const ACTIVE_A = BASE + 1;
const ACTIVE_B = BASE + 2;
const RETIRED = BASE + 3;
const DOC = BASE + 500;
const LONER = BASE + 501; // mapped nowhere

async function wipe() {
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, status, name] of [
    [ACTIVE_A, 1, 'Klinik A'],
    [ACTIVE_B, 1, '  '],
    [RETIRED, 0, 'Klinik Lama'],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', ?, 0, 0, NOW())`,
      id, name, `c${id}@test.local`, status,
    );
  }
  // Out of id order, and ACTIVE_B twice: the answer must still be ascending and unique.
  let m = BASE + 9000;
  for (const clinicId of [ACTIVE_B, RETIRED, ACTIVE_A, ACTIVE_B]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({
      data: { id: BigInt(m), doctorId: BigInt(DOC), clinicId: BigInt(clinicId), createdAt: new Date() },
    });
  }
});

afterAll(async () => {
  await wipe();
});

describe('listPracticeClinics', () => {
  it('lists active clinics only, ascending by id, each once, with a fallback name', async () => {
    expect(await listPracticeClinics(BigInt(DOC))).toEqual([
      { id: ACTIVE_A, name: 'Klinik A' },
      { id: ACTIVE_B, name: `Klinik #${ACTIVE_B}` },
    ]);
  });

  it('answers [] for a psychologist with no mapping', async () => {
    expect(await listPracticeClinics(BigInt(LONER))).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/services/practice-clinics.test.ts`
Expected: FAIL, `listPracticeClinics is not a function` (atau TS: no exported member).

- [ ] **Step 3: Implementasi**

Di `src/services/billing/kc-actor.ts`, tepat setelah fungsi `listAdminClinics`:

```ts
/** One active clinic a PROFESSIONAL practises at, as /auth/me `practiceClinics` reports it. */
export interface PracticeClinic {
  id: number;
  name: string;
}

/**
 * Every ACTIVE clinic this psychologist is mapped to, ascending by id, each once.
 *
 * The one source for where a psychologist may add a service of their own
 * (POST /api/v1/services) and for the clinic picker the FE builds from `practiceClinics`.
 * Inactive clinics are left out on purpose: several psychologists still hold a mapping to a
 * retired clinic, and counting it would make them pick between one live clinic and one that
 * nobody can book.
 */
export async function listPracticeClinics(wpUserId: bigint): Promise<PracticeClinic[]> {
  const mappings = await prisma.kcDoctorClinicMapping.findMany({
    where: { doctorId: wpUserId },
    select: { clinicId: true },
  });
  if (mappings.length === 0) return [];

  const clinics = await prisma.kcClinic.findMany({
    where: { id: { in: mappings.map((m) => m.clinicId) }, status: 1 },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  return clinics.map((c) => ({ id: Number(c.id), name: c.name?.trim() || `Klinik #${c.id}` }));
}
```

`findMany` atas `id IN (...)` sudah menghasilkan setiap klinik sekali, walau mapping-nya ganda.
Kolom yang dibaca hanya `id`, `name`, dan `clinicId`. Kolom tanggal sengaja tidak disentuh:
mapping produksi berisi `0000-00-00` yang membuat Prisma 500.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npx vitest run tests/integration/services/practice-clinics.test.ts`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/billing/kc-actor.ts tests/integration/services/practice-clinics.test.ts
git commit -m "feat(klinik): daftar klinik aktif tempat psikolog praktik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `practiceClinics` di login dan `/auth/me`

**Files:**
- Modify: `src/services/auth/service.ts`: import di baris 10, `LoginResult.user` (sekitar baris 165), dan `scopeClinics` (sekitar baris 281–310)
- Modify: `tests/unit/auth/scope-clinics-owned-failure.test.ts`
- Modify: `tests/integration/auth/auth-me-owned-clinics.test.ts`

**Interfaces:**
- Consumes: `listPracticeClinics(wpUserId: bigint): Promise<PracticeClinic[]>` (Task 1).
- Produces: `user.practiceClinics: PracticeClinic[]` untuk PROFESSIONAL di respons login,
  OTP login, dan `/auth/me`. Selalu berupa larik; role lain tidak membawanya. Dibaca FE Task 6.

- [ ] **Step 1: Tulis test unit yang gagal**

Ganti seluruh isi `tests/unit/auth/scope-clinics-owned-failure.test.ts`:

```ts
/**
 * A psychologist's login / /auth/me must survive a failing clinic lookup (e.g. `clinic_owners`
 * missing on a half-migrated DB): the login still succeeds with an empty list, the failure is
 * logged, and the FE retries on its next refresh. The two lists fail independently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listOwnedClinics, listPracticeClinics, logError } = vi.hoisted(() => ({
  listOwnedClinics: vi.fn(),
  listPracticeClinics: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/services/clinic-owner/service', () => ({ listOwnedClinics }));
vi.mock('@/services/billing/kc-actor', async (orig) => ({
  ...(await orig<typeof import('@/services/billing/kc-actor')>()),
  listPracticeClinics,
}));
vi.mock('@/lib/logging', () => ({
  logging: { error: logError, warn: vi.fn(), info: vi.fn() },
}));

const { scopeClinics } = await import('@/services/auth/service');

describe('scopeClinics — PROFESSIONAL clinic lists', () => {
  beforeEach(() => {
    listOwnedClinics.mockReset();
    listPracticeClinics.mockReset();
    logError.mockReset();
    listPracticeClinics.mockResolvedValue([{ id: 4, name: 'K' }]);
  });

  it('resolves to an empty ownedClinics list and logs the error with the wpUserId', async () => {
    const boom = new Error("Table 'clinic_owners' doesn't exist");
    listOwnedClinics.mockRejectedValue(boom);

    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [],
      practiceClinics: [{ id: 4, name: 'K' }],
    });

    expect(logError).toHaveBeenCalledTimes(1);
    const [, err, ctx] = logError.mock.calls[0];
    expect(err).toBe(boom);
    expect(JSON.stringify(ctx)).toContain('5');
  });

  it('resolves to an empty practiceClinics list when that lookup fails, keeping ownedClinics', async () => {
    listOwnedClinics.mockResolvedValue([{ id: 4, name: 'K', source: 'manual' }]);
    listPracticeClinics.mockRejectedValue(new Error('boom'));

    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [{ id: 4, name: 'K', source: 'manual' }],
      practiceClinics: [],
    });
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('still returns both lists when the lookups work', async () => {
    listOwnedClinics.mockResolvedValue([{ id: 4, name: 'K', source: 'manual' }]);
    await expect(scopeClinics('PROFESSIONAL', 5n)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [{ id: 4, name: 'K', source: 'manual' }],
      practiceClinics: [{ id: 4, name: 'K' }],
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('gives a psychologist without a WordPress link two empty lists, without querying', async () => {
    await expect(scopeClinics('PROFESSIONAL', null)).resolves.toEqual({
      clinicId: null,
      ownedClinics: [],
      practiceClinics: [],
    });
    expect(listPracticeClinics).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/unit/auth/scope-clinics-owned-failure.test.ts`
Expected: FAIL. Hasilnya tidak berisi `practiceClinics`.

- [ ] **Step 3: Implementasi**

Di `src/services/auth/service.ts`:

1. Baris import 10 menjadi:

```ts
import {
  listAdminClinics,
  listPracticeClinics,
  resolveClinicId,
  type AdminClinic,
  type PracticeClinic,
} from '@/services/billing/kc-actor';
```

2. Di `LoginResult.user`, tepat di bawah `ownedClinics?: OwnedClinic[];`:

```ts
    /** See `scopeClinics`. Only a PROFESSIONAL carries it. */
    practiceClinics?: PracticeClinic[];
```

3. Di komentar dok `scopeClinics`, tepat setelah paragraf `ownedClinics`:

```ts
 *
 * `practiceClinics`: PROFESSIONAL only. Every active clinic they practise at, ascending by
 * id — where they may add a service of their own. Always an array.
```

4. Ganti tanda tangan dan cabang PROFESSIONAL `scopeClinics`:

```ts
export async function scopeClinics(
  role: UserRole,
  wpUserId: bigint | null,
): Promise<{
  clinicId: number | null;
  clinics?: AdminClinic[];
  ownedClinics?: OwnedClinic[];
  practiceClinics?: PracticeClinic[];
}> {
```

```ts
  if (role === 'PROFESSIONAL') {
    if (wpUserId === null) return { clinicId: null, ownedClinics: [], practiceClinics: [] };
    const [ownedClinics, practiceClinics] = await Promise.all([
      optionalClinicList('owned clinics', wpUserId, () => listOwnedClinics(wpUserId)),
      optionalClinicList('practice clinics', wpUserId, () => listPracticeClinics(wpUserId)),
    ]);
    return { clinicId: null, ownedClinics, practiceClinics };
  }
```

5. Tepat di atas `export async function scopeClinics`:

```ts
/**
 * A psychologist's clinic list must never take a login or /auth/me down: a failing query (a
 * missing `clinic_owners` table, a half-migrated DB) is logged and answered with [], and the
 * FE retries on its next refresh. Each list fails on its own.
 */
async function optionalClinicList<T>(what: string, wpUserId: bigint, load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (err) {
    await logging.error(`Could not load the ${what} for a psychologist`, err, {
      metadata: { wpUserId: wpUserId.toString() },
    });
    return [];
  }
}
```

Komentar lama di dalam blok `try/catch` cabang PROFESSIONAL ("Owner mode is optional: …") ikut
terhapus, karena isinya kini ada di dok `optionalClinicList`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npx vitest run tests/unit/auth/scope-clinics-owned-failure.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Tambah test integrasi `/auth/me` (test DB)**

Di `tests/integration/auth/auth-me-owned-clinics.test.ts`, tambahkan di akhir file:

```ts
describe('GET /auth/me — practiceClinics', () => {
  it('lists the active clinics a psychologist practises at', async () => {
    expect((await me('auth-me-owned-test-doc', 'PROFESSIONAL')).practiceClinics).toEqual([
      { id: SOLO, name: 'Klinik Solo' },
    ]);
  });

  it('gives a psychologist without clinics, or without a WordPress link, an empty list', async () => {
    expect((await me('auth-me-owned-test-lone', 'PROFESSIONAL')).practiceClinics).toEqual([]);
    expect((await me('auth-me-owned-test-unlinked', 'PROFESSIONAL')).practiceClinics).toEqual([]);
  });

  it('gives other roles no practiceClinics field at all', async () => {
    expect(await me('auth-me-owned-test-super', 'SUPER_ADMIN')).not.toHaveProperty('practiceClinics');
  });
});
```

Run: `npx vitest run tests/integration/auth/auth-me-owned-clinics.test.ts`
Expected: `6 passed`.

- [ ] **Step 6: Cek tipe dan test auth lain**

Run: `npx tsc --noEmit -p . && npx vitest run tests/unit/auth tests/integration/auth`
Expected: tsc tanpa error; semua test auth lulus. Kalau ada test login/OTP yang memakai
`toEqual` atas objek user PROFESSIONAL dan gagal karena `practiceClinics`, tambahkan
`practiceClinics: []` (atau daftar yang sesuai fixture-nya) ke nilai harapannya. Jangan
melonggarkan menjadi `toMatchObject`.

- [ ] **Step 7: Commit**

```bash
git add src/services/auth/service.ts tests/unit/auth/scope-clinics-owned-failure.test.ts tests/integration/auth/auth-me-owned-clinics.test.ts
git commit -m "feat(auth): login dan /auth/me mengirim klinik praktik psikolog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Ikut sertakan file test lain yang diubah di Step 6, kalau ada.)

---

### Task 3: `canCreate` dan `resolveOwnCreateTarget`

**Files:**
- Modify: `src/services/service-catalog/scope.ts`
- Create: `src/services/service-catalog/own-create.ts`
- Modify: `tests/services/service-catalog.scope.test.ts`
- Create: `tests/services/service-catalog.own-create.test.ts`

**Interfaces:**
- Consumes: `listPracticeClinics` (Task 1).
- Produces:
  - `export function canCreate(role: Actor['role']): boolean`;
  - `export type OwnCreateRefusal = 'not_self' | 'no_clinic' | 'clinic_not_yours' | 'clinic_required'`;
  - `export type OwnCreateTarget = { clinicId: number } | { refusal: OwnCreateRefusal }`;
  - `export async function resolveOwnCreateTarget(input: { self: bigint; doctorIds: number[]; clinicId?: number }): Promise<OwnCreateTarget>`.

  Dipakai Task 4.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/services/service-catalog.scope.test.ts`:
- `canCreate` ke daftar import dari `@/services/service-catalog/scope`;
- blok ini di bawah `describe('canEdit', …)`.

```ts
describe('canCreate', () => {
  it('admits the two admin roles plus a psychologist adding for themselves', () => {
    expect(canCreate('SUPER_ADMIN')).toBe(true);
    expect(canCreate('CLINIC_ADMIN')).toBe(true);
    // Narrowed to their own name and clinics by resolveOwnCreateTarget, not here.
    expect(canCreate('PROFESSIONAL')).toBe(true);
    expect(canCreate('RECEPTIONIST')).toBe(false);
    expect(canCreate('CLIENT')).toBe(false);
  });

  it('leaves deleting to the admins', () => {
    expect(canWrite('PROFESSIONAL')).toBe(false);
  });
});
```

`tests/services/service-catalog.own-create.test.ts`:

```ts
/**
 * Where a psychologist's own new service goes. The clinic list is mocked here; its query is
 * covered on the test DB in tests/integration/services/practice-clinics.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const kc = vi.hoisted(() => ({ listPracticeClinics: vi.fn() }));
vi.mock('@/services/billing/kc-actor', () => kc);

import { resolveOwnCreateTarget } from '@/services/service-catalog/own-create';

const SELF = 34n;
const one = [{ id: 4, name: 'AzaniDianda.com' }];
const two = [{ id: 5, name: 'Klinik A' }, { id: 44, name: 'Klinik B' }];

beforeEach(() => {
  kc.listPracticeClinics.mockReset();
  kc.listPracticeClinics.mockResolvedValue(one);
});

describe('resolveOwnCreateTarget', () => {
  it('uses the only clinic when none is named', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34] })).toEqual({ clinicId: 4 });
    expect(kc.listPracticeClinics).toHaveBeenCalledWith(SELF);
  });

  it('accepts a duplicated self id', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34, 34] })).toEqual({ clinicId: 4 });
  });

  it('refuses a body naming another psychologist, before reading any clinic', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34, 35] })).toEqual({ refusal: 'not_self' });
    expect(kc.listPracticeClinics).not.toHaveBeenCalled();
  });

  it('asks for a clinic when there is more than one', async () => {
    kc.listPracticeClinics.mockResolvedValue(two);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34] })).toEqual({ refusal: 'clinic_required' });
  });

  it('takes a named clinic they practise at', async () => {
    kc.listPracticeClinics.mockResolvedValue(two);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 44 })).toEqual({ clinicId: 44 });
  });

  it('refuses a named clinic they do not practise at, even with a single clinic', async () => {
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 99 })).toEqual({
      refusal: 'clinic_not_yours',
    });
  });

  it('refuses a psychologist with no active clinic at all', async () => {
    kc.listPracticeClinics.mockResolvedValue([]);
    expect(await resolveOwnCreateTarget({ self: SELF, doctorIds: [34], clinicId: 4 })).toEqual({ refusal: 'no_clinic' });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/services/service-catalog.scope.test.ts tests/services/service-catalog.own-create.test.ts`
Expected: FAIL. `canCreate` belum diekspor, dan modul `own-create` tidak ada.

- [ ] **Step 3: Implementasi `canCreate`**

Di `src/services/service-catalog/scope.ts`, tepat di bawah `canEdit`:

```ts
/**
 * `canWrite`, plus a psychologist adding offerings for themselves (2026-10-19). Their name and
 * clinic are pinned by `resolveOwnCreateTarget`, not here. Retiring stays `canWrite`.
 */
export function canCreate(role: Actor['role']): boolean {
  return canWrite(role) || role === 'PROFESSIONAL';
}
```

Ganti paragraf terakhir komentar kepala file, mulai dari "Editing is one step wider (2026-10-15)"
sampai akhir paragraf, dengan:

```ts
 * Editing is one step wider (2026-10-15): a psychologist may change the price, duration,
 * name and the rest of *their own* offerings. "Their own" is not enforced here —
 * `readScopeFor` pins a PROFESSIONAL to `doctorId = their wp user`, and `updateService` 404s
 * any mapping outside that scope. Adding is as wide (2026-10-19): a psychologist may add
 * offerings for themselves at an active clinic they practise at — see `canCreate` and
 * `own-create.ts`. Retiring offerings stays with the admins.
```

- [ ] **Step 4: Implementasi `own-create.ts`**

`src/services/service-catalog/own-create.ts`:

```ts
/**
 * Where a psychologist's own new service goes (POST /api/v1/services as PROFESSIONAL).
 *
 * A psychologist may add offerings for themselves only, at an active clinic they practise at.
 * The answer is a clinic id or the reason to refuse; the route turns the reason into a
 * response. Spec: docs/superpowers/specs/2026-10-19-psikolog-tambah-layanan-design.md §B3.
 */
import { listPracticeClinics } from '@/services/billing/kc-actor';

export type OwnCreateRefusal = 'not_self' | 'no_clinic' | 'clinic_not_yours' | 'clinic_required';

export type OwnCreateTarget = { clinicId: number } | { refusal: OwnCreateRefusal };

export async function resolveOwnCreateTarget(input: {
  /** The psychologist's wp user id, from the token — never from the body. */
  self: bigint;
  doctorIds: number[];
  clinicId?: number;
}): Promise<OwnCreateTarget> {
  // A body naming anyone else is the caller's mistake. Dropping the other ids silently would
  // create the service for a different set of people than the one asked for.
  if (input.doctorIds.some((d) => BigInt(d) !== input.self)) return { refusal: 'not_self' };

  const clinics = await listPracticeClinics(input.self);
  if (clinics.length === 0) return { refusal: 'no_clinic' };

  if (input.clinicId !== undefined) {
    return clinics.some((c) => c.id === input.clinicId)
      ? { clinicId: input.clinicId }
      : { refusal: 'clinic_not_yours' };
  }
  return clinics.length === 1 ? { clinicId: clinics[0].id } : { refusal: 'clinic_required' };
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `npx vitest run tests/services/service-catalog.scope.test.ts tests/services/service-catalog.own-create.test.ts`
Expected: semua lulus (own-create 7 test).

- [ ] **Step 6: Commit**

```bash
git add src/services/service-catalog/scope.ts src/services/service-catalog/own-create.ts tests/services/service-catalog.scope.test.ts tests/services/service-catalog.own-create.test.ts
git commit -m "feat(services): aturan psikolog menambah layanan untuk dirinya sendiri

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/v1/services` menerima psikolog

**Files:**
- Modify: `src/app/api/v1/services/route.ts` (fungsi `POST` dan import)
- Modify: `tests/integration/services/collection-route.test.ts`

**Interfaces:**
- Consumes: `canCreate`, `resolveOwnCreateTarget`, `OwnCreateRefusal` (Task 3);
  `createService(input, clinicId: number, actorId: string)` yang sudah ada.
- Produces: kontrak HTTP sesuai tabel spec §B3, dibaca FE Task 7.

- [ ] **Step 1: Ubah mock dan tulis test yang gagal**

Di `tests/integration/services/collection-route.test.ts`:

1. Ganti blok mock `scope`, lalu tambahkan mock `own-create` tepat di bawahnya:

```ts
const scope = vi.hoisted(() => ({ scopeForRequest: vi.fn(), canWrite: vi.fn(), canCreate: vi.fn() }));
vi.mock('@/services/service-catalog/scope', async (orig) => ({
  ...(await orig<any>()),
  ...scope,
}));

const own = vi.hoisted(() => ({ resolveOwnCreateTarget: vi.fn() }));
vi.mock('@/services/service-catalog/own-create', () => own);
```

2. Di `beforeEach`, tambahkan di samping reset yang lain:

```ts
  scope.canCreate.mockReset();
  own.resolveOwnCreateTarget.mockReset();
  scope.canCreate.mockReturnValue(true);
```

3. Test `'refuses a role that cannot write with 403'` diganti menjadi:

```ts
  it('refuses a role that cannot create with 403', async () => {
    scope.canCreate.mockReturnValue(false);

    const res = await POST(post(validBody));

    expect(res.status).toBe(403);
    expect(svc.createService).not.toHaveBeenCalled();
  });
```

4. Tambahkan `describe` baru di akhir file:

```ts
describe('POST /api/v1/services — a psychologist adding for themselves', () => {
  const SELF = 34n;

  beforeEach(() => {
    auth.actor = { id: 'doc-34', role: 'PROFESSIONAL', practiceId: null };
    scope.scopeForRequest.mockResolvedValue({ scope: { clinicId: null, doctorId: SELF, empty: false } });
  });

  it('creates at the resolved clinic with themselves as the only professional', async () => {
    own.resolveOwnCreateTarget.mockResolvedValue({ clinicId: 4 });

    const res = await POST(post({ ...validBody, doctorIds: [34] }));

    expect(res.status).toBe(201);
    expect(own.resolveOwnCreateTarget).toHaveBeenCalledWith({ self: SELF, doctorIds: [34], clinicId: undefined });
    expect(svc.createService).toHaveBeenCalledWith(
      expect.objectContaining({ doctorIds: [34] }),
      4,
      'doc-34',
    );
  });

  it('passes a named clinic on to the resolver', async () => {
    own.resolveOwnCreateTarget.mockResolvedValue({ clinicId: 44 });

    await POST(post({ ...validBody, doctorIds: [34], clinicId: 44 }));

    expect(own.resolveOwnCreateTarget).toHaveBeenCalledWith({ self: SELF, doctorIds: [34], clinicId: 44 });
    expect(svc.createService).toHaveBeenCalledWith(expect.any(Object), 44, 'doc-34');
  });

  it.each([
    ['not_self', 403, 'Psychologists can only add services for themselves'],
    ['no_clinic', 403, 'Professional is not assigned to an active clinic'],
    ['clinic_not_yours', 403, 'Not a clinic this professional practises at'],
  ])('maps %s to %i', async (refusal, status, message) => {
    own.resolveOwnCreateTarget.mockResolvedValue({ refusal });

    const res = await POST(post({ ...validBody, doctorIds: [34] }));

    expect(res.status).toBe(status);
    expect(JSON.stringify(await res.json())).toContain(message);
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('asks for a clinic with 422 clinic_required when they practise at several', async () => {
    own.resolveOwnCreateTarget.mockResolvedValue({ refusal: 'clinic_required' });

    const res = await POST(post({ ...validBody, doctorIds: [34] }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('clinic_required');
    expect(body.fields).toHaveProperty('clinicId');
    expect(svc.createService).not.toHaveBeenCalled();
  });

  it('fails closed when the scope carries no doctor id', async () => {
    scope.scopeForRequest.mockResolvedValue({ scope: { clinicId: null, doctorId: null, empty: false } });

    const res = await POST(post({ ...validBody, doctorIds: [34] }));

    expect(res.status).toBe(403);
    expect(own.resolveOwnCreateTarget).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/services/collection-route.test.ts`
Expected: FAIL. Route masih memakai `canWrite`, yang di mock bernilai `true`. Akibatnya:
- `refuses a role that cannot create` mendapat 201, bukan 403;
- test psikolog mendapat 422 `clinic_required`, karena `scope.clinicId` null dan body tanpa
  `clinicId`, atau `resolveOwnCreateTarget` tidak pernah dipanggil.

- [ ] **Step 3: Implementasi**

Di `src/app/api/v1/services/route.ts`:

1. Import scope dan own-create:

```ts
import { scopeForRequest, canCreate } from '@/services/service-catalog/scope';
import { resolveOwnCreateTarget, type OwnCreateRefusal } from '@/services/service-catalog/own-create';
```

(`canWrite` tidak lagi dipakai file ini. Hapus dari import supaya lint tidak mengeluh.)

2. Komentar kepala file, baris POST, menjadi:

```ts
 * POST /api/v1/services — create one, with a mapping per psychologist. A psychologist may
 *                         create for themselves only (see own-create.ts).
```

3. Di atas `export const POST`, tambahkan:

```ts
/** A psychologist's refused create, as the response to send. */
function ownCreateRefusal(refusal: OwnCreateRefusal): NextResponse {
  if (refusal === 'clinic_required') {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['Pick one of the clinics you practise at'],
      }),
      { status: 422 },
    );
  }
  const message = {
    not_self: 'Psychologists can only add services for themselves',
    no_clinic: 'Professional is not assigned to an active clinic',
    clinic_not_yours: 'Not a clinic this professional practises at',
  }[refusal];
  return NextResponse.json(forbidden(message), { status: 403 });
}
```

4. Di `POST`, blok pertama menjadi:

```ts
  if (!canCreate(actor.role)) {
    return NextResponse.json(
      forbidden('Only Super Admin, Clinic Admin and psychologists for themselves can create services'),
      { status: 403 },
    );
  }
```

5. Di `POST`, ganti bagian dari `const clinicId = scoped.scope.clinicId ?? (parsed.data.clinicId ?? null);`
sampai sebelum `try {` dengan:

```ts
  let input = parsed.data;
  let clinicId: number | null;
  if (actor.role === 'PROFESSIONAL') {
    // readScopeFor pins a PROFESSIONAL to doctorId = their wp user, taken from the token.
    // Without it there is no "themselves" to create for, so refuse rather than guess.
    const self = scoped.scope.doctorId;
    if (self === null) {
      return NextResponse.json(forbidden('Professional is not linked to a WordPress account'), {
        status: 403,
      });
    }
    const target = await resolveOwnCreateTarget({ self, doctorIds: input.doctorIds, clinicId: input.clinicId });
    if ('refusal' in target) return ownCreateRefusal(target.refusal);
    clinicId = target.clinicId;
    // De-duplicated to exactly themselves: `[34, 34]` passed the check above.
    input = { ...input, doctorIds: [Number(self)] };
  } else {
    // A clinic admin is pinned to their own clinic whatever the body says. A super admin has
    // no clinic of their own, so they must name one.
    const scopedClinic = scoped.scope.clinicId;
    clinicId = scopedClinic !== null ? Number(scopedClinic) : (input.clinicId ?? null);
  }
  if (clinicId === null) {
    return NextResponse.json(
      validationError('clinic_required', 'clinicId is required', undefined, {
        clinicId: ['clinicId is required for this role'],
      }),
      { status: 422 },
    );
  }
```

6. Di blok `try`, pemanggilan `createService` menjadi:

```ts
    const created = await createService(input, clinicId, actor.id);
```

Komentar lama "A clinic admin is pinned to their own clinic whatever the body says…" di atas
`scopeForRequest` dihapus, karena sudah pindah ke cabang `else` di atas. Komentar tentang
"An empty scope …" dan pemeriksaan `scoped.scope.empty` tetap di tempatnya.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npx vitest run tests/integration/services/collection-route.test.ts`
Expected: semua lulus, termasuk test lama: admin diabaikan clinicId-nya, SUPER_ADMIN memilih,
dan 409/400/422 dipetakan.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/services/route.ts tests/integration/services/collection-route.test.ts
git commit -m "feat(services): psikolog boleh menambah layanannya sendiri

POST /api/v1/services menerima PROFESSIONAL lewat canCreate(). doctorIds
harus dirinya sendiri (selain itu 403), klinik harus klinik aktif tempat
ia praktik (403), dan psikolog dengan beberapa klinik wajib memilih
(422 clinic_required). DELETE tetap khusus admin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dokumen API, full suite, push BE

**Files:**
- Modify: `docs/api/SERVICES-CRUD-GUIDE.md` (§3, §6, §12)
- Modify: `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (bagian "Mode pemilik (PROFESSIONAL)")

- [ ] **Step 1: `SERVICES-CRUD-GUIDE.md` §3**

Baris tabel `PROFESSIONAL` menjadi:

```markdown
| `PROFESSIONAL` | **baris miliknya sendiri**, lintas klinik | ✏️ `POST` untuk dirinya sendiri, `PUT` baris miliknya sendiri |
```

Butir 4 menjadi:

```markdown
4. **Psikolog boleh menambah dan mengubah, tidak boleh menghapus.** `PUT` dari `PROFESSIONAL`
   (sejak 2026-10-15) diterima untuk baris miliknya sendiri; baris psikolog lain dijawab `404`
   lewat aturan nomor 2. `POST` (sejak 2026-10-19) diterima hanya untuk dirinya sendiri, di
   klinik aktif tempat ia praktik — lihat §6. `DELETE` tetap `403` untuknya.
```

- [ ] **Step 2: `SERVICES-CRUD-GUIDE.md` §6**

Kalimat "Hanya `SUPER_ADMIN` dan `CLINIC_ADMIN`." diganti dengan:

```markdown
`SUPER_ADMIN`, `CLINIC_ADMIN`, dan `PROFESSIONAL` untuk dirinya sendiri.

**Untuk `PROFESSIONAL`** (sejak 2026-10-19):

- `doctorIds` harus berisi dirinya sendiri saja (wp user id-nya, sama dengan
  `user.wpUserId` di `/auth/me`). Ada id lain → `403`.
- `clinicId` boleh tidak dikirim kalau ia hanya praktik di satu klinik aktif. Kalau lebih,
  wajib salah satu dari `user.practiceClinics` di `/auth/me`. Kosong → `422 clinic_required`;
  klinik lain → `403`.
- Psikolog tanpa klinik aktif sama sekali → `403`.
- Layanannya langsung berlaku seperti buatan admin (tidak ada persetujuan).
```

- [ ] **Step 3: `SERVICES-CRUD-GUIDE.md` §12**

Baris `403` dan `422 clinic_required` di tabel diganti:

```markdown
| `403` | — | peran tidak boleh menulis, aktor tidak punya klinik, atau psikolog menyebut psikolog/klinik selain miliknya |
```

```markdown
| `422` | `clinic_required` | `SUPER_ADMIN` tidak menyebut `clinicId`, atau `PROFESSIONAL` dengan beberapa klinik aktif tidak memilih |
```

- [ ] **Step 4: `PRACTICES-AND-SERVICES-GUIDE.md`**

Tepat sebelum heading `### Mode pemilik (PROFESSIONAL)`, sisipkan:

```markdown
### Klinik praktik (PROFESSIONAL)

`/auth/me` dan respons login untuk psikolog membawa `user.practiceClinics`: setiap klinik
**aktif** tempat ia dipetakan, `[{ "id": 4, "name": "AzaniDianda.com" }]`, urut id naik.
Selalu berupa larik (boleh kosong); role lain tidak membawa field ini. Inilah pilihan klinik
saat psikolog menambah layanannya sendiri (`POST /api/v1/services`). Berbeda dari
`ownedClinics`, daftar ini tidak memberi akses admin apa pun.
```

- [ ] **Step 5: Full suite + tsc**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: tsc tanpa error; seluruh suite lulus. Catat jumlahnya untuk laporan. Kegagalan di
luar file yang disentuh: jalankan file itu di `origin/main` (worktree lain) untuk memastikan
kegagalannya sudah ada sebelumnya, dan laporkan, jangan diperbaiki diam-diam.

- [ ] **Step 6: Commit dan push**

```bash
git add docs/api/SERVICES-CRUD-GUIDE.md docs/api/PRACTICES-AND-SERVICES-GUIDE.md
git commit -m "docs(api): psikolog menambah layanan sendiri dan practiceClinics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/psikolog-tambah-layanan
```

Push memakai kunci SSH khusus repo (lihat `~/.ssh/config`). Kalau ditolak dengan
"Permission denied", jangan coba kunci lain; laporkan.

---

### Task 6: FE — `practiceClinics` di sesi

**Files:**
- Modify: `app/Http/Controllers/AuthController.php`
- Create: `tests/Feature/KlinikPraktikProfilTest.php`

**Interfaces:**
- Consumes: `user.practiceClinics: {id:number,name:string}[]` dari `/auth/login` dan `/auth/me` (Task 2).
- Produces: profil sesi psikolog `practiceClinics: list<array{id:int,name:string}>` dan
  `public static function klinikPraktikSesi(): array` (`[]` untuk role lain atau sesi tanpa
  daftar). Dipakai Task 7 dan Task 8.

- [ ] **Step 1: Tulis test yang gagal**

`tests/Feature/KlinikPraktikProfilTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

// Klinik praktik psikolog (`practiceClinics` dari backend): pilihan klinik saat
// psikolog menambah layanannya sendiri. Disimpan bersama ownedClinics, dan
// disegarkan oleh mekanisme yang sama (segarkanKlinikPemilik, umur 5 menit).
class KlinikPraktikProfilTest extends TestCase
{
    private function sesi(array $extra = []): void
    {
        Session::put(PraktiquApi::TOKEN_KEY, 'tok');
        Session::put(PraktiquApi::PROFILE_KEY, array_merge(
            ['v' => AuthController::PROFILE_VERSION, 'role' => 'psikolog', 'name' => 'Dr A', 'professionalId' => 34],
            $extra,
        ));
    }

    public function test_login_menyimpan_klinik_praktik_dan_membuang_baris_rusak(): void
    {
        Http::fake([
            '*/api/v1/auth/login' => Http::response(['accessToken' => 'tok', 'user' => ['id' => 'u1', 'role' => 'PROFESSIONAL', 'wpUserId' => 34, 'email' => 'a@x.co']]),
            '*/api/v1/auth/me' => Http::response(['user' => ['id' => 'u1', 'role' => 'PROFESSIONAL', 'wpUserId' => 34, 'email' => 'a@x.co', 'displayName' => 'Dr A',
                'ownedClinics' => [],
                'practiceClinics' => [['id' => 4, 'name' => 'Klinik A'], ['id' => 'x'], ['id' => '44', 'name' => '']]]]),
        ]);

        $this->post('/professional/login', ['email' => 'a@x.co', 'password' => 'rahasia123']);

        $this->assertSame(
            [['id' => 4, 'name' => 'Klinik A'], ['id' => 44, 'name' => 'Klinik #44']],
            Session::get(PraktiquApi::PROFILE_KEY.'.practiceClinics'),
        );
    }

    public function test_daftar_basi_disegarkan_bersama_klinik_milik(): void
    {
        $this->sesi(['ownedClinics' => [], 'ownedClinicsAt' => time() - 301, 'practiceClinics' => [['id' => 4, 'name' => 'Klinik A']]]);
        Http::fake(['*/api/v1/auth/me' => Http::response(['user' => ['role' => 'PROFESSIONAL', 'ownedClinics' => [],
            'practiceClinics' => [['id' => 4, 'name' => 'Klinik A'], ['id' => 9, 'name' => 'Klinik Baru']]]])]);

        AuthController::segarkanKlinikPemilik(app(PraktiquApi::class));

        $this->assertSame([4, 9], array_column(AuthController::klinikPraktikSesi(), 'id'));
    }

    public function test_backend_lama_tanpa_field_menghasilkan_daftar_kosong(): void
    {
        $this->sesi(['ownedClinics' => [], 'ownedClinicsAt' => time() - 301]);
        Http::fake(['*/api/v1/auth/me' => Http::response(['user' => ['role' => 'PROFESSIONAL', 'ownedClinics' => []]])]);

        AuthController::segarkanKlinikPemilik(app(PraktiquApi::class));

        $this->assertSame([], AuthController::klinikPraktikSesi());
    }

    public function test_role_lain_tidak_punya_klinik_praktik(): void
    {
        $this->sesi(['role' => 'admin', 'practiceClinics' => [['id' => 4, 'name' => 'Klinik A']]]);

        $this->assertSame([], AuthController::klinikPraktikSesi());
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `PHPUNIT --filter KlinikPraktikProfilTest`
Expected: FAIL. `klinikPraktikSesi` tidak ada, dan `practiceClinics` tidak tersimpan.

- [ ] **Step 3: Implementasi**

Di `app/Http/Controllers/AuthController.php`:

1. Tepat di bawah fungsi `klinikPemilikDari()`:

```php
    // Klinik tempat psikolog PRAKTIK (`practiceClinics` dari /auth/me) — pilihan
    // klinik saat ia menambah layanannya sendiri (ServiceController::store).
    // Berbeda dari ownedClinics: daftar ini tidak membuka akses admin apa pun.
    // Baris yang bentuknya tidak sah dibuang satu per satu. null = backend
    // tidak mengirim daftar sama sekali (backend sebelum 2026-10-19).
    private static function klinikPraktikDari(?array $u): ?array
    {
        $raw = $u['practiceClinics'] ?? null;
        if (! is_array($raw) || ! array_is_list($raw)) {
            return null;
        }

        $out = [];
        foreach ($raw as $c) {
            $id = is_array($c) ? ($c['id'] ?? null) : null;
            if (is_string($id) && ctype_digit($id)) {
                $id = (int) $id;
            }
            if (! is_int($id) || $id <= 0) {
                continue;
            }
            $nama = trim((string) ($c['name'] ?? ''));
            $out[] = ['id' => $id, 'name' => $nama !== '' ? $nama : 'Klinik #'.$id];
        }

        return $out;
    }

    /** Klinik praktik psikolog di sesi ini; [] untuk role lain atau sesi tanpa daftar. */
    public static function klinikPraktikSesi(): array
    {
        $p = self::validProfile();
        if (($p['role'] ?? null) !== 'psikolog' || ! is_array($p['practiceClinics'] ?? null)) {
            return [];
        }

        return $p['practiceClinics'];
    }
```

2. Di `segarkanKlinikPemilik()`, tepat setelah
`$p['ownedClinics'] = self::klinikPemilikDari(is_array($u) ? $u : null) ?? [];`:

```php
        $p['practiceClinics'] = self::klinikPraktikDari(is_array($u) ? $u : null) ?? [];
```

3. Di login, di dalam blok `if ($profile['role'] === 'psikolog') {`, tepat setelah
`$profile['ownedClinicsAt'] = time();`:

```php
            $profile['practiceClinics'] = self::klinikPraktikDari(is_array($meUser) && $this->roleOf($meUser) !== null ? $meUser : $user) ?? [];
```

Komentar dok `segarkanKlinikPemilik()` ditambah satu kalimat di akhir: "practiceClinics ikut
disegarkan di panggilan yang sama."

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `PHPUNIT --filter 'KlinikPraktikProfilTest|ModePemilikProfilTest'`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/AuthController.php tests/Feature/KlinikPraktikProfilTest.php
git commit -m "feat(auth): klinik praktik psikolog disimpan di sesi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: FE — `ServiceController::store` untuk psikolog

**Files:**
- Modify: `app/Http/Controllers/ServiceController.php`
- Modify: `tests/Feature/ServiceCrudTest.php`

**Interfaces:**
- Consumes: `AuthController::klinikPraktikSesi(): array` (Task 6); profil sesi `professionalId`;
  kontrak BE Task 4.
- Produces: `POST /dashboard/layanan` menerima psikolog. Body yang dibaca: `name`,
  `categoryId`, `duration`, `price`, `mode`, `active`, dan `clinicId` (opsional). `doctors`
  diabaikan untuk psikolog. Dipakai Task 8.

- [ ] **Step 1: Tulis test yang gagal**

Di `tests/Feature/ServiceCrudTest.php`, ganti `test_psikolog_tidak_boleh_menambah_atau_menghapus_layanan`
dengan test-test berikut:

```php
    public function test_psikolog_tidak_boleh_menghapus_layanan(): void
    {
        Http::fake(fn () => Http::response([]));

        $this->withSession($this->staf('psikolog', ['professionalId' => 34]))
            ->deleteJson('/dashboard/layanan/9')
            ->assertStatus(403)
            ->assertJsonPath('message', 'Hanya Super Admin dan Admin Klinik yang boleh menghapus layanan.');

        Http::assertNothingSent();
    }

    /**
     * Psikolog menambah layanan untuk DIRINYA SENDIRI.
     *
     * doctorIds diambil dari sesi, bukan dari form — psikolog lain yang
     * disebut di request tidak pernah sampai ke backend. Backend tetap
     * memeriksa ulang (403 kalau doctorIds bukan dirinya).
     */
    public function test_psikolog_menambah_layanan_atas_namanya_sendiri(): void
    {
        Http::fake(['*/api/v1/services' => Http::response(['data' => ['id' => 99]])]);

        $this->withSession($this->staf('psikolog', [
            'professionalId' => 34,
            'practiceClinics' => [['id' => 4, 'name' => 'AzaniDianda.com']],
        ]))
            ->postJson('/dashboard/layanan', $this->isi(['doctors' => [35, 36], 'clinicId' => '']))
            ->assertOk()->assertJsonPath('message', 'Layanan ditambahkan.');

        Http::assertSent(function (Request $r) {
            $b = $this->badan($r);

            return $r->method() === 'POST' && $b['doctorIds'] === [34] && $b['clinicId'] === 4;
        });
    }

    public function test_psikolog_dengan_dua_klinik_mengirim_klinik_pilihannya(): void
    {
        Http::fake(['*/api/v1/services' => Http::response(['data' => []])]);

        $this->withSession($this->staf('psikolog', [
            'professionalId' => 26,
            'practiceClinics' => [['id' => 5, 'name' => 'Klinik A'], ['id' => 44, 'name' => 'Klinik B']],
        ]))
            ->postJson('/dashboard/layanan', $this->isi(['clinicId' => '44']))
            ->assertOk();

        Http::assertSent(fn (Request $r) => $this->badan($r)['clinicId'] === 44 && $this->badan($r)['doctorIds'] === [26]);
    }

    public function test_psikolog_dengan_dua_klinik_tanpa_pilihan_ditolak_sebelum_dikirim(): void
    {
        Http::fake(fn () => Http::response([]));

        $this->withSession($this->staf('psikolog', [
            'professionalId' => 26,
            'practiceClinics' => [['id' => 5, 'name' => 'Klinik A'], ['id' => 44, 'name' => 'Klinik B']],
        ]))
            ->postJson('/dashboard/layanan', $this->isi(['clinicId' => '']))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Pilih dulu klinik tempat layanan ini berlaku.');

        Http::assertNothingSent();
    }

    /** Sesi sebelum fitur ini belum membawa practiceClinics: backend yang memutuskan. */
    public function test_psikolog_tanpa_daftar_klinik_di_sesi_menyerahkan_klinik_ke_backend(): void
    {
        Http::fake(['*/api/v1/services' => Http::response(['data' => []])]);

        $this->withSession($this->staf('psikolog', ['professionalId' => 34]))
            ->postJson('/dashboard/layanan', $this->isi(['clinicId' => '']))
            ->assertOk();

        Http::assertSent(fn (Request $r) => ! array_key_exists('clinicId', $this->badan($r)) && $this->badan($r)['doctorIds'] === [34]);
    }

    public function test_psikolog_tanpa_id_profesional_ditolak(): void
    {
        Http::fake(fn () => Http::response([]));

        $this->withSession($this->staf('psikolog'))
            ->postJson('/dashboard/layanan', $this->isi())
            ->assertStatus(403);

        Http::assertNothingSent();
    }

    public function test_psikolog_tidak_wajib_memilih_psikolog(): void
    {
        Http::fake(['*/api/v1/services' => Http::response(['data' => []])]);

        $isi = $this->isi();
        unset($isi['doctors']);

        $this->withSession($this->staf('psikolog', ['professionalId' => 34, 'practiceClinics' => [['id' => 4, 'name' => 'K']]]))
            ->postJson('/dashboard/layanan', $isi)
            ->assertOk();
    }
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `PHPUNIT --filter ServiceCrudTest`
Expected: FAIL. Test psikolog `store` mendapat 403, dan pesan hapus belum cocok.

- [ ] **Step 3: Implementasi**

Di `app/Http/Controllers/ServiceController.php`:

1. Komentar dok `penulis()` diganti:

```php
    /**
     * Peran yang boleh menulis layanan.
     *
     * Menghapus: super & admin saja. Menambah dan mengubah: psikolog juga,
     * tapi hanya untuk dirinya sendiri — mengubah dijaga backend (PUT dari
     * PROFESSIONAL menjawab 404 untuk baris psikolog lain), menambah dijaga
     * di sini (doctorIds dari sesi, lihat store()) DAN di backend (403 kalau
     * doctorIds atau kliniknya bukan miliknya).
     */
```

2. `store()` diganti seluruhnya:

```php
    /** POST /dashboard/layanan */
    public function store(Request $request): JsonResponse
    {
        $profile = $this->penulis(psikologBoleh: true);
        if (! $profile) {
            return $this->tolak();
        }
        $psikolog = ($profile['role'] ?? null) === 'psikolog';

        $data = $this->validasi($request, psikolog: $psikolog);

        if ($psikolog) {
            // Atas nama dirinya sendiri, dari sesi — `doctors` di request tidak
            // ikut divalidasi, jadi tidak pernah sampai ke sini.
            $proId = $profile['professionalId'] ?? null;
            if (! is_numeric($proId)) {
                return response()->json([
                    'message' => 'Akun psikolog Anda belum terhubung ke data psikolog. Hubungi admin.',
                ], 403);
            }
            $data['doctors'] = [(int) $proId];
            $clinicId = $this->klinikPsikolog($data);
        } else {
            $clinicId = $this->klinik($profile, $data);
        }

        if ($clinicId === false || (! $psikolog && $clinicId === null)) {
            return response()->json([
                'message' => 'Pilih dulu klinik tempat layanan ini berlaku.',
            ], 422);
        }

        return $this->teruskan(
            fn () => $this->api->post('api/v1/services', $this->payload($data, $clinicId)),
            'Layanan ditambahkan.',
        );
    }
```

3. `destroy()`: `return $this->tolak();` menjadi
`return $this->tolak('Hanya Super Admin dan Admin Klinik yang boleh menghapus layanan.');`.

4. `validasi()` diganti tanda tangan dan blok awalnya:

```php
    private function validasi(Request $request, bool $baru = true, bool $psikolog = false): array
    {
        // Wajib saat admin membuat: layanan tanpa psikolog tidak muncul di
        // halaman booking mana pun (lihat catatan kelas). Psikolog tidak
        // memilih — ia selalu menambah untuk dirinya sendiri, dari sesi.
        $aturanBaru = ! $baru ? [] : ['clinicId' => ['nullable', 'string', 'max:40']] + ($psikolog ? [] : [
            'doctors' => ['required', 'array', 'min:1'],
            'doctors.*' => ['required', 'integer'],
        ]);

        return $request->validate($aturanBaru + [
```

Sisa `validasi()` tidak berubah: aturan `name` dst. dan pesan-pesannya.

5. Di bawah `klinik()`, tambahkan:

```php
    /**
     * Klinik untuk layanan baru seorang psikolog.
     *
     * Yang dipilih di form kalau ada, kalau tidak, satu-satunya klinik
     * praktiknya. null = sesi belum membawa practiceClinics (login sebelum
     * fitur ini, paling lama 5 menit) — clinicId tidak dikirim dan backend
     * yang memutuskan. false = ada beberapa klinik dan belum dipilih.
     * Apakah klinik pilihannya memang miliknya, backend yang memeriksa (403).
     */
    private function klinikPsikolog(array $data): string|null|false
    {
        $pilihan = $data['clinicId'] ?? null;
        if ($pilihan !== null && $pilihan !== '') {
            return (string) $pilihan;
        }

        $klinik = AuthController::klinikPraktikSesi();
        if (count($klinik) === 1) {
            return (string) $klinik[0]['id'];
        }

        return $klinik === [] ? null : false;
    }
```

6. `tolak()` diganti:

```php
    private function tolak(string $pesan = 'Peran Anda tidak boleh mengubah layanan klinik ini.'): JsonResponse
    {
        return response()->json(['message' => $pesan], 403);
    }
```

7. Komentar dok `payload()`, baris tentang `clinicId` ("Diabaikan backend untuk admin klinik …
dan wajib untuk super admin."), ditambah: "Untuk psikolog: klinik praktik pilihannya, atau
tidak dikirim sama sekali (lihat klinikPsikolog)."

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `PHPUNIT --filter ServiceCrudTest`
Expected: `OK`. Semua test admin/super lama tetap lulus.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/ServiceController.php tests/Feature/ServiceCrudTest.php
git commit -m "feat(layanan): psikolog bisa menambah layanannya sendiri

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: FE — tombol dan form untuk psikolog, full suite, push

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php` (`render()`, array `payload`)
- Modify: `resources/views/dashboard.blade.php`
- Modify: `tests/Feature/ModePemilikDashboardTest.php`, `tests/Feature/DeadFeatureAuditTest.php`

**Interfaces:**
- Consumes: `AuthController::klinikPraktikSesi()` (Task 6); `POST /dashboard/layanan` (Task 7).
- Produces: payload `klinikPraktik: list<{id:int,name:string}>`, berisi daftar hanya untuk
  psikolog di mode "Praktik saya" dan `[]` di kasus lain. State Alpine `klinikPraktik`.

- [ ] **Step 1: Tulis test yang gagal**

1. `tests/Feature/ModePemilikDashboardTest.php`, di `test_peran_ui_dipakai_untuk_tombol_operasional`,
baris `SERVICE_CREATE_ENABLED && peranUi !== 'psikolog'` diganti:

```php
        // Add Service kini juga untuk psikolog (layanannya sendiri) — tidak lagi digerbang peranUi.
        $this->assertStringContainsString("x-show=\"SERVICE_CREATE_ENABLED && (role !== 'super' || svcClinic)\"", $view);
```

Lalu tambahkan dua test di kelas yang sama:

```php
    public function test_psikolog_mendapat_klinik_praktik_di_payload(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi(['practiceClinics' => [['id' => 4, 'name' => 'Klinik Pamela'], ['id' => 44, 'name' => 'Klinik B']]]))
            ->get('/psikolog')->assertOk();

        $this->assertSame([['id' => 4, 'name' => 'Klinik Pamela'], ['id' => 44, 'name' => 'Klinik B']], $this->payload($res)['klinikPraktik']);
    }

    public function test_mode_pemilik_tidak_membawa_klinik_praktik(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi(['ownerClinicId' => 4, 'practiceClinics' => [['id' => 4, 'name' => 'Klinik Pamela']]]))
            ->get('/psikolog')->assertOk();

        $this->assertSame([], $this->payload($res)['klinikPraktik']);
    }
```

2. `tests/Feature/DeadFeatureAuditTest.php`: ganti seluruh method
`test_a_psychologist_may_edit_but_not_add_or_delete_services` (beserta docblock-nya) dengan
versi berikut. Bagian regex Hapus dipertahankan persis seperti aslinya.

```php
    /**
     * Psikolog diberi tombol Tambah dan Ubah untuk layanannya sendiri, tapi
     * tidak Hapus.
     *
     * Bukan cuma soal layar: ServiceController mengisi doctorIds psikolog dari
     * sesi, dan backend menolak (403) layanan untuk psikolog atau klinik lain.
     * Hapus tetap milik admin — tombol yang pasti ditolak lebih buruk daripada
     * tidak ada tombol.
     */
    public function test_a_psychologist_may_add_and_edit_but_not_delete_services(): void
    {
        $view = file_get_contents(resource_path('views/dashboard.blade.php'));

        $this->assertStringContainsString(
            "x-show=\"SERVICE_CREATE_ENABLED && (role !== 'super' || svcClinic)\"",
            $view,
        );
        $this->assertStringNotContainsString("SERVICE_CREATE_ENABLED && peranUi !== 'psikolog'", $view);
        // Psikolog tidak memilih psikolog: rosternya tidak dimuat untuknya.
        $this->assertStringContainsString('if (!r && this.peranUi !== "psikolog") this.muatPsikologKlinik', $view);
        // Baris Ubah/Hapus terbuka untuk semua peran yang barisnya membawa id…
        $this->assertStringContainsString('x-if="svcDapatDiubah && r.id"', $view);
        // …tapi Hapus disembunyikan dari psikolog.
        $this->assertMatchesRegularExpression(
            '/<button x-show="peranUi !== \'psikolog\'"[^>]*\n?[^>]*@click="svcHapus = r\.id/',
            $view,
        );
    }
```

(Method aslinya berakhir tepat setelah regex Hapus. Tidak ada assert lain yang hilang.)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `PHPUNIT --filter 'ModePemilikDashboardTest|DeadFeatureAuditTest'`
Expected: FAIL. String x-show baru belum ada, dan `klinikPraktik` belum ada di payload.

- [ ] **Step 3: Payload `klinikPraktik`**

Di `DashboardController::render()`, di array `payload`, tepat setelah
`'modePemilik' => $modePemilik !== null,`:

```php
                // Klinik praktik psikolog: pilihan klinik saat ia menambah
                // layanannya sendiri (lihat ServiceController::store). Hanya di
                // mode "Praktik saya" — di mode Kelola ia bertindak sebagai
                // admin satu klinik, dan kliniknya sudah pasti.
                'klinikPraktik' => $role === 'psikolog' && $modePemilik === null ? AuthController::klinikPraktikSesi() : [],
```

- [ ] **Step 4: Blade — state dan tombol**

Di `resources/views/dashboard.blade.php`:

1. State Alpine. Pada baris yang berisi `modePemilik: !!payload.modePemilik, pesanMode: payload.pesanMode || "",`, tambahkan di akhir baris:

```js
    klinikPraktik: payload.klinikPraktik || [],
```

2. Tombol Add Service. Ganti `x-show="SERVICE_CREATE_ENABLED && peranUi !== 'psikolog' && (role !== 'super' || svcClinic)"` dengan:

```blade
x-show="SERVICE_CREATE_ENABLED && (role !== 'super' || svcClinic)"
```

Komentar Blade di atasnya ("Hanya untuk peran yang memang mengurus layanan …") ditambah
satu baris: `Psikolog juga — untuk layanannya sendiri (ServiceController::store).`

- [ ] **Step 5: Blade — JS form**

1. `bukaLayanan(r)`. Objek layanan baru (cabang `: { id: null, … }`) diganti:

```js
        : { id: null, name: "", categoryId: "", duration: 60, price: 0, mode: "offline", active: true, doctors: [],
            // Psikolog dengan satu klinik praktik: langsung terisi. Lebih dari
            // satu: dipilih di form. Peran lain tidak memakainya.
            clinicId: this.klinikPraktik.length === 1 ? String(this.klinikPraktik[0].id) : "" };
```

Baris `if (!r) this.muatPsikologKlinik(this.svcKlinikId, null);` menjadi:

```js
      if (!r && this.peranUi !== "psikolog") this.muatPsikologKlinik(this.svcKlinikId, null);
```

Komentar di atasnya, kalimat "Psikolog sendiri pun hanya bisa mengubah, dan roster klinik
bukan urusannya.", diganti dengan: "Psikolog selalu menambah untuk dirinya sendiri, jadi
roster klinik bukan urusannya."

2. Tepat di bawah `get svcPsikolog() { … },`, tambahkan:

```js
    // Nama klinik di kepala form: kartu klinik pilihan super, klinik baris
    // yang sedang diubah, atau klinik praktik psikolog yang terpilih.
    get svcNamaKlinik() {
      if (this.svcClinic) return this.svcClinic.name;
      if (this.svcForm.clinicName) return this.svcForm.clinicName;
      const k = this.klinikPraktik.find((c) => String(c.id) === String(this.svcForm.clinicId || ""));
      return k ? k.name : "Anda";
    },
    get svcBolehSimpan() {
      if (this.svcBusy) return false;
      if (this.svcForm.id) return true;
      if (this.peranUi === "psikolog") return this.klinikPraktik.length <= 1 || !!this.svcForm.clinicId;
      return this.svcForm.doctors.length > 0;
    },
```

3. Di `simpanLayanan()`, tepat setelah `if (ubah) delete badan.doctors;`, sebelum
`else if (this.role === "super" …`, ubah rantai menjadi:

```js
        if (ubah) { delete badan.doctors; delete badan.clinicId; }
        else if (this.role === "super" && this.svcClinic) badan.clinicId = String(this.svcClinic.id);
```

- [ ] **Step 6: Blade — markup form**

1. Kepala form: `x-text="svcClinic ? svcClinic.name : (svcForm.clinicName || 'Anda')"` menjadi
`x-text="svcNamaKlinik"`.

2. Blok pemilih psikolog `<div x-show="!svcForm.id">` (yang berisi "Ditawarkan oleh" dengan
tombol `svc-pick`) menjadi `<div x-show="!svcForm.id && peranUi !== 'psikolog'">`. Tepat
**setelah** penutup `</div>` blok itu, sisipkan:

```blade
            {{-- Psikolog menambah untuk dirinya sendiri: tidak memilih psikolog
                 (ServiceController::store mengisinya dari sesi). Klinik hanya
                 dipilih kalau ia praktik di lebih dari satu klinik aktif. --}}
            <div x-show="!svcForm.id && peranUi === 'psikolog'">
              <label class="lbl" style="margin-bottom:7px">Ditawarkan oleh</label>
              <div style="font-size:13px;font-weight:700;color:#1E2236" x-text="profile.name"></div>
              <div style="font-size:11.5px;color:#9499AE;margin-top:5px;line-height:1.5">
                Layanan yang Anda tambahkan selalu atas nama Anda sendiri.
              </div>
            </div>
            <div x-show="!svcForm.id && peranUi === 'psikolog' && klinikPraktik.length > 1">
              <label class="lbl" style="margin-bottom:7px">Klinik <span style="color:#E0594E">*</span></label>
              <select class="inp inp-blue" x-model="svcForm.clinicId" style="cursor:pointer">
                <option value="" disabled>— pilih klinik —</option>
                <template x-for="k in klinikPraktik" :key="k.id">
                  <option :value="String(k.id)" x-text="k.name"></option>
                </template>
              </select>
            </div>
```

3. Tombol submit: `:disabled="svcBusy || (!svcForm.id && !svcForm.doctors.length)"` menjadi
`:disabled="!svcBolehSimpan"`.

- [ ] **Step 7: Jalankan test yang ditarget**

Run: `PHPUNIT --filter 'ModePemilikDashboardTest|DeadFeatureAuditTest|ServiceCrudTest|KlinikPraktikProfilTest|DashboardServicesTest'`
Expected: `OK`.

- [ ] **Step 8: Cek sintaks Blade + full suite**

Run: `PHPUNIT`
Expected: `OK`, seluruh suite. Catat jumlahnya. Saat rencana ditulis, tidak ada test lain yang
memeriksa string blade yang diganti (`svcForm.doctors.length`, `svcClinic ? svcClinic.name`,
`if (!r) this.muatPsikologKlinik`). Kalau ternyata ada yang gagal karena string itu, perbarui
assert-nya ke string baru, jangan dihapus.

- [ ] **Step 9: Uji di browser (lokal)**

Ikuti resep smoke test lokal FE: Docker network + stub backend + sesi palsu + Playwright,
sesuai catatan memori `fe-local-browser-smoke-test`. Tiga sesi yang perlu dibuat:
- psikolog `practiceClinics` 1 klinik;
- psikolog 2 klinik;
- admin.

Cek:
- (a) psikolog melihat Add Service;
- (b) form psikolog tidak menampilkan pemilih psikolog;
- (c) pemilih klinik muncul hanya untuk 2 klinik;
- (d) tombol Simpan mati sampai klinik dipilih;
- (e) admin tetap melihat pemilih psikolog.

Ambil screenshot form psikolog. Kalau resep itu tidak bisa dijalankan, catat sebagai "belum
diverifikasi di browser" di laporan, jangan diklaim lulus.

- [ ] **Step 10: Commit dan push**

```bash
git add app/Http/Controllers/DashboardController.php resources/views/dashboard.blade.php tests/Feature/ModePemilikDashboardTest.php tests/Feature/DeadFeatureAuditTest.php
git commit -m "feat(layanan): tombol Add Service dan form untuk psikolog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/psikolog-tambah-layanan
```

---

### Task 9: Serah terima

- [ ] **Step 1: Laporkan ke user**

Laporkan hal-hal berikut:
- kedua branch beserta commit terakhirnya;
- jumlah test BE dan FE;
- hasil uji browser, atau bahwa belum diuji.

Berikan dua tautan compare untuk membuka PR. `gh` tidak bisa dipakai, jadi PR dibuka manual:
- BE: `https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/psikolog-tambah-layanan?expand=1`
- FE: `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/psikolog-tambah-layanan?expand=1`

Urutan merge: **BE dulu**, tunggu Hostinger auto-deploy (~1,5 menit, cek log deploy menyebut
commit merge-nya), **baru FE**.

- [ ] **Step 2: Uji coba setelah live (oleh user)**

1. Login sebagai psikolog di mode "Praktik saya".
2. Tambah 1 layanan berstatus **Nonaktif**.
3. Cek kartunya muncul atas nama psikolog itu.
4. Hapus layanan uji itu lewat akun admin klinik atau super admin.
