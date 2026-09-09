# Pengingat Sesi T−24 Jam dan T−1 Jam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kirim email pengingat ke klien dan profesional 24 jam dan 1 jam sebelum sesi yang sudah BOOKED.

**Architecture:** WordPress Action Scheduler yang menjadwalkan; ketika menyala ia mengirim webhook `session.reminder` kembali ke Next.js, dan Next.js yang mengirim emailnya. Handler sisi WordPress sudah ada dan terdaftar sejak awal — yang dibangun di sini adalah sisi Next.js: yang menjadwalkan, yang membatalkan, dan yang menerima. Tanpa tabel baru: idempotensi dari cancel-lalu-enqueue, catatan terkirim dari `LogEntry`.

**Tech Stack:** TypeScript, Next.js 14 App Router, Prisma 5 (raw SQL untuk tabel `wp_kc_*`), Vitest, date-fns-tz.

**Spec:** `docs/superpowers/specs/2026-09-08-session-reminders-design.md`

## Global Constraints

- **Backend Next.js dan plugin `praktiqu-endpoint`.** Tidak ada perubahan skema Prisma. Plugin itu milik proyek ini dan terpasang di server; ia dalam cakupan sejak amandemen 8 September (lihat spec §3b).
- **Urutan kunci `args` adalah kontraknya, bukan namanya.** Action Scheduler mengeksekusi dengan `do_action_ref_array($hook, array_values($this->get_args()))` — `array_values()` membuang kunci. `args` harus selalu ditulis `{ sessionId, channel }` dalam urutan itu, karena handler PHP-nya `handle_session_send_reminder(int $session_id, string $channel = 'email')` menerimanya secara posisional.
- **Nama hook:** `praktiqu_session_send_reminder`. Nama event webhook: `session.reminder`.
- **Nilai `channel`:** hanya `'email_24h'` dan `'email_1h'`.
- **Model `AppointmentReminder` tidak boleh dipakai.** Foreign key-nya menunjuk tabel shadow `Appointment` yang sudah mati dan antre `DROP TABLE` di Fase 4.
- **Penerima:** klien **dan** profesional, keduanya di T−24 jam dan T−1 jam. Empat email per sesi.
- **Guard jam mulai tanpa masa tenggang:** kalau `startsAt <= now` saat webhook tiba, tidak ada email dikirim.
- **Penerima tanpa email dilewati, bukan bikin gagal.** Handler tidak boleh melempar karena alamat email kosong.
- **Salinan email berbahasa Indonesia.**
- **Test unit tetap harus jalan tanpa database** — mock `@/lib/db`, `@/lib/jobs/client`, dan `@/lib/email`. Itu bukan lagi karena keterbatasan lingkungan, tapi karena test yang cepat dan tak bergantung DB lebih berguna.
- **Baseline sekarang hijau: `npm test` = 154 berkas / 1522 test, semua lulus.** MySQL sudah hidup (container `praktiqu-mysql`). Jadi kegagalan apa pun, di berkas mana pun, adalah regresi nyata — tidak ada lagi "noise lingkungan" untuk disingkirkan.
- **PHP diuji di container, bukan di server.** `docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli` — terbukti melint 16 berkas plugin bersih dan menjalankan `php tests/test-money.php` sampai ALL PASS.
- **Jalankan `npx tsc --noEmit` sebelum setiap commit.** Harus bersih.

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `src/repositories/wp/sessions.repo.ts` (ubah) | Tambah `professionalEmail` ke `SessionRow` — kolomnya belum diambil, padahal join `wp_users du` sudah ada |
| `src/services/session/reminder-email.ts` (baru) | Murni: sesi + penerima + offset → `{subject, html, text}` Bahasa Indonesia. Tanpa I/O |
| `src/services/session/reminder-schedule.ts` (baru) | Hitung `runAt`, enqueue dan cancel job. Satu-satunya yang menyentuh `@/lib/jobs` |
| `src/services/session/reminder-handler.ts` (baru) | Terima `{sessionId, channel}`, guard, kirim, catat audit. Mendaftarkan dirinya di lingkup modul |
| `src/app/api/v1/webhooks/wordpress-jobs/route.ts` (ubah) | Impor `reminder-handler` demi efek samping pendaftaran |
| `src/services/session/session.service.ts` (ubah) | Dua kail `syncSessionReminders(row)` |

Urutan task mengikuti arah ketergantungan: repo dulu (handler butuh `professionalEmail`), lalu unit murni, lalu yang ber-I/O, lalu penyambungan.

---

### Task 1: `professionalEmail` di `SessionRow`

`SELECT_SQL` sudah men-`LEFT JOIN wp_users du ON du.ID = a.doctor_id` dan sudah mengambil `pu.user_email AS patient_email`, tapi tidak mengambil email dokternya. Tanpa ini handler tidak bisa mengirim ke profesional. Penambahan kolom bersifat aditif — pemanggil lain (`listSessions`, `findSessionById`, `payment.service.ts`) mengabaikannya.

**Files:**
- Modify: `src/repositories/wp/sessions.repo.ts` (tipe `SessionRow` di ~103, `toSession` di ~167, `RawRow` di ~121, `SELECT_SQL` di ~193)
- Test: `tests/repositories/wp-sessions-professional-email.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `SessionRow.professionalEmail: string` — string kosong bila kolomnya `NULL`, mengikuti perlakuan `clientEmail` yang sudah ada.

- [ ] **Step 1: Tulis test yang gagal**

Test ini memanggil `findSessionById` dengan `@/lib/db` yang dimock, jadi ia menguji pemetaan `toSession` lewat pintu publiknya tanpa database.

```typescript
// tests/repositories/wp-sessions-professional-email.test.ts
/**
 * `SessionRow` membawa email klien tapi dulu tidak membawa email profesional, padahal
 * join `wp_users du` sudah ada di SELECT_SQL. Pengingat sesi mengirim ke keduanya, jadi
 * kolomnya harus ikut terambil.
 *
 * Prisma dimock: tidak ada MySQL di lingkungan dev ini.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const db = { prisma: { $queryRawUnsafe: vi.fn() } };
vi.mock('@/lib/db', () => db);

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    clinic_id: 1,
    doctor_id: 119,
    patient_id: 522,
    appointment_start_date: new Date('2026-09-10T00:00:00Z'),
    appointment_start_time: new Date('1970-01-01T09:30:00Z'),
    appointment_end_time: new Date('1970-01-01T10:30:00Z'),
    appointment_timezone: 'Asia/Jakarta',
    visit_type: '3',
    description: null,
    status: 1,
    created_at: new Date('2026-09-01T00:00:00Z'),
    doctor_first: 'Pamela',
    doctor_last: 'Dewi',
    doctor_display: 'Pamela Dewi',
    doctor_email: 'pamela@klinik.test',
    patient_first: 'Ada',
    patient_last: 'Lovelace',
    patient_display: 'Ada Lovelace',
    patient_email: 'ada@contoh.test',
    ...over,
  };
}

describe('findSessionById — email profesional', () => {
  beforeEach(() => db.prisma.$queryRawUnsafe.mockReset());

  it('membawa email profesional dari kolom doctor_email', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow()]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    const row = await findSessionById(7);

    expect(row?.professionalEmail).toBe('pamela@klinik.test');
    expect(row?.clientEmail).toBe('ada@contoh.test');
  });

  it('memakai string kosong saat dokter tidak punya email, seperti perlakuan klien', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow({ doctor_email: null })]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    const row = await findSessionById(7);

    expect(row?.professionalEmail).toBe('');
  });

  it('meminta kolom doctor_email di SQL-nya', async () => {
    db.prisma.$queryRawUnsafe.mockResolvedValue([rawRow()]);
    const { findSessionById } = await import('@/repositories/wp/sessions.repo');

    await findSessionById(7);

    const sql = db.prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('du.user_email');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/repositories/wp-sessions-professional-email.test.ts`
Expected: FAIL. Dua test pertama gagal karena `professionalEmail` `undefined`, bukan string. Test ketiga gagal karena SQL belum memuat `du.user_email`.

- [ ] **Step 3: Tambah kolomnya ke SQL**

Di `src/repositories/wp/sessions.repo.ts`, pada `SELECT_SQL`, ubah baris yang mengambil kolom dokter:

```
         df.meta_value AS doctor_first,  dl.meta_value AS doctor_last,  du.display_name AS doctor_display,
         du.user_email AS doctor_email,
```

- [ ] **Step 4: Tambah field ke `RawRow` dan `SessionRow`**

Di tipe `RawRow`, tepat setelah `doctor_display`:

```typescript
  doctor_email: string | null;
```

Di tipe `SessionRow`, tepat setelah `clientEmail`:

```typescript
  /** Email profesional. String kosong bila `wp_users.user_email`-nya NULL. */
  professionalEmail: string;
```

- [ ] **Step 5: Petakan di `toSession`**

Di `toSession`, tepat setelah baris `clientEmail`:

```typescript
    professionalEmail: r.doctor_email ?? '',
```

- [ ] **Step 6: Jalankan test dan type-check**

Run: `npx vitest run tests/repositories/wp-sessions-professional-email.test.ts`
Expected: PASS (3 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 7: Commit**

```bash
git add src/repositories/wp/sessions.repo.ts tests/repositories/wp-sessions-professional-email.test.ts
git commit -m "feat(sessions): bawa email profesional di SessionRow

Join wp_users du sudah ada di SELECT_SQL tapi kolom emailnya tidak pernah
diambil. Pengingat sesi mengirim ke klien dan profesional, jadi keduanya
harus tersedia dari satu round trip."
```

---

### Task 2: Isi email pengingat

Unit murni: tidak menyentuh database, jaringan, atau jam. Semua yang dibutuhkannya masuk sebagai argumen, jadi ia bisa diuji tanpa mock apa pun.

Tanggal ditulis dalam Bahasa Indonesia. `formatDateTimeInTz` tidak menerima locale, jadi nama hari dan bulan dipetakan di sini — dua pemanggilan helper, sisanya murni aritmetika string.

**Files:**
- Create: `src/services/session/reminder-email.ts`
- Test: `tests/unit/session/reminder-email.test.ts`

**Interfaces:**
- Consumes: `formatDateTimeInTz(utcDate, tz, fmt)` dan `getDayOfWeekInTz(utcDate, tz)` dari `@/lib/time`.
- Produces:
  - `type ReminderOffset = 'email_24h' | 'email_1h'`
  - `type ReminderRecipient = 'client' | 'professional'`
  - `interface SessionReminderEmailInput { offset, recipient, clientName, professionalName, startsAtUtc, timezone }`
  - `interface BuiltEmail { subject: string; html: string; text: string }`
  - `buildSessionReminderEmail(input: SessionReminderEmailInput): BuiltEmail`

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// tests/unit/session/reminder-email.test.ts
/**
 * Murni, tanpa mock: sesi + penerima + offset → subjek dan isi.
 *
 * Yang dipaku di sini adalah hal-hal yang gampang rusak diam-diam: tanggal berbahasa
 * Indonesia, dan perbedaan sudut pandang antara email untuk klien ("sesi Anda dengan
 * Pamela Dewi") dan untuk profesional ("sesi Anda dengan Ada Lovelace").
 */
import { describe, expect, it } from 'vitest';
import { buildSessionReminderEmail } from '@/services/session/reminder-email';

// Kamis, 10 September 2026, 09:30 di Asia/Jakarta = 02:30 UTC.
const STARTS_AT = new Date('2026-09-10T02:30:00Z');

const base = {
  clientName: 'Ada Lovelace',
  professionalName: 'Pamela Dewi',
  startsAtUtc: STARTS_AT,
  timezone: 'Asia/Jakarta',
} as const;

describe('buildSessionReminderEmail', () => {
  it('menulis tanggal dan jam dalam Bahasa Indonesia pada zona waktu klinik', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });

    expect(mail.text).toContain('Kamis, 10 September 2026');
    expect(mail.text).toContain('09:30');
  });

  it('memberi tahu klien nama profesionalnya', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });

    expect(mail.text).toContain('Pamela Dewi');
    expect(mail.html).toContain('Ada Lovelace'); // sapaan
  });

  it('memberi tahu profesional nama kliennya', () => {
    const mail = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'professional' });

    expect(mail.text).toContain('Ada Lovelace');
    expect(mail.html).toContain('Pamela Dewi'); // sapaan
  });

  it('membedakan subjek pengingat besok dari yang satu jam lagi', () => {
    const h24 = buildSessionReminderEmail({ ...base, offset: 'email_24h', recipient: 'client' });
    const h1 = buildSessionReminderEmail({ ...base, offset: 'email_1h', recipient: 'client' });

    expect(h24.subject).not.toBe(h1.subject);
    expect(h24.subject.toLowerCase()).toContain('besok');
    expect(h1.subject).toContain('1 jam');
  });

  it('mengisi ketiga bagian untuk setiap kombinasi', () => {
    for (const offset of ['email_24h', 'email_1h'] as const) {
      for (const recipient of ['client', 'professional'] as const) {
        const mail = buildSessionReminderEmail({ ...base, offset, recipient });
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('menghormati zona waktu yang diberikan, bukan zona server', () => {
    const jakarta = buildSessionReminderEmail({ ...base, offset: 'email_1h', recipient: 'client' });
    const utc = buildSessionReminderEmail({ ...base, timezone: 'UTC', offset: 'email_1h', recipient: 'client' });

    expect(jakarta.text).toContain('09:30');
    expect(utc.text).toContain('02:30');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/unit/session/reminder-email.test.ts`
Expected: FAIL dengan "Cannot find module '@/services/session/reminder-email'"

- [ ] **Step 3: Tulis implementasinya**

```typescript
// src/services/session/reminder-email.ts
/**
 * Isi email pengingat sesi.
 *
 * Murni: tidak menyentuh database, jaringan, atau jam. Semua yang dibutuhkan masuk
 * sebagai argumen, jadi ia bisa diuji tanpa satu pun mock.
 *
 * Salinan berbahasa Indonesia — sengaja berbeda dari empat pengirim email lain yang
 * masih berbahasa Inggris. Menyeragamkan yang lain di luar cakupan; lihat §8 spec.
 *
 * Nama hari dan bulan dipetakan di sini karena `formatDateTimeInTz` tidak menerima
 * locale. Menambah dukungan locale ke `lib/time.ts` akan menyentuh semua pemanggilnya,
 * dan tidak ada yang membutuhkannya selain email ini.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { formatDateTimeInTz, getDayOfWeekInTz } from '@/lib/time';

export type ReminderOffset = 'email_24h' | 'email_1h';
export type ReminderRecipient = 'client' | 'professional';

export interface SessionReminderEmailInput {
  offset: ReminderOffset;
  recipient: ReminderRecipient;
  clientName: string;
  professionalName: string;
  /** Jam mulai sesi dalam UTC. */
  startsAtUtc: Date;
  /** Zona waktu klinik, mis. 'Asia/Jakarta'. */
  timezone: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** 'Kamis, 10 September 2026' + '09:30', pada zona waktu klinik. */
function formatWaktu(startsAtUtc: Date, timezone: string): { tanggal: string; jam: string } {
  const [datePart, jam] = formatDateTimeInTz(startsAtUtc, timezone, 'yyyy-MM-dd HH:mm').split(' ');
  const [tahun, bulan, hariAngka] = datePart.split('-').map(Number);
  const hari = HARI[getDayOfWeekInTz(startsAtUtc, timezone)];
  return { tanggal: `${hari}, ${hariAngka} ${BULAN[bulan - 1]} ${tahun}`, jam };
}

export function buildSessionReminderEmail(input: SessionReminderEmailInput): BuiltEmail {
  const { tanggal, jam } = formatWaktu(input.startsAtUtc, input.timezone);

  // Siapa yang disapa, dan siapa lawan bicaranya di sesi itu.
  const sapaan = input.recipient === 'client' ? input.clientName : input.professionalName;
  const lawan = input.recipient === 'client' ? input.professionalName : input.clientName;
  const peranLawan = input.recipient === 'client' ? 'psikolog' : 'klien';

  const kapan = input.offset === 'email_24h' ? 'besok' : '1 jam lagi';
  const subject =
    input.offset === 'email_24h'
      ? `Pengingat: sesi Anda besok, ${tanggal} pukul ${jam}`
      : `Pengingat: sesi Anda 1 jam lagi, pukul ${jam}`;

  const html = `<p>Halo ${sapaan},</p>
<p>Ini pengingat bahwa sesi Anda berlangsung <strong>${kapan}</strong>.</p>
<ul>
  <li>Tanggal: ${tanggal}</li>
  <li>Waktu: ${jam}</li>
  <li>Bersama ${peranLawan}: ${lawan}</li>
</ul>
<p>Kalau Anda perlu mengubah jadwal, hubungi klinik sesegera mungkin.</p>`;

  const text = `Halo ${sapaan},

Ini pengingat bahwa sesi Anda berlangsung ${kapan}.

Tanggal: ${tanggal}
Waktu: ${jam}
Bersama ${peranLawan}: ${lawan}

Kalau Anda perlu mengubah jadwal, hubungi klinik sesegera mungkin.`;

  return { subject, html, text };
}
```

- [ ] **Step 4: Jalankan test dan type-check**

Run: `npx vitest run tests/unit/session/reminder-email.test.ts`
Expected: PASS (6 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add src/services/session/reminder-email.ts tests/unit/session/reminder-email.test.ts
git commit -m "feat(sessions): isi email pengingat, Bahasa Indonesia

Unit murni tanpa I/O. Nama hari dan bulan dipetakan lokal karena
formatDateTimeInTz tidak menerima locale, dan tidak ada pemanggil lain
yang membutuhkannya."
```

---

### Task 3: Penjadwalan dan pembatalan job

Satu-satunya modul yang menyentuh `@/lib/jobs`. Menerima `SessionRow` dan memutuskan sendiri dari `row.status` — jadi kedua titik hook nanti memanggil fungsi yang sama tanpa bercabang.

`now` disuntikkan supaya test bisa memindahkan waktu tanpa `sleep`, mengikuti pola `nowProvider` di `src/lib/rate-limit.ts`.

**Files:**
- Create: `src/services/session/reminder-schedule.ts`
- Test: `tests/unit/session/reminder-schedule.test.ts`

**Interfaces:**
- Consumes: `jobs` dari `@/lib/jobs/client`; `buildUtcDateTime`, `timeToMinutes` dari `@/lib/time`; `SESSION_STATUS`, tipe `SessionRow` dari `@/repositories/wp/sessions.repo`; tipe `ReminderOffset` dari `./reminder-email`.
- Produces:
  - `REMINDER_HOOK = 'praktiqu_session_send_reminder'`
  - `REMINDER_OFFSETS: readonly ReminderOffset[]`
  - `sessionStartsAtUtc(row: SessionRow): Date | null`
  - `reminderArgs(sessionId: number, channel: ReminderOffset): { sessionId: number; channel: ReminderOffset }`
  - `syncSessionReminders(row: SessionRow, now?: Date): Promise<void>`

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// tests/unit/session/reminder-schedule.test.ts
/**
 * Penjadwalan pengingat, dengan `@/lib/jobs/client` dimock.
 *
 * Test paling penting di berkas ini adalah yang memaku **urutan kunci** `args`.
 * Action Scheduler mengeksekusi dengan `do_action_ref_array($hook, array_values($args))`,
 * jadi `array_values()` membuang kuncinya dan handler PHP menerimanya secara posisional.
 * Menukar urutannya tidak akan membuat apa pun gagal sampai produksi. Kelas bug yang
 * sama membuat SEMUA penjadwalan job gagal diam-diam dari Juli sampai 1 September 2026.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const jobsClient = { jobs: { enqueue: vi.fn(), cancel: vi.fn() } };
vi.mock('@/lib/jobs/client', () => jobsClient);

import { syncSessionReminders, reminderArgs, sessionStartsAtUtc } from '@/services/session/reminder-schedule';

// Kamis, 10 September 2026, 09:30 Asia/Jakarta = 02:30 UTC.
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
    slotDate: '2026-09-10',
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

const STARTS_AT = new Date('2026-09-10T02:30:00Z');
const JAUH_SEBELUM = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
  jobsClient.jobs.enqueue.mockReset();
  jobsClient.jobs.cancel.mockReset();
});

describe('reminderArgs — urutan kunci adalah kontraknya', () => {
  it('menaruh sessionId lebih dulu, lalu channel', () => {
    // array_values() di sisi PHP membuang kunci, jadi urutan inilah yang menentukan
    // argumen mana yang jadi $session_id dan mana yang jadi $channel.
    expect(Object.keys(reminderArgs(7, 'email_24h'))).toEqual(['sessionId', 'channel']);
    expect(Object.values(reminderArgs(7, 'email_24h'))).toEqual([7, 'email_24h']);
  });
});

describe('sessionStartsAtUtc', () => {
  it('menggabungkan tanggal, jam, dan zona waktu klinik menjadi UTC', () => {
    expect(sessionStartsAtUtc(row())?.toISOString()).toBe(STARTS_AT.toISOString());
  });

  it('mengembalikan null bila tanggal atau jamnya kosong', () => {
    expect(sessionStartsAtUtc(row({ slotDate: null }))).toBeNull();
    expect(sessionStartsAtUtc(row({ startTime: null }))).toBeNull();
  });
});

describe('syncSessionReminders — sesi BOOKED', () => {
  it('membatalkan lebih dulu supaya penjadwalan idempoten', async () => {
    await syncSessionReminders(row(), JAUH_SEBELUM);

    expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
    const [first] = jobsClient.jobs.cancel.mock.invocationCallOrder;
    const [firstEnqueue] = jobsClient.jobs.enqueue.mock.invocationCallOrder;
    expect(first).toBeLessThan(firstEnqueue);
  });

  it('menjadwalkan dua job pada T-24 jam dan T-1 jam', async () => {
    await syncSessionReminders(row(), JAUH_SEBELUM);

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(2);
    const calls = jobsClient.jobs.enqueue.mock.calls.map((c) => c[0]);

    expect(calls[0]).toEqual({
      hook: 'praktiqu_session_send_reminder',
      runAt: new Date(STARTS_AT.getTime() - 24 * 60 * 60_000),
      args: { sessionId: 7, channel: 'email_24h' },
    });
    expect(calls[1]).toEqual({
      hook: 'praktiqu_session_send_reminder',
      runAt: new Date(STARTS_AT.getTime() - 60 * 60_000),
      args: { sessionId: 7, channel: 'email_1h' },
    });
  });

  it('melewati pengingat yang waktunya sudah lewat', async () => {
    // 3 jam sebelum sesi: T-24 jam sudah lewat, T-1 jam belum.
    const now = new Date(STARTS_AT.getTime() - 3 * 60 * 60_000);

    await syncSessionReminders(row(), now);

    expect(jobsClient.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobsClient.jobs.enqueue.mock.calls[0][0].args.channel).toBe('email_1h');
  });

  it('tidak menjadwalkan apa pun untuk sesi yang kurang dari satu jam lagi', async () => {
    const now = new Date(STARTS_AT.getTime() - 30 * 60_000);

    await syncSessionReminders(row(), now);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
    // Pembatalan tetap jalan — kalau sesi digeser lebih awal, sisa job harus hilang.
    expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
  });

  it('tidak menjadwalkan bila tanggal atau jamnya kosong', async () => {
    await syncSessionReminders(row({ startTime: null }), JAUH_SEBELUM);

    expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('syncSessionReminders — sesi yang bukan BOOKED', () => {
  for (const status of [SESSION_STATUS.PENDING, SESSION_STATUS.CANCELLED, SESSION_STATUS.CHECK_IN, SESSION_STATUS.CHECK_OUT] as const) {
    it(`membatalkan dan tidak menjadwalkan apa pun untuk ${status}`, async () => {
      await syncSessionReminders(row({ status }), JAUH_SEBELUM);

      expect(jobsClient.jobs.enqueue).not.toHaveBeenCalled();
      expect(jobsClient.jobs.cancel).toHaveBeenCalledTimes(2);
    });
  }

  it('membatalkan dengan args yang sama persis dengan yang dipakai saat enqueue', async () => {
    await syncSessionReminders(row({ status: SESSION_STATUS.CANCELLED }), JAUH_SEBELUM);

    const args = jobsClient.jobs.cancel.mock.calls.map((c) => c[0].args);
    expect(args).toEqual([
      { sessionId: 7, channel: 'email_24h' },
      { sessionId: 7, channel: 'email_1h' },
    ]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/unit/session/reminder-schedule.test.ts`
Expected: FAIL dengan "Cannot find module '@/services/session/reminder-schedule'"

- [ ] **Step 3: Tulis implementasinya**

```typescript
// src/services/session/reminder-schedule.ts
/**
 * Menjadwalkan dan membatalkan job pengingat sesi.
 *
 * Satu-satunya modul yang menyentuh `@/lib/jobs`. Menerima `SessionRow` dan memutuskan
 * sendiri dari `row.status`, jadi kedua titik hook di `session.service.ts` memanggil
 * fungsi yang sama tanpa bercabang: BOOKED menjadwalkan, apa pun selain itu membatalkan.
 *
 * Tidak ada tabel state. Idempotensi datang dari selalu membatalkan sebelum menjadwalkan
 * — `as_unschedule_all_actions` di sisi WordPress membuang semua action yang cocok, jadi
 * menyetujui sesi dua kali tidak menghasilkan pengingat kembar. Model `AppointmentReminder`
 * sengaja tidak dipakai: foreign key-nya menunjuk tabel shadow yang antre dihapus.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { jobs } from '@/lib/jobs/client';
import { buildUtcDateTime, timeToMinutes } from '@/lib/time';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';
import type { ReminderOffset } from './reminder-email';

export const REMINDER_HOOK = 'praktiqu_session_send_reminder' as const;

export const REMINDER_OFFSETS: readonly ReminderOffset[] = ['email_24h', 'email_1h'];

const LEAD_MS: Record<ReminderOffset, number> = {
  email_24h: 24 * 60 * 60_000,
  email_1h: 60 * 60_000,
};

/**
 * Args untuk hook pengingat.
 *
 * ⚠️ **Urutan kuncinya adalah kontraknya, bukan namanya.** Action Scheduler
 * mengeksekusi action dengan `do_action_ref_array($hook, array_values($args))`
 * (`ActionScheduler_Action.php:86`), jadi `array_values()` membuang kunci dan handler
 * PHP-nya menerima nilainya secara posisional:
 *
 *     handle_session_send_reminder(int $session_id, string $channel = 'email')
 *
 * Menukar urutan kunci di sini akan menukar argumen di sisi WordPress, dan tidak ada
 * yang akan gagal sampai produksi. Ada test yang memaku urutan ini — jangan dilonggarkan.
 */
export function reminderArgs(
  sessionId: number,
  channel: ReminderOffset,
): { sessionId: number; channel: ReminderOffset } {
  return { sessionId, channel };
}

/** Jam mulai sesi dalam UTC, atau null bila tanggal/jamnya tidak lengkap. */
export function sessionStartsAtUtc(row: SessionRow): Date | null {
  if (!row.slotDate || !row.startTime) return null;
  return buildUtcDateTime(row.slotDate, timeToMinutes(row.startTime), row.timezone);
}

/**
 * Selaraskan job pengingat dengan keadaan sesi saat ini.
 *
 * Selalu membatalkan lebih dulu, lalu menjadwalkan ulang hanya bila sesinya BOOKED dan
 * waktunya masih di depan. `now` disuntikkan supaya test bisa memindahkan waktu.
 */
export async function syncSessionReminders(row: SessionRow, now: Date = new Date()): Promise<void> {
  for (const channel of REMINDER_OFFSETS) {
    await jobs.cancel({ hook: REMINDER_HOOK, args: reminderArgs(row.id, channel) });
  }

  if (row.status !== SESSION_STATUS.BOOKED) return;

  const startsAt = sessionStartsAtUtc(row);
  if (!startsAt) return;

  for (const channel of REMINDER_OFFSETS) {
    const runAt = new Date(startsAt.getTime() - LEAD_MS[channel]);
    if (runAt.getTime() <= now.getTime()) continue;
    await jobs.enqueue({ hook: REMINDER_HOOK, runAt, args: reminderArgs(row.id, channel) });
  }
}
```

- [ ] **Step 4: Jalankan test dan type-check**

Run: `npx vitest run tests/unit/session/reminder-schedule.test.ts`
Expected: PASS (11 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add src/services/session/reminder-schedule.ts tests/unit/session/reminder-schedule.test.ts
git commit -m "feat(sessions): jadwalkan dan batalkan job pengingat

Menerima SessionRow dan memutuskan dari statusnya, jadi kedua titik hook
memanggil fungsi yang sama. Idempoten tanpa tabel: selalu cancel sebelum
enqueue. Urutan kunci args dipaku test karena array_values() di sisi PHP
membuang kuncinya."
```

---

### Task 4: Handler webhook dan pendaftarannya

Handler pertama yang pernah didaftarkan di aplikasi ini — `registerJobHandler` sudah ada sejak awal tapi belum pernah dipanggil, jadi map dispatcher-nya kosong dan setiap callback job jatuh ke cabang "No handler registered" lalu dibalas 200.

Pemanggilan `registerJobHandler` berada di lingkup modul. Task 5 yang membuat modul ini benar-benar terimpor.

**Files:**
- Create: `src/services/session/reminder-handler.ts`
- Test: `tests/unit/session/reminder-handler.test.ts`

**Interfaces:**
- Consumes: `findSessionById`, `SESSION_STATUS` dari `@/repositories/wp/sessions.repo`; `sendEmail` dari `@/lib/email`; `logging` dari `@/lib/logging`; `registerJobHandler` dari `@/lib/jobs/webhook-handler`; `buildSessionReminderEmail`, tipe `ReminderOffset` dari `./reminder-email`; `sessionStartsAtUtc`, `REMINDER_OFFSETS` dari `./reminder-schedule`.
- Produces: `handleSessionReminder(data: Record<string, unknown>, now?: Date): Promise<void>`, dan efek samping pendaftaran `registerJobHandler('session.reminder', …)` saat modul dimuat.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// tests/unit/session/reminder-handler.test.ts
/**
 * Handler webhook pengingat sesi.
 *
 * Handler ini berjalan sebagai job latar: tidak ada manusia yang menunggu jawabannya,
 * jadi ia tidak boleh melempar. Setiap penolakan dicatat lalu selesai dengan tenang.
 *
 * Guard-nya bukan hiasan: pembatalan job di sisi WordPress adalah best-effort (komentar
 * plugin-nya sendiri mengakui itu), dan WP-Cron menyala telat. Jadi handler harus
 * menganggap sesi bisa saja sudah dibatalkan atau sudah lewat saat webhook tiba.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const repo = { findSessionById: vi.fn() };
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const email = { sendEmail: vi.fn() };
vi.mock('@/lib/email', () => email);

const log = { logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() } };
vi.mock('@/lib/logging', () => log);

vi.mock('@/lib/jobs/webhook-handler', () => ({ registerJobHandler: vi.fn() }));

import { handleSessionReminder } from '@/services/session/reminder-handler';

const STARTS_AT = new Date('2026-09-10T02:30:00Z');
const SEBELUM = new Date('2026-09-09T00:00:00Z');

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
    slotDate: '2026-09-10',
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  repo.findSessionById.mockReset();
  email.sendEmail.mockReset().mockResolvedValue({ ok: true, messageId: 'm1' });
  log.logging.audit.mockReset();
  log.logging.warn.mockReset();
});

describe('handleSessionReminder — jalur normal', () => {
  it('mengirim ke klien dan profesional', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    const tujuan = email.sendEmail.mock.calls.map((c) => c[0].to);
    expect(tujuan).toEqual(['ada@contoh.test', 'pamela@klinik.test']);
  });

  it('menandai emailnya sebagai session_reminder untuk penyambungan template nanti', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_1h' }, SEBELUM);

    for (const call of email.sendEmail.mock.calls) {
      expect(call[0].template).toBe('session_reminder');
    }
  });

  it('mencatat siapa yang terkirim', async () => {
    repo.findSessionById.mockResolvedValue(row());

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.reminder.sent',
      expect.objectContaining({
        resourceId: '7',
        metadata: expect.objectContaining({ channel: 'email_24h', sent: ['client', 'professional'] }),
      }),
    );
  });
});

describe('handleSessionReminder — penerima tanpa email', () => {
  it('tetap mengirim ke profesional saat klien tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ clientEmail: '' }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('pamela@klinik.test');
  });

  it('tetap mengirim ke klien saat profesional tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ professionalEmail: '' }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('ada@contoh.test');
  });

  it('tidak melempar saat keduanya tidak punya email', async () => {
    repo.findSessionById.mockResolvedValue(row({ clientEmail: '', professionalEmail: '' }));

    await expect(
      handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM),
    ).resolves.toBeUndefined();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

describe('handleSessionReminder — guard', () => {
  it('tidak mengirim apa pun untuk sesi yang tidak ada', async () => {
    repo.findSessionById.mockResolvedValue(null);

    await handleSessionReminder({ sessionId: 999, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tidak mengirim apa pun untuk sesi yang sudah dibatalkan', async () => {
    // Pembatalan job adalah best-effort, jadi job untuk sesi yang dibatalkan bisa
    // tetap menyala. Guard inilah yang menahannya, bukan pembatalan job.
    repo.findSessionById.mockResolvedValue(row({ status: SESSION_STATUS.CANCELLED }));

    await handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tidak mengirim apa pun bila sesinya sudah dimulai — tanpa masa tenggang', async () => {
    repo.findSessionById.mockResolvedValue(row());
    const setelahMulai = new Date(STARTS_AT.getTime() + 60_000);

    await handleSessionReminder({ sessionId: 7, channel: 'email_1h' }, setelahMulai);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('menolak channel yang tidak dikenal tanpa menyentuh database', async () => {
    await handleSessionReminder({ sessionId: 7, channel: 'sms' }, SEBELUM);

    expect(repo.findSessionById).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('menolak sessionId yang tidak masuk akal tanpa menyentuh database', async () => {
    for (const buruk of [undefined, null, 'abc', 0, -1, 1.5]) {
      await handleSessionReminder({ sessionId: buruk, channel: 'email_24h' }, SEBELUM);
    }

    expect(repo.findSessionById).not.toHaveBeenCalled();
  });
});

describe('handleSessionReminder — kegagalan kirim', () => {
  it('tidak melempar saat sendEmail membalas ok:false', async () => {
    repo.findSessionById.mockResolvedValue(row());
    email.sendEmail.mockResolvedValue({ ok: false, error: 'smtp 550' });

    await expect(
      handleSessionReminder({ sessionId: 7, channel: 'email_24h' }, SEBELUM),
    ).resolves.toBeUndefined();

    expect(log.logging.audit).toHaveBeenCalledWith(
      'session.reminder.sent',
      expect.objectContaining({ metadata: expect.objectContaining({ sent: [] }) }),
    );
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/unit/session/reminder-handler.test.ts`
Expected: FAIL dengan "Cannot find module '@/services/session/reminder-handler'"

- [ ] **Step 3: Tulis implementasinya**

```typescript
// src/services/session/reminder-handler.ts
/**
 * Penerima webhook `session.reminder` dari WordPress Action Scheduler.
 *
 * Ini handler job pertama yang pernah didaftarkan di aplikasi ini. `registerJobHandler`
 * sudah ada di `lib/jobs/webhook-handler.ts` sejak awal tapi belum pernah dipanggil,
 * jadi map dispatcher-nya kosong dan setiap callback jatuh ke cabang "No handler
 * registered" lalu dibalas 200 — WordPress dikabari berhasil dan tidak pernah retry.
 *
 * Handler ini berjalan sebagai job latar. Tidak ada manusia yang menunggu jawabannya,
 * jadi ia **tidak boleh melempar**: setiap penolakan dicatat lalu selesai dengan tenang.
 * `processWebhook` memang menelan error handler, tapi mengandalkan itu berarti kegagalan
 * jadi tak terlihat.
 *
 * Guard-nya bukan hiasan. Pembatalan job di sisi WordPress adalah best-effort — komentar
 * di `class-praktiqu-endpoint-jobs.php:90-96` mengakuinya — dan WP-Cron menyala telat.
 * Jadi sesi bisa saja sudah dibatalkan, atau sudah dimulai, saat webhook-nya tiba.
 *
 * Source of truth: docs/superpowers/specs/2026-09-08-session-reminders-design.md
 */
import { findSessionById, SESSION_STATUS } from '@/repositories/wp/sessions.repo';
import { sendEmail } from '@/lib/email';
import { logging } from '@/lib/logging';
import { registerJobHandler } from '@/lib/jobs/webhook-handler';
import {
  buildSessionReminderEmail,
  type ReminderOffset,
  type ReminderRecipient,
} from './reminder-email';
import { REMINDER_OFFSETS, sessionStartsAtUtc } from './reminder-schedule';

export const REMINDER_EVENT = 'session.reminder' as const;

function isOffset(value: unknown): value is ReminderOffset {
  return typeof value === 'string' && (REMINDER_OFFSETS as readonly string[]).includes(value);
}

function isSessionId(value: unknown): value is number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0;
}

export async function handleSessionReminder(
  data: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  const channel = data.channel;
  if (!isOffset(channel)) {
    await logging.warn('session.reminder: channel tidak dikenal', { metadata: { data } });
    return;
  }
  if (!isSessionId(data.sessionId)) {
    await logging.warn('session.reminder: sessionId tidak valid', { metadata: { data } });
    return;
  }
  const sessionId = Number(data.sessionId);

  const row = await findSessionById(sessionId);
  if (!row) {
    await logging.warn('session.reminder: sesi tidak ditemukan', { metadata: { sessionId } });
    return;
  }

  if (row.status !== SESSION_STATUS.BOOKED) {
    await logging.audit('session.reminder.skipped', {
      resource: 'session',
      resourceId: String(sessionId),
      metadata: { channel, reason: 'status', status: row.status },
    });
    return;
  }

  const startsAt = sessionStartsAtUtc(row);
  if (!startsAt || startsAt.getTime() <= now.getTime()) {
    await logging.audit('session.reminder.skipped', {
      resource: 'session',
      resourceId: String(sessionId),
      metadata: { channel, reason: startsAt ? 'sudah_dimulai' : 'jadwal_tidak_lengkap' },
    });
    return;
  }

  const targets: { recipient: ReminderRecipient; to: string }[] = [
    { recipient: 'client', to: row.clientEmail },
    { recipient: 'professional', to: row.professionalEmail },
  ];

  const sent: ReminderRecipient[] = [];
  const skipped: ReminderRecipient[] = [];

  for (const target of targets) {
    if (!target.to) {
      skipped.push(target.recipient);
      continue;
    }
    const mail = buildSessionReminderEmail({
      offset: channel,
      recipient: target.recipient,
      clientName: row.clientName,
      professionalName: row.professionalName,
      startsAtUtc: startsAt,
      timezone: row.timezone,
    });
    // sendEmail tidak pernah melempar — ia membalas { ok: false } dan sudah mencatat
    // kegagalannya lewat audit.emailDeliveryFailed.
    const res = await sendEmail({
      to: target.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      template: 'session_reminder',
    });
    (res.ok ? sent : skipped).push(target.recipient);
  }

  await logging.audit('session.reminder.sent', {
    resource: 'session',
    resourceId: String(sessionId),
    metadata: { channel, sent, skipped },
  });
}

// Efek samping saat modul dimuat. Route webhook mengimpor modul ini justru untuk ini —
// lihat komentar di src/app/api/v1/webhooks/wordpress-jobs/route.ts.
registerJobHandler(REMINDER_EVENT, (data) => handleSessionReminder(data));
```

- [ ] **Step 4: Jalankan test dan type-check**

Run: `npx vitest run tests/unit/session/reminder-handler.test.ts`
Expected: PASS (12 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add src/services/session/reminder-handler.ts tests/unit/session/reminder-handler.test.ts
git commit -m "feat(sessions): handler webhook pengingat sesi

Handler job pertama yang pernah didaftarkan — registerJobHandler ada sejak
awal tapi belum pernah dipanggil, jadi setiap callback dibalas 200 tanpa
dikerjakan. Berjalan sebagai job latar, jadi tidak pernah melempar: setiap
penolakan dicatat lalu selesai."
```

---

### Task 5: Sambungkan pendaftaran ke route webhook

Route handler Next.js adalah modul per-request. `registerJobHandler` yang dipanggil di modul yang tidak pernah diimpor route itu tidak akan pernah jalan, jadi impor di task ini **satu-satunya** yang membuat handler terdaftar.

Test-nya sengaja masuk lewat `processWebhook`, bukan memeriksa map handler-nya: itulah jalur yang benar-benar dipakai produksi, dan itu yang menangkap impor yang dihapus orang karena disangka tidak terpakai.

**Files:**
- Modify: `src/app/api/v1/webhooks/wordpress-jobs/route.ts`
- Test: `tests/unit/session/reminder-registration.test.ts`

**Interfaces:**
- Consumes: modul `@/services/session/reminder-handler` (demi efek samping), `processWebhook` dari `@/lib/jobs/webhook-handler`.
- Produces: tidak ada nilai baru.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// tests/unit/session/reminder-registration.test.ts
/**
 * Kalau tidak ada yang mengimpor `reminder-handler`, `registerJobHandler` tidak pernah
 * jalan dan webhook `session.reminder` jatuh ke cabang "No handler registered" — dibalas
 * 200, tidak dikerjakan, tidak di-retry WordPress. Diam total.
 *
 * Test ini masuk lewat `processWebhook`, jalur yang benar-benar dipakai produksi, dan
 * karena itu ia menangkap impor yang dihapus orang karena disangka tidak terpakai.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const SECRET = 'rahasia-webhook-untuk-test';
process.env.WORDPRESS_WEBHOOK_SECRET = SECRET;

const repo = { findSessionById: vi.fn() };
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const email = { sendEmail: vi.fn().mockResolvedValue({ ok: true }) };
vi.mock('@/lib/email', () => email);
vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));

function sessionRow(): SessionRow {
  // Jauh di masa depan supaya guard "sudah dimulai" tidak ikut menahannya.
  const tahunDepan = new Date().getUTCFullYear() + 1;
  return {
    id: 7,
    clinicId: 1,
    professionalId: 119,
    clientId: 522,
    professionalName: 'Pamela Dewi',
    clientName: 'Ada Lovelace',
    clientEmail: 'ada@contoh.test',
    professionalEmail: 'pamela@klinik.test',
    slotDate: `${tahunDepan}-09-10`,
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  repo.findSessionById.mockReset().mockResolvedValue(sessionRow());
  email.sendEmail.mockClear();
});

describe('pendaftaran handler session.reminder', () => {
  it('mengimpor modul route membuat webhook session.reminder benar-benar dikerjakan', async () => {
    // Impor route-nya, persis seperti Next.js melakukannya saat request masuk.
    await import('@/app/api/v1/webhooks/wordpress-jobs/route');
    const { processWebhook } = await import('@/lib/jobs/webhook-handler');

    const body = JSON.stringify({ event: 'session.reminder', data: { sessionId: 7, channel: 'email_24h' } });
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');

    const handled = await processWebhook(body, signature);

    expect(handled).toBe(true);
    expect(repo.findSessionById).toHaveBeenCalledWith(7);
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/unit/session/reminder-registration.test.ts`
Expected: FAIL — `processWebhook` membalas `true` tapi `findSessionById` tidak pernah dipanggil, karena belum ada handler terdaftar.

Nama variabel lingkungan dan format digest-nya sudah diverifikasi: `webhook-handler.ts:17` membaca `process.env.WORDPRESS_WEBHOOK_SECRET`, dan tanda tangannya HMAC-SHA256 dalam **hex**. Keduanya sudah sesuai di test. Perhatikan bahwa `WEBHOOK_SECRET` dibaca saat modul dimuat, jadi penetapan `process.env` di test harus terjadi sebelum `await import(...)` — itu sebabnya kedua impor di test ini dinamis, bukan statis.

- [ ] **Step 3: Impor modul handler di route**

Di `src/app/api/v1/webhooks/wordpress-jobs/route.ts`, tambahkan impor tepat di bawah impor `processWebhook`:

```typescript
import { processWebhook } from '@/lib/jobs/webhook-handler';
// Diimpor demi efek sampingnya: modul ini memanggil registerJobHandler('session.reminder')
// di lingkup modul. Route handler Next.js adalah modul per-request, jadi impor inilah
// satu-satunya yang membuat handler terdaftar. JANGAN hapus sebagai "impor tak terpakai" —
// tests/unit/session/reminder-registration.test.ts menjaga ini.
import '@/services/session/reminder-handler';
```

- [ ] **Step 4: Jalankan test dan type-check**

Run: `npx vitest run tests/unit/session/reminder-registration.test.ts`
Expected: PASS (1 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

Kalau ESLint mengeluh soal impor tanpa binding, biarkan — impor efek samping memang bentuknya begitu, dan komentarnya sudah menjelaskan. Jangan menambahkan `eslint-disable` kecuali `npm run lint` benar-benar gagal.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/webhooks/wordpress-jobs/route.ts tests/unit/session/reminder-registration.test.ts
git commit -m "feat(jobs): daftarkan handler session.reminder di route webhook

Route handler Next.js adalah modul per-request, jadi impor efek samping ini
satu-satunya yang membuat handler terdaftar. Test masuk lewat processWebhook
supaya impor yang dihapus karena disangka tak terpakai langsung ketangkap."
```

---

### Task 6: Kail di `session.service.ts`

Dua pemanggilan. Keduanya di tempat yang sudah punya `SessionRow` segar, jadi tidak ada query tambahan.

`syncSessionReminders` memutuskan sendiri dari `row.status`, jadi kedua kail identik dan tidak bercabang: BOOKED menjadwalkan, apa pun selain itu membatalkan. Itu sekaligus menutup jalur booking tamu, yang lahir PENDING dan lewat `transitionSession` saat disetujui.

**Files:**
- Modify: `src/services/session/session.service.ts` (impor di bagian atas; kail di ekor `createSession` ~343-347 dan ekor `transitionSession` ~483-485)
- Test: `tests/unit/session/reminder-hooks.test.ts`

**Interfaces:**
- Consumes: `syncSessionReminders(row, now?)` dari `./reminder-schedule`.
- Produces: tidak ada nilai baru.

- [ ] **Step 1: Tulis test yang gagal**

```typescript
// tests/unit/session/reminder-hooks.test.ts
/**
 * Dua kail di session.service: setelah pembuatan, dan setelah transisi status.
 *
 * Yang dipaku di sini bukan logika penjadwalannya — itu sudah dipaku
 * tests/unit/session/reminder-schedule.test.ts — melainkan bahwa kailnya terpasang dan
 * bahwa yang diserahkan adalah baris **hasil baca ulang**. Kalau yang diserahkan baris
 * sebelum perubahan, statusnya masih PENDING dan persetujuan tidak akan pernah
 * menjadwalkan apa pun. Bug seperti itu tidak akan terlihat sampai produksi.
 *
 * `transitionSession` memanggil, berurutan: resolveKcActor, findSessionById (lewat
 * loadForActor), setAppointmentStatus, logging.audit, lalu findSessionById lagi untuk
 * baca ulang. Kelimanya dimock, jadi test ini jalan tanpa database.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SESSION_STATUS, type SessionRow } from '@/repositories/wp/sessions.repo';

const schedule = { syncSessionReminders: vi.fn().mockResolvedValue(undefined) };
vi.mock('@/services/session/reminder-schedule', () => schedule);

const repo = { findSessionById: vi.fn() };
vi.mock('@/repositories/wp/sessions.repo', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, findSessionById: (...a: unknown[]) => repo.findSessionById(...a) };
});

const writes = {
  setAppointmentStatus: vi.fn().mockResolvedValue(undefined),
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
};
vi.mock('@/repositories/wp/appointments.write', () => writes);

const kcActor = { resolveKcActor: vi.fn() };
vi.mock('@/services/billing/kc-actor', () => kcActor);

vi.mock('@/lib/logging', () => ({
  logging: { audit: vi.fn(), warn: vi.fn(), error: vi.fn(), activity: vi.fn(), system: vi.fn() },
}));

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
    slotDate: '2026-09-10',
    startTime: '09:30',
    endTime: '10:30',
    timezone: 'Asia/Jakarta',
    status: SESSION_STATUS.BOOKED,
    serviceIds: [3],
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
}

// SUPER_ADMIN lolos assertCanRead tanpa pemeriksaan cakupan, dan lolos gerbang
// "Not authorized to approve" — jadi test ini menguji kailnya, bukan RBAC-nya.
const ACTOR = { id: 'wpu_1', role: 'SUPER_ADMIN', practiceId: null };

beforeEach(() => {
  schedule.syncSessionReminders.mockClear();
  repo.findSessionById.mockReset();
  writes.setAppointmentStatus.mockClear();
  kcActor.resolveKcActor.mockReset().mockResolvedValue({ actor: ACTOR, wpUserId: 1n, clinicId: 1n });
});

describe('kail di transitionSession', () => {
  it('menyerahkan baris hasil baca ulang, bukan baris sebelum perubahan', async () => {
    const sebelum = row({ status: SESSION_STATUS.PENDING });
    const sesudah = row({ status: SESSION_STATUS.BOOKED });
    repo.findSessionById
      .mockResolvedValueOnce(sebelum)  // loadForActor
      .mockResolvedValueOnce(sesudah); // baca ulang setelah tulis

    const { transitionSession } = await import('@/services/session/session.service');
    await transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.BOOKED });

    expect(schedule.syncSessionReminders).toHaveBeenCalledTimes(1);
    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(sesudah);
  });

  it('memanggil kail juga saat sesi dibatalkan, supaya job sisanya dibuang', async () => {
    const sebelum = row({ status: SESSION_STATUS.BOOKED });
    const sesudah = row({ status: SESSION_STATUS.CANCELLED });
    repo.findSessionById.mockResolvedValueOnce(sebelum).mockResolvedValueOnce(sesudah);

    const { transitionSession } = await import('@/services/session/session.service');
    await transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.CANCELLED });

    expect(schedule.syncSessionReminders).toHaveBeenCalledWith(sesudah);
  });

  it('tidak memanggil kail saat transisinya ditolak', async () => {
    // CANCELLED tidak punya transisi keluar — VALID_TRANSITIONS.CANCELLED kosong.
    repo.findSessionById.mockResolvedValueOnce(row({ status: SESSION_STATUS.CANCELLED }));

    const { transitionSession } = await import('@/services/session/session.service');
    await expect(
      transitionSession({ actor: ACTOR as never, sessionId: 7, target: SESSION_STATUS.BOOKED }),
    ).rejects.toThrow(/Cannot transition/);

    expect(schedule.syncSessionReminders).not.toHaveBeenCalled();
  });
});
```

Kail di `createSession` sengaja tidak diuji di sini: fungsi itu juga memanggil pencarian pasien, dokter, layanan, hari libur, dan bentrokan jadwal, jadi memocknya menghasilkan test yang lebih banyak mengurus perancah daripada perilaku. Cakupannya datang dari `tests/complete-in-progress/sessions.test.ts` yang berbasis database, yang jalan begitu MySQL tersedia. Kalau kail `createSession` sampai hilang, test itulah yang menangkapnya.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/unit/session/reminder-hooks.test.ts`
Expected: FAIL. Ketiga test gagal karena `session.service.ts` belum memanggil `syncSessionReminders` — dua yang pertama pada `toHaveBeenCalledTimes(1)`/`toHaveBeenCalledWith`, dan yang ketiga lulus secara kebetulan. Kalau yang ketiga lulus sementara dua lainnya gagal, itu memang yang diharapkan pada tahap ini.

- [ ] **Step 3: Tambahkan impornya**

Di `src/services/session/session.service.ts`, di antara impor lain yang relatif:

```typescript
import { syncSessionReminders } from './reminder-schedule';
```

- [ ] **Step 4: Pasang kail di `createSession`**

Di ekor `createSession`, setelah guard `readback_failed` dan sebelum `return toSession(row)`:

```typescript
  const row = await findSessionById(created.id);
  if (!row) {
    throw new SessionServiceError(
      'readback_failed',
      'Session was created but could not be read back',
      502,
    );
  }

  // Staf membuat sesi langsung BOOKED; klien membuatnya PENDING. syncSessionReminders
  // memutuskan dari row.status, jadi kail ini tidak perlu tahu bedanya.
  await syncSessionReminders(row);

  return toSession(row);
```

- [ ] **Step 5: Pasang kail di `transitionSession`**

Di ekor `transitionSession`, setelah guard `not_found` dan sebelum `return toSession(updated)`:

```typescript
  const updated = await findSessionById(sessionId);
  if (!updated) throw new SessionServiceError('not_found', 'Session not found', 404);

  // Persetujuan menjadwalkan, pembatalan membersihkan. Booking tamu lahir PENDING dan
  // lewat sini saat disetujui, jadi ia tidak butuh kail sendiri.
  await syncSessionReminders(updated);

  return toSession(updated);
```

- [ ] **Step 6: Jalankan test dan type-check**

Run: `npx vitest run tests/unit/session/reminder-hooks.test.ts`
Expected: PASS (1 test)

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 7: Jalankan seluruh suite**

Run: `npm test`
Expected: jumlah lulus naik sebanyak test baru di plan ini. Kegagalan yang tersisa **harus** hanya `PrismaClientInitializationError` — itu berkas test yang butuh MySQL dan tidak bisa jalan di sini. Kalau ada kegagalan dengan sebab lain, perbaiki sebelum commit.

- [ ] **Step 8: Commit**

```bash
git add src/services/session/session.service.ts tests/unit/session/reminder-hooks.test.ts
git commit -m "feat(sessions): jadwalkan pengingat saat sesi jadi BOOKED

Dua kail, keduanya di tempat yang sudah punya SessionRow segar, jadi tanpa
query tambahan. syncSessionReminders memutuskan dari statusnya, jadi kedua
kail identik dan booking tamu ikut tertutup lewat jalur persetujuan."
```

---


### Task 7: Pengirim webhook jobs di plugin

Plugin punya pengirim bertanda tangan yang bekerja (`Hooks::dispatch_webhook`), tapi payload-nya datar dan tujuannya untuk event user. Task ini menambah pengirim khusus jobs yang menghasilkan `{ event, data }` — bentuk yang `processWebhook` di Next.js baca — dengan opsi URL dan rahasia sendiri.

Bagian yang murni (`build_body`, `sign`) dipisah dari yang menyentuh WordPress (`send`), supaya keduanya bisa diuji di container PHP tanpa WordPress. Itu pola yang sudah ditetapkan `Money` dan alasannya sama.

**Files:**
- Create: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs-webhook.php`
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php` (dua `register_setting` baru di dekat baris 43-53, dua baris form di tabel webhook)
- Test: `Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-webhook.php`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `PraktiQU\Endpoint\Jobs_Webhook` dengan `URL_OPTION`, `SECRET_OPTION`, `build_body(string $event, array $data): string|false`, `sign(string $body, string $secret): string`, dan `send(string $event, array $data): void`. Task 8 memanggil `send`.

- [ ] **Step 1: Tulis test yang gagal**

```php
<?php
/**
 * Assertions for Jobs_Webhook::build_body() and ::sign(). Plain PHP — no PHPUnit, no
 * WordPress — so it runs in a bare `php:8.3-cli` container, same as tests/test-money.php.
 *
 * What matters here is the wire contract with Next.js:
 *   - the body MUST be { event, data }, because processWebhook() reads payload.event and
 *     then calls handler(payload.data). A flat payload hands the handler undefined.
 *   - the signature MUST be HMAC-SHA256 hex over the raw body, because
 *     verifyWebhookSignature() in src/lib/jobs/webhook-handler.ts computes exactly that
 *     and compares with timingSafeEqual.
 */

declare(strict_types=1);

define('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST', true);
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-jobs-webhook.php';

use PraktiQU\Endpoint\Jobs_Webhook;

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

echo "Jobs_Webhook::build_body\n";

$body = Jobs_Webhook::build_body('session.reminder', ['sessionId' => 7, 'channel' => 'email_24h']);
check('nests the payload under data', $body, '{"event":"session.reminder","data":{"sessionId":7,"channel":"email_24h"}}');

$decoded = json_decode((string) $body, true);
check('event is top level', $decoded['event'], 'session.reminder');
check('sessionId lives under data', $decoded['data']['sessionId'], 7);
check('channel lives under data', $decoded['data']['channel'], 'email_24h');
check('no stray top-level keys', array_keys($decoded), ['event', 'data']);

$empty = Jobs_Webhook::build_body('session.reminder', []);
check('empty data still nests as an object', $empty, '{"event":"session.reminder","data":{}}');

echo "Jobs_Webhook::sign\n";

$secret = 'rahasia-webhook';
$sig = Jobs_Webhook::sign('{"a":1}', $secret);
check('hmac sha256 hex over the raw body', $sig, hash_hmac('sha256', '{"a":1}', $secret));
check('hex is 64 chars', strlen($sig), 64);
check('empty secret yields an empty signature', Jobs_Webhook::sign('{"a":1}', ''), '');
check('signature covers the body, not just the event', Jobs_Webhook::sign('{"a":2}', $secret) !== $sig, true);

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run, from the repo root:

```bash
cd Wordpress-Plugin/praktiqu-endpoint && docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli php tests/test-jobs-webhook.php
```

Expected: PHP fatal error — `Failed opening required '.../class-praktiqu-endpoint-jobs-webhook.php'`. The class does not exist yet.

- [ ] **Step 3: Tulis kelasnya**

```php
<?php
/**
 * Jobs_Webhook — mengirim callback penyelesaian job dari Action Scheduler ke Next.js.
 *
 * Terpisah dari `Hooks::dispatch_webhook` dengan sengaja, karena keduanya bicara dalam
 * dua kontrak berbeda. `dispatch_webhook` mengirim event user dengan payload DATAR
 * (`{event, wpUserId, issuedAt, source, ...}`). Penerima job di Next.js
 * (`src/app/api/v1/webhooks/wordpress-jobs/route.ts` -> `processWebhook`) membaca
 * `payload.event` lalu memanggil `handler(payload.data)`, jadi ia butuh `data` bersarang.
 * Memakai ulang pengirim yang datar akan menyerahkan `undefined` ke handler.
 *
 * URL dan rahasianya juga milik sendiri, bukan berbagi dengan event user: merotasi
 * rahasia event user tidak boleh mematikan callback job tanpa suara.
 *
 * `build_body()` dan `sign()` sengaja bebas dari WordPress supaya kontrak kabelnya bisa
 * diuji di container PHP kosong (tests/test-jobs-webhook.php) alih-alih hanya lewat
 * Action Scheduler yang hidup — pola yang sama, dan alasan yang sama, seperti Money.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

// Harness test mendefinisikan PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST supaya berkas ini bisa
// di-require di luar WordPress. Di luar itu, tanpa ABSPATH tetap berhenti.
defined('ABSPATH') || defined('PRAKTIQU_ENDPOINT_JOBS_WEBHOOK_TEST') || exit;

final class Jobs_Webhook
{
    public const URL_OPTION    = 'praktiqu_endpoint_jobs_webhook_url';
    public const SECRET_OPTION = 'praktiqu_endpoint_jobs_webhook_secret';

    /**
     * Bentuk body yang dibaca `processWebhook` di Next.js: `{ event, data }`.
     *
     * Memakai `json_encode`, bukan `wp_json_encode`, supaya fungsi ini bisa diuji tanpa
     * WordPress. Body-nya kita susun sendiri dari nilai skalar, jadi tidak ada yang
     * dibutuhkan dari pembungkus WordPress-nya.
     *
     * `data` di-cast ke object supaya array kosong terbit sebagai `{}`, bukan `[]` —
     * `handler(payload.data)` di sisi Next.js mengharapkan objek.
     */
    public static function build_body(string $event, array $data): string|false
    {
        return json_encode([
            'event' => $event,
            'data'  => (object) $data,
        ]);
    }

    /**
     * HMAC-SHA256 hex atas body mentah — persis yang dihitung `verifyWebhookSignature()`
     * di `src/lib/jobs/webhook-handler.ts` sebelum membandingkannya dengan timingSafeEqual.
     *
     * Rahasia kosong menghasilkan tanda tangan kosong, meniru `dispatch_webhook`. Sisi
     * Next.js menolak permintaan tanpa tanda tangan saat rahasianya terpasang.
     */
    public static function sign(string $body, string $secret): string
    {
        return $secret !== '' ? hash_hmac('sha256', $body, $secret) : '';
    }

    /**
     * Kirim satu callback. Fire-and-forget: kegagalan jaringan tidak boleh menjatuhkan
     * eksekusi action, dan Action Scheduler tidak punya siapa pun untuk dikabari.
     */
    public function send(string $event, array $data): void
    {
        $url = (string) get_option(self::URL_OPTION, '');
        if ($url === '') {
            return; // Belum dikonfigurasi; no-op tanpa suara, sama seperti dispatch_webhook.
        }

        $body = self::build_body($event, $data);
        if ($body === false) {
            return;
        }

        $secret = (string) get_option(self::SECRET_OPTION, '');

        $response = wp_remote_post($url, [
            'method'      => 'POST',
            'timeout'     => 5,
            'redirection' => 0,
            'headers'     => [
                'Content-Type'                 => 'application/json',
                'X-PraktiQU-Webhook-Event'     => $event,
                'X-PraktiQU-Webhook-Signature' => self::sign($body, $secret),
            ],
            'body'     => $body,
            'blocking' => false,
        ]);

        if (is_wp_error($response)) {
            error_log('[praktiqu-endpoint] jobs webhook failed: ' . $response->get_error_message());
        }
    }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `cd Wordpress-Plugin/praktiqu-endpoint && docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli php tests/test-jobs-webhook.php`
Expected: `ALL PASS`, 11 baris `ok`.

- [ ] **Step 5: Daftarkan dua opsi baru di halaman pengaturan**

Di `class-praktiqu-endpoint-settings.php`, tepat setelah `register_setting` untuk `praktiqu_endpoint_payment_webhook_url` (sekitar baris 53), tambahkan dua pendaftaran yang meniru bentuk tetangganya persis — baca dulu argumen `register_setting` yang sudah ada dan tiru `type`, `sanitize_callback`, dan `default`-nya:

```php
        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_jobs_webhook_url', [
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ]);

        register_setting(self::OPTION_GROUP, 'praktiqu_endpoint_jobs_webhook_secret', [
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ]);
```

Lalu tambahkan dua baris form di tabel webhook yang sudah ada, mengikuti markup baris `praktiqu_endpoint_webhook_url` (sekitar baris 270-280) — `<tr>`, `<th>` dengan `<label for>`, `<td>` dengan `<input>`. Label: "Jobs Webhook URL" dan "Jobs Webhook Secret". Teks bantu untuk URL-nya harus menyebut nilai yang benar: `https://<app>/api/v1/webhooks/wordpress-jobs`. Teks bantu untuk rahasianya harus menyebut bahwa ia wajib sama dengan env `WORDPRESS_WEBHOOK_SECRET` di aplikasi Next.js.

- [ ] **Step 6: Lint seluruh plugin**

Run: `cd Wordpress-Plugin/praktiqu-endpoint && docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli sh -c 'for f in praktiqu-endpoint.php includes/*.php; do php -l "$f" || exit 1; done'`
Expected: `No syntax errors detected` untuk setiap berkas.

- [ ] **Step 7: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs-webhook.php \
        Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-settings.php \
        Wordpress-Plugin/praktiqu-endpoint/tests/test-jobs-webhook.php
git commit -m "feat(plugin): pengirim webhook jobs dengan payload {event,data}

Hooks::dispatch_webhook mengirim payload datar untuk event user, sementara
processWebhook di Next.js memanggil handler(payload.data) dan butuh data
bersarang. URL dan rahasianya milik sendiri supaya rotasi rahasia event user
tidak mematikan callback job tanpa suara.

build_body dan sign bebas WordPress, jadi kontrak kabelnya diuji di container
PHP kosong seperti Money."
```

---

### Task 8: Sambungkan handler job ke pengirim itu

`Jobs::handle_session_send_reminder` dan `handle_session_auto_complete` memanggil `$this->service->send_webhook(...)`, tapi `Service` tidak punya method itu — sepuluh methodnya semua soal autentikasi dan user. Grep di seluruh `Wordpress-Plugin/` menemukan `send_webhook` hanya di dua tempat pemanggilan itu. Jadi setiap job yang menyala melempar fatal "Call to undefined method", Action Scheduler menandainya gagal, dan tidak ada webhook yang pernah terkirim. Task ini yang menutupnya.

**Files:**
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php` (properti + konstruktor sekitar baris 35-41; dua pemanggilan di `:111` dan `:124`)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php` (baris 43, tempat `Jobs` disusun)
- Modify: `Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php` (blok `require_once`, baris 25-39; dan header `Version:` di baris 6)

**Interfaces:**
- Consumes: `Jobs_Webhook::send(string $event, array $data): void` dari Task 7.
- Produces: tidak ada nilai baru.

- [ ] **Step 1: Buktikan dulu bahwa methodnya memang tidak ada**

Ini bukan test, ini verifikasi premis — jalankan dan tempelkan hasilnya ke laporanmu:

```bash
grep -rn "send_webhook" Wordpress-Plugin/praktiqu-endpoint/
grep -nE "(public|private|protected) function" Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-service.php
```

Expected: `send_webhook` muncul hanya di dua pemanggilan di `class-praktiqu-endpoint-jobs.php`, dan daftar method `Service` tidak memuatnya. Kalau ternyata ADA, berhenti dan laporkan — premis task ini salah.

- [ ] **Step 2: Tambahkan require untuk kelas baru**

Di `praktiqu-endpoint.php`, tepat setelah baris `require_once` untuk `class-praktiqu-endpoint-jobs.php`:

```php
require_once PRAKTIQU_ENDPOINT_PATH . 'includes/class-praktiqu-endpoint-jobs-webhook.php';
```

- [ ] **Step 3: Suntikkan pengirimnya ke `Jobs`**

Di `class-praktiqu-endpoint-jobs.php`, tambahkan properti di sebelah `private Service $service;`:

```php
    private Jobs_Webhook $jobs_webhook;
```

lalu perluas konstruktornya. Bentuk sekarang adalah `__construct(Service $service, Payments $payments)`; tambahkan parameter ketiga dan simpan:

```php
    public function __construct(Service $service, Payments $payments, Jobs_Webhook $jobs_webhook)
    {
        $this->service      = $service;
        $this->payments     = $payments;
        $this->jobs_webhook = $jobs_webhook;
    }
```

Pertahankan penugasan `$this->service` dan `$this->payments` yang sudah ada apa adanya — `Service` masih dipakai di tempat lain di kelas ini.

- [ ] **Step 4: Ganti kedua pemanggilan method hantu itu**

Di `handle_session_send_reminder` (sekitar baris 124):

```php
    public function handle_session_send_reminder(int $session_id, string $channel = 'email'): void
    {
        $this->jobs_webhook->send('session.reminder', [
            'sessionId' => $session_id,
            'channel'   => $channel,
        ]);
    }
```

Dan di `handle_session_auto_complete` (sekitar baris 111) — patah dengan cara yang sama, dan hanya tidak terlihat karena tidak ada yang menjadwalkannya:

```php
    public function handle_session_auto_complete(int $session_id): void
    {
        $this->jobs_webhook->send('session.auto_complete', [
            'sessionId' => $session_id,
        ]);
    }
```

- [ ] **Step 5: Sambungkan di `Plugin`**

Di `class-praktiqu-endpoint-plugin.php` baris 43, `Jobs` disusun sebagai `new Jobs($this->service, $this->payments)`. Tambahkan argumen ketiga:

```php
        $this->jobs     = new Jobs($this->service, $this->payments, new Jobs_Webhook());
```

- [ ] **Step 6: Naikkan versi plugin**

Di `praktiqu-endpoint.php` baris 6, `Version: 1.6.5` menjadi `Version: 1.6.6`. Kalau ada konstanta versi kedua di berkas itu, naikkan juga — cari `1.6.5` di seluruh berkas plugin dan naikkan setiap kemunculan yang menyatakan versi plugin.

- [ ] **Step 7: Lint dan jalankan kedua harness PHP**

Run: `cd Wordpress-Plugin/praktiqu-endpoint && docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli sh -c 'for f in praktiqu-endpoint.php includes/*.php; do php -l "$f" || exit 1; done; php tests/test-money.php; php tests/test-jobs-webhook.php'`
Expected: tidak ada syntax error, dan kedua harness `ALL PASS`.

- [ ] **Step 8: Pastikan tidak ada sisa pemanggilan hantu**

Run: `grep -rn "send_webhook" Wordpress-Plugin/praktiqu-endpoint/includes/`
Expected: hanya `dispatch_webhook` milik `Hooks` yang muncul. Tidak ada lagi `service->send_webhook`.

- [ ] **Step 9: Commit**

```bash
git add Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-jobs.php \
        Wordpress-Plugin/praktiqu-endpoint/includes/class-praktiqu-endpoint-plugin.php \
        Wordpress-Plugin/praktiqu-endpoint/praktiqu-endpoint.php
git commit -m "fix(plugin): handler job memanggil method yang tidak pernah ada

Jobs memanggil Service::send_webhook() untuk session.reminder dan
session.auto_complete, tapi Service tidak punya method itu — sepuluh methodnya
semua soal auth/user, dan grep menemukan send_webhook hanya di dua tempat
pemanggilan itu. Jadi setiap job yang menyala melempar fatal, Action Scheduler
menandainya gagal, dan tidak ada webhook yang pernah terkirim sejak hook-hook
itu ditulis. Terverifikasi juga pada plugin yang terpasang di server.

Versi 1.6.6."
```

---

### Task 9: Runbook deploy dan verifikasi ujung-ke-ujung

Semuanya sampai titik ini diuji per bagian. Task ini yang membuktikan rantainya utuh — dan urutan deploy-nya penting, karena aplikasi dan plugin harus bergerak dalam urutan yang tidak meninggalkan jendela rusak.

**Files:**
- Create: `docs/deploy/session-reminders-runbook.md`

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: tidak ada kode.

- [ ] **Step 1: Tulis runbook-nya**

Harus memuat, dengan perintah nyata dan bukan garis besar:

1. **Urutan deploy, dan alasannya.** Plugin lebih dulu, aplikasi kemudian. Alasan: plugin 1.6.6 mengirim `session.reminder` hanya kalau opsi URL-nya terisi, jadi memasangnya lebih dulu tidak mengirim apa pun ke aplikasi lama. Sebaliknya, memasang aplikasi lebih dulu berarti aplikasi mulai menjadwalkan job yang, saat menyala, memanggil method hantu di plugin 1.6.5 dan tercatat gagal di Action Scheduler.
2. **Dua opsi yang harus diisi manual** di WP Admin setelah plugin ter-deploy: Jobs Webhook URL = `https://staging2.praktiqu.com/api/v1/webhooks/wordpress-jobs`, dan Jobs Webhook Secret = nilai env `WORDPRESS_WEBHOOK_SECRET` pada proses Next.js. Sertakan perintah untuk membaca nilai itu dari proses yang berjalan, karena `.env` di server tidak bisa dipercaya:

```bash
ssh -p 45022 praktiqu@101.50.1.106 'PID=$(pgrep -u praktiqu -f staging2.praktiqu.com | head -1); tr "\0" "\n" < /proc/$PID/environ | grep "^WORDPRESS_WEBHOOK_SECRET="'
```

3. **Verifikasi job benar-benar terjadwal.** Jadwalkan satu sesi lalu periksa tabel Action Scheduler:

```sql
SELECT action_id, hook, status, scheduled_date_gmt, args
  FROM wp_actionscheduler_actions
 WHERE hook = 'praktiqu_session_send_reminder'
 ORDER BY action_id DESC LIMIT 5;
```

Harapan: dua baris `pending`, satu 24 jam sebelum jam mulai sesi dan satu 1 jam sebelumnya, dengan `args` memuat `sessionId` dan `channel`. **Kalau nol baris**, `jobs.enqueue` diam-diam tidak melakukan apa pun — periksa `WORDPRESS_SERVICE_TOKEN` pada proses Next.js, karena tanpa itu ia `return` tanpa suara.

4. **Verifikasi urutan args tiba benar di sisi PHP.** Inilah satu-satunya cara membuktikan `$session_id` menerima id dan bukan channel. Jadwalkan job dengan `runAt` beberapa menit ke depan, tunggu menyala, lalu periksa `wp_actionscheduler_logs` untuk `action_id` itu dan log aplikasi untuk baris audit `session.reminder.sent`.

5. **Rollback.** Turunkan aplikasi lebih dulu, lalu plugin. Sebelum rollback, kosongkan opsi Jobs Webhook URL supaya plugin 1.6.5 tidak dipanggil dengan job yang masih tertunda. Perintah untuk membatalkan job yang tersisa:

```sql
UPDATE wp_actionscheduler_actions
   SET status = 'canceled'
 WHERE hook IN ('praktiqu_session_send_reminder', 'praktiqu_session_auto_complete')
   AND status = 'pending';
```

- [ ] **Step 2: Jalankan gerbang hijau terakhir**

Ketiganya harus lulus, dan tempelkan keluarannya ke laporanmu:

```bash
npm test
npx tsc --noEmit
cd Wordpress-Plugin/praktiqu-endpoint && docker run --rm -v "$(pwd)":/p -w /p php:8.3-cli sh -c 'for f in praktiqu-endpoint.php includes/*.php; do php -l "$f" || exit 1; done; php tests/test-money.php; php tests/test-jobs-webhook.php'
```

Expected: `npm test` lulus penuh tanpa satu pun kegagalan — baseline sebelum plan ini adalah 154 berkas / 1522 test, jadi hitungannya harus itu ditambah test baru dari plan ini. `tsc` bersih. Lint bersih dan kedua harness PHP `ALL PASS`.

**Jangan deploy, jangan SSH untuk mengubah apa pun, jangan sentuh opsi WP.** Task ini menulis runbook-nya dan membuktikan pohon kerjanya hijau; eksekusinya keputusan manusia.

- [ ] **Step 3: Commit**

```bash
git add docs/deploy/session-reminders-runbook.md
git commit -m "docs(deploy): runbook pengingat sesi

Plugin lebih dulu, aplikasi kemudian: plugin 1.6.6 diam sampai opsi URL-nya
diisi, sedangkan urutan sebaliknya membuat aplikasi menjadwalkan job yang
memanggil method hantu di 1.6.5 dan tercatat gagal.

Memuat dua verifikasi yang tidak bisa dilakukan di luar staging: bahwa job
benar-benar sampai ke Action Scheduler, dan bahwa urutan args tiba benar di
sisi PHP."
```

---

## Selesai bila

- Sesi yang dibuat staf (BOOKED) menjadwalkan dua job; sesi klien dan tamu (PENDING) tidak, sampai disetujui.
- Menyetujui sesi PENDING menjadwalkan dua job; membatalkan sesi membuang keduanya.
- Webhook `session.reminder` mengirim dua email berbahasa Indonesia — klien dan profesional — dan mencatatnya di `LogEntry`.
- Sesi yang sudah dibatalkan atau sudah dimulai tidak menghasilkan email, meski job-nya tetap menyala.
- `npx tsc --noEmit` bersih, dan `npm test` lulus **penuh** — nol kegagalan, karena baselinenya hijau.
- Lint PHP bersih dan kedua harness plugin `ALL PASS`.
- `Jobs` tidak lagi memanggil method yang tidak ada, dan `session.auto_complete` ikut hidup.
- Tanpa tabel baru, tanpa perubahan skema database.

## Verifikasi yang tidak bisa dilakukan di lingkungan ini

Menyusut jauh sejak amandemen: MySQL dan PHP keduanya tersedia sekarang, jadi hanya dua hal yang benar-benar butuh staging. Keduanya masuk runbook Task 9 dan harus dicatat di ledger — jangan diam-diam dianggap beres.

1. **Job benar-benar sampai ke Action Scheduler.** `jobs.enqueue` diam-diam `return` tanpa `WORDPRESS_SERVICE_TOKEN`. Token itu terpasang di proses staging, tapi hanya baris nyata di `wp_actionscheduler_actions` yang membuktikan rantainya sambung.
2. **Urutan args tiba benar di sisi PHP.** Test kita memaku urutan kunci di sisi kita, dan Task 7 memaku bentuk payload di sisi plugin, tapi hanya eksekusi nyata yang membuktikan `$session_id` menerima id dan bukan channel — terutama karena `jobs.enqueue` menempelkan `webhookToken` sebagai kunci ketiga dan `add_action(..., 10, 2)` yang membuangnya.
