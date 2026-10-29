# Approval Psikolog — Setujui atau Tolak dari Tautan Email — Desain

**Tanggal:** 2026-10-29
**Status:** Disetujui per bagian oleh user (2026-10-29). Menunggu review spec tertulis.
**Dibangun di atas:** `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md` (fitur sudah live
2026-10-21: plugin 1.8.4, tabel `session_approvals` / `professional_approval_settings`, BE PR #63, FE PR #61).
**Repo yang tersentuh:**
- Backend Next.js `Alfzzz124/nextjs-appointment-praktiqu` (branch `feat/approval-tautan-email`, dari `origin/main` bbb62f5)
- FE Laravel `raakanaka/laravel-praktiqu` (branch baru dari `main`, hanya lewat PR)
- **Tidak** ada perubahan plugin WordPress, skema database, atau SQL produksi.

## 1. Masalah

Email "Booking baru menunggu persetujuan Anda" dan email pengingat ke psikolog hanya menautkan
`/dashboard/persetujuan/{id}`, yang mewajibkan login. Psikolog yang membaca email di ponsel harus login
dulu sebelum bisa memutuskan, padahal keputusannya hanya satu klik.

## 2. Keputusan user

| Pertanyaan | Keputusan |
|---|---|
| Apa yang boleh dilakukan lewat tautan email tanpa login? | **Setujui dan tolak.** Menolak tetap wajib menulis alasan (internal). |
| Email mana yang mendapat tautan tanpa login? | **Psikolog saja**: email booking baru dan setiap email pengingat. Email eskalasi ke admin klinik tidak berubah. |
| Sampai kapan tautan berlaku? | **Sampai booking diputuskan atau jam sesi tiba.** Tautan dari email mana pun yang dikirim untuk booking itu berlaku selama itu. |
| Pendekatan teknis | **A: token bertanda tangan** (HMAC, tanpa tabel baru). Bukan token di database, bukan tautan login otomatis. |
| Alur psikolog (Bagian 1), backend (Bagian 2), FE + email + urutan rilis (Bagian 3), pengujian (Bagian 4) | Disetujui apa adanya. |

## 3. Tujuan dan batasan

- Psikolog bisa menyetujui atau menolak satu booking yang menunggu, dari tautan di email, tanpa login.
- Hasilnya identik dengan memutuskan dari dashboard: fungsi keputusan yang sama, email ke klien yang sama,
  audit yang sama.
- **Membuka tautan tidak pernah memutuskan apa pun.** Banyak layanan email (Outlook Safe Links, pemindai
  Gmail, antivirus kantor) membuka setiap tautan di email secara otomatis. Keputusan selalu butuh menekan
  tombol (POST) di halaman yang dibuka tautan itu.
- Tautan hanya memberi akses ke **satu booking** milik **satu psikolog**, dan hanya ke data booking yang sama
  dengan di email itu, ditambah nominal yang dibayar. Tidak memberi sesi login, tidak membuka dashboard, tidak memperlihatkan klien lain.

## 4. Alur psikolog

1. Email booking baru dan setiap email pengingat ke psikolog berisi dua tautan baru, di atas tautan dashboard:
   - **Setujui jadwal** → `{APP_PUBLIC_URL}/persetujuan/t/{token}`
   - **Tolak permintaan** → `{APP_PUBLIC_URL}/persetujuan/t/{token}?aksi=tolak`
2. Kedua tautan membuka halaman yang sama tanpa login. Halaman menampilkan ringkasan booking dan, selama
   booking masih menunggu dan sesi belum mulai, tombol **"Ya, setujui jadwal ini"** serta form tolak
   (alasan wajib, internal) dengan tombol **"Tolak permintaan"**. Dengan `?aksi=tolak`, form tolak tampil
   lebih dulu dan kolom alasan mendapat fokus.
3. Menekan tombol memanggil backend, lalu halaman dimuat ulang dengan pesan hasil:
   - setuju → "Jadwal disetujui. Klien menerima email konfirmasi dan pengingat sesi."
   - tolak → "Permintaan ditolak. Klien sudah diberi tahu, dan klinik akan mengembalikan dananya."
4. Membuka tautan lagi:
   - sudah diputuskan (lewat jalur mana pun, oleh siapa pun) → "Sudah disetujui oleh …" / "Sudah ditolak
     oleh …", tanpa tombol;
   - jam sesi sudah lewat dan belum diputuskan → hanya form tolak, dengan teks "Jam sesi sudah lewat —
     permintaan ini hanya bisa ditolak." (aturan yang sama dengan dashboard);
   - tautan tidak berlaku → "Tautan ini tidak berlaku." dengan tombol **Masuk ke dashboard**
     (`/staff/login`).

## 5. Token

File baru `src/lib/public/approval-token.ts`, idiom yang sama dengan `src/lib/google/oauth-state.ts`
(HMAC-SHA256 dengan `AUTH_SECRET`, base64url, perbandingan constant-time, cek panjang dulu):

```ts
export interface ApprovalTokenPayload { appointmentId: number; doctorWpUserId: number }
export function signApprovalToken(p: ApprovalTokenPayload, opts?: { issuedAt?: number }): string
export function verifyApprovalToken(token: string): ApprovalTokenPayload | null
```

- Badan token: `{"p":"approval","a":<appointmentId>,"d":<doctorWpUserId>,"i":<issuedAt epoch ms>}`,
  di-base64url, lalu `.` dan HMAC atas string base64url itu.
- `p: "approval"` adalah pemisah tujuan: token approval tidak lolos sebagai token janji temu publik
  (`appointment-token.ts`) atau state Google (`oauth-state.ts`), dan sebaliknya. `verifyApprovalToken`
  menolak badan tanpa `p === "approval"`, `a`/`d` yang bukan bilangan bulat positif aman, atau JSON rusak.
- **Tidak ada kedaluwarsa di dalam token.** Berlaku atau tidaknya selalu dari keadaan saat itu (§6.2).
  `i` hanya membuat setiap email membawa token yang berbeda.
- Produksi wajib punya `AUTH_SECRET` (sudah dijaga modul token lain). Mengganti `AUTH_SECRET` membatalkan
  semua tautan yang sudah terkirim; psikolog tetap bisa memutuskan dari dashboard.

## 6. Backend

### 6.1 Endpoint publik baru

Tanpa Bearer, di bawah `src/app/api/v1/public/approvals/[token]/`:

| Metode dan path | Badan | Jawaban sukses |
|---|---|---|
| `GET /api/v1/public/approvals/{token}` | — | `200 { data: PublicApprovalLinkView }` |
| `POST /api/v1/public/approvals/{token}/approve` | — (abaikan badan) | `200 { data: PublicApprovalLinkView }` |
| `POST /api/v1/public/approvals/{token}/reject` | `{ "reason": string }` 1–500 karakter setelah trim | `200 { data: PublicApprovalLinkView }` |

```ts
interface PublicApprovalLinkView {
  clientName: string;
  professionalName: string;
  serviceName: string;
  slotDate: string;        // YYYY-MM-DD, zona klinik
  startTime: string;       // HH:mm:ss, zona klinik
  timezone: string;
  amount: { value: number; currency: 'IDR' | 'USD' } | null;   // null = ditandai lunas manual
  state: 'AWAITING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decidedByName: string | null;
  decidedAt: string | null;  // ISO
  isOverdue: boolean;
  canApprove: boolean;       // state AWAITING && !isOverdue && sesi masih PENDING
  canReject: boolean;        // state AWAITING && sesi masih PENDING
}
```

Tidak ada id internal, email, telepon, alasan penolakan, data refund, atau nomor order di view ini.

### 6.2 Pemeriksaan di setiap panggilan

Urutan, berhenti di yang pertama gagal:

1. `verifyApprovalToken` → null ⇒ **404 `approval_link_invalid`**.
2. Sesi (`findSessionById(appointmentId)`) dan catatan `session_approvals` ada ⇒ selain itu 404 `approval_link_invalid`.
3. Psikolog sesi **saat ini** sama dengan `doctorWpUserId` di token ⇒ selain itu 404 `approval_link_invalid`
   (booking yang dipindah ke psikolog lain membatalkan tautan lama).
4. Psikolog di token **masih aktif** ⇒ selain itu 404 `approval_link_invalid`. Tautan tidak berlaku bila
   salah satu dari ini benar:
   - akun aplikasinya (`ensureUserFromWordPress(row.professionalEmail)`, lihat §6.3) berstatus `users.status === 0`;
   - akun WordPress-nya bukan `'active'` menurut `findWpAccountStatus(doctorWpUserId)`. Dibaca langsung dari
     WordPress, karena `users.status` hanya disinkronkan saat login;
   - status profesionalnya `INACTIVE` (`findDoctorById(...)?.status`, yang diset aksi admin "nonaktifkan
     profesional").

   Tautan tidak kedaluwarsa, jadi menonaktifkan akun psikolog adalah satu-satunya cara klinik mencabut tautan
   yang bocor atau diteruskan (§8). Empat kegagalan ini sengaja dijawab sama. Akun aplikasi yang `wpUserId`-nya
   berbeda dari token bukan "tautan tidak berlaku" melainkan 500 (§6.3).
5. Sebelum membangun view, jalankan rekonsiliasi yang sama dengan antrean (`settleExternal` untuk catatan
   AWAITING yang sesinya sudah bukan PENDING), supaya halaman tidak menawarkan tombol untuk booking yang
   sebenarnya sudah selesai di luar app. Rekonsiliasi berjalan setelah langkah 4, jadi tautan yang tidak
   berlaku tidak mengubah apa pun.

### 6.3 Keputusan

- Aktor = `ensureUserFromWordPress(row.professionalEmail)` (`src/services/auth/service.ts`; membuat baris
  `users` dari WordPress bila belum ada, seperti lupa sandi dan OTP). Dicari sekali, di langkah §6.2.4, dan
  dibawa ke keputusan. Hasilnya wajib punya `wpUserId === doctorWpUserId`. `null` atau `wpUserId` berbeda ⇒
  **500 `approval_actor_missing`** dengan log; jangan memutuskan tanpa aktor yang cocok.
- `approve` → `approveAwaiting({ actor, actorWpUserId: doctorWpUserId, row, approval })`;
  `reject` → `rejectAwaiting({ actor, actorWpUserId: doctorWpUserId, row, reason })`. Tidak ada jalur
  keputusan baru: klaim bersyarat (`claimDecision`, yang pertama menang), penulisan status, email ke klien,
  `onBehalf = false`, dan aturan "sesi sudah mulai hanya bisa ditolak" ikut dengan sendirinya.
- Audit: event keputusan yang sudah ada, metadata ditambah `via: 'email_link'`.
- Error mengikuti endpoint staf (`approvalErrorResponse`): sudah diputuskan → **409
  `approval_already_decided`**; setujui setelah sesi mulai → **422 `session_already_started`**; alasan
  kosong/terlalu panjang → 422 validasi; plugin gagal → 502/500 seperti staf. 409 di endpoint publik aman
  karena hanya halaman baru (§7) yang memanggil endpoint ini.
- Fungsi keputusan masih bisa mengembalikan kode lain di endpoint ini: **409 `booking_cancelled`** (booking
  dibatalkan selagi disetujui; pembayarannya masuk daftar refund), **502 `upstream_failed`** (plugin gagal
  mengonfirmasi, klaim dibatalkan, boleh dicoba lagi) dan **500 `status_write_failed`** (gagal membatalkan
  saat menolak). FE memetakan menurut status HTTP (§7), jadi 409 mana pun dibaca "sudah diputuskan" dan
  5xx mana pun "belum jelas apakah tersimpan".

### 6.4 Pembatasan laju

Satu `createRateLimiter` bersama untuk ketiga rute (`{ lockoutAfter: 30, windowMs: 15 menit }`), kunci
`clientIpOrNull(req.headers) ?? 'unknown'`. **Hanya token palsu yang dihitung dan dibatasi:**

- Token yang tanda tangannya tidak lolos `verifyApprovalToken` lewat pembatas: bila kunci sedang terkunci ⇒
  **429** dengan `Retry-After`; selain itu `recordFailure` dan jawaban 404 `approval_link_invalid`, tanpa
  menyentuh database.
- Token yang tanda tangannya benar **tidak pernah** diperiksa atau dihitung pembatas, walaupun kemudian
  ternyata tidak berlaku karena alasan lain (booking dipindah, catatan tidak ada, akun nonaktif: tetap 404,
  hanya tidak dihitung). Menebak tanda tangan tidak mungkin, jadi token sah tidak perlu dibatasi.
- Tidak ada `recordSuccess`: membuka tautan sah tidak menghapus hitungan siapa pun.
- Badan 429: `{ title: "Too Many Requests", status: 429, code: "rate_limited", ... }` plus header `Retry-After`.

Alasannya: selama FE belum meneruskan IP pengguna (lihat memori "FE forwards its own IP"), IP yang terlihat
adalah host FE, jadi semua pengunjung berbagi satu kunci. `throttle` di FE (§7) per pengunjung, sehingga tidak
menolong di sini. Bila tautan sah ikut dihitung atau diperiksa, tiga puluh tautan sembarang dari siapa pun
mengunci semua psikolog. Karena hanya token palsu yang dibatasi, satu kunci bersama tidak bisa mengunci
tautan asli.

### 6.5 Email

- `buildProfessionalRequestEmail` mendapat field wajib baru `actionLink: string` (tautan tanpa `?aksi`).
  Builder tetap murni: token dibuat pemanggil (`holdForApproval` di `service.ts` dan `reminder-handler.ts`)
  dengan `signApprovalToken({ appointmentId, doctorWpUserId })`, URL dari `getPublicAppUrl()`.
- Isi email bertambah, di antara rincian dan tautan dashboard (HTML dan teks):
  - `<p><a href="{actionLink}">Setujui jadwal</a> · <a href="{actionLink}?aksi=tolak">Tolak permintaan</a></p>`
  - `<p>Tautan ini khusus untuk Anda, jangan diteruskan. Berlaku sampai booking diputuskan atau sesi dimulai.</p>`
  - Tautan dashboard berganti label menjadi **"Buka di dashboard"** (target tetap `/dashboard/persetujuan/{id}`).
- `buildAdminEscalationEmail` dan email ke klien tidak berubah.

### 6.6 Dokumentasi

`docs/api/APPROVAL-PSIKOLOG-GUIDE.md` (bagian baru "Tautan email"), `openapi.yaml` (tiga path publik),
`docs/deploy/approval-psikolog-runbook.md` (urutan rilis §10).

## 7. FE Laravel

- Rute publik, **di luar** middleware `staff`, didaftarkan sebelum rute tenant `/{slug}`:
  - `GET /persetujuan/t/{token}` → tampilkan
  - `POST /persetujuan/t/{token}/setujui`
  - `POST /persetujuan/t/{token}/tolak` (validasi `alasan` required, max 500, pesan sama dengan dashboard)
  - semuanya `throttle:30,1` dan CSRF biasa; `{token}` dibatasi `[A-Za-z0-9_.-]{20,400}`.
- Controller baru (mis. `PersetujuanTautanController`) memanggil endpoint §6.1 lewat jalur publik
  `PraktiquApi` (tanpa token sesi). POST sukses → redirect ke GET dengan flash pesan dari §4 langkah 3. Error →
  redirect ke GET dengan flash: 409 "Permintaan ini sudah diputuskan.", 422 sesi mulai "Jam sesi sudah
  lewat — permintaan ini hanya bisa ditolak.", 404 → tampilan "tidak berlaku", 429 "Terlalu banyak
  percobaan. Coba lagi beberapa menit lagi.", 5xx "Server sedang bermasalah, jadi belum jelas apakah
  keputusan tersimpan. Muat ulang halaman ini untuk melihat keadaan terbarunya."
- View Blade berdiri sendiri, gaya mengikuti `dashboard/persetujuan-detail.blade.php`, logo PraktiQu di atas,
  tanpa navigasi dashboard. Empat keadaan: menunggu, sudah diputuskan, sesi lewat, tidak berlaku. Nominal
  memakai format yang sama dengan `PersetujuanController::nominal`.
- Header respons halaman ini: `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`; ditambah `<meta name="robots" content="noindex, nofollow">`.
- Jangan pernah menulis token ke log aplikasi FE (log error mencatat path tanpa token).

## 8. Keamanan

| Risiko | Penanganan |
|---|---|
| Pemindai email membuka tautan | GET hanya menampilkan; keputusan hanya lewat POST dengan CSRF. |
| Email diteruskan / bocor | Akses terbatas pada satu booking yang masih menunggu, dan hanya data booking yang sama dengan di email, ditambah nominal yang dibayar, tanpa data klien lain. Tidak ada sesi login. Kalimat "jangan diteruskan" di email. Setelah diputuskan, tautan tidak bisa mengubah apa pun. Menonaktifkan akun psikolog membatalkan tautannya (§6.2 langkah 4). |
| Token bocor lewat Referer / cache / mesin pencari | `no-referrer`, `no-store`, `noindex`. |
| Tebak/palsukan token | HMAC-SHA256 256 bit, constant-time; token palsu dibatasi lajunya di BE (§6.4) dan FE. |
| Token dipakai lintas fitur | Pemisah tujuan `p: "approval"`. |
| Booking dipindah ke psikolog lain | Cek psikolog saat ini (§6.2 langkah 3). |
| Klik di tautan dan dashboard bersamaan | `claimDecision` yang sudah ada: yang pertama menang, yang kedua 409. |

## 9. Pengujian

- **BE (vitest):**
  - `approval-token`: sign→verify; gagal bila badan atau tanda tangan diubah, `p` salah, secret lain, JSON
    rusak, id bukan bilangan bulat positif; token janji temu dan state Google tidak lolos, dan sebaliknya.
  - Route publik: 404 untuk token rusak, sesi tidak ada, catatan approval tidak ada, psikolog berbeda;
    GET untuk AWAITING / APPROVED / REJECTED / sesi lewat (flag `canApprove`/`canReject` benar); POST
    approve/reject memanggil `approveAwaiting`/`rejectAwaiting` dengan aktor psikolog dan audit
    `via: 'email_link'`; 409 / 422 diteruskan; alasan kosong dan 501 karakter → 422; psikolog nonaktif
    (akun aplikasi, akun WordPress, atau status profesional) → 404 di GET dan kedua POST; akun aplikasi
    dengan `wpUserId` berbeda → 500; pembatasan laju: 30 token palsu → 429, sedangkan token sah dari IP yang
    sama tetap 200; view tidak memuat field yang dilarang di §6.1.
  - Email: booking baru dan pengingat memuat kedua tautan dengan token yang terverifikasi ke booking dan
    psikolog itu, plus kalimat "jangan diteruskan"; email eskalasi admin tidak berubah (snapshot lama tetap).
  - Database uji: keputusan lewat tautan dan lewat dashboard bersamaan → tepat satu sukses.
- **FE (PHPUnit, `Http::fake`):** rute terbuka tanpa sesi; empat tampilan; `?aksi=tolak` mendahulukan form
  tolak; POST sukses → redirect + flash; setiap kode error → pesan §7; alasan wajib; header §7 ada di
  respons GET; staf yang sedang login tidak memengaruhi apa pun di halaman ini.
- **Uji coba setelah rilis (user):** satu booking nyata ke psikolog uji → setujui dari tautan email asli;
  satu lagi → tolak dari tautan; buka ulang tautan pertama → "Sudah disetujui oleh …".

## 10. Rilis

Urutan **FE dulu, baru backend** (kebalikan biasanya):

1. Merge PR FE → deploy. Aman sendirian: belum ada email yang berisi tautan baru, jadi halaman belum
   bisa dicapai; kalaupun dibuka, backend lama menjawab 404 dan halaman menampilkan "tidak berlaku".
2. Merge PR backend → Hostinger auto-deploy. **Cek build benar-benar berjalan** (memori "Hostinger
   auto-deploy skipped merges"). Sejak saat itu email baru dan pengingat berisi tautan.
3. Uji coba §9.

Rollback: revert backend dulu (email kembali tanpa tautan); tautan yang sudah terkirim lalu dijawab 404
oleh backend lama dan halaman menampilkan "tidak berlaku" dengan tombol login. FE boleh dibiarkan.

## 11. Di luar cakupan

- Tautan tanpa login untuk admin klinik (eskalasi) atau klien.
- Mencabut tautan per booking sebelum diputuskan (butuh pendekatan B).
- Satu klik langsung dari email tanpa halaman (tidak aman terhadap pemindai email, §3).
- Mempercantik tampilan email atau menambahkan zona waktu di jam email (catatan terpisah 2026-10-21).

## 12. Risiko

- **Email diteruskan sebelum diputuskan** memberi penerimanya kemampuan memutuskan booking itu. Diterima
  user sebagai bagian dari pilihan "setujui dan tolak" + "berlaku sampai diputuskan".
- **`AUTH_SECRET` berganti** membatalkan tautan lama tanpa pemberitahuan; jalur dashboard tetap ada.
- **Booking sangat jauh hari** membuat satu tautan berlaku lama; tetap hanya untuk booking yang menunggu itu.
