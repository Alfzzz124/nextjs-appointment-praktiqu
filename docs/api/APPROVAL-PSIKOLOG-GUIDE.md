# Approval Psikolog — Kontrak API untuk FE

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`.

Booking publik yang sudah dibayar untuk psikolog yang menyalakan saklar **tetap `PENDING`**
sampai psikolog (atau admin atas namanya) memutuskan. Yang membedakannya dari "belum
dibayar" adalah objek `approval`.

## Objek `approval` (staf)

Ada di `GET /sessions`, `GET /sessions/{id}`, `GET /sessions/pending`, respons
`/approve`, `/reject`, `/cancel`, dan setiap item antrean. `null` untuk booking biasa.

Bentuk staf ini hanya untuk token staf. Token `CLIENT` yang membaca sesinya sendiri lewat
endpoint yang sama (`GET /sessions`, `GET /sessions/{id}`, jawaban `/cancel`) menerima
**objek publik** di bawah: tanpa `rejectReason`, nama staf, catatan refund, dan `payment`.

```json
{
  "state": "AWAITING",
  "requestedAt": "2026-10-20T02:00:00.000Z",
  "decidedAt": null,
  "decidedByName": null,
  "rejectReason": null,
  "refundStatus": "NONE",
  "refundedAt": null,
  "refundedByName": null,
  "refundNote": null,
  "isOverdue": false,
  "payment": { "gateway": "xendit", "wcOrderId": 49863, "expectedAmount": 350000, "chargedAmount": 350000, "chargedCurrency": "IDR" }
}
```

- `state`: `AWAITING` | `APPROVED` | `REJECTED` | `CANCELLED`
- `refundStatus`: `NONE` | `NEEDED` | `DONE`
- `isOverdue`: `AWAITING` dan jam sesi sudah lewat. Yang tersisa hanya tolak.
- `payment`: `null` untuk booking yang ditandai lunas manual.

## Objek `approval` (publik)

Ada di `POST /public/payment-verify`, `GET /public/appointments/{token}` dan
`POST /public/appointments/{token}/cancel` (isinya `CANCELLED` + `refundStatus = NEEDED` kalau
klien membatalkan booking yang sedang menunggu psikolog). `POST /public/appointments` membawanya
hanya saat memutar ulang permintaan ber-`Idempotency-Key` (200). Hanya `state`, `requestedAt`,
`decidedAt`, `refundStatus`, `isOverdue`; `null` untuk booking biasa. Bentuk yang sama juga
diterima token `CLIENT` di endpoint sesi staf (lihat di atas).

## Arti status + approval

| `status` | `approval.state` | `refundStatus` | Label FE |
|---|---|---|---|
| `PENDING` | — | — | Belum dibayar |
| `PENDING` | `AWAITING` | `NONE` | Lunas · menunggu psikolog |
| `PENDING` | `APPROVED` | `NONE` | Sementara, lihat catatan di bawah |
| `PENDING` | `REJECTED` | `NEEDED` | Sementara: penolakan yang status batalnya belum tertulis. Dirapikan menjadi `CANCELLED` saat antrean atau detail dibaca, atau oleh job pengingat. Email penolakan ke klien hanya terkirim kalau job pengingat yang merapikannya. |
| `BOOKED` / `CHECK_IN` / `CHECK_OUT` | `APPROVED` | `NONE` | Label status biasa (`BOOKED`: Terjadwal · lunas); `approval` tidak mengubah artinya |
| `CANCELLED` | `REJECTED` | `NEEDED` / `DONE` | Ditolak · perlu refund / sudah direfund |
| `CANCELLED` | `CANCELLED` | `NEEDED` / `DONE` | Batal · perlu refund / sudah direfund |
| `CANCELLED` | `APPROVED` | `NONE` | Batal biasa, lihat catatan di bawah |

- `PENDING` + `APPROVED` adalah keadaan singkat: persetujuan sudah tercatat tetapi belum sampai ke
  WordPress (sedang dikirim, atau prosesnya terputus di tengah). Sistem menyelesaikannya sendiri,
  lewat job pengingat berikutnya, pemeriksaan pembayaran (`/public/payment-verify`) yang berulang,
  atau `/approve` yang diulang. Jangan tampilkan sebagai keputusan baru; muat ulang beberapa saat
  kemudian. Selama keadaan ini booking **tidak bisa dibatalkan**: `/cancel` dan `/reject` staf
  menjawab 409 `approval_already_decided`, tautan batal klien menjawab `not_cancellable` (409 yang
  sudah ada), dan batal massal melewatinya (dihitung tidak terbatalkan).
- Sesi yang dibatalkan **setelah** disetujui tetap `approval.state = APPROVED` dan
  `refundStatus = NONE`. Tidak ada refund yang dilacak untuk kasus itu (di luar cakupan fitur ini),
  jadi jangan menampilkannya sebagai "perlu refund".

## Aksi yang sudah ada, arti barunya

| Endpoint | Sesi `PENDING` tanpa approval | Sesi `PENDING` + `AWAITING` |
|---|---|---|
| `POST /sessions/{id}/approve` | Tandai lunas. Kalau saklar psikolog menyala **dan jam sesi belum lewat** → masuk antrean (tetap `PENDING`, `approval.state = AWAITING`), selain itu `BOOKED`. | Setujui → `BOOKED`. Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. 422 `session_already_started` kalau jam sesi lewat. |
| `POST /sessions/{id}/reject` `{reason}` | Batal seperti sebelumnya. | Tolak → `CANCELLED`, `refundStatus = NEEDED`, email standar ke klien (tanpa alasan). Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. |
| `POST /sessions/{id}/cancel` | Batal. | Batal → `approval.state = CANCELLED`, `refundStatus = NEEDED`. |

Pembayaran (webhook atau pemeriksaan `/public/payment-verify`) yang masuk **sesudah jam mulai
sesi** juga langsung `BOOKED`, walau saklarnya menyala: permintaan yang sudah terlewat sejak masuk
antrean hanya bisa ditolak.

Sesi `PENDING` yang `approval.state`-nya `APPROVED`, `REJECTED` atau `CANCELLED` sudah diputuskan:
`/approve` pada `REJECTED`/`CANCELLED` dijawab 409 `approval_already_decided` (bukan `BOOKED`),
`/cancel` dan `/reject` pada `APPROVED` juga 409 `approval_already_decided` (lihat catatan
`PENDING` + `APPROVED` di atas).

`/reject` mewajibkan `reason`: string 1–500 karakter setelah di-trim. `reason` yang hilang, kosong
atau > 500, juga body yang kosong atau bukan JSON, dijawab 422 validasi.

Keputusan yang kalah balapan: **409 `approval_already_decided`** di `/approve` dan `/reject`.
`/cancel` menjawabnya hanya untuk booking yang sedang dikonfirmasi (`PENDING` + `APPROVED`).
Daftar lengkap kode error ada di [Kode error](#kode-error).

Perhatian untuk FE: `/reject` hanya berlaku untuk sesi `PENDING`. Untuk status lain, misalnya sesi
yang sementara itu sudah disetujui dan kini `BOOKED`, jawabannya 400 `invalid_transition` dan sesi
tidak berubah: muat ulang item dan tampilkan keputusan yang sudah ada. Untuk sesi yang punya
`approval`, sembunyikan tombol Tolak kecuali `approval.state = AWAITING`, dan muat ulang item
sebelum mengirim keputusan dari halaman yang sudah lama terbuka.

## Endpoint baru

### `GET /api/v1/sessions/approvals`

Query: `state` = `AWAITING` (default) | `REFUND_NEEDED` | `REFUNDED` | `DECIDED`;
`professionalId`, `clinicId`, `page` (≥1), `limit` (1–100, default 20).

`state` menyaring dan mengurutkan seperti ini (huruf besar persis; nilai lain → 422). Seri diputus
dengan id sesi, searah urutan utamanya.

| `state` | Yang ditampilkan | Urutan |
|---|---|---|
| `AWAITING` | `approval.state = AWAITING` | `requestedAt` terlama dulu |
| `REFUND_NEEDED` | `refundStatus = NEEDED` | `decidedAt` terlama dulu |
| `REFUNDED` | `refundStatus = DONE` | `refundedAt` terbaru dulu |
| `DECIDED` | `approval.state` = `APPROVED`, `REJECTED` atau `CANCELLED` | `decidedAt` terbaru dulu |

`DECIDED` tumpang tindih dengan dua saringan refund: sesi yang ditolak atau dibatalkan muncul di
`DECIDED` dan di `REFUND_NEEDED` / `REFUNDED`.

Sebelum menghitung halaman dan `counts`, antrean merapikan catatan dalam scope yang tidak cocok lagi
dengan janji temunya (perubahan dari dashboard KiviCare, check-out lewat tagihan, atau proses yang
terputus):

| Catatan | Janji temu | Menjadi |
|---|---|---|
| `AWAITING` | `CANCELLED` | `approval.state = CANCELLED`, `refundStatus = NEEDED` (masuk "Perlu refund") |
| `AWAITING` | `BOOKED` / `CHECK_IN` / `CHECK_OUT` | `approval.state = APPROVED`, `decidedByName = null` |
| `REJECTED` | `PENDING` | janji temu ditulis `CANCELLED`; `refundStatus` tetap `NEEDED` |

Jadi isi dan `counts` bisa berubah di antara dua pemuatan tanpa ada yang menekan tombol. Itu
disengaja; tampilkan apa adanya.

Pembacaan ini tidak mengirim email. Penolakan yang dirapikan lewat antrean atau detail tidak
mengirim email penolakan ke klien. Email itu hanya terkirim kalau job pengingat yang lebih dulu
merapikannya.

**Booking yang sudah ditolak tidak bisa dibuka ulang dari dashboard KiviCare.** Keputusan
`REJECTED` di catatan tetap dipegang, apa pun yang ditulis di KiviCare setelahnya:

- Kalau statusnya dikembalikan ke **Pending**, catatannya menjadi `REJECTED` + `PENDING` lagi.
  Pembacaan antrean atau detail berikutnya akan **membatalkannya lagi** (baris ketiga tabel di
  atas). Biasanya ini terjadi tanpa email. Klien hanya menerima email penolakan lagi kalau job
  pengingat lama ternyata masih terjadwal.
- Kalau statusnya diubah ke **Booked**, **Check-in** atau **Check-out**, tidak ada aturan yang
  merapikannya. Sesinya berjalan, tetapi catatannya tetap `REJECTED` dengan `refundStatus = NEEDED`,
  jadi booking itu tetap muncul di **Perlu refund**.

Kalau klien jadi dilayani, buat booking baru untuknya. Selesaikan refund booking yang ditolak lewat
`/refund-done`; catatannya boleh menyebut bahwa dana dipakai untuk booking pengganti.

Peran: psikolog (miliknya saja, `professionalId` diabaikan), `CLINIC_ADMIN` (klinik aktif;
klinik lain → halaman kosong), `SUPER_ADMIN` (semua, atau `clinicId`). Resepsionis → 403.

```json
{
  "data": [ { "id": 3358, "clinicId": 16, "professionalId": 142, "professionalName": "…", "clientName": "…",
              "slotDate": "2026-10-22", "startTime": "10:00:00", "endTime": "11:00:00", "timezone": "Asia/Jakarta",
              "status": "PENDING", "serviceIds": [12], "serviceName": "Konseling Individu", "approval": { … } } ],
  "pagination": { "currentPage": 1, "totalPages": 1, "totalItems": 1, "itemsPerPage": 20 },
  "counts": { "awaiting": 1, "refundNeeded": 0 }
}
```

Item antrean adalah baris sesi lengkap, bentuknya sama dengan item `GET /sessions`, ditambah
`serviceName` dan `approval` (selalu terisi). Contoh JSON di atas disingkat: item aslinya juga
membawa `clientId`, `clientEmail`, `professionalEmail`, `description`, `createdAt`, dan seterusnya.

Kuncinya lebih dari satu, jadi `PraktiquApi::unwrap()` di FE **tidak** membukanya. Baca `$res['data']` dan `$res['counts']`.

### `GET /api/v1/sessions/{id}/approval`

Satu item, bentuknya sama dengan item antrean, dibungkus `{ data }`. 404 `approval_not_found` kalau sesi itu tidak pernah menunggu approval; 403 di luar scope. Catatannya dirapikan dulu dengan aturan yang sama seperti antrean, jadi item selalu menunjukkan keadaan terbaru.

### `POST /api/v1/sessions/{id}/refund-done`

Body `{ "note": "Transfer BCA 21/10" }` (opsional, ≤ 500). Hanya `CLINIC_ADMIN` klinik sesi itu dan `SUPER_ADMIN`. Respons `{ data: approval }`. 409 `refund_not_needed` kalau tidak ada refund yang tertunda.

### `GET|PUT /api/v1/professionals/{id}/approval-setting`

`id` = `professionalId` (wp_users.ID). PUT body `{ "requiresApproval": true }`. Peran: psikolog itu sendiri, `CLINIC_ADMIN` yang klinik aktifnya memetakan psikolog itu, `SUPER_ADMIN`. 404 `professional_not_found` kalau psikolog tidak ada; 403 `forbidden` kalau bukan haknya; 422 untuk body yang salah.

```json
{ "data": { "professionalId": 142, "requiresApproval": true, "updatedAt": "2026-10-20T03:00:00.000Z", "updatedByName": "Rina Admin" } }
```

### Katalog publik

`GET /public/professionals`, `/public/professionals/{id}`, `/public/professionals/by-slug/{slug}`: setiap psikolog membawa `requiresApproval: boolean`.

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
dengan audit `via: "email_link"`. Error: `404 approval_link_invalid` (token rusak, booking tidak
ada, booking tanpa catatan approval, atau booking milik psikolog lain — sengaja tidak dibedakan),
`409 approval_already_decided`, `422 session_already_started` (setujui setelah sesi mulai), `422`
validasi alasan, `429 rate_limited`, `500 approval_actor_missing`. Tautan juga dijawab
`404 approval_link_invalid` bila akun psikolognya dinonaktifkan (status akun WordPress, status
profesional `INACTIVE`, atau akun app nonaktif) — menonaktifkan akun adalah cara mencabut tautan.

Dari fungsi keputusan yang sama dengan dashboard, kode berikut ikut diteruskan apa adanya:
`409 booking_cancelled` (`/approve`, booking dibatalkan di antara klaim dan konfirmasinya),
`502 upstream_failed` (`/approve`, penulisan ke WordPress gagal) dan `500 status_write_failed`
(`/reject`, penulisan status batal gagal). Arti dan penanganannya sama seperti di tabel "Kode
error" di bawah; dua yang terakhir aman diulang.

Badan `429` bukan bentuk di tabel di bawah: `{ "title": "Too Many Requests", "code": "rate_limited", … }`,
jadi kodenya ada di `code`, bukan di `title`, dan jawabannya membawa header `Retry-After`. FE
memetakan 429 dari status HTTP-nya.

Batas 429 hanya berlaku untuk token yang tanda tangannya palsu: 30 per alamat per 15 menit, dan
tautan asli tidak pernah terkunci. Catatan: selama `FE_FORWARDER_SECRET` belum diisi di kedua sisi
(BE dan FE; lihat `src/lib/client-ip.ts`), "alamat" itu sebenarnya alamat host FE, jadi batasnya
berlaku per host FE, bukan per pengunjung. Karena hanya token palsu yang dibatasi, ini tidak pernah
mengunci tautan asli.

## Kode error

Jalur approval (`GET /sessions/approvals`, `GET /sessions/{id}/approval`, dan `POST` ke `/approve`,
`/reject`, `/refund-done` di bawah `/sessions/{id}`) menjawab error dengan badan bergaya RFC 7807:
`{ "type": "/errors/<kode>", "title": "<kode>", "status": <HTTP>, "detail": "<pesan Inggris>" }`.
Kodenya ada di `title` (dan di `type`), bukan di field `code`; cocokkan `title`, jangan `detail`.
(Pengecualian: `429 rate_limited` dari tautan email memakai `title` `Too Many Requests` dan kodenya
di `code`; lihat bagian "Tautan email tanpa login".)
Header `Content-Type`-nya `application/json`, bukan `application/problem+json`. Pengecualiannya
ada di bawah tabel.

| HTTP | Kode (`title`) | Endpoint | Kapan | Yang dilakukan FE |
|---|---|---|---|---|
| 409 | `approval_already_decided` | `/approve`, `/reject`, `/cancel` | Kalah balapan: dua keputusan masuk bersamaan dan yang lain menang (`detail` menyebut keputusan dan pengambilnya). Juga: `/approve` pada sesi `PENDING` yang catatannya `REJECTED`/`CANCELLED`; `/reject` atau `/cancel` pada sesi `PENDING` yang catatannya `APPROVED` (sedang dikonfirmasi). | Muat ulang item, tampilkan keputusan yang sudah ada. Jangan diulang. |
| 409 | `booking_cancelled` | `/approve` | Booking dibatalkan (misalnya dari dashboard KiviCare) di antara klaim persetujuan dan konfirmasinya ke WordPress. Janji temu tetap `CANCELLED`, dan catatannya menjadi `approval.state = CANCELLED`, `refundStatus = NEEDED` (masuk "Perlu refund"). Butuh plugin 1.8.4. | Muat ulang item, tampilkan bahwa booking batal dan dananya perlu direfund. Jangan diulang. |
| 400 | `invalid_transition` | `/approve`, `/reject` | Sesi sudah bukan `PENDING` saat permintaan sampai (halaman basi): `/approve` pada sesi `BOOKED`, `CHECK_IN`, `CHECK_OUT` atau `CANCELLED`; `/reject` pada sesi mana pun yang bukan `PENDING`: `BOOKED`, `CHECK_IN`, `CHECK_OUT` atau `CANCELLED`. | Muat ulang item dan tampilkan keputusan yang sudah ada; tombol keputusan hilang sendiri. |
| 422 | `session_already_started` | `/approve` | Jam sesi sudah lewat (`isOverdue`). | Tampilkan bahwa hanya tolak yang mungkin; sembunyikan Setujui. |
| 502 | `upstream_failed` | `/approve` | Penulisan ke WordPress gagal dan janji temu masih belum `BOOKED`. Klaim keputusan sudah dibatalkan, permintaan kembali `AWAITING`. (Kalau WordPress ternyata sudah menyimpan `BOOKED` walau jawabannya error, `/approve` menjawab 200 biasa.) | Aman diulang. Tampilkan "coba lagi". |
| 500 | `status_write_failed` | `/reject` | Penulisan status batal gagal. Klaim keputusan sudah dibatalkan, permintaan kembali `AWAITING`. | Aman diulang. Tampilkan "coba lagi". |
| 409 | `refund_not_needed` | `/refund-done` | `refundStatus` bukan `NEEDED` (sudah `DONE`, atau tidak pernah `NEEDED`). `detail` menyebut statusnya. | Muat ulang item. |
| 404 | `approval_not_found` | `/approval`, `/refund-done` | Sesinya ada, tetapi tidak pernah menunggu approval. | Tampilkan "bukan booking approval". |
| 404 | `not_found` | `/approve`, `/reject`, `/approval`, `/refund-done` | Id sesi tidak ada. | Kembali ke antrean. |
| 403 | `forbidden` | semua | Di luar scope atau peran salah: resepsionis di antrean, `/approval` atau `/approve`; psikolog di `/refund-done`; sesi milik psikolog atau klinik lain; `/approve` atau `/reject` pada sesi `AWAITING` oleh selain psikolognya, `CLINIC_ADMIN` atau `SUPER_ADMIN`. | Sembunyikan aksinya sesuai peran. |
| 422 | validasi | `/sessions/approvals`, `/reject`, `/refund-done` | Query atau body salah: `state` tidak dikenal, `limit` di luar 1–100, `page` < 1, `professionalId` atau `clinicId` bukan bilangan bulat positif, `reason` hilang, kosong atau > 500, body `/reject` kosong atau bukan JSON, `note` > 500 atau ada kunci lain di body. `title` = `Validation Error`, `type` = `/errors/validation-error`. | Perbaiki input. |

Selain tabel itu:

- 400 `Invalid session id` (`type` `/errors/validation-error`): id di path bukan bilangan bulat positif.
- `POST /public/appointments/{token}/cancel` tidak memakai kode di atas: booking yang sedang
  dikonfirmasi (`PENDING` + `APPROVED`) dijawab seperti booking lain yang tidak bisa dibatalkan,
  409 `not_cancellable` yang sudah ada. `/public/appointments/{token}/cancel` tidak pernah menjawab
  409 baru; endpoint `/public/approvals/*` memang menjawab 409 (lihat "Tautan email tanpa login").
- 401: token tidak ada atau kedaluwarsa. Bentuknya problem+json lengkap dengan field `code` terpisah
  dan header `application/problem+json`.
- 500 `{ "error": "Internal server error" }` tanpa kode: kegagalan tak terduga. Muat ulang item untuk
  melihat apakah keputusannya sempat tercatat sebelum mengulang.
- `GET|PUT /professionals/{id}/approval-setting` memakai problem+json biasa dengan kode di field
  `code`: 403 `forbidden`, 404 `professional_not_found`, 422 (`title` `Validation Error`), 400 untuk
  id yang bukan bilangan positif.
