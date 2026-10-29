# Approval Psikolog dari Tautan Email — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Psikolog bisa menyetujui atau menolak satu booking yang menunggu langsung dari tautan di email, tanpa login.

**Architecture:** Backend menandatangani token HMAC per booking + psikolog (`src/lib/public/approval-token.ts`) dan menaruh tautannya di email psikolog. Tiga endpoint publik baru (`/api/v1/public/approvals/{token}`) memvalidasi token terhadap keadaan booking saat itu lalu memanggil fungsi keputusan yang sama dengan dashboard (`approveAwaiting` / `rejectAwaiting`) atas nama akun psikolog. FE Laravel menyediakan halaman publik `/persetujuan/t/{token}`: GET hanya menampilkan, keputusan selalu lewat POST.

**Tech Stack:** Next.js 14 route handlers + Prisma (MySQL = DB WordPress), vitest; Laravel 11 + Blade, PHPUnit dengan `Http::fake`.

**Spec:** `docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md` (e0dadc8). Fitur dasarnya: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`.

## Global Constraints

- **Tidak ada** perubahan skema Prisma, SQL produksi, atau plugin WordPress. Jangan pernah `prisma db push` / `prisma migrate` (DATABASE_URL adalah DB WordPress).
- Badan token: `{"p":"approval","a":<appointmentId>,"d":<doctorWpUserId>,"i":<issuedAt epoch ms>}` → base64url, lalu `.` dan HMAC-SHA256 (dengan `AUTH_SECRET`) atas string base64url itu. Tidak ada kedaluwarsa di dalam token.
- Tautan: `{APP_PUBLIC_URL}/persetujuan/t/{token}` dan `{APP_PUBLIC_URL}/persetujuan/t/{token}?aksi=tolak`. `APP_PUBLIC_URL` dibaca lewat `getPublicAppUrl()`.
- Endpoint: `GET /api/v1/public/approvals/{token}`, `POST /api/v1/public/approvals/{token}/approve`, `POST /api/v1/public/approvals/{token}/reject` dengan badan `{ "reason": string }` 1–500 karakter setelah trim. Semua sukses → `200 { data: PublicApprovalLinkView }`.
- `PublicApprovalLinkView` persis: `clientName, professionalName, serviceName, slotDate, startTime, timezone, amount ({ value, currency: 'IDR'|'USD' } | null), state, decidedByName, decidedAt, isOverdue, canApprove, canReject`. **Tidak boleh** memuat id internal, email, telepon, alasan penolakan, data refund, atau nomor order.
- Kode error: tautan tidak berlaku → **404 `approval_link_invalid`** (token rusak, sesi tidak ada, catatan approval tidak ada, psikolog sesi bukan psikolog di token — semuanya dijawab sama); sudah diputuskan → **409 `approval_already_decided`**; setujui setelah sesi mulai → **422 `session_already_started`**; alasan tidak sah → 422 validasi; kunci laju → **429 `rate_limited`**; akun psikolog tidak cocok → **500 `approval_actor_missing`**.
- GET tidak pernah memutuskan apa pun.
- Keputusan lewat tautan memakai `approveAwaiting` / `rejectAwaiting` yang sudah ada, aktor = akun psikolog, audit `session.approval_decided` dengan metadata tambahan `via: 'email_link'`.
- Teks email (HTML): `<p><a href="{actionLink}">Setujui jadwal</a> · <a href="{actionLink}?aksi=tolak">Tolak permintaan</a></p>` dan `<p>Tautan ini khusus untuk Anda, jangan diteruskan. Berlaku sampai booking diputuskan atau sesi dimulai.</p>`; tautan dashboard berlabel **"Buka di dashboard"**. Email eskalasi admin dan email klien tidak berubah.
- Halaman FE: header `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, plus `<meta name="robots" content="noindex, nofollow">`. Token tidak boleh tertulis ke log FE.
- Pesan FE: setuju → "Jadwal disetujui. Klien menerima email konfirmasi dan pengingat sesi."; tolak → "Permintaan ditolak. Klien sudah diberi tahu, dan klinik akan mengembalikan dananya."; 409 → "Permintaan ini sudah diputuskan."; 422 sesi mulai → "Jam sesi sudah lewat — permintaan ini hanya bisa ditolak."; 404 → "Tautan ini tidak berlaku."; 429 → "Terlalu banyak percobaan. Coba lagi beberapa menit lagi."; 0/5xx → "Server sedang bermasalah, jadi belum jelas apakah keputusan tersimpan. Muat ulang halaman ini untuk melihat keadaan terbarunya."
- Urutan rilis: **FE dulu, baru backend**.
- Commit dalam bahasa Indonesia gaya conventional (`feat(approval): …`, `test(…): …`, `docs(…): …`), diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jangan push ke `main`; PR dibuka user dari tautan compare.
- Perintah vitest dijalankan lewat `rtk proxy npx vitest run …` (hook RTK menyaring keluaran `npx vitest` biasa).

## Peta file

**Backend** — worktree `/home/ahmad/projects/nextjs-appointment-praktiqu/.claude/worktrees/approval-tautan-email`, branch `feat/approval-tautan-email`:

| File | Tanggung jawab |
|---|---|
| `src/lib/public/approval-token.ts` (baru) | Tanda tangan dan verifikasi token tautan. Murni, tanpa DB. |
| `src/services/approval/emails.ts` | `buildProfessionalRequestEmail` mendapat `actionLink`. |
| `src/services/approval/service.ts` | `approvalActionLink()`, `DecideInput.via`, `reconcile` diekspor. |
| `src/services/approval/reminder-handler.ts` | Email pengingat membawa `actionLink`. |
| `src/services/approval/email-link.ts` (baru) | Validasi tautan, view publik, setujui/tolak lewat tautan. |
| `src/services/approval/email-link-http.ts` (baru) | Pembatas laju bersama + bungkus respons tiga route. |
| `src/app/api/v1/public/approvals/[token]/route.ts` (baru) | GET. |
| `src/app/api/v1/public/approvals/[token]/approve/route.ts` (baru) | POST setujui. |
| `src/app/api/v1/public/approvals/[token]/reject/route.ts` (baru) | POST tolak. |
| `tests/unit/lib/approval-token.test.ts` (baru) | Tes token. |
| `tests/unit/approval/emails.test.ts`, `service.test.ts`, `reminder-handler.test.ts` | Tes email. |
| `tests/helpers/id-blocks.ts` | Blok id untuk tes integrasi baru. |
| `tests/integration/approval/approval-email-link.test.ts` (baru) | Tiga route ujung ke ujung di DB uji. |
| `docs/api/APPROVAL-PSIKOLOG-GUIDE.md`, `docs/api/openapi.yaml`, `docs/deploy/approval-psikolog-runbook.md` | Dokumentasi. |

**FE** — repo `raakanaka/laravel-praktiqu`, worktree `/home/ahmad/projects/praktiqu-fe/approval-tautan-email`, branch `feat/approval-tautan-email` dari `origin/main`:

| File | Tanggung jawab |
|---|---|
| `app/Services/PraktiquApi.php` | Token tautan disamarkan di setiap baris log. |
| `app/Http/Controllers/PersetujuanTautanController.php` (baru) | Halaman tautan: tampil, setujui, tolak. |
| `resources/views/persetujuan-tautan.blade.php` (baru) | Tampilan halaman tautan. |
| `resources/views/layouts/base.blade.php` | Slot `@section('robots')` untuk meta robots. |
| `routes/web.php` | Tiga rute publik. |
| `tests/Feature/PraktiquApiLoggingTest.php`, `tests/Feature/PersetujuanTautanTest.php` (baru) | Tes. |

---

## Bagian B — Backend

### Task B1: Token tautan persetujuan

**Files:**
- Create: `src/lib/public/approval-token.ts`
- Test: `tests/unit/lib/approval-token.test.ts`

**Interfaces:**
- Produces: `signApprovalToken(payload: ApprovalTokenPayload, opts?: { issuedAt?: number }): string`, `verifyApprovalToken(token: string): ApprovalTokenPayload | null`, `interface ApprovalTokenPayload { appointmentId: number; doctorWpUserId: number }`.

- [ ] **Step 1: Tulis tes yang gagal**

`tests/unit/lib/approval-token.test.ts`:

```ts
/**
 * The token in the psychologist's "approve / reject" email link (spec 2026-10-29 §5).
 * It names one booking and its psychologist; anyone holding it may decide that booking
 * while it waits, so it must be tamper-proof and must not pass as any other token.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signApprovalToken, verifyApprovalToken } from '@/lib/public/approval-token';
import { signAppointmentToken, verifyAppointmentToken } from '@/lib/public/appointment-token';
import { signOAuthState, verifyOAuthState } from '@/lib/google/oauth-state';

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const PAYLOAD = { appointmentId: 7, doctorWpUserId: 34 };

/** A token with any body, correctly signed — to prove the checks after the signature. */
function signed(body: unknown): string {
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
}

describe('signApprovalToken / verifyApprovalToken', () => {
  it('round-trips the payload', () => {
    expect(verifyApprovalToken(signApprovalToken(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('has no expiry: a token issued a year ago still verifies', () => {
    const old = signApprovalToken(PAYLOAD, { issuedAt: Date.now() - 365 * 24 * 3_600_000 });
    expect(verifyApprovalToken(old)).toEqual(PAYLOAD);
  });

  it('gives each email its own token', () => {
    expect(signApprovalToken(PAYLOAD, { issuedAt: 1 })).not.toBe(signApprovalToken(PAYLOAD, { issuedAt: 2 }));
  });

  it('rejects a tampered body', () => {
    const [body, sig] = signApprovalToken(PAYLOAD).split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.a = 8;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    expect(verifyApprovalToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const [body] = signApprovalToken(PAYLOAD).split('.');
    expect(verifyApprovalToken(`${body}.${'A'.repeat(43)}`)).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const t of ['', 'nope', 'a.b.c', '.x', 'x.']) expect(verifyApprovalToken(t)).toBeNull();
  });

  it('rejects a correctly signed body with another purpose', () => {
    expect(verifyApprovalToken(signed({ p: 'oauth', a: 7, d: 34, i: 1 }))).toBeNull();
    expect(verifyApprovalToken(signed({ a: 7, d: 34, i: 1 }))).toBeNull();
  });

  it('rejects ids that are not positive safe integers', () => {
    for (const a of [0, -1, 1.5, '7', null]) {
      expect(verifyApprovalToken(signed({ p: 'approval', a, d: 34, i: 1 }))).toBeNull();
    }
    expect(verifyApprovalToken(signed({ p: 'approval', a: 7, d: 0, i: 1 }))).toBeNull();
  });

  it('rejects a signed body that is not a JSON object', () => {
    expect(verifyApprovalToken(signed(null))).toBeNull();
    expect(verifyApprovalToken(signed('approval'))).toBeNull();
  });

  it('does not pass as an appointment token or a Google state, nor they as it', () => {
    const token = signApprovalToken(PAYLOAD);
    expect(verifyAppointmentToken(token)).toBeNull();
    expect(verifyOAuthState(token)).toBeNull();

    expect(verifyApprovalToken(signAppointmentToken(7))).toBeNull();
    expect(verifyApprovalToken(signOAuthState({ professionalId: 34, returnUrl: 'https://contoh.test/' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `rtk proxy npx vitest run tests/unit/lib/approval-token.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/public/approval-token"`.

- [ ] **Step 3: Implementasi**

`src/lib/public/approval-token.ts`:

```ts
// The token in the psychologist's "approve / reject" email link
// (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md §5).
//
// Same idiom as src/lib/google/oauth-state.ts and appointment-token.ts — HMAC-SHA256
// over the base64url body, constant-time comparison — so the codebase keeps one way of
// signing. The `p` field separates purposes: oauth-state signs its body exactly the same
// way with the same secret, so without it one token could be replayed as the other.
//
// No expiry in the token. Whether a link still works is decided from the booking when it
// is used: still waiting, the session not started, the same psychologist.

import { createHmac, timingSafeEqual } from 'node:crypto';

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in production');
}

const SECRET = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
const PURPOSE = 'approval';

export interface ApprovalTokenPayload {
  appointmentId: number;
  doctorWpUserId: number;
}

interface TokenBody {
  /** Purpose. Always "approval". */
  p: string;
  /** wp_kc_appointments.id */
  a: number;
  /** The psychologist's wp_users.ID */
  d: number;
  /** Issued-at, epoch ms. Only makes each email's token different. */
  i: number;
}

const signature = (encoded: string): string => createHmac('sha256', SECRET).update(encoded).digest('base64url');
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function signApprovalToken(payload: ApprovalTokenPayload, opts: { issuedAt?: number } = {}): string {
  const body: TokenBody = {
    p: PURPOSE,
    a: payload.appointmentId,
    d: payload.doctorWpUserId,
    i: opts.issuedAt ?? Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyApprovalToken(token: string): ApprovalTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const a = Buffer.from(sig);
  const b = Buffer.from(signature(encoded));
  // Length first: timingSafeEqual throws on a mismatch, and a signature's length is no secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { p, a: appointmentId, d: doctorWpUserId } = body as Partial<TokenBody>;
  if (p !== PURPOSE || !isId(appointmentId) || !isId(doctorWpUserId)) return null;
  return { appointmentId, doctorWpUserId };
}
```

- [ ] **Step 4: Jalankan dan pastikan lolos**

Run: `rtk proxy npx vitest run tests/unit/lib/approval-token.test.ts`
Expected: PASS, 10 tes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/public/approval-token.ts tests/unit/lib/approval-token.test.ts
git commit -m "feat(approval): token bertanda tangan untuk tautan setujui/tolak di email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: Tautan setujui/tolak di email psikolog

**Files:**
- Modify: `src/services/approval/emails.ts` (`ProfessionalRequestInput`, `buildProfessionalRequestEmail`)
- Modify: `src/services/approval/service.ts` (tambah `approvalActionLink`, panggilan di `holdForApproval`)
- Modify: `src/services/approval/reminder-handler.ts` (import + panggilan builder)
- Test: `tests/unit/approval/emails.test.ts`, `tests/unit/approval/service.test.ts`, `tests/unit/approval/reminder-handler.test.ts`

**Interfaces:**
- Consumes: `signApprovalToken` (B1).
- Produces: `approvalActionLink(appointmentId: number, doctorWpUserId: number): string` di `service.ts`; `ProfessionalRequestInput.actionLink: string` (wajib).

- [ ] **Step 1: Ubah tes email**

Di `tests/unit/approval/emails.test.ts`, tambahkan konstanta di bawah `LINK`:

```ts
const ACTION = 'https://appointment.praktiqu.test/persetujuan/t/tok.sig';
```

Ganti seluruh blok `describe('buildProfessionalRequestEmail', …)` dengan:

```ts
describe('buildProfessionalRequestEmail', () => {
  it('first mail: new booking, the no-login links first, then the dashboard', () => {
    const m = buildProfessionalRequestEmail({ ...FACTS, link: LINK, actionLink: ACTION, waitingSince: null });
    expect(m.subject).toBe('Booking baru menunggu persetujuan Anda: Kamis, 22 Oktober 2026 pukul 10:00');
    expect(m.html).toContain(
      `<p><a href="${ACTION}">Setujui jadwal</a> · <a href="${ACTION}?aksi=tolak">Tolak permintaan</a></p>`,
    );
    expect(m.html).toContain(
      '<p>Tautan ini khusus untuk Anda, jangan diteruskan. Berlaku sampai booking diputuskan atau sesi dimulai.</p>',
    );
    expect(m.html).toContain(`<a href="${LINK}">Buka di dashboard</a>`);
    expect(m.html.indexOf('Setujui jadwal')).toBeLessThan(m.html.indexOf('Buka di dashboard'));
    expect(m.text).toContain(`Setujui jadwal: ${ACTION}`);
    expect(m.text).toContain(`Tolak permintaan: ${ACTION}?aksi=tolak`);
    expect(m.text).toContain('jangan diteruskan');
    expect(m.text).toContain(`Buka di dashboard: ${LINK}`);
    expect(m.text).toContain('sudah membayar sesi berikut');
  });

  it('reminder: names the client and how long it has waited, and carries the links too', () => {
    const m = buildProfessionalRequestEmail({
      ...FACTS,
      link: LINK,
      actionLink: ACTION,
      waitingSince: new Date('2026-10-20T02:00:00.000Z'),
    });
    expect(m.subject).toBe('Pengingat: booking Ada <b>Lovelace</b> masih menunggu persetujuan Anda');
    expect(m.text).toContain('sejak Selasa, 20 Oktober 2026 pukul 09:00');
    expect(m.html).toContain(`<a href="${ACTION}?aksi=tolak">Tolak permintaan</a>`);
  });
});
```

Di `describe('buildAdminEscalationEmail', …)`, tambahkan di akhir tes yang ada:

```ts
    expect(m.html).not.toContain('/persetujuan/t/');
    expect(m.html).toContain('Buka antrean persetujuan');
```

- [ ] **Step 2: Tambah asersi di tes service dan reminder**

Di `tests/unit/approval/service.test.ts`, tambahkan import di bagian import paling atas (setelah import vitest):

```ts
import { verifyApprovalToken } from '@/lib/public/approval-token';
```

Di tes `holdForApproval` yang memuat `expect((email.sendEmail.mock.calls[1][0] as { html: string }).html).toContain('https://appointment.praktiqu.test/dashboard/persetujuan/7');`, tambahkan tepat sesudahnya:

```ts
    const html = (email.sendEmail.mock.calls[1][0] as { html: string }).html;
    const found = html.match(/https:\/\/appointment\.praktiqu\.test\/persetujuan\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/);
    expect(found).not.toBeNull();
    expect(verifyApprovalToken(found![1])).toEqual({ appointmentId: 7, doctorWpUserId: 34 });
    expect(html).toContain(`/persetujuan/t/${found![1]}?aksi=tolak`);
```

Di `tests/unit/approval/reminder-handler.test.ts`, tambahkan import:

```ts
import { verifyApprovalToken } from '@/lib/public/approval-token';
```

dan tes baru di dalam `describe('handleApprovalReminder', …)`, setelah tes pertama:

```ts
  it('the reminder carries a no-login link for this booking and its psychologist', async () => {
    await handleApprovalReminder({ appointmentId: 7 }, at(24));

    const toPsychologist = email.sendEmail.mock.calls
      .map(([m]) => m as { to: string; html: string })
      .find((m) => m.to === 'dianda@klinik.test');
    const found = toPsychologist!.html.match(/\/persetujuan\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/);
    expect(found).not.toBeNull();
    expect(verifyApprovalToken(found![1])).toEqual({ appointmentId: 7, doctorWpUserId: 34 });

    const toAdmin = email.sendEmail.mock.calls
      .map(([m]) => m as { to: string; html: string })
      .find((m) => m.to === 'admin@klinik.test');
    expect(toAdmin!.html).not.toContain('/persetujuan/t/');
  });
```

- [ ] **Step 3: Jalankan dan pastikan gagal**

Run: `rtk proxy npx vitest run tests/unit/approval/emails.test.ts tests/unit/approval/service.test.ts tests/unit/approval/reminder-handler.test.ts`
Expected: FAIL — teks "Buka di dashboard" dan tautan `/persetujuan/t/` belum ada (`tsc` juga akan mengeluh soal `actionLink`).

- [ ] **Step 4: Implementasi**

`src/services/approval/emails.ts` — ganti `ProfessionalRequestInput` dan `buildProfessionalRequestEmail` dengan:

```ts
export interface ProfessionalRequestInput extends SessionMailFacts {
  /** The dashboard page for this request (login required). */
  link: string;
  /**
   * The no-login page for this request (spec 2026-10-29): `?aksi=tolak` opens it on the
   * reject form. Opening it decides nothing — the page needs a button press.
   */
  actionLink: string;
  /** Null for the first mail; when the booking was paid, for a reminder. */
  waitingSince: Date | null;
}

export function buildProfessionalRequestEmail(f: ProfessionalRequestInput): BuiltEmail {
  const r = rincian(f);
  const t = tautan(f.link, 'Buka di dashboard');
  const tolakLink = `${f.actionLink}?aksi=tolak`;
  const aksiHtml = `<p><a href="${escapeHtml(f.actionLink)}">Setujui jadwal</a> · <a href="${escapeHtml(tolakLink)}">Tolak permintaan</a></p>`;
  const aksiText = `Setujui jadwal: ${f.actionLink}\nTolak permintaan: ${tolakLink}`;
  const peringatan = 'Tautan ini khusus untuk Anda, jangan diteruskan. Berlaku sampai booking diputuskan atau sesi dimulai.';
  const { tanggal, jam } = formatWaktu(f.startsAtUtc, f.timezone);

  let subject: string;
  let pembukaHtml: string;
  let pembukaText: string;
  if (f.waitingSince === null) {
    subject = `Booking baru menunggu persetujuan Anda: ${tanggal} pukul ${jam}`;
    pembukaHtml = `${escapeHtml(f.clientName)} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
    pembukaText = `${f.clientName} sudah membayar sesi berikut dan menunggu persetujuan Anda.`;
  } else {
    const sejak = formatWaktu(f.waitingSince, f.timezone);
    subject = `Pengingat: booking ${f.clientName} masih menunggu persetujuan Anda`;
    pembukaHtml = `Booking dari ${escapeHtml(f.clientName)} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
    pembukaText = `Booking dari ${f.clientName} masih menunggu persetujuan Anda sejak ${sejak.tanggal} pukul ${sejak.jam}.`;
  }

  const penutup = 'Jadwal ini tetap terkunci sampai Anda menyetujui atau menolaknya. Klien baru menerima konfirmasi setelah Anda menyetujui.';
  const html = `<p>Halo ${escapeHtml(f.professionalName)},</p>
<p>${pembukaHtml}</p>
${r.html}
${aksiHtml}
<p>${peringatan}</p>
${t.html}
<p>${penutup}</p>`;
  const text = `Halo ${f.professionalName},

${pembukaText}

${r.text}

${aksiText}

${peringatan}

${t.text}

${penutup}`;
  return { subject, html, text };
}
```

`src/services/approval/service.ts` — tambahkan import di blok import:

```ts
import { signApprovalToken } from '@/lib/public/approval-token';
```

tambahkan tepat di bawah fungsi `approvalLink`:

```ts
/**
 * The no-login page for one request (spec 2026-10-29 §6.5), signed for the booking and the
 * psychologist it belongs to now. Each call signs a fresh token; any of them works until
 * the booking is decided or its session starts.
 */
export function approvalActionLink(appointmentId: number, doctorWpUserId: number): string {
  return `${getPublicAppUrl()}/persetujuan/t/${signApprovalToken({ appointmentId, doctorWpUserId })}`;
}
```

dan di `holdForApproval` ganti panggilan builder menjadi:

```ts
      buildProfessionalRequestEmail({
        ...facts,
        link: approvalLink(row.id),
        actionLink: approvalActionLink(row.id, row.professionalId),
        waitingSince: null,
      }),
```

`src/services/approval/reminder-handler.ts` — tambahkan `approvalActionLink,` ke daftar import dari `'./service'` (urut abjad, setelah `APPROVAL_REMINDER_EVENT,`), lalu ganti panggilan builder pengingat menjadi:

```ts
      buildProfessionalRequestEmail({
        ...facts,
        link,
        actionLink: approvalActionLink(appointmentId, row.professionalId),
        waitingSince: approval.requestedAt,
      }),
```

- [ ] **Step 5: Jalankan dan pastikan lolos, plus tsc**

Run: `rtk proxy npx vitest run tests/unit/approval/` lalu `rtk proxy npx tsc --noEmit -p .`
Expected: semua tes approval PASS; tsc 0 error.

- [ ] **Step 6: Commit**

```bash
git add src/services/approval/emails.ts src/services/approval/service.ts src/services/approval/reminder-handler.ts tests/unit/approval/emails.test.ts tests/unit/approval/service.test.ts tests/unit/approval/reminder-handler.test.ts
git commit -m "feat(approval): email psikolog membawa tautan setujui/tolak tanpa login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3: Endpoint publik tautan persetujuan

**Files:**
- Modify: `src/services/approval/service.ts` (`DecideInput.via`, `auditDecision`, `reconcile` diekspor)
- Create: `src/services/approval/email-link.ts`
- Create: `src/services/approval/email-link-http.ts`
- Create: `src/app/api/v1/public/approvals/[token]/route.ts`
- Create: `src/app/api/v1/public/approvals/[token]/approve/route.ts`
- Create: `src/app/api/v1/public/approvals/[token]/reject/route.ts`
- Modify: `tests/helpers/id-blocks.ts`
- Test: `tests/integration/approval/approval-email-link.test.ts`

**Interfaces:**
- Consumes: `verifyApprovalToken`, `signApprovalToken` (B1); `approveAwaiting`, `rejectAwaiting`, `ApprovalError`, `serviceNameOf` dari `service.ts`; `ensureUserFromWordPress(email)` dari `src/services/auth/service.ts`.
- Produces: `linkView(token, now?)`, `approveByLink(token, now?)`, `rejectByLink(token, reason, now?)` → `Promise<PublicApprovalLinkView>`; `interface PublicApprovalLinkView`; `linkResponse(req, tag, run)`.

- [ ] **Step 1: Daftarkan blok id tes**

Di `tests/helpers/id-blocks.ts`, tambahkan baris tepat setelah baris `[8_970_000, 'complete-in-progress/sessions.test.ts', …]`:

```ts
  [8_980_000, 'integration/approval/approval-email-link.test.ts', 'session_approvals, payment_orders, kc_appointments, kc_doctor_clinic_mappings, kc_clinics, wp_users, wp_usermeta, users (approval-link-test-*)'],
```

- [ ] **Step 2: Tulis tes integrasi yang gagal**

`tests/integration/approval/approval-email-link.test.ts`:

```ts
/**
 * The no-login approval link end to end against the test database
 * (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md §6, §9).
 *
 * Same boundaries mocked as approval-routes.test.ts: the plugin write (setAppointmentStatus
 * writes the status straight into wp_kc_appointments, as the plugin's UPDATE would), jobs
 * and email. The tests run in order and build on each other's state.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { signApprovalToken } from '@/lib/public/approval-token';
import { APPOINTMENT_STATUS } from '@/repositories/wp/appointments.repo';
import { assertTestDb } from '../../billing/fixtures';
import { idBlock } from '../../helpers/id-blocks';

const writes = vi.hoisted(() => ({ setAppointmentStatus: vi.fn() }));
vi.mock('@/repositories/wp/appointments.write', async (orig) => ({
  ...(await orig<typeof import('@/repositories/wp/appointments.write')>()),
  setAppointmentStatus: (...a: unknown[]) => writes.setAppointmentStatus(...a),
}));

const jobsClient = vi.hoisted(() => ({ enqueue: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/jobs/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/jobs/client')>()),
  jobs: { enqueue: (...a: unknown[]) => jobsClient.enqueue(...a), cancel: (...a: unknown[]) => jobsClient.cancel(...a) },
}));

const email = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: (...a: unknown[]) => email.sendEmail(...a),
}));

import { GET as linkGet } from '@/app/api/v1/public/approvals/[token]/route';
import { POST as linkApprove } from '@/app/api/v1/public/approvals/[token]/approve/route';
import { POST as linkReject } from '@/app/api/v1/public/approvals/[token]/reject/route';
import { POST as staffApprove } from '@/app/api/v1/sessions/[id]/approve/route';

const { BASE, END } = idBlock('integration/approval/approval-email-link.test.ts');
const CLINIC = BASE + 1;
const DOCTOR = BASE + 20;
const OTHER_DOCTOR = BASE + 21;
const PATIENT = BASE + 30;
const APPT_APPROVE = BASE + 100; // waiting, paid by order → approved through the link
const APPT_REJECT = BASE + 101; // waiting → rejected through the link
const APPT_DONE = BASE + 102; // already approved in the dashboard
const APPT_PAST = BASE + 103; // waiting, its session was a year ago
const APPT_MOVED = BASE + 104; // held for DOCTOR, the appointment now belongs to OTHER_DOCTOR
const APPT_RACE = BASE + 105; // two clicks on the link at the same moment
const APPT_RACE2 = BASE + 107; // link and dashboard approve at the same moment
const APPT_NONE = BASE + 106; // PENDING, never held for approval
const WC_ORDER = BASE + 500;

const PSI = 'approval-link-test-psi';
const FUTURE = `${new Date().getUTCFullYear() + 1}-03-10`;
const PAST = `${new Date().getUTCFullYear() - 1}-03-10`;
const inRange = { gte: BigInt(BASE), lt: BigInt(END) };
const caps = (role: string) => `a:1:{s:${role.length}:"${role}";b:1;}`;
const wpEmail = (id: number) => `u${id}@approval-link.test.local`;
const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-secret-change-me');

const linkFor = (appointmentId: number, doctorWpUserId = DOCTOR) => signApprovalToken({ appointmentId, doctorWpUserId });
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

function getReq(token: string, ip = '198.51.100.7') {
  return new NextRequest(`http://localhost/api/v1/public/approvals/${token}`, { headers: { 'x-forwarded-for': ip } });
}
function postReq(token: string, action: 'approve' | 'reject', body?: unknown, ip = '198.51.100.7') {
  return new NextRequest(`http://localhost/api/v1/public/approvals/${token}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}
async function staffReq(id: number) {
  const jwt = await new SignJWT({ role: 'PROFESSIONAL' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(PSI)
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
  return new NextRequest(`http://localhost/api/v1/sessions/${id}/approve`, {
    method: 'POST',
    body: '{}',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
  });
}

async function wpUser(id: number, role: string, first: string) {
  await prisma.kcUser.create({
    data: { id: BigInt(id), userLogin: `u${id}`, userEmail: wpEmail(id), displayName: `${first} Uji`, userRegistered: new Date() },
  });
  await prisma.kcUserMeta.createMany({
    data: [
      { userId: BigInt(id), metaKey: 'wp_capabilities', metaValue: caps(role) },
      { userId: BigInt(id), metaKey: 'first_name', metaValue: first },
      { userId: BigInt(id), metaKey: 'last_name', metaValue: 'Uji' },
      { userId: BigInt(id), metaKey: 'praktiqu_professional_status', metaValue: 'ACTIVE' },
    ],
  });
}

async function appointment(id: number, doctor: number, status: number, date: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_appointments
       (id, clinic_id, doctor_id, patient_id, appointment_start_date, appointment_start_time,
        appointment_end_date, appointment_end_time, appointment_timezone, visit_type,
        description, status, created_at)
     VALUES (?, ?, ?, ?, ?, '10:00:00', ?, '11:00:00', 'Asia/Jakarta', '', '', ?, NOW())`,
    id,
    CLINIC,
    doctor,
    PATIENT,
    date,
    date,
    status,
  );
}

const statusOf = async (id: number) =>
  Number(
    (await prisma.$queryRawUnsafe<Array<{ status: number }>>('SELECT status FROM wp_kc_appointments WHERE id = ?', id))[0]
      .status,
  );

async function wipe() {
  const ids = [APPT_APPROVE, APPT_REJECT, APPT_DONE, APPT_PAST, APPT_MOVED, APPT_RACE, APPT_RACE2, APPT_NONE].map(String);
  await prisma.logEntry.deleteMany({ where: { resourceId: { in: ids } } });
  await prisma.sessionApproval.deleteMany({ where: { appointmentId: inRange } });
  await prisma.paymentOrder.deleteMany({ where: { wcOrderId: { gte: BASE, lt: END } } });
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_appointments WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_doctor_clinic_mappings WHERE doctor_id >= ? AND doctor_id < ?`, BASE, END);
  await prisma.$executeRawUnsafe(`DELETE FROM wp_kc_clinics WHERE id >= ? AND id < ?`, BASE, END);
  await prisma.kcUserMeta.deleteMany({ where: { userId: inRange } });
  await prisma.kcUser.deleteMany({ where: { id: inRange } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { startsWith: 'approval-link-test-' } }, { wpUserId: inRange }] } });
}

beforeAll(async () => {
  assertTestDb();
  await wipe();

  await prisma.$executeRawUnsafe(
    `INSERT INTO wp_kc_clinics (id, name, email, telephone_no, address, city, status, clinic_admin_id, clinic_logo, created_at)
     VALUES (?, 'Klinik Tautan', 'klinik@approval-link.test.local', '0221234567', 'Jl. Uji 1', 'Bandung', 1, 0, 0, NOW())`,
    CLINIC,
  );
  await wpUser(DOCTOR, 'kiviCare_doctor', 'Dianda');
  await wpUser(OTHER_DOCTOR, 'kiviCare_doctor', 'Pamela');
  await wpUser(PATIENT, 'kiviCare_patient', 'Klien');
  for (const [mapId, doctor] of [[BASE + 900, DOCTOR], [BASE + 901, OTHER_DOCTOR]] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO wp_kc_doctor_clinic_mappings (id, doctor_id, clinic_id, owner, created_at) VALUES (?, ?, ?, 0, NOW())`,
      mapId,
      doctor,
      CLINIC,
    );
  }
  // Same address as the WordPress account: ensureUserFromWordPress finds this row.
  await prisma.user.create({
    data: {
      id: PSI,
      email: wpEmail(DOCTOR),
      username: PSI,
      firstName: 'Dianda',
      lastName: 'Uji',
      displayName: 'Dianda',
      role: 'PROFESSIONAL',
      wpUserId: BigInt(DOCTOR),
      status: 1,
    },
  });

  for (const id of [APPT_APPROVE, APPT_REJECT, APPT_RACE, APPT_RACE2, APPT_NONE]) {
    await appointment(id, DOCTOR, APPOINTMENT_STATUS.PENDING, FUTURE);
  }
  await appointment(APPT_DONE, DOCTOR, APPOINTMENT_STATUS.BOOKED, FUTURE);
  await appointment(APPT_PAST, DOCTOR, APPOINTMENT_STATUS.PENDING, PAST);
  await appointment(APPT_MOVED, OTHER_DOCTOR, APPOINTMENT_STATUS.PENDING, FUTURE);

  const order = await prisma.paymentOrder.create({
    data: {
      source: 'public',
      appointmentId: String(APPT_APPROVE),
      wcOrderId: WC_ORDER,
      expectedAmount: 350000,
      status: 'paid',
      gateway: 'xendit',
      chargedAmount: 350000,
      chargedCurrency: 'IDR',
      transactionId: 'tx-tautan',
    },
  });
  const waiting = (id: number, paymentOrderId: string | null = null) => ({
    appointmentId: BigInt(id),
    doctorWpUserId: BigInt(DOCTOR),
    clinicId: BigInt(CLINIC),
    paymentOrderId,
    state: 'AWAITING',
  });
  await prisma.sessionApproval.createMany({
    data: [
      waiting(APPT_APPROVE, order.id),
      waiting(APPT_REJECT),
      waiting(APPT_PAST),
      waiting(APPT_MOVED),
      waiting(APPT_RACE),
      waiting(APPT_RACE2),
      { ...waiting(APPT_DONE), state: 'APPROVED', decidedAt: new Date(), decidedBy: PSI },
    ],
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.setAppointmentStatus.mockImplementation(async (id: number, status: number) => {
    await prisma.$executeRawUnsafe('UPDATE wp_kc_appointments SET status = ? WHERE id = ?', status, id);
    return { id, status, cancelled: status === 0 };
  });
  jobsClient.enqueue.mockResolvedValue(true);
  jobsClient.cancel.mockResolvedValue(undefined);
  email.sendEmail.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  await wipe();
});

const VIEW_KEYS = [
  'amount', 'canApprove', 'canReject', 'clientName', 'decidedAt', 'decidedByName', 'isOverdue',
  'professionalName', 'serviceName', 'slotDate', 'startTime', 'state', 'timezone',
];

describe('GET /public/approvals/{token}', () => {
  it('shows a waiting booking with the buttons it may offer, and nothing else', async () => {
    const res = await linkGet(getReq(linkFor(APPT_APPROVE)), ctx(linkFor(APPT_APPROVE)));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(VIEW_KEYS);
    expect(data).toMatchObject({
      clientName: 'Klien Uji',
      professionalName: 'Dianda Uji',
      serviceName: 'Sesi',
      slotDate: FUTURE,
      startTime: '10:00:00',
      timezone: 'Asia/Jakarta',
      amount: { value: 350000, currency: 'IDR' },
      state: 'AWAITING',
      decidedByName: null,
      isOverdue: false,
      canApprove: true,
      canReject: true,
    });
  });

  it('a link that does not verify, or names a booking without a record, is 404 approval_link_invalid', async () => {
    for (const token of ['rusak', linkFor(APPT_NONE), linkFor(BASE + 999)]) {
      const res = await linkGet(getReq(token), ctx(token));
      expect(res.status).toBe(404);
      expect((await res.json()).title).toBe('approval_link_invalid');
    }
  });

  it('a booking now with another psychologist does not open for the old one', async () => {
    const res = await linkGet(getReq(linkFor(APPT_MOVED)), ctx(linkFor(APPT_MOVED)));
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe('approval_link_invalid');
  });

  it('a decided booking shows who decided and no buttons', async () => {
    const { data } = await (await linkGet(getReq(linkFor(APPT_DONE)), ctx(linkFor(APPT_DONE)))).json();
    expect(data).toMatchObject({ state: 'APPROVED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });
  });

  it('a session that has started may only be rejected', async () => {
    const { data } = await (await linkGet(getReq(linkFor(APPT_PAST)), ctx(linkFor(APPT_PAST)))).json();
    expect(data).toMatchObject({ state: 'AWAITING', isOverdue: true, canApprove: false, canReject: true });
  });
});

describe('POST /public/approvals/{token}/approve', () => {
  it('approves as the psychologist: BOOKED, recorded under their account, audited via email_link', async () => {
    const token = linkFor(APPT_APPROVE);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ state: 'APPROVED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });

    expect(await statusOf(APPT_APPROVE)).toBe(APPOINTMENT_STATUS.BOOKED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_APPROVE) } });
    expect(record?.decidedBy).toBe(PSI);

    const audit = await prisma.logEntry.findFirst({
      where: { resourceId: String(APPT_APPROVE), action: 'session.approval_decided' },
    });
    expect(audit?.metadata).toMatchObject({ decision: 'APPROVED', via: 'email_link', onBehalf: false });
  });

  it('the same link again: 409 approval_already_decided, nothing written', async () => {
    const token = linkFor(APPT_APPROVE);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(409);
    expect((await res.json()).title).toBe('approval_already_decided');
    expect(writes.setAppointmentStatus).not.toHaveBeenCalled();
  });

  it('a session that has started: 422 session_already_started', async () => {
    const token = linkFor(APPT_PAST);
    const res = await linkApprove(postReq(token, 'approve'), ctx(token));
    expect(res.status).toBe(422);
    expect((await res.json()).title).toBe('session_already_started');
    expect(await statusOf(APPT_PAST)).toBe(APPOINTMENT_STATUS.PENDING);
  });

  it('two clicks on the link at the same moment: exactly one decides, the other gets 409', async () => {
    const token = linkFor(APPT_RACE);
    const results = await Promise.all([
      linkApprove(postReq(token, 'approve'), ctx(token)),
      linkApprove(postReq(token, 'approve'), ctx(token)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(writes.setAppointmentStatus).toHaveBeenCalledTimes(1);
    expect(await statusOf(APPT_RACE)).toBe(APPOINTMENT_STATUS.BOOKED);
  });

  it('link and dashboard at the same moment: one decision recorded, BOOKED, nothing errors', async () => {
    const token = linkFor(APPT_RACE2);
    const [viaLink, viaDashboard] = await Promise.all([
      linkApprove(postReq(token, 'approve'), ctx(token)),
      staffApprove(await staffReq(APPT_RACE2), { params: Promise.resolve({ id: String(APPT_RACE2) }) }),
    ]);
    // The dashboard path that loses may answer 409 (claim lost), 400 (already BOOKED) or
    // 200 (it finished the winner's confirmation through completeApproval, which is
    // idempotent). Never a 5xx, and only one decision is ever recorded.
    for (const s of [viaLink.status, viaDashboard.status]) expect([200, 400, 409]).toContain(s);
    expect([viaLink.status, viaDashboard.status]).toContain(200);
    expect(await statusOf(APPT_RACE2)).toBe(APPOINTMENT_STATUS.BOOKED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_RACE2) } });
    expect(record).toMatchObject({ state: 'APPROVED', decidedBy: PSI });
    expect(
      await prisma.logEntry.count({ where: { resourceId: String(APPT_RACE2), action: 'session.approval_decided' } }),
    ).toBe(1);
  });
});

describe('POST /public/approvals/{token}/reject', () => {
  it('an empty or too long reason is 422 and changes nothing', async () => {
    const token = linkFor(APPT_REJECT);
    for (const reason of ['', '   ', 'x'.repeat(501)]) {
      const res = await linkReject(postReq(token, 'reject', { reason }), ctx(token));
      expect(res.status).toBe(422);
    }
    expect(await statusOf(APPT_REJECT)).toBe(APPOINTMENT_STATUS.PENDING);
  });

  it('rejects as the psychologist: CANCELLED, reason kept internal, client told', async () => {
    const token = linkFor(APPT_REJECT);
    const res = await linkReject(postReq(token, 'reject', { reason: '  Bentrok jadwal  ' }), ctx(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ state: 'REJECTED', decidedByName: 'Dianda Uji', canApprove: false, canReject: false });
    expect(JSON.stringify(body)).not.toContain('Bentrok jadwal');

    expect(await statusOf(APPT_REJECT)).toBe(APPOINTMENT_STATUS.CANCELLED);
    const record = await prisma.sessionApproval.findUnique({ where: { appointmentId: BigInt(APPT_REJECT) } });
    expect(record).toMatchObject({ state: 'REJECTED', rejectReason: 'Bentrok jadwal', refundStatus: 'NEEDED', decidedBy: PSI });
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: wpEmail(PATIENT), subject: 'Jadwal sesi Anda tidak dapat diterima' }),
    );
  });
});

describe('rate limit', () => {
  it('30 bad links from one address lock it out with 429 rate_limited', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 30; i++) {
      expect((await linkGet(getReq(`rusak-${i}`, ip), ctx(`rusak-${i}`))).status).toBe(404);
    }
    const res = await linkGet(getReq(linkFor(APPT_DONE), ip), ctx(linkFor(APPT_DONE)));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Jalankan dan pastikan gagal**

Run: `rtk proxy npx vitest run tests/integration/approval/approval-email-link.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/v1/public/approvals/[token]/route"`.

- [ ] **Step 4: Ubah `service.ts`: `via` di audit, `reconcile` diekspor**

Ganti `export interface DecideInput { … }` dengan:

```ts
export interface DecideInput {
  actor: Actor;
  /** The actor's wp_users.ID, which the caller resolved when it checked they may decide. */
  actorWpUserId: number;
  row: SessionRow;
  now?: Date;
  /** How the decision arrived when it was not the dashboard (spec 2026-10-29): the email link. */
  via?: 'email_link';
}
```

Ganti tanda tangan dan metadata `auditDecision`:

```ts
async function auditDecision(
  input: Pick<DecideInput, 'actor' | 'actorWpUserId' | 'row' | 'via'>,
  decision: 'APPROVED' | 'REJECTED',
  reason: string | null,
): Promise<void> {
  const { actor, row } = input;
  // By who decided, not by role: a psychologist who owns the clinic decides as its
  // CLINIC_ADMIN (owner mode), and deciding their own booking is not on anyone's behalf.
  const onBehalf = row.professionalId !== input.actorWpUserId;
  await logging.audit('session.approval_decided', {
    userId: actor.id,
    resource: 'session',
    resourceId: String(row.id),
    action: 'session.approval_decided',
    metadata: {
      decision,
      reason,
      onBehalf,
      professionalId: row.professionalId,
      ...(input.via ? { via: input.via } : {}),
    },
  });
```

(sisa fungsi — audit `session.status_changed` — tidak berubah.)

Ubah `async function reconcile(` menjadi `export async function reconcile(` dan tambahkan satu kalimat di akhir komentar dokumennya: `Exported for the email link (email-link.ts), which reads one record the same way.`

- [ ] **Step 5: Buat `src/services/approval/email-link.ts`**

```ts
/**
 * Approve or reject one waiting booking from the link in the psychologist's email,
 * without logging in (spec docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md).
 *
 * The token names one booking and its psychologist. Whether it still works is decided here,
 * from the booking as it is now: it exists, it has an approval record, and it still belongs
 * to that psychologist. The view shows only what the email already said. The decisions are
 * the dashboard's own functions, run as the psychologist's account — so the claim (first one
 * wins), the client mails and the rule that an overdue session can only be rejected all hold.
 */
import type { Actor } from '@/lib/auth';
import { logging } from '@/lib/logging';
import { verifyApprovalToken } from '@/lib/public/approval-token';
import { SESSION_STATUS, findSessionById, type SessionRow } from '@/repositories/wp/sessions.repo';
import { ensureUserFromWordPress } from '@/services/auth/service';
import { sessionStartsAtUtc } from '@/services/session/reminder-schedule';
import { isOverdue } from './schedule';
import { ApprovalError, approveAwaiting, reconcile, rejectAwaiting, serviceNameOf } from './service';
import * as store from './store';

export interface PublicApprovalLinkView {
  clientName: string;
  professionalName: string;
  serviceName: string;
  /** YYYY-MM-DD, clinic zone. */
  slotDate: string | null;
  /** HH:mm:ss, clinic zone. */
  startTime: string | null;
  timezone: string;
  /** What the client paid; null when staff marked it paid by hand. */
  amount: { value: number; currency: 'IDR' | 'USD' } | null;
  state: store.ApprovalState;
  decidedByName: string | null;
  decidedAt: string | null;
  isOverdue: boolean;
  canApprove: boolean;
  canReject: boolean;
}

interface Resolved {
  row: SessionRow;
  approval: store.ApprovalRecord;
  doctorWpUserId: number;
}

/** One answer for every way a link fails, so a forged token learns nothing. */
function invalidLink(): ApprovalError {
  return new ApprovalError('approval_link_invalid', 'This approval link is not valid', 404);
}

async function resolve(token: string): Promise<Resolved> {
  const payload = verifyApprovalToken(token);
  if (!payload) throw invalidLink();
  const row = await findSessionById(payload.appointmentId);
  if (!row || row.professionalId !== payload.doctorWpUserId) throw invalidLink();
  const approval = await store.findApproval(payload.appointmentId);
  if (!approval) throw invalidLink();
  return { row, approval, doctorWpUserId: payload.doctorWpUserId };
}

/** Settle a record whose appointment moved outside the app (as the queue does), then read again. */
async function resolveSettled(token: string, now: Date): Promise<Resolved> {
  const first = await resolve(token);
  await reconcile([first.approval], now);
  return resolve(token);
}

async function toView(row: SessionRow, a: store.ApprovalRecord, now: Date): Promise<PublicApprovalLinkView> {
  const names = await store.userNames([a.decidedBy]);
  const order = a.paymentOrderId ? (await store.paymentOrdersByIds([a.paymentOrderId])).get(a.paymentOrderId) : undefined;
  const waiting = a.state === store.APPROVAL_STATE.AWAITING && row.status === SESSION_STATUS.PENDING;
  const overdue = a.state === store.APPROVAL_STATE.AWAITING && isOverdue(sessionStartsAtUtc(row), now);
  return {
    clientName: row.clientName,
    professionalName: row.professionalName,
    serviceName: await serviceNameOf(row),
    slotDate: row.slotDate,
    startTime: row.startTime,
    timezone: row.timezone,
    amount: order
      ? { value: order.chargedAmount ?? order.expectedAmount, currency: order.chargedCurrency === 'USD' ? 'USD' : 'IDR' }
      : null,
    state: a.state,
    decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    isOverdue: overdue,
    canApprove: waiting && !overdue,
    canReject: waiting,
  };
}

function assertWaiting({ row, approval }: Resolved): void {
  if (approval.state !== store.APPROVAL_STATE.AWAITING || row.status !== SESSION_STATUS.PENDING) {
    throw new ApprovalError('approval_already_decided', 'This booking is no longer waiting for approval', 409);
  }
}

/**
 * The psychologist's app account. ensureUserFromWordPress creates it from WordPress when they
 * never logged in. It must be the same WordPress user the token names; anything else and the
 * decision would be recorded under somebody else.
 */
async function linkActor(row: SessionRow, doctorWpUserId: number): Promise<Actor> {
  const user = row.professionalEmail ? await ensureUserFromWordPress(row.professionalEmail) : null;
  if (!user || user.wpUserId === null || Number(user.wpUserId) !== doctorWpUserId) {
    await logging.error('approval link: no app account matches the psychologist', undefined, {
      resource: 'session',
      resourceId: String(row.id),
      metadata: { doctorWpUserId },
    });
    throw new ApprovalError('approval_actor_missing', 'The psychologist account could not be resolved', 500);
  }
  return { id: user.id, role: 'PROFESSIONAL', practiceId: null };
}

export async function linkView(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const { row, approval } = await resolveSettled(token, now);
  return toView(row, approval, now);
}

export async function approveByLink(token: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolveSettled(token, now);
  assertWaiting(resolved);
  const { row, approval, doctorWpUserId } = resolved;
  const actor = await linkActor(row, doctorWpUserId);
  await approveAwaiting({ actor, actorWpUserId: doctorWpUserId, row, approval, now, via: 'email_link' });
  const after = await resolve(token);
  return toView(after.row, after.approval, now);
}

export async function rejectByLink(token: string, reason: string, now: Date = new Date()): Promise<PublicApprovalLinkView> {
  const resolved = await resolveSettled(token, now);
  assertWaiting(resolved);
  const { row, doctorWpUserId } = resolved;
  const actor = await linkActor(row, doctorWpUserId);
  await rejectAwaiting({ actor, actorWpUserId: doctorWpUserId, row, reason, now, via: 'email_link' });
  const after = await resolve(token);
  return toView(after.row, after.approval, now);
}
```

- [ ] **Step 6: Buat `src/services/approval/email-link-http.ts`**

```ts
/**
 * The HTTP side the three approval-link routes share: one rate limiter keyed by client IP
 * (spec 2026-10-29 §6.4) and the { data } / problem answer. One limiter, not one per route,
 * so a guesser cannot spread attempts over GET and the two POSTs.
 *
 * Only an invalid link counts as a failure. While the FE does not vouch for the visitor's
 * IP (src/lib/client-ip.ts), every request looks like the FE host, so the FE's own throttle
 * is the limit that bites first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clientIpOrNull } from '@/lib/client-ip';
import { tooManyRequests } from '@/lib/problem-details';
import { createRateLimiter } from '@/lib/rate-limit';
import { approvalErrorResponse } from './http';
import { ApprovalError } from './service';

const limiter = createRateLimiter({ config: { lockoutAfter: 30, windowMs: 15 * 60_000 } });

export async function linkResponse(req: NextRequest, tag: string, run: () => Promise<unknown>): Promise<NextResponse> {
  const key = clientIpOrNull(req.headers) ?? 'unknown';
  const verdict = limiter.check(key);
  if (verdict.kind === 'lockout') {
    const retryAfter = Math.ceil(verdict.retryAfterMs / 1000);
    const p = tooManyRequests('rate_limited', retryAfter);
    return NextResponse.json(p, { status: p.status, headers: { 'Retry-After': String(retryAfter) } });
  }
  try {
    const data = await run();
    limiter.recordSuccess(key);
    return NextResponse.json({ data }, { status: 200 });
  } catch (err) {
    if (err instanceof ApprovalError && err.code === 'approval_link_invalid') limiter.recordFailure(key);
    return approvalErrorResponse(err, tag);
  }
}
```

- [ ] **Step 7: Buat tiga route**

`src/app/api/v1/public/approvals/[token]/route.ts`:

```ts
/**
 * GET /api/v1/public/approvals/:token — the booking behind a psychologist's email link,
 * and which buttons the page may offer. No login: the signed token is the authority.
 * Decides nothing (email scanners open every link). Spec 2026-10-29 §6.1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { linkView } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[GET /public/approvals/:token]', () => linkView(token));
}
```

`src/app/api/v1/public/approvals/[token]/approve/route.ts`:

```ts
/**
 * POST /api/v1/public/approvals/:token/approve — approve the booking as its psychologist,
 * from the email link. Same decision as the dashboard's. Body ignored. Spec 2026-10-29 §6.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { approveByLink } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[POST /public/approvals/:token/approve]', () => approveByLink(token));
}
```

`src/app/api/v1/public/approvals/[token]/reject/route.ts`:

```ts
/**
 * POST /api/v1/public/approvals/:token/reject — reject the booking as its psychologist, from
 * the email link. The reason is internal and never shown to the client. Spec 2026-10-29 §6.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rejectByLink } from '@/services/approval/email-link';
import { linkResponse } from '@/services/approval/email-link-http';

export const dynamic = 'force-dynamic';

const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  return linkResponse(req, '[POST /public/approvals/:token/reject]', async () => {
    const { reason } = rejectBody.parse(await req.json().catch(() => ({})));
    return rejectByLink(token, reason);
  });
}
```

- [ ] **Step 8: Jalankan dan pastikan lolos**

Run: `rtk proxy npx vitest run tests/integration/approval/approval-email-link.test.ts tests/unit/test-id-blocks.test.ts`
Expected: PASS (14 tes integrasi + tes blok id).

Lalu seluruh suite approval dan tsc:
Run: `rtk proxy npx vitest run tests/unit/approval tests/integration/approval` lalu `rtk proxy npx tsc --noEmit -p .`
Expected: PASS; tsc 0 error.

- [ ] **Step 9: Commit**

```bash
git add src/services/approval/service.ts src/services/approval/email-link.ts src/services/approval/email-link-http.ts "src/app/api/v1/public/approvals" tests/helpers/id-blocks.ts tests/integration/approval/approval-email-link.test.ts
git commit -m "feat(approval): endpoint publik untuk setujui/tolak dari tautan email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4: Dokumentasi backend

**Files:**
- Modify: `docs/api/APPROVAL-PSIKOLOG-GUIDE.md`
- Modify: `docs/api/openapi.yaml`
- Modify: `docs/deploy/approval-psikolog-runbook.md`

- [ ] **Step 1: Panduan API**

Di `docs/api/APPROVAL-PSIKOLOG-GUIDE.md`, tambahkan bagian baru tepat sebelum `## Kode error`:

````markdown
## Tautan email tanpa login

Email "Booking baru" dan setiap email pengingat ke psikolog membawa dua tautan ke halaman FE
`/persetujuan/t/{token}` (yang kedua dengan `?aksi=tolak`). Token ditandatangani backend untuk
satu booking dan psikolognya, tanpa kedaluwarsa: ia berhenti berguna begitu booking diputuskan,
sesinya mulai (hanya bisa ditolak), atau booking dipindah ke psikolog lain. Membuka tautan tidak
memutuskan apa pun — keputusan selalu lewat POST.

| Endpoint | Badan | Sukses |
|---|---|---|
| `GET /api/v1/public/approvals/{token}` | — | `200 { data: PublicApprovalLinkView }` |
| `POST /api/v1/public/approvals/{token}/approve` | — | `200 { data: PublicApprovalLinkView }` |
| `POST /api/v1/public/approvals/{token}/reject` | `{ "reason": "…" }` (1–500 setelah trim, internal) | `200 { data: PublicApprovalLinkView }` |

```json
{
  "clientName": "Ada Lovelace",
  "professionalName": "Dianda Psikolog",
  "serviceName": "Konseling Individu",
  "slotDate": "2026-11-05",
  "startTime": "10:00:00",
  "timezone": "Asia/Jakarta",
  "amount": { "value": 350000, "currency": "IDR" },
  "state": "AWAITING",
  "decidedByName": null,
  "decidedAt": null,
  "isOverdue": false,
  "canApprove": true,
  "canReject": true
}
```

Tanpa bearer (FE memakai `getPublic` / `postPublic`). Keputusan dicatat atas nama akun psikolog,
dengan audit `via: "email_link"`. Error: `404 approval_link_invalid` (token rusak, booking tanpa
catatan approval, atau booking milik psikolog lain — sengaja tidak dibedakan),
`409 approval_already_decided`, `422 session_already_started` (setujui setelah sesi mulai), `422`
validasi alasan, `429 rate_limited` (30 tautan tidak sah per alamat per 15 menit),
`500 approval_actor_missing`.
````

- [ ] **Step 2: OpenAPI**

Di `docs/api/openapi.yaml`, tambahkan blok berikut tepat sebelum baris `  /api/v1/public/booking:` (bagian ini tidak dimiliki generator, jadi `npm run openapi:check` membiarkannya):

```yaml
  /api/v1/public/approvals/{token}:
    parameters:
      - name: token
        in: path
        required: true
        description: Signed approval-link token from the psychologist's email.
        schema:
          type: string
    get:
      tags:
        - public
      summary: Approval link (GET) — public
      operationId: get_api_v1_public_approvals_token
      description: 'The booking behind an email approval link and the buttons it may offer. Decides nothing. **Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/PublicApprovalLinkView'
        '404':
          $ref: '#/components/responses/NotFound'
      security: []
  /api/v1/public/approvals/{token}/approve:
    parameters:
      - name: token
        in: path
        required: true
        schema:
          type: string
    post:
      tags:
        - public
      summary: Approve from the email link (POST) — public
      operationId: post_api_v1_public_approvals_token_approve
      description: 'Approve as the psychologist. 409 approval_already_decided, 422 session_already_started. **Response envelope:** standard / RFC-7807 problem+json'
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/PublicApprovalLinkView'
        '404':
          $ref: '#/components/responses/NotFound'
      security: []
  /api/v1/public/approvals/{token}/reject:
    parameters:
      - name: token
        in: path
        required: true
        schema:
          type: string
    post:
      tags:
        - public
      summary: Reject from the email link (POST) — public
      operationId: post_api_v1_public_approvals_token_reject
      description: 'Reject as the psychologist; the reason is internal. 409 approval_already_decided. **Response envelope:** standard / RFC-7807 problem+json'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reason]
              properties:
                reason:
                  type: string
                  minLength: 1
                  maxLength: 500
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: '#/components/schemas/PublicApprovalLinkView'
        '404':
          $ref: '#/components/responses/NotFound'
        '422':
          $ref: '#/components/responses/ValidationError'
      security: []
```

dan skema berikut di bawah `components: schemas:` (urut abjad, tepat sebelum skema `PublicAppointmentView`):

```yaml
    PublicApprovalLinkView:
      type: object
      required: [clientName, professionalName, serviceName, slotDate, startTime, timezone, amount, state, decidedByName, decidedAt, isOverdue, canApprove, canReject]
      properties:
        clientName: { type: string }
        professionalName: { type: string }
        serviceName: { type: string }
        slotDate: { type: string, nullable: true, example: '2026-11-05' }
        startTime: { type: string, nullable: true, example: '10:00:00' }
        timezone: { type: string, example: Asia/Jakarta }
        amount:
          type: object
          nullable: true
          properties:
            value: { type: number }
            currency: { type: string, enum: [IDR, USD] }
        state: { type: string, enum: [AWAITING, APPROVED, REJECTED, CANCELLED] }
        decidedByName: { type: string, nullable: true }
        decidedAt: { type: string, format: date-time, nullable: true }
        isOverdue: { type: boolean }
        canApprove: { type: boolean }
        canReject: { type: boolean }
```

Run: `rtk proxy npm run openapi:check`
Expected: lolos (tidak ada grup milik generator yang berubah). Kalau `openapi:check` sudah merah di `main` sebelum perubahan ini, catat itu di laporan dan jangan perbaiki di sini.

- [ ] **Step 3: Runbook**

Di `docs/deploy/approval-psikolog-runbook.md`, tambahkan bagian di akhir file:

```markdown
## Tautan email tanpa login (spec 2026-10-29)

Urutan rilis **FE dulu, baru backend** (kebalikan biasanya):

1. Merge PR FE `feat/approval-tautan-email` → deploy GitHub Actions. Aman sendirian: belum ada
   email yang membawa tautan baru; kalaupun halaman dibuka, backend lama menjawab 404 dan halaman
   menampilkan "Tautan ini tidak berlaku".
2. Merge PR backend `feat/approval-tautan-email` → Hostinger auto-deploy. **Cek build benar-benar
   berjalan**: hPanel → Penempatan, atau `ls -t ~/domains/endpoint.praktiqu.com/hbuilds/logs | head -3`
   lalu `grep "Checking out commit"` di log terbaru; harus sama dengan `git log -1 origin/main`.
   Tidak ada SQL, tidak ada plugin.
3. Verifikasi tanpa data nyata: `GET https://endpoint.praktiqu.com/api/v1/public/approvals/rusak`
   → `404` dengan `"title":"approval_link_invalid"`; halaman
   `https://appointment.praktiqu.com/persetujuan/t/xxxxxxxxxxxxxxxxxxxxxxxx` → "Tautan ini tidak berlaku".
4. Uji coba (user): booking nyata ke psikolog uji → setujui dari tautan email asli; booking kedua →
   tolak dari tautan; buka ulang tautan pertama → "Sudah disetujui oleh …".

Rollback: revert backend dulu (email kembali tanpa tautan). Tautan yang sudah terkirim lalu dijawab
404 oleh backend lama, dan halaman FE menampilkan "tidak berlaku" dengan tombol login. FE boleh dibiarkan.
```

- [ ] **Step 4: Commit**

```bash
git add docs/api/APPROVAL-PSIKOLOG-GUIDE.md docs/api/openapi.yaml docs/deploy/approval-psikolog-runbook.md
git commit -m "docs(approval): kontrak, openapi, dan urutan rilis tautan email tanpa login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Bagian F — FE Laravel

Persiapan worktree (sekali, sebelum F1):

```bash
git -C /home/ahmad/projects/praktiqu-fe/approval-psikolog fetch origin
git -C /home/ahmad/projects/praktiqu-fe/approval-psikolog worktree add -b feat/approval-tautan-email /home/ahmad/projects/praktiqu-fe/approval-tautan-email origin/main
cp /home/ahmad/projects/praktiqu-fe/approval-psikolog/.env /home/ahmad/projects/praktiqu-fe/approval-tautan-email/.env
/usr/bin/diff -q /home/ahmad/projects/praktiqu-fe/approval-tautan-email/composer.lock /home/ahmad/projects/praktiqu-fe/approval-psikolog/composer.lock
```

Kalau `composer.lock` sama, `vendor` dipinjam lewat mount. Kalau berbeda, jalankan dulu
`docker run --rm -v /home/ahmad/projects/praktiqu-fe/approval-tautan-email:/app -w /app composer:2 install --no-interaction --ignore-platform-reqs`.

Perintah tes FE (dari folder worktree FE; ganti `--filter` sesuai tes):

```bash
docker run --rm -v "$PWD":/app -v /home/ahmad/projects/praktiqu-fe/approval-psikolog/vendor:/app/vendor -w /app php:8.4-cli php vendor/bin/phpunit --filter PersetujuanTautan
```

(Tanpa mount `vendor` kalau `composer install` dijalankan di worktree ini.) Jangan membuat symlink `vendor`; mount saja. Berkas yang ditulis container bisa milik root — bersihkan lewat container bila perlu.

### Task F1: Token tautan tidak masuk log FE

**Files:**
- Modify: `app/Services/PraktiquApi.php`
- Test: `tests/Feature/PraktiquApiLoggingTest.php`

**Interfaces:**
- Produces: `PraktiquApi::jalurLog(string $path): string` (private static).

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan di akhir kelas `PraktiquApiLoggingTest`:

```php
    // Token tautan persetujuan (approval psikolog lewat email) memberi siapa pun
    // yang memegangnya kemampuan memutuskan booking itu — ia tidak boleh
    // mendarat di log, sama seperti kata sandi.
    public function test_token_tautan_persetujuan_disamarkan_di_log(): void
    {
        Http::fake([
            '*/api/v1/public/approvals/*' => Http::response(['title' => 'Internal Server Error', 'code' => 'boom'], 500),
        ]);

        Log::shouldReceive('warning')
            ->once()
            ->withArgs(fn (string $msg) => str_contains($msg, 'POST /api/v1/public/approvals/[token]/approve')
                && ! str_contains($msg, 'rahasiaTokenUji'));

        $this->expectException(ApiException::class);

        app(PraktiquApi::class)->postPublic('api/v1/public/approvals/rahasiaTokenUji.tandaTangan/approve');
    }
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `docker run --rm -v "$PWD":/app -v /home/ahmad/projects/praktiqu-fe/approval-psikolog/vendor:/app/vendor -w /app php:8.4-cli php vendor/bin/phpunit --filter PraktiquApiLoggingTest`
Expected: FAIL — pesan log memuat `rahasiaTokenUji`.

- [ ] **Step 3: Implementasi**

Di `app/Services/PraktiquApi.php`, tambahkan method ini tepat sebelum `private function dispatch(`:

```php
    /**
     * Path untuk log. Token tautan persetujuan (approval psikolog lewat email)
     * memberi siapa pun yang memegangnya kemampuan memutuskan satu booking,
     * jadi ia disamarkan di setiap baris log; sisa path tetap utuh untuk
     * penelusuran.
     */
    private static function jalurLog(string $path): string
    {
        return preg_replace('#^(api/v1/public/approvals/)[^/?]+#', '$1[token]', $path) ?? $path;
    }
```

lalu ganti kelima pemakaian path di log:

- di `send()`: `logger()->warning('[praktiqu-api] '.strtoupper($method)." /{$path} → tidak terhubung", [` → `logger()->warning('[praktiqu-api] '.strtoupper($method).' /'.self::jalurLog($path).' → tidak terhubung', [`
- di `call()`, baris balasan bukan JSON: `logger()->warning('[praktiqu-api] '.strtoupper($method)." /{$path} → {$res->status()} balasan bukan JSON", [` → `logger()->warning('[praktiqu-api] '.strtoupper($method).' /'.self::jalurLog($path)." → {$res->status()} balasan bukan JSON", [`
- di `call()`, dua konteks `'path' => $path,` (mode pemilik ditolak dan klinik aktif ditolak) → `'path' => self::jalurLog($path),`
- di `call()`, baris 5xx: `logger()->warning('[praktiqu-api] '.strtoupper($method)." /{$path} → {$res->status()}", [` → `logger()->warning('[praktiqu-api] '.strtoupper($method).' /'.self::jalurLog($path)." → {$res->status()}", [`

- [ ] **Step 4: Jalankan dan pastikan lolos**

Run: perintah Step 2.
Expected: PASS, semua tes `PraktiquApiLoggingTest` (termasuk yang lama).

- [ ] **Step 5: Commit**

```bash
git add app/Services/PraktiquApi.php tests/Feature/PraktiquApiLoggingTest.php
git commit -m "fix(log): token tautan persetujuan disamarkan di log PraktiquApi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F2: Halaman tautan persetujuan tanpa login

**Files:**
- Create: `app/Http/Controllers/PersetujuanTautanController.php`
- Create: `resources/views/persetujuan-tautan.blade.php`
- Modify: `resources/views/layouts/base.blade.php` (satu baris meta robots)
- Modify: `routes/web.php` (import + tiga rute)
- Test: `tests/Feature/PersetujuanTautanTest.php`

**Interfaces:**
- Consumes: endpoint B3 (`GET|POST /api/v1/public/approvals/{token}[/approve|/reject]`), `PraktiquApi::getPublic/postPublic`, `PersetujuanController::jadwal(array)` dan `::nominal(?array)`.
- Produces: rute bernama `persetujuan.tautan`, `persetujuan.tautan.setujui`, `persetujuan.tautan.tolak`.

- [ ] **Step 1: Tulis tes yang gagal**

`tests/Feature/PersetujuanTautanTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Services\PraktiquApi;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Approval psikolog dari tautan email, tanpa login (spec backend
// 2026-10-29-approval-tautan-email). Backend dipalsukan. Yang diuji: halaman
// terbuka tanpa sesi, empat keadaannya, urutan form dengan ?aksi=tolak, POST →
// redirect + pesan, terjemahan kode error, dan header pengamannya.
class PersetujuanTautanTest extends TestCase
{
    private const TOKEN = 'eyJwIjoiYXBwcm92YWwiLCJhIjo3LCJkIjozNH0.c2lnbmF0dXJlLXVqaS0xMjM0NTY3ODkw';

    private const VIEW = [
        'clientName' => 'Ada Lovelace',
        'professionalName' => 'Dianda Psikolog',
        'serviceName' => 'Konseling Individu',
        'slotDate' => '2026-11-05',
        'startTime' => '10:00:00',
        'timezone' => 'Asia/Jakarta',
        'amount' => ['value' => 350000, 'currency' => 'IDR'],
        'state' => 'AWAITING',
        'decidedByName' => null,
        'decidedAt' => null,
        'isOverdue' => false,
        'canApprove' => true,
        'canReject' => true,
    ];

    private function url(string $tail = ''): string
    {
        return '/persetujuan/t/'.self::TOKEN.$tail;
    }

    private function fakeView(array $over = []): void
    {
        Http::fake(['*/api/v1/public/approvals/*' => Http::response(['data' => array_merge(self::VIEW, $over)], 200)]);
    }

    public function test_terbuka_tanpa_login_dan_menampilkan_ringkasan(): void
    {
        $this->fakeView();

        $this->get($this->url())->assertOk()
            ->assertSee('Ada Lovelace')
            ->assertSee('Konseling Individu')
            ->assertSee('Rp350.000')
            ->assertSee('Ya, setujui jadwal ini')
            ->assertSee('Tolak permintaan');

        Http::assertSent(fn (Request $r) => $r->method() === 'GET'
            && str_ends_with($r->url(), '/api/v1/public/approvals/'.self::TOKEN));
    }

    public function test_staf_yang_sedang_login_tidak_mengirim_bearernya(): void
    {
        $this->fakeView();

        $this->withSession([
            PraktiquApi::TOKEN_KEY => 'tok-staf',
            PraktiquApi::PROFILE_KEY => ['v' => AuthController::PROFILE_VERSION, 'role' => 'admin', 'name' => 'Staf', 'userId' => 9, 'practiceId' => 4],
        ])->get($this->url())->assertOk();

        Http::assertSent(fn (Request $r) => ! $r->hasHeader('Authorization'));
    }

    public function test_header_pengaman(): void
    {
        $this->fakeView();

        $res = $this->get($this->url());

        $res->assertHeader('X-Robots-Tag', 'noindex, nofollow')
            ->assertHeader('Referrer-Policy', 'no-referrer')
            ->assertSee('<meta name="robots" content="noindex, nofollow">', false);
        $this->assertStringContainsString('no-store', (string) $res->headers->get('Cache-Control'));
    }

    public function test_tanpa_aksi_tombol_setujui_lebih_dulu(): void
    {
        $this->fakeView();

        $html = $this->get($this->url())->getContent();

        $this->assertLessThan(strpos($html, 'id="alasan"'), strpos($html, 'Ya, setujui jadwal ini'));
        $this->assertStringNotContainsString('autofocus', $html);
    }

    public function test_aksi_tolak_mendahulukan_form_tolak(): void
    {
        $this->fakeView();

        $html = $this->get($this->url('?aksi=tolak'))->assertOk()->getContent();

        $this->assertLessThan(strpos($html, 'Ya, setujui jadwal ini'), strpos($html, 'id="alasan"'));
        $this->assertStringContainsString('autofocus', $html);
    }

    public function test_sudah_diputuskan_tanpa_tombol(): void
    {
        $this->fakeView([
            'state' => 'APPROVED', 'decidedByName' => 'Dianda Psikolog', 'decidedAt' => '2026-10-29T03:00:00.000Z',
            'canApprove' => false, 'canReject' => false,
        ]);

        $this->get($this->url())->assertOk()
            ->assertSee('Sudah disetujui oleh Dianda Psikolog.')
            ->assertDontSee('Ya, setujui jadwal ini')
            ->assertDontSee('id="alasan"', false);
    }

    public function test_sesi_lewat_hanya_bisa_ditolak(): void
    {
        $this->fakeView(['isOverdue' => true, 'canApprove' => false, 'canReject' => true]);

        $this->get($this->url())->assertOk()
            ->assertSee('Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.')
            ->assertDontSee('Ya, setujui jadwal ini')
            ->assertSee('id="alasan"', false);
    }

    public function test_tautan_tidak_berlaku(): void
    {
        Http::fake(['*/api/v1/public/approvals/*' => Http::response(['title' => 'approval_link_invalid', 'status' => 404], 404)]);

        $this->get($this->url())->assertNotFound()
            ->assertSee('Tautan ini tidak berlaku.')
            ->assertSee('href="/staff/login"', false);
    }

    public function test_backend_bermasalah_saat_memuat(): void
    {
        Http::fake(['*/api/v1/public/approvals/*' => Http::response(['title' => 'boom'], 500)]);

        $this->get($this->url())->assertStatus(503)
            ->assertSee('Halaman ini tidak bisa dimuat sekarang.');
    }

    public function test_token_berbentuk_aneh_tidak_sampai_ke_backend(): void
    {
        Http::fake();

        $this->get('/persetujuan/t/pendek')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_setujui_lalu_kembali_dengan_pesan(): void
    {
        Http::fake(['*/api/v1/public/approvals/*/approve' => Http::response(['data' => self::VIEW], 200)]);

        $this->post($this->url('/setujui'))
            ->assertRedirect($this->url())
            ->assertSessionHas('tautanPesan', 'Jadwal disetujui. Klien menerima email konfirmasi dan pengingat sesi.');

        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && str_ends_with($r->url(), '/api/v1/public/approvals/'.self::TOKEN.'/approve')
            && ! $r->hasHeader('Authorization'));
    }

    public function test_tolak_wajib_alasan(): void
    {
        Http::fake();

        $this->from($this->url('?aksi=tolak'))
            ->post($this->url('/tolak'), ['alasan' => ''])
            ->assertRedirect($this->url('?aksi=tolak'))
            ->assertSessionHasErrors('alasan');

        Http::assertNothingSent();
    }

    public function test_tolak_mengirim_alasan_yang_sudah_dirapikan(): void
    {
        Http::fake(['*/api/v1/public/approvals/*/reject' => Http::response(['data' => self::VIEW], 200)]);

        $this->post($this->url('/tolak'), ['alasan' => '  Bentrok jadwal  '])
            ->assertRedirect($this->url())
            ->assertSessionHas('tautanPesan', 'Permintaan ditolak. Klien sudah diberi tahu, dan klinik akan mengembalikan dananya.');

        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/reject') && $r['reason'] === 'Bentrok jadwal');
    }

    public static function kodeGagal(): array
    {
        return [
            'sudah diputuskan' => [409, 'approval_already_decided', 'Permintaan ini sudah diputuskan.'],
            'sesi sudah mulai' => [422, 'session_already_started', 'Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.'],
            'tidak berlaku' => [404, 'approval_link_invalid', 'Tautan ini tidak berlaku.'],
            'terlalu sering' => [429, 'Too Many Requests', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'],
            'server' => [502, 'upstream_failed', 'Server sedang bermasalah, jadi belum jelas apakah keputusan tersimpan. Muat ulang halaman ini untuk melihat keadaan terbarunya.'],
        ];
    }

    #[DataProvider('kodeGagal')]
    public function test_kode_error_diterjemahkan(int $status, string $kode, string $pesan): void
    {
        Http::fake(['*/api/v1/public/approvals/*/approve' => Http::response(['title' => $kode, 'status' => $status], $status)]);

        $this->post($this->url('/setujui'))
            ->assertRedirect($this->url())
            ->assertSessionHas('tautanGagal', $pesan);
    }
}
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `docker run --rm -v "$PWD":/app -v /home/ahmad/projects/praktiqu-fe/approval-psikolog/vendor:/app/vendor -w /app php:8.4-cli php vendor/bin/phpunit --filter PersetujuanTautanTest`
Expected: FAIL — rute `/persetujuan/t/…` belum ada (404 di hampir semua tes).

- [ ] **Step 3: Rute**

Di `routes/web.php`, tambahkan import (urut abjad, setelah `use App\Http\Controllers\PatientResultUploadController;`):

```php
use App\Http\Controllers\PersetujuanTautanController;
```

dan tambahkan blok ini tepat setelah rute `Route::get('/book/payment/{hasil}', …)->name('booking.kembali');`:

```php
// Approval psikolog dari tautan email, TANPA login (spec backend
// 2026-10-29-approval-tautan-email). Tokennya ditandatangani backend untuk satu
// booking dan psikolognya; backend yang memutuskan apakah ia masih berlaku. GET
// hanya menampilkan — banyak layanan email membuka setiap tautan secara
// otomatis, jadi keputusan selalu lewat POST. Tiga segmen, jadi tidak tertelan
// /{tenant}. NoStore: halamannya memuat data klien dan tokennya ada di URL.
Route::middleware([NoStore::class, 'throttle:30,1'])->group(function () {
    $token = '[A-Za-z0-9_.-]{20,400}';
    Route::get('/persetujuan/t/{token}', [PersetujuanTautanController::class, 'show'])
        ->where('token', $token)->name('persetujuan.tautan');
    Route::post('/persetujuan/t/{token}/setujui', [PersetujuanTautanController::class, 'setujui'])
        ->where('token', $token)->name('persetujuan.tautan.setujui');
    Route::post('/persetujuan/t/{token}/tolak', [PersetujuanTautanController::class, 'tolak'])
        ->where('token', $token)->name('persetujuan.tautan.tolak');
});
```

- [ ] **Step 4: Controller**

`app/Http/Controllers/PersetujuanTautanController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\ApiException;
use App\Services\PraktiquApi;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Approval psikolog dari tautan di email, tanpa login. Spec backend:
 * docs/superpowers/specs/2026-10-29-approval-tautan-email-design.md.
 *
 * Token di URL ditandatangani backend untuk satu booking milik satu psikolog;
 * backend yang memutuskan apakah ia masih berlaku. Semua panggilan lewat jalur
 * publik PraktiquApi (tanpa bearer), supaya staf yang kebetulan sedang login di
 * peramban yang sama tidak ikut mengirim identitasnya.
 *
 * GET hanya menampilkan: banyak layanan email membuka setiap tautan secara
 * otomatis, jadi keputusan selalu lewat tombol (POST).
 */
class PersetujuanTautanController extends Controller
{
    /** Header untuk halaman yang tokennya ada di URL. Cache-Control dari NoStore di rute. */
    private const HEADER = ['X-Robots-Tag' => 'noindex, nofollow', 'Referrer-Policy' => 'no-referrer'];

    public function __construct(private readonly PraktiquApi $api) {}

    public function show(Request $request, string $token): Response
    {
        $item = null;
        $keadaan = 'ada';
        $status = 200;
        try {
            $item = $this->api->getPublic("api/v1/public/approvals/{$token}");
            if (! is_array($item)) {
                [$keadaan, $status] = ['tidak-berlaku', 404];
            }
        } catch (ApiException $e) {
            [$keadaan, $status] = match (true) {
                $e->status === 404 => ['tidak-berlaku', 404],
                $e->status === 429 => ['terlalu-sering', 429],
                default => ['gagal', 503],
            };
        }

        return response()
            ->view('persetujuan-tautan', [
                'token' => $token,
                'item' => $item,
                'keadaan' => $keadaan,
                'tolakDulu' => $request->query('aksi') === 'tolak',
            ], $status)
            ->withHeaders(self::HEADER);
    }

    public function setujui(string $token): RedirectResponse
    {
        try {
            $this->api->postPublic("api/v1/public/approvals/{$token}/approve");
        } catch (ApiException $e) {
            return $this->kembali($token)->with('tautanGagal', self::pesanGagal($e));
        }

        return $this->kembali($token)->with('tautanPesan', 'Jadwal disetujui. Klien menerima email konfirmasi dan pengingat sesi.');
    }

    public function tolak(Request $request, string $token): RedirectResponse
    {
        $data = $request->validate(['alasan' => 'required|string|max:500'], [
            'alasan.required' => 'Tulis alasan penolakannya. Alasan ini hanya untuk catatan internal — klien menerima pesan standar.',
            'alasan.max' => 'Alasan paling panjang 500 karakter.',
        ]);

        try {
            $this->api->postPublic("api/v1/public/approvals/{$token}/reject", ['reason' => trim($data['alasan'])]);
        } catch (ApiException $e) {
            return $this->kembali($token, tolak: true)->withInput()->with('tautanGagal', self::pesanGagal($e));
        }

        return $this->kembali($token)->with('tautanPesan', 'Permintaan ditolak. Klien sudah diberi tahu, dan klinik akan mengembalikan dananya.');
    }

    private function kembali(string $token, bool $tolak = false): RedirectResponse
    {
        return redirect()->route('persetujuan.tautan', array_filter(['token' => $token, 'aksi' => $tolak ? 'tolak' : null]));
    }

    private static function pesanGagal(ApiException $e): string
    {
        // Problem+json backend menaruh kodenya di `title`.
        $kode = is_array($e->body) ? ($e->body['title'] ?? null) : null;

        return match (true) {
            $kode === 'approval_already_decided', $e->status === 409 => 'Permintaan ini sudah diputuskan.',
            $kode === 'session_already_started' => 'Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.',
            $e->status === 404 => 'Tautan ini tidak berlaku.',
            $e->status === 429 => 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.',
            $e->status === 0 || $e->status >= 500 => 'Server sedang bermasalah, jadi belum jelas apakah keputusan tersimpan. Muat ulang halaman ini untuk melihat keadaan terbarunya.',
            default => 'Permintaan gagal diproses.',
        };
    }
}
```

- [ ] **Step 5: Slot meta robots di layout**

Di `resources/views/layouts/base.blade.php`, tambahkan tepat setelah baris `<meta name="csrf-token" content="{{ csrf_token() }}">`:

```blade
  @hasSection('robots')<meta name="robots" content="@yield('robots')">@endif
```

- [ ] **Step 6: View**

`resources/views/persetujuan-tautan.blade.php`:

```blade
@extends('layouts.base')
@section('title', 'Persetujuan Booking — PraktiQu')
@section('robots', 'noindex, nofollow')

{{-- Approval psikolog dari tautan email, tanpa login — lihat
     PersetujuanTautanController. Gaya mengikuti dashboard/persetujuan-detail;
     tanpa navigasi dashboard karena pembukanya belum tentu login. --}}

@php
  $P = \App\Http\Controllers\PersetujuanController::class;

  $aksen = '#425FAD';
  $teks  = '#1E2236';
  $redup = '#6B7090';
  $garis = '#DDE1EC';

  $amount = is_array($item['amount'] ?? null) ? $item['amount'] : null;
  $nominal = $amount ? $P::nominal(['chargedAmount' => $amount['value'] ?? null, 'chargedCurrency' => $amount['currency'] ?? 'IDR']) : null;
  $baris = is_array($item) ? array_filter([
      'Klien' => $item['clientName'] ?? null,
      'Layanan' => $item['serviceName'] ?? 'Sesi',
      'Jadwal' => $P::jadwal($item),
      'Psikolog' => $item['professionalName'] ?? null,
      'Dibayar' => $nominal ?? 'Ditandai lunas manual oleh staf',
  ], fn ($v) => $v !== null && $v !== '') : [];
  $oleh = ($item['decidedByName'] ?? null) ? ' oleh '.$item['decidedByName'] : '';
  $keputusan = match ($item['state'] ?? null) {
      'APPROVED' => 'Sudah disetujui'.$oleh.'.',
      'REJECTED' => 'Sudah ditolak'.$oleh.'.',
      'CANCELLED' => 'Booking ini sudah dibatalkan.',
      default => null,
  };
  $bolehSetujui = ! empty($item['canApprove']);
  $bolehTolak = ! empty($item['canReject']);
  $urutan = $tolakDulu ? ['tolak', 'setujui'] : ['setujui', 'tolak'];
  $kartu = "background:#fff;border:1.5px solid {$garis};border-radius:16px;padding:22px 22px";
@endphp

@section('content')
<div style="min-height:100vh;background:#F2F4FA;padding:32px 16px 64px">
<div style="max-width:560px;margin:0 auto">

  <img src="/praktiqu-logo.png" alt="PraktiQu" style="height:26px;width:auto;margin-bottom:22px">

  @if ($keadaan === 'tidak-berlaku')
    <div style="{{ $kartu }}">
      <h1 style="font-size:22px;font-weight:800;color:{{ $teks }};margin:0 0 8px">Tautan ini tidak berlaku.</h1>
      <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 18px">
        Tautannya mungkin terpotong saat disalin, atau booking ini sudah dipindahkan. Masuk ke dashboard
        untuk melihat permintaan persetujuan Anda.
      </p>
      <a href="/staff/login" style="display:inline-block;background:{{ $aksen }};color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;text-decoration:none">Masuk ke dashboard</a>
    </div>
  @elseif ($keadaan !== 'ada')
    <div style="{{ $kartu }}">
      <h1 style="font-size:22px;font-weight:800;color:{{ $teks }};margin:0 0 8px">Halaman ini tidak bisa dimuat sekarang.</h1>
      <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0">
        {{ $keadaan === 'terlalu-sering' ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' : 'Tidak ada yang diubah. Muat ulang halaman ini sebentar lagi.' }}
      </p>
    </div>
  @else
    <h1 style="font-size:24px;font-weight:800;color:{{ $teks }};letter-spacing:-.01em;margin:0 0 6px">Permintaan booking</h1>
    <p style="font-size:14px;color:{{ $redup }};line-height:1.65;margin:0 0 18px">
      Booking online berikut sudah dibayar klien dan menunggu persetujuan Anda.
    </p>

    @if (session('tautanPesan'))
      <div style="border:1.5px solid #BFE3D2;background:#F2FBF7;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;font-weight:700;color:#1B6B4A">
        {{ session('tautanPesan') }}
      </div>
    @endif
    @if (session('tautanGagal'))
      <div style="border:1.5px solid #F0C9C9;background:#FDF5F5;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-size:14px;color:#9B2C2C;line-height:1.6">
        {{ session('tautanGagal') }}
      </div>
    @endif

    <dl style="{{ $kartu }};margin:0 0 18px;display:grid;grid-template-columns:110px 1fr;gap:10px 16px;font-size:14px">
      @foreach ($baris as $judul => $isi)
        <dt style="color:{{ $redup }}">{{ $judul }}</dt>
        <dd style="margin:0;color:{{ $teks }};font-weight:600">{{ $isi }}</dd>
      @endforeach
    </dl>

    @if ($keputusan)
      <div style="background:#F2F3F7;border-radius:12px;padding:14px 16px;font-size:14px;font-weight:700;color:#5A5F7A">{{ $keputusan }}</div>
    @else
      @if (! empty($item['isOverdue']))
        <div style="font-size:13.5px;color:#7A5A00;background:#FFF6E5;border:1.5px solid #F3E2BE;border-radius:12px;padding:12px 14px;line-height:1.6;margin-bottom:14px">
          Jam sesi sudah lewat — permintaan ini hanya bisa ditolak.
        </div>
      @endif

      @foreach ($urutan as $bagian)
        @if ($bagian === 'setujui' && $bolehSetujui)
          <form method="POST" action="{{ route('persetujuan.tautan.setujui', ['token' => $token]) }}" style="margin-bottom:16px">
            @csrf
            <button type="submit" style="border:none;background:{{ $aksen }};color:#fff;border-radius:11px;padding:13px 24px;font-size:15px;font-weight:700;cursor:pointer">Ya, setujui jadwal ini</button>
            <div style="font-size:12.5px;color:{{ $redup }};margin-top:6px">Klien menerima email konfirmasi dan pengingat sesi.</div>
          </form>
        @elseif ($bagian === 'tolak' && $bolehTolak)
          <form method="POST" action="{{ route('persetujuan.tautan.tolak', ['token' => $token]) }}"
                style="{{ $kartu }};display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
            @csrf
            <label for="alasan" style="font-size:14px;font-weight:700;color:{{ $teks }}">Alasan penolakan (wajib, hanya untuk catatan internal)</label>
            <textarea id="alasan" name="alasan" maxlength="500" required rows="3" @if ($tolakDulu) autofocus @endif
                      style="border:1.5px solid {{ $garis }};border-radius:10px;padding:10px 12px;font:inherit;font-size:14px">{{ old('alasan') }}</textarea>
            @error('alasan')
              <div style="font-size:13px;color:#9B2C2C">{{ $message }}</div>
            @enderror
            <div style="font-size:12.5px;color:{{ $redup }};line-height:1.55">
              Klien menerima pesan standar bahwa jadwal ini tidak dapat diterima dan dananya akan dikembalikan oleh klinik.
            </div>
            <div>
              <button type="submit" style="border:none;background:#F2756A;color:#fff;border-radius:11px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer">Tolak permintaan</button>
            </div>
          </form>
        @endif
      @endforeach
    @endif

    <p style="font-size:12.5px;color:{{ $redup }};line-height:1.6;margin:22px 0 0">
      Tautan ini khusus untuk Anda, jangan diteruskan.
      <a href="/dashboard/persetujuan" style="color:{{ $aksen }}">Buka di dashboard</a> (perlu login).
    </p>
  @endif

</div>
</div>
@endsection
```

- [ ] **Step 7: Jalankan dan pastikan lolos**

Run: perintah Step 2.
Expected: PASS, 18 tes (14 metode, salah satunya dengan 5 data).

Lalu seluruh suite FE dan tes JS:
Run: `docker run --rm -v "$PWD":/app -v /home/ahmad/projects/praktiqu-fe/approval-psikolog/vendor:/app/vendor -w /app php:8.4-cli php vendor/bin/phpunit`
Run: `for f in tests/js/*.test.mjs; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "GAGAL $f"; done`
Expected: PHPUnit OK; semua tes JS `ok`.

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/PersetujuanTautanController.php resources/views/persetujuan-tautan.blade.php resources/views/layouts/base.blade.php routes/web.php tests/Feature/PersetujuanTautanTest.php
git commit -m "feat(persetujuan): halaman setujui/tolak dari tautan email tanpa login

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Bagian G — Rilis (bukan untuk junior; butuh persetujuan user di setiap langkah produksi)

1. Push kedua branch `feat/approval-tautan-email` (BE dengan kunci SSH khusus repo; FE dengan `id_ed25519_praktiqu_fe`). User membuka PR dari tautan compare:
   - FE: `https://github.com/raakanaka/laravel-praktiqu/compare/main...feat/approval-tautan-email?expand=1`
   - BE: `https://github.com/Alfzzz124/nextjs-appointment-praktiqu/compare/main...feat/approval-tautan-email?expand=1`
2. Sebelum merge FE: coba merge branch FE ke `origin/main` FE terbaru di worktree sementara, lalu jalankan PHPUnit dan tes JS di hasil merge.
3. User merge **FE dulu** → cek GitHub Actions hijau → halaman `https://appointment.praktiqu.com/persetujuan/t/xxxxxxxxxxxxxxxxxxxxxxxx` menampilkan "Tautan ini tidak berlaku".
4. User merge **backend** → cek build Hostinger benar-benar berjalan untuk commit merge itu → `GET https://endpoint.praktiqu.com/api/v1/public/approvals/rusak` → 404 `approval_link_invalid`.
5. Uji coba user (spec §9): setujui dari tautan, tolak dari tautan, buka ulang tautan yang sudah dipakai.
