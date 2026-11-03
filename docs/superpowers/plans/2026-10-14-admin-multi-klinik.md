# Admin Multi-Klinik ("Klinik Aktif") — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seorang admin klinik (CLINIC_ADMIN) bisa memegang beberapa klinik, memilih satu klinik aktif lewat dropdown di dashboard, dan backend memvalidasi di setiap request bahwa klinik itu memang miliknya.

**Architecture:** FE Laravel mengirim header `X-Praktiqu-Clinic-Id` di setiap panggilan backend (satu titik: `PraktiquApi::dispatch()`). Backend memvalidasi header itu di `getActor()` (satu titik untuk semua route) dan menaruh hasilnya di `actor.activeClinicId`; `resolveKcActor()` memakainya sebagai `clinicId`, sehingga 146 pemanggil yang sudah ada otomatis ter-scope ke klinik aktif tanpa diubah. Daftar klinik admin berasal dari `wp_kc_clinics.clinic_admin_id`. Super admin menugaskan klinik ke admin lewat endpoint `change-admin` yang diperbaiki dan halaman baru di FE.

**Tech Stack:** Next.js 15 route handlers + Prisma (MySQL/MariaDB WordPress DB) + vitest; Laravel 12 + Blade + Alpine.js + PHPUnit (PHP 8.4 via Docker).

**Spec:** `docs/superpowers/specs/2026-10-13-admin-multi-klinik-design.md` (baca dulu bagian "Keputusan" dan "Kontrak ringkas").

## Global Constraints

Berlaku untuk SETIAP task:

- **Jangan pernah** menjalankan `prisma db push`, `prisma migrate dev/deploy/reset`. `DATABASE_URL` adalah database WordPress yang sama. Fitur ini **tidak menambah tabel atau kolom apa pun**. `npx prisma generate` juga tidak perlu (skema tidak berubah).
- Plugin WordPress `Wordpress-Plugin/praktiqu-endpoint` **tidak diubah**.
- Header klinik aktif: **`X-Praktiqu-Clinic-Id`**. Format sah: regex **`^[1-9][0-9]{0,18}$`**.
- Kode error (pesan `AuthError` = kodenya sendiri): **`invalid_clinic_header`** (HTTP 400) dan **`clinic_not_in_scope`** (HTTP 403).
- Header hanya berlaku untuk role JWT **`CLINIC_ADMIN`**. Role lain: header **diabaikan**, tanpa error.
- Daftar klinik admin = baris `wp_kc_clinics` dengan `clinic_admin_id = wpUserId`, **aktif (`status = 1`) dulu, lalu `id` naik**. Hanya bila admin tidak memiliki klinik sama sekali: cadangan dari `wp_kc_doctor_clinic_mappings` urut `id` mapping naik.
- `/auth/me` (dan login/register/OTP): `clinicId` = `clinics[0].id`; field `clinics` **hanya** untuk CLINIC_ADMIN.
- Akses di luar scope tetap **404** (konvensi repo). Akses pasien tetap **403 kode `forbidden`**.
- FE: `AuthController::PROFILE_VERSION` **tetap 5** (menaikkannya me-logout semua staf).
- Bahasa: komentar kode mengikuti file yang diubah (backend: Inggris, FE: Indonesia). Pesan untuk pengguna: Bahasa Indonesia. Pesan commit: Bahasa Indonesia, format conventional (`feat(auth): ...`).
- Commit hanya file yang disebut di task (`git add <path>`), **jangan `git add -A`**.
- Backend: repo `Alfzzz124/nextjs-appointment-praktiqu`, branch **`feat/multi-klinik`**, worktree **`/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/multi-klinik`**. Push dengan refspec eksplisit: `git push origin feat/multi-klinik:refs/heads/feat/multi-klinik` (key SSH sudah diatur lewat `core.sshCommand`).
- FE: repo `raakanaka/laravel-praktiqu`, branch **`feat/multi-klinik`** dari `origin/main`, worktree **`/home/ahmad/projects/praktiqu-fe/multi-klinik`**. `main` FE auto-deploy ke produksi: **hanya lewat branch + PR, jangan pernah push ke `main`**. Repo FE tidak punya git identity, jadi setiap commit FE memakai `git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit ...`.
- Tes backend: `npx vitest run <file>` dari worktree BE. DB uji = MySQL lokal di Docker (`praktiqu-mysql`); `DATABASE_URL` di `.env.test.local` **wajib mengandung "test"** (fixture menolak jalan kalau tidak).
- Tes FE: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit [--filter NamaTes]` dari worktree FE (Docker Desktop harus menyala).
- Rentang id uji backend (supaya file tes tidak saling menghapus data): Task B1 `8_650_000`, B2 `8_660_000`, B5 `8_670_000`, B6 `8_680_000`, B7 `8_690_000`, B8 `8_620_000` — masing-masing selebar 10.000. Task B4 memakai rentang tes yang sudah ada (`8_600_000`).

## Peta file

**Backend** (`/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/multi-klinik`)

| File | Status | Tanggung jawab |
|---|---|---|
| `src/services/billing/kc-actor.ts` | ubah | `listAdminClinicIds`, `listAdminClinics`, default per role, `resolveKcActor` memakai `activeClinicId` |
| `src/lib/auth/active-clinic.ts` | baru | Validasi header `X-Praktiqu-Clinic-Id` |
| `src/lib/auth.ts` | ubah | `Actor.activeClinicId`, `getActor()` memanggil validasi |
| `src/lib/auth/route-guards.ts`, `src/lib/auth/caller.ts`, `src/lib/auth/session-notes-caller.ts` | ubah | Teruskan status 400/403 dari `AuthError` |
| `src/services/auth/service.ts`, `src/services/auth/otp.service.ts` | ubah | `scopeClinics()` → `clinicId` + `clinics` |
| `src/repositories/wp/patients.repo.ts`, `src/services/client/client.service.ts` | ubah | Akses pasien = punya mapping ke klinik aktif |
| `src/repositories/wp/clinic-admins.repo.ts` | baru | `isClinicAdminUser`, `countOwnedClinics`, `listClinicAdmins` |
| `src/services/practice/service.ts` | ubah | `changePracticeAdmin` baru + `NotAClinicAdminError` |
| `src/app/api/v1/practices/[id]/change-admin/route.ts` | ubah | Endpoint diperbaiki |
| `src/app/api/v1/practices/clinic-admins/route.ts` | baru | Daftar akun admin klinik (super) |
| `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` | ubah | Dokumentasi kontrak |
| `tests/integration/auth/admin-clinics.test.ts` | baru | Tes B1 |
| `tests/integration/auth/active-clinic-header.test.ts` | baru | Tes B2 |
| `tests/lib/auth/auth-error-status.test.ts` | baru | Tes B3 |
| `tests/integration/auth/auth-me-clinic-id.test.ts` | ubah | Tes B4 |
| `tests/integration/practice/practice-active-clinic.test.ts` | baru | Tes B5 |
| `tests/integration/client/client-multi-clinic-access.test.ts` | baru | Tes B6 |
| `tests/integration/practice/change-admin.test.ts` | baru | Tes B7 |
| `tests/integration/practice/clinic-admins.test.ts` | baru | Tes B8 |
| `tests/payments/session-routes.test.ts` | ubah | Mock Prisma ikut bentuk query baru |

**FE** (`/home/ahmad/projects/praktiqu-fe/multi-klinik`)

| File | Status | Tanggung jawab |
|---|---|---|
| `app/Http/Controllers/AuthController.php` | ubah | `clinics` di profil, profil lama dibuang sebelum login |
| `app/Services/PraktiquApi.php` | ubah | `headerKlinikAktif()`, deteksi klinik ditolak |
| `app/Services/KlinikTidakBerlakuException.php` | baru | Exception "klinik aktif tidak berlaku lagi" |
| `bootstrap/app.php` | ubah | Render exception di atas; alias middleware `klinik.halaman` |
| `app/Http/Controllers/EncounterDocumentController.php` | ubah | Header klinik di jalur `Http::` mentah |
| `app/Http/Controllers/KlinikAktifController.php` | baru | `POST /dashboard/klinik-aktif` |
| `app/Http/Middleware/CocokKlinikHalaman.php` | baru | Guard dua tab (409) |
| `app/Http/Controllers/DashboardController.php` | ubah | Payload `practiceId`, data dropdown |
| `resources/views/dashboard.blade.php` | ubah | Dropdown, pembungkus `fetch`, banner tab basi, tautan "Admin klinik" |
| `resources/views/dashboard/partials/pilih-klinik.blade.php` | baru | Markup dropdown |
| `public/css/app.css` | ubah | Gaya dropdown |
| `app/Http/Controllers/KlinikAdminController.php` | baru | Halaman super admin "Admin klinik" |
| `resources/views/dashboard/klinik-admin.blade.php` | baru | View halaman di atas |
| `routes/web.php` | ubah | 4 route baru + middleware grup |
| `tests/Feature/KlinikAktifLoginTest.php`, `HeaderKlinikAktifTest.php`, `KlinikDicabutTest.php`, `GantiKlinikAktifTest.php`, `DropdownKlinikAktifTest.php`, `CocokKlinikHalamanTest.php`, `AdminKlinikSuperTest.php` | baru | Tes F1–F7 |

---

## Part 0 — Persiapan

### Task 0: Siapkan worktree backend dan pastikan tes dasar hijau

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Masuk ke worktree (buat kalau belum ada)**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu
git fetch origin
git worktree list | grep multi-klinik || git worktree add .claude/worktrees/multi-klinik feat/multi-klinik
cd .claude/worktrees/multi-klinik
git log --oneline -3
```

Expected: commit teratas adalah `docs(...)` untuk spec/rencana ini, di atas `82d17ce Merge pull request #26`.

- [ ] **Step 2: Sambungkan `node_modules` dan env tes**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/multi-klinik
test -e node_modules || ln -s /home/ahmad/projects/nextjs-appointment-praktiqu/node_modules node_modules
test -e .env.test.local || cp /home/ahmad/projects/nextjs-appointment-praktiqu/.env.test.local .env.test.local
grep -c 'DATABASE_URL=.*test' .env.test.local
git status --short
```

Expected: angka `1`; `git status --short` kosong (`/node_modules` sudah ada di `.git/info/exclude`, `.env.test.local` di `.gitignore`).

- [ ] **Step 3: Pastikan MySQL uji menyala**

```bash
docker ps --filter name=praktiqu-mysql --format '{{.Names}} {{.Status}}'
```

Expected: `praktiqu-mysql Up ...`. Kalau kosong: nyalakan Docker Desktop, lalu `docker start praktiqu-mysql`.

- [ ] **Step 4: Jalankan tes yang akan disentuh, sebelum mengubah apa pun**

```bash
npx vitest run tests/billing/kc-actor.test.ts tests/integration/auth/auth-me-clinic-id.test.ts tests/billing/practice-routes-scope.integration.test.ts tests/payments/session-routes.test.ts
```

Expected: semua PASS. Kalau ada yang gagal di sini, berhenti dan laporkan — itu bukan akibat perubahan kita.

---

## Part B — Backend (Next.js)

### Task B1: Daftar klinik milik admin di `kc-actor.ts`

**Files:**
- Modify: `src/services/billing/kc-actor.ts` (fungsi `resolveClinicId`, tambah dua fungsi baru)
- Modify: `tests/payments/session-routes.test.ts:7-20` dan `:183`
- Test (baru): `tests/integration/auth/admin-clinics.test.ts`

**Interfaces:**
- Produces:
  - `export interface AdminClinic { id: number; name: string; active: boolean }`
  - `export async function listAdminClinicIds(wpUserId: bigint): Promise<bigint[]>`
  - `export async function listAdminClinics(wpUserId: bigint): Promise<AdminClinic[]>` — urutan identik dengan `listAdminClinicIds`
  - `resolveClinicId(role, wpUserId)` — tanda tangan tidak berubah; CLINIC_ADMIN = elemen pertama `listAdminClinicIds`

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/integration/auth/admin-clinics.test.ts`:

```ts
/**
 * Which clinics a CLINIC_ADMIN may act in, and which one is their default.
 *
 * The source of truth is wp_kc_clinics.clinic_admin_id (KiviCare's own definition of
 * "admin of clinic X"). Doctor mappings are only a fallback for an admin who owns no
 * clinic at all, so accounts scoped that way before keep their access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { listAdminClinicIds, listAdminClinics, resolveClinicId } from '@/services/billing/kc-actor';

const BASE = 8_650_000;
const END = BASE + 10_000;

const OWNER = BASE + 500; // owns three clinics, and is also mapped as a doctor elsewhere
const MAPPED_ONLY = BASE + 501; // owns none, has two doctor mappings
const NOBODY = BASE + 502; // owns none, no mappings
const RECEPTIONIST = BASE + 503;
const DOCTOR = BASE + 504;
const SOMEONE_ELSE = BASE + 900;

const ACTIVE_LOW = BASE + 1;
const INACTIVE = BASE + 2;
const ACTIVE_HIGH = BASE + 3;
const MAPPED_1 = BASE + 4;
const MAPPED_2 = BASE + 5;

async function clinic(id: number, adminId: number, status: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', ?, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    status,
    adminId,
  );
}

async function doctorMapping(id: number, doctorId: number, clinicId: number) {
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(id), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcReceptionistClinicMapping.deleteMany({
    where: { receptionistId: { gte: BigInt(BASE), lt: BigInt(END) } },
  });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  // Inserted out of id order on purpose: the result must not depend on insertion order.
  await clinic(ACTIVE_HIGH, OWNER, 1);
  await clinic(INACTIVE, OWNER, 0);
  await clinic(ACTIVE_LOW, OWNER, 1);
  await clinic(MAPPED_1, SOMEONE_ELSE, 1);
  await clinic(MAPPED_2, SOMEONE_ELSE, 1);
  // MAPPED_ONLY's mapping ids put MAPPED_2 first.
  await doctorMapping(BASE + 10, MAPPED_ONLY, MAPPED_2);
  await doctorMapping(BASE + 11, MAPPED_ONLY, MAPPED_1);
  // OWNER is also mapped as a doctor at MAPPED_1. Ownership must win; the old resolver
  // read the doctor mapping first and so gave OWNER clinic MAPPED_1.
  await doctorMapping(BASE + 12, OWNER, MAPPED_1);
  await doctorMapping(BASE + 13, DOCTOR, MAPPED_2);
  await doctorMapping(BASE + 14, DOCTOR, MAPPED_1);
  await prisma.kcReceptionistClinicMapping.create({
    data: { id: BigInt(BASE + 20), receptionistId: BigInt(RECEPTIONIST), clinicId: BigInt(MAPPED_1), createdAt: new Date() },
  });
});

afterAll(async () => {
  await wipe();
});

describe('listAdminClinicIds', () => {
  it('lists owned clinics, active ones first, each group by id', async () => {
    expect(await listAdminClinicIds(BigInt(OWNER))).toEqual([
      BigInt(ACTIVE_LOW),
      BigInt(ACTIVE_HIGH),
      BigInt(INACTIVE),
    ]);
  });

  it('ignores doctor mappings when the admin owns a clinic', async () => {
    expect(await listAdminClinicIds(BigInt(OWNER))).not.toContain(BigInt(MAPPED_1));
  });

  it('falls back to doctor mappings, in mapping order, when the admin owns nothing', async () => {
    expect(await listAdminClinicIds(BigInt(MAPPED_ONLY))).toEqual([BigInt(MAPPED_2), BigInt(MAPPED_1)]);
  });

  it('is empty for an admin with neither', async () => {
    expect(await listAdminClinicIds(BigInt(NOBODY))).toEqual([]);
  });
});

describe('listAdminClinics', () => {
  it('has the same order as listAdminClinicIds, with names and the active flag', async () => {
    expect(await listAdminClinics(BigInt(OWNER))).toEqual([
      { id: ACTIVE_LOW, name: `Klinik ${ACTIVE_LOW}`, active: true },
      { id: ACTIVE_HIGH, name: `Klinik ${ACTIVE_HIGH}`, active: true },
      { id: INACTIVE, name: `Klinik ${INACTIVE}`, active: false },
    ]);
  });

  it('names the fallback clinics too', async () => {
    expect(await listAdminClinics(BigInt(MAPPED_ONLY))).toEqual([
      { id: MAPPED_2, name: `Klinik ${MAPPED_2}`, active: true },
      { id: MAPPED_1, name: `Klinik ${MAPPED_1}`, active: true },
    ]);
  });
});

describe('resolveClinicId', () => {
  it('gives a clinic admin the first of their clinics', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(OWNER))).toBe(BigInt(ACTIVE_LOW));
  });

  it('gives a mapped-only clinic admin their first mapping', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(MAPPED_ONLY))).toBe(BigInt(MAPPED_2));
  });

  it('gives null to a clinic admin with nothing', async () => {
    expect(await resolveClinicId('CLINIC_ADMIN', BigInt(NOBODY))).toBeNull();
  });

  it('keeps a professional on their first mapping by mapping id', async () => {
    expect(await resolveClinicId('PROFESSIONAL', BigInt(DOCTOR))).toBe(BigInt(MAPPED_2));
  });

  it('keeps a receptionist on their mapping', async () => {
    expect(await resolveClinicId('RECEPTIONIST', BigInt(RECEPTIONIST))).toBe(BigInt(MAPPED_1));
  });

  it('gives SUPER_ADMIN and CLIENT nothing', async () => {
    expect(await resolveClinicId('SUPER_ADMIN', BigInt(OWNER))).toBeNull();
    expect(await resolveClinicId('CLIENT', BigInt(OWNER))).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/auth/admin-clinics.test.ts`
Expected: FAIL — `listAdminClinicIds is not a function`, dan `gives a clinic admin the first of their clinics` mendapat `MAPPED_1` (perilaku lama).

- [ ] **Step 3: Implementasi**

Ganti **seluruh isi** `src/services/billing/kc-actor.ts` dengan (fungsi `resolveKcActor` belum berubah di task ini):

```ts
import { prisma } from '@/lib/db';
import { KcError } from '@/lib/kc-response';
import type { Actor } from '@/lib/auth';

export interface KcActor {
  actor: Actor;
  wpUserId: bigint;          // = wp_users.ID; used as doctor_id / patient_id
  clinicId: bigint | null;   // resolved clinic for CLINIC_ADMIN / RECEPTIONIST / PROFESSIONAL
}

/** One clinic a CLINIC_ADMIN may switch to, as /auth/me reports it. */
export interface AdminClinic {
  id: number;
  name: string;
  active: boolean;
}

/** Resolve the JWT actor to KiviCare ids. */
export async function resolveKcActor(actor: Actor): Promise<KcActor> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { wpUserId: true },
  });
  if (!user?.wpUserId) {
    throw new KcError('User is not linked to a WordPress account', 403);
  }
  const wpUserId = user.wpUserId;

  const clinicId = await resolveClinicId(actor.role, wpUserId);
  return { actor, wpUserId, clinicId };
}

/**
 * The clinic an actor works in when the request names none, by role.
 *
 * CLINIC_ADMIN: the first of `listAdminClinicIds`. RECEPTIONIST: their first receptionist
 * mapping. PROFESSIONAL: their first doctor mapping. Anyone else has none. "First" is by
 * id, so the answer never depends on the order the database happens to return rows in.
 */
export async function resolveClinicId(role: Actor['role'], wpUserId: bigint): Promise<bigint | null> {
  if (role === 'CLINIC_ADMIN') {
    const [first] = await listAdminClinicIds(wpUserId);
    return first ?? null;
  }
  if (role === 'PROFESSIONAL') {
    const mapping = await prisma.kcDoctorClinicMapping.findFirst({
      where: { doctorId: wpUserId },
      select: { clinicId: true },
      orderBy: { id: 'asc' },
    });
    return mapping?.clinicId ?? null;
  }
  if (role === 'RECEPTIONIST') {
    const mapping = await prisma.kcReceptionistClinicMapping.findFirst({
      where: { receptionistId: wpUserId },
      select: { clinicId: true },
      orderBy: { id: 'asc' },
    });
    return mapping?.clinicId ?? null;
  }
  return null;
}

/**
 * Every clinic a CLINIC_ADMIN may act in, default first.
 *
 * The source is wp_kc_clinics.clinic_admin_id, KiviCare's own definition of "admin of
 * clinic X": active clinics first, then inactive ones, each group by id. Only an admin who
 * owns no clinic at all falls back to their doctor mappings (by mapping id). Being mapped
 * as a doctor at a clinic deliberately does NOT make someone its admin otherwise.
 */
export async function listAdminClinicIds(wpUserId: bigint): Promise<bigint[]> {
  return (await adminClinicRows(wpUserId)).map((c) => c.id);
}

/** `listAdminClinicIds` with names and the active flag, in exactly the same order. */
export async function listAdminClinics(wpUserId: bigint): Promise<AdminClinic[]> {
  return (await adminClinicRows(wpUserId)).map((c) => ({
    id: Number(c.id),
    name: c.name?.trim() || `Klinik #${c.id}`,
    active: c.status === 1,
  }));
}

type ClinicRow = { id: bigint; name: string | null; status: number };

async function adminClinicRows(wpUserId: bigint): Promise<ClinicRow[]> {
  const owned = await prisma.kcClinic.findMany({
    where: { clinicAdminId: wpUserId },
    select: { id: true, name: true, status: true },
    orderBy: { id: 'asc' },
  });
  if (owned.length > 0) {
    return [...owned.filter((c) => c.status === 1), ...owned.filter((c) => c.status !== 1)];
  }

  const mappings = await prisma.kcDoctorClinicMapping.findMany({
    where: { doctorId: wpUserId },
    select: { clinicId: true },
    orderBy: { id: 'asc' },
  });
  const ids: bigint[] = [];
  for (const m of mappings) {
    if (!ids.includes(m.clinicId)) ids.push(m.clinicId);
  }
  if (ids.length === 0) return [];

  const clinics = await prisma.kcClinic.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true },
  });
  const byId = new Map(clinics.map((c) => [c.id.toString(), c]));
  // Mapping order is kept. A mapping to a clinic row that no longer exists keeps its id,
  // exactly as the old first-mapping resolver did.
  return ids.map((id) => byId.get(id.toString()) ?? { id, name: null, status: 0 });
}
```

- [ ] **Step 4: Sesuaikan mock di `tests/payments/session-routes.test.ts`**

Blok `vi.hoisted` di baris 7-20: ubah tiga baris ini

```ts
  kcDoctorClinicMapping: { findFirst: vi.fn() },
  kcReceptionistClinicMapping: { findFirst: vi.fn() },
  kcClinic: { findFirst: vi.fn() },
```

menjadi

```ts
  kcDoctorClinicMapping: { findFirst: vi.fn(), findMany: vi.fn() },
  kcReceptionistClinicMapping: { findFirst: vi.fn() },
  kcClinic: { findFirst: vi.fn(), findMany: vi.fn() },
```

Di `beforeEach` blok clinic-scope (sekitar baris 183), ganti baris

```ts
    db.kcClinic.findFirst.mockImplementation(async ({ where }: any) => (where.clinicAdminId === 502n ? { id: CLINIC_A } : null));
```

dengan

```ts
    // A clinic admin's clinics now come from findMany (every clinic they own), not findFirst.
    db.kcClinic.findMany.mockImplementation(async ({ where }: any) =>
      where.clinicAdminId === 502n ? [{ id: CLINIC_A, name: 'Klinik A', status: 1 }] : []);
    db.kcDoctorClinicMapping.findMany.mockResolvedValue([]);
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/auth/admin-clinics.test.ts tests/billing/kc-actor.test.ts tests/payments/session-routes.test.ts tests/integration/auth/auth-me-clinic-id.test.ts`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/billing/kc-actor.ts tests/integration/auth/admin-clinics.test.ts tests/payments/session-routes.test.ts
git commit -m "feat(auth): daftar klinik admin dari clinic_admin_id, default pasti per role"
```

---

### Task B2: Header `X-Praktiqu-Clinic-Id` divalidasi di `getActor()`

**Files:**
- Create: `src/lib/auth/active-clinic.ts`
- Modify: `src/lib/auth.ts` (interface `Actor`, fungsi `getActor`)
- Modify: `src/services/billing/kc-actor.ts` (fungsi `resolveKcActor`)
- Test (baru): `tests/integration/auth/active-clinic-header.test.ts`

**Interfaces:**
- Consumes: `listAdminClinicIds(wpUserId: bigint): Promise<bigint[]>` (Task B1)
- Produces:
  - `Actor.activeClinicId?: bigint` — hanya diisi oleh `getActor()`
  - `export const ACTIVE_CLINIC_HEADER = 'x-praktiqu-clinic-id'`
  - `export async function resolveActiveClinic(actorId: string, role: Actor['role'], raw: string | null): Promise<ActiveClinicResult>`
  - `getActor()` melempar `AuthError('invalid_clinic_header', 400)` atau `AuthError('clinic_not_in_scope', 403)`
  - `resolveKcActor()` → `clinicId = actor.activeClinicId ?? default`

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/integration/auth/active-clinic-header.test.ts`:

```ts
/**
 * X-Praktiqu-Clinic-Id: the clinic a CLINIC_ADMIN who holds several clinics is acting in
 * for this request. getActor() checks it against the admin's own clinics; every other role
 * ignores it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { AuthError, getActor } from '@/lib/auth';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { assertTestDb } from '../../billing/fixtures';

const BASE = 8_660_000;
const END = BASE + 10_000;
const ADMIN_WP = BASE + 500;
const OTHER_ADMIN_WP = BASE + 501;
const RECEPTIONIST_WP = BASE + 502;
const CLINIC_A = BASE + 1; // ADMIN_WP's default
const CLINIC_B = BASE + 2; // ADMIN_WP's second clinic
const CLINIC_C = BASE + 3; // OTHER_ADMIN_WP's
const MISSING = BASE + 9; // no such clinic

const ADMIN = 'active-clinic-test-admin';
const UNLINKED = 'active-clinic-test-unlinked';
const RECEPTIONIST = 'active-clinic-test-receptionist';
const SUPER = 'active-clinic-test-super';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(sub: string, role: string, clinicHeader?: string): Promise<NextRequest> {
  const jwt = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (clinicHeader !== undefined) headers['x-praktiqu-clinic-id'] = clinicHeader;
  return new NextRequest('http://localhost/api/v1/anything', { headers });
}

async function rejection(p: Promise<unknown>): Promise<AuthError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error('expected getActor to reject');
}

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    adminId,
  );
}

async function authUser(id: string, role: string, wpUserId: number | null) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@active-clinic.test.local`,
      username: id,
      firstName: 'T',
      lastName: 'U',
      displayName: 'Test User',
      role: role as never,
      wpUserId: wpUserId === null ? null : BigInt(wpUserId),
      status: 1,
    },
  });
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'active-clinic-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A, ADMIN_WP);
  await clinic(CLINIC_B, ADMIN_WP);
  await clinic(CLINIC_C, OTHER_ADMIN_WP);
  await authUser(ADMIN, 'CLINIC_ADMIN', ADMIN_WP);
  await authUser(UNLINKED, 'CLINIC_ADMIN', null);
  await authUser(RECEPTIONIST, 'RECEPTIONIST', RECEPTIONIST_WP);
  await authUser(SUPER, 'SUPER_ADMIN', null);
});

afterAll(async () => {
  await wipe();
});

describe('getActor — X-Praktiqu-Clinic-Id', () => {
  it('leaves activeClinicId unset without the header', async () => {
    expect((await getActor(await req(ADMIN, 'CLINIC_ADMIN'))).activeClinicId).toBeUndefined();
  });

  it('treats an empty header as absent', async () => {
    expect((await getActor(await req(ADMIN, 'CLINIC_ADMIN', ''))).activeClinicId).toBeUndefined();
  });

  it('accepts a clinic the admin owns', async () => {
    const actor = await getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_B)));
    expect(actor.activeClinicId).toBe(BigInt(CLINIC_B));
  });

  it("rejects another admin's clinic with 403 clinic_not_in_scope", async () => {
    const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_C))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('rejects a clinic that does not exist exactly the same way', async () => {
    const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', String(MISSING))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it.each(['abc', '0', '-1', '1.5', '01', '4 4', '12345678901234567890'])(
    'rejects the malformed value %j with 400 invalid_clinic_header',
    async (value) => {
      const err = await rejection(getActor(await req(ADMIN, 'CLINIC_ADMIN', value)));
      expect(err.status).toBe(400);
      expect(err.message).toBe('invalid_clinic_header');
    },
  );

  it('rejects any clinic for a clinic admin with no WordPress link', async () => {
    const err = await rejection(getActor(await req(UNLINKED, 'CLINIC_ADMIN', String(CLINIC_A))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('ignores the header for a receptionist', async () => {
    const actor = await getActor(await req(RECEPTIONIST, 'RECEPTIONIST', String(CLINIC_C)));
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('ignores even a malformed header for a super admin', async () => {
    const actor = await getActor(await req(SUPER, 'SUPER_ADMIN', 'abc'));
    expect(actor.activeClinicId).toBeUndefined();
  });
});

describe('resolveKcActor — active clinic', () => {
  it('uses the default clinic without the header', async () => {
    const kc = await resolveKcActor(await getActor(await req(ADMIN, 'CLINIC_ADMIN')));
    expect(kc.clinicId).toBe(BigInt(CLINIC_A));
  });

  it('uses the validated clinic from the header', async () => {
    const kc = await resolveKcActor(await getActor(await req(ADMIN, 'CLINIC_ADMIN', String(CLINIC_B))));
    expect(kc.clinicId).toBe(BigInt(CLINIC_B));
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/auth/active-clinic-header.test.ts`
Expected: FAIL — `accepts a clinic the admin owns` mendapat `undefined`; tes penolakan gagal dengan `expected getActor to reject`.

- [ ] **Step 3: Buat `src/lib/auth/active-clinic.ts`**

```ts
/**
 * X-Praktiqu-Clinic-Id — which of their clinics a CLINIC_ADMIN is acting in for this request.
 *
 * A clinic admin may hold several clinics (wp_kc_clinics.clinic_admin_id on several rows).
 * The Laravel FE keeps one of them "active" and sends it on every call; getActor() checks
 * it here, so every route sees one validated clinic per request and no route has to know
 * about the header.
 *
 * Only CLINIC_ADMIN is affected. Every other role ignores the header without an error.
 */
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { listAdminClinicIds } from '@/services/billing/kc-actor';

/** Lower-case, as `Headers.get()` is case-insensitive anyway. */
export const ACTIVE_CLINIC_HEADER = 'x-praktiqu-clinic-id';

const CLINIC_ID = /^[1-9][0-9]{0,18}$/;

export type ActiveClinicResult =
  | { ok: true; clinicId: bigint | undefined }
  | { ok: false; status: 400; code: 'invalid_clinic_header' }
  | { ok: false; status: 403; code: 'clinic_not_in_scope' };

export async function resolveActiveClinic(
  actorId: string,
  role: Actor['role'],
  raw: string | null,
): Promise<ActiveClinicResult> {
  if (role !== 'CLINIC_ADMIN') return { ok: true, clinicId: undefined };

  const value = raw?.trim() ?? '';
  if (value === '') return { ok: true, clinicId: undefined };
  if (!CLINIC_ID.test(value)) return { ok: false, status: 400, code: 'invalid_clinic_header' };

  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { wpUserId: true } });
  if (!user?.wpUserId) return { ok: false, status: 403, code: 'clinic_not_in_scope' };

  const clinicId = BigInt(value);
  const own = await listAdminClinicIds(user.wpUserId);
  // A clinic that does not exist gets the same answer as someone else's, so the header
  // cannot be used to probe which clinic ids exist.
  return own.includes(clinicId)
    ? { ok: true, clinicId }
    : { ok: false, status: 403, code: 'clinic_not_in_scope' };
}
```

- [ ] **Step 4: Ubah `src/lib/auth.ts`**

Tambahkan import di bawah import yang sudah ada:

```ts
import { ACTIVE_CLINIC_HEADER, resolveActiveClinic } from '@/lib/auth/active-clinic';
```

Ganti `interface Actor` menjadi:

```ts
export interface Actor {
  id: string;
  role: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PROFESSIONAL' | 'RECEPTIONIST' | 'CLIENT';
  practiceId: string | null;
  /**
   * The clinic a CLINIC_ADMIN picked for this request with X-Praktiqu-Clinic-Id, already
   * checked to be one of their own. Set ONLY by getActor(); resolveKcActor() trusts it
   * without checking again. Undefined means "use the default clinic".
   */
  activeClinicId?: bigint;
}
```

Ganti seluruh fungsi `getActor` menjadi:

```ts
export async function getActor(req: NextRequest): Promise<Actor> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }
  const token = header.slice('Bearer '.length);
  let actor: Actor;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) throw new AuthError('Invalid token: missing sub', 401);
    actor = {
      id: payload.sub as string,
      role: (payload.role as Actor['role']) ?? 'CLIENT',
      practiceId: (payload.practiceId as string | null) ?? null,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired token', 401);
  }

  // Outside the try above on purpose: a database error here must surface as a 500, not be
  // reported as a bad token. The AuthError message IS the code (clinic_not_in_scope /
  // invalid_clinic_header), so it reaches the client whatever wrapper renders it.
  const active = await resolveActiveClinic(actor.id, actor.role, req.headers.get(ACTIVE_CLINIC_HEADER));
  if (!active.ok) throw new AuthError(active.code, active.status);
  if (active.clinicId !== undefined) actor.activeClinicId = active.clinicId;
  return actor;
}
```

Jangan ubah `optionalActor()` — route publik tidak membaca header ini.

- [ ] **Step 5: Ubah `resolveKcActor` di `src/services/billing/kc-actor.ts`**

Ganti baris

```ts
  const clinicId = await resolveClinicId(actor.role, wpUserId);
```

dengan

```ts
  // activeClinicId was already checked against this admin's own clinics by getActor().
  const clinicId = actor.activeClinicId ?? (await resolveClinicId(actor.role, wpUserId));
```

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/auth/active-clinic-header.test.ts tests/integration/auth/admin-clinics.test.ts tests/billing/kc-actor.test.ts tests/billing/practice-routes-scope.integration.test.ts`
Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/active-clinic.ts src/lib/auth.ts src/services/billing/kc-actor.ts tests/integration/auth/active-clinic-header.test.ts
git commit -m "feat(auth): header X-Praktiqu-Clinic-Id memilih klinik aktif admin, divalidasi di getActor"
```

---

### Task B3: Pembungkus auth meneruskan status 400/403

**Files:**
- Modify: `src/lib/auth/route-guards.ts` (blok `catch` di `requireRoles`)
- Modify: `src/lib/auth/caller.ts` (blok `catch` di `callerFromRequest`)
- Modify: `src/lib/auth/session-notes-caller.ts` (blok `catch` di `callerFromHeaders`)
- Test (baru): `tests/lib/auth/auth-error-status.test.ts`

**Interfaces:**
- Consumes: `AuthError(message, status)` dari `getActor()` (Task B2)
- Produces: `requireRoles` menjawab problem+json dengan `code` = pesan error untuk 400/403; `callerFromRequest` melempar `InterventionPlanError('forbidden', <kode>, <status>)`; `callerFromHeaders` melempar `SessionNoteAccessError(<kode>, <status>)`. 401 tetap seperti sebelumnya.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/lib/auth/auth-error-status.test.ts`:

```ts
/**
 * The active-clinic header makes getActor() throw 400/403 as well as 401. Wrappers that
 * turned every AuthError into 401 would send the Laravel FE into a pointless token refresh
 * and retry; they must pass the real status and the code (the error message) through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getActor: vi.fn() };
});

import { AuthError, getActor } from '@/lib/auth';
import { requireRoles } from '@/lib/auth/route-guards';
import { callerFromRequest } from '@/lib/auth/caller';
import { callerFromHeaders } from '@/lib/auth/session-notes-caller';

const request = () => new NextRequest('http://localhost/api/v1/anything');

beforeEach(() => vi.mocked(getActor).mockReset());

describe('requireRoles', () => {
  it('answers 403 with the clinic code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('clinic_not_in_scope', 403));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(403);
    expect((await gate.response.json()).code).toBe('clinic_not_in_scope');
  });

  it('answers 400 with the header code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('invalid_clinic_header', 400));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(400);
    expect((await gate.response.json()).code).toBe('invalid_clinic_header');
  });

  it('still answers 401 unauthorized for a bad token', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    const gate = await requireRoles(request(), ['CLINIC_ADMIN']);
    if (!('response' in gate)) throw new Error('expected a response');
    expect(gate.response.status).toBe(401);
    expect((await gate.response.json()).code).toBe('unauthorized');
  });
});

describe('callerFromRequest (intervention plans)', () => {
  it('keeps 403 and the code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('clinic_not_in_scope', 403));
    await expect(callerFromRequest(request())).rejects.toMatchObject({ status: 403, message: 'clinic_not_in_scope' });
  });

  it('still reports 401 as unauthenticated', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    await expect(callerFromRequest(request())).rejects.toMatchObject({ status: 401, message: 'unauthenticated' });
  });
});

describe('callerFromHeaders (session notes)', () => {
  it('keeps 400 and the code', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('invalid_clinic_header', 400));
    await expect(callerFromHeaders(request())).rejects.toMatchObject({ status: 400, message: 'invalid_clinic_header' });
  });

  it('still reports 401 as unauthenticated', async () => {
    vi.mocked(getActor).mockRejectedValue(new AuthError('Invalid or expired token', 401));
    await expect(callerFromHeaders(request())).rejects.toMatchObject({ status: 401, message: 'unauthenticated' });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/lib/auth/auth-error-status.test.ts`
Expected: FAIL — status 401 diterima di tempat 403/400 diharapkan.

- [ ] **Step 3: Ubah `src/lib/auth/route-guards.ts`**

Ganti import problem-details menjadi:

```ts
import { unauthorized, forbidden, badRequest } from '@/lib/problem-details';
```

Ganti blok `catch` di `requireRoles` menjadi:

```ts
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        response: NextResponse.json(authProblem(err), {
          status: err.status,
          headers: PROBLEM_HEADERS,
        }),
      };
    }
    throw err;
  }
```

Tambahkan di akhir file:

```ts
/**
 * Problem body for an AuthError. 401 stays `unauthorized`. 400/403 come from the
 * X-Praktiqu-Clinic-Id check in getActor(), whose message IS its code, so it becomes the
 * problem `code` the client acts on (the Laravel FE ends the session on it).
 */
function authProblem(err: AuthError) {
  if (err.status === 403) return forbidden(err.message, err.message);
  if (err.status === 400) return badRequest(err.message, err.message);
  return unauthorized('unauthorized', err.message);
}
```

- [ ] **Step 4: Ubah `src/lib/auth/caller.ts`**

Ganti

```ts
    if (err instanceof AuthError) {
      throw new InterventionPlanError('forbidden', 'unauthenticated', 401);
    }
```

dengan

```ts
    if (err instanceof AuthError) {
      // 401 = missing/invalid token. 400/403 = the active-clinic header was refused; keep
      // its status and code so the client can tell the two apart.
      throw new InterventionPlanError('forbidden', err.status === 401 ? 'unauthenticated' : err.message, err.status);
    }
```

- [ ] **Step 5: Ubah `src/lib/auth/session-notes-caller.ts`**

Ganti

```ts
    if (err instanceof AuthError) {
      throw new SessionNoteAccessError('unauthenticated', 401);
    }
```

dengan

```ts
    if (err instanceof AuthError) {
      // 401 = missing/invalid token. 400/403 = the active-clinic header was refused.
      throw new SessionNoteAccessError(err.status === 401 ? 'unauthenticated' : err.message, err.status);
    }
```

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/lib/auth/auth-error-status.test.ts tests/integration/intervention-plan tests/lib`
Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/route-guards.ts src/lib/auth/caller.ts src/lib/auth/session-notes-caller.ts tests/lib/auth/auth-error-status.test.ts
git commit -m "fix(auth): pembungkus auth meneruskan status 400/403 dari getActor"
```

---

### Task B4: `/auth/me`, login, register, OTP mengirim `clinics`

**Files:**
- Modify: `src/services/auth/service.ts` (import baris 10; tipe `LoginResult` sekitar baris 150-160; fungsi `scopeClinicId` baris 256-270; tiga pemanggil di sekitar baris 250, 478, 777)
- Modify: `src/services/auth/otp.service.ts` (import baris 26; pemanggil sekitar baris 239)
- Test: `tests/integration/auth/auth-me-clinic-id.test.ts`

**Interfaces:**
- Consumes: `listAdminClinics`, `resolveClinicId`, `AdminClinic` (Task B1)
- Produces: `export async function scopeClinics(role: UserRole, wpUserId: bigint | null): Promise<{ clinicId: number | null; clinics?: AdminClinic[] }>`. `scopeClinicId` **dihapus**. Objek `user` di respons login/me/register/OTP mendapat `clinics` hanya untuk CLINIC_ADMIN.

- [ ] **Step 1: Tambah tes yang gagal**

Di `tests/integration/auth/auth-me-clinic-id.test.ts`:

1. Di bawah `const CLINIC_B = BASE + 2;` tambahkan:

```ts
const CLINIC_INACTIVE = BASE + 3; // owned by ADMIN_WP, inactive
const CLINIC_D = BASE + 4; // owned by ADMIN_WP, active
```

2. Di `beforeAll`, tepat setelah `INSERT` untuk `CLINIC_A`, tambahkan:

```ts
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Nonaktif', 'n@test.local', '0221234567', 'Jl. Uji 3', 'Bandung', 0, ?, 0, NOW())`,
    CLINIC_INACTIVE,
    ADMIN_WP,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik D', 'd@test.local', '0221234567', 'Jl. Uji 4', 'Bandung', 1, ?, 0, NOW())`,
    CLINIC_D,
    ADMIN_WP,
  );
```

3. Di akhir file tambahkan:

```ts
describe('GET /auth/me — clinics', () => {
  it('lists every clinic a clinic admin owns, active first, and clinicId is the first', async () => {
    const user = await me('auth-me-clinic-test-admin', 'CLINIC_ADMIN');
    expect(user.clinics).toEqual([
      { id: CLINIC_A, name: 'Klinik A', active: true },
      { id: CLINIC_D, name: 'Klinik D', active: true },
      { id: CLINIC_INACTIVE, name: 'Klinik Nonaktif', active: false },
    ]);
    expect(user.clinicId).toBe(CLINIC_A);
  });

  it('gives a receptionist no clinics field at all', async () => {
    expect(await me('auth-me-clinic-test-receptionist', 'RECEPTIONIST')).not.toHaveProperty('clinics');
  });

  it('gives a professional no clinics field at all', async () => {
    expect(await me('auth-me-clinic-test-doctor', 'PROFESSIONAL')).not.toHaveProperty('clinics');
  });

  it('gives an unlinked clinic admin an empty list', async () => {
    expect((await me('auth-me-clinic-test-unlinked', 'CLINIC_ADMIN')).clinics).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/auth/auth-me-clinic-id.test.ts`
Expected: 4 tes lama PASS; 4 tes baru FAIL (`clinics` undefined).

- [ ] **Step 3: Implementasi di `src/services/auth/service.ts`**

Ganti import baris 10:

```ts
import { resolveClinicId } from '@/services/billing/kc-actor';
```

menjadi:

```ts
import { listAdminClinics, resolveClinicId, type AdminClinic } from '@/services/billing/kc-actor';
```

Di tipe `LoginResult` (sekitar baris 158-159), ganti:

```ts
    /** See `scopeClinicId`. */
    clinicId: number | null;
```

menjadi:

```ts
    /** See `scopeClinics`. */
    clinicId: number | null;
    /** See `scopeClinics`. Only a CLINIC_ADMIN carries it. */
    clinics?: AdminClinic[];
```

Ganti seluruh fungsi `scopeClinicId` beserta komentar JSDoc-nya dengan:

```ts
/**
 * The clinic(s) a staff role is bound to, for clients that scope by them.
 *
 * `clinicId`: CLINIC_ADMIN and RECEPTIONIST get one. Without it the Laravel FE guessed an
 * admin's clinic by sweeping /practices for a matching email (which stopped at the first
 * page) and never found a receptionist's at all, so their dashboards came up empty. For a
 * CLINIC_ADMIN it is their default clinic, i.e. the first entry of `clinics`.
 *
 * `clinics`: CLINIC_ADMIN only. Every clinic they may pick with the X-Praktiqu-Clinic-Id
 * header, default first. Other roles do not get the field at all, so a client can tell
 * "no clinic switcher" apart from "a switcher with nothing in it".
 *
 * A PROFESSIONAL deliberately gets `clinicId: null`: they can work at several clinics, and
 * the FE treats this value as a clinic override (schedule saves, service lists), so a
 * first-mapping guess would lock them out of every clinic but one.
 */
export async function scopeClinics(
  role: UserRole,
  wpUserId: bigint | null,
): Promise<{ clinicId: number | null; clinics?: AdminClinic[] }> {
  if (role === 'CLINIC_ADMIN') {
    const clinics = wpUserId === null ? [] : await listAdminClinics(wpUserId);
    return { clinicId: clinics[0]?.id ?? null, clinics };
  }
  if (role === 'RECEPTIONIST' && wpUserId !== null) {
    const clinicId = await resolveClinicId(role, wpUserId);
    return { clinicId: clinicId === null ? null : Number(clinicId) };
  }
  return { clinicId: null };
}
```

Lalu di **tiga** tempat di file yang sama (login ±250, `getMeFromAccessToken` ±478, register ±777), ganti baris:

```ts
      clinicId: await scopeClinicId(user.role, user.wpUserId),
```

(di `getMeFromAccessToken` indentasinya 4 spasi: `    clinicId: await scopeClinicId(user.role, user.wpUserId),`) dengan:

```ts
      ...(await scopeClinics(user.role, user.wpUserId)),
```

(pertahankan indentasi baris aslinya).

- [ ] **Step 4: Implementasi di `src/services/auth/otp.service.ts`**

Baris 26: ganti `scopeClinicId` menjadi `scopeClinics` di daftar import dari `'@/services/auth/service'`. Lalu ganti baris sekitar 239:

```ts
      clinicId: await scopeClinicId(user.role, user.wpUserId),
```

dengan:

```ts
      ...(await scopeClinics(user.role, user.wpUserId)),
```

- [ ] **Step 5: Pastikan tidak ada sisa `scopeClinicId`**

Run: `grep -rn "scopeClinicId" src tests`
Expected: tidak ada output.

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/auth`
Expected: semua PASS.

Lalu: `npx tsc --noEmit -p .`
Expected: tidak ada error baru di file yang diubah (kalau `main` sudah punya error lama di file lain, catat jumlahnya sebelum dan sesudah — harus sama).

- [ ] **Step 7: Commit**

```bash
git add src/services/auth/service.ts src/services/auth/otp.service.ts tests/integration/auth/auth-me-clinic-id.test.ts
git commit -m "feat(auth): /auth/me dan login mengirim daftar klinik admin (clinics)"
```

---

### Task B5: Bukti tingkat route — praktik mengikuti klinik aktif

Task ini tidak mengubah kode produksi (B2+B3 sudah cukup). Tujuannya membuktikan bahwa route nyata — yang memakai `requireRoles` dan `withAuth` — mengikuti header.

**Files:**
- Test (baru): `tests/integration/practice/practice-active-clinic.test.ts`

**Interfaces:**
- Consumes: semua hasil B1–B3.

Cakupan: `/practices` (lewat `requireRoles`) dan penolakan di `withAuth` (`/bills`). Daftar bills sendiri tidak diuji mengikuti header karena butuh modul billing aktif di DB uji; ia memakai `resolveKcActor` yang sama yang sudah dibuktikan di Task B2. `/practices/{id}/payment-settings` memakai `assertPracticeInScope` yang sama dengan `/practices/{id}` yang diuji di sini.

- [ ] **Step 1: Tulis tes**

Buat `tests/integration/practice/practice-active-clinic.test.ts`:

```ts
/**
 * Route-level proof that the active clinic narrows what a clinic admin who holds two
 * clinics sees, through both auth wrappers in use: requireRoles (/practices) and withAuth
 * (/bills).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { GET as practicesGet } from '@/app/api/v1/practices/route';
import { GET as practiceGet } from '@/app/api/v1/practices/[id]/route';
import { GET as billsGet } from '@/app/api/v1/bills/route';

const BASE = 8_670_000;
const END = BASE + 10_000;
const ADMIN_WP = BASE + 500;
const OTHER_WP = BASE + 501;
const CLINIC_A = BASE + 1; // ADMIN_WP's default
const CLINIC_B = BASE + 2; // ADMIN_WP's second clinic
const CLINIC_C = BASE + 3; // OTHER_WP's
const ADMIN = 'practice-active-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
let jwt: string;

function req(path: string, clinicHeader?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (clinicHeader !== undefined) headers['x-praktiqu-clinic-id'] = clinicHeader;
  return new NextRequest(`http://localhost${path}`, { headers });
}

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    adminId,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'practice-active-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A, ADMIN_WP);
  await clinic(CLINIC_B, ADMIN_WP);
  await clinic(CLINIC_C, OTHER_WP);
  await prisma.user.create({
    data: {
      id: ADMIN, email: `${ADMIN}@test.local`, username: ADMIN, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(ADMIN_WP), status: 1,
    },
  });
  jwt = await new SignJWT({ role: 'CLINIC_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADMIN)
    .setExpirationTime('1h')
    .sign(SECRET);
});

afterAll(async () => {
  await wipe();
});

const ids = async (res: Response) => ((await res.json()) as { data: Array<{ id: number }> }).data.map((p) => p.id);

describe('GET /practices', () => {
  it('lists only the default clinic without the header', async () => {
    const res = await practicesGet(req('/api/v1/practices'));
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual([CLINIC_A]);
  });

  it('lists only the active clinic with the header', async () => {
    const res = await practicesGet(req('/api/v1/practices', String(CLINIC_B)));
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual([CLINIC_B]);
  });

  it("refuses another admin's clinic with 403 clinic_not_in_scope", async () => {
    const res = await practicesGet(req('/api/v1/practices', String(CLINIC_C)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('clinic_not_in_scope');
  });

  it('refuses a malformed header with 400 invalid_clinic_header', async () => {
    const res = await practicesGet(req('/api/v1/practices', 'abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_clinic_header');
  });
});

describe('GET /practices/:id', () => {
  it('404s the second clinic while the first is active', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`, String(CLINIC_A)), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(404);
  });

  it('404s the second clinic without the header (default is the first)', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(404);
  });

  it('serves the second clinic once it is active', async () => {
    const res = await practiceGet(req(`/api/v1/practices/${CLINIC_B}`, String(CLINIC_B)), { params: { id: String(CLINIC_B) } } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(CLINIC_B);
  });
});

describe('withAuth routes', () => {
  it("refuse another admin's clinic before the handler runs", async () => {
    const res = await billsGet(req('/api/v1/bills', String(CLINIC_C)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('clinic_not_in_scope');
  });
});
```

- [ ] **Step 2: Jalankan**

Run: `npx vitest run tests/integration/practice/practice-active-clinic.test.ts`
Expected: semua PASS. Kalau ada yang gagal, periksa dulu Task B2/B3 — jangan mengubah route `/practices`.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/practice/practice-active-clinic.test.ts
git commit -m "test(practices): daftar dan detail praktik mengikuti klinik aktif"
```

---

### Task B6: Pasien yang terdaftar di beberapa klinik bisa dibuka dari klinik mana pun miliknya

**Files:**
- Modify: `src/repositories/wp/patients.repo.ts` (tambah fungsi `patientInClinic`)
- Modify: `src/services/client/client.service.ts` (import dari patients.repo; cabang CLINIC_ADMIN/RECEPTIONIST di `enforceClientReadAccess`, sekitar baris 212-219)
- Test (baru): `tests/integration/client/client-multi-clinic-access.test.ts`

**Interfaces:**
- Produces: `export async function patientInClinic(patientId: bigint, clinicId: bigint): Promise<boolean>` di `patients.repo.ts`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/integration/client/client-multi-clinic-access.test.ts`:

```ts
/**
 * A patient registered at clinics A and B belongs to both. The list already used every
 * mapping (EXISTS), but opening the record compared against the patient's FIRST mapping
 * only, so clinic B listed the patient and then answered 403 on click.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb, seedPatient, seedPatientClinicMapping } from '../../billing/fixtures';
import { GET as clientGet } from '@/app/api/v1/clients/[id]/route';
import { GET as clientsGet } from '@/app/api/v1/clients/route';

const BASE = 8_680_000;
const END = BASE + 10_000;
const ADMIN_WP = BASE + 500;
const CLINIC_A = BASE + 1;
const CLINIC_B = BASE + 2;
const P_BOTH = BASE + 100; // mapped to A first, then B
const P_A_ONLY = BASE + 101;
const ADMIN = 'client-multi-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
let jwt: string;

function req(path: string, clinicHeader: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${jwt}`, 'x-praktiqu-clinic-id': clinicHeader },
  });
}
const open = (id: number, clinic: number) =>
  clientGet(req(`/api/v1/clients/${id}`, String(clinic)), { params: Promise.resolve({ id: String(id) }) } as any);

async function clinic(id: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    ADMIN_WP,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_patient_clinic_mappings WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.user.deleteMany({ where: { id: { startsWith: 'client-multi-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await clinic(CLINIC_A);
  await clinic(CLINIC_B);
  await seedPatient({ id: P_BOTH, name: 'Pasien Dua', email: `p${P_BOTH}@client-multi.test.local` });
  await seedPatient({ id: P_A_ONLY, name: 'Pasien Satu', email: `p${P_A_ONLY}@client-multi.test.local` });
  await seedPatientClinicMapping({ id: BASE + 200, patientId: P_BOTH, clinicId: CLINIC_A });
  await seedPatientClinicMapping({ id: BASE + 201, patientId: P_BOTH, clinicId: CLINIC_B });
  await seedPatientClinicMapping({ id: BASE + 202, patientId: P_A_ONLY, clinicId: CLINIC_A });
  await prisma.user.create({
    data: {
      id: ADMIN, email: `${ADMIN}@test.local`, username: ADMIN, firstName: 'A', lastName: 'D',
      displayName: 'Admin', role: 'CLINIC_ADMIN', wpUserId: BigInt(ADMIN_WP), status: 1,
    },
  });
  jwt = await new SignJWT({ role: 'CLINIC_ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADMIN)
    .setExpirationTime('1h')
    .sign(SECRET);
});

afterAll(async () => {
  await wipe();
});

describe('opening a patient while clinic B is active', () => {
  it('opens a patient of clinics A and B', async () => {
    expect((await open(P_BOTH, CLINIC_B)).status).toBe(200);
  });

  it('still refuses a patient of clinic A only with 403', async () => {
    expect((await open(P_A_ONLY, CLINIC_B)).status).toBe(403);
  });

  it('lists the shared patient and not the clinic-A-only one', async () => {
    const res = await clientsGet(req('/api/v1/clients?limit=100', String(CLINIC_B)));
    expect(res.status).toBe(200);
    const listed = ((await res.json()) as { data: Array<{ id: number }> }).data.map((c) => c.id);
    expect(listed).toContain(P_BOTH);
    expect(listed).not.toContain(P_A_ONLY);
  });
});

describe('opening a patient while clinic A is active', () => {
  it('opens both patients', async () => {
    expect((await open(P_BOTH, CLINIC_A)).status).toBe(200);
    expect((await open(P_A_ONLY, CLINIC_A)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/client/client-multi-clinic-access.test.ts`
Expected: FAIL hanya di `opens a patient of clinics A and B` (mendapat 403). Tiga tes lain sudah PASS (daftar memang sudah memakai semua mapping).

- [ ] **Step 3: Tambahkan `patientInClinic` di `src/repositories/wp/patients.repo.ts`**

Tambahkan di akhir file:

```ts
/**
 * Whether the patient has a mapping row for this clinic, i.e. is a patient of it. Any of
 * their clinics counts, not just the first: the same rule as the `clinicIds` filter in
 * listPatients (EXISTS over wp_kc_patient_clinic_mappings).
 */
export async function patientInClinic(patientId: bigint, clinicId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ one: number }>>(
    `SELECT 1 AS one FROM wp_kc_patient_clinic_mappings WHERE patient_id = ? AND clinic_id = ? LIMIT 1`,
    patientId,
    clinicId,
  );
  return rows.length > 0;
}
```

- [ ] **Step 4: Pakai di `src/services/client/client.service.ts`**

Tambahkan `patientInClinic,` ke daftar import dari `'@/repositories/wp/patients.repo'` (blok import yang berakhir di baris 31). Lalu ganti cabang ini di `enforceClientReadAccess`:

```ts
  if (role === 'CLINIC_ADMIN' || role === 'RECEPTIONIST') {
    if (kc.clinicId === null || patient.clinicId !== kc.clinicId) {
```

menjadi:

```ts
  if (role === 'CLINIC_ADMIN' || role === 'RECEPTIONIST') {
    // Any of the patient's clinics counts, the same rule the list applies. `patient.clinicId`
    // is only their FIRST mapping, so comparing against it hid a patient of clinics A+B from
    // clinic B right after the list had shown them there.
    if (kc.clinicId === null || !(await patientInClinic(patient.id, kc.clinicId))) {
```

(sisa blok — `throw new ClientServiceError(...)` dan `return;` — tidak berubah.)

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/client/client-multi-clinic-access.test.ts tests/complete-in-progress/clients-professional-scope.test.ts`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/wp/patients.repo.ts src/services/client/client.service.ts tests/integration/client/client-multi-clinic-access.test.ts
git commit -m "fix(clients): pasien multi-klinik bisa dibuka dari klinik mana pun miliknya"
```

---

### Task B7: Perbaiki `POST /practices/:id/change-admin`

**Files:**
- Create: `src/repositories/wp/clinic-admins.repo.ts`
- Modify: `src/services/practice/service.ts` (fungsi `changePracticeAdmin` sekitar baris 284-296, tambah `NotAClinicAdminError` dan `ChangePracticeAdminResult`)
- Modify: `src/app/api/v1/practices/[id]/change-admin/route.ts` (seluruh isi)
- Test (baru): `tests/integration/practice/change-admin.test.ts`

**Interfaces:**
- Produces (`clinic-admins.repo.ts`):
  - `export async function isClinicAdminUser(wpUserId: bigint): Promise<boolean>`
  - `export async function countOwnedClinics(wpUserId: bigint): Promise<number>`
- Produces (`practice/service.ts`):
  - `export class NotAClinicAdminError extends Error { readonly wpUserId: number }`
  - `export interface ChangePracticeAdminResult { clinicId: number; adminId: number; previousAdminId: number; previousAdminClinicCount: number; unchanged: boolean }`
  - `export async function changePracticeAdmin(practiceId: number, newAdminId: number, actorId: string): Promise<ChangePracticeAdminResult>`
- Kontrak HTTP: lihat spec bagian B7.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/integration/practice/change-admin.test.ts`:

```ts
/**
 * POST /practices/:id/change-admin — a super admin hands a clinic to a clinic admin.
 *
 * It used to look the new admin up by auth cuid and then write Number(cuid) (NaN) into
 * wp_kc_clinics.clinic_admin_id, so it could not succeed with any input. It now takes a
 * wp_users.ID that must hold the kiviCare_clinic_admin capability.
 *
 * The tests in this file run in order and build on each other's state (vitest runs the
 * tests of one file sequentially).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { POST } from '@/app/api/v1/practices/[id]/change-admin/route';
import { GET as practicesGet } from '@/app/api/v1/practices/route';

const BASE = 8_690_000;
const END = BASE + 10_000;
const ADMIN1 = BASE + 500; // owns A and B at the start
const ADMIN2 = BASE + 501;
const ADMIN3 = BASE + 502; // capability row with a broken length prefix
const PATIENT = BASE + 503;
const NO_SUCH_USER = BASE + 599;
const CLINIC_A = BASE + 1;
const CLINIC_B = BASE + 2;
const NO_SUCH_CLINIC = BASE + 9;

const SUPER = 'change-admin-test-super';
const ADMIN1_AUTH = 'change-admin-test-admin1';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);

async function call(sub: string, role: string, clinicId: string, body: string) {
  const req = new NextRequest(`http://localhost/api/v1/practices/${clinicId}/change-admin`, {
    method: 'POST',
    body,
    headers: { authorization: `Bearer ${await token(sub, role)}`, 'content-type': 'application/json' },
  });
  return POST(req, { params: { id: clinicId } } as any);
}
const superCall = (clinicId: number | string, body: unknown) =>
  call(SUPER, 'SUPER_ADMIN', String(clinicId), typeof body === 'string' ? body : JSON.stringify(body));

async function adminOf(clinicId: number): Promise<number> {
  const row = await prisma.kcClinic.findUnique({ where: { id: BigInt(clinicId) }, select: { clinicAdminId: true } });
  return Number(row!.clinicAdminId);
}

const auditRows = () =>
  prisma.logEntry.findMany({
    where: { action: 'practice.admin_changed', resourceId: { in: [String(CLINIC_A), String(CLINIC_B)] } },
    orderBy: { occurredAt: 'asc' },
  });

async function wpUser(id: number, capabilities: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@change-admin.test.local`, displayName: `User ${id}`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities } });
}
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    adminId,
  );
}

async function wipe() {
  await prisma.logEntry.deleteMany({
    where: { action: 'practice.admin_changed', resourceId: { in: [String(CLINIC_A), String(CLINIC_B)] } },
  });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'change-admin-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN1, caps('kiviCare_clinic_admin'));
  await wpUser(ADMIN2, caps('kiviCare_clinic_admin'));
  // Length prefix 15 is wrong (the slug has 21 characters): unserialize() fails on it, a
  // LIKE match does not. Real rows like this exist on the live site.
  await wpUser(ADMIN3, 'a:1:{s:15:"kiviCare_clinic_admin";b:1;}');
  await wpUser(PATIENT, caps('kiviCare_patient'));
  await clinic(CLINIC_A, ADMIN1);
  await clinic(CLINIC_B, ADMIN1);
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN1_AUTH, 'CLINIC_ADMIN', ADMIN1]] as const) {
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

describe('refusals', () => {
  it('refuses a clinic admin with 403', async () => {
    const res = await call(ADMIN1_AUTH, 'CLINIC_ADMIN', String(CLINIC_B), JSON.stringify({ newAdminId: ADMIN2 }));
    expect(res.status).toBe(403);
    expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
  });

  it('404s a clinic that does not exist', async () => {
    expect((await superCall(NO_SUCH_CLINIC, { newAdminId: ADMIN2 })).status).toBe(404);
  });

  it('404s a non-numeric clinic id', async () => {
    expect((await superCall('abc', { newAdminId: ADMIN2 })).status).toBe(404);
  });

  it('400s a body that is not JSON', async () => {
    expect((await superCall(CLINIC_B, 'not json')).status).toBe(400);
  });

  it.each([{}, { newAdminId: 'abc' }, { newAdminId: 0 }, { newAdminId: 'cmrhxo22l0006usokhbjug1fe' }, { newAdminId: 1.5 }])(
    '422s the body %j',
    async (body) => {
      expect((await superCall(CLINIC_B, body)).status).toBe(422);
      expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
    },
  );

  it('422s not_a_clinic_admin for a patient account', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: PATIENT });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
    expect(await adminOf(CLINIC_B)).toBe(ADMIN1);
  });

  it('422s not_a_clinic_admin for a WordPress user that does not exist', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: NO_SUCH_USER });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_clinic_admin');
  });
});

describe('changes', () => {
  it('hands clinic B to another admin and audits it', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: ADMIN2 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      clinicId: CLINIC_B,
      adminId: ADMIN2,
      previousAdminId: ADMIN1,
      previousAdminClinicCount: 1,
      unchanged: false,
    });
    expect(await adminOf(CLINIC_B)).toBe(ADMIN2);
    const [row] = await auditRows();
    expect(row).toMatchObject({ userId: SUPER, resource: 'clinic', resourceId: String(CLINIC_B) });
    expect(row.metadata).toMatchObject({ previousAdminId: ADMIN1, newAdminId: ADMIN2 });
  });

  it('reports when the previous admin is left with no clinic', async () => {
    const res = await superCall(CLINIC_A, { newAdminId: ADMIN2 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ previousAdminId: ADMIN1, previousAdminClinicCount: 0 });
  });

  it('accepts a numeric string and a capability row with a broken length prefix', async () => {
    const res = await superCall(CLINIC_B, { newAdminId: String(ADMIN3) });
    expect(res.status).toBe(200);
    expect(await adminOf(CLINIC_B)).toBe(ADMIN3);
  });

  it('changes nothing and audits nothing when the admin is already in place', async () => {
    const before = (await auditRows()).length;
    const res = await superCall(CLINIC_B, { newAdminId: ADMIN3 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ unchanged: true, adminId: ADMIN3, previousAdminId: ADMIN3 });
    expect((await auditRows()).length).toBe(before);
  });

  it('the previous admin loses the clinic on their very next request', async () => {
    const req = new NextRequest('http://localhost/api/v1/practices', {
      headers: { authorization: `Bearer ${await token(ADMIN1_AUTH, 'CLINIC_ADMIN')}`, 'x-praktiqu-clinic-id': String(CLINIC_A) },
    });
    const res = await practicesGet(req);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('clinic_not_in_scope');
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/practice/change-admin.test.ts`
Expected: FAIL — `hands clinic B to another admin` mendapat 404 (lookup cuid lama), tes `not_a_clinic_admin` mendapat 404, beberapa tes 422 mendapat 404.

- [ ] **Step 3: Buat `src/repositories/wp/clinic-admins.repo.ts`**

```ts
/**
 * Clinic admin accounts as WordPress knows them: wp_users rows holding the
 * kiviCare_clinic_admin capability, and the clinics they own (wp_kc_clinics.clinic_admin_id).
 *
 * The capability is matched with LIKE, never unserialize(): live rows exist whose length
 * prefix is wrong, which unserialize() rejects (see roleLikePattern in wp-user.ts).
 */
import { prisma } from '@/lib/db';
import { CAPABILITIES_KEY, HAS_ROLE_SQL, KIVICARE_ROLES, roleLikePattern } from './wp-user';

/** Whether this WordPress user exists and holds the clinic admin capability. */
export async function isClinicAdminUser(wpUserId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) AS n FROM wp_users u WHERE u.ID = ? AND ${HAS_ROLE_SQL}`,
    wpUserId,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.clinicAdmin),
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** How many clinics name this user as their admin. */
export async function countOwnedClinics(wpUserId: bigint): Promise<number> {
  return prisma.kcClinic.count({ where: { clinicAdminId: wpUserId } });
}
```

- [ ] **Step 4: Ubah `src/services/practice/service.ts`**

Tambahkan import di blok import paling atas:

```ts
import { countOwnedClinics, isClinicAdminUser } from '@/repositories/wp/clinic-admins.repo';
```

Ganti seluruh fungsi `changePracticeAdmin` (sekitar baris 284-296) dengan:

```ts
/** `newAdminId` is not a WordPress account holding the kiviCare_clinic_admin capability. */
export class NotAClinicAdminError extends Error {
  constructor(public readonly wpUserId: number) {
    super(`WordPress user ${wpUserId} is not a clinic admin`);
    this.name = 'NotAClinicAdminError';
  }
}

export interface ChangePracticeAdminResult {
  clinicId: number;
  adminId: number;
  previousAdminId: number;
  /** Clinics the previous admin still owns after this change; 0 = they now hold none. */
  previousAdminClinicCount: number;
  /** True when `newAdminId` already was the admin: nothing was written or audited. */
  unchanged: boolean;
}

/**
 * Make `newAdminId` (a wp_users.ID) the admin of a clinic. A clinic has exactly one admin;
 * one admin may hold several clinics and picks one per request with X-Praktiqu-Clinic-Id.
 * The previous admin loses this clinic at once: their next request naming it gets 403.
 */
export async function changePracticeAdmin(
  practiceId: number,
  newAdminId: number,
  actorId: string,
): Promise<ChangePracticeAdminResult> {
  const clinic = await findClinicById(BigInt(practiceId));
  if (!clinic) throw new PracticeNotFoundError(practiceId);
  if (!(await isClinicAdminUser(BigInt(newAdminId)))) throw new NotAClinicAdminError(newAdminId);

  const previousAdminId = Number(clinic.clinicAdminId);
  const unchanged = previousAdminId === newAdminId;
  if (!unchanged) {
    // clinic_admin_id is outside UpdateClinicInput, which covers the contact fields, so
    // it is set explicitly rather than widening that type for one caller.
    const { prisma } = await import('@/lib/db');
    await prisma.$executeRawUnsafe(
      `UPDATE wp_kc_clinics SET clinic_admin_id = ? WHERE id = ?`,
      newAdminId,
      practiceId,
    );
    // userId is the caller's users.id (a cuid): log_entries.userId is a foreign key to
    // users.id, and logging swallows insert errors, so a wp_users.ID here would drop the row.
    await logging.audit('practice.admin_changed', {
      userId: actorId,
      resource: 'clinic',
      resourceId: String(practiceId),
      metadata: { previousAdminId, newAdminId },
    });
  }

  return {
    clinicId: practiceId,
    adminId: newAdminId,
    previousAdminId,
    previousAdminClinicCount: await countOwnedClinics(BigInt(previousAdminId)),
    unchanged,
  };
}
```

- [ ] **Step 5: Ganti seluruh isi `src/app/api/v1/practices/[id]/change-admin/route.ts`**

```ts
/**
 * POST /api/v1/practices/:id/change-admin — make a clinic admin the admin of this clinic.
 *
 * SUPER_ADMIN only. Body: `{ "newAdminId": <wp_users.ID> }`, a number or a numeric string,
 * whose account holds the kiviCare_clinic_admin capability. A clinic has exactly one admin
 * (wp_kc_clinics.clinic_admin_id); one admin may hold several clinics.
 *
 * This used to look `newAdminId` up as an auth cuid and then write Number(cuid) — NaN — into
 * clinic_admin_id, so it could not succeed with any input.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { forbidden } from '@/lib/problem-details';
import {
  changePracticeAdmin,
  NotAClinicAdminError,
  PracticeNotFoundError,
} from '@/services/practice/service';
import { logging } from '@/lib/logging';

/** A wp_users.ID / wp_kc_clinics.id small enough to survive Number(). */
const ID = /^[1-9][0-9]{0,14}$/;

const schema = z.object({
  newAdminId: z
    .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(ID)])
    .transform(Number),
});

const practiceNotFound = () =>
  NextResponse.json(
    { type: '/errors/resource-not-found', title: 'Practice not found', status: 404 },
    { status: 404 },
  );

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  if (actor.role !== 'SUPER_ADMIN') {
    return NextResponse.json(forbidden('Insufficient permissions'), { status: 403 });
  }
  if (!ID.test(String(params?.id ?? ''))) return practiceNotFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { type: '/errors/bad-request', title: 'Invalid JSON', status: 400 },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: '/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  try {
    const result = await changePracticeAdmin(Number(params.id), parsed.data.newAdminId, actor.id);
    return NextResponse.json({ message: 'Practice admin updated', data: result }, { status: 200 });
  } catch (err) {
    if (err instanceof PracticeNotFoundError) return practiceNotFound();
    if (err instanceof NotAClinicAdminError) {
      return NextResponse.json(
        {
          type: '/errors/validation-error',
          title: 'Not a clinic admin',
          status: 422,
          code: 'not_a_clinic_admin',
          detail: err.message,
        },
        { status: 422 },
      );
    }
    await logging.error('changePracticeAdmin failed', err, { path: `/api/v1/practices/${params.id}/change-admin` });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
});
```

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice/change-admin.test.ts tests/billing/practice-routes-scope.integration.test.ts`
Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/wp/clinic-admins.repo.ts src/services/practice/service.ts "src/app/api/v1/practices/[id]/change-admin/route.ts" tests/integration/practice/change-admin.test.ts
git commit -m "fix(practices): change-admin menerima wp_users.ID admin klinik, diaudit"
```

---

### Task B8: `GET /practices/clinic-admins` untuk super admin

**Files:**
- Modify: `src/repositories/wp/clinic-admins.repo.ts` (tambah `ClinicAdminRow`, `listClinicAdmins`)
- Create: `src/app/api/v1/practices/clinic-admins/route.ts`
- Test (baru): `tests/integration/practice/clinic-admins.test.ts`

**Interfaces:**
- Produces:
  - `export interface ClinicAdminRow { wpUserId: number; name: string; email: string; clinicIds: number[] }`
  - `export async function listClinicAdmins(): Promise<ClinicAdminRow[]>`
  - HTTP: `GET /api/v1/practices/clinic-admins` → `{ data: ClinicAdminRow[], total: number }` (SUPER_ADMIN; lainnya 403; tanpa token 401)

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/integration/practice/clinic-admins.test.ts`:

```ts
/**
 * GET /practices/clinic-admins — the accounts a super admin can make a clinic's admin.
 * Read from WordPress, so an admin created in KiviCare who has never logged in to the API
 * (no `users` row yet) is still offered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';
import { GET } from '@/app/api/v1/practices/clinic-admins/route';

const BASE = 8_620_000;
const END = BASE + 10_000;
const ADMIN_X = BASE + 500; // owns two clinics
const ADMIN_BROKEN = BASE + 501; // broken capability length prefix, owns none
const ADMIN_NONAME = BASE + 502; // empty display_name
const PATIENT = BASE + 503;
const CLINIC_1 = BASE + 1;
const CLINIC_2 = BASE + 2;
const SUPER = 'clinic-admins-test-super';
const ADMIN_AUTH = 'clinic-admins-test-admin';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');
const token = (sub: string, role: string) =>
  new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
const get = async (sub?: string, role?: string) =>
  GET(new NextRequest('http://localhost/api/v1/practices/clinic-admins', {
    headers: sub ? { authorization: `Bearer ${await token(sub, role!)}` } : {},
  }));

async function wpUser(id: number, displayName: string, capabilities: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: `u${id}@clinic-admins.test.local`, displayName, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: capabilities } });
}
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;

async function clinic(id: number, adminId: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`,
    id,
    `Klinik ${id}`,
    `k${id}@test.local`,
    adminId,
  );
}

async function wipe() {
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'clinic-admins-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(ADMIN_X, 'Admin Iks', caps('kiviCare_clinic_admin'));
  await wpUser(ADMIN_BROKEN, 'Admin Rusak', 'a:1:{s:15:"kiviCare_clinic_admin";b:1;}');
  await wpUser(ADMIN_NONAME, '', caps('kiviCare_clinic_admin'));
  await wpUser(PATIENT, 'Pasien', caps('kiviCare_patient'));
  await clinic(CLINIC_2, ADMIN_X);
  await clinic(CLINIC_1, ADMIN_X);
  for (const [id, role, wp] of [[SUPER, 'SUPER_ADMIN', null], [ADMIN_AUTH, 'CLINIC_ADMIN', ADMIN_X]] as const) {
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

type Row = { wpUserId: number; name: string; email: string; clinicIds: number[] };

describe('GET /practices/clinic-admins', () => {
  it('lists clinic admin accounts with the clinics they own', async () => {
    const res = await get(SUPER, 'SUPER_ADMIN');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Row[]; total: number };
    expect(body.total).toBe(body.data.length);
    expect(body.data.find((r) => r.wpUserId === ADMIN_X)).toEqual({
      wpUserId: ADMIN_X,
      name: 'Admin Iks',
      email: `u${ADMIN_X}@clinic-admins.test.local`,
      clinicIds: [CLINIC_1, CLINIC_2],
    });
  });

  it('includes an account whose capability row has a broken length prefix', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === ADMIN_BROKEN)).toMatchObject({ name: 'Admin Rusak', clinicIds: [] });
  });

  it('falls back to user_login for an empty display name', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === ADMIN_NONAME)?.name).toBe(`u${ADMIN_NONAME}`);
  });

  it('leaves out other roles', async () => {
    const body = (await (await get(SUPER, 'SUPER_ADMIN')).json()) as { data: Row[] };
    expect(body.data.find((r) => r.wpUserId === PATIENT)).toBeUndefined();
  });

  it('refuses a clinic admin with 403', async () => {
    expect((await get(ADMIN_AUTH, 'CLINIC_ADMIN')).status).toBe(403);
  });

  it('refuses a request without a token with 401', async () => {
    expect((await get()).status).toBe(401);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/integration/practice/clinic-admins.test.ts`
Expected: FAIL — modul route `clinic-admins/route` tidak ditemukan.

- [ ] **Step 3: Tambahkan ke `src/repositories/wp/clinic-admins.repo.ts`**

Tambahkan di akhir file:

```ts
export interface ClinicAdminRow {
  wpUserId: number;
  name: string;
  email: string;
  /** Clinics naming this user as their admin, by id. */
  clinicIds: number[];
}

/** Every clinic admin account, by name. */
export async function listClinicAdmins(): Promise<ClinicAdminRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ID: bigint; display_name: string | null; user_login: string; user_email: string; clinic_ids: string | null }>
  >(
    `SELECT u.ID, u.display_name, u.user_login, u.user_email,
            (SELECT GROUP_CONCAT(c.id ORDER BY c.id) FROM wp_kc_clinics c WHERE c.clinic_admin_id = u.ID) AS clinic_ids
       FROM wp_users u
      WHERE ${HAS_ROLE_SQL}
      ORDER BY COALESCE(NULLIF(TRIM(u.display_name), ''), u.user_login), u.ID`,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.clinicAdmin),
  );
  return rows.map((r) => ({
    wpUserId: Number(r.ID),
    name: (r.display_name ?? '').trim() || r.user_login,
    email: r.user_email,
    clinicIds: r.clinic_ids ? r.clinic_ids.split(',').map(Number) : [],
  }));
}
```

- [ ] **Step 4: Buat `src/app/api/v1/practices/clinic-admins/route.ts`**

```ts
/**
 * GET /api/v1/practices/clinic-admins — every account that can be made a clinic's admin.
 *
 * SUPER_ADMIN only. Read from WordPress (wp_users + the kiviCare_clinic_admin capability),
 * not from the auth `users` table: an admin created in KiviCare has no `users` row until
 * their first login, and must still be offered. The static segment wins over `[id]`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRoles } from '@/lib/auth/route-guards';
import { listClinicAdmins } from '@/repositories/wp/clinic-admins.repo';
import { logging } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireRoles(req, ['SUPER_ADMIN']);
  if ('response' in gate) return gate.response;

  try {
    const data = await listClinicAdmins();
    return NextResponse.json({ data, total: data.length }, { status: 200 });
  } catch (err) {
    await logging.error('listClinicAdmins failed', err, { path: '/api/v1/practices/clinic-admins' });
    return NextResponse.json(
      { type: '/errors/internal', title: 'Internal Server Error', status: 500 },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `npx vitest run tests/integration/practice/clinic-admins.test.ts tests/integration/practice/change-admin.test.ts`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/wp/clinic-admins.repo.ts src/app/api/v1/practices/clinic-admins/route.ts tests/integration/practice/clinic-admins.test.ts
git commit -m "feat(practices): GET /practices/clinic-admins untuk memilih admin klinik"
```

---

### Task B9: Dokumentasi kontrak di `docs/api/PRACTICES-AND-SERVICES-GUIDE.md`

**Files:**
- Modify: `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (§2, §4.1, §4.11, tambah §4.17, §9 baris 3)

(`openapi.yaml` di root repo adalah spec API plugin KiviCare, **bukan** `/api/v1` — jangan disentuh.)

- [ ] **Step 1: §2 Autentikasi — tambahkan di akhir bagian (sebelum `---` yang menutup §2)**

```markdown
### Klinik aktif (admin yang memegang beberapa klinik)

Sejak 2026-10, satu `CLINIC_ADMIN` boleh memegang beberapa klinik (beberapa baris
`wp_kc_clinics` dengan `clinic_admin_id` yang sama). Respons login dan `GET /auth/me`
untuk CLINIC_ADMIN membawa daftarnya, klinik default lebih dulu:

```json
{ "user": { "role": "CLINIC_ADMIN", "clinicId": 4,
            "clinics": [ { "id": 4, "name": "Klinik A", "active": true },
                         { "id": 20, "name": "Klinik B", "active": true } ] } }
```

Pilih klinik untuk satu request dengan header **`X-Praktiqu-Clinic-Id: <id>`**. Tanpa header =
klinik default (`clinicId`). Header hanya dibaca untuk CLINIC_ADMIN; role lain mengabaikannya.

| Kasus | Jawaban |
|---|---|
| Format bukan bilangan bulat positif | 400, body memuat `invalid_clinic_header` |
| Klinik bukan milik admin ini, atau tidak ada | 403, body memuat `clinic_not_in_scope` |

Setiap endpoint ter-scope (daftar, detail, bills, pasien, laporan, pengaturan pembayaran)
mengikuti klinik aktif ini. Klinik di luar klinik aktif tetap 404 seperti biasa.
```

- [ ] **Step 2: §4.1 — tambahkan satu paragraf di akhir subbagian**

```markdown
> CLINIC_ADMIN hanya melihat **klinik aktifnya** (header `X-Praktiqu-Clinic-Id`, atau klinik
> default bila tanpa header) — satu baris, walau ia memegang beberapa klinik. Daftar lengkap
> klinik miliknya ada di `user.clinics` respons `/auth/me` (§2).
```

- [ ] **Step 3: Ganti seluruh §4.11 dengan**

```markdown
### 4.11 `POST /api/v1/practices/{id}/change-admin` — SUPER_ADMIN

Menjadikan seorang admin klinik sebagai admin klinik `{id}`. Satu klinik punya satu admin;
satu admin boleh memegang beberapa klinik. Admin lama kehilangan klinik ini seketika.

Body: `{ "newAdminId": 911 }` — `wp_users.ID` (angka atau string angka) yang punya
capability `kiviCare_clinic_admin`.

| Kasus | Jawaban |
|---|---|
| Bukan SUPER_ADMIN | 403 |
| Klinik tidak ada / id bukan angka | 404 |
| Body bukan JSON | 400 |
| `newAdminId` hilang/tidak sah | 422 |
| Akun bukan admin klinik / tidak ada | 422, `code: "not_a_clinic_admin"` |

Sukses (200):

```json
{ "message": "Practice admin updated",
  "data": { "clinicId": 20, "adminId": 911, "previousAdminId": 512,
            "previousAdminClinicCount": 0, "unchanged": false } }
```

`previousAdminClinicCount` = jumlah klinik yang masih dipegang admin lama; `0` berarti ia
kini tidak memegang klinik apa pun. `unchanged: true` = akun itu sudah admin klinik ini
(tidak ada yang ditulis, tidak ada audit). Perubahan dicatat di audit log
`practice.admin_changed`.
```

- [ ] **Step 4: Tambahkan subbagian baru setelah §4.16 (sebelum `## 5.`)**

```markdown
### 4.17 `GET /api/v1/practices/clinic-admins` — SUPER_ADMIN

Semua akun WordPress yang ber-capability `kiviCare_clinic_admin`, urut nama — termasuk yang
belum pernah login ke API.

```json
{ "data": [ { "wpUserId": 911, "name": "Admin Satu", "email": "a@klinik.co", "clinicIds": [4, 20] } ],
  "total": 1 }
```

`clinicIds` = klinik yang `clinic_admin_id`-nya akun ini. Role lain: 403.
```

- [ ] **Step 5: §9 — ganti baris tabel nomor 3**

Ganti:

```markdown
| 3 | `change-admin` mencampur id cuid dan integer (§4.11) | Endpoint gagal untuk input apa pun |
```

dengan:

```markdown
| 3 | ~~`change-admin` mencampur id cuid dan integer~~ — **diperbaiki 2026-10** (§4.11) | — |
```

- [ ] **Step 6: Commit**

```bash
git add docs/api/PRACTICES-AND-SERVICES-GUIDE.md
git commit -m "docs(api): klinik aktif, change-admin yang diperbaiki, daftar admin klinik"
```

---

### Task B10: Verifikasi penuh backend, push, dan link PR

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Seluruh suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: tidak ada tes gagal yang **baru**. Untuk membandingkan, jalankan suite yang sama di `origin/main` (mis. di worktree sementara) kalau ada kegagalan; laporkan setiap kegagalan yang hanya muncul di branch ini dan perbaiki sebelum lanjut.

- [ ] **Step 2: Typecheck dan lint**

```bash
npx tsc --noEmit -p . 2>&1 | tail -5
npm run lint 2>&1 | tail -15
```

Expected: tidak ada error baru di file yang disentuh fitur ini.

- [ ] **Step 3: Pastikan tidak ada operasi skema**

```bash
git diff origin/main --stat -- prisma/
```

Expected: tidak ada output (skema Prisma tidak berubah).

- [ ] **Step 4: Push (dengan konfirmasi pemilik repo dulu)**

Minta izin user sebelum push. Lalu:

```bash
git push --dry-run origin feat/multi-klinik:refs/heads/feat/multi-klinik
git push origin feat/multi-klinik:refs/heads/feat/multi-klinik
```

- [ ] **Step 5: Buat link PR yang sudah terisi (tidak ada `gh` di mesin ini)**

```bash
python3 - <<'EOF'
import urllib.parse
title = "feat: admin klinik multi-klinik (klinik aktif) — backend"
body = """Spec: docs/superpowers/specs/2026-10-13-admin-multi-klinik-design.md
Rencana: docs/superpowers/plans/2026-10-14-admin-multi-klinik.md (Part B)

- Header `X-Praktiqu-Clinic-Id` divalidasi di `getActor()`; `resolveKcActor()` memakai klinik aktif.
- Daftar klinik admin dari `wp_kc_clinics.clinic_admin_id` (aktif dulu, id naik); cadangan mapping dokter.
- `/auth/me` & login: `clinics` untuk CLINIC_ADMIN.
- Pasien multi-klinik bisa dibuka dari klinik mana pun miliknya.
- `change-admin` diperbaiki (wp_users.ID, diaudit) + `GET /practices/clinic-admins`.
- Tanpa perubahan skema, tanpa perubahan plugin. Kompatibel ke belakang: tanpa header = perilaku lama.

**Sebelum deploy:** jalankan gerbang data (spec Lampiran A) — admin yang punya mapping dokter berbeda dari klinik miliknya akan berganti klinik default."""
print("https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/multi-klinik?expand=1&title="
      + urllib.parse.quote(title) + "&body=" + urllib.parse.quote(body))
EOF
```

Berikan URL itu ke user. **User yang membuka dan me-merge PR.**

---

## Part F — FE Laravel (`raakanaka/laravel-praktiqu`)

Semua perintah di Part F dijalankan dari `/home/ahmad/projects/praktiqu-fe/multi-klinik` kecuali disebut lain. Singkatan di bawah:

```bash
# Jalankan PHPUnit (Docker Desktop harus menyala)
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter NamaTes
# Commit (repo FE tidak punya git identity)
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "..."
```

Part F tidak bergantung pada backend yang sudah ter-deploy: semua tes memalsukan backend dengan `Http::fake`. Kontrak yang dipalsukan ada di spec bagian "Kontrak ringkas".

### Task F0: Siapkan worktree FE dan pastikan tes dasar hijau

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Buat worktree dari `origin/main`**

```bash
cd /home/ahmad/projects/praktiqu-fe/main
git fetch origin
git worktree add -b feat/multi-klinik ../multi-klinik origin/main
cd ../multi-klinik
git log --oneline -1
```

Expected: commit teratas = `origin/main` terbaru. (`core.sshCommand` dengan key `~/.ssh/id_ed25519_praktiqu_fe` sudah diatur di clone `main` dan berlaku untuk worktree.)

- [ ] **Step 2: Env dan dependency**

```bash
cp ../main/.env .env
mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app -e COMPOSER_ALLOW_SUPERUSER=1 composer:2 install --no-scripts
git status --short
```

Expected: `git status --short` kosong (`.env` dan `vendor/` di-ignore).

- [ ] **Step 3: Seluruh suite sebelum mengubah apa pun**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`
Expected: semua lulus. Catat jumlah tes (baris `OK (N tests, M assertions)`). Kalau ada yang gagal di sini, berhenti dan laporkan.

---

### Task F1: Daftar klinik admin disimpan di profil sesi saat login

**Files:**
- Modify: `app/Http/Controllers/AuthController.php` (tambah method `klinikMilik`; di `login()` setelah baris `$profile['canManageClinicPayment'] = ...`)
- Test (baru): `tests/Feature/KlinikAktifLoginTest.php`

**Interfaces:**
- Consumes (backend): `user.clinics: [{id:int, name:string, active:bool}]` di `/auth/me` — hanya untuk CLINIC_ADMIN.
- Produces: `pq_profile['clinics']` = `list<array{id:int, name:string, active:bool}>`, hanya ada untuk role `admin` yang backend-nya mengirim `clinics`. `practiceId` tidak berubah cara pengisiannya.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikAktifLoginTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

// Admin klinik yang memegang beberapa klinik: daftar kliniknya (`clinics` dari
// /auth/me) disimpan di profil sesi saat login, untuk dropdown klinik aktif.
// PROFILE_VERSION sengaja TIDAK naik — menaikkannya me-logout semua staf; sesi
// lama tanpa `clinics` tetap sah, hanya tanpa dropdown sampai login berikutnya.
class KlinikAktifLoginTest extends TestCase
{
    private function masukSebagai(array $userMe): array
    {
        Http::fake(function ($req) use ($userMe) {
            if (str_contains($req->url(), 'auth/me')) {
                return Http::response(['user' => $userMe]);
            }

            return Http::response([
                'accessToken' => 'tok_123',
                'refreshToken' => 'ref_123',
                'user' => ['id' => $userMe['id'], 'email' => $userMe['email'], 'role' => $userMe['role'], 'clinicId' => $userMe['clinicId'] ?? null],
            ]);
        });

        $this->post('/staff/login', ['email' => $userMe['email'], 'password' => 'secret']);

        return Session::get(PraktiquApi::PROFILE_KEY);
    }

    public function test_daftar_klinik_admin_disimpan_di_profil(): void
    {
        $profil = $this->masukSebagai([
            'id' => 'cuid1', 'email' => 'admin@klinik.co', 'displayName' => 'Admin Dua Klinik',
            'role' => 'CLINIC_ADMIN', 'clinicId' => 4,
            'clinics' => [
                ['id' => 4, 'name' => 'Klinik A', 'active' => true],
                ['id' => 20, 'name' => 'Klinik B', 'active' => false],
            ],
        ]);

        $this->assertSame(5, AuthController::PROFILE_VERSION);
        $this->assertSame(5, $profil['v']);
        $this->assertSame('admin', $profil['role']);
        $this->assertSame(4, $profil['practiceId']);
        $this->assertSame([
            ['id' => 4, 'name' => 'Klinik A', 'active' => true],
            ['id' => 20, 'name' => 'Klinik B', 'active' => false],
        ], $profil['clinics']);
    }

    public function test_resepsionis_tidak_mendapat_daftar_klinik(): void
    {
        $profil = $this->masukSebagai(['id' => 'cuid2', 'email' => 'r@klinik.co', 'role' => 'RECEPTIONIST', 'clinicId' => 4]);

        $this->assertSame('admin', $profil['role']);
        $this->assertSame(4, $profil['practiceId']);
        $this->assertArrayNotHasKey('clinics', $profil);
    }

    public function test_isian_klinik_yang_rusak_dibuang_satu_per_satu(): void
    {
        $profil = $this->masukSebagai([
            'id' => 'cuid1', 'email' => 'admin@klinik.co', 'role' => 'CLINIC_ADMIN', 'clinicId' => 4,
            'clinics' => [
                ['id' => 4, 'name' => 'Klinik A', 'active' => true],
                ['id' => 'abc', 'name' => 'Rusak'],
                ['id' => 0, 'name' => 'Nol'],
                'bukan-larik',
                ['id' => '20', 'name' => '  ', 'active' => true],
                ['id' => 31, 'name' => 'Tanpa Flag'],
            ],
        ]);

        $this->assertSame([
            ['id' => 4, 'name' => 'Klinik A', 'active' => true],
            ['id' => 20, 'name' => 'Klinik #20', 'active' => true],
            ['id' => 31, 'name' => 'Tanpa Flag', 'active' => true],
        ], $profil['clinics']);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikAktifLoginTest`
Expected: FAIL — `Undefined array key "clinics"` di tes pertama dan ketiga; tes resepsionis PASS.

- [ ] **Step 3: Implementasi**

Di `app/Http/Controllers/AuthController.php`, tambahkan method ini tepat setelah method `kelolaPembayaranKlinik()`:

```php
    // Klinik yang dipegang admin klinik (`clinics` dari /auth/me), untuk dropdown
    // klinik aktif — lihat KlinikAktifController. Backend hanya mengirimnya untuk
    // CLINIC_ADMIN, klinik default lebih dulu. Isian yang bentuknya tidak sah
    // dibuang satu per satu: satu baris rusak tidak boleh menghapus seluruh
    // daftar. null = backend tidak mengirim daftar sama sekali (role lain, atau
    // backend versi lama).
    private static function klinikMilik(?array $u): ?array
    {
        $raw = $u['clinics'] ?? null;
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
            $out[] = [
                'id' => $id,
                'name' => $nama !== '' ? $nama : 'Klinik #'.$id,
                'active' => (bool) ($c['active'] ?? true),
            ];
        }

        return $out;
    }
```

Di `login()`, tepat **setelah** blok:

```php
        $profile['canManageClinicPayment'] = self::kelolaPembayaranKlinik(
            is_array($meUser) && $this->roleOf($meUser) !== null ? $meUser : $user
        );
```

tambahkan:

```php
        // Daftar klinik untuk dropdown klinik aktif, dari user yang sama dengan
        // flag di atas. Resepsionis juga ber-role 'admin', tapi backend tidak
        // mengirim `clinics` untuknya, jadi ia tidak mendapat dropdown.
        $klinik = self::klinikMilik(is_array($meUser) && $this->roleOf($meUser) !== null ? $meUser : $user);
        if ($profile['role'] === 'admin' && $klinik !== null) {
            $profile['clinics'] = $klinik;
        }
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikAktifLoginTest|KelolaPembayaranLoginTest|StaffScopeLookupTest|StaffLoginRoleTest'`
Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/AuthController.php tests/Feature/KlinikAktifLoginTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(auth): simpan daftar klinik admin klinik di profil sesi"
```

---

### Task F2: Header `X-Praktiqu-Clinic-Id` di setiap panggilan backend

**Files:**
- Modify: `app/Services/PraktiquApi.php` (method baru `headerKlinikAktif`; `dispatch()` sekitar baris 157-171)
- Modify: `app/Http/Controllers/AuthController.php` (di `login()`, sebelum `$res = $this->api->post('api/v1/auth/login', $cred);`)
- Modify: `app/Http/Controllers/EncounterDocumentController.php` (dua baris `->withHeaders(PraktiquApi::headerIpKlien())`, sekitar baris 102 dan 162)
- Test (baru): `tests/Feature/HeaderKlinikAktifTest.php`

**Interfaces:**
- Consumes: `pq_profile['role']`, `pq_profile['practiceId']`.
- Produces: `public static function headerKlinikAktif(): array` → `['X-Praktiqu-Clinic-Id' => '<id>']` atau `[]`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/HeaderKlinikAktifTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Klinik aktif dikirim ke backend sebagai X-Praktiqu-Clinic-Id di SETIAP
// panggilan sesi admin. Backend memvalidasi dan men-scope semua data ke klinik
// itu; tanpa header ia memakai klinik default.
class HeaderKlinikAktifTest extends TestCase
{
    private function sesi(string $role, array $extra = []): void
    {
        Session::put(PraktiquApi::TOKEN_KEY, 'tok');
        Session::put(PraktiquApi::PROFILE_KEY, array_merge(
            ['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'],
            $extra,
        ));
    }

    private function panggil(): void
    {
        Http::fake(['*' => Http::response(['data' => []], 200)]);
        app(PraktiquApi::class)->get('api/v1/practices');
    }

    public function test_admin_mengirim_klinik_aktifnya(): void
    {
        $this->sesi('admin', ['practiceId' => 20]);
        $this->panggil();

        Http::assertSent(fn (Request $r) => $r->header('X-Praktiqu-Clinic-Id') === ['20']);
    }

    public function test_practice_id_berupa_string_angka_juga_dikirim(): void
    {
        $this->sesi('admin', ['practiceId' => '20']);
        $this->panggil();

        Http::assertSent(fn (Request $r) => $r->header('X-Praktiqu-Clinic-Id') === ['20']);
    }

    #[DataProvider('tanpaHeader')]
    public function test_tidak_ada_header(string $role, array $extra): void
    {
        $this->sesi($role, $extra);
        $this->panggil();

        Http::assertSent(fn (Request $r) => ! $r->hasHeader('X-Praktiqu-Clinic-Id'));
    }

    public static function tanpaHeader(): array
    {
        return [
            'super admin' => ['super', ['practiceId' => 20]],
            'psikolog' => ['psikolog', ['practiceId' => 20, 'professionalId' => 7]],
            'admin tanpa klinik' => ['admin', []],
            'practiceId bukan angka' => ['admin', ['practiceId' => 'abc']],
            'practiceId nol' => ['admin', ['practiceId' => 0]],
        ];
    }

    public function test_panggilan_publik_tanpa_token_tidak_membawa_header(): void
    {
        $this->sesi('admin', ['practiceId' => 20]);
        Http::fake(['*' => Http::response(['data' => []], 200)]);

        app(PraktiquApi::class)->getPublic('api/v1/public/practices');

        Http::assertSent(fn (Request $r) => ! $r->hasHeader('X-Praktiqu-Clinic-Id'));
    }

    // Login di atas sesi lama: klinik milik akun sebelumnya tidak boleh ikut
    // terkirim bersama token akun baru (backend akan menjawab 403).
    public function test_login_tidak_membawa_klinik_dari_sesi_sebelumnya(): void
    {
        $user = ['id' => 'c', 'email' => 'a@klinik.co', 'role' => 'CLINIC_ADMIN', 'clinicId' => 4];
        Http::fake(function ($req) use ($user) {
            return str_contains($req->url(), 'auth/me')
                ? Http::response(['user' => $user])
                : Http::response(['accessToken' => 'tok_baru', 'refreshToken' => 'r', 'user' => $user]);
        });

        $this->withSession([
            PraktiquApi::TOKEN_KEY => 'tok_lama',
            PraktiquApi::PROFILE_KEY => ['v' => AuthController::PROFILE_VERSION, 'role' => 'admin', 'name' => 'Lama', 'practiceId' => 99],
        ])->post('/staff/login', ['email' => 'a@klinik.co', 'password' => 'secret']);

        Http::assertNotSent(fn (Request $r) => $r->hasHeader('X-Praktiqu-Clinic-Id'));
        $this->assertSame(4, Session::get(PraktiquApi::PROFILE_KEY)['practiceId']);
    }

    // EncounterDocumentController memanggil Http:: langsung (lewat kirimMentah),
    // bukan lewat dispatch(), jadi headernya harus ditambahkan sendiri.
    public function test_pratinjau_dokumen_juga_membawa_klinik_aktif(): void
    {
        Http::fake(['*' => Http::response('%PDF-1.4', 200, ['Content-Type' => 'application/pdf'])]);

        $this->withSession([
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => ['v' => AuthController::PROFILE_VERSION, 'role' => 'admin', 'name' => 'Staf', 'practiceId' => 20],
        ])->get('/dashboard/encounters/documents/content?path='.urlencode('/api/v1/patient-medical-reports/5/content'));

        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'patient-medical-reports/5/content')
            && $r->header('X-Praktiqu-Clinic-Id') === ['20']);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter HeaderKlinikAktifTest`
Expected: FAIL di `test_admin_mengirim_klinik_aktifnya`, `test_practice_id_berupa_string_angka_juga_dikirim`, `test_login_tidak_membawa_klinik_dari_sesi_sebelumnya` (gagal karena profil lama — **baru gagal setelah Step 3a**, lihat catatan), dan `test_pratinjau_dokumen_juga_membawa_klinik_aktif`. Tes `tanpaHeader` dan publik sudah PASS.

Catatan: tes login baru benar-benar menguji sesuatu setelah header ada; sebelum Step 3a ia PASS karena memang belum ada header sama sekali. Itu wajar.

- [ ] **Step 3a: Tambah `headerKlinikAktif()` dan pakai di `dispatch()`**

Di `app/Services/PraktiquApi.php`, tambahkan tepat setelah method `headerIpKlien()`:

```php
    /**
     * Klinik aktif admin klinik, untuk backend: X-Praktiqu-Clinic-Id.
     *
     * Admin klinik boleh memegang beberapa klinik dan memilih satu yang aktif
     * (KlinikAktifController). Backend memvalidasi header ini di setiap request
     * dan men-scope semua data ke klinik itu; tanpa header ia memakai klinik
     * default — perilaku sebelum fitur ini.
     *
     * Dikirim untuk setiap sesi role 'admin' yang punya practiceId. Resepsionis
     * juga 'admin' di FE ini; backend mengabaikan header itu untuk mereka, jadi
     * tidak perlu dibedakan di sini.
     *
     * @return array<string, string>
     */
    public static function headerKlinikAktif(): array
    {
        $p = Session::get(self::PROFILE_KEY);
        if (! is_array($p) || ($p['role'] ?? null) !== 'admin') {
            return [];
        }
        $id = $p['practiceId'] ?? null;
        if (is_int($id)) {
            $id = (string) $id;
        }

        return is_string($id) && preg_match('/^[1-9][0-9]{0,18}$/', $id) === 1
            ? ['X-Praktiqu-Clinic-Id' => $id]
            : [];
    }
```

Di `dispatch()`, ganti baris:

```php
        $req = Http::connectTimeout(10)->timeout(30)->acceptJson()->withHeaders(self::headerIpKlien() + $headers);
```

dengan:

```php
        // Header klinik hanya untuk panggilan yang membawa sesi staf: tanpa bearer
        // (postPublic/getPublic) backend tidak tahu admin siapa yang memilihnya.
        $req = Http::connectTimeout(10)->timeout(30)->acceptJson()
            ->withHeaders(self::headerIpKlien() + ($bearer ? self::headerKlinikAktif() : []) + $headers);
```

- [ ] **Step 3b: Buang profil lama sebelum login**

Di `app/Http/Controllers/AuthController.php` method `login()`, tepat **sebelum** baris:

```php
        try {
            $res = $this->api->post('api/v1/auth/login', $cred);
```

tambahkan:

```php
        // Profil sesi sebelumnya (kalau ada) dibuang dulu: PraktiquApi menurunkan
        // header klinik aktif dari profil itu, dan klinik milik akun lama tidak
        // boleh ikut terkirim bersama login akun baru.
        Session::forget(PraktiquApi::PROFILE_KEY);
```

- [ ] **Step 3c: Jalur `Http::` mentah di `EncounterDocumentController`**

Di `app/Http/Controllers/EncounterDocumentController.php` ada **dua** baris:

```php
            ->withHeaders(PraktiquApi::headerIpKlien())
```

Ganti keduanya dengan:

```php
            ->withHeaders(PraktiquApi::headerIpKlien() + PraktiquApi::headerKlinikAktif())
```

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'HeaderKlinikAktifTest|KlinikAktifLoginTest|KelolaPembayaranLoginTest|EncounterDocument'`
Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/PraktiquApi.php app/Http/Controllers/AuthController.php app/Http/Controllers/EncounterDocumentController.php tests/Feature/HeaderKlinikAktifTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(api): kirim klinik aktif sebagai X-Praktiqu-Clinic-Id"
```

---

### Task F3: Klinik aktif ditolak backend → sesi diakhiri

**Files:**
- Create: `app/Services/KlinikTidakBerlakuException.php`
- Modify: `app/Services/PraktiquApi.php` (di `call()`, awal blok `if (! $res->successful()) {`; method privat baru `klinikDitolak`)
- Modify: `bootstrap/app.php` (blok `withExceptions`)
- Test (baru): `tests/Feature/KlinikDicabutTest.php`

**Interfaces:**
- Consumes (backend): status 400/403 dengan body yang memuat `clinic_not_in_scope` atau `invalid_clinic_header` (di `error`, `code`, atau `detail`, tergantung route).
- Produces: `App\Services\KlinikTidakBerlakuException` (konstanta `PESAN`). Non-JSON → redirect ke portal login dengan error `sesi`; JSON → 401 `{message, sesiHabis: true, login}`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/KlinikDicabutTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Super admin bisa memindahkan klinik dari seorang admin kapan saja. Sesi admin
// itu masih menyimpan klinik lama sebagai klinik aktif, dan backend menolaknya
// (403 clinic_not_in_scope). Data apa pun yang dimuat setelah itu akan salah
// klinik, jadi sesinya diakhiri dan ia masuk lagi untuk mendapat daftar baru.
class KlinikDicabutTest extends TestCase
{
    private const URL = '/dashboard/klinik/4/pembayaran-internasional';

    private function adminKlinik(): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => [
                'v' => AuthController::PROFILE_VERSION, 'role' => 'admin', 'name' => 'Admin',
                'practiceId' => 4, 'canManageClinicPayment' => true,
                'clinics' => [['id' => 4, 'name' => 'Klinik A', 'active' => true]],
            ],
        ];
    }

    #[DataProvider('penolakan')]
    public function test_klinik_yang_ditolak_backend_mengakhiri_sesi(int $status, array $body): void
    {
        Http::fake(['*' => Http::response($body, $status)]);

        $res = $this->withSession($this->adminKlinik())->get(self::URL);

        $res->assertRedirect(AuthController::PORTAL_PATH['staff']);
        $res->assertSessionHasErrors(['sesi']);
        $this->assertFalse(Session::has(PraktiquApi::TOKEN_KEY));
        $this->assertFalse(Session::has(PraktiquApi::PROFILE_KEY));
    }

    public static function penolakan(): array
    {
        return [
            'withAuth 403' => [403, ['error' => 'clinic_not_in_scope']],
            'problem+json 403' => [403, ['type' => 'about:blank', 'title' => 'Forbidden', 'status' => 403, 'code' => 'clinic_not_in_scope']],
            'header rusak 400' => [400, ['type' => 'about:blank', 'status' => 400, 'code' => 'invalid_clinic_header']],
        ];
    }

    public function test_permintaan_json_mendapat_401_yang_dikenali_dashboard(): void
    {
        Http::fake(['*' => Http::response(['error' => 'clinic_not_in_scope'], 403)]);

        $res = $this->withSession($this->adminKlinik())->putJson(self::URL, ['international' => false]);

        $res->assertStatus(401);
        $res->assertJson(['message' => 'Akses klinik Anda berubah. Silakan masuk lagi.', 'sesiHabis' => true]);
        $this->assertFalse(Session::has(PraktiquApi::TOKEN_KEY));
    }

    public function test_403_biasa_tidak_mengakhiri_sesi(): void
    {
        Http::fake(['*' => Http::response(['type' => 'about:blank', 'status' => 403, 'code' => 'forbidden'], 403)]);

        $this->withSession($this->adminKlinik())->get(self::URL)->assertNotFound();

        $this->assertTrue(Session::has(PraktiquApi::TOKEN_KEY));
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter KlinikDicabutTest`
Expected: FAIL — halaman menjawab 404 (perilaku `ApiException` 403 biasa) dan sesi masih ada; `test_403_biasa_tidak_mengakhiri_sesi` sudah PASS.

- [ ] **Step 3: Buat `app/Services/KlinikTidakBerlakuException.php`**

```php
<?php

namespace App\Services;

// Backend menolak klinik aktif sesi ini (clinic_not_in_scope /
// invalid_clinic_header) — lihat PraktiquApi::call(). Sesinya sudah
// dibersihkan saat ini dilempar; bootstrap/app.php memulangkan pengguna ke
// halaman masuk.
//
// Sengaja BUKAN turunan ApiException: puluhan controller menangkap
// ApiException lalu menampilkan galat biasa, dan itu akan menelan sinyal ini.
class KlinikTidakBerlakuException extends \RuntimeException
{
    public const PESAN = 'Akses klinik Anda berubah. Silakan masuk lagi.';

    public function __construct()
    {
        parent::__construct(self::PESAN);
    }
}
```

- [ ] **Step 4: Deteksi di `PraktiquApi::call()`**

Di `call()`, ubah awal blok

```php
        if (! $res->successful()) {
            $msg = is_array($json)
```

menjadi

```php
        if (! $res->successful()) {
            // Backend menolak klinik aktif sesi ini: admin dicabut dari klinik itu
            // (super admin memindahkannya), atau profil menyimpan klinik yang bukan
            // miliknya lagi. Dicek dari body mentah karena kodenya bisa ada di
            // `error`, `code`, atau `detail`, tergantung pembungkus route backend.
            if (in_array($res->status(), [400, 403], true) && self::klinikDitolak((string) $res->body())) {
                logger()->info('[praktiqu-api] klinik aktif ditolak backend; sesi diakhiri', [
                    'path' => $path, 'status' => $res->status(),
                ]);
                $this->clearSession();
                throw new KlinikTidakBerlakuException;
            }

            $msg = is_array($json)
```

Tambahkan method privat di kelas yang sama (mis. tepat setelah `clearSession()`):

```php
    private static function klinikDitolak(string $body): bool
    {
        return str_contains($body, 'clinic_not_in_scope') || str_contains($body, 'invalid_clinic_header');
    }
```

(`KlinikTidakBerlakuException` berada di namespace yang sama, `App\Services`, jadi tidak perlu `use`.)

- [ ] **Step 5: Render di `bootstrap/app.php`**

Di dalam `->withExceptions(function (Exceptions $exceptions): void {`, tambahkan **setelah** blok render 419 yang sudah ada:

```php
        // Klinik aktif admin ditolak backend (lihat PraktiquApi::call). Sesinya
        // sudah dibersihkan; di sini hanya cara memulangkannya. AJAX mendapat 401
        // + sesiHabis, yang sudah dikenali pembungkus fetch dashboard (banner
        // "Sesi Anda berakhir"); navigasi biasa ke portal masuk dengan penjelasan.
        $exceptions->dontReport(\App\Services\KlinikTidakBerlakuException::class);
        $exceptions->render(function (\App\Services\KlinikTidakBerlakuException $e, Request $request) {
            $login = \App\Http\Controllers\AuthController::loginPathUntuk($request);
            if ($request->expectsJson()) {
                return response()->json(['message' => $e->getMessage(), 'sesiHabis' => true, 'login' => $login], 401);
            }

            return redirect($login)->withErrors(['sesi' => $e->getMessage()]);
        });
```

Catatan: controller yang menangkap `\Throwable` (mis. `DashboardController::services`) akan menelan exception ini. Itu dapat diterima: sesinya sudah dibersihkan sebelum exception dilempar, jadi aksi berikutnya mendapat 401/redirect login dari `StaffAuth`.

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'KlinikDicabutTest|PengaturanPembayaranKlinikTest|HeaderKlinikAktifTest'`
Expected: semua PASS.

- [ ] **Step 7: Commit**

```bash
git add app/Services/KlinikTidakBerlakuException.php app/Services/PraktiquApi.php bootstrap/app.php tests/Feature/KlinikDicabutTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(api): akhiri sesi saat backend menolak klinik aktif"
```

---

### Task F4: `POST /dashboard/klinik-aktif` — pindah klinik

**Files:**
- Create: `app/Http/Controllers/KlinikAktifController.php`
- Modify: `routes/web.php` (tepat setelah baris `Route::get('/psikolog', ...)`, baris 77)
- Test (baru): `tests/Feature/GantiKlinikAktifTest.php`

**Interfaces:**
- Consumes: `pq_profile['clinics']` (Task F1).
- Produces: route bernama `klinik.aktif` (`POST /dashboard/klinik-aktif`, field `clinicId`). Sukses → `pq_profile['practiceId']` = klinik pilihan; redirect `/klinik` (JSON: `{ok: true, practiceId}`). Klinik di luar daftar → 422.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/GantiKlinikAktifTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Session;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Pindah klinik aktif: hanya ke klinik yang ada di daftar klinik admin itu
// sendiri (pq_profile.clinics). Backend memvalidasi lagi di setiap request;
// pemeriksaan di sini supaya pilihan yang mustahil tidak sempat tersimpan.
class GantiKlinikAktifTest extends TestCase
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

    private function adminDuaKlinik(): array
    {
        return $this->sesi('admin', [
            'practiceId' => 4,
            'canManageClinicPayment' => true,
            'clinics' => [
                ['id' => 4, 'name' => 'Klinik A', 'active' => true],
                ['id' => 20, 'name' => 'Klinik B', 'active' => true],
            ],
        ]);
    }

    public function test_admin_berpindah_ke_klinik_miliknya(): void
    {
        $res = $this->withSession($this->adminDuaKlinik())->post('/dashboard/klinik-aktif', ['clinicId' => '20']);

        $res->assertRedirect('/klinik');
        $p = Session::get(PraktiquApi::PROFILE_KEY);
        $this->assertSame(20, $p['practiceId']);
        // Kunci lain profil tidak boleh hilang.
        $this->assertTrue($p['canManageClinicPayment']);
        $this->assertSame(AuthController::PROFILE_VERSION, $p['v']);
        $this->assertCount(2, $p['clinics']);
    }

    public function test_jawaban_json(): void
    {
        $this->withSession($this->adminDuaKlinik())
            ->postJson('/dashboard/klinik-aktif', ['clinicId' => 20])
            ->assertOk()
            ->assertJson(['ok' => true, 'practiceId' => 20]);
    }

    #[DataProvider('pilihanTidakSah')]
    public function test_klinik_di_luar_daftar_ditolak(mixed $clinicId): void
    {
        $this->withSession($this->adminDuaKlinik())
            ->postJson('/dashboard/klinik-aktif', ['clinicId' => $clinicId])
            ->assertStatus(422);

        $this->assertSame(4, Session::get(PraktiquApi::PROFILE_KEY)['practiceId']);
    }

    public static function pilihanTidakSah(): array
    {
        return ['klinik orang lain' => [99], 'bukan angka' => ['abc'], 'nol' => [0], 'kosong' => [null]];
    }

    // Resepsionis juga ber-role 'admin', tapi tidak punya `clinics`.
    public function test_resepsionis_tidak_bisa_berpindah(): void
    {
        $this->withSession($this->sesi('admin', ['practiceId' => 4]))
            ->postJson('/dashboard/klinik-aktif', ['clinicId' => 4])
            ->assertStatus(422);
    }

    public function test_psikolog_ditolak_middleware(): void
    {
        $this->withSession($this->sesi('psikolog', ['professionalId' => 7]))
            ->post('/dashboard/klinik-aktif', ['clinicId' => 4])
            ->assertRedirect('/psikolog');
    }

    public function test_super_admin_ditolak_middleware(): void
    {
        $this->withSession($this->sesi('super'))
            ->post('/dashboard/klinik-aktif', ['clinicId' => 4])
            ->assertRedirect('/admin');
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter GantiKlinikAktifTest`
Expected: FAIL — 404/405 karena route belum ada.

- [ ] **Step 3: Buat `app/Http/Controllers/KlinikAktifController.php`**

```php
<?php

namespace App\Http\Controllers;

use App\Services\PraktiquApi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

/**
 * Pindah klinik aktif — admin klinik yang memegang beberapa klinik.
 *
 * Daftar kliniknya (`clinics`) diisi saat login dari /auth/me. Klinik aktif
 * adalah `practiceId` di profil yang sama, jadi semua controller yang sudah
 * membaca practiceId ikut berpindah tanpa diubah. PraktiquApi mengirimnya ke
 * backend sebagai X-Praktiqu-Clinic-Id, dan backend memvalidasinya lagi di
 * setiap request — pemeriksaan di sini hanya supaya pilihan yang mustahil
 * tidak sempat tersimpan di sesi.
 */
class KlinikAktifController extends Controller
{
    public function ganti(Request $request): RedirectResponse|JsonResponse
    {
        $profil = AuthController::validProfile() ?? [];
        $daftar = is_array($profil['clinics'] ?? null) ? $profil['clinics'] : [];
        $id = filter_var($request->input('clinicId'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        $pilihan = null;
        foreach ($daftar as $k) {
            if ($id !== false && is_array($k) && ($k['id'] ?? null) === $id) {
                $pilihan = $k;
                break;
            }
        }
        // Resepsionis juga ber-role 'admin', tapi tidak punya `clinics`: daftarnya
        // kosong, jadi pilihan apa pun ditolak di sini.
        abort_if($pilihan === null, 422, 'Klinik itu tidak ada di daftar klinik Anda.');

        $profil['practiceId'] = $pilihan['id'];
        Session::put(PraktiquApi::PROFILE_KEY, $profil);

        // Reload penuh, bukan memperbarui state di tempat: seluruh data yang sudah
        // dimuat halaman ini milik klinik lama.
        return $request->expectsJson()
            ? response()->json(['ok' => true, 'practiceId' => $pilihan['id']])
            : redirect('/klinik');
    }
}
```

- [ ] **Step 4: Daftarkan route**

Di `routes/web.php`, tepat setelah baris

```php
Route::get('/psikolog', fn () => app(DashboardController::class)->index('psikolog'))->middleware('staff:psikolog');
```

tambahkan:

```php

// Admin klinik yang memegang beberapa klinik memilih satu klinik aktif
// (dropdown di dashboard). Sengaja DI LUAR grup staff:any di bawah: grup itu
// memakai guard klinik.halaman, dan pindah klinik justru mengubah klinik
// halaman.
Route::post('/dashboard/klinik-aktif', [\App\Http\Controllers\KlinikAktifController::class, 'ganti'])
    ->middleware('staff:admin')->name('klinik.aktif');
```

- [ ] **Step 5: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter GantiKlinikAktifTest`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/KlinikAktifController.php routes/web.php tests/Feature/GantiKlinikAktifTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): route pindah klinik aktif untuk admin klinik"
```

---

### Task F5: Dropdown klinik aktif di dashboard

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php` (method `render()`, sekitar baris 1592-1646)
- Create: `resources/views/dashboard/partials/pilih-klinik.blade.php`
- Modify: `resources/views/dashboard.blade.php` (pil klinik di topbar sekitar baris 2356-2358 dan di sidebar sekitar baris 2380-2384)
- Modify: `public/css/app.css` (setelah blok `.pq-clinic.mini .pq-clinic-ini`, sekitar baris 386)
- Test (baru): `tests/Feature/DropdownKlinikAktifTest.php`

**Interfaces:**
- Consumes: `pq_profile['clinics']`, `pq_profile['practiceId']`, route `klinik.aktif` (F4).
- Produces: variabel view `klinikSaya` (list), `practiceIdAktif`, `inisialKlinik`; `payload.profile.practiceId` (admin saja; role lain `null`). **Jangan** memakai kunci payload `clinics` — kunci itu sudah dipakai untuk daftar klinik dari `/practices`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/DropdownKlinikAktifTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Pil nama klinik di topbar dan sidebar menjadi dropdown untuk admin klinik
// yang memegang lebih dari satu klinik. Satu klinik: tetap pil biasa.
class DropdownKlinikAktifTest extends TestCase
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

    private function fakeBackend(): void
    {
        Http::fake([
            '*/api/v1/practices*' => Http::response(['data' => [['id' => 20, 'name' => 'Klinik B']]]),
            '*' => Http::response(['data' => []]),
        ]);
    }

    public function test_admin_tiga_klinik_mendapat_dropdown(): void
    {
        $this->fakeBackend();

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20, 'clinics' => [
            ['id' => 4, 'name' => 'Klinik A', 'active' => true],
            ['id' => 20, 'name' => 'Klinik B', 'active' => true],
            ['id' => 31, 'name' => 'Klinik Lama', 'active' => false],
        ]]))->get('/klinik');

        $res->assertOk();
        $res->assertSee('action="/dashboard/klinik-aktif"', false);
        $res->assertSee('name="clinicId"', false);
        $res->assertSee('value="20" selected', false);
        $res->assertDontSee('value="4" selected', false);
        $res->assertSee('Klinik A');
        $res->assertSee('Klinik Lama (Nonaktif)');
        $res->assertSee('"practiceId":20', false);
    }

    public function test_admin_satu_klinik_tetap_pil_biasa(): void
    {
        $this->fakeBackend();

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20, 'clinics' => [
            ['id' => 20, 'name' => 'Klinik B', 'active' => true],
        ]]))->get('/klinik');

        $res->assertOk();
        $res->assertDontSee('name="clinicId"', false);
        $res->assertSee('"clinic":{"name":"Klinik B"', false);
    }

    public function test_sesi_lama_tanpa_daftar_klinik_tanpa_dropdown(): void
    {
        $this->fakeBackend();

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20]))->get('/klinik');

        $res->assertOk();
        $res->assertDontSee('name="clinicId"', false);
        $res->assertSee('"practiceId":20', false);
    }

    public function test_super_admin_tidak_mendapat_practice_id(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->withSession($this->sesi('super', ['practiceId' => 42]))
            ->get('/admin')
            ->assertOk()
            ->assertDontSee('"practiceId":42', false)
            ->assertDontSee('name="clinicId"', false);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter DropdownKlinikAktifTest`
Expected: FAIL — tidak ada `name="clinicId"` dan tidak ada `"practiceId":20`.

- [ ] **Step 3: Data view di `DashboardController::render()`**

Di awal `render()`, tepat setelah baris `$roleName = ...;`, tambahkan:

```php
        // Dropdown klinik aktif: hanya admin klinik yang memegang lebih dari satu
        // klinik (lihat KlinikAktifController). Sumbernya profil sesi, BUKAN
        // /practices — daftar itu sengaja hanya berisi klinik aktif.
        $klinikSaya = $role === 'admin' && is_array($profile['clinics'] ?? null) ? array_values($profile['clinics']) : [];
        $klinikAktifNama = '';
        foreach ($klinikSaya as $k) {
            if ((string) ($k['id'] ?? '') === (string) ($profile['practiceId'] ?? '')) {
                $klinikAktifNama = (string) ($k['name'] ?? '');
            }
        }
```

Di array yang dikirim ke `view('dashboard', [...])`, tambahkan tiga kunci di tingkat atas (di samping `'role' => $role,`):

```php
            'klinikSaya' => $klinikSaya,
            'practiceIdAktif' => $profile['practiceId'] ?? null,
            'inisialKlinik' => self::initialsOf($klinikAktifNama),
```

Di `'profile' => [...]` di dalam payload, tambahkan kunci keempat:

```php
                    // Klinik yang dipakai halaman ini saat dirender. Dibaca JS untuk
                    // isian bawaan form (Tambah Sesi, Janji Manual) dan dikirim balik
                    // sebagai X-Klinik-Halaman (CocokKlinikHalaman). Admin saja —
                    // super admin melihat semua klinik, psikolog tidak memilih.
                    'practiceId' => $role === 'admin' ? ($profile['practiceId'] ?? null) : null,
```

- [ ] **Step 4: Buat `resources/views/dashboard/partials/pilih-klinik.blade.php`**

```blade
{{-- Dropdown klinik aktif — admin klinik yang memegang lebih dari satu klinik
     (lihat KlinikAktifController). Form biasa, bukan fetch: pindah klinik memuat
     ulang halaman penuh, karena seluruh data di halaman ini milik klinik lama.
     Variabel: $klinikSaya, $practiceIdAktif, $inisialKlinik (dari
     DashboardController::render), $idPilih dan $mini (dari @include). --}}
<form method="POST" action="{{ route('klinik.aktif', [], false) }}" class="pq-clinic pq-clinic-pilih{{ $mini ? ' mini' : '' }}">
  @csrf
  <span class="pq-clinic-ini" aria-hidden="true">{{ $inisialKlinik }}</span>
  <label for="{{ $idPilih }}" class="sr-only">Klinik aktif</label>
  <select id="{{ $idPilih }}" name="clinicId" onchange="this.form.submit()">
    @foreach ($klinikSaya as $k)
      <option value="{{ $k['id'] }}" @selected((string) $k['id'] === (string) $practiceIdAktif)>{{ $k['name'] }}{{ ($k['active'] ?? true) ? '' : ' (Nonaktif)' }}</option>
    @endforeach
  </select>
  <noscript><button type="submit">Ganti</button></noscript>
</form>
```

- [ ] **Step 5: Pakai partial di `resources/views/dashboard.blade.php`**

Topbar — ganti blok

```blade
    <template x-if="clinic">
      <div class="pq-clinic mini"><span class="pq-clinic-ini" x-text="clinic.initial"></span><span x-text="clinic.name"></span></div>
    </template>
```

dengan

```blade
    @if (count($klinikSaya) > 1)
      @include('dashboard.partials.pilih-klinik', ['idPilih' => 'klinik-aktif-atas', 'mini' => true])
    @else
      <template x-if="clinic">
        <div class="pq-clinic mini"><span class="pq-clinic-ini" x-text="clinic.initial"></span><span x-text="clinic.name"></span></div>
      </template>
    @endif
```

Sidebar — ganti blok

```blade
    <template x-if="clinic">
      <div class="pq-clinic-wrap" style="padding:0 20px 14px">
        <div class="pq-clinic"><span class="pq-clinic-ini" x-text="clinic.initial"></span><span x-text="clinic.name"></span></div>
      </div>
    </template>
```

dengan

```blade
    @if (count($klinikSaya) > 1)
      <div class="pq-clinic-wrap" style="padding:0 20px 14px">
        @include('dashboard.partials.pilih-klinik', ['idPilih' => 'klinik-aktif-samping', 'mini' => false])
      </div>
    @else
      <template x-if="clinic">
        <div class="pq-clinic-wrap" style="padding:0 20px 14px">
          <div class="pq-clinic"><span class="pq-clinic-ini" x-text="clinic.initial"></span><span x-text="clinic.name"></span></div>
        </div>
      </template>
    @endif
```

(`.pq-clinic-wrap` sudah disembunyikan saat sidebar dikuncupkan — `public/css/app.css` sekitar baris 75 — jadi dropdown ikut tersembunyi, sama seperti pil hari ini.)

- [ ] **Step 6: Gaya di `public/css/app.css`**

Tambahkan tepat setelah baris `.pq-clinic.mini .pq-clinic-ini { ... }`:

```css
/* Dropdown klinik aktif: pil yang sama, isinya <select>. Panahnya bawaan
   browser, supaya jelas bisa diklik tanpa ikon tambahan. */
.pq-clinic-pilih { padding-right: 6px; }
.pq-clinic-pilih select { flex: 1 1 auto; min-width: 0; max-width: 100%; border: none; background: transparent;
                          font: inherit; color: inherit; cursor: pointer; padding: 0 2px; text-overflow: ellipsis; }
.pq-clinic-pilih select:focus-visible { outline: 2px solid #425FAD; outline-offset: 2px; border-radius: 4px; }
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'DropdownKlinikAktifTest|StaffAccessTest|DashboardCakupanKlinikTest'`
Expected: semua PASS.

- [ ] **Step 8: Cek visual (manual, opsional tapi disarankan)**

Jalankan FE lokal dengan sesi admin palsu tidak praktis; cukup pastikan di review PR bahwa pil di topbar ponsel (lebar < 980px) tidak mendorong logo keluar layar — `select` memakai `min-width: 0` dan elipsis.

- [ ] **Step 9: Commit**

```bash
git add app/Http/Controllers/DashboardController.php resources/views/dashboard/partials/pilih-klinik.blade.php resources/views/dashboard.blade.php public/css/app.css tests/Feature/DropdownKlinikAktifTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): dropdown klinik aktif untuk admin multi-klinik"
```

---

### Task F6: Guard dua tab — tolak aksi dari tab yang kliniknya sudah berganti

**Files:**
- Create: `app/Http/Middleware/CocokKlinikHalaman.php`
- Modify: `bootstrap/app.php` (alias middleware)
- Modify: `routes/web.php` (baris 80: `Route::middleware('staff:any')->group(function () {`)
- Modify: `resources/views/dashboard.blade.php` (pembungkus `fetch` di `@push('head')` baris ±19-33; state `sesiHabis: false` baris ±316; banner di bawah banner "Sesi Anda berakhir" baris ±2337-2342; atribut `x-data` baris ±2333)
- Test (baru): `tests/Feature/CocokKlinikHalamanTest.php`

**Interfaces:**
- Consumes: `payload.profile.practiceId` (F5).
- Produces: header browser `X-Klinik-Halaman`; middleware alias `klinik.halaman`; jawaban 409 `{ok: false, klinikBerganti: true, message}`; event JS `pq-klinik-berganti`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/CocokKlinikHalamanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Klinik aktif disimpan di sesi, dan sesi dipakai bersama semua tab. Pindah
// klinik di tab B diam-diam mengubah tab A; tanpa guard ini, form yang dikirim
// dari tab A menulis ke klinik B. Halaman mengirim klinik saat ia dirender
// (X-Klinik-Halaman); yang tidak cocok dengan sesi ditolak 409.
class CocokKlinikHalamanTest extends TestCase
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

    public function test_tab_dengan_klinik_lama_ditolak_409(): void
    {
        Http::fake();

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20]))
            ->withHeaders(['X-Klinik-Halaman' => '4'])
            ->getJson('/dashboard/services');

        $res->assertStatus(409);
        $res->assertJson([
            'ok' => false,
            'klinikBerganti' => true,
            'message' => 'Klinik aktif sudah berganti di tab lain. Muat ulang halaman ini.',
        ]);
        Http::assertNothingSent();
    }

    public function test_klinik_yang_sama_lolos(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20]))
            ->withHeaders(['X-Klinik-Halaman' => '20'])
            ->getJson('/dashboard/services');

        $this->assertNotSame(409, $res->status());
    }

    public function test_tanpa_header_lolos(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 20]))->getJson('/dashboard/services');

        $this->assertNotSame(409, $res->status());
    }

    public function test_role_lain_tidak_diperiksa(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi('super'))
            ->withHeaders(['X-Klinik-Halaman' => '4'])
            ->getJson('/dashboard/services');

        $this->assertNotSame(409, $res->status());
    }

    public function test_pindah_klinik_tidak_dijaga(): void
    {
        $res = $this->withSession($this->sesi('admin', [
            'practiceId' => 20,
            'clinics' => [['id' => 4, 'name' => 'A', 'active' => true], ['id' => 20, 'name' => 'B', 'active' => true]],
        ]))->withHeaders(['X-Klinik-Halaman' => '20'])->postJson('/dashboard/klinik-aktif', ['clinicId' => 4]);

        $res->assertOk();
    }

    public function test_dashboard_memasang_header_dan_banner(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $html = $this->withSession($this->sesi('admin', ['practiceId' => 20]))->get('/klinik')->assertOk()->getContent();

        $this->assertStringContainsString('X-Klinik-Halaman', $html);
        $this->assertStringContainsString('pq-klinik-berganti', $html);
        $this->assertStringContainsString('Klinik aktif sudah berganti di tab lain', $html);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter CocokKlinikHalamanTest`
Expected: FAIL di `test_tab_dengan_klinik_lama_ditolak_409` dan `test_dashboard_memasang_header_dan_banner`.

- [ ] **Step 3: Buat `app/Http/Middleware/CocokKlinikHalaman.php`**

```php
<?php

namespace App\Http\Middleware;

use App\Services\PraktiquApi;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

// Guard dua tab untuk admin klinik yang memegang beberapa klinik.
//
// Klinik aktif disimpan di sesi, dan sesi dipakai bersama semua tab. Pindah
// klinik di tab B diam-diam mengubah tab A: form yang dikirim dari tab A akan
// menulis ke klinik B, padahal yang terlihat di layar klinik A. Dashboard
// mengirim klinik saat halamannya dirender (X-Klinik-Halaman, lihat pembungkus
// fetch di dashboard.blade.php); yang tidak cocok dengan sesi ditolak sebelum
// apa pun dikirim ke backend.
//
// Tanpa header (navigasi biasa, form non-fetch) atau role selain 'admin':
// lolos. Bukan batas keamanan — backend tetap memvalidasi klinik di setiap
// request — melainkan pengaman salah-klinik.
class CocokKlinikHalaman
{
    public const HEADER = 'X-Klinik-Halaman';

    public function handle(Request $request, Closure $next)
    {
        $halaman = trim((string) $request->header(self::HEADER, ''));
        if ($halaman === '') {
            return $next($request);
        }

        $profil = Session::get(PraktiquApi::PROFILE_KEY);
        if (! is_array($profil) || ($profil['role'] ?? null) !== 'admin') {
            return $next($request);
        }

        if ((string) ($profil['practiceId'] ?? '') === $halaman) {
            return $next($request);
        }

        return response()->json([
            'ok' => false,
            'klinikBerganti' => true,
            'message' => 'Klinik aktif sudah berganti di tab lain. Muat ulang halaman ini.',
        ], 409);
    }
}
```

- [ ] **Step 4: Alias dan pemasangan**

`bootstrap/app.php` — ubah

```php
        $middleware->alias([
            'staff' => \App\Http\Middleware\StaffAuth::class,
        ]);
```

menjadi

```php
        $middleware->alias([
            'staff' => \App\Http\Middleware\StaffAuth::class,
            'klinik.halaman' => \App\Http\Middleware\CocokKlinikHalaman::class,
        ]);
```

`routes/web.php` baris 80 — ubah

```php
Route::middleware('staff:any')->group(function () {
```

menjadi

```php
// klinik.halaman: guard dua tab (CocokKlinikHalaman). Urutannya penting —
// staff:any lebih dulu, supaya sesi yang tidak sah dijawab 401, bukan 409.
Route::middleware(['staff:any', 'klinik.halaman'])->group(function () {
```

**Jangan** pasang di `/booking/*` atau route publik: FE produksi membaca 409 pada `/public/payments` sebagai "pending".

- [ ] **Step 5: Pembungkus `fetch` di `resources/views/dashboard.blade.php`**

Ganti seluruh blok `if (!window.__pqFetchSesi) { ... }` (di `@push('head')`, sekitar baris 19-33) dengan:

```js
if (!window.__pqFetchSesi) {
  window.__pqFetchSesi = true;
  const fetchAsli = window.fetch.bind(window);
  // Klinik yang dipakai halaman ini saat dirender (admin klinik saja; null untuk
  // role lain). Dibaca saat dipanggil, karena skrip ini berjalan sebelum elemen
  // payload ada di halaman.
  const klinikHalaman = () => {
    try { return JSON.parse(document.getElementById("dash-payload").textContent).profile.practiceId ?? null; }
    catch { return null; }
  };
  const milikKita = (alamat) => alamat.startsWith("/") || alamat.startsWith(location.origin);
  window.fetch = async (...arg) => {
    // Guard dua tab (CocokKlinikHalaman): setiap request ke server kita sendiri
    // membawa klinik halaman ini, supaya server bisa menolak aksi dari tab yang
    // kliniknya sudah diganti di tab lain.
    try {
      const alamat = String((arg[0] && arg[0].url) || arg[0] || "");
      const klinik = milikKita(alamat) ? klinikHalaman() : null;
      if (klinik !== null && klinik !== "") {
        const init = { ...(arg[1] || {}) };
        const h = new Headers(init.headers || (arg[0] instanceof Request ? arg[0].headers : undefined));
        h.set("X-Klinik-Halaman", String(klinik));
        init.headers = h;
        arg = [arg[0], init];
      }
    } catch {}
    const res = await fetchAsli(...arg);
    try {
      const alamat = String((arg[0] && arg[0].url) || arg[0] || "");
      if (milikKita(alamat) && (res.status === 419 || (res.status === 401 && alamat.includes("/dashboard")))) {
        window.dispatchEvent(new CustomEvent("pq-sesi-habis"));
      }
      if (milikKita(alamat) && res.status === 409 && alamat.includes("/dashboard")) {
        const j = await res.clone().json().catch(() => null);
        if (j && j.klinikBerganti) window.dispatchEvent(new CustomEvent("pq-klinik-berganti"));
      }
    } catch {}
    return res;
  };
}
```

(Pertahankan komentar panjang di atas blok asli; ia menjelaskan bagian sesi habis yang tidak berubah.)

- [ ] **Step 6: State dan banner**

Di objek state `dashApp()`, tepat setelah baris `sesiHabis: false,` (±316) tambahkan:

```js
    // Klinik aktif diganti di tab lain (CocokKlinikHalaman menjawab 409).
    klinikBerganti: false,
```

Ubah elemen akar:

```blade
<div class="dash" x-data="dashApp()" x-cloak @pq-sesi-habis.window="sesiHabis = true">
```

menjadi:

```blade
<div class="dash" x-data="dashApp()" x-cloak @pq-sesi-habis.window="sesiHabis = true" @pq-klinik-berganti.window="klinikBerganti = true">
```

Tepat setelah `</div>` penutup banner "Sesi Anda berakhir" (±2342), tambahkan:

```blade
  {{-- Klinik aktif diganti di tab lain (CocokKlinikHalaman). Aksi terakhir
       ditolak sebelum sampai ke backend, jadi tidak ada yang tertulis ke klinik
       yang salah; muat ulang supaya halaman ini memakai klinik yang sekarang. --}}
  <div x-show="klinikBerganti" x-cloak role="alert"
       style="position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100;max-width:560px;width:calc(100% - 32px);background:#FFF4E5;border:1px solid #F3C98B;color:#6B4A12;border-radius:14px;padding:14px 16px;box-shadow:0 12px 30px -12px rgba(19,25,48,.35);font-size:13.5px;line-height:1.5">
    <b>Klinik aktif sudah berganti di tab lain.</b> Perubahan terakhir tidak dikirim.
    <a href="#" @click.prevent="location.reload()" style="color:#425FAD;font-weight:700">Muat ulang halaman ini</a>.
  </div>
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'CocokKlinikHalamanTest|GantiKlinikAktifTest|StaffAccessTest'`
Expected: semua PASS.

Lalu seluruh suite: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`
Expected: semua PASS (guard dipasang di grup besar; tes lain tidak mengirim `X-Klinik-Halaman`, jadi tidak terpengaruh).

- [ ] **Step 8: Commit**

```bash
git add app/Http/Middleware/CocokKlinikHalaman.php bootstrap/app.php routes/web.php resources/views/dashboard.blade.php tests/Feature/CocokKlinikHalamanTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): tolak aksi dari tab yang klinik aktifnya sudah berganti"
```

---

### Task F7: Halaman super admin "Admin klinik"

**Files:**
- Create: `app/Http/Controllers/KlinikAdminController.php`
- Create: `resources/views/dashboard/klinik-admin.blade.php`
- Modify: `routes/web.php` (di dalam grup `staff:any`, tepat setelah dua route `klinik.pembayaran`)
- Modify: `resources/views/dashboard.blade.php` (kartu klinik tampilan "Clinics", di dalam `@if (($role ?? null) === 'super')` setelah tautan "Pengaturan pembayaran ›", sekitar baris 4560)
- Test (baru): `tests/Feature/AdminKlinikSuperTest.php`

**Interfaces:**
- Consumes (backend): `GET api/v1/practices/clinic-admins` → `{data: [{wpUserId, name, email, clinicIds}], total}`; `GET api/v1/practices/{id}` → `{data: {id, name, ...}}`; `POST api/v1/practices/{id}/change-admin` body `{newAdminId: int}` → `{message, data: {clinicId, adminId, previousAdminId, previousAdminClinicCount, unchanged}}`, 422 `code: not_a_clinic_admin`.
- Produces: route `klinik.admin` (GET) dan `klinik.admin.simpan` (POST) di `/dashboard/klinik/{id}/admin`; flash `adminPesan`, `adminPeringatan`, `adminGagal`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `tests/Feature/AdminKlinikSuperTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Super admin menugaskan admin sebuah klinik. Satu klinik punya satu admin;
// satu admin boleh memegang beberapa klinik. Selain super admin: 404 sebelum
// satu request pun ke backend.
class AdminKlinikSuperTest extends TestCase
{
    private const URL = '/dashboard/klinik/4/admin';

    private const KANDIDAT = [
        ['wpUserId' => 512, 'name' => 'Admin Lama', 'email' => 'lama@klinik.co', 'clinicIds' => [4]],
        ['wpUserId' => 911, 'name' => 'Admin Baru', 'email' => 'baru@klinik.co', 'clinicIds' => [20, 31]],
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

    private function fakeHalaman(array $ubah = []): void
    {
        Http::fake($ubah + [
            '*/api/v1/practices/clinic-admins' => Http::response(['data' => self::KANDIDAT, 'total' => 2]),
            '*/api/v1/practices/4' => Http::response(['data' => ['id' => 4, 'name' => 'Klinik Sehat']]),
        ]);
    }

    private function fakeSimpan(array $data, int $status = 200): void
    {
        Http::fake([
            '*/api/v1/practices/4/change-admin' => Http::response(
                $status === 200 ? ['message' => 'Practice admin updated', 'data' => $data] : $data,
                $status,
            ),
        ]);
    }

    // ── Akses ───────────────────────────────────────────────────────────

    public function test_super_admin_melihat_admin_saat_ini_dan_pilihan(): void
    {
        $this->fakeHalaman();

        $res = $this->withSession($this->sesi('super'))->get(self::URL);

        $res->assertOk();
        $res->assertSee('Admin Klinik');
        $res->assertSee('Klinik Sehat');
        $res->assertSee('Admin saat ini');
        $res->assertSee('lama@klinik.co');
        $res->assertSee('Admin Baru — baru@klinik.co — memegang 2 klinik');
        $res->assertSee('name="newAdminId"', false);
        $res->assertSee('Admin lama akan kehilangan akses ke klinik ini');
        $res->assertSee('href="/admin"', false);
    }

    #[DataProvider('bukanSuper')]
    public function test_selain_super_mendapat_404_tanpa_menyentuh_backend(string $role, array $extra): void
    {
        Http::fake();

        $this->withSession($this->sesi($role, $extra))->get(self::URL)->assertNotFound();
        $this->withSession($this->sesi($role, $extra))->post(self::URL, ['newAdminId' => '911'])->assertNotFound();

        Http::assertNothingSent();
    }

    public static function bukanSuper(): array
    {
        return [
            'admin klinik' => ['admin', ['practiceId' => 4, 'canManageClinicPayment' => true]],
            'psikolog' => ['psikolog', ['professionalId' => 7]],
        ];
    }

    public function test_klinik_yang_tidak_ada_404(): void
    {
        $this->fakeHalaman(['*/api/v1/practices/4' => Http::response(['status' => 404], 404)]);

        $this->withSession($this->sesi('super'))->get(self::URL)->assertNotFound();
    }

    public function test_daftar_admin_gagal_dimuat_form_tidak_tampil(): void
    {
        $this->fakeHalaman(['*/api/v1/practices/clinic-admins' => Http::response(['title' => 'x'], 500, ['Retry-After' => '0'])]);

        $res = $this->withSession($this->sesi('super'))->get(self::URL);

        $res->assertOk();
        $res->assertSee('Daftar admin klinik tidak bisa dimuat');
        $res->assertDontSee('name="newAdminId"', false);
    }

    // ── Simpan ──────────────────────────────────────────────────────────

    public function test_simpan_memanggil_backend_dengan_wp_user_id(): void
    {
        $this->fakeSimpan(['clinicId' => 4, 'adminId' => 911, 'previousAdminId' => 512, 'previousAdminClinicCount' => 2, 'unchanged' => false]);

        $res = $this->withSession($this->sesi('super'))->post(self::URL, ['newAdminId' => '911']);

        $res->assertRedirect(self::URL);
        $res->assertSessionHas('adminPesan', 'Admin klinik tersimpan.');
        $res->assertSessionMissing('adminPeringatan');
        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && str_ends_with($r->url(), '/api/v1/practices/4/change-admin')
            && $r['newAdminId'] === 911);
    }

    public function test_peringatan_bila_admin_lama_tidak_memegang_klinik_lagi(): void
    {
        $this->fakeSimpan(['clinicId' => 4, 'adminId' => 911, 'previousAdminId' => 512, 'previousAdminClinicCount' => 0, 'unchanged' => false]);

        $this->withSession($this->sesi('super'))->post(self::URL, ['newAdminId' => '911'])
            ->assertSessionHas('adminPeringatan');
    }

    public function test_admin_yang_sama_tidak_mengubah_apa_pun(): void
    {
        $this->fakeSimpan(['clinicId' => 4, 'adminId' => 512, 'previousAdminId' => 512, 'previousAdminClinicCount' => 1, 'unchanged' => true]);

        $this->withSession($this->sesi('super'))->post(self::URL, ['newAdminId' => '512'])
            ->assertSessionHas('adminPesan', 'Tidak ada yang berubah: akun itu memang admin klinik ini.');
    }

    public function test_akun_bukan_admin_klinik_ditolak_backend(): void
    {
        $this->fakeSimpan(['type' => '/errors/validation-error', 'status' => 422, 'code' => 'not_a_clinic_admin'], 422);

        $this->withSession($this->sesi('super'))->post(self::URL, ['newAdminId' => '700'])
            ->assertRedirect(self::URL)
            ->assertSessionHas('adminGagal', 'Akun itu bukan admin klinik. Pilih akun lain.');
    }

    public function test_isian_tidak_sah_tidak_dikirim(): void
    {
        Http::fake();

        $this->withSession($this->sesi('super'))->post(self::URL, ['newAdminId' => 'abc'])
            ->assertSessionHasErrors(['newAdminId']);

        Http::assertNothingSent();
    }

    // ── Pintu masuk ─────────────────────────────────────────────────────

    public function test_kartu_klinik_super_admin_menautkan_halaman_ini(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->withSession($this->sesi('super'))->get('/admin')
            ->assertOk()
            ->assertSee(":href=\"'/dashboard/klinik/' + r.id + '/admin'\"", false);
    }
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter AdminKlinikSuperTest`
Expected: FAIL — route belum ada (404 di tes super admin, tes simpan gagal).

- [ ] **Step 3: Buat `app/Http/Controllers/KlinikAdminController.php`**

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Admin sebuah klinik — super admin saja.
 *
 * Satu klinik punya satu admin (wp_kc_clinics.clinic_admin_id); satu admin
 * boleh memegang beberapa klinik dan memilih klinik aktifnya dari dashboard
 * (KlinikAktifController). Halaman tersendiri, mengikuti
 * KlinikPembayaranController. Backend: GET /api/v1/practices/clinic-admins
 * (pilihan) dan POST /api/v1/practices/{id}/change-admin (simpan).
 *
 * Selain super admin: 404, sebelum satu request pun ke backend. Backend
 * menegakkan aturan yang sama; ini lapis kedua.
 */
class KlinikAdminController extends Controller
{
    public function __construct(private readonly PraktiquApi $api) {}

    private static function superAdmin(): bool
    {
        return (AuthController::validProfile()['role'] ?? null) === 'super';
    }

    public function index(string $id): View
    {
        abort_unless(self::superAdmin(), 404);

        $nama = $this->namaKlinik($id);
        $kandidat = $this->kandidat();

        $sekarang = null;
        foreach ($kandidat ?? [] as $k) {
            if (in_array((int) $id, $k['clinicIds'], true)) {
                $sekarang = $k;
                break;
            }
        }

        return view('dashboard.klinik-admin', [
            'id' => $id,
            'nama' => $nama,
            // null = gagal dimuat; form tidak ditampilkan dalam keadaan itu.
            'kandidat' => $kandidat,
            'sekarang' => $sekarang,
        ]);
    }

    public function simpan(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::superAdmin(), 404);

        $data = $request->validate(
            ['newAdminId' => ['required', 'regex:/^[1-9][0-9]{0,14}$/']],
            ['newAdminId.required' => 'Pilih admin klinik.', 'newAdminId.regex' => 'Pilihan admin tidak dikenali.'],
        );

        $kembali = redirect()->route('klinik.admin', ['id' => $id]);
        try {
            $res = $this->api->post("api/v1/practices/{$id}/change-admin", ['newAdminId' => (int) $data['newAdminId']]);
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);
            $kode = is_array($e->body) ? ($e->body['code'] ?? '') : '';

            return $kembali->withInput()->with('adminGagal', match (true) {
                $kode === 'not_a_clinic_admin' => 'Akun itu bukan admin klinik. Pilih akun lain.',
                $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah admin tersimpan. Muat ulang halaman untuk melihat admin saat ini.',
                default => 'Admin klinik belum tersimpan.'.ResourceController::rincianValidasi($e->body),
            });
        }

        // unwrap() sudah membuka {message, data}; dua bentuk ditangani supaya
        // perubahan amplop di backend tidak diam-diam menghapus peringatan.
        $hasil = is_array($res) ? ($res['data'] ?? $res) : [];
        if (! empty($hasil['unchanged'])) {
            return $kembali->with('adminPesan', 'Tidak ada yang berubah: akun itu memang admin klinik ini.');
        }

        $kembali = $kembali->with('adminPesan', 'Admin klinik tersimpan.');
        if (($hasil['previousAdminClinicCount'] ?? null) === 0 && ! empty($hasil['previousAdminId'])) {
            $kembali = $kembali->with('adminPeringatan', 'Admin sebelumnya kini tidak memegang klinik apa pun dan tidak bisa lagi membuka dashboard klinik.');
        }

        return $kembali;
    }

    private function namaKlinik(string $id): string
    {
        try {
            $p = $this->api->get("api/v1/practices/{$id}");
        } catch (ApiException $e) {
            abort_if(in_array($e->status, [403, 404], true), 404);

            return 'Klinik #'.$id;
        }
        $nama = is_array($p) ? trim((string) (($p['data'] ?? $p)['name'] ?? '')) : '';

        return $nama !== '' ? $nama : 'Klinik #'.$id;
    }

    /** @return list<array{wpUserId:int, name:string, email:string, clinicIds:list<int>}>|null */
    private function kandidat(): ?array
    {
        try {
            $res = $this->api->get('api/v1/practices/clinic-admins');
        } catch (ApiException $e) {
            logger()->warning('[klinik-admin] daftar admin klinik gagal dimuat: '.$e->getMessage());

            return null;
        }

        $baris = is_array($res) ? ($res['data'] ?? $res) : [];
        $out = [];
        foreach (is_array($baris) ? $baris : [] as $r) {
            if (! is_array($r) || ! is_numeric($r['wpUserId'] ?? null)) {
                continue;
            }
            $nama = trim((string) ($r['name'] ?? ''));
            $out[] = [
                'wpUserId' => (int) $r['wpUserId'],
                'name' => $nama !== '' ? $nama : 'Akun #'.$r['wpUserId'],
                'email' => (string) ($r['email'] ?? ''),
                'clinicIds' => array_values(array_map('intval', is_array($r['clinicIds'] ?? null) ? $r['clinicIds'] : [])),
            ];
        }

        return $out;
    }
}
```

- [ ] **Step 4: Buat `resources/views/dashboard/klinik-admin.blade.php`**

```blade
@extends('layouts.base')

{{-- Admin sebuah klinik — lihat KlinikAdminController. Halaman tersendiri,
     sama seperti dashboard/klinik-pembayaran.blade.php. --}}

@php
  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';
  $label = 'display:block;font-size:13px;font-weight:600;color:'.$teks.';margin-bottom:6px';
  $kolom = 'width:100%;box-sizing:border-box;border:1.5px solid '.$garis.';border-radius:11px;padding:10px 12px;font-size:14px;color:'.$teks.';background:#fff';
  $galat = 'font-size:12.5px;color:#9B2C2C;margin-top:5px;line-height:1.5';
  $dipilih = (string) old('newAdminId', $sekarang['wpUserId'] ?? '');
@endphp

@section('title', 'Admin Klinik — '.$nama.' — PraktiQu')

@section('content')
<div style="max-width:720px;margin:0 auto;padding:28px 20px 64px">

  <a href="/admin" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke dashboard</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 6px">Admin Klinik</h1>
  <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 24px">
    {{ $nama }} — satu klinik punya satu admin. Satu admin boleh memegang beberapa klinik
    dan memilih klinik yang aktif dari dashboard-nya.
  </p>

  @if (session('adminPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">
      {{ session('adminPesan') }}
    </div>
  @endif
  @if (session('adminPeringatan'))
    <div style="border:1.5px solid #F3E2BE;background:#FFF6E5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:13.5px;color:#7A5A00;line-height:1.6">
      {{ session('adminPeringatan') }}
    </div>
  @endif
  @if (session('adminGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">
      {{ session('adminGagal') }}
    </div>
  @endif

  <div style="border:1.5px solid {{ $garis }};border-radius:16px;padding:16px 20px;margin-bottom:20px">
    <div style="font-size:12.5px;color:{{ $redup }};margin-bottom:4px">Admin saat ini</div>
    @if ($sekarang)
      <div style="font-size:15px;font-weight:700;color:{{ $teks }}">{{ $sekarang['name'] }}</div>
      <div style="font-size:13px;color:{{ $redup }}">{{ $sekarang['email'] }} · memegang {{ count($sekarang['clinicIds']) }} klinik</div>
    @elseif ($kandidat === null)
      <div style="font-size:14px;color:{{ $redup }}">Tidak diketahui (daftar admin gagal dimuat).</div>
    @else
      <div style="font-size:14px;color:{{ $redup }}">Admin saat ini bukan akun admin klinik, atau belum ditetapkan.</div>
    @endif
  </div>

  @if ($kandidat === null)
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px">
      <div style="font-size:14px;font-weight:700;color:#9B2C2C">Daftar admin klinik tidak bisa dimuat.</div>
      <div style="font-size:13px;color:#7A3B3B;margin-top:4px;line-height:1.6">Tidak ada yang diubah. Muat ulang halaman untuk mencoba lagi.</div>
    </div>
  @elseif (count($kandidat) === 0)
    <div style="font-size:14px;color:{{ $redup }};line-height:1.6">
      Belum ada akun admin klinik. Buat akunnya dulu di WordPress/KiviCare, lalu kembali ke sini.
    </div>
  @else
    <form method="POST" action="{{ route('klinik.admin.simpan', ['id' => $id]) }}"
          style="border:1.5px solid {{ $garis }};border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:16px">
      @csrf
      <div>
        <label for="ka-admin" style="{{ $label }}">Admin klinik</label>
        <select id="ka-admin" name="newAdminId" required style="{{ $kolom }}">
          <option value="">— Pilih admin klinik —</option>
          @foreach ($kandidat as $k)
            <option value="{{ $k['wpUserId'] }}" @selected($dipilih === (string) $k['wpUserId'])>{{ $k['name'] }} — {{ $k['email'] }} — memegang {{ count($k['clinicIds']) }} klinik</option>
          @endforeach
        </select>
        @error('newAdminId') <div style="{{ $galat }}">{{ $message }}</div> @enderror
      </div>

      <div style="font-size:13px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:12px;padding:10px 12px;line-height:1.55">
        Admin lama akan kehilangan akses ke klinik ini mulai permintaan berikutnya.
      </div>

      <div>
        <button type="submit"
                style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">
          Simpan Admin
        </button>
      </div>
    </form>
  @endif
</div>
@endsection
```

- [ ] **Step 5: Route**

Di `routes/web.php`, di dalam grup `staff:any`, tepat setelah route `klinik.pembayaran.simpan`, tambahkan:

```php
    // Admin sebuah klinik — super admin saja, diperiksa KlinikAdminController
    // (404 untuk role lain, sama seperti pembayaran internasional di atas).
    Route::get('/dashboard/klinik/{id}/admin', [\App\Http\Controllers\KlinikAdminController::class, 'index'])
        ->whereNumber('id')->name('klinik.admin');
    Route::post('/dashboard/klinik/{id}/admin', [\App\Http\Controllers\KlinikAdminController::class, 'simpan'])
        ->whereNumber('id')->name('klinik.admin.simpan');
```

- [ ] **Step 6: Tautan di kartu klinik**

Di `resources/views/dashboard.blade.php`, tampilan "Clinics", di dalam blok:

```blade
                @if (($role ?? null) === 'super')
                <a x-show="r.id != null" :href="'/dashboard/klinik/' + r.id + '/pembayaran-internasional'"
                   style="display:inline-flex;align-items:center;margin-top:10px;font-size:12.5px;font-weight:600;color:#425FAD;text-decoration:none">Pengaturan pembayaran ›</a>
                @endif
```

tambahkan tautan kedua sebelum `@endif`:

```blade
                <a x-show="r.id != null" :href="'/dashboard/klinik/' + r.id + '/admin'"
                   style="display:inline-flex;align-items:center;margin-top:10px;margin-left:14px;font-size:12.5px;font-weight:600;color:#425FAD;text-decoration:none">Admin klinik ›</a>
```

- [ ] **Step 7: Jalankan tes, pastikan lulus**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit --filter 'AdminKlinikSuperTest|PengaturanPembayaranKlinikTest'`
Expected: semua PASS.

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/KlinikAdminController.php resources/views/dashboard/klinik-admin.blade.php routes/web.php resources/views/dashboard.blade.php tests/Feature/AdminKlinikSuperTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): halaman super admin untuk menugaskan admin klinik"
```

---

### Task F8: Verifikasi penuh FE, push branch, link PR

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Seluruh suite**

Run: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php vendor/bin/phpunit`
Expected: `OK`, jumlah tes = jumlah di Task F0 + tes baru F1–F7. Tidak boleh ada kegagalan.

- [ ] **Step 2: Syntax check semua file PHP yang disentuh**

```bash
for f in $(git diff --name-only origin/main -- '*.php'); do
  DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v "$PWD":/app -w /app php:8.4-cli php -l "$f"
done
```

Expected: `No syntax errors detected` untuk setiap file.

- [ ] **Step 3: Pastikan `PROFILE_VERSION` tidak berubah dan tidak ada yang menyentuh `main`**

```bash
grep -n "PROFILE_VERSION = 5" app/Http/Controllers/AuthController.php
git branch --show-current
```

Expected: satu baris cocok; branch `feat/multi-klinik`.

- [ ] **Step 4: Push (dengan izin user lebih dulu)**

Minta izin user. Lalu:

```bash
git push --dry-run origin feat/multi-klinik:refs/heads/feat/multi-klinik
git push origin feat/multi-klinik:refs/heads/feat/multi-klinik
```

**Jangan pernah** `git push origin main` atau push ke `refs/heads/main`.

- [ ] **Step 5: Link PR yang sudah terisi**

```bash
python3 - <<'EOF'
import urllib.parse
title = "feat: admin klinik multi-klinik (dropdown klinik aktif)"
body = """Butuh backend Alfzzz124/nextjs-appointment-praktiqu branch feat/multi-klinik ter-deploy lebih dulu (kalau belum, header diabaikan dan dropdown tidak muncul karena /auth/me belum mengirim `clinics`).

- Login menyimpan `clinics` (dari /auth/me) di profil; PROFILE_VERSION tetap 5, tidak ada staf yang ter-logout.
- Setiap panggilan backend sesi admin membawa `X-Praktiqu-Clinic-Id` = klinik aktif.
- `POST /dashboard/klinik-aktif` + dropdown di pil klinik (topbar & sidebar) untuk admin yang memegang >1 klinik.
- Backend menolak klinik (403 clinic_not_in_scope) → sesi diakhiri, login ulang.
- Guard dua tab: aksi dari tab yang kliniknya sudah berganti dijawab 409.
- Super admin: halaman /dashboard/klinik/{id}/admin untuk menugaskan admin klinik.

Spec & rencana: docs/superpowers/specs/2026-10-13-admin-multi-klinik-design.md dan docs/superpowers/plans/2026-10-14-admin-multi-klinik.md di repo backend."""
print("https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/multi-klinik?expand=1&title="
      + urllib.parse.quote(title) + "&body=" + urllib.parse.quote(body))
EOF
```

Berikan URL itu ke user. **User yang membuka dan me-merge PR** (merge ke `main` FE langsung deploy ke produksi).

---

## Part G — Rilis (dikerjakan bersama user, bukan oleh subagent)

### Task G1: Gerbang data (wajib sebelum deploy backend)

- [ ] **Step 1:** Simpan skrip di spec **Lampiran A** sebagai `cek-multi-klinik.php` di folder sementara lokal (bukan di repo).
- [ ] **Step 2:** Dengan izin user, jalankan dalam **satu** koneksi:

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger 'cd ~/domains/api-appointment.praktiqu.com/public_html && php' < cek-multi-klinik.php
```

(Kalau timeout di port 65002: akses SSH di hPanel mungkin mati atau IP diblokir — minta user mengeceknya. Jangan mencoba berulang-ulang.)

- [ ] **Step 3:** Laporkan ke user, hanya ID (tanpa nama/email):
  - admin yang memiliki >1 klinik (`admin_pemilik_banyak_klinik`) — mereka langsung mendapat dropdown setelah rilis;
  - baris `staf_semua_sumber` ber-role `CLINIC_ADMIN` yang `mapping_dokter`-nya tidak kosong **dan** berbeda dari `klinik_dimiliki` — **klinik default mereka berubah**; user memutuskan apakah mereka perlu dikabari atau mapping-nya dibereskan dulu.

### Task G2: Deploy backend

- [ ] User me-merge PR backend ke `main`, lalu deploy Next.js ke `endpoint.praktiqu.com` lewat hPanel seperti rilis sebelumnya (catat build id baru dan build id lama untuk rollback).
- [ ] Smoke test tanpa FE baru (perilaku lama harus utuh): login sebagai admin klinik di `appointment.praktiqu.com`, buka dashboard, daftar pasien, bills — semua tampil seperti sebelumnya.
- [ ] Cek `/auth/me` admin klinik sekarang membawa `clinics` (mis. lewat Postman dengan token admin).

### Task G3: Deploy FE

- [ ] User me-merge PR FE ke `main` (auto-deploy).
- [ ] Pastikan rilis benar-benar sampai di `https://appointment.praktiqu.com` (bukan hanya Actions hijau): mis. `curl -s -o /dev/null -w '%{http_code}\n' https://appointment.praktiqu.com/dashboard/klinik/4/admin` harus `302` (ke login) — sebelum rilis route ini `404`.

### Task G4: Uji coba dengan admin percobaan

- [ ] Login sebagai super admin → Clinics → kartu klinik kedua → "Admin klinik ›" → pilih admin percobaan → simpan. Perhatikan peringatan "Admin sebelumnya kini tidak memegang klinik apa pun" bila muncul.
- [ ] Login sebagai admin percobaan → dropdown muncul di sidebar dan topbar ponsel → pindah klinik → daftar pasien, appointments, bills, laporan, dan pengaturan pembayaran internasional berganti ke klinik itu.
- [ ] Buka dua tab, pindah klinik di tab kedua, simpan sesuatu di tab pertama → banner "Klinik aktif sudah berganti di tab lain".
- [ ] Kembalikan klinik ke admin aslinya bila uji coba memakai klinik sungguhan.

**Rollback:** backend dan FE bisa di-revert sendiri-sendiri. Backend lama mengabaikan header yang tidak dikenalnya; FE lama tidak mengirimnya. Penugasan `clinic_admin_id` yang sudah dibuat tetap ada.
