# Psikolog Pemilik Klinik — Desain

**Tanggal:** 2026-10-16
**Status:** Disetujui per bagian oleh user (2026-10-16). Menunggu review spec tertulis.
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu` (branch `feat/pemilik-klinik`, dari `origin/main` 0b16fc7)
- FE Laravel `raakanaka/laravel-praktiqu` (branch baru dari `main`, hanya lewat PR)
- Plugin WordPress `praktiqu-endpoint`: **tidak berubah**

## Masalah

Psikolog (role `PROFESSIONAL`) hanya bisa mengelola baris miliknya sendiri. Padahal banyak
klinik sebenarnya milik seorang psikolog — klinik pribadinya, atau klinik bersama yang ia
pimpin — dan ia perlu mengurus klinik itu tanpa harus punya akun admin klinik terpisah.

Sejak 2026-10-15 (PR #34) psikolog sudah bisa **mengubah** layanannya sendiri. Yang belum:
menambah/menghapus layanan, mengatur jadwal psikolog lain, melihat seluruh janji temu,
klien, billing, dan laporan klinik.

## Keputusan user

| # | Keputusan |
|---|---|
| K1 | Ada flag **pemilik klinik** per pasangan psikolog × klinik. Yang boleh mencentang: super admin (klinik mana pun) dan admin klinik (kliniknya sendiri). |
| K2 | **Klinik solo** (tepat satu psikolog aktif) → psikolognya otomatis pemilik. |
| K3 | Kuasa pemilik = **operasional**: layanan, jadwal semua psikolog, janji temu, klien, billing, laporan klinik. **Bukan** profil/pengaturan klinik, pembayaran internasional, resepsionis. |
| K4 | **Rekam medis tetap milik masing-masing psikolog.** Encounter, catatan sesi, hasil klien dst. tidak ikut terbuka bagi pemilik. |
| K5 | Psikolog multi-klinik memakai **pemilih mode**: "Praktik saya" (perilaku sekarang) atau "Kelola: Klinik X" (terkunci ke klinik X). Data tidak dicampur. |
| K6 | Pendekatan **A + 1**: tabel milik app (bukan kolom KiviCare), izin dibuka **per fitur** (allowlist), role tidak diubah. |

## Kenapa tidak memakai kolom `owner` milik KiviCare

`wp_kc_doctor_clinic_mappings` sudah punya kolom `owner` (tinyint, default 0, berindeks
`(clinic_id, owner)`), tapi KiviCare selalu menulis 0 dan — yang menentukan — **menghapus lalu
membuat ulang** semua mapping seorang dokter setiap kali profilnya disimpan
(`Wordpress-Plugin/kivicare-clinic-management-system/app/controllers/api/DoctorController.php:1627-1633`,
`saveDoctorClinic()` :1438). Flag di kolom itu akan kembali ke 0 diam-diam setiap kali
seseorang mengedit dokter di WordPress.

## Kenapa tidak "jadikan CLINIC_ADMIN lalu kecualikan"

`role === 'CLINIC_ADMIN'` dan `kc.clinicId` dipakai di puluhan tempat. Menyamar sebagai
admin lalu mengecualikan fitur klinis berarti satu pengecualian yang terlewat = rekam medis
bocor. Allowlist membalik risikonya: fitur yang terlupa tetap **tertutup**.

---

## 1. Data

### Tabel `clinic_owners` (milik app)

```sql
CREATE TABLE IF NOT EXISTS clinic_owners (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  clinic_id          BIGINT UNSIGNED NOT NULL,   -- wp_kc_clinics.id
  doctor_wp_user_id  BIGINT UNSIGNED NOT NULL,   -- wp_users.ID
  created_by         VARCHAR(191)    NOT NULL,   -- users.id (cuid string) actor yang mencentang
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clinic_owner (clinic_id, doctor_wp_user_id),
  KEY idx_owner_doctor (doctor_wp_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- Dibuat lewat `prisma/manual/2026-10-16-clinic-owners.sql` (pola yang sama dengan file lain di sana) + model Prisma `ClinicOwner` — **tanpa** `db push`
  / `migrate dev` (DATABASE_URL adalah database WordPress; lihat
  `docs/deploy/FINAL-MIGRATION-CHECKLIST.md`).
- Mencabut pemilik = `DELETE` barisnya. Tidak ada soft delete; jejaknya di audit log.

### Definisi

- **Psikolog aktif di klinik C**: ada baris `wp_kc_doctor_clinic_mappings` (doctor_id, C),
  user-nya punya kapabilitas `kiviCare_doctor`, dan usermeta
  `praktiqu_professional_status` adalah `ACTIVE` **atau kosong/tidak ada** (konvensi
  `doctors.repo.ts:307-310` — meta kosong dibaca ACTIVE). `wp_users.user_status` **tidak**
  dipakai (kontradiktif di KiviCare, lihat `doctors.repo.ts:30-36`).
- **Klinik solo**: tepat satu psikolog aktif di klinik itu. Dihitung **setiap request**, tidak
  disimpan — begitu psikolog kedua masuk, kuasa otomatisnya berhenti.

### Modul `src/services/clinic-owner/`

| Fungsi | Isi |
|---|---|
| `isClinicOwner(wpUserId, clinicId): Promise<boolean>` | psikolog **aktif** di klinik itu **dan** (ada baris `clinic_owners` **atau** klinik solo). Mapping yang sudah hilang membatalkan baris `clinic_owners` yang basi. |
| `listOwnedClinics(wpUserId): Promise<OwnedClinic[]>` | `{ id, name, source: 'manual' \| 'solo' }`, urut id. `manual` menang bila keduanya berlaku. |
| `listClinicOwnerRoster(clinicId)` | psikolog aktif klinik itu + `{ owner: boolean, source: 'manual' \| 'solo' \| null }` — untuk layar centang. |
| `setClinicOwners(clinicId, doctorWpUserIds, actorId)` | ganti seluruh set pemilik manual klinik itu; tiap id wajib psikolog aktif di klinik itu (422 kalau bukan); audit `clinic_owner.granted` / `clinic_owner.revoked` per perubahan. |

---

## 2. Mode pemilik per request

- `X-Praktiqu-Clinic-Id` (sudah ada, `src/lib/auth/active-clinic.ts`) kini juga dibaca untuk
  `PROFESSIONAL`:
  - tidak ada / kosong → **"Praktik saya"**, perilaku identik dengan hari ini;
  - ada → wajib klinik yang `isClinicOwner` benar, kalau tidak `403 clinic_not_in_scope`
    (jawaban yang sama untuk klinik tak dikenal maupun milik orang lain — tidak bisa dipakai
    menebak id klinik). Format salah → `400 invalid_clinic_header`, seperti admin.
- Hasilnya disimpan di field **baru** `Actor.ownerClinicId?: bigint`. `activeClinicId` dan
  `KcActor.clinicId` **tidak** diubah untuk psikolog, sehingga tak satu pun cabang
  `CLINIC_ADMIN` / `kc.clinicId` yang ikut terbuka.
- Helper `ownerClinicOf(actor): bigint | null` dipakai semua cabang scope di bawah.
- `/auth/me` untuk `PROFESSIONAL` ditambah `ownedClinics: OwnedClinic[]` (selalu ada, boleh
  kosong). `clinicId` tetap `null` seperti sekarang.

---

## 3. Akses dalam mode pemilik (allowlist)

Setiap fungsi scope yang dibuka mendapat **satu cabang** yang sama:
`role === 'PROFESSIONAL' && ownerClinicId` → scope klinik `{ clinicId: ownerClinicId }`
(setara admin klinik untuk klinik itu). Penulisan target dikunci ke `ownerClinicId`.

| Area | Mode pemilik di Klinik X | Titik ubah (perkiraan, dipastikan di plan) |
|---|---|---|
| Layanan | list/get semua psikolog di X; **tambah**, ubah, **hapus** | `service-catalog/scope.ts` (`readScopeFor`, `canWrite`, `canEdit`), `services/route.ts`, `services/[id]/route.ts` |
| Jadwal praktik | baca & tulis jadwal mingguan / sesi psikolog mana pun di X | `billing/staff-scope.ts` `doctorSessionScopeFor`, `professional-sessions/**` |
| Ketersediaan & hari off | psikolog mana pun di X | `professionals/[id]/availability`, `off-days`, `professional/route-scope.ts` |
| Clinic schedule (modul doctor) | psikolog di X | `schedule-scope.ts`, `clinic-schedule.service.ts` |
| Janji temu | list/get/kalender semua di X; **buat** (booking manual untuk psikolog di X); approve/check-in/check-out/batal; ekspor; batal massal (terbatas X) | `session.service.ts` (`createSession` :252, `listSessions`, `transitionSession`, `getCalendar`), `sessions/export`, `sessions/bulk/delete` |
| Klien | list/get klien X; **tambah**; ubah kontak (field staf); aktif/nonaktif; arsip; ekspor | `client/access-control.ts`, `client.service.ts` (`listClients`, `createClient`, `setStatus`, `archiveClient`, `exportClients`) |
| Billing | list/view/tambah; hapus item — klinik X | `kc-permissions.ts` (`billScopeFor`, cap `patient_bill_delete`) |
| Dashboard & laporan | statistik dan data laporan klinik X | `schedule-scope.ts` `dashboardScopeFor`; FE Laporan memakai `GET /sessions` + `GET /bills` |

**Tetap seperti psikolog biasa (baris miliknya sendiri) di mode apa pun — K4:**
encounter + dokumen encounter, catatan sesi, rencana intervensi, hasil klien + PIN, riwayat
medis, resep, laporan medis (`med-report-scope.ts`), follow-up.

**Tetap ditolak di mode apa pun — K3:** profil/pengaturan/nonaktifkan klinik
(`practices/[id]`, `settings`), hari libur klinik (`holidays`), pembayaran internasional
(`payment-settings`), resepsionis, daftar/nonaktifkan/status psikolog, pajak (`tax_manage`),
impor, GDPR, template email, custom field, notes template, **menunjuk pemilik**.

**Klien vs rekam medis.** Membuka "klien klinik X" hanya membuka data identitas & kontak
(`/clients`). Pintu klinis (`canProfessionalAccessClient` untuk encounter/hasil) **tidak**
memakai cabang pemilik.

### Endpoint pengatur pemilik

| | |
|---|---|
| `GET /api/v1/practices/{id}/owners` | roster psikolog aktif klinik + status pemilik + sumber |
| `PUT /api/v1/practices/{id}/owners` | body `{ doctorIds: number[] }` = set pemilik **manual** lengkap |

- `SUPER_ADMIN`: klinik mana pun. `CLINIC_ADMIN`: hanya klinik di `listAdminClinicIds` —
  klinik lain 404. Peran lain 403, termasuk psikolog pemilik.
- Psikolog yang bukan psikolog aktif di klinik itu → 422 dengan `fields.doctorIds`.
- Pemilik solo tidak disimpan; mengirim/menghapusnya tidak mengubah apa pun (ia tetap
  `source: 'solo'` selama kliniknya solo).

---

## 4. FE (Laravel)

- **Profil sesi**: `ownedClinics` dari `/auth/me` disimpan untuk psikolog; mode aktif di key
  **baru** `ownerClinicId`. `practiceId` tidak disentuh (untuk psikolog ia dipakai memfilter
  "Praktik saya", `DashboardController.php:446-461`). `PROFILE_VERSION` dinaikkan supaya sesi
  lama dimuat ulang.
- **Pemilih mode**: dropdown di sidebar, pola sama dengan pemilih klinik admin
  (`KlinikAktifController`). Isi: "Praktik saya" + "Kelola: {nama}" per klinik milik, label
  "(otomatis — klinik solo)" untuk `source: 'solo'`. Hanya tampil bila `ownedClinics` tidak
  kosong. Route baru `POST /dashboard/mode-klinik` (`clinicId` atau kosong untuk "Praktik
  saya"), divalidasi terhadap `ownedClinics`, 422 kalau bukan miliknya.
- **Header**: `PraktiquApi::headerKlinikAktif()` juga mengirim `X-Praktiqu-Clinic-Id` untuk
  psikolog yang `ownerClinicId`-nya terisi.
- **Satu helper**: `AuthController::modePemilik(): ?int` (id klinik atau null). Role tetap
  `'psikolog'` — **tidak** dijadikan `'admin'`, karena `'admin'` di FE juga resepsionis dan
  membuka hal yang sengaja tidak diberikan.
- **Controller yang dibuka** (klinik dikunci ke `modePemilik()`, seperti `practiceId` admin):
  - `ServiceController` — tambah & hapus layanan.
  - `DashboardController::services()` — mode pemilik memakai `clinicId=ownerClinicId`
    (jalur admin), bukan jalur "layanan saya".
  - `DoctorSessionController`, `CustomSessionController` — psikolog mana pun di klinik itu.
  - `ManualAppointmentController` — roster psikolog = seluruh klinik.
  - `ResourceController` (patients) — tambah, aktif/nonaktif, arsip.
  - `ReportController`, Billing — dibuka.
  - Daftar per role (`DashboardController.php:89-92`): mode pemilik memuat `bills`.
- **Tampilan** (`ROLE_ALLOWED` / `$ALLOWED_NAV` + `x-show`): mode pemilik menambah menu
  Billing & Laporan, tombol Tambah/Hapus layanan, Add Client + toggle + arsip, filter
  psikolog di Doctor Sessions. Encounters & Hasil Klien tetap tampil dengan isi miliknya.
- **Layar centang pemilik**:
  - Admin klinik: kartu "Psikolog klinik" di Settings — roster + kotak **Pemilik**; klinik
    solo tampil tercentang, terkunci, berketerangan "otomatis — klinik solo". Simpan →
    `PUT owners`.
  - Super admin: kartu yang sama di `/dashboard/klinik/{id}/admin`.

---

## 5. Galat

| Keadaan | Perilaku |
|---|---|
| Status pemilik hilang di tengah sesi (dicabut, psikolog kedua masuk klinik solo, mapping dilepas) | request berikutnya `403 clinic_not_in_scope` → FE menghapus `ownerClinicId`, kembali ke "Praktik saya", toast "Akses pemilik untuk {klinik} sudah tidak berlaku", memuat ulang `ownedClinics` |
| `PUT owners` oleh peran lain | 403; klinik bukan milik admin → 404 |
| Mencentang psikolog yang tidak aktif di klinik itu | 422 `fields.doctorIds` |
| Header klinik untuk psikolog di "Praktik saya" | tidak dikirim; backend tidak mengubah apa pun |

---

## 6. Test

**Backend (vitest):**
- `isClinicOwner` / `listOwnedClinics`: manual; solo; psikolog nonaktif tidak dihitung ke solo;
  baris `clinic_owners` basi (mapping hilang) tidak berlaku; klinik dua psikolog tanpa centang.
- `resolveActiveClinic` cabang PROFESSIONAL: tanpa header, header milik, header bukan milik
  (403), header rusak (400). `activeClinicId` tetap kosong untuk psikolog.
- Setiap scope yang dibuka di §3: mode pemilik melihat/menulis klinik X; mode "Praktik saya"
  tidak berubah.
- **Satu test negatif per fitur klinis & konfigurasi di mode pemilik** (encounter, catatan
  sesi, hasil klien, riwayat medis, resep, laporan medis, follow-up, practices PATCH,
  settings, holidays, payment-settings, receptionists, owners PUT, tax manage, import, GDPR).
  Ini pagar utama K4.
- `GET/PUT owners`: matriks peran, 404 klinik lain, 422 psikolog asing, audit tertulis.

**FE (phpunit):**
- Header dikirim untuk psikolog mode pemilik, tidak untuk "Praktik saya".
- `POST /dashboard/mode-klinik` menolak klinik yang bukan miliknya.
- Setiap controller yang dibuka: psikolog mode pemilik diterima dengan klinik terkunci;
  psikolog biasa tetap ditolak seperti sekarang.
- 403 `clinic_not_in_scope` mengembalikan sesi ke "Praktik saya".

---

## 7. Rollout

1. Jalankan SQL `CREATE TABLE clinic_owners` di database Hostinger (aditif).
2. Merge + deploy BE. Tanpa header, tidak ada yang berubah bagi pengguna mana pun.
3. Merge FE. Klinik solo langsung mendapat mode pemilik; klinik bersama menunggu admin/super
   admin mencentang.

## Di luar cakupan

- Pemilik mengelola resepsionis atau pengaturan klinik.
- Pemilik menunjuk pemilik lain.
- Notifikasi ke psikolog saat dijadikan / dicabut sebagai pemilik.
- Membuka rekam medis psikolog lain bagi pemilik.
