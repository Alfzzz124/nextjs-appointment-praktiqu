# Psikolog Pemilik Klinik — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Psikolog yang ditandai sebagai pemilik sebuah klinik (atau satu-satunya psikolog aktif di klinik itu) bisa memilih mode "Kelola: Klinik X" dan mengurus layanan, jadwal, janji temu, klien, billing, dan laporan klinik itu, sementara rekam medis psikolog lain tetap tertutup.

**Architecture:**
- **Backend.** `getActor()` (satu titik untuk semua route) memvalidasi `X-Praktiqu-Clinic-Id` untuk PROFESSIONAL terhadap `isClinicOwner()` dan menyimpan hasilnya di `actor.ownerClinicId`.
  - Hanya pada route yang ada di daftar putih `OWNER_ROUTES`, actor-nya ditukar menjadi CLINIC_ADMIN untuk klinik itu (`asClinicManager`), sehingga logika scope admin yang sudah ada dipakai apa adanya.
  - Route lain, termasuk semua route klinis, tetap melihat PROFESSIONAL biasa. Route baru tertutup secara default.
- **FE.** Pola yang sama: helper `AuthController::profilOperasional()` mengembalikan profil "admin untuk klinik X" saat mode pemilik aktif. Helper ini dipakai **hanya** di controller operasional. Controller klinis (Hasil Klien, dokumen encounter) tetap memakai `validProfile()`.
- **Data pemilik.** Tabel app baru `clinic_owners`; klinik solo dihitung saat request.

**Tech Stack:** Next.js 15 route handlers + Prisma (MySQL WordPress DB) + vitest; Laravel 12 + Blade + Alpine.js + PHPUnit (PHP 8.4 via Docker).

**Spec:** `docs/superpowers/specs/2026-10-16-psikolog-pemilik-klinik-design.md`. Baca dulu "Keputusan user" dan bagian "Catatan rencana" di akhir spec.

## Global Constraints

Berlaku untuk SETIAP task:

**Database**
- **Jangan pernah** menjalankan `prisma db push` atau `prisma migrate dev/deploy/reset`. `DATABASE_URL` adalah database WordPress. Tabel baru dibuat hanya lewat `prisma/manual/2026-10-16-clinic-owners.sql`.
- Yang boleh: `npx prisma db execute --file <sql> --url <url-db-uji>` dan `npx prisma generate`.
- Plugin WordPress `praktiqu-endpoint` **tidak diubah**.

**Kontrak header dan kode error**
- Header: **`X-Praktiqu-Clinic-Id`**, format sah regex **`^[1-9][0-9]{0,18}$`**.
- Kode error untuk header ini tetap **`invalid_clinic_header`** (400) dan **`clinic_not_in_scope`** (403). Psikolog memakai kode yang sama dengan admin.

**Definisi pemilik**
- **Psikolog aktif di klinik C:** ada baris `wp_kc_doctor_clinic_mappings` (doctor_id, C), dan `wp_usermeta[wp_capabilities]` mengandung `"kiviCare_doctor"`, dan `praktiqu_professional_status` adalah `ACTIVE`, kosong, atau tidak ada.
- **Klinik solo:** tepat 1 psikolog aktif.
- **Pemilik:** psikolog aktif di klinik itu, dan (ada baris `clinic_owners` **atau** kliniknya solo).

**Batas akses (K4 di spec)**
- Rekam medis tidak pernah ikut dibuka. Route encounter, catatan sesi, hasil klien, riwayat medis, resep, laporan medis, follow-up, dan `sessions/{id}/(notes|summary|attachments|custom-fields)` **tidak boleh** masuk `OWNER_ROUTES`.
- Akses di luar scope tetap mengikuti konvensi repo: 404, atau 403 untuk peran yang salah.

**FE**
- `AuthController::PROFILE_VERSION` **tetap 5**. Menaikkannya me-logout semua staf. Sesi lama tanpa kunci `ownedClinics` diisi ulang lewat `/auth/me` saat dashboard dibuka.
- Repo FE tidak punya git identity, jadi setiap commit memakai `git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit ...`.

**Bahasa dan commit**
- Komentar kode mengikuti file yang diubah: backend Inggris, FE Indonesia.
- Pesan untuk pengguna dalam Bahasa Indonesia.
- Commit dalam Bahasa Indonesia, format conventional (`feat(auth): ...`), diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit hanya file yang disebut di task (`git add <path>`), **jangan `git add -A`**.

**Repo backend**
- Repo `Alfzzz124/nextjs-appointment-praktiqu`, branch **`feat/pemilik-klinik`** (berbasis `origin/fix/scope-gaps`, yang belum di-merge ke `main`).
- Worktree **`/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan`**.
- Push: `git push origin feat/pemilik-klinik`. Key SSH sudah diatur lewat `core.sshCommand`.

**Repo FE**
- Repo `raakanaka/laravel-praktiqu`, branch **`feat/pemilik-klinik`** dari `origin/main` 511e708.
- Worktree **`/home/ahmad/projects/praktiqu-fe/pemilik-klinik`**.
- `main` FE auto-deploy ke produksi: **hanya lewat branch + PR, jangan pernah push ke `main`**.
- Push: `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/pemilik-klinik`.

**Menjalankan tes**
- Backend: `npx vitest run <file>` dari worktree BE.
  - DB uji = MySQL Docker `praktiqu-mysql`.
  - `DATABASE_URL` di `.env.test.local` **wajib mengandung "test"**.
- FE: `DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit [--filter X]`.
  - `vendor/` harus **salinan**, bukan symlink. Autoload composer menunjuk ke folder induknya, jadi symlink menguji kode worktree lain.

**Rentang id uji backend** (masing-masing selebar 10.000)

| Task | Rentang |
|---|---|
| B2 | `8_760_000` |
| B3 | `8_770_000` |
| B4 | `8_780_000` |
| B5 | `8_790_000` |
| B6 | `8_755_000` (selebar 5.000) |

Rentang `8_700_000`–`8_799_999` juga disapu `tests/repositories/wp-appointments.repo.test.ts` dan `wp-clinical-records.repo.test.ts`, tapi hanya untuk tabel janji temu, riwayat medis, dan resep. Tabel yang dipakai fitur ini (`wp_users`, `wp_usermeta`, `wp_kc_clinics`, `wp_kc_doctor_clinic_mappings`, `clinic_owners`) tidak ikut tersapu, jadi aman.

## Peta file

**Backend** (`/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan`)

| File | Status | Tanggung jawab |
|---|---|---|
| `prisma/manual/2026-10-16-clinic-owners.sql` | baru | DDL tabel `clinic_owners` |
| `prisma/schema.prisma` | ubah | model `ClinicOwner` |
| `src/services/clinic-owner/service.ts` | baru | `listOwnedClinics`, `isClinicOwner`, `listClinicOwnerRoster`, `setClinicOwners` |
| `src/lib/auth/owner-routes.ts` | baru | `OWNER_ROUTES`, `isOwnerRoute`, `asClinicManager` |
| `src/lib/auth/active-clinic.ts` | ubah | cabang PROFESSIONAL → `ownerClinicId` |
| `src/lib/auth.ts` | ubah | `Actor.ownerClinicId`, elevasi di `getActor()` |
| `src/services/auth/service.ts` | ubah | `scopeClinics()` mengirim `ownedClinics` untuk PROFESSIONAL |
| `src/app/api/v1/practices/[id]/owners/route.ts` | baru | `GET`/`PUT` pemilik klinik |
| `docs/api/SERVICES-CRUD-GUIDE.md`, `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` | ubah | dokumentasi kontrak |
| `tests/services/clinic-owner.service.test.ts` | baru | B2 |
| `tests/lib/auth/owner-routes.test.ts` | baru | B3 (unit) |
| `tests/integration/auth/owner-mode-header.test.ts` | baru | B3 (integrasi) |
| `tests/integration/auth/owner-mode-scope.test.ts` | baru | B4 |
| `tests/integration/practice/clinic-owners-route.test.ts` | baru | B5 |
| `tests/integration/auth/auth-me-owned-clinics.test.ts` | baru | B6 |

**FE** (`/home/ahmad/projects/praktiqu-fe/pemilik-klinik`)

| File | Status | Tanggung jawab |
|---|---|---|
| `app/Http/Controllers/AuthController.php` | ubah | `ownedClinics` di profil; `klinikPemilikSesi`, `modePemilik`, `profilOperasional`, `segarkanKlinikPemilik` |
| `app/Services/PraktiquApi.php` | ubah | header untuk psikolog mode pemilik; penolakan → `ModePemilikBerakhirException` |
| `app/Services/ModePemilikBerakhirException.php` | baru | exception "mode pemilik tidak berlaku lagi" |
| `bootstrap/app.php` | ubah | render exception di atas |
| `app/Http/Controllers/KlinikModeController.php` | baru | `POST /dashboard/mode-klinik` |
| `resources/views/dashboard/partials/pilih-mode.blade.php` | baru | dropdown mode |
| `app/Http/Controllers/DashboardController.php` | ubah | `scopedQuery`, `rosterKlinik`, `services`, `index`, `render` |
| `app/Http/Controllers/{Service,DoctorSession,CustomSession,ManualAppointment,Resource,Report}Controller.php` | ubah | `validProfile()` → `profilOperasional()` |
| `app/Http/Middleware/CocokKlinikHalaman.php` | ubah | memakai `profilOperasional()` |
| `resources/views/dashboard.blade.php` | ubah | `peranUi`, menu, dropdown, kartu pengaturan pemilik, fetch wrapper |
| `app/Http/Controllers/KlinikPemilikController.php` | baru | halaman "Pemilik klinik" |
| `resources/views/dashboard/klinik-pemilik.blade.php` | baru | view halaman di atas |
| `resources/views/dashboard/klinik-admin.blade.php` | ubah | tautan ke halaman pemilik (super) |
| `routes/web.php` | ubah | 3 route baru |
| `tests/Feature/ModePemilikProfilTest.php`, `ModePemilikHeaderTest.php`, `ModePemilikGantiTest.php`, `ModePemilikControllerTest.php`, `ModePemilikDashboardTest.php`, `KlinikPemilikTest.php` | baru | F1–F6 |

---

## Part 0 — Persiapan

### Task 0: Worktree backend siap dan tes dasar hijau

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Masuk ke worktree dan pastikan basisnya benar**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan
git fetch origin
git status -sb | head -1
git log --oneline -4
```

Expected:
- Baris status: `## feat/pemilik-klinik...origin/feat/pemilik-klinik`.
- Urutan commit dari atas: commit `docs(plan)` rencana ini, lalu `docs(spec): psikolog pemilik klinik`, lalu `b9c9645 fix(akses): ...`, lalu `0b16fc7 Merge pull request #34`.

Kalau `fix/scope-gaps` sudah di-merge ke `main` saat task ini dikerjakan, rebase dulu: `git rebase origin/main`. Commit scope-gaps akan hilang dari riwayat branch ini.

- [ ] **Step 2: Sambungkan `node_modules` dan env tes**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan
test -e node_modules || ln -s /home/ahmad/projects/nextjs-appointment-praktiqu/node_modules node_modules
test -e .env.test.local || cp /home/ahmad/projects/nextjs-appointment-praktiqu/.env.test.local .env.test.local
grep -c 'DATABASE_URL=.*test' .env.test.local
git status --short
```

Expected: angka `1`, dan `git status --short` kosong.

- [ ] **Step 3: Pastikan MySQL uji menyala**

```bash
docker ps --filter name=praktiqu-mysql --format '{{.Names}} {{.Status}}'
```

Expected: `praktiqu-mysql Up ...`. Kalau kosong, jalankan `docker start praktiqu-mysql`. Kalau Docker Desktop mati, minta user menyalakannya.

- [ ] **Step 4: Tes yang akan disentuh, sebelum mengubah apa pun**

```bash
npx vitest run tests/integration/auth/active-clinic-header.test.ts tests/integration/auth/auth-me-clinic-id.test.ts tests/services/service-catalog.scope.test.ts tests/integration/services/item-route.test.ts
```

Expected: semua PASS. Kalau ada yang gagal di sini, berhenti dan laporkan, karena itu bukan akibat perubahan kita.

---

## Part B — Backend

### Task B1: Tabel `clinic_owners` dan model Prisma

**Files:**
- Create: `prisma/manual/2026-10-16-clinic-owners.sql`
- Modify: `prisma/schema.prisma` (tambahkan model tepat setelah blok `model GoogleCalendarConnection { ... }`)

**Interfaces:**
- Produces: model Prisma `ClinicOwner` → `prisma.clinicOwner`, dengan field `id: bigint`, `clinicId: bigint`, `doctorWpUserId: bigint`, `createdBy: string`, `createdAt: Date`. Kunci unik komposit `clinicId_doctorWpUserId`.

- [ ] **Step 1: Tulis file SQL**

`prisma/manual/2026-10-16-clinic-owners.sql`:

```sql
-- Psychologists marked as owners of a clinic ("pemilik klinik").
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-10-16-clinic-owners.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- Not stored in wp_kc_doctor_clinic_mappings.owner: KiviCare deletes and recreates a
-- doctor's mappings every time the doctor is saved (DoctorController.php:1627-1633),
-- which would silently reset the flag to 0.
--
-- A row only grants anything while the psychologist is still an ACTIVE doctor mapped to
-- the clinic; the check lives in src/services/clinic-owner/service.ts, so a stale row
-- left behind by an unmapping is harmless. A clinic with exactly one active
-- psychologist makes them owner without any row here.
--
-- `createdBy` is users.id (a cuid) of whoever ticked the box.

CREATE TABLE IF NOT EXISTS `clinic_owners` (
  `id`              bigint unsigned NOT NULL AUTO_INCREMENT,
  `clinicId`        bigint unsigned NOT NULL,
  `doctorWpUserId`  bigint unsigned NOT NULL,
  `createdBy`       varchar(191)    NOT NULL,
  `createdAt`       datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `clinic_owners_clinicId_doctorWpUserId_key` (`clinicId`, `doctorWpUserId`),
  KEY `clinic_owners_doctorWpUserId_idx` (`doctorWpUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Tambahkan model Prisma**

Sisipkan di `prisma/schema.prisma`, setelah kurung tutup `model GoogleCalendarConnection`:

```prisma
/// A psychologist marked as owner of a clinic. See prisma/manual/2026-10-16-clinic-owners.sql
/// and src/services/clinic-owner/service.ts — a row grants nothing on its own.
model ClinicOwner {
  id             BigInt   @id @default(autoincrement()) @db.UnsignedBigInt
  /// wp_kc_clinics.id
  clinicId       BigInt   @db.UnsignedBigInt
  /// wp_users.ID of the psychologist
  doctorWpUserId BigInt   @db.UnsignedBigInt
  /// users.id (cuid) of the actor who granted it
  createdBy      String   @db.VarChar(191)
  createdAt      DateTime @default(now()) @db.DateTime(3)

  @@unique([clinicId, doctorWpUserId])
  @@index([doctorWpUserId])
  @@map("clinic_owners")
}
```

- [ ] **Step 3: Generate client dan pasang tabel di DB uji**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan
npx prisma generate
TEST_URL="$(grep '^DATABASE_URL=' .env.test.local | cut -d= -f2- | tr -d '"')"
echo "$TEST_URL" | grep -qi test && npx prisma db execute --file prisma/manual/2026-10-16-clinic-owners.sql --url "$TEST_URL"
```

Expected:
- `generate` mencetak `✔ Generated Prisma Client`.
- `db execute` mencetak `Script executed successfully.`
- Kalau `grep -qi test` gagal, **berhenti**: URL itu bukan DB uji.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add prisma/manual/2026-10-16-clinic-owners.sql prisma/schema.prisma
git commit -m "feat(db): tabel clinic_owners untuk psikolog pemilik klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: Layanan `clinic-owner`

**Files:**
- Create: `src/services/clinic-owner/service.ts`
- Test: `tests/services/clinic-owner.service.test.ts`

**Interfaces:**
- Consumes: `prisma.clinicOwner` (B1).
- Produces:
  - `type OwnerSource = 'manual' | 'solo'`
  - `interface OwnedClinic { id: number; name: string; source: OwnerSource }`
  - `interface RosterEntry { doctorId: number; name: string; owner: boolean; source: OwnerSource | null }`
  - `listOwnedClinics(wpUserId: bigint): Promise<OwnedClinic[]>`
  - `isClinicOwner(wpUserId: bigint, clinicId: bigint): Promise<boolean>`
  - `listClinicOwnerRoster(clinicId: bigint): Promise<RosterEntry[]>`
  - `setClinicOwners(clinicId: bigint, doctorIds: number[], actorId: string): Promise<RosterEntry[]>`
  - `class NotAClinicProfessionalError extends Error { doctorIds: number[] }`

- [ ] **Step 1: Tulis tes yang gagal**

`tests/services/clinic-owner.service.test.ts`:

```ts
/**
 * Who counts as a clinic's owner ("pemilik klinik"): an ACTIVE psychologist mapped to the
 * clinic who is either ticked in clinic_owners or the clinic's only active psychologist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../billing/fixtures';
import {
  NotAClinicProfessionalError,
  isClinicOwner,
  listClinicOwnerRoster,
  listOwnedClinics,
  setClinicOwners,
} from '@/services/clinic-owner/service';

const BASE = 8_760_000;
const END = BASE + 10_000;
const SOLO = BASE + 1; // one active doctor: DOC_A
const SHARED = BASE + 2; // DOC_A + DOC_B, DOC_B ticked
const WITH_INACTIVE = BASE + 3; // DOC_A active + DOC_OFF inactive → solo for DOC_A
const UNTICKED = BASE + 4; // DOC_A + DOC_B, nobody ticked
const DOC_A = BASE + 500;
const DOC_B = BASE + 501;
const DOC_OFF = BASE + 502;
const PATIENT = BASE + 503; // not a doctor at all

function caps(role: string): string {
  return `a:1:{s:${role.length}:"${role}";b:1;}`;
}

async function wpUser(id: number, name: string, role: string, status?: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `own${id}`, userEmail: `own${id}@test.local`, displayName: name, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) } });
  if (status !== undefined) {
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: status } });
  }
}

async function clinic(id: number, name: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    id, name, `c${id}@test.local`,
  );
}

let mapId = BASE + 9000;
async function map(doctorId: number, clinicId: number) {
  mapId += 1;
  await prisma.kcDoctorClinicMapping.create({
    data: { id: BigInt(mapId), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() },
  });
}

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  await wpUser(DOC_A, 'Dr A', 'kiviCare_doctor'); // no status meta → ACTIVE
  await wpUser(DOC_B, 'Dr B', 'kiviCare_doctor', 'ACTIVE');
  await wpUser(DOC_OFF, 'Dr Off', 'kiviCare_doctor', 'INACTIVE');
  await wpUser(PATIENT, 'Pasien', 'kiviCare_patient');
  await clinic(SOLO, 'Klinik Solo');
  await clinic(SHARED, 'Klinik Bersama');
  await clinic(WITH_INACTIVE, 'Klinik Satu Aktif');
  await clinic(UNTICKED, 'Klinik Tanpa Pemilik');
  await map(DOC_A, SOLO);
  await map(DOC_A, SHARED);
  await map(DOC_B, SHARED);
  await map(DOC_A, WITH_INACTIVE);
  await map(DOC_OFF, WITH_INACTIVE);
  await map(DOC_A, UNTICKED);
  await map(DOC_B, UNTICKED);
  await prisma.clinicOwner.create({ data: { clinicId: BigInt(SHARED), doctorWpUserId: BigInt(DOC_B), createdBy: 'test' } });
});

afterAll(async () => {
  await wipe();
});

describe('listOwnedClinics', () => {
  it('gives a sole active psychologist their clinic as solo, an inactive colleague not counting', async () => {
    expect(await listOwnedClinics(BigInt(DOC_A))).toEqual([
      { id: SOLO, name: 'Klinik Solo', source: 'solo' },
      { id: WITH_INACTIVE, name: 'Klinik Satu Aktif', source: 'solo' },
    ]);
  });

  it('gives a ticked psychologist of a shared clinic that clinic as manual', async () => {
    expect(await listOwnedClinics(BigInt(DOC_B))).toEqual([
      { id: SHARED, name: 'Klinik Bersama', source: 'manual' },
    ]);
  });

  it('gives an inactive psychologist nothing, even at a clinic they are mapped to', async () => {
    expect(await listOwnedClinics(BigInt(DOC_OFF))).toEqual([]);
  });

  it('ignores a clinic_owners row whose psychologist is no longer mapped there', async () => {
    await prisma.clinicOwner.create({ data: { clinicId: BigInt(SOLO), doctorWpUserId: BigInt(DOC_B), createdBy: 'test' } });
    try {
      expect((await listOwnedClinics(BigInt(DOC_B))).map((c) => c.id)).toEqual([SHARED]);
    } finally {
      await prisma.clinicOwner.deleteMany({ where: { clinicId: BigInt(SOLO), doctorWpUserId: BigInt(DOC_B) } });
    }
  });
});

describe('isClinicOwner', () => {
  it('is true for solo and ticked, false for an unticked shared clinic and for a non-doctor', async () => {
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(SOLO))).toBe(true);
    expect(await isClinicOwner(BigInt(DOC_B), BigInt(SHARED))).toBe(true);
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(SHARED))).toBe(false);
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(UNTICKED))).toBe(false);
    expect(await isClinicOwner(BigInt(PATIENT), BigInt(SOLO))).toBe(false);
  });
});

describe('listClinicOwnerRoster', () => {
  it('lists active psychologists with owner flag and source', async () => {
    expect(await listClinicOwnerRoster(BigInt(SHARED))).toEqual([
      { doctorId: DOC_A, name: 'Dr A', owner: false, source: null },
      { doctorId: DOC_B, name: 'Dr B', owner: true, source: 'manual' },
    ]);
    expect(await listClinicOwnerRoster(BigInt(WITH_INACTIVE))).toEqual([
      { doctorId: DOC_A, name: 'Dr A', owner: true, source: 'solo' },
    ]);
  });
});

describe('setClinicOwners', () => {
  it('replaces the manual set: grants the new, revokes the dropped', async () => {
    const roster = await setClinicOwners(BigInt(UNTICKED), [DOC_A], 'actor-x');
    expect(roster.find((r) => r.doctorId === DOC_A)).toEqual({ doctorId: DOC_A, name: 'Dr A', owner: true, source: 'manual' });
    const row = await prisma.clinicOwner.findUnique({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(UNTICKED), doctorWpUserId: BigInt(DOC_A) } },
    });
    expect(row?.createdBy).toBe('actor-x');

    await setClinicOwners(BigInt(UNTICKED), [DOC_B], 'actor-x');
    expect(await isClinicOwner(BigInt(DOC_A), BigInt(UNTICKED))).toBe(false);
    expect(await isClinicOwner(BigInt(DOC_B), BigInt(UNTICKED))).toBe(true);

    await setClinicOwners(BigInt(UNTICKED), [], 'actor-x');
    expect(await prisma.clinicOwner.count({ where: { clinicId: BigInt(UNTICKED) } })).toBe(0);
  });

  it('refuses someone who is not an active psychologist of the clinic, writing nothing', async () => {
    await expect(setClinicOwners(BigInt(UNTICKED), [DOC_A, DOC_OFF, PATIENT], 'actor-x')).rejects.toMatchObject({
      name: 'NotAClinicProfessionalError',
      doctorIds: [DOC_OFF, PATIENT],
    });
    expect(await prisma.clinicOwner.count({ where: { clinicId: BigInt(UNTICKED) } })).toBe(0);
  });

  it('exports the error class', () => {
    expect(new NotAClinicProfessionalError([1])).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npx vitest run tests/services/clinic-owner.service.test.ts
```

Expected: FAIL, `Failed to resolve import "@/services/clinic-owner/service"`.

- [ ] **Step 3: Implementasi**

`src/services/clinic-owner/service.ts`:

```ts
/**
 * Clinic owners ("pemilik klinik"): psychologists allowed to run a clinic's operations —
 * services, schedules, appointments, clients, billing, reports — without becoming its
 * clinic admin. See docs/superpowers/specs/2026-10-16-psikolog-pemilik-klinik-design.md.
 *
 * Ownership is never trusted from the clinic_owners table alone. A psychologist owns
 * clinic C only while they are an ACTIVE doctor mapped to C AND (they are ticked in
 * clinic_owners OR they are C's only active doctor). That way a row left behind by an
 * unmapping or a deactivation grants nothing, and a second psychologist joining a solo
 * clinic ends the automatic ownership on the very next request.
 */
import { prisma } from '@/lib/db';
import { audit } from '@/lib/logging';
import { CAPABILITIES_KEY, KIVICARE_ROLES, roleLikePattern } from '@/repositories/wp/wp-user';
import { PROFESSIONAL_STATUS, PROFESSIONAL_STATUS_META_KEY } from '@/repositories/wp/doctors.repo';

export type OwnerSource = 'manual' | 'solo';

export interface OwnedClinic {
  id: number;
  name: string;
  source: OwnerSource;
}

export interface RosterEntry {
  doctorId: number;
  name: string;
  owner: boolean;
  source: OwnerSource | null;
}

export class NotAClinicProfessionalError extends Error {
  constructor(public doctorIds: number[]) {
    super('not_a_clinic_professional');
    this.name = 'NotAClinicProfessionalError';
  }
}

const byId = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Active psychologists mapped to each clinic, as clinicId → doctor ids (ascending).
 *
 * "Active" follows doctors.repo.ts: the praktiqu status meta is ACTIVE, empty or absent.
 * wp_users.user_status is deliberately ignored — KiviCare's own use of it contradicts
 * itself (doctors.repo.ts:30-36).
 */
async function activeDoctorsByClinic(clinicIds: bigint[]): Promise<Map<bigint, bigint[]>> {
  const out = new Map<bigint, bigint[]>();
  if (clinicIds.length === 0) return out;
  const rows = await prisma.$queryRawUnsafe<{ clinicId: bigint; doctorId: bigint }[]>(
    `SELECT DISTINCT dcm.clinic_id AS clinicId, dcm.doctor_id AS doctorId
       FROM wp_kc_doctor_clinic_mappings dcm
       JOIN wp_users u ON u.ID = dcm.doctor_id
      WHERE dcm.clinic_id IN (${clinicIds.map(() => '?').join(',')})
        AND EXISTS (
          SELECT 1 FROM wp_usermeta cap
           WHERE cap.user_id = u.ID AND cap.meta_key = ? AND cap.meta_value LIKE ?)
        AND NOT EXISTS (
          SELECT 1 FROM wp_usermeta st
           WHERE st.user_id = u.ID AND st.meta_key = ? AND st.meta_value <> '' AND st.meta_value <> ?)
      ORDER BY dcm.doctor_id`,
    ...clinicIds,
    CAPABILITIES_KEY,
    roleLikePattern(KIVICARE_ROLES.doctor),
    PROFESSIONAL_STATUS_META_KEY,
    PROFESSIONAL_STATUS.ACTIVE,
  );
  for (const r of rows) {
    const clinicId = BigInt(r.clinicId);
    out.set(clinicId, [...(out.get(clinicId) ?? []), BigInt(r.doctorId)]);
  }
  return out;
}

/** Every clinic this psychologist owns right now, ascending by id. */
export async function listOwnedClinics(wpUserId: bigint): Promise<OwnedClinic[]> {
  const mapped = await prisma.kcDoctorClinicMapping.findMany({
    where: { doctorId: wpUserId },
    select: { clinicId: true },
  });
  const clinicIds = [...new Set(mapped.map((m) => m.clinicId))].sort(byId);
  if (clinicIds.length === 0) return [];

  const [active, manual, clinics] = await Promise.all([
    activeDoctorsByClinic(clinicIds),
    prisma.clinicOwner.findMany({
      where: { doctorWpUserId: wpUserId, clinicId: { in: clinicIds } },
      select: { clinicId: true },
    }),
    prisma.kcClinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } }),
  ]);
  const ticked = new Set(manual.map((m) => m.clinicId));
  const names = new Map(clinics.map((c) => [c.id, c.name?.trim() || `Klinik #${c.id}`]));

  const out: OwnedClinic[] = [];
  for (const id of clinicIds) {
    const doctors = active.get(id) ?? [];
    if (!doctors.includes(wpUserId)) continue; // not an active doctor here
    const source: OwnerSource | null = ticked.has(id) ? 'manual' : doctors.length === 1 ? 'solo' : null;
    if (source !== null) out.push({ id: Number(id), name: names.get(id) ?? `Klinik #${id}`, source });
  }
  return out;
}

export async function isClinicOwner(wpUserId: bigint, clinicId: bigint): Promise<boolean> {
  return (await listOwnedClinics(wpUserId)).some((c) => BigInt(c.id) === clinicId);
}

/** The clinic's active psychologists, each with whether they own it and why. */
export async function listClinicOwnerRoster(clinicId: bigint): Promise<RosterEntry[]> {
  const doctors = (await activeDoctorsByClinic([clinicId])).get(clinicId) ?? [];
  if (doctors.length === 0) return [];

  const [manual, users] = await Promise.all([
    prisma.clinicOwner.findMany({
      where: { clinicId, doctorWpUserId: { in: doctors } },
      select: { doctorWpUserId: true },
    }),
    prisma.kcUser.findMany({ where: { id: { in: doctors } }, select: { id: true, displayName: true } }),
  ]);
  const ticked = new Set(manual.map((m) => m.doctorWpUserId));
  const names = new Map(users.map((u) => [u.id, u.displayName?.trim() || `Psikolog #${u.id}`]));
  const solo = doctors.length === 1;

  return doctors.map((d) => {
    const source: OwnerSource | null = ticked.has(d) ? 'manual' : solo ? 'solo' : null;
    return { doctorId: Number(d), name: names.get(d) ?? `Psikolog #${d}`, owner: source !== null, source };
  });
}

/**
 * Replace the clinic's MANUAL owners with exactly `doctorIds`.
 *
 * Every id must be an active psychologist of the clinic; otherwise nothing is written.
 * Solo ownership is not stored, so sending or omitting a solo psychologist changes
 * nothing about their access while the clinic stays solo.
 */
export async function setClinicOwners(
  clinicId: bigint,
  doctorIds: number[],
  actorId: string,
): Promise<RosterEntry[]> {
  const wanted = [...new Set(doctorIds)].map((id) => BigInt(id));
  const active = (await activeDoctorsByClinic([clinicId])).get(clinicId) ?? [];
  const strangers = wanted.filter((id) => !active.includes(id));
  if (strangers.length > 0) throw new NotAClinicProfessionalError(strangers.map(Number));

  const current = await prisma.clinicOwner.findMany({ where: { clinicId }, select: { doctorWpUserId: true } });
  const have = new Set(current.map((c) => c.doctorWpUserId));
  const want = new Set(wanted);
  const grant = wanted.filter((id) => !have.has(id));
  const revoke = [...have].filter((id) => !want.has(id));

  await prisma.$transaction([
    prisma.clinicOwner.deleteMany({ where: { clinicId, doctorWpUserId: { in: revoke } } }),
    prisma.clinicOwner.createMany({
      data: grant.map((doctorWpUserId) => ({ clinicId, doctorWpUserId, createdBy: actorId })),
      skipDuplicates: true,
    }),
  ]);

  for (const d of grant) {
    await audit('clinic_owner.granted', {
      userId: actorId, resource: 'clinic', resourceId: String(clinicId), metadata: { doctorId: String(d) },
    });
  }
  for (const d of revoke) {
    await audit('clinic_owner.revoked', {
      userId: actorId, resource: 'clinic', resourceId: String(clinicId), metadata: { doctorId: String(d) },
    });
  }

  return listClinicOwnerRoster(clinicId);
}
```

Kalau `tsc` menolak salah satu field `audit` (`resource`, `resourceId`, `metadata`), samakan dengan bentuk yang dipakai `src/services/service-catalog/service.ts` (panggilan `audit('service.updated', {...})`).

- [ ] **Step 4: Jalankan tes, typecheck**

```bash
npx vitest run tests/services/clinic-owner.service.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS, dan `0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/clinic-owner/service.ts tests/services/clinic-owner.service.test.ts
git commit -m "feat(klinik): siapa pemilik klinik — manual, solo, dan pengaturannya

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3: Mode pemilik di `getActor()` dan daftar putih route

**Files:**
- Create: `src/lib/auth/owner-routes.ts`
- Modify: `src/lib/auth/active-clinic.ts`, `src/lib/auth.ts`
- Test: `tests/lib/auth/owner-routes.test.ts`, `tests/integration/auth/owner-mode-header.test.ts`

**Interfaces:**
- Consumes: `isClinicOwner(wpUserId, clinicId)` (B2).
- Produces:
  - `Actor.ownerClinicId?: bigint`
  - `isOwnerRoute(method: string, pathname: string): boolean`
  - `asClinicManager(actor: Actor, clinicId: bigint): Actor`
  - `ActiveClinicResult` versi ok mendapat field `ownerClinicId?: bigint`.

- [ ] **Step 1: Tes unit daftar putih (gagal)**

`tests/lib/auth/owner-routes.test.ts`:

```ts
/**
 * The owner-mode allowlist. A route NOT listed here keeps seeing a plain PROFESSIONAL
 * even when the psychologist is in owner mode — that is what keeps other psychologists'
 * clinical records closed (spec K4). New routes are closed by default.
 */
import { describe, expect, it } from 'vitest';
import { asClinicManager, isOwnerRoute } from '@/lib/auth/owner-routes';

describe('isOwnerRoute — operational routes are elevated', () => {
  it.each([
    ['GET', '/api/v1/services'],
    ['POST', '/api/v1/services'],
    ['PUT', '/api/v1/services/488'],
    ['DELETE', '/api/v1/services/488'],
    ['GET', '/api/v1/professional-sessions'],
    ['POST', '/api/v1/professional-sessions'],
    ['PUT', '/api/v1/professional-sessions/12'],
    ['PUT', '/api/v1/professional-sessions/week'],
    ['GET', '/api/v1/professional-sessions/grouped'],
    ['GET', '/api/v1/doctor-sessions/export'],
    ['POST', '/api/v1/doctor-sessions/bulk/delete'],
    ['GET', '/api/v1/sessions'],
    ['GET', '/api/v1/sessions/calendar'],
    ['GET', '/api/v1/sessions/export'],
    ['GET', '/api/v1/sessions/77'],
    ['POST', '/api/v1/sessions/77/approve'],
    ['POST', '/api/v1/sessions/77/check-out'],
    ['POST', '/api/v1/sessions/bulk/delete'],
    ['GET', '/api/v1/clients'],
    ['POST', '/api/v1/clients'],
    ['PATCH', '/api/v1/clients/9'],
    ['DELETE', '/api/v1/clients/9'],
    ['PATCH', '/api/v1/clients/9/status'],
    ['POST', '/api/v1/clients/bulk/status'],
    ['GET', '/api/v1/bills'],
    ['GET', '/api/v1/bills/3'],
    ['GET', '/api/v1/dashboard/statistics'],
    ['GET', '/api/v1/dashboard/revenue-chart'],
    ['get', '/api/v1/services/'],
  ])('%s %s', (method, path) => {
    expect(isOwnerRoute(method, path)).toBe(true);
  });
});

describe('isOwnerRoute — clinical, configuration and unknown routes stay PROFESSIONAL', () => {
  it.each([
    ['GET', '/api/v1/encounters'],
    ['POST', '/api/v1/encounters'],
    ['GET', '/api/v1/sessions/77/notes'],
    ['GET', '/api/v1/sessions/77/summary'],
    ['GET', '/api/v1/sessions/77/attachments/5/content'],
    ['PUT', '/api/v1/sessions/77/custom-fields'],
    ['GET', '/api/v1/clients/9/custom-fields'],
    ['GET', '/api/v1/clients/9/statistics'],
    ['GET', '/api/v1/patient-medical-reports'],
    ['GET', '/api/v1/medical-history'],
    ['GET', '/api/v1/prescriptions'],
    ['GET', '/api/v1/follow-ups'],
    ['GET', '/api/v1/bills/by-encounter/4'],
    ['GET', '/api/v1/bills/encounters-without-bill'],
    ['DELETE', '/api/v1/bills/item/4'],
    ['GET', '/api/v1/practices/4/settings'],
    ['PATCH', '/api/v1/practices/4'],
    ['PUT', '/api/v1/practices/4/payment-settings'],
    ['GET', '/api/v1/practices/4/holidays'],
    ['PUT', '/api/v1/practices/4/owners'],
    ['GET', '/api/v1/receptionists'],
    ['GET', '/api/v1/professionals'],
    ['PATCH', '/api/v1/professionals/12'],
    ['GET', '/api/v1/clinic-schedules'],
    ['POST', '/api/v1/sessions'],
    ['PATCH', '/api/v1/services/488'],
    ['GET', '/api/v1/services/abc'],
    ['GET', '/api/v1/services-extra'],
  ])('%s %s', (method, path) => {
    expect(isOwnerRoute(method, path)).toBe(false);
  });
});

describe('asClinicManager', () => {
  it('acts as CLINIC_ADMIN of exactly that clinic, keeping identity', () => {
    const actor = { id: 'u1', role: 'PROFESSIONAL' as const, practiceId: null, ownerClinicId: 4n };
    expect(asClinicManager(actor, 4n)).toEqual({
      id: 'u1', role: 'CLINIC_ADMIN', practiceId: null, activeClinicId: 4n, ownerClinicId: 4n,
    });
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npx vitest run tests/lib/auth/owner-routes.test.ts
```

Expected: FAIL, karena module tidak ditemukan.

- [ ] **Step 3: Implementasi `owner-routes.ts`**

`src/lib/auth/owner-routes.ts`:

```ts
/**
 * Owner mode: which routes a psychologist who owns the clinic they picked with
 * X-Praktiqu-Clinic-Id may use AS that clinic's admin.
 *
 * getActor() swaps the actor for `asClinicManager(...)` on these routes only, so the
 * existing CLINIC_ADMIN scoping applies unchanged — services, schedules, appointments,
 * clients, billing reads, dashboard figures, all pinned to the owned clinic. Every route
 * NOT listed keeps a plain PROFESSIONAL actor; that is what keeps other psychologists'
 * clinical records (encounters, notes, results, medical history, reports) closed, and
 * what keeps a route added later closed until someone decides otherwise.
 *
 * Patterns are anchored and ids are numeric, so `/sessions/77/notes` can never ride on
 * the `/sessions/77` entry. Spec: docs/superpowers/specs/2026-10-16-psikolog-pemilik-klinik-design.md §3.
 */
import type { Actor } from '@/lib/auth';

const ID = '[1-9][0-9]*';
const SCHEDULES = '(?:professional|doctor)-sessions';

type Rule = { path: RegExp; methods: readonly string[] };

const rule = (path: string, methods: readonly string[]): Rule => ({ path: new RegExp(`^${path}$`), methods });

export const OWNER_ROUTES: readonly Rule[] = [
  // Services offered at the clinic
  rule('/api/v1/services', ['GET', 'POST']),
  rule(`/api/v1/services/${ID}`, ['GET', 'PUT', 'DELETE']),

  // Practice schedules of every psychologist at the clinic
  rule(`/api/v1/${SCHEDULES}`, ['GET', 'POST']),
  rule(`/api/v1/${SCHEDULES}/${ID}`, ['GET', 'PUT', 'DELETE']),
  rule(`/api/v1/${SCHEDULES}/week`, ['GET', 'PUT', 'DELETE']),
  rule(`/api/v1/${SCHEDULES}/(?:grouped|module|export)`, ['GET']),
  rule(`/api/v1/${SCHEDULES}/bulk/delete`, ['POST']),

  // Appointments (not their notes, summaries, attachments or custom fields)
  rule('/api/v1/sessions', ['GET']),
  rule('/api/v1/sessions/(?:calendar|pending|export)', ['GET']),
  rule('/api/v1/sessions/bulk/delete', ['POST']),
  rule(`/api/v1/sessions/${ID}`, ['GET']),
  rule(`/api/v1/sessions/${ID}/(?:approve|reject|cancel|check-in|check-out)`, ['POST']),

  // Clients: identity and contact only
  rule('/api/v1/clients', ['GET', 'POST']),
  rule('/api/v1/clients/export', ['GET']),
  rule('/api/v1/clients/bulk/(?:delete|status)', ['POST']),
  rule(`/api/v1/clients/${ID}`, ['GET', 'PATCH', 'DELETE']),
  rule(`/api/v1/clients/${ID}/status`, ['PATCH']),

  // Billing and report figures (read)
  rule('/api/v1/bills', ['GET']),
  rule('/api/v1/bills/export', ['GET']),
  rule(`/api/v1/bills/${ID}`, ['GET']),
  rule('/api/v1/dashboard/(?:statistics|revenue-chart|recent-payments|upcoming-sessions|top-professionals)', ['GET']),
];

export function isOwnerRoute(method: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const verb = method.toUpperCase();
  return OWNER_ROUTES.some((r) => r.methods.includes(verb) && r.path.test(path));
}

/** The actor as admin of the clinic they own, for one allowlisted request. */
export function asClinicManager(actor: Actor, clinicId: bigint): Actor {
  return { ...actor, role: 'CLINIC_ADMIN', activeClinicId: clinicId, ownerClinicId: clinicId };
}
```

- [ ] **Step 4: Tes integrasi header untuk psikolog (gagal)**

`tests/integration/auth/owner-mode-header.test.ts`:

```ts
/**
 * X-Praktiqu-Clinic-Id for a PROFESSIONAL: owner mode. Accepted only for a clinic they
 * own; on allowlisted routes the actor becomes that clinic's admin, elsewhere it stays a
 * professional carrying ownerClinicId.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { AuthError, getActor } from '@/lib/auth';
import { assertTestDb } from '../../billing/fixtures';

const BASE = 8_770_000;
const END = BASE + 10_000;
const OWNED = BASE + 1; // solo clinic of DOC
const SHARED = BASE + 2; // DOC + OTHER, nobody ticked
const DOC = BASE + 500;
const OTHER = BASE + 501;
const DOC_USER = 'owner-mode-test-doc';
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(path: string, header?: string, method = 'GET'): Promise<NextRequest> {
  const jwt = await new SignJWT({ role: 'PROFESSIONAL' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(DOC_USER).setExpirationTime('1h').sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (header !== undefined) headers['x-praktiqu-clinic-id'] = header;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

async function rejection(p: Promise<unknown>): Promise<AuthError> {
  try { await p; } catch (err) { if (err instanceof AuthError) return err; throw err; }
  throw new Error('expected getActor to reject');
}

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owner-mode-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, OTHER]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `om${id}`, userEmail: `om${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  for (const [id, name] of [[OWNED, 'Klinik Milik'], [SHARED, 'Klinik Bersama']] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, id, name, `c${id}@test.local`);
  }
  let m = BASE + 9000;
  for (const [doctorId, clinicId] of [[DOC, OWNED], [DOC, SHARED], [OTHER, SHARED]]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(m), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() } });
  }
  await prisma.user.create({
    data: { id: DOC_USER, email: `${DOC_USER}@test.local`, username: DOC_USER, firstName: 'D', lastName: 'R', displayName: 'Dr', role: 'PROFESSIONAL', wpUserId: BigInt(DOC), status: 1 },
  });
});

afterAll(async () => {
  await wipe();
});

describe('getActor — PROFESSIONAL with X-Praktiqu-Clinic-Id', () => {
  it('without the header: a plain professional, no owner clinic', async () => {
    const actor = await getActor(await req('/api/v1/services'));
    expect(actor.role).toBe('PROFESSIONAL');
    expect(actor.ownerClinicId).toBeUndefined();
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('owned clinic on an allowlisted route: acts as that clinic admin', async () => {
    const actor = await getActor(await req('/api/v1/services', String(OWNED)));
    expect(actor.role).toBe('CLINIC_ADMIN');
    expect(actor.activeClinicId).toBe(BigInt(OWNED));
    expect(actor.ownerClinicId).toBe(BigInt(OWNED));
  });

  it('owned clinic on a clinical route: stays a professional', async () => {
    const actor = await getActor(await req('/api/v1/encounters', String(OWNED)));
    expect(actor.role).toBe('PROFESSIONAL');
    expect(actor.ownerClinicId).toBe(BigInt(OWNED));
    expect(actor.activeClinicId).toBeUndefined();
  });

  it('a clinic they practise at but do not own: 403 clinic_not_in_scope', async () => {
    const err = await rejection(getActor(await req('/api/v1/services', String(SHARED))));
    expect(err.status).toBe(403);
    expect(err.message).toBe('clinic_not_in_scope');
  });

  it('a malformed value: 400 invalid_clinic_header', async () => {
    const err = await rejection(getActor(await req('/api/v1/services', '01')));
    expect(err.status).toBe(400);
    expect(err.message).toBe('invalid_clinic_header');
  });

  it('ticking them as owner opens the shared clinic on the next request', async () => {
    await prisma.clinicOwner.create({ data: { clinicId: BigInt(SHARED), doctorWpUserId: BigInt(DOC), createdBy: 'test' } });
    const actor = await getActor(await req('/api/v1/sessions', String(SHARED)));
    expect(actor.role).toBe('CLINIC_ADMIN');
    expect(actor.activeClinicId).toBe(BigInt(SHARED));
  });
});
```

- [ ] **Step 5: Jalankan dan pastikan gagal**

```bash
npx vitest run tests/integration/auth/owner-mode-header.test.ts
```

Expected: FAIL. Header masih diabaikan untuk PROFESSIONAL, jadi `ownerClinicId` undefined dan tidak ada 403.

- [ ] **Step 6: Ubah `active-clinic.ts`**

Ganti seluruh isi `src/lib/auth/active-clinic.ts` dengan:

```ts
/**
 * X-Praktiqu-Clinic-Id — which clinic the caller is acting in for this request.
 *
 * - CLINIC_ADMIN: one of their own clinics (wp_kc_clinics.clinic_admin_id). The Laravel FE
 *   keeps one "active" and sends it on every call.
 * - PROFESSIONAL: a clinic they OWN (src/services/clinic-owner). This is owner mode; see
 *   src/lib/auth/owner-routes.ts for what it opens. Absent = their ordinary view.
 *
 * getActor() checks it here, so every route sees one validated clinic per request and no
 * route has to know about the header. Every other role ignores it without an error.
 */
import { prisma } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { listAdminClinicIds } from '@/services/billing/kc-actor';
import { isClinicOwner } from '@/services/clinic-owner/service';

/** Lower-case, as `Headers.get()` is case-insensitive anyway. */
export const ACTIVE_CLINIC_HEADER = 'x-praktiqu-clinic-id';

const CLINIC_ID = /^[1-9][0-9]{0,18}$/;

export type ActiveClinicResult =
  | { ok: true; clinicId: bigint | undefined; ownerClinicId?: bigint }
  | { ok: false; status: 400; code: 'invalid_clinic_header' }
  | { ok: false; status: 403; code: 'clinic_not_in_scope' };

export async function resolveActiveClinic(
  actorId: string,
  role: Actor['role'],
  raw: string | null,
): Promise<ActiveClinicResult> {
  if (role !== 'CLINIC_ADMIN' && role !== 'PROFESSIONAL') return { ok: true, clinicId: undefined };

  const value = raw?.trim() ?? '';
  if (value === '') return { ok: true, clinicId: undefined };
  if (!CLINIC_ID.test(value)) return { ok: false, status: 400, code: 'invalid_clinic_header' };

  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { wpUserId: true } });
  if (!user?.wpUserId) return { ok: false, status: 403, code: 'clinic_not_in_scope' };

  const clinicId = BigInt(value);
  // A clinic that does not exist gets the same answer as someone else's, so the header
  // cannot be used to probe which clinic ids exist.
  if (role === 'PROFESSIONAL') {
    return (await isClinicOwner(user.wpUserId, clinicId))
      ? { ok: true, clinicId: undefined, ownerClinicId: clinicId }
      : { ok: false, status: 403, code: 'clinic_not_in_scope' };
  }

  const own = await listAdminClinicIds(user.wpUserId);
  return own.includes(clinicId)
    ? { ok: true, clinicId }
    : { ok: false, status: 403, code: 'clinic_not_in_scope' };
}
```

- [ ] **Step 7: Ubah `src/lib/auth.ts`**

(a) Tambahkan import, di bawah import `active-clinic`:

```ts
import { asClinicManager, isOwnerRoute } from '@/lib/auth/owner-routes';
```

(b) Di `interface Actor`, setelah `activeClinicId?: bigint;`:

```ts
  /**
   * The clinic a PROFESSIONAL owns and picked with X-Praktiqu-Clinic-Id (owner mode),
   * already checked by getActor(). On an allowlisted route (owner-routes.ts) getActor()
   * also turns the actor into that clinic's CLINIC_ADMIN; elsewhere it stays a
   * PROFESSIONAL and this field is informational only.
   */
  ownerClinicId?: bigint;
```

(c) Di `getActor()`, ganti baris

```ts
  if (active.clinicId !== undefined) actor.activeClinicId = active.clinicId;
  return actor;
```

dengan

```ts
  if (active.clinicId !== undefined) actor.activeClinicId = active.clinicId;
  if (active.ownerClinicId !== undefined) {
    actor.ownerClinicId = active.ownerClinicId;
    if (isOwnerRoute(req.method, req.nextUrl.pathname)) actor = asClinicManager(actor, active.ownerClinicId);
  }
  return actor;
```

- [ ] **Step 8: Jalankan tes B3 dan tes header admin yang lama**

```bash
npx vitest run tests/lib/auth/owner-routes.test.ts tests/integration/auth/owner-mode-header.test.ts tests/integration/auth/active-clinic-header.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS, dan `0`.

Kalau `active-clinic-header.test.ts` punya kasus "PROFESSIONAL mengabaikan header", kasus itu sekarang salah. Ubah kasus itu supaya memakai klinik yang **bukan** milik psikolog tersebut dan mengharapkan 403 `clinic_not_in_scope`. Jangan hapus kasusnya.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/owner-routes.ts src/lib/auth/active-clinic.ts src/lib/auth.ts tests/lib/auth/owner-routes.test.ts tests/integration/auth/owner-mode-header.test.ts tests/integration/auth/active-clinic-header.test.ts
git commit -m "feat(auth): mode pemilik — psikolog pemilik bertindak sebagai admin kliniknya di route operasional

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4: Bukti di scope dan route yang sebenarnya

Tujuannya membuktikan dua hal dengan kode scope asli, bukan mock: actor hasil `getActor()` benar-benar ter-scope ke klinik milik di route operasional, dan tetap tertutup di route klinis atau konfigurasi.

**Files:**
- Test: `tests/integration/auth/owner-mode-scope.test.ts`

**Interfaces:**
- Consumes: `getActor` (B3), `readScopeFor` (`src/services/service-catalog/scope.ts`), `resolveKcActor` (`src/services/billing/kc-actor.ts`), `doctorSessionScopeFor` (`src/services/billing/staff-scope.ts`), `billScopeFor` (`src/services/billing/kc-permissions.ts`), `dashboardScopeFor` (`src/services/billing/schedule-scope.ts`), route `GET /api/v1/practices/[id]/settings`.

- [ ] **Step 1: Tulis tes**

`tests/integration/auth/owner-mode-scope.test.ts`:

```ts
/**
 * Owner mode reaches the REAL scope functions: on operational routes the actor is pinned
 * to the owned clinic exactly like its admin; on clinical and configuration routes it is
 * still a professional confined to their own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/auth';
import { readScopeFor } from '@/services/service-catalog/scope';
import { resolveKcActor } from '@/services/billing/kc-actor';
import { doctorSessionScopeFor } from '@/services/billing/staff-scope';
import { billScopeFor } from '@/services/billing/kc-permissions';
import { dashboardScopeFor } from '@/services/billing/schedule-scope';
import { assertTestDb } from '../../billing/fixtures';

const { GET: settingsGET } = await import('@/app/api/v1/practices/[id]/settings/route');

const BASE = 8_780_000;
const END = BASE + 10_000;
const FIRST = BASE + 1; // DOC's first mapping, shared with OTHER, not owned
const OWNED = BASE + 2; // DOC + OTHER, DOC ticked
const DOC = BASE + 500;
const OTHER = BASE + 501;
const DOC_USER = 'owner-scope-test-doc';
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(path: string, method = 'GET', header: string | undefined = String(OWNED)): Promise<NextRequest> {
  const jwt = await new SignJWT({ role: 'PROFESSIONAL' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(DOC_USER).setExpirationTime('1h').sign(SECRET);
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (header !== undefined) headers['x-praktiqu-clinic-id'] = header;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owner-scope-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, OTHER]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `os${id}`, userEmail: `os${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  for (const id of [FIRST, OWNED]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
       VALUES (?, ?, ?, '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, id, `Klinik ${id}`, `c${id}@test.local`);
  }
  let m = BASE + 9000;
  for (const [doctorId, clinicId] of [[DOC, FIRST], [OTHER, FIRST], [DOC, OWNED], [OTHER, OWNED]]) {
    m += 1;
    await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(m), doctorId: BigInt(doctorId), clinicId: BigInt(clinicId), createdAt: new Date() } });
  }
  await prisma.clinicOwner.create({ data: { clinicId: BigInt(OWNED), doctorWpUserId: BigInt(DOC), createdBy: 'test' } });
  await prisma.user.create({
    data: { id: DOC_USER, email: `${DOC_USER}@test.local`, username: DOC_USER, firstName: 'D', lastName: 'R', displayName: 'Dr', role: 'PROFESSIONAL', wpUserId: BigInt(DOC), status: 1 },
  });
});

afterAll(async () => {
  await wipe();
});

describe('operational routes in owner mode', () => {
  it('services: every psychologist of the owned clinic, not just their own rows', async () => {
    const scope = await readScopeFor(await getActor(await req('/api/v1/services')));
    expect(scope).toEqual({ clinicId: BigInt(OWNED), doctorId: null, empty: false });
  });

  it('schedules, bills and dashboard: pinned to the owned clinic, not to the first mapping', async () => {
    const kc = await resolveKcActor(await getActor(await req('/api/v1/professional-sessions/week')));
    expect(kc.clinicId).toBe(BigInt(OWNED));
    expect(doctorSessionScopeFor(kc)).toEqual({ clinicId: BigInt(OWNED) });

    const bills = await resolveKcActor(await getActor(await req('/api/v1/bills')));
    expect(billScopeFor(bills)).toEqual({ clinicId: BigInt(OWNED) });

    const dash = await resolveKcActor(await getActor(await req('/api/v1/dashboard/statistics')));
    expect(dashboardScopeFor(dash)).toEqual({ clinicId: BigInt(OWNED) });
  });

  it('without the header nothing changes: own rows only', async () => {
    const scope = await readScopeFor(await getActor(await req('/api/v1/services', 'GET', undefined)));
    expect(scope).toEqual({ clinicId: null, doctorId: BigInt(DOC), empty: false });
  });
});

describe('clinical and configuration routes in owner mode', () => {
  it.each(['/api/v1/encounters', '/api/v1/sessions/1/notes', '/api/v1/patient-medical-reports', '/api/v1/clinic-schedules'])(
    '%s keeps a professional confined to their own rows',
    async (path) => {
      const actor = await getActor(await req(path));
      expect(actor.role).toBe('PROFESSIONAL');
      expect(doctorSessionScopeFor(await resolveKcActor(actor))).toEqual({ doctorId: BigInt(DOC) });
    },
  );

  it('clinic settings answer 403, owner or not', async () => {
    const res = await settingsGET(await req(`/api/v1/practices/${OWNED}/settings`), { params: { id: String(OWNED) } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Jalankan**

```bash
npx vitest run tests/integration/auth/owner-mode-scope.test.ts
```

Expected: semua PASS, karena tidak ada kode baru di task ini.

Kalau ada yang gagal, berarti ada scope yang tidak ikut `activeClinicId`. Laporkan nama fungsinya dan **jangan** menambal di sini. Perbaikannya keputusan desain dan dibicarakan dengan user.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/auth/owner-mode-scope.test.ts
git commit -m "test(auth): mode pemilik ter-scope ke kliniknya dan tidak membuka rekam medis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B5: `GET` / `PUT /api/v1/practices/{id}/owners`

**Files:**
- Create: `src/app/api/v1/practices/[id]/owners/route.ts`
- Test: `tests/integration/practice/clinic-owners-route.test.ts`

**Interfaces:**
- Consumes: `listClinicOwnerRoster`, `setClinicOwners`, `NotAClinicProfessionalError` (B2); `requireRoles` (`src/lib/auth/route-guards.ts`); `assertPracticeInScope`, `PracticeNotFoundError` (`src/services/practice/service.ts`).
- Produces (dikonsumsi FE di F6):
  - `GET` → `200 { data: RosterEntry[], clinic: { id: number, name: string } }`.
  - `PUT` body `{ doctorIds: number[] }` → `200` dengan bentuk yang sama.
  - Galat:

| Kasus | Status |
|---|---|
| Klinik di luar scope admin | 404 |
| Peran lain | 403 |
| JSON rusak | 400 |
| Bentuk body salah, atau psikolog yang bukan psikolog aktif di klinik itu | 422 dengan `fields.doctorIds` |

- [ ] **Step 1: Tulis tes (gagal)**

`tests/integration/practice/clinic-owners-route.test.ts`:

```ts
/**
 * Ticking clinic owners. SUPER_ADMIN: any clinic. CLINIC_ADMIN: their active clinic only
 * (another clinic answers 404). Everyone else, an owner psychologist included: 403.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { assertTestDb } from '../../billing/fixtures';

const { GET, PUT } = await import('@/app/api/v1/practices/[id]/owners/route');

const BASE = 8_790_000;
const END = BASE + 10_000;
const CLINIC = BASE + 1; // ADMIN_WP's
const ELSEWHERE = BASE + 2; // someone else's
const ADMIN_WP = BASE + 400;
const DOC_A = BASE + 500;
const DOC_B = BASE + 501;
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

async function req(sub: string, role: string, clinicId: number, method = 'GET', body?: unknown): Promise<NextRequest> {
  const jwt = await new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(SECRET);
  return new NextRequest(`http://localhost/api/v1/practices/${clinicId}/owners`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const ctx = (id: number) => ({ params: { id: String(id) } });

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function wipe() {
  await prisma.clinicOwner.deleteMany({ where: { clinicId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'owners-route-test-' } } });
}

async function authUser(id: string, role: string, wpUserId: number | null) {
  await prisma.user.create({
    data: { id, email: `${id}@test.local`, username: id, firstName: 'T', lastName: 'U', displayName: 'T U', role: role as never, wpUserId: wpUserId === null ? null : BigInt(wpUserId), status: 1 },
  });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const [id, name] of [[DOC_A, 'Dr A'], [DOC_B, 'Dr B']] as const) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `or${id}`, userEmail: `or${id}@test.local`, displayName: name, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Pemilik', 'a@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, ?, 0, NOW())`, CLINIC, ADMIN_WP);
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Lain', 'b@test.local', '0221234567', 'Jl. Uji 2', 'Bandung', 1, 0, 0, NOW())`, ELSEWHERE);
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 9001), doctorId: BigInt(DOC_A), clinicId: BigInt(CLINIC), createdAt: new Date() } });
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 9002), doctorId: BigInt(DOC_B), clinicId: BigInt(CLINIC), createdAt: new Date() } });
  await authUser('owners-route-test-super', 'SUPER_ADMIN', null);
  await authUser('owners-route-test-admin', 'CLINIC_ADMIN', ADMIN_WP);
  await authUser('owners-route-test-doc', 'PROFESSIONAL', DOC_A);
});

afterAll(async () => {
  await wipe();
});

describe('GET /practices/{id}/owners', () => {
  it('gives the clinic admin the roster of their clinic', async () => {
    const res = await GET(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC), ctx(CLINIC));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clinic: { id: CLINIC, name: 'Klinik Pemilik' },
      data: [
        { doctorId: DOC_A, name: 'Dr A', owner: false, source: null },
        { doctorId: DOC_B, name: 'Dr B', owner: false, source: null },
      ],
    });
  });

  it("answers 404 for another clinic's roster", async () => {
    const res = await GET(await req('owners-route-test-admin', 'CLINIC_ADMIN', ELSEWHERE), ctx(ELSEWHERE));
    expect(res.status).toBe(404);
  });

  it('answers 403 to a psychologist', async () => {
    const res = await GET(await req('owners-route-test-doc', 'PROFESSIONAL', CLINIC), ctx(CLINIC));
    expect(res.status).toBe(403);
  });
});

describe('PUT /practices/{id}/owners', () => {
  it('lets super admin tick an owner and returns the new roster', async () => {
    const res = await PUT(await req('owners-route-test-super', 'SUPER_ADMIN', CLINIC, 'PUT', { doctorIds: [DOC_B] }), ctx(CLINIC));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.find((r: { doctorId: number }) => r.doctorId === DOC_B)).toEqual({ doctorId: DOC_B, name: 'Dr B', owner: true, source: 'manual' });
    const row = await prisma.clinicOwner.findUnique({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_B) } },
    });
    expect(row?.createdBy).toBe('owners-route-test-super');
  });

  it('refuses a psychologist who does not practise at the clinic with 422 fields.doctorIds', async () => {
    const res = await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', { doctorIds: [DOC_A, ADMIN_WP] }), ctx(CLINIC));
    expect(res.status).toBe(422);
    expect((await res.json()).fields.doctorIds).toEqual([`Not an active psychologist of this clinic: ${ADMIN_WP}`]);
  });

  it('refuses a malformed body with 422 and bad JSON with 400', async () => {
    expect((await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', { doctorIds: 'x' }), ctx(CLINIC))).status).toBe(422);
    expect((await PUT(await req('owners-route-test-admin', 'CLINIC_ADMIN', CLINIC, 'PUT', '{ nope'), ctx(CLINIC))).status).toBe(400);
  });

  it('answers 403 to a psychologist, even one who owns the clinic', async () => {
    await prisma.clinicOwner.upsert({
      where: { clinicId_doctorWpUserId: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_A) } },
      create: { clinicId: BigInt(CLINIC), doctorWpUserId: BigInt(DOC_A), createdBy: 'test' },
      update: {},
    });
    const res = await PUT(await req('owners-route-test-doc', 'PROFESSIONAL', CLINIC, 'PUT', { doctorIds: [] }), ctx(CLINIC));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npx vitest run tests/integration/practice/clinic-owners-route.test.ts
```

Expected: FAIL, karena module route tidak ditemukan.

- [ ] **Step 3: Implementasi route**

`src/app/api/v1/practices/[id]/owners/route.ts`:

```ts
/**
 * GET /api/v1/practices/:id/owners — the clinic's active psychologists, with who owns it
 * PUT /api/v1/practices/:id/owners — replace the manually ticked owners
 *
 * SUPER_ADMIN for any clinic; CLINIC_ADMIN for their active clinic only (404 otherwise,
 * via assertPracticeInScope). A psychologist — owner or not — cannot change owners: that
 * is clinic configuration, which owner mode deliberately leaves out.
 * See src/services/clinic-owner/service.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRoles } from '@/lib/auth/route-guards';
import { KcError } from '@/lib/kc-response';
import { prisma } from '@/lib/db';
import { PracticeNotFoundError, assertPracticeInScope } from '@/services/practice/service';
import {
  NotAClinicProfessionalError,
  listClinicOwnerRoster,
  setClinicOwners,
} from '@/services/clinic-owner/service';

type Params = { params: { id: string } };

const bodySchema = z.object({ doctorIds: z.array(z.number().int().positive()).max(500) });

const notFound = () =>
  NextResponse.json({ type: '/errors/resource-not-found', title: 'Practice not found', status: 404 }, { status: 404 });

/** The scope gate shared by both verbs: a response to send, or null to carry on. */
async function gate(req: NextRequest, id: string): Promise<{ actorId: string; clinicId: bigint } | NextResponse> {
  const g = await requireRoles(req, ['SUPER_ADMIN', 'CLINIC_ADMIN']);
  if ('response' in g) return g.response;
  try {
    await assertPracticeInScope(g.actor, Number(id));
  } catch (err) {
    if (err instanceof PracticeNotFoundError) return notFound();
    if (err instanceof KcError) {
      return NextResponse.json(
        { type: '/errors/forbidden', title: 'Forbidden', status: err.httpStatus, detail: err.message },
        { status: err.httpStatus },
      );
    }
    throw err;
  }
  return { actorId: g.actor.id, clinicId: BigInt(id) };
}

async function payload(clinicId: bigint, roster: Awaited<ReturnType<typeof listClinicOwnerRoster>>) {
  const clinic = await prisma.kcClinic.findUnique({ where: { id: clinicId }, select: { name: true } });
  return { clinic: { id: Number(clinicId), name: clinic?.name?.trim() || `Klinik #${clinicId}` }, data: roster };
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const g = await gate(req, params.id);
  if (g instanceof NextResponse) return g;
  return NextResponse.json(await payload(g.clinicId, await listClinicOwnerRoster(g.clinicId)));
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const g = await gate(req, params.id);
  if (g instanceof NextResponse) return g;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ type: '/errors/bad-request', title: 'Invalid JSON', status: 400 }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { type: '/errors/validation-error', title: 'Validation Error', status: 422, fields: { doctorIds: ['doctorIds must be an array of positive integers'] } },
      { status: 422 },
    );
  }

  try {
    const roster = await setClinicOwners(g.clinicId, parsed.data.doctorIds, g.actorId);
    return NextResponse.json(await payload(g.clinicId, roster));
  } catch (err) {
    if (err instanceof NotAClinicProfessionalError) {
      return NextResponse.json(
        {
          type: '/errors/validation-error',
          title: 'Validation Error',
          status: 422,
          fields: { doctorIds: [`Not an active psychologist of this clinic: ${err.doctorIds.join(', ')}`] },
        },
        { status: 422 },
      );
    }
    throw err;
  }
}
```

- [ ] **Step 4: Jalankan tes, typecheck**

```bash
npx vitest run tests/integration/practice/clinic-owners-route.test.ts
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS, dan `0`.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/v1/practices/[id]/owners/route.ts' tests/integration/practice/clinic-owners-route.test.ts
git commit -m "feat(practices): endpoint pengatur pemilik klinik untuk super admin dan admin klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B6: `ownedClinics` di `/auth/me`, login, dan OTP

**Files:**
- Modify: `src/services/auth/service.ts` (tipe `LoginResult.user` sekitar baris 158-161, `scopeClinics` sekitar baris 274-287)
- Test: `tests/integration/auth/auth-me-owned-clinics.test.ts`

**Interfaces:**
- Consumes: `listOwnedClinics` dan `OwnedClinic` (B2).
- Produces: `user.ownedClinics: { id, name, source }[]` di respons login, `/auth/me`, dan OTP. Field ini **hanya** ada untuk PROFESSIONAL dan selalu berupa larik (boleh kosong). FE F1 bergantung padanya.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/integration/auth/auth-me-owned-clinics.test.ts`:

```ts
/**
 * /auth/me tells a psychologist which clinics they own, so the FE can offer owner mode.
 * Only a PROFESSIONAL carries the field; it is always an array.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { issueAccessToken } from '@/lib/auth/jwt';
import { assertTestDb } from '../../billing/fixtures';

const { GET } = await import('@/app/api/v1/auth/me/route');

const BASE = 8_755_000;
const END = BASE + 5_000;
const SOLO = BASE + 1;
const DOC = BASE + 500;
const LONE = BASE + 501; // a doctor with no clinic at all

function caps(role: string) { return `a:1:{s:${role.length}:"${role}";b:1;}`; }

async function linkAuthUser(cuid: string, wpUserId: number | null, role: string) {
  await prisma.user.create({
    data: { id: cuid, email: `${cuid}@test.local`, username: cuid, firstName: 'T', lastName: 'U', displayName: 'T U', role: role as never, wpUserId: wpUserId === null ? null : BigInt(wpUserId), status: 1 },
  });
}

async function me(cuid: string, role: string) {
  const { token } = await issueAccessToken({ userId: cuid, role: role as never, email: `${cuid}@test.local`, username: cuid });
  const res = await GET(new NextRequest('http://localhost/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: Record<string, unknown> }).user;
}

async function wipe() {
  await prisma.kcDoctorClinicMapping.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.kcUser.deleteMany({ where: { id: { gte: BigInt(BASE), lt: BigInt(END) } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'auth-me-owned-test-' } } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();
  for (const id of [DOC, LONE]) {
    await prisma.kcUser.create({ data: { id: BigInt(id), userLogin: `am${id}`, userEmail: `am${id}@test.local`, displayName: `Dr ${id}`, userRegistered: new Date() } });
    await prisma.kcUserMeta.create({ data: { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps('kiviCare_doctor') } });
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Solo', 's@test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`, SOLO);
  await prisma.kcDoctorClinicMapping.create({ data: { id: BigInt(BASE + 10), doctorId: BigInt(DOC), clinicId: BigInt(SOLO), createdAt: new Date() } });
  await linkAuthUser('auth-me-owned-test-doc', DOC, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-lone', LONE, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-unlinked', null, 'PROFESSIONAL');
  await linkAuthUser('auth-me-owned-test-super', null, 'SUPER_ADMIN');
});

afterAll(async () => {
  await wipe();
});

describe('GET /auth/me — ownedClinics', () => {
  it('lists the solo clinic of a psychologist, clinicId staying null', async () => {
    const user = await me('auth-me-owned-test-doc', 'PROFESSIONAL');
    expect(user.clinicId).toBeNull();
    expect(user.ownedClinics).toEqual([{ id: SOLO, name: 'Klinik Solo', source: 'solo' }]);
  });

  it('gives a psychologist without clinics, or without a WordPress link, an empty list', async () => {
    expect((await me('auth-me-owned-test-lone', 'PROFESSIONAL')).ownedClinics).toEqual([]);
    expect((await me('auth-me-owned-test-unlinked', 'PROFESSIONAL')).ownedClinics).toEqual([]);
  });

  it('gives other roles no ownedClinics field at all', async () => {
    expect(await me('auth-me-owned-test-super', 'SUPER_ADMIN')).not.toHaveProperty('ownedClinics');
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
npx vitest run tests/integration/auth/auth-me-owned-clinics.test.ts
```

Expected: FAIL, karena `ownedClinics` undefined.

- [ ] **Step 3: Implementasi**

Di `src/services/auth/service.ts`:

(a) Tambahkan import di dekat import `listAdminClinics`:

```ts
import { listOwnedClinics, type OwnedClinic } from '@/services/clinic-owner/service';
```

(b) Di tipe user `LoginResult` (sekitar baris 160), setelah `clinics?: AdminClinic[];`:

```ts
    /** See `scopeClinics`. Only a PROFESSIONAL carries it. */
    ownedClinics?: OwnedClinic[];
```

(c) Ganti signature dan isi `scopeClinics` dengan:

```ts
export async function scopeClinics(
  role: UserRole,
  wpUserId: bigint | null,
): Promise<{ clinicId: number | null; clinics?: AdminClinic[]; ownedClinics?: OwnedClinic[] }> {
  if (role === 'CLINIC_ADMIN') {
    const clinics = wpUserId === null ? [] : await listAdminClinics(wpUserId);
    return { clinicId: clinics[0]?.id ?? null, clinics };
  }
  if (role === 'RECEPTIONIST' && wpUserId !== null) {
    const clinicId = await resolveClinicId(role, wpUserId);
    return { clinicId: clinicId === null ? null : Number(clinicId) };
  }
  if (role === 'PROFESSIONAL') {
    return { clinicId: null, ownedClinics: wpUserId === null ? [] : await listOwnedClinics(wpUserId) };
  }
  return { clinicId: null };
}
```

(d) Tambahkan satu paragraf di akhir komentar dokumentasi `scopeClinics`, sebelum `*/`:

```ts
 *
 * `ownedClinics`: PROFESSIONAL only. Clinics they own (manually ticked, or the only active
 * psychologist there), each usable as X-Praktiqu-Clinic-Id for owner mode. Always an array.
```

- [ ] **Step 4: Jalankan tes auth yang berkaitan**

```bash
npx vitest run tests/integration/auth/
npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```

Expected: semua PASS, dan `0`.

Kalau ada tes login/OTP yang membandingkan seluruh objek `user` dengan `toEqual` dan kini gagal karena ada `ownedClinics` untuk PROFESSIONAL, tambahkan `ownedClinics: []` (atau isi yang benar) ke nilai harapan tes itu. Jangan ubah kodenya.

- [ ] **Step 5: Commit**

```bash
git add src/services/auth/service.ts tests/integration/auth/auth-me-owned-clinics.test.ts
git commit -m "feat(auth): /auth/me dan login mengirim klinik milik psikolog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Tambahkan juga ke `git add` setiap tes yang ikut disesuaikan di Step 4.

---

### Task B7: Dokumentasi, verifikasi penuh, push

**Files:**
- Modify: `docs/api/SERVICES-CRUD-GUIDE.md` (§3 Hak akses), `docs/api/PRACTICES-AND-SERVICES-GUIDE.md` (bagian header klinik aktif)

- [ ] **Step 1: Dokumentasi**

(a) Di `docs/api/SERVICES-CRUD-GUIDE.md` §3, tambahkan poin 5 di bawah daftar "Tiga hal yang perlu diketahui frontend":

```markdown
5. **Psikolog pemilik klinik** (sejak 2026-10-16): dengan header `X-Praktiqu-Clinic-Id` berisi
   klinik yang ia miliki, `PROFESSIONAL` diperlakukan sebagai `CLINIC_ADMIN` klinik itu di
   `/services` dan `/services/{id}` (tambah, ubah, hapus untuk semua psikolog di klinik itu).
   Tanpa header, aturan nomor 4 berlaku. Lihat `src/lib/auth/owner-routes.ts`.
```

(b) Di `docs/api/PRACTICES-AND-SERVICES-GUIDE.md`, tepat setelah paragraf yang menjelaskan `X-Praktiqu-Clinic-Id` untuk admin klinik (cari `X-Praktiqu-Clinic-Id`), tambahkan:

```markdown
### Mode pemilik (PROFESSIONAL)

Psikolog juga boleh mengirim `X-Praktiqu-Clinic-Id`, tetapi hanya untuk klinik yang ia **miliki**
(`ownedClinics` di `/auth/me`). Pemilik = psikolog aktif di klinik itu yang dicentang di
`PUT /practices/{id}/owners`, atau satu-satunya psikolog aktif di klinik itu. Klinik lain → `403
clinic_not_in_scope`, format salah → `400 invalid_clinic_header`.

Dalam mode ini, dan **hanya** pada route di `src/lib/auth/owner-routes.ts` (layanan, jadwal,
janji temu tanpa catatan, klien tanpa data klinis, billing baca, dashboard), ia bertindak
sebagai admin klinik itu. Semua route lain, termasuk encounter, catatan sesi, hasil klien,
riwayat medis, resep, laporan medis, pengaturan klinik, resepsionis, dan pemilik, tetap
melihatnya sebagai psikolog biasa.

| Endpoint | Peran | Isi |
|---|---|---|
| `GET /practices/{id}/owners` | SUPER_ADMIN, CLINIC_ADMIN (klinik aktifnya) | `{ clinic: {id,name}, data: [{doctorId,name,owner,source}] }`; `source` = `manual` \| `solo` \| `null` |
| `PUT /practices/{id}/owners` | sama | body `{ doctorIds: number[] }` = set pemilik manual lengkap; psikolog asing → 422 `fields.doctorIds` |
```

Lalu commit:

```bash
git add docs/api/SERVICES-CRUD-GUIDE.md docs/api/PRACTICES-AND-SERVICES-GUIDE.md
git commit -m "docs(api): mode pemilik klinik dan endpoint pemilik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short
```

Expected: `git status --short` kosong. Wajib kosong sebelum Step 2, karena Step 2 menimpa sementara isi working tree.

- [ ] **Step 2: Suite penuh, dibandingkan dengan baseline**

```bash
cd /home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/psikolog-layanan
SP=/tmp/claude-1000/pemilik-klinik-vitest; mkdir -p $SP
npx vitest run --reporter=json --outputFile=$SP/after.json >/dev/null 2>&1
git checkout -q origin/fix/scope-gaps -- . 2>/dev/null; npx prisma generate >/dev/null
npx vitest run --reporter=json --outputFile=$SP/before.json >/dev/null 2>&1
git checkout -q HEAD -- . && npx prisma generate >/dev/null
python3 -c "
import json
def f(p):
    d=json.load(open(p)); s=set()
    for t in d['testResults']:
        for a in t['assertionResults']:
            if a['status']=='failed': s.add(t['name'].split('/tests/')[-1]+' :: '+a['fullName'])
    return d['numFailedTests'], d['numPassedTests'], s
b=f('$SP/before.json'); a=f('$SP/after.json')
print('before', b[:2], 'after', a[:2]); print('new failures:', sorted(a[2]-b[2]))
"
git status --short
```

Expected:
- `new failures: []`.
- `after` punya lebih banyak PASS daripada `before`.
- `git status --short` kosong. File baru milik branch ini tidak tersentuh `checkout -- .`, dan `git checkout HEAD -- .` memulihkan semua file yang sempat ditimpa.

Di keluaran `before`, tes baru branch ini gagal karena modulnya belum ada. Itu memang tidak dihitung, karena yang dibandingkan hanya kegagalan yang **baru muncul** di `after`.

- [ ] **Step 3: Push**

```bash
git push origin feat/pemilik-klinik
```

Expected: push berhasil. Tautan PR: `https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/pemilik-klinik`. PR **jangan** dibuka sebelum `fix/scope-gaps` di-merge.

---

## Part F — FE Laravel (`raakanaka/laravel-praktiqu`)

### Task F0: Worktree FE siap dan tes dasar hijau

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Worktree dan vendor**

```bash
cd /home/ahmad/projects/praktiqu-fe
git -C main fetch -q origin
git -C main worktree list | grep pemilik-klinik || git -C main worktree add -b feat/pemilik-klinik ../pemilik-klinik origin/main
cd pemilik-klinik
git log --oneline -1
test -d vendor && ! test -L vendor || { rm -f vendor; cp -a ../main/vendor vendor; }
test -e .env || cp ../main/.env .env
mkdir -p /tmp/dockercfg && { test -f /tmp/dockercfg/config.json || echo '{}' > /tmp/dockercfg/config.json; }
git status --short
```

Expected:
- `511e708 fix: restore manual appointment professional on every modal open`, atau commit lebih baru dari `origin/main`.
- `git status --short` kosong (`/vendor` dan `.env` ada di `.gitignore`).

- [ ] **Step 2: Suite penuh, baseline**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit 2>&1 | tail -3
```

Expected: `OK (N tests, ...)`. Catat N. Kalau gagal di sini, berhenti dan laporkan.

---

### Task F1: Profil — `ownedClinics`, `modePemilik()`, `profilOperasional()`

**Files:**
- Modify: `app/Http/Controllers/AuthController.php`
- Test: `tests/Feature/ModePemilikProfilTest.php`

**Interfaces:**
- Consumes: `user.ownedClinics` dari `/auth/me` (B6).
- Produces:
  - Kunci profil `ownedClinics`: daftar `['id' => int, 'name' => string, 'source' => 'manual'|'solo']`, hanya untuk psikolog.
  - Kunci profil `ownerClinicId` (int), hanya diisi F3.
  - `AuthController::klinikPemilikSesi(): array`
  - `AuthController::modePemilik(): ?int`
  - `AuthController::profilOperasional(): ?array`
  - `AuthController::segarkanKlinikPemilik(PraktiquApi $api): void`

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/ModePemilikProfilTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

// Psikolog pemilik klinik: daftar klinik miliknya disimpan di profil saat
// login, dan mode pemilik (ownerClinicId) hanya berlaku untuk klinik yang ada
// di daftar itu. profilOperasional() adalah satu-satunya pintu controller
// operasional ke "admin klinik X" — controller klinis tetap memakai
// validProfile().
class ModePemilikProfilTest extends TestCase
{
    private function profil(array $extra = []): array
    {
        return array_merge(['v' => AuthController::PROFILE_VERSION, 'role' => 'psikolog', 'name' => 'Dr A', 'professionalId' => 34], $extra);
    }

    private function sesi(array $extra = []): void
    {
        Session::put(PraktiquApi::TOKEN_KEY, 'tok');
        Session::put(PraktiquApi::PROFILE_KEY, $this->profil($extra));
    }

    public function test_login_menyimpan_klinik_milik_psikolog(): void
    {
        Http::fake([
            '*/api/v1/auth/login' => Http::response(['accessToken' => 'tok', 'user' => ['id' => 'u1', 'role' => 'PROFESSIONAL', 'wpUserId' => 34, 'email' => 'a@x.co']]),
            '*/api/v1/auth/me' => Http::response(['user' => ['id' => 'u1', 'role' => 'PROFESSIONAL', 'wpUserId' => 34, 'email' => 'a@x.co', 'displayName' => 'Dr A',
                'ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'solo'], ['id' => 'x'], ['id' => 7, 'name' => '', 'source' => 'aneh']]]]),
        ]);

        $this->post('/professional/login', ['email' => 'a@x.co', 'password' => 'rahasia123']);

        $this->assertSame(
            [['id' => 4, 'name' => 'Klinik A', 'source' => 'solo'], ['id' => 7, 'name' => 'Klinik #7', 'source' => 'manual']],
            Session::get(PraktiquApi::PROFILE_KEY.'.ownedClinics'),
        );
    }

    public function test_mode_pemilik_hanya_untuk_klinik_di_daftar(): void
    {
        $this->sesi(['ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']], 'ownerClinicId' => 4]);
        $this->assertSame(4, AuthController::modePemilik());

        $this->sesi(['ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']], 'ownerClinicId' => 9]);
        $this->assertNull(AuthController::modePemilik());

        $this->sesi(['ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']]]);
        $this->assertNull(AuthController::modePemilik());
    }

    public function test_profil_operasional_menjadikan_pemilik_admin_klinik_itu(): void
    {
        $this->sesi(['ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']], 'ownerClinicId' => 4, 'practiceId' => 2]);

        $p = AuthController::profilOperasional();
        $this->assertSame('admin', $p['role']);
        $this->assertSame(4, $p['practiceId']);
        $this->assertNull($p['professionalId']);
        $this->assertTrue($p['pemilik']);
        $this->assertFalse((bool) ($p['canManageClinicPayment'] ?? false));
        $this->assertSame('psikolog', AuthController::validProfile()['role']);
    }

    public function test_profil_operasional_psikolog_biasa_tidak_berubah(): void
    {
        $this->sesi(['ownedClinics' => []]);
        $this->assertSame(AuthController::validProfile(), AuthController::profilOperasional());
    }

    public function test_sesi_lama_tanpa_daftar_diisi_ulang_dari_auth_me(): void
    {
        $this->sesi();
        Http::fake(['*/api/v1/auth/me' => Http::response(['user' => ['role' => 'PROFESSIONAL', 'ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'solo']]]])]);

        AuthController::segarkanKlinikPemilik(app(PraktiquApi::class));
        AuthController::segarkanKlinikPemilik(app(PraktiquApi::class));

        $this->assertSame([['id' => 4, 'name' => 'Klinik A', 'source' => 'solo']], AuthController::klinikPemilikSesi());
        Http::assertSentCount(1);
    }
}
```

Sebelum menulis tes login, cek nama route POST login psikolog di `routes/web.php`: `grep -n "login" routes/web.php`. Kalau bukan `/professional/login`, pakai yang ada. Begitu juga dengan nama field formnya (`email`/`password`). Kalau login memakai throttle atau CSRF yang membuat tes gagal, tiru pola `tests/Feature/KlinikAktifLoginTest.php`.

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter ModePemilikProfilTest
```

Expected: FAIL, karena metode belum ada.

- [ ] **Step 3: Implementasi di `AuthController.php`**

(a) Tepat setelah metode `klinikMilik()`, tambahkan:

```php
    // Klinik yang DIMILIKI psikolog (`ownedClinics` dari /auth/me) — pilihan
    // mode pemilik, lihat KlinikModeController. Backend mengirimnya hanya untuk
    // PROFESSIONAL. Baris yang bentuknya tidak sah dibuang satu per satu; sumber
    // yang tidak dikenal dibaca 'manual' supaya label "otomatis" tidak pernah
    // menempel pada sesuatu yang bukan klinik solo. null = backend tidak
    // mengirim daftar sama sekali.
    private static function klinikPemilikDari(?array $u): ?array
    {
        $raw = $u['ownedClinics'] ?? null;
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
                'source' => ($c['source'] ?? null) === 'solo' ? 'solo' : 'manual',
            ];
        }

        return $out;
    }

    /** Klinik milik psikolog di sesi ini; [] untuk role lain atau sesi tanpa daftar. */
    public static function klinikPemilikSesi(): array
    {
        $p = self::validProfile();
        if (($p['role'] ?? null) !== 'psikolog' || ! is_array($p['ownedClinics'] ?? null)) {
            return [];
        }

        return $p['ownedClinics'];
    }

    /**
     * Klinik yang sedang dikelola psikolog dalam mode pemilik, atau null.
     *
     * Hanya berlaku kalau ownerClinicId masih ada di ownedClinics sesi ini —
     * daftar itu yang diperbarui saat backend menolak, jadi id basi tidak pernah
     * dipakai lagi.
     */
    public static function modePemilik(): ?int
    {
        $p = self::validProfile();
        $id = $p['ownerClinicId'] ?? null;
        if (($p['role'] ?? null) !== 'psikolog' || ! is_int($id)) {
            return null;
        }
        foreach (self::klinikPemilikSesi() as $k) {
            if ($k['id'] === $id) {
                return $id;
            }
        }

        return null;
    }

    /**
     * Profil untuk controller OPERASIONAL (layanan, jadwal, janji temu, klien,
     * billing, laporan): psikolog dalam mode pemilik tampil sebagai admin klinik
     * yang ia kelola. Selain itu sama persis dengan validProfile().
     *
     * Controller klinis (hasil klien, dokumen encounter) TIDAK boleh memakainya —
     * di sana psikolog tetap psikolog, dan rekam medis rekannya tetap tertutup.
     * canManageClinicPayment tetap false dan `clinics` tidak ada, jadi pengaturan
     * pembayaran dan pemilih klinik admin tidak ikut terbuka.
     */
    public static function profilOperasional(): ?array
    {
        $p = self::validProfile();
        $klinik = self::modePemilik();
        if ($p === null || $klinik === null) {
            return $p;
        }

        return ['role' => 'admin', 'practiceId' => $klinik, 'professionalId' => null, 'pemilik' => true] + $p;
    }

    /**
     * Isi ownedClinics untuk sesi psikolog yang belum punya kuncinya (login
     * sebelum fitur ini, atau setelah backend menolak mode pemilik). Satu kali
     * /auth/me; gagal = dicoba lagi saat halaman berikutnya dibuka.
     */
    public static function segarkanKlinikPemilik(PraktiquApi $api): void
    {
        $p = self::validProfile();
        if (($p['role'] ?? null) !== 'psikolog' || array_key_exists('ownedClinics', $p)) {
            return;
        }
        try {
            $me = $api->get('api/v1/auth/me');
        } catch (ApiException $e) {
            logger()->info('[auth] ownedClinics tidak bisa disegarkan: '.$e->getMessage());

            return;
        }
        $u = $me['user'] ?? $me['data']['user'] ?? $me['data'] ?? $me;
        $p['ownedClinics'] = self::klinikPemilikDari(is_array($u) ? $u : null) ?? [];
        Session::put(PraktiquApi::PROFILE_KEY, $p);
    }
```

(b) Di `login`, tepat setelah blok

```php
        if ($profile['role'] === 'admin' && $klinik !== null) {
            $profile['clinics'] = $klinik;
        }
```

tambahkan:

```php
        // Klinik milik psikolog untuk pilihan mode pemilik (lihat
        // KlinikModeController). Selalu ada untuk psikolog, boleh kosong:
        // segarkanKlinikPemilik() memakai ada-tidaknya kunci ini sebagai tanda
        // "sudah pernah ditanyakan".
        if ($profile['role'] === 'psikolog') {
            $profile['ownedClinics'] = self::klinikPemilikDari(is_array($meUser) && $this->roleOf($meUser) !== null ? $meUser : $user) ?? [];
        }
```

- [ ] **Step 4: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'ModePemilikProfilTest|KlinikAktifLoginTest|KelolaPembayaranLoginTest'
```

Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/AuthController.php tests/Feature/ModePemilikProfilTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(auth): klinik milik psikolog di profil, mode pemilik, dan profil operasional

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F2: Header ke backend dan mode pemilik yang ditolak

**Files:**
- Create: `app/Services/ModePemilikBerakhirException.php`
- Modify: `app/Services/PraktiquApi.php` (`headerKlinikAktif()` sekitar baris 150; cabang `klinikDitolak` di `call()` sekitar baris 455), `bootstrap/app.php` (setelah render `KlinikTidakBerlakuException`)
- Test: `tests/Feature/ModePemilikHeaderTest.php`

**Interfaces:**
- Consumes: kunci profil `ownerClinicId` dan `ownedClinics` (F1).
- Produces:
  - `ModePemilikBerakhirException::PESAN`.
  - Respons AJAX `409 { message, modePemilikBerakhir: true }`. F4 memakainya di fetch wrapper.
  - Flash sesi `pesanMode`. F4 menampilkannya.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/ModePemilikHeaderTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\ModePemilikBerakhirException;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use Tests\TestCase;

// Psikolog dalam mode pemilik mengirim klinik yang ia kelola sebagai
// X-Praktiqu-Clinic-Id. Kalau backend menolaknya (dicabut, psikolog kedua masuk
// klinik solo), sesi TIDAK diakhiri seperti admin: hanya mode pemiliknya yang
// gugur, dan ia kembali ke "Praktik saya".
class ModePemilikHeaderTest extends TestCase
{
    private function sesi(array $extra = []): void
    {
        Session::put(PraktiquApi::TOKEN_KEY, 'tok');
        Session::put(PraktiquApi::PROFILE_KEY, array_merge([
            'v' => AuthController::PROFILE_VERSION, 'role' => 'psikolog', 'name' => 'Dr A', 'professionalId' => 34,
            'ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']],
        ], $extra));
    }

    public function test_header_dikirim_dalam_mode_pemilik(): void
    {
        $this->sesi(['ownerClinicId' => 4]);
        Http::fake(['*' => Http::response(['data' => []])]);

        app(PraktiquApi::class)->get('api/v1/services');

        Http::assertSent(fn (Request $r) => $r->header('X-Praktiqu-Clinic-Id') === ['4']);
    }

    public function test_tanpa_mode_pemilik_tidak_ada_header(): void
    {
        $this->sesi();
        Http::fake(['*' => Http::response(['data' => []])]);

        app(PraktiquApi::class)->get('api/v1/services');

        Http::assertSent(fn (Request $r) => $r->header('X-Praktiqu-Clinic-Id') === []);
    }

    public function test_penolakan_mengakhiri_mode_bukan_sesi(): void
    {
        $this->sesi(['ownerClinicId' => 4]);
        Http::fake(['*' => Http::response(['error' => 'clinic_not_in_scope'], 403)]);

        try {
            app(PraktiquApi::class)->get('api/v1/services');
            $this->fail('ModePemilikBerakhirException diharapkan');
        } catch (ModePemilikBerakhirException) {
        }

        $this->assertSame('tok', Session::get(PraktiquApi::TOKEN_KEY));
        $profil = Session::get(PraktiquApi::PROFILE_KEY);
        $this->assertArrayNotHasKey('ownerClinicId', $profil);
        $this->assertArrayNotHasKey('ownedClinics', $profil);
    }

    public function test_ajax_mendapat_409_dengan_penanda(): void
    {
        $this->sesi(['ownerClinicId' => 4]);
        Http::fake(['*' => Http::response(['error' => 'clinic_not_in_scope'], 403)]);

        $this->getJson('/dashboard/services')
            ->assertStatus(409)
            ->assertJson(['modePemilikBerakhir' => true, 'message' => ModePemilikBerakhirException::PESAN]);
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter ModePemilikHeaderTest
```

Expected: FAIL, karena class exception belum ada.

- [ ] **Step 3: Exception**

`app/Services/ModePemilikBerakhirException.php`:

```php
<?php

namespace App\Services;

// Backend menolak klinik yang sedang dikelola psikolog dalam mode pemilik
// (clinic_not_in_scope / invalid_clinic_header) — lihat PraktiquApi::call().
// Berbeda dari KlinikTidakBerlakuException milik admin: sesinya TETAP hidup,
// hanya ownerClinicId dan ownedClinics yang sudah dibuang saat ini dilempar;
// bootstrap/app.php memulangkan pengguna ke "Praktik saya".
//
// Sengaja BUKAN turunan ApiException, dengan alasan yang sama seperti
// KlinikTidakBerlakuException.
class ModePemilikBerakhirException extends \RuntimeException
{
    public const PESAN = 'Akses pemilik klinik Anda berubah. Dashboard kembali ke Praktik saya.';

    public function __construct()
    {
        parent::__construct(self::PESAN);
    }
}
```

- [ ] **Step 4: `PraktiquApi.php`**

(a) Ganti isi `headerKlinikAktif()` (dari `$p = Session::get(self::PROFILE_KEY);` sampai `return`) dengan:

```php
        $p = Session::get(self::PROFILE_KEY);
        if (! is_array($p)) {
            return [];
        }

        // Psikolog dalam mode pemilik: klinik yang ia kelola (lihat
        // KlinikModeController). ownerClinicId hanya ditulis setelah dicocokkan
        // dengan ownedClinics, dan dibuang begitu backend menolaknya.
        if (($p['role'] ?? null) === 'psikolog') {
            $id = $p['ownerClinicId'] ?? null;

            return is_int($id) && $id > 0 ? ['X-Praktiqu-Clinic-Id' => (string) $id] : [];
        }

        if (($p['role'] ?? null) !== 'admin') {
            return [];
        }
        $id = $p['practiceId'] ?? null;
        if (is_int($id)) {
            $id = (string) $id;
        }

        return is_string($id) && preg_match('/^[1-9][0-9]{0,18}$/', $id) === 1
            ? ['X-Praktiqu-Clinic-Id' => $id]
            : [];
```

Perbarui juga satu kalimat di docblock-nya: "Dikirim untuk setiap sesi role 'admin' yang punya practiceId" menjadi "Dikirim untuk sesi role 'admin' yang punya practiceId, dan untuk psikolog dalam mode pemilik (ownerClinicId)."

(b) Di `call()`, di dalam `if (in_array($res->status(), [400, 403], true) && self::klinikDitolak(...)) {` dan **sebelum** `logger()->info(...)`, sisipkan:

```php
                // Psikolog dalam mode pemilik: yang gugur hanya modenya. Daftar
                // klinik miliknya ikut dibuang supaya dimuat ulang dari /auth/me
                // (segarkanKlinikPemilik) — ia mungkin masih memiliki klinik lain.
                $profil = Session::get(self::PROFILE_KEY);
                if (is_array($profil) && ($profil['role'] ?? null) === 'psikolog' && isset($profil['ownerClinicId'])) {
                    logger()->info('[praktiqu-api] mode pemilik ditolak backend; kembali ke Praktik saya', [
                        'path' => $path, 'status' => $res->status(), 'klinik' => $profil['ownerClinicId'],
                    ]);
                    unset($profil['ownerClinicId'], $profil['ownedClinics']);
                    Session::put(self::PROFILE_KEY, $profil);
                    throw new ModePemilikBerakhirException;
                }
```

Class ini berada di namespace yang sama (`App\Services`), jadi tidak perlu `use`.

- [ ] **Step 5: `bootstrap/app.php`**

Tepat setelah blok `$exceptions->render(function (\App\Services\KlinikTidakBerlakuException $e, Request $request) { ... });`, tambahkan:

```php
        // Mode pemilik psikolog ditolak backend (lihat PraktiquApi::call). Sesi
        // tetap hidup; pesan dititipkan ke halaman berikutnya. AJAX mendapat 409
        // + modePemilikBerakhir, yang membuat dashboard memuat ulang dirinya.
        $exceptions->dontReport(\App\Services\ModePemilikBerakhirException::class);
        $exceptions->render(function (\App\Services\ModePemilikBerakhirException $e, Request $request) {
            $request->session()->flash('pesanMode', $e->getMessage());
            if ($request->expectsJson()) {
                return response()->json(['message' => $e->getMessage(), 'modePemilikBerakhir' => true], 409);
            }

            return redirect('/psikolog');
        });
```

- [ ] **Step 6: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'ModePemilikHeaderTest|HeaderKlinikAktifTest|KlinikDicabutTest'
```

Expected: semua PASS.

Kalau `test_ajax_mendapat_409_dengan_penanda` gagal karena `/dashboard/services` menangkap exception lebih dulu (`catch (\Throwable)` di `sapuLayanan`), tambahkan baris berikut di awal blok catch `\Throwable` itu:

```php
if ($e instanceof \App\Services\ModePemilikBerakhirException) { throw $e; }
```

Lakukan hal yang sama di setiap `catch (\Throwable ...)` milik controller operasional yang memanggil backend. Untuk menemukannya: `grep -n "catch (\\\\Throwable" app/Http/Controllers/*.php`.

- [ ] **Step 7: Commit**

```bash
git add app/Services/ModePemilikBerakhirException.php app/Services/PraktiquApi.php bootstrap/app.php tests/Feature/ModePemilikHeaderTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(api): header klinik untuk mode pemilik; penolakan hanya mengakhiri modenya

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Tambahkan controller yang disentuh Step 6 ke `git add` bila ada.

---

### Task F3: `POST /dashboard/mode-klinik`

**Files:**
- Create: `app/Http/Controllers/KlinikModeController.php`
- Modify: `routes/web.php` (setelah route `klinik.aktif`)
- Test: `tests/Feature/ModePemilikGantiTest.php`

**Interfaces:**
- Consumes: `AuthController::klinikPemilikSesi()` (F1).
- Produces: route bernama `klinik.mode`. Isian form `clinicId`: kosong berarti "Praktik saya", atau id klinik milik. Hasilnya redirect `/psikolog` atau JSON `{ ok, ownerClinicId }`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/ModePemilikGantiTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Tests\TestCase;

class ModePemilikGantiTest extends TestCase
{
    private function sesi(string $role = 'psikolog', array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge([
                'v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Dr A', 'professionalId' => 34,
                'ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']],
            ], $extra),
        ];
    }

    public function test_masuk_mode_pemilik_untuk_klinik_milik(): void
    {
        $this->withSession($this->sesi())->post('/dashboard/mode-klinik', ['clinicId' => '4'])
            ->assertRedirect('/psikolog')
            ->assertSessionHas(PraktiquApi::PROFILE_KEY.'.ownerClinicId', 4);
    }

    public function test_kembali_ke_praktik_saya(): void
    {
        $this->withSession($this->sesi(extra: ['ownerClinicId' => 4]))->post('/dashboard/mode-klinik', ['clinicId' => ''])
            ->assertRedirect('/psikolog')
            ->assertSessionMissing(PraktiquApi::PROFILE_KEY.'.ownerClinicId');
    }

    public function test_klinik_yang_bukan_miliknya_ditolak(): void
    {
        $this->withSession($this->sesi())->post('/dashboard/mode-klinik', ['clinicId' => '9'])
            ->assertStatus(422);
        $this->withSession($this->sesi())->post('/dashboard/mode-klinik', ['clinicId' => 'abc'])
            ->assertStatus(422);
    }

    public function test_hanya_untuk_psikolog(): void
    {
        $res = $this->withSession($this->sesi('admin', ['practiceId' => 4]))->post('/dashboard/mode-klinik', ['clinicId' => '4']);
        $this->assertContains($res->status(), [302, 403]);
        $res->assertSessionMissing(PraktiquApi::PROFILE_KEY.'.ownerClinicId');
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter ModePemilikGantiTest
```

Expected: FAIL, karena route 404.

- [ ] **Step 3: Controller dan route**

`app/Http/Controllers/KlinikModeController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\PraktiquApi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Session;

/**
 * Mode dashboard psikolog: "Praktik saya" atau "Kelola: Klinik X".
 *
 * Mode pemilik hanya boleh untuk klinik di ownedClinics sesi (dari /auth/me).
 * Backend tetap memvalidasi klinik itu di setiap request — ini pilihan
 * tampilan, bukan batas keamanan. Pindah mode memuat ulang halaman penuh,
 * sama seperti pindah klinik aktif admin (KlinikAktifController).
 */
class KlinikModeController extends Controller
{
    public function ganti(Request $request): RedirectResponse|JsonResponse
    {
        $profil = AuthController::validProfile() ?? [];
        $raw = $request->input('clinicId');

        if ($raw === null || $raw === '') {
            unset($profil['ownerClinicId']);
        } else {
            $id = filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $milik = $id !== false && collect(AuthController::klinikPemilikSesi())->contains(fn ($k) => $k['id'] === $id);
            abort_unless($milik, 422, 'Klinik itu bukan klinik milik Anda.');
            $profil['ownerClinicId'] = $id;
        }
        Session::put(PraktiquApi::PROFILE_KEY, $profil);

        return $request->expectsJson()
            ? response()->json(['ok' => true, 'ownerClinicId' => $profil['ownerClinicId'] ?? null])
            : redirect('/psikolog');
    }
}
```

Di `routes/web.php`, tepat setelah definisi route `->name('klinik.aktif');`, tambahkan:

```php
// Psikolog pemilik klinik memilih mode dashboard: "Praktik saya" atau
// "Kelola: Klinik X". Di luar grup klinik.halaman untuk alasan yang sama
// dengan klinik-aktif: pindah mode justru mengubah klinik halaman.
Route::post('/dashboard/mode-klinik', [\App\Http\Controllers\KlinikModeController::class, 'ganti'])
    ->middleware('staff:psikolog')->name('klinik.mode');
```

- [ ] **Step 4: Jalankan tes**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'ModePemilikGantiTest|GantiKlinikAktifTest'
```

Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/KlinikModeController.php routes/web.php tests/Feature/ModePemilikGantiTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): psikolog pemilik memilih mode Praktik saya atau Kelola klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F4: Controller operasional memakai `profilOperasional()`

**Files:**
- Modify:
  - `app/Http/Controllers/DashboardController.php`: baris 448 `scopedQuery`, 1340 `rosterKlinik`, 1413 `services`, dan awal `index()`.
  - `app/Http/Controllers/ServiceController.php:54`
  - `app/Http/Controllers/DoctorSessionController.php:23,62,157,204`
  - `app/Http/Controllers/CustomSessionController.php:21,41,124`
  - `app/Http/Controllers/ManualAppointmentController.php:36,156,176,248,312`
  - `app/Http/Controllers/ResourceController.php:155,267,692`
  - `app/Http/Controllers/ReportController.php:52`
  - `app/Http/Middleware/CocokKlinikHalaman.php`
- Test: `tests/Feature/ModePemilikControllerTest.php`

**Interfaces:**
- Consumes: `AuthController::profilOperasional()`, `segarkanKlinikPemilik()`, `modePemilik()` (F1).
- **Tidak boleh disentuh** (K4): `PatientResultUploadController`, `EncounterDocumentController`, `SessionLogController`, `KlinikPembayaranController`, `KlinikAdminController`, `KlinikAktifController`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/ModePemilikControllerTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Psikolog dalam mode pemilik = admin klinik yang ia kelola di controller
// OPERASIONAL — klinik dikunci ke ownerClinicId, bukan ke isian form. Di luar
// mode itu, perilakunya tidak berubah.
class ModePemilikControllerTest extends TestCase
{
    private function pemilik(array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge([
                'v' => AuthController::PROFILE_VERSION, 'role' => 'psikolog', 'name' => 'Dr A', 'professionalId' => 34,
                'ownedClinics' => [['id' => 4, 'name' => 'Klinik A', 'source' => 'manual']], 'ownerClinicId' => 4,
            ], $extra),
        ];
    }

    private function biasa(): array
    {
        $s = $this->pemilik();
        unset($s[PraktiquApi::PROFILE_KEY]['ownerClinicId']);

        return $s;
    }

    private function badan(Request $r): array
    {
        return json_decode($r->body(), true) ?: [];
    }

    private function layanan(): array
    {
        return ['name' => 'Konseling', 'categoryId' => 29, 'duration' => 60, 'price' => 300000,
            'mode' => 'offline', 'active' => true, 'doctors' => [51], 'clinicId' => '99'];
    }

    public function test_pemilik_menambah_layanan_untuk_kliniknya_sendiri(): void
    {
        Http::fake(['*/api/v1/services' => Http::response(['data' => ['id' => 1]])]);

        $this->withSession($this->pemilik())->postJson('/dashboard/layanan', $this->layanan())->assertOk();

        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && ($this->badan($r)['clinicId'] ?? null) === 4);
    }

    public function test_pemilik_menghapus_layanan(): void
    {
        Http::fake(['*/api/v1/services/9' => Http::response(['data' => []])]);

        $this->withSession($this->pemilik())->deleteJson('/dashboard/layanan/9')->assertOk();
    }

    public function test_psikolog_biasa_tetap_tidak_boleh_menambah_layanan(): void
    {
        Http::fake();

        $this->withSession($this->biasa())->postJson('/dashboard/layanan', $this->layanan())->assertStatus(403);
        Http::assertNothingSent();
    }

    public function test_daftar_layanan_pemilik_memakai_jalur_klinik(): void
    {
        Http::fake([
            '*/api/v1/services*' => Http::response(['data' => [['id' => 7, 'doctorId' => 51, 'clinicId' => 4, 'name' => 'Konseling']], 'total' => 1]),
            '*' => Http::response(['data' => []]),
        ]);

        $this->withSession($this->pemilik())->getJson('/dashboard/services')->assertOk()->assertJsonPath('dapatDiubah', true);

        Http::assertSent(function (Request $r) {
            if (! str_contains($r->url(), '/api/v1/services?')) {
                return false;
            }
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);

            return ($q['clinicId'] ?? null) === '4';
        });
    }

    public function test_laporan_terbuka_untuk_pemilik_dan_dikunci_ke_kliniknya(): void
    {
        Http::fake(['*' => Http::response(['data' => [], 'pagination' => ['totalItems' => 0]])]);

        $this->withSession($this->pemilik())->getJson('/dashboard/laporan?from=2026-10-01&to=2026-10-31')->assertOk();
        $this->withSession($this->biasa())->getJson('/dashboard/laporan?from=2026-10-01&to=2026-10-31')->assertStatus(403);

        Http::assertSent(function (Request $r) {
            if (! str_contains($r->url(), '/api/v1/sessions')) {
                return false;
            }
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);

            return ($q['practiceId'] ?? null) === '4';
        });
    }

    public function test_roster_klinik_pemilik_terkunci_ke_kliniknya(): void
    {
        Http::fake(['*/api/v1/public/professionals*' => Http::response(['items' => [['id' => 51, 'fullName' => 'Dr B']]])]);

        $this->withSession($this->pemilik())->getJson('/dashboard/psikolog-klinik?clinicId=99')->assertOk();

        Http::assertSent(function (Request $r) {
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $q);

            return ($q['clinicId'] ?? null) === '4';
        });
    }
}
```

Sebelum menjalankan, cek path route dengan `grep -n "laporan\|psikolog-klinik\|dashboard/layanan" routes/web.php`. Sesuaikan URL di tes kalau berbeda, dan sesuaikan isian validasi `ReportController` (`from`/`to`) dengan `$request->validate` di controller itu.

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter ModePemilikControllerTest
```

Expected: FAIL. Tes pemilik akan menerima 403 atau clinicId yang salah.

- [ ] **Step 3: Ganti pemanggilan di controller operasional**

Jalankan dari worktree FE. Perintah ini hanya mengganti `AuthController::validProfile()` di file-file yang tercantum:

```bash
cd /home/ahmad/projects/praktiqu-fe/pemilik-klinik
for f in ServiceController DoctorSessionController CustomSessionController ManualAppointmentController ResourceController ReportController; do
  sed -i 's/AuthController::validProfile()/AuthController::profilOperasional()/g' app/Http/Controllers/$f.php
done
sed -i '448s/AuthController::validProfile()/AuthController::profilOperasional()/; 1340s/AuthController::validProfile()/AuthController::profilOperasional()/; 1413s/AuthController::validProfile()/AuthController::profilOperasional()/' app/Http/Controllers/DashboardController.php
cat app/Http/Controllers/{Service,DoctorSession,CustomSession,ManualAppointment,Resource,Report,Dashboard}Controller.php | grep -c "AuthController::profilOperasional()"
grep -n "validProfile()" app/Http/Controllers/DashboardController.php
```

Expected:
- Angka `20`. Rinciannya: Service 1, DoctorSession 4, CustomSession 3, ManualAppointment 5, Resource 3, Report 1, Dashboard 3.
- `DashboardController` hanya tersisa satu `validProfile()`, di sekitar baris 1893 (logging peran). Itu dibiarkan.
- Kalau nomor baris `DashboardController` bergeser, cari ketiga baris itu lewat nama fungsinya (`scopedQuery`, `rosterKlinik`, `services`).

- [ ] **Step 4: Penyegaran daftar dan pengalihan mode yang gugur di `index()`**

Di `DashboardController::index(string $role)`, tepat setelah `{` pembuka metode, sebelum `$q = $this->scopedQuery();`, tambahkan:

```php
        // Sesi psikolog yang belum tahu klinik miliknya (login sebelum fitur ini,
        // atau mode pemilik baru saja ditolak backend) diisi dulu, supaya pilihan
        // mode di sidebar tidak hilang sampai login berikutnya.
        if ($role === 'psikolog') {
            AuthController::segarkanKlinikPemilik($this->api);
        }
        $modeSebelum = AuthController::modePemilik();
```

Lalu, tepat setelah blok

```php
        if (! Session::has(PraktiquApi::TOKEN_KEY)) {
            return redirect(AuthController::loginPath($role));
        }
```

tambahkan:

```php
        // Mode pemilik gugur di tengah pemuatan (backend menolak kliniknya dan
        // PraktiquApi sudah membuangnya dari profil): data yang termuat campuran,
        // jadi muat ulang sekali sebagai "Praktik saya" dengan penjelasan.
        if ($modeSebelum !== null && AuthController::modePemilik() === null) {
            return redirect('/psikolog')->with('pesanMode', \App\Services\ModePemilikBerakhirException::PESAN);
        }
```

- [ ] **Step 5: `CocokKlinikHalaman` ikut mode pemilik**

Di `app/Http/Middleware/CocokKlinikHalaman.php`, ganti

```php
        $profil = Session::get(PraktiquApi::PROFILE_KEY);
        if (! is_array($profil) || ($profil['role'] ?? null) !== 'admin') {
            return $next($request);
        }
```

dengan

```php
        // profilOperasional(): psikolog dalam mode pemilik ikut dijaga — pindah
        // mode di tab lain juga mengubah klinik tujuan setiap aksi.
        $profil = \App\Http\Controllers\AuthController::profilOperasional();
        if (! is_array($profil) || ($profil['role'] ?? null) !== 'admin') {
            return $next($request);
        }
```

Kalau import `Session` atau `PraktiquApi` tidak lagi dipakai di file itu, hapus `use`-nya. Perbarui juga satu kalimat komentar kelas, "Tanpa header ... atau role selain 'admin': lolos.", menjadi "Tanpa header, atau selain admin dan psikolog dalam mode pemilik: lolos."

- [ ] **Step 6: Jalankan tes yang berkaitan**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'ModePemilik|ServiceCrudTest|DashboardServicesTest|DoctorSessionTest|CustomSessionTest|ManualAppointmentTest|LaporanTest|CocokKlinikHalamanTest|StaffAccessTest|ClientCreateRbacTest|DashboardRowScopeTest|PinKlienStafTest|HasilPasien'
```

Expected: semua PASS. Tes `PinKlienStafTest` dan `HasilPasien*` membuktikan Hasil Klien tidak ikut berubah (K4).

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/DashboardController.php app/Http/Controllers/ServiceController.php app/Http/Controllers/DoctorSessionController.php app/Http/Controllers/CustomSessionController.php app/Http/Controllers/ManualAppointmentController.php app/Http/Controllers/ResourceController.php app/Http/Controllers/ReportController.php app/Http/Middleware/CocokKlinikHalaman.php tests/Feature/ModePemilikControllerTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): controller operasional memperlakukan psikolog pemilik sebagai admin kliniknya

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F5: Tampilan — dropdown mode, menu, dan tombol

**Files:**
- Create: `resources/views/dashboard/partials/pilih-mode.blade.php`
- Modify: `app/Http/Controllers/DashboardController.php` (`render()`), `resources/views/dashboard.blade.php`
- Test: `tests/Feature/ModePemilikDashboardTest.php`

**Interfaces:**
- Consumes: `AuthController::modePemilik()`, `klinikPemilikSesi()`, route `klinik.mode`, flash `pesanMode`.
- Produces (variabel view dan payload JS):
  - `$klinikPemilik`, `$modePemilikAktif` (`?int`), `$roleUi` (`'admin'` saat mode pemilik).
  - Di payload: `modePemilik`, `pesanMode`, dan `profile.practiceId` (= klinik dikelola).

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/ModePemilikDashboardTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ModePemilikDashboardTest extends TestCase
{
    private function sesi(array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge([
                'v' => AuthController::PROFILE_VERSION, 'role' => 'psikolog', 'name' => 'Dr A', 'professionalId' => 34,
                'ownedClinics' => [['id' => 4, 'name' => 'Klinik Pamela', 'source' => 'solo']],
            ], $extra),
        ];
    }

    private function payload(\Illuminate\Testing\TestResponse $res): array
    {
        return $res->viewData('payload');
    }

    public function test_pemilik_melihat_pilihan_mode(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi())->get('/psikolog')->assertOk();

        $res->assertSee('Praktik saya');
        $res->assertSee('Kelola: Klinik Pamela (otomatis — klinik solo)');
        $res->assertSee(route('klinik.mode', [], false), false);
    }

    public function test_psikolog_tanpa_klinik_milik_tidak_melihat_pilihan(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->withSession($this->sesi(['ownedClinics' => []]))->get('/psikolog')->assertOk()
            ->assertViewHas('klinikPemilik', [])->assertDontSee('Praktik saya');
    }

    public function test_mode_pemilik_membuka_menu_billing_dan_laporan(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        // Menu dipilih dari $ALLOWED_NAV[$roleUi]; markup tiap view tetap ada
        // di halaman untuk semua peran, jadi yang diuji peran tampilannya.
        $this->withSession($this->sesi())->get('/psikolog')->assertViewHas('roleUi', 'psikolog');

        $pemilik = $this->withSession($this->sesi(['ownerClinicId' => 4]))->get('/psikolog');
        $pemilik->assertViewHas('roleUi', 'admin')->assertViewHas('modePemilikAktif', 4);
        $p = $this->payload($pemilik);
        $this->assertTrue($p['modePemilik']);
        $this->assertSame(4, $p['profile']['practiceId']);
        $this->assertSame('psikolog', $p['role']);
    }

    public function test_pesan_mode_gugur_ditampilkan(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $res = $this->withSession($this->sesi())->withSession(['pesanMode' => 'Akses pemilik klinik Anda berubah.'])->get('/psikolog');
        $this->assertSame('Akses pemilik klinik Anda berubah.', $this->payload($res)['pesanMode']);
    }

    public function test_peran_ui_dipakai_untuk_tombol_operasional(): void
    {
        $view = file_get_contents(resource_path('views/dashboard.blade.php'));
        $this->assertStringContainsString('get peranUi()', $view);
        $this->assertStringContainsString("x-show=\"peranUi !== 'psikolog'\" @click=\"openModal('patient')\"", $view);
        $this->assertStringContainsString("SERVICE_CREATE_ENABLED && peranUi !== 'psikolog'", $view);
        // Kartu Google Calendar tetap milik peran ASLI.
        $this->assertStringContainsString("@if ((\$role ?? null) === 'psikolog')", $view);
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter ModePemilikDashboardTest
```

Expected: FAIL.

- [ ] **Step 3: Ganti cek peran di JS. Kerjakan PERTAMA, sebelum menyisipkan baris apa pun di file ini**

Nomor baris di bawah berlaku untuk `resources/views/dashboard.blade.php` di commit 511e708. Cek dulu daftarnya:

```bash
cd /home/ahmad/projects/praktiqu-fe/pemilik-klinik
grep -nE "role (!==|===) ['\"]psikolog['\"]" resources/views/dashboard.blade.php | cut -d: -f1 | tr '\n' ' '
```

Expected: `344 554 555 669 811 812 855 856 875 2248 2258 2930 2971 2986 3446 3527 3584 3768 3846 5302 5303`. Kalau berbeda, petakan ulang dengan membaca isi setiap baris; aturannya ada di bawah.

**Aturan:**
- **Tetap** memakai peran asli: `344` (portal login) dan `2248` (nama modal profil diri).
- Sisanya adalah tampilan operasional dan diganti ke `peranUi`.
- Di baris-baris JS itu, `this.role === "admin"` ikut diganti, supaya pemilik memakai `practiceId` klinik yang ia kelola.

```bash
F=resources/views/dashboard.blade.php
for n in 554 555 669 811 812 855 856 875 2258; do sed -i "${n}s/this\.role/this.peranUi/g" $F; done
for n in 2930 2971 2986 3446 3527 3584 3768 3846 5302 5303; do sed -i -E "${n}s/\brole (!==|===) '(psikolog|doctor)'/peranUi \1 '\2'/g" $F; done
grep -nE "role (!==|===) ['\"]psikolog['\"]" $F | cut -d: -f1 | tr '\n' ' '
```

Expected: tersisa `344 2248`.

- [ ] **Step 4: Getter dan data JS**

(a) Di objek `dashApp`, ganti potongan `role: payload.role, profile: payload.profile, dataError: payload.dataError,` (sekitar baris 345) menjadi

```js
    role: payload.role, profile: payload.profile, dataError: payload.dataError,
    // Mode pemilik klinik (lihat KlinikModeController): role tetap "psikolog",
    // tapi tampilan operasional — menu, tombol, form — mengikuti admin klinik
    // yang ia kelola. Rekam medis tetap disaring backend ke miliknya sendiri.
    modePemilik: !!payload.modePemilik, pesanMode: payload.pesanMode || "",
```

(b) Tepat sebelum baris `get allowed() { ... }` (sekitar baris 1056), tambahkan

```js
    get peranUi() { return this.modePemilik ? "admin" : this.role; },
```

lalu ganti isi `get allowed()` menjadi `return ROLE_ALLOWED[this.peranUi] || ROLE_ALLOWED.admin;`.

(c) Di fetch wrapper paling atas (blok `if (milikKita(alamat) && res.status === 409 && alamat.includes("/dashboard")) { ... }`), ganti baris

```js
        if (j && j.klinikBerganti) window.dispatchEvent(new CustomEvent("pq-klinik-berganti"));
```

dengan

```js
        if (j && j.klinikBerganti) window.dispatchEvent(new CustomEvent("pq-klinik-berganti"));
        // Mode pemilik ditolak backend: server sudah kembali ke "Praktik saya"
        // dan menitipkan pesannya; data di layar ini milik klinik lama.
        if (j && j.modePemilikBerakhir) location.reload();
```

Perbarui juga satu kalimat komentar `klinikHalaman`, "(admin klinik saja; null untuk role lain)", menjadi "(admin klinik, dan psikolog dalam mode pemilik; null untuk selainnya)".

(d) Tepat setelah elemen banner `sesiHabis` (`<div x-show="sesiHabis" ...>...</div>`), tambahkan:

```blade
  {{-- Mode pemilik gugur (ModePemilikBerakhirException): penjelasan sekali tampil. --}}
  <div x-show="pesanMode" x-cloak role="status"
       style="margin:12px 20px 0;padding:11px 14px;border-radius:12px;background:#FFF6E5;border:1px solid #F3E2BE;color:#7A5A00;font-size:13px;display:flex;gap:10px;align-items:center">
    <span style="flex:1" x-text="pesanMode"></span>
    <button type="button" class="btn-white" style="padding:5px 10px;font-size:12px" @click="pesanMode = ''">Tutup</button>
  </div>
```

- [ ] **Step 5: Menu PHP dan dropdown**

(a) Ganti `][$role] ?? [];` di `$ALLOWED_NAV` (sekitar baris 2537) menjadi `][$roleUi ?? $role] ?? [];`. Lakukan hal yang sama untuk `][$role] ?? ['appointments', 'patients', 'revenue'];` (sekitar baris 2648).

(b) Buat `resources/views/dashboard/partials/pilih-mode.blade.php`:

```blade
{{-- Dropdown mode psikolog pemilik klinik — lihat KlinikModeController. Form
     biasa, bukan fetch: pindah mode memuat ulang halaman penuh, karena seluruh
     data di halaman ini milik mode lama. Variabel: $klinikPemilik,
     $modePemilikAktif, $inisialKlinik (dari DashboardController::render),
     $idPilih dan $mini (dari @include). --}}
<form method="POST" action="{{ route('klinik.mode', [], false) }}" class="pq-clinic pq-clinic-pilih{{ $mini ? ' mini' : '' }}">
  @csrf
  <span class="pq-clinic-ini" aria-hidden="true">{{ $modePemilikAktif !== null ? $inisialKlinik : 'PS' }}</span>
  <label for="{{ $idPilih }}" class="sr-only">Mode dashboard</label>
  <select id="{{ $idPilih }}" name="clinicId" onchange="this.form.submit()">
    <option value="" @selected($modePemilikAktif === null)>Praktik saya</option>
    @foreach ($klinikPemilik as $k)
      <option value="{{ $k['id'] }}" @selected($modePemilikAktif === $k['id'])>Kelola: {{ $k['name'] }}{{ $k['source'] === 'solo' ? ' (otomatis — klinik solo)' : '' }}</option>
    @endforeach
  </select>
  <noscript><button type="submit">Ganti</button></noscript>
</form>
```

(c) Di kedua tempat `@if (count($klinikSaya) > 1)` (topbar sekitar baris 2479, sidebar sekitar baris 2507), tambahkan cabang `@elseif` sebelum `@else`:

Topbar:

```blade
    @elseif (count($klinikPemilik ?? []) > 0)
      @include('dashboard.partials.pilih-mode', ['idPilih' => 'mode-klinik-atas', 'mini' => true])
```

Sidebar:

```blade
    @elseif (count($klinikPemilik ?? []) > 0)
      <div class="pq-clinic-wrap" style="padding:0 20px 14px">
        @include('dashboard.partials.pilih-mode', ['idPilih' => 'mode-klinik-samping', 'mini' => false])
      </div>
```

- [ ] **Step 6: `render()`**

Di `DashboardController::render()`:

(a) Tepat setelah perulangan `foreach ($klinikSaya as $k) { ... }`, tambahkan:

```php
        // Mode pemilik psikolog (KlinikModeController): pilihan mode di sidebar
        // dan "peran tampilan" admin untuk klinik yang sedang dikelola.
        $klinikPemilik = $role === 'psikolog' ? AuthController::klinikPemilikSesi() : [];
        $modePemilik = AuthController::modePemilik();
        if ($modePemilik !== null) {
            foreach ($klinikPemilik as $k) {
                if ($k['id'] === $modePemilik) {
                    $klinikAktifNama = $k['name'];
                }
            }
        }
```

(b) Di array `view('dashboard', [...])`, setelah `'klinikSaya' => $klinikSaya,`, tambahkan:

```php
            'klinikPemilik' => $klinikPemilik,
            'modePemilikAktif' => $modePemilik,
            'roleUi' => $modePemilik !== null ? 'admin' : $role,
```

(c) Di `'profile' => [...]`, ganti `'practiceId' => $role === 'admin' ? ($profile['practiceId'] ?? null) : null,` dengan:

```php
                    'practiceId' => $role === 'admin' ? ($profile['practiceId'] ?? null) : $modePemilik,
```

(d) Ganti `'clinic' => self::klinikAktif($role, $profile),` dengan:

```php
                'clinic' => $modePemilik !== null
                    ? ['name' => $klinikAktifNama, 'initial' => self::initialsOf($klinikAktifNama)]
                    : self::klinikAktif($role, $profile),
                'modePemilik' => $modePemilik !== null,
                'pesanMode' => session('pesanMode'),
```

- [ ] **Step 7: Jalankan tes, lalu suite penuh**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'ModePemilik|DeadFeatureAuditTest|SidebarBillingUiTest|DropdownKlinikAktifTest|StaffAccessTest'
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit 2>&1 | tail -3
```

Expected: semua PASS. Jumlah tes = N dari F0 ditambah tes baru.

Kalau ada tes lama (misalnya `DeadFeatureAuditTest`) yang mencari string `role !== 'psikolog'` persis, perbarui harapannya ke `peranUi !== 'psikolog'`. Isinya tetap sama.

- [ ] **Step 8: Commit**

```bash
git add resources/views/dashboard/partials/pilih-mode.blade.php resources/views/dashboard.blade.php app/Http/Controllers/DashboardController.php tests/Feature/ModePemilikDashboardTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(dashboard): dropdown mode pemilik, menu dan tombol operasional untuk pemilik klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Tambahkan tes lama yang ikut diperbarui di Step 7 ke `git add`.

---

### Task F6: Halaman "Pemilik klinik"

**Files:**
- Create: `app/Http/Controllers/KlinikPemilikController.php`, `resources/views/dashboard/klinik-pemilik.blade.php`
- Modify:
  - `routes/web.php`: setelah route `klinik.admin.simpan`.
  - `resources/views/dashboard.blade.php`: kartu di Settings, setelah kartu Pembayaran Internasional.
  - `app/Http/Controllers/DashboardController.php` (`render()`): `pemilikKlinikUrl`.
  - `resources/views/dashboard/klinik-admin.blade.php`: tautan untuk super admin.
- Test: `tests/Feature/KlinikPemilikTest.php`

**Interfaces:**
- Consumes: `GET`/`PUT api/v1/practices/{id}/owners` (B5).
- Produces: route `klinik.pemilik` (GET) dan `klinik.pemilik.simpan` (POST), path `/dashboard/klinik/{id}/pemilik`.

- [ ] **Step 1: Tulis tes (gagal)**

`tests/Feature/KlinikPemilikTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

// Mencentang psikolog pemilik klinik. Super admin: klinik mana pun. Admin
// klinik (CLINIC_ADMIN asli, bukan resepsionis): klinik aktifnya saja. Selain
// itu 404 sebelum satu request pun ke backend.
class KlinikPemilikTest extends TestCase
{
    private const URL = '/dashboard/klinik/4/pemilik';

    private const ROSTER = ['clinic' => ['id' => 4, 'name' => 'Klinik Sehat'], 'data' => [
        ['doctorId' => 34, 'name' => 'Dr A', 'owner' => true, 'source' => 'manual'],
        ['doctorId' => 51, 'name' => 'Dr B', 'owner' => false, 'source' => null],
    ]];

    private function sesi(string $role, array $extra = []): array
    {
        return [
            PraktiquApi::TOKEN_KEY => 'tok',
            PraktiquApi::PROFILE_KEY => array_merge(['v' => AuthController::PROFILE_VERSION, 'role' => $role, 'name' => 'Staf'], $extra),
        ];
    }

    public function test_admin_klinik_melihat_daftar_psikolog_dan_pemilik(): void
    {
        Http::fake(['*/api/v1/practices/4/owners' => Http::response(self::ROSTER)]);

        $res = $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))->get(self::URL);

        $res->assertOk()->assertSee('Klinik Sehat')->assertSee('Dr A')->assertSee('Dr B');
        $res->assertSee('name="doctorIds[]" value="34" checked', false);
    }

    public function test_klinik_solo_terkunci_dengan_keterangan(): void
    {
        Http::fake(['*/api/v1/practices/4/owners' => Http::response(['clinic' => ['id' => 4, 'name' => 'Klinik Solo'], 'data' => [
            ['doctorId' => 34, 'name' => 'Dr A', 'owner' => true, 'source' => 'solo'],
        ]])]);

        $this->withSession($this->sesi('super'))->get(self::URL)
            ->assertOk()->assertSee('otomatis — klinik solo')->assertSee('disabled', false);
    }

    public function test_simpan_mengirim_set_pemilik_lengkap(): void
    {
        Http::fake(['*/api/v1/practices/4/owners' => Http::response(self::ROSTER)]);

        $this->withSession($this->sesi('super'))->post(self::URL, ['doctorIds' => ['51']])
            ->assertRedirect(self::URL)->assertSessionHas('pemilikPesan');

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && json_decode($r->body(), true) === ['doctorIds' => [51]]);
    }

    public function test_simpan_tanpa_centang_mengosongkan_pemilik(): void
    {
        Http::fake(['*/api/v1/practices/4/owners' => Http::response(self::ROSTER)]);

        $this->withSession($this->sesi('super'))->post(self::URL, [])->assertRedirect(self::URL);

        Http::assertSent(fn (Request $r) => $r->method() === 'PUT' && json_decode($r->body(), true) === ['doctorIds' => []]);
    }

    public function test_penolakan_422_ditampilkan(): void
    {
        Http::fake(['*/api/v1/practices/4/owners' => Http::response(['status' => 422, 'fields' => ['doctorIds' => ['Not an active psychologist of this clinic: 99']]], 422)]);

        $this->withSession($this->sesi('super'))->post(self::URL, ['doctorIds' => ['99']])
            ->assertRedirect(self::URL)->assertSessionHas('pemilikGagal');
    }

    public function test_selain_yang_berhak_404_tanpa_request(): void
    {
        Http::fake();

        $this->withSession($this->sesi('admin', ['practiceId' => 7, 'canManageClinicPayment' => true]))->get(self::URL)->assertNotFound();
        $this->withSession($this->sesi('admin', ['practiceId' => 4]))->get(self::URL)->assertNotFound(); // resepsionis
        $this->withSession($this->sesi('psikolog', ['professionalId' => 34, 'ownedClinics' => [['id' => 4, 'name' => 'K', 'source' => 'manual']], 'ownerClinicId' => 4]))->get(self::URL)->assertNotFound();

        Http::assertNothingSent();
    }

    public function test_kartu_pengaturan_hanya_untuk_admin_klinik(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->withSession($this->sesi('admin', ['practiceId' => 4, 'canManageClinicPayment' => true]))->get('/klinik')
            ->assertSee(self::URL, false);
        $this->withSession($this->sesi('admin', ['practiceId' => 4]))->get('/klinik')
            ->assertDontSee(self::URL, false);
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter KlinikPemilikTest
```

Expected: FAIL, karena route 404 untuk semua kasus.

- [ ] **Step 3: Controller**

`app/Http/Controllers/KlinikPemilikController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Psikolog pemilik sebuah klinik — dicentang super admin (klinik mana pun)
 * atau admin klinik (klinik aktifnya). Pemilik mendapat mode "Kelola: Klinik X"
 * di dashboard-nya (KlinikModeController). Klinik dengan satu psikolog aktif
 * tidak perlu dicentang: psikolognya otomatis pemilik.
 *
 * Backend: GET/PUT /api/v1/practices/{id}/owners. Halaman tersendiri,
 * mengikuti KlinikAdminController. Selain yang berhak: 404 sebelum satu
 * request pun ke backend — backend menegakkan aturan yang sama.
 */
class KlinikPemilikController extends Controller
{
    public function __construct(private readonly PraktiquApi $api) {}

    /**
     * Super admin, atau admin klinik ASLI (canManageClinicPayment = role mentah
     * CLINIC_ADMIN; resepsionis juga 'admin' di FE ini) untuk klinik aktifnya.
     * validProfile(), bukan profilOperasional(): psikolog pemilik tidak boleh
     * menunjuk pemilik lain.
     */
    private static function boleh(string $id): bool
    {
        $p = AuthController::validProfile() ?? [];

        return ($p['role'] ?? null) === 'super'
            || (($p['role'] ?? null) === 'admin' && ! empty($p['canManageClinicPayment']) && (string) ($p['practiceId'] ?? '') === $id);
    }

    public function index(string $id): View
    {
        abort_unless(self::boleh($id), 404);

        $data = null;
        try {
            $res = $this->api->get("api/v1/practices/{$id}/owners");
            $data = is_array($res) ? $res : null;
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);
            logger()->warning("[pemilik] roster klinik {$id} gagal: ".$e->getMessage());
        }

        $roster = is_array($data['data'] ?? null) ? $data['data'] : null;

        return view('dashboard.klinik-pemilik', [
            'id' => $id,
            'nama' => (string) ($data['clinic']['name'] ?? 'Klinik #'.$id),
            // null = gagal dimuat; form tidak ditampilkan dalam keadaan itu.
            'roster' => $roster,
            'kembali' => (AuthController::validProfile()['role'] ?? null) === 'super' ? '/admin' : '/klinik',
        ]);
    }

    public function simpan(Request $request, string $id): RedirectResponse
    {
        abort_unless(self::boleh($id), 404);

        $data = $request->validate(
            ['doctorIds' => ['nullable', 'array'], 'doctorIds.*' => ['regex:/^[1-9][0-9]{0,14}$/']],
            ['doctorIds.*.regex' => 'Pilihan psikolog tidak dikenali.'],
        );
        $ids = array_values(array_map('intval', $data['doctorIds'] ?? []));

        $kembali = redirect()->route('klinik.pemilik', ['id' => $id]);
        try {
            $this->api->call('PUT', "api/v1/practices/{$id}/owners", [], ['doctorIds' => $ids]);
        } catch (ApiException $e) {
            abort_if($e->status === 404, 404);

            return $kembali->with('pemilikGagal', match (true) {
                $e->status === 422 => 'Ada psikolog yang tidak lagi aktif di klinik ini. Muat ulang halaman lalu coba lagi.',
                $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah perubahan tersimpan. Muat ulang halaman untuk melihat pemilik saat ini.',
                default => 'Pemilik klinik belum tersimpan.'.ResourceController::rincianValidasi($e->body),
            });
        }

        return $kembali->with('pemilikPesan', 'Pemilik klinik disimpan. Psikolog yang dicentang melihat pilihan "Kelola" setelah memuat ulang dashboard-nya.');
    }
}
```

- [ ] **Step 4: View**

`resources/views/dashboard/klinik-pemilik.blade.php`:

```blade
@extends('layouts.base')

{{-- Psikolog pemilik klinik — lihat KlinikPemilikController. Halaman
     tersendiri, sama seperti dashboard/klinik-admin.blade.php. --}}

@php
  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';
@endphp

@section('title', 'Pemilik Klinik — '.$nama.' — PraktiQu')

@section('content')
<div style="max-width:720px;margin:0 auto;padding:28px 20px 64px">

  <a href="{{ $kembali }}" style="font-size:13.5px;color:{{ $redup }};text-decoration:none">← Kembali ke dashboard</a>

  <h1 style="font-size:26px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:18px 0 6px">Pemilik Klinik</h1>
  <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 24px">
    {{ $nama }} — psikolog pemilik bisa mengelola layanan, jadwal semua psikolog, janji temu, klien,
    billing, dan laporan klinik ini. Rekam medis (encounter, catatan sesi, hasil klien) tetap hanya
    milik psikolog yang menangani.
  </p>

  @if (session('pemilikPesan'))
    <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">
      {{ session('pemilikPesan') }}
    </div>
  @endif
  @if (session('pemilikGagal'))
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">
      {{ session('pemilikGagal') }}
    </div>
  @endif

  @if ($roster === null)
    <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px">
      <div style="font-size:14px;font-weight:700;color:#9B2C2C">Daftar psikolog klinik tidak bisa dimuat.</div>
      <div style="font-size:13px;color:#7A3B3B;margin-top:4px;line-height:1.6">Tidak ada yang diubah. Muat ulang halaman untuk mencoba lagi.</div>
    </div>
  @elseif (count($roster) === 0)
    <div style="font-size:14px;color:{{ $redup }};line-height:1.6">Belum ada psikolog aktif di klinik ini.</div>
  @else
    <form method="POST" action="{{ route('klinik.pemilik.simpan', ['id' => $id]) }}"
          style="border:1.5px solid {{ $garis }};border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:12px">
      @csrf
      @foreach ($roster as $r)
        @php $solo = ($r['source'] ?? null) === 'solo'; @endphp
        <label style="display:flex;align-items:center;gap:12px;font-size:14px;color:{{ $teks }}">
          <input type="checkbox" name="doctorIds[]" value="{{ $r['doctorId'] }}" @checked(! empty($r['owner'])) @disabled($solo)>
          <span style="flex:1">{{ $r['name'] }}</span>
          @if ($solo)
            <span style="font-size:12px;color:{{ $redup }}">otomatis — klinik solo</span>
          @endif
        </label>
      @endforeach

      <div style="font-size:13px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:12px;padding:10px 12px;line-height:1.55">
        Psikolog yang tidak dicentang kehilangan akses pemilik mulai permintaan berikutnya.
        Klinik dengan satu psikolog aktif tidak perlu dicentang.
      </div>

      <div>
        <button type="submit"
                style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">
          Simpan Pemilik
        </button>
      </div>
    </form>
  @endif
</div>
@endsection
```

Pemilik solo dikirim sebagai kotak `disabled`, jadi nilainya tidak ikut terkirim. Itu disengaja, karena backend tidak menyimpan pemilik solo.

- [ ] **Step 5: Route, kartu Settings, dan tautan super admin**

(a) `routes/web.php`, tepat setelah route `->name('klinik.admin.simpan')` (cari `klinik.admin.simpan`):

```php
    // Psikolog pemilik klinik — super admin (klinik mana pun) dan admin klinik
    // (klinik aktifnya); diperiksa KlinikPemilikController, 404 untuk selainnya.
    Route::get('/dashboard/klinik/{id}/pemilik', [\App\Http\Controllers\KlinikPemilikController::class, 'index'])
        ->whereNumber('id')->name('klinik.pemilik');
    Route::post('/dashboard/klinik/{id}/pemilik', [\App\Http\Controllers\KlinikPemilikController::class, 'simpan'])
        ->whereNumber('id')->name('klinik.pemilik.simpan');
```

Letakkan kedua route ini di grup yang sama dengan `klinik.admin`. Cek middleware grupnya dengan membaca beberapa baris di atas route itu.

(b) `DashboardController::render()`: di array view, setelah `'pembayaranKlinikUrl' => ...,`, tambahkan:

```php
            // Pintu ke halaman pemilik klinik: syaratnya sama dengan pembayaran
            // internasional (admin klinik asli, bukan resepsionis).
            'pemilikKlinikUrl' => $role === 'admin' && ! empty($profile['canManageClinicPayment']) && ! empty($profile['practiceId'])
                ? route('klinik.pemilik', ['id' => $profile['practiceId']], false)
                : null,
```

(c) `dashboard.blade.php`: tepat setelah `@endif` penutup kartu Pembayaran Internasional (`@if (! empty($pembayaranKlinikUrl)) ... @endif`), tambahkan:

```blade
          {{-- Admin klinik asli saja — DashboardController::render() mengisi
               $pemilikKlinikUrl. Halamannya: KlinikPemilikController. --}}
          @if (! empty($pemilikKlinikUrl))
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:15px;font-weight:700;color:#1E2236;margin-bottom:4px">Psikolog Pemilik Klinik</div>
            <div style="font-size:13px;color:#8A90A6;margin-bottom:18px;line-height:1.6">Pilih psikolog yang boleh mengelola layanan, jadwal, janji temu, klien, dan laporan klinik ini dari dashboard-nya sendiri.</div>
            <a class="btn-white" href="{{ $pemilikKlinikUrl }}" style="text-decoration:none;display:inline-flex;align-items:center">Atur Pemilik</a>
          </div>
          @endif
```

(d) `resources/views/dashboard/klinik-admin.blade.php`: tepat di bawah paragraf pembuka (`</p>` pertama), tambahkan:

```blade
  <p style="font-size:13.5px;margin:-12px 0 24px">
    <a href="{{ route('klinik.pemilik', ['id' => $id]) }}" style="color:{{ $aksen }};font-weight:700;text-decoration:none">Atur psikolog pemilik klinik ini →</a>
  </p>
```

- [ ] **Step 6: Jalankan tes, lalu suite penuh**

```bash
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit --filter 'KlinikPemilikTest|AdminKlinikSuperTest|PengaturanPembayaranKlinikTest'
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli php vendor/bin/phpunit 2>&1 | tail -3
```

Expected: semua PASS, dengan `OK (...)`.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/KlinikPemilikController.php resources/views/dashboard/klinik-pemilik.blade.php routes/web.php resources/views/dashboard.blade.php app/Http/Controllers/DashboardController.php resources/views/dashboard/klinik-admin.blade.php tests/Feature/KlinikPemilikTest.php
git -c user.name="Claude Code" -c user.email="noreply@anthropic.com" commit -m "feat(klinik): halaman pemilik klinik untuk super admin dan admin klinik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F7: Verifikasi penuh FE dan push

- [ ] **Step 1: Suite penuh dan sintaks**

```bash
cd /home/ahmad/projects/praktiqu-fe/pemilik-klinik
DOCKER_CONFIG=/tmp/dockercfg docker run --rm -v /home/ahmad/projects/praktiqu-fe:/w -w /w/pemilik-klinik php:8.4-cli sh -c 'for f in $(git ls-files -m -o --exclude-standard "*.php") $(git diff --name-only origin/main -- "*.php"); do php -l "$f" >/dev/null || echo "GAGAL $f"; done; php vendor/bin/phpunit 2>&1 | tail -3'
git status --short
```

Expected: tidak ada baris `GAGAL`, keluaran `OK (...)`, dan `git status --short` kosong.

- [ ] **Step 2: Push**

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_praktiqu_fe -o IdentitiesOnly=yes" git push -u origin feat/pemilik-klinik
```

Expected: push berhasil. Tautan PR: `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/pemilik-klinik`.

---

## Part G — Rilis (dikerjakan bersama user, bukan oleh subagent)

### G1: Gerbang data (wajib sebelum deploy backend)

- [ ] Tabel `clinic_owners` dipasang di database WordPress Hostinger. Yang menjalankannya user, atau agen setelah user menyetujui perintahnya:

```bash
ssh praktiqu-hostinger 'mysql -u <user> -p <database>' < prisma/manual/2026-10-16-clinic-owners.sql
```

Lalu verifikasi dengan `SHOW CREATE TABLE clinic_owners;`.

### G2: Deploy backend

- [ ] Merge `fix/scope-gaps` lebih dulu, lalu PR `feat/pemilik-klinik`. Next.js auto-deploy dari `main` lewat integrasi GitHub Hostinger.
- [ ] Uji cepat dengan token psikolog solo: `GET /api/v1/auth/me` harus berisi `ownedClinics` dengan `source: "solo"`.

### G3: Deploy FE

- [ ] Merge PR FE `feat/pemilik-klinik`. Cek bahwa deploy mencapai `appointment.praktiqu.com`. Workflow FE masih menunjuk path dan URL `terpadu`, lihat memori `laravel-fe-repo-access`.

### G4: Uji coba bersama user

- [ ] Psikolog klinik solo: dropdown muncul dengan "(otomatis — klinik solo)". Dalam mode Kelola, ia bisa menambah layanan, jadwal, dan klien, dan bisa membuka Billing & Laporan.
- [ ] Psikolog di klinik bersama: dropdown baru muncul setelah admin mencentangnya di Settings → "Psikolog Pemilik Klinik". Setelah dicabut, aksi berikutnya mengembalikan dashboard ke "Praktik saya" disertai pesan.
- [ ] Dalam mode Kelola, Encounter dan Hasil Klien hanya menampilkan milik psikolog itu sendiri.
