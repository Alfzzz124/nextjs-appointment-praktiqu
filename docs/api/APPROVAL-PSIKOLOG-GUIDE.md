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

Ada di `POST /public/payment-verify` dan `GET /public/appointments/{token}`. Hanya
`state`, `requestedAt`, `decidedAt`, `refundStatus`, `isOverdue`.

## Arti status + approval

| `status` | `approval.state` | `refundStatus` | Label FE |
|---|---|---|---|
| `PENDING` | — | — | Belum dibayar |
| `PENDING` | `AWAITING` | `NONE` | Lunas · menunggu psikolog |
| `BOOKED` | `APPROVED` | `NONE` | Terjadwal · lunas |
| `CANCELLED` | `REJECTED` | `NEEDED` / `DONE` | Ditolak · perlu refund / sudah direfund |
| `CANCELLED` | `CANCELLED` | `NEEDED` / `DONE` | Batal · perlu refund / sudah direfund |

## Aksi yang sudah ada, arti barunya

| Endpoint | Sesi `PENDING` tanpa approval | Sesi `PENDING` + `AWAITING` |
|---|---|---|
| `POST /sessions/{id}/approve` | Tandai lunas. Kalau saklar psikolog menyala → masuk antrean (tetap `PENDING`, `approval.state = AWAITING`), selain itu `BOOKED`. | Setujui → `BOOKED`. Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. 422 `session_already_started` kalau jam sesi lewat. |
| `POST /sessions/{id}/reject` `{reason}` | Batal seperti sebelumnya. | Tolak → `CANCELLED`, `refundStatus = NEEDED`, email standar ke klien (tanpa alasan). Hanya psikolognya, `CLINIC_ADMIN`, `SUPER_ADMIN`. |
| `POST /sessions/{id}/cancel` | Batal. | Batal → `approval.state = CANCELLED`, `refundStatus = NEEDED`. |

Keputusan yang kalah balapan: **409 `approval_already_decided`**.

## Endpoint baru

### `GET /api/v1/sessions/approvals`

Query: `state` = `AWAITING` (default) | `REFUND_NEEDED` | `REFUNDED` | `DECIDED`;
`professionalId`, `clinicId`, `page` (≥1), `limit` (1–100, default 20).

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

Kuncinya lebih dari satu, jadi `PraktiquApi::unwrap()` di FE **tidak** membukanya. Baca `$res['data']` dan `$res['counts']`.

### `GET /api/v1/sessions/{id}/approval`

Satu item, bentuknya sama dengan item antrean, dibungkus `{ data }`. 404 `approval_not_found` kalau sesi itu tidak pernah menunggu approval; 403 di luar scope.

### `POST /api/v1/sessions/{id}/refund-done`

Body `{ "note": "Transfer BCA 21/10" }` (opsional, ≤ 500). Hanya `CLINIC_ADMIN` klinik sesi itu dan `SUPER_ADMIN`. Respons `{ data: approval }`. 409 `refund_not_needed` kalau tidak ada refund yang tertunda.

### `GET|PUT /api/v1/professionals/{id}/approval-setting`

`id` = `professionalId` (wp_users.ID). PUT body `{ "requiresApproval": true }`. Peran: psikolog itu sendiri, `CLINIC_ADMIN` yang klinik aktifnya memetakan psikolog itu, `SUPER_ADMIN`. 404 kalau psikolog tidak ada; 403 kalau bukan haknya; 422 untuk body yang salah.

```json
{ "data": { "professionalId": 142, "requiresApproval": true, "updatedAt": "2026-10-20T03:00:00.000Z", "updatedByName": "Rina Admin" } }
```

### Katalog publik

`GET /public/professionals`, `/public/professionals/{id}`, `/public/professionals/by-slug/{slug}`: setiap psikolog membawa `requiresApproval: boolean`.
