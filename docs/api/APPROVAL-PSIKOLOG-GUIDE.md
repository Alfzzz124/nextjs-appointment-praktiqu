# Approval Psikolog — Kontrak API untuk FE

Spec: `docs/superpowers/specs/2026-10-19-approval-psikolog-design.md`.

Booking publik yang sudah dibayar untuk psikolog yang menyalakan saklar **tetap `PENDING`**
sampai psikolog (atau admin atas namanya) memutuskan. Yang membedakannya dari "belum
dibayar" adalah objek `approval`.

## Objek `approval` (staf)

Ada di `GET /sessions`, `GET /sessions/{id}`, `GET /sessions/pending`, respons
`/approve`, `/reject`, `/cancel`, dan setiap item antrean. `null` untuk booking biasa.

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
`decidedAt`, `refundStatus`, `isOverdue`; `null` untuk booking biasa.

## Arti status + approval

| `status` | `approval.state` | `refundStatus` | Label FE |
|---|---|---|---|
| `PENDING` | — | — | Belum dibayar |
| `PENDING` | `AWAITING` | `NONE` | Lunas · menunggu psikolog |
| `PENDING` | `APPROVED` | `NONE` | Sementara, lihat catatan di bawah |
| `BOOKED` / `CHECK_IN` / `CHECK_OUT` | `APPROVED` | `NONE` | Label status biasa (`BOOKED`: Terjadwal · lunas); `approval` tidak mengubah artinya |
| `CANCELLED` | `REJECTED` | `NEEDED` / `DONE` | Ditolak · perlu refund / sudah direfund |
| `CANCELLED` | `CANCELLED` | `NEEDED` / `DONE` | Batal · perlu refund / sudah direfund |
| `CANCELLED` | `APPROVED` | `NONE` | Batal biasa, lihat catatan di bawah |

- `PENDING` + `APPROVED` adalah keadaan singkat: persetujuan sudah tercatat tetapi belum sampai ke
  WordPress (prosesnya terputus di tengah). Sistem menyelesaikannya sendiri, lewat job pengingat
  berikutnya, pemeriksaan pembayaran (`/public/payment-verify`) yang berulang, atau `/approve` yang
  diulang. Jangan tampilkan sebagai keputusan baru; muat ulang beberapa saat kemudian.
- Sesi yang dibatalkan **setelah** disetujui tetap `approval.state = APPROVED` dan
  `refundStatus = NONE`. Tidak ada refund yang dilacak untuk kasus itu (di luar cakupan fitur ini),
  jadi jangan menampilkannya sebagai "perlu refund".

## Aksi yang sudah ada, arti barunya

| Endpoint | Sesi `PENDING` tanpa approval | Sesi `PENDING` + `AWAITING` |
|---|---|---|
| `POST /sessions/{id}/approve` | Tandai lunas. Kalau saklar psikolog menyala → masuk antrean (tetap `PENDING`, `approval.state = AWAITING`), selain itu `BOOKED`. | Setujui → `BOOKED`. Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. 422 `session_already_started` kalau jam sesi lewat. |
| `POST /sessions/{id}/reject` `{reason}` | Batal seperti sebelumnya. | Tolak → `CANCELLED`, `refundStatus = NEEDED`, email standar ke klien (tanpa alasan). Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. |
| `POST /sessions/{id}/cancel` | Batal. | Batal → `approval.state = CANCELLED`, `refundStatus = NEEDED`. |

`/reject` mewajibkan `reason`: string 1–500 karakter setelah di-trim. `reason` yang hilang, kosong
atau > 500, juga body yang kosong atau bukan JSON, dijawab 422 validasi.

Keputusan yang kalah balapan: **409 `approval_already_decided`** (hanya `/approve` dan `/reject`;
`/cancel` tidak pernah menjawabnya). Daftar lengkap kode error ada di [Kode error](#kode-error).

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

Satu item, bentuknya sama dengan item antrean, dibungkus `{ data }`. 404 `approval_not_found` kalau sesi itu tidak pernah menunggu approval; 403 di luar scope.

### `POST /api/v1/sessions/{id}/refund-done`

Body `{ "note": "Transfer BCA 21/10" }` (opsional, ≤ 500). Hanya `CLINIC_ADMIN` klinik sesi itu dan `SUPER_ADMIN`. Respons `{ data: approval }`. 409 `refund_not_needed` kalau tidak ada refund yang tertunda.

### `GET|PUT /api/v1/professionals/{id}/approval-setting`

`id` = `professionalId` (wp_users.ID). PUT body `{ "requiresApproval": true }`. Peran: psikolog itu sendiri, `CLINIC_ADMIN` yang klinik aktifnya memetakan psikolog itu, `SUPER_ADMIN`. 404 `professional_not_found` kalau psikolog tidak ada; 403 `forbidden` kalau bukan haknya; 422 untuk body yang salah.

```json
{ "data": { "professionalId": 142, "requiresApproval": true, "updatedAt": "2026-10-20T03:00:00.000Z", "updatedByName": "Rina Admin" } }
```

### Katalog publik

`GET /public/professionals`, `/public/professionals/{id}`, `/public/professionals/by-slug/{slug}`: setiap psikolog membawa `requiresApproval: boolean`.

## Kode error

Jalur approval (`GET /sessions/approvals`, `GET /sessions/{id}/approval`, dan `POST` ke `/approve`,
`/reject`, `/refund-done` di bawah `/sessions/{id}`) menjawab error dengan badan bergaya RFC 7807:
`{ "type": "/errors/<kode>", "title": "<kode>", "status": <HTTP>, "detail": "<pesan Inggris>" }`.
Kodenya ada di `title` (dan di `type`), bukan di field `code`; cocokkan `title`, jangan `detail`.
Header `Content-Type`-nya `application/json`, bukan `application/problem+json`. Pengecualiannya
ada di bawah tabel.

| HTTP | Kode (`title`) | Endpoint | Kapan | Yang dilakukan FE |
|---|---|---|---|---|
| 409 | `approval_already_decided` | `/approve`, `/reject` | Kalah balapan: dua keputusan masuk bersamaan dan yang lain menang. `detail` menyebut keputusan dan pengambilnya. | Muat ulang item, tampilkan keputusan yang sudah ada. Jangan diulang. |
| 400 | `invalid_transition` | `/approve`, `/reject` | Sesi sudah bukan `PENDING` saat permintaan sampai (halaman basi): `/approve` pada sesi `BOOKED`, `CHECK_IN`, `CHECK_OUT` atau `CANCELLED`; `/reject` pada sesi mana pun yang bukan `PENDING`: `BOOKED`, `CHECK_IN`, `CHECK_OUT` atau `CANCELLED`. | Muat ulang item dan tampilkan keputusan yang sudah ada; tombol keputusan hilang sendiri. |
| 422 | `session_already_started` | `/approve` | Jam sesi sudah lewat (`isOverdue`). | Tampilkan bahwa hanya tolak yang mungkin; sembunyikan Setujui. |
| 502 | `upstream_failed` | `/approve` | Penulisan ke WordPress gagal. Klaim keputusan sudah dibatalkan, permintaan kembali `AWAITING`. | Aman diulang. Tampilkan "coba lagi". |
| 500 | `status_write_failed` | `/reject` | Penulisan status batal gagal. Klaim keputusan sudah dibatalkan, permintaan kembali `AWAITING`. | Aman diulang. Tampilkan "coba lagi". |
| 409 | `refund_not_needed` | `/refund-done` | `refundStatus` bukan `NEEDED` (sudah `DONE`, atau tidak pernah `NEEDED`). `detail` menyebut statusnya. | Muat ulang item. |
| 404 | `approval_not_found` | `/approval`, `/refund-done` | Sesinya ada, tetapi tidak pernah menunggu approval. | Tampilkan "bukan booking approval". |
| 404 | `not_found` | `/approve`, `/reject`, `/approval`, `/refund-done` | Id sesi tidak ada. | Kembali ke antrean. |
| 403 | `forbidden` | semua | Di luar scope atau peran salah: resepsionis di antrean, `/approval` atau `/approve`; psikolog di `/refund-done`; sesi milik psikolog atau klinik lain; `/approve` atau `/reject` pada sesi `AWAITING` oleh selain psikolognya, `CLINIC_ADMIN` atau `SUPER_ADMIN`. | Sembunyikan aksinya sesuai peran. |
| 422 | validasi | `/sessions/approvals`, `/reject`, `/refund-done` | Query atau body salah: `state` tidak dikenal, `limit` di luar 1–100, `page` < 1, `professionalId` atau `clinicId` bukan bilangan bulat positif, `reason` hilang, kosong atau > 500, body `/reject` kosong atau bukan JSON, `note` > 500 atau ada kunci lain di body. `title` = `Validation Error`, `type` = `/errors/validation-error`. | Perbaiki input. |

Selain tabel itu:

- 400 `Invalid session id` (`type` `/errors/validation-error`): id di path bukan bilangan bulat positif.
- 401: token tidak ada atau kedaluwarsa. Bentuknya problem+json lengkap dengan field `code` terpisah
  dan header `application/problem+json`.
- 500 `{ "error": "Internal server error" }` tanpa kode: kegagalan tak terduga. Muat ulang item untuk
  melihat apakah keputusannya sempat tercatat sebelum mengulang.
- `GET|PUT /professionals/{id}/approval-setting` memakai problem+json biasa dengan kode di field
  `code`: 403 `forbidden`, 404 `professional_not_found`, 422 (`title` `Validation Error`), 400 untuk
  id yang bukan bilangan positif.
