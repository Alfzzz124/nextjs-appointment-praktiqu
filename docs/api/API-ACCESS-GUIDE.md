# Panduan Akses API PraktiQU (`/api/v1`)

Catatan praktis cara mengakses endpoint yang ada di [`openapi.yaml`](./openapi.yaml): mana yang **publik** (tanpa token), mana yang **butuh Bearer token**, dan cara melampirkan token pada request.

> Diverifikasi langsung ke server staging (`staging2.praktiqu.com`) pada 2026-07-20 — bukan hanya membaca spec.

---

## 1. Ringkasan singkat

| | Jumlah |
|---|---|
| Total operasi | **261** |
| Publik (tanpa token) | **21** |
| Butuh Bearer token | **240** |

> Angka di atas: 260/20/240 saat diverifikasi 2026-07-20, ditambah `POST /api/v1/public/auth/register` yang menyusul pada 2026-08-07.

**Aturan mudah:**
- Semua yang berawalan **`/api/v1/public/*`** → **publik** (tanpa token).
- Endpoint auth untuk masuk (`login`, `refresh`, `forgot-password`, `reset-password`) → **tanpa token**.
- **Selain itu semua butuh token** `Authorization: Bearer <accessToken>`.

> ⚠️ **Penting soal `openapi.yaml`:** file spec itu **di-generate otomatis dari route**, dan banyak endpoint non-`/public/` tertulis `security: []` (seolah publik) padahal **kenyataannya butuh token** (server membalas `401`). Contoh yang sudah diuji dan ternyata **butuh token**: `practices`, `email-templates`, `intervention-plans`, `notes-templates`, `consent-forms`, `custom-fields`, `session-notes`. **Acuan yang benar adalah dokumen ini**, bukan field `security` di `openapi.yaml`.

---

## 2. Base URL

| Environment | Base URL |
|---|---|
| Staging (live) | `https://staging2.praktiqu.com` |
| Local dev | `http://localhost:3000` |

Semua path di bawah diawali base URL, mis. `https://staging2.praktiqu.com/api/v1/public/config`.

> Catatan: di `openapi.yaml` server tertulis `staging.praktiqu.com`, tapi deployment yang aktif adalah **`staging2.praktiqu.com`**.

---

## 3. Model autentikasi

- **Skema:** JWT Bearer. Login menghasilkan `accessToken` (masa berlaku pendek) + `refreshToken` (masa berlaku panjang).
- **Cara pakai:** kirim header `Authorization: Bearer <accessToken>` pada setiap request ke endpoint terproteksi.
- **Lapis kedua (modul KC):** sebagian endpoint (bills, taxes, encounters, dashboard, dll.) selain butuh token juga butuh **capability** tertentu sesuai role. Kalau token valid tapi role tidak punya capability-nya → **`403 Forbidden`** (lihat kolom *Capability* di §7).

---

## 4. Endpoint PUBLIK (tanpa token)

Bisa dipanggil langsung tanpa `Authorization`.

| Method | Endpoint | Keterangan |
|---|---|---|
| `POST` | `/api/v1/auth/forgot-password` |  |
| `POST` | `/api/v1/auth/login` |  |
| `POST` | `/api/v1/auth/refresh` | pakai `refreshToken` di body, bukan Bearer |
| `POST` | `/api/v1/auth/reset-password` | stub (501) |
| `POST` | `/api/v1/public/appointments` |  |
| `GET` | `/api/v1/public/appointments/{token}` |  |
| `POST` | `/api/v1/public/auth/register` | registrasi mandiri pasien; balas `201` + token — lihat [PUBLIC-REGISTER.md](./PUBLIC-REGISTER.md) |
| `POST` | `/api/v1/public/appointments/{token}/cancel` |  |
| `POST` | `/api/v1/public/booking` |  |
| `GET` | `/api/v1/public/booking/hold` |  |
| `POST` | `/api/v1/public/booking/hold` |  |
| `GET` | `/api/v1/public/config` |  |
| `POST` | `/api/v1/public/payment-verify` |  |
| `POST` | `/api/v1/public/payments` |  |
| `GET` | `/api/v1/public/practices` |  |
| `GET` | `/api/v1/public/practices/{id}` |  |
| `GET` | `/api/v1/public/professionals` |  |
| `GET` | `/api/v1/public/professionals/{id}/services` |  |
| `GET` | `/api/v1/public/professionals/{id}/slots` |  |
| `GET` | `/api/v1/public/rating/{id}` |  |
| `GET` | `/api/v1/public/static-data` |  |

Contoh (tanpa token):

```bash
curl -sS https://staging2.praktiqu.com/api/v1/public/config
curl -sS https://staging2.praktiqu.com/api/v1/public/professionals
```

---

## 5. Cara mendapatkan token (login)

`POST /api/v1/auth/login` dengan body JSON `{ email, password }`.

```bash
curl -sS -X POST https://staging2.praktiqu.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"EMAIL_KAMU","password":"PASSWORD_KAMU"}'
```

> Gunakan **single-quote** untuk `-d` supaya karakter spesial pada password (mis. `!`, `$`) tidak diproses shell.

Response sukses (`200`):

```json
{
  "user": { "id": "...", "email": "...", "role": "..." },
  "accessToken": "eyJhbGciOi...",
  "accessTokenExpiresAt": "2026-07-20T10:00:00.000Z",
  "refreshToken": "eyJhbGciOi...",
  "refreshTokenExpiresAt": "2026-07-27T09:00:00.000Z"
}
```

Yang dipakai untuk request berikutnya adalah **`accessToken`**.

---

## 6. Cara melampirkan token ke request

Header-nya selalu: `Authorization: Bearer <accessToken>`.

### a) Simpan token ke variable, lalu pakai (butuh `jq`)

```bash
TOKEN=$(curl -sS -X POST https://staging2.praktiqu.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"EMAIL_KAMU","password":"PASSWORD_KAMU"}' \
  | jq -r '.accessToken')

# panggil endpoint terproteksi:
curl -sS https://staging2.praktiqu.com/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"

curl -sS https://staging2.praktiqu.com/api/v1/professionals \
  -H "Authorization: Bearer $TOKEN"
```

### b) POST/PATCH dengan body + token

```bash
curl -sS -X POST https://staging2.praktiqu.com/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"...","professionalId":"...","serviceId":"...","slotDate":"2026-08-01","startTime":"2026-08-01T09:00:00.000Z"}'
```

### c) HTTPie

```bash
http GET https://staging2.praktiqu.com/api/v1/professionals \
  "Authorization: Bearer $TOKEN"
```

### d) JavaScript `fetch`

```js
const res = await fetch("https://staging2.praktiqu.com/api/v1/professionals", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const data = await res.json();
```

### e) Axios (instance dengan token default)

```js
import axios from "axios";
const api = axios.create({
  baseURL: "https://staging2.praktiqu.com/api/v1",
  headers: { Authorization: `Bearer ${accessToken}` },
});
await api.get("/professionals");
await api.post("/clients", { firstName: "Budi", email: "budi@example.com" });
```

### f) Postman / Insomnia
- Tab **Authorization** → Type **Bearer Token** → tempel `accessToken`.
- Atau set **environment variable** `accessToken`, lalu header `Authorization: Bearer {{accessToken}}`.

---

## 7. Refresh token (kalau accessToken kedaluwarsa)

Kalau accessToken habis masa berlaku, request akan `401`. Ambil token baru tanpa login ulang:

```bash
curl -sS -X POST https://staging2.praktiqu.com/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"REFRESH_TOKEN_KAMU"}'
```

---

## 8. Format response & error

Ada **dua konvensi** yang dipakai bersamaan:

- **Modul standar** (auth, sessions, professionals, clients, practices, dll.) → mengembalikan entity / `data` langsung; error mengikuti **RFC 7807** `application/problem+json`.
- **Modul KC** (bills, taxes, encounters, prescriptions, medical-history, dashboard, dll.) → amplop `{ "status", "message", "data" }`.

Kode status umum:

| Kode | Arti | Kapan |
|---|---|---|
| `200` / `201` | Sukses | — |
| `400` | Bad Request | body/validasi input salah (mis. login tanpa email) |
| `401` | Unauthorized | token tidak ada / tidak valid / kedaluwarsa |
| `403` | Forbidden | token valid, tapi role tidak punya capability |
| `404` | Not Found | resource tidak ada |
| `422` | Validation Error | payload gagal validasi skema |
| `501` | Not Implemented | endpoint masih stub (belum di-wire) |

Contoh error `401` (RFC 7807):

```json
{
  "type": "https://staging2.praktiqu.com/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "code": "missing_token",
  "detail": "Authentication required",
  "instance": "/api/v1/auth/me"
}
```

---

## 9. Referensi endpoint yang BUTUH token

Dikelompokkan per modul. Kolom **Capability** hanya untuk modul KC — kalau `—`, aksesnya berbasis role/kepemilikan data (bukan capability spesifik). Beberapa endpoint bertanda **_stub 501_** artinya belum diimplementasikan.

### `auth` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `POST` | `/api/v1/auth/change-password` | — |
| `DELETE` | `/api/v1/auth/delete-account` | — |
| `POST` | `/api/v1/auth/logout` | — |
| `GET` | `/api/v1/auth/me` | — |
| `POST` | `/api/v1/auth/register` | — |

### `bills` (12)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/bills` | `patient_bill_list` |
| `POST` | `/api/v1/bills` | `patient_bill_add` |
| `GET` | `/api/v1/bills/by-encounter/{encounterId}` | `patient_bill_view` |
| `POST` | `/api/v1/bills/calculate-tax` | `patient_bill_view` |
| `GET` | `/api/v1/bills/encounters-without-bill` | `patient_bill_list` |
| `GET` | `/api/v1/bills/export` | `patient_bill_list` |
| `DELETE` | `/api/v1/bills/item/{itemId}` | `patient_bill_add` / `patient_bill_delete` |
| `PUT` | `/api/v1/bills/item/{itemId}` | `patient_bill_add` / `patient_bill_delete` |
| `GET` | `/api/v1/bills/{id}` | `patient_bill_view` |
| `PUT` | `/api/v1/bills/{id}` | `patient_bill_add` |
| `POST` | `/api/v1/bills/{id}/email` | `patient_bill_view` |
| `GET` | `/api/v1/bills/{id}/print` | `patient_bill_view` |

### `clients` (14)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/clients` | — |
| `POST` | `/api/v1/clients` | — |
| `POST` | `/api/v1/clients/bulk/delete` | — |
| `POST` | `/api/v1/clients/bulk/resend-credentials` | — · _stub 501_ |
| `POST` | `/api/v1/clients/bulk/status` | — |
| `GET` | `/api/v1/clients/export` | — |
| `DELETE` | `/api/v1/clients/{id}` | — |
| `GET` | `/api/v1/clients/{id}` | — |
| `PATCH` | `/api/v1/clients/{id}` | — |
| `GET` | `/api/v1/clients/{id}/custom-fields` | — |
| `PUT` | `/api/v1/clients/{id}/custom-fields` | — |
| `POST` | `/api/v1/clients/{id}/resend-credentials` | — · _stub 501_ |
| `GET` | `/api/v1/clients/{id}/statistics` | — |
| `PATCH` | `/api/v1/clients/{id}/status` | — |

### `clinic-schedules` (7)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/clinic-schedules` | `schedule_read` |
| `POST` | `/api/v1/clinic-schedules` | `schedule_manage` |
| `POST` | `/api/v1/clinic-schedules/get-unavailable-schedule` | `schedule_read` |
| `GET` | `/api/v1/clinic-schedules/module` | `schedule_read` |
| `DELETE` | `/api/v1/clinic-schedules/{id}` | `schedule_manage` |
| `GET` | `/api/v1/clinic-schedules/{id}` | `schedule_read` |
| `PUT` | `/api/v1/clinic-schedules/{id}` | `schedule_manage` |

### `consent-forms` (6)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/consent-forms` | — |
| `POST` | `/api/v1/consent-forms` | — |
| `POST` | `/api/v1/consent-forms/status` | — |
| `DELETE` | `/api/v1/consent-forms/{id}` | — |
| `GET` | `/api/v1/consent-forms/{id}` | — |
| `PATCH` | `/api/v1/consent-forms/{id}` | — |

### `consent-signatures` (2)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/consent-signatures` | — |
| `POST` | `/api/v1/consent-signatures` | — |

### `custom-fields` (9)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/custom-fields` | — |
| `POST` | `/api/v1/custom-fields` | — |
| `POST` | `/api/v1/custom-fields/file-upload` | — |
| `GET` | `/api/v1/custom-fields/get-data` | — |
| `POST` | `/api/v1/custom-fields/save-data` | — |
| `POST` | `/api/v1/custom-fields/status` | — |
| `DELETE` | `/api/v1/custom-fields/{id}` | — |
| `GET` | `/api/v1/custom-fields/{id}` | — |
| `PATCH` | `/api/v1/custom-fields/{id}` | — |

### `dashboard` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/dashboard/recent-payments` | `dashboard_read` |
| `GET` | `/api/v1/dashboard/revenue-chart` | `dashboard_read` |
| `GET` | `/api/v1/dashboard/statistics` | `dashboard_read` |
| `GET` | `/api/v1/dashboard/top-professionals` | `dashboard_read` |
| `GET` | `/api/v1/dashboard/upcoming-sessions` | `dashboard_read` |

### `doctor-sessions` (8)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/doctor-sessions` | `doctor_session_read` |
| `POST` | `/api/v1/doctor-sessions` | `doctor_session_manage` |
| `POST` | `/api/v1/doctor-sessions/bulk/delete` | `doctor_session_manage` |
| `GET` | `/api/v1/doctor-sessions/export` | `doctor_session_read` |
| `GET` | `/api/v1/doctor-sessions/module` | `doctor_session_read` |
| `DELETE` | `/api/v1/doctor-sessions/{id}` | `doctor_session_manage` |
| `GET` | `/api/v1/doctor-sessions/{id}` | `doctor_session_read` |
| `PUT` | `/api/v1/doctor-sessions/{id}` | `doctor_session_manage` |

### `email-templates` (6)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/email-templates` | — |
| `POST` | `/api/v1/email-templates` | — |
| `DELETE` | `/api/v1/email-templates/{id}` | — |
| `GET` | `/api/v1/email-templates/{id}` | — |
| `PATCH` | `/api/v1/email-templates/{id}` | — |
| `POST` | `/api/v1/email-templates/{id}/preview` | — |

### `encounters` (9)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/encounters` | `encounter_read` |
| `POST` | `/api/v1/encounters` | `encounter_manage` |
| `POST` | `/api/v1/encounters/bulk/delete` | `encounter_manage` |
| `POST` | `/api/v1/encounters/bulk/status` | `encounter_manage` |
| `GET` | `/api/v1/encounters/export` | `encounter_read` |
| `DELETE` | `/api/v1/encounters/{id}` | `encounter_manage` |
| `GET` | `/api/v1/encounters/{id}` | `encounter_read` |
| `PUT` | `/api/v1/encounters/{id}` | `encounter_manage` |
| `GET` | `/api/v1/encounters/{id}/print` | `encounter_read` |

### `followup-chains` (4)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/followup-chains` | `followup_read` |
| `POST` | `/api/v1/followup-chains` | `followup_manage` |
| `GET` | `/api/v1/followup-chains/{id}` | `followup_read` |
| `PUT` | `/api/v1/followup-chains/{id}` | `followup_manage` |

### `followup-reminders` (1)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `DELETE` | `/api/v1/followup-reminders/{id}` | `followup_manage` |

### `followups` (13)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/followups` | `followup_read` |
| `POST` | `/api/v1/followups` | `followup_manage` |
| `POST` | `/api/v1/followups/bulk/status` | `followup_manage` |
| `GET` | `/api/v1/followups/due` | `followup_read` |
| `DELETE` | `/api/v1/followups/{id}` | `followup_manage` |
| `GET` | `/api/v1/followups/{id}` | `followup_read` |
| `PUT` | `/api/v1/followups/{id}` | `followup_manage` |
| `GET` | `/api/v1/followups/{id}/activity` | `followup_read` |
| `POST` | `/api/v1/followups/{id}/cancel` | `followup_manage` |
| `POST` | `/api/v1/followups/{id}/complete` | `followup_manage` |
| `GET` | `/api/v1/followups/{id}/reminders` | `followup_read` |
| `POST` | `/api/v1/followups/{id}/reminders` | `followup_manage` |
| `POST` | `/api/v1/followups/{id}/send-reminder` | `followup_manage` |

### `gdpr` (11)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/gdpr/audit-log` | `gdpr_audit_read` |
| `GET` | `/api/v1/gdpr/consent-versions` | `gdpr_read` |
| `POST` | `/api/v1/gdpr/consent-versions` | `gdpr_manage` |
| `GET` | `/api/v1/gdpr/consent-versions/{id}` | `gdpr_read` |
| `POST` | `/api/v1/gdpr/consent-versions/{id}/activate` | `gdpr_manage` |
| `GET` | `/api/v1/gdpr/consents` | `gdpr_read` |
| `POST` | `/api/v1/gdpr/consents` | `gdpr_manage` |
| `GET` | `/api/v1/gdpr/consents/{id}` | `gdpr_read` |
| `POST` | `/api/v1/gdpr/consents/{id}/withdraw` | `gdpr_manage` |
| `POST` | `/api/v1/gdpr/data-delete` | `gdpr_delete` |
| `POST` | `/api/v1/gdpr/data-export` | `gdpr_export` |

### `import` (3)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `POST` | `/api/v1/import` | `import_manage` |
| `GET` | `/api/v1/import/templates` | `import_manage` |
| `POST` | `/api/v1/import/validate` | `import_manage` |

### `intervention-plans` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/intervention-plans` | — |
| `POST` | `/api/v1/intervention-plans` | — |
| `GET` | `/api/v1/intervention-plans/{id}` | — |
| `POST` | `/api/v1/intervention-plans/{id}/items` | — |
| `PATCH` | `/api/v1/intervention-plans/{id}/items/{itemId}/complete` | — |

### `medical-history` (6)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/medical-history` | `medical_history_read` |
| `POST` | `/api/v1/medical-history` | `medical_history_manage` |
| `GET` | `/api/v1/medical-history/export` | `medical_history_read` |
| `DELETE` | `/api/v1/medical-history/{id}` | `medical_history_manage` |
| `GET` | `/api/v1/medical-history/{id}` | `medical_history_read` |
| `PUT` | `/api/v1/medical-history/{id}` | `medical_history_manage` |

### `notes-templates` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/notes-templates` | — |
| `POST` | `/api/v1/notes-templates` | — |
| `DELETE` | `/api/v1/notes-templates/{id}` | — |
| `GET` | `/api/v1/notes-templates/{id}` | — |
| `PATCH` | `/api/v1/notes-templates/{id}` | — |

### `patient-medical-reports` (10)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/patient-medical-reports` | `patient_report_read` |
| `POST` | `/api/v1/patient-medical-reports` | `patient_report_manage` |
| `POST` | `/api/v1/patient-medical-reports/bulk/delete` | `patient_report_manage` |
| `GET` | `/api/v1/patient-medical-reports/export` | `patient_report_read` |
| `DELETE` | `/api/v1/patient-medical-reports/{id}` | `patient_report_manage` |
| `GET` | `/api/v1/patient-medical-reports/{id}` | `patient_report_read` |
| `GET` | `/api/v1/patient-medical-reports/{id}/file` | `patient_report_read` |
| `GET` | `/api/v1/patient-medical-reports/{id}/preview` | `patient_report_read` · _stub 501_ |
| `GET` | `/api/v1/patient-medical-reports/{id}/print` | `patient_report_read` · _stub 501_ |
| `POST` | `/api/v1/patient-medical-reports/{id}/send-email` | `patient_report_manage` · _stub 501_ |

### `practices` (17)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/practices` | — · _stub 501_ |
| `POST` | `/api/v1/practices` | — · _stub 501_ |
| `POST` | `/api/v1/practices/bulk/delete` | — |
| `POST` | `/api/v1/practices/bulk/resend-credentials` | — · _stub 501_ |
| `POST` | `/api/v1/practices/bulk/status` | — |
| `GET` | `/api/v1/practices/export` | — |
| `DELETE` | `/api/v1/practices/{id}` | — |
| `GET` | `/api/v1/practices/{id}` | — |
| `PATCH` | `/api/v1/practices/{id}` | — |
| `POST` | `/api/v1/practices/{id}/change-admin` | — |
| `DELETE` | `/api/v1/practices/{id}/holidays` | — |
| `GET` | `/api/v1/practices/{id}/holidays` | — |
| `POST` | `/api/v1/practices/{id}/holidays` | — |
| `POST` | `/api/v1/practices/{id}/resend-credentials` | — · _stub 501_ |
| `GET` | `/api/v1/practices/{id}/settings` | — |
| `PATCH` | `/api/v1/practices/{id}/settings` | — |
| `GET` | `/api/v1/practices/{id}/users` | — |

### `prescriptions` (7)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/prescriptions` | `prescription_read` |
| `POST` | `/api/v1/prescriptions` | `prescription_manage` |
| `POST` | `/api/v1/prescriptions/bulk/delete` | `prescription_manage` |
| `GET` | `/api/v1/prescriptions/export` | `prescription_read` |
| `DELETE` | `/api/v1/prescriptions/{id}` | `prescription_manage` |
| `GET` | `/api/v1/prescriptions/{id}` | `prescription_read` |
| `PUT` | `/api/v1/prescriptions/{id}` | `prescription_manage` |

### `professionals` (23)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/professionals` | — |
| `POST` | `/api/v1/professionals` | — |
| `POST` | `/api/v1/professionals/bulk/delete` | — |
| `POST` | `/api/v1/professionals/bulk/resend-credentials` | — · _stub 501_ |
| `POST` | `/api/v1/professionals/bulk/status` | — |
| `GET` | `/api/v1/professionals/export` | — |
| `DELETE` | `/api/v1/professionals/{id}` | — |
| `GET` | `/api/v1/professionals/{id}` | — |
| `PATCH` | `/api/v1/professionals/{id}` | — |
| `GET` | `/api/v1/professionals/{id}/availability` | — |
| `PUT` | `/api/v1/professionals/{id}/availability` | — |
| `DELETE` | `/api/v1/professionals/{id}/off-days` | — |
| `GET` | `/api/v1/professionals/{id}/off-days` | — |
| `POST` | `/api/v1/professionals/{id}/off-days` | — |
| `POST` | `/api/v1/professionals/{id}/resend-credentials` | — · _stub 501_ |
| `DELETE` | `/api/v1/professionals/{id}/services` | — |
| `GET` | `/api/v1/professionals/{id}/services` | — |
| `POST` | `/api/v1/professionals/{id}/services` | — |
| `POST` | `/api/v1/professionals/{id}/services/bulk/delete` | — |
| `POST` | `/api/v1/professionals/{id}/services/bulk/status` | — |
| `GET` | `/api/v1/professionals/{id}/services/export` | — |
| `GET` | `/api/v1/professionals/{id}/slots` | — |
| `PATCH` | `/api/v1/professionals/{id}/status` | — |

### `ratings` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/ratings` | `rating_read` |
| `POST` | `/api/v1/ratings` | `rating_manage` |
| `GET` | `/api/v1/ratings/stats` | `rating_read` |
| `DELETE` | `/api/v1/ratings/{id}` | `rating_manage` |
| `GET` | `/api/v1/ratings/{id}` | `rating_read` |

### `receptionists` (10)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/receptionists` | `receptionist_read` |
| `POST` | `/api/v1/receptionists` | `receptionist_manage` |
| `POST` | `/api/v1/receptionists/bulk/delete` | `receptionist_manage` |
| `POST` | `/api/v1/receptionists/bulk/resend-credentials` | `receptionist_manage` · _stub 501_ |
| `POST` | `/api/v1/receptionists/bulk/status` | `receptionist_manage` |
| `GET` | `/api/v1/receptionists/export` | `receptionist_read` |
| `DELETE` | `/api/v1/receptionists/{id}` | `receptionist_manage` |
| `GET` | `/api/v1/receptionists/{id}` | `receptionist_read` |
| `PUT` | `/api/v1/receptionists/{id}` | `receptionist_manage` |
| `POST` | `/api/v1/receptionists/{id}/resend-credentials` | `receptionist_manage` · _stub 501_ |

### `session-notes` (5)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/session-notes` | — |
| `POST` | `/api/v1/session-notes` | — |
| `GET` | `/api/v1/session-notes/{id}` | — |
| `PATCH` | `/api/v1/session-notes/{id}` | — |
| `POST` | `/api/v1/session-notes/{id}/close` | — |

### `sessions` (22)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/sessions` | — |
| `POST` | `/api/v1/sessions` | — |
| `POST` | `/api/v1/sessions/bulk/delete` | — |
| `GET` | `/api/v1/sessions/calendar` | — |
| `GET` | `/api/v1/sessions/export` | — |
| `POST` | `/api/v1/sessions/payment-cancel` | — |
| `POST` | `/api/v1/sessions/payment-success` | — |
| `POST` | `/api/v1/sessions/payment-verify` | — |
| `POST` | `/api/v1/sessions/payment-webhook` | — |
| `GET` | `/api/v1/sessions/pending` | — |
| `GET` | `/api/v1/sessions/{id}` | — |
| `POST` | `/api/v1/sessions/{id}/approve` | — |
| `POST` | `/api/v1/sessions/{id}/cancel` | — |
| `POST` | `/api/v1/sessions/{id}/check-in` | — |
| `POST` | `/api/v1/sessions/{id}/check-out` | — |
| `GET` | `/api/v1/sessions/{id}/custom-fields` | — |
| `PUT` | `/api/v1/sessions/{id}/custom-fields` | — |
| `GET` | `/api/v1/sessions/{id}/notes` | — |
| `GET` | `/api/v1/sessions/{id}/print-invoice` | — |
| `POST` | `/api/v1/sessions/{id}/regenerate-video-conference` | — · _stub 501_ |
| `POST` | `/api/v1/sessions/{id}/reject` | — |
| `GET` | `/api/v1/sessions/{id}/summary` | — |

### `taxes` (9)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `GET` | `/api/v1/taxes` | `tax_read` |
| `POST` | `/api/v1/taxes` | `tax_manage` |
| `POST` | `/api/v1/taxes/bulk/delete` | `tax_manage` |
| `PUT` | `/api/v1/taxes/bulk/status` | `tax_manage` |
| `GET` | `/api/v1/taxes/export` | `tax_read` |
| `DELETE` | `/api/v1/taxes/{id}` | `tax_manage` |
| `GET` | `/api/v1/taxes/{id}` | `tax_read` |
| `PUT` | `/api/v1/taxes/{id}` | `tax_manage` |
| `PUT` | `/api/v1/taxes/{id}/status` | `tax_manage` |

### `webhooks` (1)

| Method | Endpoint | Capability (KC) |
|---|---|---|
| `POST` | `/api/v1/webhooks/wordpress-jobs` | — |

---

## 10. Tips

- **Selalu login dulu** untuk endpoint non-`/public/`. Tanpa token → `401`.
- Kalau dapat **`403`** padahal sudah login: token-nya valid, tapi **role kamu tidak punya capability** untuk aksi itu (lihat kolom Capability). Coba dengan akun ber-role lebih tinggi (mis. `CLINIC_ADMIN` / `SUPER_ADMIN`).
- Kalau dapat **`501`**: endpoint memang masih stub, bukan salah kamu.
- `accessToken` masa berlakunya pendek — kalau tiba-tiba `401` di tengah kerja, **refresh** (§7), jangan login berulang.
- Jangan menaruh token/password di URL query. Selalu lewat header `Authorization` dan body JSON.
